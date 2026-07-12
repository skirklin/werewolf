import { useState } from "react";
import { Home } from "./Home.js";
import { OnlineApp } from "./OnlineApp.js";
import { LocalApp } from "./LocalApp.js";

type Mode = "home" | "online" | "local";

export function App() {
  // Jump straight into online play from a shared invite link (?room=CODE) or
  // when we have saved credentials to resume.
  const [mode, setMode] = useState<Mode>(() => {
    const hasInvite = new URLSearchParams(location.search).has("room");
    return hasInvite || localStorage.getItem("werewolf.creds") ? "online" : "home";
  });

  if (mode === "online") return <OnlineApp onExit={() => setMode("home")} />;
  if (mode === "local") return <LocalApp onExit={() => setMode("home")} />;
  return <Home onPick={setMode} />;
}
