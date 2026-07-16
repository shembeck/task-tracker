export type TeamMember = {
  id: string;
  name: string;
  active?: boolean;
  createdAt: string;
};

export type TaskStatus = "active" | "complete" | "obsolete";

export type Task = {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  weekStart: string;
  rolledFrom: string | null;
  memberId: string;
  createdAt: string;
  updatedAt: string;
  member: TeamMember;
};

export type WeekOption = {
  weekStart: string;
  label: string;
  kind: "past" | "current" | "future";
};
