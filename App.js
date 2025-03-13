import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import LocTrack from './Components/locTrack';
import ForgotPassword from './Components/Auth/ForgotPassword';
import VerifyEmail from './Components/Auth/VerifyEmail';
import { View, ActivityIndicator, Text } from 'react-native';
import ProductKeyManager from './Components/Admin/ProductKeyManager';
import { initializeAdmin } from './scripts/initAdmin';
import { getDatabase, ref, get } from 'firebase/database';
import Profile from './Components/Profile/Profile';

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    const setupApp = async () => {
      const auth = getAuth();
      
      try {
        // Initialize admin account if it doesn't exist
        await initializeAdmin();
      } catch (error) {
        console.error('Admin initialization error:', error);
      }

      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          const db = getDatabase();
          const userProfileRef = ref(db, `users/${user.uid}/profile`);
          const snapshot = await get(userProfileRef);
          
          if (snapshot.exists()) {
            const userData = snapshot.val();
            setUser({
              ...user,
              isAdmin: userData.isAdmin
            });
            setIsVerified(userData.isAdmin || user.emailVerified);
          } else {
            setUser(user);
            setIsVerified(user.emailVerified);
          }
        } else {
          setUser(null);
          setIsVerified(false);
        }
        setLoading(false);
      });

      return unsubscribe;
    };

    setupApp();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#0000ff" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          presentation: 'card',
          animation: 'slide_from_right',
        }}
      >
        {user ? (
          isVerified ? (
            <>
              {user?.isAdmin ? (
                <>
                  <Stack.Screen 
                    name="ProductKeyManager" 
                    component={ProductKeyManager}
                    options={{ 
                      headerShown: true,
                      title: 'Product Keys'
                    }}
                  />
                  <Stack.Screen 
                    name="LocTrack" 
                    component={LocTrack}
                    options={{ 
                      headerShown: false,
                      animation: 'slide_from_left'
                    }}
                  />
                  <Stack.Screen 
                    name="Profile" 
                    component={Profile}
                    options={{ 
                      headerShown: true,
                      title: 'My Profile',
                      headerBackVisible: false,
                      animation: 'slide_from_right'
                    }}
                  />
                </>
              ) : (
                <>
                  <Stack.Screen 
                    name="LocTrack" 
                    component={LocTrack}
                    options={{ 
                      headerShown: false,
                      animation: 'slide_from_left'
                    }}
                  />
                  <Stack.Screen 
                    name="Profile" 
                    component={Profile}
                    options={{ 
                      headerShown: true,
                      title: 'My Profile',
                      headerBackVisible: false,
                      animation: 'slide_from_right'
                    }}
                  />
                </>
              )}
            </>
          ) : (
            <Stack.Screen 
              name="VerifyEmail" 
              component={VerifyEmail}
              options={{ headerShown: false }}
            />
          )
        ) : (
          // Auth routes
          <>
            <Stack.Screen 
              name="Login" 
              component={Login}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Register" 
              component={Register}
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="ForgotPassword" 
              component={ForgotPassword}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
