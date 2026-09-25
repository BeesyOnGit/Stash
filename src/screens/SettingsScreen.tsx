import React, { useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bubbleSupported, enableBubble } from '../bubble/BubbleBridge';
import {
  LANGUAGES,
  deviceLanguage,
  syncLayoutDirection,
  tr,
  type Key,
  type LanguagePref,
} from '../i18n';
import { goToTab } from '../navigation/ref';
import { useCurrentTrack, useLibrary } from '../player/hooks';
import { scanDeviceMusic } from '../services/deviceScanner';
import {
  CROSSFADES,
  saveSettings,
  speedLabel,
  useSettings,
  type RingColor,
  type SongChange,
  type VinylStyle,
  type YoutubeBackend,
} from '../services/settings';
import { openSheet, toast } from '../state/ui';
import { useOnline } from '../services/network';
import { hapticsSupported } from '../services/haptics';
import { keepScreenOnSupported } from '../services/screen';
import { formatBytes, formatGB } from '../services/storage';
import {
  checkForUpdate,
  installedVersion,
  updatesSupported,
} from '../services/updater';
import {
  ACCENT,
  GREEN_LIGHT,
  WARN,
  eyebrow,
  font,
  mono,
  paletteFor,
  useTheme,
} from '../theme';
import { artworkUri } from '../types';
import { ChevronRightIcon, LogoMark } from '../ui/icons';
import { Chip, Segmented, Slider, Toggle } from '../ui/primitives';
import { VINYL, Vinyl } from '../ui/Vinyl';
import { Pressable } from '../ui/Pressable';

const GB = 1024 ** 3;

/** Same colours as the native bubble (bubble/BubbleState.kt). */
const RING_COLORS: { value: RingColor; labelKey: Key; color: string }[] = [
  { value: 'white', labelKey: 'settings.ringWhite', color: '#FFFFFF' },
  { value: 'orange', labelKey: 'settings.ringOrange', color: ACCENT },
  { value: 'cover', labelKey: 'settings.ringCover', color: '' },
  { value: 'green', labelKey: 'settings.ringGreen', color: GREEN_LIGHT },
  { value: 'blue', labelKey: 'settings.ringBlue', color: '#5B9BE6' },
];

const SONG_CHANGE_HINTS: Record<SongChange, Key> = {
  slide: 'settings.songSlideHint',
  fade: 'settings.songFadeHint',
  zoom: 'settings.songZoomHint',
  flip: 'settings.songFlipHint',
};

