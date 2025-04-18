import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Switch
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, query, orderByChild, limitToLast, set, update } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const AVERAGE_STEP_LENGTH_METERS = 0.762; // Average step length in meters

export default function StepTracker({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [totalSteps, setTotalSteps] = useState(0);
  const [stepHistory, setStepHistory] = useState([]);
  const [teamCode, setTeamCode] = useState('');
  const [avgStepsPerUpdate, setAvgStepsPerUpdate] = useState(0);
  const [maxStepsPerUpdate, setMaxStepsPerUpdate] = useState(0);
  const [totalUpdates, setTotalUpdates] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [indoorMode, setIndoorMode] = useState(true);
  const [isPedometerUsed, setIsPedometerUsed] = useState(false);
  const [realTimeStepCount, setRealTimeStepCount] = useState(0);
  const [totalTeamSteps, setTotalTeamSteps] = useState(0);
  const [teamData, setTeamData] = useState([]);
  const autoRefreshInterval = useRef(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [estimatedDistance, setEstimatedDistance] = useState(0); // Total distance
  const [estimatedStepsPerUpdate, setEstimatedStepsPerUpdate] = useState(0); // NEW: Avg steps per saved interval
  const [estimatedDistancePerUpdate, setEstimatedDistancePerUpdate] = useState(0); // NEW: Avg distance per saved interval

  useEffect(() => {
    loadStepData();
    
    // Check if we should start in indoor mode based on previous usage
    AsyncStorage.getItem('indoorModeEnabled').then(value => {
      if (value !== null) {
        setIndoorMode(value === 'true');
        console.log(`📊 STEP VIEWER: Indoor mode set to ${value === 'true'}`);
      }
    });
    
    // Set up auto-refresh interval
    autoRefreshInterval.current = setInterval(() => {
      console.log('📊 STEP VIEWER: Auto-refreshing step data...');
      loadStepData(true); // true indicates silent refresh (no loading indicators)
    }, 30000); // Refresh every 30 seconds
    
    // Log when the component mounts
    console.log('📊 STEP VIEWER: Component mounted, loading data...');
    
    // Clean up interval on unmount
    return () => {
      if (autoRefreshInterval.current) {
        clearInterval(autoRefreshInterval.current);
        autoRefreshInterval.current = null;
      }
    };
  }, []);

  // Save indoor mode preference when it changes
  useEffect(() => {
    AsyncStorage.setItem('indoorModeEnabled', indoorMode.toString());
    console.log(`📊 STEP VIEWER: Indoor mode ${indoorMode ? 'enabled' : 'disabled'}`);
  }, [indoorMode]);

  const loadStepData = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setIsLoading(true);
      }
      setError(null);  // Reset any previous errors
      
      console.log('📊 STEP TRACKER: Loading step data...');
      
      const auth = getAuth();
      const db = getDatabase();
      
      if (!auth.currentUser) {
        throw new Error('No authenticated user found');
      }
      
      // First, check if step data has been initialized in the app state
      const appStateRef = ref(db, `appState/${auth.currentUser.uid}`);
      const appStateSnapshot = await get(appStateRef);
      
      if (!appStateSnapshot.exists() || !appStateSnapshot.val().stepDataInitialized) {
        console.log('📊 STEP TRACKER: No step data has been initialized yet. User may need to use the map first.');
        
        // Check user's profile for any fallback step data
        const userRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const userSnapshot = await get(userRef);
        
        if (userSnapshot.exists() && userSnapshot.val().stepData) {
          console.log('📊 STEP TRACKER: Found fallback step data in profile, using that');
          const userData = userSnapshot.val();
          const personalStepData = userData.stepData;
          
          // Set data from profile as fallback
          setTotalSteps(personalStepData.totalSteps || 0);
          setStepHistory(personalStepData.history || []);
          setTotalUpdates(personalStepData.history?.length || 0);
          setAvgStepsPerUpdate(personalStepData.totalSteps / (personalStepData.history?.length || 1));
          setMaxStepsPerUpdate(Math.max(...(personalStepData.history?.map(entry => entry.steps) || [0])));
          setIsPedometerUsed(personalStepData.isPedometerUsed || false);
          setRealTimeStepCount(personalStepData.realTimeStepCount || 0);
          setTeamCode(userData.teamCode || '');
          
          // Initialize the app state flag if we have data but the flag isn't set
          if (userData.teamCode) {
            try {
              await update(appStateRef, {
                stepDataInitialized: true,
                lastStepUpdateTimestamp: new Date().getTime()
              });
              console.log('📊 STEP TRACKER: Initialized step data flag in app state');
            } catch (err) {
              console.error('📊 STEP TRACKER: Error setting step data flag:', err);
            }
          }
          
          if (!silent) {
            setIsLoading(false);
          }
          setLastRefresh(new Date());
          return;
        }
        
        // If we still don't have data, show a more helpful error
        setError('No step data found. Please use the Map to initialize step tracking first.');
        
        if (!silent) {
          setIsLoading(false);
        }
        return;
      }
      
      // Get the user data first
      const userRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const userSnapshot = await get(userRef);
      if (!userSnapshot.exists()) throw new Error('User profile not found');
      const userData = userSnapshot.val();
      const teamCode = userData.teamCode;
      if (!teamCode) throw new Error('No team code found for user');
      setTeamCode(teamCode);

      // Load user's personal step data from profile - THIS IS NOW PRIMARY
      let personalStepData = null;
      if (userData.stepData) {
        personalStepData = userData.stepData;
        console.log('📊 STEP TRACKER: Found personal step data in profile:', personalStepData);
      } else {
        console.log('📊 STEP TRACKER: No personal step data found in profile. Cannot display history/stats.');
        // Handle case where there's absolutely no data yet
        setTotalSteps(0);
        setStepHistory([]);
        setTotalUpdates(0);
        setAvgStepsPerUpdate(0);
        setMaxStepsPerUpdate(0);
        setIsPedometerUsed(false);
        setRealTimeStepCount(0);
        setEstimatedDistance(0); // Set distance to 0
        setEstimatedStepsPerUpdate(0); // Reset new state
        setEstimatedDistancePerUpdate(0); // Reset new state
        setError('No step data found. Start walking on the Map screen.');
        setIsLoading(false);
        return;
      }
      
      // *** Use personal profile data for display ***
      const currentHistory = personalStepData.history || [];
      const currentTotalSteps = personalStepData.totalSteps || 0;
      const historyLength = currentHistory.length;
      
      setTotalSteps(currentTotalSteps);
      setStepHistory(currentHistory);
      setTotalUpdates(historyLength); 
      // Calculate average using steps from history entries if available
      const totalStepsFromHistory = currentHistory.reduce((sum, entry) => sum + (entry.steps || 0), 0);
      // Use overall total if history sum seems off or history is empty
      const avgNumerator = historyLength > 0 ? totalStepsFromHistory : currentTotalSteps; 
      setAvgStepsPerUpdate(historyLength > 0 ? Math.round(avgNumerator / historyLength) : 0);
      setMaxStepsPerUpdate(Math.max(...(currentHistory.map(entry => entry.steps || 0)), 0));
      setIsPedometerUsed(personalStepData.isPedometerUsed || false);
      setRealTimeStepCount(personalStepData.realTimeStepCount || currentTotalSteps); // Fallback for real-time display

      // *** Calculate and set estimated distance ***
      const distanceInMeters = currentTotalSteps * AVERAGE_STEP_LENGTH_METERS;
      const distanceInKm = distanceInMeters / 1000;
      setEstimatedDistance(distanceInKm); 

      // *** Calculate Steps and Distance PER Update ***
      let avgStepsPerInterval = 0;
      let avgDistancePerInterval = 0;
      if (historyLength > 0) {
          const totalStepsInHistory = currentHistory.reduce((sum, entry) => sum + (entry.steps || 0), 0);
          avgStepsPerInterval = Math.round(totalStepsInHistory / historyLength);
          avgDistancePerInterval = avgStepsPerInterval * AVERAGE_STEP_LENGTH_METERS;
      }
      setEstimatedStepsPerUpdate(avgStepsPerInterval);
      setEstimatedDistancePerUpdate(avgDistancePerInterval);
      // Keep old avg calculation for now, or remove if redundant
      const avgStepsPerIntervalNumerator = historyLength > 0 ? totalStepsInHistory : currentTotalSteps; 
      setAvgStepsPerUpdate(historyLength > 0 ? Math.round(avgStepsPerIntervalNumerator / historyLength) : 0);
      setMaxStepsPerUpdate(Math.max(...(currentHistory.map(entry => entry.steps || 0)), 0));

      console.log(`📊 STEP TRACKER: Calculated Stats - Total: ${currentTotalSteps}, Updates: ${historyLength}, AvgSteps/Upd: ${avgStepsPerInterval}, AvgDist/Upd: ${avgDistancePerInterval.toFixed(2)}m, Est. Total Dist: ${distanceInKm.toFixed(2)}km`);

      // We can still load team data in the background for other purposes if needed,
      // but we won't use it for the primary display stats of the current user here.
      // const teamStepDataRef = ref(db, `teams/${teamCode}/locationStepData`);
      // const teamStepDataSnapshot = await get(teamStepDataRef);
      // if (teamStepDataSnapshot.exists()) { ... process team data if needed ... }

      console.log('📊 STEP TRACKER: Successfully loaded step data using profile history.');
      setLastRefresh(new Date());
    } catch (error) {
      console.error('📊 STEP TRACKER: Error loading step data:', error);
      setError(`Error loading step data: ${error.message}`);
      
      // Schedule a retry after a delay for certain types of errors
      if (error.message.includes('network') || error.message.includes('timeout')) {
        setTimeout(() => {
          console.log('📊 STEP TRACKER: Retrying data load after network error');
          loadStepData();
        }, 5000);
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);
  
  // Function to manually record indoor steps
  const startIndoorTracking = async () => {
    console.log('📊 STEP VIEWER: Starting indoor tracking');
    if (!indoorMode) {
      setIndoorMode(true);
      console.log('📊 STEP VIEWER: Enabled indoor mode automatically');
    }
    
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        console.log('📊 STEP VIEWER ERROR: No authenticated user');
        Alert.alert('Error', 'You must be logged in to track steps');
        return;
      }
      
      const db = getDatabase();
      
      // Check if step data has already been initialized
      const appStateRef = ref(db, `appState/${auth.currentUser.uid}`);
      const appStateSnapshot = await get(appStateRef);
      const isInitialized = appStateSnapshot.exists() && appStateSnapshot.val().stepDataInitialized;
      
      // Get team code from profile
      let userTeamCode = teamCode;
      if (!userTeamCode) {
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const snapshot = await get(userProfileRef);
        if (snapshot.exists()) {
          const userData = snapshot.val();
          userTeamCode = userData.teamCode;
          setTeamCode(userTeamCode);
          console.log(`📊 STEP VIEWER: Retrieved team code: ${userTeamCode}`);
        }
      }
      
      if (!userTeamCode) {
        console.log('📊 STEP VIEWER ERROR: No team code found');
        Alert.alert('Error', 'No team code found. Please join a team first.');
        return;
      }
      
      console.log('📊 STEP VIEWER: Preparing to start tracking steps');
      
      // If already initialized, give the option to just refresh
      if (isInitialized) {
        Alert.alert(
          'Step Tracking Already Active',
          'Step tracking is already initialized. Would you like to refresh the data or go to the map?',
          [
            {
              text: 'Refresh Data',
              onPress: () => {
                console.log('📊 STEP VIEWER: User chose to refresh data');
                loadStepData();
              }
            },
            {
              text: 'Go to Map',
              onPress: () => {
                console.log('📊 STEP VIEWER: User chose to navigate to map');
                // Force refresh data when returning from map
                const unsubscribe = navigation.addListener('focus', () => {
                  console.log('📊 STEP VIEWER: Returned from map, refreshing data...');
                  loadStepData();
                  unsubscribe();
                });
                navigation.navigate('LocTrack');
              }
            },
            {
              text: 'Cancel',
              style: 'cancel'
            }
          ]
        );
        return;
      }
      
      // Ask the user if they want to go to the map instead of automatically redirecting
      Alert.alert(
        'Start Step Tracking',
        'Do you want to go to the map screen to begin tracking steps, or initialize step tracking here?',
        [
          {
            text: 'Go to Map',
            onPress: () => {
              console.log('📊 STEP VIEWER: User chose to navigate to map');
              // Force refresh data when returning from map
              const unsubscribe = navigation.addListener('focus', () => {
                console.log('📊 STEP VIEWER: Returned from map, refreshing data...');
                loadStepData();
                unsubscribe();
              });
              navigation.navigate('LocTrack');
            }
          },
          {
            text: 'Initialize Here',
            onPress: () => {
              console.log('📊 STEP VIEWER: User chose to initialize step tracking from step tracker screen');
              // Create some initial step data so we have something to display
              tryCreateInitialStepData(userTeamCode);
            }
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    } catch (error) {
      console.error('📊 STEP VIEWER ERROR: Error starting indoor tracking:', error);
      Alert.alert('Error', 'Failed to start indoor tracking: ' + error.message);
    }
  };
  
  // Function to create initial step data without requiring map navigation
  const tryCreateInitialStepData = async (userTeamCode) => {
    try {
      setIsLoading(true);
      
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const db = getDatabase();
      const timestamp = new Date().getTime();
      const entryId = `step_${timestamp}`;
      
      // Create placeholder data
      const initialStepData = {
        location: {
          latitude: 0,
          longitude: 0,
          isIndoor: true
        },
        steps: 50, // Start with some steps
        totalSteps: 50,
        timestamp: timestamp,
        formattedTime: new Date(timestamp).toISOString(),
        userId: auth.currentUser.uid,
        isIndoorTracking: true,
        isPedometerUsed: false
      };
      
      // Save to team data
      const teamStepDataRef = ref(db, `teams/${userTeamCode}/locationStepData/${auth.currentUser.uid}/${entryId}`);
      await set(teamStepDataRef, initialStepData);
      
      // Save to user profile
      const userStepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData`);
      await set(userStepDataRef, {
        lastLocation: initialStepData.location,
        lastStepCount: initialStepData.steps,
        totalSteps: initialStepData.totalSteps,
        lastUpdateTimestamp: timestamp,
        history: [
          {
            latitude: initialStepData.location.latitude,
            longitude: initialStepData.location.longitude,
            steps: initialStepData.steps,
            timestamp: initialStepData.timestamp,
            formattedTime: initialStepData.formattedTime,
            isIndoorTracking: true
          }
        ]
      });
      
      // Set the app state flag to indicate step data is initialized
      const appStateRef = ref(db, `appState/${auth.currentUser.uid}`);
      await update(appStateRef, {
        stepDataInitialized: true,
        lastStepUpdateTimestamp: timestamp
      });
      
      console.log('📊 STEP VIEWER: Created initial step data and set initialization flag');
      Alert.alert('Step Tracking Initialized', 'Initial step data has been created. You can now begin tracking steps.');
      
      // Refresh data display
      loadStepData();
    } catch (error) {
      console.error('📊 STEP VIEWER ERROR: Failed to create initial step data', error);
      Alert.alert('Error', 'Failed to initialize step data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  const syncWithMap = async () => {
    console.log('📊 STEP VIEWER: Sync with map button pressed');
    
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'You must be logged in to track steps');
        return;
      }
      
      const db = getDatabase();
      
      // Check if step data has already been initialized
      const appStateRef = ref(db, `appState/${auth.currentUser.uid}`);
      const appStateSnapshot = await get(appStateRef);
      const isInitialized = appStateSnapshot.exists() && appStateSnapshot.val().stepDataInitialized;
      
      if (isInitialized) {
        // If already initialized, give more specific options
        Alert.alert(
          'Sync with Map',
          'Choose an option for tracking your steps:',
          [
            {
              text: 'Indoor Tracking',
              onPress: startIndoorTracking
            },
            {
              text: 'Outdoor GPS Tracking',
              onPress: () => {
                console.log('📊 STEP VIEWER: Navigating to outdoor GPS tracking');
                navigation.navigate('LocTrack');
              }
            },
            {
              text: 'Refresh Data',
              onPress: () => {
                console.log('📊 STEP VIEWER: User chose to refresh data');
                loadStepData();
              }
            },
            {
              text: 'Cancel',
              style: 'cancel'
            }
          ]
        );
      } else {
        // If not initialized, guide the user to initialize first
        Alert.alert(
          'Initialize Step Tracking',
          'Step tracking hasn\'t been initialized yet. Choose how to start:',
          [
            {
              text: 'Indoor Tracking',
              onPress: startIndoorTracking
            },
            {
              text: 'Outdoor GPS Tracking',
              onPress: () => {
                console.log('📊 STEP VIEWER: Navigating to outdoor GPS tracking for initialization');
                navigation.navigate('LocTrack');
              }
            },
            {
              text: 'Cancel',
              style: 'cancel'
            }
          ]
        );
      }
    } catch (error) {
      console.error('📊 STEP VIEWER ERROR: Error checking step tracking state:', error);
      // Fall back to original behavior on error
      Alert.alert(
        'Sync with Map',
        'Choose an option for tracking your steps:',
        [
          {
            text: 'Indoor Tracking',
            onPress: startIndoorTracking
          },
          {
            text: 'Outdoor GPS Tracking',
            onPress: () => {
              console.log('📊 STEP VIEWER: Navigating to outdoor GPS tracking');
              navigation.navigate('LocTrack');
            }
          },
          {
            text: 'Cancel',
            style: 'cancel'
          }
        ]
      );
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  const getBarWidth = (steps) => {
    // Calculate width as percentage of max steps (min 5%)
    const percentage = Math.max(5, (steps / maxStepsPerUpdate) * 100);
    return `${percentage}%`;
  };
  
  const toggleIndoorMode = () => {
    const newMode = !indoorMode;
    console.log(`📊 STEP VIEWER: Toggling indoor mode to ${newMode}`);
    setIndoorMode(newMode);
    
    if (newMode) {
      Alert.alert(
        'Indoor Mode Enabled',
        'Steps will be tracked even without GPS. Great for walking indoors!',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert(
        'Indoor Mode Disabled',
        'Steps will only be tracked with GPS location. Best for outdoor walking.',
        [{ text: 'OK' }]
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Step Tracker</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={styles.syncButton}
            onPress={syncWithMap}
          >
            <Ionicons name="map-outline" size={24} color="#4CAF50" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.refreshButton}
            onPress={loadStepData}
          >
            <Ionicons name="refresh" size={24} color="#2196F3" />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading step data...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Add indoor mode toggle */}
          <View style={styles.modeToggleCard}>
            <View style={styles.modeToggleContent}>
              <View>
                <Text style={styles.modeToggleTitle}>
                  {indoorMode ? 'Indoor Mode: ON' : 'Indoor Mode: OFF'}
                </Text>
                <Text style={styles.modeToggleDescription}>
                  {indoorMode 
                    ? 'Tracking steps without GPS for indoor walking' 
                    : 'Using GPS for accurate outdoor tracking'}
                </Text>
                {isPedometerUsed && (
                  <Text style={styles.pedometerStatus}>
                    Using device pedometer for accurate step counting
                  </Text>
                )}
              </View>
              <Switch
                value={indoorMode}
                onValueChange={toggleIndoorMode}
                trackColor={{ false: '#D1D1D1', true: '#81D4FA' }}
                thumbColor={indoorMode ? '#2196F3' : '#f4f3f4'}
              />
            </View>
            <TouchableOpacity 
              style={styles.startTrackingButton}
              onPress={startIndoorTracking}
            >
              <Ionicons name="play" size={16} color="white" />
              <Text style={styles.startTrackingText}>Start Tracking Now</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Ionicons name="footsteps" size={24} color="#2196F3" />
              {isPedometerUsed && realTimeStepCount > 0 ? (
                <>
                  <Text style={styles.statValue}>{realTimeStepCount}</Text>
                  <Text style={styles.statLabel}>Pedometer Steps</Text>
                </>
              ) : (
                <>
                  <Text style={styles.statValue}>{totalSteps}</Text>
                  <Text style={styles.statLabel}>Total Steps</Text>
                </>
              )}
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="walk-outline" size={24} color="#4CAF50" />
              <Text style={styles.statValue}>{estimatedDistance.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Total Dist (km)</Text>
            </View>
            
            <View style={styles.statItem}>
              <Ionicons name="sync-circle-outline" size={24} color="#FF9800" />
              <Text style={styles.statValue}>{totalUpdates}</Text>
              <Text style={styles.statLabel}>Updates</Text>
            </View>
          </View>
          
          {/* Add a new row/card for per-update stats */}  
          <View style={styles.statsCard}> 
            {/* Est. Steps Per Update */}
            <View style={styles.statItem}>
                <Ionicons name="analytics-outline" size={24} color="#9C27B0" />
                <Text style={styles.statValue}>{estimatedStepsPerUpdate}</Text>
                <Text style={styles.statLabel}>Steps/Update</Text>
            </View>

            {/* Est. Distance Per Update */}    
            <View style={styles.statItem}>
                <Ionicons name="resize-outline" size={24} color="#795548" /> 
                <Text style={styles.statValue}>{estimatedDistancePerUpdate.toFixed(2)}</Text>
                <Text style={styles.statLabel}>Dist/Update (m)</Text>
            </View>
          </View>
          
          {lastRefresh && (
            <Text style={styles.lastRefreshText}>
              Last updated: {lastRefresh.toLocaleTimeString()}
            </Text>
          )}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Steps History</Text>
            <Text style={styles.sectionSubtitle}>
              Each bar represents steps taken between updates
            </Text>
          </View>

          {stepHistory.length > 0 ? (
            <View style={styles.historyContainer}>
              {stepHistory.map((entry, index) => (
                <View key={index} style={styles.historyItem}>
                  <View style={styles.historyInfo}>
                    <Text style={styles.historyTime}>
                      {formatTimestamp(entry.timestamp)}
                    </Text>
                    <Text style={styles.historyDate}>
                      {formatDate(entry.timestamp)}
                    </Text>
                    {entry.isIndoorTracking && (
                      <Text style={styles.indoorBadge}>Indoor</Text>
                    )}
                  </View>
                  <View style={styles.barContainer}>
                    <View 
                      style={[
                        styles.bar, 
                        { width: getBarWidth(entry.steps) },
                        entry.isIndoorTracking ? styles.indoorBar : styles.outdoorBar
                      ]}
                    />
                    <Text style={styles.barText}>{entry.steps} steps</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="walk-outline" size={50} color="#ccc" />
              <Text style={styles.emptyStateText}>
                No step data available yet. Start walking with the app open to track steps.
              </Text>
              <TouchableOpacity 
                style={styles.tryAgainButton}
                onPress={startIndoorTracking}
              >
                <Text style={styles.tryAgainButtonText}>Start Tracking Steps</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>How It Works</Text>
            <Text style={styles.infoText}>
              • Indoor Mode: Turn on to track steps without GPS (perfect for indoors)
              • Outdoor Mode: Use the map screen for GPS-based tracking
              • Keep the app open while walking for best results
              • Refresh this screen to see your updated steps
            </Text>
          </View>
          
          {/* Debug information */}
          <TouchableOpacity 
            style={styles.debugButton}
            onPress={() => {
              Alert.alert(
                'Debug Info',
                `Team Code: ${teamCode || 'None'}\n` +
                `Total Steps: ${totalSteps}\n` +
                `Step History Entries: ${stepHistory.length}\n` +
                `Indoor Mode: ${indoorMode ? 'Enabled' : 'Disabled'}\n` +
                `Pedometer Used: ${isPedometerUsed ? 'Yes' : 'No'}\n` +
                `Real-time Pedometer Count: ${realTimeStepCount}\n` +
                `Last Updated: ${stepHistory.length ? new Date(stepHistory[0].timestamp).toLocaleString() : 'Never'}`
              );
            }}
          >
            <Text style={styles.debugButtonText}>Debug Info</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  headerButtons: {
    flexDirection: 'row',
  },
  refreshButton: {
    padding: 8,
  },
  syncButton: {
    padding: 8,
    marginRight: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 16,
  },
  scrollContent: {
    padding: 16,
  },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 6,
  },
  modeToggleCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 16,
  },
  modeToggleContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeToggleTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  modeToggleDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    maxWidth: width * 0.6,
  },
  pedometerStatus: {
    fontSize: 11,
    color: '#00796B',
    marginTop: 4,
    fontStyle: 'italic',
  },
  startTrackingButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  startTrackingText: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 8,
  },
  lastRefreshText: {
    textAlign: 'right',
    color: '#888',
    fontSize: 12,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  historyContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 20,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  historyInfo: {
    width: 80,
  },
  historyTime: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  historyDate: {
    fontSize: 12,
    color: '#666',
  },
  indoorBadge: {
    fontSize: 10,
    color: 'white',
    backgroundColor: '#9C27B0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  barContainer: {
    flex: 1,
    height: 24,
    backgroundColor: '#F0F0F0',
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  bar: {
    height: '100%',
  },
  indoorBar: {
    backgroundColor: '#9C27B0',
  },
  outdoorBar: {
    backgroundColor: '#2196F3',
  },
  barText: {
    position: 'absolute',
    right: 8,
    top: 3,
    fontSize: 12,
    fontWeight: '500',
    color: '#333',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, 
    shadowRadius: 3,
    elevation: 2,
    marginBottom: 20,
  },
  emptyStateText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 12,
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: '#E3F2FD',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976D2',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  tryAgainButton: {
    padding: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
    marginTop: 12,
  },
  tryAgainButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  debugButton: {
    padding: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 8,
    marginTop: 20,
    alignSelf: 'center',
  },
  debugButtonText: {
    fontSize: 14,
    color: '#757575',
  },
}); 