/**
 * Session lifecycle: wire the relay to the store, run the login handshake,
 * batch the inbound flood.
 */
import {
  connect, disconnect, onLine, onStatus, passwordHash, sendLine, LIVE,
} from "./connection";
import { parseLine, serialize } from "../protocol/wire";
import type { CommandName, Message, MessageMap } from "../protocol/registry";
import { useLobby } from "../store/lobby";
import { describeRegisterFailure } from "../store/adapters";
import { useRoom } from "../store/room";
import { fanout } from "../store/slices";

export const LOBBY_VERSION = "NewLobby/Shiro 0.1.0";

/**
 * Reconnect backoff, in milliseconds, then every 30s.
 *
 * Deliberately not aggressive. A reconnect loop hammering a production game
 * server is how a new client gets its IP banned, and the server's own
 * BannedTooManyConnectionAttempts exists for exactly that.
 */
const BACKOFF = [2000, 4000, 8000, 16000, 30000];

let unlisten: Array<() => void> = [];
let queue: Message[] = [];
let frame = 0;
let timer = 0;

/** Everything needed to re-establish the session without asking again. */
let session: { creds: Credentials; hash: string; host: string; port: number } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

/** Coalesce inbound messages into one store write per animation frame. */
/* Batching is on the frame, with a timer behind it.

   A lobby's normal state during a match is minimised, and WebView2 and
   WebKitGTK both suspend requestAnimationFrame for a hidden window - so a
   frame-only batcher stops processing the protocol at exactly the moment the
   game is running. Ready checks expire unanswered, ConnectSpring is not acted
   on, kick notices go unseen, and the queue grows until the window is looked
   at again.

   Login survived that, which is what kept it hidden: the Welcome -> Login
   reply is sent straight from the line handler, above, and never waits for a
   batch.

   Whichever of the two fires first flushes and cancels the other, so a visible
   window still batches per frame and pays nothing for the fallback. */
const FLUSH_MS = 100;

function flush() {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (timer) { clearTimeout(timer); timer = 0; }
  const batch = queue;
  queue = [];
  if (!batch.length) return;
  useLobby.getState().applyBatch(batch);
  fanout(batch);
}

function enqueue(m: Message) {
  queue.push(m);
  if (frame || timer) return;
  frame = requestAnimationFrame(flush);
  timer = setTimeout(flush, FLUSH_MS) as unknown as number;
}

/**
 * Send any protocol command. Typed against the generated registry, so a wrong
 * field name or a missing required field is a compile error.
 *
 *   send("JoinChannel", { ChannelName: "zk" });
 */
export function send<K extends CommandName>(cmd: K, data: MessageMap[K]): Promise<void> {
  return sendLine(serialize(cmd, data));
}

export interface Credentials {
  name: string;
  password: string;
}

function cancelRetry(): void {
  if (retry) { clearTimeout(retry); retry = null; }
}

/**
 * Re-establish a session that dropped underneath us.
 *
 * Only ever called after a login the server accepted: a *rejected* login is
 * never retried, because LoginChecker.LogIpFailure() fires on a bad name and
 * repeated failures earn BannedTooManyConnectionAttempts.
 */
function scheduleReconnect(): void {
  if (!session || retry) return;
  const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
  attempt += 1;
  useLobby.getState().setReconnect(attempt);
  retry = setTimeout(() => {
    retry = null;
    if (!session) return;
    reconnectState();
    void connect(session.host, session.port).catch(() => scheduleReconnect());
  }, delay);
}

/**
 * Drop everything the server is about to re-send. A reconnect replays the full
 * directory, and we were not in a battle while disconnected.
 */
function reconnectState(): void {
  useLobby.getState().resetDirectory();
  useRoom.getState().clear();
}

/** Retry immediately - the "Retry now" affordance in the status bar. */
export function reconnectNow(): void {
  if (!session) return;
  cancelRetry();
  attempt = 0;
  useLobby.getState().setReconnect(0);
  reconnectState();
  void connect(session.host, session.port).catch(() => scheduleReconnect());
}

/**
 * Connect and log in. Resolves once the server has accepted or rejected the
 * login; the caller reads the outcome from the store's connection state.
 *
 * Never auto-retries a rejected login: LoginChecker.LogIpFailure() fires on a
 * bad name and repeated failures earn BannedTooManyConnectionAttempts.
 */
