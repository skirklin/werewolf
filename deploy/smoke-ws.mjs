// Smoke-test the live WebSocket endpoint end-to-end: connect, create a room,
// and confirm we get a `joined` + a lobby `view` back. Usage:
//   node deploy/smoke-ws.mjs wss://werewolf.example.com/ws
import { WebSocket } from "ws";

const url = process.argv[2] ?? "wss://werewolf.example.com/ws";
const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error("TIMEOUT — no expected messages");
  process.exit(1);
}, 15000);

let gotJoined = false;
let gotView = false;
ws.on("open", () => ws.send(JSON.stringify({ type: "createRoom", name: "Smoke" })));
ws.on("error", (e) => { console.error("WS error:", e.message); process.exit(1); });
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "joined") { gotJoined = true; console.log(`joined room ${msg.code}`); }
  if (msg.type === "view") { gotView = true; console.log(`view: phase=${msg.view.phase}, players=${msg.view.players.length}`); }
  if (gotJoined && gotView) {
    console.log("WS OK ✅");
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
