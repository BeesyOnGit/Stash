//! Phone ↔ computer sync, the computer's side: the server the phone connects
//! to over the local network (HTTP + one WebSocket, no internet), announced
//! over mDNS as `_stash._tcp`, with pairing, request signing and encryption.
//!
//! The data itself is merged by the TypeScript side (src/core/sync): each
//! request reaches it as a `sync-request` event and it answers with
//! `sync_reply`. Files are streamed from and to disk here.
//!
//! The protocol is described in src/core/sync/core/protocol.ts.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Path as UrlPath, Query, State};
use axum::http::{header, HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use p256::ecdh::EphemeralSecret;
use p256::pkcs8::{DecodePublicKey, EncodePublicKey};
use p256::PublicKey;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

/// Same as PROTOCOL_VERSION in protocol.ts.
const PROTOCOL: u32 = 1;
const DEFAULT_PORT: u16 = 47893;
const CHUNK: u64 = 1 << 20;
const SERVICE: &str = "_stash._tcp.local.";
/// Requests signed with a clock this far off are refused (replays are caught by nonce too).
const MAX_SKEW_MS: i64 = 24 * 3600 * 1000;
const MAX_PAIR_TRIES: u32 = 5;
/// How long the app may take to answer a request (a big first sync).
const JS_TIMEOUT: Duration = Duration::from_secs(300);

type HmacSha256 = Hmac<Sha256>;

fn hmac(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut m = <HmacSha256 as Mac>::new_from_slice(key).expect("HMAC takes any key");
    m.update(msg);
    m.finalize().into_bytes().into()
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The keys derived from a pairing's shared secret.
#[derive(Clone)]
struct Keys {
    enc: [u8; 32],
    mac: [u8; 32],
}

impl Keys {
    fn from_secret(secret: &[u8]) -> Self {
        Keys {
            enc: hmac(secret, b"stash-enc"),
            mac: hmac(secret, b"stash-mac"),
        }
    }

    /// nonce(12) | ciphertext | tag(16)
    fn seal(&self, aad: &[u8], plain: &[u8]) -> Vec<u8> {
        let cipher = Aes256Gcm::new_from_slice(&self.enc).expect("32-byte key");
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let ct = cipher
            .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad })
            .expect("AES-GCM encrypt");
        let mut out = Vec::with_capacity(12 + ct.len());
        out.extend_from_slice(&nonce);
        out.extend(ct);
        out
    }

    fn open(&self, aad: &[u8], data: &[u8]) -> Option<Vec<u8>> {
        if data.len() < 28 {
            return None;
        }
        let cipher = Aes256Gcm::new_from_slice(&self.enc).ok()?;
        cipher
            .decrypt(Nonce::from_slice(&data[..12]), Payload { msg: &data[12..], aad })
            .ok()
    }

    fn verify(&self, msg: &str, sig_hex: &str) -> bool {
        let Ok(sig) = hex::decode(sig_hex) else {
            return false;
        };
        let mut m = <HmacSha256 as Mac>::new_from_slice(&self.mac).expect("HMAC takes any key");
        m.update(msg.as_bytes());
        m.verify_slice(&sig).is_ok()
    }
}

/// The paired phone (one at a time), kept in sync.json in the app's data folder.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Peer {
    id: String,
    name: String,
    secret: String,
    paired_at: i64,
}

struct Pairing {
    code: String,
    secret: EphemeralSecret,
    public: String,
    tries: u32,
}

#[derive(Default)]
struct Inner {
    app: Mutex<Option<AppHandle>>,
    device_id: Mutex<String>,
    port: Mutex<u16>,
    peer: Mutex<Option<Peer>>,
    pairing: Mutex<Option<Pairing>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    clients: Mutex<Vec<mpsc::UnboundedSender<String>>>,
    nonces: Mutex<(HashSet<String>, VecDeque<String>)>,
    mdns: Mutex<Option<mdns_sd::ServiceDaemon>>,
    progress_at: Mutex<Option<Instant>>,
}

#[derive(Default)]
pub struct Sync(Arc<Inner>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    id: String,
    name: String,
    paired_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    running: bool,
    port: u16,
    hosts: Vec<String>,
    name: String,
    device_id: String,
    peer: Option<PeerInfo>,
    connected: bool,
    pairing: bool,
}

