import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Alert, ActivityIndicator, SafeAreaView } from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, set, remove, onValue, push, serverTimestamp, update } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Navbar from './Navbar';
import CacheManager from './utils/CacheManager';

// Cache keys
const CACHE_KEYS = {
  TEAM_MEMBERS: 'cache:team-members',
  USER_STATS: 'cache:user-stats',
  TEAM_CODE: 'cache:team-code',
  TEAM_GEOFENCE: 'cache:team-geofence', // Added for geofence data
};

// Cache TTLs (time-to-live)
const CACHE_TTL = {
  TEAM_MEMBERS: 5 * 60 * 1000, // 5 minutes for team members
  USER_STATS: 2 * 60 * 1000,   // 2 minutes for stats (changes more frequently)
  TEAM_CODE: 60 * 60 * 1000,   // 1 hour for team code (rarely changes)
  TEAM_GEOFENCE: 10 * 60 * 1000, // 10 minutes for geofence data
};

// Format name function to safely handle empty or null fields
const formatName = (firstName, middleName, lastName) => {
  const parts = [];
  if (firstName && firstName.trim()) parts.push(firstName.trim());
  if (middleName && middleName.trim()) parts.push(middleName.trim());
  if (lastName && lastName.trim()) parts.push(lastName.trim());
  
  return parts.length > 0 ? parts.join(' ') : 'User';
}

// Helper function to get initials
const getInitials = (firstName, lastName) => {
  let initials = '';
  if (firstName && firstName.trim()) {
    initials += firstName.trim()[0].toUpperCase();
  }
  if (lastName && lastName.trim()) {
    initials += lastName.trim()[0].toUpperCase();
  }
  return initials || '?';
};

// Format last seen time
const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'Never';
  
  const lastSeen = new Date(timestamp);
  const now = new Date();
  const diffMinutes = Math.floor((now - lastSeen) / (1000 * 60));
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return lastSeen.toLocaleDateString();
};

// Format user status
const formatStatus = (status) => {
  if (!status) return 'Offline';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// Format coordinates to be more readable
const formatCoordinate = (value) => {
  if (value === undefined || value === null) return 'N/A';
  return value.toFixed(6);
};

// Format distance to be more readable
const formatDistance = (meters) => {
  if (meters === undefined || meters === null) return 'N/A';
  
  if (meters < 1000) {
    return `${meters.toFixed(0)}m`;
  } else {
    return `${(meters / 1000).toFixed(2)}km`;
  }
};

// Check if point is inside polygon
const isPointInsidePolygon = (point, polygon) => {
  if (!point || !polygon || !Array.isArray(polygon) || polygon.length < 3) return false;
  
  let x = point.latitude, y = point.longitude;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].latitude, yi = polygon[i].longitude;
    let xj = polygon[j].latitude, yj = polygon[j].longitude;

    let intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
};

// Log team activity to Firebase
const logTeamActivity = async (db, teamCode, userId, userName, eventType, message) => {
  if (!teamCode || !userId || !eventType) {
    console.error(`ACTIVITY LOG ERROR: Missing required parameters - teamCode: ${teamCode}, userId: ${userId}, eventType: ${eventType}`);
    return;
  }
  
  try {
    console.log(`Attempting to log activity: ${eventType} for user ${userName} (${userId}) in team ${teamCode}`);
    const logRef = ref(db, `teams/${teamCode}/activityLog`);
    const newLogEntryRef = push(logRef); // Get a unique key
    
    // Include both server timestamp and client timestamp to ensure we have a value
    const logEntry = {
      timestamp: serverTimestamp(), // Use server time for accuracy
      clientTimestamp: Date.now(), // Fallback client timestamp
      userId: userId,
      userName: userName || 'Unknown User',
      eventType: eventType, // e.g., 'geofenceEnter', 'geofenceExit'
      message: message || `User ${userName || userId} location changed.`
    };
    
    await set(newLogEntryRef, logEntry);
    console.log(`✅ ACTIVITY LOG SUCCESS: Event '${eventType}' for user ${userName || userId} logged to team ${teamCode}.`);
    
    // Double check if the log was actually written by reading it back
    try {
      const checkRef = ref(db, `teams/${teamCode}/activityLog/${newLogEntryRef.key}`);
      const checkSnapshot = await get(checkRef);
      
      if (checkSnapshot.exists()) {
        console.log(`✅ Verified log entry was written successfully: ${newLogEntryRef.key}`);
      } else {
        console.error(`❌ Failed to verify log entry was written: ${newLogEntryRef.key}`);
      }
    } catch (verifyError) {
      console.error('Error verifying log entry:', verifyError);
    }
  } catch (error) {
    console.error(`❌ ACTIVITY LOG ERROR: Failed to log event '${eventType}' for user ${userId}:`, error);
  }
};

