import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';
import Login from './Components/Auth/Login';
import Register from './Components/Auth/Register';
import LocTrack from './Components/locTrack';
import ForgotPassword from './Components/Auth/ForgotPassword';
import VerifyEmail from './Components/Auth/VerifyEmail';
import ChangePassword from './Components/Auth/ChangePassword';
import InvitationScreen from './Components/Auth/InvitationScreen';
import { View, ActivityIndicator, Text, TouchableOpacity, Linking, Platform, Alert } from 'react-native';
import ProductKeyManager from './Components/Admin/ProductKeyManager';
import AdminDashboard from './Components/Admin/AdminDashboard';
import UserDetail from './Components/Admin/UserDetail';
import { initializeAdmin } from './scripts/initAdmin';
import { getDatabase, ref, get, set, onValue } from 'firebase/database';
import Profile from './Components/Profile/Profile';
import EditProfile from './Components/Profile/EditProfile';
import Dashboard from './Components/IoT/Dashboard';
import Ionicons from 'react-native-vector-icons/Ionicons';
import GeofenceRequests from './Components/Admin/GeofenceRequests';
import OwnerInitialization from './Components/Auth/OwnerInitialization';
import LocationLog from './Components/History/locationLogs';
import StepTracker from './Components/StepTracker';
import Logs from './Components/Logs';
import UserManagement from './Components/UserManagement';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';

