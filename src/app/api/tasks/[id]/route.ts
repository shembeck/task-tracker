import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { rolloverIncompleteTasks } from "@/lib/rollover";
import { syncCurrentWeekToDoc } from "@/lib/google-doc-sync";
import { weekKind } from "@/lib/weeks";

const STATUSES = new Set(["active", "complete", "obsolete"]);

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  await rolloverIncompleteTasks();
  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const kind = weekKind(existing.weekStart);
  const updates: {
    title?: string;
    notes?: string;
    status?: string;
  } = {};

  if (typeof body?.status === "string") {
    if (!STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }

  const wantsContentEdit =
    typeof body?.title === "string" || typeof body?.notes === "string";

  if (kind === "past" && wantsContentEdit) {
    return NextResponse.json(
      {
        error:
          "Past weeks are read-only except for marking complete or obsolete",
      },
      { status: 400 }
    );
  }

  if (kind === "past") {
    // Only status changes allowed; and only to complete or obsolete (or reverse to active)
    if (!updates.status) {
      return NextResponse.json(
        { error: "No allowed changes provided" },
        { status: 400 }
      );
    }
  } else {
    if (typeof body?.title === "string") {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "Title is required" }, { status: 400 });
      }
      updates.title = title;
    }
    if (typeof body?.notes === "string") {
      updates.notes = body.notes.trim();
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const task = await prisma.task.update({
    where: { id },
    data: updates,
    include: { member: true },
  });

  await syncCurrentWeekToDoc();

  return NextResponse.json(task);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  await rolloverIncompleteTasks();
  const { id } = await params;

  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (weekKind(existing.weekStart) === "past") {
    return NextResponse.json(
      { error: "Cannot delete tasks from past weeks" },
      { status: 400 }
    );
  }

  await prisma.task.delete({ where: { id } });

  await syncCurrentWeekToDoc();

  return NextResponse.json({ ok: true });
}
