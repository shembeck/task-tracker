import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rolloverIncompleteTasks } from "@/lib/rollover";
import { pushBackup } from "@/lib/backup";
import {
  currentWeekStart,
  isValidWeekStart,
  normalizeToWeekStart,
  weekKind,
} from "@/lib/weeks";

const PRIORITIES = new Set(["high", "medium", "low"]);

export async function GET(request: NextRequest) {
  const { moved } = await rolloverIncompleteTasks();
  if (moved > 0) {
    await pushBackup();
  }

  const weekParam = request.nextUrl.searchParams.get("week");
  const weekStart = weekParam
    ? normalizeToWeekStart(weekParam)
    : currentWeekStart();

  const tasks = await prisma.task.findMany({
    where: { weekStart },
    include: { member: true },
    orderBy: [{ member: { name: "asc" } }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    weekStart,
    kind: weekKind(weekStart),
    tasks,
  });
}

export async function POST(request: NextRequest) {
  await rolloverIncompleteTasks();

  const body = await request.json().catch(() => null);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  const priorityRaw =
    typeof body?.priority === "string" ? body.priority.trim() : "medium";
  const priority = PRIORITIES.has(priorityRaw) ? priorityRaw : "";
  const weekRaw = typeof body?.weekStart === "string" ? body.weekStart : "";
  const weekStart = weekRaw
    ? normalizeToWeekStart(weekRaw)
    : currentWeekStart();

  if (!memberId || !title) {
    return NextResponse.json(
      { error: "memberId and title are required" },
      { status: 400 }
    );
  }

  if (!priority) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }

  if (!isValidWeekStart(weekStart)) {
    return NextResponse.json({ error: "Invalid week" }, { status: 400 });
  }

  if (weekKind(weekStart) === "past") {
    return NextResponse.json(
      { error: "Cannot add tasks to past weeks" },
      { status: 400 }
    );
  }

  const member = await prisma.teamMember.findUnique({ where: { id: memberId } });
  if (!member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  const task = await prisma.task.create({
    data: {
      memberId,
      title,
      notes,
      priority,
      weekStart,
      status: "active",
    },
    include: { member: true },
  });

  const backup = await pushBackup();
  if (!backup.ok) {
    console.error("Task saved but backup failed:", backup);
  }

  return NextResponse.json({ ...task, backup }, { status: 201 });
}
