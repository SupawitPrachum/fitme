// app/(tabs)/StartWorkout.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, TextInput, Linking, Animated, Easing } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
// removed set logging dependency to keep existing screen simple

const PLAN_CACHE_KEY = 'last_workout_plan_v1';

// ===== Types =====
type Exercise = {
  id?: number;
  seq?: number;
  name?: string;
  sets?: number | null;
  repsOrTime?: string | null; // e.g. "8–12" or "30s"
  restSec?: number | null;    // rest between sets (seconds)
  notes?: string | null;
};

type PlanDay = {
  id?: number;
  dayOrder?: number;
  focus?: string;
  warmup?: string;
  cooldown?: string;
  exercises?: Exercise[];
};

type ServerPlan = {
  id: number;
  title?: string;
  createdAt?: string;
  goal?: string;
  daysPerWeek?: number;
  minutesPerSession?: number;
  equipment?: string;
  level?: string;
  addCardio?: boolean;
  addCore?: boolean;
  addMobility?: boolean;
  days: PlanDay[];
};

// ===== How-To (ย่อ) =====
type HowToInfo = {
  cues: string[];
  safety?: string[];
  image?: any;
};

const HOW_TO: Record<string, HowToInfo> = {
  'Barbell Back Squat': {
    cues: ['บาร์บนสันบ่า', 'เท้ากว้างไหล่', 'เก็บแกนกลาง', 'ลงขนานพื้นแล้วดันขึ้น'],
    safety: ['หลังเป็นกลาง', 'ส้นเท้าติดพื้น', 'ใช้เซฟตี้ถ้าเล่นคนเดียว'],
  },
  'Dumbbell Goblet Squat': {
    cues: ['ถือดัมบ์เบลชิดอก', 'เข่าทิศเดียวกับปลายเท้า', 'คุมจังหวะ'],
    safety: ['อย่าหลังงอ'],
  },
  'Barbell Bench Press': {
    cues: ['สะบักแน่น', 'แตะอกแล้วดัน', 'เท้าวางมั่นคง'],
    safety: ['ควรมี spotter', 'อย่าแบะศอก 90°'],
  },
  'DB Bench Press': {
    cues: ['เก็บสะบัก', 'เส้นทางดัมบ์เบลแนวดิ่ง'],
    safety: ['อย่าปล่อยตกเร็ว'],
  },
  'Push-up': {
    cues: ['ลำตัวตรง', 'ศอก ~45°', 'ดันขึ้นจนสุดศอก'],
    safety: ['อย่าแอ่นหลัง'],
  },
  'Barbell Romanian Deadlift': {
    cues: ['ฮิปฮินจ์', 'บาร์ชิดขา', 'หลังเป็นกลาง'],
    safety: ['อย่าโค้งหลัง'],
  },
  'DB RDL': {
    cues: ['ฮิปฮินจ์', 'ดัมบ์เบลแนบลำตัว'],
    safety: ['โฟกัสหลังขา/ก้น'],
  },
  'Lat Pulldown / Pull-up': {
    cues: ['ศอกลงข้างลำตัว', 'อกนำ ไหล่ลง'],
    safety: ['อย่าเหวี่ยงแรง'],
  },
  'Plank': {
    cues: ['ลำตัวตรง เก็บท้องก้น', 'หายใจปกติ'],
    safety: ['หยุดถ้าปวดหลัง'],
  },
  'Dead Bug': {
    cues: ['หลังแนบพื้น', 'แขน-ขาตรงข้ามยืดช้าๆ'],
    safety: ['อย่าให้หลังแอ่น'],
  },
};

function getHowTo(name?: string): HowToInfo | undefined {
  if (!name) return undefined;
  if (HOW_TO[name]) return HOW_TO[name];
  const k = Object.keys(HOW_TO).find(x => name.toLowerCase().includes(x.toLowerCase()));
  return k ? HOW_TO[k] : undefined;
}

// ===== Timer/Set State =====
type Phase = 'idle' | 'work' | 'rest' | 'paused';
type Mode  = 'countdown' | 'stopwatch';

type ExState = {
  totalSets: number;
  currentSet: number;       // 1..totalSets (0 = ยังไม่เริ่ม)
  mode: Mode;
  targetSec?: number;       // สำหรับ countdown (เช่น 30s)
  restSec?: number;         // พักระหว่างเซ็ต
  phase: Phase;
  running: boolean;
  remaining: number;        // ถ้า countdown = เวลาที่เหลือ, stopwatch = เวลาที่นับขึ้น (วินาที)
  done: boolean;            // ทำครบทุกเซ็ตแล้ว
};

