import { serve } from "@hono/node-server";
import { appBanner } from "../shared/app-info";
import { app } from "./app";

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => console.log(`${appBanner("web")} listening on ${port}`));
