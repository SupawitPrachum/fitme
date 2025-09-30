// app/(tabs)/AIRecommendationScreen.tsx
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Switch,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';

const AUTH_KEY = 'auth_token';
const USER_PREFS_KEY = 'user_food_preferences';
const API_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

type Macro = { p: number; c: number; f: number };
type Meal = { 
  name: string; 
  kcal: number; 
  macros?: Macro; 
  note?: string;
  ingredients?: string[];
  cookingTime?: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  cost?: 'low' | 'medium' | 'high';
};

type MealPlanResponse = { 
  dayTotalKcal: number; 
  meals: Meal[];
  nutritionSummary?: {
    totalProtein: number;
    totalCarbs: number;
    totalFat: number;
    fiber?: number;
    sugar?: number;
  };
};

type UserPreferences = {
  height?: number;
  weight?: number;
  age?: number;
  gender?: 'male' | 'female';
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  goal?: 'lose' | 'maintain' | 'gain';
  medicalConditions?: string[];
  favoriteCuisines?: string[];
  cookingSkill?: 'beginner' | 'intermediate' | 'advanced';
  budget?: 'low' | 'medium' | 'high';
  mealPrepTime?: number; // minutes
};

export default function AIRecommendationScreen() {
  const [calories, setCalories] = useState<string>('2000');
  const [meals, setMeals] = useState<string>('3');
  const [diet, setDiet] = useState<string>('balanced');
  const [avoid, setAvoid] = useState<string>('');
  
  // New enhanced features
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [cuisineType, setCuisineType] = useState<string>('thai');
  const [maxCookTime, setMaxCookTime] = useState<string>('60');
  const [budget, setBudget] = useState<string>('medium');
  const [includeIngredients, setIncludeIngredients] = useState<string>('');
  const [mealTiming, setMealTiming] = useState<string[]>(['breakfast', 'lunch', 'dinner']);
  const [showPrefsModal, setShowPrefsModal] = useState(false);
  const [generateShoppingList, setGenerateShoppingList] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState(false);

  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<MealPlanResponse | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [shoppingList, setShoppingList] = useState<string[]>([]);

  // Load user preferences on mount
  useEffect(() => {
    loadUserPreferences();
  }, []);

  const loadUserPreferences = async () => {
    try {
      const prefs = await AsyncStorage.getItem(USER_PREFS_KEY);
      if (prefs) {
        const parsed = JSON.parse(prefs);
        setUserPrefs(parsed);
        // Auto-calculate calories if user has physical data
        if (parsed.weight && parsed.height && parsed.age && parsed.gender) {
          const calculatedCalories = calculateBMR(parsed);
          setCalories(calculatedCalories.toString());
        }
      }
    } catch (error) {
      console.log('Error loading preferences:', error);
    }
  };

  const saveUserPreferences = async (prefs: UserPreferences) => {
    try {
      await AsyncStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
      setUserPrefs(prefs);
    } catch (error) {
      console.log('Error saving preferences:', error);
    }
  };

  // Calculate BMR (Basal Metabolic Rate) using Harris-Benedict equation
  const calculateBMR = (prefs: UserPreferences): number => {
    if (!prefs.weight || !prefs.height || !prefs.age || !prefs.gender) return 2000;
    
    let bmr: number;
    if (prefs.gender === 'male') {
      bmr = 88.362 + (13.397 * prefs.weight) + (4.799 * prefs.height) - (5.677 * prefs.age);
    } else {
      bmr = 447.593 + (9.247 * prefs.weight) + (3.098 * prefs.height) - (4.330 * prefs.age);
    }

    // Apply activity level multiplier
    const activityMultipliers = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9
    };

    const multiplier = activityMultipliers[prefs.activityLevel || 'moderate'];
    let totalCalories = bmr * multiplier;

    // Adjust for goal
    if (prefs.goal === 'lose') totalCalories *= 0.85; // 15% deficit
    if (prefs.goal === 'gain') totalCalories *= 1.15; // 15% surplus

    return Math.round(totalCalories);
  };

  const kcalNum = useMemo(() => {
    const n = parseInt(calories, 10);
    return Number.isFinite(n) && n > 0 ? n : 2000;
  }, [calories]);

  const mealsNum = useMemo(() => {
    const n = parseInt(meals, 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
  }, [meals]);

  const doGenerate = useCallback(async () => {
    try {
      setLoading(true);
      const token = await AsyncStorage.getItem(AUTH_KEY);
      if (!token) {
        Alert.alert('เธ•เนเธญเธเธฅเนเธญเธเธญเธดเธเธเนเธญเธ', 'เธเธฃเธธเธ“เธฒเน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธเน€เธเธทเนเธญเนเธเน AI เนเธเธฐเธเธณเธญเธฒเธซเธฒเธฃ');
        router.replace('/(tabs)/login');
        return;
      }

      // Enhanced request payload
      const requestBody = {
        daily_kcal: kcalNum,
        meals: mealsNum,
        diet,
        avoid,
        cuisine_type: cuisineType,
        max_cooking_time: parseInt(maxCookTime, 10) || 60,
        budget,
        include_ingredients: includeIngredients,
        meal_timing: mealTiming,
        user_preferences: userPrefs,
        generate_shopping_list: generateShoppingList,
        weekly_plan: weeklyPlan,
        // Additional context for AI
        context: {
          cooking_skill: userPrefs.cookingSkill || 'intermediate',
          medical_conditions: userPrefs.medicalConditions || [],
          favorite_cuisines: userPrefs.favoriteCuisines || [],
        }
      };

      const res = await fetch(`${API_URL}/api/ai/meal-suggest`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(requestBody),
      });

      if (res.status === 401) {
        await AsyncStorage.removeItem(AUTH_KEY);
        Alert.alert('เธซเธกเธ”เน€เธงเธฅเธฒ', 'เธเธฃเธธเธ“เธฒเธฅเนเธญเธเธญเธดเธเนเธซเธกเน');
        router.replace('/(tabs)/login');
        return;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(txt || `HTTP ${res.status}`);
      }

      const raw = await res.json().catch(() => ({}));
      
      if (raw && typeof raw === 'object' && Array.isArray(raw.meals)) {
        setPlan(raw as MealPlanResponse);
        setAiText(null);
        
        // Extract shopping list if available
        if (raw.shopping_list && Array.isArray(raw.shopping_list)) {
          setShoppingList(raw.shopping_list);
        } else if (generateShoppingList && raw.meals) {
          // Generate shopping list from ingredients
          const ingredients = raw.meals
            .flatMap((meal: Meal) => meal.ingredients || [])
            .filter((item: string, index: number, array: string[]) => 
              array.indexOf(item) === index
            );
          setShoppingList(ingredients);
        }
      } else if (typeof raw === 'string') {
        setAiText(raw);
        setPlan(null);
      } else if (raw?.text) {
        setAiText(String(raw.text));
        setPlan(null);
      } else {
        setAiText(JSON.stringify(raw));
        setPlan(null);
      }
    } catch (e: any) {
      Alert.alert('เธชเธฃเนเธฒเธเนเธเธเธญเธฒเธซเธฒเธฃเนเธกเนเธชเธณเน€เธฃเนเธ', e?.message ?? 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”');
    } finally {
      setLoading(false);
    }
  }, [kcalNum, mealsNum, diet, avoid, cuisineType, maxCookTime, budget, includeIngredients, mealTiming, userPrefs, generateShoppingList, weeklyPlan]);

  const totalFromMeals = useMemo(() => {
    if (!plan?.meals?.length) return 0;
    return Math.round(plan.meals.reduce((s, m) => s + (Number(m.kcal) || 0), 0));
  }, [plan]);

  const reset = () => { 
    setPlan(null); 
    setAiText(null); 
    setShoppingList([]);
  };

  const saveMealPlan = async () => {
    if (!plan) return;
    try {
      const savedPlans = await AsyncStorage.getItem('saved_meal_plans') || '[]';
      const plans = JSON.parse(savedPlans);
      plans.push({
        id: Date.now(),
        date: new Date().toISOString(),
        plan,
        preferences: { calories: kcalNum, meals: mealsNum, diet, avoid }
      });
      await AsyncStorage.setItem('saved_meal_plans', JSON.stringify(plans));
      Alert.alert('เธเธฑเธเธ—เธถเธเนเธฅเนเธง', 'เนเธเธเธญเธฒเธซเธฒเธฃเธ–เธนเธเธเธฑเธเธ—เธถเธเน€เธฃเธตเธขเธเธฃเนเธญเธขเนเธฅเนเธง');
    } catch (error) {
      Alert.alert('เนเธกเนเธชเธฒเธกเธฒเธฃเธ–เธเธฑเธเธ—เธถเธ', 'เน€เธเธดเธ”เธเนเธญเธเธดเธ”เธเธฅเธฒเธ”เนเธเธเธฒเธฃเธเธฑเธเธ—เธถเธ');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F7F8FA' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.title}>๐ค– AI เนเธเธฐเธเธณเธญเธฒเธซเธฒเธฃเธญเธฑเธเธเธฃเธดเธขเธฐ</Text>
        <Text style={styles.subtitle}>
          เธชเธฃเนเธฒเธเน€เธกเธเธน {mealsNum} เธกเธทเนเธญ เธเธฃเธฐเธกเธฒเธ“ {kcalNum} kcal/เธงเธฑเธ โ€ข เธชเนเธ•เธฅเน {dietLabel(diet)}
          {userPrefs.weight && userPrefs.height && (
            <Text style={styles.bmiInfo}>
              {'\n'}BMI: {((userPrefs.weight / ((userPrefs.height/100) ** 2)).toFixed(1))}
            </Text>
          )}
        </Text>

        {/* User Profile Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.secTitle}>โ๏ธ เนเธเธฃเนเธเธฅเนเนเธฅเธฐเธเธฒเธฃเธ•เธฑเนเธเธเนเธฒ</Text>
            <TouchableOpacity 
              style={styles.linkBtn} 
              onPress={() => setShowPrefsModal(true)}
            >
              <Text style={styles.linkText}>เนเธเนเนเธ</Text>
            </TouchableOpacity>
          </View>
          
          {userPrefs.weight || userPrefs.height ? (
            <Text style={styles.meta}>
              เธเนเธณเธซเธเธฑเธ: {userPrefs.weight || '-'} kg โ€ข เธชเนเธงเธเธชเธนเธ: {userPrefs.height || '-'} cm
              {userPrefs.age && ` โ€ข เธญเธฒเธขเธธ: ${userPrefs.age} เธเธต`}
            </Text>
          ) : (
            <Text style={styles.metaWarning}>
              ๐’ก เน€เธเธดเนเธกเธเนเธญเธกเธนเธฅเธชเนเธงเธเธ•เธฑเธงเน€เธเธทเนเธญเนเธซเน AI เนเธเธฐเธเธณเนเธ”เนเนเธกเนเธเธขเธณเธเธถเนเธ
            </Text>
          )}
        </View>

        {/* Basic Settings */}
        <View style={styles.card}>
          <Text style={styles.secTitle}>๐ฏ เธ•เธฑเนเธเธเนเธฒเธเธทเนเธเธเธฒเธ</Text>

          <View style={styles.row}>
            <View style={styles.inputBox}>
              <Text style={styles.label}>เนเธเธฅเธญเธฃเธตเน/เธงเธฑเธ</Text>
              <TextInput
                value={calories}
                onChangeText={setCalories}
                keyboardType="numeric"
                placeholder="2000"
                style={styles.input}
              />
            </View>
            <View style={styles.inputBox}>
              <Text style={styles.label}>เธเธณเธเธงเธเธกเธทเนเธญ</Text>
              <TextInput
                value={meals}
                onChangeText={setMeals}
                keyboardType="numeric"
                placeholder="3"
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>เธชเนเธ•เธฅเนเธญเธฒเธซเธฒเธฃ</Text>
          <View style={styles.pillRow}>
            {['balanced', 'low_carb', 'high_protein', 'vegetarian', 'vegan', 'keto'].map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setDiet(k)}
                style={[styles.pill, diet === k && styles.pillActive]}
              >
                <Text style={[styles.pillText, diet === k && styles.pillTextActive]}>
                  {dietLabel(k)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>เธเธฃเธฐเน€เธ เธ—เธญเธฒเธซเธฒเธฃ</Text>
          <View style={styles.pillRow}>
            {['thai', 'international', 'asian', 'western', 'fusion'].map((k) => (
              <TouchableOpacity
                key={k}
                onPress={() => setCuisineType(k)}
                style={[styles.pill, cuisineType === k && styles.pillActive]}
              >
                <Text style={[styles.pillText, cuisineType === k && styles.pillTextActive]}>
                  {cuisineLabel(k)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Advanced Settings */}
        <View style={styles.card}>
          <TouchableOpacity 
            style={styles.headerRow}
            onPress={() => setShowAdvanced(!showAdvanced)}
          >
            <Text style={styles.secTitle}>โก เธ•เธฑเนเธเธเนเธฒเธเธฑเนเธเธชเธนเธ</Text>
            <Text style={styles.linkText}>{showAdvanced ? 'โ–ผ' : 'โ–ถ'}</Text>
          </TouchableOpacity>

          {showAdvanced && (
            <>
              <View style={styles.row}>
                <View style={styles.inputBox}>
                  <Text style={styles.label}>เน€เธงเธฅเธฒเธ—เธณเธญเธฒเธซเธฒเธฃเธชเธนเธเธชเธธเธ” (เธเธฒเธ—เธต)</Text>
                  <TextInput
                    value={maxCookTime}
                    onChangeText={setMaxCookTime}
                    keyboardType="numeric"
                    placeholder="60"
                    style={styles.input}
                  />
                </View>
                <View style={styles.inputBox}>
                  <Text style={styles.label}>เธเธเธเธฃเธฐเธกเธฒเธ“</Text>
                  <View style={styles.pillRow}>
                    {['low', 'medium', 'high'].map((k) => (
                      <TouchableOpacity
                        key={k}
                        onPress={() => setBudget(k)}
                        style={[styles.miniPill, budget === k && styles.pillActive]}
                      >
                        <Text style={[styles.pillText, budget === k && styles.pillTextActive]}>
                          {budgetLabel(k)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <Text style={styles.label}>เธงเธฑเธ•เธ–เธธเธ”เธดเธเธ—เธตเนเธกเธตเธญเธขเธนเน (เนเธขเธเธ”เนเธงเธขเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธขเธเธธเธฅเธ เธฒเธ)</Text>
              <TextInput
                value={includeIngredients}
                onChangeText={setIncludeIngredients}
                placeholder="เน€เธเนเธ เนเธเน, เธเนเธฒเธง, เธกเธฐเน€เธเธทเธญเน€เธ—เธจ"
                style={[styles.input, { height: 44 }]}
              />

              <Text style={styles.label}>เธซเธฅเธตเธเน€เธฅเธตเนเธขเธ (เน€เธเนเธ เธเธธเนเธ, เธ–เธฑเนเธงเธฅเธดเธชเธ)</Text>
              <TextInput
                value={avoid}
                onChangeText={setAvoid}
                placeholder="เน€เธเนเธ เธเธธเนเธ, เธ–เธฑเนเธงเธฅเธดเธชเธ, เนเธเนเธเธเธฑเธ”เธชเธต"
                style={[styles.input, { height: 44 }]}
              />

              <View style={styles.switchRow}>
                <Text style={styles.label}>เธชเธฃเนเธฒเธเธฃเธฒเธขเธเธฒเธฃเธเธทเนเธญเธเธญเธ</Text>
                <Switch
                  value={generateShoppingList}
                  onValueChange={setGenerateShoppingList}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.label}>เนเธเธเธญเธฒเธซเธฒเธฃเธฃเธฒเธขเธชเธฑเธเธ”เธฒเธซเน</Text>
                <Switch
                  value={weeklyPlan}
                  onValueChange={setWeeklyPlan}
                />
              </View>
            </>
          )}
        </View>

        {/* Generate Button */}
        <TouchableOpacity
          style={[styles.btn, styles.primaryBtn, loading && { opacity: 0.7 }]}
          onPress={doGenerate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.btnText, { color: '#fff' }]}>
              ๐จ เนเธซเน AI เธชเธฃเนเธฒเธเนเธเธเธญเธฒเธซเธฒเธฃเธญเธฑเธเธเธฃเธดเธขเธฐ
            </Text>
          )}
        </TouchableOpacity>

        {/* Results - Structured */}
        {plan && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.secTitle}>๐ฝ๏ธ เนเธเธเธญเธฒเธซเธฒเธฃเธชเธณเธซเธฃเธฑเธเธเธธเธ“</Text>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.miniBtn} onPress={saveMealPlan}>
                  <Text style={styles.miniBtnText}>๐’พ เธเธฑเธเธ—เธถเธ</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.miniBtn} onPress={reset}>
                  <Text style={styles.miniBtnText}>๐—‘๏ธ เธฅเนเธฒเธ</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Nutrition Summary */}
            <View style={styles.nutritionCard}>
              <Text style={styles.nutritionTitle}>๐“ เธชเธฃเธธเธเธเธธเธ“เธเนเธฒเธ—เธฒเธเนเธ เธเธเธฒเธเธฒเธฃ</Text>
              <Text style={styles.meta}>
                เนเธเธฅเธญเธฃเธตเนเธฃเธงเธก: <Text style={styles.bold}>{totalFromMeals} kcal</Text>
              </Text>
              {plan.nutritionSummary && (
                <Text style={styles.macroLine}>
                  P {plan.nutritionSummary.totalProtein}g โ€ข 
                  C {plan.nutritionSummary.totalCarbs}g โ€ข 
                  F {plan.nutritionSummary.totalFat}g
                </Text>
              )}
            </View>

            {/* Meals */}
            <View style={{ marginTop: 10 }}>
              {plan.meals.map((m, i) => (
                <View key={i} style={styles.enhancedMealCard}>
                  <View style={styles.mealHeader}>
                    <Text style={styles.mealName}>
                      ๐ฝ๏ธ {getMealIcon(i)} {m.name}
                    </Text>
                    <Text style={styles.mealKcal}>โ {Math.round(m.kcal)} kcal</Text>
                  </View>

                  {m.macros && (
                    <Text style={styles.macroLine}>
                      P {m.macros.p}g โ€ข C {m.macros.c}g โ€ข F {m.macros.f}g
                    </Text>
                  )}

                  {m.cookingTime && (
                    <Text style={styles.mealMeta}>
                      โฑ๏ธ เน€เธงเธฅเธฒเธ—เธณ: {m.cookingTime} เธเธฒเธ—เธต
                    </Text>
                  )}

                  {m.difficulty && (
                    <Text style={styles.mealMeta}>
                      ๐”ฅ เธเธงเธฒเธกเธขเธฒเธ: {difficultyLabel(m.difficulty)}
                    </Text>
                  )}

                  {m.cost && (
                    <Text style={styles.mealMeta}>
                      ๐’ฐ เธเนเธฒเนเธเนเธเนเธฒเธข: {costLabel(m.cost)}
                    </Text>
                  )}

                  {m.ingredients && m.ingredients.length > 0 && (
                    <View style={styles.ingredientsSection}>
                      <Text style={styles.ingredientsTitle}>๐ฅ เธงเธฑเธ•เธ–เธธเธ”เธดเธ:</Text>
                      <Text style={styles.ingredients}>
                        {m.ingredients.join(', ')}
                      </Text>
                    </View>
                  )}

                  {m.note && (
                    <Text style={styles.note}>๐’ก {m.note}</Text>
                  )}
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.btn, { marginTop: 10 }]}
              onPress={doGenerate}
            >
              <Text style={styles.btnText}>๐ฒ เธชเธธเนเธกเนเธซเธกเน / เธชเธฃเนเธฒเธเธญเธตเธเธเธฃเธฑเนเธ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Shopping List */}
        {shoppingList.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.secTitle}>๐’ เธฃเธฒเธขเธเธฒเธฃเธเธทเนเธญเธเธญเธ</Text>
            <View style={styles.shoppingList}>
              {shoppingList.map((item, index) => (
                <Text key={index} style={styles.shoppingItem}>
                  โ€ข {item}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* AI Text Result (fallback) */}
        {aiText && !plan && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.secTitle}>๐ค– เธเนเธญเน€เธชเธเธฐเนเธเธฐเธเธฒเธ AI</Text>
              <TouchableOpacity style={styles.linkBtn} onPress={reset}>
                <Text style={styles.linkText}>เธฅเนเธฒเธเธเธฅเธฅเธฑเธเธเน</Text>
              </TouchableOpacity>
            </View>
            {aiText.split('\n').map((line, i) => (
              <Text key={i} style={styles.meta}>{line}</Text>
            ))}
            <TouchableOpacity style={[styles.btn, { marginTop: 10 }]} onPress={doGenerate}>
              <Text style={styles.btnText}>๐ฒ เธชเธธเนเธกเนเธซเธกเน / เธชเธฃเนเธฒเธเธญเธตเธเธเธฃเธฑเนเธ</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* User Preferences Modal */}
        <Modal
          visible={showPrefsModal}
          animationType="slide"
          presentationStyle="pageSheet"
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>๐‘ค เธเนเธญเธกเธนเธฅเธชเนเธงเธเธ•เธฑเธง</Text>
              <TouchableOpacity onPress={() => setShowPrefsModal(false)}>
                <Text style={styles.closeBtn}>โ•</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.modalContent}>
              <UserPreferencesForm
                preferences={userPrefs}
                onSave={(prefs) => {
                  saveUserPreferences(prefs);
                  setShowPrefsModal(false);
                }}
              />
            </ScrollView>
          </View>
        </Modal>

        {/* Navigation */}
        <TouchableOpacity
          style={[styles.btn, { marginTop: 10 }]}
          onPress={() => router.replace('/(tabs)/Homesrceen')}
        >
          <Text style={styles.btnText}>๐  เธเธฅเธฑเธเธซเธเนเธฒ Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// User Preferences Form Component
const UserPreferencesForm = ({ preferences, onSave }: {
  preferences: UserPreferences;
  onSave: (prefs: UserPreferences) => void;
}) => {
  const [prefs, setPrefs] = useState<UserPreferences>(preferences);

  const updatePref = (key: keyof UserPreferences, value: any) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  return (
    <View style={styles.prefsForm}>
      <Text style={styles.formSection}>๐“ เธเนเธญเธกเธนเธฅเธ—เธฒเธเธเธฒเธข</Text>
      
      <View style={styles.row}>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เธเนเธณเธซเธเธฑเธ (kg)</Text>
          <TextInput
            value={prefs.weight?.toString() || ''}
            onChangeText={(v) => updatePref('weight', parseFloat(v) || undefined)}
            keyboardType="numeric"
            placeholder="70"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เธชเนเธงเธเธชเธนเธ (cm)</Text>
          <TextInput
            value={prefs.height?.toString() || ''}
            onChangeText={(v) => updatePref('height', parseFloat(v) || undefined)}
            keyboardType="numeric"
            placeholder="170"
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.row}>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เธญเธฒเธขเธธ (เธเธต)</Text>
          <TextInput
            value={prefs.age?.toString() || ''}
            onChangeText={(v) => updatePref('age', parseInt(v) || undefined)}
            keyboardType="numeric"
            placeholder="25"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เน€เธเธจ</Text>
          <View style={styles.pillRow}>
            {[
              { key: 'male', label: 'เธเธฒเธข' },
              { key: 'female', label: 'เธซเธเธดเธ' }
            ].map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                onPress={() => updatePref('gender', key)}
                style={[styles.miniPill, prefs.gender === key && styles.pillActive]}
              >
                <Text style={[styles.pillText, prefs.gender === key && styles.pillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.formSection}>๐ฏ เน€เธเนเธฒเธซเธกเธฒเธข</Text>
      
      <Text style={styles.label}>เธฃเธฐเธ”เธฑเธเธเธดเธเธเธฃเธฃเธก</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'sedentary', label: 'เธเนเธญเธข' },
          { key: 'light', label: 'เน€เธเธฒ' },
          { key: 'moderate', label: 'เธเธฒเธ' },
          { key: 'active', label: 'เธกเธฒเธ' },
          { key: 'very_active', label: 'เธกเธฒเธเธกเธฒเธ' }
        ].map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => updatePref('activityLevel', key)}
            style={[styles.pill, prefs.activityLevel === key && styles.pillActive]}
          >
            <Text style={[styles.pillText, prefs.activityLevel === key && styles.pillTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>เน€เธเนเธฒเธซเธกเธฒเธขเธเนเธณเธซเธเธฑเธ</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'lose', label: '๐”ป เธฅเธ”เธเนเธณเธซเธเธฑเธ' },
          { key: 'maintain', label: 'โ–๏ธ เธเธเธ—เธตเน' },
          { key: 'gain', label: '๐”บ เน€เธเธดเนเธกเธเนเธณเธซเธเธฑเธ' }
        ].map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => updatePref('goal', key)}
            style={[styles.pill, prefs.goal === key && styles.pillActive]}
          >
            <Text style={[styles.pillText, prefs.goal === key && styles.pillTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.formSection}>๐‘จโ€๐ณ เธเธฒเธฃเธ—เธณเธญเธฒเธซเธฒเธฃ</Text>
      
      <Text style={styles.label}>เธ—เธฑเธเธฉเธฐเธเธฒเธฃเธ—เธณเธญเธฒเธซเธฒเธฃ</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'beginner', label: '๐”ฐ เน€เธฃเธดเนเธกเธ•เนเธ' },
          { key: 'intermediate', label: 'โญ เธเธฒเธเธเธฅเธฒเธ' },
          { key: 'advanced', label: '๐ เน€เธเธตเนเธขเธงเธเธฒเธ' }
        ].map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => updatePref('cookingSkill', key)}
            style={[styles.pill, prefs.cookingSkill === key && styles.pillActive]}
          >
            <Text style={[styles.pillText, prefs.cookingSkill === key && styles.pillTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.row}>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เน€เธงเธฅเธฒเน€เธ•เธฃเธตเธขเธกเธญเธฒเธซเธฒเธฃ (เธเธฒเธ—เธต/เธกเธทเนเธญ)</Text>
          <TextInput
            value={prefs.mealPrepTime?.toString() || ''}
            onChangeText={(v) => updatePref('mealPrepTime', parseInt(v) || undefined)}
            keyboardType="numeric"
            placeholder="30"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เธเธเธเธฃเธฐเธกเธฒเธ“เธ•เนเธญเธงเธฑเธ</Text>
          <View style={styles.pillRow}>
            {[
              { key: 'low', label: '๐’ธ เธ•เนเธณ' },
              { key: 'medium', label: '๐’ฐ เธเธฒเธ' },
              { key: 'high', label: '๐’ เธชเธนเธ' }
            ].map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                onPress={() => updatePref('budget', key)}
                style={[styles.miniPill, prefs.budget === key && styles.pillActive]}
              >
                <Text style={[styles.pillText, prefs.budget === key && styles.pillTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <Text style={styles.formSection}>๐ฅ เธชเธธเธเธ เธฒเธ</Text>
      
      <Text style={styles.label}>เธ เธฒเธงเธฐเธชเธธเธเธ เธฒเธเธเธดเน€เธจเธฉ (เนเธขเธเธ”เนเธงเธขเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธขเธเธธเธฅเธ เธฒเธ)</Text>
      <TextInput
        value={prefs.medicalConditions?.join(', ') || ''}
        onChangeText={(v) => updatePref('medicalConditions', 
          v.split(',').map(s => s.trim()).filter(s => s.length > 0)
        )}
        placeholder="เน€เธเนเธ เน€เธเธฒเธซเธงเธฒเธ, เธเธงเธฒเธกเธ”เธฑเธเธชเธนเธ, เนเธฃเธเธซเธฑเธงเนเธ"
        style={[styles.input, { height: 60 }]}
        multiline
      />

      <Text style={styles.formSection}>๐ เธเธงเธฒเธกเธเธญเธ</Text>
      
      <Text style={styles.label}>เธญเธฒเธซเธฒเธฃเธ—เธตเนเธเธทเนเธเธเธญเธ (เนเธขเธเธ”เนเธงเธขเน€เธเธฃเธทเนเธญเธเธซเธกเธฒเธขเธเธธเธฅเธ เธฒเธ)</Text>
      <TextInput
        value={prefs.favoriteCuisines?.join(', ') || ''}
        onChangeText={(v) => updatePref('favoriteCuisines', 
          v.split(',').map(s => s.trim()).filter(s => s.length > 0)
        )}
        placeholder="เน€เธเนเธ เธญเธฒเธซเธฒเธฃเนเธ—เธข, เธญเธฒเธซเธฒเธฃเธเธตเนเธเธธเนเธ, เธญเธฒเธซเธฒเธฃเธญเธดเธ•เธฒเน€เธฅเธตเธขเธ"
        style={[styles.input, { height: 60 }]}
        multiline
      />

      <TouchableOpacity
        style={[styles.btn, styles.primaryBtn, { marginTop: 20 }]}
        onPress={() => onSave(prefs)}
      >
        <Text style={[styles.btnText, { color: '#fff' }]}>๐’พ เธเธฑเธเธ—เธถเธเธเนเธญเธกเธนเธฅ</Text>
      </TouchableOpacity>
    </View>
  );
};

// Helper functions
function dietLabel(key: string) {
  switch (key) {
    case 'balanced': return 'โ–๏ธ เธชเธกเธ”เธธเธฅ';
    case 'low_carb': return '๐ฅฌ เธเธฒเธฃเนเธเธ•เนเธณ';
    case 'high_protein': return '๐ฅฉ เนเธเธฃเธ•เธตเธเธชเธนเธ';
    case 'vegetarian': return '๐ฅ— เธกเธฑเธเธชเธงเธดเธฃเธฑเธ•เธด';
    case 'vegan': return '๐ฑ เธงเธตเนเธเธ';
    case 'keto': return '๐ฅ‘ เธเธตเนเธ•';
    default: return key;
  }
}

function cuisineLabel(key: string) {
  switch (key) {
    case 'thai': return '๐น๐ญ เนเธ—เธข';
    case 'international': return '๐ เธเธฒเธเธฒเธเธฒเธ•เธด';
    case 'asian': return '๐ฅข เน€เธญเน€เธเธตเธข';
    case 'western': return '๐ฝ๏ธ เธ•เธฐเธงเธฑเธเธ•เธ';
    case 'fusion': return '๐ญ เธเธดเธงเธเธฑเธ';
    default: return key;
  }
}

function budgetLabel(key: string) {
  switch (key) {
    case 'low': return '๐’ธ เธ•เนเธณ';
    case 'medium': return '๐’ฐ เธเธฒเธ';
    case 'high': return '๐’ เธชเธนเธ';
    default: return key;
  }
}

function difficultyLabel(key: string) {
  switch (key) {
    case 'easy': return '๐ข เธเนเธฒเธข';
    case 'medium': return '๐ก เธเธฒเธ';
    case 'hard': return '๐”ด เธขเธฒเธ';
    default: return key;
  }
}

function costLabel(key: string) {
  switch (key) {
    case 'low': return '๐’ธ เธเธฃเธฐเธซเธขเธฑเธ”';
    case 'medium': return '๐’ฐ เธเธฒเธเธเธฅเธฒเธ';
    case 'high': return '๐’ เธซเธฃเธน';
    default: return key;
  }
}

function getMealIcon(index: number) {
  const icons = ['๐…', 'โ€๏ธ', '๐', '๐', 'โญ'];
  return icons[index] || '๐ฝ๏ธ';
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: '900', color: '#111', textAlign: 'center' },
  subtitle: { 
    color: '#6b7280', 
    marginTop: 6, 
    marginBottom: 16, 
    textAlign: 'center',
    lineHeight: 20 
  },
  bmiInfo: { color: '#059669', fontWeight: '600' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  
  secTitle: { 
    fontSize: 18, 
    fontWeight: '800', 
    color: '#111', 
    marginBottom: 12 
  },

  headerRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    marginBottom: 8,
  },
  
  buttonGroup: { 
    flexDirection: 'row', 
    gap: 8 
  },
  
  miniBtn: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  
  miniBtnText: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#374151' 
  },

  row: { 
    flexDirection: 'row', 
    gap: 12, 
    marginBottom: 12 
  },
  
  inputBox: { flex: 1 },
  
  label: { 
    fontWeight: '700', 
    color: '#111', 
    marginBottom: 6,
    fontSize: 14,
  },
  
  input: {
    backgroundColor: '#f9fafb',
    borderColor: '#d1d5db',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },

  pillRow: { 
    flexDirection: 'row', 
    flexWrap: 'wrap', 
    gap: 8, 
    marginBottom: 12 
  },
  
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  
  miniPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  
  pillActive: { 
    backgroundColor: '#8b5cf6', 
    borderColor: '#7c3aed' 
  },
  
  pillText: { 
    color: '#374151', 
    fontWeight: '700',
    fontSize: 13,
  },
  
  pillTextActive: { color: '#fff' },

  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 8,
  },

  btn: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 4,
  },
  
  primaryBtn: { 
    backgroundColor: '#8b5cf6', 
    borderColor: '#7c3aed' 
  },
  
  btnText: { 
    color: '#3730a3', 
    fontWeight: '800',
    fontSize: 16,
  },

  linkBtn: { padding: 8 },
  linkText: { 
    color: '#6b7280', 
    fontWeight: '700',
    fontSize: 14,
  },

  meta: { 
    color: '#374151', 
    marginTop: 2,
    lineHeight: 18,
  },
  
  metaWarning: {
    color: '#f59e0b',
    fontWeight: '600',
    fontStyle: 'italic',
  },
  
  bold: { fontWeight: '800', color: '#111' },

  // Enhanced meal cards
  nutritionCard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  
  nutritionTitle: {
    fontWeight: '800',
    color: '#15803d',
    marginBottom: 6,
  },

  enhancedMealCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fafafa',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  
  mealHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  
  mealName: { 
    fontWeight: '800', 
    color: '#111',
    fontSize: 16,
    flex: 1,
    marginRight: 8,
  },
  
  mealKcal: {
    color: '#059669',
    fontWeight: '700',
    fontSize: 14,
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  
  mealMeta: { 
    color: '#6b7280', 
    marginTop: 4,
    fontSize: 13,
  },
  
  macroLine: { 
    color: '#111', 
    fontWeight: '700', 
    marginTop: 4,
    fontSize: 14,
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },

  ingredientsSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  
  ingredientsTitle: {
    fontWeight: '700',
    color: '#374151',
    marginBottom: 4,
    fontSize: 13,
  },
  
  ingredients: {
    color: '#6b7280',
    fontSize: 13,
    lineHeight: 18,
  },
  
  note: { 
    color: '#6b7280', 
    marginTop: 8, 
    fontStyle: 'italic',
    fontSize: 13,
    backgroundColor: '#fef3c7',
    padding: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },

  // Shopping list
  shoppingList: {
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  
  shoppingItem: {
    color: '#374151',
    paddingVertical: 2,
    fontSize: 14,
  },

  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111',
  },
  
  closeBtn: {
    fontSize: 24,
    color: '#6b7280',
    fontWeight: '600',
  },
  
  modalContent: {
    flex: 1,
    padding: 20,
  },

  // Preferences form
  prefsForm: {
    paddingBottom: 40,
  },
  
  formSection: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    marginTop: 20,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: '#e5e7eb',
  },
});
