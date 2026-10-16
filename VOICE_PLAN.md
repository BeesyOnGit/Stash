# Huddle voice chat — implementation plan

Handoff for the agent building voice chat in huddles. Read this whole file
first, then the code it points to.

**Status (2026-10-16):** sections 1 and 2 are built (not yet tested on devices).
- Server: `huddle_api/src/features/huddle/voice.rs`, `huddle_api/deploy/livekit.yml`.
- Clients: `voice.ts` (the LiveKit code, the same file in both apps) and the
  voice parts of `core.ts`.
- Android: `bubble/VoiceService.kt`.

Section 3 (noise suppression) is not started. Until it is, WebRTC's own noise
suppression is on.

## Goal

People in a huddle can talk to each other while the music plays in sync:

- Join or leave voice from the huddle header.
- A voice bar shows who is in the call, with a green ring on whoever is talking.
- The bar has Mute, a "lower music while people talk" switch (ducking) and Leave.
- Noise suppression removes background noise *and most of the music leaking
  into the mic* (people listen on speakers too).

The UI is specified in the design files the user shared, `Music App v4.dc.html`
(phone) and `Music App Desktop v4.dc.html`: look for `rm.inVoiceMe`,
`rm.callFaces`, `rm.toggleDuck`, `rm.joinVoice`. There, voice is only simulated.

## Decisions already made

| Topic | Decision | Why |
|---|---|---|
| Media transport | **Self-hosted LiveKit** (SFU), not peer-to-peer mesh, not a hosted service | Huddles allow 16 members; a mesh doesn't scale; the user wants no third party |
| Where LiveKit runs | **Separate container `livekit` in the existing compose stack** (`huddle_api/deploy/docker-compose.yml`) | The user asked to put it inside the Rust API if possible. It isn't: LiveKit is a Go server, and building an SFU inside axum (webrtc-rs) would take weeks and be worse. The API only issues tokens |
| Echo cancellation | WebRTC's built-in AEC (on by default in LiveKit) | — |
| Noise suppression | **DeepFilterNet** (Rust `libDF`) by default, **RNNoise** as the light fallback; setting: Smart / Light / Off | Speech-only models remove music bleed; RNNoise is about 5–20× cheaper but weak against music |
| Music-as-reference echo cancellation | **Not now.** Only if testing shows sung vocals still leak too much | Needs native timing work (about 1–2 weeks) |

## Current code to know

- `huddle_api/` — Rust/axum WebSocket server, everything in memory.
  - `src/features/huddle/{model,service,controller,routes}.rs`.
  - Member id **is the device id** (`WsQuery.id`). A member reconnecting replaces its old connection (`Member.conn`).
  - Tests: `cargo test` in `huddle_api/`.
- `src/huddle/core.ts` = `desktop/src/core/huddle/core.ts` — **the same file in both apps; keep them identical** (same for `labels.ts` and `src/i18n/strings/huddle.ts`).
  - Holds the connection, the clock and the room state.
  - Platform parts come in through `HuddleHost` (`src/huddle/index.ts`, `desktop/src/core/huddle/index.ts`).
- Device id: `getSettings().huddleId` (made once per install). Use it as the LiveKit **identity**, so voice participants match huddle members.
- UI:
  - Phone: `src/screens/HuddleScreen.tsx` (React Native). The app draws edge to edge, so use the `useKeyboardSpace()` there for anything with an input.
  - Desktop: `desktop/src/ui/HuddleScreen.tsx` (Tauri + React DOM, WebView2 on Windows).
- i18n: every key in en, fr, ar, es, de. **Arabic plurals need all six forms** (zero, one, two, few, many, other); `__tests__/i18n.test.ts` enforces it.
- Volume:
  - Desktop has `PlayerService.setVolume(v, save)`; ducking can use a temporary level (`liveVolume`).
  - The phone has only a private `setVolume` in `src/player/PlayerService.ts` (used by the sleep timer). Add a public duck level there and multiply it in.
- Changelog: add user-facing lines to `CHANGELOG.md` under the next version.

## 1. Backend

### 1a. LiveKit container

In `huddle_api/deploy/docker-compose.yml`, add a `livekit` service:

- **Image:** `livekit/livekit-server`, pinned to an exact version.
- **Config:** `livekit.yaml` mounted from the deploy folder:
  - `keys: { <LIVEKIT_API_KEY>: <LIVEKIT_API_SECRET> }`
  - `port: 7880`
  - `rtc: { tcp_port: 7881, udp_port: 7882, use_external_ip: true }`. A single muxed UDP port is simpler to open than a range.
  - `turn: { enabled: true, udp_port: 3478 }` for hard networks. TURN over TLS (5349) needs a domain plus a certificate; add it if mobile networks fail.
  - `room: { empty_timeout: 300 }`, to match `EMPTY_TTL_SECS`.
- **Ports to open on the VPS:** 7881/tcp, 7882/udp, 3478/udp.
- **Signalling:** 7880 must be **wss**. Serve it through the reverse proxy (Caddy or Nginx) at its own host, e.g. `voice.inovsoft.online`, next to `huddle.inovsoft.online`.
- **`.env.production.example`:** add `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `LIVEKIT_URL` (the public `wss://` URL). The API and LiveKit read the same key and secret.
- **`deploy.sh`:** also `docker compose pull livekit`, and health-check it (`http://127.0.0.1:7880` answers `OK`).

### 1b. Token endpoint in the API

