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
import SettingsScreen from "./screens/SettingsScreen.jsx";
import DownloadsScreen from "./screens/DownloadsScreen.jsx";
import HostBattleDialog from "./screens/HostBattleDialog.jsx";
import JoinPasswordDialog from "./screens/JoinPasswordDialog.jsx";
import RegisterDialog from "./screens/RegisterDialog.jsx";

import { inTauri } from "./net/connection";
import { login, register, teardown, send, say, reconnectNow } from "./net/session";
import { useLobby } from "./store/lobby";
import { useRoom } from "./store/room";
import { useContent, prefetchForBattle } from "./store/content";
import { useGame } from "./store/game";
import { useChat, BATTLE_ROOM, selectTabs } from "./store/chat";
import { useMatchmaker, secondsLeft } from "./store/matchmaker";
import { useFriends } from "./store/friends";
import { useParty, inviteSecondsLeft } from "./store/party";
import { useSettings } from "./store/settings";
import { useSite, channelOf, isExternalUrl } from "./store/site";
import { useHistory, buildDebriefView } from "./store/history";
import {
  battleList, statusBarKind, describeFailure, roomModel, chatLines, userToChip,
} from "./store/adapters";

/* Click-through: login -> battle list -> battle room -> (launch) -> debriefing.
   The ready-check is a shell-level overlay because it interrupts any screen.

   Every screen has a live path and a demo path. Inside Tauri the stores drive
   everything; in a plain browser tab the same components render src/data.js so
   the click-through still works without a server. */
