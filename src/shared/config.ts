export type ProcessName = "web" | "worker" | "cli";

export class ConfigError extends Error {}

/** Database name (last path segment, without query) of a Postgres URL, or "" if unparseable. */
export function databaseName(url: string | undefined): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

export interface AppConfig {
  testRoutesEnabled: boolean;
}

/**
 * Validates the environment (D-25). With ENABLE_TEST_ROUTES=true every other safety condition
 * must hold, otherwise this throws a ConfigError and the process must not start.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.ENABLE_TEST_ROUTES !== "true") return { testRoutesEnabled: false };
  const problems: string[] = [];
  if (env.NODE_ENV !== "test") problems.push(`NODE_ENV must be "test" (it is "${env.NODE_ENV ?? ""}")`);
  if (env.FLY_APP_NAME) problems.push(`FLY_APP_NAME must be unset (it is "${env.FLY_APP_NAME}")`);
  const name = databaseName(env.DATABASE_URL);
  if (!name.endsWith("_test")) problems.push(`the database name must end in "_test" (it is "${name}")`);
  if (problems.length > 0) {
    throw new ConfigError(
      `Refusing to start: ENABLE_TEST_ROUTES=true (test routes) is only allowed in a test environment, but ${problems.join("; ")}.`,
    );
  }
  return { testRoutesEnabled: true };
}

/** Loads the config for a process entry point; prints the reason and exits non-zero if unsafe. */
export function loadConfigOrExit(name: ProcessName, env: NodeJS.ProcessEnv = process.env): AppConfig {
  try {
    return loadConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`[${name}] ${error.message}`);
    process.exit(1);
  }
}
