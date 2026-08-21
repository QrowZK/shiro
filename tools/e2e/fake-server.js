/**
 * A ZkLobbyServer good enough to drive the whole UI, injected into the page
 * before the app boots.
 *
 * The client's only contact with the outside world is four Tauri commands and
 * two events, so replacing `window.__TAURI_INTERNALS__` swaps the real server
 * for this one without the app knowing. That makes the live code paths - the
 * ones that only run inside Tauri - testable in a plain browser.
 *
 * It is a script, not a module, because it runs through
 * Playwright's addInitScript before any bundle loads.
 *
 * Usage from a test:
 *   await page.addInitScript({ path: "tools/e2e/fake-server.js" });
 *   ...
 *   await page.evaluate(() => window.__ZKS.push('BattleAdded {"Header":{...}}'));
 */
(() => {
  /** eventId -> {event, handler}. Ids are what `listen` hands back, and what
   *  `unlisten` gives us to take a handler back off. */
  const handlers = new Map();
  let nextId = 1;
  const emit = (event, payload) => {
    for (const [id, h] of handlers) {
      if (h.event === event) h.handler({ event, id, payload });
    }
  };

  const state = {
    /** Every line the client sent, for assertions. */
    sent: [],
    /** Lines the scripted responses have queued. */
    push: line => emit("zks://line", line),
    emitGame: status => emit("zks://game", status),
    /** Set by a test to intercept a command instead of the default reply. */
    onSend: null,
    /** Pull the socket out from under the client. */
    drop: reason => emit("zks://status", { kind: "disconnected", reason: reason || "reset by peer" }),
    /* Content downloads. `missing` is what the preflight reports as absent, so
       a test can put the launcher through the download gate; `emitContent`
       stands in for the supervisor's events. */
    missing: [],
    lastJobId: null,
    /** A Shiro-managed install that nothing has been downloaded into. */
    managed: { root: "C:\\Users\\test\\AppData\\Roaming\\shiro\\zk",
      prepared: false, engineInstalled: false, archives: 0 },
    engineAsked: null,
    lastFetch: null,
    emitContent: status => emit("zks://content", status),
  };
  window.__ZKS = state;

  let jobCounter = 0;
  const line = (cmd, data) => cmd + " " + JSON.stringify(data);
  const soon = fn => setTimeout(fn, 5);

  /** The post-login flood, trimmed to what the screens actually read. */
  function flood() {
    state.push(line("User", { Name: "Qrow", AccountID: 1, Country: "GB", Clan: "ZKF",
      EffectiveElo: 1842.4, EffectiveMmElo: 1766, Level: 41, Rank: 4, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1766 }));
    // hexed founded battle 11 and is sitting in it, which is what makes
    // "join whatever that player is in" answerable.
    state.push(line("User", { Name: "hexed", AccountID: 2, Country: "US", Clan: "ZKF",
      BattleID: 11,
      EffectiveElo: 1790, EffectiveMmElo: 1701, Level: 33, Rank: 3, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1701 }));
    state.push(line("User", { Name: "lorelei", AccountID: 3, Country: "FR",
      EffectiveElo: 1588, EffectiveMmElo: 1550, Level: 19, Rank: 2, IsAdmin: false, IsBot: false,
      AwaySince: "2026-08-18T09:00:00Z",
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1550 }));
    // A custom game on purpose: the room panel has to name what it runs, and a
    // room that is not Zero-K is the case that gets it wrong.
    state.push(line("BattleAdded", { Header: { BattleID: 11, Title: "Teams 8v8 - all welcome",
      Map: "Comet Catcher Redux", Founder: "hexed", PlayerCount: 9, MaxPlayers: 16,
      Game: "Supreme-K 3.42",
      SpectatorCount: 2, Mode: 6, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 12, Title: "private - do not join",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 4, MaxPlayers: 8, Password: "x",
      Mode: 4, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 13, Title: "running match",
      Map: "TartarusV7", Founder: "Qrow", PlayerCount: 12, MaxPlayers: 12, Mode: 6,
      IsRunning: true, RunningSince: "2026-08-18T09:30:00Z" } }));
    /* Two rooms nobody can walk into, because the list has to tell them apart
       from the ones you can. 14 is at its cap, which the server answers by
       quietly spectating whoever arrives. 15 is *over* its cap, which only
       happens where the server's time queue is on: everybody counts as a
       player until the game starts, and then the last to claim a slot are
       spectated. PlayerCount excludes spectators and bots, so it is the number
       MaxPlayers is measured against. Both are kept quieter than battle 11 so
       the busiest-room ordering above still has the same answer. */
    state.push(line("BattleAdded", { Header: { BattleID: 14, Title: "full house",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 6, MaxPlayers: 6,
      SpectatorCount: 0, Mode: 6, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 15, Title: "queue for a slot",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 8, MaxPlayers: 6,
      SpectatorCount: 0, Mode: 6, IsRunning: false, TimeQueueEnabled: true } }));
    state.push(line("JoinChannelResponse", { Success: true, ChannelName: "zk",
      Channel: { ChannelName: "zk", IsDeluge: false, Users: ["Qrow", "hexed", "lorelei"],
        Topic: { Text: "Welcome to Zero-K", SetBy: "zk-admin" } } }));
    state.push(line("Say", { Place: 0, Target: "zk", User: "hexed", Text: "anyone up for teams",
      Time: "2026-08-18T09:51:00Z", IsEmote: false, Ring: false, AllowRelay: true }));
    state.push(line("FriendList", { Friends: [{ Name: "hexed" }, { Name: "lorelei" }] }));
    state.push(line("MatchMakerSetup", { PossibleQueues: [
      { Name: "1v1", Description: "1v1", MaxPartySize: 1, UseWinChanceLimit: false,
        UseCasualElo: false, MinWinChanceMult: 0, MinWinChanceOffset: 0, UseHandicap: false,
        MaxSize: 2, MinSize: 2, EloCutOffExponent: 1, Mode: 3 },
      { Name: "Teams", Description: "Teams", MaxPartySize: 4, UseWinChanceLimit: false,
        UseCasualElo: false, MinWinChanceMult: 0, MinWinChanceOffset: 0, UseHandicap: false,
        MaxSize: 16, MinSize: 4, EloCutOffExponent: 1, Mode: 6 },
    ] }));
    state.push(line("MatchMakerStatus", { JoinedQueues: [], QueueCounts: { "1v1": 6, Teams: 21 },
      IngameCounts: { "1v1": 2, Teams: 14 }, UserCount: 100, UserCountDiscord: 12 }));
  }

  /** The roster of a battle we just joined. */
  function joined(battleID) {
    state.push(line("JoinBattleSuccess", {
      BattleID: battleID,
      Options: { commshare: "1", multiplier: "2.0" },
      Players: [
        { Name: "Qrow", AllyNumber: 0 },
        { Name: "hexed", AllyNumber: 1 },
        { Name: "lorelei", IsSpectator: true },
      ],
      Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "hexed" }],
    }));
    state.push(line("User", { Name: "Qrow", AccountID: 1, BattleID: battleID,
      IsAdmin: false, IsBot: false, BanMute: false, BanVotes: false, BanSpecChat: false,
      SyncVersion: 1, RawMmElo: 1766, EffectiveMmElo: 1766, EffectiveElo: 1842, Level: 41, Rank: 4 }));
    state.push(line("Say", { Place: 1, User: "hexed", Text: "hi", Time: "2026-08-18T10:00:00Z",
      IsEmote: false, Ring: false, AllowRelay: true }));
  }

  /** Default replies, so a test only scripts what it cares about. */
  function respond(raw) {
    const sp = raw.indexOf(" ");
    const cmd = sp < 0 ? raw : raw.slice(0, sp);
    const data = sp < 0 ? {} : JSON.parse(raw.slice(sp + 1));

    switch (cmd) {
      case "Register":
        // "shiro-taken" is the one name this server refuses, so a test can see
        // both outcomes.
        soon(() => state.push(line("RegisterResponse",
          data.Name === "shiro-taken" ? { ResultCode: 2 } : { ResultCode: 0 })));
        break;
      case "Login":
        soon(() => {
          /* "shiro-wrong" is refused, and the connection drops straight after -
             which is what the real server does, and the reason a refused login
             could turn into a reconnect loop replaying the same bad hash. */
          if (data.Name === "shiro-wrong") {
            state.logins = (state.logins ?? 0) + 1;
            // 3 is InvalidPassword; 2 would be InvalidName, which is a different message.
            state.push(line("LoginResponse", { ResultCode: 3, BanReason: "" }));
            soon(() => state.drop());
            return;
          }
          state.me = data.Name;
          state.push(line("LoginResponse", { ResultCode: 0, Name: data.Name, SessionToken: "t" }));
          flood();
        });
        break;
      /* The real server echoes a Say back to everyone in the channel or room,
         including the sender - that echo is how a sent line ever appears. This
         server did not, which is why nothing here ever exercised an INCOMING
         chat line, and so nothing caught the log failing to follow one. */
      case "Say":
        soon(() => state.push(line("Say", {
          Place: data.Place, Target: data.Target, User: state.me || "Qrow",
          Text: data.Text, Time: new Date(0).toISOString(),
        })));
        break;
      case "JoinBattle":
        soon(() => joined(data.BattleID));
        break;
      case "OpenBattle":
        soon(() => {
          state.push(line("BattleAdded", { Header: { BattleID: 99, Title: data.Header.Title,
            Map: data.Header.Map, Founder: "Qrow", PlayerCount: 1,
            MaxPlayers: data.Header.MaxPlayers, Mode: 0, IsRunning: false } }));
          joined(99);
        });
        break;
      /* The real server assigns the dictionary and broadcasts it to the room -
         there is no acknowledgement, the echo *is* the acknowledgement, and a
         client that does not wait for it is guessing. */
      case "SetModOptions":
        soon(() => state.push(line("SetModOptions", { Options: data.Options })));
        break;
      /* LeaveBattle gets no reply: the real server tells the *room* you left
         by re-sending User records, and says nothing to the leaver. Removing
         the battle here would be wrong - it is still open without us. */
      case "LeaveBattle":
        break;
      case "MatchMakerQueueRequest":
        soon(() => state.push(line("MatchMakerStatus", { JoinedQueues: data.Queues,
          QueueCounts: { "1v1": 6, Teams: 21 }, IngameCounts: { "1v1": 2, Teams: 14 },
          JoinedTime: new Date().toISOString(), UserCount: 100, UserCountDiscord: 12 })));
        break;
      case "AreYouReadyResponse":
        soon(() => state.push(line("AreYouReadyUpdate", { ReadyAccepted: data.Ready,
          LikelyToPlay: true, YourBattleSize: 4, YourBattleReady: 3 })));
        break;
      case "RequestConnectSpring":
        soon(() => state.push(line("ConnectSpring", { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0",
          Ip: "128.0.0.1", Port: 8452, Map: "TartarusV7", ScriptPassword: "sp-9f2c", Mode: 6,
          Title: "running match", IsSpectator: false })));
        break;
      case "InviteToParty":
        // The invitee accepts instantly; both sides hear the same status.
        soon(() => state.push(line("OnPartyStatus", { PartyID: 7,
          UserNames: ["Qrow", data.UserName] })));
        break;
      case "PartyInviteResponse":
        soon(() => state.push(line("OnPartyStatus", {
          PartyID: data.PartyID, UserNames: data.Accepted ? ["Qrow", "hexed"] : [] })));
        break;
      case "LeaveParty":
        soon(() => state.push(line("OnPartyStatus", { PartyID: data.PartyID, UserNames: [] })));
        break;
      case "KickFromBattle":
        soon(() => state.push(line("JoinBattleSuccess", { BattleID: data.BattleID,
          Options: { commshare: "1", multiplier: "2.0" },
          Players: [{ Name: "Qrow", AllyNumber: 0 }],
          Bots: [{ Name: "CAI-Brutal", AllyNumber: 1, AiLib: "CAI", Owner: "hexed" }] })));
        break;
      case "UpdateBotStatus":
        soon(() => state.push(line("UpdateBotStatus", { Name: data.Name || "CAI-2",
          AiLib: data.AiLib, AllyNumber: data.AllyNumber, Owner: data.Owner })));
        break;
      case "UserProfile":
        soon(() => state.push(line("UserProfile", { Name: data.Name, Level: 33, Rank: 3,
          EffectiveElo: 1790, EffectiveMmElo: 1701, EffectivePwElo: 1400, Kudos: 0,
          Badges: ["veteran"] })));
        break;
      default:
        break;
    }
  }

  /* Tauri's own `unlisten` goes through this object rather than an invoke, so
     without it every teardown throws. */
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, eventId) => { handlers.delete(eventId); },
  };

  window.__TAURI_INTERNALS__ = {
    // The real one hands back an id and calls window[`_${id}`]; keeping the
    // function itself is equivalent and saves the indirection.
    transformCallback: cb => cb,
    async invoke(cmd, args) {
      switch (cmd) {
        case "plugin:event|listen": {
          const id = nextId++;
          handlers.set(id, { event: args.event, handler: args.handler });
          return id;
        }
        case "plugin:event|unlisten":
          handlers.delete(args.eventId);
          return;
        case "zks_connect":
          soon(() => {
            emit("zks://status", { kind: "connected" });
            state.push(line("Welcome", { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0",
              UserCount: 100, Version: "1.0", UserCountLimited: false }));
          });
          return;
        case "zks_send":
          state.sent.push(args.line);
          if (state.onSend) state.onSend(args.line);
          respond(args.line);
          return;
        case "zks_password_hash":
          return "aGFzaA==";
        /* Zero-K's featured custom modes. Three shapes on purpose, because
           that is what the live service returns: one that names a game, one
           that names a map and runs on stock Zero-K, and one that is nothing
           but a modoption. */
        case "zks_game_modes":
          return [
            { shortName: "zkarena", displayName: "Arena Mod",
              game: "Arena Mod v1.0.10", options: { terrarestoreonly: "1" } },
            { shortName: "zeroWars", displayName: "Zero Wars",
              map: "ZeroWars v2.1.9", options: {} },
            { shortName: "techk", displayName: "Tech-K", options: { techk: "1" } },
          ];
        case "zks_find_maps":
          return [{ name: "Comet Catcher Redux v3.1", support: "MatchMaker" }];
        case "zks_disconnect":
          return;
        case "zks_locate_install":
          state.installRoot = args.root;
          // An override that is not a Zero-K folder fails the way Rust's does.
          if (args.root && !/zero-k/i.test(args.root)) {
            throw new Error(args.root + " is not a Zero-K installation - no engine/ with games, maps or pool beside it.");
          }
          return {
            root: args.root || "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K",
            source: args.root ? "settings" : "Steam",
          };
        /* What a launch would need. Nothing was stubbed here before, so the
           preflight rejected and prefetchForBattle swallowed it - which is how
           "we never tell the room we have the map" went unnoticed. Default is
           a complete install; `state.missing` makes it incomplete. */
        /* The site's map catalogue. One call answers for every map, which is
           what makes a link to a map's own page affordable. */
        /* The app launcher. The catalogue is compiled into the Rust binary,
           so this stub stands in for that constant. Springen is deliberately
           unavailable here, because that is its real state until it publishes
           a release - and it is the state most likely to look broken. */
        case "zka_catalogue":
          return [
            { id: "sprofiler", name: "Sprofiler", kind: "executable",
              summary: "Check whether Zero-K will run well on this machine",
              description: "Reads what the engine saw the last time it ran.",
              source: "github.com/QrowZK/Sprofiler",
              unavailable: "No build published yet." },
            { id: "splaunch", name: "Splaunch", kind: "executable",
              summary: "Build Zero-K scenarios and play them",
              description: "Place units, set objectives, press Test.",
              source: "github.com/QrowZK/Splaunch",
              unavailable: "No build published yet." },
            { id: "springen", name: "Springen", kind: "executable",
              summary: "Node-graph map generator for Spring and Zero-K",
              description: "Authors terrain and writes a finished .sd7.",
              source: "github.com/QrowZK/Springen", version: "0.1.1",
              download: "https://github.com/QrowZK/Springen/releases/download/dev/Springen_0.1.1_x64.zip",
              sha256: "99e5b950937719056052aff1258ca28054733d3a37fa5a2386ecf174a05335ea" },
          ];
        case "zka_status":
          return [
            { id: "sprofiler", installed: false },
            { id: "splaunch", installed: false },
            { id: "springen", installed: state.installed === "springen" },
          ];
        case "zka_install":
          state.sent.push("install " + args.id);
          state.installed = args.id;
          return null;
        case "zka_launch":
          state.sent.push("launched " + args.id);
          return null;

        /* The profiler. A machine with a real graphics card, so the happy path
           is what the screenshot shows. */
        case "zks_map_catalogue":
          return [
            { name: "TartarusV7", resourceId: 4242 },
            { name: "Comet_Catcher_Redux", resourceId: 55646 },
          ];

        /* A player's zero-k.info page. `null` is "no such account" - the site
           says so in forty bytes - and is an answer, not a failure. */
        case "zkw_profile": {
          /* "Gholam" is nobody the lobby knows - an account that exists on the
             site but is not connected, which is the case the search exists for.
             Anything else is a miss, so the not-found path is reachable too. */
          if (args.who !== "hexed" && args.who !== "Gholam") return null;
          return {
            accountId: 4242, name: args.who, clan: "ZKF", level: 33,
            rank: "Red Dwarf", rankIcon: "3_3",
            badges: ["Silver donator"],
            awards: [{ key: "pwn", name: "Complete Annihilation", count: 812 }],
            battlesPlayed: 1904, battlesWatched: 233,
            firstLogin: "6 years ago", lastLogin: "20 minutes ago",
            forumKarma: 12, recent: [],
          };
        }
        case "zkw_ratings":
          return [
            { date: "2026-08-01", elo: 1750 },
            { date: "2026-08-10", elo: 1790 },
          ];

        case "zks_content_preflight":
          return {
            install: { root: state.installRoot || "C:\Zero-K", source: "Steam" },
            engineOk: true,
            downloader: "pr-downloader.exe",
            items: state.missing || [],
            writable: true,
          };

        /* The real one queues a job and returns its id; the supervisor then
           reports progress and a finish. Here the test drives those. */
        case "zks_content_fetch": {
          const id = "job-" + (++jobCounter);
          state.lastJobId = id;
          state.lastFetch = { installRoot: args.installRoot, items: args.items };
          state.emitContent({ kind: "queued", id, items: args.items || [] });
          return id;
        }

        case "zks_content_cancel":
          state.emitContent({ kind: "finished", id: args.id, outcome: "killed" });
          return null;

        /* Zero-K installed by Shiro rather than found. The real ones create
           a directory and fetch a 45 MB engine; here the test drives the
           state so the screen can be checked without downloading anything. */
        case "zks_managed_root":
          return state.managed.root;

        case "zks_managed_state":
          return { ...state.managed, engineInstalled: state.managed.engineInstalled };

        case "zks_managed_prepare":
          state.managed.prepared = true;
          return state.managed.root;

        case "zks_managed_install_engine":
          state.engineAsked = args.version;
          emit("zks://engine", { kind: "progress", received: 22, total: 44 });
          state.managed.prepared = true;
          state.managed.engineInstalled = true;
          return state.managed.root + "\\engine";

        case "zks_managed_remove":
          state.managed.prepared = false;
          state.managed.engineInstalled = false;
          state.managed.archives = 0;
          return null;

        case "zks_launch_preview": {
          const root = state.installRoot
            || "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K";
          if (!args.engine) throw new Error("Zero-K is installed but engine  is not.");
          const exe = root + "\\engine\\win64\\" + args.engine + "\\spring.exe";
          return {
            install: { root, source: state.installRoot ? "settings" : "Steam" },
            exe,
            cwd: root + "\\engine\\win64\\" + args.engine,
            args: ["C:\\Users\\you\\AppData\\Local\\Temp\\shiro\\connect_script.txt"],
            env: [["SPRING_DATADIR", root], ["SPRING_WRITEDIR", root]],
            scriptPath: "C:\\Users\\you\\AppData\\Local\\Temp\\shiro\\connect_script.txt",
            script: "[GAME]\n{\nHostIP=0.0.0.0;\nHostPort=0;\nIsHost=0;\nMyPlayerName="
              + args.player + ";\nMyPasswd=preview;\n}\n",
          };
        }
        case "zks_launch_spring":
          state.launched = args.req;
          soon(() => emit("zks://game", { kind: "launched", pid: 4242 }));
          return 4242;
        default:
          throw new Error("fake-server: unstubbed command " + cmd);
      }
    },
  };
})();
