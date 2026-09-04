/**
 * AppAlert — 全局统一弹窗组件
 *
 * 替代系统 Alert.alert()，风格与 App 整体设计统一。
 * 通过 AlertContext 在任意位置调用，无需 prop 传递。
 *
 * 用法：
 *   const { showAlert } = useAppAlert();
 *   showAlert({ title: '提示', message: '请先输入邮箱' });
 *   showAlert({ title: '确认', message: '确定删除？', confirmText: '删除', onConfirm: () => {} });
 */

import React, {createContext, useCallback, useContext, useRef, useState} from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {useTheme, space, radius, type} from '../theme';

// ── Types ──
export interface AlertConfig {
  title: string;
  message: string;
  /** 确认按钮文字，默认 "确定" */
  confirmText?: string;
  /** 确认按钮是否为危险操作（红色） */
  confirmDestructive?: boolean;
  /** 是否显示取消按钮，默认单按钮模式下不显示 */
  showCancel?: boolean;
  /** 取消按钮文字，默认 "取消" */
  cancelText?: string;
  /** 确认回调 */
  onConfirm?: () => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 关闭后回调（无论哪种方式关闭） */
  onDismiss?: () => void;
}

interface AlertContextValue {
  showAlert: (config: AlertConfig) => void;
}

const AlertContext = createContext<AlertContextValue>({
  showAlert: () => {},
});

export function useAppAlert() {
  return useContext(AlertContext);
}

// ── Provider ──
export function AppAlertProvider({children}: {children: React.ReactNode}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<AlertConfig>({title: '', message: ''});
  const scale = useRef(new Animated.Value(0.85)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const configRef = useRef<AlertConfig>({title: '', message: ''});

  const showAlert = useCallback((cfg: AlertConfig) => {
    Keyboard.dismiss();
    configRef.current = cfg;
    setConfig(cfg);
    setVisible(true);
    Animated.parallel([
      Animated.spring(scale, {toValue: 1, useNativeDriver: true, tension: 280, friction: 20}),
      Animated.timing(opacity, {toValue: 1, duration: 200, useNativeDriver: true}),
    ]).start();
  }, [scale, opacity]);

  const dismiss = useCallback((fn?: () => void) => {
    Animated.parallel([
      Animated.timing(scale, {toValue: 0.9, duration: 150, useNativeDriver: true}),
      Animated.timing(opacity, {toValue: 0, duration: 150, useNativeDriver: true}),
    ]).start(() => {
      setVisible(false);
      fn?.();
      configRef.current.onDismiss?.();
    });
  }, [scale, opacity]);

  const handleConfirm = useCallback(() => {
    dismiss(configRef.current.onConfirm);
  }, [dismiss]);

  const handleCancel = useCallback(() => {
    dismiss(configRef.current.onCancel);
  }, [dismiss]);

  const handleBackdrop = useCallback(() => {
    // 单按钮模式不允许点遮罩关闭
    if (configRef.current.showCancel || configRef.current.onCancel) {
      handleCancel();
    }
  }, [handleCancel]);

  const showCancel = config.showCancel || !!config.onCancel;
  const confirmText = config.confirmText || '确定';
  const cancelText = config.cancelText || '取消';

  return (
    <AlertContext.Provider value={{showAlert}}>
      {children}
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={showCancel ? handleCancel : () => {}}>
        <Pressable style={premiumStyles.backdrop} onPress={handleBackdrop}>
          <Animated.View
            style={[
              premiumStyles.card,
              {backgroundColor: t.bgSurface},
              t.shadowLg,
              {opacity, transform: [{scale}]},
            ]}
            // 阻止点击穿透到 backdrop
            onStartShouldSetResponder={() => true}>

            {/* ── 标题 ── */}
            <Text style={[premiumStyles.title, {color: t.textPrimary}]}>{config.title}</Text>

            {/* ── 内容 ── */}
            <Text style={[premiumStyles.message, {color: t.textSecondary}]}>{config.message}</Text>

            {/* ── 按钮 ── */}
            <View style={premiumStyles.btnRow}>
              {showCancel && (
                <TouchableOpacity
                  style={[premiumStyles.btn, premiumStyles.btnCancel, {borderColor: t.divider}]}
                  onPress={handleCancel}
                  activeOpacity={0.7}>
                  <Text style={[premiumStyles.btnCancelText, {color: t.textSecondary}]}>{cancelText}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  premiumStyles.btn,
                  premiumStyles.btnConfirm,
                  {backgroundColor: config.confirmDestructive ? t.danger : t.accent},
                ]}
                onPress={handleConfirm}
                activeOpacity={0.8}>
                <Text style={premiumStyles.btnConfirmText}>{confirmText}</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Pressable>
      </Modal>
    </AlertContext.Provider>
  );
}

// ── Premium Styles ──
const premiumStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 44,
  },
  card: {
    width: '100%',
    borderRadius: radius.xl,
    paddingTop: 28,
    paddingBottom: 22,
    paddingHorizontal: 28,
    alignItems: 'center',
  },

  // Title
  title: {
    ...type.heading,
    textAlign: 'center',
    marginBottom: 10,
  },

  // Message
  message: {
    ...type.body,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },

  // Buttons
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnCancel: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  btnConfirm: {},
  btnConfirmText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