fn computer_name() -> String {
    hostname::get()
        .ok()
        .map(|h| h.to_string_lossy().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "stash".into())
}

/// The computer's addresses on the local network, most likely ones first.
fn lan_hosts() -> Vec<String> {
    let mut hosts: Vec<(u8, String)> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.is_loopback())
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if !v4.is_link_local() && !v4.is_unspecified() => {
                let o = v4.octets();
                let rank = match o {
                    [192, 168, ..] => 0,
                    [10, ..] => 1,
                    [172, b, ..] if (16..32).contains(&b) => 2,
                    _ => 3,
                };
                Some((rank, v4.to_string()))
            }
            _ => None,
        })
        .collect();
    hosts.sort();
    hosts.dedup_by(|a, b| a.1 == b.1);
    hosts.into_iter().map(|(_, h)| h).collect()
}

impl Inner {
    fn app(&self) -> Option<AppHandle> {
        self.app.lock().unwrap().clone()
    }

    fn config_path(&self) -> Option<PathBuf> {
        self.app()?.path().app_data_dir().ok().map(|d| d.join("sync.json"))
    }

    fn incoming_dir(&self) -> Option<PathBuf> {
        self.app()?.path().app_data_dir().ok().map(|d| d.join("sync-incoming"))
    }

    fn save_peer(&self) {
        let Some(path) = self.config_path() else { return };
        let peer = self.peer.lock().unwrap().clone();
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        let _ = std::fs::write(&path, serde_json::to_vec(&json!({ "peer": peer })).unwrap());
    }

    fn load_peer(&self) {
        let Some(path) = self.config_path() else { return };
        let peer = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| serde_json::from_value::<Peer>(v["peer"].clone()).ok());
        *self.peer.lock().unwrap() = peer;
    }

    fn connected(&self) -> bool {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|c| !c.is_closed());
        !clients.is_empty()
    }

    fn status(&self) -> Status {
        let port = *self.port.lock().unwrap();
        Status {
            running: port != 0,
            port,
            hosts: lan_hosts(),
            name: computer_name(),
            device_id: self.device_id.lock().unwrap().clone(),
            peer: self.peer.lock().unwrap().as_ref().map(|p| PeerInfo {
                id: p.id.clone(),
                name: p.name.clone(),
                paired_at: p.paired_at,
            }),
            connected: self.connected(),
            pairing: self.pairing.lock().unwrap().is_some(),
        }
    }

    fn emit_status(&self) {
        if let Some(app) = self.app() {
            let _ = app.emit("sync-status", self.status());
        }
    }

    fn broadcast(&self, msg: &str) {
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|c| c.send(msg.to_string()).is_ok());
    }

    /// Hands a request to the app (src/core/sync/server.ts) and waits for its answer.
    async fn ask_js(&self, op: &str, body: Value) -> Result<Value, String> {
        let app = self.app().ok_or("not started")?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(e) = app.emit_to("main", "sync-request", json!({ "id": id, "op": op, "body": body })) {
            self.pending.lock().unwrap().remove(&id);
            return Err(e.to_string());
        }
        match tokio::time::timeout(JS_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            _ => {
                self.pending.lock().unwrap().remove(&id);
                Err("stash didn't answer".into())
            }
        }
    }

    /// Checks a request's signature; returns the pairing's keys.
    fn authorize(
        &self,
        device: &str,
        protocol: &str,
        ts: &str,
        nonce: &str,
        sig: &str,
        signed: impl FnOnce(&str, &str) -> String,
    ) -> Result<Keys, Response> {
        let peer = self.peer.lock().unwrap().clone();
        let Some(peer) = peer.filter(|p| p.id == device) else {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        };
        if protocol.parse::<u32>().unwrap_or(0) != PROTOCOL {
            return Err(too_old());
        }
        let skew = ts.parse::<i64>().map(|t| (t - now_ms()).abs()).unwrap_or(i64::MAX);
        if skew > MAX_SKEW_MS || nonce.len() < 16 || nonce.len() > 64 {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        }
        let secret = B64.decode(&peer.secret).unwrap_or_default();
        let keys = Keys::from_secret(&secret);
        if !keys.verify(&signed(ts, nonce), sig) {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        }
        let mut guard = self.nonces.lock().unwrap();
        let (seen, order) = &mut *guard;
        if !seen.insert(nonce.to_string()) {
            return Err(StatusCode::UNAUTHORIZED.into_response());
        }
        order.push_back(nonce.to_string());
        while order.len() > 20_000 {
            if let Some(old) = order.pop_front() {
                seen.remove(&old);
            }
        }
        Ok(keys)
    }

    fn authorize_request(
        &self,
        method: &Method,
        uri: &Uri,
        headers: &HeaderMap,
        body_hash: &str,
    ) -> Result<Keys, Response> {
        let h = |n: &str| headers.get(n).and_then(|v| v.to_str().ok()).unwrap_or("");
        let path = uri.path_and_query().map(|p| p.as_str()).unwrap_or(uri.path());
        let range = h("range");
        self.authorize(
            h("x-stash-device"),
            h("x-stash-protocol"),
            h("x-stash-ts"),
            h("x-stash-nonce"),
            h("x-stash-sig"),
            |ts, nonce| format!("{method}\n{path}\n{ts}\n{nonce}\n{range}\n{body_hash}"),
        )
    }

    /// Transfer progress for the app's progress bar (a few times a second).
    fn emit_progress(&self, dir: &str, hash: &str, done: u64, total: u64, batch: &str) {
        {
            let mut at = self.progress_at.lock().unwrap();
            if done < total && at.is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
                return;
            }
            *at = Some(Instant::now());
        }
        if let Some(app) = self.app() {
            let _ = app.emit(
                "sync-transfer",
                json!({ "dir": dir, "hash": hash, "done": done, "total": total, "batch": batch }),
            );
        }
    }
}

