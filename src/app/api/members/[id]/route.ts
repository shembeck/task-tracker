import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushBackup } from "@/lib/backup";

type Params = { params: Promise<{ id: string }> };

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
