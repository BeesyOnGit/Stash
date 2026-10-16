/**
 * Huddle voice chat over LiveKit (self-hosted, see huddle_api/deploy). Same
 * file in both apps; the phone calls registerGlobals() before using it.
 */
import { Room, RoomEvent, Track } from 'livekit-client';
import type { VoiceCall, VoiceUpdate } from './core';

/** The bits of a Web Audio context the chime uses (the browser's, or react-native-audio-api's). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { currentTime: number; destination: any; createOscillator(): any; createGain(): any };

/** Two soft notes: rising when someone joins the call, falling when they leave. */
export function chime(ctx: Ctx, up: boolean) {
  const t = ctx.currentTime;
  (up ? [660, 880] : [880, 660]).forEach((freq, i) => {
    const at = t + i * 0.12;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.3);
  });
}

export async function connectVoice(url: string, token: string, on: { update(u: VoiceUpdate): void; ended(): void }): Promise<VoiceCall> {
  const room = new Room({
    // WebRTC's echo cancellation stays on: people listen on speakers with music playing.
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const everyone = () => [room.localParticipant, ...room.remoteParticipants.values()];
  const report = () =>
    on.update({
      ids: everyone().map(p => p.identity),
      speaking: room.activeSpeakers.map(p => p.identity),
      muted: everyone().filter(p => !p.isMicrophoneEnabled).map(p => p.identity),
    });
  // The computer plays the others through <audio> elements; the phone plays them natively.
  const doc = (globalThis as { document?: { body: { appendChild(el: unknown): void } } }).document;
  const players = new Set<{ remove(): void }>();
  room
    .on(RoomEvent.TrackSubscribed, track => {
      if (track.kind !== Track.Kind.Audio || !doc) return;
      const el = track.attach();
      players.add(el);
      doc.body.appendChild(el);
      report();
    })
    .on(RoomEvent.TrackUnsubscribed, track => {
      for (const el of track.detach()) {
        players.delete(el);
        el.remove();
      }
      report();
    })
    .on(RoomEvent.ParticipantConnected, report)
    .on(RoomEvent.ParticipantDisconnected, report)
    .on(RoomEvent.ActiveSpeakersChanged, report)
    .on(RoomEvent.TrackMuted, report)
    .on(RoomEvent.TrackUnmuted, report)
    .on(RoomEvent.LocalTrackPublished, report)
    .on(RoomEvent.Disconnected, () => on.ended());
  await room.connect(url, token);
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (e) {
    room.disconnect();
    throw e;
  }
  report();
  return {
    setMuted: async muted => {
      await room.localParticipant.setMicrophoneEnabled(!muted);
      report();
    },
    leave: () => {
      room.removeAllListeners();
      room.disconnect();
      for (const el of players) el.remove();
      players.clear();
    },
  };
}