export function SettingsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const online = useOnline();
  const { tracks } = useLibrary();
  const current = useCurrentTrack();
  const [scanning, setScanning] = useState(false);
  // The song the record previews show: what's playing, else the newest song.
  const preview = current ?? tracks.find(x => x.status === 'ready') ?? null;
  const previewPalette = preview ? paletteFor(preview) : null;
  const previewArt = preview ? artworkUri(preview) : null;
  const ring = RING_COLORS.find(r => r.value === s.bubbleRingColor)!;

  const version = installedVersion();
  const [checking, setChecking] = useState(false);
  const checkUpdates = async () => {
    if (version?.debug) {
      toast(tr('settings.devBuild'));
      return;
    }
    setChecking(true);
    try {
      const release = await checkForUpdate();
      if (release) openSheet({ kind: 'update', release });
      else toast(tr('settings.upToDate'));
    } catch {
      toast(tr('settings.noGithub'));
    } finally {
      setChecking(false);
    }
  };

  const setBubble = async (on: boolean) => {
    if (!on) return saveSettings({ floatingBubble: false });
    if (!(await enableBubble())) {
      toast(tr('settings.bubblePermission'));
    }
  };

  const setLanguage = (language: LanguagePref) => {
    if (language === s.language) return;
    saveSettings({ language });
    // Arabic reads right to left: React Native only flips the layout on start.
    if (syncLayoutDirection()) {
      Alert.alert(tr('settings.restartTitle'), tr('settings.restartBody'));
    }
  };

  const downloaded = tracks.filter(
    x => x.source !== 'device' && x.status === 'ready',
  );
  const used = downloaded.reduce((a, x) => a + (x.sizeBytes ?? 0), 0);
  const limit = s.storageLimitGB * GB;
  const over = used > limit;
  const barColor = over ? ACCENT : used > limit * 0.85 ? WARN : t.ink;

  const scan = async () => {
    setScanning(true);
    try {
      const r = await scanDeviceMusic();
      Alert.alert(
        tr('settings.scanDoneTitle'),
        tr('settings.scanDoneBody', { count: r.total, added: r.added }),
      );
    } finally {
      setScanning(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[styles.pad, { paddingTop: insets.top }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.h1, { color: t.ink }]}>{tr('settings.title')}</Text>

      <Section title={tr('settings.sectionStorage')} />
      <View
        style={[
          styles.card,
          styles.cardPad,
          { backgroundColor: t.card, borderColor: t.line },
        ]}
      >
        <View style={styles.between}>
          <Text style={[font(600, 22), { color: t.ink, letterSpacing: -0.4 }]}>
            {formatBytes(used)}
          </Text>
          <Text style={[font(400, 13), { color: t.muted }]}>
            {tr('settings.storageOf', { size: formatGB(s.storageLimitGB) })}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: t.fill3 }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${Math.min(100, Math.max(1, (used / limit) * 100))}%`,
                backgroundColor: barColor,
              },
            ]}
          />
        </View>
        <View style={[styles.between, styles.mt8]}>
          <Text style={[mono(400, 12), { color: t.muted }]}>
            {tr('common.songs', { count: downloaded.length })}
          </Text>
          <Text style={[mono(400, 12), { color: t.muted }]}>
            {tr('settings.storageFree', {
              size: formatBytes(Math.max(0, limit - used)),
            })}
          </Text>
        </View>
        {over && (
          <View style={[styles.warn, { backgroundColor: t.accentSoft }]}>
            <Text style={[font(500, 13, 1.4), { color: t.accentInk }]}>
              {tr('settings.storageOver')}
            </Text>
          </View>
        )}
        <View style={[styles.between, styles.mt20]}>
          <Text style={[font(500, 15), { color: t.ink }]}>
            {tr('settings.storageLimit')}
          </Text>
          <Text style={[mono(600, 15), { color: t.ink }]}>
            {formatGB(s.storageLimitGB)}
          </Text>
        </View>
        <Slider
          value={s.storageLimitGB}
          min={0.5}
          max={32}
          step={0.5}
          onChange={v =>
            v !== s.storageLimitGB && saveSettings({ storageLimitGB: v })
          }
        />
        <View style={styles.between}>
          <Text style={[mono(400, 11), { color: t.muted2 }]}>
            {formatGB(0.5)}
          </Text>
          <Text style={[mono(400, 11), { color: t.muted2 }]}>
            {formatGB(32)}
          </Text>
        </View>
        <View style={styles.presets}>
          {[1, 2, 8, 16].map(g => (
            <Chip
              key={g}
              label={formatGB(g)}
              on={s.storageLimitGB === g}
              onPress={() => saveSettings({ storageLimitGB: g })}
            />
          ))}
        </View>
      </View>
      <View
        style={[
          styles.card,
          styles.mt10,
          { backgroundColor: t.card, borderColor: t.line },
        ]}
      >
        <Row
          title={tr('settings.manageDownloads')}
          sub={tr('settings.manageDownloadsSub')}
          onPress={() => goToTab('Saving')}
          right={<ChevronRightIcon color={t.muted} />}
        />
      </View>

      <Section title={tr('settings.sectionSaving')} />
      <View
        style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <Row
          title={tr('settings.saveWhileStreaming')}
          sub={tr('settings.saveWhileStreamingSub')}
          right={
            <Toggle
              value={s.saveWhileStreaming}
              onChange={v => saveSettings({ saveWhileStreaming: v })}
            />
          }
          divider
        />
        <Row
          title={tr('settings.lookUpDetails')}
          sub={tr('settings.lookUpDetailsSub')}
          right={
            <Toggle
              value={s.fetchCoverArt}
              onChange={v => saveSettings({ fetchCoverArt: v })}
            />
          }
        />
      </View>

      <Section title={tr('settings.sectionListening')} />
      <View
        style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <Row
          title={tr('settings.suggestSimilar')}
          sub={tr('settings.suggestSimilarSub')}
          right={
            <Toggle
              value={s.suggestSimilar}
              onChange={v => saveSettings({ suggestSimilar: v })}
            />
          }
          divider
        />
        <Row
          title={tr('settings.playbackSpeed')}
          sub={tr('settings.playbackSpeedSub')}
          divider
          right={
            <Pressable
              onPress={() => openSheet({ kind: 'speed' })}
              style={[styles.pill, { borderColor: t.line2 }]}
            >
              <Text style={[mono(600, 13), { color: t.ink }]}>
                {speedLabel(s.playbackSpeed)}
              </Text>
            </Pressable>
          }
        />
        {Platform.OS === 'android' && (
          <View
            style={[
              styles.block,
              { borderBottomWidth: 1, borderBottomColor: t.line },
            ]}
          >
            <Text style={[font(500, 15), { color: t.ink }]}>
              {tr('settings.crossfade')}
            </Text>
            <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
              {s.crossfadeSeconds
                ? tr('settings.crossfadeOn', { count: s.crossfadeSeconds })
                : tr('settings.crossfadeOff')}
            </Text>
            <View style={styles.presets}>
              {CROSSFADES.map(v => (
                <Chip
                  key={v}
                  label={
                    v ? tr('settings.seconds', { count: v }) : tr('common.off')
                  }
                  on={s.crossfadeSeconds === v}
                  onPress={() => saveSettings({ crossfadeSeconds: v })}
                />
              ))}
            </View>
          </View>
        )}
        {bubbleSupported() && (
          <Row
            title={tr('settings.bubble')}
            sub={tr('settings.bubbleSub')}
            divider
            right={<Toggle value={s.floatingBubble} onChange={setBubble} />}
          />
        )}
        {bubbleSupported() && s.floatingBubble && (
          <View
            style={[
              styles.block,
              { borderBottomWidth: 1, borderBottomColor: t.line },
            ]}
          >
            <Text style={[font(500, 15), { color: t.ink }]}>
              {tr('settings.bubbleColour')}
            </Text>
            <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
              {tr(ring.labelKey)}
            </Text>
            <View style={styles.swatches}>
              {RING_COLORS.map(r => {
                const on = r.value === s.bubbleRingColor;
                return (
                  <Pressable
                    key={r.value}
                    haptic="tick"
                    accessibilityLabel={tr(r.labelKey)}
                    accessibilityState={{ selected: on }}
                    onPress={() => saveSettings({ bubbleRingColor: r.value })}
                    style={[
                      styles.swatch,
                      { backgroundColor: r.color || previewPalette?.accent },
                      on
                        ? {
                            boxShadow: `0px 0px 0px 2px ${t.card}, 0px 0px 0px 4px ${ACCENT}`,
                          }
                        : styles.swatchOff,
                    ]}
                  >
                    {r.value === 'cover' && (
                      <View
                        style={[
                          styles.swatchHalf,
                          { backgroundColor: previewPalette?.deep ?? '#333' },
                        ]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        <Row
          title={tr('settings.playerCover')}
          sub={
            s.playerArt === 'vinyl'
              ? tr('settings.playerCoverVinyl')
              : tr('settings.playerCoverSquare')
          }
          divider
          right={
            <Segmented
              compact
              height={30}
              value={s.playerArt}
              onChange={playerArt => saveSettings({ playerArt })}
              options={[
                { value: 'vinyl', label: tr('settings.optVinyl') },
                { value: 'cover', label: tr('settings.optCover') },
              ]}
            />
          }
        />
        <Row
          title={tr('settings.rotateArt')}
          sub={tr('settings.rotateArtSub')}
          divider
          right={
            <Toggle
              value={s.rotateArt}
              onChange={v => saveSettings({ rotateArt: v })}
            />
          }
        />
        <View style={styles.block}>
          <Text style={[font(500, 15), { color: t.ink }]}>
            {tr('settings.vinylStyle')}
          </Text>
          <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
            {bubbleSupported()
              ? tr('settings.vinylStyleSubBubble')
              : tr('settings.vinylStyleSub')}
          </Text>
          <View style={styles.vinyls}>
            {(Object.keys(VINYL) as VinylStyle[]).map(v => {
              const on = v === s.vinylStyle;
              return (
                <Pressable
                  key={v}
                  haptic="tick"
                  onPress={() =>
                    saveSettings({ vinylStyle: v, playerArt: 'vinyl' })
                  }
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.vinylOpt,
                    {
                      borderColor: on ? ACCENT : t.line,
                      backgroundColor: on ? t.fill2 : 'transparent',
                    },
                  ]}
                >
                  <Vinyl
                    uri={previewArt}
                    size={44}
                    small
                    vinylStyle={v}
                    palette={previewPalette}
                    spinning={false}
                    style={styles.vinylEdge}
                  />
                  <Text
                    numberOfLines={1}
                    style={[font(on ? 600 : 500, 12), { color: t.ink }]}
                  >
                    {VINYL[v].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <Section title={tr('settings.sectionAppearance')} />
      <View
        style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <Row
          title={tr('settings.theme')}
          divider
          right={
            <Segmented
              compact
              height={30}
              value={s.theme}
              onChange={theme => saveSettings({ theme })}
              options={[
                { value: 'light', label: tr('settings.themeLight') },
                { value: 'dark', label: tr('settings.themeDark') },
              ]}
            />
          }
        />
        <Row
          title={tr('settings.playerBackground')}
          sub={tr('settings.playerBackgroundSub')}
          divider
          right={
            <Segmented
              compact
              height={30}
              value={s.playerStyle}
              onChange={playerStyle => saveSettings({ playerStyle })}
              options={[
                { value: 'deep', label: tr('settings.bgDeep') },
                { value: 'light', label: tr('settings.bgLight') },
              ]}
            />
          }
        />
        <View
          style={[
            styles.block,
            { borderBottomWidth: 1, borderBottomColor: t.line },
          ]}
        >
          <Text style={[font(500, 15), { color: t.ink }]}>
            {tr('settings.songChange')}
          </Text>
          <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
            {tr(SONG_CHANGE_HINTS[s.songChange])}
          </Text>
          <View style={styles.mt10}>
            <Segmented
              value={s.songChange}
              onChange={songChange => saveSettings({ songChange })}
              options={[
                { value: 'slide', label: tr('settings.songSlide') },
                { value: 'fade', label: tr('settings.songFade') },
                { value: 'zoom', label: tr('settings.songZoom') },
                { value: 'flip', label: tr('settings.songFlip') },
              ]}
            />
          </View>
        </View>
        {keepScreenOnSupported() && (
          <Row
            title={tr('settings.keepScreenOn')}
            sub={tr('settings.keepScreenOnSub')}
            divider={hapticsSupported()}
            right={
              <Toggle
                value={s.keepScreenOn}
                onChange={v => saveSettings({ keepScreenOn: v })}
              />
            }
          />
        )}
        {hapticsSupported() && (
          <Row
            title={tr('settings.haptics')}
            sub={tr('settings.hapticsSub')}
            divider={s.haptics}
            right={
              <Toggle
                value={s.haptics}
                onChange={v => saveSettings({ haptics: v })}
              />
            }
          />
        )}
        {hapticsSupported() && s.haptics && (
          <Row
            title={tr('settings.hapticStrength')}
            right={
              <Segmented
                compact
                height={30}
                value={s.hapticStrength}
                onChange={hapticStrength => saveSettings({ hapticStrength })}
                options={[
                  { value: 'light', label: tr('settings.hapticLight') },
                  { value: 'medium', label: tr('settings.hapticMedium') },
                  { value: 'strong', label: tr('settings.hapticStrong') },
                ]}
              />
            }
          />
        )}
      </View>

      <Section title={tr('settings.sectionLanguage')} />
      <View
        style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}
      >
        <View style={styles.block}>
          <Text style={[font(500, 15), { color: t.ink }]}>
            {tr('settings.language')}
          </Text>
          <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
            {tr('settings.languageSub')}
          </Text>
          <View style={styles.presets}>
            <Chip
              label={tr('settings.languagePhone', {
                name:
                  LANGUAGES.find(l => l.code === deviceLanguage())?.name ?? '',
              })}
              on={s.language === 'system'}
              onPress={() => setLanguage('system')}
            />
            {LANGUAGES.map(l => (
              <Chip
                key={l.code}
                label={l.name}
                on={s.language === l.code}
                onPress={() => setLanguage(l.code)}
              />
            ))}
          </View>
        </View>
      </View>

      <Section title={tr('settings.sectionSources')} />
      <View
        style={[
          styles.card,
          styles.cardPad,
          { backgroundColor: t.card, borderColor: t.line },
        ]}
      >
        <Text style={[font(500, 15), styles.mb10, { color: t.ink }]}>
          YouTube
        </Text>
        <Segmented
          compact
          height={30}
          value={s.youtubeBackend}
          onChange={(youtubeBackend: YoutubeBackend) =>
            saveSettings({ youtubeBackend })
          }
          options={[
            { value: 'device', label: tr('settings.youtubeDevice') },
            { value: 'invidious', label: 'Invidious' },
            { value: 'piped', label: 'Piped' },
          ]}
        />
        {s.youtubeBackend === 'device' ? (
          <Text style={[font(400, 12, 1.4), styles.mt10, { color: t.muted }]}>
            {tr('settings.youtubeDeviceHint')}
          </Text>
        ) : (
          <>
            <Field
              label={tr('settings.instanceUrl')}
              value={s.youtubeInstance}
              placeholder={
                s.youtubeBackend === 'piped'
                  ? 'https://pipedapi.example.com'
                  : 'https://inv.example.com'
              }
              keyboardType="url"
              onSave={v => saveSettings({ youtubeInstance: v })}
            />
            <Text style={[font(400, 12, 1.4), { color: t.muted }]}>
              {tr('settings.instanceHint', {
                onPhone: tr('settings.youtubeDevice'),
              })}
            </Text>
          </>
        )}
        <View style={[styles.divider, { backgroundColor: t.line }]} />
        <Text style={[font(500, 15), { color: t.ink }]}>Jamendo</Text>
        <Field
          label={tr('settings.jamendoClientId')}
          value={s.jamendoClientId}
          placeholder={tr('settings.jamendoPlaceholder')}
          onSave={v => saveSettings({ jamendoClientId: v.trim() })}
        />
        {online && (
          <Text
            style={[font(500, 13), { color: t.accentInk }]}
            onPress={() => Linking.openURL('https://devportal.jamendo.com')}
          >
            {tr('settings.jamendoGet')}
          </Text>
        )}
      </View>

      {Platform.OS === 'android' && (
        <>
          <Section title={tr('settings.sectionPhone')} />
          <View
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.line },
            ]}
          >
            <Row
              title={tr(scanning ? 'settings.scanning' : 'settings.scan')}
              sub={tr('settings.scanSub')}
              onPress={scanning ? undefined : scan}
              right={<ChevronRightIcon color={t.muted} />}
            />
          </View>
        </>
      )}

      {updatesSupported() && (
        <>
          <Section title={tr('settings.sectionApp')} />
          <View
            style={[
              styles.card,
              { backgroundColor: t.card, borderColor: t.line },
            ]}
          >
            <Row
              title={tr(
                checking ? 'settings.checking' : 'settings.checkUpdates',
              )}
              sub={tr('settings.checkUpdatesSub')}
              onPress={checking ? undefined : checkUpdates}
              right={<ChevronRightIcon color={t.muted} />}
            />
          </View>
        </>
      )}

      <View style={styles.about}>
        <LogoMark size={40} />
        <View style={styles.flex}>
          <Text style={[font(700, 17), { color: t.ink, letterSpacing: -0.5 }]}>
            stash
          </Text>
          <Text style={[mono(400, 12), { color: t.muted }]}>
            {tr('settings.aboutVersion', { version: version?.name || '2.0' })}
            {version?.debug ? ` (${tr('settings.aboutDev')})` : ''}
            {Platform.OS === 'android' ? ` · ${tr('settings.aboutAuto')}` : ''}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Section({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text style={[eyebrow(), styles.section, { color: t.muted }]}>{title}</Text>
  );
}

function Row({
  title,
  sub,
  right,
  divider,
  onPress,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  divider?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.row,
        divider && { borderBottomWidth: 1, borderBottomColor: t.line },
      ]}
    >
      <View style={styles.flex}>
        <Text style={[font(500, 15), { color: t.ink }]}>{title}</Text>
        {!!sub && (
          <Text style={[font(400, 12, 1.4), styles.mt2, { color: t.muted }]}>
            {sub}
          </Text>
        )}
      </View>
      {right}
    </Pressable>
  );
}

function Field({
  label,
  value,
  placeholder,
  keyboardType,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  keyboardType?: 'url';
  onSave: (v: string) => void;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[font(400, 12), styles.mb6, { color: t.muted }]}>
        {label}
      </Text>
      <TextInput
        defaultValue={value}
        placeholder={placeholder}
        placeholderTextColor={t.muted2}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onEndEditing={e => onSave(e.nativeEvent.text)}
        style={[
          font(400, 15),
          styles.input,
          { backgroundColor: t.bg, borderColor: t.line2, color: t.ink },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: 24 },
  flex: { flex: 1, minWidth: 0 },
  h1: {
    ...font(700, 34, 1.05),
    letterSpacing: -1,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  section: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8 },
  card: {
    marginHorizontal: 20,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardPad: { padding: 16 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  track: { marginTop: 12, height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  warn: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  mt2: { marginTop: 2 },
  mt8: { marginTop: 8 },
  mt10: { marginTop: 10 },
  mt20: { marginTop: 20 },
  mb6: { marginBottom: 6 },
  mb10: { marginBottom: 10 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  field: { marginTop: 12, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  divider: { height: 1, marginVertical: 16 },
  block: { paddingHorizontal: 16, paddingVertical: 14 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  swatch: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden' },
  swatchOff: { borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  swatchHalf: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '50%',
  },
  vinyls: { flexDirection: 'row', gap: 8, marginTop: 12 },
  vinylOpt: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 7,
  },
  vinylEdge: { boxShadow: '0px 0px 0px 1px rgba(0,0,0,0.2)' },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  about: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
    marginHorizontal: 20,
  },
});
