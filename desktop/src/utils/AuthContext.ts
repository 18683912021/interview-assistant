import { createContext } from 'react';

/** 全局登出回调，ProfileScreen 通过 context 触发 App 层的 isLoggedIn 切换 */
export const AuthContext = createContext<{ logout: () => void }>({ logout: () => {} });