export async function login(
  creds: Credentials,
  host: string = LIVE.host,
  port: number = LIVE.port,
): Promise<void> {
  await teardown();

  const store = useLobby.getState();
  store.reset();

  const hash = await passwordHash(creds.password);
  session = { creds, hash, host, port };
  attempt = 0;

  const settled = new Promise<void>(resolve => {
    const stop = useLobby.subscribe(s => {
      const k = s.connection.kind;
      if (k === "online" || k === "rejected" || k === "disconnected") {
        stop();
        resolve();
      }
    });
  });

  unlisten.push(await onStatus(s => {
    useLobby.getState().applyRelayStatus(s);
    // A drop after a good login is a transport problem, not a credentials
    // problem, so it is ours to fix without bothering anyone.
    if (s.kind === "disconnected") scheduleReconnect();
    if (s.kind === "connected") { attempt = 0; useLobby.getState().setReconnect(0); }
  }));
  unlisten.push(await onLine(line => {
    const m = parseLine(line);
    if (!m) return;

    // An admin threw us off. Retrying would be pointless and rude, so the
    // session is dropped before the disconnect that follows can schedule one.
    if (m.cmd === "KickFromServer") {
      session = null;
      cancelRetry();
    }

    /* A refused login, dropped for the same reason and more urgently.
       The server closes the connection after refusing, which reaches
       `onStatus` as a plain disconnect - and `scheduleReconnect` only asks
       whether there is a session, not whether the credentials were any good.
       So the reconnect fired, `Welcome` arrived, and the handler below sent
       the same bad hash again, on a backoff, indefinitely.

       That is the LoginChecker.LogIpFailure spiral this file's comments
       promise never to enter: a mistyped password could earn the player's IP
       a server-side ban while they sat looking at the login screen. */
    if (m.cmd === "LoginResponse" && (m.data as { ResultCode?: number }).ResultCode !== 0) {
      session = null;
      cancelRetry();
    }

    // The server sends Welcome unprompted on connect; that is our cue to log in.
    if (m.cmd === "Welcome") {
      useLobby.getState().setConnection({ kind: "loggingIn" });
      void sendLine(serialize("Login", {
        Name: creds.name,
        PasswordHash: hash,
        UserID: 0,
        InstallID: "",
        ClientType: 1,
        LobbyVersion: LOBBY_VERSION,
      } as never));
    }
    enqueue(m);
  }));

  await connect(host, port);
  await settled;
}

/**
 * Create an account, then log into it.
 *
 * Registration runs on its own connection with its own listener: the normal
 * session sends `Login` the moment `Welcome` arrives, which is exactly wrong
 * for an account that does not exist yet.
 *
 * Rejections are final. The server counts failed attempts by IP and bans repeat
 * offenders, so nothing here retries.
 */
export async function register(
  creds: Credentials,
  email?: string,
  host: string = LIVE.host,
  port: number = LIVE.port,
): Promise<void> {
  await teardown();
  const hash = await passwordHash(creds.password);

  const outcome = new Promise<void>((resolve, reject) => {
    let stop: (() => void) | undefined;
    const finish = (err?: Error) => {
      stop?.();
      void disconnect().catch(() => {});
      if (err) reject(err); else resolve();
    };

    void onLine(line => {
      const m = parseLine(line);
      if (!m) return;
      if (m.cmd === "Welcome") {
        void sendLine(serialize("Register", {
          Name: creds.name,
          PasswordHash: hash,
          Email: email,
          UserID: 0,
          InstallID: "",
        } as never));
      }
      if (m.cmd === "RegisterResponse") {
        const d = m.data as { ResultCode: number; BanReason?: string };
        finish(d.ResultCode === 0
          ? undefined
          : new Error(describeRegisterFailure(d.ResultCode, d.BanReason)));
      }
    }).then(fn => { stop = fn; });

    void onStatus(s => {
      if (s.kind === "disconnected") finish(new Error(`Lost connection: ${s.reason}`));
    }).then(fn => {
      const inner = stop;
      stop = () => { inner?.(); fn(); };
    });
  });

  await connect(host, port);
  await outcome;
  await login(creds, host, port);
}

export async function teardown(): Promise<void> {
  // Drop the session first: the disconnect this causes must not be retried.
  session = null;
  cancelRetry();
  attempt = 0;
  for (const fn of unlisten) fn();
  unlisten = [];
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  queue = [];
  await disconnect().catch(() => {});
}

export function say(text: string, place: number, target?: string): Promise<void> {
  return sendLine(serialize("Say", {
    Place: place, Target: target, Text: text, IsEmote: false, Ring: false, AllowRelay: true,
  } as never));
}