// Send a notification
const sendNotification = async (title, body, data = {}) => {
  try {
    console.log(`Attempting to send notification: ${title} - ${body}`);
    
    // Configure notification channels first (required for Android)
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('geofence-alerts', {
        name: 'Geofence Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: true,
        enableVibrate: true,
      });
    }
    
    // Schedule the notification with the appropriate channel
    const notificationContent = {
      title: title,
      body: body,
      data: data,
      sound: true,
    };
    
    // Add Android-specific properties
    if (Platform.OS === 'android') {
      notificationContent.priority = Notifications.AndroidNotificationPriority.HIGH;
      notificationContent.channelId = 'geofence-alerts';
      notificationContent.sticky = true;
      notificationContent.autoDismiss = false;
    }
    
    // Schedule notification
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null, // Immediate notification
    });
    
    console.log(`✅ Notification sent successfully: ${title} (ID: ${notificationId})`);
    return notificationId;
  } catch (error) {
    console.error(`❌ Error sending notification:`, error);
    return null;
  }
};

// Add a new function to reset steps and location data
const resetStepsAndLocationData = async () => {
  try {
    Alert.alert(
      "Reset Testing Data",
      "This will reset your step count, location history, and geofence points for testing purposes. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Reset", 
          style: "destructive",
          onPress: async () => {
            // Show loading
            Alert.alert("Resetting...", "Please wait while data is being reset.", []);
            
            try {
              // 1. Reset local state
              setStepCount(0);
              stepCountRef.current = 0;
              setStepsSinceLastGpsUpdate(0);
              stepsSinceLastGpsUpdateRef.current = 0;
              setRealStepCount(0);
              setStepCountHistory([]);
              setLocationHistory([]);
              setIsUserMoving(false);
              setLastStepUpdateTime(Date.now());
              lastSmoothedCoordinateRef.current = null;
              lastTrailPointStepsRef.current = null;
              setPoints([]); // Reset owner points
              setTeamGeofence([]); // Reset member geofence
              
              if (auth.currentUser?.uid) {
                const db = getDatabase();
                
                // 2. Reset Firebase step data
                const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData`);
                await update(stepDataRef, {
                  lastStepCount: 0,
                  totalSteps: 0,
                  lastUpdateTimestamp: Date.now(),
                  history: []
                });
                
                // 3. Get user profile to determine role and team code
                const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
                const profileSnap = await get(userProfileRef);
                if (profileSnap.exists()) {
                  const userData = profileSnap.val();
                  const teamCode = userData.teamCode;
                  
                  if (teamCode) {
                    // 4. Reset team step data
                    const teamStepDataRef = ref(db, `teams/${teamCode}/locationStepData/${auth.currentUser.uid}`);
                    await remove(teamStepDataRef);
                    
                    // 5. Reset geofence data based on role
                    if (userData.role === 'owner') {
                      // Reset owner's geofence data
                      const teamGeofenceRef = ref(db, `teams/${teamCode}/geofence/coordinates`);
                      await set(teamGeofenceRef, []);
                      
                      // Reset owner's profile geofence data
                      const ownerGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
                      await remove(ownerGeofenceRef);
                      
                      console.log('Reset owner geofence data');
                    } else {
                      // Reset member's cached geofence data
                      const memberGeofenceCacheRef = ref(db, `users/${auth.currentUser.uid}/profile/teamGeofenceCache`);
                      await remove(memberGeofenceCacheRef);
                      
                      console.log('Reset member geofence cache');
                    }
                  }
                }
                
                // 6. Reset location history if needed
                if (currentLocation) {
                  const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
                  await update(userLocationRef, {
                    Timestamp: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                  });
                }
                
                Alert.alert("Reset Complete", "Step count, location history, and geofence data have been reset for testing purposes.");
              } else {
                Alert.alert("Error", "You must be logged in to reset data.");
              }
            } catch (error) {
              console.error("Error resetting data:", error);
              Alert.alert("Reset Failed", "There was an error resetting your data.");
            }
          }
        }
      ]
    );
  } catch (error) {
    console.error("Error in resetStepsAndLocationData:", error);
  }
};

export default function UserManagement({ navigation }) {
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamCode, setTeamCode] = useState('');
  const [membersLocations, setMembersLocations] = useState({});
  const [userStats, setUserStats] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [teamGeofence, setTeamGeofence] = useState([]);
  // Reference to store the previous geofence state of each member
  const previousGeofenceStateRef = useRef({});
  
  const auth = getAuth();
  const db = getDatabase();

  useEffect(() => {
    // Request notification permissions when component mounts
    const requestNotificationPermissions = async () => {
      try {
        // Configure notification handler with enhanced settings
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
            priority: Notifications.AndroidNotificationPriority.MAX, // Use MAX instead of HIGH for critical alerts
          }),
        });

        // Set up notification channels (required for Android)
        if (Platform.OS === 'android') {
          console.log('Setting up Android notification channels...');
          await Notifications.setNotificationChannelAsync('geofence-alerts', {
            name: 'Geofence Alerts',
            description: 'Notifications when team members enter or exit geofenced areas',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
            enableVibrate: true,
            sound: true,
          });
          console.log('Android notification channel setup complete');
        }

        // Request permissions
        console.log('Requesting notification permissions...');
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        console.log('Current notification permission status:', existingStatus);
        
        if (existingStatus !== 'granted') {
          console.log('Notification permission not granted, requesting...');
          const { status } = await Notifications.requestPermissionsAsync();
          console.log('New notification permission status:', status);
          
          if (status !== 'granted') {
            console.warn('Notification permission denied by user');
            Alert.alert(
              'Notification Permission Required',
              'Geofence alerts require notification permissions. Please enable them in your device settings.',
              [{ text: 'OK' }]
            );
          } else {
            console.log('Notification permission granted by user');
            // Send a test notification to ensure everything is working
            if (__DEV__) { // Only in development mode
              setTimeout(async () => {
                try {
                  await sendNotification(
                    'Notification System Active',
                    'The geofence alert system is now operational.',
                    { type: 'system', test: true }
                  );
                } catch (e) {
                  console.error('Failed to send test notification:', e);
                }
              }, 2000);
            }
          }
        } else {
          console.log('Notification permission already granted');
        }
        
        // Add listener for receiving notifications
        console.log('Setting up notification received listener...');
        const subscription = Notifications.addNotificationReceivedListener(notification => {
          console.log('Notification received in foreground:', notification);
        });
        
        console.log('Notification setup complete');
        
        // Make sure to return the subscription to clean it up later
        return subscription;
      } catch (error) {
        console.error('Error requesting notification permissions:', error);
        return null;
      }
    };

    const notificationSubscription = requestNotificationPermissions();
    
    async function initialize() {
      if (!auth.currentUser) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      
      // Check if we need to focus on geofence alerts
      try {
        const checkGeofenceAlerts = await AsyncStorage.getItem('checkGeofenceAlerts');
        if (checkGeofenceAlerts === 'true') {
          // Clear the flag
          await AsyncStorage.removeItem('checkGeofenceAlerts');
          
          // Show an alert to inform user they're viewing team members after a geofence alert
          setTimeout(() => {
            Alert.alert(
              'Geofence Alert',
              'You can monitor your team members and their geofence status here.',
              [{ text: 'OK' }]
            );
          }, 1000);
        }
      } catch (error) {
        console.error('Error checking geofence alerts:', error);
      }
      
      // Load cached data first to show immediately
      await loadCachedData();
      
      // Then fetch fresh data
      await loadTeamMembers(false);
      
      // Set up location listener
      const unsubscribe = setupLocationListener();
      
      // Load user stats
      await loadUserStats(false);
      
      // Load team geofence
      await loadTeamGeofence(false);
      
      return () => {
        if (unsubscribe) unsubscribe();
        if (notificationSubscription) notificationSubscription.remove();
      };
    }
    
    initialize().finally(() => {
      setLoading(false);
    });
    
    // Clean up notification subscription on component unmount
    return () => {
      if (notificationSubscription) notificationSubscription.remove();
    };
  }, []);

  const loadCachedData = async () => {
    try {
      // Load cached team members
      const cachedMembers = await CacheManager.get(CACHE_KEYS.TEAM_MEMBERS);
      if (cachedMembers) {
        setTeamMembers(cachedMembers);
      }
      
      // Load cached team code
      const cachedTeamCode = await CacheManager.get(CACHE_KEYS.TEAM_CODE);
      if (cachedTeamCode) {
        setTeamCode(cachedTeamCode);
      }
      
      // Load cached stats
      const cachedStats = await CacheManager.get(CACHE_KEYS.USER_STATS);
      if (cachedStats) {
        setUserStats(cachedStats);
      }
      
      // Load cached geofence
      const cachedGeofence = await CacheManager.get(CACHE_KEYS.TEAM_GEOFENCE);
      if (cachedGeofence) {
        setTeamGeofence(cachedGeofence);
      }
      
      console.log('Loaded cached data for User Management');
    } catch (error) {
      console.error('Error loading cached data:', error);
    }
  };

  const setupLocationListener = () => {
    try {
      const db = getDatabase();
      const locationsRef = ref(db, 'UsersCurrentLocation');
      
      return onValue(locationsRef, async (snapshot) => {
        if (!snapshot.exists() || !auth.currentUser) return;
        
        const locationsData = snapshot.val();
        console.log('User locations updated:', Object.keys(locationsData).length);
        
        // Get current user's team code
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const userSnapshot = await get(userProfileRef);
        
        if (userSnapshot.exists()) {
          const userData = userSnapshot.val();
          const userTeamCode = userData.teamCode;
          console.log(`Current user team code: ${userTeamCode}`);
          
          // Only include members from the same team
          const filteredLocations = {};
          const memberProfiles = {};
          
          // First determine which users are in the same team
          for (const userId in locationsData) {
            if (userId === auth.currentUser.uid) continue; // Skip current user
            
            try {
              const memberProfileRef = ref(db, `users/${userId}/profile`);
              const memberSnapshot = await get(memberProfileRef);
              
              if (memberSnapshot.exists()) {
                const memberData = memberSnapshot.val();
                const memberTeamCode = memberData.teamCode;
                
                // Only include users with matching team code
                if (memberTeamCode === userTeamCode) {
                  // Get presence status for this user
                  const presenceRef = ref(db, `users/${userId}/presence`);
                  const presenceSnapshot = await get(presenceRef);
                  const presenceData = presenceSnapshot.exists() ? presenceSnapshot.val() : { status: 'offline' };
                  
                  // Always include location data for team members regardless of presence status
                  filteredLocations[userId] = {
                    ...locationsData[userId],
                    presence: presenceData // Include presence data
                  };
                  
                  // Save member profile data for geofence checks
                  memberProfiles[userId] = memberData;
                  
                  console.log(`Added user ${userId} to visible members (team ${memberTeamCode}), status: ${presenceData.status}`);
                } else {
                  console.log(`Skipped user ${userId} - different team (${memberTeamCode} vs ${userTeamCode})`);
                }
              }
            } catch (error) {
              console.error(`Error fetching profile for user ${userId}:`, error);
            }
          }
          
          console.log(`Filtered locations: ${Object.keys(filteredLocations).length} team members found`);
          setMembersLocations(filteredLocations);
          
          // Check geofence status for each team member and log/notify changes
          if (teamGeofence.length >= 3) {
            console.log(`Checking geofence status for ${Object.keys(filteredLocations).length} team members against a geofence with ${teamGeofence.length} points`);
            
            for (const userId in filteredLocations) {
              const memberLocation = filteredLocations[userId];
              const memberData = memberProfiles[userId];
              
              if (memberLocation.Latitude && memberLocation.Longitude) {
                const memberPoint = {
                  latitude: memberLocation.Latitude,
                  longitude: memberLocation.Longitude
                };
                
                const isInsideGeofence = isPointInsidePolygon(memberPoint, teamGeofence);
                const memberName = formatName(memberData.firstName, memberData.middleName, memberData.lastName);
                
                // Get previous state from ref (default to undefined if not set yet)
                const previousState = previousGeofenceStateRef.current[userId];
                
                console.log(`User ${memberName} (${userId}): 
                  Current location: ${memberPoint.latitude}, ${memberPoint.longitude}
                  Current geofence status: ${isInsideGeofence ? 'INSIDE' : 'OUTSIDE'}
                  Previous geofence status: ${previousState === undefined ? 'UNKNOWN (first check)' : previousState ? 'INSIDE' : 'OUTSIDE'}
                `);
                
                if (previousState === undefined) {
                  // This is the first check, so we just store the state without notifying
                  console.log(`⏭️ First status check for ${memberName}, setting initial state to ${isInsideGeofence ? 'INSIDE' : 'OUTSIDE'} without notification`);
                  
                  // Update the ref with the initial state
                  previousGeofenceStateRef.current = {
                    ...previousGeofenceStateRef.current,
                    [userId]: isInsideGeofence
                  };
                } 
                // ONLY log and notify if there's a CHANGE in state
                else if (previousState !== isInsideGeofence) {
                  console.log(`🔄 State change detected for ${memberName}!`);
                  
                  // Update the ref with the new state
                  previousGeofenceStateRef.current = {
                    ...previousGeofenceStateRef.current,
                    [userId]: isInsideGeofence
                  };
                  
                  const eventType = isInsideGeofence ? 'geofenceEnter' : 'geofenceExit';
                  const message = isInsideGeofence
                    ? `${memberName} is now inside the Geofenced Area.`
                    : `${memberName} is now outside the Geofenced Area.`;
                    
                  console.log(`📝 Will log event: ${eventType} - ${message}`);
                  
                  // Log the activity - wrap in try/catch to ensure notification still runs
                  try {
                    await logTeamActivity(db, userTeamCode, userId, memberName, eventType, message);
                  } catch (logError) {
                    console.error(`Failed to log geofence activity: ${logError.message}`);
                  }
                  
                  console.log(`🔔 Will send notification for: ${memberName}`);
                  
                  // Add slight delay to avoid notification congestion
                  setTimeout(async () => {
                    // Send notification - wrap in a separate try/catch
                    try {
                      // Force notification to be sent regardless of other errors
                      await sendNotification(
                        `Geofence Alert: ${memberName}`,
                        message,
                        { 
                          type: 'geofence', 
                          userId, 
                          inside: isInsideGeofence,
                          userName: memberName,
                          timestamp: Date.now()
                        }
                      );
                      
                      // Double-check notification was sent
                      console.log(`✅ Geofence notification dispatched for ${memberName} - ${eventType}`);
                    } catch (notifyError) {
                      console.error(`Failed to send notification: ${notifyError.message}`);
                      
                      // Fallback to Alert if push notification fails
                      Alert.alert(
                        `Geofence Alert: ${memberName}`,
                        message,
                        [{ text: 'OK' }]
                      );
                    }
                  }, 500); // 500ms delay
                } else {
                  console.log(`⏭️ No state change for ${memberName}, skipping log/notification. Still ${isInsideGeofence ? 'INSIDE' : 'OUTSIDE'}.`);
                }
              } else {
                console.log(`⚠️ No valid location data for member ${memberProfiles[userId]?.firstName || userId}`);
              }
            }
          } else {
            console.log(`⚠️ Not enough geofence points (${teamGeofence.length}) to perform geofence check, minimum required: 3`);
          }
        } else {
          console.error("Current user profile not found");
        }
      });
    } catch (error) {
      console.error('Error setting up location listener:', error);
      return null;
    }
  };

  const loadTeamGeofence = async (showLoading = true) => {
    if (showLoading) {
      setIsRefreshing(true);
    }
    
    try {
      const fetchGeofence = async () => {
        if (!auth.currentUser) return [];
        
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const profileSnapshot = await get(userProfileRef);
        const userTeamCode = profileSnapshot.val()?.teamCode;
        
        if (!userTeamCode) {
          console.log("No team code found, cannot load geofence");
          return [];
        }
        
        // Use team-specific geofence path
        const geofenceRef = ref(db, `teams/${userTeamCode}/geofence/coordinates`);
        const geofenceSnapshot = await get(geofenceRef);
        
        if (geofenceSnapshot.exists()) {
          const coordinates = geofenceSnapshot.val();
          console.log(`Loaded team geofence with ${coordinates.length} points`);
          return coordinates;
        } else {
          console.log(`No geofence found for team ${userTeamCode}`);
          return [];
        }
      };
      
      // Get data with auto-refresh capability
      const geofence = await CacheManager.getWithAutoRefresh(
        CACHE_KEYS.TEAM_GEOFENCE,
        fetchGeofence,
        CACHE_TTL.TEAM_GEOFENCE
      );
      
      if (geofence) {
        setTeamGeofence(geofence);
      }
    } catch (error) {
      console.error('Error loading team geofence:', error);
    } finally {
      if (showLoading) {
        setIsRefreshing(false);
      }
    }
  };

  const loadUserStats = async (showLoading = true) => {
    if (showLoading) {
      setIsRefreshing(true);
    }
    
    try {
      const fetchStats = async () => {
        // Try to get from database
        const statsRef = ref(db, 'userStats');
        const snapshot = await get(statsRef);
        
        if (snapshot.exists()) {
          return snapshot.val();
        } else {
          // Generate placeholder data
          console.log('No user statistics found, using placeholder data');
          const placeholderStats = {};
          teamMembers.forEach(member => {
            placeholderStats[member.id] = {
              totalDistance: Math.floor(Math.random() * 10000), // Random distance in meters for demo
              lastLocationDateTime: new Date().toISOString()
            };
          });
          return placeholderStats;
        }
      };
      
      // Get data with auto-refresh capability
      const stats = await CacheManager.getWithAutoRefresh(
        CACHE_KEYS.USER_STATS,
        fetchStats,
        CACHE_TTL.USER_STATS
      );
      
      if (stats) {
        setUserStats(stats);
      }
    } catch (error) {
      console.error('Error loading user statistics:', error);
    } finally {
      if (showLoading) {
        setIsRefreshing(false);
      }
    }
  };

  const loadTeamMembers = async (showLoading = true) => {
    if (showLoading) {
      setIsRefreshing(true);
    }
    
    try {
      if (!auth.currentUser) {
        setIsRefreshing(false);
        return;
      }

      const fetchTeamMembers = async () => {
        // Get owner's team code
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const snapshot = await get(userProfileRef);
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          if (userData.teamCode) {
            // Cache team code separately (long TTL)
            await CacheManager.set(
              CACHE_KEYS.TEAM_CODE, 
              userData.teamCode,
              CACHE_TTL.TEAM_CODE
            );
            
            setTeamCode(userData.teamCode);
            
            // Find all users with this team code
            const usersRef = ref(db, 'users');
            const usersSnapshot = await get(usersRef);
            
            if (usersSnapshot.exists()) {
              const users = usersSnapshot.val();
              const members = [];
              
              // Process each user
              for (const userId of Object.keys(users)) {
                const user = users[userId];
                
                // Only include members of this team who are not the owner
                if (user.profile && 
                    user.profile.teamCode === userData.teamCode && 
                    userId !== auth.currentUser.uid) {
                  
                  // Get presence data for this user
                  let presenceData = { status: 'offline', lastSeen: null };
                  if (user.presence) {
                    presenceData = user.presence;
                  } else {
                    // If presence is not in the user object, try to get it directly
                    const presenceRef = ref(db, `users/${userId}/presence`);
                    const presenceSnapshot = await get(presenceRef);
                    if (presenceSnapshot.exists()) {
                      presenceData = presenceSnapshot.val();
                    }
                  }
                  
                  members.push({
                    id: userId,
                    ...user.profile,
                    presence: presenceData
                  });
                }
              }
              
              return members;
            }
          }
        }
        
        return [];
      };
      
      // Get data with auto-refresh capability
      const members = await CacheManager.getWithAutoRefresh(
        CACHE_KEYS.TEAM_MEMBERS,
        fetchTeamMembers,
        CACHE_TTL.TEAM_MEMBERS
      );
      
      if (members) {
        setTeamMembers(members);
      }
      
      // Also refresh user stats when team members are refreshed
      await loadUserStats(false);
      
    } catch (error) {
      console.error('Error loading team members:', error);
    } finally {
      if (showLoading) {
        setIsRefreshing(false);
      }
    }
  };

  const handleRefresh = () => {
    loadTeamMembers(true);
    loadTeamGeofence(false);
  };

  const handleRemoveMember = (memberId, memberName) => {
    Alert.alert(
      'Remove Team Member',
      `Are you sure you want to remove ${memberName} from your team?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              // Update the member's profile to remove team code
              const memberProfileRef = ref(db, `users/${memberId}/profile`);
              const snapshot = await get(memberProfileRef);
              
              if (snapshot.exists()) {
                const memberData = snapshot.val();
                await set(memberProfileRef, {
                  ...memberData,
                  teamCode: '',
                  role: 'member'
                });
                
                // Update the UI
                setTeamMembers(prev => prev.filter(member => member.id !== memberId));
                
                // Update cache
                await CacheManager.set(
                  CACHE_KEYS.TEAM_MEMBERS,
                  teamMembers.filter(member => member.id !== memberId),
                  CACHE_TTL.TEAM_MEMBERS
                );
                
                Alert.alert('Success', `${memberName} has been removed from your team.`);
              }
            } catch (error) {
              console.error('Error removing team member:', error);
              Alert.alert('Error', 'Failed to remove team member. Please try again.');
            }
          }
        }
      ]
    );
  };

  const renderMemberItem = ({ item }) => {
    const memberName = formatName(item.firstName, item.middleName, item.lastName);
    const memberLocation = membersLocations[item.id] || {};
    const memberStats = userStats[item.id] || { totalDistance: 0 };
    
    // Log information about the member's location
    console.log(`Rendering member ${item.id} (${memberName}): 
      Has location data: ${memberLocation.Latitude ? 'YES' : 'NO'}
      Presence status: ${item.presence?.status || 'unknown'}`);
    
    // Check if member is online based on presence status only, not location data
    const isOnline = item.presence?.status === 'online';
    
    // Check if the member is inside the geofence area
    let isInsideGeofence = false;
    if (memberLocation.Latitude && memberLocation.Longitude && teamGeofence.length >= 3) {
      const memberPoint = {
        latitude: memberLocation.Latitude,
        longitude: memberLocation.Longitude
      };
      isInsideGeofence = isPointInsidePolygon(memberPoint, teamGeofence);
      console.log(`Member ${memberName} is ${isInsideGeofence ? 'INSIDE' : 'OUTSIDE'} the geofence`);
    }
    
    return (
      <View style={styles.memberItem}>
        <View style={styles.memberInfo}>
          {item.photoURL ? (
            <Image source={{ uri: item.photoURL }} style={styles.memberAvatar} />
          ) : (
            <View style={styles.memberAvatarFallback}>
              <Text style={styles.memberAvatarText}>
                {getInitials(item.firstName, item.lastName)}
              </Text>
            </View>
          )}
          
          <View style={styles.memberTextInfo}>
            <Text style={styles.memberName}>{memberName}</Text>
            <Text style={styles.memberEmail}>{item.email || 'No email'}</Text>
            
            {/* Location coordinates */}
            <View style={styles.locationContainer}>
              <Ionicons name="location" size={14} color={memberLocation.Latitude ? "#007AFF" : "#8E8E93"} />
              <Text style={styles.locationText}>
                {memberLocation.Latitude ? 
                  `Lat: ${formatCoordinate(memberLocation.Latitude)}, Lng: ${formatCoordinate(memberLocation.Longitude)}` :
                  'Location not available'}
              </Text>
            </View>
            
            {/* Indicators row */}
            <View style={styles.indicatorsRow}>
              {/* Total distance traveled */}
              {/* <View style={styles.indicator}>
                <Ionicons name="fitness" size={14} color="red" />
                <Text style={styles.indicatorText}>
                  {formatDistance(memberStats.totalDistance)}
                </Text>
              </View> */}
              
              {/* Geofence status indicator */}
              {memberLocation.Latitude && teamGeofence.length >= 3 && (
                <View style={[
                  styles.indicator,
                  isInsideGeofence ? styles.insideGeofence : styles.outsideGeofence
                ]}>
                  <Ionicons 
                    name={isInsideGeofence ? "shield-checkmark" : "shield-outline"} 
                    size={14} 
                    color={isInsideGeofence ? "#4CD964" : "#FF3B30"} 
                  />
                  <Text style={[
                    styles.indicatorText,
                    isInsideGeofence ? styles.insideGeofenceText : styles.outsideGeofenceText
                  ]}>
                    {isInsideGeofence ? 'In Area' : 'Outside'}
                  </Text>
                </View>
              )}
              
              {/* Indoor/Outdoor indicator - static for now */}
              <View style={styles.indicator}>
                <Ionicons name="home" size={14} color="#FF9500" />
                <Text style={styles.indicatorText}>Indoor</Text>
              </View>
            </View>
            
            <View style={styles.statusIndicator}>
              <View 
                style={[
                  styles.statusDot, 
                  { backgroundColor: isOnline ? '#4CD964' : '#8E8E93' }
                ]} 
              />
              <Text style={styles.statusText}>
                {isOnline ? 'Online' : 'Offline'}
                {!isOnline && item.presence?.lastSeen && 
                  ` · ${formatLastSeen(item.presence.lastSeen)}`}
              </Text>
            </View>
          </View>
        </View>
        
        <View style={styles.memberActions}>
          <TouchableOpacity 
            style={styles.memberAction}
            onPress={() => handleRemoveMember(item.id, memberName)}
          >
            <Ionicons name="person-remove" size={22} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.content}>
        {!auth.currentUser ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Please log in to view team members</Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading team members...</Text>
          </View>
        ) : (
          <>
            <View style={styles.headerContainer}>
              <Text style={styles.header}>Team Members</Text>
              <TouchableOpacity 
                style={[styles.refreshButton, isRefreshing && styles.refreshingButton]}
                onPress={handleRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : (
                  <Ionicons name="refresh" size={20} color="#007AFF" />
                )}
              </TouchableOpacity>
            </View>
            
            {teamMembers.length > 0 ? (
              <FlatList
                data={teamMembers}
                renderItem={renderMemberItem}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.list}
              />
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="people" size={60} color="#CCCCCC" />
                <Text style={styles.emptyText}>No team members found</Text>
                <Text style={styles.emptySubtext}>Share your team code to invite members</Text>
                
                {teamCode ? (
                  <View style={styles.teamCodeContainer}>
                    <Text style={styles.teamCodeLabel}>Your Team Code:</Text>
                    <Text style={styles.teamCode}>{teamCode}</Text>
                  </View>
                ) : (
                  <Text style={styles.noCodeText}>No team code available</Text>
                )}
              </View>
            )}
          </>
        )}
      </SafeAreaView>
      <Navbar activePage="userManagement" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
  content: {
    flex: 1,
    paddingBottom: 80, // Space for navbar
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  refreshButton: {
    padding: 8,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshingButton: {
    opacity: 0.7,
  },
  list: {
    padding: 16,
  },
  memberItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  memberAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  memberAvatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberAvatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
  },
  memberTextInfo: {
    marginLeft: 12,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  memberEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  memberActions: {
    flexDirection: 'row',
  },
  memberAction: {
    padding: 8,
    marginLeft: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#888',
    marginTop: 8,
    textAlign: 'center',
  },
  teamCodeContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  teamCodeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  teamCode: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
    letterSpacing: 1,
  },
  noCodeText: {
    fontSize: 14,
    color: '#888',
    marginTop: 20,
    fontStyle: 'italic',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    backgroundColor: '#F0F8FF',
    padding: 4,
    borderRadius: 4,
  },
  locationText: {
    fontSize: 12,
    color: '#333',
    marginLeft: 4,
    fontFamily: 'monospace',
  },
  indicatorsRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    padding: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  indicatorText: {
    fontSize: 12,
    color: '#333',
    marginLeft: 4,
  },
  insideGeofence: {
    backgroundColor: 'rgba(76, 217, 100, 0.2)',
    borderWidth: 1,
    borderColor: '#4CD964',
  },
  outsideGeofence: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  insideGeofenceText: {
    color: '#388E3C',
    fontWeight: '500',
  },
  outsideGeofenceText: {
    color: '#D32F2F',
    fontWeight: '500',
  },
}); 