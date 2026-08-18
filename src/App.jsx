import React from "react";
import { Dialog, Button, Meter } from "./ds/shiro.js";
import D from "./data.js";

import ErrorBoundary from "./ErrorBoundary.jsx";
import AppShell from "./screens/AppShell.jsx";
import LoginScreen from "./screens/LoginScreen.jsx";
import BattleListScreen from "./screens/BattleListScreen.jsx";
import BattleRoomScreen from "./screens/BattleRoomScreen.jsx";
import ChatScreen from "./screens/ChatScreen.jsx";
import QueueScreen from "./screens/QueueScreen.jsx";
import DebriefingScreen from "./screens/DebriefingScreen.jsx";
import FriendsScreen from "./screens/FriendsScreen.jsx";

import { inTauri } from "./net/connection";
import { login, teardown } from "./net/session";
import { useLobby } from "./store/lobby";
import { battleList, statusBarKind, describeFailure } from "./store/adapters";

/* Click-through: login -> battle list -> battle room -> (launch) -> debriefing.
   The ready-check is a shell-level overlay because it interrupts any screen.

   Inside Tauri the login, status bar and battle list are driven by the live
   server. The remaining screens still render demo data - see README. */
export default function App() {
  const live = inTauri();

  const [loggedIn, setLoggedIn] = React.useState(false);
  const [view, setView] = React.useState("battles");
  const [room, setRoom] = React.useState(null);
  const [empty, setEmpty] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [check, setCheck] = React.useState(0);
  const [launching, setLaunching] = React.useState(false);

  const connection = useLobby(s => s.connection);
  const welcome = useLobby(s => s.welcome);
  const me = useLobby(s => s.me);
  const liveBattles = useLobby(s => s.battles);
  const liveUsers = useLobby(s => s.users);

  React.useEffect(() => () => { if (live) void teardown(); }, [live]);

  React.useEffect(() => {
    if (!check) return;
    const t = setInterval(() => setCheck(c => (c > 1 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [check]);

  const handleLogin = React.useCallback(async (name, password) => {
    if (!live) {
      await new Promise(r => setTimeout(r, 700));
      setLoggedIn(true);
      return;
    }
    await login({ name, password });
    const c = useLobby.getState().connection;
    if (c.kind !== "online") throw new Error(describeFailure(c));
    setLoggedIn(true);
  }, [live]);

  // Who is in each battle room. Only `User` carries BattleID, so this is the
  // only occupancy signal available before joining.
  const occupantsOf = React.useCallback(
    id => Object.values(liveUsers).filter(u => u.BattleID === id && u.Name).map(u => u.Name).sort(),
    [liveUsers]
  );

  const shell = {
    connection: live ? statusBarKind(connection) : "online",
    users: live ? (welcome?.UserCount ?? 0) : D.welcome.UserCount,
    engine: live ? (welcome?.Engine ?? "-") : D.welcome.Engine,
    game: live ? (welcome?.Game ?? "-") : D.welcome.Game,
  };

  if (!loggedIn) {
    return (
      <AppShell view={view} onView={setView} {...shell}>
        <ErrorBoundary><LoginScreen onLogin={handleLogin} live={live} /></ErrorBoundary>
      </AppShell>
    );
  }

  const battles = live ? battleList(liveBattles) : D.battles;

  let body;
  if (room) body = <BattleRoomScreen room={D.room} onLeave={() => setRoom(null)}
    onStart={() => { setLaunching(true); setTimeout(() => { setLaunching(false); setRoom(null); setView("debrief"); }, 1600); }} />;
  else if (view === "battles") body = <BattleListScreen battles={battles} empty={empty}
    occupants={live ? occupantsOf : null}
    onToggleEmpty={e => setEmpty(e.target.checked)} onJoin={b => setRoom(b)} />;
  else if (view === "chat") body = <ChatScreen channels={D.channels} users={D.channelUsers} messages={D.channelChat} />;
  else if (view === "queue") body = <QueueScreen queued={queued} onQueue={setQueued} onFake={() => setCheck(9)} />;
  else if (view === "friends") body = <FriendsScreen users={D.channelUsers} />;
  else body = <DebriefingScreen d={D.debrief} onBack={() => setView("battles")} />;

  const overlay = (
    <>
      <Dialog open={check > 0} title="Ready check" urgent width={380}
        footer={<><Button variant="ghost" onClick={() => { setCheck(0); setQueued(false); }}>Decline</Button>
          <Button variant="primary" onClick={() => { setCheck(0); setQueued(false); setRoom(D.room); }}>Ready</Button></>}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span style={{ font: "var(--text-title)", color: "var(--text-hi)" }}>Match found. Ready?</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>{check}s</span>
        </div>
        <div style={{ marginTop: 14 }}><Meter value={check} max={9} height={2} /></div>
      </Dialog>
      <Dialog open={launching} title="Launching" width={360}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>Handing off to the engine.</span>
          <Meter indeterminate />
          <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
            Shiro goes dormant while the match runs and comes back with your results.
          </span>
        </div>
      </Dialog>
    </>
  );

  return (
    <AppShell view={view} onView={v => { setRoom(null); setView(v); }} {...shell}
      overlay={overlay} me={me}>
      <ErrorBoundary>{body}</ErrorBoundary>
    </AppShell>
  );
}
