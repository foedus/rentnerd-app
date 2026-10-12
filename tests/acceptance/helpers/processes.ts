/**
 * Starts and stops the app processes (SPEC.md §15.5 harness contract).
 *
 * APP_RUNNER=node (default): `node dist/<script>.js` in the repository root.
 * APP_RUNNER=docker: the same command inside the locally built production image
 *   ($APP_IMAGE, default rentnerd-app:local) with host networking, so the image
 *   reaches the Docker Compose services on localhost.
 *
 * Process ids live in files under .state/ so that any Playwright worker can
 * restart processes started by another one (workers restart after failures).
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_URL, REPO_ROOT, STATE_DIR, TEST_ENV } from './env';

export type Proc = 'web' | 'worker';
/** Overrides applied on top of test.env; `undefined` removes the variable. */
export type EnvOverrides = Record<string, string | undefined>;

const RUNNER = process.env.APP_RUNNER ?? 'node';
const IMAGE = process.env.APP_IMAGE ?? 'rentnerd-app:local';
const LOG_DIR = path.join(STATE_DIR, 'logs');

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function appEnv(overrides: EnvOverrides = {}): Record<string, string> {
  const env: Record<string, string> = { ...TEST_ENV };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function command(script: string, args: string[], overrides: EnvOverrides, name?: string) {
  ensureDirs();
  const env = appEnv(overrides);
  if (RUNNER === 'docker') {
    const envFile = path.join(STATE_DIR, `${name ?? 'run'}-${process.pid}.env`);
    fs.writeFileSync(envFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    const dockerArgs = ['run', '--rm', '--init', '--network', 'host', '--env-file', envFile];
    if (name) dockerArgs.push('--name', `rentnerd-acc-${name}`);
    dockerArgs.push(IMAGE, 'node', `dist/${script}`, ...args);
    return { cmd: 'docker', args: dockerArgs, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } };
  }
  return {
    cmd: 'node',
    args: [`dist/${script}`, ...args],
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  };
}

const pidFile = (p: Proc) => path.join(STATE_DIR, `${p}.pid`);

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function stopProcess(p: Proc) {
  ensureDirs();
  if (RUNNER === 'docker') spawnSync('docker', ['rm', '-f', `rentnerd-acc-${p}`], { stdio: 'ignore' });
  if (!fs.existsSync(pidFile(p))) return;
  const pid = Number(fs.readFileSync(pidFile(p), 'utf8'));
  if (pid && alive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 100 && alive(pid); i++) await sleep(100);
    if (alive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }
  fs.rmSync(pidFile(p), { force: true });
}

export async function startProcess(p: Proc, overrides: EnvOverrides = {}) {
  await stopProcess(p);
  const script = p === 'web' ? 'server.js' : 'worker.js';
  const { cmd, args, env } = command(script, [], overrides, p);
  const log = fs.openSync(path.join(LOG_DIR, `${p}.log`), 'a');
  fs.writeSync(log, `\n===== ${new Date().toISOString()} start ${p} ${JSON.stringify(overrides)}\n`);
  const child = spawn(cmd, args, { cwd: REPO_ROOT, env, detached: true, stdio: ['ignore', log, log] });
  fs.writeFileSync(pidFile(p), String(child.pid));
  child.unref();
}

export async function waitForHealthy(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/api/health`);
      if (res.status === 200) return;
      last = `status ${res.status}`;
    } catch (e) {
      last = String(e);
    }
    await sleep(250);
  }
  throw new Error(`App did not become healthy at ${APP_URL}/api/health (${last}). See tests/acceptance/.state/logs/web.log`);
}

export async function isHealthy() {
  try {
    return (await fetch(`${APP_URL}/api/health`)).status === 200;
  } catch {
    return false;
  }
}

/** Runs a one-off script (migrate.js, cli.js, or server.js/worker.js expected to exit) and waits for it to exit. */
export async function runToExit(
  script: string,
  args: string[] = [],
  overrides: EnvOverrides = {},
  timeoutMs = 120_000,
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  const { cmd, args: a, env } = command(script, args, overrides);
  return await new Promise((resolve) => {
    const child = spawn(cmd, a, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output, timedOut });
    });
  });
}

export async function migrate(overrides: EnvOverrides = {}) {
  const r = await runToExit('migrate.js', [], overrides);
  if (r.code !== 0) throw new Error(`node dist/migrate.js failed (exit ${r.code}):\n${r.output}`);
}

export async function startApp(overrides: EnvOverrides = {}) {
  await startProcess('web', overrides);
  await startProcess('worker', overrides);
  await waitForHealthy();
}

export async function stopApp() {
  await stopProcess('web');
  await stopProcess('worker');
}

export async function restartApp(overrides: EnvOverrides = {}) {
  await stopApp();
  await startApp(overrides);
}
