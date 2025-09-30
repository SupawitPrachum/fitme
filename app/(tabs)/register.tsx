import axios from 'axios';
import { API_BASE_URL } from '@/constants/api';
import React, { useState, memo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
  Modal,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

/* -------------------- InputField (ประกาศนอก component + memo) -------------------- */
type InputFieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  placeholder?: string;
  autoComplete?: any;
  textContentType?: any;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: string;
};

const InputField = memo(function InputField({
  label,
  value,
  onChangeText,
  secureTextEntry = false,
  keyboardType = 'default',
  placeholder,
  autoComplete,
  textContentType,
  autoCapitalize = 'none',
  error,
}: InputFieldProps) {
  const [focused, setFocused] = useState(false);
  const showError = !!error;

  return (
    <View style={styles.inputContainer}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          focused && styles.inputFocused,
          showError && styles.inputError,
        ]}
        placeholder={placeholder || `กรอก${label}`}
        value={value ?? ''}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        placeholderTextColor="#A0A0A0"
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        selectionColor="#6366f1"
        underlineColorAndroid="transparent"
        importantForAutofill="yes"
        autoComplete={autoComplete}
        textContentType={textContentType}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {showError ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});
/* ------------------------------------------------------------------------------- */

// ใช้ Base URL กลาง (override ได้ด้วย EXPO_PUBLIC_API_BASE_URL)
const api = axios.create({ baseURL: API_BASE_URL.replace(/\/$/, '') });

