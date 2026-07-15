# Google Doc sync setup

This connects the Task Tracker app to a Google Doc. The app stays the source of
truth and **pushes the current week's tasks into the Doc on every change**. The
Doc is a generated, read-only view — anything typed directly into it is
overwritten on the next sync.

## How it works

```
Task Tracker (Next.js)  --POST JSON-->  Apps Script web app  -->  Google Doc
```

No Google credentials live in the app. The app just calls one URL with a shared
secret. The Apps Script runs as you (the Doc owner) and rewrites the Doc.

## One-time setup

1. **Create the Doc.** Make a new Google Doc that will hold the weekly tasks.

2. **Open the script editor.** In that Doc: `Extensions → Apps Script`. This
   creates a script bound to the Doc.

3. **Paste the code.** Replace the default `Code.gs` contents with the code from
   [`Code.gs`](./Code.gs) in this folder. Save.

4. **Set the shared secret.** In the Apps Script editor:
   `Project Settings (gear) → Script properties → Add script property`
   - Property: `SYNC_SECRET`
   - Value: a long random string (generate one, e.g. `openssl rand -hex 24`)

5. **Deploy as a web app.** `Deploy → New deployment → type: Web app`.
   - Description: `Task Tracker sync`
   - Execute as: **Me**
   - Who has access: **Anyone**
   
   Click Deploy, authorize when prompted, and copy the **Web app URL**
   (ends in `/exec`).

   > "Who has access: Anyone" is required so the app's server can call it. The
   > endpoint is still protected because it rejects any request whose `secret`
   > doesn't match `SYNC_SECRET`.

6. **Configure the app.** In the Task Tracker `.env`:
   ```
   GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/AKfyc.../exec"
   GOOGLE_SYNC_SECRET="the-same-long-random-string-as-SYNC_SECRET"
   ```
   Restart the app.

That's it. Add or change a task and the Doc updates within a few seconds.

## Notes

- **Re-deploying after code edits:** use `Deploy → Manage deployments → edit →
  Version: New version`, so the existing URL keeps working.
- **Disabling sync:** clear `GOOGLE_APPS_SCRIPT_URL` in `.env`. The app skips
  the sync silently.
- **Failures never block the app.** If Google is unreachable, task changes still
  save; the error is only logged server-side.
- **Sharing the Doc with the team:** share the Doc itself (View access is enough)
  the normal way in Google Drive. This is separate from the sync mechanism.
