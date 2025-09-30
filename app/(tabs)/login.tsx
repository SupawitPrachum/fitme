// app/(auth)/login.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const API_URL = API_BASE_URL;

// กันพิมพ์ path ผิด + ให้เป็น literal types
const ROUTES = {
  SUCCESS: '/(tabs)/LoginSuccessScreen',
  register: '/(tabs)/register',  // แก้ไขตรงนี้เป็นหน้าโปรไฟล์ที่ต้องการให้ guest เข้าไป
  forgotPassword: '/(tabs)/ForgotPassword',
  forgotEmail: '/(tabs)/ForgotEmail',
} as const;

export default function LoginScreen() {
  const [username, setUsername] = useState('admin'); // เดโม่
  const [password, setPassword] = useState('11111111');
  const [loading, setLoading] = useState(false);
  const [hidePw, setHidePw] = useState(true);

  const handleLogin = async () => {
    if (!username || !password) {
      Alert.alert('กรอกให้ครบ', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      // เซฟ token ให้หน้าถัดไปใช้
      const token = String(data.token || '');
      await AsyncStorage.setItem(AUTH_KEY, token);
      // ไปหน้า success เสมอ (โฟลว์เดิม)
      router.replace({ pathname: ROUTES.SUCCESS, params: { username } } as const);
    } catch (err: any) {
      // ส่งไปหน้าแจ้งผล พร้อมข้อความสาเหตุความล้มเหลว
      const msg = String(err?.message || 'Unknown error');
      router.replace({ pathname: ROUTES.SUCCESS, params: { ok: '0', error: msg } } as const);
    } finally {
      setLoading(false);
    }
  };

  const register = async () => {
    // ลบ token → ให้ backend โหมด dev/fallback ทำงาน (ถ้ารองรับ)
    await AsyncStorage.removeItem(AUTH_KEY);
    router.replace(ROUTES.register); // ไปหน้าโปรไฟล์แบบ guest
  };

  const goForgotPassword = () => router.push(ROUTES.forgotPassword);
  const goForgotEmail = () => router.push(ROUTES.forgotEmail);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>เข้าสู่ระบบ</Text>

      <TextInput
        style={styles.input}
        placeholder="ชื่อผู้ใช้"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
      />

      <View style={{ width: '100%', position: 'relative' }}>
        <TextInput
          style={[styles.input, { paddingRight: 90 }]}
          placeholder="รหัสผ่าน"
          secureTextEntry={hidePw}
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity onPress={() => setHidePw(s => !s)} style={styles.eyeBtn}>
          <Text style={{ color: '#667eea', fontWeight: '700' }}>
            {hidePw ? 'แสดง' : 'ซ่อน'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>ล็อกอิน</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={register}>
        <Text style={styles.secondaryText}>ลงทะเบียน</Text>
      </TouchableOpacity>

      <View style={styles.hintsRow}>
        <TouchableOpacity style={styles.hintBtn} onPress={goForgotPassword}>
          <Text style={styles.hintText}>ลืมรหัสผ่าน?</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hintBtn} onPress={goForgotEmail}>
          <Text style={styles.hintText}>ลืมอีเมล?</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:{ flex:1, alignItems:'center', justifyContent:'center', padding:24, backgroundColor:'#12122b' },
  title:{ fontSize:28, fontWeight:'bold', marginBottom:24, color:'#fff' },
  input:{
    width:'100%', height:48, backgroundColor:'#1b1b3a', borderRadius:12, paddingHorizontal:14,
    color:'#fff', marginBottom:14, borderWidth:1, borderColor:'#2b2b55',
  },
  eyeBtn:{ position:'absolute', right:10, top:0, bottom:0, justifyContent:'center', paddingHorizontal:10 },
  primaryBtn:{ backgroundColor:'#667eea', paddingVertical:14, borderRadius:28, width:'100%', alignItems:'center', marginTop:8 },
  primaryText:{ color:'#fff', fontWeight:'bold', fontSize:16 },
  secondaryBtn:{ marginTop:14, paddingVertical:14, borderRadius:28, width:'100%', alignItems:'center', borderWidth:1, borderColor:'#667eea', backgroundColor:'#12122b' },
  secondaryText:{ color:'#667eea', fontWeight:'bold', fontSize:16 },
  hintsRow:{ flexDirection:'row', justifyContent:'space-between', width:'100%', marginTop:14 },
  hintBtn:{ paddingVertical:8 },
  hintText:{ color:'#9aa0b6', fontSize:12 },
});
