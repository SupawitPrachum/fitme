// screens/RegisterSuccessScreen.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

const { width } = Dimensions.get('window');

const RegisterSuccessScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const email = route?.params?.email;

  return (
    <View style={styles.container}>
      <Text style={styles.bigIcon}>✅</Text>
      <Text style={styles.title}>สมัครสมาชิกสำเร็จ!</Text>
      <Text style={styles.subtitle}>
        {email ? `บัญชีของ: ${email}\n` : ''}คุณสามารถเข้าสู่ระบบและเริ่มใช้งานได้เลย
      </Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          // @ts-ignore
          navigation.navigate('login');
        }}
      >
        <Text style={styles.buttonText}>ไปหน้าเข้าสู่ระบบ</Text>
      </TouchableOpacity>

    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  bigIcon: { fontSize: 72, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#1e293b', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#64748b', marginBottom: 28, textAlign: 'center', lineHeight: 22 },
  button: { width: width * 0.8, backgroundColor: '#6366f1', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  secondaryButton: { backgroundColor: '#E5E7EB' },
  secondaryButtonText: { color: '#374151' },
});

export default RegisterSuccessScreen;