const Stack = createNativeStackNavigator();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState(null);

  // Add notification received handler
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground:', notification);
    });

    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
    });

    return () => {
      subscription.remove();
      responseSubscription.remove();
    };
  }, []);

  // Configure notifications when component mounts
  useEffect(() => {
    const configureNotifications = async () => {
      try {
        // Configure notification handler
        Notifications.setNotificationHandler({
          handleNotification: async () => {
            console.log('Handling notification...');
            return {
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
              priority: Notifications.AndroidNotificationPriority.HIGH,
            };
          },
        });

        // Request permissions
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        console.log('Existing notification status:', existingStatus);
        
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          console.log('Requesting notification permissions...');
          const { status } = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
              allowAnnouncements: true,
            },
          });
          finalStatus = status;
        }

        setNotificationStatus(finalStatus);
        console.log('Final notification status:', finalStatus);

      } catch (error) {
        console.error('Error setting up notifications:', error);
      }
    };

    configureNotifications();
  }, []);

  // Separate useEffect for setting up device listeners
  useEffect(() => {
    if (!user) return; // Only proceed if user is logged in

    console.log('Setting up device listeners');
    const db = getDatabase();
    
    // Set up device listener
    const setupDeviceListener = async () => {
      const iotsRef = ref(db, 'IOTs');
      return onValue(iotsRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        
        const devices = snapshot.val();
        console.log('Device update received:', devices);
        
        Object.entries(devices).forEach(async ([deviceId, device]) => {
          try {
            // Handle shock detection
            if (device.Readings === "Shock Detected") {
              console.log('Shock detected for device:', deviceId);
              
              // Send notification for shock detection
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: "⚠️ SHOCK DETECTED!",
                  body: `Device ${deviceId} has detected a shock. Tap to call emergency services.`,
                  data: { type: 'shock', deviceId },
                  sound: true,
                  priority: Notifications.AndroidNotificationPriority.HIGH,
                },
                trigger: null, // null means send immediately
              });
              
              // Show alert with auto-dial option for 911
              Alert.alert(
                '⚠️ SHOCK DETECTED!',
                `Device ${deviceId} has detected a shock. Call Emergency Services (911) immediately?`,
                [
                  {
                    text: 'Cancel',
                    style: 'cancel'
                  },
                  {
                    text: 'Call 911',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const phoneUrl = `tel:911`;
                        const canOpen = await Linking.canOpenURL(phoneUrl);
                        if (canOpen) {
                          await Linking.openURL(phoneUrl);
                        } else if (Platform.OS === 'android') {
                          await IntentLauncher.startActivityAsync(
                            'android.intent.action.DIAL',
                            { data: phoneUrl }
                          );
                        }
                      } catch (error) {
                        console.error('Error making emergency call:', error);
                        Alert.alert('Error', 'Failed to initiate call. Please dial 911 manually.');
                      }
                    }
                  }
                ],
                { cancelable: false }
              );
            }
            
            // Handle smoke detection
            if (device.Environment === "Smoke Detected") {
              console.log('Smoke detected for device:', deviceId);
              
              // Send notification for smoke detection
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: "🚨 SMOKE DETECTED!",
                  body: `Device ${deviceId} has detected smoke. Tap to call emergency services.`,
                  data: { type: 'smoke', deviceId },
                  sound: true,
                  priority: Notifications.AndroidNotificationPriority.HIGH,
                },
                trigger: null, // null means send immediately
              });
              
              // Show alert with auto-dial option for 911
              Alert.alert(
                '🚨 SMOKE DETECTED!',
                `Device ${deviceId} has detected smoke. Call Emergency Services (911) immediately?`,
                [
                  {
                    text: 'Cancel',
                    style: 'cancel'
                  },
                  {
                    text: 'Call 911',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        const phoneUrl = `tel:911`;
                        const canOpen = await Linking.canOpenURL(phoneUrl);
                        if (canOpen) {
                          await Linking.openURL(phoneUrl);
                        } else if (Platform.OS === 'android') {
                          await IntentLauncher.startActivityAsync(
                            'android.intent.action.DIAL',
                            { data: phoneUrl }
                          );
                        }
                      } catch (error) {
                        console.error('Error making emergency call:', error);
                        Alert.alert('Error', 'Failed to initiate call. Please dial 911 manually.');
                      }
                    }
                  }
                ],
                { cancelable: false }
              );
            }
          } catch (error) {
            console.error('Error processing device update:', error);
          }
        });
      });
    };

    // Set up the listener
    let deviceListener = null;
    setupDeviceListener().then(listener => {
      deviceListener = listener;
    });

    // Cleanup function
    return () => {
      if (deviceListener) deviceListener();
    };
  }, [user]); // Only depend on user changes

  // Add notification tap handler
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const { type, deviceId } = response.notification.request.content.data;
      
      // Handle notification tap by initiating emergency call
      try {
        Linking.openURL('tel:911');
      } catch (error) {
        console.error('Error making emergency call from notification:', error);
        Alert.alert('Error', 'Failed to initiate call. Please dial 911 manually.');
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const setupApp = async () => {
      const auth = getAuth();
      const db = getDatabase();
      
      try {
        await initializeAdmin();
        
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
          if (user) {
            try {
              console.log("User logged in:", user.uid);
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

              // Set up device listeners only if notifications are permitted
              if (notificationStatus === 'granted') {
                console.log('Setting up device listeners for authenticated user');
                const deviceListener = setupDeviceListeners();
                return () => {
                  console.log('Cleaning up device listeners');
                  if (deviceListener) deviceListener();
                };
              } else {
                console.warn('Notifications not permitted:', notificationStatus);
              }
            } catch (error) {
              console.error('Error in auth state change:', error);
            }
          } else {
            setUser(null);
            setIsVerified(false);
          }
          setLoading(false);
        });

        return () => {
          unsubscribe();
        };
      } catch (error) {
        console.error('Setup error:', error);
        setLoading(false);
      }
    };

    setupApp();
  }, [notificationStatus]); // Added notificationStatus as dependency

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
                name="GeofenceRequests" 
                component={GeofenceRequests}
                options={{ 
                  headerShown: false,
                  animation: 'slide_from_right'
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
                name="Logs" 
                component={Logs}
                options={{ 
                  headerShown: false,
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="UserManagement" 
                component={UserManagement}
                options={{ 
                  headerShown: false,
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
              <Stack.Screen 
                name="locationLogs" 
                component={LocationLog}
                options={{ 
                  headerShown: true,
                  title: 'Location History',
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="OwnerInitialization" 
                component={OwnerInitialization}
                options={{ 
                  headerShown: true,
                  title: 'Geofence Setup',
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="StepTracker" 
                component={StepTracker}
                options={{ 
                  headerShown: true,
                  title: 'Step Tracker',
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
              <Stack.Screen 
                name="locationLogs" 
                component={LocationLog}
                options={{ 
                  headerShown: true,
                  title: 'Location History',
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="OwnerInitialization" 
                component={OwnerInitialization}
                options={{ 
                  headerShown: true,
                  title: 'Geofence Setup',
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="StepTracker" 
                component={StepTracker}
                options={{ 
                  headerShown: true,
                  title: 'Step Tracker',
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="Logs" 
                component={Logs}
                options={{ 
                  headerShown: false,
                  animation: 'slide_from_right'
                }}
              />
              <Stack.Screen 
                name="UserManagement" 
                component={UserManagement}
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
            <Stack.Screen 
              name="VerifyEmail" 
              component={VerifyEmail}
              options={{ 
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen 
              name="ChangePassword" 
              component={ChangePassword}
              options={{ 
                headerShown: true,
                title: 'Change Password',
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
