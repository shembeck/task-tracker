/**
 * Weekly Tasks → Google Doc archive + JSON backup (Apps Script web app).
 *
 * This is a CONTAINER-BOUND script: create it from inside the target Google Doc
 * via Extensions → Apps Script.
 *
 *  - doPost: receives a FULL snapshot (all members + all tasks) from the app on
 *    every change. It (1) saves a machine-readable JSON backup in Script
 *    Properties (no Drive access needed), and (2) rewrites the Doc as a
 *    human-readable archive with each week as a section, newest week on top.
 *  - doGet:  returns the latest JSON backup so the app can restore its database
 *    after a restart (needed on hosts without persistent storage).
 *
 * Setup: see google-apps-script/README.md in the repo.
 *
 * IMPORTANT: After editing this file you MUST publish a new deployment version
 * (Deploy → Manage deployments → Edit → Version: New version) or the live URL
 * keeps running the old code.
 */

var BACKUP_CHUNKS_KEY = "BACKUP_CHUNKS";
var BACKUP_CHUNK_PREFIX = "BACKUP_CHUNK_";
// Script Properties allow ~9KB per value; stay under that with headroom.
var CHUNK_SIZE = 8000;

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!authorized(payload.secret)) {
      return jsonOutput({ ok: false, error: "unauthorized" });
    }

    var saved = saveBackup(payload);
    renderDoc(payload);

    return jsonOutput({
      ok: true,
      members: saved.members,
      tasks: saved.tasks,
      bytes: saved.bytes,
      chunks: saved.chunks
    });
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

/* ---------- JSON backup in Script Properties (no Drive) ---------- */

function latestBackupContent() {
  var props = PropertiesService.getScriptProperties();
  var countStr = props.getProperty(BACKUP_CHUNKS_KEY);
  if (!countStr) return null;

  var count = Number(countStr);
  if (!count || count < 1) return null;

  var parts = [];
  for (var i = 0; i < count; i++) {
    var piece = props.getProperty(BACKUP_CHUNK_PREFIX + i);
    if (piece === null || piece === undefined) return null;
    parts.push(piece);
  }
  return parts.join("");
}

function saveBackup(payload) {
  // Store only what's needed to rebuild the database — never the shared secret.
  var members = payload.members || [];
  var tasks = payload.tasks || [];
  var backup = {
    generatedAt: payload.generatedAt || new Date().toISOString(),
    members: members,
    tasks: tasks
  };
  var json = JSON.stringify(backup);

  var props = PropertiesService.getScriptProperties();

  // Clear previous chunks.
  var oldCount = Number(props.getProperty(BACKUP_CHUNKS_KEY) || "0");
  for (var i = 0; i < oldCount; i++) {
    props.deleteProperty(BACKUP_CHUNK_PREFIX + i);
  }
  props.deleteProperty(BACKUP_CHUNKS_KEY);

  // Write new chunks.
  var chunks = [];
  for (var offset = 0; offset < json.length; offset += CHUNK_SIZE) {
    chunks.push(json.substring(offset, offset + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push("{}");

  var toSet = {};
  toSet[BACKUP_CHUNKS_KEY] = String(chunks.length);
  for (var c = 0; c < chunks.length; c++) {
    toSet[BACKUP_CHUNK_PREFIX + c] = chunks[c];
  }
  props.setProperties(toSet, false);

  return {
    members: members.length,
    tasks: tasks.length,
    bytes: json.length,
    chunks: chunks.length
  };
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
