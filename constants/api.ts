import { Platform } from 'react-native';

// Read from Expo public env. Example: EXPO_PUBLIC_API_BASE_URL=http://192.168.1.10:3000
const fromEnv = (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_API_BASE_URL) || '';

// Default behavior keeps emulator/dev experience working
const fallback = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

export const API_BASE_URL = (fromEnv && fromEnv.trim()) || fallback;

export const apiUrl = (path: string) => {
  const base = API_BASE_URL.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
};

