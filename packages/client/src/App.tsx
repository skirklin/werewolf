import { useEffect, useState } from "react";
import { Picker } from "./shell/Picker.js";
import { Online } from "./shell/Online.js";
import { hasSavedRoom } from "./shell/net.js";
import { gameById } from "./games/index.js";

/**
 * Where we are, read from the address bar so pages can be linked, reloaded
 * and navigated with the back button:
 *   /                 the game picker
 *   /<game>           a game's home   (/werewolf)
 *   /<game>/<sub>     a page of it    (/werewolf/stats, /werewolf/online)
 *   ?room=CODE        an invite, which goes straight to joining
 */
type Route = { kind: "picker" } | { kind: "game"; game: string; sub: string } | { kind: "join" };

function readRoute(): Route {
  if (new URLSearchParams(location.search).has("room") || hasSavedRoom()) return { kind: "join" };
  const [first, sub = ""] = location.pathname.split("/").filter(Boolean);
  // Before there was more than one game, the stats page lived at /stats.
  if (first === "stats") return { kind: "game", game: "werewolf", sub: "stats" };
  if (first && gameById(first)) return { kind: "game", game: first, sub };
  return { kind: "picker" };
}

function pathOf(route: Route): string {
  if (route.kind === "game") return `/${route.game}${route.sub ? `/${route.sub}` : ""}`;
  return "/";
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  const go = (next: Route) => {
    const path = pathOf(next);
    // Leaving a room drops any invite from the address bar along with it.
    if (location.pathname !== path || location.search) history.pushState(null, "", path);
    setRoute(next);
  };

  // ...and follow the back button rather than stranding the reader on a page
  // the address bar says they've left.
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const home = (gameId?: string) =>
    go(gameId && gameById(gameId) ? { kind: "game", game: gameId, sub: "" } : { kind: "picker" });

  if (route.kind === "join") return <Online onExit={home} />;
  if (route.kind === "game") {
    const game = gameById(route.game)!;
    if (route.sub === "online") return <Online game={game} onExit={home} />;
    return (
      <game.Home
        sub={route.sub}
        navigate={(sub) => go({ kind: "game", game: game.id, sub })}
        onBack={() => go({ kind: "picker" })}
      />
    );
  }
  return <Picker onPick={(id) => go({ kind: "game", game: id, sub: "" })} />;
}
