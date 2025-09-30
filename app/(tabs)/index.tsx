import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';

const WelcomeScreen = () => {
  const handlePress = () => {
    // ใช้ expo-router ให้สอดคล้องกับโครงสร้างไฟล์ใน app/
    router.push('/(tabs)/login');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ยินดีต้อนรับสู่ AI Health Hub</Text>
      <Text style={styles.subtitle}>เริ่มต้นการดูแลสุขภาพของคุณด้วย AI ที่ล้ำสมัย</Text>
      
      <TouchableOpacity style={styles.button} onPress={handlePress}>
        <Text style={styles.buttonText}>เริ่มใช้งาน</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#0f0c29',
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#667eea',
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 30,
    elevation: 6,
  },
  buttonText: {
    fontSize: 18,
    color: 'white',
    fontWeight: 'bold',
  },
});

export default WelcomeScreen;
