import { existsSync, writeFileSync, rmSync } from "fs";
import { prisma } from "./db";
import { compareISODates, formatWeekLabel } from "./weeks";

/*
 * One-way backup + restore against the Google Apps Script web app.
 *
 * The app pushes a FULL snapshot (all members + all tasks) on every change. The
 * Apps Script stores it in Script Properties (machine-readable, used to restore
 * the database after a restart) and rewrites the companion Google Doc as a
 * human-readable archive with each week as a section, newest on top.
 *
 * This exists so the app can run on hosts without persistent storage (e.g. a
 * Render free web service, whose filesystem — and therefore its SQLite database
 * — is wiped on every redeploy and spin-down).
 */

const MARKER_PATH =
  process.env.BACKUP_MARKER_PATH || "/tmp/task-tracker-backup-ok";

/** Which backup slot in Apps Script to read/write (e.g. "production"). */
export function backupEnv(): string {
  if (process.env.BACKUP_ENV) return process.env.BACKUP_ENV;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** Local dev must never overwrite production backup unless explicitly opted in. */
export function backupPushEnabled(): boolean {
  if (process.env.BACKUP_PUSH_ENABLED === "true") return true;
  if (process.env.BACKUP_PUSH_ENABLED === "false") return false;
  return (
    process.env.NODE_ENV === "production" && backupEnv() === "production"
  );
}

export function backupRestoreEnabled(): boolean {
  if (process.env.BACKUP_RESTORE_ENABLED === "true") return true;
  if (process.env.BACKUP_RESTORE_ENABLED === "false") return false;
  return (
    process.env.NODE_ENV === "production" && backupEnv() === "production"
  );
}

type SnapshotMember = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
};

type SnapshotTask = {
  id: string;
  title: string;
  notes: string;
  status: string;
  priority?: string;
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
    tasks: {
      title: string;
      notes: string;
      status: string;
      priority?: string;
    }[];
  }[];
};

export type Snapshot = {
  generatedAt: string;
  members: SnapshotMember[];
  tasks: SnapshotTask[];
  weeks: DocWeek[];
};

export type PushBackupResult = {
  ok: boolean;
  skipped?: string;
  members?: number;
  tasks?: number;
  error?: string;
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
    active: m.active,
    createdAt: m.createdAt.toISOString(),
  }));

  const snapTasks: SnapshotTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    priority: t.priority,
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
    member.tasks.push({
      title: t.title,
      notes: t.notes,
      status: t.status,
      priority: t.priority,
    });
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
 * Post a snapshot to the Apps Script web app.
 *
 * Apps Script accepts the POST, then 302s to a googleusercontent "echo" URL
 * whose body is the doPost result. `redirect: "follow"` is the reliable mode
 * in Node — `manual` often hides the Location header and aborts the push.
 * `text/plain` avoids Apps Script quirks with application/json POSTs.
 */
async function postSnapshot(
  url: string,
  secret: string,
  environment: string,
  snapshot: Snapshot
): Promise<{ ok: boolean; members?: number; tasks?: number; error?: string }> {
  const body = JSON.stringify({ secret, environment, ...snapshot });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    const text = await res.text();
    let result: {
      ok?: boolean;
      members?: number;
      tasks?: number;
      error?: string;
    } | null = null;
    try {
      result = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: `non-JSON response HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    if (!res.ok || result?.ok === false) {
      return {
        ok: false,
        error: result?.error || `HTTP ${res.status}`,
      };
    }

    return {
      ok: true,
      members: result?.members,
      tasks: result?.tasks,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function pushBackupOnce(): Promise<PushBackupResult> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SYNC_SECRET;
  if (!url || !secret) {
    return { ok: false, skipped: "not-configured" };
  }

  if (!backupPushEnabled()) {
    console.warn(
      `Skipping backup push: disabled for env=${backupEnv()} ` +
        `(set BACKUP_PUSH_ENABLED=true only when intentionally pushing).`
    );
    return { ok: false, skipped: "push-disabled" };
  }

  if (!isBackupHealthy()) {
    console.warn(
      "Skipping backup push: startup restore has not completed successfully " +
        "(guarding against overwriting a good backup)."
    );
    return { ok: false, skipped: "not-healthy" };
  }

  try {
    const snapshot = await buildSnapshot();
    console.log(
      `Backup pushing snapshot: ${snapshot.members.length} members, ${snapshot.tasks.length} tasks`
    );

    const env = backupEnv();
    const result = await postSnapshot(url, secret, env, snapshot);
    if (!result.ok) {
      console.error("Backup push failed:", result.error);
      return { ok: false, error: result.error };
    }

    console.log(
      "Backup push ok:",
      `${result.members ?? snapshot.members.length} members, ` +
        `${result.tasks ?? snapshot.tasks.length} tasks`
    );
    return {
      ok: true,
      members: result.members ?? snapshot.members.length,
      tasks: result.tasks ?? snapshot.tasks.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Backup push error:", err);
    return { ok: false, error: message };
  }
}

/**
 * Serialize backup pushes so concurrent API requests can't race and overwrite a
 * newer snapshot with an older one (e.g. adding members quickly).
 * Each run builds a fresh snapshot after the previous push finishes.
 */
let backupChain: Promise<unknown> = Promise.resolve();

export function pushBackup(): Promise<PushBackupResult> {
  const run = backupChain.then(() => pushBackupOnce());
  // Keep the chain alive even if a push fails.
  backupChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Fetch the latest snapshot from the backend. Throws if unreachable. */
export async function fetchBackup(
  url: string,
  secret: string,
  environment: string = backupEnv()
): Promise<Snapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    const qs = new URLSearchParams({
      secret,
      env: environment,
    });
    res = await fetch(`${url}?${qs.toString()}`, {
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

  // empty:true from Apps Script means no backup stored yet
  if (data.empty === true) {
    return { generatedAt: "", members: [], tasks: [], weeks: [] };
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
        data: {
          id: m.id,
          name: m.name,
          active: m.active !== false,
          createdAt: new Date(m.createdAt),
        },
      })
    ),
    ...snapshot.tasks.map((t) =>
      prisma.task.create({
        data: {
          id: t.id,
          title: t.title,
          notes: t.notes,
          status: t.status,
          priority:
            t.priority === "high" || t.priority === "low" ? t.priority : "medium",
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

  if (!backupRestoreEnabled()) {
    console.warn(
      `Skipping backup restore: disabled for env=${backupEnv()} ` +
        `(local dev should not pull production backup on startup).`
    );
    return { status: "not-configured" };
  }

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

/** Local + remote backup status for debugging. */
export async function getBackupStatus() {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SYNC_SECRET;
  const [localMembers, localTasks] = await Promise.all([
    prisma.teamMember.count(),
    prisma.task.count(),
  ]);

  const env = backupEnv();
  const base = {
    configured: Boolean(url && secret),
    environment: env,
    pushEnabled: backupPushEnabled(),
    restoreEnabled: backupRestoreEnabled(),
    healthy: isBackupHealthy(),
    local: { members: localMembers, tasks: localTasks },
  };

  if (!url || !secret) {
    return { ...base, remote: null as null };
  }

  try {
    const remote = await fetchBackup(url, secret, env);
    return {
      ...base,
      remote: remote
        ? {
            members: remote.members.length,
            tasks: remote.tasks.length,
            generatedAt: remote.generatedAt || null,
            memberNames: remote.members.map((m) => m.name),
          }
        : null,
    };
  } catch (err) {
    return {
      ...base,
      remote: {
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
