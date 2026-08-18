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

/** Everything needed to re-establish the session without asking again. */
let session: { creds: Credentials; hash: string; host: string; port: number } | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

/** Coalesce inbound messages into one store write per animation frame. */
function enqueue(m: Message) {
  queue.push(m);
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const batch = queue;
    queue = [];
    useLobby.getState().applyBatch(batch);
    fanout(batch);
  });
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
