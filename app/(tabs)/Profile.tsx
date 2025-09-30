// app/(tabs)/Profile.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert, ActivityIndicator, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const ME_CACHE_KEY = 'me_cache';
const PLAN_CACHE_KEY = 'last_workout_plan_v1';
const API_URL = API_BASE_URL;

type Me = {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  gender?: string;
  date_of_birth?: string;
  photo_url?: string | null;
  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
  is_admin?: boolean;
  is_active?: boolean;
};

export default function Profile() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  // admin state
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  const fetchMe = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        router.replace('/(tabs)/login');
        return;
      }
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        router.replace('/(tabs)/login');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Me | null;
      if (data) {
        setMe(data);
        await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(data));
      }
    } catch (e: any) {
      const raw = await AsyncStorage.getItem(ME_CACHE_KEY);
      if (raw) setMe(JSON.parse(raw));
      else Alert.alert('โหลดโปรไฟล์ไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const displayName = me
    ? (`${me.first_name ?? ''} ${me.last_name ?? ''}`.trim() || me.username || 'ผู้ใช้')
    : 'ผู้ใช้';
const backToHome = () => router.replace('/(tabs)/Homesrceen');
  const onEditProfile = () => router.push('/(tabs)/EditProfile');
  const openLastPlan = async () => {
    const raw = await AsyncStorage.getItem(PLAN_CACHE_KEY);
    if (!raw) {
      Alert.alert('ยังไม่มีแผน', 'ไปที่ “สร้างแพลนการออกกำลังกาย” เพื่อเริ่มต้น');
      return;
    }
    router.push('/(tabs)/WorkoutPlanDetail');
  };

  // Admin helpers
  const fetchUsers = async () => {
    try {
      setAdminLoading(true);
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) { router.replace('/(tabs)/login'); return; }
      const u = new URL(`${API_URL}/api/admin/users`);
      if (adminSearch) u.searchParams.set('search', adminSearch);
      u.searchParams.set('limit', '50');
      const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) { Alert.alert('สิทธิ์ไม่พอ', 'ต้องเป็น Admin เท่านั้น'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAdminUsers(data.items || []);
    } catch (e: any) {
      Alert.alert('ดึงรายชื่อผู้ใช้ไม่สำเร็จ', e?.message ?? 'error');
    } finally {
      setAdminLoading(false);
    }
  };
  const toggleUser = async (u: any, field: 'is_active'|'is_admin') => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) return;
      const res = await fetch(`${API_URL}/api/admin/users/${u.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: !u[field] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAdminUsers(prev => prev.map(x => x.id === u.id ? { ...x, [field]: !u[field] } : x));
    } catch (e: any) {
      Alert.alert('อัปเดตไม่สำเร็จ', e?.message ?? 'error');
    }
  };
  const resetPassword = async (u: any) => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) return;
      const res = await fetch(`${API_URL}/api/admin/users/${u.id}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ new_password: '123456' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Alert.alert('สำเร็จ', `รีเซ็ตรหัสผ่านของ ${u.username} = 123456`);
    } catch (e: any) {
      Alert.alert('รีเซ็ตรหัสผ่านล้มเหลว', e?.message ?? 'error');
    }
  };
  const forceLogout = async (u: any) => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) return;
      const res = await fetch(`${API_URL}/api/admin/users/${u.id}/force-logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      Alert.alert('สำเร็จ', `ลบโทเค็น ${data.removedTokens} รายการของ ${u.username}`);
    } catch (e: any) {
      Alert.alert('บังคับออกจากระบบล้มเหลว', e?.message ?? 'error');
    }
  };

  const signOut = async () => {
    await AsyncStorage.removeItem(AUTH_KEY);
    await AsyncStorage.removeItem(ME_CACHE_KEY);
    router.replace('/(tabs)/login');
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Cover */}
      <View style={styles.cover} />
      {/* Back to Home */}
      <View style={{ marginTop: 8, marginHorizontal: 12 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/(tabs)/Homesrceen')}>
          <Text style={styles.backText}>‹ กลับหน้าหลัก</Text>
        </TouchableOpacity>
      </View>
      {/* Header card */}
      <View style={styles.headerCard}>
        <View style={styles.avatarWrap}>
          {me?.photo_url ? (
            <Image source={{ uri: me.photo_url }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={40} color="#5b21b6" />
            </View>
          )}
          <TouchableOpacity style={styles.editBadge} onPress={onEditProfile}>
            <Text style={styles.editBadgeText}>แก้ไข</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.name}>{displayName}</Text>
        <Text style={styles.email}>{me?.email ?? ''}</Text>
        {me?.goal ? <Text style={styles.goalTag}>🎯 {humanGoal(me.goal)}</Text> : null}
      </View>

      {loading && (
        <View style={{ paddingTop: 20 }}>
          <ActivityIndicator />
        </View>
      )}

      {/* Quick stats */}
      <View style={styles.statsRow}>
        <Stat label="วัน/สัปดาห์" value={guessDaysPerWeek()} />
        <Stat label="นาที/ครั้ง" value={guessMinutesPerSession()} />
        <Stat label="เลเวล" value={humanLevel(me?.activity_level)} />
      </View>

      {/* Menu */}
      <View style={styles.menuCard}>
        <MenuItem title="แก้ไขโปรไฟล์" subtitle="รูปโปรไฟล์ • ส่วนสูง/น้ำหนัก • เป้าหมาย" onPress={onEditProfile} />
        <Separator />
        <MenuItem title="แผนออกกำลังกายล่าสุด" subtitle="เปิดดูหรือเริ่มวันถัดไป" onPress={openLastPlan} />
        <Separator />
        <MenuItem title="ตั้งค่าเป้าหมายแคลอรี่" subtitle="กำหนด DailyGoalKcal / โหมดเป้าหมาย" onPress={() => router.push('/')} />
        <Separator />
        <MenuItem title="รายการโปรดอาหาร" subtitle="เพิ่มอาหารที่ใช้บ่อย" onPress={() => router.push('/')} />
        {me?.is_admin ? (
          <>
            <Separator />
            <MenuItem title="โหมดผู้ดูแลระบบ" subtitle={showAdmin ? 'ปิดคอนโซลผู้ดูแล' : 'เปิดคอนโซลผู้ดูแล'} onPress={()=>setShowAdmin(s=>!s)} />
          </>
        ) : null}
      </View>

      {me?.is_admin && showAdmin && (
        <View style={styles.menuCard}>
          <Text style={[styles.menuTitle,{paddingHorizontal:14,paddingTop:10}]}>Admin Console</Text>
          <View style={{ flexDirection:'row', gap:8, paddingHorizontal:14, paddingBottom:10 }}>
            <TextInput
              placeholder="ค้นหา username/email"
              placeholderTextColor="#9ca3af"
              value={adminSearch}
              onChangeText={setAdminSearch}
              style={styles.input}
            />
            <TouchableOpacity style={styles.btnSmall} onPress={fetchUsers}>
              <Text style={{ fontWeight:'800', color:'#111' }}>ค้นหา</Text>
            </TouchableOpacity>
          </View>

          {adminLoading ? (
            <View style={{ paddingVertical:12 }}><ActivityIndicator /></View>
          ) : (
            <View style={{ paddingHorizontal:14, paddingBottom:12 }}>
              {adminUsers.map((u) => (
                <View key={u.id} style={styles.adminRow}>
                  <View style={{ flex:1 }}>
                    <Text style={styles.menuTitle}>{u.username} {u.is_admin ? '• Admin' : ''}</Text>
                    <Text style={styles.menuSub}>{u.email}</Text>
                  </View>
                  <View style={{ alignItems:'flex-end' }}>
                    <View style={{ flexDirection:'row', gap:8 }}>
                      <TouchableOpacity onPress={()=>toggleUser(u,'is_active')} style={[styles.chip, u.is_active ? styles.ok : styles.warn]}>
                        <Text style={styles.chipText}>{u.is_active ? 'Active' : 'Disabled'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={()=>toggleUser(u,'is_admin')} style={[styles.chip, u.is_admin ? styles.ok : styles.neutral]}>
                        <Text style={styles.chipText}>{u.is_admin ? 'Admin' : 'User'}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection:'row', gap:12, marginTop:6 }}>
                      <TouchableOpacity onPress={()=>resetPassword(u)}>
                        <Text style={{ color:'#3b82f6', fontWeight:'800' }}>Reset PW</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={()=>forceLogout(u)}>
                        <Text style={{ color:'#ef4444', fontWeight:'800' }}>Force Logout</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    <View style={styles.menuCard1}>
        <TouchableOpacity onPress={backToHome} style={styles.signoutBtn1}>
          <Text style={styles.signoutText1}>กลับหน้าหลัก</Text>
        </TouchableOpacity>
        </View>
      <View style={styles.menuCard}>
        <TouchableOpacity onPress={signOut} style={styles.signoutBtn}>
          <Text style={styles.signoutText}>ออกจากระบบ</Text>
        </TouchableOpacity> 
      </View>
      
    </ScrollView>
  );
}

/* ---------- Small UI helpers ---------- */
const Stat = ({ label, value }: { label: string; value?: string }) => (
  <View style={styles.statBox}>
    <Text style={styles.statValue}>{value ?? '-'}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const MenuItem = ({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) => (
  <TouchableOpacity onPress={onPress} style={styles.menuItem}>
    <View style={{ flex: 1 }}>
      <Text style={styles.menuTitle}>{title}</Text>
      {subtitle ? <Text style={styles.menuSub}>{subtitle}</Text> : null}
    </View>
    <Text style={styles.chev}>›</Text>
  </TouchableOpacity>
);

const Separator = () => <View style={styles.sep} />;

/* ---------- Humanize helpers ---------- */
function humanGoal(g?: string | null) {
  switch (g) {
    case 'build_muscle': return 'เพิ่มกล้ามเนื้อ';
    case 'lose_weight': return 'ลดน้ำหนัก';
    case 'maintain_shape': return 'รักษารูปร่าง';
    case 'general_fitness': return 'ฟิตเนสทั่วไป';
    default: return g ?? '—';
  }
}

function humanLevel(l?: string | null) {
  if (!l) return '—';
  const t = l.toLowerCase();
  if (['beginner','novice','low'].includes(t)) return 'มือใหม่';
  if (['intermediate','mid','medium'].includes(t)) return 'กลาง';
  if (['advanced','high'].includes(t)) return 'สูง';
  return l;
}
function guessDaysPerWeek() { return '3–5'; }
function guessMinutesPerSession() { return '45–60'; }

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
  cover: {
    height: 120,
    backgroundColor: '#8b5cf6',
    opacity: 0.9,
  },
  headerCard: {
    marginTop: -40,
    paddingTop: 50,
    paddingBottom: 14,
    backgroundColor: '#fff',
    marginHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarWrap: { position: 'absolute', top: -40, alignItems: 'center' },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 3, borderColor: '#fff',
    backgroundColor: '#ede9fe',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarPlaceholder: { // วงกลม + ไอคอน
    backgroundColor: '#ede9fe',
  },
  editBadge: {
    position: 'absolute', right: -10, bottom: -6,
    backgroundColor: '#8b5cf6', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: '#7c3aed'
  },
  editBadgeText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  name: { marginTop: 4, fontSize: 18, fontWeight: '800', color: '#111' },
  email: { color: '#6b7280', marginTop: 2 },
  goalTag: { marginTop: 6, color: '#3730a3', backgroundColor: '#eef2ff', borderColor: '#c7d2fe', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, fontWeight: '800' },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 12, paddingHorizontal: 12 },
  statBox: {
    flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    paddingVertical: 14, borderRadius: 12, alignItems: 'center'
  },
  statValue: { fontWeight: '800', color: '#111', fontSize: 16 },
  statLabel: { color: '#6b7280', marginTop: 2 },

  menuCard: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, marginTop: 12, marginHorizontal: 12, overflow: 'hidden'
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  menuTitle: { fontWeight: '800', color: '#111' },
  menuSub: { color: '#6b7280', marginTop: 2 },
  chev: { color: '#9ca3af', fontSize: 22, fontWeight: '300' },
  sep: { height: 1, backgroundColor: '#e5e7eb', marginHorizontal: 14 },

  signoutBtn: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#fee2e2' },
  signoutText: { color: '#b91c1c', fontWeight: '800' },
 
  menuCard1: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb',
    borderRadius: 12, marginTop: 12, marginHorizontal: 12, overflow: 'hidden'
  },
  menuItem1: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  menuTitle1: { fontWeight: '800', color: '#111' },
  menuSub1: { color: '#6b7280', marginTop: 2 },
  chev1: { color: '#9ca3af', fontSize: 22, fontWeight: '300' },
  sep1: { height: 1, backgroundColor: '#e5e7eb', marginHorizontal: 14 },

  signoutBtn1: { paddingVertical: 12, alignItems: 'center', backgroundColor: '#721deaff' },
  signoutText1: { color: '#ffffffff', fontWeight: '800' },

  // Back button
  backBtn:{ alignSelf:'flex-start', paddingVertical:6, paddingHorizontal:10, borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, backgroundColor:'#fff' },
  backText:{ color:'#111', fontWeight:'800' },

  // Admin styles
  input:{ flex:1, height:44, backgroundColor:'#fff', borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, paddingHorizontal:12, color:'#111' },
  btnSmall:{ paddingHorizontal:14, borderRadius:10, alignItems:'center', justifyContent:'center', backgroundColor:'#e2e8f0' },
  adminRow:{ flexDirection:'row', alignItems:'center', backgroundColor:'#fff', borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, marginBottom:8 },
  chip:{ paddingVertical:6, paddingHorizontal:10, borderRadius:8 },
  chipText:{ color:'#111', fontWeight:'700' },
  ok:{ backgroundColor:'#dcfce7' },
  warn:{ backgroundColor:'#fee2e2' },
  neutral:{ backgroundColor:'#e2e8f0' },
});
