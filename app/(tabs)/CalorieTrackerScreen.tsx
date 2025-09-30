// app/(tabs)/CalorieTrackerScreen.tsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Modal,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router'; // ✅ เพิ่ม

// ===== CONFIG =====
const AUTH_KEY = 'auth_token';
const ME_CACHE_KEY = 'me_cache';
const API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const STORAGE_KEY = 'calorie_log_v2';
const FAVORITES_KEY = 'favorite_foods_v1';
const SETTINGS_KEY = 'calorie_settings_v1';

// ===== Types =====
type Entry = {
  id: string;
  name: string;
  calories: number;
  servings: number;
  createdAt: string;
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
};

type FavoriteFood = {
  id: string;
  name: string;
  calories: number;
  usageCount: number;
};

type Settings = {
  dailyGoal: number;
  goalMode: 'maintain' | 'lose' | 'gain';
  showMealCategories: boolean;
};

type DayLog = Entry[];
type ViewMode = 'daily' | 'weekly' | 'monthly' | 'favorites' | 'settings';

type MeResponse = {
  id: number;
  gender: 'male' | 'female' | string | null;
  date_of_birth?: string | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  activity_level?: string | null;
};

const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseNum = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const estimateDailyTarget = (me?: MeResponse | null): number => {
  if (!me || !me.gender || !me.date_of_birth || !me.weight_kg || !me.height_cm) return 2000;
  const w = me.weight_kg;
  const h = me.height_cm;
  if (!w || !h) return 2000;

  const birth = new Date(me.date_of_birth);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

  const gender = String(me.gender).toLowerCase().startsWith('m') ? 'male' : 'female';
  const bmr = gender === 'male'
    ? (10 * w) + (6.25 * h) - (5 * age) + 5
    : (10 * w) + (6.25 * h) - (5 * age) - 161;

  const s = (me.activity_level ?? '').toLowerCase();
  let mult = 1.55;
  if (s.includes('sedentary')) mult = 1.2;
  else if (s.includes('light')) mult = 1.375;
  else if (s.includes('moderate')) mult = 1.55;
  else if (s.includes('very')) mult = 1.9;
  else if (s.includes('intense') || s.includes('active')) mult = 1.725;

  const tdee = Math.round(bmr * mult);
  return Math.min(3800, Math.max(1200, tdee));
};

