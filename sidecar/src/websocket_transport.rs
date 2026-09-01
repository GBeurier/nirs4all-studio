//! Bounded RFC 6455 transport for Studio's frozen legacy WebSocket surface.
//!
//! The renderer-facing protocol intentionally remains the four-key Studio V1
//! envelope.  Native ordering metadata stays inside the job registry and is
//! never leaked on these sockets.

use std::{
    collections::{BTreeMap, BTreeSet},
    io::{ErrorKind, Write},
    net::TcpStream,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};
use tungstenite::{
    handshake::derive_accept_key,
    protocol::{Message, Role, WebSocket, WebSocketConfig},
    Error as WebSocketError,
};

/// Maximum accepted UTF-8 client message size.
pub const MAX_CLIENT_MESSAGE_BYTES: usize = 16 * 1024;
/// Maximum accepted frame size, including control-frame and framing overhead.
pub const MAX_FRAME_BYTES: usize = 32 * 1024;
/// Maximum queued job events per slow connection before it is dropped.
pub const MAX_PENDING_MESSAGES: usize = 64;
/// Short polling interval used to multiplex socket input and registry output.
pub const SOCKET_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// One of the three exact frozen Studio V1 WebSocket endpoints.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyWebSocketEndpoint {
    Main { client_id: Option<String> },
    Job { job_id: String },
    Training { job_id: String },
}

impl LegacyWebSocketEndpoint {
    /// Parse an exact legacy endpoint and its only supported query parameter.
    #[must_use]
    pub fn parse(path: &str, query: Option<&str>) -> Option<Self> {
        if path == "/ws" {
            return parse_client_id(query)
                .ok()
                .map(|client_id| Self::Main { client_id });
        }
        if query.is_some() {
            return None;
        }
        if let Some(job_id) = path.strip_prefix("/ws/job/") {
            return valid_job_id(job_id).then(|| Self::Job {
                job_id: job_id.into(),
            });
        }
        if let Some(job_id) = path.strip_prefix("/ws/training/") {
            return valid_job_id(job_id).then(|| Self::Training {
                job_id: job_id.into(),
            });
        }
        None
    }

    fn client_id(&self) -> Option<String> {
        match self {
            Self::Main { client_id } => client_id.clone(),
            Self::Job { job_id } => Some(format!("job-{job_id}")),
            Self::Training { job_id } => Some(format!("training-{job_id}")),
        }
    }

    fn automatic_channel(&self) -> Option<String> {
        match self {
            Self::Main { .. } => None,
            Self::Job { job_id } | Self::Training { job_id } => Some(format!("job:{job_id}")),
        }
    }
}

#[derive(Clone, Debug)]
struct ConnectionEntry {
    outbound: SyncSender<String>,
    channels: BTreeSet<String>,
}

#[derive(Debug, Default)]
struct ConnectionState {
    connections: BTreeMap<u64, ConnectionEntry>,
}

/// Thread-safe connection registry used by HTTP accept threads and job workers.
#[derive(Debug, Default)]
pub struct WebSocketConnectionManager {
    next_id: AtomicU64,
    state: Mutex<ConnectionState>,
}

impl WebSocketConnectionManager {
    /// Construct an empty manager.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn register(&self, automatic_channel: Option<String>) -> RegisteredConnection {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (outbound, receiver) = mpsc::sync_channel(MAX_PENDING_MESSAGES);
        let channels = automatic_channel.into_iter().collect();
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .connections
            .insert(id, ConnectionEntry { outbound, channels });
        RegisteredConnection { id, receiver }
    }

    fn disconnect(&self, id: u64) {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .connections
            .remove(&id);
    }

    /// Number of currently registered native sockets.
    #[must_use]
    pub fn connection_count(&self) -> usize {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .connections
            .len()
    }

    /// Publish one exact legacy envelope to subscribers of its channel.
    ///
    /// Failed receivers are pruned immediately. No replay is retained.
    ///
    /// # Errors
    ///
    /// Returns an error without publishing if the public envelope is not the
    /// exact bounded four-key Studio V1 shape.
    pub fn broadcast_legacy(&self, envelope: &Value) -> Result<usize, LegacyEnvelopeError> {
        validate_legacy_envelope(envelope)?;
        let channel = envelope["channel"]
            .as_str()
            .ok_or(LegacyEnvelopeError::InvalidChannel)?;
        let encoded = serde_json::to_string(envelope)
            .map_err(|_| LegacyEnvelopeError::SerializationFailed)?;
        if encoded.len() > MAX_CLIENT_MESSAGE_BYTES {
            return Err(LegacyEnvelopeError::TooLarge);
        }

        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut delivered = 0;
        state.connections.retain(|_, connection| {
            if !connection.channels.contains(channel) {
                return true;
            }
            if connection.outbound.try_send(encoded.clone()).is_ok() {
                delivered += 1;
                true
            } else {
                false
            }
        });
        drop(state);
        Ok(delivered)
    }
}

