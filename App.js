import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import LocTrack from './Components/locTrack';
import ForgotPassword from './Components/Auth/ForgotPassword';
import VerifyEmail from './Components/Auth/VerifyEmail';
import InvitationScreen from './Components/Auth/InvitationScreen';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import ProductKeyManager from './Components/Admin/ProductKeyManager';
import AdminDashboard from './Components/Admin/AdminDashboard';
import UserDetail from './Components/Admin/UserDetail';
import { initializeAdmin } from './scripts/initAdmin';
import { getDatabase, ref, get, set } from 'firebase/database';
import Profile from './Components/Profile/Profile';
import EditProfile from './Components/Profile/EditProfile';
import Dashboard from './Components/IoT/Dashboard';
import Ionicons from 'react-native-vector-icons/Ionicons';

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
          try {
            console.log("User logged in:", user.uid, user.email);
            const db = getDatabase();
            const userProfileRef = ref(db, `users/${user.uid}/profile`);
            const snapshot = await get(userProfileRef);
            
            if (snapshot.exists()) {
              const userData = snapshot.val();
              console.log('User Profile Data:', userData);
              console.log('Is Admin:', userData.isAdmin);
              console.log('User Role:', userData.role);
              
              // Set user with admin status - check both isAdmin and role
              const isAdminUser = userData.isAdmin === true || userData.role === 'admin';
              const userWithAdmin = {
                ...user,
                isAdmin: isAdminUser
              };
              console.log('User Object with Admin:', userWithAdmin);
              setUser(userWithAdmin);
              
              // Admin users are always verified
              setIsVerified(isAdminUser || user.emailVerified);
              console.log('Is Verified:', isAdminUser || user.emailVerified);
            } else {
              console.log('No profile found for user:', user.uid);
              
              // Create a default profile for the user if none exists
              const defaultProfile = {
                firstName: user.displayName ? user.displayName.split(' ')[0] : '',
                lastName: user.displayName ? user.displayName.split(' ').slice(1).join(' ') : '',
                email: user.email,
                createdAt: new Date().toISOString(),
                role: 'member',
                isAdmin: false,
                isOwner: false,
                emailVerified: user.emailVerified
              };
              
              // If this is the hardcoded admin email, set admin role
              if (user.email.toLowerCase() === 'ab@loctrack.com') {
                defaultProfile.role = 'admin';
                defaultProfile.isAdmin = true;
                defaultProfile.emailVerified = true;
                console.log('Setting admin role for hardcoded admin account');
              }
              
              console.log('Creating default profile:', defaultProfile);
              await set(ref(db, `users/${user.uid}/profile`), defaultProfile);
              
              // Update user object with admin status
              const userWithAdmin = {
                ...user,
                isAdmin: defaultProfile.isAdmin
              };
              
              setUser(userWithAdmin);
              setIsVerified(defaultProfile.isAdmin || user.emailVerified);
            }
          } catch (error) {
            console.error('Error loading user profile:', error);
            // Fall back to basic user info
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
          // Check if user is admin first, then check verification
          user.isAdmin ? (
            <>
              <Stack.Screen 
                name="AdminDashboard" 
                component={AdminDashboard}
                options={{ 
                  headerShown: true,
                  title: 'Admin Dashboard',
                  headerBackVisible: false,
                  headerRight: () => (
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          await signOut(getAuth());
                        } catch (error) {
                          console.error('Error signing out:', error);
                        }
                      }}
                      style={{ marginRight: 15 }}
                    >
                      <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
                    </TouchableOpacity>
                  ),
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
                name="ProductKeyManager" 
                component={ProductKeyManager}
                options={{ 
                  headerShown: true,
                  title: 'Product Keys',
                }}
              />
              <Stack.Screen 
                name="UserDetail" 
                component={UserDetail}
                options={{ 
                  headerShown: true,
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="Dashboard" 
                component={Dashboard}
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
                  animation: 'slide_from_right',
                }}
              />
              <Stack.Screen 
                name="EditProfile" 
                component={EditProfile}
                options={{ 
                  headerShown: false,
                  animation: 'slide_from_right'
                }}
              />
            </>
          ) : isVerified ? (
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
                name="Dashboard" 
                component={Dashboard}
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
                  animation: 'slide_from_right',
                }}
              />
              <Stack.Screen 
                name="EditProfile" 
                component={EditProfile}
                options={{ 
                  headerShown: false,
                  animation: 'slide_from_right'
                }}
              />
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
            <Stack.Screen 
              name="InvitationScreen" 
              component={InvitationScreen}
              options={{ 
                headerShown: true,
                title: 'Team Invitation',
                headerBackVisible: false,
                gestureEnabled: false,
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
