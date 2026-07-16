import { existsSync, writeFileSync, rmSync } from "fs";
import { prisma } from "./db";
import { compareISODates, formatWeekLabel } from "./weeks";

/*
 * One-way backup + restore against the Google Apps Script web app.
 *
 * The app pushes a FULL snapshot (all members + all tasks) on every change. The
 * Apps Script stores it as a JSON file in Drive (machine-readable, used to
 * restore the database after a restart) and rewrites the companion Google Doc as
 * a human-readable archive with each week as a section, newest on top.
 *
 * This exists so the app can run on hosts without persistent storage (e.g. a
 * Render free web service, whose filesystem — and therefore its SQLite database
 * — is wiped on every redeploy and spin-down).
 */

const MARKER_PATH =
  process.env.BACKUP_MARKER_PATH || "/tmp/task-tracker-backup-ok";

type SnapshotMember = { id: string; name: string; createdAt: string };

type SnapshotTask = {
  id: string;
  title: string;
  notes: string;
  status: string;
  weekStart: string;
  rolledFrom: string | null;
  memberId: string;
  createdAt: string;
  updatedAt: string;
};

type DocWeek = {
  weekStart: string;
  label: string;
  members: {
    name: string;
    tasks: { title: string; notes: string; status: string }[];
  }[];
};

export type Snapshot = {
  generatedAt: string;
  members: SnapshotMember[];
  tasks: SnapshotTask[];
  weeks: DocWeek[];
};

async function buildSnapshot(): Promise<Snapshot> {
  const [members, tasks] = await Promise.all([
    prisma.teamMember.findMany({ orderBy: { name: "asc" } }),
    prisma.task.findMany({
      include: { member: true },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  const snapMembers: SnapshotMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    createdAt: m.createdAt.toISOString(),
  }));

  const snapTasks: SnapshotTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    weekStart: t.weekStart,
    rolledFrom: t.rolledFrom,
    memberId: t.memberId,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  // Pre-group for the human Doc: weeks newest-first, members A→Z.
  const weekMap = new Map<string, Map<string, DocWeek["members"][number]>>();
  for (const t of tasks) {
    let week = weekMap.get(t.weekStart);
    if (!week) {
      week = new Map();
      weekMap.set(t.weekStart, week);
    }
    let member = week.get(t.member.name);
    if (!member) {
      member = { name: t.member.name, tasks: [] };
      week.set(t.member.name, member);
    }
    member.tasks.push({ title: t.title, notes: t.notes, status: t.status });
  }

  const weeks: DocWeek[] = Array.from(weekMap.entries())
    .sort((a, b) => compareISODates(b[0], a[0]))
    .map(([weekStart, memberMap]) => ({
      weekStart,
      label: formatWeekLabel(weekStart),
      members: Array.from(memberMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));

  return {
    generatedAt: new Date().toISOString(),
    members: snapMembers,
    tasks: snapTasks,
    weeks,
  };
}

/**
 * Health marker: written by the startup restore only after it has successfully
 * reached the backend. `pushBackup` refuses to run without it, so a temporary
 * backend outage at startup can never cause the app to overwrite a good backup
 * with an empty database.
 */
export function isBackupHealthy(): boolean {
  return existsSync(MARKER_PATH);
}

export function markBackupHealthy(): void {
  try {
    writeFileSync(MARKER_PATH, new Date().toISOString());
  } catch (err) {
    console.error("Could not write backup health marker:", err);
  }
}

export function clearBackupHealthy(): void {
  try {
    rmSync(MARKER_PATH, { force: true });
  } catch {
    // ignore
  }
}

/**
 * Best-effort push of a full snapshot. Never throws — a backend outage must not
 * break task operations.
 */
export async function pushBackup(): Promise<void> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SYNC_SECRET;
  if (!url || !secret) return;

  if (!isBackupHealthy()) {
    console.warn(
      "Skipping backup push: startup restore has not completed successfully " +
        "(guarding against overwriting a good backup)."
    );
    return;
  }

  try {
    const snapshot = await buildSnapshot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, ...snapshot }),
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Backup push failed: HTTP ${res.status} ${body}`);
      return;
    }

    const result = await res.json().catch(() => null);
    if (result && result.ok === false) {
      console.error("Backup push rejected:", result.error || result);
      return;
    }
    console.log(
      "Backup push ok:",
      result
        ? `${result.members ?? "?"} members, ${result.tasks ?? "?"} tasks`
        : "no body"
    );
  } catch (err) {
    console.error("Backup push error:", err);
  }
}

/** Fetch the latest snapshot from the backend. Throws if unreachable. */
async function fetchBackup(
  url: string,
  secret: string
): Promise<Snapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Backup fetch failed: HTTP ${res.status}`);

  const data = await res.json();
  if (data && data.error) {
    throw new Error(`Backup fetch rejected: ${data.error}`);
  }
  if (
    !data ||
    (!Array.isArray(data.members) && !Array.isArray(data.tasks))
  ) {
    return null;
  }

  return {
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
    members: Array.isArray(data.members) ? data.members : [],
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    weeks: [],
  };
}

async function applySnapshot(snapshot: Snapshot): Promise<void> {
  // Members must exist before tasks (foreign key). A single transaction runs the
  // operations in array order, so member inserts precede task inserts.
  await prisma.$transaction([
    ...snapshot.members.map((m) =>
      prisma.teamMember.create({
        data: { id: m.id, name: m.name, createdAt: new Date(m.createdAt) },
      })
    ),
    ...snapshot.tasks.map((t) =>
      prisma.task.create({
        data: {
          id: t.id,
          title: t.title,
          notes: t.notes,
          status: t.status,
          weekStart: t.weekStart,
          rolledFrom: t.rolledFrom,
          memberId: t.memberId,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        },
      })
    ),
  ]);
}

export type RestoreResult =
  | { status: "not-configured" }
  | { status: "skipped-existing"; members: number; tasks: number }
  | { status: "empty-backup" }
  | { status: "restored"; members: number; tasks: number };

/**
 * If the local database is empty, restore it from the backend snapshot.
 * Throws only when the backend is unreachable — the caller must NOT mark the
 * backup healthy in that case.
 */
export async function restoreIfEmpty(): Promise<RestoreResult> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SYNC_SECRET;
  if (!url || !secret) return { status: "not-configured" };

  const [memberCount, taskCount] = await Promise.all([
    prisma.teamMember.count(),
    prisma.task.count(),
  ]);
  if (memberCount > 0 || taskCount > 0) {
    return { status: "skipped-existing", members: memberCount, tasks: taskCount };
  }

  const snapshot = await fetchBackup(url, secret);
  if (
    !snapshot ||
    (snapshot.members.length === 0 && snapshot.tasks.length === 0)
  ) {
    return { status: "empty-backup" };
  }

  await applySnapshot(snapshot);
  return {
    status: "restored",
    members: snapshot.members.length,
    tasks: snapshot.tasks.length,
  };
}