#[derive(Debug)]
struct RegisteredConnection {
    id: u64,
    receiver: Receiver<String>,
}

/// Rejection reason for a would-be renderer-facing event.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LegacyEnvelopeError {
    NotObject,
    WrongKeys,
    InvalidType,
    InvalidChannel,
    InvalidData,
    InvalidTimestamp,
    TooLarge,
    SerializationFailed,
}

/// Perform the already-validated HTTP upgrade and own the socket until close.
///
/// # Errors
///
/// Returns an I/O error when the handshake or socket loop cannot be completed.
pub fn handle_websocket_connection(
    mut stream: TcpStream,
    websocket_key: &str,
    endpoint: &LegacyWebSocketEndpoint,
    manager: &WebSocketConnectionManager,
) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        derive_accept_key(websocket_key.as_bytes())
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    stream.set_read_timeout(Some(SOCKET_POLL_INTERVAL))?;

    let automatic_channel = endpoint.automatic_channel();
    let registration = manager.register(automatic_channel.clone());
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_CLIENT_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES))
        .accept_unmasked_frames(false);
    let mut socket = WebSocket::from_raw_socket(stream, Role::Server, Some(config));

    let result = (|| {
        let connected = legacy_message(
            "connected",
            "system",
            json!({
                "client_id": endpoint.client_id(),
                "message": "Connected to nirs4all WebSocket server"
            }),
        );
        send_json(&mut socket, &connected)?;
        if let Some(channel) = automatic_channel {
            send_json(
                &mut socket,
                &legacy_message("subscribed", &channel, json!({"channel": channel})),
            )?;
        }
        run_socket_loop(&mut socket, &registration.receiver)
    })();
    manager.disconnect(registration.id);
    result
}

fn run_socket_loop(
    socket: &mut WebSocket<TcpStream>,
    outbound: &Receiver<String>,
) -> std::io::Result<()> {
    loop {
        loop {
            match outbound.try_recv() {
                Ok(message) => send_text(socket, message)?,
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return Ok(()),
            }
        }

        match socket.read() {
            Ok(Message::Text(text)) => {
                let response = handle_client_text(text.as_str());
                send_json(socket, &response)?;
            }
            Ok(Message::Ping(payload)) => socket
                .send(Message::Pong(payload))
                .map_err(websocket_io_error)?,
            Ok(Message::Close(frame)) => {
                let _ = socket.close(frame);
                return Ok(());
            }
            Ok(Message::Binary(_) | Message::Pong(_) | Message::Frame(_)) => {}
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => {}
            Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => return Ok(()),
            Err(error) => return Err(websocket_io_error(error)),
        }
    }
}

fn handle_client_text(text: &str) -> Value {
    if text.len() > MAX_CLIENT_MESSAGE_BYTES {
        return invalid_message("message exceeds the configured limit");
    }
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return invalid_message("invalid JSON");
    };
    let Some(object) = value.as_object() else {
        return invalid_message("message must be an object");
    };
    match object.get("type").and_then(Value::as_str) {
        Some("ping") => legacy_message("pong", "system", json!({"timestamp": rfc3339_now()})),
        Some(message_type) => {
            invalid_message(&format!("'{message_type}' is not a valid MessageType"))
        }
        None => invalid_message("message type is required"),
    }
}

fn invalid_message(reason: &str) -> Value {
    legacy_message(
        "error",
        "system",
        json!({"error": format!("Invalid message format: {reason}")}),
    )
}

fn legacy_message(event_type: &str, channel: &str, data: Value) -> Value {
    Value::Object(Map::from_iter([
        ("type".into(), Value::String(event_type.into())),
        ("channel".into(), Value::String(channel.into())),
        ("data".into(), data),
        ("timestamp".into(), Value::String(rfc3339_now())),
    ]))
}

fn send_json(socket: &mut WebSocket<TcpStream>, value: &Value) -> std::io::Result<()> {
    let encoded = serde_json::to_string(value).map_err(std::io::Error::other)?;
    send_text(socket, encoded)
}

