import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushBackup } from "@/lib/backup";
import { isSortBy } from "@/lib/sort-tasks";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const existing = await prisma.teamMember.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const updates: { sortBy?: string; sortReversed?: boolean } = {};

  if (typeof body?.sortBy === "string") {
    if (!isSortBy(body.sortBy)) {
      return NextResponse.json({ error: "Invalid sortBy" }, { status: 400 });
    }
    updates.sortBy = body.sortBy;
  }

  if (typeof body?.sortReversed === "boolean") {
    updates.sortReversed = body.sortReversed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }

  const member = await prisma.teamMember.update({
    where: { id },
    data: updates,
  });

  const backup = await pushBackup();
  if (!backup.ok) {
    console.error("Member sort updated but backup failed:", backup);
  }

  return NextResponse.json({ ...member, backup });
}

/**
 * Soft-delete a team member: mark inactive so they can't be selected for new
 * tasks, but keep the row (and all their tasks) for history.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const member = await prisma.teamMember.findUnique({ where: { id } });
  if (!member) {
    return NextResponse.json({ error: "Team member not found" }, { status: 404 });
  }

  if (!member.active) {
    return NextResponse.json({ ok: true, alreadyInactive: true });
  }

  await prisma.teamMember.update({
    where: { id },
    data: { active: false },
  });

  const backup = await pushBackup();
  if (!backup.ok) {
    console.error("Member deactivated but backup failed:", backup);
  }

  return NextResponse.json({ ok: true, backup });
}
