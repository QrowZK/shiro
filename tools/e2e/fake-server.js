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
  const listeners = new Map();
  const emit = (event, payload) => {
    for (const h of listeners.get(event) || []) h({ event, id: 0, payload });
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
  };
  window.__ZKS = state;

  const line = (cmd, data) => cmd + " " + JSON.stringify(data);
  const soon = fn => setTimeout(fn, 5);

  /** The post-login flood, trimmed to what the screens actually read. */
  function flood() {
    state.push(line("User", { Name: "Qrow", AccountID: 1, Country: "GB", Clan: "ZKF",
      EffectiveElo: 1842.4, EffectiveMmElo: 1766, Level: 41, Rank: 4, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1766 }));
    state.push(line("User", { Name: "hexed", AccountID: 2, Country: "US", Clan: "ZKF",
      EffectiveElo: 1790, EffectiveMmElo: 1701, Level: 33, Rank: 3, IsAdmin: false, IsBot: false,
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1701 }));
    state.push(line("User", { Name: "lorelei", AccountID: 3, Country: "FR",
      EffectiveElo: 1588, EffectiveMmElo: 1550, Level: 19, Rank: 2, IsAdmin: false, IsBot: false,
      AwaySince: "2026-08-18T09:00:00Z",
      BanMute: false, BanVotes: false, BanSpecChat: false, SyncVersion: 1, RawMmElo: 1550 }));
    state.push(line("BattleAdded", { Header: { BattleID: 11, Title: "Teams 8v8 - all welcome",
      Map: "Comet Catcher Redux", Founder: "hexed", PlayerCount: 9, MaxPlayers: 16,
      SpectatorCount: 2, Mode: 6, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 12, Title: "private - do not join",
      Map: "Barren v3", Founder: "lorelei", PlayerCount: 4, MaxPlayers: 8, Password: "x",
      Mode: 4, IsRunning: false } }));
    state.push(line("BattleAdded", { Header: { BattleID: 13, Title: "running match",
      Map: "TartarusV7", Founder: "Qrow", PlayerCount: 12, MaxPlayers: 12, Mode: 6,
      IsRunning: true, RunningSince: "2026-08-18T09:30:00Z" } }));
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
      case "Login":
        soon(() => {
          state.push(line("LoginResponse", { ResultCode: 0, Name: data.Name, SessionToken: "t" }));
          flood();
        });
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

  window.__TAURI_INTERNALS__ = {
    // The real one hands back an id and calls window[`_${id}`]; keeping the
    // function itself is equivalent and saves the indirection.
    transformCallback: cb => cb,
    async invoke(cmd, args) {
      switch (cmd) {
        case "plugin:event|listen": {
          const set = listeners.get(args.event) || new Set();
          set.add(args.handler);
          listeners.set(args.event, set);
          return 1;
        }
        case "plugin:event|unlisten":
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
        case "zks_disconnect":
          return;
        case "zks_locate_install":
          return { root: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Zero-K", source: "Steam" };
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
