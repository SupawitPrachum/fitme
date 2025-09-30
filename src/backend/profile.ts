// src/lib/profile.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const AUTH_KEY = 'auth_token';
export const API_URL = Platform.select({
  android: 'http://10.0.2.2:3000',
  ios: 'http://localhost:3000',
  default: 'http://localhost:3000',
});

export type ProfilePayload = {
  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
};

export async function fetchMe() {
  const token = await AsyncStorage.getItem(AUTH_KEY);
  if (!token) throw new Error('no token');

  const res = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateProfile(patch: ProfilePayload) {
  const token = await AsyncStorage.getItem(AUTH_KEY);
  if (!token) throw new Error('no token');

  const res = await fetch(`${API_URL}/api/me/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json(); // { ok: true }
}
