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
  const [drafts, setDrafts] = useState<DraftTask[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [canAddAnotherTask, setCanAddAnotherTask] = useState(false);
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
    setMemberId((prev) => {
      if (prev && data.some((m) => m.id === prev)) return prev;
      const stephen = data.find(
        (m) => m.name.toLowerCase() === "stephen"
      );
      return stephen?.id || data[0]?.id || "";
    });
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
      }
      setDrafts([emptyDraft()]);
      setCanAddAnotherTask(true);
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
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-6">
        <div>
          <p className="font-[family-name:var(--font-serif)] text-4xl tracking-tight">
            Weekly Tasks
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Shared status by week · incomplete work rolls forward automatically
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
        >
          Sign out
        </button>
      </header>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="mt-8 flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium">
          Week
          <select
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="ml-2 rounded-lg border border-[var(--line)] bg-white px-3 py-2"
          >
            {weeks.map((w) => (
              <option key={w.weekStart} value={w.weekStart}>
                {w.label}
                {w.kind === "current" ? " (current)" : ""}
                {w.kind === "future" ? " (upcoming)" : ""}
              </option>
            ))}
          </select>
        </label>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            weekKind === "past"
              ? "bg-[var(--paper-2)] text-[var(--ink-muted)]"
              : weekKind === "future"
                ? "bg-[#e8f0ff] text-[#2a4a7a]"
                : "bg-[var(--accent-soft)] text-[var(--accent)]"
          }`}
        >
          {weekKind === "past"
            ? "Past · read-only except complete / obsolete"
            : weekKind === "future"
              ? "Upcoming week"
              : "Current week"}
        </span>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-5 shadow-[var(--shadow)]">
            <h2 className="font-[family-name:var(--font-serif)] text-xl">
              Team members
            </h2>
            <form
              onSubmit={addMember}
              className="mt-4 flex gap-2"
              noValidate
            >
              <input
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Add a name"
                autoComplete="off"
                disabled={addingMember}
                className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={addingMember || !newMemberName.trim()}
                className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {addingMember ? "Adding…" : "Add"}
              </button>
            </form>
            {members.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                No members yet — add someone to start logging tasks.
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-full bg-[var(--paper-2)] px-3 py-1 text-sm"
                  >
                    {m.name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-5 shadow-[var(--shadow)]">
            <h2 className="font-[family-name:var(--font-serif)] text-xl">
              Add tasks
            </h2>
            {!canAddTasks ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                You can’t add tasks to past weeks. Switch to the current or an
                upcoming week.
              </p>
            ) : (
              <form onSubmit={submitTasks} className="mt-4 space-y-4">
                <label className="block text-sm font-medium">
                  Who is this for?
                  <select
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    required
                    className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2"
                  >
                    <option value="" disabled>
                      Select team member
                    </option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>

                <p className="text-sm text-[var(--ink-muted)]">
                  Week: <span className="text-[var(--ink)]">{weekLabel}</span>
                </p>

                {drafts.map((draft, index) => (
                  <div
                    key={index}
                    className="space-y-2 border-t border-[var(--line)] pt-4 first:border-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-sm font-medium">
                        Task {drafts.length > 1 ? index + 1 : ""}
                      </label>
                      {drafts.length > 1 ? (
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
                      ) : null}
                    </div>
                    <input
                      ref={index === 0 ? taskTitleRef : undefined}
                      value={draft.title}
                      onChange={(e) => {
                        setCanAddAnotherTask(false);
                        setDrafts((prev) =>
                          prev.map((d, i) =>
                            i === index ? { ...d, title: e.target.value } : d
                          )
                        );
                      }}
                      placeholder="What are you working on?"
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2"
                    />
                    <textarea
                      value={draft.notes}
                      onChange={(e) => {
                        setCanAddAnotherTask(false);
                        setDrafts((prev) =>
                          prev.map((d, i) =>
                            i === index ? { ...d, notes: e.target.value } : d
                          )
                        );
                      }}
                      placeholder="Notes (optional)"
                      rows={2}
                      className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2"
                    />
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!canAddAnotherTask || saving}
                    title={
                      canAddAnotherTask
                        ? "Add another task"
                        : "Save the current task before adding another"
                    }
                    onClick={() => {
                      setCanAddAnotherTask(false);
                      setDrafts([emptyDraft()]);
                      requestAnimationFrame(() =>
                        taskTitleRef.current?.focus()
                      );
                    }}
                    className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm hover:bg-[var(--paper)] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    + Another task
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !memberId || !hasTaskTitle}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save task"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-white/70 p-5 shadow-[var(--shadow)]">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-[family-name:var(--font-serif)] text-xl">
              {weekKind === "current" ? "This week" : "Week board"}
            </h2>
            <p className="text-sm text-[var(--ink-muted)]">{weekLabel}</p>
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
                  <section key={member.id}>
                    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2">
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
                                className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2"
                              />
                              <textarea
                                value={editNotes}
                                onChange={(e) => setEditNotes(e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2"
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
                              className={`relative overflow-hidden rounded-lg border border-transparent px-1 py-1 ${
                                task.status === "complete"
                                  ? ""
                                  : "hover:border-[var(--line)] hover:bg-[var(--paper)]/60"
                              }`}
                            >
                              <div className="flex gap-3">
                                <div className="min-w-0 flex-1">
                                  <p
                                    className={`pt-1 text-sm leading-snug ${
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
                                    <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)] whitespace-pre-wrap">
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
                                        className={`relative z-10 ml-auto font-bold text-[var(--accent)] transition ${
                                          task.status === "complete"
                                            ? "opacity-0 group-hover:opacity-100 focus:opacity-100"
                                            : ""
                                        }`}
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
                                  className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--accent-soft)]/65"
                                >
                                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xl font-semibold text-[#dcebe3] shadow-sm">
                                    ✓
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
  );
}
