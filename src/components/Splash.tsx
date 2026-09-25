/**
 * Opening screen: the stash mark, the name and the tagline. It takes over from
 * the native launch screen (same logo, same place), then fades into the app once
 * the library has loaded.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { tr } from '../i18n';
import { useLibrary } from '../player/hooks';
import { font, useTheme } from '../theme';
import { LogoMark } from '../ui/icons';

/** Long enough to read the tagline, short enough not to be in the way. */
const MIN_MS = 1300;
/** Never block the app, even if the library is slow to load. */
const MAX_MS = 3500;
const LOGO = 96;

export function Splash() {
  const t = useTheme();
  const { loading } = useLibrary();
  const [minDone, setMinDone] = useState(false);
  const [maxDone, setMaxDone] = useState(false);
  const [gone, setGone] = useState(false);
  const logo = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(logo, {
      toValue: 1,
      friction: 6,
      tension: 60,
      useNativeDriver: true,
    }).start();
    Animated.timing(text, {
      toValue: 1,
      duration: 500,
      delay: 180,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
    const a = setTimeout(() => setMinDone(true), MIN_MS);
    const b = setTimeout(() => setMaxDone(true), MAX_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [logo, text]);

  const leaving = minDone && (!loading || maxDone);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(out, {
      toValue: 0,
      duration: 380,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => setGone(true));
  }, [leaving, out]);

  if (gone) return null;

  const logoScale = logo.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });
  const textY = text.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={[styles.fill, { backgroundColor: t.bg, opacity: out }]}
    >
      <Animated.View
        style={[styles.logo, { transform: [{ scale: logoScale }] }]}
      >
        <LogoMark size={LOGO} />
      </Animated.View>
      <Animated.View
        style={[
          styles.text,
          { opacity: text, transform: [{ translateY: textY }] },
        ]}
      >
        <Text style={[styles.name, { color: t.ink }]}>stash</Text>
        <Text style={[font(400, 16, 1.45), styles.tagline, { color: t.muted }]}>
          {tr('settings.splashTagline')}
        </Text>
      </Animated.View>
      <View style={styles.footer}>
        <Text style={[font(400, 12, 1.5), styles.center, { color: t.muted2 }]}>
          {tr('settings.splashFooter')}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  // Centred exactly like the native launch screen, so the hand-over is seamless.
  logo: {
    width: LOGO,
    height: LOGO,
    borderRadius: 22,
    boxShadow: '0px 14px 34px rgba(224,83,47,0.32)',
  },
  text: {
    position: 'absolute',
    top: '50%',
    left: 32,
    right: 32,
    marginTop: LOGO / 2 + 22,
    alignItems: 'center',
  },
  name: { ...font(700, 56), letterSpacing: -3, lineHeight: 58 },
  tagline: { marginTop: 10, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 48, left: 40, right: 40 },
  center: { textAlign: 'center' },
});
