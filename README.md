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

## Google Doc archive + JSON backup (recommended for deploy)

The app pushes a full snapshot (all members + all tasks) to a Google Apps Script
web app on every change. That script:

- saves a machine-readable JSON snapshot in Apps Script **Script Properties**
  (no Drive file access), which the app **restores from on startup**, and
- rewrites a Google Doc as a human-readable archive (each week a section, newest
  on top).

The app remains the source of truth. This is what makes it safe to run on a host
with **no persistent storage** (see below). Setup:
[`google-apps-script/README.md`](./google-apps-script/README.md).

## Deploy on Render (free tier)

This app uses **SQLite** on the local filesystem. On Render's **free** tier that
filesystem is ephemeral — it's wiped on every redeploy *and* whenever the service
spins down after inactivity. To avoid paying for a persistent disk, the app
**restores its database from the Google Drive JSON backup on startup**, so you
must set up the backup first.

### 1. Set up the Google backup

Follow [`google-apps-script/README.md`](./google-apps-script/README.md) and note
your `GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_SYNC_SECRET`. **Without this, data does
not survive restarts on the free tier.**

### 2. Push to GitHub

The repo should already be at `https://github.com/shembeck/task-tracker`.

### 3. Create the Render service

1. Go to [render.com](https://render.com) and sign in.
2. **New → Blueprint** (uses the included `render.yaml`) or **New → Web Service**.
3. Connect the `shembeck/task-tracker` GitHub repo. Instance type: **Free**.

### 4. Set environment variables

| Variable | Value |
|---|---|
| `SITE_PASSWORD` | Your team's shared password (required) |
| `AUTH_SECRET` | Long random string (Render can auto-generate this) |
| `DATABASE_URL` | `file:/tmp/prod.db` |
| `APP_TIMEZONE` | `America/Los_Angeles` (or your timezone) |
| `GOOGLE_APPS_SCRIPT_URL` | Apps Script web app URL (required for durable data) |
| `GOOGLE_SYNC_SECRET` | Must match the Apps Script `SYNC_SECRET` |

### 5. Build & start commands (pre-filled by `render.yaml`)

```
Build:  npm install && npx prisma generate && npm run build
Start:  npm run start:prod
```

`start:prod` runs `prisma migrate deploy`, then `scripts/restore.ts` (restores
the DB from the backup, or seeds a default "Stephen" on the very first run), then
starts the server.

### 6. Deploy

Click **Deploy**. When it finishes, open your `*.onrender.com` URL and sign in
with `SITE_PASSWORD`.

### Notes

- **Free tier spins down after ~15 min idle**; the first visit after that takes
  ~30–60s while it cold-starts and restores from the backup.
- If Google is unreachable at startup, the app comes up empty **and disables
  backup writes** until a later restart restores successfully — this prevents an
  empty database from clobbering your good backup.
- After changing env vars, trigger a **Manual Deploy**.
- **Prefer zero data loss / always-on?** Use Render's Starter plan (~$7/mo) with
  a persistent disk mounted at `/data` and set `DATABASE_URL=file:/data/prod.db`.
  The Google backup is then optional but still a nice off-site copy + shareable
  Doc.
