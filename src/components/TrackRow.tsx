import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCurrentTrack, usePlayerState } from '../player/hooks';
import { ACCENT, font, formatTime, mono, paletteFor, useTheme } from '../theme';
import { artworkUri, type Track } from '../types';
import { haptic } from '../services/haptics';
import { CheckIcon, HeartSolidIcon, MoreIcon } from '../ui/icons';
import { Badge, Cover, Equalizer } from '../ui/primitives';
import { Pressable } from '../ui/Pressable';
import { tr } from '../i18n';

const NEW_FOR_MS = 24 * 3600 * 1000;

interface Props {
  track: Pick<
    Track,
    | 'id'
    | 'title'
    | 'artist'
    | 'duration'
    | 'artworkPath'
    | 'remoteArtworkUrl'
    | 'liked'
    | 'savedAt'
  >;
  /** Second line; defaults to "artist · genre". */
  subtitle?: string;
  /** Artwork override (e.g. an online result's thumbnail). */
  artwork?: string | null;
  showLiked?: boolean;
  showNew?: boolean;
  showDuration?: boolean;
  /** Replaces the duration + menu on the right (search result actions). */
  right?: React.ReactNode;
  artSize?: number;
  /** Set while choosing several songs: shows a check circle instead of the menu. */
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onMenu?: () => void;
  /** After the menu (a playlist's drag handle). */
  trailing?: React.ReactNode;
}

export function TrackRow({
  track,
  subtitle,
  artwork,
  showLiked = true,
  showNew = true,
  showDuration = true,
  right,
  artSize = 50,
  selected,
  onPress,
  onLongPress,
  onMenu,
  trailing,
}: Props) {
  const t = useTheme();
  const current = useCurrentTrack();
  const { isPlaying } = usePlayerState();
  const isCurrent = current?.id === track.id;
  const isNew =
    showNew && !!track.savedAt && Date.now() - track.savedAt < NEW_FOR_MS;
  const pal = paletteFor(track);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={
        onLongPress &&
        (() => {
          haptic('confirm');
          onLongPress();
        })
      }
      style={({ pressed }) => [
        styles.row,
        (pressed || selected) && { backgroundColor: t.fill },
      ]}
    >
      <View>
        <Cover
          uri={artwork !== undefined ? artwork : artworkUri(track)}
          size={artSize}
          radius={artSize > 48 ? 11 : 10}
          bg={pal.artBg}
        />
        {isCurrent && (
          <View style={[styles.overlay, { borderRadius: 11 }]}>
            <Equalizer color="#fff" playing={isPlaying} />
          </View>
        )}
      </View>
      <View style={styles.info}>
        <View style={styles.titleRow}>
          <Text
            numberOfLines={1}
            style={[font(500, 15, 1.25), styles.shrink, { color: t.ink }]}
          >
            {track.title}
          </Text>
          {isNew && <Badge label={tr('sheets.newBadge')} />}
        </View>
        <Text
          numberOfLines={1}
          style={[font(400, 13, 1.35), { color: t.muted }]}
        >
          {subtitle ?? (track.artist || tr('common.unknownArtist'))}
        </Text>
      </View>
      {selected !== undefined ? (
        <View
          style={[
            styles.check,
            selected
              ? { backgroundColor: t.ink }
              : { borderWidth: 2, borderColor: t.line2 },
          ]}
        >
          {selected && <CheckIcon color={t.onInk} />}
        </View>
      ) : (
        right ?? (
          <>
            {showLiked && track.liked && (
              <HeartSolidIcon size={14} color={ACCENT} />
            )}
            {showDuration && !!track.duration && (
              <Text style={[mono(400, 12), { color: t.muted2 }]}>
                {formatTime(track.duration)}
              </Text>
            )}
            {onMenu && (
              <Pressable hitSlop={6} onPress={onMenu} style={styles.menu}>
                <MoreIcon color={t.muted} />
              </Pressable>
            )}
          </>
        )
      )}
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
    paddingLeft: 20,
    paddingRight: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(22,22,26,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    width: 36,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
