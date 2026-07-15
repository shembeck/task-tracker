import { prisma } from "../src/lib/db";
import { markBackupHealthy, restoreIfEmpty } from "../src/lib/backup";

/**
 * Runs once at server startup (see `start:prod`), after `prisma migrate deploy`.
 *
 * On hosts without persistent storage the SQLite database is empty on every cold
 * start, so we pull the latest snapshot from the Google Apps Script backup and
 * load it in. If the backend is unreachable we deliberately leave the health
 * marker unset so the running app won't overwrite the good backup.
 */
async function main() {
  try {
    const result = await restoreIfEmpty();

    switch (result.status) {
      case "not-configured":
        console.log(
          "Backup not configured (GOOGLE_APPS_SCRIPT_URL / GOOGLE_SYNC_SECRET unset) — starting without restore."
        );
        break;
      case "skipped-existing":
        console.log(
          `Database already has data (${result.members} members, ${result.tasks} tasks) — skipping restore.`
        );
        markBackupHealthy();
        break;
      case "empty-backup":
        console.log("No backup found yet (first run) — starting empty.");
        markBackupHealthy();
        break;
      case "restored":
        console.log(
          `Restored ${result.members} members and ${result.tasks} tasks from backup.`
        );
        markBackupHealthy();
        break;
    }
  } catch (err) {
    console.error(
      "Restore failed — backend unreachable. Backups are DISABLED until the next " +
        "successful restore to avoid overwriting the good backup."
    );
    console.error(err);
  }

  // Guarantee the app is usable even with no backup / no restore.
  const memberCount = await prisma.teamMember.count();
  if (memberCount === 0) {
    await prisma.teamMember.upsert({
      where: { name: "Stephen" },
      update: {},
      create: { name: "Stephen" },
    });
    console.log('Seeded default team member "Stephen".');
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
