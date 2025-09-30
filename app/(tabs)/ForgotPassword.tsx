import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, Linking } from 'react-native';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const API_URL = API_BASE_URL;

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) {
      Alert.alert('กรอกอีเมล', 'กรุณากรอกอีเมลที่ใช้สมัคร');
      return;
    }
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const url: string | undefined = data?.preview_url || data?.reset_link;
      if (url) {
        const fixed = Platform.OS === 'android' ? url.replace('://localhost', '://10.0.2.2') : url;
        setResultUrl(fixed);
        Alert.alert('ส่งคำขอสำเร็จ', 'เปิดลิงก์รีเซ็ตในเบราว์เซอร์?', [
          { text: 'ยกเลิก' },
          { text: 'เปิดลิงก์', onPress: () => Linking.openURL(fixed).catch(() => {}) },
        ]);
      } else {
        Alert.alert('ส่งคำขอสำเร็จ', data?.message || 'ถ้ามีบัญชี เราได้ส่งลิงก์รีเซ็ตไปที่อีเมลนี้แล้ว');
      }
    } catch (e: any) {
      Alert.alert('ขอรีเซ็ตไม่สำเร็จ', e?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ลืมรหัสผ่าน</Text>
      <Text style={styles.subtitle}>กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่</Text>

      <TextInput
        style={styles.input}
        placeholder="อีเมลที่ใช้สมัคร"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholderTextColor="#9aa0b6"
      />

      <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={submit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>ส่งลิงก์รีเซ็ต</Text>}
      </TouchableOpacity>

      {resultUrl ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>ลิงก์รีเซ็ต:</Text>
          <Text style={styles.resultLink} numberOfLines={2}>{resultUrl}</Text>
          <TouchableOpacity style={styles.openBtn} onPress={() => Linking.openURL(resultUrl).catch(() => {})}>
            <Text style={styles.openText}>เปิดลิงก์</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity style={styles.linkBtn} onPress={() => router.back()}>
        <Text style={styles.linkText}>ย้อนกลับไปหน้าเข้าสู่ระบบ</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#12122b' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  subtitle: { color: '#9aa0b6', marginBottom: 16, textAlign: 'center' },
  input: {
    width: '100%', height: 48, backgroundColor: '#1b1b3a', borderRadius: 12, paddingHorizontal: 14,
    color: '#fff', marginBottom: 14, borderWidth: 1, borderColor: '#2b2b55',
  },
  primaryBtn: { backgroundColor: '#667eea', paddingVertical: 14, borderRadius: 28, width: '100%', alignItems: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  linkBtn: { marginTop: 14, paddingVertical: 8 },
  linkText: { color: '#9aa0b6', fontSize: 12 },
  resultBox: { marginTop: 16, padding: 12, backgroundColor: '#1b1b3a', borderRadius: 8, width: '100%', gap: 8 },
  resultText: { color: '#9aa0b6' },
  resultLink: { color: '#fff' },
  openBtn: { marginTop: 6, backgroundColor: '#2b2b55', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  openText: { color: '#fff', fontWeight: '600' },
});