fn send_text(socket: &mut WebSocket<TcpStream>, encoded: String) -> std::io::Result<()> {
    socket
        .send(Message::Text(encoded.into()))
        .map_err(websocket_io_error)
}

fn websocket_io_error(error: WebSocketError) -> std::io::Error {
    match error {
        WebSocketError::Io(error) => error,
        other => std::io::Error::other(other),
    }
}

fn validate_legacy_envelope(envelope: &Value) -> Result<(), LegacyEnvelopeError> {
    let object = envelope.as_object().ok_or(LegacyEnvelopeError::NotObject)?;
    let keys: BTreeSet<&str> = object.keys().map(String::as_str).collect();
    if keys != BTreeSet::from(["channel", "data", "timestamp", "type"]) {
        return Err(LegacyEnvelopeError::WrongKeys);
    }
    let event_type = object["type"]
        .as_str()
        .ok_or(LegacyEnvelopeError::InvalidType)?;
    if !matches!(
        event_type,
        "job_started" | "job_progress" | "job_metrics" | "job_completed" | "job_failed"
    ) {
        return Err(LegacyEnvelopeError::InvalidType);
    }
    let channel = object["channel"]
        .as_str()
        .ok_or(LegacyEnvelopeError::InvalidChannel)?;
    if !channel.starts_with("job:") || !valid_job_id(&channel[4..]) {
        return Err(LegacyEnvelopeError::InvalidChannel);
    }
    if !object["data"].is_object() {
        return Err(LegacyEnvelopeError::InvalidData);
    }
    let timestamp = object["timestamp"]
        .as_str()
        .ok_or(LegacyEnvelopeError::InvalidTimestamp)?;
    if !looks_like_rfc3339(timestamp) {
        return Err(LegacyEnvelopeError::InvalidTimestamp);
    }
    Ok(())
}

fn parse_client_id(query: Option<&str>) -> Result<Option<String>, ()> {
    let Some(query) = query else {
        return Ok(None);
    };
    let mut values = url::form_urlencoded::parse(query.as_bytes());
    let (key, value) = values.next().ok_or(())?;
    if key != "client_id" || value.is_empty() || value.len() > 256 || values.next().is_some() {
        return Err(());
    }
    Ok(Some(value.into_owned()))
}