export default function CalorieTrackerScreen() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [logs, setLogs] = useState<Record<string, DayLog>>({});
  const [favorites, setFavorites] = useState<FavoriteFood[]>([]);
  const [settings, setSettings] = useState<Settings>({
    dailyGoal: 2000,
    goalMode: 'maintain',
    showMealCategories: true,
  });
  
  // Form states
  const [name, setName] = useState('');
  const [calories, setCalories] = useState<string>('');
  const [servings, setServings] = useState<string>('1');
  const [selectedCategory, setSelectedCategory] = useState<Entry['category']>('breakfast');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // UI states
  const [viewMode, setViewMode] = useState<ViewMode>('daily');
  const [showFavorites, setShowFavorites] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const key = useMemo(() => todayKey(selectedDate), [selectedDate]);
  const dayList = logs[key] ?? [];

  // Calculate totals by category
  const mealTotals = useMemo(() => {
    const totals = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    dayList.forEach(entry => {
      totals[entry.category] += entry.calories * entry.servings;
    });
    return totals;
  }, [dayList]);

  const totalKcal = Object.values(mealTotals).reduce((sum, val) => sum + val, 0);
  const progress = Math.min(1, totalKcal / (settings.dailyGoal || 2000));

  // Calculate streak
  const streak = useMemo(() => {
    let count = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = todayKey(d);
      const dayTotal = (logs[k] ?? []).reduce((sum, entry) => sum + entry.calories * entry.servings, 0);
      if (dayTotal >= settings.dailyGoal * 0.8) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }, [logs, settings.dailyGoal]);

  // Weekly data for chart
  const weeklyData = useMemo(() => {
    const data = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = todayKey(d);
      const dayTotal = (logs[k] ?? []).reduce((sum, entry) => sum + entry.calories * entry.servings, 0);
      data.push({
        day: d.toLocaleDateString('th-TH', { weekday: 'short' }),
        calories: dayTotal,
        goal: settings.dailyGoal,
      });
    }
    return data;
  }, [logs, settings.dailyGoal]);

  // Load data
  const loadData = useCallback(async () => {
    try {
      const [logsData, favoritesData, settingsData] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(SETTINGS_KEY),
      ]);
      
      if (logsData) setLogs(JSON.parse(logsData));
      if (favoritesData) setFavorites(JSON.parse(favoritesData));
      if (settingsData) setSettings(prev => ({ ...prev, ...JSON.parse(settingsData) }));
    } catch (e) {
      console.warn('Load data error', e);
    }
  }, []);

  const loadTargetFromProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_KEY);
      const cache = await AsyncStorage.getItem(ME_CACHE_KEY);
      if (cache) {
        const meCached: MeResponse = JSON.parse(cache);
        const estimated = estimateDailyTarget(meCached);
        setSettings(prev => ({ ...prev, dailyGoal: estimated }));
      }
      if (!token) return;

      const res = await fetch(`${API_URL}/api/me`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return;
      const me: MeResponse | null = await res.json();
      if (me) {
        const estimated = estimateDailyTarget(me);
        setSettings(prev => ({ ...prev, dailyGoal: estimated }));
        await AsyncStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadData();
    loadTargetFromProfile();
  }, [loadData, loadTargetFromProfile]);

  // Save functions
  const saveLogs = useCallback(async (next: Record<string, DayLog>) => {
    setLogs(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const saveFavorites = useCallback(async (next: FavoriteFood[]) => {
    setFavorites(next);
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }, []);

  const saveSettings = useCallback(async (next: Settings) => {
    setSettings(next);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  // Add or update entry
  const addOrUpdate = () => {
    const cal = parseNum(calories);
    const srv = parseNum(servings || '1');
    if (!name.trim()) return Alert.alert('กรอกไม่ครบ', 'กรุณาใส่ชื่ออาหาร/เมนู');
    if (!Number.isFinite(cal) || cal <= 0) return Alert.alert('แคลอรี่ไม่ถูกต้อง', 'ใส่ตัวเลขมากกว่าศูนย์');
    if (!Number.isFinite(srv) || srv <= 0) return Alert.alert('จำนวนหน่วยไม่ถูกต้อง', 'ใส่ตัวเลขมากกว่าศูนย์');

    const now = new Date().toISOString();
    const next = { ...logs };
    const list = next[key] ? [...next[key]] : [];

    if (editingId) {
      const idx = list.findIndex(x => x.id === editingId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], name: name.trim(), calories: cal, servings: srv, category: selectedCategory };
      }
    } else {
      list.unshift({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        calories: cal,
        servings: srv,
        category: selectedCategory,
        createdAt: now,
      });
    }

    next[key] = list;
    saveLogs(next);

    // Update favorites
    const existingFav = favorites.find(f => f.name.toLowerCase() === name.trim().toLowerCase());
    if (existingFav) {
      const updatedFavs = favorites.map(f => 
        f.id === existingFav.id ? { ...f, usageCount: f.usageCount + 1, calories: cal } : f
      );
      saveFavorites(updatedFavs);
    } else {
      const newFav: FavoriteFood = {
        id: `fav_${Date.now()}`,
        name: name.trim(),
        calories: cal,
        usageCount: 1,
      };
      saveFavorites([...favorites, newFav]);
    }

    resetForm();
  };

  const resetForm = () => {
    setName('');
    setCalories('');
    setServings('1');
    setSelectedCategory('breakfast');
    setEditingId(null);
  };

  const editItem = (it: Entry) => {
    setName(it.name);
    setCalories(String(it.calories));
    setServings(String(it.servings));
    setSelectedCategory(it.category);
    setEditingId(it.id);
  };

  const removeItem = (id: string) => {
    const next = { ...logs };
    const list = (next[key] ?? []).filter(x => x.id !== id);
    next[key] = list;
    saveLogs(next);
    if (editingId === id) resetForm();
  };

  const changeDay = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d);
  };

  const quickAdd = (kcal: number) => {
    const next = { ...logs };
    const now = new Date().toISOString();
    const list = next[key] ? [...next[key]] : [];
    list.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: `Quick +${kcal} kcal`,
      calories: kcal,
      servings: 1,
      category: 'snack',
      createdAt: now,
    });
    next[key] = list;
    saveLogs(next);
  };

  const addFromFavorite = (fav: FavoriteFood) => {
    setName(fav.name);
    setCalories(String(fav.calories));
    setServings('1');
    setShowFavorites(false);
  };

  const exportData = async () => {
    try {
      const data = JSON.stringify({ logs, favorites, settings }, null, 2);
      Alert.alert('Export Data', `Data ready for export:\n\n${data.slice(0, 200)}...`);
    } catch (e) {
      Alert.alert('Export Error', 'Failed to export data');
    }
  };

  const filteredFavorites = favorites
    .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => b.usageCount - a.usageCount);

  // UI helpers
  const renderTabButton = (mode: ViewMode, title: string, icon: string) => (
    <TouchableOpacity
      style={[styles.tabBtn, viewMode === mode && styles.tabBtnActive]}
      onPress={() => setViewMode(mode)}
    >
      <Text style={[styles.tabBtnText, viewMode === mode && styles.tabBtnTextActive]}>
        {icon} {title}
      </Text>
    </TouchableOpacity>
  );

  const renderCategoryButton = (category: Entry['category'], title: string, color: string) => (
    <TouchableOpacity
      style={[styles.categoryBtn, { borderColor: color }, selectedCategory === category && { backgroundColor: color + '20' }]}
      onPress={() => setSelectedCategory(category)}
    >
      <Text style={[styles.categoryText, { color }, selectedCategory === category && styles.categoryTextActive]}>
        {title}
      </Text>
    </TouchableOpacity>
  );

  const renderWeeklyChart = () => (
    <View style={styles.chartContainer}>
      <Text style={styles.chartTitle}>สัปดาห์นี้</Text>
      <View style={styles.chartRow}>
        {weeklyData.map((data, idx) => {
          const height = Math.min(100, (data.calories / data.goal) * 100);
          return (
            <View key={idx} style={styles.chartBar}>
              <View style={styles.chartBarContainer}>
                <View style={[styles.chartBarFill, { height: `${height}%` }]} />
              </View>
              <Text style={styles.chartLabel}>{data.day}</Text>
              <Text style={styles.chartValue}>{data.calories}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );

  const renderMealSummary = () => (
    <View style={styles.mealSummary}>
      <Text style={styles.mealTitle}>สรุปตามมื้อ</Text>
      {Object.entries(mealTotals).map(([category, total]) => {
        const colors = { breakfast: '#f59e0b', lunch: '#10b981', dinner: '#3b82f6', snack: '#8b5cf6' };
        const names = { breakfast: 'เช้า', lunch: 'กลางวัน', dinner: 'เย็น', snack: 'ของว่าง' };
        const percentage = totalKcal > 0 ? (total / totalKcal) * 100 : 0;
        
        return (
          <View key={category} style={styles.mealRow}>
            <View style={[styles.mealIndicator, { backgroundColor: colors[category as keyof typeof colors] }]} />
            <Text style={styles.mealName}>{names[category as keyof typeof names]}</Text>
            <Text style={styles.mealCalories}>{total} kcal</Text>
            <Text style={styles.mealPercent}>({percentage.toFixed(0)}%)</Text>
          </View>
        );
      })}
    </View>
  );

  // Main render
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <View style={styles.container}>

        {/* ✅ ปุ่มกลับหน้า Home */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)/Homesrceen')}
            style={styles.homeBtn}
            activeOpacity={0.85}
          >
            <Text style={styles.homeBtnText}>← กลับหน้า Home</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Navigation */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabContainer}>
          {renderTabButton('daily', 'รายวัน', '📅')}
          {renderTabButton('weekly', 'สัปดาห์', '📊')}
          {renderTabButton('favorites', 'รายการโปรด', '⭐')}
          {renderTabButton('settings', 'ตั้งค่า', '⚙️')}
        </ScrollView>

        {/* Daily View */}
        {viewMode === 'daily' && (
          <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
            {/* Header with date controls */}
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.navDayBtn} onPress={() => changeDay(-1)}>
                <Text style={styles.navDayText}>‹ เมื่อวาน</Text>
              </TouchableOpacity>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.title}>นับแคลอรี่</Text>
                <Text style={styles.dateText}>
                  {selectedDate.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </Text>
              </View>
              <TouchableOpacity style={styles.navDayBtn} onPress={() => changeDay(1)}>
                <Text style={styles.navDayText}>พรุ่งนี้ ›</Text>
              </TouchableOpacity>
            </View>

            {/* Target & progress */}
            <View style={styles.targetCard}>
              <View style={styles.rowBetween}>
                <Text style={styles.targetLabel}>เป้าหมาย/วัน</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.targetValue}>{settings.dailyGoal} kcal</Text>
                  <Text style={styles.streakText}>🔥 {streak} วันติดต่อกัน</Text>
                </View>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.totalText}>
                วันนี้รับแล้ว <Text style={styles.totalStrong}>{totalKcal}</Text> / {settings.dailyGoal} kcal
                {progress >= 1 && <Text style={styles.goalReached}> 🎉 บรรลุเป้าแล้ว!</Text>}
              </Text>
            </View>

            {/* Meal Summary */}
            {settings.showMealCategories && renderMealSummary()}

            {/* Quick add */}
            <View style={styles.quickRow}>
              {[100, 250, 500].map(k => (
                <TouchableOpacity key={k} style={styles.quickBtn} onPress={() => quickAdd(k)}>
                  <Text style={styles.quickText}>+{k}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.favBtn} onPress={() => setShowFavorites(true)}>
                <Text style={styles.favText}>⭐</Text>
              </TouchableOpacity>
            </View>

            {/* Form */}
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="ชื่ออาหาร/เมนู"
                value={name}
                onChangeText={setName}
              />
              
              {/* Category selection */}
              {settings.showMealCategories && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow}>
                  {renderCategoryButton('breakfast', 'เช้า', '#f59e0b')}
                  {renderCategoryButton('lunch', 'กลางวัน', '#10b981')}
                  {renderCategoryButton('dinner', 'เย็น', '#3b82f6')}
                  {renderCategoryButton('snack', 'ของว่าง', '#8b5cf6')}
                </ScrollView>
              )}

              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="แคลอรี่/หน่วย (kcal)"
                    keyboardType="numeric"
                    value={calories}
                    onChangeText={(t) => setCalories(t.replace(/[^\d.]/g, ''))}
                  />
                </View>
                <View style={{ width: 120 }}>
                  <TextInput
                    style={styles.input}
                    placeholder="จำนวน"
                    keyboardType="numeric"
                    value={servings}
                    onChangeText={(t) => setServings(t.replace(/[^\d.]/g, ''))}
                  />
                </View>
              </View>

              <TouchableOpacity style={styles.addBtn} onPress={addOrUpdate}>
                <Text style={styles.addBtnText}>{editingId ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}</Text>
              </TouchableOpacity>
            </View>

            {/* List */}
            {dayList.length === 0 ? (
              <Text style={styles.emptyText}>ยังไม่มีรายการสำหรับวันนี้</Text>
            ) : (
              <View>
                {dayList.map((item) => {
                  const kcal = item.calories * item.servings;
                  const categoryColors = { breakfast: '#f59e0b', lunch: '#10b981', dinner: '#3b82f6', snack: '#8b5cf6' };
                  const categoryNames = { breakfast: 'เช้า', lunch: 'กลางวัน', dinner: 'เย็น', snack: 'ของว่าง' };
                  return (
                    <View key={item.id} style={styles.item}>
                      {settings.showMealCategories && (
                        <View style={[styles.categoryIndicator, { backgroundColor: categoryColors[item.category] }]} />
                      )}
                      <View style={{ flex: 1 }}>
                        <View style={styles.itemHeader}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          {settings.showMealCategories && (
                            <Text style={[styles.itemCategory, { color: categoryColors[item.category] }]}>
                              {categoryNames[item.category]}
                            </Text>
                          )}
                        </View>
                        <Text style={styles.itemSub}>
                          {item.calories} × {item.servings} = <Text style={styles.bold}>{kcal}</Text> kcal
                        </Text>
                        <Text style={styles.itemTime}>
                          {new Date(item.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </View>
                      <View style={styles.itemActions}>
                        <TouchableOpacity style={styles.itemBtn} onPress={() => editItem(item)}>
                          <Text style={styles.itemBtnText}>แก้ไข</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.itemBtn, { backgroundColor: '#ef4444' }]} onPress={() => removeItem(item.id)}>
                          <Text style={styles.itemBtnText}>ลบ</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

        {/* Weekly View */}
        {viewMode === 'weekly' && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.title}>สรุปรายสัปดาห์</Text>
            {renderWeeklyChart()}
            
            <View style={styles.weeklyStats}>
              <Text style={styles.statsTitle}>สถิติสัปดาห์นี้</Text>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>เฉลี่ย/วัน:</Text>
                <Text style={styles.statValue}>
                  {Math.round(weeklyData.reduce((sum, d) => sum + d.calories, 0) / 7)} kcal
                </Text>
              </View>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>วันที่บรรลุเป้า:</Text>
                <Text style={styles.statValue}>
                  {weeklyData.filter(d => d.calories >= d.goal).length}/7 วัน
                </Text>
              </View>
            </View>
          </ScrollView>
        )}

        {/* Favorites View */}
        {viewMode === 'favorites' && (
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>รายการโปรด</Text>
            <TextInput
              style={[styles.input, { margin: 16 }]}
              placeholder="ค้นหาอาหาร..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <FlatList
              data={filteredFavorites}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.favoriteItem} onPress={() => addFromFavorite(item)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.favoriteName}>{item.name}</Text>
                    <Text style={styles.favoriteDetails}>
                      {item.calories} kcal • ใช้ {item.usageCount} ครั้ง
                    </Text>
                  </View>
                  <Text style={styles.favoriteAdd}>เพิ่ม ›</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Settings View */}
        {viewMode === 'settings' && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={styles.title}>ตั้งค่า</Text>
            
            <View style={styles.settingSection}>
              <Text style={styles.settingTitle}>เป้าหมายแคลอรี่รายวัน</Text>
              <TextInput
                style={styles.input}
                placeholder="เป้าหมาย kcal/วัน"
                keyboardType="numeric"
                value={String(settings.dailyGoal)}
                onChangeText={(text) => {
                  const goal = parseNum(text);
                  if (goal > 0) saveSettings({ ...settings, dailyGoal: goal });
                }}
              />
            </View>

            <View style={styles.settingSection}>
              <Text style={styles.settingTitle}>โหมดเป้าหมาย</Text>
              <View style={styles.goalModeRow}>
                {[
                  { value: 'lose', label: 'ลดน้ำหนัก', color: '#ef4444' },
                  { value: 'maintain', label: 'คงน้ำหนัก', color: '#10b981' },
                  { value: 'gain', label: 'เพิ่มน้ำหนัก', color: '#3b82f6' },
                ].map(mode => (
                  <TouchableOpacity
                    key={mode.value}
                    style={[
                      styles.goalModeBtn,
                      { borderColor: mode.color },
                      settings.goalMode === mode.value && { backgroundColor: mode.color + '20' }
                    ]}
                    onPress={() => saveSettings({ ...settings, goalMode: mode.value as Settings['goalMode'] })}
                  >
                    <Text style={[styles.goalModeText, { color: mode.color }]}>
                      {mode.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.settingSection}>
              <View style={styles.settingRow}>
                <Text style={styles.settingTitle}>แสดงหมวดหมู่มื้ออาหาร</Text>
                <Switch
                  value={settings.showMealCategories}
                  onValueChange={(value) => saveSettings({ ...settings, showMealCategories: value })}
                  trackColor={{ false: '#e5e7eb', true: '#8b5cf6' }}
                  thumbColor={settings.showMealCategories ? '#ffffff' : '#f4f3f4'}
                />
              </View>
            </View>

            <View style={styles.settingSection}>
              <Text style={styles.settingTitle}>ข้อมูลและสำรอง</Text>
              <TouchableOpacity style={styles.exportBtn} onPress={exportData}>
                <Text style={styles.exportBtnText}>📤 ส่งออกข้อมูล</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.settingSection}>
              <Text style={styles.settingTitle}>สถิติโดยรวม</Text>
              <View style={styles.overallStats}>
                <View style={styles.overallStatItem}>
                  <Text style={styles.overallStatValue}>{Object.keys(logs).length}</Text>
                  <Text style={styles.overallStatLabel}>วันที่บันทึก</Text>
                </View>
                <View style={styles.overallStatItem}>
                  <Text style={styles.overallStatValue}>{favorites.length}</Text>
                  <Text style={styles.overallStatLabel}>รายการโปรด</Text>
                </View>
                <View style={styles.overallStatItem}>
                  <Text style={styles.overallStatValue}>{streak}</Text>
                  <Text style={styles.overallStatLabel}>วันติดต่อกัน</Text>
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {/* Favorites Modal */}
        <Modal
          visible={showFavorites}
          animationType="slide"
          presentationStyle="pageSheet"
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>รายการโปรด</Text>
              <TouchableOpacity onPress={() => setShowFavorites(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <TextInput
              style={[styles.input, { margin: 16 }]}
              placeholder="ค้นหาอาหาร..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            <FlatList
              data={filteredFavorites}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.favoriteItem} onPress={() => addFromFavorite(item)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.favoriteName}>{item.name}</Text>
                    <Text style={styles.favoriteDetails}>
                      {item.calories} kcal • ใช้ {item.usageCount} ครั้ง
                    </Text>
                  </View>
                  <Text style={styles.favoriteAdd}>เลือก</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>ไม่พบรายการโปรด</Text>
              }
            />
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },

  // ✅ Top bar
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: '#F8F8F8',
  },
  homeBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#e0e7ff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  homeBtnText: { color: '#3730a3', fontWeight: '800' },

  // Tab Navigation
  tabContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
  },
  tabBtnActive: {
    backgroundColor: '#8b5cf6',
  },
  tabBtnText: {
    color: '#6b7280',
    fontWeight: '600',
    fontSize: 14,
  },
  tabBtnTextActive: {
    color: '#fff',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  navDayBtn: { padding: 8 },
  navDayText: { color: '#8b5cf6', fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '800', color: '#111', textAlign: 'center' },
  dateText: { fontSize: 12, color: '#666', marginTop: 2 },

  // Target Card
  targetCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  targetLabel: { fontWeight: '700', color: '#111', fontSize: 16 },
  targetValue: { fontWeight: '800', color: '#111', fontSize: 18 },
  streakText: { fontSize: 12, color: '#8b5cf6', marginTop: 2 },
  progressBar: {
    height: 12,
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8b5cf6',
    borderRadius: 8,
  },
  totalText: { marginTop: 12, color: '#444', fontSize: 15 },
  totalStrong: { fontWeight: '800', color: '#111' },
  goalReached: { color: '#10b981', fontWeight: '700' },

  // Meal Summary
  mealSummary: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  mealTitle: { fontWeight: '700', color: '#111', fontSize: 16, marginBottom: 12 },
  mealRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  mealIndicator: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  mealName: { flex: 1, color: '#444', fontWeight: '600' },
  mealCalories: { fontWeight: '700', color: '#111', marginRight: 8 },
  mealPercent: { color: '#666', fontSize: 12 },

  // Quick Actions
  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#e0e7ff',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  quickText: { color: '#3730a3', fontWeight: '800' },
  favBtn: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  favText: { fontSize: 16 },

  // Form
  form: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  input: {
    height: 48,
    borderColor: '#d1d5db',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    marginBottom: 12,
    fontSize: 16,
  },
  row: { flexDirection: 'row' },
  categoryRow: { marginBottom: 12 },
  categoryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    marginRight: 8,
  },
  categoryText: { fontWeight: '600', fontSize: 14 },
  categoryTextActive: { fontWeight: '700' },
  addBtn: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },

  // Items
  item: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    position: 'relative',
  },
  categoryIndicator: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontWeight: '800', color: '#111', fontSize: 16, flex: 1 },
  itemCategory: { fontSize: 12, fontWeight: '600' },
  itemSub: { color: '#444', marginTop: 4, fontSize: 14 },
  bold: { fontWeight: '800' },
  itemTime: { color: '#888', fontSize: 12, marginTop: 4 },
  itemActions: { justifyContent: 'center', gap: 6, marginLeft: 12 },
  itemBtn: {
    backgroundColor: '#8b5cf6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  itemBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Weekly Chart
  chartContainer: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chartTitle: { fontWeight: '700', color: '#111', fontSize: 16, marginBottom: 16 },
  chartRow: { flexDirection: 'row', justifyContent: 'space-between' },
  chartBar: { alignItems: 'center', flex: 1 },
  chartBarContainer: {
    height: 100,
    width: 20,
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  chartBarFill: { backgroundColor: '#8b5cf6', width: '100%', borderRadius: 10 },
  chartLabel: { fontSize: 12, color: '#666', marginTop: 8 },
  chartValue: { fontSize: 11, color: '#888', marginTop: 2 },

  weeklyStats: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  statsTitle: { fontWeight: '700', color: '#111', fontSize: 16, marginBottom: 12 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  statLabel: { color: '#666' },
  statValue: { fontWeight: '700', color: '#111' },

  // Favorites
  favoriteItem: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
  },
  favoriteName: { fontWeight: '700', color: '#111', fontSize: 16 },
  favoriteDetails: { color: '#666', marginTop: 4 },
  favoriteAdd: { color: '#8b5cf6', fontWeight: '700' },

  // Settings
  settingSection: { marginBottom: 24 },
  settingTitle: { fontWeight: '700', color: '#111', fontSize: 16, marginBottom: 12 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalModeRow: { flexDirection: 'row', gap: 8 },
  goalModeBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  goalModeText: { fontWeight: '600' },
  exportBtn: {
    backgroundColor: '#f3f4f6',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  exportBtnText: { color: '#374151', fontWeight: '600' },
  overallStats: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  overallStatItem: { flex: 1, alignItems: 'center' },
  overallStatValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#8b5cf6',
  },
  overallStatLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#F8F8F8' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  modalClose: { fontSize: 20, color: '#666' },

  emptyText: { textAlign: 'center', color: '#777', marginTop: 20, fontSize: 16 },
});
