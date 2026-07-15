/**
 * Weekly Tasks → Google Doc archive + JSON backup (Apps Script web app).
 *
 * This is a CONTAINER-BOUND script: create it from inside the target Google Doc
 * via Extensions → Apps Script.
 *
 *  - doPost: receives a FULL snapshot (all members + all tasks) from the app on
 *    every change. It (1) saves a machine-readable JSON backup file to your
 *    Drive, and (2) rewrites the Doc as a human-readable archive with each week
 *    as a section, newest week on top.
 *  - doGet:  returns the latest JSON backup so the app can restore its database
 *    after a restart (needed on hosts without persistent storage).
 *
 * Drive access is limited to the single backup file this script creates (the
 * `drive.file` scope in appsscript.json) — it can NOT see the rest of your
 * Drive. The file's id is remembered in a script property, so the script never
 * searches or lists your Drive.
 *
 * Setup: see google-apps-script/README.md in the repo.
 */

var BACKUP_FILENAME = "task-tracker-backup.json";
var BACKUP_FILE_ID_KEY = "BACKUP_FILE_ID";

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!authorized(payload.secret)) {
      return jsonOutput({ ok: false, error: "unauthorized" });
    }
    saveBackup(payload);
    renderDoc(payload);
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    var secret = e && e.parameter ? e.parameter.secret : "";
    if (!authorized(secret)) {
      return jsonOutput({ ok: false, error: "unauthorized" });
    }
    var content = latestBackupContent();
    if (!content) {
      return jsonOutput({ ok: true, empty: true, members: [], tasks: [] });
    }
    return ContentService.createTextOutput(content).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function authorized(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty(
    "SYNC_SECRET"
  );
  return expected && secret === expected;
}

/* ---------- JSON backup (machine-readable, used for restore) ---------- */

function latestBackupContent() {
  var id = PropertiesService.getScriptProperties().getProperty(
    BACKUP_FILE_ID_KEY
  );
  if (!id) return null;
  try {
    return DriveApp.getFileById(id).getBlob().getDataAsString();
  } catch (err) {
    // File was deleted/inaccessible — treat as no backup.
    return null;
  }
}

function saveBackup(payload) {
  // Store only what's needed to rebuild the database — never the shared secret.
  var backup = {
    generatedAt: payload.generatedAt || new Date().toISOString(),
    members: payload.members || [],
    tasks: payload.tasks || []
  };
  var json = JSON.stringify(backup);

  var props = PropertiesService.getScriptProperties();

  // Drive has no "overwrite contents" for a File, so trash the previous backup
  // (tracked by id — no Drive-wide search needed) and create a fresh one.
  var oldId = props.getProperty(BACKUP_FILE_ID_KEY);
  if (oldId) {
    try {
      DriveApp.getFileById(oldId).setTrashed(true);
    } catch (err) {
      // Already gone — ignore.
    }
  }

  var file = DriveApp.createFile(BACKUP_FILENAME, json, "application/json");
  props.setProperty(BACKUP_FILE_ID_KEY, file.getId());
}

/* ---------- Human-readable Doc archive (newest week on top) ---------- */

function renderDoc(payload) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  body.clear();

  body
    .appendParagraph("Weekly Tasks")
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  var weeks = payload.weeks || [];
  if (weeks.length === 0) {
    body.appendParagraph("No tasks logged yet.").setItalic(true);
  } else {
    weeks.forEach(function (week) {
      body
        .appendParagraph(week.label)
        .setHeading(DocumentApp.ParagraphHeading.HEADING1);

      var members = week.members || [];
      if (members.length === 0) {
        body.appendParagraph("No tasks this week.").setItalic(true);
        return;
      }

      members.forEach(function (member) {
        body
          .appendParagraph(member.name)
          .setHeading(DocumentApp.ParagraphHeading.HEADING2);

        (member.tasks || []).forEach(function (task) {
          var suffix =
            task.status === "complete"
              ? "  \u2713 done"
              : task.status === "obsolete"
                ? "  (obsolete)"
                : "";
          var item = body.appendListItem(task.title + suffix);
          item.setGlyphType(DocumentApp.GlyphType.BULLET);
          if (task.status === "complete" || task.status === "obsolete") {
            item.editAsText().setStrikethrough(true);
          }
          if (task.notes) {
            var note = body.appendParagraph(task.notes);
            note.setIndentStart(36);
            note.setIndentFirstLine(36);
            note.editAsText().setForegroundColor("#5a6b62").setItalic(true);
          }
        });
      });
    });
  }

  var stamp = body.appendParagraph(
    "Last updated " + formatStamp(payload.generatedAt)
  );
  stamp.editAsText().setForegroundColor("#8a8f8c").setFontSize(8);

  doc.saveAndClose();
}

function formatStamp(iso) {
  try {
    return Utilities.formatDate(
      new Date(iso),
      Session.getScriptTimeZone(),
      "MMM d, yyyy h:mm a"
    );
  } catch (err) {
    return iso || "";
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
