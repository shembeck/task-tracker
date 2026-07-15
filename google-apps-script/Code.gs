/**
 * Weekly Tasks → Google Doc sync (Apps Script web app).
 *
 * This is a CONTAINER-BOUND script: create it from inside the target Google Doc
 * via Extensions → Apps Script. It rebuilds the document body on each POST from
 * the Task Tracker app with the current week's tasks.
 *
 * Setup: see google-apps-script/README.md in the repo.
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    var expected = PropertiesService.getScriptProperties().getProperty("SYNC_SECRET");
    if (!expected || payload.secret !== expected) {
      return jsonOutput({ ok: false, error: "unauthorized" });
    }

    renderDoc(payload);
    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

function renderDoc(payload) {
  var doc = DocumentApp.getActiveDocument();
  var body = doc.getBody();
  body.clear();

  body.appendParagraph("Weekly Tasks").setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(payload.weekLabel).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  var members = payload.members || [];
  if (members.length === 0) {
    body.appendParagraph("No tasks logged for this week yet.").setItalic(true);
  } else {
    members.forEach(function (member) {
      body.appendParagraph(member.name).setHeading(DocumentApp.ParagraphHeading.HEADING2);
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
  }

  var stamp = body.appendParagraph("Last updated " + formatStamp(payload.generatedAt));
  stamp.editAsText().setForegroundColor("#8a8f8c").setFontSize(8);

  doc.saveAndClose();
}

function formatStamp(iso) {
  try {
    return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), "MMM d, yyyy h:mm a");
  } catch (err) {
    return iso;
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