const RegisterScreen = () => {
  const navigation = useNavigation();

  // form states
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [gender, setGender] = useState<string>('');
  const [dateOfBirth, setDateOfBirth] = useState<string>('');

  // errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // modals
  const [showGenderModal, setShowGenderModal] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);

  // date selections (picker)
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');

  const genderOptions = ['ชาย', 'หญิง', 'ไม่ระบุ', 'อื่นๆ'];
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const getDaysInMonth = (month: number, year: number) => new Date(year, month, 0).getDate();

  const generateYears = () => {
    const currentYear = new Date().getFullYear();
    const years: string[] = [];
    for (let i = currentYear; i >= currentYear - 100; i--) years.push(i.toString());
    return years;
  };

  const formatDate = () => {
    if (selectedDay && selectedMonth && selectedYear) {
      const monthNumber = months.indexOf(selectedMonth) + 1;
      const formattedMonth = monthNumber.toString().padStart(2, '0');
      const formattedDay = selectedDay.toString().padStart(2, '0');
      return `${selectedYear}-${formattedMonth}-${formattedDay}`;
    }
    return '';
  };

  const handleDateConfirm = () => {
    const formattedDate = formatDate();
    setDateOfBirth(formattedDate);
    setShowDateModal(false);
    if (errors.dateOfBirth) setErrors((e) => ({ ...e, dateOfBirth: '' }));
  };

  /* ------------------------- validate ก่อนยิง API ------------------------- */
  const validate = () => {
    const next: Record<string, string> = {};

    if (!username.trim()) next.username = 'กรุณากรอกชื่อผู้ใช้';
    if (!email.trim()) next.email = 'กรุณากรอกอีเมล';
    else {
      const emailOK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      if (!emailOK) next.email = 'รูปแบบอีเมลไม่ถูกต้อง';
    }

    if (!password) next.password = 'กรุณากรอกรหัสผ่าน';
    else if (password.length < 6) next.password = 'รหัสผ่านอย่างน้อย 6 ตัวอักษร';

    if (!confirmPassword) next.confirmPassword = 'กรุณายืนยันรหัสผ่าน';
    else if (password && confirmPassword && password !== confirmPassword) {
      next.confirmPassword = 'รหัสผ่านไม่ตรงกัน';
    }

    // 🔴 บังคับเลือกเพศ/วันเกิด
    if (!gender) next.gender = 'กรุณาเลือกเพศ';
    if (!dateOfBirth) next.dateOfBirth = 'กรุณาเลือกวันเกิด';

    setErrors(next);
    return Object.keys(next).length === 0;
  };
  /* ---------------------------------------------------------------------- */

  const handleRegister = async () => {
    if (!validate()) return;

    const userData = {
      username,
      password,
      email,
      first_name: firstName,
      last_name: lastName,
      gender,
      date_of_birth: dateOfBirth,
    };

    try {
      const response = await api.post('/register', userData);
      if (response.status >= 200 && response.status < 300) {
        // ไปหน้า Success พร้อมส่งอีเมล
        // @ts-ignore
        navigation.navigate('RegisterSuccess', { email });
      } else {
        Alert.alert('เกิดข้อผิดพลาดในการสมัครสมาชิก', `สถานะ: ${response.status}`);
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || error?.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
      Alert.alert('เกิดข้อผิดพลาดในการสมัครสมาชิก', msg);
    }
  };

  const handleLogin = () => {
    // @ts-ignore
    navigation.navigate('login');
  };

  // helper เพื่อล้าง error เมื่อพิมพ์
  const clearErrorAnd =
    (field: string, setter: (t: string) => void) =>
    (t: string) => {
      setter(t);
      if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
    };

  // ----- ตัวเลือกเพศ/วันเกิด (เพิ่มกรอบแดง + ข้อความเตือน) -----
  const GenderSelector = () => {
    const showError = !!errors.gender;
    return (
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>เพศ</Text>
        <TouchableOpacity
          style={[
            styles.input,
            styles.selectorInput,
            showError && styles.inputError,
          ]}
          onPress={() => {
            if (errors.gender) setErrors((e) => ({ ...e, gender: '' }));
            setShowGenderModal(true);
          }}
        >
          <Text style={[styles.selectorText, !gender && styles.placeholderText]}>
            {gender || 'เลือกเพศ'}
          </Text>
          <Text style={styles.dropdownIcon}>▼</Text>
        </TouchableOpacity>
        {showError ? <Text style={styles.errorText}>{errors.gender}</Text> : null}
      </View>
    );
  };

  const DateSelector = () => {
    const showError = !!errors.dateOfBirth;
    return (
      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>วันเกิด</Text>
        <TouchableOpacity
          style={[
            styles.input,
            styles.selectorInput,
            showError && styles.inputError,
          ]}
          onPress={() => {
            if (errors.dateOfBirth) setErrors((e) => ({ ...e, dateOfBirth: '' }));
            setShowDateModal(true);
          }}
        >
          <Text style={[styles.selectorText, !dateOfBirth && styles.placeholderText]}>
            {dateOfBirth
              ? new Date(dateOfBirth).toLocaleDateString('th-TH', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              : 'เลือกวันเกิด'}
          </Text>
          <Text style={styles.dropdownIcon}>📅</Text>
        </TouchableOpacity>
        {showError ? <Text style={styles.errorText}>{errors.dateOfBirth}</Text> : null}
      </View>
    );
  };
  // -------------------------------------------------------

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <View style={styles.headerContainer}>
          <Text style={styles.title}>สมัครสมาชิก</Text>
          <Text style={styles.subtitle}>สร้างบัญชีใหม่เพื่อเริ่มต้นใช้งาน</Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ข้อมูลการเข้าสู่ระบบ</Text>

            <InputField
              label="ชื่อผู้ใช้"
              value={username}
              onChangeText={clearErrorAnd('username', setUsername)}
              autoComplete="username"
              textContentType="username"
              error={errors.username}
            />
            <InputField
              label="อีเมล"
              value={email}
              onChangeText={clearErrorAnd('email', setEmail)}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              error={errors.email}
            />
            <InputField
              label="รหัสผ่าน"
              value={password}
              onChangeText={clearErrorAnd('password', setPassword)}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              error={errors.password}
            />
            <InputField
              label="ยืนยันรหัสผ่าน"
              value={confirmPassword}
              onChangeText={clearErrorAnd('confirmPassword', setConfirmPassword)}
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              error={errors.confirmPassword}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ข้อมูลส่วนตัว</Text>

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <InputField
                  label="ชื่อจริง"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <InputField
                  label="นามสกุล"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <GenderSelector />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <DateSelector />
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.button} onPress={handleRegister}>
            <Text style={styles.buttonText}>สมัครสมาชิก</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkButton} onPress={handleLogin}>
            <Text style={styles.linkText}>
              มีบัญชีแล้ว? <Text style={styles.linkTextBold}>เข้าสู่ระบบ</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Gender Modal */}
        <Modal
          visible={showGenderModal}
          transparent
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setShowGenderModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>เลือกเพศ</Text>
              {genderOptions.map((option, index) => (
                <TouchableOpacity
                  key={index}
                  style={[styles.modalOption, gender === option && styles.selectedOption]}
                  onPress={() => {
                    setGender(option);
                    if (errors.gender) setErrors((e) => ({ ...e, gender: '' }));
                    setShowGenderModal(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, gender === option && styles.selectedOptionText]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowGenderModal(false)}>
                <Text style={styles.modalCloseButtonText}>ยกเลิก</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Date Modal */}
        <Modal
          visible={showDateModal}
          transparent
          animationType="slide"
          statusBarTranslucent
          onRequestClose={() => setShowDateModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>เลือกวันเกิด</Text>

              <View style={styles.datePickerContainer}>
                <View style={styles.datePickerColumn}>
                  <Text style={styles.datePickerLabel}>วัน</Text>
                  <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
                    {Array.from({ length: 31 }, (_, i) => (i + 1).toString()).map((day) => (
                      <TouchableOpacity
                        key={day}
                        style={[styles.datePickerOption, selectedDay === day && styles.selectedDateOption]}
                        onPress={() => setSelectedDay(day)}
                      >
                        <Text style={[styles.datePickerOptionText, selectedDay === day && styles.selectedDateOptionText]}>
                          {day}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.datePickerColumn}>
                  <Text style={styles.datePickerLabel}>เดือน</Text>
                  <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
                    {months.map((month, index) => (
                      <TouchableOpacity
                        key={index}
                        style={[styles.datePickerOption, selectedMonth === month && styles.selectedDateOption]}
                        onPress={() => setSelectedMonth(month)}
                      >
                        <Text style={[styles.datePickerOptionText, selectedMonth === month && styles.selectedDateOptionText]}>
                          {month}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                <View style={styles.datePickerColumn}>
                  <Text style={styles.datePickerLabel}>ปี</Text>
                  <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
                    {generateYears().map((year) => (
                      <TouchableOpacity
                        key={year}
                        style={[styles.datePickerOption, selectedYear === year && styles.selectedDateOption]}
                        onPress={() => setSelectedYear(year)}
                      >
                        <Text style={[styles.datePickerOptionText, selectedYear === year && styles.selectedDateOptionText]}>
                          {year}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </View>

              <View style={styles.modalButtonContainer}>
                <TouchableOpacity style={styles.modalConfirmButton} onPress={handleDateConfirm}>
                  <Text style={styles.modalConfirmButtonText}>ยืนยัน</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowDateModal(false)}>
                  <Text style={styles.modalCloseButtonText}>ยกเลิก</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 20,
    backgroundColor: '#6366f1',
  },
  title: { fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#E2E8F0', textAlign: 'center' },
  formContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    marginTop: -20,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1e293b', marginBottom: 20, paddingLeft: 4 },
  inputContainer: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8, paddingLeft: 4 },
  input: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: '#1F2937',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  inputFocused: {
    borderColor: '#6366f1',
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  inputError: { borderColor: '#ef4444' },
  errorText: { marginTop: 6, color: '#ef4444', fontSize: 12 },
  row: { flexDirection: 'row', marginHorizontal: -10 },
  button: { backgroundColor: '#6366f1', paddingVertical: 18, borderRadius: 16, alignItems: 'center', marginTop: 20, marginBottom: 20 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  linkButton: { alignItems: 'center', paddingVertical: 16, marginBottom: 30 },
  linkText: { fontSize: 16, color: '#6B7280' },
  linkTextBold: { fontWeight: '600', color: '#6366f1' },
  selectorInput: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectorText: { fontSize: 16, color: '#1F2937', flex: 1 },
  placeholderText: { color: '#A0A0A0' },
  dropdownIcon: { fontSize: 16, color: '#6B7280', marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: width * 0.9, maxHeight: height * 0.7, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 },
  modalTitle: { fontSize: 20, fontWeight: '600', color: '#1e293b', textAlign: 'center', marginBottom: 20 },
  modalOption: { paddingVertical: 16, paddingHorizontal: 20, borderRadius: 12, marginBottom: 8, backgroundColor: '#F8FAFC' },
  selectedOption: { backgroundColor: '#6366f1' },
  modalOptionText: { fontSize: 16, color: '#374151', textAlign: 'center' },
  selectedOptionText: { color: '#FFFFFF', fontWeight: '500' },
  modalCloseButton: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, marginTop: 16, backgroundColor: '#F3F4F6' },
  modalCloseButtonText: { fontSize: 16, color: '#6B7280', textAlign: 'center', fontWeight: '500' },
  datePickerContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  datePickerColumn: { flex: 1, marginHorizontal: 4 },
  datePickerLabel: { fontSize: 14, fontWeight: '500', color: '#374151', textAlign: 'center', marginBottom: 12 },
  datePickerScroll: { maxHeight: 200, backgroundColor: '#F8FAFC', borderRadius: 12 },
  datePickerOption: { paddingVertical: 12, paddingHorizontal: 8, borderRadius: 8, marginVertical: 2, marginHorizontal: 4 },
  selectedDateOption: { backgroundColor: '#6366f1' },
  datePickerOptionText: { fontSize: 14, color: '#374151', textAlign: 'center' },
  selectedDateOptionText: { color: '#FFFFFF', fontWeight: '500' },
  modalButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  modalConfirmButton: { flex: 1, paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, backgroundColor: '#6366f1' },
  modalConfirmButtonText: { fontSize: 16, color: '#FFFFFF', textAlign: 'center', fontWeight: '600' },
});

export default RegisterScreen;
