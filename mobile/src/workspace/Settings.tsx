import React, {useState} from 'react';
import {Alert, Linking, ScrollView, Text, View} from 'react-native';
import {ANSWER_STYLES, type Settings as Preferences} from '../api/workspace';
import {Button, Choices, Notice, Select, Txt, ui, usePalette} from './ui';
export default function Settings({
  settings,
  onSave,
  onLogout,
}: {
  settings: Preferences;
  onSave: (patch: Partial<Preferences>) => Promise<void>;
  onLogout: () => void;
}) {
  const t = usePalette();
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const save = async (patch: Partial<Preferences>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await onSave(patch);
      setNotice('偏好已保存，下次面试生效');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={ui.fill}>
      <View style={[ui.header, {borderColor: t.divider}]}>
        <Text style={[ui.title, {color: t.textPrimary}]}>设置</Text>
      </View>
      <ScrollView contentContainerStyle={ui.page}>
        <Notice text={busy ? '正在保存…' : notice} />
        <View pointerEvents={busy ? 'none' : 'auto'} style={{gap: 22}}>
          <Txt>默认回答方式</Txt>
          <Choices
            value={settings.answer_style}
            options={ANSWER_STYLES}
            onChange={v => save({answer_style: v})}
          />
          <Select
            label="回答语言"
            value={settings.language}
            options={[
              {value: 'auto', label: '跟随问题语言'},
              {value: 'zh', label: '中文'},
              {value: 'en', label: 'English'},
            ]}
            onChange={v => save({language: v as Preferences['language']})}
          />
          <Select
            label="外观"
            value={settings.theme}
            options={[
              {value: 'system', label: '跟随系统'},
              {value: 'light', label: '浅色'},
              {value: 'dark', label: '深色'},
            ]}
            onChange={v => save({theme: v as Preferences['theme']})}
          />
          <Select
            label="回答字号"
            value={String(settings.font_size)}
            options={[
              {value: '14', label: '紧凑'},
              {value: '16', label: '标准'},
              {value: '18', label: '大字'},
            ]}
            onChange={v =>
              save({font_size: Number(v) as Preferences['font_size']})
            }
          />
          <Select
            label="已结束面试的云端录音"
            value={String(settings.audio_retention_days || 0)}
            options={[
              {value: '0', label: '手动清理'},
              {value: '7', label: '7 天后自动清理'},
              {value: '30', label: '30 天后自动清理'},
            ]}
            onChange={v =>
              Alert.alert(
                '更改录音保留时间？',
                '自动清理只删除录音，保留文字记录；已超过期限的录音会被清理。',
                [
                  {text: '取消', style: 'cancel'},
                  {
                    text: '确认',
                    onPress: () =>
                      save({audio_retention_days: Number(v) as 0 | 7 | 30}),
                  },
                ],
              )
            }
          />
        </View>
        <View
          style={[
            ui.card,
            {borderColor: t.divider, backgroundColor: t.bgSurface},
          ]}>
          <Txt>麦克风权限</Txt>
          <Txt muted small>
            只请求麦克风与录音通知权限，不申请录屏或系统通话音频权限。来电或其他应用可能占用麦克风，遇到异常请暂停并重试。
          </Txt>
          <Button
            tone="quiet"
            label="打开应用权限设置"
            onPress={() => Linking.openSettings()}
          />
        </View>
        <Txt muted small>
          麦克风音频上传用于实时转写。应用不会在未开始面试时录音；结束后停止采集。应用中展示的回答仅供参考，个人经历请以真实资料为准。
        </Txt>
        <Button
          tone="danger"
          label="退出登录"
          onPress={() =>
            Alert.alert('退出登录？', '已经同步的资料与记录会保留。', [
              {text: '取消', style: 'cancel'},
              {text: '退出登录', onPress: onLogout},
            ])
          }
        />
        <Txt muted small>
          AI 面试助手 · Android 1.1.0
        </Txt>
      </ScrollView>
    </View>
  );
}
