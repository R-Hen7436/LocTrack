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

// Modern Step Counter Display
const StepCounter = ({ value = 0, title, subtitle }) => {
  return (
    <View style={styles.stepCounterContainer}>
      <View style={styles.stepCounterInner}>
        <Text style={styles.stepCounterTitle}>{title}</Text>
        <View style={styles.stepCountValueContainer}>
          <Text style={styles.stepCounterValue}>{value.toLocaleString()}</Text>
          <Text style={styles.stepCounterLabel}>steps</Text>
        </View>
        {subtitle && <Text style={styles.stepCounterSubtitle}>{subtitle}</Text>}
      </View>
    </View>
  );
};

// Stat Card Component
const StatCard = ({ icon, value, label, color }) => {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconContainer, { backgroundColor: `${color}20` }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
};

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
  const [estimatedDistance, setEstimatedDistance] = useState(0);
  const [estimatedStepsPerUpdate, setEstimatedStepsPerUpdate] = useState(0);
  const [estimatedDistancePerUpdate, setEstimatedDistancePerUpdate] = useState(0);

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

  // Get the step count to display
  const getDisplaySteps = () => {
    return isPedometerUsed && realTimeStepCount > 0 ? realTimeStepCount : totalSteps;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Step Tracker</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={styles.iconButton}
            onPress={syncWithMap}
          >
            <Ionicons name="map-outline" size={22} color="#4CAF50" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.iconButton}
            onPress={loadStepData}
          >
            <Ionicons name="refresh" size={22} color="#2196F3" />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading step data...</Text>
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Main step counter */}
          <StepCounter
            value={getDisplaySteps()}
            title="Total Steps"
            subtitle={`${estimatedDistance.toFixed(2)} km total distance`}
          />

          {/* Statistics row */}
          <Text style={styles.sectionTitle}>Statistics</Text>
          <View style={styles.statsRow}>
            <StatCard 
              icon="sync-circle-outline" 
              value={totalUpdates} 
              label="Updates" 
              color="#FF9800"
            />
            <StatCard 
              icon="analytics-outline" 
              value={estimatedStepsPerUpdate} 
              label="Steps/Update" 
              color="#9C27B0"
            />
            <StatCard 
              icon="resize-outline" 
              value={estimatedDistancePerUpdate.toFixed(2)} 
              label="Dist/Update (m)" 
              color="#795548"
            />
          </View>
          
          {/* Additional stats in card format */}
          <View style={styles.additionalStatsCard}>
            <View style={styles.additionalStatsHeader}>
              <Ionicons name="stats-chart" size={20} color="#4CAF50" />
              <Text style={styles.additionalStatsTitle}>Tracking Summary</Text>
            </View>
            
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Max steps in one update:</Text>
              <Text style={styles.statValue}>{maxStepsPerUpdate}</Text>
            </View>
            
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Track using:</Text>
              <Text style={styles.statValue}>{isPedometerUsed ? 'Device pedometer' : 'GPS location'}</Text>
            </View>
            
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Daily average:</Text>
              <Text style={styles.statValue}>{Math.round(totalSteps / (totalUpdates || 1))} steps</Text>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
    elevation: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  headerButtons: {
    flexDirection: 'row',
  },
  iconButton: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
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
    padding: 20,
    paddingBottom: 40,
  },
  stepCounterContainer: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 4,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  stepCounterInner: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 0,
    backgroundColor: 'white',
  },
  stepCounterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stepCountValueContainer: {
    alignItems: 'center',
  },
  stepCounterValue: {
    fontSize: 54,
    fontWeight: 'bold',
    color: '#2196F3',
    letterSpacing: -1,
  },
  stepCounterLabel: {
    fontSize: 18,
    fontWeight: '500',
    color: '#2196F3',
    opacity: 0.8,
    marginTop: 0,
  },
  stepCounterSubtitle: {
    fontSize: 14,
    color: '#757575',
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#424242',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    width: '31%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  statIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginVertical: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#757575',
    textAlign: 'center',
  },
  additionalStatsCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  additionalStatsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  additionalStatsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  lastRefreshText: {
    textAlign: 'center',
    color: '#9E9E9E',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  }
}); 