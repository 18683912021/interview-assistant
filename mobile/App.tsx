import React, {useCallback, useEffect, useState} from 'react';
import {View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import TabNavigator from './src/navigation/TabNavigator';
import AuthScreen from './src/screens/AuthScreen';
import {AppAlertProvider} from './src/components/AppAlert';
import {AuthContext} from './src/utils/AuthContext';
import {clearToken, verifyToken} from './src/utils/token';

export default function App(): React.JSX.Element {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);

  // 启动时检查本地 token 是否仍然有效
  useEffect(() => {
    verifyToken()
      .then(email => {
        if (email) { setIsLoggedIn(true); }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = useCallback(async () => {
    await clearToken();
    setIsLoggedIn(false);
  }, []);

  // token 校验中不渲染任何内容（避免闪屏）
  if (checking) {
    return <View />;
  }

  return (
    <AuthContext.Provider value={{logout: handleLogout}}>
      <SafeAreaProvider>
        <AppAlertProvider>
          {isLoggedIn ? (
            <TabNavigator />
          ) : (
            <AuthScreen onLogin={() => setIsLoggedIn(true)} onRegister={() => setIsLoggedIn(true)} />
          )}
        </AppAlertProvider>
      </SafeAreaProvider>
    </AuthContext.Provider>
  );
}
