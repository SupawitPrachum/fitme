// app/(tabs)/WorkoutProgram.tsx
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, Alert, Switch, Modal, ActivityIndicator
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const PREF_KEY = 'workout_plan_prefs_v2';
const PLAN_CACHE_KEY = 'last_workout_plan_v1';
const ME_CACHE_KEY = 'me_cache';
const API_URL = API_BASE_URL;

type Days    = 3|4|5;
type Minutes = 30|45|60;
type Equip   = 'none' | 'minimal' | 'fullGym';
type Level   = 'beginner' | 'intermediate' | 'advanced';
type Goal    = 'lose_weight' | 'build_muscle' | 'maintain_shape' | 'general_fitness';

type Prefs = {
  daysPerWeek: Days;
  minutesPerSession: Minutes;
  equipment: Equip;
  level: Level;
  goal: Goal;
  addCardio: boolean;
  addCore: boolean;
  addMobility: boolean;
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
};

const Section = ({ title, children, note }: {title: string; children: React.ReactNode; note?: string}) => (
  <View style={styles.card}>
    <Text style={styles.section}>{title}</Text>
    {note ? <Text style={styles.note}>{note}</Text> : null}
    {children}
  </View>
);

const Pill = ({ label, active, onPress }: {label:string; active:boolean; onPress:()=>void}) => (
  <TouchableOpacity style={[styles.pill, active && styles.pillActive]} onPress={onPress} activeOpacity={0.9}>
    <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
  </TouchableOpacity>
);