fn too_old() -> Response {
    (
        StatusCode::UPGRADE_REQUIRED,
        [(header::CONTENT_TYPE, "application/json")],
        json!({ "protocol": PROTOCOL }).to_string(),
    )
        .into_response()
}

fn json_response(v: Value) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], v.to_string()).into_response()
}

fn sealed(keys: &Keys, path: &str, v: &Value) -> Response {
    let data = keys.seal(format!("res:{path}").as_bytes(), v.to_string().as_bytes());
    ([(header::CONTENT_TYPE, "application/octet-stream")], data).into_response()
}

fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

// ---- handlers ----

type Shared = State<Arc<Inner>>;

async fn hello(State(inner): Shared) -> Response {
    let pairing = inner.pairing.lock().unwrap().as_ref().map(|p| p.public.clone());
    json_response(json!({
        "app": "stash",
        "protocol": PROTOCOL,
        "deviceId": inner.device_id.lock().unwrap().clone(),
        "name": computer_name(),
        "pairing": pairing.is_some(),
        "pub": pairing,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairRequest {
    protocol: u32,
    phone_id: String,
    phone_name: String,
    phone_pub: String,
    proof: String,
}

async fn pair(State(inner): Shared, body: Bytes) -> Response {
    let Ok(req) = serde_json::from_slice::<PairRequest>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if req.protocol != PROTOCOL {
        return too_old();
    }
    let device_id = inner.device_id.lock().unwrap().clone();
    let result = {
        let mut guard = inner.pairing.lock().unwrap();
        let Some(pairing) = guard.as_mut() else {
            return StatusCode::FORBIDDEN.into_response();
        };
        let peer_pub = B64
            .decode(&req.phone_pub)
            .ok()
            .and_then(|der| PublicKey::from_public_key_der(&der).ok());
        let Some(peer_pub) = peer_pub else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        let shared = pairing.secret.diffie_hellman(&peer_pub);
        let msg = format!("stash-pair-v1|{}|{}|{}", pairing.code, device_id, req.phone_id);
        let secret = hmac(shared.raw_secret_bytes(), msg.as_bytes());
        let keys = Keys::from_secret(&secret);
        if keys.verify("stash-pair-phone", &req.proof) {
            *guard = None;
            Ok((secret, keys))
        } else {
            pairing.tries += 1;
            if pairing.tries >= MAX_PAIR_TRIES {
                *guard = None; // too many wrong codes: pairing closes
            }
            Err(())
        }
    };
    let Ok((secret, keys)) = result else {
        inner.emit_status();
        return StatusCode::FORBIDDEN.into_response();
    };
    *inner.peer.lock().unwrap() = Some(Peer {
        id: req.phone_id,
        name: req.phone_name,
        secret: B64.encode(secret),
        paired_at: now_ms(),
    });
    inner.save_peer();
    inner.emit_status();
    json_response(json!({
        "deviceId": device_id,
        "name": computer_name(),
        "proof": hex::encode(hmac(&keys.mac, b"stash-pair-desktop")),
    }))
}

/// /v1/sync and /v1/files: an encrypted JSON request answered by the app.
async fn json_op(State(inner): Shared, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    let keys = match inner.authorize_request(&method, &uri, &headers, &sha256_hex(&body)) {
        Ok(k) => k,
        Err(r) => return r,
    };
    let path = uri.path().to_string();
    let Some(plain) = keys.open(format!("req:{path}").as_bytes(), &body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&plain) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let op = path.trim_start_matches("/v1/").to_string();
    match inner.ask_js(&op, value).await {
        Ok(v) => sealed(&keys, &path, &v),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, e).into_response(),
    }
}

async fn unpair_request(State(inner): Shared, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response {
    if let Err(r) = inner.authorize_request(&method, &uri, &headers, &sha256_hex(&body)) {
        return r;
    }
    forget_peer(&inner);
    StatusCode::OK.into_response()
}

fn forget_peer(inner: &Inner) {
    *inner.peer.lock().unwrap() = None;
    inner.save_peer();
    inner.broadcast("unpaired");
    inner.broadcast("__close");
    inner.emit_status();
}

/// A file, in encrypted 1 MiB frames, from `Range: bytes=N-` (N a multiple of 1 MiB).
async fn file_get(State(inner): Shared, UrlPath(hash): UrlPath<String>, method: Method, uri: Uri, headers: HeaderMap) -> Response {
    let keys = match inner.authorize_request(&method, &uri, &headers, &sha256_hex(b"")) {
        Ok(k) => k,
        Err(r) => return r,
    };
    if !is_hash(&hash) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = match inner.ask_js("resolve", json!({ "hash": hash })).await {
        Ok(v) => v["path"].as_str().map(str::to_string),
        Err(e) => return (StatusCode::SERVICE_UNAVAILABLE, e).into_response(),
    };
    let Some(path) = path else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(mut file) = tokio::fs::File::open(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let size = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let from = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|r| r.strip_prefix("bytes="))
        .and_then(|r| r.trim_end_matches('-').parse::<u64>().ok())
        .unwrap_or(0);
    if from % CHUNK != 0 || from > size || file.seek(std::io::SeekFrom::Start(from)).await.is_err() {
        return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
    }
    let batch = headers
        .get("x-stash-batch")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let state = (file, from, keys, hash.clone(), inner.clone(), batch);
    let stream = futures_util::stream::unfold(state, move |(mut file, at, keys, hash, inner, batch)| async move {
        if at >= size {
            return None;
        }
        let len = CHUNK.min(size - at) as usize;
        let mut buf = vec![0u8; len];
        if let Err(e) = file.read_exact(&mut buf).await {
            return Some((Err(e), (file, size, keys, hash, inner, batch)));
        }
        let sealed = keys.seal(format!("{hash}:{}", at / CHUNK).as_bytes(), &buf);
        let mut frame = Vec::with_capacity(4 + sealed.len());
        frame.extend_from_slice(&(sealed.len() as u32).to_be_bytes());
        frame.extend(sealed);
        let next = at + len as u64;
        inner.emit_progress("send", &hash, next, size, &batch);
        Some((Ok(Bytes::from(frame)), (file, next, keys, hash, inner, batch)))
    });
    Response::builder()
        .status(if from > 0 { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header("x-stash-size", size.to_string())
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// Bytes of an upload already here, whole chunks only (a torn last chunk is dropped).
async fn received_so_far(part: &PathBuf) -> u64 {
    let len = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let whole = len - len % CHUNK;
    if whole != len {
        if let Ok(f) = tokio::fs::OpenOptions::new().write(true).open(part).await {
            let _ = f.set_len(whole).await;
        }
    }
    whole
}

async fn upload_status(State(inner): Shared, UrlPath(hash): UrlPath<String>, method: Method, uri: Uri, headers: HeaderMap) -> Response {
    if let Err(r) = inner.authorize_request(&method, &uri, &headers, &sha256_hex(b"")) {
        return r;
    }
    let (Some(dir), true) = (inner.incoming_dir(), is_hash(&hash)) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let received = received_so_far(&dir.join(format!("{hash}.part"))).await;
    json_response(json!({ "received": received }))
}

#[derive(Deserialize)]
struct UploadQuery {
    size: u64,
    name: String,
    from: u64,
}

/// A file from the phone, in encrypted frames; checked against its hash, then handed to the app.
async fn upload_put(
    State(inner): Shared,
    UrlPath(hash): UrlPath<String>,
    Query(q): Query<UploadQuery>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    // Frames are authenticated one by one (AES-GCM, bound to the hash and chunk index).
    let keys = match inner.authorize_request(&method, &uri, &headers, "-") {
        Ok(k) => k,
        Err(r) => return r,
    };
    let (Some(dir), true) = (inner.incoming_dir(), is_hash(&hash)) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let _ = tokio::fs::create_dir_all(&dir).await;
    let part = dir.join(format!("{hash}.part"));
    let mut received = received_so_far(&part).await;
    if received != q.from {
        return (StatusCode::CONFLICT, json!({ "received": received }).to_string()).into_response();
    }
    let Ok(mut file) = tokio::fs::OpenOptions::new().create(true).append(true).open(&part).await else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let batch = headers.get("x-stash-batch").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let mut stream = body.into_data_stream();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else { break };
        buf.extend_from_slice(&chunk);
        while buf.len() >= 4 {
            let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
            if len > CHUNK as usize + 64 {
                return StatusCode::BAD_REQUEST.into_response();
            }
            if buf.len() < 4 + len {
                break;
            }
            let frame: Vec<u8> = buf.drain(..4 + len).skip(4).collect();
            let Some(plain) = keys.open(format!("{hash}:{}", received / CHUNK).as_bytes(), &frame) else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            if file.write_all(&plain).await.is_err() {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            received += plain.len() as u64;
            inner.emit_progress("receive", &hash, received, q.size, &batch);
        }
    }
    let _ = file.flush().await;
    drop(file);
    if received < q.size {
        // Cut off: the phone resumes from here next time.
        return json_response(json!({ "received": received }));
    }
    let check = part.clone();
    let actual = tokio::task::spawn_blocking(move || -> Option<String> {
        let mut f = std::fs::File::open(&check).ok()?;
        let mut hasher = Sha256::new();
        std::io::copy(&mut f, &mut hasher).ok()?;
        Some(hex::encode(hasher.finalize()))
    })
    .await
    .ok()
    .flatten();
    if received != q.size || actual.as_deref() != Some(hash.as_str()) {
        let _ = tokio::fs::remove_file(&part).await;
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }
    let done = dir.join(&hash);
    if tokio::fs::rename(&part, &done).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let name: String = q.name.chars().filter(|c| !"\\/:*?\"<>|".contains(*c)).take(150).collect();
    match inner
        .ask_js("received", json!({ "hash": hash, "path": done.to_string_lossy(), "name": name }))
        .await
    {
        Ok(_) => json_response(json!({ "received": received })),
        Err(e) => (StatusCode::SERVICE_UNAVAILABLE, e).into_response(),
    }
}

async fn ws(State(inner): Shared, Query(q): Query<HashMap<String, String>>, upgrade: WebSocketUpgrade) -> Response {
    let g = |k: &str| q.get(k).map(String::as_str).unwrap_or("");
    let empty = sha256_hex(b"");
    if let Err(r) = inner.authorize(g("device"), g("protocol"), g("ts"), g("nonce"), g("sig"), |ts, nonce| {
        format!("GET\n/v1/ws\n{ts}\n{nonce}\n\n{empty}")
    }) {
        return r;
    }
    upgrade.on_upgrade(move |socket| client(inner, socket))
}

/// The phone's WebSocket: "changed" pings both ways while it's connected.
async fn client(inner: Arc<Inner>, socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();
    let (out, mut out_rx) = mpsc::unbounded_channel::<String>();
    inner.clients.lock().unwrap().push(out);
    inner.emit_status();
    let send = async {
        let mut keepalive = tokio::time::interval(Duration::from_secs(20));
        loop {
            tokio::select! {
                msg = out_rx.recv() => {
                    let Some(msg) = msg else { break };
                    if msg == "__close" { break; }
                    if tx.send(Message::Text(msg.into())).await.is_err() { break; }
                }
                _ = keepalive.tick() => {
                    if tx.send(Message::Ping(Bytes::new())).await.is_err() { break; }
                }
            }
        }
        let _ = tx.close().await;
    };
    let app = inner.app();
    let recv = async {
        while let Some(Ok(msg)) = rx.next().await {
            match msg {
                Message::Text(t) if t.as_str() == "changed" => {
                    if let Some(app) = &app {
                        let _ = app.emit("sync-remote-changed", ());
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    };
    tokio::select! {
        _ = send => {},
        _ = recv => {},
    }
    // Let the sender go, then tell the app the phone is gone.
    drop(out_rx);
    inner.emit_status();
}

fn announce(inner: &Inner, port: u16) -> Result<(), String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
    let id = inner.device_id.lock().unwrap().clone();
    let host: String = computer_name()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let props = [("id", id.as_str()), ("v", "1")];
    let info = mdns_sd::ServiceInfo::new(
        SERVICE,
        &format!("stash-{}", &id[..id.len().min(8)]),
        &format!("{host}.local."),
        "",
        port,
        &props[..],
    )
    .map_err(|e| e.to_string())?
    .enable_addr_auto();
    daemon.register(info).map_err(|e| e.to_string())?;
    *inner.mdns.lock().unwrap() = Some(daemon);
    Ok(())
}

// ---- commands (src/core/sync/server.ts) ----

/// Starts the server and the mDNS announcement (once; later calls return the status).
#[tauri::command]
pub async fn sync_start(app: AppHandle, state: tauri::State<'_, Sync>, device_id: String) -> Result<Status, String> {
    let inner = state.0.clone();
    if *inner.port.lock().unwrap() != 0 {
        return Ok(inner.status());
    }
    *inner.app.lock().unwrap() = Some(app);
    *inner.device_id.lock().unwrap() = device_id;
    inner.load_peer();
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", DEFAULT_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0)).await.map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *inner.port.lock().unwrap() = port;
    let router = Router::new()
        .route("/v1/hello", get(hello))
        .route("/v1/pair", post(pair))
        .route("/v1/sync", post(json_op))
        .route("/v1/files", post(json_op))
        .route("/v1/unpair", post(unpair_request))
        .route("/v1/file/{hash}", get(file_get))
        .route("/v1/upload/{hash}", get(upload_status).put(upload_put))
        .route("/v1/ws", get(ws))
        .layer(DefaultBodyLimit::max(256 * 1024 * 1024))
        .with_state(inner.clone());
    tauri::async_runtime::spawn(async move {
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("sync server stopped: {e}");
        }
    });
    if let Err(e) = announce(&inner, port) {
        eprintln!("mDNS announcement failed: {e}");
    }
    Ok(inner.status())
}

#[tauri::command]
pub fn sync_status(state: tauri::State<'_, Sync>) -> Status {
    state.0.status()
}

/// Opens pairing: a new 6-digit code and key pair, until a phone pairs or it's closed.
#[tauri::command]
pub fn sync_pair_open(state: tauri::State<'_, Sync>) -> Result<String, String> {
    let secret = EphemeralSecret::random(&mut OsRng);
    let public = PublicKey::from(&secret)
        .to_public_key_der()
        .map_err(|e| e.to_string())?;
    let code = format!("{:06}", OsRng.next_u32() % 1_000_000);
    *state.0.pairing.lock().unwrap() = Some(Pairing {
        code: code.clone(),
        secret,
        public: B64.encode(public.as_bytes()),
        tries: 0,
    });
    state.0.emit_status();
    Ok(code)
}

#[tauri::command]
pub fn sync_pair_close(state: tauri::State<'_, Sync>) {
    *state.0.pairing.lock().unwrap() = None;
    state.0.emit_status();
}

#[tauri::command]
pub fn sync_unpair(state: tauri::State<'_, Sync>) {
    forget_peer(&state.0);
}

/// The app's answer to a `sync-request`.
#[tauri::command]
pub fn sync_reply(state: tauri::State<'_, Sync>, id: u64, ok: bool, body: Value) {
    if let Some(tx) = state.0.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(if ok {
            Ok(body)
        } else {
            Err(body.as_str().unwrap_or("failed").to_string())
        });
    }
}

/// Something changed here: the phone pulls.
#[tauri::command]
pub fn sync_ping(state: tauri::State<'_, Sync>) {
    state.0.broadcast("changed");
}

/// The pairing QR code, as SVG.
#[tauri::command]
pub fn sync_qr(text: String) -> Result<String, String> {
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(232, 232)
        .quiet_zone(true)
        .build())
}
