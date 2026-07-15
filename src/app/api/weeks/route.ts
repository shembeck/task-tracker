import { NextResponse } from "next/server";
import { addWeeks, currentWeekStart, formatWeekLabel, weekKind } from "@/lib/weeks";

/** Nearby weeks for the week picker (past for browsing, current, near future). */
export async function GET() {
  const current = currentWeekStart();
  const weeks = [];

  for (let i = -12; i <= 8; i++) {
    const weekStart = addWeeks(current, i);
    weeks.push({
      weekStart,
      label: formatWeekLabel(weekStart),
      kind: weekKind(weekStart),
    });
  }

  return NextResponse.json({ current, weeks });
}
