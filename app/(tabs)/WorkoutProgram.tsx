// app/(tabs)/WorkoutProgram.tsx
// เวอร์ชันแก้บั๊ก + อัปเกรด AI ให้ "ออกแบบท่าออกกำลังกายที่เหมาะสม" ด้วย
// - ตัดการพึ่งพาโมดูลภายนอก (CDN) ที่ทำให้ build fail ใน sandbox
// - ไม่ import '@/constants/api' หรือ 'expo-haptics' อีกต่อไป
// - ใช้ API_URL จาก globalThis.API_BASE_URL ถ้ามี ไม่งั้น fallback: 'http://localhost:3000'
// - เพิ่ม fallback generator ให้ AI: ถ้า AI ไม่คืนรายการท่า -> เราสร้างท่าให้เองตาม goal/equipment/level
// - เพิ่ม self-tests แบบง่าย ๆ ผ่าน console.assert สำหรับ pure helpers

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
// หมายเหตุ: ถ้าไม่มี expo-router ใน sandbox ของคุณ ให้แทนที่ด้วย navigation กลไกอื่นได้
import { router } from 'expo-router';

// ====== CONFIG KEYS / LOCAL FALLBACKS ======
const AUTH_KEY = 'auth_token';
const PREF_KEY = 'workout_plan_prefs_v2';
const PLAN_CACHE_KEY = 'last_workout_plan_v1';
const ME_CACHE_KEY = 'me_cache';

const API_URL: string = (typeof globalThis !== 'undefined' && (globalThis as any)?.API_BASE_URL) || 'http://localhost:3000';

// ====== TYPES ======
type Days = 3 | 4 | 5;
type Minutes = 30 | 45 | 60;
type Equip = 'none' | 'minimal' | 'fullGym';
type Level = 'beginner' | 'intermediate' | 'advanced';
type Goal = 'lose_weight' | 'build_muscle' | 'maintain_shape' | 'general_fitness';

type Prefs = {
  daysPerWeek: Days;
  minutesPerSession: Minutes;
  equipment: Equip;
  level: Level;
  goal: Goal;
  addCardio: boolean;
  addCore: boolean;
  addMobility: boolean;
  injuries?: string[]; // e.g., ['knee','shoulder','lower_back','wrist','elbow']
  restrictedMoves?: string[]; // custom exercise keywords to avoid
  intensityMode?: 'heavy' | 'medium' | 'light';
};

const defaultPrefs: Prefs = {
  daysPerWeek: 3,
  minutesPerSession: 45,
  equipment: 'minimal',
  level: 'beginner',
  goal: 'general_fitness',
  addCardio: true,
  addCore: true,
  addMobility: true,
  injuries: [],
  restrictedMoves: [],
  intensityMode: 'medium',
};

type PlanBlock = {
  type: 'warmup' | 'strength' | 'hypertrophy' | 'cardio' | 'cooldown' | 'mobility' | string;
  minutes?: number;
  intensity?: string;
  items?: string[]; // รายการท่าที่ออกแบบ
};

type PlanDay = {
  title: string;
  focus?: string;
  blocks: PlanBlock[];
  notes?: string;
};

type AIPlan = {
  summary: string;
  week_minutes: number;
  week_kcal: number;
  days: PlanDay[];
  tips?: string[];
};

type PreviewDay = { day: string; focus: string };

// ====== UTIL: safe haptics (no external import) ======
const haptic = async (kind: 'light' | 'success' = 'light') => {
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).vibrate) {
      (navigator as any).vibrate(kind === 'success' ? 30 : 10);
    }
  } catch {}
};

// ====== PURE HELPERS ======
export const calcWeeklyMinutesFrom = (p: Prefs): number => (
  p.daysPerWeek * p.minutesPerSession + (p.addMobility ? p.daysPerWeek * 5 : 0)
);

export const calcWeeklyBurnKcalFrom = (p: Prefs): number => {
  const levelFactor = p.level === 'advanced' ? 10 : p.level === 'intermediate' ? 8 : 6;
  const base = calcWeeklyMinutesFrom(p) * levelFactor;
  return Math.round(base * (1 + (p.addCardio ? 0.15 : 0)));
};

// ====== Fallback Exercise Generator ======
// ออกแบบท่าตาม goal/equipment/level/focus โดยไม่ต้องพึ่ง AI ถ้า AI ไม่ส่งท่ามา
const pick = <T,>(arr: T[], n: number) => arr.slice(0, Math.max(0, n));

const DB = {
  none: {
    full: ['Squat (BW)', 'Push-up', 'Reverse Lunge', 'Hip Hinge (Good Morning BW)', 'Glute Bridge', 'Plank', 'Side Plank'],
    push: ['Incline Push-up', 'Pike Push-up', 'Diamond Push-up', 'Dips (chair)'],
    pull: ['Door Row / Towel Row', 'Prone Y-T-W', 'Reverse Snow Angel'],
    legs: ['Split Squat', 'Wall Sit', 'Glute Bridge March', 'Calf Raise (single-leg)'],
    core: ['Hollow Hold', 'Dead Bug', 'Mountain Climber'],
  },
  minimal: {
    full: ['DB Goblet Squat', 'DB Flat Press', 'DB Row (bench/hip hinge)', 'DB RDL', 'DB Split Squat', 'Banded Pull-apart', 'Plank'],
    push: ['DB Incline Press', 'DB Shoulder Press', 'DB Fly', 'Band Pushdown'],
    pull: ['DB Row', 'DB Pullover', 'Band Face Pull', 'Hammer Curl'],
    legs: ['DB RDL', 'DB Bulgarian Split Squat', 'DB Hip Thrust', 'DB Walking Lunge'],
    core: ['Cable/Band Pallof Press', 'Hanging Knee Raise (bar)', 'Ab Wheel / Plank'],
  },
  fullGym: {
    full: ['Back Squat', 'Bench Press', 'Lat Pulldown', 'Romanian Deadlift', 'Seated Row', 'Leg Press', 'Plank'],
    push: ['Bench Press', 'Incline DB Press', 'Overhead Press', 'Cable Fly', 'Triceps Rope'],
    pull: ['Deadlift (light-tech)', 'Lat Pulldown', 'Seated Row', 'Chest-supported Row', 'EZ-bar Curl'],
    legs: ['Back Squat', 'Hack Squat', 'Leg Press', 'Hip Thrust', 'Leg Curl', 'Calf Raise'],
    core: ['Cable Pallof', 'Hanging Leg Raise', 'Decline Crunch'],
  },
} as const;

