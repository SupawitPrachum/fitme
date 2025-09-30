import React from 'react';
import { View, Text, StyleSheet, ProgressBarAndroid } from 'react-native';

const ProgressTrackerScreen: React.FC = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>ติดตามความคืบหน้า</Text>
      <View style={styles.card}>
        <Text style={styles.title}>ความคืบหน้าการลดน้ำหนัก</Text>
        <ProgressBarAndroid styleAttr="Horizontal" indeterminate={false} progress={0.75} />
        <Text style={styles.progressText}>75%</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f0f4f8',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    elevation: 5,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: '#374151',
  },
  progressText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6366f1',
    textAlign: 'center',
    marginTop: 8,
  },
});

export default ProgressTrackerScreen;