export default function WorkoutProgram() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loading, setLoading] = useState(false);
  const [hasCachedPlan, setHasCachedPlan] = useState(false);
  const [displayName, setDisplayName] = useState<string>('คุณ');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [showAIPreview, setShowAIPreview] = useState(false);

  // โหลดค่าที่เคยเลือก + ชื่อผู้ใช้สำหรับทักทาย + เช็คว่ามีแผนเก่าไหม
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PREF_KEY);
        if (raw) setPrefs(prev => ({ ...prev, ...JSON.parse(raw) }));

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

  // สรุป split โดยคร่าว ตาม daysPerWeek + goal
  const splitLabel = useMemo(() => {
    if (prefs.daysPerWeek === 3) return 'Full-Body x3';
    if (prefs.daysPerWeek === 4) {
      return prefs.goal === 'build_muscle' ? 'Upper/Lower x2' : 'FB/Push+Core/Pull+Cardio/Legs';
    }
    // 5 วัน
    return prefs.goal === 'build_muscle' ? 'Push/Pull/Legs/Upper/Lower' : 'FB/Push/Pull/Legs/Condition';
  }, [prefs.daysPerWeek, prefs.goal]);

  // พรีวิวชื่อวันและโฟกัสคร่าวๆ
  const previewDays = useMemo(() => {
    const base = new Array(prefs.daysPerWeek).fill(null).map((_, i) => ({ day: `Day ${i+1}`, focus: 'Full-Body' }));
    if (prefs.daysPerWeek === 4) {
      return [
        { day: 'Day 1', focus: 'Upper' },
        { day: 'Day 2', focus: 'Lower' },
        { day: 'Day 3', focus: 'Upper' },
        { day: 'Day 4', focus: 'Lower' },
      ];
    }
    if (prefs.daysPerWeek === 5) {
      return prefs.goal === 'build_muscle'
        ? [
            { day: 'Day 1', focus: 'Push (อก/ไหล่/หลังแขน)' },
            { day: 'Day 2', focus: 'Pull (หลัง/หน้าท้อง/หน้าแขน)' },
            { day: 'Day 3', focus: 'Legs (ขา/สะโพก)' },
            { day: 'Day 4', focus: 'Upper (บน)' },
            { day: 'Day 5', focus: 'Lower (ล่าง)' },
          ]
        : [
            { day: 'Day 1', focus: 'Full-Body' },
            { day: 'Day 2', focus: 'Push' },
            { day: 'Day 3', focus: 'Pull' },
            { day: 'Day 4', focus: 'Legs' },
            { day: 'Day 5', focus: 'Conditioning/Cardio' },
          ];
    }
    return base;
  }, [prefs.daysPerWeek, prefs.goal]);

  // ประมาณเวลา/สัปดาห์ + เผาผลาญคร่าวๆ (แค่ช่วยให้เห็นภาพ)
  const weeklyMinutes = useMemo(() => prefs.daysPerWeek * prefs.minutesPerSession + (prefs.addMobility ? prefs.daysPerWeek * 5 : 0), [prefs]);
  const weeklyBurnKcal = useMemo(() => {
    // ค่าประมาณหยาบ: ยิ่งเวลามาก/เลเวลสูง/คาร์ดิโอเปิด → เผาผลาญมาก
    const levelFactor = prefs.level === 'advanced' ? 10 : prefs.level === 'intermediate' ? 8 : 6;
    const cardioBonus = prefs.addCardio ? 0.15 : 0;
    const base = weeklyMinutes * levelFactor;
    return Math.round(base * (1 + cardioBonus));
  }, [weeklyMinutes, prefs.level, prefs.addCardio]);

  const intensityTag = useMemo(() => {
    const m = prefs.minutesPerSession;
    const lvl = prefs.level;
    const score = (m/60) + (lvl === 'advanced' ? 1 : lvl === 'intermediate' ? 0.6 : 0.3) + (prefs.addCardio ? 0.3 : 0);
    if (score >= 1.5) return { text: 'เข้มข้นสูง', color: '#ef4444' };
    if (score >= 1.0) return { text: 'ปานกลาง', color: '#f59e0b' };
    return { text: 'เบาถึงปานกลาง', color: '#10b981' };
  }, [prefs.minutesPerSession, prefs.level, prefs.addCardio]);

  const equipmentTips = useMemo(() => {
    if (prefs.equipment === 'none') return 'ท่าพื้นฐาน: Squat/Push-up/Lunge/Glute bridge/Plank/Skipping';
    if (prefs.equipment === 'minimal') return 'ดัมบ์เบล/ยางยืด/ดิปบาร์ → ดัน/ดึง/สควอต/ฮิปฮินจ์ครบ';
    return 'ครบเครื่อง: บาร์เบล/แมชีน/ดัมบ์เบล → ความหลากหลายสูง เพิ่ม progressive overload ได้ง่าย';
  }, [prefs.equipment]);

  const levelNotes = useMemo(() => {
    if (prefs.level === 'beginner') return 'แนะนำ RIR 2–3, พัก 60–90s, เน้นฟอร์มถูกต้อง';
    if (prefs.level === 'intermediate') return 'RIR 1–2, พัก 60–120s, เริ่มใส่ progressive overload ชัดเจน';
    return 'RIR 0–1 (บางเซ็ต), พัก 90–180s, periodization ชัด + เทคนิค advance ได้';
  }, [prefs.level]);

  const change = <K extends keyof Prefs>(k: K, v: Prefs[K]) => savePrefs({ ...prefs, [k]: v });

  const createPlan = async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนสร้างแพลน');
        router.replace('/(tabs)/login');
        return;
      }

      // Use AI endpoint by default; fallback to deterministic if needed
      let res = await fetch(`${API_URL}/api/ai/workout-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });

      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
        router.replace('/(tabs)/login');
        return;
      }
      if (!res.ok) {
        // fallback to classic endpoint
        res = await fetch(`${API_URL}/api/workout/plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(prefs),
        });
        if (!res.ok) {
          const txt = await res.text().catch(()=> '');
          throw new Error(txt || `HTTP ${res.status}`);
        }
      }
      const plan = await res.json();
      await AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(plan));
      router.push('/(tabs)/WorkoutPlanDetail');
    } catch (e:any) {
      Alert.alert('สร้างแพลนไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  const previewWithAI = async () => {
    try {
      setAiLoading(true);
      setAiText(null);
      setShowAIPreview(true);

      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        setShowAIPreview(false);
        Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบก่อนใช้งาน AI');
        router.replace('/(tabs)/login');
        return;
      }

      const res = await fetch(`${API_URL}/api/ai/workout-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });

      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        setShowAIPreview(false);
        Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
        router.replace('/(tabs)/login');
        return;
      }

      const raw = await res.json().catch(() => ({}));
      if (raw && typeof raw === 'object' && raw.ok === false) {
        const msg = raw?.error?.reason ? `AI error: ${raw.error.reason}` : 'ไม่สามารถสร้างจาก AI ได้';
        setAiText(msg);
        return;
      }
      if (typeof raw?.text === 'string') {
        setAiText(raw.text);
      } else if (typeof raw === 'string') {
        setAiText(raw);
      } else {
        setAiText('ไม่พบข้อความจาก AI');
      }
    } catch (e:any) {
      setAiText(`โหมดออฟไลน์: ${e?.message ?? 'เกิดข้อผิดพลาดในการเชื่อมต่อ'}`);
    } finally {
      setAiLoading(false);
    }
  };

  const loadLastPlan = async () => {
    const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) return Alert.alert('ยังไม่มีแผนล่าสุด', 'กรุณาสร้างแพลนก่อน');
    router.push('/(tabs)/WorkoutPlanDetail');
  };

  const resetPrefs = async () => {
    await savePrefs(defaultPrefs);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <Text style={styles.title}>สร้างแพลนการออกกำลังกาย</Text>
      <Text style={styles.subtitle}>สวัสดี {displayName} • ตั้งค่าด้านล่างแล้วกด “สร้างแพลน”</Text>

      {/* Goal */}
      <Section title="เป้าหมาย" note="เลือกเป้าหมายหลักเพื่อปรับโฟกัสของแพลน">
        <View style={styles.rowWrap}>
          <Pill label="ลดน้ำหนัก"    active={prefs.goal==='lose_weight'}       onPress={()=>change('goal','lose_weight')} />
          <Pill label="เพิ่มกล้ามเนื้อ" active={prefs.goal==='build_muscle'}     onPress={()=>change('goal','build_muscle')} />
          <Pill label="รักษารูปร่าง"  active={prefs.goal==='maintain_shape'}    onPress={()=>change('goal','maintain_shape')} />
          <Pill label="ฟิตเนสทั่วไป"  active={prefs.goal==='general_fitness'}   onPress={()=>change('goal','general_fitness')} />
        </View>
      </Section>

      {/* Frequency */}
      <Section title="จำนวนวันต่อสัปดาห์" note="เลือกให้เหมาะกับตารางชีวิต (3=พื้นฐาน, 4=บาลานซ์, 5=จริงจัง)">
        <View style={styles.row}>
          {[3,4,5].map(n => (
            <Pill key={n} label={`${n} วัน`} active={prefs.daysPerWeek===n} onPress={()=>change('daysPerWeek', n as Days)} />
          ))}
        </View>
        <Text style={styles.helper}>Split ที่คาดไว้: <Text style={styles.bold}>{splitLabel}</Text></Text>
      </Section>

      {/* Duration */}
      <Section title="เวลาต่อครั้ง" note="รวมวอร์มอัพและคูลดาวน์คร่าวๆ">
        <View style={styles.row}>
          {[30,45,60].map(n => (
            <Pill key={n} label={`${n} นาที`} active={prefs.minutesPerSession===n} onPress={()=>change('minutesPerSession', n as Minutes)} />
          ))}
        </View>
        <View style={[styles.badge, { backgroundColor: intensityTag.color+'22', borderColor: intensityTag.color }]}>
          <Text style={[styles.badgeText, { color: intensityTag.color }]}>ความเข้มข้น: {intensityTag.text}</Text>
        </View>
      </Section>

      {/* Equipment */}
      <Section title="อุปกรณ์" note="มีอุปกรณ์มากขึ้นจะเพิ่มความหลากหลายและการไต่ระดับได้ง่าย">
        <View style={styles.rowWrap}>
          <Pill label="ไม่มีอุปกรณ์" active={prefs.equipment==='none'} onPress={()=>change('equipment','none')} />
          <Pill label="อุปกรณ์น้อย"  active={prefs.equipment==='minimal'} onPress={()=>change('equipment','minimal')} />
          <Pill label="ฟูลยิม"       active={prefs.equipment==='fullGym'} onPress={()=>change('equipment','fullGym')} />
        </View>
        <Text style={styles.helper}>{equipmentTips}</Text>
      </Section>

      {/* Level */}
      <Section title="เลเวล" note="ใช้ RIR/เวลาพักต่างกันตามประสบการณ์">
        <View style={styles.rowWrap}>
          <Pill label="มือใหม่" active={prefs.level==='beginner'} onPress={()=>change('level','beginner')} />
          <Pill label="กลาง"   active={prefs.level==='intermediate'} onPress={()=>change('level','intermediate')} />
          <Pill label="สูง"    active={prefs.level==='advanced'} onPress={()=>change('level','advanced')} />
        </View>
        <Text style={styles.helper}>{levelNotes}</Text>
      </Section>

      {/* Add-ons */}
      <Section title="ตัวเลือกเสริม">
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>เพิ่มคาร์ดิโอ</Text>
          <Switch
            value={prefs.addCardio}
            onValueChange={(v)=>change('addCardio', v)}
            trackColor={{ false: '#e5e7eb', true: '#8b5cf6' }}
            thumbColor={prefs.addCardio ? '#ffffff' : '#f4f3f4'}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>เน้นแกนกลาง (Core)</Text>
          <Switch
            value={prefs.addCore}
            onValueChange={(v)=>change('addCore', v)}
            trackColor={{ false: '#e5e7eb', true: '#8b5cf6' }}
            thumbColor={prefs.addCore ? '#ffffff' : '#f4f3f4'}
          />
        </View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>โมบิลิตี้/ยืดเหยียด</Text>
          <Switch
            value={prefs.addMobility}
            onValueChange={(v)=>change('addMobility', v)}
            trackColor={{ false: '#e5e7eb', true: '#8b5cf6' }}
            thumbColor={prefs.addMobility ? '#ffffff' : '#f4f3f4'}
          />
        </View>
      </Section>

      {/* Preview */}
      <View style={styles.previewCard}>
        <Text style={styles.previewTitle}>พรีวิวแพลนคร่าวๆ</Text>
        <Text style={styles.previewSub}>Split: <Text style={styles.bold}>{splitLabel}</Text></Text>
        <Text style={styles.previewSub}>เวลารวม/สัปดาห์: <Text style={styles.bold}>{weeklyMinutes}</Text> นาที</Text>
        <Text style={styles.previewSub}>ประมาณเผาผลาญ: <Text style={styles.bold}>{weeklyBurnKcal}</Text> kcal/สัปดาห์</Text>
        <View style={styles.previewDays}>
          {previewDays.map((d, i)=>(
            <View key={i} style={styles.dayBox}>
              <Text style={styles.dayTitle}>{d.day}</Text>
              <Text style={styles.dayFocus}>{d.focus}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.previewTiny}>* ตัวเลขเป็นการประมาณเพื่อการตัดสินใจ</Text>
      </View>

      {/* Actions */}
      <TouchableOpacity style={[styles.cta, aiLoading && {opacity:0.7}]} disabled={aiLoading} onPress={previewWithAI}>
        {aiLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaText}>ให้ AI ออกแบบและพรีวิว</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.cta, loading && {opacity:0.7}]} disabled={loading} onPress={createPlan}>
        <Text style={styles.ctaText}>{loading ? 'กำลังสร้างแพลน...' : 'สร้างแพลน'}</Text>
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
        <TouchableOpacity style={styles.linkBtn} onPress={()=>router.replace('/(tabs)/Homesrceen')}>
          <Text style={styles.linkText}>‹ กลับหน้า Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={()=>router.push('/(tabs)/ExerciseLibrary')}>
          <Text style={styles.linkText}>คลังท่าออกกำลังกาย</Text>
        </TouchableOpacity>
      </View>

      {/* Tips */}
      <View style={styles.tip}>
        <Text style={styles.tipTitle}>เคล็ดลับ</Text>
        <Text style={styles.tipText}>• วอร์มอัพ 5–8 นาที & โมบิลิตี้ 3–5 นาที ก่อนเล่นจริง</Text>
        <Text style={styles.tipText}>• จดน้ำหนัก/จำนวนครั้ง เพื่อทำ progressive overload ทุกสัปดาห์</Text>
        <Text style={styles.tipText}>• นอนให้พอ โปรตีน 1.6–2.2 g/kg หากเน้นกล้ามเนื้อ</Text>
      </View>

      {/* AI Preview Modal */}
      <Modal visible={showAIPreview} animationType="slide" presentationStyle="pageSheet">
        <ScrollView contentContainerStyle={{ padding:16, paddingBottom:24, backgroundColor:'#fff' }}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <Text style={[styles.title, { marginBottom:0 }]}>🤖 พรีวิวโดย AI</Text>
            <TouchableOpacity style={styles.linkBtn} onPress={()=>setShowAIPreview(false)}>
              <Text style={styles.linkText}>ปิด</Text>
            </TouchableOpacity>
          </View>

          {/* Summary badges */}
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>สรุปพรีวิว</Text>
            <Text style={styles.previewSub}>Split: <Text style={styles.bold}>{splitLabel}</Text></Text>
            <Text style={styles.previewSub}>เวลารวม/สัปดาห์: <Text style={styles.bold}>{weeklyMinutes}</Text> นาที</Text>
            <Text style={styles.previewSub}>ประมาณเผาผลาญ: <Text style={styles.bold}>{weeklyBurnKcal}</Text> kcal/สัปดาห์</Text>
            <View style={styles.previewDays}>
              {previewDays.map((d, i)=>(
                <View key={i} style={styles.dayBox}>
                  <Text style={styles.dayTitle}>{d.day}</Text>
                  <Text style={styles.dayFocus}>{d.focus}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* AI Text */}
          <View style={styles.card}>
            <Text style={styles.section}>ข้อเสนอแนะจาก AI</Text>
            {aiLoading ? (
              <ActivityIndicator />
            ) : (
              <View>
                {(aiText || '').split('\n').map((line, i) => (
                  <Text key={i} style={{ color:'#374151', marginTop:2 }}>{line}</Text>
                ))}
              </View>
            )}
          </View>

          {/* Actions */}
          <TouchableOpacity style={[styles.cta, (loading||aiLoading) && {opacity:0.7}]} disabled={loading||aiLoading} onPress={createPlan}>
            <Text style={styles.ctaText}>{loading ? 'กำลังสร้างแพลน...' : 'ยืนยันและสร้างแพลน'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={()=>setShowAIPreview(false)}>
            <Text style={styles.secondaryText}>ยกเลิก/แก้ไขพรีเซ็ต</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding:16, paddingBottom:32, backgroundColor:'#F8F8F8' },
  title:{ fontSize:22, fontWeight:'800', marginBottom:6, color:'#111' },
  subtitle:{ color:'#6b7280', marginBottom:12 },
  card:{ backgroundColor:'#fff', borderRadius:12, padding:12, marginBottom:12, borderWidth:1, borderColor:'#e5e7eb' },
  section:{ fontWeight:'800', marginBottom:6, color:'#111' },
  note:{ color:'#6b7280', marginBottom:8 },
  row:{ flexDirection:'row', gap:8, flexWrap:'wrap' },
  rowWrap:{ flexDirection:'row', flexWrap:'wrap', gap:8 },
  pill:{
    paddingHorizontal:14, paddingVertical:10, borderRadius:999,
    backgroundColor:'#f3f4f6', borderWidth:1, borderColor:'#e5e7eb'
  },
  pillActive:{ backgroundColor:'#8b5cf6', borderColor:'#7c3aed' },
  pillText:{ color:'#374151', fontWeight:'700' },
  pillTextActive:{ color:'#fff' },

  badge:{ alignSelf:'flex-start', marginTop:8, borderWidth:1, paddingHorizontal:10, paddingVertical:6, borderRadius:999 },
  badgeText:{ fontWeight:'800' },
  helper:{ marginTop:8, color:'#374151' },
  bold:{ fontWeight:'800', color:'#111' },

  toggleRow:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:6 },
  toggleLabel:{ fontSize:15, color:'#111', fontWeight:'600' },

  previewCard:{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb', marginBottom:12 },
  previewTitle:{ fontWeight:'800', color:'#111', marginBottom:4 },
  previewSub:{ color:'#374151', marginTop:2 },
  previewDays:{ flexDirection:'row', flexWrap:'wrap', gap:8, marginTop:8 },
  dayBox:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, backgroundColor:'#fafafa', minWidth:140 },
  dayTitle:{ fontWeight:'800', color:'#111' },
  dayFocus:{ color:'#374151', marginTop:2, fontSize:12 },
  previewTiny:{ marginTop:8, color:'#9ca3af', fontSize:12 },

  cta:{ backgroundColor:'#8b5cf6', paddingVertical:14, borderRadius:12, alignItems:'center', marginTop:6 },
  ctaText:{ color:'#fff', fontWeight:'800', fontSize:16 },

  secondary:{ alignItems:'center', marginTop:10 },
  secondaryText:{ color:'#6b7280', fontWeight:'700' },

  rowCenter:{ flexDirection:'row', justifyContent:'center', alignItems:'center', gap:16, marginTop:8 },
  linkBtn:{ paddingVertical:8, paddingHorizontal:6 },
  linkText:{ color:'#6b7280', fontWeight:'700' },

  tip:{ backgroundColor:'#eef2ff', borderColor:'#c7d2fe', borderWidth:1, borderRadius:12, padding:12, marginTop:10 },
  tipTitle:{ fontWeight:'800', color:'#3730a3', marginBottom:4 },
  tipText:{ color:'#3730a3' },
});