const designExercises = (prefs: Prefs, dayFocus: string, minutes: number): PlanBlock[] => {
  const baseWarm = { type: 'warmup' as const, minutes: 5, items: ['Mobility 5’ (hips/shoulders)'] };
  const baseCool = { type: 'cooldown' as const, minutes: 5, items: ['Stretch 5’ / Breathing'] };

  const lib = DB[prefs.equipment];
  const wantCore = prefs.addCore || /core/i.test(dayFocus);
  const wantCardio = prefs.addCardio || /condition|cardio/i.test(dayFocus);

  // แบ่งเวลาคร่าว ๆ ตามโฟกัส
  const strengthMinutes = Math.max(10, minutes - 10 - (wantCardio ? 10 : 0));
  const perItem = prefs.level === 'advanced' ? 6 : prefs.level === 'intermediate' ? 5 : 4; // นาทีต่อท่า
  const numStrength = Math.max(3, Math.min(6, Math.floor(strengthMinutes / perItem)));

  const pickFrom = (key: keyof typeof lib) => pick(lib[key], numStrength);

  let focusKey: keyof typeof lib = 'full';
  if (/push/i.test(dayFocus)) focusKey = 'push';
  else if (/pull/i.test(dayFocus)) focusKey = 'pull';
  else if (/leg/i.test(dayFocus) || /ขา|สะโพก/.test(dayFocus)) focusKey = 'legs';

  const items = pickFrom(focusKey);
  const blocks: PlanBlock[] = [
    baseWarm,
    { type: prefs.goal === 'build_muscle' ? 'hypertrophy' : 'strength', minutes: strengthMinutes, items },
  ];

  if (wantCore) blocks.push({ type: 'mobility', minutes: 5, items: pick(lib.core, 2) });
  if (wantCardio) blocks.push({ type: 'cardio', minutes: 10, intensity: 'Z2-Z3', items: ['Bike / Row / Jog'] });
  blocks.push(baseCool);

  return blocks;
};

const ensurePlanHasExercises = (plan: AIPlan, prefs: Prefs): AIPlan => {
  const perSession = prefs.minutesPerSession;
  const days = plan.days.map((d) => {
    const hasAny = d.blocks?.some((b) => b?.items && b.items.length > 0);
    return hasAny
      ? d
      : { ...d, blocks: designExercises(prefs, d.focus || d.title, perSession) };
  });
  return { ...plan, days };
};

// Convert a simple day focus into detailed exercises compatible with WorkoutPlanDetail screen
type PlanExercise = { name: string; sets?: number | null; repsOrTime?: string | null; restSec?: number | null; notes?: string | null; seq?: number };
const genExercisesForDay = (focus: string, p: Prefs): PlanExercise[] => {
  const E = p.equipment;
  const L = p.level;
  const withCore = p.addCore || /core/i.test(focus);
  const withCardio = p.addCardio || /cardio|condition/i.test(focus);
  const injuries = (p.injuries || []).map(s => String(s).toLowerCase());
  const restricted = (p.restrictedMoves || []).map(s => String(s).toLowerCase());
  const mode = p.intensityMode || 'medium';

  const move = {
    squat: E === 'none' ? 'Bodyweight Squat' : E === 'minimal' ? 'DB Goblet Squat' : 'Barbell Back Squat',
    hinge: E === 'none' ? 'Hip Hinge (BW)' : E === 'minimal' ? 'DB Romanian Deadlift' : 'Barbell Romanian Deadlift',
    push_h: E === 'none' ? 'Push-up' : E === 'minimal' ? 'DB Bench Press' : 'Barbell Bench Press',
    push_v: E === 'none' ? 'Pike Push-up' : E === 'minimal' ? 'DB Shoulder Press' : 'Barbell Overhead Press',
    pull_h: E === 'none' ? 'Inverted Row' : E === 'minimal' ? 'DB Row' : 'Seated/Barbell Row',
    pull_v: E === 'none' ? 'Doorway Row / Band Pull' : E === 'minimal' ? 'Band Lat Pulldown' : 'Lat Pulldown / Pull-up',
    lunge: E === 'none' ? 'Reverse Lunge' : E === 'minimal' ? 'DB Reverse Lunge' : 'Smith/DB Lunge',
    core1: 'Plank', core2: 'Dead Bug', cardio: 'Bike/Row/Jog (steady)'
  } as const;

  const presc = () => {
    if (mode === 'heavy') {
      const sets = L === 'advanced' ? 5 : L === 'intermediate' ? 4 : 3;
      const rir  = L === 'advanced' ? 'RIR 0–1' : L === 'intermediate' ? 'RIR 1–2' : 'RIR 2–3';
      return { sets, reps: '4–6', rest: 120, rir } as const;
    }
    if (mode === 'light') {
      const sets = L === 'advanced' ? 3 : 3;
      const rir  = L === 'advanced' ? 'RIR 2' : L === 'intermediate' ? 'RIR 2–3' : 'RIR 3–4';
      return { sets, reps: '12–15', rest: 60, rir } as const;
    }
    // medium
    const sets = L === 'advanced' ? 4 : 3;
    const rir  = L === 'advanced' ? 'RIR 1' : L === 'intermediate' ? 'RIR 1–2' : 'RIR 2–3';
    return { sets, reps: '8–10', rest: 90, rir } as const;
  };

  const prescribe = (base: string) => {
    const pr = presc();
    return { sets: pr.sets, repsOrTime: base || pr.reps, restSec: pr.rest, notes: pr.rir };
  };

  const isUnsafe = (name: string) => {
    const n = name.toLowerCase();
    const hitRestricted = restricted.some(k => k && n.includes(k));
    const has = (inj: string) => injuries.includes(inj);
    const keyword = (kw: string) => n.includes(kw);
    if (hitRestricted) return true;
    if (has('knee') && (keyword('squat') || keyword('lunge') || keyword('step') || keyword('jump'))) return true;
    if (has('shoulder') && (keyword('overhead') || keyword('pike') || keyword('shoulder press'))) return true;
    if (has('lower_back') && (keyword('deadlift') || keyword('rdl') || keyword('good morning') || keyword('barbell row'))) return true;
    if (has('wrist') && (keyword('push-up') || keyword('plank') || keyword('handstand') || keyword('dip'))) return true;
    if (has('elbow') && (keyword('triceps') || keyword('dip')) ) return true;
    return false;
  };

  const altFor = (name: string) => {
    const n = name.toLowerCase();
    const has = (inj: string) => injuries.includes(inj);
    if (has('knee')) {
      if (n.includes('squat')) return E === 'none' ? 'Wall Sit' : E === 'minimal' ? 'DB Box Squat (high box)' : 'Leg Press (light range)';
      if (n.includes('lunge')) return E === 'none' ? 'Glute Bridge' : 'Hip Thrust';
    }
    if (has('shoulder')) {
      if (n.includes('overhead') || n.includes('shoulder press') || n.includes('pike')) return E === 'none' ? 'Incline Push-up' : 'DB Lateral Raise (light)';
    }
    if (has('lower_back')) {
      if (n.includes('deadlift') || n.includes('rdl') || n.includes('good morning')) return E === 'none' ? 'Glute Bridge' : 'Hip Thrust';
      if (n.includes('row')) return E === 'none' ? 'Door Row (knees bent)' : 'Chest-supported Row';
    }
    if (has('wrist')) {
      if (n.includes('push-up') || n.includes('plank')) return E === 'minimal' ? 'DB Chest Press' : E === 'fullgym' ? 'Machine Chest Press' : 'Wall Push-up (neutral wrist)';
    }
    if (has('elbow')) {
      if (n.includes('triceps') || n.includes('dip')) return E === 'minimal' ? 'Cable/Band Pushdown (light)' : 'DB Floor Press (close grip, light)';
    }
    // fallback to original
    return name;
  };

  const out: PlanExercise[] = [];
  const add = (name?: string, preset?: Partial<PlanExercise>) => {
    if (!name) return;
    const safe = isUnsafe(name) ? altFor(name) : name;
    out.push({ name: safe, ...preset });
  };
  if (/Full-Body/i.test(focus)) {
    const pr = presc();
    add(move.squat, prescribe(pr.reps)); add(move.push_h, prescribe(pr.reps)); add(move.pull_h, prescribe(pr.reps)); add(move.hinge, prescribe(pr.reps));
  } else if (/Upper/i.test(focus)) {
    const pr = presc();
    add(move.push_h, prescribe(pr.reps)); add(move.pull_h, prescribe(pr.reps)); add(move.push_v, prescribe(pr.reps)); add(move.pull_v, prescribe(pr.reps));
  } else if (/Lower/i.test(focus)) {
    const pr = presc();
    add(move.squat, prescribe(pr.reps)); add(move.hinge, prescribe(pr.reps)); add(move.lunge, prescribe(pr.reps));
  } else if (/Push/i.test(focus) && !/Pull/i.test(focus)) {
    const pr = presc();
    add(move.push_h, prescribe(pr.reps)); add(move.push_v, prescribe(pr.reps));
  } else if (/Pull/i.test(focus) && !/Push/i.test(focus)) {
    const pr = presc();
    add(move.pull_h, prescribe(pr.reps)); add(move.pull_v, prescribe(pr.reps));
  } else if (/Legs/i.test(focus)) {
    const pr = presc();
    add(move.squat, prescribe(pr.reps)); add(move.lunge, prescribe(pr.reps)); add(move.hinge, prescribe(pr.reps));
  } else if (/Conditioning|Cardio/i.test(focus)) {
    add(move.cardio, { sets: 1, repsOrTime: '10–20m', restSec: 0, notes: 'Z2 steady' });
  } else {
    const pr = presc();
    add(move.squat, prescribe(pr.reps)); add(move.push_h, prescribe(pr.reps)); add(move.pull_h, prescribe(pr.reps));
  }
  if (withCore) add(move.core1, { sets: 3, repsOrTime: '30s', restSec: 45, notes: 'bracing' });
  if (withCardio) add(move.cardio, { sets: 1, repsOrTime: '8–12m', restSec: 0, notes: 'easy pace' });
  return out.map((e, i) => ({ ...e, seq: i + 1 }));
};

