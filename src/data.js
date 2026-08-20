/* Fake data shaped exactly like the ZkLobbyServer payloads documented in
   docs/DESIGN_HANDOFF.md section 6. Replaced by the real protocol store
   once the Rust TCP relay lands - see docs/ARCHITECTURE.md section 4. */
import { rankColour } from "./net/ranks.ts";

/* Rank tints are derived rather than written into the fixtures below: the live
   path computes them in `userToChip`, and a demo that hard-coded them would
   drift from it the moment either changed. */
function tinted(value) {
  if (Array.isArray(value)) return value.map(tinted);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = tinted(v);
  if (typeof out.elo === "number" && out.eloTint === undefined) {
    out.eloTint = rankColour(out.elo);
  }
  return out;
}

export default tinted({
  welcome: { Engine: "2025.06.21", Game: "Zero-K v1.14.8.0", UserCount: 100 },
  me: { name: "Shadowfury", clan: "ZKF", country: "DE", faction: "machines", level: 41, elo: 1842, mmElo: 1766 },
  battles: [
    { id:1, title:"Teams 8v8 - no noobs", map:"Argent_Strata_1.1", founder:"Shadowfury", players:11, maxPlayers:16, spectators:3, mode:"Teams" },
    { id:2, title:"1v1 ladder", map:"Canis_River_v1.4", founder:"quantum", players:2, maxPlayers:2, spectators:12, mode:"1v1", matchmaker:true },
    { id:3, title:"private - do not join", map:"Rainbow_Comet_v1.25", founder:"ZKF|hexed", players:8, maxPlayers:8, spectators:0, mode:"FFA", locked:true, running:true, runningSince:252 },
    { id:4, title:"newbies welcome, will explain", map:"Hide_and_Seek_2.2.3", founder:"tinman", players:4, maxPlayers:12, spectators:1, mode:"Teams" },
    { id:5, title:"coop vs 4 brutal AI", map:"Skate_Park_v1.00", founder:"lorelei", players:3, maxPlayers:8, spectators:0, mode:"Coop" },
    { id:6, title:"FFA 8 way chaos", map:"Rainbow_Comet_v1.25", founder:"vex", players:6, maxPlayers:8, spectators:2, mode:"FFA" },
    { id:7, title:"clan practice [ZKF] only", map:"Argent_Strata_1.1", founder:"ZKF|nine", players:9, maxPlayers:16, spectators:0, mode:"Teams", locked:true },
    { id:8, title:"1v1 casual anyone", map:"Canis_River_v1.4", founder:"a", players:1, maxPlayers:2, spectators:0, mode:"1v1" },
    { id:9, title:"big teams 16v16 come on", map:"Skate_Park_v1.00", founder:"marrow", players:22, maxPlayers:32, spectators:5, mode:"Teams" },
    { id:10, title:"running - 40 min in", map:"Hide_and_Seek_2.2.3", founder:"pell", players:12, maxPlayers:12, spectators:8, mode:"Teams", running:true, runningSince:2464 }
  ],
  room: {
    id:1, title:"Teams 8v8 - no noobs", map:"Argent_Strata_1.1", founder:"Shadowfury", mode:"Teams",
    options:[
      { key:"noelo", label:"No Elo", value:"1", known:true, desc:"Prevent battle from affecting Elo rankings" },
      { key:"startmetal", label:"Starting metal", value:"1300", known:true },
      { key:"maxunits", label:"Max units", value:"2000", known:true },
      // A key the option table has no entry for - a custom game's, or one the
      // server set itself. Shown as it arrived rather than hidden.
      { key:"commshare", label:"commshare", value:"1", known:false },
    ],
    teams:[
      { ally:0, players:[
        { user:{name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",level:41,elo:1842}, host:true },
        { user:{name:"quantum",clan:"ZKF",country:"PL",faction:"rising",level:12,elo:1503}, party:1 },
        { user:{name:"tinman",country:"GB",faction:"hegemony",level:27,elo:1671}, party:1 },
        { user:{name:"a",country:"JP",faction:"rising",level:3,elo:987,presence:"away"} },
        { user:{name:"CAI-Brutal",bot:true}, sync:"ok" }
      ]},
      { ally:1, players:[
        { user:{name:"hexed",clan:"ZKF",country:"US",faction:"machines",level:33,elo:1790} },
        { user:{name:"lorelei",country:"FR",faction:"hegemony",level:19,elo:1588}, sync:"downloading" },
        { user:{name:"vexatiousmachinist",country:"BR",faction:"rising",level:8,elo:1204}, sync:"missing" },
        { user:{name:"marrow",country:"SE",faction:"machines",level:44,elo:1955} }
      ]}
    ],
    spectators:[
      { user:{name:"pell",country:"NL",presence:"room",level:52,elo:2210} },
      { user:{name:"nine",clan:"ZKF",country:"CA",presence:"room",level:21,elo:1499} },
      { user:{name:"zk-admin",country:"US",presence:"room",admin:true,level:60,elo:2400} }
    ],
    chat:[
      { time:"21:03", user:{name:"quantum",clan:"ZKF",country:"PL"}, text:"map veto?" },
      { time:"21:03", user:{name:"Shadowfury",clan:"ZKF",country:"DE"}, text:"argent is fine, it is balanced enough for 8v8" },
      { time:"21:04", emote:true, user:{name:"hexed"}, text:"rolls a die" },
      { time:"21:04", system:true, text:"lorelei joined the room" },
      { time:"21:05", user:{name:"lorelei",country:"FR"}, text:"downloading the map, one sec" },
      { time:"21:05", ring:true, user:{name:"hexed",clan:"ZKF",country:"US"}, text:"you are up - we need one more on team 2 or this never starts" }
    ]
  },
  channels: [
    { id:"zk", label:"#zk", unread:12 },
    { id:"newbies", label:"#newbies" },
    { id:"main", label:"#main", unread:3 },
    { id:"hexed", label:"hexed", mention:true, dm:true }
  ],
  channelUsers: [
    {name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",presence:"room",level:41,elo:1842},
    {name:"hexed",clan:"ZKF",country:"US",faction:"machines",presence:"online",level:33,elo:1790},
    {name:"quantum",clan:"ZKF",country:"PL",faction:"rising",presence:"room",level:12,elo:1503},
    {name:"marrow",country:"SE",faction:"machines",presence:"ingame",level:44,elo:1955},
    {name:"pell",country:"NL",presence:"ingame",level:52,elo:2210},
    {name:"lorelei",country:"FR",faction:"hegemony",presence:"away",level:19,elo:1588},
    {name:"tinman",country:"GB",faction:"hegemony",presence:"online",level:27,elo:1671},
    {name:"zk-admin",country:"US",admin:true,presence:"online",level:60,elo:2400},
    {name:"a",country:"JP",faction:"rising",presence:"away",level:3,elo:987},
    {name:"vexatiousmachinist",country:"BR",faction:"rising",presence:"online",level:8,elo:1204},
    {name:"nine",clan:"ZKF",country:"CA",presence:"online",level:21,elo:1499},
    {name:"CAI-Brutal",bot:true,presence:"online"}
  ],
  channelChat: [
    { time:"20:51", user:{name:"tinman",country:"GB"}, text:"anyone up for teams" },
    { time:"20:52", user:{name:"nine",clan:"ZKF",country:"CA"}, text:"in 10" },
    { time:"20:55", system:true, text:"marrow is now in game" },
    { time:"20:58", user:{name:"zk-admin",country:"US",admin:true}, text:"server restart at 23:00 UTC, matches in progress will finish" },
    { time:"21:01", emote:true, user:{name:"pell"}, text:"is already queuing" },
    { time:"21:02", user:{name:"hexed",clan:"ZKF",country:"US"}, text:"Shadowfury hosted, room is open - 11/16 and we need people who can actually hold a flank instead of feeding their com in the first five minutes" },
    { time:"21:06", ring:true, user:{name:"quantum",clan:"ZKF",country:"PL"}, text:"Shadowfury get in here" }
  ],
  debrief: {
    result:"Victory", map:"Argent_Strata_1.1", mode:"Teams", duration:"27:14", category:"Team",
    elo:{ change:18, next:1842, rank:"Sergeant", rankup:true, prevRankElo:1750, nextRankElo:1900 },
    xp:{ change:640, next:12480, prevLevelXp:9000, nextLevelXp:16000, levelUp:false, level:41 },
    awards:[
      { name:"Most damage dealt", value:"148,320" },
      { name:"Largest army", value:"96 units" },
      { name:"First blood", value:"2:41" }
    ],
    team:[
      { user:{name:"Shadowfury",clan:"ZKF",country:"DE",faction:"machines",level:41}, elo:1842, change:18, win:true },
      { user:{name:"quantum",clan:"ZKF",country:"PL",faction:"rising",level:12}, elo:1521, change:18, win:true },
      { user:{name:"tinman",country:"GB",faction:"hegemony",level:27}, elo:1689, change:18, win:true },
      { user:{name:"a",country:"JP",faction:"rising",level:3}, elo:1005, change:18, win:true }
    ],
    opponents:[
      { user:{name:"hexed",clan:"ZKF",country:"US",faction:"machines",level:33}, elo:1773, change:-17, win:false },
      { user:{name:"lorelei",country:"FR",faction:"hegemony",level:19}, elo:1571, change:-17, win:false },
      { user:{name:"marrow",country:"SE",faction:"machines",level:44}, elo:1938, change:-17, win:false },
      { user:{name:"vexatiousmachinist",country:"BR",faction:"rising",level:8}, elo:1187, change:-17, win:false }
    ]
  }
});
