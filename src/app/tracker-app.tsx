"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task, TeamMember, WeekOption } from "@/lib/types";

type DraftTask = { title: string; notes: string };

const emptyDraft = (): DraftTask => ({ title: "", notes: "" });

export default function TrackerApp() {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [weekStart, setWeekStart] = useState<string>("");
  const [weekKind, setWeekKind] = useState<"past" | "current" | "future">(
    "current"
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [memberId, setMemberId] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [showNewMember, setShowNewMember] = useState(false);
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [drafts, setDrafts] = useState<DraftTask[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showSelectHint, setShowSelectHint] = useState(false);
  const taskTitleRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const canAddTasks = weekKind !== "past";
  const canEditContent = weekKind !== "past";
  const hasTaskTitle = drafts.some((draft) => draft.title.trim().length > 0);

  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/members");
    if (!res.ok) throw new Error("Failed to load members");
    const data: TeamMember[] = await res.json();
    setMembers(data);
    setMemberId((prev) =>
      prev && data.some((m) => m.id === prev) ? prev : ""
    );
  }, []);

  const loadWeeks = useCallback(async () => {
    const res = await fetch("/api/weeks");
    if (!res.ok) throw new Error("Failed to load weeks");
    const data = await res.json();
    setWeeks(data.weeks);
    setWeekStart((prev) => prev || data.current);
  }, []);

  const loadTasks = useCallback(async (week: string) => {
    const res = await fetch(`/api/tasks?week=${encodeURIComponent(week)}`);
    if (!res.ok) throw new Error("Failed to load tasks");
    const data = await res.json();
    setTasks(data.tasks);
    setWeekStart(data.weekStart);
    setWeekKind(data.kind);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        await Promise.all([loadMembers(), loadWeeks()]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMembers, loadWeeks]);

  useEffect(() => {
    if (!weekStart) return;
    let cancelled = false;
    (async () => {
      try {
        setError("");
        await loadTasks(weekStart);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, loadTasks]);

  const tasksByMember = useMemo(() => {
    const map = new Map<string, { member: TeamMember; tasks: Task[] }>();
    for (const task of tasks) {
      const entry = map.get(task.memberId);
      if (entry) entry.tasks.push(task);
      else map.set(task.memberId, { member: task.member, tasks: [task] });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.member.name.localeCompare(b.member.name)
    );
  }, [tasks]);

  const weekLabel =
    weeks.find((w) => w.weekStart === weekStart)?.label || weekStart;

  async function addMember(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const name = newMemberName.trim();
    if (!name) {
      setError("Enter a team member name");
      return;
    }
    setAddingMember(true);
    setError("");
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Could not add member");
        return;
      }
      setNewMemberName("");
      setShowNewMember(false);
      setMembers((prev) =>
        [...prev, data as TeamMember].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
      setMemberId(data.id);
    } catch {
      setError("Could not add member — check your connection");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeMember(member: TeamMember) {
    setError("");
    if (
      !window.confirm(
        `Remove ${member.name} from the team?\n\nTheir past and current tasks will stay on the board; they just won’t appear in the selector anymore.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/members/${member.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.error || "Could not remove team member");
        return;
      }

      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      if (memberId === member.id) setMemberId("");
      // Keep the week board as-is; their tasks remain visible via member relation.
      if (data?.backup && data.backup.ok === false) {
        setError(
          `Member removed, but backup failed (${data.backup.error || data.backup.skipped || "unknown"}).`
        );
      }
    } catch {
      setError("Could not remove team member — check your connection");
    }
  }

  async function submitTasks(e: FormEvent) {
    e.preventDefault();
    if (!memberId || !canAddTasks) return;
    const payload = drafts
      .map((d) => ({ title: d.title.trim(), notes: d.notes.trim() }))
      .filter((d) => d.title);
    if (payload.length === 0) {
      setError("Enter at least one task title");
      return;
    }
    setSaving(true);
    setError("");
    try {
      for (const item of payload) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId,
            title: item.title,
            notes: item.notes,
            weekStart,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to save task");
        if (data?.backup && data.backup.ok === false) {
          setError(
            `Task saved, but backup failed (${data.backup.error || data.backup.skipped || "unknown"}). Check Render logs.`
          );
        }
      }
      setDrafts([emptyDraft()]);
      setShowNote(false);
      await loadTasks(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function patchTask(
    id: string,
    body: { status?: string; title?: string; notes?: string }
  ) {
    setError("");
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Update failed");
      return;
    }
    setEditingId(null);
    await loadTasks(weekStart);
  }

  async function deleteTask(id: string) {
    if (!confirm("Delete this task?")) return;
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Delete failed");
      return;
    }
    await loadTasks(weekStart);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditNotes(task.notes);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-[var(--ink-muted)]">
        Loading…
      </main>
    );
  }

  return (
    <>
      <nav className="sticky top-0 z-20 bg-[var(--accent-deep)]">
        <div
          className="flex items-center justify-between"
          style={{ height: "80px", paddingLeft: "60px", paddingRight: "60px" }}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-[18px] w-[18px]"
                aria-hidden="true"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span className="relative font-sans text-3xl font-semibold tracking-tight text-white">
              TaskTracker
              <span className="absolute -top-2 -right-10 text-[0.32em] font-semibold uppercase tracking-wider text-white/80">
                Beta
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-xs font-medium text-white/90 transition hover:text-white"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">

      {error ? (
        <p
          className="mt-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="mt-8 space-y-6">
        <div className="w-full rounded-2xl bg-[var(--surface)]/30 p-5 shadow-[var(--shadow)]">
          <h2 className="font-sans text-xl">Add a task</h2>
          <p
            className={`mt-3 text-sm ${
              !memberId && showSelectHint
                ? "font-medium text-[var(--warn)]"
                : "text-[var(--ink-muted)]"
            }`}
          >
            Select:
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {members.map((m) => {
              const selected = m.id === memberId;
              return (
                <span
                  key={m.id}
                  className={`group relative inline-flex items-center rounded-full px-3 py-1 text-sm transition ${
                    selected
                      ? "bg-[var(--accent)] font-medium text-white"
                      : "bg-[var(--surface-strong)] text-[var(--ink)] hover:bg-[var(--line)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMemberId(m.id);
                      setShowSelectHint(false);
                    }}
                    aria-pressed={selected}
                    className="min-w-0"
                  >
                    {m.name}
                  </button>
                  <button
                    type="button"
                    title={`Remove ${m.name}`}
                    aria-label={`Remove ${m.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeMember(m);
                    }}
                    className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--gray-500)] bg-[var(--paper)] text-[var(--ink-muted)] opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      className="h-2 w-2"
                      aria-hidden="true"
                    >
                      <path d="M3 3l6 6M9 3L3 9" />
                    </svg>
                  </button>
                </span>
              );
            })}
            {showNewMember ? (
              <form
                onSubmit={addMember}
                className="inline-flex items-center gap-2"
                noValidate
              >
                <input
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  placeholder="Name"
                  autoComplete="off"
                  autoFocus
                  disabled={addingMember}
                  className="min-w-0 rounded-full border border-[var(--line)] bg-[var(--paper)] px-3 py-1 text-sm disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={addingMember || !newMemberName.trim()}
                  className="rounded-full bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {addingMember ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewMember(false);
                    setNewMemberName("");
                  }}
                  className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowNewMember(true)}
                className="text-sm font-medium text-[var(--accent)] hover:underline"
              >
                New team member
              </button>
            )}
          </div>

          <div className="mt-6">
          {!canAddTasks ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                You can’t add tasks to past weeks. Switch to the current or an
                upcoming week.
              </p>
            ) : (
              <form onSubmit={submitTasks} className="mt-4 space-y-4">
                {drafts.map((draft, index) => (
                  <div
                    key={index}
                    className="space-y-2 border-t border-[var(--line)] pt-4 first:border-0 first:pt-0"
                  >
                    {drafts.length > 1 ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((prev) =>
                              prev.filter((_, i) => i !== index)
                            )
                          }
                          className="text-xs text-[var(--ink-muted)] hover:text-[var(--danger)]"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                    <div className="relative flex items-center gap-2">
                      <input
                        ref={index === 0 ? taskTitleRef : undefined}
                        value={draft.title}
                        disabled={!memberId}
                        onChange={(e) => {
                          setDrafts((prev) =>
                            prev.map((d, i) =>
                              i === index ? { ...d, title: e.target.value } : d
                            )
                          );
                        }}
                        placeholder="Enter a task for this week"
                        className="h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={saving || !memberId || !hasTaskTitle}
                        aria-label="Add a task"
                        title="Add a task"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3.5}
                          strokeLinecap="round"
                          className="h-5 w-5"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                      {!memberId ? (
                        <button
                          type="button"
                          aria-label="Select who you are first"
                          onClick={() => setShowSelectHint(true)}
                          className="absolute inset-0 z-10 cursor-not-allowed rounded-lg"
                        />
                      ) : null}
                    </div>
                    {!memberId && showSelectHint ? (
                      <p className="text-sm text-[var(--warn)]">
                        Select who you are above before adding a task.
                      </p>
                    ) : null}
                    {showNote ? (
                      <textarea
                        value={draft.notes}
                        disabled={!memberId}
                        autoFocus
                        onChange={(e) => {
                          setDrafts((prev) =>
                            prev.map((d, i) =>
                              i === index ? { ...d, notes: e.target.value } : d
                            )
                          );
                        }}
                        placeholder="Notes (optional)"
                        rows={2}
                        className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={!memberId}
                        onClick={() => setShowNote(true)}
                        className="text-sm font-medium text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        + add a note
                      </button>
                    )}
                  </div>
                ))}
              </form>
            )}
          </div>
        </div>

        <div className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface)]/70 p-5 shadow-[var(--shadow)]">
          <p className="font-sans text-3xl leading-none tracking-tight">
            {weekKind === "current" ? "This Week's Tasks" : "That Week's Tasks"}
          </p>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              {showWeekPicker ? (
                <select
                  value={weekStart}
                  autoFocus
                  onChange={(e) => {
                    setWeekStart(e.target.value);
                    setShowWeekPicker(false);
                  }}
                  onBlur={() => setShowWeekPicker(false)}
                  className="mt-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-sm text-[var(--ink)]"
                >
                  {weeks.map((w) => (
                    <option key={w.weekStart} value={w.weekStart}>
                      {w.label}
                      {w.kind === "current" ? " (current)" : ""}
                      {w.kind === "future" ? " (upcoming)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-0.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowWeekPicker(true)}
                    title="Click to jump to a different week"
                    className="text-sm text-[var(--ink-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--ink)]"
                  >
                    {weekLabel}
                  </button>
                  <span
                    style={{
                      fontSize: "11px",
                      lineHeight: 1,
                      paddingTop: "4px",
                      paddingRight: "4px",
                      paddingBottom: "4px",
                      paddingLeft: "4px",
                      borderRadius: "100px",
                    }}
                    className="inline-flex items-center justify-center bg-[var(--surface-strong)] font-bold uppercase tracking-wide text-[var(--ink-muted)]"
                  >
                    {weekKind === "past"
                      ? "Past"
                      : weekKind === "future"
                      ? "Future"
                      : "Current"}
                  </span>
                </div>
              )}
              {weekKind === "past" ? (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Read-only except marking complete / obsolete
                </p>
              ) : null}
            </div>
          </div>

          {tasksByMember.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--ink-muted)]">
              No tasks logged for this week yet.
            </p>
          ) : (
            <div className="mt-6 space-y-8">
              {tasksByMember.map(({ member, tasks: memberTasks }) => {
                const done = memberTasks.filter(
                  (t) => t.status === "complete"
                ).length;
                const active = memberTasks.filter(
                  (t) => t.status === "active"
                ).length;
                return (
                  <section
                    key={member.id}
                    className="rounded-xl border border-dotted border-[var(--line)] bg-[var(--paper-2)]/20 p-4"
                  >
                    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)]/40 pb-2">
                      <h3 className="text-base font-semibold">{member.name}</h3>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {done}/{memberTasks.length} complete
                        {active > 0 ? ` · ${active} active` : ""}
                      </p>
                    </div>
                    <ul className="mt-3 space-y-3">
                      {memberTasks.map((task) => (
                        <li key={task.id} className="group">
                          {editingId === task.id ? (
                            <div className="space-y-2 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)]/40 p-3">
                              <input
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2"
                              />
                              <textarea
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    patchTask(task.id, {
                                      title: editTitle,
                                      notes: editNotes,
                                    })
                                  }
                                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--ink-muted)]"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className={`relative overflow-hidden rounded-lg border px-2 py-1 ${
                                task.status === "complete"
                                  ? "border-transparent bg-[var(--paper)]/50"
                                  : "border-[var(--line)] bg-[var(--paper)]/50 hover:bg-[var(--surface-strong)]/60"
                              }`}
                            >
                              <div className="flex gap-3">
                                <div className="min-w-0 flex-1">
                                  <p
                                    style={{ fontSize: "11px", lineHeight: 1 }}
                                    className="pt-1 font-bold uppercase tracking-wider text-[var(--ink-muted)]"
                                  >
                                    Task
                                  </p>
                                  <p
                                    style={{ paddingLeft: "4px" }}
                                    className={`mt-1 text-sm leading-snug ${
                                      task.status === "complete"
                                        ? "text-[var(--ink-muted)] line-through"
                                        : task.status === "obsolete"
                                          ? "text-[var(--obsolete)] line-through decoration-[var(--obsolete)]"
                                          : ""
                                    }`}
                                  >
                                    {task.title}
                                  </p>
                                  {task.notes ? (
                                    <p
                                      style={{ paddingLeft: "4px" }}
                                      className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)] whitespace-pre-wrap"
                                    >
                                      {task.notes}
                                    </p>
                                  ) : null}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
                                    {task.rolledFrom ? (
                                      <span>Carried forward</span>
                                    ) : null}
                                    <span className="opacity-0 transition group-hover:opacity-100">
                                      {canEditContent ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => startEdit(task)}
                                            className="hover:text-[var(--ink)]"
                                          >
                                            Edit
                                          </button>
                                          {" · "}
                                          <button
                                            type="button"
                                            onClick={() => deleteTask(task.id)}
                                            className="hover:text-[var(--danger)]"
                                          >
                                            Delete
                                          </button>
                                          {" · "}
                                        </>
                                      ) : null}
                                      {task.status !== "obsolete" ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            patchTask(task.id, {
                                              status: "obsolete",
                                            })
                                          }
                                          className="hover:text-[var(--warn)]"
                                        >
                                          Mark obsolete
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            patchTask(task.id, {
                                              status: "active",
                                            })
                                          }
                                          className="hover:text-[var(--ink)]"
                                        >
                                          Restore
                                        </button>
                                      )}
                                    </span>
                                    {task.status !== "obsolete" ? (
                                      <button
                                        type="button"
                                        aria-label={
                                          task.status === "complete"
                                            ? `Mark ${task.title} incomplete`
                                            : `Mark ${task.title} complete`
                                        }
                                        onClick={() =>
                                          patchTask(task.id, {
                                            status:
                                              task.status === "complete"
                                                ? "active"
                                                : "complete",
                                          })
                                        }
                                        className={`relative z-10 ml-auto font-medium text-[var(--accent)] transition ${
                                          task.status === "complete"
                                            ? "opacity-0 group-hover:opacity-100 focus:opacity-100"
                                            : ""
                                        }`}
                                        style={{
                                          fontWeight: 500,
                                          paddingBottom: "2px",
                                          paddingRight: "2px",
                                        }}
                                      >
                                        {task.status === "complete"
                                          ? "Mark incomplete"
                                          : "Mark complete"}
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                              {task.status === "complete" ? (
                                <div
                                  aria-hidden="true"
                                  style={{ gap: "6px" }}
                                  className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[var(--accent-soft)]/65"
                                >
                                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--ink)] shadow-sm">
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="h-[18px] w-[18px]"
                                      aria-hidden="true"
                                    >
                                      <path d="M5 13l4 4L19 7" />
                                    </svg>
                                  </span>
                                  <span
                                    style={{ fontSize: "11px", lineHeight: 1 }}
                                    className="font-semibold uppercase tracking-wider text-[var(--accent)]"
                                  >
                                    Complete!
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </section>
      </main>
    </>
  );
}
