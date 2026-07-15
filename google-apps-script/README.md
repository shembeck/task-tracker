# Google Doc archive + JSON backup

This connects the Task Tracker app to Google in two ways at once, using a single
Apps Script web app bound to a Google Doc:

1. **JSON backup (machine-readable).** On every change the app pushes a full
   snapshot (all members + all tasks). The script saves it to a Drive file
   (`task-tracker-backup.json`). On startup the app reads this file back to
   **restore its database** — this is what lets the app run on a host without
   persistent storage (e.g. a Render free web service).
2. **Google Doc archive (human-readable).** The same snapshot rewrites the Doc
   with each week as a section, **newest week on top**. The Doc is a generated
   view — anything typed directly into it is overwritten on the next change.

The app stays the source of truth.

## How it works

```
                       --POST full snapshot-->  saves task-tracker-backup.json (Drive)
Task Tracker (Next.js)                          rewrites the Google Doc (week history)
                       <--GET latest backup--   returns task-tracker-backup.json  (on startup)
```

No Google credentials live in the app. It calls one URL with a shared secret.
The Apps Script runs as you (the Doc owner).

## What access does it ask for?

**Not your whole Drive.** The script uses two narrow scopes (pinned in
[`appsscript.json`](./appsscript.json)):

- `drive.file` — *"See, edit, create, and delete **only the specific Google
  Drive files you use with this app**."* The script can only touch the one
  backup file it creates (`task-tracker-backup.json`). It cannot see or read any
  of your other Drive files.
- `documents.currentonly` — access limited to **this one Doc**, not your other
  documents.

If the consent screen ever shows *"See, edit, create, and delete **all** of your
Google Drive files,"* the manifest wasn't applied — go back to step 3b.

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
      (adjust `timeZone` if you like). This is what limits the Drive scope.
   c. Save.

4. **Set the shared secret.** In the Apps Script editor:
   `Project Settings (gear) → Script properties → Add script property`
   - Property: `SYNC_SECRET`
   - Value: a long random string (generate one, e.g. `openssl rand -hex 24`)

5. **Deploy as a web app.** `Deploy → New deployment → type: Web app`.
   - Description: `Task Tracker backup`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click Deploy. **Authorize when prompted** — confirm the consent screen only
   mentions *"only the specific ... files you use with this app"* for Drive (not
   all files). Approve it, then copy the **Web app URL** (ends in `/exec`).

   > "Who has access: Anyone" is required so the app's server can call it. The
   > endpoint is still protected: every request must include the correct
   > `secret`, and the returned data contains no credentials.

6. **Configure the app.** Set these environment variables (locally in `.env`, or
   in your host's dashboard):
   ```
   GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/AKfyc.../exec"
   GOOGLE_SYNC_SECRET="the-same-long-random-string-as-SYNC_SECRET"
   ```
   Restart the app.

That's it. Add or change a task and both the backup file and the Doc update
within a few seconds.

## Verifying the backup

- In Google Drive, search for `task-tracker-backup.json` — it should appear and
  update as you make changes. This file is what the app restores from.
- Open the URL `.../exec?secret=YOUR_SECRET` in a browser: you should see the
  latest snapshot JSON (this is exactly what the app fetches on startup).

## Notes

- **Re-deploying after code edits:** use `Deploy → Manage deployments → edit →
  Version: New version`, so the existing URL keeps working. (If you're upgrading
  from the old Doc-only script, you must re-deploy so `doGet` and Drive access
  take effect, and re-authorize for Drive.)
- **Disabling backup/sync:** clear `GOOGLE_APPS_SCRIPT_URL`. The app skips it
  silently (and, with no persistent storage, will start empty after restarts).
- **Failures never block the app.** If Google is unreachable when saving, task
  changes still save locally; the error is only logged server-side.
- **Restore safety.** If Google is unreachable at startup, the app starts empty
  **and disables backup writes** until a later restart restores successfully —
  this prevents an empty database from overwriting your good backup.
- **Sharing the Doc with the team:** share the Doc itself (View access is enough)
  the normal way in Google Drive. That's separate from this mechanism.
