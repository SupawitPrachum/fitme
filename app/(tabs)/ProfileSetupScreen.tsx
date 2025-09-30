// app/(tabs)/ProfileSetupScreen.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNPickerSelect from 'react-native-picker-select';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { API_BASE_URL } from '@/constants/api';
import { getToken, clearToken } from '@/hooks/use-auth';

// ===== Inline auth helpers (moved to hook) =====

// ===== API Base =====
const API_URL = API_BASE_URL;
const PREF_KEY = 'workout_plan_prefs_v2';
const PLAN_CACHE_KEY = 'last_workout_plan_v1';

type MeResponse = {
  id: number;
  username: string;
  first_name: string | null;
  last_name: string | null;
  gender: 'male' | 'female' | '' | null;
  date_of_birth?: string | null;
  email: string;
  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
};

const exerciseTypeItems = [
  { label: 'ลดน้ำหนัก', value: 'lose_weight' },
  { label: 'เพิ่มกล้ามเนื้อ', value: 'build_muscle' },
  { label: 'รักษาสุขภาพ', value: 'maintain_health' },
  { label: 'ฟิตเนสทั่วไป', value: 'general_fitness' },
];
const activityLevelItems = [
  { label: 'นั่งทำงาน', value: 'sedentary' },
  { label: 'ออกกำลังกายเบาๆ', value: 'light_activity' },
  { label: 'ออกกำลังกายปานกลาง', value: 'moderate_activity' },
  { label: 'ออกกำลังกายหนัก', value: 'intense_activity' },
  { label: 'งานหนักมาก', value: 'very_intense' },
];
const goalItems = [
  { label: 'ลดน้ำหนัก', value: 'lose_weight' },
  { label: 'เพิ่มมวลกล้ามเนื้อ', value: 'build_muscle' },
  { label: 'รักษารูปร่าง', value: 'maintain_shape' },
];

const calcAge = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return String(age);
};