- Add `GET /huddles/{code}/voice?id=<device id>`, which returns `{ url, token }`.
- **Only hand out tokens to current members.** Look up `ROOMS[code]` and check that a member with that `id` exists, so you can't listen in by knowing a code without being in the huddle. Otherwise return 403 or 404.
- **Token grants:**
  - LiveKit room = huddle code; identity = member id; name = member name.
  - `room_join: true`, `can_publish: true`, publish sources limited to the microphone, `can_subscribe: true`.
  - Lifetime about 10 min; clients ask for a new one when they rejoin.
- **Signing:** use the `livekit-api` crate (access tokens). It's an HS256 JWT, so `jsonwebtoken` works too if that crate is heavy.
- **Tests:** in `service.rs` or a new `voice.rs`:
  - a member gets a token;
  - a non-member and an unknown code are refused;
  - the claims have the right room and identity.
- **Optional:** add `voice: bool` to `MemberView` and broadcast it, but only if the members list needs voice status for people who aren't in the call. LiveKit's participant list already tells callers who is in voice.

## 2. Clients: basic voice

**Shared logic** (both apps): keep it platform-neutral. Either add `voice` hooks to `HuddleHost`, or put voice in a small separate module per app.

- `joinVoice()`: fetch a token from `${HUDDLE_SERVER}huddles/${code}/voice?id=${deviceId}`, connect, publish the mic.
- `leaveVoice()`, `toggleMute()`, `toggleDuck()`.
- **View state** to expose:
  - `inVoice`;
  - `participants` (identities, mapped to huddle members by id);
  - `speaking` (from LiveKit active speakers);
  - `muted` and `duck`.
- **Ducking:** while any *other* participant is speaking and `duck` is on, lower the music player to about 30% with a short fade, then restore it.
- **Leaving the huddle** leaves voice too.

**Desktop:**
- Package: `livekit-client`.
- WebView2 has WebRTC. Ask for the mic with echo cancellation on.
- **macOS:** add `NSMicrophoneUsageDescription` to the Tauri config.
- **Linux:** WebKitGTK usually has WebRTC turned off. Hide voice there instead of failing.

**Phone:**
- Packages: `@livekit/react-native` and `@livekit/react-native-webrtc` (native modules, so the app must be rebuilt).
- **Android:**
  - `RECORD_AUDIO` permission, asked when joining voice.
  - A foreground service with `foregroundServiceType="microphone"` while in voice, so the call survives the screen locking.
  - Check whether the existing `whileAway` / keep-alive covers JS timers.
- **iOS:** `NSMicrophoneUsageDescription`, and the `audio` background mode.

**UI** (follow the design):
- Header button "Join voice" / "Voice · N".
- Voice bar at the bottom: faces with a green ring while talking; mute; duck; Leave.
- The members list shows "In voice", "Talking" or "Muted".
- **Show this hint when joining voice:** with Bluetooth headphones, turning on the mic switches them to call mode, and music sounds worse (mono, low quality) while you're in voice. This can't be avoided; it's how Bluetooth works.

## 3. Clients: noise suppression

Shared Rust library, e.g. a new crate `voice_ns/`:

- **Wraps:** DeepFilterNet `libDF` (default model compiled in) and RNNoise (e.g. the `nnnoiseless` crate, pure Rust).
- **API:** `process(frame: &mut [f32; 480])` at 48 kHz mono, one 10 ms frame, the same as WebRTC capture frames. It also needs `new(mode)` and `set_mode(mode)`.
- **Build targets:**
  - Android: `cargo-ndk` for arm64-v8a, armeabi-v7a and x86_64 (C API, JNI).
  - iOS: `aarch64-apple-ios` plus the simulator (static library).
  - Desktop: `wasm32-unknown-unknown` (`wasm-bindgen`).

Per platform:

- **Android:** LiveKit Android's capture post-processing hook (`AudioProcessorInterface` / audio processing options).
  - A Kotlin processor that calls the library over JNI.
  - Register it from a small React Native native module.
- **iOS:** LiveKit Swift's custom capture processing delegate, calling the static library.
- **Desktop:** an `AudioWorklet` running the WebAssembly module, attached as a LiveKit audio track processor.
- **All platforms:** turn off WebRTC's own noise suppression while ours runs. **Keep its echo cancellation on.**
- **Setting:** add "Noise suppression: Smart / Light / Off" to `Settings` in both apps; default Smart.
- **Automatic fallback to Light:** if processing a frame takes more than about 8 ms on average, switch and tell the user once.

## Order of work

1. **Spike (about 1 day), do it first:** build `libDF` for Android arm64 and time `process()` on the user's phone, with music playing in the room. If a budget phone can't stay well under 10 ms per frame, plan on RNNoise as the phone default.
2. Backend: LiveKit container, reverse proxy and ports, the token endpoint with tests. Deploy it before any app ships.
3. Desktop basic voice, then phone basic voice (with the rebuild).
4. Ducking, the voice bar and the members list status; i18n in all 5 languages.
5. Noise suppression: shared crate, then Android, iOS and desktop.
6. Test on real devices: a budget Android phone, Bluetooth headphones, a laptop on speakers with music playing, mobile data (checks TURN).
7. `CHANGELOG.md` entry.

Rough total: about 1 week for basic voice and about 2 weeks for noise suppression.

## Conventions in this repo

- Keep the solution as small as it can be.
- Mark deliberate shortcuts with a `ponytail:` comment that says what the limit is and when to upgrade.
- Comments and UI copy are plain and short; follow the style of the surrounding code.
- `core.ts`, `labels.ts` and `strings/huddle.ts` stay identical between `src/` and `desktop/src/core/`. Edit one, then copy it over.
- Checks before you finish:
  - `cargo test` in `huddle_api/`;
  - `npx tsc --noEmit -p .` and `npx jest` at the root;
  - `npx tsc --noEmit -p .` and `npx vite build` in `desktop/`.