// Convert AIPlan (blocks/items) into WorkoutPlan-like shape for WorkoutPlanDetail
const aiToWorkoutPlan = (ai: AIPlan, p: Prefs) => {
  const days = ai.days.map((d, i) => {
    const focus = d.focus || d.title || 'Full-Body';
    const exs = genExercisesForDay(focus, p).map(({ name, sets, repsOrTime, restSec, notes, seq }) => ({ name, sets, repsOrTime, restSec, notes, seq }));
    return { dayOrder: i + 1, focus, warmup: '5–8m warm-up', cooldown: '3–5m cooldown', exercises: exs };
  });
  return {
    title: ai.summary?.slice(0, 80) || `พรีเซ็ต • ${p.daysPerWeek}d x ${p.minutesPerSession}m (${p.level})`,
    goal: p.goal,
    daysPerWeek: p.daysPerWeek,
    minutesPerSession: p.minutesPerSession,
    equipment: p.equipment,
    level: p.level,
    addCardio: p.addCardio,
    addCore: p.addCore,
    addMobility: p.addMobility,
    days,
  } as any;
};

// ====== AI Wrappers ======
const wrapTextAsPlan = (
  text: string,
  fallbackDays: PreviewDay[],
  weeklyMinutes: number,
  weeklyKcal: number,
  prefs: Prefs
): AIPlan => ({
  summary: text.trim(),
  week_minutes: weeklyMinutes,
  week_kcal: weeklyKcal,
  days: fallbackDays.map((d) => ({
    title: `${d.day} — ${d.focus}`,
    focus: d.focus,
    blocks: designExercises(prefs, d.focus, Math.max(30, prefs.minutesPerSession)),
    notes: 'ปรับเซ็ต/เรป/น้ำหนักตามระดับและเวลาจริง',
  })),
  tips: ['จดบันทึกหลังซ้อม', 'เพิ่มภาระทีละน้อย (progressive overload)'],
});

