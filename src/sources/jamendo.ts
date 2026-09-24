/**
 * Jamendo: free, legal, Creative Commons music with an official API.
 * Needs a free client id: https://devportal.jamendo.com
 */
import { getSettings } from '../services/settings';
import type { OnlineResult } from '../types';
import { getJson } from './http';
import type { MusicSource } from './types';

interface JamendoTracks {
  results: Array<{
    id: string;
    name: string;
    duration: number;
    artist_name: string;
    album_name: string;
    image: string;
    audio: string;
  }>;
}

const API = 'https://api.jamendo.com/v3.0';

// The stream URL is part of the search response; keep it so resolving costs no request.
const streamUrls = new Map<string, string>();

export const jamendoSource: MusicSource = {
  id: 'jamendo',
  name: 'Jamendo',
  isEnabled: () => !!getSettings().jamendoClientId,
  async search(q) {
    const id = getSettings().jamendoClientId;
    const data = await getJson<JamendoTracks>(
      `${API}/tracks/?client_id=${id}&format=json&limit=20&audioformat=mp32&imagesize=600` +
        `&search=${encodeURIComponent(q)}`,
    );
    return data.results.map((t): OnlineResult => {
      streamUrls.set(t.id, t.audio);
      return {
        source: 'jamendo',
        sourceId: t.id,
        title: t.name,
        artist: t.artist_name || null,
        album: t.album_name || null,
        duration: t.duration || null,
        thumbnailUrl: t.image || null,
      };
    });
  },
  async resolveStream(r) {
    let url = streamUrls.get(r.sourceId);
    if (!url) {
      const id = getSettings().jamendoClientId;
      const data = await getJson<JamendoTracks>(
        `${API}/tracks/?client_id=${id}&format=json&audioformat=mp32&id=${r.sourceId}`,
      );
      url = data.results[0]?.audio;
    }
    if (!url) throw new Error('Track not available on Jamendo');
    return { url, mimeType: 'audio/mpeg' };
  },
  preferCoverLookup: false,
};
