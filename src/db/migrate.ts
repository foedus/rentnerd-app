import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { appBanner } from "../shared/app-info";
import { createDb } from "./client";

const migrationsFolder = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), "src/db/migrations");
const { db, pool } = createDb();
try {
  await migrate(db, { migrationsFolder });
  console.log(`${appBanner("migrate")}: migrations applied`);
} catch (error) {
  console.error(`${appBanner("migrate")}: failed`, error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
