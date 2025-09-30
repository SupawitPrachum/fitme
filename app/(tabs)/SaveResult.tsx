import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';

export default function SaveResultScreen() {
  const params = useLocalSearchParams();
  const ok = String(params?.ok ?? '').toLowerCase() === '1' || String(params?.ok ?? '').toLowerCase() === 'true';
  const title = String(params?.title ?? (ok ? 'สำเร็จ' : 'ไม่สำเร็จ'));
  const message = String(
    params?.message ?? (ok ? 'บันทึกข้อมูลเรียบร้อยแล้ว' : 'เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่')
  );

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={[styles.iconCircle, ok ? styles.iconSuccess : styles.iconFail]}>
          <Text style={styles.iconText}>{ok ? '✓' : '✕'}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>

        <TouchableOpacity
          style={[styles.primaryBtn, ok ? styles.btnSuccess : styles.btnFail]}
          onPress={() => router.replace('/(tabs)/Homesrceen')}
        >
          <Text style={styles.primaryText}>กลับหน้าหลัก</Text>
        </TouchableOpacity>

        {!ok ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryText}>ย้อนกลับ</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1228', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', backgroundColor: '#12122b', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#2b2b55', alignItems: 'center' },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  iconSuccess: { backgroundColor: '#144d2a' },
  iconFail: { backgroundColor: '#5b1f25' },
  iconText: { fontSize: 38, color: 'white', fontWeight: '800' },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  message: { color: '#9aa0b6', textAlign: 'center', marginBottom: 16 },
  primaryBtn: { width: '100%', paddingVertical: 14, borderRadius: 28, alignItems: 'center', marginTop: 4 },
  btnSuccess: { backgroundColor: '#2f855a' },
  btnFail: { backgroundColor: '#c53030' },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { marginTop: 10, paddingVertical: 12, borderRadius: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#667eea', backgroundColor: '#12122b' },
  secondaryText: { color: '#667eea', fontWeight: '700' },
});

