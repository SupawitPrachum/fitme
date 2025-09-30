
// LoginSuccessScreen.tsx
import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useLocalSearchParams, router, Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';

export default function LoginSuccessScreen() {
  // รับพารามฯจาก url/route (expo-router)
  const params = useLocalSearchParams<{ username?: string; ok?: string; error?: string }>();
  const username =
    typeof params.username === 'string'
      ? decodeURIComponent(params.username)
      : Array.isArray(params.username)
      ? decodeURIComponent(params.username[0])
      : 'ผู้ใช้';
  const errorParam = Array.isArray(params.error) ? params.error[0] : params.error;
  const okParam = Array.isArray(params.ok) ? params.ok[0] : params.ok;
  const isError = !!errorParam || (okParam ? !['1','true','yes'].includes(String(okParam).toLowerCase()) : false);

  const onPress = useCallback(async (to: string) => {
    // ฟีดแบกสัมผัสเล็กน้อย
    try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    router.replace(to as Href);
  }, []);

  return (
    <LinearGradient
      colors={['#0f1026', '#13163a', '#1c1f54']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <StatusBar style="light" />
      {/* วงแหวนบอกความสำเร็จ */}
      <View style={styles.ringBg}>
        <View style={styles.ring} />
        <View style={[styles.ring, { transform: [{ scale: 1.25 }], opacity: 0.4 }]} />
        <View style={[styles.ring, { transform: [{ scale: 1.5 }], opacity: 0.15 }]} />
      </View>

      <BlurView intensity={40} tint="dark" style={styles.card}>
        {isError ? (
          <>
            <View style={styles.emojiWrap}>
              <View style={[styles.checkWrap, { backgroundColor: 'rgba(229,62,62,0.08)', borderColor: 'rgba(229,62,62,0.35)'}]}>
                <Ionicons name="close-circle" size={84} color="#f28b82" />
              </View>
            </View>
            <Text style={styles.title}>เข้าสู่ระบบไม่สำเร็จ</Text>
            <Text style={styles.subtitle}>
              {errorParam ? String(errorParam) : 'กรุณาลองใหม่อีกครั้ง'}
            </Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              activeOpacity={0.9}
              onPress={() => onPress('/(tabs)/login')}
            >
              <Ionicons name="log-in" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.btnPrimaryText}>ลองใหม่</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnAlt]}
              activeOpacity={0.9}
              onPress={() => onPress('/(tabs)/ForgotPassword')}
            >
              <Ionicons name="key" size={18} color="#c9d1ff" style={{ marginRight: 8 }} />
              <Text style={styles.btnAltText}>ลืมรหัสผ่าน</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.emojiWrap}>
              <View style={styles.checkWrap}>
                <Ionicons name="checkmark-circle" size={84} color="#7dd87d" />
              </View>
            </View>
            <Text style={styles.title}>ล็อกอินสำเร็จ!</Text>
            <Text style={styles.subtitle}>
              ยินดีต้อนรับ, <Text style={styles.username}>{username}</Text>
            </Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              activeOpacity={0.9}
              onPress={() => onPress('/(tabs)/Homesrceen')}
            >
              <Ionicons name="home" size={18} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.btnPrimaryText}>ไปหน้า Home</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.btn, styles.btnAlt]}
              activeOpacity={0.9}
              onPress={() => onPress('/(tabs)/ProfileSetupScreen')}
            >
              <Ionicons name="person-add" size={18} color="#c9d1ff" style={{ marginRight: 8 }} />
              <Text style={styles.btnAltText}>กรอกข้อมูลหากเข้าครั้งแรก</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              activeOpacity={0.9}
              onPress={() => onPress('/(tabs)/login')}
            >
              <Ionicons name="log-out" size={18} color="#aab4ff" style={{ marginRight: 8 }} />
              <Text style={styles.btnGhostText}>ออกจากระบบ</Text>
            </TouchableOpacity>
          </>
        )}
      </BlurView>

      <Text style={styles.footer}>Powered by YourApp • ความปลอดภัยระดับองค์กร</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringBg: {
    position: 'absolute', width: 340, height: 340, borderRadius: 170,
    alignItems: 'center', justifyContent: 'center', opacity: 0.6,
  },
  ring: {
    position: 'absolute', width: 260, height: 260, borderRadius: 130,
    borderWidth: 1.5, borderColor: 'rgba(120,140,255,0.35)',
  },
  card: {
    width: '86%',
    borderRadius: 24,
    paddingVertical: 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: Platform.select({ android: 'rgba(18,18,40,0.35)', ios: 'transparent' }),
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  emojiWrap: { marginTop: 4, marginBottom: 10 },
  checkWrap: {
    width: 110, height: 110, borderRadius: 55,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(125,216,125,0.08)',
    borderWidth: 1, borderColor: 'rgba(125,216,125,0.25)',
  },
  title: {
    fontSize: 26, fontWeight: '800', color: '#ffffff', marginTop: 6, letterSpacing: 0.2,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15, color: '#cfd2ff', marginTop: 6, marginBottom: 18, textAlign: 'center',
  },
  username: { fontWeight: '800', color: '#fff' },
  btn: {
    width: '100%', minHeight: 50, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 10, paddingHorizontal: 16,
  },
  btnPrimary: {
    backgroundColor: '#6a78ff',
    shadowColor: '#6a78ff', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  btnAlt: {
    backgroundColor: 'rgba(102,126,234,0.14)',
    borderWidth: 1, borderColor: 'rgba(160,170,255,0.35)',
  },
  btnAltText: { color: '#c9d1ff', fontWeight: '700', fontSize: 15 },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: 'rgba(160,170,255,0.25)',
  },
  btnGhostText: { color: '#aab4ff', fontWeight: '700', fontSize: 15 },
  footer: {
    position: 'absolute', bottom: 20, color: '#9aa3ff', fontSize: 12, opacity: 0.8,
  },
}); 
