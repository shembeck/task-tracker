import { prisma } from "./db";
import { currentWeekStart, formatWeekLabel } from "./weeks";

type SyncMember = {
  name: string;
  tasks: { title: string; notes: string; status: string }[];
};

type SyncPayload = {
  secret: string;
  weekStart: string;
  weekLabel: string;
  generatedAt: string;
  members: SyncMember[];
};

/** Build a snapshot of the current week grouped by member. */
async function buildCurrentWeekPayload(secret: string): Promise<SyncPayload> {
  const weekStart = currentWeekStart();
  const tasks = await prisma.task.findMany({
    where: { weekStart },
    include: { member: true },
    orderBy: [{ member: { name: "asc" } }, { createdAt: "asc" }],
  });

  const byMember = new Map<string, SyncMember>();
  for (const task of tasks) {
    let entry = byMember.get(task.memberId);
    if (!entry) {
      entry = { name: task.member.name, tasks: [] };
      byMember.set(task.memberId, entry);
    }
    entry.tasks.push({
      title: task.title,
      notes: task.notes,
      status: task.status,
    });
  }

  return {
    secret,
    weekStart,
    weekLabel: formatWeekLabel(weekStart),
    generatedAt: new Date().toISOString(),
    members: Array.from(byMember.values()),
  };
}

/**
 * Best-effort push of the current week to the Google Doc via the Apps Script
 * web app. Never throws — a Docs outage must not break task operations.
 */
export async function syncCurrentWeekToDoc(): Promise<void> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_SYNC_SECRET;

  if (!url || !secret) {
    // Sync not configured — silently skip.
    return;
  }

  try {
    const payload = await buildCurrentWeekPayload(secret);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`Google Doc sync failed: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error("Google Doc sync error:", err);
  }
}
