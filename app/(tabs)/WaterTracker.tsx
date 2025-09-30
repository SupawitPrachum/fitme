// app/(tabs)/WaterTracker.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const API = API_BASE_URL;
const WATER_INTAKE_PREFIX = 'water_intake_v1';
const WATER_EVENTS_PREFIX = 'water_events_v1';
const WATER_REMINDER_PREFIX = 'water_reminder_v1';
const WATER_NOTIF_IDS_PREFIX = 'water_notif_ids_v1';

type Me = {
  id: number;
  username: string;
  weight_kg?: number | null;
  water_goal_l?: number | null;
  activity_level?: string | null;
  goal?: string | null;
};

type DailySummary = {
  date: string;
  total: number;
};

type Reminder = {
  enabled: boolean;
  intervalMinutes: number;
  startHour: number;
  endHour: number;
};

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress: number;
  target: number;
};

// Utility functions
const padZero = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const formatDate = (date: Date): string => {
  return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}`;
};

const calculateWaterTarget = (weightKg?: number | null, fallback: number = 2): number => {
  if (!weightKg || weightKg <= 0) return fallback;
  const calculated = Number((weightKg * 0.033).toFixed(2));
  return Math.max(1.2, Math.min(5, calculated));
};

const getStorageKey = (userId: number, date: string): string => {
  return `${WATER_INTAKE_PREFIX}:${userId}:${date}`;
};

const getAuthToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(AUTH_KEY);
  } catch {
    return null;
  }
};

const getEventsKey = (userId: number, date: string): string => `${WATER_EVENTS_PREFIX}:${userId}:${date}`;
const getReminderKey = (userId: number): string => `${WATER_REMINDER_PREFIX}:${userId}`;
const getNotifIdsKey = (userId: number): string => `${WATER_NOTIF_IDS_PREFIX}:${userId}`;

const getStreakCount = async (userId: number): Promise<number> => {
  let streak = 0;
  const today = new Date();
  
  for (let i = 0; i < 365; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = formatDate(date);
    const key = getStorageKey(userId, dateStr);
    const raw = await AsyncStorage.getItem(key);
    const value = raw ? Number(raw) : 0;
    
    // Need to check against target - for now assume 2000ml minimum
    if (value >= 2000) {
      streak++;
    } else {
      break;
    }
  }
  
  return streak;
};

const calculateAchievements = (
  totalDays: number,
  streak: number,
  totalLiters: number
): Achievement[] => {
  return [
    {
      id: 'first_day',
      title: 'เริ่มต้นดี!',
      description: 'ดื่มน้ำครบเป้าวันแรก',
      icon: '🎯',
      unlocked: totalDays >= 1,
      progress: Math.min(totalDays, 1),
      target: 1,
    },
    {
      id: 'week_warrior',
      title: 'นักรบแห่งสัปดาห์',
      description: 'ดื่มน้ำครบเป้า 7 วันติดต่อกัน',
      icon: '🔥',
      unlocked: streak >= 7,
      progress: Math.min(streak, 7),
      target: 7,
    },
    {
      id: 'month_master',
      title: 'เซียนประจำเดือน',
      description: 'ดื่มน้ำครบเป้า 30 วันติดต่อกัน',
      icon: '⭐',
      unlocked: streak >= 30,
      progress: Math.min(streak, 30),
      target: 30,
    },
    {
      id: 'hydration_hero',
      title: 'ฮีโร่สายน้ำ',
      description: 'ดื่มน้ำไปแล้วรวม 100 ลิตร',
      icon: '💧',
      unlocked: totalLiters >= 100,
      progress: Math.min(totalLiters, 100),
      target: 100,
    },
    {
      id: 'ocean_drinker',
      title: 'ผู้ดื่มมหาสมุทร',
      description: 'ดื่มน้ำไปแล้วรวม 500 ลิตร',
      icon: '🌊',
      unlocked: totalLiters >= 500,
      progress: Math.min(totalLiters, 500),
      target: 500,
    },
  ];
};

export default function WaterTracker() {
  const [me, setMe] = useState<Me | null>(null);
  const [dateStr, setDateStr] = useState<string>(() => formatDate(new Date()));
  const [ml, setMl] = useState<number>(0);
  const [addStr, setAddStr] = useState<string>('');
  const [goalLStr, setGoalLStr] = useState<string>('');
  const [last7, setLast7] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [streak, setStreak] = useState<number>(0);
  const [totalLiters, setTotalLiters] = useState<number>(0);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [showAchievements, setShowAchievements] = useState<boolean>(false);
  const [cupSize, setCupSize] = useState<number>(250); // Default cup size
  const [events, setEvents] = useState<DrinkEvent[]>([]);
  const [reminder, setReminder] = useState<Reminder>({ enabled: false, intervalMinutes: 120, startHour: 9, endHour: 20 });

  // Memoized values
  const targetMl = useMemo(() => {
    const targetL = me?.water_goal_l ?? calculateWaterTarget(me?.weight_kg, 2);
    return Math.round(targetL * 1000);
  }, [me?.water_goal_l, me?.weight_kg]);

  const progressPercentage = useMemo(() => {
    if (targetMl === 0) return 0;
    return Math.max(0, Math.min(100, Math.round((ml / targetMl) * 100)));
  }, [ml, targetMl]);

  const currentGoalL = useMemo(() => {
    return me?.water_goal_l ?? calculateWaterTarget(me?.weight_kg, 2);
  }, [me?.water_goal_l, me?.weight_kg]);

  // Load user profile
  const loadMe = useCallback(async (): Promise<Me | null> => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        router.replace('/(tabs)/login');
        return null;
      }

      const res = await fetch(`${API}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        router.replace('/(tabs)/login');
        return null;
      }

      if (!res.ok) {
        throw new Error(`Failed to load profile: ${res.status}`);
      }

      const data = await res.json() as Me;
      setMe(data);
      
      if (data.water_goal_l != null) {
        setGoalLStr(String(data.water_goal_l));
      }

      return data;
    } catch (error) {
      console.error('Error loading user profile:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถโหลดข้อมูลผู้ใช้');
      return null;
    }
  }, []);

  // Load water intake for specific date
  const loadWater = useCallback(async (userId?: number, date?: string): Promise<void> => {
    try {
      const uid = userId ?? me?.id;
      if (!uid) return;

      const targetDate = date ?? dateStr;
      const key = getStorageKey(uid, targetDate);

      // Try server first (if token available), then fallback to local
      const token = await getAuthToken();
      if (token) {
        try {
          const res = await fetch(`${API}/api/water?date=${encodeURIComponent(targetDate)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const js = await res.json();
            const serverMl = Number(js?.ml || 0);
            const val = Number.isFinite(serverMl) ? serverMl : 0;
            setMl(val);
            await AsyncStorage.setItem(key, String(val)); // cache locally
            return;
          }
        } catch (e) {
          // ignore and fallback
        }
      }

      const raw = await AsyncStorage.getItem(key);
      const value = raw ? Number(raw) : 0;
      setMl(Number.isFinite(value) ? value : 0);
    } catch (error) {
      console.error('Error loading water intake:', error);
      setMl(0);
    }
  }, [me?.id, dateStr]);

  // Load events for selected date
  const loadEvents = useCallback(async (userId?: number, date?: string): Promise<void> => {
    try {
      const uid = userId ?? me?.id;
      if (!uid) return;
      const targetDate = date ?? dateStr;
      const key = getEventsKey(uid, targetDate);
      const raw = await AsyncStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) as DrinkEvent[] : [];
      if (Array.isArray(arr)) setEvents(arr); else setEvents([]);
    } catch {
      setEvents([]);
    }
  }, [me?.id, dateStr]);

  // Save water intake
  const saveWater = useCallback(async (newValue: number): Promise<void> => {
    try {
      const uid = me?.id;
      if (!uid) return;

      const key = getStorageKey(uid, dateStr);

      // Attempt to persist to server first
      const token = await getAuthToken();
      if (token) {
        try {
          const res = await fetch(`${API}/api/water`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ date: dateStr, ml: Math.max(0, Math.round(newValue)) }),
          });
          if (res.ok) {
            const safeVal = Math.max(0, Math.round(newValue));
            await AsyncStorage.setItem(key, String(safeVal));
            setMl(safeVal);
            return;
          }
        } catch (e) {
          // ignore and fallback
        }
      }

      // Fallback to local-only save
      await AsyncStorage.setItem(key, String(newValue));
      setMl(newValue);
    } catch (error) {
      console.error('Error saving water intake:', error);
      Alert.alert('เกิดข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูล');
    }
  }, [me?.id, dateStr]);

  // Load last 7 days summary
  const loadLast7Days = useCallback(async (): Promise<void> => {
    try {
      const uid = me?.id;
      if (!uid) return;

      const token = await getAuthToken();
      if (token) {
        try {
          // Load 7-day summary from server
          const r7 = await fetch(`${API}/api/water/summary?days=7`, { headers: { Authorization: `Bearer ${token}` } });
          if (r7.ok) {
            const js = await r7.json();
            const items: { date: string; ml: number }[] = Array.isArray(js?.items) ? js.items : [];
            const summaries: DailySummary[] = items.map(it => ({ date: it.date, total: Number(it.ml || 0) }));
            setLast7(summaries);

            // Compute days met goal and streak from these items
            const met = summaries.filter(d => d.total >= targetMl).length;
            // streak from end
            let s = 0;
            for (let i = summaries.length - 1; i >= 0; i--) {
              if (summaries[i].total >= targetMl) s++; else break;
            }
            setStreak(s);

            // Load 90-day to compute total liters
            try {
              const r90 = await fetch(`${API}/api/water/summary?days=90`, { headers: { Authorization: `Bearer ${token}` } });
              if (r90.ok) {
                const js90 = await r90.json();
                const items90: { date: string; ml: number }[] = Array.isArray(js90?.items) ? js90.items : [];
                const totalMl = items90.reduce((acc, d) => acc + Number(d.ml || 0), 0);
                const liters = Number((totalMl / 1000).toFixed(1));
                setTotalLiters(liters);
                const newAchievements = calculateAchievements(met, s, liters);
                setAchievements(newAchievements);
                return;
              }
            } catch {}

            // If 90-day load failed, approximate from last 7
            const approxLiters = Number((summaries.reduce((a,b)=>a+b.total,0) / 1000).toFixed(1));
            setTotalLiters(approxLiters);
            const newAchievements = calculateAchievements(met, s, approxLiters);
            setAchievements(newAchievements);
            return;
          }
        } catch {
          // fall back to local
        }
      }

      // Local fallback (AsyncStorage-only)
      const summaries: DailySummary[] = [];
      const today = new Date();
      let daysMetGoal = 0;

      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateString = formatDate(date);
        const key = getStorageKey(uid, dateString);
        const raw = await AsyncStorage.getItem(key);
        const dailyTotal = raw ? Number(raw) : 0;
        summaries.push({ date: dateString, total: Number.isFinite(dailyTotal) ? dailyTotal : 0 });
        if (dailyTotal >= targetMl) daysMetGoal++;
      }

      setLast7(summaries);
      const currentStreak = await getStreakCount(uid);
      setStreak(currentStreak);
      const allTimeTotal = await calculateTotalLiters(uid);
      setTotalLiters(allTimeTotal);
      const newAchievements = calculateAchievements(daysMetGoal, currentStreak, allTimeTotal);
      setAchievements(newAchievements);
    } catch (error) {
      console.error('Error loading 7-day summary:', error);
    }
  }, [me?.id, targetMl]);

  const calculateTotalLiters = async (userId: number): Promise<number> => {
    try {
      let total = 0;
      const today = new Date();
      
      // Check last 90 days for performance
      for (let i = 0; i < 90; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const key = getStorageKey(userId, formatDate(date));
        const raw = await AsyncStorage.getItem(key);
        const value = raw ? Number(raw) : 0;
        total += value;
      }
      
      return Number((total / 1000).toFixed(1));
    } catch {
      return 0;
    }
  };

  // Initial load
  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      const user = await loadMe();
      if (isMounted && user) {
        await loadWater(user.id, dateStr);
        await loadEvents(user.id, dateStr);
        // Load reminder settings
        try {
          const raw = await AsyncStorage.getItem(getReminderKey(user.id));
          if (raw) {
            const r = JSON.parse(raw) as Reminder;
            if (r && typeof r === 'object') setReminder({
              enabled: !!r.enabled,
              intervalMinutes: Math.max(15, Math.min(480, Number(r.intervalMinutes) || 120)),
              startHour: Math.max(0, Math.min(23, Number(r.startHour) || 9)),
              endHour: Math.max(0, Math.min(23, Number(r.endHour) || 20)),
            });
          }
        } catch {}
      }
    };

    initialize();

    return () => {
      isMounted = false;
    };
  }, [dateStr, loadMe, loadWater]);

  // Load 7-day summary when dependencies change
  useEffect(() => {
    loadLast7Days();
  }, [loadLast7Days, ml, dateStr]);

  // Reload events when date or user changes
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Change date
  const changeDay = useCallback((delta: number): void => {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + delta);
    setDateStr(formatDate(date));
  }, [dateStr]);

  const goToToday = useCallback((): void => {
    setDateStr(formatDate(new Date()));
  }, []);

  // Add water intake
  const addWater = useCallback(async (amount: number): Promise<void> => {
    if (!me?.id) return;
    const uid = me.id;
    const token = await getAuthToken();
    let newMl = ml + amount;
    if (token) {
      try {
        const r = await fetch(`${API}/api/water/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ add_ml: amount, date: dateStr }),
        });
        if (r.ok) {
          const js = await r.json();
          newMl = Number(js?.ml || newMl);
          setMl(newMl);
        } else {
          await saveWater(newMl);
        }
      } catch {
        await saveWater(newMl);
      }
    } else {
      await saveWater(newMl);
    }
    // Log event locally
    try {
      const key = getEventsKey(uid, dateStr);
      const raw = await AsyncStorage.getItem(key);
      const arr: DrinkEvent[] = raw ? JSON.parse(raw) : [];
      const next = [...(Array.isArray(arr) ? arr : []), { ts: Date.now(), amount } as DrinkEvent];
      setEvents(next);
      await AsyncStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }, [me?.id, ml, saveWater, dateStr]);

  // Subtract water intake
  const subtractWater = useCallback(async (amount: number): Promise<void> => {
    if (!me?.id) return;
    const uid = me.id;
    const newValue = Math.max(0, ml - amount);
    await saveWater(newValue);
    // Log negative event
    try {
      const key = getEventsKey(uid, dateStr);
      const raw = await AsyncStorage.getItem(key);
      const arr: DrinkEvent[] = raw ? JSON.parse(raw) : [];
      const next = [...(Array.isArray(arr) ? arr : []), { ts: Date.now(), amount: -amount } as DrinkEvent];
      setEvents(next);
      await AsyncStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }, [me?.id, ml, saveWater, dateStr]);

  // Add custom amount
  const addCustomAmount = useCallback(async (): Promise<void> => {
    const amount = parseInt(addStr, 10);
    
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกจำนวน ml ที่ถูกต้อง');
      return;
    }

    await addWater(amount);
    setAddStr('');
  }, [addStr, addWater]);

  // Reset daily intake
  const resetDaily = useCallback(async (): Promise<void> => {
    Alert.alert(
      'ยืนยันการรีเซ็ต',
      'ต้องการรีเซ็ตข้อมูลการดื่มน้ำของวันนี้?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'รีเซ็ต',
          style: 'destructive',
          onPress: async () => {
            await saveWater(0);
            // Clear events for the day
            try {
              if (me?.id) await AsyncStorage.removeItem(getEventsKey(me.id, dateStr));
              setEvents([]);
            } catch {}
          },
        },
      ]
    );
  }, [saveWater]);

  const deleteEventAt = useCallback(async (idx: number): Promise<void> => {
    try {
      const uid = me?.id; if (!uid) return;
      const key = getEventsKey(uid, dateStr);
      const arr = [...events];
      const ev = arr[idx];
      if (!ev) return;
      arr.splice(idx, 1);
      setEvents(arr);
      await AsyncStorage.setItem(key, JSON.stringify(arr));
      const newTotal = Math.max(0, ml - ev.amount); // revert this event
      await saveWater(newTotal);
    } catch {}
  }, [events, ml, me?.id, dateStr, saveWater]);

  const saveReminder = useCallback(async (): Promise<void> => {
    try {
      const uid = me?.id; if (!uid) return;
      const clean: Reminder = {
        enabled: !!reminder.enabled,
        intervalMinutes: Math.max(15, Math.min(480, Math.round(reminder.intervalMinutes || 120))),
        startHour: Math.max(0, Math.min(23, Math.round(reminder.startHour || 9))),
        endHour: Math.max(0, Math.min(23, Math.round(reminder.endHour || 20))),
      };
      await AsyncStorage.setItem(getReminderKey(uid), JSON.stringify(clean));

      // Schedule/cancel notifications via dynamic import
      try {
        const notif = await import('expo-notifications');
        // cancel existing first
        try {
          const idsRaw = await AsyncStorage.getItem(getNotifIdsKey(uid));
          const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
          if (Array.isArray(ids) && ids.length) {
            await Promise.all(ids.map(id => notif.cancelScheduledNotificationAsync(id).catch(()=>{})));
          }
        } catch {}

        if (!clean.enabled) {
          await AsyncStorage.setItem(getNotifIdsKey(uid), JSON.stringify([]));
          Alert.alert('บันทึกแล้ว', 'ปิดการแจ้งเตือนการดื่มน้ำ');
          return;
        }

        // ask permission
        const { status } = await notif.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('ไม่ได้รับอนุญาต', 'กรุณาอนุญาตการแจ้งเตือนในระบบ');
          return;
        }

        // Set a simple handler (optional)
        notif.setNotificationHandler({
          handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
        });

        // Schedule repeating notifications at specific times daily
        const ids: string[] = [];
        const start = clean.startHour;
        const end = clean.endHour;
        const interval = clean.intervalMinutes;
        const times: { hour: number; minute: number }[] = [];
        const t0 = new Date(); t0.setHours(start, 0, 0, 0);
        for (let t = new Date(t0); t.getHours() <= end; t = new Date(t.getTime() + interval * 60000)) {
          times.push({ hour: t.getHours(), minute: t.getMinutes() });
        }
        for (const tm of times) {
          const id = await notif.scheduleNotificationAsync({
            content: { title: 'ดื่มน้ำกันเถอะ 💧', body: 'พักสั้นๆ แล้วดื่มน้ำสักแก้วนะ', sound: false },
            trigger: { type: notif.SchedulableTriggerInputTypes.DAILY, hour: tm.hour, minute: tm.minute },
          });
          ids.push(id);
        }
        await AsyncStorage.setItem(getNotifIdsKey(uid), JSON.stringify(ids));
        Alert.alert('บันทึกแล้ว', `ตั้งแจ้งเตือนทุก ${interval} นาที ตั้งแต่ ${start}:00 ถึง ${end}:00`);
      } catch (e) {
        // expo-notifications not installed
        Alert.alert('ติดตั้งแพคเกจเพิ่ม', 'ต้องติดตั้ง expo-notifications เพื่อใช้การแจ้งเตือน');
      }
    } catch (e: any) {
      Alert.alert('บันทึกไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    }
  }, [me?.id, reminder]);

  // Save water goal
  const saveWaterGoal = useCallback(async (): Promise<void> => {
    const goalL = parseFloat(goalLStr);

    if (!Number.isFinite(goalL) || goalL <= 0) {
      Alert.alert('ข้อมูลไม่ถูกต้อง', 'กรุณากรอกเป้าน้ำที่ถูกต้อง');
      return;
    }

    setLoading(true);

    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        router.replace('/(tabs)/login');
        return;
      }

      const res = await fetch(`${API}/api/me/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exercise_type: null,
          activity_level: me?.activity_level ?? null,
          weight_kg: me?.weight_kg ?? null,
          height_cm: null,
          water_goal_l: goalL,
          health_condition: null,
          goal: me?.goal ?? null,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || 'Failed to update profile');
      }

      setMe((prev) => (prev ? { ...prev, water_goal_l: goalL } : prev));
      Alert.alert('สำเร็จ', 'อัปเดตเป้าน้ำต่อวันแล้ว');
    } catch (error: any) {
      console.error('Error saving water goal:', error);
      Alert.alert('บันทึกไม่สำเร็จ', error?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [goalLStr, me]);

  // Quick add buttons
  const quickAddButtons = [200, 300, 500];

  const getMotivationalMessage = (): string => {
    if (progressPercentage >= 100) return '🎉 เยี่ยมมาก! คุณทำได้!';
    if (progressPercentage >= 75) return '💪 เกือบถึงแล้ว สู้ๆ!';
    if (progressPercentage >= 50) return '👍 ครึ่งทางแล้ว ดื่มต่อเลย!';
    if (progressPercentage >= 25) return '🌟 เริ่มต้นดีแล้ว!';
    return '💧 มาดื่มน้ำกันเถอะ!';
  };

  const getHydrationLevel = (): { level: string; color: string; emoji: string } => {
    if (progressPercentage >= 100) return { level: 'เยี่ยม', color: '#10b981', emoji: '🌟' };
    if (progressPercentage >= 75) return { level: 'ดี', color: '#3b82f6', emoji: '💙' };
    if (progressPercentage >= 50) return { level: 'ปานกลาง', color: '#f59e0b', emoji: '💛' };
    if (progressPercentage >= 25) return { level: 'น้อย', color: '#f97316', emoji: '🧡' };
    return { level: 'น้อยมาก', color: '#ef4444', emoji: '❤️' };
  };

  const hydrationStatus = getHydrationLevel();

  return (
    <ScrollView 
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={styles.title}>ตัวติดตามการดื่มน้ำ</Text>
      
      {/* Stats Overview */}
      <View style={styles.statsOverview}>
        <View style={styles.statBox}>
          <Text style={styles.statEmoji}>🔥</Text>
          <Text style={styles.statNumber}>{streak}</Text>
          <Text style={styles.statLabel}>วันติดต่อกัน</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statEmoji}>💧</Text>
          <Text style={styles.statNumber}>{totalLiters}L</Text>
          <Text style={styles.statLabel}>รวมทั้งหมด</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statEmoji}>{hydrationStatus.emoji}</Text>
          <Text style={[styles.statNumber, { color: hydrationStatus.color }]}>
            {hydrationStatus.level}
          </Text>
          <Text style={styles.statLabel}>สถานะ</Text>
        </View>
      </View>

      <Text style={styles.meta}>เลือกวัน • {dateStr}</Text>

      {/* Date Navigation */}
      <View style={styles.dateNavigation}>
        <TouchableOpacity 
          style={styles.btn} 
          onPress={() => changeDay(-1)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>‹ เมื่อวาน</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.btn} 
          onPress={goToToday}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>วันนี้</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.btn} 
          onPress={() => changeDay(1)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>พรุ่งนี้ ›</Text>
        </TouchableOpacity>
      </View>

      {/* Progress Card */}
      <View style={[styles.card, styles.progressCard]}>
        <View style={styles.motivationBanner}>
          <Text style={styles.motivationText}>{getMotivationalMessage()}</Text>
        </View>
        
        <Text style={styles.cardLine}>
          ดื่มแล้ว: <Text style={styles.bold}>{Math.round(ml)}</Text> ml / 
          เป้า <Text style={styles.bold}>{targetMl}</Text> ml 
          ({progressPercentage}%)
        </Text>
        
        <View style={styles.progressOuter}>
          <View 
            style={[
              styles.progressInner, 
              { 
                width: `${progressPercentage}%`,
                backgroundColor: hydrationStatus.color 
              }
            ]} 
          />
        </View>

        {/* Quick Add Buttons */}
        <View style={styles.rowWrap}>
          {quickAddButtons.map((amount) => (
            <TouchableOpacity
              key={amount}
              style={styles.btn}
              onPress={() => addWater(amount)}
              activeOpacity={0.7}
            >
              <Text style={styles.btnText}>+{amount} ml</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.btn}
            onPress={() => subtractWater(100)}
            activeOpacity={0.7}
          >
            <Text style={styles.btnText}>-100 ml</Text>
          </TouchableOpacity>
        </View>

        {/* Cup Size Presets */}
        <Text style={styles.miniSection}>ขนาดแก้ว</Text>
        <View style={styles.rowWrap}>
          {[150, 250, 350, 500].map((size) => (
            <TouchableOpacity
              key={size}
              style={[styles.btnSmall, cupSize === size && styles.btnActive]}
              onPress={() => setCupSize(size)}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnTextSmall, cupSize === size && styles.btnTextActive]}>
                {size}ml
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        
        <TouchableOpacity
          style={[styles.btn, styles.cupBtn]}
          onPress={() => addWater(cupSize)}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>🥤 ดื่ม 1 แก้ว ({cupSize} ml)</Text>
        </TouchableOpacity>

        {/* Custom Amount Input */}
        <View style={[styles.rowWrap, styles.customInputRow]}>
          <TextInput
            value={addStr}
            onChangeText={setAddStr}
            keyboardType="numeric"
            placeholder="ระบุ ml เช่น 250"
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={addCustomAmount}
          />
          <TouchableOpacity
            style={[styles.btn, styles.primaryBtn]}
            onPress={addCustomAmount}
            activeOpacity={0.7}
          >
            <Text style={[styles.btnText, styles.primaryBtnText]}>เพิ่ม</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btn}
            onPress={resetDaily}
            activeOpacity={0.7}
          >
            <Text style={styles.btnText}>รีเซ็ตวันนี้</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Goal Setting */}
      <Text style={styles.section}>เป้าน้ำต่อวัน</Text>
      <View style={styles.card}>
        <Text style={styles.cardLine}>
          ปัจจุบัน: <Text style={styles.bold}>{currentGoalL}</Text> L/วัน
        </Text>
        <View style={[styles.rowWrap, styles.goalInputRow]}>
          <TextInput
            value={goalLStr}
            onChangeText={setGoalLStr}
            keyboardType="numeric"
            placeholder="เช่น 2.5"
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={saveWaterGoal}
          />
          <TouchableOpacity
            style={[styles.btn, styles.primaryBtn]}
            onPress={saveWaterGoal}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={[styles.btnText, styles.primaryBtnText]}>
              {loading ? 'กำลังบันทึก...' : 'บันทึกเป้า'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Today Events */}
      <Text style={styles.section}>ประวัติการดื่มวันนี้</Text>
      <View style={styles.card}>
        {events.length === 0 ? (
          <Text style={styles.cardLine}>ยังไม่มีรายการสำหรับ {dateStr}</Text>
        ) : (
          events
            .slice()
            .sort((a,b)=>a.ts-b.ts)
            .map((ev, idx) => {
              const d = new Date(ev.ts);
              const hh = padZero(d.getHours());
              const mm = padZero(d.getMinutes());
              const positive = ev.amount >= 0;
              return (
                <View key={String(ev.ts)+':'+idx} style={styles.eventItem}>
                  <Text style={styles.eventTime}>{hh}:{mm}</Text>
                  <Text style={[styles.eventAmount, positive ? styles.eventPlus : styles.eventMinus]}>
                    {positive ? '+' : ''}{Math.abs(ev.amount)} ml
                  </Text>
                  <TouchableOpacity style={[styles.btnSmall, styles.deleteBtn]} onPress={() => deleteEventAt(idx)} activeOpacity={0.7}>
                    <Text style={[styles.btnTextSmall, styles.deleteBtnText]}>ลบ</Text>
                  </TouchableOpacity>
                </View>
              );
            })
        )}
      </View>

      {/* Reminders */}
      <Text style={styles.section}>การแจ้งเตือนการดื่มน้ำ</Text>
      <View style={styles.card}>
        <View style={[styles.rowWrap, { alignItems: 'center' }]}>
          <TouchableOpacity style={[styles.btnSmall, reminder.enabled && styles.btnActive]} onPress={() => setReminder(r=>({ ...r, enabled: !r.enabled }))}>
            <Text style={[styles.btnTextSmall, reminder.enabled && styles.btnTextActive]}>{reminder.enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</Text>
          </TouchableOpacity>
          <Text style={styles.cardLine}>ช่วงเวลา:</Text>
          <TextInput
            value={String(reminder.startHour)}
            onChangeText={(t)=>setReminder(r=>({ ...r, startHour: Math.max(0, Math.min(23, Number(t.replace(/\D/g,'') || 0))) }))}
            keyboardType="numeric"
            placeholder="เริ่ม (ชั่วโมง)"
            style={[styles.input, { maxWidth: 80 }]}
          />
          <Text style={styles.cardLine}>ถึง</Text>
          <TextInput
            value={String(reminder.endHour)}
            onChangeText={(t)=>setReminder(r=>({ ...r, endHour: Math.max(0, Math.min(23, Number(t.replace(/\D/g,'') || 0))) }))}
            keyboardType="numeric"
            placeholder="สิ้นสุด (ชั่วโมง)"
            style={[styles.input, { maxWidth: 100 }]}
          />
        </View>
        <View style={[styles.rowWrap, { alignItems: 'center' }]}>
          <Text style={styles.cardLine}>ความถี่ (นาที):</Text>
          <TextInput
            value={String(reminder.intervalMinutes)}
            onChangeText={(t)=>setReminder(r=>({ ...r, intervalMinutes: Math.max(15, Math.min(480, Number(t.replace(/\D/g,'') || 0))) }))}
            keyboardType="numeric"
            placeholder="เช่น 120"
            style={[styles.input, { maxWidth: 120 }]}
          />
          <TouchableOpacity style={[styles.btn, styles.primaryBtn]} onPress={saveReminder} activeOpacity={0.7}>
            <Text style={[styles.btnText, styles.primaryBtnText]}>บันทึกแจ้งเตือน</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.meta}>ต้องติดตั้งแพคเกจ expo-notifications และอนุญาตการแจ้งเตือนในระบบ</Text>
      </View>

      {/* Last 7 Days Summary */}
      <Text style={styles.section}>สรุป 7 วัน</Text>
      <View style={styles.card}>
        {last7.length === 0 ? (
          <Text style={styles.cardLine}>กำลังโหลดข้อมูล...</Text>
        ) : (
          <>
            {last7.map((day) => {
              const percentage = Math.max(
                0,
                Math.min(100, Math.round((day.total / Math.max(1, targetMl)) * 100))
              );
              const isToday = day.date === formatDate(new Date());
              
              return (
                <View key={day.date} style={styles.summaryItem}>
                  <Text style={[styles.cardLine, isToday && styles.todayText]}>
                    {isToday ? '📍 ' : ''}{day.date} • {Math.round(day.total)} ml ({percentage}%)
                  </Text>
                  <View style={styles.progressOuter}>
                    <View style={[styles.progressInner, { width: `${percentage}%` }]} />
                  </View>
                </View>
              );
            })}
            
            <View style={styles.weekSummary}>
              <Text style={styles.weekSummaryText}>
                💪 ทำได้ {last7.filter(d => (d.total / targetMl) >= 1).length}/7 วัน
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Achievements */}
      <View style={styles.achievementsSection}>
        <TouchableOpacity 
          style={styles.achievementsHeader}
          onPress={() => setShowAchievements(!showAchievements)}
          activeOpacity={0.7}
        >
          <Text style={styles.section}>🏆 ความสำเร็จ</Text>
          <Text style={styles.achievementCount}>
            {achievements.filter(a => a.unlocked).length}/{achievements.length}
          </Text>
        </TouchableOpacity>
        
        {showAchievements && (
          <View style={styles.card}>
            {achievements.map((achievement) => (
              <View 
                key={achievement.id} 
                style={[
                  styles.achievementItem,
                  !achievement.unlocked && styles.achievementLocked
                ]}
              >
                <Text style={styles.achievementIcon}>{achievement.icon}</Text>
                <View style={styles.achievementInfo}>
                  <Text style={[
                    styles.achievementTitle,
                    !achievement.unlocked && styles.lockedText
                  ]}>
                    {achievement.title}
                  </Text>
                  <Text style={styles.achievementDesc}>{achievement.description}</Text>
                  {!achievement.unlocked && (
                    <View style={styles.achievementProgressOuter}>
                      <View 
                        style={[
                          styles.achievementProgressInner,
                          { width: `${(achievement.progress / achievement.target) * 100}%` }
                        ]} 
                      />
                    </View>
                  )}
                </View>
                {achievement.unlocked && (
                  <Text style={styles.unlockedBadge}>✓</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Back Button */}
      <View style={styles.backButtonContainer}>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.replace('/(tabs)/StatsScreen')}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>‹ กลับสถิติ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.replace('/(tabs)/Homesrceen')}
          activeOpacity={0.7}
        >
          <Text style={styles.btnText}>🏠 หน้าแรก</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111',
  },
  meta: {
    color: '#6b7280',
    marginTop: 4,
  },
  dateNavigation: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  section: {
    marginTop: 16,
    marginBottom: 6,
    fontWeight: '800',
    color: '#111',
  },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 12,
    marginTop: 6,
  },
  progressCard: {
    marginTop: 12,
  },
  cardLine: {
    color: '#374151',
  },
  bold: {
    fontWeight: '800',
    color: '#111',
  },
  progressOuter: {
    height: 10,
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 6,
  },
  progressInner: {
    height: '100%',
    backgroundColor: '#60a5fa',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  customInputRow: {
    marginTop: 8,
  },
  goalInputRow: {
    marginTop: 8,
  },
  btn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: '#8b5cf6',
    borderColor: '#7c3aed',
  },
  btnText: {
    color: '#3730a3',
    fontWeight: '800',
  },
  primaryBtnText: {
    color: '#fff',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    minWidth: 120,
    flex: 1,
  },
  summaryItem: {
    marginBottom: 8,
  },
  todayText: {
    fontWeight: '900',
    color: '#8b5cf6',
  },
  weekSummary: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  weekSummaryText: {
    textAlign: 'center',
    fontWeight: '700',
    color: '#6b7280',
  },
  backButtonContainer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  statsOverview: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  motivationBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  motivationText: {
    textAlign: 'center',
    fontWeight: '700',
    color: '#92400e',
  },
  miniSection: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    marginTop: 12,
    marginBottom: 4,
  },
  btnSmall: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  btnActive: {
    backgroundColor: '#8b5cf6',
    borderColor: '#7c3aed',
  },
  btnTextSmall: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '700',
  },
  btnTextActive: {
    color: '#fff',
  },
  cupBtn: {
    marginTop: 8,
  },
  achievementsSection: {
    marginTop: 8,
  },
  achievementsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  achievementCount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#8b5cf6',
  },
  achievementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    marginBottom: 8,
  },
  achievementLocked: {
    opacity: 0.6,
  },
  achievementIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  achievementInfo: {
    flex: 1,
  },
  achievementTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111',
  },
  lockedText: {
    color: '#6b7280',
  },
  achievementDesc: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  achievementProgressOuter: {
    height: 4,
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    marginTop: 6,
    overflow: 'hidden',
  },
  achievementProgressInner: {
    height: '100%',
    backgroundColor: '#8b5cf6',
  },
  unlockedBadge: {
    fontSize: 20,
    color: '#10b981',
  },
  // Events
  eventItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  eventTime: {
    minWidth: 52,
    color: '#6b7280',
    fontWeight: '700',
  },
  eventAmount: {
    flex: 1,
    textAlign: 'right',
    fontWeight: '800',
  },
  eventPlus: { color: '#10b981' },
  eventMinus: { color: '#ef4444' },
  deleteBtn: {
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
  },
  deleteBtnText: { color: '#b91c1c' },
});
type DrinkEvent = {
  ts: number; // epoch ms
  amount: number; // ml (positive for add, negative for subtract)
};
