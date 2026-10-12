import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";
import { keepAlive } from "./keep-alive";

loadConfigOrExit("worker");
console.log(`${appBanner("worker")} started (stub)`);
const stop = keepAlive();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, stop);
