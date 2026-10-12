import { appBanner } from "../shared/app-info";
import { loadConfigOrExit } from "../shared/config";

loadConfigOrExit("cli");
console.log(`${appBanner("cli")}: no commands yet`);