fn valid_job_id(job_id: &str) -> bool {
    !job_id.is_empty()
        && job_id.len() <= 256
        && job_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn looks_like_rfc3339(value: &str) -> bool {
    value.len() >= 20
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && value.as_bytes().get(13) == Some(&b':')
        && value.as_bytes().get(16) == Some(&b':')
        && value.ends_with('Z')
}

fn rfc3339_now() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = i64::try_from(duration.as_secs()).unwrap_or(i64::MAX);
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{:03}Z",
        duration.subsec_millis()
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read as _, net::TcpListener, sync::Arc, thread};

    #[test]
    fn exact_endpoint_parser_is_bounded_and_fail_closed() {
        assert_eq!(
            LegacyWebSocketEndpoint::parse("/ws", None),
            Some(LegacyWebSocketEndpoint::Main { client_id: None })
        );
        assert_eq!(
            LegacyWebSocketEndpoint::parse("/ws", Some("client_id=renderer%201")),
            Some(LegacyWebSocketEndpoint::Main {
                client_id: Some("renderer 1".into())
            })
        );
        assert_eq!(
            LegacyWebSocketEndpoint::parse("/ws/job/run-1", None),
            Some(LegacyWebSocketEndpoint::Job {
                job_id: "run-1".into()
            })
        );
        assert!(LegacyWebSocketEndpoint::parse("/ws/job/../secret", None).is_none());
        assert!(LegacyWebSocketEndpoint::parse("/ws", Some("unknown=1")).is_none());
        assert!(LegacyWebSocketEndpoint::parse("/ws/job/run-1", Some("x=1")).is_none());
    }

    #[test]
    fn frozen_client_protocol_accepts_only_ping() {
        let pong = handle_client_text(r#"{"type":"ping","channel":"system","data":{}}"#);
        assert_eq!(pong["type"], "pong");
        assert_eq!(pong["channel"], "system");

        let refused = handle_client_text(
            r#"{"type":"subscribe","channel":"system","data":{"channel":"job:1"}}"#,
        );
        assert_eq!(refused["type"], "error");
        assert_eq!(
            refused["data"]["error"],
            "Invalid message format: 'subscribe' is not a valid MessageType"
        );
    }

    #[test]
    fn manager_delivers_only_to_the_exact_automatic_channel() {
        let manager = WebSocketConnectionManager::new();
        let job_one = manager.register(Some("job:one".into()));
        let job_two = manager.register(Some("job:two".into()));
        let general = manager.register(None);
        let envelope = json!({
            "type": "job_progress",
            "channel": "job:one",
            "data": {"job_id": "one", "progress": 50},
            "timestamp": "2026-09-01T12:00:00Z"
        });

        assert_eq!(manager.broadcast_legacy(&envelope), Ok(1));
        assert!(job_one.receiver.try_recv().is_ok());
        assert!(job_two.receiver.try_recv().is_err());
        assert!(general.receiver.try_recv().is_err());
    }

    #[test]
    fn public_broadcast_rejects_internal_or_unreachable_envelopes() {
        let manager = WebSocketConnectionManager::new();
        let internal = json!({
            "protocol_version": "studio-sidecar-r1",
            "type": "job_started",
            "channel": "job:one",
            "sequence": 1,
            "data": {},
            "timestamp": "2026-09-01T12:00:00Z"
        });
        assert_eq!(
            manager.broadcast_legacy(&internal),
            Err(LegacyEnvelopeError::WrongKeys)
        );
        let cancelled = json!({
            "type": "job_cancelled",
            "channel": "job:one",
            "data": {},
            "timestamp": "2026-09-01T12:00:00Z"
        });
        assert_eq!(
            manager.broadcast_legacy(&cancelled),
            Err(LegacyEnvelopeError::InvalidType)
        );
    }

    #[test]
    fn slow_connection_is_dropped_at_the_exact_queue_bound() {
        let manager = WebSocketConnectionManager::new();
        let _slow = manager.register(Some("job:one".into()));
        let envelope = json!({
            "type": "job_progress",
            "channel": "job:one",
            "data": {"job_id": "one", "progress": 50},
            "timestamp": "2026-09-01T12:00:00Z"
        });
        for _ in 0..MAX_PENDING_MESSAGES {
            assert_eq!(manager.broadcast_legacy(&envelope), Ok(1));
        }
        assert_eq!(manager.connection_count(), 1);
        assert_eq!(manager.broadcast_legacy(&envelope), Ok(0));
        assert_eq!(manager.connection_count(), 0);
    }

    #[test]
    fn calendar_conversion_matches_unix_epoch_and_leap_day() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert!(looks_like_rfc3339(&rfc3339_now()));
    }

    #[test]
    fn live_rfc6455_upgrade_emits_frozen_handshake_and_ping_sequence() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let manager = Arc::new(WebSocketConnectionManager::new());
        let server_manager = Arc::clone(&manager);
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0_u8; 1];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap();
            let key = request
                .lines()
                .find_map(|line| line.strip_prefix("Sec-WebSocket-Key: ").map(str::trim))
                .unwrap();
            handle_websocket_connection(
                stream,
                key,
                &LegacyWebSocketEndpoint::Job {
                    job_id: "one".into(),
                },
                &server_manager,
            )
            .unwrap();
        });

        let stream = TcpStream::connect(address).unwrap();
        let (mut client, response) =
            tungstenite::client(format!("ws://{address}/ws/job/one"), stream).unwrap();
        assert_eq!(response.status(), 101);
        let connected = client.read().unwrap().into_text().unwrap();
        let connected: Value = serde_json::from_str(connected.as_str()).unwrap();
        assert_eq!(connected["type"], "connected");
        assert_eq!(connected["channel"], "system");
        assert_eq!(connected["data"]["client_id"], "job-one");
        let subscribed = client.read().unwrap().into_text().unwrap();
        let subscribed: Value = serde_json::from_str(subscribed.as_str()).unwrap();
        assert_eq!(subscribed["type"], "subscribed");
        assert_eq!(subscribed["channel"], "job:one");

        client
            .send(Message::Text(
                r#"{"type":"ping","channel":"system","data":{}}"#.into(),
            ))
            .unwrap();
        let pong = client.read().unwrap().into_text().unwrap();
        let pong: Value = serde_json::from_str(pong.as_str()).unwrap();
        assert_eq!(pong["type"], "pong");
        assert_eq!(pong["channel"], "system");
        client.close(None).unwrap();
        server.join().unwrap();
        assert_eq!(manager.connection_count(), 0);
    }
}
