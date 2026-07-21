import { weeksBetween } from "./weeks";
import type { TaskPriority } from "./types";

export type SortBy = "priority" | "carried" | "status" | "newest";

export const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "newest", label: "Date added" },
  { value: "priority", label: "Priority" },
  { value: "carried", label: "Weeks carried" },
  { value: "status", label: "Status" },
];

export const DEFAULT_SORT_BY: SortBy = "newest";

const PRIORITY_RANK: Record<TaskPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATUS_RANK: Record<string, number> = {
  active: 0,
  complete: 1,
  obsolete: 2,
};

const SORT_BY_VALUES = new Set<string>([
  "priority",
  "carried",
  "status",
  "newest",
]);

export function isSortBy(value: unknown): value is SortBy {
  return typeof value === "string" && SORT_BY_VALUES.has(value);
}

export function normalizeSortBy(value: unknown): SortBy {
  return isSortBy(value) ? value : DEFAULT_SORT_BY;
}

function normalizePriority(priority: string | undefined): TaskPriority {
  return priority === "high" || priority === "low" ? priority : "medium";
}

function createdAtKey(createdAt: string | Date): string {
  return typeof createdAt === "string" ? createdAt : createdAt.toISOString();
}

export type SortableTask = {
  priority?: string;
  status: string;
  createdAt: string | Date;
  weekStart: string;
  rolledFrom: string | null;
};

export function taskCarriedWeeks(task: SortableTask): number {
  if (!task.rolledFrom) return 0;
  return Math.max(1, weeksBetween(task.rolledFrom, task.weekStart));
}

export function compareTasks(
  a: SortableTask,
  b: SortableTask,
  sortBy: SortBy,
  sortReversed: boolean
): number {
  let cmp = 0;
  switch (sortBy) {
    case "priority":
      cmp =
        PRIORITY_RANK[normalizePriority(a.priority)] -
        PRIORITY_RANK[normalizePriority(b.priority)];
      break;
    case "carried":
      cmp = taskCarriedWeeks(b) - taskCarriedWeeks(a);
      break;
    case "status":
      cmp = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
      break;
    case "newest":
      cmp = createdAtKey(b.createdAt).localeCompare(createdAtKey(a.createdAt));
      break;
  }
  if (cmp === 0) {
    cmp = createdAtKey(b.createdAt).localeCompare(createdAtKey(a.createdAt));
  }
  return sortReversed ? -cmp : cmp;
}
