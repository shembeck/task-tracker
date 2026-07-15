import { prisma } from "./db";
import { currentWeekStart } from "./weeks";

/**
 * Move incomplete (active) tasks from past weeks into the current week.
 * Past weeks keep completed/obsolete tasks as historical record.
 */
export async function rolloverIncompleteTasks() {
  const current = currentWeekStart();
  const stale = await prisma.task.findMany({
    where: {
      status: "active",
      weekStart: { lt: current },
    },
  });

  if (stale.length === 0) return { moved: 0 };

  await prisma.$transaction(
    stale.map((task) =>
      prisma.task.update({
        where: { id: task.id },
        data: {
          rolledFrom: task.rolledFrom ?? task.weekStart,
          weekStart: current,
        },
      })
    )
  );

  return { moved: stale.length };
}
