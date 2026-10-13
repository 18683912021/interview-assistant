import {markdownBlocks} from './markdown';
import React, {createContext, useContext, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme, type Theme} from '../theme';
export const Palette = createContext<Theme | null>(null);
export const FontSize = createContext(16);
export function usePalette() {
  const fallback = useTheme(false);
  return useContext(Palette) || fallback;
}
export const ui = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
  page: {padding: 20, gap: 20, paddingBottom: 32},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10},
  title: {fontSize: 28, fontWeight: '700', letterSpacing: -0.6},
  h2: {fontSize: 18, fontWeight: '600'},
  label: {fontSize: 13, fontWeight: '600'},
  body: {fontSize: 15, lineHeight: 23},
  small: {fontSize: 12, lineHeight: 18},
  card: {borderWidth: 1, borderRadius: 14, padding: 16, gap: 12},
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
export function Txt({
  children,
  muted = false,
  small = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  small?: boolean;
}) {
  const t = usePalette();
  return (
    <Text
      style={[
        small ? ui.small : ui.body,
        {color: muted ? t.textSecondary : t.textPrimary},
      ]}>
      {children}
    </Text>
  );
}
export function Button({
  label,
  onPress,
  busy,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'quiet' | 'danger';
}) {
  const t = usePalette();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled: !!off, busy: !!busy}}
      disabled={off}
      onPress={onPress}
      style={({pressed}) => ({
        minHeight: 46,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        backgroundColor:
          tone === 'primary'
            ? t.accent
            : tone === 'danger'
            ? t.dangerLight
            : t.bgSurface,
        borderWidth: tone === 'quiet' ? 1 : 0,
        borderColor: t.divider,
        opacity: off ? 0.5 : pressed ? 0.72 : 1,
      })}>
      {busy && (
        <ActivityIndicator
          size="small"
          color={tone === 'primary' ? '#fff' : t.accent}
        />
      )}
      <Text
        style={{
          fontSize: 14,
          fontWeight: '600',
          color:
            tone === 'primary'
              ? '#fff'
              : tone === 'danger'
              ? t.danger
              : t.textPrimary,
        }}>
        {label}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & {label: string; error?: string; hint?: string}) {
  const t = usePalette();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{gap: 7}}>
      <Text style={[ui.label, {color: t.textPrimary}]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={t.textTertiary}
        onFocus={e => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={e => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={[
          {
            minHeight: 48,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: error ? t.danger : focus ? t.accent : t.dividerStrong,
            backgroundColor: t.bgSurface,
            color: t.textPrimary,
            fontSize: 16,
            textAlignVertical: props.multiline ? 'top' : 'center',
          },
          props.multiline && {minHeight: 120},
          props.style,
        ]}
      />
      {(error || hint) && (
        <Text
          accessibilityLiveRegion="polite"
          style={[ui.small, {color: error ? t.danger : t.textSecondary}]}>
          {error || hint}
        </Text>
      )}
    </View>
  );
}
export function Notice({
  text,
  action,
  onAction,
}: {
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  const t = usePalette();
  if (!text) {
    return null;
  }
  return (
    <View
      style={{
        padding: 12,
        gap: 8,
        backgroundColor: t.accentLight,
        borderRadius: 10,
      }}>
      <Text
        accessibilityLiveRegion="polite"
        style={[ui.small, {color: t.textPrimary}]}>
        {text}
      </Text>
      {action && onAction && (
        <Button tone="quiet" label={action} onPress={onAction} />
      )}
    </View>
  );
}
export function Empty({title, detail}: {title: string; detail: string}) {
  const t = usePalette();
  return (
    <View
      style={{
        paddingHorizontal: 24,
        paddingVertical: 56,
        alignItems: 'center',
        gap: 12,
      }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.divider,
          backgroundColor: t.bgSurface,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={{fontSize: 26, color: t.accent}}>≡</Text>
      </View>
      <Text style={[ui.h2, {color: t.textPrimary}]}>{title}</Text>
      <Text style={[ui.body, {color: t.textSecondary, textAlign: 'center'}]}>
        {detail}
      </Text>
    </View>
  );
}
export function Choices<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly {value: T; label: string; description?: string}[];
  onChange: (v: T) => void;
}) {
  const t = usePalette();
  return (
    <View style={{gap: 8}}>
      {options.map(o => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{checked: value === o.value}}
          onPress={() => onChange(o.value)}
          style={({pressed}) => ({
            padding: 14,
            minHeight: 48,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: value === o.value ? t.accent : t.divider,
            backgroundColor: value === o.value ? t.accentLight : t.bgSurface,
            opacity: pressed ? 0.7 : 1,
            gap: 4,
          })}>
          <View style={ui.row}>
            <Text style={[ui.label, {color: t.textPrimary, flex: 1}]}>
              {o.label}
            </Text>
            {value === o.value && <Text style={{color: t.accent}}>✓</Text>}
          </View>
          {o.description && (
            <Txt muted small>
              {o.description}
            </Txt>
          )}
        </Pressable>
      ))}
    </View>
  );
}
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: {value: string; label: string; description?: string}[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const t = usePalette();
  return (
    <View style={{gap: 7}}>
      <Text style={[ui.label, {color: t.textPrimary}]}>{label}</Text>
      <Button
        tone="quiet"
        label={`${options.find(o => o.value === value)?.label || '请选择'}  ▾`}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}>
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: t.backdrop,
          }}>
          <Pressable
            accessibilityLabel="关闭选择"
            style={ui.fill}
            onPress={() => setOpen(false)}
          />
          <SafeAreaView
            edges={['bottom']}
            style={{
              maxHeight: '75%',
              padding: 20,
              gap: 16,
              backgroundColor: t.bgSurface,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
            }}>
            <View style={ui.row}>
              <Text style={[ui.h2, {flex: 1, color: t.textPrimary}]}>
                {label}
              </Text>
              <Button
                tone="quiet"
                label="关闭"
                onPress={() => setOpen(false)}
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Choices
                value={value}
                options={options}
                onChange={v => {
                  onChange(v);
                  setOpen(false);
                }}
              />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}
