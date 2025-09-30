import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// ถ้าไฟล์อยู่ในโฟลเดอร์ (tabs) ก็อิมพอร์ตตรงนี้ได้
import LoginScreen from './(tabs)/login';
import HomeScreen from './(tabs)/Homesrceen';   // ชื่อไฟล์ Homesreen สะกดถูกตามไฟล์จริงนะครับ
import RegisterScreen from './(tabs)/register';
import RegisterSuccessScreen from './(tabs)/RegisterSuccess';
import StatsScreen from './(tabs)/StatsScreen';
import CalorieTrackerScreen from './(tabs)/CalorieTrackerScreen';
const Stack = createNativeStackNavigator();

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShown: false }}   // << ซ่อนแถบด้านบน
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="login" component={LoginScreen} />
        <Stack.Screen name="register" component={RegisterScreen} />
        <Stack.Screen name="RegisterSuccess" component={RegisterSuccessScreen} />
        <Stack.Screen name="Stats" component={StatsScreen} />
        <Stack.Screen name="CalorieTrackerScreen" component={CalorieTrackerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
