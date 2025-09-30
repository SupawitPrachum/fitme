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
import { API_BASE_URL } from '@/constants/api';

const AUTH_KEY = 'auth_token';
const USER_PREFS_KEY = 'user_food_preferences';
const API_URL = API_BASE_URL;

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

  // -------- Ingredient completeness check --------
  const tokenizeIngredients = (s: string): string[] =>
    s.split(/[,\n]/).map(t => t.trim().toLowerCase()).filter(Boolean);

  const hasAny = (tokens: string[], keys: string[]) =>
    tokens.some(t => keys.some(k => t.includes(k)));

  const analyzeIngredients = (tokens: string[]) => {
    // Common sources (EN + TH keywords)
    const protein = ['chicken','pork','beef','fish','tuna','salmon','shrimp','egg','eggs','tofu','tempeh','bean','beans','lentil','yogurt','milk','ไก่','หมู','เนื้อ','ปลา','ทูน่า','แซลมอน','กุ้ง','ไข่','เต้าหู้','ถั่ว','โยเกิร์ต','นม'];
    const carbs   = ['rice','bread','pasta','noodle','noodles','oat','oats','quinoa','potato','sweet potato','ข้าว','ขนมปัง','พาสต้า','เส้น','ก๋วยเตี๋ยว','บะหมี่','ข้าวโอ๊ต','คีนัว','มันฝรั่ง','มันหวาน'];
    const fats    = ['olive oil','avocado','nut','nuts','almond','cashew','seed','seeds','chia','flax','peanut butter','coconut oil','cheese','น้ำมันมะกอก','อะโวคาโด','ถั่ว','อัลมอนด์','เมล็ด','เมล็ดเจีย','แฟลกซ์','เนยถั่ว','น้ำมันมะพร้าว','ชีส'];
    const fiber   = ['broccoli','spinach','kale','lettuce','cabbage','carrot','tomato','cucumber','fruit','banana','apple','berries','สลัด','ผัก','บรอกโคลี','ผักโขม','คะน้า','ผักกาด','กะหล่ำ','แครอท','มะเขือเทศ','แตงกวา','ผลไม้','กล้วย','แอปเปิล','เบอร์รี่'];

    const missing: string[] = [];
    const hints: Record<string,string[]> = {
      protein: ['ไก่','ไข่','ปลา','เต้าหู้','ถั่ว'],
      carbs: ['ข้าว','มันหวาน','ขนมปังโฮลวีต','พาสต้าโฮลวีต','ข้าวโอ๊ต'],
      fats: ['อะโวคาโด','ถั่วอัลมอนด์','น้ำมันมะกอก','เมล็ดเจีย'],
      fiber: ['ผักใบเขียว','บรอกโคลี','แครอท','มะเขือเทศ','ผลไม้']
    };

    if (!hasAny(tokens, protein)) missing.push('แหล่งโปรตีน');
    if (!hasAny(tokens, carbs))   missing.push('คาร์โบไฮเดรตเชิงซ้อน');
    if (!hasAny(tokens, fats))    missing.push('ไขมันดี');
    if (!hasAny(tokens, fiber))   missing.push('ผัก/ใยอาหาร');

    const suggestLines: string[] = [];
    if (missing.includes('แหล่งโปรตีน')) suggestLines.push(`โปรตีน: ${hints.protein.join(', ')}`);
    if (missing.includes('คาร์โบไฮเดรตเชิงซ้อน')) suggestLines.push(`คาร์บเชิงซ้อน: ${hints.carbs.join(', ')}`);
    if (missing.includes('ไขมันดี')) suggestLines.push(`ไขมันดี: ${hints.fats.join(', ')}`);
    if (missing.includes('ผัก/ใยอาหาร')) suggestLines.push(`ผัก/ผลไม้: ${hints.fiber.join(', ')}`);

    return { missing, suggest: suggestLines.join('\n') };
  };

  // Cross‑platform confirm helper (Alert with 2 buttons on native, confirm() on web)
  const confirmProceed = async (title: string, message: string): Promise<boolean> => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof (window as any).confirm === 'function') {
      try {
        // Single modal confirm on web
        // eslint-disable-next-line no-alert
        return (window as any).confirm(`${title}\n\n${message}\n\nต้องการดำเนินการต่อหรือไม่?`);
      } catch {
        return true; // fail open on web
      }
    }
    // Native alert with 2 options
    return await new Promise<boolean>((resolve) => {
      Alert.alert(
        title,
        message,
        [
          { text: 'แก้ไขวัตถุดิบ', style: 'cancel', onPress: () => resolve(false) },
          { text: 'สร้างต่อ', onPress: () => resolve(true) },
        ]
      );
    });
  };

  // -------- Advanced filters (time/budget/include/avoid) applied client‑side --------
  const [filterMsg, setFilterMsg] = useState<string | null>(null);

  const costRank = (c?: string | null) => {
    const v = String(c || '').toLowerCase();
    if (v.includes('low') || v.includes('ต่ำ')) return 1;
    if (v.includes('high') || v.includes('สูง')) return 3;
    if (v.includes('medium') || v.includes('ปาน')) return 2;
    return 2; // unknown = medium
  };

  const textHasToken = (text: string, tokens: string[]) => {
    const s = text.toLowerCase();
    return tokens.some(t => t && s.includes(t));
  };

  const mealHasToken = (m: Meal, tokens: string[]) => {
    if (!tokens.length) return false;
    const all = [m.name || '', m.note || '', ...(m.ingredients || [])].join(' ').toLowerCase();
    return tokens.some(t => t && all.includes(t));
  };

  const applyAdvancedFilters = useCallback((input: MealPlanResponse): MealPlanResponse => {
    try {
      const avoidTokens = tokenizeIngredients(avoid);
      const includeTokens = tokenizeIngredients(includeIngredients);
      const maxTime = Math.max(1, parseInt(maxCookTime, 10) || 9999);
      const budgetRankSel = costRank(budget);

      let items = [...(input.meals || [])];
      let removed = 0;
      const removedInfo: string[] = [];

      // time filter
      const len0 = items.length;
      items = items.filter(m => (m.cookingTime == null || !Number.isFinite(Number(m.cookingTime))) ? true : Number(m.cookingTime) <= maxTime);
      if (items.length < len0) { removed += (len0 - items.length); removedInfo.push('เวลา'); }

      // budget filter
      const len1 = items.length;
      items = items.filter(m => costRank(m.cost as any) <= budgetRankSel);
      if (items.length < len1) { removed += (len1 - items.length); removedInfo.push('งบประมาณ'); }

      // avoid filter
      const len2 = items.length;
      if (avoidTokens.length) {
        items = items.filter(m => !mealHasToken(m, avoidTokens));
        if (items.length < len2) { removed += (len2 - items.length); removedInfo.push('หลีกเลี่ยง'); }
      }

      // include preference (prefer keep if any match)
      let includeNote: string | null = null;
      if (includeTokens.length) {
        const preferred = items.filter(m => mealHasToken(m, includeTokens));
        if (preferred.length) {
          items = preferred;
        } else {
          includeNote = 'ไม่มีเมนูที่ตรงกับวัตถุดิบที่ระบุ';
        }
      }

      if (items.length === 0) {
        // Fallback: keep original but show message
        items = [...(input.meals || [])];
      }

      // Recalc totals
      const totalProtein = Math.round(items.reduce((s, x) => s + (x.macros ? x.macros.p * x.kcal / 4 : 0), 0));
      const totalCarbs   = Math.round(items.reduce((s, x) => s + (x.macros ? x.macros.c * x.kcal / 4 : 0), 0));
      const totalFat     = Math.round(items.reduce((s, x) => s + (x.macros ? x.macros.f * x.kcal / 9 : 0), 0));

      const out: MealPlanResponse = {
        ...input,
        meals: items,
        nutritionSummary: { totalProtein, totalCarbs, totalFat },
      };

      const parts: string[] = [];
      if (removed > 0) parts.push(`ใช้ตัวกรองซ่อน ${removed} เมนู (${removedInfo.join(', ')})`);
      if (includeNote) parts.push(includeNote);
      setFilterMsg(parts.length ? parts.join(' • ') : null);
      return out;
    } catch {
      setFilterMsg(null);
      return input;
    }
  }, [avoid, includeIngredients, maxCookTime, budget]);

  // -------- Local fallback generator (offline / server unavailable) --------
  const buildLocalPlan = useCallback((): MealPlanResponse => {
    const m = Math.max(1, Math.min(8, mealsNum));
    const kcalPerMeal = Math.round(kcalNum / m);
    const tokens = tokenizeIngredients(includeIngredients);
    const { missing } = analyzeIngredients(tokens);
    const macroSplit: Macro[] = Array.from({ length: m }).map((_, i) => {
      // Simple macro distribution per meal (approx): P 25–35%, C 40–55%, F 20–30%
      const p = 0.3 + ((i % 3) - 1) * 0.02; // vary a little
      const c = 0.5 + ((i % 2) ? -0.03 : 0.03);
      const f = 1 - (p + c);
      return { p: Math.max(0.25, Math.min(0.35, p)), c: Math.max(0.4, Math.min(0.55, c)), f: Math.max(0.2, Math.min(0.3, f)) };
    });
    const mealsOut: Meal[] = Array.from({ length: m }).map((_, i) => {
      const label = ['เช้า','กลางวัน','เย็น','ว่าง'][i] || `มื้อที่ ${i+1}`;
      const kcal = kcalPerMeal;
      const macros = macroSplit[i];
      const suggestions: string[] = [];
      if (missing.includes('แหล่งโปรตีน')) suggestions.push('เพิ่ม: ไก่/ไข่/ปลา/เต้าหู้');
      if (missing.includes('คาร์โบไฮเดรตเชิงซ้อน')) suggestions.push('เพิ่ม: ข้าวกล้อง/มันหวาน/พาสต้าโฮลวีต');
      if (missing.includes('ไขมันดี')) suggestions.push('เพิ่ม: อะโวคาโด/อัลมอนด์/น้ำมันมะกอก');
      if (missing.includes('ผัก/ใยอาหาร')) suggestions.push('เพิ่ม: ผักใบเขียว/บรอกโคลี/ผลไม้');
      return {
        name: `${label}: เมนูสมดุล`,
        kcal,
        macros,
        note: suggestions.join(' • '),
        ingredients: tokens.length ? tokens : undefined,
        difficulty: 'easy',
        cost: budget as any,
      } as Meal;
    });
    const totalProtein = Math.round(mealsOut.reduce((s, x) => s + (x.macros ? x.macros.p * x.kcal / 4 : 0), 0));
    const totalCarbs   = Math.round(mealsOut.reduce((s, x) => s + (x.macros ? x.macros.c * x.kcal / 4 : 0), 0));
    const totalFat     = Math.round(mealsOut.reduce((s, x) => s + (x.macros ? x.macros.f * x.kcal / 9 : 0), 0));
    return {
      dayTotalKcal: kcalNum,
      meals: mealsOut,
      nutritionSummary: { totalProtein, totalCarbs, totalFat },
    };
  }, [mealsNum, kcalNum, includeIngredients, budget]);

  const doGenerate = useCallback(async () => {
    try {
      // Pre-check ingredient completeness (only when user entered something)
      const tokens = tokenizeIngredients(includeIngredients);
      if (tokens.length) {
        const { missing, suggest } = analyzeIngredients(tokens);
        if (missing.length) {
          const proceed = await confirmProceed(
            'วัตถุดิบยังไม่ครบตามโภชนาการ',
            `ขาด: ${missing.join(' • ')}\n\nแนะนำเพิ่ม:\n${suggest}`
          );
          if (!proceed) return;
        }
      }

      setLoading(true);
      const token = await AsyncStorage.getItem(AUTH_KEY);
      // หากไม่มี token ให้ใช้แผนแบบออฟไลน์แทน (ไม่เด้งออกจากหน้า)
      if (!token) {
        const local = buildLocalPlan();
        setPlan(local);
        setAiText('โหมดออฟไลน์: ใช้แผนอาหารภายในแอป');
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
        // ใช้แผนแบบออฟไลน์แทนทันที
        await AsyncStorage.removeItem(AUTH_KEY);
        const local = buildLocalPlan();
        setPlan(local);
        setAiText('หมดเวลาเข้าสู่ระบบ: แสดงแผนออฟไลน์แทน');
        return;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        // แสดงแผนออฟไลน์แทนเมื่อเซิร์ฟเวอร์ไม่ปกติ
        const local = buildLocalPlan();
        setPlan(local);
        setAiText(txt || `โหมดออฟไลน์: ใช้แผนอาหารภายในแอป (HTTP ${res.status})`);
        return;
      }

      const raw = await res.json().catch(() => ({}));
      
      // Align with backend contract: handle ok:false and partial results
      if (raw && typeof raw === 'object' && raw.ok === false) {
        if (typeof raw.partialText === 'string' && raw.partialText.trim()) {
          setAiText(String(raw.partialText));
        } else if (raw?.error?.reason) {
          const reason = String(raw.error.reason);
          const finish = String(raw.error.finish || '');
          const block = String(raw.error.blockReason || '');
          const msg = reason === 'BLOCKED'
            ? `คำขอถูกบล็อก (${block || 'SAFETY'})`
            : reason === 'NON_STOP_FINISH' && finish
              ? `จบไม่ปกติ (${finish})`
              : reason === 'EMPTY_OUTPUT'
                ? 'ไม่มีข้อความจากโมเดล'
                : `ข้อผิดพลาด: ${reason}`;
          setAiText(msg);
        } else {
          setAiText('ไม่สามารถสร้างคำแนะนำได้');
        }
        setPlan(null);
        return;
      }
      
      if (raw && typeof raw === 'object' && Array.isArray(raw.meals)) {
        const filtered = applyAdvancedFilters(raw as MealPlanResponse);
        setPlan(filtered);
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
      // หากเกิดข้อผิดพลาด ให้ใช้แผนแบบออฟไลน์สร้างให้ใช้งานได้ต่อเนื่อง พร้อมกรองขั้นสูง
      const local = applyAdvancedFilters(buildLocalPlan());
      setPlan(local);
      setAiText(`โหมดออฟไลน์: ${e?.message ?? 'เกิดข้อผิดพลาดในเครือข่าย'}`);
    } finally {
      setLoading(false);
    }
  }, [kcalNum, mealsNum, diet, avoid, cuisineType, maxCookTime, budget, includeIngredients, mealTiming, userPrefs, generateShoppingList, weeklyPlan, buildLocalPlan, applyAdvancedFilters]);

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
      Alert.alert('บันทึกแล้ว', 'แผนอาหารถูกบันทึกเรียบร้อยแล้ว');
    } catch (error) {
      Alert.alert('ไม่สามารถบันทึก', 'เกิดข้อผิดพลาดในการบันทึก');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#F7F8FA' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.title}>🤖 AI แนะนำอาหารอัจฉริยะ</Text>
        <Text style={styles.subtitle}>
          สร้างเมนู {mealsNum} มื้อ ประมาณ {kcalNum} kcal/วัน • สไตล์ {dietLabel(diet)}
          {userPrefs.weight && userPrefs.height && (
            <Text style={styles.bmiInfo}>
              {'\n'}BMI: {((userPrefs.weight / ((userPrefs.height/100) ** 2)).toFixed(1))}
            </Text>
          )}
        </Text>

        {/* User Profile Card */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.secTitle}>⚙️ โปรไฟล์และการตั้งค่า</Text>
            <TouchableOpacity 
              style={styles.linkBtn} 
              onPress={() => setShowPrefsModal(true)}
            >
              <Text style={styles.linkText}>แก้ไข</Text>
            </TouchableOpacity>
          </View>
          
          {userPrefs.weight || userPrefs.height ? (
            <Text style={styles.meta}>
              น้ำหนัก: {userPrefs.weight || '-'} kg • ส่วนสูง: {userPrefs.height || '-'} cm
              {userPrefs.age && ` • อายุ: ${userPrefs.age} ปี`}
            </Text>
          ) : (
            <Text style={styles.metaWarning}>
              💡 เพิ่มข้อมูลส่วนตัวเพื่อให้ AI แนะนำได้แม่นยำขึ้น
            </Text>
          )}
        </View>

        {/* Basic Settings */}
        <View style={styles.card}>
          <Text style={styles.secTitle}>🎯 ตั้งค่าพื้นฐาน</Text>

          <View style={styles.row}>
            <View style={styles.inputBox}>
              <Text style={styles.label}>แคลอรี่/วัน</Text>
              <TextInput
                value={calories}
                onChangeText={setCalories}
                keyboardType="numeric"
                placeholder="2000"
                style={styles.input}
              />
            </View>
            <View style={styles.inputBox}>
              <Text style={styles.label}>จำนวนมื้อ</Text>
              <TextInput
                value={meals}
                onChangeText={setMeals}
                keyboardType="numeric"
                placeholder="3"
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.label}>สไตล์อาหาร</Text>
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

          <Text style={styles.label}>ประเภทอาหาร</Text>
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
            <Text style={styles.secTitle}>⚡ ตั้งค่าขั้นสูง</Text>
            <Text style={styles.linkText}>{showAdvanced ? '▼' : '▶'}</Text>
          </TouchableOpacity>

          {showAdvanced && (
            <>
              <View style={styles.row}>
                <View style={styles.inputBox}>
                  <Text style={styles.label}>เวลาทำอาหารสูงสุด (นาที)</Text>
                  <TextInput
                    value={maxCookTime}
                    onChangeText={setMaxCookTime}
                    keyboardType="numeric"
                    placeholder="60"
                    style={styles.input}
                  />
                </View>
                <View style={styles.inputBox}>
                  <Text style={styles.label}>งบประมาณ</Text>
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

              <Text style={styles.label}>วัตถุดิบที่มีอยู่ (แยกด้วยเครื่องหมายจุลภาค)</Text>
              <TextInput
                value={includeIngredients}
                onChangeText={setIncludeIngredients}
                placeholder="เช่น ไก่, ข้าว, มะเขือเทศ"
                style={[styles.input, { height: 44 }]}
              />

              <Text style={styles.label}>หลีกเลี่ยง (เช่น กุ้ง, ถั่วลิสง)</Text>
              <TextInput
                value={avoid}
                onChangeText={setAvoid}
                placeholder="เช่น กุ้ง, ถั่วลิสง, แป้งขัดสี"
                style={[styles.input, { height: 44 }]}
              />

              <View style={styles.switchRow}>
                <Text style={styles.label}>สร้างรายการซื้อของ</Text>
                <Switch
                  value={generateShoppingList}
                  onValueChange={setGenerateShoppingList}
                />
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.label}>แผนอาหารรายสัปดาห์</Text>
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
              🎨 ให้ AI สร้างแผนอาหารอัจฉริยะ
            </Text>
          )}
        </TouchableOpacity>

        {/* Results - Structured */}
        {plan && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.secTitle}>🍽️ แผนอาหารสำหรับคุณ</Text>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={styles.miniBtn} onPress={saveMealPlan}>
                  <Text style={styles.miniBtnText}>💾 บันทึก</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.miniBtn} onPress={reset}>
                  <Text style={styles.miniBtnText}>🗑️ ล้าง</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Nutrition Summary */}
            <View style={styles.nutritionCard}>
              <Text style={styles.nutritionTitle}>📊 สรุปคุณค่าทางโภชนาการ</Text>
              {!!filterMsg && (
                <Text style={styles.metaWarning}>{filterMsg}</Text>
              )}
              <Text style={styles.meta}>
                แคลอรี่รวม: <Text style={styles.bold}>{totalFromMeals} kcal</Text>
              </Text>
              {plan.nutritionSummary && (
                <Text style={styles.macroLine}>
                  P {plan.nutritionSummary.totalProtein}g • 
                  C {plan.nutritionSummary.totalCarbs}g • 
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
                      🍽️ {getMealIcon(i)} {m.name}
                    </Text>
                    <Text style={styles.mealKcal}>≈ {Math.round(m.kcal)} kcal</Text>
                  </View>

                  {m.macros && (
                    <Text style={styles.macroLine}>
                      P {m.macros.p}g • C {m.macros.c}g • F {m.macros.f}g
                    </Text>
                  )}

                  {m.cookingTime && (
                    <Text style={styles.mealMeta}>
                      ⏱️ เวลาทำ: {m.cookingTime} นาที
                    </Text>
                  )}

                  {m.difficulty && (
                    <Text style={styles.mealMeta}>
                      🔥 ความยาก: {difficultyLabel(m.difficulty)}
                    </Text>
                  )}

                  {m.cost && (
                    <Text style={styles.mealMeta}>
                      💰 ค่าใช้จ่าย: {costLabel(m.cost)}
                    </Text>
                  )}

                  {m.ingredients && m.ingredients.length > 0 && (
                    <View style={styles.ingredientsSection}>
                      <Text style={styles.ingredientsTitle}>🥘 วัตถุดิบ:</Text>
                      <Text style={styles.ingredients}>
                        {m.ingredients.join(', ')}
                      </Text>
                    </View>
                  )}

                  {m.note && (
                    <Text style={styles.note}>💡 {m.note}</Text>
                  )}
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.btn, { marginTop: 10 }]}
              onPress={doGenerate}
            >
              <Text style={styles.btnText}>🎲 สุ่มใหม่ / สร้างอีกครั้ง</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Shopping List */}
        {shoppingList.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.secTitle}>🛒 รายการซื้อของ</Text>
            <View style={styles.shoppingList}>
              {shoppingList.map((item, index) => (
                <Text key={index} style={styles.shoppingItem}>
                  • {item}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* AI Text Result (fallback) */}
        {aiText && !plan && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.secTitle}>🤖 ข้อเสนะแนะจาก AI</Text>
              <TouchableOpacity style={styles.linkBtn} onPress={reset}>
                <Text style={styles.linkText}>ล้างผลลัพธ์</Text>
              </TouchableOpacity>
            </View>
            {aiText.split('\n').map((line, i) => (
              <Text key={i} style={styles.meta}>{line}</Text>
            ))}
            <TouchableOpacity style={[styles.btn, { marginTop: 10 }]} onPress={doGenerate}>
              <Text style={styles.btnText}>🎲 สุ่มใหม่ / สร้างอีกครั้ง</Text>
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
              <Text style={styles.modalTitle}>👤 ข้อมูลส่วนตัว</Text>
              <TouchableOpacity onPress={() => setShowPrefsModal(false)}>
                <Text style={styles.closeBtn}>✕</Text>
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
          <Text style={styles.btnText}>🏠 กลับหน้า Home</Text>
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
      <Text style={styles.formSection}>📏 ข้อมูลทางกาย</Text>
      
      <View style={styles.row}>
        <View style={styles.inputBox}>
          <Text style={styles.label}>น้ำหนัก (kg)</Text>
          <TextInput
            value={prefs.weight?.toString() || ''}
            onChangeText={(v) => updatePref('weight', parseFloat(v) || undefined)}
            keyboardType="numeric"
            placeholder="70"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>ส่วนสูง (cm)</Text>
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
          <Text style={styles.label}>อายุ (ปี)</Text>
          <TextInput
            value={prefs.age?.toString() || ''}
            onChangeText={(v) => updatePref('age', parseInt(v) || undefined)}
            keyboardType="numeric"
            placeholder="25"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>เพศ</Text>
          <View style={styles.pillRow}>
            {[
              { key: 'male', label: 'ชาย' },
              { key: 'female', label: 'หญิง' }
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

      <Text style={styles.formSection}>🎯 เป้าหมาย</Text>
      
      <Text style={styles.label}>ระดับกิจกรรม</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'sedentary', label: 'น้อย' },
          { key: 'light', label: 'เบา' },
          { key: 'moderate', label: 'ปาน' },
          { key: 'active', label: 'มาก' },
          { key: 'very_active', label: 'มากมาก' }
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

      <Text style={styles.label}>เป้าหมายน้ำหนัก</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'lose', label: '🔻 ลดน้ำหนัก' },
          { key: 'maintain', label: '⚖️ คงที่' },
          { key: 'gain', label: '🔺 เพิ่มน้ำหนัก' }
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

      <Text style={styles.formSection}>👨‍🍳 การทำอาหาร</Text>
      
      <Text style={styles.label}>ทักษะการทำอาหาร</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'beginner', label: '🔰 เริ่มต้น' },
          { key: 'intermediate', label: '⭐ ปานกลาง' },
          { key: 'advanced', label: '🌟 เชี่ยวชาญ' }
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
          <Text style={styles.label}>เวลาเตรียมอาหาร (นาที/มื้อ)</Text>
          <TextInput
            value={prefs.mealPrepTime?.toString() || ''}
            onChangeText={(v) => updatePref('mealPrepTime', parseInt(v) || undefined)}
            keyboardType="numeric"
            placeholder="30"
            style={styles.input}
          />
        </View>
        <View style={styles.inputBox}>
          <Text style={styles.label}>งบประมาณต่อวัน</Text>
          <View style={styles.pillRow}>
            {[
              { key: 'low', label: '💸 ต่ำ' },
              { key: 'medium', label: '💰 ปาน' },
              { key: 'high', label: '💎 สูง' }
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

      <Text style={styles.formSection}>🏥 สุขภาพ</Text>
      
      <Text style={styles.label}>ภาวะสุขภาพพิเศษ (แยกด้วยเครื่องหมายจุลภาค)</Text>
      <TextInput
        value={prefs.medicalConditions?.join(', ') || ''}
        onChangeText={(v) => updatePref('medicalConditions', 
          v.split(',').map(s => s.trim()).filter(s => s.length > 0)
        )}
        placeholder="เช่น เบาหวาน, ความดันสูง, โรคหัวใจ"
        style={[styles.input, { height: 60 }]}
        multiline
      />

      <Text style={styles.formSection}>🌍 ความชอบ</Text>
      
      <Text style={styles.label}>อาหารที่ชื่นชอบ (แยกด้วยเครื่องหมายจุลภาค)</Text>
      <TextInput
        value={prefs.favoriteCuisines?.join(', ') || ''}
        onChangeText={(v) => updatePref('favoriteCuisines', 
          v.split(',').map(s => s.trim()).filter(s => s.length > 0)
        )}
        placeholder="เช่น อาหารไทย, อาหารญี่ปุ่น, อาหารอิตาเลียน"
        style={[styles.input, { height: 60 }]}
        multiline
      />

      <TouchableOpacity
        style={[styles.btn, styles.primaryBtn, { marginTop: 20 }]}
        onPress={() => onSave(prefs)}
      >
        <Text style={[styles.btnText, { color: '#fff' }]}>💾 บันทึกข้อมูล</Text>
      </TouchableOpacity>
    </View>
  );
};

// Helper functions
function dietLabel(key: string) {
  switch (key) {
    case 'balanced': return '⚖️ สมดุล';
    case 'low_carb': return '🥬 คาร์บต่ำ';
    case 'high_protein': return '🥩 โปรตีนสูง';
    case 'vegetarian': return '🥗 มังสวิรัติ';
    case 'vegan': return '🌱 วีแกน';
    case 'keto': return '🥑 คีโต';
    default: return key;
  }
}

function cuisineLabel(key: string) {
  switch (key) {
    case 'thai': return '🇹🇭 ไทย';
    case 'international': return '🌍 นานาชาติ';
    case 'asian': return '🥢 เอเชีย';
    case 'western': return '🍽️ ตะวันตก';
    case 'fusion': return '🎭 ฟิวชัน';
    default: return key;
  }
}

function budgetLabel(key: string) {
  switch (key) {
    case 'low': return '💸 ต่ำ';
    case 'medium': return '💰 ปาน';
    case 'high': return '💎 สูง';
    default: return key;
  }
}

function difficultyLabel(key: string) {
  switch (key) {
    case 'easy': return '🟢 ง่าย';
    case 'medium': return '🟡 ปาน';
    case 'hard': return '🔴 ยาก';
    default: return key;
  }
}

function costLabel(key: string) {
  switch (key) {
    case 'low': return '💸 ประหยัด';
    case 'medium': return '💰 ปานกลาง';
    case 'high': return '💎 หรู';
    default: return key;
  }
}

function getMealIcon(index: number) {
  const icons = ['🌅', '☀️', '🌙', '🌃', '⭐'];
  return icons[index] || '🍽️';
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
