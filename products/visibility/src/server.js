import { createServer } from "node:http";
import { database } from "./db.js";
import { app } from "./api.js";
if (
  process.env.NODE_ENV === "production" &&
  !process.env.VISIBILITY_PUBLIC_ORIGIN?.startsWith("https://")
)
  throw new Error("Production requires VISIBILITY_PUBLIC_ORIGIN=https://…");
const pool = database();
await pool.query("SELECT 1");
const server = createServer(app(pool));
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 4100),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      JSON.stringify({
        event: "visibility.started",
        port: process.env.PORT || 4100,
      }),
    ),
);
async function stop() {
  server.close(async () => {
    await pool.end();
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
