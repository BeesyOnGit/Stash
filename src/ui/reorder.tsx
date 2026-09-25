/**
 * Drag-to-reorder for simple lists of rows of the same height, and
 * swipe-to-remove rows. Built on PanResponder (no gesture library).
 */
import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  type PanResponderInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { haptic } from '../services/haptics';

/**
 * `handle(i)` goes on each row's grip, `rowStyle(i)` on each row, and
 * `measure` on the first row (for the row height). While dragging, the row
 * follows the finger and the others make room; on release `onMove(from, to)`.
 */
export function useReorder(
  count: number,
  onMove: (from: number, to: number) => void,
) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dy = useRef(new Animated.Value(0)).current;
  const rowH = useRef(64);
  const live = useRef({ count, onMove, drag });
  live.current = { count, onMove, drag };
  const responders = useRef(new Map<number, PanResponderInstance>());

  const handle = (i: number) => {
    let r = responders.current.get(i);
    if (!r) {
      const target = (g: number) =>
        Math.max(
          0,
          Math.min(live.current.count - 1, i + Math.round(g / rowH.current)),
        );
      const end = (g: number) => {
        const to = target(g);
        setDrag(null);
        dy.setValue(0);
        if (to !== i) live.current.onMove(i, to);
      };
      r = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          haptic('tick');
          dy.setValue(0);
          setDrag({ from: i, to: i });
        },
        onPanResponderMove: (_, g) => {
          dy.setValue(g.dy);
          const to = target(g.dy);
          if (live.current.drag?.to !== to) {
            if (live.current.drag) haptic('tick');
            setDrag({ from: i, to });
          }
        },
        onPanResponderRelease: (_, g) => end(g.dy),
        onPanResponderTerminate: (_, g) => end(g.dy),
      });
      responders.current.set(i, r);
    }
    return r.panHandlers;
  };

  const rowStyle = (
    i: number,
  ): Animated.WithAnimatedValue<ViewStyle> | undefined => {
    if (!drag) return undefined;
    const { from, to } = drag;
    if (i === from)
      return {
        transform: [{ translateY: dy }],
        zIndex: 10,
        elevation: 8,
        opacity: 0.95,
      };
    if (from < to && i > from && i <= to)
      return { transform: [{ translateY: -rowH.current }] };
    if (from > to && i >= to && i < from)
      return { transform: [{ translateY: rowH.current }] };
    return undefined;
  };

  const measure = (e: { nativeEvent: { layout: { height: number } } }) => {
    if (e.nativeEvent.layout.height > 0)
      rowH.current = e.nativeEvent.layout.height;
  };

  return { handle, rowStyle, measure, dragging: !!drag };
}

/**
 * A row that can be swiped sideways to remove it: past a third of its width
 * (or flung), it slides out and `onRemove` is called; otherwise it springs back.
 */
export function SwipeToRemove({
  onRemove,
  children,
  style,
}: {
  onRemove: () => void;
  children: React.ReactNode;
  style?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(360);
  const cb = useRef(onRemove);
  cb.current = onRemove;
  const responder = useRef(
    PanResponder.create({
      // Capture: take the gesture from the row's own tap once it's clearly sideways.
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => x.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        const away = Math.abs(g.dx) > width.current / 3 || Math.abs(g.vx) > 0.8;
        if (away) {
          haptic('confirm');
          Animated.timing(x, {
            toValue: Math.sign(g.dx || g.vx) * width.current,
            duration: 160,
            useNativeDriver: true,
          }).start(() => {
            cb.current();
            x.setValue(0);
          });
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
    }),
  ).current;
  return (
    <Animated.View style={style}>
      <Animated.View
        {...responder.panHandlers}
        onLayout={e => {
          width.current = e.nativeEvent.layout.width || width.current;
        }}
        style={{
          transform: [{ translateX: x }],
          opacity: x.interpolate({
            inputRange: [-width.current, 0, width.current],
            outputRange: [0.2, 1, 0.2],
          }),
        }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
