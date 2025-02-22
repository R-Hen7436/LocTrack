import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import LocTrack from './Components/locTrack';
import ForgotPassword from './Components/Auth/ForgotPassword';
import { View, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    return unsubscribe;
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
      <Stack.Navigator>
        {user ? (
          // Protected routes
          <Stack.Screen 
            name="LocTrack" 
            component={LocTrack}
            options={{ headerShown: false }}
          />
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
