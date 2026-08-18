//! Thin TCP relay for the ZkLobbyServer protocol.
//!
//! Deliberately dumb: it owns the socket lifecycle and nothing else. It does not
//! parse messages or hold lobby state - that all lives in TypeScript. See
//! docs/ARCHITECTURE.md section 4 for why.
//!
//! Wire format is `CommandName {json}\n`, UTF-8, newline delimited.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

/// One decoded line from the server, forwarded verbatim.
const LINE_EVENT: &str = "zks://line";
/// Connection lifecycle transitions.
const STATUS_EVENT: &str = "zks://status";

/// The server drops idle connections, so hold it open.
const KEEPALIVE: Duration = Duration::from_secs(30);

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Status {
    Connecting,
    Connected,
    Disconnected { reason: String },
}

struct Conn {
    tx: mpsc::UnboundedSender<String>,
    tasks: Vec<JoinHandle<()>>,
}

impl Conn {
    fn shutdown(self) {
        // Aborting the reader drops its half of the socket, which closes it.
        for t in self.tasks {
            t.abort();
        }
        drop(self.tx);
    }
}

#[derive(Default)]
pub struct Relay {
    conn: Arc<Mutex<Option<Conn>>>,
}

#[tauri::command]
pub async fn zks_connect(
    app: AppHandle,
    relay: State<'_, Relay>,
    host: String,
    port: u16,
) -> Result<(), String> {
    // Never leave a previous socket running underneath a new one.
    if let Some(prev) = relay.conn.lock().await.take() {
        prev.shutdown();
    }

    app.emit(STATUS_EVENT, Status::Connecting).ok();

    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("connect {host}:{port} failed: {e}"))?;
    stream.set_nodelay(true).ok();

    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if write_half.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    let ka_tx = tx.clone();
    let keepalive = tokio::spawn(async move {
        let mut tick = tokio::time::interval(KEEPALIVE);
        tick.tick().await; // interval fires immediately; skip that one
        loop {
            tick.tick().await;
            if ka_tx.send("Ping {}\n".to_string()).is_err() {
                break;
            }
        }
    });

    let slot = relay.conn.clone();
    let reader_app = app.clone();
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(read_half).lines();
        let reason = loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    reader_app.emit(LINE_EVENT, line).ok();
                }
                Ok(None) => break "closed by server".to_string(),
                Err(e) => break format!("read error: {e}"),
            }
        };
        // Clear the slot so the UI cannot keep writing into a dead socket.
        *slot.lock().await = None;
        reader_app
            .emit(STATUS_EVENT, Status::Disconnected { reason })
            .ok();
    });

    *relay.conn.lock().await = Some(Conn {
        tx,
        tasks: vec![reader, writer, keepalive],
    });

    app.emit(STATUS_EVENT, Status::Connected).ok();
    Ok(())
}

#[tauri::command]
pub async fn zks_send(relay: State<'_, Relay>, line: String) -> Result<(), String> {
    let guard = relay.conn.lock().await;
    let conn = guard.as_ref().ok_or("not connected")?;
    let mut line = line;
    if !line.ends_with('\n') {
        line.push('\n');
    }
    conn.tx.send(line).map_err(|_| "writer closed".to_string())
}

#[tauri::command]
pub async fn zks_disconnect(relay: State<'_, Relay>) -> Result<(), String> {
    if let Some(conn) = relay.conn.lock().await.take() {
        conn.shutdown();
    }
    Ok(())
}

/// `Login.PasswordHash` is base64 of the RAW MD5 digest bytes, not of the hex
/// string. Verified against the live server - see docs/ARCHITECTURE.md section 5.
#[tauri::command]
pub fn zks_password_hash(password: String) -> String {
    let digest = md5::compute(password.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_hash_is_base64_of_raw_digest() {
        // Known-good vector: md5("") = d41d8cd98f00b204e9800998ecf8427e
        // raw bytes base64 -> 1B2M2Y8AsgTpgAmY7PhCfg==
        assert_eq!(zks_password_hash(String::new()), "1B2M2Y8AsgTpgAmY7PhCfg==");
    }
}