const callAI = async (
  apiUrl: string,
  token: string,
  prefs: Prefs,
  previewDays: PreviewDay[],
  weeklyMinutes: number,
  weeklyKcal: number
): Promise<any> => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // 1) AI plan เต็ม
  try {
    const r1 = await fetch(`${apiUrl}/api/ai/workout-plan`, { method: 'POST', headers, body: JSON.stringify(prefs) });
    if (r1.status === 401) throw new Error('AUTH_EXPIRED');
    const j1 = await r1.json().catch(() => null);
    if (j1 && typeof j1 === 'object') {
      // If backend returned a persisted workout plan (with exercises), just return it
      if (Array.isArray((j1 as any).days) && (j1 as any).days.length && (j1 as any).days[0]?.exercises) {
        return j1;
      }
      if ((j1 as any).ok === false) throw new Error((j1 as any)?.error?.reason || 'AI_FAILED');
      let out: AIPlan | null = null;
      if ((j1 as any).plan) out = (j1 as any).plan as AIPlan;
      else if (typeof (j1 as any).text === 'string') out = wrapTextAsPlan((j1 as any).text, previewDays, weeklyMinutes, weeklyKcal, prefs);
      if (!out) {
        const txt = JSON.stringify(j1);
        out = wrapTextAsPlan(txt, previewDays, weeklyMinutes, weeklyKcal, prefs);
      }
      return ensurePlanHasExercises(out!, prefs);
    }
    const txt1 = await r1.text().catch(() => '');
    return ensurePlanHasExercises(wrapTextAsPlan(txt1, previewDays, weeklyMinutes, weeklyKcal, prefs), prefs);
  } catch (e: any) {
    if (e?.message === 'AUTH_EXPIRED') throw e;
    // 2) suggest → wrap
    try {
      const r2 = await fetch(`${apiUrl}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(prefs) });
      if (r2.status === 401) throw new Error('AUTH_EXPIRED');
      const t2 = await r2.text();
      try {
        const j = JSON.parse(t2);
        const out = j?.plan as AIPlan | undefined;
        if (out) return ensurePlanHasExercises(out, prefs);
        const text = j?.text || t2;
        return ensurePlanHasExercises(wrapTextAsPlan(String(text), previewDays, weeklyMinutes, weeklyKcal, prefs), prefs);
      } catch {
        return ensurePlanHasExercises(wrapTextAsPlan(t2, previewDays, weeklyMinutes, weeklyKcal, prefs), prefs);
      }
    } catch (e2: any) {
      throw new Error(e2?.message || 'AI_UNAVAILABLE');
    }
  }
};

// ====== MINI UI ======
const Section = ({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) => (
  <View style={styles.card}>
    <Text style={styles.section}>{title}</Text>
    {note ? <Text style={styles.note}>{note}</Text> : null}
    {children}
  </View>
);

const Pill = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
  <TouchableOpacity
    style={[styles.pill, active && styles.pillActive]}
    onPress={() => { haptic('light'); onPress(); }}
    activeOpacity={0.9}
  >
    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
  </TouchableOpacity>
);

// ====== EXTRA COMPONENTS ======
function CoachQuickAsk({ token, prefs, onApplied }: { token: string | null; prefs: Prefs; onApplied?: (text: string) => void; }) {
  const [text, setText] = useState('อยากเน้นก้น+ไหล่ แต่มีเวลา 35 นาที ทำไงดี?');
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState('');

  const quicks = [
    'ไม่มีเบนช์วันนี้ ช่วยสลับท่าให้หน่อย',
    'เข่าเจ็บเล็กน้อย หลีกเลี่ยงท่าไหนและแทนด้วยอะไร',
    'คาร์ดิโอแค่ 15 นาทีพอไหม ปรับแผนยังไง',
  ];

  const ask = async (prompt?: string) => {
    try {
      if (!token) throw new Error('AUTH');
      setLoading(true); setAnswer('');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const body = { ...prefs, __coach_prompt: prompt || text, __mode: 'coach-ask' };
      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (res.status === 401) throw new Error('AUTH');
      const t = await res.text();
      try { const j = JSON.parse(t); setAnswer(j.text || j.plan?.summary || ''); } catch { setAnswer(t.trim()); }
    } catch (e: any) {
      if (e?.message === 'AUTH') return Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนถามโค้ช');
      setAnswer('ขออภัย เอไอไม่ตอบสนอง ลองใหม่อีกครั้ง');
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.coachCard}>
      <Text style={styles.previewTitle}>ถามโค้ช (AI)</Text>
      <View style={styles.askRow}>
        <TextInput value={text} onChangeText={setText} placeholder="พิมพ์คำถามสั้น ๆ ถึงโค้ช" style={styles.askInput} />
        <TouchableOpacity style={styles.askBtn} onPress={() => ask()} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.askBtnText}>ถาม</Text>}
        </TouchableOpacity>
      </View>
      <View style={styles.quickRow}>
        {quicks.map((q, i) => (
          <TouchableOpacity key={i} style={styles.quickChip} onPress={() => ask(q)}>
            <Text style={styles.quickChipText}>{q}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!!answer && (
        <View style={styles.answerBox}>
          {answer.split('\n').map((ln, i) => (<Text key={i} style={styles.answerText}>{ln}</Text>))}
          {onApplied && (
            <TouchableOpacity style={[styles.cta, { marginTop: 10 }]} onPress={() => { onApplied(answer); haptic('success'); Alert.alert('นำไปใช้แล้ว', 'ระบบจะปรับในแผนที่สร้างถัดไป'); }}>
              <Text style={styles.ctaText}>นำข้อเสนอไปใช้</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function PlanDiffCard({ token, basePrefs }: { token: string | null; basePrefs: Prefs; }) {
  const [loading, setLoading] = useState(false);
  const [diffText, setDiffText] = useState('');

  const runWhatIf = async (delta: Partial<Prefs>, label: string) => {
    try {
      if (!token) throw new Error('AUTH');
      setLoading(true); setDiffText('');
      const next = { ...basePrefs, ...delta } as Prefs;
      const weeklyMinutes = calcWeeklyMinutesFrom(next);
      const weeklyKcal = calcWeeklyBurnKcalFrom(next);

      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const prompt = `อธิบายความต่างของแผนถ้า ${label} โดยสรุป bullet สั้น ๆ (ไทย) และเน้นผลต่อเวลารวม/การเผาผลาญ/โฟกัสกล้ามเนื้อ`;
      const body = { ...next, __mode: 'what-if', __coach_prompt: prompt };
      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(body) });
      const t = await res.text();
      let ai = ''; try { const j = JSON.parse(t); ai = j.text || j.plan?.summary || ''; } catch { ai = t.trim(); }
      setDiffText(`• เวลารวม/สัปดาห์ ≈ ${weeklyMinutes} นาที\n• ประมาณเผาผลาญ ≈ ${weeklyKcal} kcal/สัปดาห์\n${ai ? `\n${ai}` : ''}`);
      haptic('light');
    } catch (e: any) {
      if (e?.message === 'AUTH') return Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนใช้งาน What-if');
      setDiffText('ไม่สามารถคำนวณ What-if ได้');
    } finally { setLoading(false); }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.section}>What-if (ลองปรับแล้วดูผล)</Text>
      <View style={styles.rowWrap}>
        <TouchableOpacity style={styles.quickChip} onPress={() => runWhatIf({ minutesPerSession: 30 }, 'ลดเวลาต่อครั้งเหลือ 30 นาที')}>
          <Text style={styles.quickChipText}>เวลาเหลือ 30 นาที</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickChip} onPress={() => runWhatIf({ daysPerWeek: 5 }, 'เพิ่มวันที่ฝึกเป็น 5 วัน/สัปดาห์')}>
          <Text style={styles.quickChipText}>เพิ่มเป็น 5 วัน</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickChip} onPress={() => runWhatIf({ equipment: 'none' }, 'ไม่มีอุปกรณ์เลย')}>
          <Text style={styles.quickChipText}>ไม่มีอุปกรณ์</Text>
        </TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator /> : !!diffText && (
        <View style={styles.answerBox}>
          {diffText.split('\n').map((ln, i) => (<Text key={i} style={styles.answerText}>{ln}</Text>))}
        </View>
      )}
    </View>
  );
}

function ExplainWhySheet({ visible, onClose, token, prefs }: { visible: boolean; onClose: () => void; token: string | null; prefs: Prefs; }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');

  const runExplain = useCallback(async () => {
    try {
      if (!token) throw new Error('AUTH');
      setLoading(true); setText('');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const body = { ...prefs, __mode: 'explain', __coach_prompt: 'อธิบายว่าแผนนี้เหมาะกับผู้ใช้ยังไง แบบ bullet ไทย สั้น กระชับ' };
      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(body) });
      const t = await res.text();
      try { const j = JSON.parse(t); setText(j.text || j.plan?.summary || ''); } catch { setText(t.trim()); }
    } catch (e: any) {
      if (e?.message === 'AUTH') return Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนดูคำอธิบาย');
      setText('เอไอไม่ตอบสนอง ลองใหม่อีกครั้ง');
    } finally { setLoading(false); }
  }, [token, prefs]);

  useEffect(() => { if (visible) runExplain(); }, [visible, runExplain]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.title}>ทำไมแผนนี้ถึงใช่?</Text>
          <TouchableOpacity onPress={onClose}><Text style={styles.linkText}>ปิด</Text></TouchableOpacity>
        </View>
        <View style={styles.card}>
          {loading ? <ActivityIndicator /> : (
            <View>
              {text.split('\n').map((ln, i) => (<Text key={i} style={styles.answerText}>{ln}</Text>))}
            </View>
          )}
        </View>
      </ScrollView>
    </Modal>
  );
}

function SafetyScanCard({ token, prefs }: { token: string | null; prefs: Prefs }) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');

  const scan = async () => {
    try {
      if (!token) throw new Error('AUTH');
      setLoading(true); setText('');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const body = { ...prefs, __mode: 'safety', __coach_prompt: 'สแกนความเสี่ยงของแผน (มือใหม่), ปักธงท่าเสี่ยงหลังล่าง/ไหล่, แนะนำฟอร์ม/ทางเลือก' };
      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(body) });
      const t = await res.text();
      try { const j = JSON.parse(t); setText(j.text || j.plan?.summary || ''); } catch { setText(t.trim()); }
      haptic('light');
    } catch (e: any) {
      if (e?.message === 'AUTH') return Alert.alert('ต้องล็อกอิน', 'กรุณาล็อกอินก่อนตรวจความปลอดภัย');
      setText('ตรวจไม่สำเร็จ');
    } finally { setLoading(false); }
  };

  return (
    <View style={[styles.card, { borderColor: '#c7d2fe', backgroundColor: '#eef2ff' }]}> 
      <Text style={styles.section}>Safety Check (ความปลอดภัย)</Text>
      <TouchableOpacity style={styles.cta} onPress={scan} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>สแกนความเสี่ยงด้วย AI</Text>}
      </TouchableOpacity>
      {!!text && (
        <View style={styles.answerBox}>
          {text.split('\n').map((ln, i) => (
            <Text key={i} style={[styles.answerText, { color: '#3730a3' }]}>{ln}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ====== MAIN SCREEN ======
export default function WorkoutProgram() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loading, setLoading] = useState(false);
  const [hasCachedPlan, setHasCachedPlan] = useState(false);
  const [displayName, setDisplayName] = useState<string>('คุณ');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [showAIPreview, setShowAIPreview] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showExplain, setShowExplain] = useState(false);

  useEffect(() => {
    // ===== Self-tests (ไม่แตะ UI/Network) =====
    try {
      const t1: Prefs = { ...defaultPrefs };
      console.assert(calcWeeklyMinutesFrom(t1) === t1.daysPerWeek * t1.minutesPerSession + t1.daysPerWeek * 5, 'calcWeeklyMinutesFrom ผิด');
      const kcal = calcWeeklyBurnKcalFrom({ ...t1, addCardio: false });
      console.assert(Number.isFinite(kcal) && kcal > 0, 'calcWeeklyBurnKcalFrom ผิด');
    } catch {}

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PREF_KEY);
        if (raw) setPrefs(prev => ({ ...prev, ...JSON.parse(raw) }));

        const tk = await AsyncStorage.getItem(AUTH_KEY); setToken(tk);

        const meRaw = await AsyncStorage.getItem(ME_CACHE_KEY);
        if (meRaw) {
          const me = JSON.parse(meRaw);
          const name = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim() || me?.username || 'คุณ';
          setDisplayName(name);
        }
        const cached = await AsyncStorage.getItem(PLAN_CACHE_KEY);
        setHasCachedPlan(!!cached);
      } catch {}
    })();
  }, []);

  const savePrefs = useCallback(async (next: Prefs) => {
    setPrefs(next);
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify(next));
  }, []);

  const splitLabel = useMemo(() => {
    if (prefs.daysPerWeek === 3) return 'Full-Body x3';
    if (prefs.daysPerWeek === 4) return prefs.goal === 'build_muscle' ? 'Upper/Lower x2' : 'FB/Push+Core/Pull+Cardio/Legs';
    return prefs.goal === 'build_muscle' ? 'Push/Pull/Legs/Upper/Lower' : 'FB/Push/Pull/Legs/Condition';
  }, [prefs.daysPerWeek, prefs.goal]);

  const previewDays: PreviewDay[] = useMemo(() => {
    const base = new Array(prefs.daysPerWeek).fill(null).map((_, i) => ({ day: `Day ${i + 1}`, focus: 'Full-Body' }));
    if (prefs.daysPerWeek === 4) return [
      { day: 'Day 1', focus: 'Upper' }, { day: 'Day 2', focus: 'Lower' }, { day: 'Day 3', focus: 'Upper' }, { day: 'Day 4', focus: 'Lower' },
    ];
    if (prefs.daysPerWeek === 5) return prefs.goal === 'build_muscle'
      ? [
        { day: 'Day 1', focus: 'Push (อก/ไหล่/หลังแขน)' },
        { day: 'Day 2', focus: 'Pull (หลัง/หน้าท้อง/หน้าแขน)' },
        { day: 'Day 3', focus: 'Legs (ขา/สะโพก)' },
        { day: 'Day 4', focus: 'Upper (บน)' },
        { day: 'Day 5', focus: 'Lower (ล่าง)' },
      ]
      : [
        { day: 'Day 1', focus: 'Full-Body' }, { day: 'Day 2', focus: 'Push' }, { day: 'Day 3', focus: 'Pull' }, { day: 'Day 4', focus: 'Legs' }, { day: 'Day 5', focus: 'Conditioning/Cardio' },
      ];
    return base;
  }, [prefs.daysPerWeek, prefs.goal]);

  const weeklyMinutes = useMemo(() => (
    prefs.daysPerWeek * prefs.minutesPerSession + (prefs.addMobility ? prefs.daysPerWeek * 5 : 0)
  ), [prefs]);

  const weeklyBurnKcal = useMemo(() => {
    const levelFactor = prefs.level === 'advanced' ? 10 : prefs.level === 'intermediate' ? 8 : 6;
    const base = weeklyMinutes * levelFactor;
    return Math.round(base * (1 + (prefs.addCardio ? 0.15 : 0)));
  }, [weeklyMinutes, prefs.level, prefs.addCardio]);

  const intensityTag = useMemo(() => {
    const m = prefs.minutesPerSession;
    const lvl = prefs.level;
    const score = m / 60 + (lvl === 'advanced' ? 1 : lvl === 'intermediate' ? 0.6 : 0.3) + (prefs.addCardio ? 0.3 : 0);
    if (score >= 1.5) return { text: 'เข้มข้นสูง', color: '#ef4444' } as const;
    if (score >= 1.0) return { text: 'ปานกลาง', color: '#f59e0b' } as const;
    return { text: 'เบาถึงปานกลาง', color: '#10b981' } as const;
  }, [prefs.minutesPerSession, prefs.level, prefs.addCardio]);

  const change = <K extends keyof Prefs>(k: K, v: Prefs[K]) => savePrefs({ ...prefs, [k]: v });

  const presetApply = (preset: Partial<Prefs>) => {
    const next = { ...prefs, ...preset } as Prefs;
    savePrefs(next);
    haptic('light');
  };

  const createPlan = async () => {
    try {
      setLoading(true);
      const tk = await AsyncStorage.getItem(AUTH_KEY);
      if (!tk) { Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนสร้างแพลน'); router.replace('/(tabs)/login'); return; }
      let plan: any = null;
      try {
        plan = await callAI(API_URL, tk, prefs, previewDays, weeklyMinutes, weeklyBurnKcal);
        // If came back as WorkoutPlan (with exercises), save directly
        if (plan && Array.isArray(plan.days) && plan.days[0]?.exercises) {
          await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(plan));
          haptic('success');
          router.push('/(tabs)/WorkoutPlanDetail');
          return;
        }
        // Else it's AIPlan (blocks). Ensure items and convert for WorkoutPlanDetail
        const ensured = ensurePlanHasExercises(plan as AIPlan, prefs);
        const workoutLike = aiToWorkoutPlan(ensured, prefs);
        await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(workoutLike));
        haptic('success');
        router.push('/(tabs)/WorkoutPlanDetail');
        return;
      } catch (aiErr: any) {
        // fallback deterministic
        const r = await fetch(`${API_URL}/api/workout/plan`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(prefs),
        });
        if (!r.ok) {
          const reason = aiErr?.message || `HTTP ${r.status}`; const txt = await r.text().catch(() => '');
          throw new Error(`AI ล้มเหลวและ fallback ก็ไม่สำเร็จ\n• สาเหตุ: ${reason}${txt ? `\n• รายละเอียด: ${txt}` : ''}`);
        }
        const pj = await r.json();
        // Classic endpoint returns WorkoutPlan — save directly
        if (pj && Array.isArray(pj.days) && pj.days[0]?.exercises) {
          await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(pj));
        } else {
          // As a last resort, synthesize exercises from previewDays
          const synth = {
            title: `พรีเซ็ต • ${prefs.daysPerWeek}d x ${prefs.minutesPerSession}m (${prefs.level})`,
            goal: prefs.goal,
            daysPerWeek: prefs.daysPerWeek,
            minutesPerSession: prefs.minutesPerSession,
            equipment: prefs.equipment,
            level: prefs.level,
            addCardio: prefs.addCardio,
            addCore: prefs.addCore,
            addMobility: prefs.addMobility,
            days: previewDays.map((d, i) => ({
              dayOrder: i + 1,
              focus: d.focus,
              warmup: '5–8m warm-up',
              cooldown: '3–5m cooldown',
              exercises: genExercisesForDay(d.focus, prefs),
            })),
          } as any;
          await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(synth));
        }
        haptic('success');
        router.push('/(tabs)/WorkoutPlanDetail');
        return;
      }
    } catch (e: any) {
      if (String(e?.message).includes('AUTH_EXPIRED')) {
        await AsyncStorage.removeItem(AUTH_KEY);
        Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
        router.replace('/(tabs)/login');
        return;
      }
      Alert.alert('สร้างแพลนไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const previewWithAI = async () => {
    try {
      setAiLoading(true); setAiText(null); setShowAIPreview(true);
      const tk = await AsyncStorage.getItem(AUTH_KEY);
      if (!tk) { setShowAIPreview(false); Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนใช้งาน AI'); router.replace('/(tabs)/login'); return; }
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` };
      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, { method: 'POST', headers, body: JSON.stringify(prefs) });
      if (res.status === 401) { await AsyncStorage.removeItem(AUTH_KEY); setShowAIPreview(false); Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่'); router.replace('/(tabs)/login'); return; }
      const rawText = await res.text();
      try { const j = JSON.parse(rawText); setAiText(j.text || j.plan?.summary || 'ไม่พบข้อความจาก AI'); }
      catch { setAiText(rawText?.trim() || 'ไม่พบข้อความจาก AI'); }
    } catch (e: any) { setAiText(`โหมดออฟไลน์: ${e?.message ?? 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}`); }
    finally { setAiLoading(false); }
  };

  const loadLastPlan = async () => {
    const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return Alert.alert('ยังไม่มีแผนล่าสุด', 'กรุณาสร้างแพลนก่อน');
    router.push('/(tabs)/WorkoutPlanDetail');
  };

  const resetPrefs = async () => { await savePrefs(defaultPrefs); };

  const sharePreview = async () => {
    const text = `พรีวิวแผนของฉัน\nSplit: ${splitLabel}\nเวลารวม/สัปดาห์: ${weeklyMinutes} นาที\nประมาณเผาผลาญ: ${weeklyBurnKcal} kcal/สัปดาห์`;
    try { await Share.share({ message: text }); } catch {}
  };

  // ====== RENDER ======
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* HERO */}
      <View style={styles.hero}>
        <Text style={styles.heroHi}>🤖 AI Coach</Text>
        <Text style={styles.heroTitle}>สวัสดี {displayName}</Text>
        <Text style={styles.heroSub}>ให้ AI โค้ชวางแผนที่พอดีกับเวลาจริงของคุณ</Text>
        <View style={styles.heroBadges}>
          <View style={[styles.badge, { backgroundColor: intensityTag.color + '22', borderColor: intensityTag.color }]}>
            <Text style={[styles.badgeText, { color: intensityTag.color }]}>ความเข้มข้น: {intensityTag.text}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#22c55e22', borderColor: '#22c55e' }]}>
            <Text style={[styles.badgeText, { color: '#16a34a' }]}>เวลา/สัปดาห์ {weeklyMinutes} นาที</Text>
          </View>
        </View>
      </View>

      {/* SMART PRESETS */}
      <Section title="พรีเซ็ตเร็ว" note="แตะครั้งเดียวเพื่อปรับค่าสำคัญให้เหมาะกับเป้าหมาย">
        <View style={styles.rowWrap}>
          <TouchableOpacity style={styles.quickChip} onPress={() => presetApply({ goal: 'lose_weight', addCardio: true, minutesPerSession: 45 })}>
            <Text style={styles.quickChipText}>ลดไขมันเร็ว</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickChip} onPress={() => presetApply({ goal: 'build_muscle', level: 'intermediate', daysPerWeek: 5, equipment: 'fullGym' })}>
            <Text style={styles.quickChipText}>เพิ่มกล้าม (จริงจัง)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickChip} onPress={() => presetApply({ goal: 'general_fitness', minutesPerSession: 30, daysPerWeek: 3, equipment: 'minimal' })}>
            <Text style={styles.quickChipText}>กลับเข้าฟอร์ม 30 วัน</Text>
          </TouchableOpacity>
        </View>
      </Section>

      {/* GOAL */}
      <Section title="เป้าหมาย" note="เลือกเป้าหมายหลักเพื่อปรับโฟกัสของแพลน">
        <View style={styles.rowWrap}>
          <Pill label="ลดน้ำหนัก" active={prefs.goal === 'lose_weight'} onPress={() => change('goal', 'lose_weight')} />
          <Pill label="เพิ่มกล้ามเนื้อ" active={prefs.goal === 'build_muscle'} onPress={() => change('goal', 'build_muscle')} />
          <Pill label="รักษารูปร่าง" active={prefs.goal === 'maintain_shape'} onPress={() => change('goal', 'maintain_shape')} />
          <Pill label="ฟิตเนสทั่วไป" active={prefs.goal === 'general_fitness'} onPress={() => change('goal', 'general_fitness')} />
        </View>
      </Section>

      {/* DAYS */}
      <Section title="จำนวนวันต่อสัปดาห์" note="เลือกให้เหมาะกับตารางชีวิต (3=พื้นฐาน, 4=บาลานซ์, 5=จริงจัง)">
        <View style={styles.rowWrap}>
          {[3, 4, 5].map((n) => (
            <Pill key={n} label={`${n} วัน`} active={prefs.daysPerWeek === n} onPress={() => change('daysPerWeek', n as Days)} />
          ))}
        </View>
        <Text style={styles.helper}>Split ที่คาดไว้: <Text style={styles.bold}>{splitLabel}</Text></Text>
      </Section>

      {/* DURATION */}
      <Section title="เวลาต่อครั้ง" note="รวมวอร์มอัพและคูลดาวน์คร่าว ๆ">
        <View style={styles.rowWrap}>
          {[30, 45, 60].map((n) => (
            <Pill key={n} label={`${n} นาที`} active={prefs.minutesPerSession === n} onPress={() => change('minutesPerSession', n as Minutes)} />
          ))}
        </View>
      </Section>

      {/* EQUIPMENT */}
      <Section title="อุปกรณ์" note="อุปกรณ์มากขึ้น → ความหลากหลายสูงขึ้น">
        <View style={styles.rowWrap}>
          <Pill label="ไม่มีอุปกรณ์" active={prefs.equipment === 'none'} onPress={() => change('equipment', 'none')} />
          <Pill label="อุปกรณ์น้อย" active={prefs.equipment === 'minimal'} onPress={() => change('equipment', 'minimal')} />
          <Pill label="ฟูลยิม" active={prefs.equipment === 'fullGym'} onPress={() => change('equipment', 'fullGym')} />
        </View>
      </Section>

      {/* LEVEL */}
      <Section title="เลเวล" note="RIR/เวลาพักต่างกันตามประสบการณ์">
        <View style={styles.rowWrap}>
          <Pill label="มือใหม่" active={prefs.level === 'beginner'} onPress={() => change('level', 'beginner')} />
          <Pill label="กลาง" active={prefs.level === 'intermediate'} onPress={() => change('level', 'intermediate')} />
          <Pill label="สูง" active={prefs.level === 'advanced'} onPress={() => change('level', 'advanced')} />
        </View>
      </Section>

      {/* Injuries / Restrictions */}
      <Section title="อาการบาดเจ็บ/ข้อจำกัด" note="ระบบจะหลีกเลี่ยงท่าที่เสี่ยงและเลือกทางเลือกให้">
        <View style={styles.rowWrap}>
          {['knee','shoulder','lower_back','wrist','elbow'].map((inj) => (
            <Pill
              key={inj}
              label={inj === 'knee' ? 'เข่า' : inj === 'shoulder' ? 'ไหล่' : inj === 'lower_back' ? 'หลังล่าง' : inj === 'wrist' ? 'ข้อมือ' : 'ข้อศอก'}
              active={Array.isArray(prefs.injuries) && prefs.injuries.includes(inj)}
              onPress={() => {
                const cur = new Set(prefs.injuries || []);
                cur.has(inj) ? cur.delete(inj) : cur.add(inj);
                change('injuries', Array.from(cur));
              }}
            />
          ))}
        </View>
        <Text style={styles.helper}>ท่าที่อยากหลีกเลี่ยง (คั่นด้วยจุลภาค):</Text>
        <TextInput
          value={(prefs.restrictedMoves || []).join(', ')}
          onChangeText={(v) => {
            const arr = v.split(',').map(s => s.trim()).filter(Boolean);
            change('restrictedMoves', arr);
          }}
          placeholder="เช่น Squat, Overhead Press, Deadlift"
          style={[styles.askInput, { marginTop: 6 }]}
        />
      </Section>

      {/* Intensity Mode */}
      <Section title="ความหนักของแผน (Intensity)" note="มีผลต่อ เรป/เวลาพัก/จำนวนเซ็ต">
        <View style={styles.rowWrap}>
          <Pill label="หนัก" active={prefs.intensityMode === 'heavy'} onPress={() => change('intensityMode','heavy')} />
          <Pill label="ปานกลาง" active={(prefs.intensityMode || 'medium') === 'medium'} onPress={() => change('intensityMode','medium')} />
          <Pill label="เบา" active={prefs.intensityMode === 'light'} onPress={() => change('intensityMode','light')} />
        </View>
      </Section>

      {/* PREVIEW BADGES */}
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>พรีวิวแพลนคร่าว ๆ</Text>
        <Text style={styles.previewSub}>Split: <Text style={styles.bold}>{splitLabel}</Text></Text>
        <Text style={styles.previewSub}>เวลารวม/สัปดาห์: <Text style={styles.bold}>{weeklyMinutes}</Text> นาที</Text>
        <Text style={styles.previewSub}>ประมาณเผาผลาญ: <Text style={styles.bold}>{weeklyBurnKcal}</Text> kcal/สัปดาห์</Text>
        <View style={styles.previewDays}>
          {previewDays.map((d, i) => (
            <View key={i} style={styles.dayBox}>
              <Text style={styles.dayTitle}>{d.day}</Text>
              <Text style={styles.dayFocus}>{d.focus}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TouchableOpacity style={styles.secondaryMini} onPress={() => setShowExplain(true)}>
            <Text style={styles.secondaryMiniText}>Why this plan?</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryMini} onPress={sharePreview}>
            <Text style={styles.secondaryMiniText}>แชร์พรีวิว</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.previewTiny}>* ตัวเลขเป็นการประมาณเพื่อการตัดสินใจ</Text>
      </View>

      {/* AI QUICK ASK */}
      <CoachQuickAsk token={token} prefs={prefs} onApplied={() => { /* flag state if you want */ }} />

      {/* WHAT-IF DIFF */}
      <PlanDiffCard token={token} basePrefs={prefs} />

      {/* SAFETY SCAN */}
      <SafetyScanCard token={token} prefs={prefs} />

      {/* ACTIONS */}
      <TouchableOpacity style={[styles.cta, aiLoading && { opacity: 0.7 }]} disabled={aiLoading} onPress={previewWithAI}>
        {aiLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>⚡ AI พรีวิวทันที</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.cta, loading && { opacity: 0.7 }]} disabled={loading} onPress={createPlan}>
        <Text style={styles.ctaText}>{loading ? 'กำลังสร้างแพลน...' : '✨ สร้างแพลนแบบละเอียด'}</Text>
      </TouchableOpacity>

      {hasCachedPlan && (
        <TouchableOpacity style={styles.secondary} onPress={loadLastPlan}>
          <Text style={styles.secondaryText}>ดูแพลนล่าสุดที่สร้างไว้</Text>
        </TouchableOpacity>
      )}

      <View style={styles.rowCenter}>
        <TouchableOpacity style={styles.linkBtn} onPress={resetPrefs}>
          <Text style={styles.linkText}>รีเซ็ตค่าเริ่มต้น</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.replace('/(tabs)/HomeScreen')}>
          <Text style={styles.linkText}>‹ กลับหน้า Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={() => router.push('/(tabs)/ExerciseLibrary')}>
          <Text style={styles.linkText}>คลังท่าออกกำลังกาย</Text>
        </TouchableOpacity>
      </View>

      {/* AI Preview Modal */}
      <Modal visible={showAIPreview} animationType="slide" presentationStyle="pageSheet">
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={[styles.title, { marginBottom: 0 }]}>🤖 พรีวิวโดย AI</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={() => setShowAIPreview(false)}>
              <Text style={styles.linkText}>ปิด</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>สรุปพรีวิว</Text>
            <Text style={styles.previewSub}>Split: <Text style={styles.bold}>{splitLabel}</Text></Text>
            <Text style={styles.previewSub}>เวลารวม/สัปดาห์: <Text style={styles.bold}>{weeklyMinutes}</Text> นาที</Text>
            <Text style={styles.previewSub}>ประมาณเผาผลาญ: <Text style={styles.bold}>{weeklyBurnKcal}</Text> kcal/สัปดาห์</Text>
            <View style={styles.previewDays}>
              {previewDays.map((d, i) => (
                <View key={i} style={styles.dayBox}>
                  <Text style={styles.dayTitle}>{d.day}</Text>
                  <Text style={styles.dayFocus}>{d.focus}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>ข้อเสนอแนะจาก AI</Text>
            {aiLoading ? (
              <ActivityIndicator />
            ) : (
              <View>
                {(aiText || '').split('\n').map((line, i) => (
                  <Text key={i} style={{ color: '#374151', marginTop: 2 }}>{line}</Text>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={[styles.cta, (loading || aiLoading) && { opacity: 0.7 }]} disabled={loading || aiLoading} onPress={createPlan}>
            <Text style={styles.ctaText}>{loading ? 'กำลังสร้างแพลน...' : 'ยืนยันและสร้างแพลน'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => setShowAIPreview(false)}>
            <Text style={styles.secondaryText}>ยกเลิก/แก้ไขพรีเซ็ต</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* Explain Why Sheet */}
      <ExplainWhySheet visible={showExplain} onClose={() => setShowExplain(false)} token={token} prefs={prefs} />
    </ScrollView>
  );
}

// ====== STYLES ======
const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32, backgroundColor: '#F8F8F8' },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 6, color: '#111' },
  subtitle: { color: '#6b7280', marginBottom: 12 },

  hero: {
    backgroundColor: '#f5f3ff',
    borderColor: '#ddd6fe',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  heroHi: { color: '#6d28d9', fontWeight: '800' },
  heroTitle: { color: '#1f2937', fontSize: 22, fontWeight: '900', marginTop: 2 },
  heroSub: { color: '#374151', marginTop: 2 },
  heroBadges: { flexDirection: 'row', gap: 8, marginTop: 8 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  section: { fontWeight: '800', marginBottom: 6, color: '#111' },
  note: { color: '#6b7280', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  pill: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' },
  pillActive: { backgroundColor: '#8b5cf6', borderColor: '#7c3aed' },
  pillText: { color: '#374151', fontWeight: '700' },
  pillTextActive: { color: '#fff' },

  badge: { alignSelf: 'flex-start', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  badgeText: { fontWeight: '800' },
  helper: { marginTop: 8, color: '#374151' },
  bold: { fontWeight: '800', color: '#111' },

  previewCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 12 },
  previewTitle: { fontWeight: '800', color: '#111', marginBottom: 4 },
  previewSub: { color: '#374151', marginTop: 2 },
  previewDays: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  dayBox: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, padding: 10, backgroundColor: '#fafafa', minWidth: 140 },
  dayTitle: { fontWeight: '800', color: '#111' },
  dayFocus: { color: '#374151', marginTop: 2, fontSize: 12 },
  previewTiny: { marginTop: 8, color: '#9ca3af', fontSize: 12 },

  cta: { backgroundColor: '#8b5cf6', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 6 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  secondary: { alignItems: 'center', marginTop: 10 },
  secondaryText: { color: '#6b7280', fontWeight: '700' },
  rowCenter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 8 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 6 },
  linkText: { color: '#6b7280', fontWeight: '700' },

  // Quick Ask
  coachCard: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', padding: 12, marginBottom: 12 },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  askInput: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#111' },
  askBtn: { backgroundColor: '#8b5cf6', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10 },
  askBtnText: { color: '#fff', fontWeight: '800' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  quickChip: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  quickChipText: { color: '#374151', fontWeight: '700' },
  answerBox: { marginTop: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fafafa', borderRadius: 10, padding: 10 },
  answerText: { color: '#374151', marginTop: 2 },

  secondaryMini: { borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  secondaryMiniText: { color: '#374151', fontWeight: '700' },
});
