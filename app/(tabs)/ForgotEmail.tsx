import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const API_URL = API_BASE_URL;

type Mode = 'username' | 'profile';

export default function ForgotEmailScreen() {
  const [mode, setMode] = useState<Mode>('username');
  const [loading, setLoading] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // username mode
  const [username, setUsername] = useState('');

  // profile mode
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [yyyy, setYYYY] = useState('');
  const [mm, setMM] = useState('');
  const [dd, setDD] = useState('');

  const dob = useMemo(() => {
    if (yyyy.length === 4 && mm.length >= 1 && dd.length >= 1) {
      const m = mm.padStart(2, '0');
      const d = dd.padStart(2, '0');
      return `${yyyy}-${m}-${d}`;
    }
    return '';
  }, [yyyy, mm, dd]);

  const submitUsername = async () => {
    if (!username.trim()) {
      Alert.alert('กรอกชื่อผู้ใช้', 'กรุณากรอกชื่อผู้ใช้ของคุณ');
      return;
    }
    try {
      setLoading(true);
      setMaskedEmail(null);
      setInfoMsg(null);
      const res = await fetch(`${API_URL}/auth/forgot-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.masked_email) setMaskedEmail(String(data.masked_email));
      else setInfoMsg('ถ้าข้อมูลถูกต้อง เราจะแสดงอีเมลแบบปกปิดเพื่อยืนยัน');
    } catch (e: any) {
      const msg = String(e?.message || 'Unknown error');
      const friendly = res429(msg) ? 'กรุณาลองใหม่อีกครั้งในภายหลัง (จำกัดความถี่เพื่อความปลอดภัย)' : msg;
      Alert.alert('ไม่สำเร็จ', friendly);
    } finally {
      setLoading(false);
    }
  };

  const submitProfile = async () => {
    if (!firstName.trim() || !lastName.trim() || !dob) {
      Alert.alert('กรอกข้อมูลไม่ครบ', 'กรุณากรอกชื่อ นามสกุล และวันเกิด (YYYY-MM-DD)');
      return;
    }
    const okDate = /^\d{4}-\d{2}-\d{2}$/.test(dob);
    if (!okDate) {
      Alert.alert('รูปแบบวันเกิดไม่ถูกต้อง', 'กรุณากรอกเป็น YYYY-MM-DD');
      return;
    }
    try {
      setLoading(true);
      setMaskedEmail(null);
      setInfoMsg(null);
      const res = await fetch(`${API_URL}/auth/forgot-email/by-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), date_of_birth: dob }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data?.masked_email) setMaskedEmail(String(data.masked_email));
      else setInfoMsg('ถ้าข้อมูลถูกต้อง เราจะแสดงอีเมลแบบปกปิดเพื่อยืนยัน');
    } catch (e: any) {
      const msg = String(e?.message || 'Unknown error');
      const friendly = res429(msg) ? 'กรุณาลองใหม่อีกครั้งในภายหลัง (จำกัดความถี่เพื่อความปลอดภัย)' : msg;
      Alert.alert('ไม่สำเร็จ', friendly);
    } finally {
      setLoading(false);
    }
  };

  const res429 = (msg: string) => /429|too many/i.test(msg);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>กู้คืนอีเมล</Text>
        <Text style={styles.subtitle}>เพื่อความปลอดภัย ระบบจะแสดงเฉพาะอีเมลแบบปกปิด</Text>

        <View style={styles.segmentRow}>
          <TouchableOpacity onPress={() => setMode('username')} style={[styles.segmentBtn, mode==='username' && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode==='username' && styles.segmentTextActive]}>ด้วยชื่อผู้ใช้</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('profile')} style={[styles.segmentBtn, mode==='profile' && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode==='profile' && styles.segmentTextActive]}>ด้วยข้อมูลส่วนตัว</Text>
          </TouchableOpacity>
        </View>

        {mode === 'username' ? (
          <View>
            <TextInput
              style={styles.input}
              placeholder="ชื่อผู้ใช้"
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
              placeholderTextColor="#9aa0b6"
            />
            <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={submitUsername} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>ตรวจสอบ</Text>}
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <View style={styles.row}>
              <TextInput style={[styles.input, styles.inputHalf, { marginRight: 8 }]}
                placeholder="ชื่อจริง" value={firstName} onChangeText={setFirstName} placeholderTextColor="#9aa0b6" />
              <TextInput style={[styles.input, styles.inputHalf, { marginLeft: 8 }]}
                placeholder="นามสกุล" value={lastName} onChangeText={setLastName} placeholderTextColor="#9aa0b6" />
            </View>
            <Text style={styles.label}>วันเกิด (YYYY-MM-DD)</Text>
            <View style={styles.row}> 
              <TextInput style={[styles.input, styles.yInput]} placeholder="YYYY" value={yyyy} onChangeText={setYYYY} keyboardType="numeric" maxLength={4} placeholderTextColor="#9aa0b6" />
              <TextInput style={[styles.input, styles.mInput]} placeholder="MM" value={mm} onChangeText={setMM} keyboardType="numeric" maxLength={2} placeholderTextColor="#9aa0b6" />
              <TextInput style={[styles.input, styles.dInput]} placeholder="DD" value={dd} onChangeText={setDD} keyboardType="numeric" maxLength={2} placeholderTextColor="#9aa0b6" />
            </View>
            <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={submitProfile} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>ตรวจสอบ</Text>}
            </TouchableOpacity>
          </View>
        )}

        {maskedEmail ? (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>พบอีเมลที่ผูกกับบัญชี</Text>
            <Text style={styles.resultText}>{maskedEmail}</Text>
            <Text style={styles.small}>เพื่อความปลอดภัย เราแสดงเฉพาะบางส่วน</Text>
          </View>
        ) : infoMsg ? (
          <View style={styles.resultBox}>
            <Text style={styles.small}>{infoMsg}</Text>
          </View>
        ) : null}

        <Text style={styles.disclaimer}>หมายเหตุ: เพื่อป้องกันการเดา ระบบจะไม่ยืนยันการมีอยู่ของบัญชีโดยตรง</Text>

        <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
          <Text style={styles.linkText}>ย้อนกลับไปหน้าเข้าสู่ระบบ</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0f1228' },
  card: { width: '100%', backgroundColor: '#12122b', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#2b2b55' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  subtitle: { color: '#9aa0b6', marginTop: 4, marginBottom: 12 },
  segmentRow: { flexDirection: 'row', backgroundColor: '#1b1b3a', borderRadius: 12, padding: 4, marginBottom: 12 },
  segmentBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  segmentActive: { backgroundColor: '#2b2b55' },
  segmentText: { color: '#9aa0b6', fontWeight: '600' },
  segmentTextActive: { color: '#fff' },
  input: { flex: 1, height: 48, backgroundColor: '#1b1b3a', borderRadius: 12, paddingHorizontal: 14, color: '#fff', borderWidth: 1, borderColor: '#2b2b55' },
  inputHalf: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  label: { color: '#9aa0b6', marginBottom: 6 },
  yInput: { flex: 2, marginRight: 8 },
  mInput: { flex: 1, marginRight: 8 },
  dInput: { flex: 1 },
  primaryBtn: { backgroundColor: '#667eea', paddingVertical: 14, borderRadius: 28, width: '100%', alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  resultBox: { marginTop: 16, padding: 12, backgroundColor: '#101028', borderRadius: 12, borderWidth: 1, borderColor: '#2b2b55' },
  resultTitle: { color: '#86efac', fontWeight: '700', marginBottom: 6 },
  resultText: { color: '#fff', fontSize: 16, marginBottom: 4 },
  small: { color: '#9aa0b6', fontSize: 12 },
  disclaimer: { color: '#7e869b', fontSize: 12, marginTop: 12 },
  linkBtn: { marginTop: 14, paddingVertical: 8, alignItems: 'center' },
  linkText: { color: '#9aa0b6', fontSize: 12 },
});
