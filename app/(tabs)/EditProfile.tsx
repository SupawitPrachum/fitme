// app/(tabs)/EditProfile.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Alert, ScrollView, TextInput, Modal } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const ME_CACHE_KEY = 'me_cache';

const API_URL = API_BASE_URL;

// ---------- Types ----------
type MeResponse = {
  id: number;
  username: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  avatar_url?: string | null;

  // จาก User_Profiles (OUTER APPLY)
  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
};

type ProfilePayload = {
  exercise_type?: string | null;
  activity_level?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  water_goal_l?: number | null;
  health_condition?: string | null;
  goal?: string | null;
};

// ---------- UI helpers ----------
const PILL = (props: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) => (
  <TouchableOpacity
    style={[styles.pill, props.active && styles.pillActive]}
    onPress={props.onPress}
  >
    <Text style={[styles.pillText, props.active && styles.pillTextActive]}>
      {props.label}
    </Text>
  </TouchableOpacity>
);

// ---------- Screen ----------
export default function EditProfile() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalMessage, setModalMessage] = useState('');

  // ฟิลด์โปรไฟล์ (มาจาก User_Profiles)
  const [exerciseType, setExerciseType] = useState<string | null>(null);
  const [activityLevel, setActivityLevel] = useState<string | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [weightKg, setWeightKg] = useState<string>('');      // ใช้ string ใน input
  const [heightCm, setHeightCm] = useState<string>('');      // ใช้ string ใน input
  const [waterL, setWaterL] = useState<string>('');          // ใช้ string ใน input
  const [healthCond, setHealthCond] = useState<string>('');

  // โหลดข้อมูลฉัน
  const loadMe = async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        Alert.alert('ต้องล็อกอิน', 'กรุณาเข้าสู่ระบบ');
        router.replace('/(tabs)/login');
        return;
      }
      setLoading(true);
      const res = await fetch(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
        router.replace('/(tabs)/login');
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data: MeResponse | null = await res.json();
      setMe(data);

      if (data) {
        // preload ฟิลด์โปรไฟล์
        setExerciseType(data.exercise_type ?? null);
        setActivityLevel(data.activity_level ?? null);
        setGoal(data.goal ?? null);
        setWeightKg(
          typeof data.weight_kg === 'number' ? String(data.weight_kg) : ''
        );
        setHeightCm(
          typeof data.height_cm === 'number' ? String(data.height_cm) : ''
        );
        setWaterL(
          typeof data.water_goal_l === 'number' ? String(data.water_goal_l) : ''
        );
        setHealthCond(data.health_condition ?? '');

        await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(data));
      }
    } catch (e: any) {
      Alert.alert('โหลดโปรไฟล์ไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMe();
  }, []);

  // อัปโหลดรูปโปรไฟล์
  const pickImage = async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('ต้องการสิทธิ์', 'อนุญาตคลังรูปภาพเพื่ออัปโหลด');
      return;
    }

    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (r.canceled) return;

    const uri = r.assets?.[0]?.uri;
    if (!uri) return;

    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) throw new Error('no token');
      setUploading(true);

      const name = uri.split('/').pop() || 'avatar.jpg';
      const type = name.toLowerCase().endsWith('.png')
        ? 'image/png'
        : name.toLowerCase().endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

      const form = new FormData();
      // @ts-ignore React Native FormData file
      form.append('avatar', { uri, name, type });

      const res = await fetch(`${API_URL}/api/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
        router.replace('/(tabs)/login');
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const out = await res.json(); // { ok:true, avatar_url }
      const nextMe = { ...(me || {}), avatar_url: out.avatar_url } as MeResponse;
      setMe(nextMe);
      await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(nextMe));
      Alert.alert('สำเร็จ', 'อัปเดตรูปโปรไฟล์แล้ว');
    } catch (e: any) {
      Alert.alert('อัปโหลดไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setUploading(false);
    }
  };

  // ลบรูป
  const removeAvatar = () => {
    Alert.alert('ลบรูปโปรไฟล์?', 'ต้องการลบรูปโปรไฟล์นี้หรือไม่', [
      { text: 'ยกเลิก', style: 'cancel' },
      {
        text: 'ลบ',
        style: 'destructive',
        onPress: async () => {
          try {
            const token = await AsyncStorage.getItem(AUTH_KEY);
            if (!token) throw new Error('no token');
            setDeleting(true);
            const res = await fetch(`${API_URL}/api/me/avatar`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.status === 401) {
              await AsyncStorage.removeItem(AUTH_KEY);
              Alert.alert('หมดเวลา', 'กรุณาล็อกอินใหม่');
              router.replace('/(tabs)/login');
              return;
            }
            if (!res.ok) {
              const txt = await res.text().catch(() => '');
              throw new Error(txt || `HTTP ${res.status}`);
            }
            const nextMe = { ...(me || {}), avatar_url: null } as MeResponse;
            setMe(nextMe);
            await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(nextMe));
            Alert.alert('ลบแล้ว', 'รูปโปรไฟล์ถูกลบ');
          } catch (e: any) {
            Alert.alert('ลบไม่สำเร็จ', e?.message ?? 'เกิดข้อผิดพลาด');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  // เซฟโปรไฟล์ (เฉพาะตาราง User_Profiles ตาม API)
  const saveProfile = async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        setModalTitle('ต้องล็อกอิน');
        setModalMessage('กรุณาเข้าสู่ระบบก่อนบันทึก');
        setModalVisible(true);
        router.replace('/(tabs)/login');
        return;
      }

      const payload: ProfilePayload = {
        exercise_type: exerciseType ?? null,
        activity_level: activityLevel ?? null,
        goal: goal ?? null,
        weight_kg: weightKg ? Number(weightKg) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        water_goal_l: waterL ? Number(waterL) : null,
        health_condition: healthCond || null,
      };

      // หากไม่มีการเปลี่ยนแปลง ให้แจ้งและไม่เรียก API
      const normalize = (p: ProfilePayload) => ({
        exercise_type: p.exercise_type ?? null,
        activity_level: p.activity_level ?? null,
        goal: p.goal ?? null,
        weight_kg: p.weight_kg != null && Number.isFinite(Number(p.weight_kg)) ? Number(p.weight_kg) : null,
        height_cm: p.height_cm != null && Number.isFinite(Number(p.height_cm)) ? Number(p.height_cm) : null,
        water_goal_l: p.water_goal_l != null && Number.isFinite(Number(p.water_goal_l)) ? Number(p.water_goal_l) : null,
        health_condition: p.health_condition ?? null,
      });
      const current: ProfilePayload = {
        exercise_type: me?.exercise_type ?? null,
        activity_level: me?.activity_level ?? null,
        goal: me?.goal ?? null,
        weight_kg: me?.weight_kg != null ? Number(me.weight_kg) : null,
        height_cm: me?.height_cm != null ? Number(me.height_cm) : null,
        water_goal_l: me?.water_goal_l != null ? Number(me.water_goal_l) : null,
        health_condition: me?.health_condition ?? null,
      };
      if (JSON.stringify(normalize(payload)) === JSON.stringify(normalize(current))) {
        setModalTitle('ยังไม่พบการเปลี่ยนแปลง');
        setModalMessage('โปรดแก้ไขข้อมูลก่อนกดบันทึก');
        setModalVisible(true);
        return;
      }

      setLoading(true);
      const res = await fetch(`${API_URL}/api/me/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        setModalTitle('หมดเวลา');
        setModalMessage('กรุณาล็อกอินใหม่');
        setModalVisible(true);
        router.replace('/(tabs)/login');
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }

      // โหลด me ใหม่เพื่ออัปเดต cache
      await loadMe();
      setModalTitle('บันทึกแล้ว');
      setModalMessage('อัปเดตโปรไฟล์เรียบร้อย');
      setModalVisible(true);
    } catch (e: any) {
      setModalTitle('บันทึกไม่สำเร็จ');
      setModalMessage(e?.message ?? 'เกิดข้อผิดพลาด');
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  // UI helpers
  const displayName = useMemo(() => {
    if (!me) return 'คุณ';
    const full = `${me.first_name ?? ''} ${me.last_name ?? ''}`.trim();
    return full || me.username || 'คุณ';
  }, [me]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.title}>แก้ไขโปรไฟล์</Text>
      <Text style={styles.subtitle}>สวัสดี {displayName}</Text>

      {/* Avatar */}
      <View style={styles.avatarRow}>
        <View style={styles.avatarBox}>
          {me?.avatar_url ? (
            <Image source={{ uri: me.avatar_url }} style={styles.avatar} />
          ) : (
            <View
              style={[styles.avatar, { alignItems: 'center', justifyContent: 'center' }]}
            >
              <Text style={{ color: '#9ca3af' }}>ไม่มีรูป</Text>
            </View>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={[styles.btn, styles.pickBtn]}
            onPress={pickImage}
            disabled={uploading}
          >
            <Text style={[styles.btnText, styles.pickText]}>
              {uploading ? 'กำลังอัปโหลด...' : 'เลือก/เปลี่ยนรูป'}
            </Text>
          </TouchableOpacity>
          {!!me?.avatar_url && (
            <TouchableOpacity
              style={[styles.btn, styles.delBtn]}
              onPress={removeAvatar}
              disabled={deleting}
            >
              <Text style={[styles.btnText, styles.delText]}>
                {deleting ? 'กำลังลบ...' : 'ลบรูป'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Profile (User_Profiles) */}
      <View style={styles.card}>
        <Text style={styles.section}>สไตล์การออกกำลัง</Text>
        <View style={styles.rowWrap}>
          {['cardio', 'strength', 'mixed'].map((x) => (
            <PILL
              key={x}
              label={x}
              active={exerciseType === x}
              onPress={() => setExerciseType(x)}
            />
          ))}
        </View>

        <Text style={[styles.section, { marginTop: 12 }]}>ระดับกิจกรรมประจำวัน</Text>
        <View style={styles.rowWrap}>
          {['sedentary', 'light', 'moderate', 'active', 'very_active'].map((x) => (
            <PILL
              key={x}
              label={x}
              active={activityLevel === x}
              onPress={() => setActivityLevel(x)}
            />
          ))}
        </View>

        <Text style={[styles.section, { marginTop: 12 }]}>เป้าหมาย</Text>
        <View style={styles.rowWrap}>
          {['lose_weight', 'build_muscle', 'maintain_shape', 'general_fitness'].map((x) => (
            <PILL
              key={x}
              label={x}
              active={goal === x}
              onPress={() => setGoal(x)}
            />
          ))}
        </View>

        <Text style={[styles.section, { marginTop: 12 }]}>ข้อมูลร่างกาย</Text>
        <View style={styles.grid2}>
          <View style={styles.inputBox}>
            <Text style={styles.inputLabel}>น้ำหนัก (กก.)</Text>
            <TextInput
              value={weightKg}
              onChangeText={setWeightKg}
              keyboardType="decimal-pad"
              placeholder="เช่น 68.5"
              style={styles.input}
            />
          </View>
          <View style={styles.inputBox}>
            <Text style={styles.inputLabel}>ส่วนสูง (ซม.)</Text>
            <TextInput
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
              placeholder="เช่น 170"
              style={styles.input}
            />
          </View>
        </View>

        <View style={styles.inputBox}>
          <Text style={styles.inputLabel}>เป้าน้ำดื่ม/วัน (ลิตร)</Text>
          <TextInput
            value={waterL}
            onChangeText={setWaterL}
            keyboardType="decimal-pad"
            placeholder="เช่น 2.5"
            style={styles.input}
          />
        </View>

        <View style={styles.inputBox}>
          <Text style={styles.inputLabel}>เงื่อนไขสุขภาพ/แพ้ยา (ถ้ามี)</Text>
          <TextInput
            value={healthCond}
            onChangeText={setHealthCond}
            placeholder="พิมพ์บันทึกสั้น ๆ"
            style={[styles.input, { height: 84, textAlignVertical: 'top' }]}
            multiline
          />
        </View>
      </View>

      {/* Actions */}
      <TouchableOpacity
        style={[styles.btnBig, styles.saveBtn, loading && { opacity: 0.7 }]}
        onPress={saveProfile}
        disabled={loading}
      >
        <Text style={styles.saveText}>{loading ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btnBig, styles.backBtn]}
        onPress={() => router.replace('/(tabs)/Homesrceen')}
      >
        <Text style={styles.backText}>‹ กลับหน้า Home</Text>
      </TouchableOpacity>

      {/* Modal popup */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{modalTitle}</Text>
            <Text style={styles.modalMessage}>{modalMessage}</Text>
            <TouchableOpacity style={[styles.btnBig, styles.modalOkBtn]} onPress={() => setModalVisible(false)}>
              <Text style={styles.modalOkText}>ตกลง</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '800', color: '#111' },
  subtitle: { color: '#6b7280', marginTop: 2, marginBottom: 12 },

  avatarRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  avatarBox: { width: 86, height: 86, borderRadius: 999, overflow: 'hidden', borderWidth: 1, borderColor: '#e5e7eb' },
  avatar: { width: 86, height: 86 },

  btn: {
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  btnText: { fontWeight: '800' },
  pickBtn: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  pickText: { color: '#3730a3' },
  delBtn: { backgroundColor: '#fee2e2', borderColor: '#fecaca' },
  delText: { color: '#b91c1c' },

  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },

  section: { fontWeight: '800', color: '#111', marginBottom: 6 },

  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f3f4f6',
  },
  pillActive: { backgroundColor: '#8b5cf6', borderColor: '#7c3aed' },
  pillText: { color: '#374151', fontWeight: '700' },
  pillTextActive: { color: '#fff' },

  grid2: { flexDirection: 'row', gap: 8 },
  inputBox: { flex: 1, marginTop: 6 },
  inputLabel: { color: '#111', fontWeight: '700', marginBottom: 4 },
  input: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#111',
  },

  btnBig: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  saveBtn: { backgroundColor: '#8b5cf6', borderColor: '#7c3aed' },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  backBtn: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  backText: { color: '#3730a3', fontWeight: '800' },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  modalBox: { width: '86%', backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' },
  modalTitle: { fontSize: 16, fontWeight: '900', color: '#111' },
  modalMessage: { marginTop: 6, color: '#374151' },
  modalOkBtn: { marginTop: 12, backgroundColor: '#8b5cf6', borderColor: '#7c3aed' },
  modalOkText: { color: '#fff', fontWeight: '800' },
});
