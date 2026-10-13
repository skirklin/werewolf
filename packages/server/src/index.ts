import { networkInterfaces } from "node:os";
import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = await createApp();
await app.listen({ port: PORT, host: HOST });

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
