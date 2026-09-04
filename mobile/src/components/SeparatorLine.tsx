import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {useTheme} from '../theme';

interface Props {
  dark: boolean;
}

export default function SeparatorLine({dark}: Props) {
  const t = useTheme(dark);

  return (
    <View style={styles.container}>
      <View style={[styles.line, {backgroundColor: t.divider}]} />
      <View style={[styles.badge, {backgroundColor: t.divider}]}>
        <Text style={[styles.badgeText, {color: t.textTertiary}]}>⏱ 3s</Text>
      </View>
      <View style={[styles.line, {backgroundColor: t.divider}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 8,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  badge: {
    marginHorizontal: 10,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
