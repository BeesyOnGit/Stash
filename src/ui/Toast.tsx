import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUi } from '../state/ui';
import { font, GREEN_LIGHT, useTheme } from '../theme';
import { CheckCircleIcon } from './icons';

export function Toast() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { toast } = useUi();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [toast, fade]);

  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        { top: insets.top + 6, backgroundColor: t.ink, opacity: fade },
      ]}
    >
      <CheckCircleIcon size={18} color={GREEN_LIGHT} />
      <Text style={[font(500, 13, 1.35), styles.text, { color: t.onInk }]}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    boxShadow: '0px 10px 30px rgba(0,0,0,0.25)',
  },
  text: { flex: 1 },
});
