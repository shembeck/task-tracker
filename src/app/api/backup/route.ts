import { NextResponse } from "next/server";
import { getBackupStatus, pushBackup } from "@/lib/backup";

/** Inspect local DB vs remote backup (auth required via middleware). */
export async function GET() {
  const status = await getBackupStatus();
  return NextResponse.json(status);
}

/** Force a backup of the current database to Apps Script. */
export async function POST() {
  const result = await pushBackup();
  if (!result.ok) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result);
}
