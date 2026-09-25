import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatsView } from '../components/StatsView';
import { tr } from '../i18n';
import { eyebrow, font, useTheme } from '../theme';

export function StatsScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top }}
    >
      <View style={styles.head}>
        <Text style={[eyebrow(), { color: t.muted }]}>
          {tr('stats.eyebrow')}
        </Text>
        <Text style={[styles.h1, { color: t.ink }]}>{tr('stats.title')}</Text>
      </View>
      <StatsView />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 20, paddingTop: 14 },
  h1: { ...font(700, 34, 1.05), letterSpacing: -1, marginTop: 4 },
});
