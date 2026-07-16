import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushBackup } from "@/lib/backup";

export async function GET() {
  const members = await prisma.teamMember.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(members);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const existing = await prisma.teamMember.findFirst({
    where: { name: { equals: name } },
  });
  if (existing) {
    if (!existing.active) {
      const member = await prisma.teamMember.update({
        where: { id: existing.id },
        data: { active: true },
      });
      const backup = await pushBackup();
      if (!backup.ok) {
        console.error("Member reactivated but backup failed:", backup);
      }
      return NextResponse.json({ ...member, backup, reactivated: true });
    }
    return NextResponse.json(
      { error: `"${existing.name}" is already on the team` },
      { status: 409 }
    );
  }

  try {
    const member = await prisma.teamMember.create({ data: { name } });
    const backup = await pushBackup();
    if (!backup.ok) {
      console.error("Member saved but backup failed:", backup);
    }
    return NextResponse.json({ ...member, backup }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "A team member with that name already exists" },
      { status: 409 }
    );
  }
}
