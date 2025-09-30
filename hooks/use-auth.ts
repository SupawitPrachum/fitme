import AsyncStorage from '@react-native-async-storage/async-storage';

export const AUTH_KEY = 'auth_token';

export const getToken = async (): Promise<string | null> => {
  try { return await AsyncStorage.getItem(AUTH_KEY); } catch { return null; }
};

export const clearToken = async (): Promise<void> => {
  try { await AsyncStorage.removeItem(AUTH_KEY); } catch {}
};

export const authHeaders = async (): Promise<Record<string,string>> => {
  const t = await getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};

