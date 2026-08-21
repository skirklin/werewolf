import { useEffect, useState } from "react";
import { Home } from "./Home.js";
import { OnlineApp } from "./OnlineApp.js";
import { LocalApp } from "./LocalApp.js";
import { StatsPage } from "./Stats.js";

type Mode = "home" | "online" | "local" | "stats";

export function App() {
  // Jump straight into online play from a shared invite link (?room=CODE) or
  // when we have saved credentials to resume; /stats opens the house numbers.
  const [mode, setMode] = useState<Mode>(() => {
    if (location.pathname === "/stats") return "stats";
    const hasInvite = new URLSearchParams(location.search).has("room");
    return hasInvite || localStorage.getItem("werewolf.creds") ? "online" : "home";
  });

  // Keep /stats in the address bar so it can be linked and reloaded.
  const go = (next: Mode) => {
    const path = next === "stats" ? "/stats" : "/";
    if (location.pathname !== path) history.pushState(null, "", path + location.search);
    setMode(next);
  };

  // ...and follow the back button rather than stranding the reader on a page
  // the address bar says they've left.
  useEffect(() => {
    const onPop = () => setMode(location.pathname === "/stats" ? "stats" : "home");
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  if (mode === "online") return <OnlineApp onExit={() => go("home")} />;
  if (mode === "local") return <LocalApp onExit={() => go("home")} />;
  if (mode === "stats") return <StatsPage onExit={() => go("home")} />;
  return <Home onPick={go} />;
}
