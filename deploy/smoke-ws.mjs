// Smoke-test the live WebSocket endpoint end-to-end: connect, create a room,
// and confirm we get a `joined` + the room's lobby back. Usage:
//   node deploy/smoke-ws.mjs wss://werewolf.example.com/ws
import { WebSocket } from "ws";

const url = process.argv[2] ?? "wss://werewolf.example.com/ws";
const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error("TIMEOUT — no expected messages");
  process.exit(1);
}, 15000);

let gotJoined = false;
let gotRoom = false;
ws.on("open", () => ws.send(JSON.stringify({ type: "createRoom", game: "werewolf", name: "Smoke" })));
ws.on("error", (e) => { console.error("WS error:", e.message); process.exit(1); });
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.type === "joined") { gotJoined = true; console.log(`joined room ${msg.code}`); }
  if (msg.type === "room") { gotRoom = true; console.log(`room: ${msg.room.game}, phase=${msg.room.phase}, players=${msg.room.players.length}`); }
  if (msg.type === "error") { console.error("server error:", msg.message); process.exit(1); }
  if (gotJoined && gotRoom) {
    console.log("WS OK ✅");
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
