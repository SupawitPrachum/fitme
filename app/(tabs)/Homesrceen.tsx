// app/(tabs)/HomeScreen.tsx
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  Alert,
  Pressable,
  useWindowDimensions,
  SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';
import { getToken } from '@/hooks/use-auth';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

const AUTH_KEY = 'auth_token';
const PLAN_CACHE_KEY = 'last_workout_plan_v1';
const LAST_DONE_KEY = 'last_workout_done_v1';
const HOME_NOTIF_IDS_KEY = 'home_notif_ids_v1';
const HOME_NOTIF_ON_KEY = 'home_notif_on_v1';

/** ========= Cross-platform Storage (web fallback) ========= **/
const storage = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, val: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, val);
      return;
    }
    return AsyncStorage.setItem(key, val);
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(key);
      return;
    }
    return AsyncStorage.removeItem(key);
  },
};

// Types for API responses
interface UserProfile {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  gender: 'male' | 'female' | string;
  date_of_birth: string;
  is_admin?: boolean;
  is_active?: boolean;
  photo_url?: string | null;

  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
}

// ===== Utilities =====
const d2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const ymd = (d: Date) => `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}`;
const waterTargetL = (weightKg?: number | null) => {
  if (!weightKg || weightKg <= 0) return 2;
  const v = +(Number(weightKg) * 0.033).toFixed(2);
  return Math.max(1.2, Math.min(5, v));
};

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const HomeScreen = ({ navigation }: HomeScreenProps) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const initialLoadedRef = useRef(false);
  const refreshBusyRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [todayPlan, setTodayPlan] = useState<{ planId:number; dayId:number; title?:string; focus?:string } | null>(null);
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isWide = isWeb && width >= 900;      // จอ desktop
  const isTablet = !isWeb && width >= 768;   // แท็บเล็ต

  // Weekly goal progress
  const [weekHydMl, setWeekHydMl] = useState(0);
  const [weekHydGoalMl, setWeekHydGoalMl] = useState(0);
  const [weekWkMins, setWeekWkMins] = useState(0);
  const [weekWkGoalMins, setWeekWkGoalMins] = useState(0);
  const [notifOn, setNotifOn] = useState(false);
  const [notifModal, setNotifModal] = useState(false);
  const [scheduledNotifs, setScheduledNotifs] = useState<{ id?: string; title?: string | null; body?: string | null; time?: string }[]>([]);

  // ---- helpers ----
  const showAlert = (title: string, message: string) => {
    if (isWeb && typeof window !== 'undefined') {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const fetchUserProfile = useCallback(async (): Promise<UserProfile | null> => {
    try {
      const token = await getToken();
      if (!token) {
        router.replace('/(tabs)/login');
        return null;
      }
      const res = await fetch(`${API_BASE_URL}/api/me`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401) {
        await storage.removeItem(AUTH_KEY);
        router.replace('/(tabs)/login');
        return null;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const data: UserProfile | null = await res.json();
      setUserProfile(data);
      return data ?? null;
    } catch (error: any) {
      console.error('Error fetching user profile:', error);
      showAlert('ข้อผิดพลาด', error?.message ?? 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setLoading(false);
    }
    return null;
  }, []);

  const loadWeeklyGoals = useCallback(async (profile?: UserProfile | null) => {
    try {
      const token = await getToken();
      if (!token) return;
      const me = profile ?? userProfile;
      // Week window Monday-Sunday
      const today = new Date();
      const startD = new Date(today);
      const dow = (startD.getDay() + 6) % 7; // Mon=0
      startD.setDate(startD.getDate() - dow);
      startD.setHours(0,0,0,0);
      const start = ymd(startD);
      const end = ymd(new Date(startD.getTime() + 6 * 86400000));

      // Hydration summary
      try {
        const r = await fetch(`${API_BASE_URL}/api/water/summary?days=14`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const js = await r.json();
          const items: { date: string; ml: number }[] = Array.isArray(js?.items) ? js.items : [];
          const totalMl = items.filter(it => it.date >= start && it.date <= end).reduce((s, x) => s + Number(x.ml || 0), 0);
          const goalL = me?.water_goal_l ?? waterTargetL(me?.weight_kg ?? undefined);
          const dailyTargetMl = Math.round((goalL || 2) * 1000);
          setWeekHydMl(totalMl);
          setWeekHydGoalMl(dailyTargetMl * 7);
        }
      } catch {}

      // Workout summary (daily)
      try {
        const r = await fetch(`${API_BASE_URL}/api/workout/daily?days=14`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) {
          const js = await r.json();
          const items: { date: string; sessions: number; durationSec: number }[] = Array.isArray(js?.items) ? js.items : [];
          const mins = items.filter(it => it.date >= start && it.date <= end).reduce((s, x) => s + Math.round(Number(x.durationSec || 0) / 60), 0);
          setWeekWkMins(mins);
        }
      } catch {}

      // Weekly workout goal from cached plan (if exists)
      try {
        const raw = await storage.getItem(PLAN_CACHE_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          const total = Number(p?.daysPerWeek || 0) * Number(p?.minutesPerSession || 0);
          if (total > 0) setWeekWkGoalMins(total);
        }
      } catch {}
    } catch {}
  }, [userProfile]);

  // moved below after refreshAll

  // will be defined after refreshAll

  // โหลดครั้งแรก (เฉพาะ UI/แผนจาก cache) — ไม่ยิง API ที่นี่
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true, // opacity รองรับบน web
    }).start();
    (async () => {
      try {
        const raw = await storage.getItem(PLAN_CACHE_KEY);
        if (!raw) { setTodayPlan(null); return; }
        const plan = JSON.parse(raw);
        const days = Array.isArray(plan?.days) ? plan.days : [];
        if (!plan?.id || days.length === 0) { setTodayPlan(null); return; }

        let nextDay = days[0];
        try {
          const lastRaw = await storage.getItem(LAST_DONE_KEY);
          if (lastRaw) {
            const last = JSON.parse(lastRaw);
            if (last?.planId === plan.id) {
              const idx = days.findIndex((d:any)=> d?.id === last.dayId);
              if (idx >= 0) nextDay = days[(idx + 1) % days.length];
            }
          }
        } catch {}

        setTodayPlan({ planId:Number(plan.id), dayId:Number(nextDay.id), title:plan.title, focus:nextDay.focus });
      } catch { setTodayPlan(null); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Centralized refresh with guard + throttle to prevent loops and flicker
  const refreshAll = useCallback(async (opts?: { force?: boolean }) => {
    if (refreshBusyRef.current) return; // in-flight guard
    const now = Date.now();
    if (!opts?.force && now - lastRefreshAtRef.current < 1500) return; // throttle
    refreshBusyRef.current = true;
    try {
      if (!initialLoadedRef.current) setLoading(true);
      const p = await fetchUserProfile();
      await loadWeeklyGoals(p);
      initialLoadedRef.current = true;
    } catch {}
    finally {
      setLoading(false);
      refreshBusyRef.current = false;
      lastRefreshAtRef.current = Date.now();
    }
  }, [fetchUserProfile, loadWeeklyGoals]);

  // Enable daily local notifications (summary + hydration)
  const enableHomeNotifications = useCallback(async () => {
    try {
      // Planned notifications list (also used as web fallback display)
      const planned = [
        { hour: 7,  minute: 0,  title: 'เริ่มวันด้วยการขยับร่างกาย 🏃', body: 'วอร์มอัพ 5 นาที แล้วเริ่มเวิร์คเอาต์เบาๆ' },
        { hour: 11, minute: 0,  title: 'ดื่มน้ำกันเถอะ 💧',            body: 'พักสั้นๆ แล้วดื่มน้ำสักแก้วนะ' },
        { hour: 15, minute: 0,  title: 'ดื่มน้ำกันเถอะ 💧',            body: 'อย่าลืมเติมน้ำช่วงบ่าย!' },
        { hour: 18, minute: 0,  title: 'ถึงเวลาขยับอีกสักหน่อย 💪',   body: 'ออกกำลัง 20–30 นาที ช่วงเย็นกำลังดี' },
        { hour: 20, minute: 0,  title: 'สรุปเป้าสัปดาห์',              body: 'เปิดหน้า Home เพื่อติดตามความคืบหน้า 🎯' },
      ];

      // Try native notifications first
      let notif: any = null;
      try {
        notif = await import('expo-notifications');
      } catch (e) {
        // On web or package missing
        if (Platform.OS === 'web') {
          // Use browser Notification API best-effort (while tab open)
          try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const perm = await (window?.Notification?.requestPermission?.() || Promise.resolve('default'));
            if (perm !== 'granted') {
              showAlert('ไม่ได้รับอนุญาต', 'เบราว์เซอร์ยังไม่อนุญาตการแจ้งเตือน');
            }
          } catch {}
          await storage.setItem(HOME_NOTIF_ON_KEY, '1');
          setNotifOn(true);
          setNotifModal(true);
          setScheduledNotifs(planned.map(p=>({ title:p.title, body:p.body, time:`${p.hour.toString().padStart(2,'0')}:${p.minute.toString().padStart(2,'0')}` })));
          return;
        }
        showAlert('ต้องติดตั้งแพคเกจ', 'โปรดรัน: npx expo install expo-notifications');
        return;
      }

      const { status } = await notif.requestPermissionsAsync();
      if (status !== 'granted') { showAlert('ไม่ได้รับอนุญาต', 'เปิดสิทธิ์การแจ้งเตือนในระบบก่อน'); return; }
      notif.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }) });
      try {
        const raw = await storage.getItem(HOME_NOTIF_IDS_KEY);
        const idsOld: string[] = raw ? JSON.parse(raw) : [];
        if (Array.isArray(idsOld) && idsOld.length) await Promise.all(idsOld.map(id => notif.cancelScheduledNotificationAsync(id).catch(()=>{})));
      } catch {}
      const ids: string[] = [];
      const schedule = async (hour: number, minute: number, title: string, body: string) => {
        const id = await notif.scheduleNotificationAsync({ content: { title, body, sound: false }, trigger: { type: notif.SchedulableTriggerInputTypes.DAILY, hour, minute } });
        ids.push(id);
      };
      for (const p of planned) await schedule(p.hour, p.minute, p.title, p.body);
      await storage.setItem(HOME_NOTIF_IDS_KEY, JSON.stringify(ids));
      await storage.setItem(HOME_NOTIF_ON_KEY, '1');
      setNotifOn(true);
      showAlert('เปิดการแจ้งเตือนแล้ว', 'จะแจ้งเตือนอัตโนมัติทุกวัน');
    } catch (e: any) {
      if (Platform.OS === 'web') {
        showAlert('แจ้งเตือนบนเว็บจำกัด', 'ระบบตั้งเวลาแจ้งเตือนเต็มรูปแบบใช้ได้บน iOS/Android');
      } else {
        showAlert('เปิดการแจ้งเตือนไม่สำเร็จ', e?.message ?? 'ติดตั้ง expo-notifications แล้วลองใหม่');
      }
    }
  }, []);

  const disableHomeNotifications = useCallback(async () => {
    try {
      const notif = await import('expo-notifications');
      const raw = await storage.getItem(HOME_NOTIF_IDS_KEY);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      if (Array.isArray(ids) && ids.length) await Promise.all(ids.map(id => notif.cancelScheduledNotificationAsync(id).catch(()=>{})));
    } catch {}
    finally {
      await storage.setItem(HOME_NOTIF_ON_KEY, '0');
      await storage.setItem(HOME_NOTIF_IDS_KEY, JSON.stringify([]));
      setNotifOn(false);
      showAlert('ปิดการแจ้งเตือนแล้ว', 'จะไม่แจ้งเตือนอัตโนมัติอีก');
    }
  }, []);

  const loadScheduledPreview = useCallback(async () => {
    try {
      // On web, just show planned list
      if (Platform.OS === 'web') {
        const planned = [
          { time: '07:00', title: 'เริ่มวันด้วยการขยับร่างกาย 🏃', body: 'วอร์มอัพ 5 นาที แล้วเริ่มเวิร์คเอาต์เบาๆ' },
          { time: '11:00', title: 'ดื่มน้ำกันเถอะ 💧', body: 'พักสั้นๆ แล้วดื่มน้ำสักแก้วนะ' },
          { time: '15:00', title: 'ดื่มน้ำกันเถอะ 💧', body: 'อย่าลืมเติมน้ำช่วงบ่าย!' },
          { time: '18:00', title: 'ถึงเวลาขยับอีกสักหน่อย 💪', body: 'ออกกำลัง 20–30 นาที ช่วงเย็นกำลังดี' },
          { time: '20:00', title: 'สรุปเป้าสัปดาห์', body: 'เปิดหน้า Home เพื่อติดตามความคืบหน้า 🎯' },
        ];
        setScheduledNotifs(planned);
        return;
      }
      const notif = await import('expo-notifications');
      const list = await notif.getAllScheduledNotificationsAsync();
      const fmt = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      const items = list.map((r: any) => {
        let time: string | undefined;
        try {
          const t = r?.trigger;
          if (t && (t.type === 'daily' || t.type === 'calendar' || t.type === 'calendarTrigger')) {
            const h = t.hour ?? t?.value?.hour;
            const m = t.minute ?? t?.value?.minute;
            if (typeof h === 'number' && typeof m === 'number') time = `${fmt(h)}:${fmt(m)}`;
          }
        } catch {}
        return { id: r?.identifier, title: r?.content?.title ?? null, body: r?.content?.body ?? null, time };
      });
      setScheduledNotifs(items);
    } catch {
      setScheduledNotifs([]);
    }
  }, []);

  // Pull-to-refresh handler (runs centralized refresh)
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll]);

  const quickAddWater = useCallback(async (amount: number) => {
    try {
      const token = await getToken();
      if (!token) { router.replace('/(tabs)/login'); return; }
      const res = await fetch(`${API_BASE_URL}/api/water/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ add_ml: amount })
      });
      if (!res.ok) throw new Error(await res.text());
      await refreshAll({ force: true });
    } catch (e) {
      showAlert('เพิ่มน้ำไม่สำเร็จ', e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    }
  }, [refreshAll]);

  // โหลดใหม่ทุกครั้งที่กลับเข้าหน้า (มี guard + throttle ภายใน)
  useFocusEffect(
    useCallback(() => {
      refreshAll();
      return () => { /* no-op */ };
    }, [refreshAll])
  );

  // Calculate BMI if height and weight are available
  const calculateBMI = (weight?: number | null, height?: number | null): number | null => {
    if (!weight || !height) return null;
    const heightInMeters = height / 100;
    return parseFloat((weight / (heightInMeters * heightInMeters)).toFixed(1));
  };

  // Normalize activity level strings between app/server
  const normalizeActivityKey = (raw?: string | null) => {
    if (!raw) return 'moderate_activity';
    const s = String(raw).toLowerCase();
    if (s.includes('sedentary')) return 'sedentary';
    if (s.includes('light')) return 'light_activity';
    if (s.includes('moderate')) return 'moderate_activity';
    if (s.includes('intense') || s.includes('active')) {
      if (s.includes('very')) return 'very_intense';
      return 'intense_activity';
    }
    return raw;
  };

  // Calculate daily calorie goal based on profile
  const calculateDailyCalories = (profile: UserProfile): number => {
    const w = profile.weight_kg ?? undefined;
    const h = profile.height_cm ?? undefined;
    if (!w || !h || !profile.date_of_birth) return 2000;

    const birth = new Date(profile.date_of_birth);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

    // ใช้ Mifflin–St Jeor (แม่นกว่า Harris-Benedict)
    let bmr = 0;
    if (String(profile.gender).toLowerCase() === 'male') {
      bmr = 10*w + 6.25*h - 5*age + 5;
    } else {
      bmr = 10*w + 6.25*h - 5*age - 161;
    }

    const mult: Record<string, number> = {
      sedentary: 1.2,
      light_activity: 1.375,
      moderate_activity: 1.55,
      intense_activity: 1.725,
      very_intense: 1.9,
    };
    const key = normalizeActivityKey(profile.activity_level);
    const multiplier = mult[key] ?? 1.55;
    return Math.round(bmr * multiplier);
  };

  // Display name & date
  const getDisplayName = (): string => {
    if (!userProfile) return 'ผู้ใช้';
    return `${userProfile.first_name ?? ''} ${userProfile.last_name ?? ''}`.trim() || userProfile.username;
  };

  const todayString = useMemo(() => {
    try {
      return new Date().toLocaleDateString('th-TH', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return new Date().toDateString();
    }
  }, []);

  const getGoalInThai = (goal?: string | null): string => {
    const goalMap: { [key: string]: string } = {
      lose_weight: 'ลดน้ำหนัก',
      gain_weight: 'เพิ่มน้ำหนัก',
      maintain_weight: 'รักษาน้ำหนัก',
      build_muscle: 'สร้างกล้ามเนื้อ',
      improve_health: 'ปรับปรุงสุขภาพ',
      maintain_shape: 'รักษารูปร่าง',
      general_fitness: 'ฟิตเนสทั่วไป',
      maintain_health: 'รักษาสุขภาพ',
    };
    return goal ? goalMap[goal] ?? 'ปรับปรุงสุขภาพ' : 'ปรับปรุงสุขภาพ';
  };

  const roleLabel = userProfile?.is_admin ? 'ผู้ดูแลระบบ (Admin)' : 'ผู้ใช้ทั่วไป';
  const roleStyle = userProfile?.is_admin ? styles.adminBadge : styles.userBadge;

  type QuickActionCardProps = {
    title: string;
    subtitle?: string;
    icon: string;
    color: string;
    onPress: () => void;
    isLarge?: boolean;
  };

  const QuickActionCard = ({ title, subtitle, icon, color, onPress, isLarge = false }: QuickActionCardProps) => {
    const cardStyle = isLarge
      ? [styles.quickActionCardBase, styles.quickActionCardLarge, styles.largeCard, { backgroundColor: color }]
      : [styles.quickActionCardBase, styles.quickActionCardSmall, { backgroundColor: color }];

    return (
      <Pressable
        style={cardStyle}
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
      >
        <View style={styles.cardContent}>
          <Text style={styles.cardIcon}>{icon}</Text>
          <View style={styles.cardTextContainer}>
            <Text style={styles.cardTitle}>{title}</Text>
            {subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        <View style={styles.cardArrow}>
          <Text style={styles.arrowText}>›</Text>
        </View>
      </Pressable>
    );
  };

  type StatsCardProps = {
    value: string;
    label: string;
    trend?: string;
    color: string;
  };

  const StatsCard = ({ value, label, trend, color }: StatsCardProps) => (
    <View style={[styles.statsCard, { borderLeftColor: color }]}>
      <Text style={styles.statsValue}>{value}</Text>
      <Text style={styles.statsLabel}>{label}</Text>
      {trend && <Text style={[styles.statsTrend, { color }]}>{trend}</Text>}
    </View>
  );

  // Weekly percentages (compute unconditionally to keep hooks order stable)
  const hydPct = useMemo(() => Math.max(0, Math.min(100, Math.round((weekHydMl / Math.max(1, weekHydGoalMl)) * 100))), [weekHydMl, weekHydGoalMl]);
  const wkPct = useMemo(() => weekWkGoalMins > 0 ? Math.max(0, Math.min(100, Math.round((weekWkMins / weekWkGoalMins) * 100))) : 0, [weekWkMins, weekWkGoalMins]);
  const combinedPct = useMemo(() => {
    const parts: number[] = [];
    if (weekHydGoalMl > 0) parts.push(hydPct);
    if (weekWkGoalMins > 0) parts.push(wkPct);
    if (!parts.length) return 0;
    return Math.round(parts.reduce((s,x)=>s+x,0)/parts.length);
  }, [hydPct, wkPct, weekHydGoalMl, weekWkGoalMins]);

  if (loading) {
    return (
      <LinearGradient colors={['#f8fafc', '#ffffff', '#f1f5f9']} style={[styles.container, styles.webCenterWrap, isWeb && styles.webContainer]}>
        <View style={[styles.loadingContainer, isWeb && styles.webInner]}>
          <Text style={styles.loadingText}>กำลังโหลด...</Text>
        </View>
      </LinearGradient>
    );
  }

  const bmi = calculateBMI(userProfile?.weight_kg ?? undefined, userProfile?.height_cm ?? undefined);
  const dailyCalories = userProfile ? calculateDailyCalories(userProfile) : 2000;

  return (
    <>
      {/* บนเว็บไม่ต้องใช้ StatusBar */}
      {Platform.OS !== 'web' && <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />}

      <SafeAreaView style={[styles.container, styles.webCenterWrap, isWeb && styles.webContainer]}>
        <LinearGradient colors={['#f8fafc', '#ffffff', '#f1f5f9']} style={[styles.container, styles.webInner, isWide ? styles.desktopPadding : undefined]}>
          <ScrollView
            contentContainerStyle={[styles.scrollContent, isWeb && { paddingBottom: 40 }]}
            showsVerticalScrollIndicator={isWeb}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          >
            {/* Header */}
            <Animated.View style={[styles.header, isWeb && styles.headerWeb, { opacity: fadeAnim }]}>
              <View style={styles.headerTop}>
                <View>
                  <Text style={[styles.greeting, isWeb && styles.greetingWeb]}>สวัสดี, {getDisplayName()}</Text>
                  <Text style={[styles.date, isWeb && styles.dateWeb]}>{todayString}</Text>
                  <View style={styles.roleWrap}>
                    <Text style={[styles.roleBadge, roleStyle]}>{roleLabel}</Text>
                  </View>
                </View>
                <View style={styles.headerActions}>
                  <Pressable
                    style={styles.notifButton}
                    accessibilityRole="button"
                    accessibilityLabel="การแจ้งเตือน"
                    onPress={async () => { setNotifModal(true); await loadScheduledPreview(); }}
                  >
                    <Text style={styles.notifIcon}>{notifOn ? '🔔' : '🔕'}</Text>
                    {notifOn && <View style={styles.notifDot} />}
                  </Pressable>
                  <Pressable
                    style={styles.profileButton}
                    accessibilityRole="button"
                    accessibilityLabel="โปรไฟล์"
                    onPress={() => router.push('/(tabs)/Profile')}
                  >
                    <Text style={styles.profileIcon}>👤</Text>
                  </Pressable>
                </View>
              </View>

              <View style={[styles.titleSection, isWeb && { alignItems: 'flex-start' }]}>
                <Text style={[styles.mainTitle, isWeb && styles.mainTitleWeb]}>FitMe Dashboard</Text>
              <Text style={styles.subtitle}>🎯 เป้าหมาย: {userProfile?.goal ? getGoalInThai(userProfile.goal) : 'ยังไม่ตั้งค่า'}</Text>
                <View style={styles.chipsRow}>
                  <Text style={styles.chip}>BMI: {bmi ?? '-'}</Text>
                  <Text style={styles.chip}>แคลอรี่: {dailyCalories}</Text>
                  <Text style={styles.chip}>น้ำ: {userProfile?.water_goal_l ?? 2} L</Text>
                </View>
              </View>
            </Animated.View>

            {/* Today Quick Start */}
            <View style={[styles.todaySection, isWeb && { paddingHorizontal: 0 }]}>
              {todayPlan ? (
                <Pressable
                  onPress={()=>router.push({ pathname:'/(tabs)/StartWorkout', params:{ planId: String(todayPlan.planId), dayId: String(todayPlan.dayId) }})}
                  accessibilityRole="button"
                  accessibilityLabel="เริ่มคอร์สวันนี้"
                  style={({ pressed }) => [{ opacity: pressed ? 0.96 : 1 }]}
                >
                  <LinearGradient colors={["#131314ff","#8b5cf6"]} start={{x:0,y:0}} end={{x:1,y:1}} style={[styles.todayCardGrad, isWeb && styles.cardShadowWeb]}>
                    <View style={{flex:1}}>
                      <Text style={styles.todayTitle}>คอร์สวันนี้</Text>
                      <Text style={styles.todaySub}>{todayPlan.title ?? 'แผนการออกกำลังกาย'} • {todayPlan.focus ?? 'Full-Body'}</Text>
                    </View>
                    <View style={styles.todayBtn}><Text style={styles.todayBtnText}>เริ่มวันนี้ ›</Text></View>
                  </LinearGradient>
                </Pressable>
              ) : (
                <View style={[styles.todayEmpty, isWeb && styles.cardShadowWeb]}>
                  <Text style={styles.todayEmptyText}>ยังไม่มีแพลน • เริ่ม Onboarding เพื่อสร้างแพลน</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="เริ่ม Onboarding"
                    onPress={()=>router.push('/(tabs)/WorkoutPlanDetail')}
                    style={({ pressed }) => [styles.todayCreate, { opacity: pressed ? 0.9 : 1 }]}
                  >
                    <Text style={styles.todayCreateText}>เริ่ม Onboarding</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Quick Stats */}
            <Animated.View style={[styles.statsSection, { opacity: fadeAnim }]}>
              <Text style={[styles.sectionTitle, isWeb && { paddingHorizontal: 0 }]}>ข้อมูลสุขภาพของคุณ</Text>
              <View style={[styles.statsGrid, isWeb && styles.statsGridWeb]}>
                <StatsCard value={userProfile?.weight_kg ? `${userProfile.weight_kg} กก.` : '-'} label="น้ำหนัก" color="#3b82f6" />
                <StatsCard
                  value={bmi ? `${bmi}` : '-'}
                  label="BMI"
                  trend={bmi ? (bmi < 18.5 ? 'ต่ำ' : bmi > 24.9 ? 'สูง' : 'ปกติ') : undefined}
                  color={bmi ? (bmi < 18.5 || bmi > 24.9 ? '#ef4444' : '#10b981') : '#6b7280'}
                />
                <StatsCard value={`${dailyCalories}`} label="แคลอรี่/วัน" color="#f59e0b" />
              </View>

              <View style={[styles.statsGrid, { marginTop: 12 }, isWeb && styles.statsGridWeb]}>
                <StatsCard value={userProfile?.height_cm ? `${userProfile.height_cm} ซม.` : '-'} label="ส่วนสูง" color="#8b5cf6" />
                <StatsCard value={userProfile?.water_goal_l ? `${userProfile.water_goal_l} ลิตร` : '2.0 ลิตร'} label="เป้าหมายน้ำ" color="#06b6d4" />
                <StatsCard
                  value={
                    userProfile?.activity_level
                      ? String(userProfile.activity_level).replace(/_/g, ' ')
                      : 'ปานกลาง'
                  }
                  label="ระดับกิจกรรม"
                  color="#10b981"
                />
              </View>
            </Animated.View>

            {/* Quick Actions */}
            <Animated.View style={[styles.quickActions, { opacity: fadeAnim }]}>
              <Text style={[styles.sectionTitle, isWeb && { paddingHorizontal: 0 }]}>เมนูหลัก</Text>

              {/* Large Feature Card */}
              <QuickActionCard
                title="AI แนะนำอาหาร"
                subtitle="รับคำแนะนำจาก AI ส่วนตัว"
                icon="🤖"
                color="#6366f1"
                isLarge
                onPress={() => router.push('/(tabs)/AIRecommendationScreen')}
              />

              {/* Grid of smaller cards */}
              <View style={[styles.actionGrid, isWeb && styles.actionGridWeb]}>
                <QuickActionCard
                  title="คำนวณแคลอรี่"
                  icon="🔥"
                  color="#ef4444"
                  onPress={() => router.push('/(tabs)/CalorieTrackerScreen')}
                />

                <QuickActionCard
                  title="แพลนออกกำลัง"
                  icon="💪"
                  color="#10b981"
                  onPress={() => router.push('/(tabs)/WorkoutProgram')}
                />

                <QuickActionCard
                  title="ปรับโปรไฟล์" icon="⚙️"
                  color="#f59e0b"
                  onPress={() => router.push('/(tabs)/EditProfile')}
                />
                <QuickActionCard
                  title="ดื่มน้ำ"
                  icon="💧"
                  color="#06b6d4"
                  onPress={() => router.push('/(tabs)/WaterTracker')}
                />
                <QuickActionCard
                  title="สถิติสุขภาพ" icon="📊"
                  color="#8b5cf6"
                  onPress={() => router.push('/(tabs)/StatsScreen')}
                />
              </View>
            </Animated.View>

            {/* Health Condition Alert */}
            {userProfile?.health_condition ? (
              <Animated.View style={[styles.healthAlert, { opacity: fadeAnim }]}>
                <View style={[styles.alertCard, isWeb && styles.cardShadowWeb]}>
                  <View style={styles.alertHeader}>
                    <Text style={styles.alertIcon}>⚠️</Text>
                    <Text style={styles.alertTitle}>ข้อมูลสุขภาพ</Text>
                  </View>
                  <Text style={styles.alertText}>{userProfile.health_condition}</Text>
                  <Text style={styles.alertSubtext}>กรุณาปรึกษาแพทย์ก่อนเริ่มแผนการออกกำลังกายใหม่</Text>
                </View>
              </Animated.View>
            ) : null}

            {/* Weekly Goals */}
            <View style={styles.progressSection}>
              <View style={[styles.progressCard, isWeb && styles.cardShadowWeb]}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressTitle}>เป้าหมายสัปดาห์นี้🎯</Text>
                  <Pressable onPress={() => router.push('/(tabs)/StatsScreen')}>
                    <Text style={styles.progressPercent}>{combinedPct}%</Text>
                  </Pressable>
                </View>
                {/* Hydration bar */}
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${hydPct}%`, backgroundColor: '#3b82f6' }]} />
                  </View>
                  <Text style={styles.progressText}>น้ำดื่ม: {Math.round(weekHydMl)} / {weekHydGoalMl} ml</Text>
                  <Text style={styles.progressText}>
                    {hydPct >= 100 ? 'สุดยอด! คุณทำครบเป้าน้ำสัปดาห์นี้แล้ว 🎉' : hydPct >= 50 ? 'ค่อยๆ ดื่มระหว่างวันให้สม่ำเสมอ 💧' : 'เริ่มจากแก้วเล็กๆ แล้วเพิ่มขึ้นเรื่อยๆ 💧'}
                  </Text>
                  {/* Quick actions for water */}
                  <View style={styles.quickRow}>
                    {[200, 300, 500].map(v => (
                      <Pressable key={v} style={styles.quickBtn} onPress={() => quickAddWater(v)}>
                        <Text style={styles.quickBtnText}>+{v} ml</Text>
                      </Pressable>
                    ))}
                    <Pressable style={[styles.quickBtn, { backgroundColor: '#8b5cf6', borderColor: '#7c3aed' }]} onPress={() => router.push('/(tabs)/WaterTracker')}>
                      <Text style={[styles.quickBtnText, { color: '#fff' }]}>ไปดื่มน้ำ</Text>
                    </Pressable>
                  </View>
                </View>
                {/* Workout bar */}
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${wkPct}%`, backgroundColor: '#8b5cf6' }]} />
                  </View>
                  <Text style={styles.progressText}>ออกกำลังกาย: {weekWkMins} / {weekWkGoalMins || 300} นาที</Text>
                  <Text style={styles.progressText}>
                    {wkPct >= 100 ? 'เยี่ยม! ครบเป้าการออกกำลังกายแล้ว 💪' : 'เริ่มจากสั้นๆ ก่อน แล้วค่อยคงเส้นคงวา 😊'}
                  </Text>
                  <View style={styles.quickRow}>
                    <Pressable style={styles.quickBtnAlt} onPress={() => router.push('/(tabs)/WorkoutPlanDetail')}>
                      <Text style={styles.quickBtnAltText}>ดูแผน</Text>
                    </Pressable>
                    <Pressable style={styles.quickBtnAlt} onPress={() => router.push('/(tabs)/StartWorkout')}>
                      <Text style={styles.quickBtnAltText}>เริ่มเวิร์คเอาต์</Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="ดูทั้งหมด" onPress={() => router.push('/(tabs)/StatsScreen')}>
                  <Text style={[styles.progressText, { textAlign: 'right', color: '#6366f1', fontWeight: '800' }]}>ดูทั้งหมด ›</Text>
                </Pressable>
              </View>
            </View>


            {/* Notifications control */}
            <View style={[styles.tipCard, isWeb && styles.cardShadowWeb]}> 
              <View style={styles.tipHeader}>
                <Text style={styles.tipIcon}>🔔</Text>
                <Text style={styles.tipTitle}>การแจ้งเตือน</Text>
              </View>
              <Text style={styles.tipText}>
                {notifOn ? 'แจ้งเตือนเปิดอยู่: สรุปเป้าทุกวัน 20:00 และเตือนดื่มน้ำ 11:00/15:00' : 'เปิดเพื่อรับการเตือนสรุปเป้ารายวัน และเตือนดื่มน้ำแบบเบาๆ'}
              </Text>
              <View style={{ flexDirection:'row', gap:10 }}>
                {notifOn ? (
                  <Pressable style={styles.quickBtnAlt} onPress={disableHomeNotifications}>
                    <Text style={styles.quickBtnAltText}>ปิดการแจ้งเตือน</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.quickBtn} onPress={enableHomeNotifications}>
                    <Text style={styles.quickBtnText}>เปิดการแจ้งเตือน</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Notifications modal (list) */}
            {notifModal && (
              <View style={styles.modalOverlay}>
                <View style={styles.modalBox}>
                  <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                    <Text style={styles.modalTitle}>รายการแจ้งเตือน</Text>
                    <Pressable onPress={() => setNotifModal(false)}><Text style={styles.modalClose}>✕</Text></Pressable>
                  </View>
                  <Text style={styles.modalHint}>กำหนดเตือน: 20:00 (สรุป) • 11:00/15:00 (ดื่มน้ำ)</Text>
                  <View style={{ marginTop:8 }}>
                    {scheduledNotifs.length === 0 ? (
                      <Text style={styles.modalEmpty}>ไม่มีรายการกำหนดการในตอนนี้</Text>
                    ) : (
                      scheduledNotifs.map((n,i)=> (
                        <View key={(n.id || 'id') + ':' + i} style={styles.modalItem}>
                          <View style={{ flex:1 }}>
                            <Text style={styles.modalItemTitle}>{n.title || 'แจ้งเตือน'}</Text>
                            {!!n.body && <Text style={styles.modalItemBody}>{n.body}</Text>}
                          </View>
                          <Text style={styles.modalItemTime}>{n.time || '-'}</Text>
                        </View>
                      ))
                    )}
                  </View>
                  <View style={{ flexDirection:'row', gap:10, marginTop:12 }}>
                    <Pressable style={styles.quickBtn} onPress={async ()=>{ await enableHomeNotifications(); await loadScheduledPreview(); }}>
                      <Text style={styles.quickBtnText}>เปิดแจ้งเตือน</Text>
                    </Pressable>
                    <Pressable style={styles.quickBtnAlt} onPress={async ()=>{ await disableHomeNotifications(); await loadScheduledPreview(); }}>
                      <Text style={styles.quickBtnAltText}>ปิดแจ้งเตือน</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}

            {/* Tips Card */}
            <Animated.View style={[styles.tipsSection, { opacity: fadeAnim }]}>
              <View style={[styles.tipCard, isWeb && styles.cardShadowWeb]}>
                <View style={styles.tipHeader}>
                  <Text style={styles.tipIcon}>💡</Text>
                  <Text style={styles.tipTitle}>เคล็ดลับวันนี้</Text>
                </View>
                <Text style={styles.tipText}>
                  {userProfile?.water_goal_l
                    ? `ดื่มน้ำ ${userProfile.water_goal_l} ลิตรต่อวัน เพื่อช่วยให้ระบบเผาผลาญทำงานได้ดียิ่งขึ้น`
                    : 'ดื่มน้ำ 8-10 แก้วต่อวัน เพื่อช่วยให้ระบบเผาผลาญทำงานได้ดียิ่งขึ้น'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="อ่านเคล็ดลับเพิ่มเติม"
                  style={({ pressed }) => [styles.tipButton, { opacity: pressed ? 0.9 : 1 }]}
                  onPress={() => navigation.navigate('HealthTips')}
                >
                  <Text style={styles.tipButtonText}>อ่านเคล็ดลับเพิ่มเติม</Text>
                </Pressable>
              </View>
            </Animated.View>
          </ScrollView>
        </LinearGradient>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  webCenterWrap: {
    alignItems: 'center',
  },
  webContainer: {
    backgroundColor: '#f8fafc',
  },
  webInner: {
    width: '100%',
    maxWidth: 820, // กึ่งกลางบนเว็บ (มือถือยังเต็มจอ)
    alignSelf: 'center',
  },
  desktopPadding: {
    paddingHorizontal: 24,
  },

  scrollContent: { paddingBottom: 30 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 16, color: '#6b7280' },

  // Header Styles
  header: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 16 : 8, paddingBottom: 20 },
  headerWeb: { paddingTop: 24 }, // เพิ่มระยะบนเว็บให้โปร่ง
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  greeting: { fontSize: 24, fontWeight: '700', color: '#1f2937' },
  greetingWeb: { fontSize: 26 },
  date: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  dateWeb: { fontSize: 15 },
  profileButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  profileIcon: { fontSize: 22 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notifIcon: { fontSize: 20 },
  notifDot: { position: 'absolute', right: 8, top: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },

  // Modal for notifications
  modalOverlay: { position:'absolute', inset:0, backgroundColor:'rgba(0,0,0,0.45)', alignItems:'center', justifyContent:'center', paddingHorizontal: 16 },
  modalBox: { width: '100%', maxWidth: 600, backgroundColor:'#fff', borderRadius:16, padding:16, borderWidth:1, borderColor:'#e5e7eb' },
  modalTitle: { fontSize:16, fontWeight:'900', color:'#111' },
  modalClose: { fontSize:18, color:'#6b7280', padding:6 },
  modalHint: { color:'#6b7280', marginTop:6 },
  modalEmpty: { color:'#6b7280', marginTop:8 },
  modalItem: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderBottomWidth:1, borderBottomColor:'#f3f4f6', paddingVertical:8 },
  modalItemTitle: { fontWeight:'800', color:'#111' },
  modalItemBody: { color:'#6b7280' },
  modalItemTime: { color:'#374151', fontWeight:'800', marginLeft:8 },
  titleSection: { alignItems: 'center' },
  mainTitle: { fontSize: 28, fontWeight: '800', color: '#111827', marginBottom: 4 },
  mainTitleWeb: { fontSize: 30 },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 2 },

  // Role badge
  roleWrap: { marginTop: 8 },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '800',
  },
  adminBadge: { backgroundColor: '#ede9fe', color: '#6d28d9', borderWidth: 1, borderColor: '#c4b5fd' },
  userBadge: { backgroundColor: '#f3f4f6', color: '#374151', borderWidth: 1, borderColor: '#e5e7eb' },

  // Section Titles
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#1f2937', marginBottom: 16, paddingHorizontal: 24 },

  // Stats Section
  statsSection: { marginBottom: 32 },
  statsGrid: { flexDirection: 'row', paddingHorizontal: 24, justifyContent: 'space-between' },
  statsGridWeb: {
    gap: 12,
    paddingHorizontal: 0,
  },
  statsCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    flex: 1,
    marginHorizontal: 4,
    borderLeftWidth: 4,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 3 },
      web: { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8 },
    }),
  },
  statsValue: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  statsLabel: { fontSize: 12, color: '#6b7280', marginBottom: 4 },
  statsTrend: { fontSize: 12, fontWeight: '600' },

  // Health Alert
  healthAlert: { marginBottom: 32 },
  alertCard: {
    backgroundColor: '#fef3c7',
    borderRadius: 16,
    padding: 20,
    marginHorizontal: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  alertIcon: { fontSize: 20, marginRight: 8 },
  alertTitle: { fontSize: 16, fontWeight: '700', color: '#92400e' },
  alertText: { fontSize: 14, color: '#92400e', marginBottom: 4 },
  alertSubtext: { fontSize: 12, color: '#a16207', fontStyle: 'italic' },

  // Quick Actions
  quickActions: { marginBottom: 32 },
  quickActionCardBase: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 6 },
      web: { shadowColor: 'rgba(0,0,0,0.15)', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 1, shadowRadius: 12 },
    }),
  },
  quickActionCardLarge: { marginHorizontal: 24 },
  quickActionCardSmall: { width: '48%', marginHorizontal: 0 },
  largeCard: { paddingVertical: 24 },
  cardContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  cardIcon: { fontSize: 32, marginRight: 16, lineHeight: 32 },
  cardTextContainer: { flex: 1 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#ffffff', marginBottom: 4 },
  cardSubtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.85)' },
  cardArrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255, 255, 255, 0.2)', alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 18, fontWeight: 'bold', color: '#ffffff' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, justifyContent: 'space-between' },
  actionGridWeb: { paddingHorizontal: 0, gap: 12 },

  // Progress Section
  progressSection: { marginBottom: 32 },
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 24,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 3 },
      web: { shadowColor: 'rgba(0,0,0,0.1)', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8 },
    }),
  },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  progressTitle: { fontSize: 18, fontWeight: '700', color: '#1f2937' },
  progressPercent: { fontSize: 24, fontWeight: '800', color: '#3b82f6' },
  progressBarContainer: { marginBottom: 12 },
  progressBar: { height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#3b82f6', borderRadius: 4 },
  progressText: { fontSize: 14, color: '#6b7280' },

  // Quick action row under progress
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  quickBtn: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  quickBtnText: { color: '#3730a3', fontWeight: '800' },
  quickBtnAlt: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12 },
  quickBtnAltText: { color: '#374151', fontWeight: '800' },

  // Tips Section
  tipsSection: { marginBottom: 20 },
  tipCard: { backgroundColor: '#ffffff', borderRadius: 20, padding: 24, marginHorizontal: 24, borderWidth: 1, borderColor: '#e5e7eb' },
  tipHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  tipIcon: { fontSize: 24, marginRight: 8, lineHeight: 24 },
  tipTitle: { fontSize: 18, fontWeight: '700', color: '#1f2937' },
  tipText: { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 16 },
  tipButton: { backgroundColor: '#f3f4f6', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignSelf: 'flex-start' },
  tipButtonText: { fontSize: 14, fontWeight: '600', color: '#374151' },

  // Today quick styles
  todaySection:{ paddingHorizontal:24, marginBottom:16 },
  todayCardGrad:{ borderRadius:16, padding:16, flexDirection:'row', alignItems:'center' },
  todayTitle:{ color:'#93c5fd', fontWeight:'800', marginBottom:4 },
  todaySub:{ color:'#e5e7eb' },
  todayBtn:{ backgroundColor:'#2563eb', paddingVertical:8, paddingHorizontal:12, borderRadius:10 },
  todayBtnText:{ color:'#fff', fontWeight:'800' },
  todayEmpty:{ backgroundColor:'#ffffff', borderColor:'#e5e7eb', borderWidth:1, borderRadius:16, padding:16, alignItems:'flex-start' },
  todayEmptyText:{ color:'#374151', marginBottom:8 },
  todayCreate:{ backgroundColor:'#8b5cf6', borderRadius:10, paddingVertical:8, paddingHorizontal:12 },
  todayCreateText:{ color:'#fff', fontWeight:'800' },

  // Header chips
  chipsRow:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 },
  chip:{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'#eef2ff', color:'#3730a3', fontWeight:'800', borderWidth:1, borderColor:'#c7d2fe' },

  // Web-specific shadow helper (เพิ่มนิดให้เด้งบนเว็บ)
  cardShadowWeb: {
    shadowColor: 'rgba(0,0,0,0.1)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
});

export default HomeScreen;
