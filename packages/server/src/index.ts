import { networkInterfaces } from "node:os";
import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = await createApp();
await app.listen({ port: PORT, host: HOST });

// A deploy (or Ctrl-C) stops us with a signal. Closing the app saves every
// live room before the sockets drop, so the next server picks the games up
// and the phones reconnect into them. As PID 1 in the container, Node only
// acts on SIGTERM because of this handler.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: saving rooms and shutting down.`);
    app.close().then(
      () => process.exit(0),
      (err) => {
        console.error("Unclean shutdown:", err);
        process.exit(1);
      }
    );
  });
}

console.log(`\n  🎲  Game server running\n`);
for (const url of lanUrls(PORT)) console.log(`      ${url}`);
console.log(`\n  Share a LAN URL with players on the same WiFi.\n`);

function lanUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) urls.push(`http://${net.address}:${port}`);
    }
  }
  return urls;
}
