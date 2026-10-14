/** Huddle on the phone: the lobby (start or join) and the room (now playing, shared playlist, chat). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Image,
  KeyboardAvoidingView,
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
import Svg, { Circle, Path } from 'react-native-svg';
import {
  DEFAULT_EMOS,
  EMO_LIB,
  huddle,
  huddleColor,
  useHuddle,
  type HuddleFloat,
  type HuddleView,
  type RoomState,
} from '../huddle';
import { ago, chatText, errorText, lastText, sourceText, statusText } from '../huddle/labels';
import { tr } from '../i18n';
import { navigationRef } from '../navigation/ref';
import { useLibrary } from '../player/hooks';
import { saveSettings, useSettings } from '../services/settings';
import { searchOnline } from '../sources';
import { toast } from '../state/ui';
import { ACCENT, font, formatTime, mono, paletteFor, useTheme, eyebrow } from '../theme';
import { artworkUri, type OnlineResult, type Track } from '../types';
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  GripIcon,
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

const PeopleIcon = ({ size = 18, color }: { size?: number; color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={9} cy={8} r={3.2} />
    <Path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M16 5.2a3 3 0 010 5.6M17.5 14.4c1.7.6 2.8 2.2 3.1 4.6" />
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

const goBack = () => navigationRef.isReady() && navigationRef.canGoBack() && navigationRef.goBack();

// ---------- lobby ----------

function Lobby({ v }: { v: HuddleView }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const busy = v.status !== 'idle';
  const name = () => settings.huddleName.trim() || 'Guest';
  const create = () => !busy && huddle.create(name(), roomName.trim());
  const join = () => !busy && code.length === 6 && huddle.join(name(), code);
  const input = [styles.input, { borderColor: t.line2, backgroundColor: t.bg, color: t.ink }];
  const card = [styles.card, { backgroundColor: t.card, borderColor: t.line }];
  const big = (on: boolean) => [styles.bigBtn, { backgroundColor: on ? ACCENT : t.fill2 }];

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={goBack} style={[styles.backPill, { backgroundColor: t.fill2 }]}>
          <ChevronLeftIcon size={18} color={t.ink} />
          <Text style={[font(500, 14), { color: t.ink }]}>{tr('huddle.back')}</Text>
        </Pressable>
        <Text style={[eyebrow(), { color: t.muted, marginTop: 26 }]}>{tr('huddle.nav')}</Text>
        <Text style={[font(700, 34, 1.05), { color: t.ink, letterSpacing: -1.2, marginTop: 6 }]}>{tr('huddle.title')}</Text>
        <Text style={[font(400, 15, 1.5), { color: t.ink2, marginTop: 10 }]}>{tr('huddle.intro')}</Text>

        <Text style={[font(500, 13), styles.label, { color: t.muted }]}>{tr('huddle.yourName')}</Text>
        <TextInput value={settings.huddleName} maxLength={24} onChangeText={x => saveSettings({ huddleName: x })} placeholder="Guest" placeholderTextColor={t.muted2} style={input} />

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
    </KeyboardAvoidingView>
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
  useTicker(500);
  const pos = huddle.position();
  const dur = cur?.duration ?? 0;
  const on = room.playing || room.pending;
  const status = statusText(v);
  const pill = status ?? (room.last ? lastText(room.last) : tr('huddle.shared'));
  const host = room.members.find(m => m.id === room.host);
  const chip = { backgroundColor: deep ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)' };
  const [barW, setBarW] = useState(1);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle={deep ? 'light-content' : 'dark-content'} />
      <View style={{ backgroundColor: bg, paddingTop: insets.top }}>
        {!!cur?.artwork && <Image source={{ uri: cur.artwork }} blurRadius={40} style={[StyleSheet.absoluteFill, { opacity: deep ? 0.45 : 0.3 }]} />}
        <View style={styles.row}>
          <Pressable onPress={goBack} style={[styles.round36, chip]}><ChevronLeftIcon size={18} color={ink} /></Pressable>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[font(600, 16), { color: ink }]}>{room.name}</Text>
            <View style={styles.liveRow}>
              <View style={[styles.dot, { backgroundColor: v.status === 'live' ? ACCENT : '#888' }]} />
              <Text numberOfLines={1} style={[mono(500, 11), { color: ink, opacity: 0.8 }]}>
                {v.status === 'live' ? tr('huddle.live') : tr('huddle.reconnecting')} · {room.host === v.you ? tr('huddle.host') : tr('huddle.hostName', { name: host?.name ?? '' })}
              </Text>
            </View>
          </View>
          <Pressable onPress={() => Share.share({ message: room.code }).catch(() => {})} accessibilityLabel={tr('huddle.copy')} style={[styles.codeBtn, { borderColor: inkA(0.4) }]}>
            <Text style={[mono(600, 13), { color: ink, letterSpacing: 1.5 }]}>{room.code}</Text>
          </Pressable>
        </View>
        <View style={[styles.row, { paddingTop: 12 }]}>
          <View style={styles.avatars}>
            {room.members.slice(0, 6).map(m => (
              <View key={m.id} style={[styles.avatar, { backgroundColor: huddleColor(m.color), borderColor: bg }]}>
                <Text style={[font(600, 11), { color: '#fff' }]}>{m.name[0]?.toUpperCase()}</Text>
              </View>
            ))}
          </View>
          <Text style={[font(500, 13), styles.flex, { color: ink, opacity: 0.85 }]}>{tr('huddle.listening', { count: room.members.length })}</Text>
          <Pressable
            onPress={() => {
              huddle.leave();
              goBack();
              toast(tr('huddle.left', { name: room.name }));
            }}
            style={[styles.leaveBtn, chip]}
          >
            <Text style={[font(500, 13), { color: ink }]}>{tr('huddle.leave')}</Text>
          </Pressable>
        </View>
        <View style={[styles.row, { paddingTop: 16 }]}>
          <Cover uri={cur?.artwork} size={88} radius={12} bg={pal.artBg} />
          <View style={styles.flex}>
            <Text numberOfLines={1} style={[font(700, 20), { color: ink, letterSpacing: -0.5 }]}>{cur?.title ?? tr('huddle.empty')}</Text>
            {!!cur && <Text numberOfLines={1} style={[font(400, 15), { color: ink, opacity: 0.8, marginTop: 2 }]}>{cur.artist}</Text>}
            {!!cur && (
              <View style={[styles.liveRow, { marginTop: 7 }]}>
                <View style={[styles.mini, { backgroundColor: huddleColor(cur.byColor) }]}><Text style={[font(600, 9), { color: '#fff' }]}>{cur.byName[0]?.toUpperCase()}</Text></View>
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
        <View style={styles.controls}>
          <Pressable onPress={huddle.remote.previous} style={styles.ctl}><PrevIcon size={26} color={ink} /></Pressable>
          <Pressable onPress={on ? huddle.remote.pause : huddle.remote.play} accessibilityLabel={tr('huddle.playForAll')} style={[styles.play, { backgroundColor: ink }]}>
            {on ? <PauseIcon size={22} color={bg} /> : <PlayRoundIcon size={22} color={bg} />}
          </Pressable>
          <Pressable onPress={huddle.remote.next} style={styles.ctl}><NextIcon size={26} color={ink} /></Pressable>
        </View>
        <View style={styles.pillWrap}>
          <View style={[styles.pill, { backgroundColor: inkA(0.09) }]}>
            <View style={[styles.dot, { backgroundColor: !status && room.last ? huddleColor(room.last.color) : ink }]} />
            <Text numberOfLines={1} style={[font(500, 12), { color: ink, flexShrink: 1 }]}>{pill}</Text>
          </View>
        </View>
        <View style={styles.trayWrap}>
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
        </View>
        <Floats floats={v.floats} />
      </View>

      {editEmos && room.host === v.you ? (
        <EmoEditor room={room} onDone={() => setEditEmos(false)} />
      ) : (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
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
    </KeyboardAvoidingView>
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
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
      <View style={[styles.lib, { borderTopColor: t.line }]}>
        {EMO_LIB.map(e => (
          <Pressable key={e} onPress={() => pick(e)} style={[styles.libCell, { opacity: emos.includes(e) ? 0.3 : 1 }]}>
            <Text style={styles.slotText}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.editorFoot}>
        <Pressable onPress={() => { huddle.setEmos(DEFAULT_EMOS); setSlot(null); }}>
          <Text style={[font(500, 13), { color: t.muted }]}>{tr('huddle.reset')}</Text>
        </Pressable>
        <Pressable onPress={onDone} style={styles.doneBtn}>
          <Text style={[font(600, 13), { color: '#fff' }]}>{tr('huddle.done')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ---------- shared playlist ----------


function Playlist({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const [adding, setAdding] = useState(false);
  const mins = Math.round(room.queue.reduce((a, x) => a + (x.duration ?? 0), 0) / 60);
  const reorder = useReorder(room.queue.length, huddle.move);
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
            const isCur = i === room.index;
            const c = v.cache[x.key];
            const canRemove = !isCur && (x.by === v.you || room.host === v.you);
            return (
              <Animated.View key={x.key} style={reorder.rowStyle(i)}>
                <Pressable
                  onLayout={i === 0 ? reorder.measure : undefined}
                  onPress={() => huddle.remote.skipTo(i)}
                  style={[styles.qRow, { backgroundColor: isCur ? t.accentSoft : t.bg, opacity: i < room.index ? 0.5 : 1 }]}
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
                      <View style={[styles.mini, { width: 14, height: 14, backgroundColor: huddleColor(x.byColor) }]}><Text style={[font(600, 8), { color: '#fff' }]}>{x.byName[0]?.toUpperCase()}</Text></View>
                      <Text numberOfLines={1} style={[font(400, 12), styles.flex, { color: t.muted }]}>{x.byName} · {sourceText(x)}</Text>
                    </View>
                  </View>
                  {canRemove && (
                    <Pressable onPress={() => huddle.remove(x.key)} hitSlop={6} accessibilityLabel={tr('huddle.remove')} style={styles.rm}>
                      <CloseIcon size={11} color={t.muted} />
                    </Pressable>
                  )}
                  <View {...reorder.handle(i)} hitSlop={8} accessibilityLabel={tr('huddle.drag')} style={styles.grip}>
                    <GripIcon color={t.muted} />
                  </View>
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
  const [found, setFound] = useState<OnlineResult[]>([]);
  const inQueue = useMemo(() => new Set(room.queue.map(x => x.key)), [room.queue]);

  useEffect(() => {
    if (tab !== 'search' || !q.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const id = setTimeout(() => searchOnline(q.trim(), (_, r) => live && setFound(r)).catch(() => {}), 450);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [tab, q]);

  const ql = q.trim().toLowerCase();
  const rows: { id: string; title: string; artist: string | null; art: string | null; tag: string; added: boolean; add: () => void }[] =
    tab === 'device'
      ? tracks
          .filter(x => x.status === 'ready' && x.source !== 'device' && (!ql || `${x.title} ${x.artist ?? ''} ${x.genre ?? ''}`.toLowerCase().includes(ql)))
          .slice(0, 60)
          .map(x => ({ id: x.id, title: x.title, artist: x.artist, art: artworkUri(x), tag: tr('huddle.onDevice'), added: inQueue.has(x.id), add: () => addLibrary(x) }))
      : found.map(r => ({ id: `${r.source}:${r.sourceId}`, title: r.title, artist: r.artist, art: r.thumbnailUrl, tag: r.source, added: inQueue.has(`${r.source}:${r.sourceId}`), add: () => addResult(r) }));

  return (
    <View style={styles.flex}>
      <View style={{ paddingHorizontal: 16, gap: 8, paddingBottom: 8 }}>
        <Segmented compact value={tab} onChange={setTab} options={[{ value: 'device', label: tr('huddle.onDevice') }, { value: 'search', label: tr('huddle.search') }]} />
        <View style={[styles.searchBox, { backgroundColor: t.fill2 }]}>
          <SearchIcon size={15} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={tab === 'device' ? tr('huddle.filterLib') : tr('huddle.searchSources')} placeholderTextColor={t.muted2} style={[font(400, 15), styles.flex, { color: t.ink, padding: 0 }]} />
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

function addResult(r: OnlineResult) {
  huddle.addOnline({ source: r.source, sourceId: r.sourceId, title: r.title, artist: r.artist, album: r.album, duration: r.duration, artwork: r.thumbnailUrl });
}

/** Library songs are shared by their link; everyone downloads them from the same source. */
function addLibrary(x: Track) {
  if (x.source === 'device') return;
  huddle.addOnline({ source: x.source, sourceId: x.sourceId, title: x.title, artist: x.artist, album: x.album, duration: x.duration, artwork: x.remoteArtworkUrl });
}