export function Segments({
  value,
  options,
  onChange,
}: {
  value: string;
  options: {value: string; label: string}[];
  onChange: (v: string) => void;
}) {
  const t = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.bg,
        borderRadius: 10,
        padding: 3,
      }}>
      {options.map(o => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityState={{selected: o.value === value}}
          onPress={() => onChange(o.value)}
          style={{
            flex: 1,
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            borderRadius: 8,
            backgroundColor: o.value === value ? t.bgSurface : 'transparent',
          }}>
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              color: o.value === value ? t.accent : t.textSecondary,
            }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function AnswerText({text}: {text: string}) {
  const t = usePalette();
  const size = useContext(FontSize);
  return (
    <View style={{gap: 12}}>
      {markdownBlocks(text).map((block, i) => {
        if (block.kind === 'table') {
          return (
            <ScrollView horizontal key={i}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: t.divider,
                  borderRadius: 8,
                }}>
                {block.rows.map((row, n) => (
                  <View
                    key={n}
                    style={{
                      flexDirection: 'row',
                      backgroundColor: n === 0 ? t.bg : t.bgSurface,
                    }}>
                    {row.map((cell, j) => (
                      <Text
                        selectable
                        key={j}
                        style={{
                          width: 180,
                          padding: 12,
                          color: t.textPrimary,
                          fontSize: size,
                          lineHeight: size * 1.6,
                          fontWeight: n === 0 ? '600' : '400',
                        }}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }
        if (block.kind === 'code') {
          return (
            <ScrollView
              key={i}
              horizontal
              style={{backgroundColor: t.bg, borderRadius: 10}}>
              <Text
                selectable
                style={{
                  padding: 14,
                  fontFamily: 'monospace',
                  color: t.textPrimary,
                  fontSize: size - 2,
                  lineHeight: size * 1.55,
                }}>
                {block.text}
              </Text>
            </ScrollView>
          );
        }
        return (
          <Text
            selectable
            key={i}
            style={{
              color: t.textPrimary,
              fontSize: block.kind === 'heading' ? size + 2 : size,
              fontWeight: block.kind === 'heading' ? '600' : '400',
              lineHeight: size * 1.65,
            }}>
            {block.text}
          </Text>
        );
      })}
    </View>
  );
}
