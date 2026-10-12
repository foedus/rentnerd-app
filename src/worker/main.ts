import { appBanner } from "../shared/app-info";
import { keepAlive } from "./keep-alive";

console.log(`${appBanner("worker")} started (stub)`);
const stop = keepAlive();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
