import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert
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
  const [teamCode, setTeamCode] = useState('');
  const [avgStepsPerUpdate, setAvgStepsPerUpdate] = useState(0);
  const [maxStepsPerUpdate, setMaxStepsPerUpdate] = useState(0);
  const [totalUpdates, setTotalUpdates] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
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
      const avgStepsPerIntervalNumerator = historyLength > 0 ? totalStepsFromHistory : currentTotalSteps; 
      setAvgStepsPerUpdate(historyLength > 0 ? Math.round(avgStepsPerIntervalNumerator / historyLength) : 0);
      setMaxStepsPerUpdate(Math.max(...(currentHistory.map(entry => entry.steps || 0)), 0));

      console.log(`📊 STEP TRACKER: Calculated Stats - Total: ${currentTotalSteps}, Updates: ${historyLength}, AvgSteps/Upd: ${avgStepsPerInterval}, AvgDist/Upd: ${avgDistancePerInterval.toFixed(2)}m, Est. Total Dist: ${distanceInKm.toFixed(2)}km`);

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
  
  // Function to start tracking - no longer needs indoor mode parameter
  const startTracking = async () => {
    console.log('📊 STEP VIEWER: Starting step tracking via map');
    
    // Navigate to map screen to start tracking
    navigation.navigate('Home');
    
    Alert.alert(
      'Step Tracking',
      'Go to the map screen to track your steps with GPS.',
      [{ text: 'OK' }]
    );
  };
  
  const syncWithMap = async () => {
    console.log('📊 STEP VIEWER: Sync with map button pressed');
    
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'You must be logged in to track steps');
        return;
      }
      
      navigation.navigate('Home');
      
      // Show a toast-style alert to inform the user
      Alert.alert(
        'Going to Map',
        'Opening the map for location tracking.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('📊 STEP VIEWER: Error navigating to map:', error);
      Alert.alert('Error', 'Could not navigate to map screen');
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
          <View style={styles.trackingCard}>
            <Text style={styles.trackingTitle}>GPS Step Tracking</Text>
            <Text style={styles.trackingDescription}>
              The app tracks your steps using GPS location data for accurate measurement
            </Text>
            {isPedometerUsed && (
              <Text style={styles.pedometerStatus}>
                Using device pedometer for accurate step counting
              </Text>
            )}
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
  trackingCard: {
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
  trackingTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  trackingDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    maxWidth: width * 0.9,
  },
  pedometerStatus: {
    fontSize: 11,
    color: '#00796B',
    marginTop: 4,
    fontStyle: 'italic',
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
  }
}); 