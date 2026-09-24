import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Pressable } from './Pressable';

/**
 * Height of the on-screen keyboard (0 when hidden). The sheet's modal draws
 * edge to edge, so Android doesn't resize it for the keyboard; we lift the card
 * ourselves instead.
 */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(
      ios ? 'keyboardWillShow' : 'keyboardDidShow',
      e => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/** Bottom sheet: dimmed backdrop, rounded card sliding up, grab handle. */
export function Sheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(600)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const kb = useKeyboardHeight();
  // Android reports the keyboard without the navigation bar under it.
  const keyboard = kb && Platform.OS === 'android' ? kb + insets.bottom : kb;
  const { height: screenH } = useWindowDimensions();

  useEffect(() => {
    if (!visible) return;
    y.setValue(600);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(y, {
        toValue: 0,
        duration: 300,
        easing: Easing.bezier(0.2, 0.8, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, y, fade]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fill}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable haptic={false} style={styles.fill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: t.card,
              // Sits on top of the keyboard while typing, so the field stays visible.
              bottom: keyboard,
              paddingBottom: keyboard ? 16 : 24 + insets.bottom,
              maxHeight: keyboard
                ? screenH - keyboard - insets.top - 12
                : screenH * 0.78,
              transform: [{ translateY: y }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: t.fill3 }]} />
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10,10,12,0.4)',
  },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 12,
  },
});
