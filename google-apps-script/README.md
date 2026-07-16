# Google Doc archive + JSON backup

This connects the Task Tracker app to Google in two ways at once, using a single
Apps Script web app bound to a Google Doc:

1. **JSON backup (machine-readable).** On every change the app pushes a full
   snapshot (all members + all tasks). The script stores it in **Script
   Properties** (inside the Apps Script project — no Google Drive file access
   needed). On startup the app reads this back to **restore its database** —
   this is what lets the app run on a host without persistent storage (e.g. a
   Render free web service).
2. **Google Doc archive (human-readable).** The same snapshot rewrites the Doc
   with each week as a section, **newest week on top**. The Doc is a generated
   view — anything typed directly into it is overwritten on the next change.

The app stays the source of truth.

## How it works

```
                       --POST full snapshot-->  saves JSON in Script Properties
Task Tracker (Next.js)                          rewrites the Google Doc (week history)
                       <--GET latest backup--   returns the JSON snapshot (on startup)
```

No Google credentials live in the app. It calls one URL with a shared secret.
The Apps Script runs as you (the Doc owner).

## What access does it ask for?

**Not your Drive.** The script only needs:

- `documents.currentonly` — access limited to **this one Doc**, not your other
  documents, and not any Drive files.

The machine-readable backup lives in Script Properties (project settings
storage), not as a Drive file. There is no `task-tracker-backup.json` in Drive.

## One-time setup

1. **Create the Doc.** Make a new Google Doc that will hold the weekly archive.

2. **Open the script editor.** In that Doc: `Extensions → Apps Script`. This
   creates a script bound to the Doc.

3. **Paste the code + manifest.**
   a. Replace the default `Code.gs` contents with the code from
      [`Code.gs`](./Code.gs) in this folder.
   b. Show the manifest: `Project Settings (gear) → check "Show 'appsscript.json'
      manifest file in editor."` Open `appsscript.json` in the editor and replace
      its contents with [`appsscript.json`](./appsscript.json) from this folder
      (adjust `timeZone` if you like).
   c. Save.

4. **Set the shared secret.** In the Apps Script editor:
   `Project Settings (gear) → Script properties → Add script property`
   - Property: `SYNC_SECRET`
   - Value: a long random string (generate one, e.g. `openssl rand -hex 24`)

5. **Deploy as a web app.** `Deploy → New deployment → type: Web app`.
   - Description: `Task Tracker backup`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click Deploy, authorize when prompted (Docs access for this Doc only), then
   copy the **Web app URL** (ends in `/exec`).

   > "Who has access: Anyone" is required so the app's server can call it. The
   > endpoint is still protected: every request must include the correct
   > `secret`, and the returned data contains no credentials.

6. **Configure the app.** Set these environment variables in your host's
   dashboard (production). **Do not copy production credentials into local
   `.env` for day-to-day dev** — a local change used to overwrite the live
   backup when both pointed at the same Apps Script URL.

   Production (Render):
   ```
   GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/AKfyc.../exec"
   GOOGLE_SYNC_SECRET="the-same-long-random-string-as-SYNC_SECRET"
   BACKUP_ENV="production"
   BACKUP_PUSH_ENABLED="true"
   BACKUP_RESTORE_ENABLED="true"
   ```

   Local dev: leave `GOOGLE_*` empty, or use a separate test deployment with
   `BACKUP_ENV="development"`. Push and restore are **off by default** unless
   `BACKUP_PUSH_ENABLED=true` / `BACKUP_RESTORE_ENABLED=true`.

   Restart / redeploy the app.

That's it. Add or change a task and both the backup and the Doc update within a
few seconds.

## Verifying the backup

Open this URL in a browser (use your real `/exec` URL and secret):

```
https://script.google.com/macros/s/.../exec?secret=YOUR_SECRET&env=production
```

- First run / empty: `{"ok":true,"empty":true,"members":[],"tasks":[]}`
- After a successful backup: a JSON object with `members` and `tasks` arrays
  populated (no `empty: true`).

You can also confirm Script Properties after a backup:
`Project Settings → Script properties` should show `BACKUP_CHUNKS_production` and
`BACKUP_CHUNK_production_0` (etc.). Older installs may still have unprefixed
`BACKUP_CHUNKS` keys until the next production push.

## Updating the script later

**Editing `Code.gs` alone does not update the live URL.** After every code
change you must:

1. Save in the editor
2. `Deploy → Manage deployments → ✎ Edit → Version: New version → Deploy`

If you skip this, `doPost` can "Complete" while still running old code — which
is a common reason the GET URL stays empty.

## Notes

- **Local dev vs production:** Backups are stored per environment
  (`BACKUP_CHUNKS_production`, `BACKUP_CHUNKS_development`, …). Only
  `environment: "production"` pushes rewrite the Google Doc. Local `npm run dev`
  will not push or restore unless you explicitly set `BACKUP_PUSH_ENABLED=true`.
- **Disabling backup/sync:** clear `GOOGLE_APPS_SCRIPT_URL`. The app skips it
  silently (and, with no persistent storage, will start empty after restarts).
- **Failures never block the app.** If Google is unreachable when saving, task
  changes still save locally; the error is only logged server-side.
- **Restore safety.** If Google is unreachable at startup, the app starts empty
  **and disables backup writes** until a later restart restores successfully —
  this prevents an empty database from overwriting your good backup.
- **Sharing the Doc with the team:** share the Doc itself (View access is enough)
  the normal way in Google Drive. That's separate from this mechanism.
- **Size limit.** Script Properties can hold a few hundred KB total (chunked).
  That's plenty for a small team task tracker; if you outgrow it, we'd move the
  backup to a different store.
