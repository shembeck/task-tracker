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

function backupKeys(environment) {
  var env = environment || "production";
  return {
    chunksKey: BACKUP_CHUNKS_KEY + "_" + env,
    chunkPrefix: BACKUP_CHUNK_PREFIX + env + "_"
  };
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    if (!authorized(payload.secret)) {
      return jsonOutput({ ok: false, error: "unauthorized" });
    }

    var environment = payload.environment || "production";
    var saved = saveBackup(payload, environment);
    // Only production pushes rewrite the shared Google Doc archive.
    if (environment === "production") {
      renderDoc(payload);
    }

    return jsonOutput({
      ok: true,
      environment: environment,
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
    var environment =
      e && e.parameter && e.parameter.env ? e.parameter.env : "production";
    var content = latestBackupContent(environment);
    if (!content) {
      return jsonOutput({
        ok: true,
        empty: true,
        environment: environment,
        members: [],
        tasks: []
      });
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

function latestBackupContent(environment) {
  var content = latestBackupContentForKeys(backupKeys(environment));
  if (content) return content;

  // Pre-environment backups used unprefixed keys; keep reading them for
  // production until a production push writes BACKUP_CHUNKS_production.
  if (environment === "production") {
    return latestBackupContentForKeys({
      chunksKey: BACKUP_CHUNKS_KEY,
      chunkPrefix: BACKUP_CHUNK_PREFIX
    });
  }
  return null;
}

function latestBackupContentForKeys(keys) {
  var props = PropertiesService.getScriptProperties();
  var countStr = props.getProperty(keys.chunksKey);
  if (!countStr) return null;

  var count = Number(countStr);
  if (!count || count < 1) return null;

  var parts = [];
  for (var i = 0; i < count; i++) {
    var piece = props.getProperty(keys.chunkPrefix + i);
    if (piece === null || piece === undefined) return null;
    parts.push(piece);
  }
  return parts.join("");
}

function saveBackup(payload, environment) {
  // Store only what's needed to rebuild the database — never the shared secret.
  var members = payload.members || [];
  var tasks = payload.tasks || [];
  var backup = {
    generatedAt: payload.generatedAt || new Date().toISOString(),
    members: members,
    tasks: tasks
  };
  var json = JSON.stringify(backup);

  var keys = backupKeys(environment);
  var props = PropertiesService.getScriptProperties();

  // Clear previous chunks for this environment slot.
  var oldCount = Number(props.getProperty(keys.chunksKey) || "0");
  for (var i = 0; i < oldCount; i++) {
    props.deleteProperty(keys.chunkPrefix + i);
  }
  props.deleteProperty(keys.chunksKey);

  // Write new chunks.
  var chunks = [];
  for (var offset = 0; offset < json.length; offset += CHUNK_SIZE) {
    chunks.push(json.substring(offset, offset + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push("{}");

  var toSet = {};
  toSet[keys.chunksKey] = String(chunks.length);
  for (var c = 0; c < chunks.length; c++) {
    toSet[keys.chunkPrefix + c] = chunks[c];
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

/**
 * DocumentApp copies character styles from the previous sibling when you
 * appendParagraph / appendListItem. Always wipe the full run, then apply
 * only the styles we want.
 *
 * opts.heading: if true, only clear italic/strike/underline/color so the
 * paragraph heading size/weight stay intact.
 */
function resetInheritedStyles_(el, opts) {
  opts = opts || {};
  var text = el.editAsText();
  var len = text.getText().length;
  if (len === 0) return text;
  var end = len - 1;

  text.setItalic(0, end, opts.italic === true);
  text.setUnderline(0, end, false);
  text.setStrikethrough(0, end, opts.strikethrough === true);
  text.setForegroundColor(0, end, opts.color || "#000000");
  try {
    text.setBackgroundColor(0, end, null);
  } catch (err) {
    /* some Docs builds reject null background */
  }
  try {
    text.setLinkUrl(0, end, null);
  } catch (err2) {
    /* ignore */
  }

  if (opts.heading) {
    return text;
  }

  text.setBold(0, end, opts.bold === true);
  if (opts.fontSize != null) {
    text.setFontSize(0, end, opts.fontSize);
  } else {
    try {
      text.setFontSize(0, end, null);
    } catch (err3) {
      text.setFontSize(0, end, 11);
    }
  }
  return text;
}

function renderDoc(payload) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  body.clear();

  var title = body.appendParagraph("Weekly Tasks");
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  resetInheritedStyles_(title, { heading: true });

  var weeks = payload.weeks || [];
  if (weeks.length === 0) {
    var empty = body.appendParagraph("No tasks logged yet.");
    empty.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    resetInheritedStyles_(empty, { italic: true, color: "#5a6b62", fontSize: 11 });
  } else {
    weeks.forEach(function (week) {
      var weekHeading = body.appendParagraph(week.label);
      weekHeading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      resetInheritedStyles_(weekHeading, { heading: true });

      var members = week.members || [];
      if (members.length === 0) {
        var noTasks = body.appendParagraph("No tasks this week.");
        noTasks.setHeading(DocumentApp.ParagraphHeading.NORMAL);
        resetInheritedStyles_(noTasks, {
          italic: true,
          color: "#5a6b62",
          fontSize: 11,
        });
        return;
      }

      members.forEach(function (member) {
        var memberHeading = body.appendParagraph(member.name);
        memberHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        resetInheritedStyles_(memberHeading, { heading: true });

        (member.tasks || []).forEach(function (task) {
          var priority =
            task.priority === "high"
              ? "High"
              : task.priority === "low"
                ? "Low"
                : "Medium";
          var priorityColor =
            task.priority === "high"
              ? "#e2665c"
              : task.priority === "low"
                ? "#14b58d"
                : "#e3a548";
          var done =
            task.status === "complete" || task.status === "obsolete";
          var suffix =
            task.status === "complete"
              ? "  \u2713 done"
              : task.status === "obsolete"
                ? "  (obsolete)"
                : "";
          var label = "[" + priority + "] ";
          var item = body.appendListItem(label + task.title + suffix);
          item.setHeading(DocumentApp.ParagraphHeading.NORMAL);
          item.setGlyphType(DocumentApp.GlyphType.BULLET);
          var text = resetInheritedStyles_(item, {
            strikethrough: done,
            fontSize: 11,
            color: "#000000",
          });
          // Color only the [Priority] prefix after the full-run reset.
          if (label.length > 0) {
            text.setForegroundColor(0, label.length - 1, priorityColor);
          }

          if (task.carriedWeeks) {
            var carriedWeeks = Number(task.carriedWeeks);
            var carriedLabel = "Carried over · " + carriedWeeks + "w";
            var carried = body.appendParagraph(carriedLabel);
            carried.setHeading(DocumentApp.ParagraphHeading.NORMAL);
            carried.setIndentStart(36);
            carried.setIndentFirstLine(36);
            var carriedColor =
              carriedWeeks >= 3
                ? "#e2665c"
                : carriedWeeks === 2
                  ? "#e3a548"
                  : "#6c7f7a";
            resetInheritedStyles_(carried, {
              color: carriedColor,
              fontSize: 9,
            });
          }
          if (task.notes) {
            var notePrefix = "NOTE ";
            var note = body.appendParagraph(notePrefix + task.notes);
            note.setHeading(DocumentApp.ParagraphHeading.NORMAL);
            note.setIndentStart(36);
            note.setIndentFirstLine(36);
            var noteText = resetInheritedStyles_(note, {
              italic: true,
              color: "#3d4744",
              fontSize: 11,
            });
            // Label: muted gray, bold, not italic. Body stays darker gray italic.
            noteText
              .setForegroundColor(0, notePrefix.length - 1, "#6c7f7a")
              .setBold(0, notePrefix.length - 1, true)
              .setItalic(0, notePrefix.length - 1, false);
            if (noteText.getText().length > notePrefix.length) {
              noteText
                .setForegroundColor(
                  notePrefix.length,
                  noteText.getText().length - 1,
                  "#3d4744"
                )
                .setItalic(notePrefix.length, noteText.getText().length - 1, true)
                .setBold(notePrefix.length, noteText.getText().length - 1, false);
            }
          }
        });
      });
    });
  }

  var stamp = body.appendParagraph(
    "Last updated " + formatStamp(payload.generatedAt)
  );
  stamp.setHeading(DocumentApp.ParagraphHeading.NORMAL);
  resetInheritedStyles_(stamp, { color: "#8a8f8c", fontSize: 8 });

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
