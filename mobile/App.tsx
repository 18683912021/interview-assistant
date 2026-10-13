import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  StatusBar,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  type Settings as Preferences,
} from './src/api/workspace';
import {
  clearProfile,
  clearToken,
  getToken,
  verifyToken,
} from './src/utils/token';
import {useTheme} from './src/theme';
import {FontSize, Palette, ui, Notice, Button} from './src/workspace/ui';
import Auth from './src/workspace/Auth';
import {InterviewLive, InterviewSetup} from './src/workspace/Interview';
import {useInterview} from './src/workspace/useInterview';
import Library from './src/workspace/Library';
import Tools from './src/workspace/Tools';
import History from './src/workspace/History';
import Settings from './src/workspace/Settings';

function Workspace({
  settings,
  onSave,
  onLogout,
}: {
  settings: Preferences;
  onSave: (v: Partial<Preferences>) => Promise<void>;
  onLogout: () => void;
}) {
  const c = useInterview();
  const [tab, setTab] = useState('interview'),
    [keyboard, setKeyboard] = useState(false);
  const dark = useColorScheme() === 'dark';
  const t = useTheme(
    settings.theme === 'dark' || (settings.theme === 'system' && dark),
  );
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
      b = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (c.session && c.session.status !== 'completed') {
        Alert.alert('面试进行中', '可以暂停麦克风，面试记录会保留。', [
          {text: '继续面试', style: 'cancel'},
          {text: '暂停采集', onPress: () => c.stop(false)},
        ]);
        return true;
      }
      if (c.session) {
        c.close();
        return true;
      }
      if (tab !== 'interview') {
        setTab('interview');
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [c, tab]);
  const tabs = [
    {id: 'interview', label: '面试', icon: '◉'},
    {id: 'library', label: '资料', icon: '▤'},
    {id: 'tools', label: '准备', icon: '◇'},
    {id: 'history', label: '记录', icon: '◷'},
    {id: 'settings', label: '设置', icon: '☷'},
  ];
  return (
    <Palette.Provider value={t}>
      <FontSize.Provider value={settings.font_size}>
        <SafeAreaView
          style={[ui.fill, {backgroundColor: t.bgSurface}]}
          edges={['top', 'bottom', 'left', 'right']}>
          <StatusBar
            barStyle={
              settings.theme === 'dark' || (settings.theme === 'system' && dark)
                ? 'light-content'
                : 'dark-content'
            }
            backgroundColor={t.bgSurface}
          />
          {c.session ? (
            <InterviewLive controller={c} />
          ) : tab === 'interview' ? (
            <InterviewSetup controller={c} settings={settings} />
          ) : tab === 'library' ? (
            <Library />
          ) : tab === 'tools' ? (
            <Tools />
          ) : tab === 'history' ? (
            <History onResume={c.openSaved} />
          ) : (
            <Settings settings={settings} onSave={onSave} onLogout={onLogout} />
          )}
          {!c.session && !keyboard && (
            <View
              style={{
                flexDirection: 'row',
                borderTopWidth: 1,
                borderColor: t.divider,
                paddingTop: 4,
              }}>
              {tabs.map(v => (
                <Pressable
                  key={v.id}
                  accessibilityRole="tab"
                  accessibilityLabel={v.label}
                  accessibilityState={{selected: tab === v.id}}
                  onPress={() => setTab(v.id)}
                  style={({pressed}) => ({
                    flex: 1,
                    minHeight: 60,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    opacity: pressed ? 0.6 : 1,
                  })}>
                  <Text
                    style={{
                      fontSize: 23,
                      color: tab === v.id ? t.accent : t.textTertiary,
                    }}>
                    {v.icon}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '600',
                      color: tab === v.id ? t.accent : t.textSecondary,
                    }}>
                    {v.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </SafeAreaView>
      </FontSize.Provider>
    </Palette.Provider>
  );
}
export default function App() {
  const [logged, setLogged] = useState(false),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(''),
    [settings, setSettings] = useState<Preferences>(DEFAULT_SETTINGS);
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const check = async () => {
    setChecking(true);
    setError('');
    try {
      const token = await getToken();
      if (token) {
        const email = await verifyToken();
        if (!email) {
          setError('登录校验失败，请检查网络后重试，或重新登录');
        } else {
          setLogged(true);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    check();
  }, []);
  useEffect(() => {
    if (logged) {
      getSettings()
        .then(setSettings)
        .catch(() => {});
    }
  }, [logged]);
  return (
    <SafeAreaProvider>
      <Palette.Provider value={t}>
        {checking ? (
          <SafeAreaView
            style={[
              ui.fill,
              {
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: t.bg,
              },
            ]}>
            <ActivityIndicator color={t.accent} />
            <Text style={{marginTop: 12, color: t.textSecondary}}>
              正在载入…
            </Text>
          </SafeAreaView>
        ) : logged ? (
          <Workspace
            settings={settings}
            onSave={async patch => setSettings(await saveSettings(patch))}
            onLogout={async () => {
              await clearToken();
              await clearProfile();
              setLogged(false);
              setSettings(DEFAULT_SETTINGS);
            }}
          />
        ) : error ? (
          <SafeAreaView
            style={[
              ui.fill,
              ui.page,
              {justifyContent: 'center', backgroundColor: t.bg},
            ]}>
            <Notice text={error} />
            <Button label="重新连接" onPress={check} />
            <Button
              tone="quiet"
              label="重新登录"
              onPress={() => setError('')}
            />
          </SafeAreaView>
        ) : (
          <SafeAreaView style={[ui.fill, {backgroundColor: t.bg}]}>
            <Auth onLogin={() => setLogged(true)} />
          </SafeAreaView>
        )}
      </Palette.Provider>
    </SafeAreaProvider>
  );
}
