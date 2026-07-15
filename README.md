# Weekly Tasks

Password-protected weekly task board for the team. Incomplete tasks roll into the current week automatically. Past weeks are browsable and mostly read-only (you can still mark tasks complete or obsolete).

## Setup

```bash
cd "task-tracker"
npm install
cp .env.example .env   # if needed
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Default password is `changeme` (set `SITE_PASSWORD` in `.env`).

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite path (`file:./dev.db`) |
| `SITE_PASSWORD` | Shared team password |
| `AUTH_SECRET` | Cookie signing secret |
| `APP_TIMEZONE` | Calendar timezone (default `America/Los_Angeles`); weeks are **Monday–Sunday** |
| `GOOGLE_APPS_SCRIPT_URL` | Optional. Apps Script web app URL for Google Doc sync |
| `GOOGLE_SYNC_SECRET` | Optional. Shared secret matching the Apps Script `SYNC_SECRET` |

## Features

- Add team members; pick one from a dropdown when logging work
- Add one or more tasks for the current or an upcoming week (with optional notes)
- Default view is the current week board (everyone’s tasks)
- Browse past weeks; mark tasks complete or obsolete there
- Edit / delete tasks on current and future weeks
- Active incomplete tasks from past weeks roll forward into the current week
- Optional: mirror the current week into a Google Doc on every change

## Google Doc sync (optional)

The app can push the current week's tasks into a Google Doc so it doubles as the
shareable weekly document. The app remains the source of truth; the Doc is a
generated view. Setup instructions: [`google-apps-script/README.md`](./google-apps-script/README.md).
