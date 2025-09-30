import { Tabs } from 'expo-router';
import React from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
          }}
        />
        {/* Hide non-tab routes from the tab bar */}
        <Tabs.Screen name="login" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="register" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="RegisterSuccess" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="LoginSuccessScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="Onboarding" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="ForgotPassword" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="ForgotEmail" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="Profile" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="EditProfile" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="ProfileSetupScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="Homesrceen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="SaveResult" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="StatsScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="StartWorkout" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="WorkoutProgram" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="WorkoutPlanDetail" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="CalorieTrackerScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="ProgressTrackerScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="AIRecommendationScreen" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="ExerciseLibrary" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="WaterTracker" options={{ href: null, headerShown: false }} />
        <Tabs.Screen name="explore" options={{ href: null, headerShown: false }} />
      </Tabs>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
