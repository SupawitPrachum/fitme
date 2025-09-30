// app/(tabs)/WorkoutPlanDetail.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const PLAN_CACHE_KEY = 'last_workout_plan_v1';

// ---------- Types ----------
type PlanExercise = {
  id?: number;
  seq?: number;
  name: string;
  sets?: number | null;
  repsOrTime?: string | null;
  restSec?: number | null;
  notes?: string | null;

  // รองรับ key จาก client mock เก่า
  reps?: string;
  durationMin?: number;
};

type PlanDay = {
  id?: number;
  dayOrder?: number;
  day?: string;         // รองรับ client mock เก่า (Day 1, Day 2)
  focus: string;
  warmup?: string;
  cooldown?: string;
  exercises: PlanExercise[];
};

type WorkoutPlan = {
  id?: number;
  title?: string;
  split?: string;            // client mock เก่า
  microcycleWeeks?: number;  // client mock เก่า
  createdAt?: string;
  goal?: string;
  daysPerWeek?: number;
  minutesPerSession?: number;
  equipment?: string;
  level?: string;
  addCardio?: boolean;
  addCore?: boolean;
  addMobility?: boolean;
  days?: PlanDay[];
  progression?: string[];
  deloadAdvice?: string;
};

// ---------- Screen ----------
export default function WorkoutPlanDetail() {
  const [plan, setPlan] = useState<WorkoutPlan | null>(null);

  // โหลดแผนจากแคช
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
      if (raw) setPlan(JSON.parse(raw));
    })();
  }, []);

  // ---------- UI helpers ----------
  const titleText = useMemo(() => {
    if (!plan) return '';
    // รองรับทั้งรูปแบบใหม่ (title) และเก่า (split + microcycleWeeks)
    if (plan.title) return plan.title;
    const weeks = plan.microcycleWeeks ? ` • ${plan.microcycleWeeks} สัปดาห์` : '';
    return `แผน ${plan.split ?? ''}${weeks}`;
  }, [plan]);

  const onStartDay = useCallback((dayId?: number) => {
    if (!plan?.id || !dayId) return;
    router.push({
      pathname: '/(tabs)/StartWorkout',
      params: { planId: String(plan.id), dayId: String(dayId) },
    });
  }, [plan?.id]);

  if (!plan) {
    return (
      <View style={styles.center}>
        <Text>ยังไม่มีแพลน ลองสร้างจากหน้าแรกก่อน</Text>
        <TouchableOpacity style={styles.linkBtn} onPress={()=>router.replace('/(tabs)/WorkoutProgram')}>
          <Text style={styles.linkText}>‹ กลับไปตั้งค่าแพลน</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:32 }}>
      <Text style={styles.title}>{titleText}</Text>

      {/* Progression / Deload (ถ้ามี) */}
      {(plan.progression?.length || plan.deloadAdvice) ? (
        <>
          <Text style={styles.section}>การไต่ระดับ</Text>
          <View style={styles.card}>
            {plan.progression?.map((p:string, i:number)=>(
              <Text key={i} style={styles.bullet}>• {p}</Text>
            ))}
            {plan.deloadAdvice && <Text style={[styles.bullet,{marginTop:6}]}>🧊 Deload: {plan.deloadAdvice}</Text>}
          </View>
        </>
      ) : null}

      {/* Daily schedule */}
      <Text style={styles.section}>เลือกวันเพื่อเริ่มออกกำลังกาย</Text>
      {plan.days?.map((d, i) => {
        const dayName = d.day ?? `Day ${d.dayOrder ?? i+1}`;
        return (
          <View style={styles.dayCard} key={d.id ?? i}>
            <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
              <Text style={styles.dayTitle}>{dayName} — {d.focus}</Text>
              {!!d.id && (
                <TouchableOpacity style={styles.startBtn} onPress={()=>onStartDay(d.id!)}>
                  <Text style={styles.startBtnText}>เริ่ม {dayName}</Text>
                </TouchableOpacity>
              )}
            </View>

            {d.warmup ? <Text style={styles.warmcool}>วอร์มอัพ: {d.warmup}</Text> : null}

            {d.exercises?.map((e, j) => {
              // รองรับทั้ง reps (เก่า) และ repsOrTime (ใหม่)
              const repsText = e.repsOrTime ?? e.reps ?? null;
              // รองรับ durationMin (เก่า)
              const durationText = (e.durationMin && !e.repsOrTime) ? `${e.durationMin} นาที` : null;

              return (
                <View key={e.id ?? j} style={styles.exRow}>
                  <View style={{ flex:1 }}>
                    <Text style={styles.exName}>{e.seq ? `${e.seq}. ` : ''}{e.name}</Text>
                    <Text style={styles.exMeta}>
                      {e.sets ? `${e.sets} เซ็ต` : ''}{e.sets && (repsText || durationText) ? ' × ' : ''}
                      {repsText ? `${repsText}` : (durationText ?? '')}
                      {typeof e.restSec === 'number' ? ` • พัก ${e.restSec}s` : ''}
                      {e.notes ? ` • ${e.notes}` : ''}
                    </Text>
                  </View>
                </View>
              );
            })}

            {d.cooldown ? <Text style={styles.warmcool}>คูลดาวน์: {d.cooldown}</Text> : null}
          </View>
        );
      })}

      <TouchableOpacity style={styles.secondary} onPress={()=>router.replace('/(tabs)/WorkoutProgram')}>
        <Text style={styles.secondaryText}>‹ กลับไปสร้าง/แก้ค่าพรีเซ็ต</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={()=>router.replace('/(tabs)/Homesrceen')}>
        <Text style={styles.secondaryText}>‹ กลับหน้า Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  center:{ flex:1, alignItems:'center', justifyContent:'center', padding:16 },
  linkBtn:{ marginTop:10, padding:10 },
  linkText:{ color:'#6b7280', fontWeight:'700' },

  title:{ fontSize:20, fontWeight:'800', marginBottom:10 },
  section:{ fontWeight:'800', marginTop:8, marginBottom:6, color:'#111' },
  card:{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb', marginBottom:12 },
  bullet:{ color:'#374151', marginBottom:4 },

  dayCard:{ backgroundColor:'#fff', borderRadius:12, padding:12, borderWidth:1, borderColor:'#e5e7eb', marginBottom:10 },
  dayTitle:{ fontWeight:'800', marginBottom:8, color:'#111' },
  warmcool:{ color:'#6b7280', marginTop:4, marginBottom:4 },

  exRow:{ flexDirection:'row', alignItems:'center', gap:10, marginBottom:8 },
  exName:{ fontWeight:'700', color:'#111' },
  exMeta:{ color:'#374151', marginTop:2 },

  startBtn:{
    backgroundColor:'#8b5cf6',
    borderColor:'#7c3aed',
    borderWidth:1,
    paddingHorizontal:12,
    paddingVertical:8,
    borderRadius:10,
  },
  startBtnText:{ color:'#fff', fontWeight:'800' },

  secondary:{ alignItems:'center', marginTop:8 },
  secondaryText:{ color:'#6b7280', fontWeight:'700' },
});
