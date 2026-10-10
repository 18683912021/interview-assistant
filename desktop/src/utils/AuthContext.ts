import {createContext} from 'react';
import type {UserProfile} from '../api/auth';
export const AuthContext = createContext<{
  logout: () => Promise<void>;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
}>({logout: async () => {}, profile: null, refreshProfile: async () => {}});
