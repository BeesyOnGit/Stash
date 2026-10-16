/** Huddle on the phone: the lobby (start or join) and the room (now playing or Guess the song, shared playlist, chat). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import {
  DEFAULT_EMOS,
  EMO_CATS,
  HUDDLE_COLORS,
  QUICK_EMOS,
  huddle,
  huddleColor,
  pickDecoys,
  saveToLibrary,
  tasteMatch,
  useHuddle,
  type HuddleChat,
  type HuddleFloat,
  type HuddleView,
  type RoomState,
  type SharedTrack,
} from '../huddle';
import { ago, callStatus, chatText, errorText, gameText, joinVoiceText, lastText, memberSub, recapOf, sourceText, statusText, vibeText, voiceStatus } from '../huddle/labels';
import { tr, type Key } from '../i18n';
import { navigationRef } from '../navigation/ref';
import { useDownloadProgress, useLibrary } from '../player/hooks';
import { saveSettings, useSettings } from '../services/settings';
import { searchOnline } from '../sources';
import { toast } from '../state/ui';
import { ACCENT, font, formatTime, mono, paletteFor, useTheme, eyebrow } from '../theme';
import { artworkUri, type OnlineResult, type Track } from '../types';
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  DownloadIcon,
  GripIcon,
  MicIcon,
  MoreIcon,
  NextIcon,
  PauseIcon,
  PlayRoundIcon,
  PlusIcon,
  PrevIcon,
  SearchIcon,
} from '../ui/icons';
import { Pressable } from '../ui/Pressable';
import { Cover, Segmented } from '../ui/primitives';
import { useReorder } from '../ui/reorder';
import { useKeyboardHeight } from '../ui/Sheet';

const PeopleIcon = ({ size = 18, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={9} cy={8} r={3.2} />
    <Path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M16 5.2a3 3 0 010 5.6M17.5 14.4c1.7.6 2.8 2.2 3.1 4.6" />
  </Svg>
);

const QuestionIcon = ({ size = 16, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={12} cy={12} r={9} />
    <Path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01" />
  </Svg>
);

const SmileIcon = ({ color }: { color: string }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={12} cy={12} r={9} />
    <Path d="M8.5 14.5c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7M9 9.5h.01M15 9.5h.01" />
  </Svg>
);

const PencilIcon = ({ color, size = 13 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z" />
  </Svg>
);

/** The round button in the Library header; shows how many are listening while you're in a huddle. */
export function HuddleButton() {
  const t = useTheme();
  const room = useHuddle().room;
  return (
    <Pressable
      onPress={() => navigationRef.isReady() && navigationRef.navigate('Huddle')}
      accessibilityLabel={tr('huddle.nav')}
      style={[styles.headBtn, { borderColor: t.line, backgroundColor: t.card }]}
    >
      <PeopleIcon color={t.ink} />
      {room && (
        <View style={styles.headBadge}>
          <Text style={[mono(600, 10), { color: '#fff' }]}>{room.members.length}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function HuddleScreen() {
  const v = useHuddle();
  return v.room ? <Room v={v} room={v.room} /> : <Lobby v={v} />;
}

/**
 * Room the keyboard takes at the bottom. The app draws edge to edge, so Android
 * doesn't resize the screen for it: inputs are lifted by hand, or they'd be hidden.
 */
function useKeyboardSpace() {
  const kb = useKeyboardHeight();
  const insets = useSafeAreaInsets();
  return kb && Platform.OS === 'android' ? kb + insets.bottom : kb;
}

const goBack = () => navigationRef.isReady() && navigationRef.canGoBack() && navigationRef.goBack();
const initial = (name: string) => name[0]?.toUpperCase() ?? '?';

// ---------- lobby ----------

function Lobby({ v }: { v: HuddleView }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const busy = v.status !== 'idle';
  const me = () => ({ name: settings.huddleName.trim() || 'Guest', color: settings.huddleColor });
  const create = () => !busy && huddle.create(me(), roomName.trim());
  const join = () => !busy && code.length === 6 && huddle.join(me(), code);
  const input = [styles.input, { borderColor: t.line2, backgroundColor: t.bg, color: t.ink }];
  const card = [styles.card, { backgroundColor: t.card, borderColor: t.line }];
  const big = (on: boolean) => [styles.bigBtn, { backgroundColor: on ? ACCENT : t.fill2 }];
  const kb = useKeyboardSpace();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingBottom: kb }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} style={[styles.backPill, { backgroundColor: t.fill2 }]}>
          <ChevronLeftIcon size={18} color={t.ink} />
          <Text style={[font(500, 14), { color: t.ink }]}>{tr('huddle.back')}</Text>
        </Pressable>
        <Text style={[eyebrow(), { color: t.muted, marginTop: 26 }]}>{tr('huddle.nav')}</Text>
        <Text style={[font(700, 34, 1.05), { color: t.ink, letterSpacing: -1.2, marginTop: 6 }]}>{tr('huddle.title')}</Text>
        <Text style={[font(400, 15, 1.5), { color: t.ink2, marginTop: 10 }]}>{tr('huddle.intro')}</Text>

        <Text style={[font(500, 13), styles.label, { color: t.muted }]}>{tr('huddle.yourName')}</Text>
        <View style={styles.nameRow}>
          <View style={[styles.meAvatar, { backgroundColor: huddleColor(settings.huddleColor) }]}>
            <Text style={[font(600, 18), { color: '#fff' }]}>{initial(settings.huddleName.trim() || 'Guest')}</Text>
          </View>
          <TextInput value={settings.huddleName} maxLength={24} onChangeText={x => saveSettings({ huddleName: x })} placeholder="Guest" placeholderTextColor={t.muted2} style={[input, styles.flex]} />
        </View>
        <Text style={[font(500, 13), styles.label, { color: t.muted }]}>{tr('huddle.yourColor')}</Text>
        <View style={styles.swatches}>
          {HUDDLE_COLORS.map((c, i) => (
            <Pressable key={c} onPress={() => saveSettings({ huddleColor: i })} accessibilityLabel={`${tr('huddle.yourColor')} ${i + 1}`} style={[styles.swatch, { backgroundColor: c, borderColor: settings.huddleColor === i ? t.ink : 'transparent' }]}>
              {settings.huddleColor === i && <CheckIcon size={14} color="#fff" />}
            </Pressable>
          ))}
        </View>

        {v.error && (
          <View style={[styles.errBox, { backgroundColor: t.accentSoft }]}>
            <Text style={[font(500, 13), { color: t.accentInk }]}>{errorText(v.error)}</Text>
          </View>
        )}

        <View style={[card, { marginTop: 22 }]}>
          <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}><PlusIcon size={20} color={ACCENT} /></View>
          <Text style={[font(600, 19), { color: t.ink }]}>{tr('huddle.startTitle')}</Text>
          <Text style={[font(400, 14, 1.45), { color: t.muted }]}>{tr('huddle.startSub')}</Text>
          <TextInput value={roomName} onChangeText={setRoomName} onSubmitEditing={create} maxLength={40} placeholder={tr('huddle.namePh')} placeholderTextColor={t.muted2} style={input} />
          <Pressable onPress={create} style={big(!busy)}>
            <Text style={[font(600, 16), { color: busy ? t.muted : '#fff' }]}>{busy ? tr('huddle.connecting') : tr('huddle.start')}</Text>
          </Pressable>
        </View>
        <View style={[card, { marginTop: 12 }]}>
          <View style={[styles.iconBox, { backgroundColor: t.accentSoft }]}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth={2.2} strokeLinecap="round"><Path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" /></Svg>
          </View>
          <Text style={[font(600, 19), { color: t.ink }]}>{tr('huddle.joinTitle')}</Text>
          <Text style={[font(400, 14, 1.45), { color: t.muted }]}>{tr('huddle.joinSub')}</Text>
          <TextInput
            value={code}
            onChangeText={x => setCode(x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            onSubmitEditing={join}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="K7Q2MX"
            placeholderTextColor={t.muted2}
            style={[input, mono(600, 22), { textAlign: 'center', letterSpacing: 6 }]}
          />
          <Pressable onPress={join} style={big(code.length === 6 && !busy)}>
            <Text style={[font(600, 16), { color: code.length === 6 && !busy ? '#fff' : t.muted }]}>{busy ? tr('huddle.connecting') : tr('huddle.join')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ---------- room ----------

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

type Panel = null | 'members' | 'recap' | 'game';

function Room({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { playerStyle } = useSettings();
  const deep = playerStyle === 'deep';
  const cur = room.queue[room.index] ?? null;
  const pal = paletteFor(cur ?? { title: room.name, artist: null });
  const bg = deep ? pal.deep : pal.soft;
  const ink = deep ? '#F4F3F0' : pal.softInk;
  const inkA = (a: number) => (deep ? `rgba(244,243,240,${a})` : pal.inkA(a));
  const [pane, setPane] = useState<'list' | 'chat'>('list');
  const [editEmos, setEditEmos] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  useTicker(500);
  const kb = useKeyboardSpace();
  // While typing, only the room's header stays up top: the list or chat and its input get the room.
  const typing = kb > 0;
  const chip = { backgroundColor: deep ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)' };
  const share = () => Share.share({ message: room.code }).catch(() => {});
  const leave = () => {
    huddle.leave();
    goBack();
    toast(tr('huddle.left', { name: room.name }));
  };
  const menuItems: [string, () => void, boolean?][] = [
    [tr('huddle.members'), () => setPanel('members')],
    [tr('huddle.recap'), () => setPanel('recap')],
    [tr('huddle.copy'), share],
    [tr('huddle.leave'), leave, true],
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingBottom: kb }}>
      <StatusBar barStyle={deep ? 'light-content' : 'dark-content'} />
      <View style={{ backgroundColor: bg, paddingTop: insets.top, zIndex: 2 }}>
        {!!cur?.artwork && <Image source={{ uri: cur.artwork }} blurRadius={40} style={[StyleSheet.absoluteFill, { opacity: deep ? 0.45 : 0.3 }]} />}
        <View style={[styles.row, { zIndex: 5 }]}>
          <Pressable onPress={goBack} style={[styles.round36, chip]}><ChevronLeftIcon size={18} color={ink} /></Pressable>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[font(600, 16), { color: ink }]}>{room.name}</Text>
            <View style={styles.liveRow}>
              <View style={[styles.dot, { backgroundColor: v.status === 'live' ? ACCENT : '#888' }]} />
              <Text numberOfLines={1} style={[mono(500, 11), { color: ink, opacity: 0.8 }]}>
                {v.status === 'live' ? tr('huddle.live') : tr('huddle.reconnecting')} · {room.host === v.you ? tr('huddle.host') : tr('huddle.hostName', { name: room.members.find(m => m.id === room.host)?.name ?? '' })}
              </Text>
            </View>
          </View>
          <Pressable onPress={share} accessibilityLabel={tr('huddle.copy')} style={[styles.codeBtn, { borderColor: inkA(0.4) }]}>
            <Text style={[mono(600, 13), { color: ink, letterSpacing: 1.5 }]}>{room.code}</Text>
          </Pressable>
          <View>
            <Pressable onPress={() => setMenu(m => !m)} accessibilityLabel={tr('huddle.more')} style={[styles.round36, chip]}><MoreIcon color={ink} /></Pressable>
            {menu && (
              <View style={[styles.menu, { backgroundColor: t.card }]}>
                {menuItems.map(([label, fn, danger]) => (
                  <Pressable key={label} onPress={() => { setMenu(false); fn(); }} style={styles.menuItem}>
                    <Text style={[font(500, 14), { color: danger ? t.danger : t.ink }]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
        {!typing && <View style={[styles.row, { paddingTop: 12 }]}>
          <Pressable onPress={() => setPanel('members')} accessibilityLabel={tr('huddle.members')} style={styles.avatars}>
            {room.members.slice(0, 6).map(m => {
              const pct = m.id === v.you ? null : tasteMatch(room, v.you, m.id);
              return (
                <View key={m.id} style={[styles.avatar, { backgroundColor: huddleColor(m.color), borderColor: talking(v, m.id) ? TALKING : bg }]}>
                  <Text style={[font(600, 11), { color: '#fff' }]}>{initial(m.name)}</Text>
                  {pct != null && (
                    <View style={[styles.pct, { backgroundColor: ink }]}><Text style={[mono(600, 8), { color: bg }]}>{pct}%</Text></View>
                  )}
                </View>
              );
            })}
          </Pressable>
          <Text numberOfLines={1} style={[font(500, 13), styles.flex, { color: ink, opacity: 0.85 }]}>{tr('huddle.listening', { count: room.members.length })}</Text>
          {huddle.canVoice && !v.voice && (
            <Pressable onPress={joinVoice} accessibilityLabel={tr('huddle.joinVoiceHint')} style={[styles.leaveBtn, styles.liveRow, chip]}>
              <MicIcon size={15} color={ink} />
              <Text style={[font(500, 13), { color: ink }]}>{joinVoiceText(room, v.you)}</Text>
            </Pressable>
          )}
          {!room.game && (
            <Pressable onPress={() => setPanel('game')} style={[styles.leaveBtn, chip, styles.liveRow]}>
              <QuestionIcon color={ink} />
              <Text style={[font(600, 13), { color: ink }]}>{tr('huddle.guess')}</Text>
            </Pressable>
          )}
        </View>}
        {typing ? <View style={{ height: 12 }} /> : room.game ? <GameStage v={v} room={room} ink={ink} bg={bg} inkA={inkA} /> : <NowPlaying v={v} room={room} ink={ink} bg={bg} inkA={inkA} glow={pal.glow} artBg={pal.artBg} />}
        {!typing && <View style={styles.trayWrap}>
          <View style={[styles.tray, { backgroundColor: deep ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.6)' }]}>
            {room.emos.map(e => (
              <Pressable key={e} onPress={() => huddle.react(e)} haptic="tick" style={[styles.emo, v.mine[e] && { backgroundColor: inkA(0.16) }]}>
                <Text style={styles.emoText}>{e}</Text>
                {!!room.reactions?.[e] && (
                  <View style={[styles.count, { backgroundColor: ink }]}><Text style={[mono(600, 10), { color: bg }]}>{room.reactions[e]}</Text></View>
                )}
              </Pressable>
            ))}
            {room.host === v.you && (
              <Pressable onPress={() => setEditEmos(x => !x)} accessibilityLabel={tr('huddle.customize')} style={[styles.emo, editEmos && { backgroundColor: inkA(0.16) }]}>
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth={2} strokeLinecap="round"><Circle cx={10} cy={13} r={8} /><Path d="M7 15c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M19 2v6M16 5h6" /></Svg>
              </Pressable>
            )}
          </View>
        </View>}
        <Floats floats={v.floats} />
        {v.burst && <Burst key={`${v.burst.id}-${v.burst.n}`} emoji={v.burst.emoji} n={v.burst.n} />}
      </View>

      {editEmos && room.host === v.you ? (
        <EmoEditor room={room} onDone={() => setEditEmos(false)} />
      ) : (
        <View style={{ flex: 1, paddingBottom: typing || v.voice ? 0 : insets.bottom, backgroundColor: pal.glow.replace('hsl(', 'hsla(').replace(')', ', 0.07)') }}>
          <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 6 }}>
            <Segmented
              compact
              value={pane}
              onChange={setPane}
              options={[
                { value: 'list', label: tr('huddle.playlistTab', { count: room.queue.length }) },
                { value: 'chat', label: tr('huddle.chat') },
              ]}
            />
          </View>
          {pane === 'list' ? <Playlist v={v} room={room} /> : <Chat v={v} room={room} />}
        </View>
      )}
      {v.voice && !typing && <VoiceBar v={v} room={room} />}
      <Modal visible={panel === 'members'} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setPanel(null)}>
        <Members v={v} room={room} onClose={() => setPanel(null)} />
      </Modal>
      <Modal visible={panel === 'recap'} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={() => setPanel(null)}>
        <RecapCard room={room} deep={pal.deep} glow={pal.glow} onClose={() => setPanel(null)} />
      </Modal>
      <Modal visible={panel === 'game'} transparent statusBarTranslucent navigationBarTranslucent animationType="slide" onRequestClose={() => setPanel(null)}>
        <GamePicker room={room} onClose={() => setPanel(null)} />
      </Modal>
    </View>
  );
}

/** The ring on whoever is talking. */
const TALKING = '#3DBE7A';
const talking = (v: HuddleView, id: string) => !!v.voice?.speaking.includes(id);

const Icon = ({ color, size = 18, children }: { color: string; size?: number; children: React.ReactNode }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>
);
const MIC = <><Rect x={9} y={3} width={6} height={11} rx={3} /><Path d="M5 11a7 7 0 0014 0M12 18v3" /></>;
const MIC_OFF = <Path d="M15 9.3V6a3 3 0 00-5.7-1.3M9 9v2a3 3 0 004.6 2.5M5 11a7 7 0 0011.3 5.5M19 11a7 7 0 01-.6 2.8M12 18v3M3 3l18 18" />;
const DUCK = <><Path d="M9 18V5l10-2v7" /><Circle cx={6.5} cy={18} r={2.5} /><Path d="M17 14v7M14.5 18.5L17 21l2.5-2.5" /></>;
const HANG_UP = <Path d="M3 15.5c5-4.7 13-4.7 18 0l-2.3 2.3-3.2-1.6v-2.6a12 12 0 00-7 0v2.6l-3.2 1.6z" />;

async function joinVoice() {
  if (await huddle.joinVoice()) toast(tr('huddle.btHint'));
  else if (huddle.getView().room) toast(tr('huddle.voiceFailed'));
}

/** Who's in the call (a green ring on whoever is talking), mute, ducking and leave. */
function VoiceBar({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const voice = v.voice!;
  return (
    <View style={[styles.voiceBar, { backgroundColor: t.card, borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
      <View style={[styles.liveRow, { gap: 5 }]}>
        {voice.ids.map(id => {
          const m = room.members.find(x => x.id === id);
          return (
            <View key={id} style={[styles.voiceFace, { backgroundColor: huddleColor(m?.color ?? 7), borderColor: talking(v, id) ? TALKING : 'transparent' }]}>
              <Text style={[font(600, 11), { color: '#fff' }]}>{initial(m?.name ?? '?')}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.flex}>
        <View style={styles.liveRow}>
          <View style={[styles.dot, { backgroundColor: '#2F9E62' }]} />
          <Text numberOfLines={1} style={[font(600, 13), { color: t.ink }]}>{tr('huddle.callCount', { count: voice.ids.length })}</Text>
        </View>
        <Text numberOfLines={1} style={[font(400, 12), { color: t.muted, marginTop: 1 }]}>{callStatus(room, v.you, voice)}</Text>
      </View>
      <Pressable onPress={() => huddle.toggleMute()} disabled={!voice.live} accessibilityLabel={voice.muted ? tr('huddle.unmute') : tr('huddle.mute')} style={[styles.round40, { backgroundColor: voice.muted ? t.ink : t.fill2 }]}>
        <Icon color={voice.muted ? t.onInk : t.ink}>{voice.muted ? MIC_OFF : MIC}</Icon>
      </Pressable>
      <Pressable onPress={() => huddle.toggleDuck()} accessibilityRole="switch" accessibilityState={{ checked: voice.duck }} accessibilityLabel={voice.duck ? tr('huddle.duckOn') : tr('huddle.duck')} style={[styles.round40, { backgroundColor: voice.duck ? t.accentSoft : t.fill2 }]}>
        <Icon color={voice.duck ? t.accentInk : t.ink}>{DUCK}</Icon>
      </Pressable>
      <Pressable onPress={() => huddle.leaveVoice()} accessibilityLabel={tr('huddle.leaveVoice')} style={[styles.round40, { backgroundColor: '#C2421F' }]}>
        <Icon color="#fff">{HANG_UP}</Icon>
      </Pressable>
    </View>
  );
}

/** A glow behind the cover that breathes while the music plays. */
function Glow({ color, on }: { color: string; on: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return a.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(a, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [a, on]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.glow, { backgroundColor: color, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] }) }] }]}
    />
  );
}

function NowPlaying({ v, room, ink, bg, inkA, glow, artBg }: { v: HuddleView; room: RoomState; ink: string; bg: string; inkA: (a: number) => string; glow: string; artBg: string }) {
  const cur = room.queue[room.index] ?? null;
  const pos = huddle.position();
  const dur = cur?.duration ?? 0;
  const on = room.playing || room.pending;
  const status = statusText(v);
  const pill = status ?? (room.last ? lastText(room.last) : tr('huddle.shared'));
  const [barW, setBarW] = useState(1);
  const lib = useLibraryStatus();
  const shout = cur?.shout && v.shout?.key === cur.key && Date.now() - v.shout.at < 8000 ? cur : null;
  return (
    <>
      <View style={[styles.row, { paddingTop: 16 }]}>
        <View>
          <Glow color={glow} on={room.playing} />
          <Cover uri={cur?.artwork} size={88} radius={12} bg={artBg} />
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[font(700, 20), { color: ink, letterSpacing: -0.5 }]}>{cur?.title ?? tr('huddle.empty')}</Text>
          {!!cur && <Text numberOfLines={1} style={[font(400, 15), { color: ink, opacity: 0.8, marginTop: 2 }]}>{cur.artist}</Text>}
          {!!cur && (
            <View style={[styles.liveRow, { marginTop: 7 }]}>
              <View style={[styles.mini, { backgroundColor: huddleColor(cur.byColor) }]}><Text style={[font(600, 9), { color: '#fff' }]}>{initial(cur.byName)}</Text></View>
              <Text numberOfLines={1} style={[font(500, 12), styles.flex, { color: ink, opacity: 0.9 }]}>
                {tr('huddle.addedBy', { name: cur.by === v.you ? tr('huddle.you') : cur.byName, source: sourceText(cur) })}
              </Text>
            </View>
          )}
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Pressable
          haptic={false}
          onLayout={e => setBarW(e.nativeEvent.layout.width || 1)}
          onPress={e => dur && huddle.remote.seek(Math.max(0, Math.min(1, e.nativeEvent.locationX / barW)) * dur)}
          style={styles.seekHit}
        >
          <View style={[styles.seekTrack, { backgroundColor: inkA(0.18) }]}>
            <View style={[styles.seekFill, { backgroundColor: ink, width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }]} />
          </View>
        </Pressable>
        <View style={styles.times}>
          <Text style={[mono(500, 12), { color: ink, opacity: 0.75 }]}>{formatTime(pos)}</Text>
          <Text style={[mono(500, 12), { color: ink, opacity: 0.75 }]}>{formatTime(dur)}</Text>
        </View>
      </View>
      <View style={styles.controlsRow}>
        <View style={styles.side}>{cur && <DlButton t={cur} status={lib.get(cur.key)} color={ink} bg={inkA(0.1)} />}</View>
        <View style={styles.controls}>
          <Pressable onPress={huddle.remote.previous} style={styles.ctl}><PrevIcon size={26} color={ink} /></Pressable>
          <Pressable onPress={on ? huddle.remote.pause : huddle.remote.play} accessibilityLabel={tr('huddle.playForAll')} style={[styles.play, { backgroundColor: ink }]}>
            {on ? <PauseIcon size={22} color={bg} /> : <PlayRoundIcon size={22} color={bg} />}
          </Pressable>
          <Pressable onPress={huddle.remote.next} style={styles.ctl}><NextIcon size={26} color={ink} /></Pressable>
        </View>
        <View style={styles.side} />
      </View>
      <View style={styles.pillWrap}>
        <View style={[styles.pill, { backgroundColor: inkA(0.09), flexShrink: 0 }]}>
          <View style={[styles.dot, { backgroundColor: glow }]} />
          <Text style={[font(500, 12), { color: ink }]}>{vibeText(cur)}</Text>
        </View>
        {shout ? (
          <Pressable onPress={huddle.closeShout} style={[styles.pill, styles.shout]}>
            <View style={[styles.mini, { width: 20, height: 20, backgroundColor: huddleColor(shout.byColor) }]}><Text style={[font(600, 10), { color: '#fff' }]}>{initial(shout.byName)}</Text></View>
            <Text numberOfLines={1} style={[font(500, 12), { color: '#16161A', flexShrink: 1 }]}>
              <Text style={font(600, 12)}>{shout.by === v.you ? tr('huddle.yourShout') : tr('huddle.shoutBy', { name: shout.byName })}: </Text>“{shout.shout}”
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.pill, { backgroundColor: inkA(0.09) }]}>
            <View style={[styles.dot, { backgroundColor: !status && room.last ? huddleColor(room.last.color) : ink }]} />
            <Text numberOfLines={1} style={[font(500, 12), { color: ink, flexShrink: 1 }]}>{pill}</Text>
          </View>
        )}
      </View>
    </>
  );
}

function GameStage({ v, room, ink, bg, inkA }: { v: HuddleView; room: RoomState; ink: string; bg: string; inkA: (a: number) => string }) {
  const g = room.game!;
  const cur = room.queue[room.index] ?? null;
  const ask = g.phase === 'ask';
  const mine = g.by === v.you;
  const hide = ask && !mine;
  const [myPick, setMyPick] = useState<{ round: number; opt: number } | null>(null);
  const picked = g.picks?.find(p => p.who === v.you)?.opt ?? (myPick?.round === g.round ? myPick.opt : null);
  const left = g.start ? Math.max(0, Math.ceil((g.end - huddle.serverNow()) / 1000)) : 20;
  const pct = g.start ? Math.max(0, Math.min(1, (g.end - huddle.serverNow()) / (g.end - g.start))) : 1;
  const byMember = (id: string) => room.members.find(m => m.id === id);
  const guess = (i: number) => {
    if (!ask || mine || picked != null || !g.start) return;
    setMyPick({ round: g.round, opt: i });
    huddle.guess(i);
  };
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
      <View style={styles.liveRow}>
        <View style={[styles.gameArt, { backgroundColor: inkA(0.15) }]}>
          {!!cur?.artwork && <Image source={{ uri: cur.artwork }} blurRadius={hide ? 25 : 0} style={[StyleSheet.absoluteFill, hide && { transform: [{ scale: 1.25 }] }]} />}
          {hide && <View style={styles.center}><QuestionIcon size={34} color="#fff" /></View>}
        </View>
        <View style={[styles.flex, { marginLeft: 14 }]}>
          <Text style={[eyebrow(), { color: ink, opacity: 0.85 }]}>{tr('huddle.round', { n: g.round })} · {tr('huddle.guess')}</Text>
          {ask && (
            <>
              <Text style={[mono(700, 32), { color: ink, marginTop: 4 }]}>{left} <Text style={[font(500, 13), { color: ink, opacity: 0.8 }]}>{tr('huddle.secLeft')}</Text></Text>
              <View style={[styles.seekTrack, { backgroundColor: inkA(0.18), marginTop: 8 }]}><View style={[styles.seekFill, { backgroundColor: ink, width: `${pct * 100}%` }]} /></View>
            </>
          )}
          {!hide && !!cur && (
            <>
              <Text numberOfLines={1} style={[font(700, 19), { color: ink, marginTop: 4 }]}>{cur.title}</Text>
              <Text numberOfLines={1} style={[font(400, 14), { color: ink, opacity: 0.8 }]}>{cur.artist}</Text>
            </>
          )}
          <Text style={[font(400, 12), { color: ink, opacity: 0.8, marginTop: 6 }]}>{mine ? (ask ? tr('huddle.yourPickSecret') : tr('huddle.yourPick')) : tr('huddle.pickedBy', { name: g.byName })}</Text>
        </View>
      </View>
      <View style={styles.opts}>
        {g.opts.map((o, i) => {
          const right = g.answer === i;
          let back = inkA(0.11), fore = ink, op = 1;
          if (ask) {
            if (picked === i) [back, fore] = [ink, bg];
            else if (picked != null || mine) op = 0.6;
          } else if (right) [back, fore] = ['#23804F', '#fff'];
          else if (picked === i) [back, fore] = ['#C2421F', '#fff'];
          else op = 0.5;
          const votes = (g.picks ?? []).filter(p => p.opt === i).map(p => byMember(p.who)).filter(Boolean);
          return (
            <Pressable key={i} onPress={() => guess(i)} style={[styles.opt, { backgroundColor: back, opacity: op }]}>
              <Text numberOfLines={1} style={[font(600, 14), { color: fore }]}>{o.title}</Text>
              <Text numberOfLines={1} style={[font(400, 12), { color: fore, opacity: 0.75 }]}>{o.artist}</Text>
              {votes.length > 0 && (
                <View style={styles.votes}>
                  {votes.map(m => (
                    <View key={m!.id} style={[styles.vote, { backgroundColor: huddleColor(m!.color), borderColor: bg }]}><Text style={[font(600, 9), { color: '#fff' }]}>{initial(m!.name)}</Text></View>
                  ))}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <View style={[styles.pillWrap, { paddingHorizontal: 0 }]}>
        <View style={[styles.pill, { backgroundColor: inkA(0.09) }]}><Text style={[font(500, 12), { color: ink }]}>{gameText(v)}</Text></View>
      </View>
      {!ask && room.scores.length > 0 && (
        <View style={[styles.pillWrap, { flexWrap: 'wrap', paddingHorizontal: 0 }]}>
          {room.scores.slice(0, 4).map(s => {
            const won = g.results.find(r => r.who === s.id);
            return (
              <View key={s.id} style={[styles.pill, { backgroundColor: inkA(0.1), paddingLeft: 4 }]}>
                <View style={[styles.mini, { width: 20, height: 20, backgroundColor: huddleColor(s.color) }]}><Text style={[font(600, 10), { color: '#fff' }]}>{initial(s.name)}</Text></View>
                <Text style={[font(500, 12), { color: ink }]}>{s.id === v.you ? tr('huddle.you') : s.name} · {s.pts}{won ? ` (+${won.pts})` : ''}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function FloatView({ f }: { f: HuddleFloat }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 3200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [a]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.float,
        {
          left: `${f.x}%`,
          opacity: a.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -300] }) }, { scale: a.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0.4, 1, 1] }) }],
        },
      ]}
    >
      <Text style={{ fontSize: 30 }}>{f.emoji}</Text>
      <Text style={[font(500, 11), styles.floatName]}>{f.name}</Text>
    </Animated.View>
  );
}

function Floats({ floats }: { floats: HuddleFloat[] }) {
  return (
    <View pointerEvents="none" style={styles.floats}>
      {floats.map(f => <FloatView key={f.id} f={f} />)}
    </View>
  );
}

/** A reaction streak: the emoji big in the middle, with "4× streak". */
function Burst({ emoji, n }: { emoji: string; n: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 2000, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      <Animated.View
        style={{
          alignItems: 'center',
          gap: 8,
          opacity: a.interpolate({ inputRange: [0, 0.14, 0.78, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ scale: a.interpolate({ inputRange: [0, 0.14, 0.24, 1], outputRange: [0.3, 1.15, 1, 1.04] }) }],
        }}
      >
        <Text style={{ fontSize: 80 }}>{emoji}</Text>
        <View style={styles.streak}><Text style={[font(700, 16), { color: '#fff' }]}>{tr('huddle.streak', { n })}</Text></View>
      </Animated.View>
    </View>
  );
}

/** Emoji by category: the chat's picker and the host's reaction editor. */
function EmojiGrid({ onPick, dim, height = 220 }: { onPick: (e: string) => void; dim?: (e: string) => boolean; height?: number }) {
  const t = useTheme();
  const [cat, setCat] = useState(0);
  return (
    <View>
      <View style={styles.cats}>
        {EMO_CATS.map(([name, icon], i) => (
          <Pressable key={name} onPress={() => setCat(i)} accessibilityLabel={tr(`huddle.cat.${name}` as Key)} style={[styles.cat, { backgroundColor: i === cat ? t.fill2 : 'transparent', opacity: i === cat ? 1 : 0.6 }]}>
            <Text style={{ fontSize: 17 }}>{icon}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView style={{ height }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <View style={styles.lib}>
          {EMO_CATS[cat][2].map(e => (
            <Pressable key={e} onPress={() => onPick(e)} style={[styles.libCell, { opacity: dim?.(e) ? 0.3 : 1 }]}>
              <Text style={styles.slotText}>{e}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const MAX_EMOS = 8;

function EmoEditor({ room, onDone }: { room: RoomState; onDone: () => void }) {
  const t = useTheme();
  const [slot, setSlot] = useState<number | null>(null);
  const emos = room.emos;
  const pick = (e: string) => {
    if (emos.includes(e)) return;
    if (slot != null) {
      huddle.setEmos(emos.map((x, i) => (i === slot ? e : x)));
      setSlot(null);
    } else if (emos.length < MAX_EMOS) huddle.setEmos([...emos, e]);
    else toast(tr('huddle.maxEmos'));
  };
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={styles.editorHead}>
        <Text style={[font(600, 15), { color: t.ink }]}>{tr('huddle.reactions')}</Text>
        <Text style={[font(400, 12), { color: t.muted, flexShrink: 1, textAlign: 'right' }]}>
          {slot != null ? tr('huddle.pick') : emos.length < MAX_EMOS ? tr('huddle.tapToAdd') : tr('huddle.tapToSwap')}
        </Text>
      </View>
      <View style={styles.slots}>
        {emos.map((e, i) => (
          <View key={e}>
            <Pressable onPress={() => setSlot(slot === i ? null : i)} style={[styles.slot, { backgroundColor: t.fill2, borderColor: slot === i ? ACCENT : 'transparent' }]}>
              <Text style={styles.slotText}>{e}</Text>
            </Pressable>
            {emos.length > 3 && (
              <Pressable onPress={() => { huddle.setEmos(emos.filter((_, j) => j !== i)); setSlot(null); }} hitSlop={6} style={[styles.slotX, { backgroundColor: t.ink, borderColor: t.bg }]}>
                <CloseIcon size={7} color={t.onInk} />
              </Pressable>
            )}
          </View>
        ))}
      </View>
      <View style={[{ marginTop: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, flex: 1 }]}>
        <EmojiGrid onPick={pick} dim={e => emos.includes(e)} height={260} />
      </View>
      <View style={styles.editorFoot}>
        <Pressable onPress={() => { huddle.setEmos(DEFAULT_EMOS); setSlot(null); }}>
          <Text style={[font(500, 13), { color: t.muted }]}>{tr('huddle.reset')}</Text>
        </Pressable>
        <Pressable onPress={onDone} style={styles.doneBtn}>
          <Text style={[font(600, 13), { color: '#fff' }]}>{tr('huddle.done')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------- downloads ----------

/** Library status by track id (a huddle song's key is its library id). */
function useLibraryStatus() {
  const { tracks } = useLibrary();
  return useMemo(() => new Map(tracks.map(x => [x.id, x.status])), [tracks]);
}

function DlButton({ t, status, color, bg }: { t: SharedTrack; status: string | undefined; color: string; bg?: string }) {
  const p = useDownloadProgress(t.key);
  if (status === 'ready') return <View accessibilityLabel={tr('huddle.downloaded')} style={styles.dl}><CheckIcon size={15} color={color} /></View>;
  if (status === 'downloading' || p != null)
    return <View accessibilityLabel={tr('huddle.downloading', { pct: Math.round((p ?? 0) * 100) })} style={styles.dl}><Text style={[mono(600, 10), { color: ACCENT }]}>{Math.round((p ?? 0) * 100)}%</Text></View>;
  return (
    <Pressable
      onPress={() => {
        saveToLibrary(t);
        toast(tr('huddle.downloadStarted', { title: t.title }));
      }}
      accessibilityLabel={tr('huddle.download')}
      style={[styles.dl, bg ? { backgroundColor: bg } : null]}
    >
      <DownloadIcon size={16} color={color} />
    </Pressable>
  );
}

// ---------- shared playlist ----------

function Playlist({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const mins = Math.round(room.queue.reduce((a, x) => a + (x.duration ?? 0), 0) / 60);
  const reorder = useReorder(room.queue.length, huddle.move);
  const lib = useLibraryStatus();
  const g = room.game;
  // While others guess, the list doesn't give away which song is playing.
  const hideCur = !!g && g.phase === 'ask' && g.by !== v.you;
  return (
    <View style={styles.flex}>
      <View style={styles.listHead}>
        <Text numberOfLines={1} style={[font(400, 12), styles.flex, { color: t.muted }]}>
          {tr('common.songs', { count: room.queue.length })} · {tr('huddle.minutes', { min: mins })}
        </Text>
        <Pressable onPress={() => setAdding(x => !x)} style={[styles.addBtn, { backgroundColor: adding ? t.fill2 : t.ink }]}>
          {!adding && <PlusIcon size={14} color={t.onInk} />}
          <Text style={[font(500, 13), { color: adding ? t.ink : t.onInk }]}>{adding ? tr('huddle.done') : tr('huddle.addSongs')}</Text>
        </Pressable>
      </View>
      {adding ? (
        <AddSongs room={room} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }} scrollEnabled={!reorder.dragging}>
          {room.queue.map((x, i) => {
            const isCur = i === room.index && !hideCur;
            const c = v.cache[x.key];
            const mine = x.by === v.you || room.host === v.you;
            const canRemove = mine && i !== room.index;
            return (
              <Animated.View key={x.key} style={reorder.rowStyle(i)}>
                <Pressable
                  onLayout={i === 0 ? reorder.measure : undefined}
                  onPress={() => !g && huddle.remote.skipTo(i)}
                  style={[styles.qRow, { backgroundColor: isCur ? t.accentSoft : 'transparent', opacity: i < room.index && !hideCur ? 0.5 : 1 }]}
                >
                  <View>
                    <Cover uri={x.artwork} size={44} radius={8} bg={paletteFor(x).artBg} />
                    {typeof c === 'number' && (
                      <View style={styles.progTrack}><View style={[styles.progFill, { width: `${c * 100}%` }]} /></View>
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={[font(500, 15), { color: isCur ? ACCENT : t.ink }]}>{x.title}</Text>
                    <View style={styles.liveRow}>
                      <View style={[styles.mini, { width: 14, height: 14, backgroundColor: huddleColor(x.byColor) }]}><Text style={[font(600, 8), { color: '#fff' }]}>{initial(x.byName)}</Text></View>
                      <Text numberOfLines={1} style={[font(400, 12), styles.flex, { color: t.muted }]}>{x.byName} · {sourceText(x)}</Text>
                    </View>
                    {!!x.shout && <Text numberOfLines={1} style={[font(400, 12), { color: t.ink2, fontStyle: 'italic' }]}>“{x.shout}”</Text>}
                  </View>
                  <DlButton t={x} status={lib.get(x.key)} color={t.muted} />
                  {canRemove && (
                    <Pressable onPress={() => huddle.remove(x.key)} hitSlop={6} accessibilityLabel={tr('huddle.remove')} style={styles.rm}>
                      <CloseIcon size={11} color={t.muted} />
                    </Pressable>
                  )}
                  {mine ? (
                    <View {...reorder.handle(i)} hitSlop={8} accessibilityLabel={tr('huddle.drag')} style={styles.grip}>
                      <GripIcon color={t.muted} />
                    </View>
                  ) : (
                    <View style={{ width: 30 }} />
                  )}
                </Pressable>
              </Animated.View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function AddSongs({ room }: { room: RoomState }) {
  const t = useTheme();
  const { tracks } = useLibrary();
  const [tab, setTab] = useState<'device' | 'search'>('device');
  const [q, setQ] = useState('');
  const [shout, setShout] = useState('');
  const inQueue = useMemo(() => new Set(room.queue.map(x => x.key)), [room.queue]);
  const found = useOnlineSearch(tab === 'search' ? q : '');

  const ql = q.trim().toLowerCase();
  // The shoutout goes with the next song added, then clears.
  const withShout = (add: (shout: string) => void) => () => {
    add(shout.trim());
    setShout('');
  };
  const rows: { id: string; title: string; artist: string | null; art: string | null; tag: string; added: boolean; add: () => void }[] =
    tab === 'device'
      ? tracks
          .filter(x => x.status === 'ready' && x.source !== 'device' && (!ql || `${x.title} ${x.artist ?? ''} ${x.genre ?? ''}`.toLowerCase().includes(ql)))
          .slice(0, 60)
          .map(x => ({ id: x.id, title: x.title, artist: x.artist, art: artworkUri(x), tag: tr('huddle.onDevice'), added: inQueue.has(x.id), add: withShout(s => addLibrary(x, s)) }))
      : found.map(r => ({ id: `${r.source}:${r.sourceId}`, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, added: inQueue.has(`${r.source}:${r.sourceId}`), add: withShout(s => addResult(r, s)) }));

  return (
    <View style={styles.flex}>
      <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
        <Segmented compact value={tab} onChange={setTab} options={[{ value: 'device', label: tr('huddle.onDevice') }, { value: 'search', label: tr('huddle.search') }]} />
        <View style={[styles.searchBox, { backgroundColor: t.fill2 }]}>
          <SearchIcon size={15} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={tab === 'device' ? tr('huddle.filterLib') : tr('huddle.searchSources')} placeholderTextColor={t.muted2} style={[font(400, 15), styles.flex, { color: t.ink, padding: 0 }]} />
        </View>
        <View style={[styles.searchBox, styles.shoutBox, { borderColor: t.line2 }]}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={t.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></Svg>
          <TextInput value={shout} maxLength={80} onChangeText={setShout} placeholder={tr('huddle.shoutPh')} placeholderTextColor={t.muted2} style={[font(400, 14), styles.flex, { color: t.ink, padding: 0 }]} />
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 24 }}
        ListEmptyComponent={<Text style={[font(400, 14), { color: t.muted, textAlign: 'center', padding: 24 }]}>{tr('huddle.noMatches')}</Text>}
        renderItem={({ item: r }) => (
          <View style={styles.qRow}>
            <Cover uri={r.art} size={44} radius={8} bg={t.fill3} />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={[font(500, 15), { color: t.ink }]}>{r.title}</Text>
              <Text numberOfLines={1} style={[font(400, 13), { color: t.muted }]}>{r.artist} · {r.tag}</Text>
            </View>
            {r.added ? (
              <View style={[styles.addRound, { backgroundColor: ACCENT, borderColor: ACCENT }]}><CheckIcon size={14} color="#fff" /></View>
            ) : (
              <Pressable onPress={r.add} style={[styles.addRound, { borderColor: t.line2 }]}><PlusIcon size={15} color={t.ink} /></Pressable>
            )}
          </View>
        )}
      />
    </View>
  );
}

/** Free sources searched as you type (debounced). */
function useOnlineSearch(q: string) {
  const [found, setFound] = useState<OnlineResult[]>([]);
  useEffect(() => {
    if (!q.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => searchOnline(q.trim(), (_, r) => live && setFound(r)).catch(() => {}), 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);
  return found;
}

function addResult(r: OnlineResult, shout = '') {
  huddle.addOnline({ source: r.source, sourceId: r.sourceId, title: r.title, artist: r.artist, album: r.album, duration: r.duration, artwork: r.thumbnailUrl, shout: shout || null });
}

/** Library songs are shared by their link; everyone downloads them from the same source. */
function addLibrary(x: Track, shout = '') {
  if (x.source === 'device') return;
  huddle.addOnline({ source: x.source, sourceId: x.sourceId, title: x.title, artist: x.artist, album: x.album, duration: x.duration, artwork: x.remoteArtworkUrl, genre: x.genre, shout: shout || null });
}

// ---------- Guess the song ----------

/** Starts a round: wrong answers come from the shared playlist and your library. */
function startRound(right: { key: string; title: string; artist: string | null; genre?: string | null }, library: Track[], add?: () => void) {
  const room = huddle.getView().room;
  if (!room) return false;
  const decoys = pickDecoys(right, [...room.queue, ...library]);
  if (!decoys.length) {
    toast(tr('huddle.needDecoys'));
    return false;
  }
  add?.();
  huddle.startGame(right.key, decoys);
  return true;
}

function GamePicker({ room, onClose }: { room: RoomState; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tracks } = useLibrary();
  const [tab, setTab] = useState<'list' | 'search'>('list');
  const [q, setQ] = useState('');
  const found = useOnlineSearch(tab === 'search' ? q : '');
  const ql = q.trim().toLowerCase();
  const match = (x: { title: string; artist: string | null }) => !ql || `${x.title} ${x.artist ?? ''}`.toLowerCase().includes(ql);
  const cur = room.queue[room.index]?.key;
  const inQueue = new Set(room.queue.map(x => x.key));
  const lib = tracks.filter(x => x.status === 'ready' && x.source !== 'device');
  const go = (ok: boolean) => ok && onClose();
  const kb = useKeyboardSpace();
  const rows: { id: string; title: string; artist: string | null; art: string | null; tag: string; pick: () => void }[] =
    tab === 'list'
      ? room.queue.filter(x => x.key !== cur && match(x)).map(x => ({ id: x.key, title: x.title, artist: x.artist, art: x.artwork, tag: tr('huddle.inPlaylist'), pick: () => go(startRound(x, lib)) }))
      : [
          ...lib.filter(x => x.id !== cur && match(x)).slice(0, 12).map(x => ({ id: x.id, title: x.title, artist: x.artist, art: artworkUri(x), tag: tr('huddle.onDevice'), pick: () => go(startRound({ ...x, key: x.id }, lib, inQueue.has(x.id) ? undefined : () => addLibrary(x))) })),
          ...found.map(r => {
            const key = `${r.source}:${r.sourceId}`;
            return { id: key, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, pick: () => go(startRound({ ...r, key }, lib, inQueue.has(key) ? undefined : () => addResult(r))) };
          }),
        ];
  return (
    <View style={[styles.sheetBack, { paddingBottom: kb, paddingTop: insets.top + 12 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} haptic={false} />
      <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: kb ? 12 : insets.bottom + 12 }, kb ? { minHeight: 0, maxHeight: '100%', flex: 1 } : null]}>
        <View style={styles.editorHead}>
          <View style={styles.flex}>
            <Text style={[font(600, 18), { color: t.ink }]}>{tr('huddle.pickTitle')}</Text>
            <Text style={[font(400, 13, 1.45), { color: t.muted, marginTop: 3 }]}>{tr('huddle.pickSub')}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityLabel={tr('huddle.close')} style={[styles.round32, { backgroundColor: t.fill2 }]}><CloseIcon size={12} color={t.ink} /></Pressable>
        </View>
        <View style={{ marginTop: 14, gap: 8 }}>
          <Segmented compact value={tab} onChange={setTab} options={[{ value: 'list', label: tr('huddle.playlist') }, { value: 'search', label: tr('huddle.search') }]} />
          <View style={[styles.searchBox, { backgroundColor: t.fill2 }]}>
            <SearchIcon size={15} color={t.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder={tab === 'list' ? tr('huddle.filterLib') : tr('huddle.searchSources')} placeholderTextColor={t.muted2} style={[font(400, 15), styles.flex, { color: t.ink, padding: 0 }]} />
          </View>
        </View>
        <FlatList
          style={{ marginTop: 8, marginHorizontal: -8 }}
          data={rows}
          keyExtractor={r => r.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={[font(400, 14), { color: t.muted, textAlign: 'center', padding: 24 }]}>{tr('huddle.noMatches')}</Text>}
          renderItem={({ item: r }) => (
            <Pressable onPress={r.pick} style={styles.qRow}>
              <Cover uri={r.art} size={44} radius={8} bg={t.fill3} />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={[font(500, 15), { color: t.ink }]}>{r.title}</Text>
                <Text numberOfLines={1} style={[font(400, 12), { color: t.muted }]}>{r.artist} · {r.tag}</Text>
              </View>
              <View style={styles.pickPill}><Text style={[font(600, 12), { color: '#fff' }]}>{tr('huddle.pickBtn')}</Text></View>
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}

// ---------- members and recap ----------

function Members({ v, room, onClose }: { v: HuddleView; room: RoomState; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.sheetBack}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} haptic={false} />
      <ScrollView style={[styles.sheet, { backgroundColor: t.card, maxHeight: '86%', flexGrow: 0 }]} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
        <View style={styles.editorHead}>
          <View>
            <Text style={[font(600, 18), { color: t.ink }]}>{tr('huddle.members')}</Text>
            <Text style={[font(400, 13), { color: t.muted, marginTop: 2 }]}>{tr('huddle.inHuddle', { count: room.members.length })}</Text>
          </View>
          <Pressable onPress={onClose} accessibilityLabel={tr('huddle.close')} style={[styles.round32, { backgroundColor: t.fill2 }]}><CloseIcon size={12} color={t.ink} /></Pressable>
        </View>
        <View style={{ marginTop: 12 }}>
          {room.members.map(m => (
            <View key={m.id} style={[styles.liveRow, { gap: 12, paddingVertical: 8 }]}>
              <View style={[styles.bigAvatar, { backgroundColor: huddleColor(m.color) }, talking(v, m.id) && { borderWidth: 2.5, borderColor: TALKING }]}><Text style={[font(600, 15), { color: '#fff' }]}>{initial(m.name)}</Text></View>
              <View style={styles.flex}>
                <View style={styles.liveRow}>
                  <Text style={[font(600, 15), { color: t.ink }]}>{m.id === v.you ? tr('huddle.you') : m.name}</Text>
                  {room.host === m.id && <View style={[styles.hostBadge, { backgroundColor: t.accentSoft }]}><Text style={[mono(600, 10), { color: t.accentInk }]}>{tr('huddle.host').toUpperCase()}</Text></View>}
                </View>
                <Text style={[font(400, 12, 1.4), { color: t.muted, marginTop: 2 }]}>{memberSub(room, v.you, m)}</Text>
              </View>
              {voiceStatus(v.voice, m) && (
                <View style={[styles.liveRow, { gap: 4 }]}>
                  <Icon size={15} color={talking(v, m.id) ? '#23804F' : t.muted}>{MIC}</Icon>
                  <Text style={[font(500, 12), { color: talking(v, m.id) ? '#23804F' : t.muted }]}>{voiceStatus(v.voice, m)}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
        <Text style={[font(400, 12, 1.45), { color: t.muted, marginTop: 6 }]}>{tr('huddle.tasteHint')}</Text>
        <View style={[styles.invite, { backgroundColor: t.fill }]}>
          <Text style={[font(400, 13), styles.flex, { color: t.ink2 }]}>
            {tr('huddle.invite')} <Text style={[mono(600, 13), { color: t.ink, letterSpacing: 1.5 }]}>{room.code}</Text>
          </Text>
          <Pressable onPress={() => Share.share({ message: room.code }).catch(() => {})} style={[styles.addBtn, { backgroundColor: t.ink }]}>
            <Text style={[font(500, 13), { color: t.onInk }]}>{tr('huddle.copyShort')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function RecapCard({ room, deep, glow, onClose }: { room: RoomState; deep: string; glow: string; onClose: () => void }) {
  const t = useTheme();
  const r = recapOf(room);
  const W = '#F4F3F0';
  const row = (lead: React.ReactNode, label: string, value: string, sub: string) => (
    <View style={styles.recapRow}>
      {lead}
      <View style={styles.flex}>
        <Text style={[mono(600, 10), { color: W, opacity: 0.7, letterSpacing: 0.8 }]}>{label.toUpperCase()}</Text>
        <Text numberOfLines={1} style={[font(600, 15), { color: W, marginTop: 2 }]}>{value}</Text>
      </View>
      {!!sub && <Text style={[font(400, 12), { color: W, opacity: 0.75 }]}>{sub}</Text>}
    </View>
  );
  const dot = (bg: string, txt: string, round = true) => (
    <View style={[styles.recapLead, { backgroundColor: bg, borderRadius: round ? 20 : 10 }]}><Text style={[font(600, 15), { color: '#fff' }]}>{txt}</Text></View>
  );
  return (
    <View style={[styles.sheetBack, { justifyContent: 'center', padding: 16 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} haptic={false} />
      <View style={[styles.recap, { backgroundColor: deep }]}>
        <View style={[styles.recapGlow, { backgroundColor: glow }]} />
        <View style={[styles.liveRow, { gap: 14 }]}>
          <View style={styles.recapCovers}>
            {r.covers.map((c, i) => <Cover key={i} uri={c} size={38} radius={0} bg="rgba(255,255,255,0.1)" />)}
          </View>
          <View style={styles.flex}>
            <Text style={[mono(600, 11), { color: W, opacity: 0.75, letterSpacing: 0.8 }]}>{tr('huddle.recapTitle').toUpperCase()}</Text>
            <Text style={[font(700, 22, 1.1), { color: W, marginTop: 4 }]}>{room.name}</Text>
          </View>
        </View>
        <View style={styles.recapStats}>
          {[[r.mins, tr('huddle.together')], [r.songs, tr('huddle.songsPlayed')], [r.msgs, tr('huddle.messages')]].map(([a, b]) => (
            <View key={b} style={styles.recapStat}>
              <Text style={[font(700, 20), { color: W }]}>{a}</Text>
              <Text style={[font(500, 11), { color: W, opacity: 0.72, marginTop: 3 }]}>{b}</Text>
            </View>
          ))}
        </View>
        {row(<Cover uri={r.top?.artwork} size={40} radius={8} bg="rgba(255,255,255,0.1)" />, tr('huddle.mostLoved'), r.top?.title ?? tr('huddle.noneYet'), r.topSub)}
        {row(<View style={[styles.recapLead, { borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' }]}><Text style={{ fontSize: 24 }}>{r.topEmoji}</Text></View>, tr('huddle.topReaction', { n: r.streak }), r.topEmojiSub, '')}
        {row(dot(r.mvp ? huddleColor(r.mvp.color) : 'rgba(255,255,255,0.2)', r.mvp ? initial(r.mvp.name) : '?'), tr('huddle.mvp'), r.mvp?.name ?? '—', r.mvpSub)}
        {row(<View style={[styles.recapLead, { borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' }]}><QuestionIcon size={20} color={W} /></View>, tr('huddle.champ'), r.champ?.name ?? tr('huddle.noneYet'), r.champSub)}
      </View>
      <View style={[styles.liveRow, { gap: 8, marginTop: 10 }]}>
        <Pressable onPress={() => Share.share({ message: r.share }).catch(() => {})} style={[styles.bigBtn, styles.flex, { backgroundColor: ACCENT, borderRadius: 999 }]}>
          <Text style={[font(600, 15), { color: '#fff' }]}>{tr('huddle.shareRecap')}</Text>
        </Pressable>
        <Pressable onPress={onClose} style={[styles.bigBtn, { backgroundColor: t.card, borderRadius: 999, paddingHorizontal: 20 }]}>
          <Text style={[font(500, 15), { color: t.ink }]}>{tr('huddle.close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------- chat ----------

function Chat({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const [msg, setMsg] = useState('');
  const [act, setAct] = useState<number | null>(null);
  const [editing, setEditing] = useState<HuddleChat | null>(null);
  const [picker, setPicker] = useState(false);
  const send = () => {
    if (!msg.trim()) return;
    if (editing) huddle.chatEdit(editing.id, msg);
    else huddle.chat(msg);
    setMsg('');
    setEditing(null);
    setPicker(false);
  };
  const chat = [...room.chat].reverse();
  const nameOf = (id: string) => (id === v.you ? tr('huddle.you') : room.members.find(m => m.id === id)?.name ?? '?');
  const bubbleExtras = (m: HuddleChat, mine: boolean) => (
    <>
      {m.edited && <Text style={[font(400, 11), { color: t.muted, marginTop: 2 }]}>{tr('huddle.edited')}</Text>}
      {Object.keys(m.rx).length > 0 && (
        <View style={[styles.rxRow, { justifyContent: mine ? 'flex-end' : 'flex-start' }]}>
          {Object.entries(m.rx).map(([e, who]) => {
            const me = !!v.you && who.includes(v.you);
            return (
              <Pressable key={e} onPress={() => huddle.chatReact(m.id, e)} accessibilityLabel={who.map(nameOf).join(', ')} style={[styles.rxChip, { backgroundColor: me ? t.accentSoft : t.fill2, borderColor: me ? ACCENT : 'transparent' }]}>
                <Text style={{ fontSize: 13 }}>{e}</Text>
                <Text style={[mono(600, 11), { color: t.ink }]}>{who.length}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {act === m.id && (
        <View style={[styles.quick, { backgroundColor: t.card, borderColor: t.line, alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
          {QUICK_EMOS.map(e => (
            <Pressable key={e} onPress={() => { huddle.chatReact(m.id, e); setAct(null); }} style={[styles.quickBtn, v.you && m.rx[e]?.includes(v.you) ? { backgroundColor: t.accentSoft } : null]}>
              <Text style={{ fontSize: 18 }}>{e}</Text>
            </Pressable>
          ))}
          {mine && (
            <Pressable onPress={() => { setEditing(m); setMsg(m.text); setAct(null); }} style={[styles.liveRow, { paddingHorizontal: 10, height: 34, gap: 5 }]}>
              <PencilIcon color={t.ink} />
              <Text style={[font(500, 12), { color: t.ink }]}>{tr('huddle.edit')}</Text>
            </Pressable>
          )}
        </View>
      )}
    </>
  );
  return (
    <View style={styles.flex}>
      <FlatList
        inverted
        data={chat}
        keyExtractor={m => String(m.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: m }) =>
          m.kind !== 'msg' ? (
            <Text style={[font(400, 12, 1.4), styles.sys, { color: t.muted }]}>{chatText(m)}</Text>
          ) : m.who === v.you ? (
            <View style={{ alignItems: 'flex-end', marginVertical: 6 }}>
              <Pressable onPress={() => setAct(act === m.id ? null : m.id)} style={styles.mine}><Text style={[font(400, 15, 1.4), { color: '#fff' }]}>{m.text}</Text></Pressable>
              {bubbleExtras(m, true)}
            </View>
          ) : (
            <View style={styles.other}>
              <View style={[styles.avatar, { width: 28, height: 28, marginLeft: 0, borderWidth: 0, backgroundColor: huddleColor(m.color) }]}>
                <Text style={[font(600, 12), { color: '#fff' }]}>{initial(m.name)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[font(600, 13), { color: huddleColor(m.color) }]}>
                  {m.name} <Text style={[mono(400, 11), { color: t.muted }]}>{ago(m.at)}</Text>
                </Text>
                <Pressable onPress={() => setAct(act === m.id ? null : m.id)} style={[styles.otherBubble, { backgroundColor: t.fill2 }]}>
                  <Text style={[font(400, 15, 1.4), { color: t.ink }]}>{m.text}</Text>
                </Pressable>
                {bubbleExtras(m, false)}
              </View>
            </View>
          )
        }
      />
      {picker && (
        <View style={[styles.picker, { backgroundColor: t.card, borderColor: t.line }]}>
          <EmojiGrid onPick={e => setMsg(x => x + e)} height={200} />
        </View>
      )}
      {editing && (
        <View style={[styles.liveRow, { paddingHorizontal: 14, paddingTop: 8 }]}>
          <PencilIcon color={ACCENT} />
          <Text numberOfLines={1} style={[font(500, 12), styles.flex, { color: t.muted }]}>{tr('huddle.editing', { text: editing.text })}</Text>
          <Pressable onPress={() => { setEditing(null); setMsg(''); }}>
            <Text style={[font(600, 12), { color: t.ink }]}>{tr('huddle.cancel')}</Text>
          </Pressable>
        </View>
      )}
      <View style={[styles.chatBar, { borderTopColor: t.line }]}>
        <View style={[styles.chatInput, { backgroundColor: t.fill2 }]}>
          <TextInput value={msg} maxLength={500} onChangeText={setMsg} onSubmitEditing={send} returnKeyType="send" placeholder={editing ? tr('huddle.editPh') : tr('huddle.say')} placeholderTextColor={t.muted2} style={[font(400, 16), styles.flex, { color: t.ink, padding: 0 }]} />
          <Pressable onPress={() => setPicker(p => !p)} accessibilityLabel={tr('huddle.emoji')} style={[styles.round32, { backgroundColor: picker ? t.fill3 : 'transparent' }]}>
            <SmileIcon color={t.muted} />
          </Pressable>
        </View>
        <Pressable onPress={send} accessibilityLabel={editing ? tr('huddle.saveEdit') : tr('huddle.send')} style={[styles.sendBtn, { backgroundColor: msg.trim() ? ACCENT : t.fill2 }]}>
          {editing ? (
            <CheckIcon size={18} color={msg.trim() ? '#fff' : t.muted} />
          ) : (
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={msg.trim() ? '#fff' : t.muted} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 19V5M6 11l6-6 6 6" /></Svg>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  headBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headBadge: { position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  backPill: { alignSelf: 'flex-start', height: 36, paddingLeft: 6, paddingRight: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 2 },
  label: { marginTop: 18, marginBottom: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  input: { height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, ...font(400, 16) },
  errBox: { marginTop: 16, padding: 12, borderRadius: 12 },
  card: { padding: 20, borderRadius: 18, borderWidth: 1, gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6 },
  round36: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  round32: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  codeBtn: { height: 32, paddingHorizontal: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 8, justifyContent: 'center' },
  menu: { position: 'absolute', top: 42, right: 0, width: 200, padding: 6, borderRadius: 14, elevation: 12, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
  menuItem: { height: 40, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center' },
  avatars: { flexDirection: 'row', paddingLeft: 6, paddingBottom: 6 },
  avatar: { width: 26, height: 26, marginLeft: -6, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pct: { position: 'absolute', bottom: -8, paddingHorizontal: 3, height: 12, borderRadius: 6, justifyContent: 'center' },
  leaveBtn: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  voiceBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth },
  voiceFace: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  round40: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mini: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', left: -14, top: -14, right: -14, bottom: -14, borderRadius: 40 },
  seekHit: { height: 18, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  seekFill: { height: '100%', borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controlsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  side: { flex: 1, flexDirection: 'row' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  ctl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 6, paddingHorizontal: 16 },
  pill: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 13, flexShrink: 1 },
  shout: { backgroundColor: '#fff', paddingLeft: 4, elevation: 6, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  trayWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 14 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 5, borderRadius: 999 },
  emo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 20 },
  count: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  floats: { position: 'absolute', left: 14, bottom: 70, width: 110, height: 340 },
  float: { position: 'absolute', bottom: 0, alignItems: 'center', gap: 4 },
  floatName: { color: '#fff', backgroundColor: 'rgba(20,20,24,0.62)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  streak: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: ACCENT },
  gameArt: { width: 96, height: 96, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  opts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  opt: { width: '48.5%', minHeight: 54, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, justifyContent: 'center' },
  votes: { position: 'absolute', top: -7, right: 8, flexDirection: 'row', gap: 2 },
  vote: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  editorHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  slot: { width: 42, height: 42, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 22 },
  slotX: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cats: { flexDirection: 'row', gap: 2 },
  cat: { flex: 1, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  lib: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  libCell: { width: '12.5%', height: 40, alignItems: 'center', justifyContent: 'center' },
  editorFoot: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  doneBtn: { height: 34, paddingHorizontal: 16, borderRadius: 17, backgroundColor: ACCENT, justifyContent: 'center' },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingLeft: 20, paddingRight: 16 },
  addBtn: { height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 5 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12 },
  progTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.3)' },
  progFill: { height: '100%', backgroundColor: ACCENT },
  dl: { minWidth: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rm: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 40, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  shoutBox: { borderWidth: 1.5, borderStyle: 'dashed' },
  addRound: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sheetBack: { flex: 1, backgroundColor: 'rgba(10,10,12,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '82%', minHeight: '60%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 16 },
  pickPill: { height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: ACCENT, justifyContent: 'center' },
  bigAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  hostBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  invite: { marginTop: 14, padding: 12, paddingLeft: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recap: { padding: 20, borderRadius: 24, overflow: 'hidden' },
  recapGlow: { position: 'absolute', right: -70, top: -70, width: 240, height: 240, borderRadius: 120, opacity: 0.35 },
  recapCovers: { width: 76, height: 76, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' },
  recapStats: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 6 },
  recapStat: { flex: 1, padding: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)' },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 6 },
  recapLead: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  sys: { alignSelf: 'center', textAlign: 'center', maxWidth: '90%', marginVertical: 6 },
  mine: { maxWidth: '80%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: ACCENT },
  other: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginVertical: 6 },
  otherBubble: { alignSelf: 'flex-start', maxWidth: '100%', marginTop: 3, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, borderTopLeftRadius: 4 },
  rxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 5 },
  rxChip: { height: 24, paddingHorizontal: 7, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  quick: { flexDirection: 'row', alignItems: 'center', marginTop: 6, padding: 3, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, elevation: 4, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  quickBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  picker: { marginHorizontal: 10, padding: 8, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  chatBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chatInput: { flex: 1, height: 44, paddingLeft: 16, paddingRight: 4, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 2 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
