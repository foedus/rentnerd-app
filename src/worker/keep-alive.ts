const IDLE_MS = 60_000;

/** Keeps the process running until stopped (placeholder until the pg-boss worker exists). */
export function keepAlive(): () => void {
  const timer = setInterval(() => undefined, IDLE_MS);
  return () => clearInterval(timer);
}
