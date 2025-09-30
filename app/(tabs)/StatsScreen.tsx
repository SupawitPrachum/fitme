// app/(tabs)/HealthStats.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, TextInput, SafeAreaView, Dimensions, Modal } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';
// NOTE: Keep this screen self-contained. Removed external fitness utils per request.

const AUTH_KEY = 'auth_token';
const API = API_BASE_URL;

type UserProfile = {
  id: number;
  username: string;
  first_name?: string | null;
  last_name?: string | null;
  gender?: 'male' | 'female' | string;
  date_of_birth?: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  activity_level?: string | null;
  water_goal_l?: number | null;
  goal?: string | null;
  exercise_type?: string | null;
  health_condition?: string | null;
};

type Settings = {
  DailyGoalKcal?: number | null;
  GoalMode?: string | null;
};

type DayCal = { date: string; total: number };

function thaiShort(w: number) {
  const list = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  return list[w] ?? '';
}

function d2(s: number) {
  return s < 10 ? `0${s}` : `${s}`;
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}`;
}

function displayName(u?: UserProfile | null) {
  if (!u) return 'ผู้ใช้';
  const n = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return n || u.username;
}

function calcBMI(weight?: number | null, height?: number | null) {
  if (!weight || !height) return null;
  const m = height / 100;
  return +(weight / (m * m)).toFixed(1);
}

function bmiCategory(bmi: number | null): string | null {
  if (bmi == null) return null;
  if (bmi < 18.5) return 'ต่ำกว่าเกณฑ์';
  if (bmi < 25) return 'ปกติ';
  if (bmi < 30) return 'น้ำหนักเกิน';
  return 'อ้วน';
}

function calcAge(dob?: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

// Mifflin-St Jeor BMR
function calcBMRMifflin(gender?: string, weightKg?: number | null, heightCm?: number | null, age?: number | null): number | null {
  if (!weightKg || !heightCm || age == null) return null;
  const male = String(gender || '').toLowerCase() === 'male';
  const bmr = male
    ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  return Math.round(bmr);
}

function activityMultiplier(key?: string | null): number {
  switch (activityKey(key)) {
    case 'sedentary': return 1.2;
    case 'light_activity': return 1.375;
    case 'moderate_activity': return 1.55;
    case 'intense_activity': return 1.725;
    case 'very_intense': return 1.9;
    default: return 1.55;
  }
}

function calcTDEE(bmr: number | null, level?: string | null): number | null {
  if (bmr == null) return null;
  return Math.round(bmr * activityMultiplier(level));
}

function hrMaxTanaka(age: number | null): number | null {
  if (age == null) return null;
  return Math.round(208 - 0.7 * age);
}

function hrZones(hrMax: number | null): [number, number][][] | null {
  if (!hrMax) return null;
  const pct = (p: number) => Math.round((p / 100) * hrMax);
  return [
    [[pct(50), pct(60)]],
    [[pct(60), pct(70)]],
    [[pct(70), pct(80)]],
    [[pct(80), pct(90)]],
    [[pct(90), pct(100)]],
  ];
}

function proteinRange(weightKg?: number | null): [number, number] | null {
  if (!weightKg) return null;
  const lo = Math.round(weightKg * 1.6);
  const hi = Math.round(weightKg * 2.2);
  return [lo, hi];
}

function waterTargetL(weightKg?: number | null): number | null {
  if (!weightKg) return null;
  return +(weightKg * 0.033).toFixed(2);
}

function activityKey(raw?: string | null) {
  if (!raw) return 'moderate_activity';
  const s = String(raw).toLowerCase();
  if (s.includes('sedentary')) return 'sedentary';
  if (s.includes('light')) return 'light_activity';
  if (s.includes('very')) return 'very_intense';
  if (s.includes('intense') || s.includes('active')) return 'intense_activity';
  if (s.includes('moderate')) return 'moderate_activity';
  return raw;
}

function estimateDailyKcal(u: UserProfile): number {
  const w = u.weight_kg ?? undefined;
  const h = u.height_cm ?? undefined;
  if (!w || !h || !u.date_of_birth) return 2000;

  const birth = new Date(u.date_of_birth);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

  let bmr = 0;
  if (String(u.gender).toLowerCase() === 'male') {
    bmr = 88.362 + 13.397 * w + 4.799 * h - 5.677 * age;
  } else {
    bmr = 447.593 + 9.247 * w + 3.098 * h - 4.33 * age;
  }
  const mult: Record<string, number> = {
    sedentary: 1.2,
    light_activity: 1.375,
    moderate_activity: 1.55,
    intense_activity: 1.725,
    very_intense: 1.9,
  };
  const k = activityKey(u.activity_level);
  return Math.round(bmr * (mult[k] ?? 1.55));
}

export default function HealthStats() {
  const [me, setMe] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [days, setDays] = useState<DayCal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [weightStr, setWeightStr] = useState('');
  // removed 1RM estimator local state
  const [planMeta, setPlanMeta] = useState<{
    id?: number;
    title?: string;
    daysPerWeek?: number;
    minutesPerSession?: number;
    next?: { dayLabel?: string; focus?: string; dayId?: number } | null;
    weeklyMinutes?: number;
  } | null>(null);
  const [lastWorkout, setLastWorkout] = useState<{ completedAt: number; planId?: number; dayId?: number } | null>(null);
  const [waterMl, setWaterMl] = useState<number>(0);
  const [waterAddStr, setWaterAddStr] = useState<string>('');
  const [waterDays, setWaterDays] = useState<{ date: string; ml: number }[]>([]);
  const [weightDays, setWeightDays] = useState<{ date: string; weight_kg: number | null }[]>([]);
  const [workoutDays, setWorkoutDays] = useState<{ date: string; sessions: number; durationSec: number }[]>([]);
  const [weeklyModal, setWeeklyModal] = useState(false);

  // Responsive chart sizing
  const screenW = Dimensions.get('window').width;
  const chartSizing = useMemo(() => {
    const axisW = 44; // space for y-axis labels
    const leftPad = 12;
    const gap = 8; // gap between bars
    const maxBar = 28;
    const minBar = 16;
    const containerPad = 16; // ScrollView content padding
    const contentW = Math.max(320, screenW - containerPad * 2);
    const barsArea = contentW - leftPad - axisW;
    const barW = Math.max(minBar, Math.min(maxBar, Math.floor((barsArea - gap * 6) / 7)));
    return { axisW, leftPad, gap, barW };
  }, [screenW]);

  // ===== Weekly goals (hydration + workout) =====
  const weekWindow = useMemo(() => {
    const today = new Date();
    const d = new Date(today);
    const dow = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - dow);
    d.setHours(0,0,0,0);
    const start = ymd(d);
    const endDate = new Date(d.getTime() + 6 * 86400000);
    const end = ymd(endDate);
    return { start, end };
  }, []);

  const weekDates = useMemo(() => {
    // Build 7 consecutive dates from week start (Mon) to end (Sun)
    const dates: { date: string; d: Date }[] = [];
    const [y, m, d] = weekWindow.start.split('-').map(n => Number(n));
    const start = new Date(y, m - 1, d);
    for (let i = 0; i < 7; i++) {
      const di = new Date(start.getTime() + i * 86400000);
      dates.push({ date: ymd(di), d: di });
    }
    return dates;
  }, [weekWindow.start]);

  const goalKcal = useMemo(() => {
    if (settings?.DailyGoalKcal) return settings.DailyGoalKcal;
    return me ? estimateDailyKcal(me) : 2000;
  }, [settings?.DailyGoalKcal, me]);

  const fetchMe = useCallback(async () => {
    const token = await AsyncStorage.getItem(AUTH_KEY);
    if (!token) {
      router.replace('/(tabs)/login'); return null;
    }
    const res = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      await AsyncStorage.removeItem(AUTH_KEY);
      router.replace('/(tabs)/login');
      return null;
    }
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as UserProfile | null;
    setMe(data);
    if (data?.weight_kg != null && Number.isFinite(Number(data.weight_kg))) {
      setWeightStr(String(data.weight_kg));
    }
    return data;
  }, []);

  const fetchSettings = useCallback(async () => {
    const token = await AsyncStorage.getItem(AUTH_KEY);
    if (!token) return null;
    const res = await fetch(`${API}/api/settings`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const s = (await res.json()) as Settings | null;
    setSettings(s);
    return s;
  }, []);

  // โหลดแคลอรี่ย้อนหลัง N วัน
  const fetchCaloriesNDays = useCallback(async (n = 14) => {
    const token = await AsyncStorage.getItem(AUTH_KEY);
    if (!token) return [];
    const out: DayCal[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = ymd(d);
      try {
        const res = await fetch(`${API}/api/calories?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(await res.text());
        const js = await res.json();
        out.push({ date, total: Number(js?.total ?? 0) });
      } catch {
        out.push({ date, total: 0 });
      }
    }
    setDays(out);
    return out;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const meData = await fetchMe();
      await fetchSettings();
      await fetchCaloriesNDays(28);
      // Water summary (server)
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
          const r = await fetch(`${API}/api/water/summary?days=14`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const js = await r.json();
            const items = Array.isArray(js?.items) ? js.items : [];
            setWaterDays(items);
            const today = items[items.length - 1];
            if (today && typeof today.ml === 'number') setWaterMl(Number(today.ml));
          }
        }
      } catch {}
      // Weight summary (server)
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
          const r = await fetch(`${API}/api/weight/summary?days=30`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const js = await r.json();
            setWeightDays(Array.isArray(js?.items) ? js.items : []);
          }
        }
      } catch {}
      // Workout daily (server)
      try {
        const token = await AsyncStorage.getItem(AUTH_KEY);
        if (token) {
          const r = await fetch(`${API}/api/workout/daily?days=14`, { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const js = await r.json();
            setWorkoutDays(Array.isArray(js?.items) ? js.items : []);
          }
        }
      } catch {}
      // Load latest workout plan + last completion from AsyncStorage
      try {
        const [pRaw, dRaw] = await Promise.all([
          AsyncStorage.getItem('last_workout_plan_v1'),
          AsyncStorage.getItem('last_workout_done_v1'),
        ]);
        const done = dRaw ? JSON.parse(dRaw) as { completedAt: number; planId?: number; dayId?: number } : null;
        setLastWorkout(done || null);
        if (pRaw) {
          const p = JSON.parse(pRaw);
          const wm = (Number(p?.daysPerWeek || 0) * Number(p?.minutesPerSession || 0)) || undefined;
          let next: { dayLabel?: string; focus?: string; dayId?: number } | null = null;
          try {
            const ds: any[] = Array.isArray(p?.days) ? p.days : [];
            if (ds.length) {
              if (done?.dayId) {
                const idx = ds.findIndex(x => x?.id === done.dayId);
                const nidx = idx >= 0 ? (idx + 1) % ds.length : 0;
                const nd = ds[nidx];
                next = { dayLabel: `Day ${nd?.dayOrder ?? (nidx+1)}`, focus: nd?.focus, dayId: nd?.id };
              } else {
                const nd = ds[0];
                next = { dayLabel: `Day ${nd?.dayOrder ?? 1}`, focus: nd?.focus, dayId: nd?.id };
              }
            }
          } catch {}
          setPlanMeta({ id: p?.id, title: p?.title, daysPerWeek: p?.daysPerWeek, minutesPerSession: p?.minutesPerSession, next, weeklyMinutes: wm });
        } else {
          setPlanMeta(null);
        }
      } catch {}
    } catch (e: any) {
      Alert.alert('ดึงข้อมูลไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [fetchMe, fetchSettings, fetchCaloriesNDays]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ===== Analytics =====
  const last7 = useMemo(() => days.slice(-7), [days]);
  const last14 = days;

  const avg7 = useMemo(() => Math.round(last7.reduce((s, x) => s + x.total, 0) / Math.max(1, last7.length)), [last7]);
  const avg14 = useMemo(() => Math.round(last14.reduce((s, x) => s + x.total, 0) / Math.max(1, last14.length)), [last14]);

  const best = useMemo(() => {
    if (!last14.length) return null;
    return last14.reduce((a, b) => (a.total >= b.total ? a : b));
  }, [last14]);

  const goalMeet7 = useMemo(
    () => last7.filter(d => d.total <= goalKcal).length,
    [last7, goalKcal]
  );

  const streakMeet = useMemo(() => {
    // นับ streak ย้อนหลัง: ทำได้ตามเป้าหมายติดต่อกันกี่วันล่าสุด
    let c = 0;
    for (let i = last14.length - 1; i >= 0; i--) {
      const ok = last14[i].total <= goalKcal;
      if (ok) c++;
      else break;
    }
    return c;
  }, [last14, goalKcal]);

  // ===== Chart helpers (bar chart 7 วัน) =====
  const maxK = Math.max(goalKcal, ...last7.map(x => x.total), 1);
  const barW = chartSizing.barW;
  const gap = chartSizing.gap;

  // Water chart (7 days)
  const waterLast7 = useMemo(() => waterDays.slice(-7), [waterDays]);
  const waterGoalL = useMemo(() => {
    const g = me?.water_goal_l ?? waterTargetL(me?.weight_kg ?? null) ?? 2;
    return Number(g);
  }, [me?.water_goal_l, me?.weight_kg]);
  const waterTargetMl = useMemo(() => Math.round(waterGoalL * 1000), [waterGoalL]);
  const maxWaterMl = useMemo(() => {
    const mx = Math.max(1, waterTargetMl, ...waterLast7.map(d => Number(d?.ml || 0)));
    // add small headroom for aesthetics
    return Math.max(mx, Math.round(waterTargetMl * 1.2));
  }, [waterLast7, waterTargetMl]);

  // Workout chart (7 days)
  const workoutLast7 = useMemo(() => workoutDays.slice(-7), [workoutDays]);
  const workoutMins = useMemo(() => workoutLast7.map(d => Math.round(Number(d?.durationSec || 0) / 60)), [workoutLast7]);
  const maxWorkoutMin = useMemo(() => Math.max(30, ...workoutMins, 1), [workoutMins]);

  // Weekly hydration progress
  const waterWeek = useMemo(() => {
    const start = weekWindow.start;
    const end = weekWindow.end;
    const totalMl = waterDays
      .filter(d => typeof d?.date === 'string' && d.date >= start && d.date <= end)
      .reduce((s, x) => s + Number(x?.ml || 0), 0);
    const goalMl = waterTargetMl * 7;
    const pct = Math.max(0, Math.min(100, Math.round((totalMl / Math.max(1, goalMl)) * 100)));
    return { totalMl, goalMl, pct };
  }, [waterDays, waterTargetMl, weekWindow.start, weekWindow.end]);

  // Weekly workout progress (by minutes)
  const workoutWeek = useMemo(() => {
    const start = weekWindow.start;
    const end = weekWindow.end;
    const mins = workoutDays
      .filter(d => typeof d?.date === 'string' && d.date >= start && d.date <= end)
      .reduce((s, x) => s + Math.round(Number(x?.durationSec || 0) / 60), 0);
    const goalMin = Number(planMeta?.weeklyMinutes || 0);
    const pct = goalMin > 0 ? Math.max(0, Math.min(100, Math.round((mins / goalMin) * 100))) : 0;
    return { mins, goalMin, pct };
  }, [workoutDays, weekWindow.start, weekWindow.end, planMeta?.weeklyMinutes]);

  function sinceThai(ts?: number): string {
    if (!ts) return '-';
    const diff = Date.now() - ts;
    const d = Math.floor(diff / (24*60*60*1000));
    if (d > 0) return `${d} วันก่อน`;
    const h = Math.floor((diff % (24*60*60*1000)) / (60*60*1000));
    if (h > 0) return `${h} ชม.ก่อน`;
    const m = Math.floor((diff % (60*60*1000)) / (60*1000));
    return `${m} นาทีที่แล้ว`;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text>กำลังโหลดสถิติ…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Hero Header */}
      <LinearGradient colors={["#6366f1","#8b5cf6"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.hero}>
        <Text style={styles.heroTitle}>สถิติสุขภาพ</Text>
        <Text style={styles.heroMeta}>{displayName(me)} • เป้าหมาย {goalKcal} kcal/วัน</Text>
        <View style={styles.chipsRow}>
          <Text style={styles.chip}>BMI: {calcBMI(me?.weight_kg ?? null, me?.height_cm ?? null) ?? '-'}</Text>
          <Text style={styles.chip}>กิจกรรม: {activityKey(me?.activity_level) ?? '-'}</Text>
        </View>
      </LinearGradient>

      {/* Weekly Goals */}
      <View style={styles.card}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
          <Text style={styles.cardLine}>เป้าหมายสัปดาห์นี้</Text>
          <TouchableOpacity onPress={() => setWeeklyModal(true)}>
            <Text style={[styles.metaLight, { fontWeight: '800', color: '#6366f1' }]}>ดูทั้งหมด ›</Text>
          </TouchableOpacity>
        </View>
        {/* Hydration weekly */}
        <View style={{ marginTop: 8 }}>
          <View style={styles.progressOuter}>
            <View style={[styles.progressInner, { width: `${waterWeek.pct}%`, backgroundColor: '#3b82f6' }]} />
          </View>
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:4 }}>
            <Text style={styles.metaLight}>น้ำดื่ม: {Math.round(waterWeek.totalMl)} / {waterWeek.goalMl} ml</Text>
            <Text style={[styles.metaLight, { fontWeight: '800', color: '#111' }]}>{waterWeek.pct}%</Text>
          </View>
          <Text style={[styles.tipText, { marginTop: 4 }]}>
            {waterWeek.pct >= 100 ? 'เยี่ยมมาก! คุณถึงเป้าประจำสัปดาห์แล้ว 🎉' : (waterWeek.pct >= 75 ? 'คุณใกล้จะถึงเป้าหมายแล้ว! 🎯' : 'ค่อยๆ ดื่มระหว่างวันให้สม่ำเสมอ 💧')}
          </Text>
        </View>

        {/* Workout weekly (show when goal exists) */}
        {!!(workoutWeek.goalMin > 0) && (
          <View style={{ marginTop: 12 }}>
            <View style={styles.progressOuter}>
              <View style={[styles.progressInner, { width: `${workoutWeek.pct}%`, backgroundColor: '#8b5cf6' }]} />
            </View>
            <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:4 }}>
              <Text style={styles.metaLight}>ออกกำลังกาย: {workoutWeek.mins} / {workoutWeek.goalMin} นาที</Text>
              <Text style={[styles.metaLight, { fontWeight: '800', color: '#111' }]}>{workoutWeek.pct}%</Text>
            </View>
            <Text style={[styles.tipText, { marginTop: 4 }]}>
              {workoutWeek.pct >= 100 ? 'สุดยอด! ครบเป้าสัปดาห์แล้ว 💪' : (workoutWeek.pct >= 75 ? 'อีกนิดเดียวจะครบเป้า! 🔥' : 'เริ่มจากสั้นๆ ก่อน แล้วค่อยเพิ่มเวลา 😊')}
            </Text>
          </View>
        )}
      </View>

      {/* Weight Trend */}
      <Text style={styles.section}>📉 เทรนด์น้ำหนัก (30 วัน)</Text>
      <View style={styles.card}>
        {(() => {
          const vals = weightDays.map(w => (typeof w.weight_kg === 'number' ? Number(w.weight_kg) : null)).filter((v): v is number => typeof v === 'number' && isFinite(v));
          if (!vals.length) return <Text style={styles.metaLight}>ยังไม่มีข้อมูล</Text>;
          const mn = Math.min(...vals);
          const mx = Math.max(...vals);
          const range = Math.max(0.5, mx - mn);
          return (
            <View style={{ flexDirection:'row', alignItems:'flex-end', gap:2, height:60 }}>
              {weightDays.slice(-30).map((d,i)=>{
                const v = typeof d.weight_kg === 'number' ? d.weight_kg! : null;
                const h = v==null ? 2 : Math.max(2, ((v - mn) / range) * 56 + 4);
                return <View key={d.date+String(i)} style={{ width:4, height:h, backgroundColor:'#6366f1', borderRadius:2 }} />
              })}
            </View>
          );
        })()}
      </View>

      {/* Health Metrics */}
      <Text style={styles.section}>📊 ตัวชี้วัดพื้นฐาน</Text>
      <View style={styles.card}>
        {(() => {
          const age = calcAge(me?.date_of_birth);
          const bmi = calcBMI(me?.weight_kg ?? null, me?.height_cm ?? null);
          const bmr = calcBMRMifflin(me?.gender, me?.weight_kg ?? null, me?.height_cm ?? null, age);
          const tdee = calcTDEE(bmr, me?.activity_level);
          const hrmax = hrMaxTanaka(age);
          const zones = hrZones(hrmax);
          const water = me?.water_goal_l ?? waterTargetL(me?.weight_kg ?? null);
          const pr = proteinRange(me?.weight_kg ?? null);
          return (
            <>
              <Text style={styles.cardLine}>อายุ: <Text style={styles.bold}>{age ?? '-'}</Text> ปี</Text>
              <Text style={styles.cardLine}>BMI: <Text style={styles.bold}>{bmi ?? '-'}</Text> {bmi!=null ? `(${bmiCategory(bmi)})` : ''}</Text>
              <Text style={styles.cardLine}>BMR (Mifflin): <Text style={styles.bold}>{bmr ?? '-'}</Text> kcal/วัน</Text>
              <Text style={styles.cardLine}>TDEE (ประมาณ): <Text style={styles.bold}>{tdee ?? '-'}</Text> kcal/วัน</Text>
              <Text style={[styles.cardLine,{marginTop:4}]}>HRmax (Tanaka): <Text style={styles.bold}>{hrmax ?? '-'}</Text> bpm</Text>
              {!!zones && (
                <Text style={styles.metaLight}>
                  โซนหัวใจ Z1 {zones[0][0][0]}–{zones[0][0][1]} • Z2 {zones[1][0][0]}–{zones[1][0][1]} • Z3 {zones[2][0][0]}–{zones[2][0][1]} • Z4 {zones[3][0][0]}–{zones[3][0][1]} • Z5 {zones[4][0][0]}–{zones[4][0][1]} bpm
                </Text>
              )}
              <Text style={[styles.cardLine,{marginTop:4}]}>เป้าน้ำ: <Text style={styles.bold}>{water ?? '-'}</Text> L/วัน</Text>
              {!!pr && (
                <Text style={styles.metaLight}>โปรตีนแนะนำ: {pr[0]}–{pr[1]} g/วัน</Text>
              )}

              {!!tdee && (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, { marginTop: 8 }]}
                  onPress={async () => {
                    try {
                      const token = await AsyncStorage.getItem(AUTH_KEY);
                      if (!token) { router.replace('/(tabs)/login'); return; }
                      const res = await fetch(`${API}/api/settings`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ DailyGoalKcal: tdee, GoalMode: 'auto' }),
                      });
                      if (!res.ok) throw new Error(await res.text());
                      Alert.alert('บันทึกแล้ว', `ตั้งเป้า ${tdee} kcal/วัน`);
                      setSettings(s => ({ ...(s || {}), DailyGoalKcal: tdee }));
                    } catch (e: any) {
                      Alert.alert('บันทึกไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
                    }
                  }}
                >
                  <Text style={[styles.btnText, { color: '#fff' }]}>ตั้งเป้าแคลอรี่ = TDEE</Text>
                </TouchableOpacity>
              )}

              {/* Update weight daily */}
              <View style={styles.weightRow}>
                <Text style={styles.cardLine}>น้ำหนักวันนี้ (kg):</Text>
                <TextInput
                  value={weightStr}
                  onChangeText={setWeightStr}
                  keyboardType="numeric"
                  placeholder="เช่น 68.5"
                  style={styles.weightInput}
                />
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={async () => {
                    const w = parseFloat(weightStr);
                    if (!Number.isFinite(w) || w <= 0) { Alert.alert('กรอกน้ำหนักให้ถูกต้อง', 'เช่น 68 หรือ 68.5'); return; }
                    try {
                      const token = await AsyncStorage.getItem(AUTH_KEY);
                      if (!token) { router.replace('/(tabs)/login'); return; }
                      const res2 = await fetch(`${API}/api/weight`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ weight_kg: w }),
                      });
                      if (!res2.ok) throw new Error(await res2.text());
                      setMe(m => (m ? { ...m, weight_kg: w } : m));
                      setWeightDays(days => {
                        const d = ymd(new Date());
                        const idx = days.findIndex(x => x.date === d);
                        if (idx >= 0) {
                          const copy = [...days];
                          copy[idx] = { ...copy[idx], weight_kg: w };
                          return copy;
                        }
                        return [...days, { date: d, weight_kg: w }];
                      });
                      Alert.alert('บันทึกแล้ว', 'อัปเดตน้ำหนักวันนี้สำเร็จ');
                    } catch (e: any) {
                      Alert.alert('บันทึกไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
                    }
                  }}
                >
                  <Text style={[styles.btnText, { color: '#fff' }]}>อัปเดต</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
      </View>

      {/* การดื่มน้ำวันนี้ */}
      <Text style={styles.section}>💧 การดื่มน้ำวันนี้</Text>
      <View style={styles.card}>
        {(() => {
          const targetL = me?.water_goal_l ?? waterTargetL(me?.weight_kg ?? null) ?? 2;
          const targetMl = Math.round(targetL * 1000);
          const pct = Math.max(0, Math.min(100, Math.round((waterMl / targetMl) * 100)));
          // Hydration streak (จาก waterDays)
          let streak = 0;
          for (let i = waterDays.length - 1; i >= 0; i--) {
            if ((waterDays[i]?.ml || 0) >= targetMl) streak++; else break;
          }
          return (
            <>
              <View style={styles.waterRowTop}>
                <Text style={styles.cardLine}>ดื่มแล้ว: <Text style={styles.bold}>{Math.round(waterMl)}</Text> ml / เป้า <Text style={styles.bold}>{targetMl}</Text> ml ({pct}%)</Text>
              </View>
              <View style={styles.progressOuter}>
                <View style={[styles.progressInner,{ width: `${pct}%` }]} />
              </View>
              <Text style={[styles.meta, { marginTop:6 }]}>สตรีคน้ำ: <Text style={styles.bold}>{streak}</Text> วัน</Text>

              <View style={styles.waterQuickRow}>
                {[200,300,500].map(v => (
                  <TouchableOpacity key={v} style={styles.btn} onPress={async ()=>{
                    try {
                      const token = await AsyncStorage.getItem(AUTH_KEY); if (!token) { router.replace('/(tabs)/login'); return; }
                      const r = await fetch(`${API}/api/water/add`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ add_ml: v }) });
                      if (!r.ok) throw new Error(await r.text());
                      const js = await r.json();
                      const ml = Number(js?.ml || 0);
                      setWaterMl(ml);
                      setWaterDays(d => { const today = ymd(new Date()); const arr=[...d]; const i=arr.findIndex(x=>x.date===today); if(i>=0){arr[i]={...arr[i], ml};} else {arr.push({date: today, ml});} return arr; });
                    } catch {}
                  }}>
                    <Text style={styles.btnText}>+{v} ml</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.btn} onPress={async ()=>{
                  try {
                    const token = await AsyncStorage.getItem(AUTH_KEY); if (!token) { router.replace('/(tabs)/login'); return; }
                    const r = await fetch(`${API}/api/water/add`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ add_ml: -100 }) });
                    if (!r.ok) throw new Error(await r.text());
                    const js = await r.json();
                    const ml = Number(js?.ml || 0);
                    setWaterMl(ml);
                    setWaterDays(d => { const today = ymd(new Date()); const arr=[...d]; const i=arr.findIndex(x=>x.date===today); if(i>=0){arr[i]={...arr[i], ml};} else {arr.push({date: today, ml});} return arr; });
                  } catch {}
                }}>
                  <Text style={styles.btnText}>-100 ml</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.weightRow}>
                <TextInput
                  value={waterAddStr}
                  onChangeText={setWaterAddStr}
                  keyboardType="numeric"
                  placeholder="ระบุ ml เช่น 250"
                  style={[styles.weightInput,{ width: 140 }]}
                />
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={async ()=>{
                  const add = parseInt(waterAddStr, 10);
                  if (!Number.isFinite(add) || add <= 0) { Alert.alert('กรอกจำนวน ml ให้ถูกต้อง'); return; }
                  try {
                    const token = await AsyncStorage.getItem(AUTH_KEY); if (!token) { router.replace('/(tabs)/login'); return; }
                    const r = await fetch(`${API}/api/water/add`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ add_ml: add }) });
                    if (!r.ok) throw new Error(await r.text());
                    const js = await r.json();
                    const ml = Number(js?.ml || 0);
                    setWaterMl(ml); setWaterAddStr('');
                    setWaterDays(d => { const today = ymd(new Date()); const arr=[...d]; const i=arr.findIndex(x=>x.date===today); if(i>=0){arr[i]={...arr[i], ml};} else {arr.push({date: today, ml});} return arr; });
                  } catch {}
                }}>
                  <Text style={[styles.btnText,{color:'#fff'}]}>เพิ่ม</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={async ()=>{
                  try {
                    const token = await AsyncStorage.getItem(AUTH_KEY); if (!token) { router.replace('/(tabs)/login'); return; }
                    const r = await fetch(`${API}/api/water`, { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body: JSON.stringify({ ml: 0 }) });
                    if (!r.ok) throw new Error(await r.text());
                    setWaterMl(0);
                    setWaterDays(d => { const today = ymd(new Date()); const arr=[...d]; const i=arr.findIndex(x=>x.date===today); if(i>=0){arr[i]={...arr[i], ml:0};} else {arr.push({date: today, ml:0});} return arr; });
                  } catch {}
                }}>
                  <Text style={styles.btnText}>รีเซ็ตวันนี้</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
      </View>

      {/* โภชนาการ */}
      <Text style={styles.section}>🍽️ โภชนาการ</Text>
      {/* KPI Cards */}
      <View style={styles.kpiRow}>
        <View style={[styles.kpi, { borderLeftColor: '#10b981' }]}>
          <Text style={styles.kpiVal}>{avg7}</Text>
          <Text style={styles.kpiLabel}>เฉลี่ย 7 วัน (kcal)</Text>
        </View>
        <View style={[styles.kpi, { borderLeftColor: '#6366f1' }]}>
          <Text style={styles.kpiVal}>{avg14}</Text>
          <Text style={styles.kpiLabel}>เฉลี่ย 14 วัน (kcal)</Text>
        </View>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpi, { borderLeftColor: '#f59e0b' }]}>
          <Text style={styles.kpiVal}>
            {goalMeet7}/{last7.length}
          </Text>
          <Text style={styles.kpiLabel}>วันแตะเป้า (7 วัน)</Text>
        </View>
        <View style={[styles.kpi, { borderLeftColor: '#ef4444' }]}>
          <Text style={styles.kpiVal}>{streakMeet} วัน</Text>
          <Text style={styles.kpiLabel}>สตรีคแตะเป้าล่าสุด</Text>
        </View>
      </View>

      {/* Bar Chart (7 days) */}
      <Text style={styles.section}>📈 แคลอรี่รายวัน (7 วันล่าสุด)</Text>
      <View style={styles.chartBox}>
        {/* เส้นเป้าหมาย */}
        <View
          style={[
            styles.goalLine,
            { bottom: `${(goalKcal / maxK) * 100}%`, left: chartSizing.leftPad, right: chartSizing.axisW },
          ]}
        />
        <View style={[styles.chartBars, { left: chartSizing.leftPad, right: chartSizing.axisW }]}>
          {last7.map((d, i) => {
            const heightPct = (d.total / maxK) * 100;
            const meet = d.total <= goalKcal;
            const date = new Date(d.date);
            return (
              <View key={d.date} style={{ width: barW, alignItems: 'center', marginRight: i < last7.length - 1 ? gap : 0 }}>
                <View style={[styles.bar, { height: `${heightPct}%`, backgroundColor: meet ? '#10b981' : '#ef4444' }]} />
                <Text style={styles.barLabel}>{thaiShort(date.getDay())}</Text>
              </View>
            );
          })}
        </View>
        <View style={[styles.chartAxis, { right: 8 }] }>
          <Text style={styles.axisText}>{Math.round(maxK)}</Text>
          <Text style={styles.axisText}>{Math.round(maxK * 0.5)}</Text>
          <Text style={styles.axisText}>0</Text>
        </View>
      </View>
      <Text style={styles.legend}>
        ─ เส้นประ: เป้า {goalKcal} kcal/วัน  •  สีเขียว ≤ เป้า  •  สีแดง {'>'} เป้า
      </Text>

      {/* Water Chart */}
      <Text style={styles.section}>💧 การดื่มน้ำ (7 วัน)</Text>
      <View style={styles.chartBox}>
        {waterLast7.length === 0 ? (
          <Text style={styles.metaLight}>ยังไม่มีข้อมูล</Text>
        ) : (
          <>
            {/* เส้นเป้าน้ำต่อวัน */}
            <View
              style={[
                styles.goalLine,
                { bottom: `${(waterTargetMl / Math.max(1, maxWaterMl)) * 100}%`, left: chartSizing.leftPad, right: chartSizing.axisW },
              ]}
            />
            <View style={[styles.chartBars, { left: chartSizing.leftPad, right: chartSizing.axisW }]}>
              {waterLast7.map((d, i) => {
                const val = Number(d?.ml || 0);
                const heightPct = (val / Math.max(1, maxWaterMl)) * 100;
                const meet = val >= waterTargetMl;
                const date = new Date(d.date);
                return (
                  <View key={d.date} style={{ width: barW, alignItems: 'center', marginRight: i < waterLast7.length - 1 ? gap : 0 }}>
                    <View style={[styles.bar, { height: `${heightPct}%`, backgroundColor: meet ? '#10b981' : '#60a5fa' }]} />
                    <Text style={styles.barLabel}>{thaiShort(date.getDay())}</Text>
                  </View>
                );
              })}
            </View>
            <View style={[styles.chartAxis, { right: 8 }]}>
              <Text style={styles.axisText}>{Math.round(maxWaterMl)} ml</Text>
              <Text style={styles.axisText}>{Math.round(maxWaterMl * 0.5)} ml</Text>
              <Text style={styles.axisText}>0</Text>
            </View>
          </>
        )}
      </View>
      <Text style={styles.legend}>
        ─ เส้นประ: เป้า {waterTargetMl} ml/วัน • สีเขียว ≥ เป้า • สีน้ำเงิน {'<'} เป้า
      </Text>

      {/* Best Day */}
      <Text style={styles.section}>วันเด่น</Text>
      <View style={styles.card}>
        <Text style={styles.cardLine}>
          • กินน้อยที่สุด (14 วัน):{' '}
          <Text style={styles.bold}>
            {last14.length ? `${last14.reduce((a, b) => (a.total <= b.total ? a : b)).total} kcal` : '-'}
          </Text>
        </Text>
        <Text style={styles.cardLine}>
          • กินมากที่สุด (14 วัน):{' '}
          <Text style={[styles.bold, { color: '#ef4444' }]}>
            {best ? `${best.total} kcal` : '-'}
          </Text>
        </Text>
      </View>

      {/* Tips */}
      <Text style={styles.section}>🤖 ข้อเสนอแนะอัตโนมัติ</Text>
      <View style={styles.card}>
        {avg7 <= goalKcal
          ? (
            <Text style={styles.tipGood}>
              ✅ โดยเฉลี่ย 7 วันคุณอยู่ในเป้าหมาย ลองเน้นโปรตีนคุณภาพและดื่มน้ำ {me?.water_goal_l ?? 2} ลิตร/วันต่อเนื่อง!
            </Text>
          ) : (
            <Text style={styles.tipWarn}>
              ⚠️ 7 วันเฉลี่ยเกินเป้า ~{avg7 - goalKcal} kcal/วัน ลองลดน้ำหวาน/ของทอด และเพิ่มผัก-โปรตีนลีน
            </Text>
          )
        }
        <Text style={styles.tipText}>
          เคล็ดลับ: จัดมื้อหลักให้มีโปรตีน 25–40g/มื้อ และบันทึกอาหารทันทีหลังทาน จะช่วยคุมแคลอรี่ได้ดีขึ้น 💪
        </Text>
      </View>

      {/* Weekly breakdown modal */}
      <Modal
        visible={weeklyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setWeeklyModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>ความคืบหน้า • สัปดาห์นี้</Text>

            {/* Hydration breakdown */}
            <Text style={[styles.section, { marginTop: 8 }]}>💧 น้ำดื่ม</Text>
            {weekDates.map((wd, idx) => {
              const w = waterDays.find(x => x.date === wd.date);
              const ml = Number(w?.ml || 0);
              const meet = ml >= waterTargetMl;
              return (
                <View key={wd.date+String(idx)} style={styles.modalRow}>
                  <Text style={[styles.metaLight, { minWidth: 52 }]}>{thaiShort(wd.d.getDay())}</Text>
                  <Text style={[styles.cardLine, { flex: 1 }]}>{ml} / {waterTargetMl} ml</Text>
                  <Text style={{ fontWeight: '800', color: meet ? '#10b981' : '#6b7280' }}>{meet ? '✓' : '•'}</Text>
                </View>
              );
            })}

            {/* Workout breakdown */}
            <Text style={[styles.section, { marginTop: 10 }]}>🏋️ ออกกำลังกาย</Text>
            {weekDates.map((wd, idx) => {
              const w = workoutDays.find(x => x.date === wd.date);
              const mins = Math.round(Number(w?.durationSec || 0) / 60);
              const ses = Number(w?.sessions || 0);
              return (
                <View key={wd.date+':w:'+String(idx)} style={styles.modalRow}>
                  <Text style={[styles.metaLight, { minWidth: 52 }]}>{thaiShort(wd.d.getDay())}</Text>
                  <Text style={[styles.cardLine, { flex: 1 }]}>{mins} นาที • {ses} ครั้ง</Text>
                </View>
              );
            })}

            <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 12 }]} onPress={() => setWeeklyModal(false)}>
              <Text style={[styles.btnText, { color: '#fff' }]}>ปิด</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* การออกกำลังกาย */}
      <Text style={styles.section}>🏋️ การออกกำลังกาย</Text>
      <View style={styles.card}>
        <Text style={styles.cardLine}>แผนล่าสุด: <Text style={styles.bold}>{planMeta?.title ?? '-'}</Text></Text>
        <Text style={styles.cardLine}>เป้าหมายสัปดาห์: <Text style={styles.bold}>{planMeta?.daysPerWeek ?? '-'}</Text> ครั้ง ≈ <Text style={styles.bold}>{planMeta?.weeklyMinutes ?? '-'}</Text> นาที</Text>
        <Text style={styles.cardLine}>ครั้งล่าสุด: <Text style={styles.bold}>{lastWorkout?.completedAt ? new Date(lastWorkout.completedAt).toLocaleString() : '-'}</Text> ({sinceThai(lastWorkout?.completedAt)})</Text>
        {!!planMeta?.next && (
          <Text style={styles.cardLine}>วันถัดไป: <Text style={styles.bold}>{planMeta.next.dayLabel}</Text> — {planMeta.next.focus ?? '-'}</Text>
        )}

        <View style={{ flexDirection:'row', gap:10, marginTop:8 }}>
          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={()=>router.push('/(tabs)/WorkoutPlanDetail')}>
            <Text style={[styles.btnText,{color:'#fff'}]}>ดูแผน</Text>
          </TouchableOpacity>
          {!!(planMeta?.id && planMeta?.next?.dayId) && (
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                const pid = planMeta?.id ? String(planMeta.id) : '';
                const did = planMeta?.next?.dayId ? String(planMeta.next.dayId) : '';
                if (!pid || !did) return;
                router.push(`/(tabs)/StartWorkout?planId=${encodeURIComponent(pid)}&dayId=${encodeURIComponent(did)}`);
              }}
            >
              <Text style={styles.btnText}>เริ่มวันถัดไป</Text>
            </TouchableOpacity>
          )}
        </View>
        {(() => {
          // Workout streak & exercise calories (ประมาณ)
          const days = workoutDays;
          let wStreak = 0;
          for (let i = days.length - 1; i >= 0; i--) { if ((days[i]?.sessions || 0) > 0) wStreak++; else break; }
          const last7w = days.slice(-7);
          const totalMin = last7w.reduce((s,x)=> s + Math.round((x.durationSec||0)/60), 0);
          const wt = me?.weight_kg || 70; // kg
          const MET = 6; // moderate
          const kcal = Math.round(totalMin * (MET * 3.5 * (wt||70)) / 200);
          return (
            <View style={{ marginTop:8 }}>
              <Text style={styles.cardLine}>สตรีคเวิร์คเอาต์: <Text style={styles.bold}>{wStreak}</Text> วัน</Text>
              <Text style={styles.cardLine}>ประมาณพลังงานจากการฝึก (7 วัน): <Text style={styles.bold}>{kcal}</Text> kcal</Text>
            </View>
          );
        })()}
      </View>

      {/* Workout Chart */}
      <Text style={styles.section}>📈 เวลาการออกกำลังกาย (7 วัน)</Text>
      <View style={styles.chartBox}>
        {workoutLast7.length === 0 ? (
          <Text style={styles.metaLight}>ยังไม่มีข้อมูล</Text>
        ) : (
          <>
            <View style={[styles.chartBars, { left: chartSizing.leftPad, right: chartSizing.axisW }]}>
              {workoutLast7.map((d, i) => {
                const mins = Math.round(Number(d?.durationSec || 0) / 60);
                const heightPct = (mins / Math.max(1, maxWorkoutMin)) * 100;
                const date = new Date(d.date);
                return (
                  <View key={d.date} style={{ width: barW, alignItems: 'center', marginRight: i < workoutLast7.length - 1 ? gap : 0 }}>
                    <View style={[styles.bar, { height: `${heightPct}%`, backgroundColor: '#8b5cf6' }]} />
                    <Text style={styles.barLabel}>{thaiShort(date.getDay())}</Text>
                  </View>
                );
              })}
            </View>
            <View style={[styles.chartAxis, { right: 8 }]}>
              <Text style={styles.axisText}>{Math.round(maxWorkoutMin)} นาที</Text>
              <Text style={styles.axisText}>{Math.round(maxWorkoutMin * 0.5)} นาที</Text>
              <Text style={styles.axisText}>0</Text>
            </View>
          </>
        )}
      </View>

      {/* Actions */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => router.push('/(tabs)/CalorieTrackerScreen')}
        >
          <Text style={[styles.btnText, { color: '#fff' }]}>ไปบันทึกแคลอรี่</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.push('/(tabs)/WaterTracker')}
        >
          <Text style={styles.btnText}>ไปดื่มน้ำ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.replace('/(tabs)/Homesrceen')}
        >
          <Text style={styles.btnText}>‹ กลับหน้า Home</Text>
        </TouchableOpacity>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  title: { fontSize: 20, fontWeight: '800', color: '#111' },
  meta: { color: '#374151', marginTop: 4 },
  metaLight: { color: '#9ca3af', marginTop: 2 },

  // Hero
  hero:{
    borderRadius:16,
    padding:16,
    marginBottom:10,
    shadowColor:'#000', shadowOpacity:0.12, shadowRadius:10, shadowOffset:{width:0,height:4},
    elevation:4,
  },
  heroTitle:{ color:'#fff', fontSize:18, fontWeight:'900' },
  heroMeta:{ color:'rgba(255,255,255,0.9)', marginTop:4 },
  chipsRow:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 },
  chip:{ paddingVertical:6, paddingHorizontal:10, borderRadius:999, backgroundColor:'rgba(255,255,255,0.18)', color:'#fff', fontWeight:'800' },

  kpiRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  kpi: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderLeftWidth: 4,
    shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2}, elevation:2,
  },
  kpiVal: { fontSize: 18, fontWeight: '800', color: '#111' },
  kpiLabel: { color: '#6b7280', marginTop: 2 },

  section: { marginTop: 16, marginBottom: 6, fontWeight: '800', color: '#111' },

  chartBox: {
    height: 220,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 12,
    marginBottom: 6,
    shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2}, elevation:2,
  },
  chartBars: {
    position: 'absolute',
    left: 12,
    right: 48, // เผื่อแกน y
    bottom: 24,
    top: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  bar: {
    width: 28,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: '#10b981',
  },
  barLabel: { fontSize: 12, color: '#6b7280', marginTop: 4, textAlign: 'center' },

  chartAxis: {
    position: 'absolute',
    right: 8,
    top: 8,
    bottom: 24,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  axisText: { fontSize: 10, color: '#9ca3af' },

  goalLine: {
    position: 'absolute',
    left: 10,
    right: 44,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: '#6b7280',
  },
  legend: { color: '#6b7280', fontSize: 12, marginBottom: 6 },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    padding: 12,
    shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2}, elevation:2,
  },
  cardLine: { color: '#374151', marginBottom: 4 },
  bold: { fontWeight: '800', color: '#111' },
  // removed rowText/label/input styles

  tipGood: { color: '#065f46', fontWeight: '700', marginBottom: 6 },
  tipWarn: { color: '#b45309', fontWeight: '700', marginBottom: 6 },
  tipText: { color: '#374151' },

  btn: {
    flex: 1,
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#8b5cf6', borderColor: '#7c3aed' },
  btnText: { color: '#3730a3', fontWeight: '800' },

  // Weight update controls
  weightRow: { flexDirection:'row', alignItems:'center', gap:8, marginTop: 10, flexWrap: 'wrap' },
  weightInput: { width: 100, borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, paddingVertical:8, paddingHorizontal:10, backgroundColor:'#fff' },

  // Water progress
  waterRowTop: { flexDirection:'row', alignItems:'center', justifyContent:'space-between' },
  waterQuickRow: { flexDirection:'row', gap:8, marginTop:8, flexWrap:'wrap' },
  progressOuter: { height: 10, backgroundColor:'#e5e7eb', borderRadius:999, overflow:'hidden', marginTop:6 },
  progressInner: { height: '100%', backgroundColor:'#60a5fa' },

  // Modal (weekly breakdown)
  modalOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', alignItems:'center', justifyContent:'center' },
  modalBox: { width:'90%', backgroundColor:'#fff', borderRadius:14, padding:16, borderWidth:1, borderColor:'#e5e7eb' },
  modalTitle: { fontSize:16, fontWeight:'900', color:'#111' },
  modalRow: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingVertical:6, borderBottomWidth:1, borderBottomColor:'#f3f4f6' },
});