export default function App() {
  const live = inTauri();

  const [loggedIn, setLoggedIn] = React.useState(false);
  const [view, setView] = React.useState("battles");
  const [room, setRoom] = React.useState(null);
  const [empty, setEmpty] = React.useState(false);
  const [queued, setQueued] = React.useState(false);
  const [check, setCheck] = React.useState(0);
  const [launching, setLaunching] = React.useState(false);
  const [hosting, setHosting] = React.useState(false);
  const [locked, setLocked] = React.useState(null);
  const [install, setInstall] = React.useState(null);
  const [profileOf, setProfileOf] = React.useState(null);
  const [away, setAway] = React.useState(false);
  const [registering, setRegistering] = React.useState(false);

  const settings = useSettings();
  /* `logout` is one of the site's actions, but the handler is defined below;
     a ref keeps the definition where it reads best. */
  const handleLogoutRef = React.useRef(null);

  const connection = useLobby(s => s.connection);
  const welcome = useLobby(s => s.welcome);
  const me = useLobby(s => s.me);
  const liveBattles = useLobby(s => s.battles);
  const liveUsers = useLobby(s => s.users);
  const reconnectAttempt = useLobby(s => s.reconnect);
  const kicked = useLobby(s => s.kicked);
  const notices = useLobby(s => s.notices);
  const siteCommand = useSite(s => s.pending);

  /* The live battle room. `useRoom` holds membership; the header it decorates
     still comes from the public battle directory in `useLobby`. */
  const liveRoomID = useRoom(s => s.battleID);
  const roomPlayers = useRoom(s => s.players);
  const roomBots = useRoom(s => s.bots);
  const roomOptions = useRoom(s => s.modOptions);
  const roomPoll = useRoom(s => s.poll);
  const roomPollOutcome = useRoom(s => s.pollOutcome);

  const chatRooms = useChat(s => s.rooms);
  const chatOrder = useChat(s => s.order);
  const chatActive = useChat(s => s.active);

  const phase = useGame(s => s.phase);
  const contentJobs = useContent(s => s.jobs);
  const contentOrder = useContent(s => s.order);
  /* The most recent job, which in a room is the one we started on join. */
  const activeDownload = contentOrder.length ? contentJobs[contentOrder[0]] : undefined;

  const mmQueues = useMatchmaker(s => s.queues);
  const mmJoined = useMatchmaker(s => s.joined);
  const mmCounts = useMatchmaker(s => s.counts);
  const mmIngame = useMatchmaker(s => s.ingame);
  const mmJoinedTime = useMatchmaker(s => s.joinedTime);
  const mmBanned = useMatchmaker(s => s.bannedSeconds);
  const mmCheck = useMatchmaker(s => s.check);

  const partyMembers = useParty(s => s.members);
  const partyInvite = useParty(s => s.invite);
  const rejoinOffer = useGame(s => s.rejoin);

  const friendNames = useFriends(s => s.friends);
  const ignoreNames = useFriends(s => s.ignores);
  const records = useHistory(s => s.records);
  const recordIndex = useHistory(s => s.index);
  const profiles = useHistory(s => s.profiles);

  React.useEffect(() => () => { if (live) void teardown(); }, [live]);

  /* Where Zero-K lives. A disk scan, so it is asked once - and again only when
     the settings screen asks, or the override changes. */
  const [detectNonce, redetect] = React.useReducer(n => n + 1, 0);
  const [installError, setInstallError] = React.useState("");
  React.useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void import("./net/launch").then(({ locateInstall }) =>
      locateInstall(settings.installRoot).then(
        i => { if (!cancelled) { setInstall(i); setInstallError(""); } },
        e => { if (!cancelled) { setInstall(null); setInstallError(String(e)); } },
      ));
    return () => { cancelled = true; };
  }, [live, settings.installRoot, detectNonce]);

  /* The demo ready-check counts itself down; the live one runs against the
     deadline the server gave us. */
  React.useEffect(() => {
    if (!check) return;
    const t = setInterval(() => setCheck(c => (c > 1 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [check]);

  /* Both countdowns run against a deadline the server set, so the UI only has
     to re-render; there is no local clock to keep in step. */
  const [, forceTick] = React.useReducer(n => n + 1, 0);
  React.useEffect(() => {
    if (!mmCheck && !partyInvite) return;
    const t = setInterval(forceTick, 500);
    return () => clearInterval(t);
  }, [mmCheck, partyInvite]);

  /* A finished match is the one thing that should pull you out of whatever you
     were doing: the debriefing is the point of having played. */
  const newest = records[0];
  React.useEffect(() => {
    // Two exceptions. Spectators are never pulled there - they have no rating
    // change, no XP and no awards, so the screen has nothing to tell them. And
    // anyone who would rather go straight back to the battle list can turn it
    // off in settings.
    if (!newest || newest.spectator || !settings.autoOpenDebriefing) return;
    setView("debrief");
  }, [newest && newest.serverBattleId]);

  /* Content, as soon as you are in the room rather than at the whistle.
     BattleHeader carries the game and map minutes before ConnectSpring does, so
     the download runs while people are still picking teams. The launch still
     runs its own preflight - this is a head start, not the gate. */
  React.useEffect(() => {
    if (!live || liveRoomID == null) return;
    const header = liveBattles[liveRoomID];
    if (!header) return;
    void prefetchForBattle(
      liveRoomID,
      header.Engine || welcome?.Engine || "",
      header.Game,
      header.Map,
      settings.installRoot,
    );
  }, [live, liveRoomID, liveBattles[liveRoomID]?.Map, liveBattles[liveRoomID]?.Game]);

  /* Hooks only: everything below the login screen's early return runs
     conditionally, so a hook down there changes the hook order between
     renders. */
  const ignored = React.useMemo(() => new Set(ignoreNames), [ignoreNames]);

  const handleLogin = React.useCallback(async (name, password, remember) => {
    // Remember the name either way - it is not a secret, and typing it every
    // time is the single most annoying thing a lobby can do.
    useSettings.getState().set({ name, remember: Boolean(remember),
      password: remember ? password : undefined });
    if (!live) {
      await new Promise(r => setTimeout(r, 700));
      setLoggedIn(true);
      return;
    }
    const { host, port } = useSettings.getState();
    await login({ name, password }, host || undefined, port || undefined);
    const c = useLobby.getState().connection;
    if (c.kind !== "online") throw new Error(describeFailure(c));
    setLoggedIn(true);
  }, [live]);

  /* The website talks to the lobby you already have open: "join this player",
     "add this friend", "open this channel". The grammar is upstream's - see
     store/site.ts - and everything it asks for here is something the app can
     already do. Anything unrecognised is ignored rather than guessed at. */
  React.useEffect(() => {
    if (!live || !siteCommand) return;
    const command = useSite.getState().take();
    if (!command) return;

    for (const { command: action, arg } of command.actions) {
      switch (action) {
        case "join_battle":
        case "join_player": {
          // The argument is a player, not a battle: join whatever they are in.
          const target = useLobby.getState().users[arg];
          if (target?.BattleID != null) {
            useRoom.getState().join(target.BattleID);
            setView("battles");
          }
          break;
        }
        case "add_friend":
          useFriends.getState().add(arg);
          break;
        case "select_map":
          // In a room the host decides, and every autohost takes !map.
          if (useRoom.getState().battleID != null) void say(`!map ${arg}`, 1);
          else setHosting(true);
          break;
        case "logout":
          handleLogoutRef.current?.();
          break;
        default:
          break;
      }
    }

    const channel = channelOf(command.path);
    if (channel) {
      useChat.getState().join(channel);
      setView("chat");
    } else if (command.path === "battles") setView("battles");
    else if (isExternalUrl(command.path)) {
      const url = command.path.startsWith("www.") ? `http://${command.path}` : command.path;
      window.open(url, "_blank", "noreferrer");
    }
  }, [live, siteCommand]);

  const handleRegister = React.useCallback(async (name, password, email) => {
    if (!live) {
      await new Promise(r => setTimeout(r, 700));
      setLoggedIn(true);
      return;
    }
    const { host, port } = useSettings.getState();
    await register({ name, password }, email, host || undefined, port || undefined);
    // register() logs in on success, so anything left is a real failure.
    const c = useLobby.getState().connection;
    if (c.kind !== "online") throw new Error(describeFailure(c));
    useSettings.getState().set({ name });
    setLoggedIn(true);
  }, [live]);

  const handleLogout = React.useCallback(() => {
    // Every store holds session state; leaving any of it behind would show the
    // next account the last one's friends.
    if (live) void teardown();
    useLobby.getState().reset();
    useRoom.getState().reset();
    useChat.getState().reset();
    useGame.getState().reset();
    useMatchmaker.getState().reset();
    useParty.getState().reset();
    useFriends.getState().reset();
    useHistory.getState().reset();
    useSettings.getState().forgetPassword();
    setLoggedIn(false);
    setView("battles");
  }, [live]);

  // Who is in each battle room. Only `User` carries BattleID, so this is the
  // only occupancy signal available before joining.
  const occupantsOf = React.useCallback(
    id => Object.values(liveUsers).filter(u => u.BattleID === id && u.Name).map(u => u.Name).sort(),
    [liveUsers]
  );

  handleLogoutRef.current = handleLogout;

  const shell = {
    connection: live ? statusBarKind(connection, reconnectAttempt) : "online",
    users: live ? (welcome?.UserCount ?? 0) : D.welcome.UserCount,
    engine: live ? (welcome?.Engine ?? "-") : D.welcome.Engine,
    game: live ? (welcome?.Game ?? "-") : D.welcome.Game,
    attempt: live ? reconnectAttempt : 0,
    onReconnect: live ? reconnectNow : undefined,
  };

  if (!loggedIn) {
    return (
      <AppShell view={view} onView={setView} {...shell}>
        <ErrorBoundary>
          <LoginScreen onLogin={handleLogin} live={live}
            onRegister={() => setRegistering(true)}
            defaultName={settings.name} defaultPassword={settings.password}
            defaultRemember={settings.remember} />
        </ErrorBoundary>
        <RegisterDialog open={registering} onClose={() => setRegistering(false)}
          onRegister={handleRegister} />
      </AppShell>
    );
  }

  const battles = live ? battleList(liveBattles) : D.battles;
  const liveRoom = live && liveRoomID != null
    ? roomModel(liveBattles[liveRoomID], roomPlayers, roomBots, liveUsers, roomOptions)
    : null;

  /* Not running: the host decides when to start, and every Zero-K autohost
     takes `!start` in room chat - which is exactly what a player types today.
     Running: ask for connect details and launch straight into it. */
  const startRoom = () => {
    if (!liveRoom) return;
    if (liveRoom.running) useGame.getState().requestStart(liveRoom.id);
    else void say("!start", 1);
  };

  const setBattleStatus = patch => {
    if (me) void send("UpdateUserBattleStatus", { Name: me, ...patch });
  };

  const joinBattle = b => {
    if (!live) { setRoom(b); return; }
    // A locked room needs its password before the join, not after a refusal.
    if (b.locked) setLocked(b);
    else useRoom.getState().join(b.id);
  };

  const openDm = name => {
    useChat.getState().openDm(name);
    setView("chat");
  };

  // ---------------------------------------------------------------- chat ---
  const battleChat = chatRooms[BATTLE_ROOM];
  const chatTabs = live
    ? selectTabs({ rooms: chatRooms, order: chatOrder })
    : D.channels;
  const activeRoom = chatRooms[chatActive];
  const chatUsers = live
    ? (activeRoom ? activeRoom.users.map(n => userToChip(liveUsers[n], n)) : [])
    : D.channelUsers;

  // ----------------------------------------------------------- matchmaker ---
  const queueRows = mmQueues.map(q => ({
    id: q.Name,
    label: q.Description || q.Name,
    waiting: mmCounts[q.Name] ?? 0,
    ingame: mmIngame[q.Name] ?? 0,
  }));

  // ---------------------------------------------------------------- view ---
  let body;
  // Being in a room does not pin you to it - the sidebar still navigates.
  if (liveRoom && view === "battles") body = (
    <BattleRoomScreen room={liveRoom}
      download={activeDownload}
      chat={battleChat ? chatLines(battleChat.messages, liveUsers, ignored) : []}
      onLeave={() => useRoom.getState().leave()}
      onSay={text => void say(text, 1)}
      onTeam={ally => setBattleStatus({ AllyNumber: ally, IsSpectator: false })}
      onSpectate={() => setBattleStatus({ IsSpectator: true })}
      sync={{ install, engine: welcome?.Engine }}
      phase={phase}
      poll={roomPoll}
      pollOutcome={roomPollOutcome}
      onVote={option => useRoom.getState().vote(option)}
      onKick={u => useRoom.getState().kick(u.name)}
      onAddBot={ally => useRoom.getState().addBot("CAI", ally)}
      onPlayer={u => { if (u.name !== me && !u.bot) openDm(u.name); }}
      onStart={startRoom} />
  );
  else if (room) body = <BattleRoomScreen room={D.room} onLeave={() => setRoom(null)}
    onStart={() => { setLaunching(true); setTimeout(() => { setLaunching(false); setRoom(null); setView("debrief"); }, 1600); }} />;
  else if (view === "battles") body = <BattleListScreen battles={battles} empty={empty}
    occupants={live ? occupantsOf : null}
    onToggleEmpty={e => setEmpty(e.target.checked)}
    onHost={() => setHosting(true)}
    onSpectate={b => (live ? useRoom.getState().join(b.id, undefined, true) : setRoom(b))}
    onJoin={joinBattle} />;
  else if (view === "chat") body = (
    <ChatScreen
      channels={chatTabs}
      users={chatUsers}
      messages={live
        ? (activeRoom ? chatLines(activeRoom.messages, liveUsers, ignored) : [])
        : D.channelChat}
      active={live ? chatActive : undefined}
      topic={live && activeRoom && activeRoom.topic ? activeRoom.topic.Text : undefined}
      onTab={live ? id => useChat.getState().setActive(id) : undefined}
      onSend={live ? text => useChat.getState().say(chatActive, text) : undefined}
      onClose={live ? id => useChat.getState().close(id) : undefined}
      onJoin={live ? name => useChat.getState().join(name) : undefined}
      onUser={live ? openDm : undefined} />
  );
  else if (view === "queue") body = (
    <QueueScreen
      queued={queued}
      queues={live ? queueRows : undefined}
      joined={live ? mmJoined : undefined}
      joinedTime={live ? mmJoinedTime : undefined}
      bannedSeconds={live ? mmBanned : undefined}
      elo={live && me && liveUsers[me] ? Math.round(liveUsers[me].EffectiveMmElo) : undefined}
      party={live ? partyMembers.map(n => userToChip(liveUsers[n], n)) : D.channelUsers.slice(0, 2)}
      onInvite={live ? name => useParty.getState().sendInvite(name) : undefined}
      onLeaveParty={live ? () => useParty.getState().leave() : undefined}
      onQueue={live
        ? (on, picked) => useMatchmaker.getState().setQueues(on ? picked : [])
        : on => setQueued(on)}
      onFake={live ? undefined : () => setCheck(9)} />
  );
  else if (view === "friends") body = (
    <FriendsScreen
      users={live ? friendNames.map(n => userToChip(liveUsers[n], n)) : D.channelUsers}
      profile={live && profileOf && profiles[profileOf] ? {
        level: profiles[profileOf].Level,
        rank: profiles[profileOf].Rank,
        elo: Math.round(profiles[profileOf].EffectiveElo),
        mmElo: Math.round(profiles[profileOf].EffectiveMmElo),
        pwElo: Math.round(profiles[profileOf].EffectivePwElo),
        badges: profiles[profileOf].Badges,
      } : undefined}
      onSelect={live ? name => {
        setProfileOf(name);
        if (!profiles[name]) useFriends.getState().requestProfile(name);
      } : undefined}
      onMessage={live ? openDm : undefined}
      onIgnore={live ? name => useFriends.getState().ignore(name) : undefined}
      onAdd={live ? name => useFriends.getState().add(name) : undefined}
      onRemove={live ? name => useFriends.getState().remove(name) : undefined} />
  );
  else if (view === "downloads") body = (
    <DownloadsScreen jobs={contentJobs} order={contentOrder}
      onCancel={id => useContent.getState().cancel(id)}
      onClear={() => useContent.getState().clearFinished()}
      onSettings={() => setView("settings")} />
  );
  else if (view === "settings") body = (
    <SettingsScreen
      me={live ? me : "Shadowfury"}
      install={live ? install : { root: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K", source: "Steam" }}
      installError={installError}
      engine={live ? welcome?.Engine : D.welcome.Engine}
      settings={settings}
      onSettings={patch => useSettings.getState().set(patch)}
      onRedetect={live ? redetect : undefined}
      onPreview={live
        ? () => import("./net/launch").then(({ launchPreview }) =>
          launchPreview(welcome?.Engine ?? "", me ?? ""))
        : undefined}
      onLogout={handleLogout}
      away={away}
      onAway={live ? next => { setAway(next); void send("ChangeUserStatus", { IsAfk: next }); } : undefined} />
  );
  else body = (
    <DebriefingScreen
      d={live
        ? (records[recordIndex]
          ? buildDebriefView(records[recordIndex], me, n => liveUsers[n], profiles)
          : null)
        : D.debrief}
      onBack={() => setView("battles")} />
  );

  const mmSeconds = secondsLeft(mmCheck, Date.now());
  const overlay = (
    <>
      <Dialog open={check > 0 || Boolean(mmCheck)} title="Ready check" urgent width={380}
        footer={mmCheck
          ? <>
            <Button variant="ghost" onClick={() => useMatchmaker.getState().respond(false)}>Decline</Button>
            <Button variant="primary" disabled={mmCheck.accepted}
              onClick={() => useMatchmaker.getState().respond(true)}>
              {mmCheck.accepted ? "Waiting for the others" : "Ready"}
            </Button>
          </>
          : <>
            <Button variant="ghost" onClick={() => { setCheck(0); setQueued(false); }}>Decline</Button>
            <Button variant="primary" onClick={() => { setCheck(0); setQueued(false); setRoom(D.room); }}>Ready</Button>
          </>}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span style={{ font: "var(--text-title)", color: "var(--text-hi)" }}>Match found. Ready?</span>
          <span style={{ font: "var(--text-num-lg)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {mmCheck ? mmSeconds : check}s
          </span>
        </div>
        <div style={{ marginTop: 14 }}>
          <Meter value={mmCheck ? mmSeconds : check} max={mmCheck ? 30 : 9} height={2} />
        </div>
        {mmCheck && mmCheck.battleSize ? (
          <div style={{ marginTop: 12, font: "var(--w-regular) var(--size-tiny)/1.4 var(--font-core)",
            color: mmCheck.likelyToPlay ? "var(--text-low)" : "var(--signal-warn)" }}>
            {(mmCheck.battleReady ?? 0)} of {mmCheck.battleSize} accepted
            {mmCheck.likelyToPlay ? "" : " - this one may not happen"}
          </div>
        ) : null}
      </Dialog>

      {/* One dialog for the whole start sequence: check content, fetch what is
          missing, then hand off. The engine must not be started before content
          is settled - an engine told to join a game whose archive it lacks sits
          on "waiting for connection" forever with nothing to explain why. */}
      <Dialog
        open={launching || phase.kind === "launching" || phase.kind === "preflight"
          || phase.kind === "downloading"}
        title={phase.kind === "downloading" ? "Downloading" : "Launching"}
        width={380}
        footer={phase.kind === "downloading" ? (
          <>
            <Button variant="ghost" onClick={() => {
              useContent.getState().cancel(phase.jobId);
              useGame.setState({ phase: { kind: "idle" } });
            }}>Cancel</Button>
            <Button variant="secondary" onClick={() => {
              const c = useGame.getState().last;
              useContent.getState().cancel(phase.jobId);
              if (c) void useGame.getState().launch(c);
            }}>Launch anyway</Button>
          </>
        ) : undefined}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          {phase.kind === "preflight" ? (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
                Checking you have the game and map.
              </span>
              <Meter indeterminate />
            </>
          ) : phase.kind === "downloading" ? (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
                Getting content Zero-K needs for this match.
              </span>
              <Meter value={phase.percent} max={100}
                label={phase.what} right={phase.percent + "%"} />
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)",
                color: "var(--text-low)" }}>
                Starting without it would leave the engine waiting for a connection
                it can never make.
              </span>
            </>
          ) : (
            <>
              <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>Handing off to the engine.</span>
              <Meter indeterminate />
              <span style={{ font: "var(--w-regular) var(--size-tiny)/1.5 var(--font-core)", color: "var(--text-low)" }}>
                Shiro goes dormant while the match runs and comes back with your results.
              </span>
            </>
          )}
        </div>
      </Dialog>

      <HostBattleDialog open={hosting} onClose={() => setHosting(false)}
        defaultTitle={me ? me + "'s battle" : "New battle"}
        maps={[...new Set(battles.map(b => b.map).filter(Boolean))].sort()}
        onHost={opts => (live
          ? useRoom.getState().host({ ...opts, engine: welcome?.Engine, game: welcome?.Game })
          : setRoom(D.room))} />

      <JoinPasswordDialog battle={locked} onClose={() => setLocked(null)}
        onJoin={password => useRoom.getState().join(locked.id, password)} />

      <Dialog open={Boolean(partyInvite)} title="Party invite" width={360}
        footer={<>
          <Button variant="ghost" onClick={() => useParty.getState().respond(false)}>Decline</Button>
          <Button variant="primary" onClick={() => useParty.getState().respond(true)}>Join party</Button>
        </>}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
          <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
            {partyInvite ? partyInvite.members.filter(n => n !== me).join(", ") : ""} want you in their party.
          </span>
          <span style={{ font: "var(--text-num)", color: "var(--text-hi)", fontVariantNumeric: "tabular-nums" }}>
            {inviteSecondsLeft(partyInvite, Date.now())}s
          </span>
        </div>
      </Dialog>

      {/* The server has something to say that is not chat: a mute, a ban, an
          announcement. One at a time, oldest first. */}
      <Dialog open={notices.length > 0} title="Message from the server" width={400}
        footer={<Button variant="primary" onClick={() => useLobby.getState().clearNotice()}>OK</Button>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>
          {notices[0] || ""}
        </span>
      </Dialog>

      {/* An admin threw us off. There is nothing to retry, so the only way
          out is back to the login screen. */}
      <Dialog open={Boolean(kicked)} title="Disconnected by an admin" width={380}
        footer={<Button variant="primary" onClick={() => { useLobby.getState().clearKick(); handleLogout(); }}>
          Back to login
        </Button>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {kicked ? kicked.reason : ""}
        </span>
      </Dialog>

      {/* Sent after login when a game you were in is still running: the lobby
          crashed, or you closed it mid-match. Purely an offer. */}
      <Dialog open={rejoinOffer != null} title="You are still in a game" width={380}
        footer={<>
          <Button variant="ghost" onClick={() => useGame.getState().takeRejoin(false)}>Ignore</Button>
          <Button variant="primary" icon="play"
            onClick={() => useGame.getState().takeRejoin(true)}>Rejoin</Button>
        </>}>
        <span style={{ font: "var(--text-ui)", color: "var(--text-body)" }}>
          {rejoinOffer != null && liveBattles[rejoinOffer]
            ? liveBattles[rejoinOffer].Title + " is still running."
            : "A battle you were in is still running."}
        </span>
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
