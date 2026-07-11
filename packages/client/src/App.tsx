import { useState } from "react";
import { Home } from "./Home.js";
import { OnlineApp } from "./OnlineApp.js";
import { LocalApp } from "./LocalApp.js";

type Mode = "home" | "online" | "local";

export function App() {
  // Jump straight back into an online game if we have saved credentials.
  const [mode, setMode] = useState<Mode>(() =>
    localStorage.getItem("werewolf.creds") ? "online" : "home"
  );

  if (mode === "online") return <OnlineApp onExit={() => setMode("home")} />;
  if (mode === "local") return <LocalApp onExit={() => setMode("home")} />;
  return <Home onPick={setMode} />;
}