const ProfileSetupScreen: React.FC = () => {
  const [token, setToken] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [age, setAge] = useState<string>('');
  const [gender, setGender] = useState<'male' | 'female' | ''>('');
  const [email, setEmail] = useState('');

  const [exerciseType, setExerciseType] = useState<string>('');
  const [activityLevel, setActivityLevel] = useState<string>('');
  const [weight, setWeight] = useState<string>('');       // kg
  const [height, setHeight] = useState<string>('');       // cm
  const [waterGoal, setWaterGoal] = useState<string>(''); // L (auto-calculated)
  const [healthCondition, setHealthCondition] = useState<string>('');
  const [goal, setGoal] = useState<string>('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<1|2>(1);

  // Plan prefs (Step 2)
  type Days = 3|4|5;
  type Minutes = 30|45|60;
  type Equip = 'none' | 'minimal' | 'fullGym';
  type Level = 'beginner' | 'intermediate' | 'advanced';
  type GoalPref  = 'lose_weight' | 'build_muscle' | 'maintain_shape' | 'general_fitness';

  const [planDays, setPlanDays] = useState<Days>(3);
  const [planMinutes, setPlanMinutes] = useState<Minutes>(45);
  const [planEquip, setPlanEquip] = useState<Equip>('minimal');
  const [planLevel, setPlanLevel] = useState<Level>('beginner');
  const [planGoal, setPlanGoal] = useState<GoalPref>('general_fitness');
  const [planAddCardio, setPlanAddCardio] = useState(true);
  const [planAddCore, setPlanAddCore] = useState(true);
  const [planAddMobility, setPlanAddMobility] = useState(true);

  // โหลด token ครั้งแรก และถ้าไม่มีให้เด้งกลับหน้า login
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await getToken();
      if (!alive) return;

      if (!t) {
        setToken(''); // ปิด spinner
        router.replace('/(tabs)/login');
        return;
      }
      setToken(t);
    })();
    return () => { alive = false; };
  }, []);

  // รีเฟรชทุกครั้งที่กลับเข้าหน้า
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const t = await getToken();
        if (!t) {
          router.replace('/(tabs)/login');
          return;
        }
        setToken(t); // กระตุ้นให้ดึง /api/me อีกครั้ง
      })();
    }, [])
  );

  // ดึง /api/me เฉพาะเมื่อมี token จริง
  useEffect(() => {
    if (token === null || token === '') return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        };

        const res = await fetch(`${API_URL}/api/me`, { headers });
        if (res.status === 401) {
          await clearToken();
          setToken('');
          router.replace('/(tabs)/login');
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const me: MeResponse | null = await res.json();
        if (!mounted || !me) return;

        const fullName = [me.first_name, me.last_name].filter(Boolean).join(' ').trim() || me.username;
        setName(fullName);
        setAge(calcAge(me.date_of_birth));
        setGender((me.gender as any) ?? '');
        setEmail(me.email ?? '');

        setExerciseType(me.exercise_type ?? '');
        setActivityLevel(me.activity_level ?? '');
        setWeight(me.weight_kg != null ? String(me.weight_kg) : '');
        setHeight(me.height_cm != null ? String(me.height_cm) : '');
        setWaterGoal(me.water_goal_l != null ? String(me.water_goal_l) : '');
        setHealthCondition(me.health_condition ?? '');
        setGoal(me.goal ?? '');

        // load plan prefs if any
        try {
          const raw = await AsyncStorage.getItem(PREF_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            if (p.daysPerWeek) setPlanDays(p.daysPerWeek);
            if (p.minutesPerSession) setPlanMinutes(p.minutesPerSession);
            if (p.equipment) setPlanEquip(p.equipment);
            if (p.level) setPlanLevel(p.level);
            if (p.goal) setPlanGoal(p.goal);
            if (typeof p.addCardio === 'boolean') setPlanAddCardio(p.addCardio);
            if (typeof p.addCore === 'boolean') setPlanAddCore(p.addCore);
            if (typeof p.addMobility === 'boolean') setPlanAddMobility(p.addMobility);
          }
        } catch {}
      } catch (err: any) {
        router.push(
          `/(tabs)/SaveResult?ok=0&title=ดึงข้อมูลไม่สำเร็จ&message=${encodeURIComponent(err?.message ?? 'Unknown error')}`
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [token]);

  const numericOrEmpty = (s: string) => s === '' || !isNaN(Number(s));

  // คำนวณปริมาณน้ำดื่มอัตโนมัติจากน้ำหนักและระดับกิจกรรม
  useEffect(() => {
    const w = Number(weight);
    if (!isFinite(w) || w <= 0) {
      // ถ้าไม่ทราบน้ำหนัก ให้เว้นว่างไว้
      setWaterGoal('');
      return;
    }
    // base: ~0.033 ลิตร/กก.
    const base = w * 0.033;
    // บวกเพิ่มตามกิจกรรม
    const addMap: Record<string, number> = {
      sedentary: 0.0,
      light_activity: 0.3,
      moderate_activity: 0.6,
      intense_activity: 1.0,
      very_intense: 1.3,
    };
    const add = addMap[activityLevel] ?? 0.3;
    let liters = base + add;
    // จำกัดช่วงที่เหมาะสม
    liters = Math.max(1.5, Math.min(liters, 5.0));
    const next = (Math.round(liters * 10) / 10).toFixed(1);
    if (next !== waterGoal) setWaterGoal(next);
  }, [weight, activityLevel]);
  const isValid = useMemo(() => {
    return (
      !!exerciseType &&
      !!activityLevel &&
      !!goal &&
      numericOrEmpty(weight) &&
      numericOrEmpty(height) &&
      numericOrEmpty(waterGoal) &&
      (weight === '' || Number(weight) >= 0) &&
      (height === '' || Number(height) >= 0) &&
      (waterGoal === '' || Number(waterGoal) >= 0)
    );
  }, [exerciseType, activityLevel, goal, weight, height, waterGoal]);

  const handleSubmit = async () => {
    if (!isValid) {
      router.push('/(tabs)/SaveResult?ok=0&title=ตรวจสอบข้อมูล&message=กรอกข้อมูลให้ครบถ้วนและตัวเลขต้องถูกต้อง');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        exercise_type: exerciseType || null,
        activity_level: activityLevel || null,
        weight_kg: weight === '' ? null : Number(weight),
        height_cm: height === '' ? null : Number(height),
        water_goal_l: waterGoal === '' ? null : Number(waterGoal),
        health_condition: healthCondition || null,
        goal: goal || null,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const res = await fetch(`${API_URL}/api/me/profile`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        await clearToken();
        setToken('');
        router.push('/(tabs)/SaveResult?ok=0&title=หมดเวลา&message=กรุณาล็อกอินใหม่');
        return;
      }

      if (!res.ok) {
        let serverMsg = '';
        try {
          const data = await res.json();
          serverMsg = data?.error || data?.message || '';
        } catch {
          serverMsg = await res.text().catch(() => '');
        }
        const message = serverMsg || `HTTP ${res.status}`;
        throw new Error(message);
      }

      // สำเร็จ: ไป Step 2 ตั้งค่าแผน
      setStep(2);
    } catch (err: any) {
      const msg = encodeURIComponent(err?.message ?? 'Unknown error');
      router.push(`/(tabs)/SaveResult?ok=0&title=บันทึกไม่สำเร็จ&message=${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const savePlanPrefs = async () => {
    const prefs = {
      daysPerWeek: planDays,
      minutesPerSession: planMinutes,
      equipment: planEquip,
      level: planLevel,
      goal: planGoal,
      addCardio: planAddCardio,
      addCore: planAddCore,
      addMobility: planAddMobility,
    };
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    return prefs;
  };

  const createPlan = async () => {
    try {
      setSaving(true);
      const t = await getToken();
      if (!t) {
        router.replace('/(tabs)/login');
        return;
      }
      const prefs = await savePlanPrefs();
      const res = await fetch(`${API_URL}/api/workout/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify(prefs),
      });
      if (res.status === 401) {
        await clearToken();
        setToken('');
        router.push('/(tabs)/SaveResult?ok=0&title=หมดเวลา&message=กรุณาล็อกอินใหม่');
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const plan = await res.json();
      await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(plan));
      router.replace('/(tabs)/WorkoutPlanDetail');
    } catch (e:any) {
      const msg = encodeURIComponent(e?.message ?? 'Unknown error');
      router.push(`/(tabs)/SaveResult?ok=0&title=สร้างแพลนไม่สำเร็จ&message=${msg}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading || token === null) {
    return (
      <View style={[styles.container, { flex: 1, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 12 }}>กำลังโหลดข้อมูล...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>ตั้งค่าข้อมูลและแผนเริ่มต้น</Text>
        <View style={{ flexDirection:'row', gap:8, marginBottom:8 }}>
          <View style={[styles.dot, step>=1 && styles.dotActive]} />
          <View style={[styles.dot, step>=2 && styles.dotActive]} />
        </View>

        {step === 1 && (
        <>
        {/* ===== ข้อมูลส่วนตัว (อ่านอย่างเดียว) ===== */}
        <Text style={styles.sectionLabel}>ข้อมูลส่วนตัว</Text>
        <TextInput style={[styles.input, styles.readonly]} value={name} editable={false} placeholder="ชื่อ" />
        <TextInput style={[styles.input, styles.readonly]} value={age} editable={false} keyboardType="numeric" placeholder="อายุ" />
        <View style={{ opacity: 0.6 }}>
          <RNPickerSelect
            style={pickerStyles}
            value={gender}
            onValueChange={() => {}}
            disabled
            useNativeAndroidPickerStyle={false}
            placeholder={{ label: 'เลือกเพศ', value: null }}
            items={[
              { label: 'ชาย', value: 'male' },
              { label: 'หญิง', value: 'female' },
            ]}
          />
        </View>
        <TextInput style={[styles.input, styles.readonly]} value={email} editable={false} placeholder="อีเมล" autoCapitalize="none" />

        {/* ===== การออกกำลังกาย ===== */}
        <Text style={styles.sectionLabel}>การออกกำลังกาย</Text>
        <RNPickerSelect
          style={pickerStyles}
          placeholder={{ label: 'เลือกประเภทการออกกำลังกาย', value: null }}
          value={exerciseType}
          onValueChange={setExerciseType}
          useNativeAndroidPickerStyle={false}
          items={exerciseTypeItems}
        />
        <RNPickerSelect
          style={pickerStyles}
          placeholder={{ label: 'เลือกระดับกิจกรรม', value: null }}
          value={activityLevel}
          onValueChange={setActivityLevel}
          useNativeAndroidPickerStyle={false}
          items={activityLevelItems}
        />

        {/* ===== สุขภาพ ===== */}
        <Text style={styles.sectionLabel}>สุขภาพ</Text>
        <TextInput
          style={styles.input}
          placeholder="น้ำหนัก (กก.)"
          keyboardType="numeric"
          value={weight}
          onChangeText={(t) => { if (numericOrEmpty(t)) setWeight(t); }}
        />
        <TextInput
          style={styles.input}
          placeholder="ส่วนสูง (ซม.)"
          keyboardType="numeric"
          value={height}
          onChangeText={(t) => { if (numericOrEmpty(t)) setHeight(t); }}
        />
        <View>
          <TextInput
            style={[styles.input, styles.readonly]}
            placeholder="เป้าน้ำดื่ม/วัน (ลิตร) — คำนวณอัตโนมัติ"
            keyboardType="numeric"
            value={waterGoal}
            editable={false}
          />
          <Text style={{ color: '#666', marginTop: -8, marginBottom: 8, fontSize: 12 }}>
            ระบบคำนวณจากน้ำหนักและระดับกิจกรรม (ปรับค่าจาก 1.5–5.0 ลิตร/วัน)
          </Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="ปัญหาสุขภาพพิเศษ (ถ้ามี)"
          value={healthCondition}
          onChangeText={setHealthCondition}
        />

        {/* ===== เป้าหมาย ===== */}
        <Text style={styles.sectionLabel}>เป้าหมาย</Text>
        <RNPickerSelect
          style={pickerStyles}
          placeholder={{ label: 'เลือกเป้าหมาย', value: null }}
          value={goal}
          onValueChange={setGoal}
          useNativeAndroidPickerStyle={false}
          items={goalItems}
        />
        <View style={{ flexDirection:'row', gap:10 }}>
          <TouchableOpacity
            style={[styles.button, !isValid && styles.buttonDisabled, { flex:1 }]}
            onPress={handleSubmit}
            disabled={!isValid || saving}
          >
            {saving ? <ActivityIndicator /> : <Text style={styles.buttonText}>บันทึกและถัดไป</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, { backgroundColor:'#6b7280', flex:1 }]} onPress={()=>router.replace('/(tabs)/Homesrceen')} disabled={saving}>
            <Text style={styles.buttonText}>ข้าม</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />
        </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.sectionLabel}>ตั้งค่าแผนเริ่มต้น</Text>
            <Text style={{ color:'#6b7280', marginBottom:8 }}>เลือกตัวเลือกเพื่อสร้างโปรแกรมเริ่มต้นอัตโนมัติ</Text>

            <Text style={styles.sectionLabel}>เป้าหมาย</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 }}>
              {[
                {k:'lose_weight', l:'ลดน้ำหนัก'},
                {k:'build_muscle', l:'เพิ่มกล้ามเนื้อ'},
                {k:'maintain_shape', l:'รักษารูปร่าง'},
                {k:'general_fitness', l:'ฟิตเนสทั่วไป'},
              ].map(it => (
                <TouchableOpacity key={it.k} style={[styles.pill, (planGoal as any)===it.k && styles.pillActive]} onPress={()=>setPlanGoal(it.k as any)}>
                  <Text style={[styles.pillText, (planGoal as any)===it.k && styles.pillTextActive]}>{it.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>จำนวนวันต่อสัปดาห์</Text>
            <View style={{ flexDirection:'row', gap:8, marginBottom:8 }}>
              {[3,4,5].map(n => (
                <TouchableOpacity key={n} style={[styles.pill, planDays===n && styles.pillActive]} onPress={()=>setPlanDays(n as Days)}>
                  <Text style={[styles.pillText, planDays===n && styles.pillTextActive]}>{n} วัน</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>เวลาต่อครั้ง</Text>
            <View style={{ flexDirection:'row', gap:8, marginBottom:8 }}>
              {[30,45,60].map(n => (
                <TouchableOpacity key={n} style={[styles.pill, planMinutes===n && styles.pillActive]} onPress={()=>setPlanMinutes(n as Minutes)}>
                  <Text style={[styles.pillText, planMinutes===n && styles.pillTextActive]}>{n} นาที</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>อุปกรณ์</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 }}>
              {[
                {k:'none', l:'ไม่มีอุปกรณ์'},
                {k:'minimal', l:'อุปกรณ์น้อย'},
                {k:'fullGym', l:'ฟูลยิม'},
              ].map(it => (
                <TouchableOpacity key={it.k} style={[styles.pill, (planEquip as any)===it.k && styles.pillActive]} onPress={()=>setPlanEquip(it.k as any)}>
                  <Text style={[styles.pillText, (planEquip as any)===it.k && styles.pillTextActive]}>{it.l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>ตัวเลือกเสริม</Text>
            <View style={{ flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 }}>
              <TouchableOpacity style={[styles.pill, planAddCardio && styles.pillActive]} onPress={()=>setPlanAddCardio(v=>!v)}>
                <Text style={[styles.pillText, planAddCardio && styles.pillTextActive]}>คาร์ดิโอ: {planAddCardio?'เปิด':'ปิด'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pill, planAddCore && styles.pillActive]} onPress={()=>setPlanAddCore(v=>!v)}>
                <Text style={[styles.pillText, planAddCore && styles.pillTextActive]}>แกนกลาง: {planAddCore?'เปิด':'ปิด'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pill, planAddMobility && styles.pillActive]} onPress={()=>setPlanAddMobility(v=>!v)}>
                <Text style={[styles.pillText, planAddMobility && styles.pillTextActive]}>โมบิลิตี้: {planAddMobility?'เปิด':'ปิด'}</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection:'row', gap:10 }}>
              <TouchableOpacity style={[styles.button, { flex:1 }]} onPress={createPlan} disabled={saving}>
                {saving ? <ActivityIndicator /> : <Text style={styles.buttonText}>สร้างแพลน</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, { backgroundColor:'#6b7280', flex:1 }]} onPress={()=>router.replace('/(tabs)/Homesrceen')} disabled={saving}>
                <Text style={styles.buttonText}>ข้าม</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: '#f8f8f8' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  sectionLabel: { marginTop: 12, marginBottom: 8, fontWeight: '700' },
  input: {
    height: 44,
    borderColor: '#ccc',
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  readonly: { backgroundColor: '#eee' },
  button: {
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700' },
  dot:{ width:10, height:10, borderRadius:5, backgroundColor:'#ddd' },
  dotActive:{ backgroundColor:'#6366f1' },
  pill:{ paddingHorizontal:14, paddingVertical:10, borderRadius:999, backgroundColor:'#f3f4f6', borderWidth:1, borderColor:'#e5e7eb' },
  pillActive:{ backgroundColor:'#8b5cf6', borderColor:'#7c3aed' },
  pillText:{ color:'#374151', fontWeight:'700' },
  pillTextActive:{ color:'#fff' },
});
const pickerStyles = StyleSheet.create({
  inputIOS: {
    height: 44,
    borderColor: '#ccc',
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    color: 'black',
    backgroundColor: '#fff',
  },
  inputAndroid: {
    height: 44,
    borderColor: '#ccc',
    borderWidth: 1,
    marginBottom: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    color: 'black',
    backgroundColor: '#fff',
  },
  placeholder: { color: '#888' },
});

export default ProfileSetupScreen;
