import { PgBoss } from "pg-boss";
import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { installClock } from "../shared/clock";
import { createDb, requireDatabaseUrl } from "../db/client";
import { loadClock } from "../db/test-clock";
import { resendAdminInvite } from "../server/bootstrap";
import { EMAIL_QUEUE } from "../worker/email";

const config = loadConfigOrExit("cli");
const { pool, db } = createDb();
if (config.testRoutesEnabled) {
  installClock();
  await loadClock(pool);
}

async function resendAdminInviteCommand(): Promise<number> {
  const boss = new PgBoss({ connectionString: requireDatabaseUrl(), schema: "pgboss", supervise: false, schedule: false });
  boss.on("error", (error) => console.error("[cli] pg-boss error", error));
  await boss.start();
  try {
    await boss.createQueue(EMAIL_QUEUE);
    const result = await resendAdminInvite(db, pool, boss);
    if (result.status === "sent") console.log(`Sent a new invitation to ${result.email}.`);
    else if (result.status === "active") console.log(`The administrator (${result.email}) has already set a password; nothing to do.`);
    else console.error("There is no administrator yet. Start the web app first.");
    return result.status === "no-admin" ? 1 : 0;
  } finally {
    await boss.stop({ graceful: true });
  }
}

const [command] = process.argv.slice(2);
let code = 0;
if (command === "resend-admin-invite") code = await resendAdminInviteCommand();
else if (command === undefined) console.log(`${appBanner("cli")}: commands: resend-admin-invite`);
else {
  console.error(`Unknown command "${command}". Available: resend-admin-invite`);
  code = 2;
}
await pool.end();
process.exit(code);