// ===== Session Log Types (Local persistence) =====
type SetEntry = {
  set: number;                // 1..N (หมายเลขเซ็ตที่จบ)
  completedAt: number;        // epoch millis
  mode: Mode;                 // ประเภทนับเวลา
  targetSec?: number;         // เป้าหมาย (กรณี countdown)
  actualSec?: number;         // เวลาจริงที่ทำได้ (กรณี stopwatch หรือจะเท่ากับ target สำหรับ countdown)
  weightKg?: number | null;   // น้ำหนักที่ใช้ (ถ้ามี)
};

type ExerciseEntry = {
  name: string;
  exerciseId?: number;
  seq?: number;
  setsPlanned: number;
  sets: SetEntry[];
};

type WorkoutSession = {
  id: string;                // key
  planId: number;
  dayId: number;
  dayOrder?: number;
  focus?: string;
  startedAt: number;
  finishedAt?: number;
  exercises: ExerciseEntry[]; // index ตรงกับ array exercises ของวัน (เท่าที่เป็นไปได้)
};

export default function StartWorkout() {
  const { planId: planIdStr, dayId: dayIdStr } = useLocalSearchParams<{ planId: string; dayId: string }>();
  const planId = Number(planIdStr);
  const dayId  = Number(dayIdStr);

  const [plan, setPlan] = useState<ServerPlan | null>(null);
  const [day, setDay]   = useState<PlanDay | null>(null);
  const [expandedHowTo, setExpandedHowTo] = useState<Record<number, boolean>>({});
  const [states, setStates] = useState<Record<number, ExState>>({});
  const [activeIdx, setActiveIdx] = useState<number | null>(null); // จำกัดทำงานทีละท่า
  // Session logging
  const sessionKeyRef = useRef<string | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showAi, setShowAi] = useState<Record<number, boolean>>({});
  const [weights, setWeights] = useState<Record<number, string>>({});
  const pulse = useRef(new Animated.Value(1)).current;

  // removed logging modal state

  // ใช้ ReturnType ของ setInterval เพื่อให้รองรับทั้ง RN/Web ได้ถูกต้อง
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // โหลดแผน
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
      if (!raw) {
        Alert.alert('ไม่พบแผน', 'กลับหน้าแผนแล้วลองใหม่อีกครั้ง');
        router.replace('/(tabs)/WorkoutPlanDetail');
        return;
      }
      try {
        const cached = JSON.parse(raw) as ServerPlan;
        if (cached?.id !== planId) {
          Alert.alert('แผนไม่ตรงกัน', 'กลับไปเลือกล่าสุดอีกครั้ง');
          router.replace('/(tabs)/WorkoutPlanDetail');
          return;
        }
        setPlan(cached);
        const d = cached.days?.find(x => x.id === dayId) || null;
        setDay(d);
        if (!d) {
          Alert.alert('ไม่พบวันในแผน', 'กลับหน้าแผนแล้วลองใหม่อีกครั้ง');
          router.replace('/(tabs)/WorkoutPlanDetail');
          return;
        }
        // init states per exercise
        const init: Record<number, ExState> = {};
        const initW: Record<number, string> = {};
        d.exercises?.forEach((e, idx) => {
          const totalSets = Math.max(1, Number(e.sets ?? 3));
          const parsedTime = parseSeconds(e.repsOrTime); // ถ้า "30s" => 30
          init[idx] = {
            totalSets,
            currentSet: 0,
            mode: typeof parsedTime === 'number' ? 'countdown' : 'stopwatch',
            targetSec: typeof parsedTime === 'number' ? parsedTime : undefined,
            restSec: typeof e.restSec === 'number' ? e.restSec : undefined,
            phase: 'idle',
            running: false,
            remaining: typeof parsedTime === 'number' ? parsedTime : 0,
            done: false,
          };
          // preload last weight if exists
          try {
            const key = `ex_w_${slug(e.name)}`;
            // @ts-ignore awaiting in loop intentionally for simplicity
            AsyncStorage.getItem(key).then(v => {
              if (v) setWeights(w => ({ ...w, [idx]: v }));
            });
          } catch {}
        });
        setStates(init);
        setWeights(initW);
      } catch {
        Alert.alert('ข้อมูลผิดรูปแบบ', 'กลับหน้าแผนแล้วลองใหม่อีกครั้ง');
        router.replace('/(tabs)/WorkoutPlanDetail');
      }
    })();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [planId, dayId]);

  // Pulse animation during rest
  const isResting = activeIdx!=null && states[activeIdx]?.phase === 'rest';
  useEffect(() => {
    if (isResting) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.2, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isResting]);

  // ฟังก์ชันแปลง "xxs" → seconds
  function parseSeconds(repsOrTime?: string | null): number | undefined {
    if (!repsOrTime) return undefined;
    const m = String(repsOrTime).trim().match(/^(\d+)\s*s$/i);
    if (!m) return undefined;
    const sec = Number(m[1]);
    return Number.isFinite(sec) ? sec : undefined;
  }

  function fmtTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // เดินเครื่อง timer ทีละท่า
  function stopInterval() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }

  // ===== Session helpers (local log) =====
  function d2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
  function ymd(d: Date) { return `${d.getFullYear()}-${d2(d.getMonth()+1)}-${d2(d.getDate())}`; }
  function makeSessionKey(pid: number, did: number, d: Date = new Date()) {
    return `workout_session_v1:${pid}:${did}:${ymd(d)}`;
  }

  async function ensureSession(): Promise<string> {
    if (sessionKeyRef.current) return sessionKeyRef.current;
    const key = makeSessionKey(planId, dayId);
    try {
      const existing = await AsyncStorage.getItem(key);
      if (!existing) {
        const payload: WorkoutSession = {
          id: key,
          planId,
          dayId,
          dayOrder: day?.dayOrder,
          focus: day?.focus,
          startedAt: Date.now(),
          exercises: (day?.exercises || []).map((e, idx) => ({
            name: e.name || `Exercise ${idx+1}`,
            exerciseId: e.id,
            seq: e.seq ?? (idx+1),
            setsPlanned: Math.max(1, Number(e.sets ?? 1)),
            sets: [],
          })),
        };
        await AsyncStorage.setItem(key, JSON.stringify(payload));
        // maintain index (latest first, cap 100)
        try {
          const idxRaw = await AsyncStorage.getItem('workout_sessions_idx_v1');
          const idxArr: string[] = idxRaw ? JSON.parse(idxRaw) : [];
          if (!idxArr.includes(key)) {
            idxArr.unshift(key);
            await AsyncStorage.setItem('workout_sessions_idx_v1', JSON.stringify(idxArr.slice(0, 100)));
          }
        } catch {}
      }
    } catch {}
    sessionKeyRef.current = key;
    setSessionStarted(true);
    return key;
  }

  async function updateSession(mutator: (s: WorkoutSession) => WorkoutSession | void) {
    const key = await ensureSession();
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw) as WorkoutSession;
      const out = (mutator(data) || data) as WorkoutSession;
      await AsyncStorage.setItem(key, JSON.stringify(out));
    } catch {}
  }

  async function logSetCompletion(exIdx: number, st: ExState) {
    try {
      const key = await ensureSession();
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw) as WorkoutSession;
      const w = parseFloat(weights[exIdx] ?? '');
      const weight = Number.isFinite(w) ? w : null;
      const entry: SetEntry = {
        set: Math.min(st.currentSet + 1, st.totalSets),
        completedAt: Date.now(),
        mode: st.mode,
        targetSec: st.targetSec,
        actualSec: st.mode === 'countdown' ? (st.targetSec ?? undefined) : (st.remaining || undefined),
        weightKg: weight,
      };
      if (!Array.isArray(data.exercises)) data.exercises = [];
      if (!data.exercises[exIdx]) {
        const e = day?.exercises?.[exIdx];
        data.exercises[exIdx] = {
          name: e?.name || `Exercise ${exIdx+1}`,
          exerciseId: e?.id,
          seq: e?.seq ?? (exIdx+1),
          setsPlanned: Math.max(1, Number(e?.sets ?? 1)),
          sets: [],
        };
      }
      data.exercises[exIdx].sets.push(entry);
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }

  async function markSessionFinished() {
    try {
      await updateSession((s) => { if (!s.finishedAt) s.finishedAt = Date.now(); });
    } catch {}
  }

  function startWork(idx: number) {
    if (!sessionStarted) { try { ensureSession(); } catch {} }
    setStates(prev => {
      const cur = prev[idx];
      if (!cur || cur.done) return prev;

      // หยุดตัวที่กำลังทำงานอยู่ตัวอื่นก่อน
      stopInterval();
      const nextAll: typeof prev = {};
      Object.keys(prev).forEach(k => {
        const i = Number(k);
        const s = prev[i];
        nextAll[i] = { ...s, running: false, phase: i === idx ? s.phase : (s.phase === 'work' ? 'paused' : s.phase) };
      });

      const s0 = nextAll[idx];
      const next: ExState = {
        ...s0,
        phase: 'work',
        running: true,
        // ถ้าเป็น countdown และอยู่ว่างๆ ให้ตั้งค่ากลับไป targetSec
        remaining: s0.mode === 'countdown'
          ? (s0.remaining > 0 && s0.remaining <= (s0.targetSec ?? 0) ? s0.remaining : (s0.targetSec ?? 0))
          : s0.remaining, // stopwatch นับต่อ (ถ้าอยากรีเซ็ตใช้ปุ่มรีเซ็ต)
      };
      nextAll[idx] = next;

      // Haptics: เริ่มทำงาน
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}

      // เริ่ม interval
      setActiveIdx(idx);
      intervalRef.current = setInterval(() => {
        setStates(p2 => {
          const st = p2[idx];
          if (!st || !st.running) return p2;

          if (st.phase === 'work') {
            if (st.mode === 'countdown') {
              const rem = st.remaining - 1;
              if (rem <= 0) {
                try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
                // จบงาน 1 เซ็ต อัตโนมัติ
                return onSetCompleteInternal(p2, idx);
              }
              return { ...p2, [idx]: { ...st, remaining: rem } };
            } else { // stopwatch
              return { ...p2, [idx]: { ...st, remaining: st.remaining + 1 } };
            }
          } else if (st.phase === 'rest') {
            const rem = (st.remaining ?? 0) - 1;
            if (rem <= 0) {
              // จบพัก → พร้อมเริ่ม work เซ็ตถัดไป (ยังไม่เดินอัตโนมัติจนกด Start อีกครั้ง)
              stopInterval();
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
              return {
                ...p2,
                [idx]: { ...st, phase: 'idle', running: false, remaining: st.mode === 'countdown' ? (st.targetSec ?? 0) : 0 },
              };
            }
            return { ...p2, [idx]: { ...st, remaining: rem } };
          }
          return p2;
        });
      }, 1000);

      return nextAll;
    });
  }

  function pause(idx: number) {
    stopInterval();
    setActiveIdx(null);
    setStates(prev => {
      const s = prev[idx];
      if (!s) return prev;
      return { ...prev, [idx]: { ...s, running: false, phase: 'paused' } };
    });
  }

  function reset(idx: number) {
    stopInterval();
    setActiveIdx(null);
    setStates(prev => {
      const s = prev[idx];
      if (!s) return prev;
      return {
        ...prev,
        [idx]: {
          ...s,
          currentSet: 0,
          phase: 'idle',
          running: false,
          remaining: s.mode === 'countdown' ? (s.targetSec ?? 0) : 0,
          done: false,
        },
      };
    });
  }

  function manualSetComplete(idx: number) {
    // สำหรับท่าที่เป็น stopwatch (rep-based)
    setStates(prev => onSetCompleteInternal(prev, idx));
  }

  function onSetCompleteInternal(prev: Record<number, ExState>, idx: number) {
    const s = prev[idx];
    if (!s) return prev;

    const nextSet = s.currentSet + 1;
    const isLast = nextSet >= s.totalSets;

    // หยุด interval ชั่วคราว
    stopInterval();
    setActiveIdx(null);

    // บันทึกเซ็ตที่เพิ่งเสร็จ
    logSetCompletion(idx, s).catch(()=>{});

    if (isLast) {
      // ครบทุกเซ็ต → done อัตโนมัติ
      const updated: ExState = {
        ...s,
        currentSet: s.totalSets,
        phase: 'idle',
        running: false,
        remaining: s.mode === 'countdown' ? (s.targetSec ?? 0) : 0,
        done: true,
      };
      const next = { ...prev, [idx]: updated };
      // ถ้าทุกท่า done → เด้งสำเร็จทั้งวัน
      if (allExercisesDone(next)) {
        try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
        setTimeout(() => {
          Alert.alert('เยี่ยมมาก! 🎉', 'ทำครบทุกท่าของวันนี้แล้ว', [
            { text: 'ตกลง', onPress: async () => {
              try {
                await markSessionFinished();
                await AsyncStorage.setItem('last_workout_done_v1', JSON.stringify({ planId, dayId, completedAt: Date.now() }));
              } catch {}
              router.replace('/(tabs)/Homesrceen');
            } },
          ]);
        }, 200);
      }
      return next;
    } else {
      // ยังไม่ใช่เซ็ตสุดท้าย → เข้าพักถ้ามี restSec, ไม่งั้นพร้อมเซ็ตถัดไป (idle)
      const hasRest = typeof s.restSec === 'number' && s.restSec > 0;
      const updated: ExState = {
        ...s,
        currentSet: nextSet,
        phase: hasRest ? 'rest' : 'idle',
        running: hasRest, // ถ้ามีพักให้วิ่งนับพักเลย
        remaining: hasRest ? s.restSec! : (s.mode === 'countdown' ? (s.targetSec ?? 0) : 0),
      };
      const next = { ...prev, [idx]: updated };

      if (hasRest) {
        // เริ่มนับพักทันที
        try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
        setActiveIdx(idx);
        intervalRef.current = setInterval(() => {
          setStates(pp => {
            const st = pp[idx];
            if (!st || !st.running || st.phase !== 'rest') return pp;
            const rem = st.remaining - 1;
            if (rem <= 0) {
              stopInterval();
              setActiveIdx(null);
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
              return {
                ...pp,
                [idx]: { ...st, phase: 'idle', running: false, remaining: st.mode === 'countdown' ? (st.targetSec ?? 0) : 0 },
              };
            }
            return { ...pp, [idx]: { ...st, remaining: rem } };
          });
        }, 1000);
      }

      return next;
    }
  }

  function allExercisesDone(st: Record<number, ExState>) {
    return Object.values(st).every(s => s.done);
  }

  const planReady = !!plan && !!day;

  const allDone = useMemo(() => {
    return planReady ? Object.values(states).length > 0 && Object.values(states).every(s => s.done) : false;
  }, [states, planReady]);

  const finishToday = () => {
    if (!allDone) {
      Alert.alert('ยังไม่ครบ', 'ยังมีท่าที่ยังไม่ครบจำนวนเซ็ต');
      return;
    }
    Alert.alert('เยี่ยมมาก! 🎉', 'คุณทำครบทุกท่าของวันนี้แล้ว', [
      { text: 'ตกลง', onPress: async () => {
        try {
          await markSessionFinished();
          await AsyncStorage.setItem('last_workout_done_v1', JSON.stringify({ planId, dayId, completedAt: Date.now() }));
        } catch {}
        router.replace('/(tabs)/Homesrceen');
      } },
    ]);
  };

  if (!plan || !day) {
    return (
      <View style={styles.center}>
        <Text>กำลังโหลด...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:32 }}>
      <Text style={styles.title}>{plan.title ?? 'แผนการออกกำลังกาย'}</Text>
      <Text style={styles.meta}>Day {day.dayOrder} — {day.focus}</Text>
      {!!plan.goal && (
        <Text style={styles.metaLight}>
          {plan.goal} • {plan.daysPerWeek} วัน/สัปดาห์ • {plan.minutesPerSession} นาที/ครั้ง • {plan.equipment} • {plan.level}
        </Text>
      )}

      {day.warmup ? <Text style={[styles.hint,{marginTop:10}]}>🔥 วอร์มอัพ: {day.warmup}</Text> : null}

      <Text style={styles.section}>รายการท่า</Text>
      {day.exercises?.map((e, idx) => {
        const st = states[idx];
        const howto = getHowTo(e.name);
        const isOpen = !!expandedHowTo[idx];
        const timeLabel = st?.mode === 'countdown' ? fmtTime(st.remaining) : fmtTime(st?.remaining ?? 0);

        return (
          <View key={e.id ?? idx} style={[styles.exCard, st?.done && {opacity:0.6}]}>
            <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
              <Text style={styles.exTitle}>
                {(e.seq ?? idx + 1).toString().padStart(2,'0')}. {e.name}
              </Text>
              <View style={{alignItems:'flex-end'}}>
                <Text style={[styles.badge, st?.done && {backgroundColor:'#16a34a22', borderColor:'#16a34a', color:'#16a34a'}]}>
                  {st?.done ? '✓ เสร็จ' : `Set ${Math.max(1, st?.currentSet + 1)}/${st?.totalSets ?? e.sets ?? 1}`}
                </Text>
                <Text style={styles.timeText}>{timeLabel}</Text>
              </View>
            </View>

            <Text style={styles.exMeta}>
              {(e.sets ?? st?.totalSets) ? `${e.sets ?? st?.totalSets} เซ็ต` : '-'}
              {e.repsOrTime ? ` • ${e.repsOrTime}` : ''}
              {typeof e.restSec === 'number' ? ` • พัก ${e.restSec}s` : ''}
              {e.notes ? ` • ${e.notes}` : ''}
            </Text>

            {/* Controls */}
            <View style={styles.rowBtns}>
              {st?.running ? (
                <TouchableOpacity style={[styles.btn, styles.warnBtn]} onPress={()=>pause(idx)}>
                  <Text style={[styles.btnText, styles.warnText]}>หยุดชั่วคราว</Text>
                </TouchableOpacity>
              ) : (
                <>
                  {st?.phase === 'rest' ? (
                    <TouchableOpacity style={[styles.btn]} onPress={()=>startWork(idx)}>
                      <Text style={styles.btnText}>กำลังพัก… ({fmtTime(st.remaining)})</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.btn, styles.primaryBtn]}
                      onPress={()=>startWork(idx)}
                      disabled={st?.done}
                    >
                      <Text style={[styles.btnText, styles.primaryText]}>{st?.mode === 'countdown' ? 'เริ่มจับเวลา' : 'เริ่มนาฬิกา'}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <TouchableOpacity style={[styles.btn]} onPress={()=>reset(idx)}>
                <Text style={styles.btnText}>รีเซ็ต</Text>
              </TouchableOpacity>

              {st?.mode === 'stopwatch' && !st?.done && (
                <TouchableOpacity style={[styles.btn, styles.successBtn]} onPress={()=>manualSetComplete(idx)}>
                  <Text style={[styles.btnText, styles.successText]}>จบเซ็ต</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Quick Actions */}
            <View style={[styles.rowBtns,{marginTop:8}]}> 
              <TouchableOpacity style={styles.btn} onPress={()=>{
                const name = e.name || '';
                const key = Object.keys(VIDEO_LINKS).find(k => name.includes(k)) || name;
                const url = VIDEO_LINKS[key];
                if (url) Linking.openURL(url).catch(()=>Alert.alert('เปิดลิงก์ไม่ได้'));
                else Alert.alert('ไม่พบวิดีโอ', 'ท่านี้ยังไม่มีลิงก์วิดีโอ');
              }}>
                <Text style={styles.btnText}>วิดีโอสาธิต</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={()=>setShowAi(p=>({...p, [idx]: !p[idx]}))}>
                <Text style={styles.btnText}>{showAi[idx] ? 'ซ่อน AI Tips' : 'ดู AI Tips'}</Text>
              </TouchableOpacity>
            </View>

            {showAi[idx] && (
              <View style={styles.aiCard}>
                <Text style={styles.aiTitle}>AI Tips</Text>
                {(AI_TIPS[e.name || ''] || getHowTo(e.name)?.cues || ['โฟกัสฟอร์มให้ถูกต้อง คุมจังหวะ เพิ่มทีละน้อย 2–5% เมื่อผ่านเกณฑ์'])
                  .slice(0,3)
                  .map((t, k) => (<Text key={k} style={styles.aiTip}>• {t}</Text>))}
              </View>
            )}

            {/* Weight Suggestion */}
            <View style={styles.weightRow}>
              <Text style={styles.weightLabel}>น้ำหนัก (kg):</Text>
              <TextInput
                value={weights[idx] ?? ''}
                onChangeText={(v)=> setWeights(w=>({...w, [idx]: v}))}
                onBlur={async ()=>{ try { await AsyncStorage.setItem(`ex_w_${slug(e.name)}`, weights[idx] ?? ''); } catch {} }}
                keyboardType="numeric"
                placeholder="เช่น 40"
                style={styles.weightInput}
              />
              {(() => {
                const w = parseFloat(weights[idx] ?? '');
                if (!Number.isFinite(w) || w <= 0) return null;
                const lo = Math.round(w * 1.025 * 10) / 10;
                const hi = Math.round(w * 1.05 * 10) / 10;
                return <Text style={styles.suggestText}>แนะนำถัดไป: {lo}–{hi} kg</Text>;
              })()}
            </View>

            {/* Rest Pulse indicator */}
            {activeIdx === idx && st?.phase==='rest' && (
              <View style={{ marginTop:8, flexDirection:'row', alignItems:'center', gap:8 }}>
                <Animated.View style={[styles.pulseDot,{ transform:[{ scale: pulse }] }]} />
                <Text style={styles.hint}>กำลังพัก • เหลือ {fmtTime(st.remaining)}</Text>
              </View>
            )}

            {/* วิธีทำ */}
            <TouchableOpacity style={styles.howBtn} onPress={()=>setExpandedHowTo(p=>({...p, [idx]: !p[idx]}))}>
              <Text style={styles.howText}>{isOpen ? 'ซ่อนวิธีทำ' : 'วิธีทำอย่างถูกต้อง'}</Text>
            </TouchableOpacity>

            {isOpen && (
              <View style={styles.howBox}>
                {howto?.image ? <Image source={howto.image} style={styles.howImage} resizeMode="cover" /> : null}
                <Text style={styles.howHeader}>ขั้นตอน</Text>
                {(howto?.cues ?? ['โฟกัสฟอร์มให้ถูกต้อง คุมจังหวะทั้งขึ้นและลง']).map((c, i) => (
                  <Text key={i} style={styles.howBullet}>• {c}</Text>
                ))}
                {!!howto?.safety?.length && (
                  <>
                    <Text style={[styles.howHeader,{marginTop:8}]}>ข้อควรระวัง</Text>
                    {howto.safety.map((s, i)=>(
                      <Text key={i} style={[styles.howBullet,{color:'#b91c1c'}]}>• {s}</Text>
                    ))}
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}

      {day.cooldown ? <Text style={styles.hint}>🧊 คูลดาวน์: {day.cooldown}</Text> : null}

      <View style={{ flexDirection:'row', gap:10, marginTop:16 }}>
        <TouchableOpacity style={[styles.btn, styles.primaryBtn]} onPress={finishToday} disabled={!allDone}>
          <Text style={[styles.btnText, styles.primaryText]}>{allDone ? 'เสร็จสิ้นวันนี้' : 'ยังทำไม่ครบ'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={()=>router.replace('/(tabs)/WorkoutPlanDetail')}>
          <Text style={styles.btnText}>‹ กลับแผน</Text>
        </TouchableOpacity>
      </View>

      {/* removed logging modal */}
    </ScrollView>
  );
}

// ===== Simple AI Tips + Video Links =====
const AI_TIPS: Record<string, string[]> = {
  'Barbell Bench Press': ['คุม eccentric ~2 วินาที', 'กดเท้าแน่นพื้นเพื่อสร้างแรง'],
  'DB Bench Press': ['โค้งเส้นทางดัมบ์เบลเล็กน้อยรูปตัว V', 'ช่วงล่างช้า ช่วงบนเร็วพอดี'],
  'Barbell Back Squat': ['คุมลมหายใจ bracing ก่อนลง', 'ลงลึกพอแต่หลังเป็นกลาง'],
  'Dumbbell Goblet Squat': ['ศอกชี้ลงพื้นเพื่อรักษาลำตัวตั้งตรง'],
  'Barbell Romanian Deadlift': ['ฮิปฮินจ์ ดันสะโพกไปหลัง ไม่งอหลัง', 'รักษาบาร์ชิดขา'],
  'DB RDL': ['เก็บสะบักเบาๆ ยอมงอเข่าบ้างเพื่อโฟกัสหลังขา'],
  'Lat Pulldown / Pull-up': ['ศอกลงข้างลำตัว ไม่เหวี่ยง', 'ดึงจนหน้าอกนำเล็กน้อย'],
  'Plank': ['เก็บก้นและท้องเล็กน้อย ให้ตัวตรง'],
  'Dead Bug': ['หลังแนบพื้นตลอด', 'หายใจปกติ ไม่กลั้น'],
  'Reverse Lunge': ['ก้าวยาวพอให้เข่าไม่ล้ำปลายเท้า', 'ลงช้า คุมทรง'],
  'DB Reverse Lunge': ['ถือดัมบ์เบลทั้งสองข้าง รักษาลำตัวตั้งตรง'],
};

const VIDEO_LINKS: Record<string, string> = {
  'Barbell Bench Press': 'https://www.youtube.com/watch?v=gRVjAtPip0Y',
  'Dumbbell Goblet Squat': 'https://www.youtube.com/watch?v=6xwGFn-J_Qw',
  'Barbell Back Squat': 'https://www.youtube.com/watch?v=ultWZbUMPL8',
  'Barbell Romanian Deadlift': 'https://www.youtube.com/watch?v=2SHsk9AzdjA',
  'DB RDL': 'https://www.youtube.com/watch?v=1uDiW5--rAE',
  'Lat Pulldown / Pull-up': 'https://www.youtube.com/watch?v=CAwf7n6Luuc',
  'Plank': 'https://www.youtube.com/watch?v=BQu26ABuVS0',
  'Dead Bug': 'https://www.youtube.com/watch?v=gBY8dR6mDJk',
  'Reverse Lunge': 'https://www.youtube.com/watch?v=Z2n58m2i4jg',
  'DB Reverse Lunge': 'https://www.youtube.com/watch?v=Nv4uG5Ff8f8',
  'Barbell Row': 'https://www.youtube.com/watch?v=kBWAon7ItDw',
};

function slug(s?: string) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const styles = StyleSheet.create({
  center:{ flex:1, alignItems:'center', justifyContent:'center' },

  title:{ fontSize:20, fontWeight:'800', color:'#111' },
  meta:{ color:'#374151', marginTop:4 },
  metaLight:{ color:'#9ca3af', marginTop:2 },

  section:{ fontWeight:'800', marginTop:12, marginBottom:6, color:'#111' },
  hint:{ color:'#6b7280' },

  exCard:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e5e7eb', borderRadius:12, padding:12, marginBottom:10 },
  exTitle:{ fontWeight:'800', color:'#111' },
  exMeta:{ color:'#374151', marginTop:2 },

  rowBtns:{ flexDirection:'row', gap:8, marginTop:10 },

  btn:{ flex:1, backgroundColor:'#eef2ff', borderColor:'#c7d2fe', borderWidth:1, borderRadius:10, paddingVertical:10, alignItems:'center' },
  btnText:{ color:'#3730a3', fontWeight:'800' },
  primaryBtn:{ backgroundColor:'#8b5cf6', borderColor:'#7c3aed' },
  primaryText:{ color:'#fff' },
  warnBtn:{ backgroundColor:'#fee2e2', borderColor:'#fecaca' },
  warnText:{ color:'#991b1b', fontWeight:'800' },
  successBtn:{ backgroundColor:'#dcfce7', borderColor:'#bbf7d0' },
  successText:{ color:'#166534', fontWeight:'800' },

  badge:{ borderWidth:1, borderColor:'#e5e7eb', paddingHorizontal:8, paddingVertical:4, borderRadius:8, color:'#374151', fontWeight:'800' },
  timeText:{ color:'#111', fontWeight:'800', marginTop:2 },

  howBtn:{ marginTop:8, alignSelf:'flex-start', paddingVertical:6, paddingHorizontal:10, borderWidth:1, borderColor:'#c7d2fe', backgroundColor:'#eef2ff', borderRadius:10 },
  howText:{ color:'#3730a3', fontWeight:'800' },
  howBox:{ marginTop:8, borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, backgroundColor:'#fafafa' },
  howHeader:{ fontWeight:'800', color:'#111', marginBottom:4 },
  howBullet:{ color:'#374151', marginBottom:2 },
  howImage:{ width:'100%', height:160, borderRadius:8, marginBottom:8 },

  // removed modal styles
  aiCard:{ marginTop:8, borderWidth:1, borderColor:'#c7d2fe', backgroundColor:'#eef2ff', borderRadius:10, padding:10 },
  aiTitle:{ fontWeight:'800', color:'#3730a3', marginBottom:4 },
  aiTip:{ color:'#3730a3', marginBottom:2 },
  weightRow:{ flexDirection:'row', alignItems:'center', gap:8, marginTop:8, flexWrap:'wrap' },
  weightLabel:{ color:'#111', fontWeight:'700' },
  weightInput:{ width:90, borderWidth:1, borderColor:'#e5e7eb', borderRadius:8, paddingVertical:6, paddingHorizontal:8, backgroundColor:'#fafafa' },
  suggestText:{ color:'#374151', fontWeight:'700' },
  pulseDot:{ width:12, height:12, borderRadius:6, backgroundColor:'#ef4444' },
});