// ---------- chat ----------

function Chat({ v, room }: { v: HuddleView; room: RoomState }) {
  const t = useTheme();
  const [msg, setMsg] = useState('');
  const send = () => {
    if (!msg.trim()) return;
    huddle.chat(msg);
    setMsg('');
  };
  const chat = [...room.chat].reverse();
  return (
    <View style={styles.flex}>
      <FlatList
        inverted
        data={chat}
        keyExtractor={m => String(m.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        renderItem={({ item: m }) =>
          m.kind !== 'msg' ? (
            <Text style={[font(400, 12, 1.4), styles.sys, { color: t.muted }]}>{chatText(m)}</Text>
          ) : m.who === v.you ? (
            <View style={styles.mine}><Text selectable style={[font(400, 15, 1.4), { color: '#fff' }]}>{m.text}</Text></View>
          ) : (
            <View style={styles.other}>
              <View style={[styles.avatar, { width: 28, height: 28, marginLeft: 0, borderWidth: 0, backgroundColor: huddleColor(m.color) }]}>
                <Text style={[font(600, 12), { color: '#fff' }]}>{m.name[0]?.toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={[font(600, 13), { color: huddleColor(m.color) }]}>
                  {m.name} <Text style={[mono(400, 11), { color: t.muted }]}>{ago(m.at)}</Text>
                </Text>
                <Text selectable style={[font(400, 15, 1.4), { color: t.ink, marginTop: 2 }]}>{m.text}</Text>
              </View>
            </View>
          )
        }
      />
      <View style={[styles.chatBar, { borderTopColor: t.line }]}>
        <TextInput value={msg} maxLength={500} onChangeText={setMsg} onSubmitEditing={send} returnKeyType="send" placeholder={tr('huddle.say')} placeholderTextColor={t.muted2} style={[font(400, 16), styles.chatInput, { backgroundColor: t.fill2, color: t.ink }]} />
        <Pressable onPress={send} accessibilityLabel={tr('huddle.send')} style={[styles.sendBtn, { backgroundColor: msg.trim() ? ACCENT : t.fill2 }]}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={msg.trim() ? '#fff' : t.muted} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 19V5M6 11l6-6 6 6" /></Svg>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headBadge: { position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  backPill: { alignSelf: 'flex-start', height: 36, paddingLeft: 6, paddingRight: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 2 },
  label: { marginTop: 18, marginBottom: 6 },
  input: { height: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, ...font(400, 16) },
  errBox: { marginTop: 16, padding: 12, borderRadius: 12 },
  card: { padding: 20, borderRadius: 18, borderWidth: 1, gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6 },
  round36: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  codeBtn: { height: 32, paddingHorizontal: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 8, justifyContent: 'center' },
  avatars: { flexDirection: 'row', paddingLeft: 6 },
  avatar: { width: 26, height: 26, marginLeft: -6, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  leaveBtn: { height: 30, paddingHorizontal: 13, borderRadius: 15, justifyContent: 'center' },
  mini: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  seekHit: { height: 18, justifyContent: 'center' },
  seekTrack: { height: 4, borderRadius: 2, overflow: 'hidden' },
  seekFill: { height: '100%', borderRadius: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  ctl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  play: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  pillWrap: { alignItems: 'center', paddingTop: 6, paddingHorizontal: 16 },
  pill: { maxWidth: '100%', minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 13 },
  trayWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 14 },
  tray: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 5, borderRadius: 999 },
  emo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emoText: { fontSize: 20 },
  count: { position: 'absolute', top: -3, right: -3, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  floats: { position: 'absolute', left: 14, bottom: 70, width: 110, height: 340 },
  float: { position: 'absolute', bottom: 0, alignItems: 'center', gap: 4 },
  floatName: { color: '#fff', backgroundColor: 'rgba(20,20,24,0.62)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  editorHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  slot: { width: 42, height: 42, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  slotText: { fontSize: 22 },
  slotX: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  lib: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  libCell: { width: '12.5%', height: 42, alignItems: 'center', justifyContent: 'center' },
  editorFoot: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  doneBtn: { height: 34, paddingHorizontal: 16, borderRadius: 17, backgroundColor: ACCENT, justifyContent: 'center' },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingLeft: 20, paddingRight: 16 },
  addBtn: { height: 32, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 5 },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 12 },
  progTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.3)' },
  progFill: { height: '100%', backgroundColor: ACCENT },
  rm: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 40, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  addRound: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sys: { alignSelf: 'center', textAlign: 'center', maxWidth: '90%', marginVertical: 6 },
  mine: { alignSelf: 'flex-end', maxWidth: '80%', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, borderBottomRightRadius: 4, backgroundColor: ACCENT, marginVertical: 6 },
  other: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginVertical: 6 },
  chatBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  chatInput: { flex: 1, height: 44, paddingHorizontal: 16, borderRadius: 22 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
