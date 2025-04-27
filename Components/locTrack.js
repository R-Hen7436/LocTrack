import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, SafeAreaView, Animated, Image, Alert, Platform, Modal, Linking, ActivityIndicator } from "react-native";
import MapView, { Marker, Polygon, Circle, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { getDatabase, ref, set, push, get, remove, child, onValue, onDisconnect, update } from "firebase/database";
import { db, auth } from "./firebaseConfig";
import { getAuth, signOut } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Navbar from './Navbar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BottomTabBar from './BottomTabBar';
import GeofencingUtils from './GeofencingUtils';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pedometer } from 'expo-sensors';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { MaterialIcons } from '@expo/vector-icons';

/**
 * Simple implementation of a Kalman filter for 2D location data
 * Based on the algorithm described in "Kalman Filter For Beginners" and several online implementations
 */
class SimpleKalmanFilter {
  /**
   * Create a Kalman filter for 2D location tracking
   * @param {number} processNoise - How much we expect the process to change randomly between updates (Q)
   * @param {number} initialMeasurementNoise - Default inaccuracy expectation (R), dynamically updated if accuracy is provided
   */
  constructor(processNoise = 0.01, initialMeasurementNoise = 10) { // Increased processNoise from 0.001 to 0.01, lower measurement noise
    // State vector [x, y, vx, vy]
    this.state = null;
    
    // Covariance matrix 4x4
    this.covariance = null;
    
    // Process noise (Q) - how much we expect our model to be wrong
    this.processNoise = processNoise;
    
    // Measurement noise (R) - Initial value, updated dynamically
    this.measurementNoise = initialMeasurementNoise; // Used as default if accuracy unavailable
    
    // Transition matrix (F) - constant velocity model
    this.transitionMatrix = [
      [1, 0, 1, 0], // x = x + vx * dt (dt=1)
      [0, 1, 0, 1], // y = y + vy * dt (dt=1)
      [0, 0, 1, 0], // vx = vx
      [0, 0, 0, 1]  // vy = vy
    ];
    
    // Observation matrix (H) - we only observe x and y, not velocities
    this.observationMatrix = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];
    
    // Identity matrix 4x4
    this.identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    
    // Store the last filtered position for noise filtering
    this.lastFilteredPosition = null;
    
    // Threshold for minimum movement (in degrees of lat/lon) to consider it real movement
    this.minMovementThreshold = 0.0000001; // Drastically reduced from 0.000008 - now ~1cm instead of ~1m
  }
  
  /**
   * Calculate distance between two points in lat/lon degrees (approximation)
   */
  calculateDistanceApprox(pos1, pos2) {
    if (!pos1 || !pos2) return 0;
    const latDiff = pos1.latitude - pos2.latitude;
    const lonDiff = pos1.longitude - pos2.longitude;
    return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
  }
  
  /**
   * Initialize the filter with a starting position
   */
  init(x, y) {
    this.state = [[x], [y], [0], [0]];
    const highUncertainty = 100;
    this.covariance = [
      [highUncertainty, 0, 0, 0],
      [0, highUncertainty, 0, 0],
      [0, 0, highUncertainty, 0],
      [0, 0, 0, highUncertainty]
    ];
    this.lastFilteredPosition = { latitude: x, longitude: y };
  }
  
  /**
   * Update the filter with a new GPS measurement
   */
  update(x, y, accuracy) {
    if (!this.state) {
      this.init(x, y);
      return { latitude: x, longitude: y };
    }
    
    let currentMeasurementNoise = this.measurementNoise;
    if (accuracy && !isNaN(accuracy) && accuracy > 0) {
      currentMeasurementNoise = Math.max(1.0, accuracy * accuracy);
    }
    
    const moveDistance = this.calculateDistanceApprox(
      { latitude: x, longitude: y },
      this.lastFilteredPosition
    );
    const currentAccuracyEstimate = Math.sqrt(currentMeasurementNoise);
    if (moveDistance < this.minMovementThreshold && currentAccuracyEstimate > 5) {
      return this.lastFilteredPosition;
    }
    
    // PREDICT
    const predictedState = this.matrixMultiply(this.transitionMatrix, this.state);
    let predictedCovariance = this.matrixMultiply(
      this.transitionMatrix,
      this.matrixMultiply(this.covariance, this.transpose(this.transitionMatrix))
    );
    for (let i = 0; i < 4; i++) {
      predictedCovariance[i][i] += this.processNoise;
    }
    
    // UPDATE
    const observationTranspose = this.transpose(this.observationMatrix);
    const hph = this.matrixMultiply(
      this.observationMatrix,
      this.matrixMultiply(predictedCovariance, observationTranspose)
    );
    for (let i = 0; i < 2; i++) {
      hph[i][i] += currentMeasurementNoise; // Use dynamic noise
    }
    const hphInverse = this.inverse2x2(hph);
    const ph = this.matrixMultiply(predictedCovariance, observationTranspose);
    const kalmanGain = this.matrixMultiply(ph, hphInverse);
    const measurement = [[x], [y]];
    const predictedMeasurement = this.matrixMultiply(this.observationMatrix, predictedState);
    const innovation = this.matrixSubtract(measurement, predictedMeasurement);
    this.state = this.matrixAdd(
      predictedState,
      this.matrixMultiply(kalmanGain, innovation)
    );
    const kh = this.matrixMultiply(kalmanGain, this.observationMatrix);
    const identityMinusKH = this.matrixSubtract(this.identity, kh);
    this.covariance = this.matrixMultiply(identityMinusKH, predictedCovariance);
    
    const result = {
      latitude: this.state[0][0],
      longitude: this.state[1][0]
    };
    this.lastFilteredPosition = result;
    return result;
  }

  // ... Matrix helper methods ... (matrixMultiply, matrixAdd, etc.)
  // (Ensure these helper methods are also present)
  matrixMultiply(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = [];
      for (let j = 0; j < b[0].length; j++) {
        let sum = 0;
        for (let k = 0; k < a[0].length; k++) {
          sum += a[i][k] * b[k][j];
        }
        result[i][j] = sum;
      }
    }
    return result;
  }

  matrixAdd(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = [];
      for (let j = 0; j < a[0].length; j++) {
        result[i][j] = a[i][j] + b[i][j];
      }
    }
    return result;
  }

  matrixSubtract(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
      result[i] = [];
      for (let j = 0; j < a[0].length; j++) {
        result[i][j] = a[i][j] - b[i][j];
      }
    }
    return result;
  }

  transpose(matrix) {
    const result = [];
    for (let j = 0; j < matrix[0].length; j++) {
      result[j] = [];
      for (let i = 0; i < matrix.length; i++) {
        result[j][i] = matrix[i][j];
      }
    }
    return result;
  }

  inverse2x2(matrix) {
    const a = matrix[0][0];
    const b = matrix[0][1];
    const c = matrix[1][0];
    const d = matrix[1][1];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-10) {
      return [[1000, 0], [0, 1000]];
    }
    const invDet = 1 / determinant;
    return [
      [d * invDet, -b * invDet],
      [-c * invDet, a * invDet]
    ];
  }
}

const GPSStrengthIndicator = ({ accuracy }) => {
  const getSignalStrength = (accuracy) => {
    if (!accuracy) return -1; // No signal
    if (accuracy <= 10) return 4; // Excellent
    if (accuracy <= 20) return 3; // Good
    if (accuracy <= 50) return 2; // Fair
    if (accuracy <= 100) return 1; // Poor
    return 0; // Very Poor
  };

  const strength = getSignalStrength(accuracy);
  const bars = [1, 2, 3, 4];

  return (
    <View style={styles.gpsIndicator}>
      <View style={styles.gpsBars}>
        {bars.map((bar) => (
          <View
            key={bar}
            style={[
              styles.gpsBar,
              {
                backgroundColor: strength === -1 ? '#FF3B30' : 
                  bar <= strength ? '#4CAF50' : '#E0E0E0',
                height: bar * 4,
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.gpsAccuracy, strength === -1 && styles.gpsNoSignal]}>
        {strength === -1 ? 'No Signal' : `${Math.round(accuracy)}m`}
      </Text>
    </View>
  );
};

const CustomMarker = ({ coordinate, photoURL, name, labelPosition = 'bottom', markerColor, isOnline = true }) => {
  const nameInitial = name && typeof name === 'string' && name.trim() !== '' ? name.trim()[0].toUpperCase() : '';
  
  const labelPositionStyle = {
    top: { marginTop: -46, marginBottom: 4 },
    bottom: { marginTop: 4 },
    left: { position: 'absolute', left: -80, top: -8 },
    right: { position: 'absolute', right: -80, top: -8 },
  }[labelPosition] || { marginTop: 4 };
  
  const offlineStyle = !isOnline ? {
    opacity: 0.7,
    borderStyle: 'dashed',
  } : {};
  
  const markerContent = React.useMemo(() => (
    <View style={styles.markerContainer}>
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={[
            styles.markerImage, 
            markerColor && { borderColor: markerColor },
            offlineStyle
          ]}
        />
      ) : (
        <View style={[
          styles.markerFallback, 
          markerColor && { backgroundColor: markerColor },
          offlineStyle
        ]}>
          {nameInitial ? (
            <Text style={styles.markerInitial}>{nameInitial}</Text>
          ) : (
            <Ionicons name="person" size={20} color="#FFFFFF" />
          )}
        </View>
      )}
      {name && typeof name === 'string' && name.trim() !== '' && (
        <View style={[
          styles.markerLabelContainer, 
          labelPositionStyle,
          { backgroundColor: markerColor ? `${markerColor}DD` : 'rgba(255, 255, 255, 0.9)' },
          // *** REMOVED: Conditional offline styles from container ***
          // !isOnline && { borderStyle: 'dashed', opacity: 0.8 }
        ]}>
          <Text style={[
            styles.markerLabel, 
            { color: markerColor ? '#FFFFFF' : '#333333', fontWeight: '700' }
            // Style text color based on online status if needed here instead
          ]}>
            {name} {!isOnline && '(offline)'} { /* Text indicates offline status */}
          </Text>
        </View>
      )}
    </View>
  ), [photoURL, name, nameInitial, labelPosition, markerColor, isOnline, offlineStyle, labelPositionStyle]);
  
  return (
    <Marker 
      coordinate={coordinate}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      {markerContent}
    </Marker>
  );
};

const formatUserName = (userData) => {
  if (!userData) return '';
  
  const firstName = userData.firstName && userData.firstName.trim ? userData.firstName.trim() : '';
  const lastName = userData.lastName && userData.lastName.trim ? userData.lastName.trim() : '';
  
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  } else if (firstName) {
    return firstName;
  } else if (lastName) {
    return lastName;
  }
  
  if (userData.email) {
    const emailParts = userData.email.split('@');
    return emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1);
  }
  
  return '';
};

const CurrentUserMarker = ({ coordinate, tracksViewChanges }) => {
  const markerContent = React.useMemo(() => (
    <View style={styles.currentUserMarkerContainer}>
      <View style={styles.currentUserMarker}>
        <Ionicons name="navigate" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.currentUserLabelContainer}>
        <Text style={styles.currentUserLabel}>You</Text>
      </View>
    </View>
  ), []);
  
  return (
    <Marker 
      coordinate={coordinate}
      tracksViewChanges={tracksViewChanges}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1000}
    >
      {markerContent}
    </Marker>
  );
};

const MAX_HISTORY_POINTS = 50;
const MIN_DISTANCE_THRESHOLD = 0.1; // Reduced from 1.0 meter to 0.1 meters
const AVERAGE_STEP_LENGTH_METERS = 0.762;
const STEPS_PER_TRAIL_POINT = 3; // Add a trail point every 3 steps
const METERS_TO_DEGREE_LAT = 111111; // Approx meters in 1 degree latitude
const METERS_TO_DEGREE_LON = 111111; // Add equivalent for longitude (will be adjusted based on latitude)
const MIN_GPS_DISTANCE_FOR_DIRECTION = 0.1; // Reduced from 1.0 to 0.1 meters
const EMA_ALPHA = 0.3; // Decreased from 0.45 for more smoothing
const STATIONARY_STEP_THRESHOLD = 1; // Minimum steps required to consider user moving
const STATIONARY_TIME_THRESHOLD = 5000; // Time in ms to consider user stationary if no step changes
const MAX_GPS_LOG_ENTRIES = 200; // Maximum number of entries to store for GPS logging

// Add a threshold for unrealistic jumps (in meters)
const UNREALISTIC_JUMP_THRESHOLD_METERS = 10; // Reduced from 50m to 10m for testing in small areas

export default function App() {
const mapRef = useRef(null);
const [points, setPoints] = useState([]);
const [currentLocation, setCurrentLocation] = useState(null);
const [isFetchingLocation, setIsFetchingLocation] = useState(false);
const [isDrawingComplete, setIsDrawingComplete] = useState(false);
const [isDrawing, setIsDrawing] = useState(false);
const [initialRegion, setInitialRegion] = useState({
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
});
const navigation = useNavigation();
const [userRole, setUserRole] = useState(null);
const [teamGeofence, setTeamGeofence] = useState([]);
const [gpsAccuracy, setGpsAccuracy] = useState(null);
const [usersLocations, setUsersLocations] = useState({});
const [shouldAutoFit, setShouldAutoFit] = useState(true);
const [markerPositions, setMarkerPositions] = useState({});
const [trackViewChanges, setTrackViewChanges] = useState(false);
  const [realStepCount, setRealStepCount] = useState(0);
  const insets = useSafeAreaInsets();

  const [stepCount, setStepCount] = useState(0);
  const [stepsSinceLastGpsUpdate, setStepsSinceLastGpsUpdate] = useState(0);
  const [stepCountHistory, setStepCountHistory] = useState([]);
  const stepCounterInterval = useRef(null);
  const lastStepSaveTimestamp = useRef(Date.now());
  const [isPedometerAvailable, setIsPedometerAvailable] = useState('checking');
  const pedometerSubscription = useRef(null);
  const isStepCountingInitialized = useRef(false);
  const lastPedometerStepsRef = useRef(0);
  
  // Refs to hold the latest state values for use in callbacks
  const stepCountRef = useRef(stepCount);
  const stepsSinceLastGpsUpdateRef = useRef(stepsSinceLastGpsUpdate); // *** Reinstate Ref ***
  const lastTrailPointStepsRef = useRef(null); // Reinstate ref for steps
  const lastSmoothedCoordinateRef = useRef(null); // *** NEW: Ref for last smoothed point ***
  const [estimatedIconPosition, setEstimatedIconPosition] = useState(null); // *** NEW: State for icon's estimated position ***
  const [isUserMarkerMoving, setIsUserMarkerMoving] = useState(false); // Re-added state
  const locationSubscriptionRef = useRef(null); // Add a ref for the location subscription
  const kalmanFilterRef = useRef(null); // Add a ref for the Kalman filter
  const [lastStepUpdateTime, setLastStepUpdateTime] = useState(Date.now());
  const [isUserMoving, setIsUserMoving] = useState(false);
  const [gpsLogData, setGpsLogData] = useState({
    raw: [],
    filtered: [],
    stationary: {
      raw: [],
      filtered: []
    },
    walking: {
      raw: [],
      filtered: []
    }
  });
  const [isLoggingGps, setIsLoggingGps] = useState(false);

  // Keep refs synced with state
  useEffect(() => { stepCountRef.current = stepCount; }, [stepCount]);
  useEffect(() => { stepsSinceLastGpsUpdateRef.current = stepsSinceLastGpsUpdate; }, [stepsSinceLastGpsUpdate]); // *** Reinstate useEffect ***
  // No longer need stepsSinceLastGpsUpdateRef here

  // Make sure the locationHistory state is correctly initialized at the top of your component
  const [locationHistory, setLocationHistory] = useState([]); // Initialize as empty array

  // Add at the top with other state variables
  const [isRemovingLocation, setIsRemovingLocation] = useState(false);

  // Add this state variable at the top of your component (in the App function)
  const [debugMode, setDebugMode] = useState(false);

useEffect(() => {
  const initializeApp = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser || !navigation) return;
      
      // Try to get a fast initial location while the profile loads
      requestInitialLocation();
      
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data:', profileData);
        setUserRole(profileData.role);
        console.log('Setting user role to:', profileData.role);
        
        if (profileData.role === 'owner' && profileData.needsGeofenceSetup === true) {
          console.log('User needs to set up a new geofence');
          
          setPoints([]);
          
          await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false);
          
          if (profileData.teamCode && navigation) {
            console.log('Navigating to OwnerInitialization with teamCode:', profileData.teamCode);
            
            const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence/coordinates`);
            try {
              await set(teamGeofenceRef, []);
              console.log('Successfully cleared geofence before initialization');
            } catch (error) {
              console.error('Error clearing geofence before initialization:', error);
            }
            
            Alert.alert(
              'Geofence Reset Approved',
              'Your request to reset the geofence has been approved. You need to set up new boundaries.',
              [
                { 
                  text: 'Set Up Now', 
                  onPress: () => {
                    set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false)
                      .then(() => {
                        console.log('needsGeofenceSetup flag explicitly cleared');
                        navigation.navigate('OwnerInitialization', { teamCode: profileData.teamCode })
                      })
                      .catch(err => {
                        console.error('Error clearing needsGeofenceSetup flag:', err);
                        navigation.navigate('OwnerInitialization', { teamCode: profileData.teamCode })
                      });
                  }
                }
              ],
              { cancelable: false }
            );
            return;
          } else {
            console.error('Cannot navigate: Missing teamCode or navigation object');
          }
        }
        
        if (profileData.role === 'owner') {
          if (profileData.geofenceData && profileData.geofenceData.coordinates) {
            console.log('Loading geofence from user profile data');
            setPoints(profileData.geofenceData.coordinates);
          } else {
            console.log('No geofence in profile, checking team geofence');
            const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
            const geofenceSnapshot = await get(teamGeofenceRef);
            
            if (geofenceSnapshot.exists()) {
              const geofenceData = geofenceSnapshot.val();
              
              const coordinates = Array.isArray(geofenceData) 
                ? geofenceData 
                : (geofenceData.coordinates || []);
              
              console.log('Found team geofence with', coordinates.length, 'points');
              setPoints(coordinates);
              
              if (coordinates.length > 0) {
                const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
                await set(userProfileGeofenceRef, {
                  coordinates: coordinates,
                  teamCode: profileData.teamCode,
                  lastModified: new Date().toISOString()
                });
                console.log('Updated user profile with geofence data for faster loading');
              }
            } else {
              Alert.alert(
                'Geofence Setup Required',
                'You need to set up location boundaries for your team.',
                [
                  { text: 'Set Up Now', onPress: () => navigation.navigate('OwnerInitialization', { teamCode: profileData.teamCode }) }
                ]
              );
              return;
            }
          }
        } else if (profileData.role === 'member') {
          if (profileData.teamCode) {
            if (profileData.teamGeofenceCache && profileData.teamGeofenceCache.coordinates) {
              console.log('Loading team geofence from local cache');
              setTeamGeofence(profileData.teamGeofenceCache.coordinates);
            }
            
            const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
            const geofenceSnapshot = await get(teamGeofenceRef);
            
            if (geofenceSnapshot.exists()) {
              const geofenceData = geofenceSnapshot.val();
              
              const coordinates = Array.isArray(geofenceData) 
                ? geofenceData 
                : (geofenceData.coordinates || []);
              
              console.log('Found team geofence with', coordinates.length, 'points');
              setTeamGeofence(coordinates);
              
              if (coordinates.length > 0) {
                const cacheRef = ref(db, `users/${auth.currentUser.uid}/profile/teamGeofenceCache`);
                await set(cacheRef, {
                  coordinates: coordinates,
                  teamCode: profileData.teamCode,
                  lastUpdated: new Date().toISOString()
                });
                console.log('Cached team geofence for faster loading');
              }
            }
          }
        }
        
        await toggleCurrentLocation();
      }
    } catch (error) {
      console.error('Error initializing app:', error);
    }
  };

  initializeApp();
}, []);

useEffect(() => {
  const loadUserRole = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        setUserRole(profileData.role);
        
        if (profileData.role === 'member') {
          toggleCurrentLocation();
        }
      }
    } catch (error) {
      console.error('Error loading user role:', error);
    }
  };

  loadUserRole();
}, []);

useEffect(() => {
  const loadTeamGeofence = async () => {
    if (!auth.currentUser || userRole !== 'member') return;
    
    try {
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnapshot = await get(userProfileRef);
      const teamCode = profileSnapshot.val()?.teamCode;
      
      if (teamCode) {
        const geofenceRef = ref(db, "geofence/coordinates");
        const geofenceSnapshot = await get(geofenceRef);
        if (geofenceSnapshot.exists()) {
          setTeamGeofence(geofenceSnapshot.val());
        }
      }
    } catch (error) {
      console.error("Error loading team geofence:", error);
    }
  };

  loadTeamGeofence();
}, [userRole]);

const initializeMap = async () => {
  try {
    // Try to get a fast location first
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getLastKnownPositionAsync();
        if (location && location.coords) {
          const { latitude, longitude } = location.coords;
          setInitialRegion({
            latitude,
            longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });
          // Don't set currentLocation here - that's managed by toggleCurrentLocation
        }
      }
    } catch (error) {
      console.warn("Error getting last known position:", error);
    }
    
    const locationsRef = ref(db, "UsersCurrentLocation");
    const locSnapshot = await get(locationsRef);
    
    if (locSnapshot.exists() && Object.keys(locSnapshot.val()).length > 0) {
      const locations = {};
      Object.entries(locSnapshot.val()).forEach(([userId, userData]) => {
        if (userData.Latitude && userData.Longitude) {
          locations[userId] = userData;
        }
      });
      
      setUsersLocations(locations);
      
      const currentUserLoc = locSnapshot.val()[auth.currentUser?.uid];
      if (currentUserLoc && currentUserLoc.Latitude && currentUserLoc.Longitude) {
        setCurrentLocation({
          latitude: currentUserLoc.Latitude,
          longitude: currentUserLoc.Longitude
        });
      }
      
      setTimeout(() => {
        fitAllMarkers(true);
      }, 1000);
    } else {
      // Start location tracking automatically if we have permission
      requestInitialLocation();
    }
  } catch (error) {
    console.error("Error initializing map:", error);
  }
};

const getLocation = async () => {
  console.log("Set Point functionality has been disabled");
  return;
};

const isSubZoneCrossingPolygonEdges = (subZone, polygon) => {
  const radius = subZone.diameter / 2;

  for (let i = 0; i < polygon.length; i++) {
    let p1 = polygon[i];
    let p2 = polygon[(i + 1) % polygon.length];
    const distance = distanceFromPointToLine(subZone, p1, p2);

    if (distance < radius) {
      return true;
    }
  }
  return false;
};

const distanceFromPointToLine = (point, lineStart, lineEnd) => {
  const A = point.latitude - lineStart.latitude;
  const B = point.longitude - lineStart.longitude;
  const C = lineEnd.latitude - lineStart.latitude;
  const D = lineEnd.longitude - lineStart.longitude;

  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  const param = len_sq !== 0 ? dot / len_sq : -1;

  let nearestLat, nearestLng;
  if (param < 0) {
    nearestLat = lineStart.latitude;
    nearestLng = lineStart.longitude;
  } else if (param > 1) {
    nearestLat = lineEnd.latitude;
    nearestLng = lineEnd.longitude;
  } else {
    nearestLat = lineStart.latitude + param * C;
    nearestLng = lineStart.longitude + param * D;
  }

  return calculateDistance(point, { latitude: nearestLat, longitude: nearestLng });
};

const toggleCurrentLocation = async () => {
  try {
    // Separate code paths for adding vs removing
    if (currentLocation) {
      console.log("Removing current location - explicit path");
      setIsRemovingLocation(true);
      
      // Clear location tracking subscription first
      if (locationSubscriptionRef.current) {
        try {
          locationSubscriptionRef.current.remove();
        } catch (e) {
          console.error("Error removing location subscription:", e);
        }
        locationSubscriptionRef.current = null;
      }
      
      // Clear all location-related state
      setCurrentLocation(null);
      setGpsAccuracy(null);
      setLocationHistory([]); 
      setEstimatedIconPosition(null);
      
      const db = getDatabase();
      const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser?.uid}`);
      
      if (auth.currentUser?.uid) {
        // Update Firebase asynchronously but don't await it
        update(userLocationRef, { 
          isActive: false,
          lastSeen: new Date().toISOString(),
        }).catch(err => console.error("Error updating location status:", err));
      }
      
      setIsRemovingLocation(false);
      return;
    }
    
    setIsFetchingLocation(true);
    
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required to share your location.');
      setIsFetchingLocation(false);
      return;
    }

    // Get initial low-accuracy location quickly
    try {
      const fastLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
        maximumAge: 10000 // Accept a cached position up to 10 seconds old
      });
      
      if (fastLocation && fastLocation.coords) {
        const { latitude, longitude } = fastLocation.coords;
        setCurrentLocation({ latitude, longitude });
        setGpsAccuracy(fastLocation.coords.accuracy);
        
        // Quick initial map focus on user
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude,
            longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }, 500);
        }
      }
    } catch (error) {
      console.warn("Fast location fetch failed, continuing with high accuracy only:", error);
    }

    // Then get high accuracy location (but don't block UI)
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High
    }).then(location => {
      const { latitude, longitude } = location.coords;
      setCurrentLocation({ latitude, longitude });
      setGpsAccuracy(location.coords.accuracy);
    }).catch(error => {
      console.error("High accuracy location failed:", error);
    });

    const db = getDatabase();
    const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
    const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);

    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    const profileData = profileSnapshot.exists() ? profileSnapshot.val() : {};

    // Update Firebase in background
    set(userLocationRef, { 
      Latitude: currentLocation?.latitude || 0, 
      Longitude: currentLocation?.longitude || 0,
      Accuracy: currentLocation ? gpsAccuracy : 0,
      Timestamp: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      ...profileData
    }).catch(err => console.error("Error updating initial location:", err));

    const presenceData = {
      status: 'online',
      lastSeen: new Date().toISOString(),
      deviceInfo: Platform.OS
    };
    set(userPresenceRef, presenceData)
      .catch(err => console.error("Error updating presence:", err));

    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        onDisconnect(userPresenceRef).update({
          status: 'offline',
          lastSeen: new Date().toISOString()
        });

        onDisconnect(userLocationRef).update({
          isActive: false,
          lastSeen: new Date().toISOString()
        });
      }
    }, { onlyOnce: true });
    
    setIsFetchingLocation(false);
  } catch (error) {
    console.error("Error toggling location:", error);
    Alert.alert('Error', 'Failed to update location');
    setIsFetchingLocation(false);
  }
};

useEffect(() => {
  const startLocationTracking = async () => {
    if (!currentLocation) {
      setGpsAccuracy(null);
      return;
    }

    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        console.warn("Location services are disabled");
        return;
      }

      const { status: existingStatus } = await Location.getForegroundPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.warn("Location permission not granted");
        return;
      }

      // Clean up any existing subscription
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
      }

      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
            accuracy: Location.Accuracy.BestForNavigation, // Changed from Balanced to BestForNavigation 
            timeInterval: 500, // Reduced from 1000ms to 500ms for more frequent updates
            distanceInterval: 0, // Get all points for KF
            mayShowUserSettingsDialog: true 
        },
        async (location) => {
          try { // Outer try
            const { latitude, longitude, accuracy } = location.coords;
            console.log(`📍 Raw GPS: Lat=${latitude.toFixed(8)}, Lon=${longitude.toFixed(8)}, Acc=${accuracy.toFixed(1)}m`); // Log Raw Data with more precision
            
            // Log full location data for diagnosis
            console.log(`🔍 FULL: Timestamp=${location.timestamp}, Speed=${location.coords.speed?.toFixed(3) || 'null'}, Heading=${location.coords.heading?.toFixed(2) || 'null'}, Alt=${location.coords.altitude?.toFixed(2) || 'null'}`);

            // --- Pre-filtering --- 
            // 1. Accuracy Filter - much more generous now
            if (accuracy > 100) { // Changed from 20m to 100m to accept more points
              console.log(`KF Using low accuracy point: ${Math.round(accuracy)}m`);
            setGpsAccuracy(accuracy);
              // We'll still update rather than return, just logging the poor accuracy
            }
            
            // 2. Jump Detection
            if (kalmanFilterRef.current && kalmanFilterRef.current.lastFilteredPosition) {
              const jumpDistance = calculateDistance( // Use Haversine distance function
                { latitude, longitude }, 
                kalmanFilterRef.current.lastFilteredPosition
              );
              
              if (jumpDistance > UNREALISTIC_JUMP_THRESHOLD_METERS) {
                console.warn(`KF Skipping unrealistic jump: ${jumpDistance.toFixed(1)}m`);
                // Don't update GPS accuracy here, as the point is likely bad
                return; 
              }
            }
            // --- End Pre-filtering --- 
            
            // Filter the location if the filter is initialized
            let filteredCoordinate = { latitude, longitude };
            let iconPositionCoordinate = { latitude, longitude }; // Separate variable for icon smoothing
            
            if (kalmanFilterRef.current) {
              try { // Inner try for KF
                // Get the actual filtered coordinate for the icon
                iconPositionCoordinate = kalmanFilterRef.current.update(
                  latitude,
                  longitude,
                  accuracy
                );
                
                // *** TEMPORARY TEST: Use raw GPS directly for polyline history ***
                filteredCoordinate = { latitude, longitude }; 
                console.log(`🚦 Using RAW GPS for polyline history (Testing Sensitivity)`);

              } catch (kfError) {
                 console.error("Kalman Filter Error:", kfError);
                 // Use raw for both if filter fails
                 filteredCoordinate = { latitude, longitude }; 
                 iconPositionCoordinate = { latitude, longitude }; 
                 kalmanFilterRef.current = new SimpleKalmanFilter(0.01, 10); // Reset filter with more responsive settings
              } 
                } else {
              console.warn("Kalman filter not initialized, using raw GPS.");
              // Initialize the Kalman filter with current position
              kalmanFilterRef.current = new SimpleKalmanFilter(0.01, 10); // More responsive settings
              kalmanFilterRef.current.init(latitude, longitude);
              // Use raw for both if filter not init
              filteredCoordinate = { latitude, longitude };
              iconPositionCoordinate = { latitude, longitude }; 
            }
            
            console.log(`✨ Icon Coord (Filtered): Lat=${iconPositionCoordinate.latitude.toFixed(6)}, Lon=${iconPositionCoordinate.longitude.toFixed(6)}`); // Log Filtered Data for Icon
            console.log(`〰️ History Coord (Raw): Lat=${filteredCoordinate.latitude.toFixed(6)}, Lon=${filteredCoordinate.longitude.toFixed(6)}`); // Log Coord used for History
            
            // Update state for icon and raw GPS display
            const currentGpsCoordinate = { latitude, longitude };
            setCurrentLocation(currentGpsCoordinate); 
            setGpsAccuracy(accuracy); 
            setEstimatedIconPosition(iconPositionCoordinate); // Icon uses the smoothed coordinate

            // Log GPS data if logging is enabled
            if (isLoggingGps) {
              const timestamp = Date.now();
              const logEntry = {
                timestamp,
                formattedTime: new Date(timestamp).toISOString(),
                accuracy,
                altitude: location.coords.altitude,
                speed: location.coords.speed,
                heading: location.coords.heading,
                stepsSinceLastUpdate: stepsSinceLastGpsUpdateRef.current || 0,
                isMoving: isUserMoving
              };
              
              // Add raw GPS data point
              const rawDataPoint = {
                ...logEntry,
                latitude,
                longitude
              };
              
              // Add filtered GPS data point
              const filteredDataPoint = {
                ...logEntry,
                latitude: iconPositionCoordinate.latitude,
                longitude: iconPositionCoordinate.longitude
              };
              
              setGpsLogData(prevData => {
                // Create new arrays with added data points
                const newRawData = [...prevData.raw, rawDataPoint].slice(-MAX_GPS_LOG_ENTRIES);
                const newFilteredData = [...prevData.filtered, filteredDataPoint].slice(-MAX_GPS_LOG_ENTRIES);
                
                // Add to appropriate movement category
                const movementCategory = isUserMoving ? 'walking' : 'stationary';
                const newMovementRawData = [...prevData[movementCategory].raw, rawDataPoint].slice(-MAX_GPS_LOG_ENTRIES);
                const newMovementFilteredData = [...prevData[movementCategory].filtered, filteredDataPoint].slice(-MAX_GPS_LOG_ENTRIES);
                
                return {
                  raw: newRawData,
                  filtered: newFilteredData,
                  stationary: {
                    raw: movementCategory === 'stationary' ? newMovementRawData : prevData.stationary.raw,
                    filtered: movementCategory === 'stationary' ? newMovementFilteredData : prevData.stationary.filtered
                  },
                  walking: {
                    raw: movementCategory === 'walking' ? newMovementRawData : prevData.walking.raw,
                    filtered: movementCategory === 'walking' ? newMovementFilteredData : prevData.walking.filtered
                  }
                };
              });
              
              console.log(`📊 GPS LOGGING: Logged ${isUserMoving ? 'walking' : 'stationary'} data point`);
            }

            setLocationHistory(prevHistory => {
              // Defensive check: if prevHistory is undefined, start with empty array
              const history = prevHistory || [];
              
              // In debug mode, always add the point
              if (debugMode) {
                console.log(`🐞 DEBUG: Force adding point to history. New length: ${history.length + 1}`);
                const newHistory = [...history, {
                  latitude,
                  longitude,
                  timestamp: Date.now() // Keep timestamp for debugging
                }];
                
                // Keep history limited
                if (newHistory.length > MAX_HISTORY_POINTS + 20) {
                  return newHistory.slice(-(MAX_HISTORY_POINTS + 10)); 
                }
                return newHistory;
              }
              
              // Check if user is moving based on step count
              const currentTime = Date.now();
              const stepsSinceLastUpdate = stepsSinceLastGpsUpdateRef.current || 0;
              const timeSinceLastStepUpdate = currentTime - lastStepUpdateTime;
              
              if (stepsSinceLastUpdate < STATIONARY_STEP_THRESHOLD && 
                  timeSinceLastStepUpdate > STATIONARY_TIME_THRESHOLD) {
                console.log(`👣 USER STATIONARY: Steps ${stepsSinceLastUpdate} < threshold ${STATIONARY_STEP_THRESHOLD}, time since update: ${timeSinceLastStepUpdate}ms`);
                setIsUserMoving(false);
                return history; // Don't add point if user is stationary
              } else if (stepsSinceLastUpdate >= STATIONARY_STEP_THRESHOLD) {
                console.log(`👣 USER MOVING: Steps ${stepsSinceLastUpdate} >= threshold ${STATIONARY_STEP_THRESHOLD}`);
                setIsUserMoving(true);
                // Update last step update time when movement is detected
                setLastStepUpdateTime(currentTime);
              }
              
              // Normal mode - check if point is different enough
              const lastPoint = history.length > 0 ? history[history.length - 1] : null;
              
              // Use EXTREMELY small threshold (essentially any change)
              const distanceThresholdDegrees = 0.00000001; // Practically any change
              if (!lastPoint || 
                  Math.abs(filteredCoordinate.latitude - lastPoint.latitude) > distanceThresholdDegrees ||
                  Math.abs(filteredCoordinate.longitude - lastPoint.longitude) > distanceThresholdDegrees) 
              {
                // Only add point if user is moving or this is the first point
                if (isUserMoving || !lastPoint) {
                  console.log(`➕ Adding point to history. New length: ${history.length + 1}`);
                  const newHistory = [...history, filteredCoordinate]; // Add the real coordinate
                  
                  // Keep history limited
                  if (newHistory.length > MAX_HISTORY_POINTS + 10) {
                    return newHistory.slice(-(MAX_HISTORY_POINTS + 5)); 
                  }
                  return newHistory;
                } else {
                  console.log(`➖ Skipping history add - user not moving.`);
                  return history; // Return existing history unchanged
                }
              } else {
                console.log(`➖ Skipping history add - point too close to last.`);
                return history; // Return existing history unchanged
              }
            });
            
            // ... (Firebase update logic - should likely use smoothed iconPositionCoordinate or raw currentGpsCoordinate)
            // Consider which coordinate to save to Firebase based on needs
            // Example using smoothed:
            // writeLocationToFirebase(iconPositionCoordinate, accuracy);
            
          } catch (error) { // Catch for outer try
            console.error("Error updating location:", error);
          } // End outer try-catch
        } // End async (location) callback
      ); // End watchPositionAsync
      
      console.log('Location tracking with Kalman Filter started.');

    } catch (error) { // Catch for startLocationTracking setup
      console.error('Error starting location tracking setup:', error);
    } // End startLocationTracking setup try-catch
  }; // End startLocationTracking function

  if (currentLocation) {
    startLocationTracking();
  }

  return () => {
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
  };
}, [currentLocation]); // Note: Dependency array might need review if stepCount directly influenced render

const isPointInsidePolygon = (point, polygon) => {
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

const calculateDistance = (point1, point2) => {
    const R = 6371e3;
  const lat1 = (point1.latitude * Math.PI) / 180;
  const lat2 = (point2.latitude * Math.PI) / 180;
  const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const deltaLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const checkDatabaseConnection = async () => {
  try {
    const connectedRef = ref(db, '.info/connected');
    return new Promise((resolve) => {
      onValue(connectedRef, (snap) => {
        resolve(snap.val() === true);
      });
    });
  } catch (error) {
    console.error("Error checking connection:", error);
    return false;
  }
};

const saveCoordinatesToFirebase = (coordinates) => {
  const auth = getAuth();
  if (!auth.currentUser) return;
  
  try {
    const db = getDatabase();
    
    const globalRef = ref(db, "geofence/coordinates");
    set(globalRef, coordinates)
      .then(() => console.log("Global coordinates saved successfully"))
      .catch((error) => console.error("Error saving global coordinates:", error));
    
    get(ref(db, `users/${auth.currentUser.uid}/profile`))
      .then((snapshot) => {
        if (snapshot.exists()) {
          const userData = snapshot.val();
          
          if (userData.role === 'owner' && userData.teamCode) {
            const teamGeofenceRef = ref(db, `teams/${userData.teamCode}/geofence`);
            const geofenceData = {
              coordinates: coordinates,
              owner: {
                uid: auth.currentUser.uid,
                name: auth.currentUser.displayName || `${userData.firstName} ${userData.lastName}`,
                email: userData.email
              },
              createdAt: userData.geofenceData?.createdAt || new Date().toISOString(),
              lastModified: new Date().toISOString()
            };
            
            set(teamGeofenceRef, geofenceData)
              .then(() => console.log("Team geofence saved successfully"))
              .catch((error) => console.error("Error saving team geofence:", error));
            
            const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
            set(userProfileGeofenceRef, {
              coordinates: coordinates,
              teamCode: userData.teamCode,
              lastModified: new Date().toISOString()
            })
              .then(() => console.log("User profile geofence saved successfully"))
              .catch((error) => console.error("Error saving to user profile:", error));
            
            get(ref(db, `teams/${userData.teamCode}/geofenceModified`))
              .then((modifiedSnapshot) => {
                if (modifiedSnapshot.exists()) {
                  const changeRequestRef = ref(db, `adminRequests/geofenceChanges/${userData.teamCode}`);
                  set(changeRequestRef, {
                    teamCode: userData.teamCode,
                    ownerId: auth.currentUser.uid,
                    ownerName: auth.currentUser.displayName || userData.firstName + ' ' + userData.lastName,
                    requestDate: new Date().toISOString(),
                    newCoordinates: coordinates,
                    status: 'pending'
                  })
                    .then(() => {
                      Alert.alert(
                        'Change Request Submitted',
                        'Your geofence boundary changes require admin approval. You will be notified when approved.'
                      );
                    })
                    .catch((error) => console.error("Error creating change request:", error));
                } else {
                  set(ref(db, `teams/${userData.teamCode}/geofenceModified`), true)
                    .then(() => console.log("Geofence marked as modified"))
                    .catch((error) => console.error("Error marking geofence:", error));
                }
              })
              .catch((error) => console.error("Error checking geofence modified status:", error));
          }
        }
      })
      .catch((error) => console.error("Error getting user profile:", error));
  } catch (error) {
    console.error("Error in saveCoordinatesToFirebase:", error);
  }
};

const fitAllMarkers = (forceUpdate = false) => {
  if (!mapRef.current) return;
  
  if (!forceUpdate && !shouldAutoFit) return;
  
  setShouldAutoFit(true);
  
  setTimeout(() => {
    const allCoordinates = [];
    
    const geofencePoints = userRole === 'member' ? teamGeofence : points;
    if (geofencePoints.length >= 3) {
      geofencePoints.forEach(point => {
        allCoordinates.push(point);
      });
      
      if (currentLocation) {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
      if (usersLocations) {
        Object.entries(usersLocations).filter(([userId, userData]) => {
          if (!userData || !userData.Latitude || !userData.Longitude) return false;
          if (userId === auth.currentUser?.uid) return false;
          
          const currentUserProfile = usersLocations[auth.currentUser?.uid];
          return userData.teamCode === currentUserProfile?.teamCode;
        }).forEach(([_, userData]) => {
          allCoordinates.push({
            latitude: userData.Latitude,
            longitude: userData.Longitude
          });
        });
      }
    } else {
      if (currentLocation) {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
      if (usersLocations) {
        Object.values(usersLocations).forEach(user => {
          if (user.Latitude && user.Longitude) {
            allCoordinates.push({
              latitude: user.Latitude,
              longitude: user.Longitude
            });
          }
        });
      }
      
      if (geofencePoints.length > 0) {
        geofencePoints.forEach(point => {
          allCoordinates.push(point);
        });
      }
    }
    
    if (allCoordinates.length > 0) {
      const edgePadding = geofencePoints.length >= 3 
          ? { top: 100, right: 100, bottom: 200, left: 100 }
          : { top: 200, right: 200, bottom: 300, left: 200 };
      
      // *** Add null check here ***
      if (mapRef.current) { 
      mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: edgePadding,
        animated: true
      });
      } else {
        console.warn("fitAllMarkers: mapRef.current is null inside setTimeout");
      }
      
      setTrackViewChanges(true);
      
      setTimeout(() => {
        setTrackViewChanges(false);
        }, 1000);
    } else {
      mapRef.current.animateToRegion({
        ...initialRegion,
          latitudeDelta: 0.03,
        longitudeDelta: 0.03
      }, 1000);
    }
    }, 100);
};

useEffect(() => {
  if (shouldAutoFit && (Object.keys(usersLocations).length > 0 || currentLocation)) {
    fitAllMarkers();
    setShouldAutoFit(false);
  }
}, [usersLocations, currentLocation, shouldAutoFit]);

useEffect(() => {
  initializeMap();
}, []);

useEffect(() => {
  const loadAllUserLocations = async () => {
    try {
      console.log("Loading user locations...");
      const locationsRef = ref(db, "UsersCurrentLocation");
      
      const unsubscribe = onValue(locationsRef, (snapshot) => {
        if (snapshot.exists()) {
          const locationsData = snapshot.val();
          
          const formattedLocations = {};
          
          const fetchUserProfiles = async () => {
            for (const [userId, userData] of Object.entries(locationsData)) {
              if (userData && userData.Latitude && userData.Longitude) {
                try {
                  const userProfileRef = ref(db, `users/${userId}/profile`);
                  const profileSnapshot = await get(userProfileRef);
                  
                  if (profileSnapshot.exists()) {
                    const profileData = profileSnapshot.val();
                    
                    let displayName = '';
                    if (profileData.firstName && profileData.firstName.trim() !== '') {
                      displayName = profileData.firstName;
                      if (profileData.lastName && profileData.lastName.trim() !== '') {
                        displayName += ' ' + profileData.lastName;
                      }
                    } else if (profileData.lastName && profileData.lastName.trim() !== '') {
                      displayName = profileData.lastName;
                    }
                    
                    formattedLocations[userId] = {
                      ...userData,
                      firstName: profileData.firstName || '',
                      lastName: profileData.lastName || '',
                      photoURL: profileData.photoURL || '',
                      role: profileData.role || '',
                      teamCode: profileData.teamCode || '',
                      name: formatUserName(profileData)
                    };
                  } else {
                    formattedLocations[userId] = {
                      ...userData,
                      firstName: '',
                      lastName: '',
                      photoURL: '',
                      role: '',
                      teamCode: '',
                      name: ''
                    };
                  }
                } catch (error) {
                  console.error(`Error fetching profile for user ${userId}`);
                  formattedLocations[userId] = {
                    ...userData,
                    firstName: '',
                    lastName: '',
                    photoURL: '',
                    role: '',
                    teamCode: '',
                    name: ''
                  };
                }
              }
            }
            
            setUsersLocations(formattedLocations);
          };
          
          fetchUserProfiles();
        } else {
          console.log("No user locations found in database");
          setUsersLocations({});
        }
      });
      
      return unsubscribe;
    } catch (error) {
      console.error("Error loading user locations:", error);
    }
  };
  
    const unsubscribe = loadAllUserLocations();
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
         Promise.resolve(unsubscribe).then(unsub => {
            if (typeof unsub === 'function') {
               unsub();
            }
         });
      }
    };
  }, [db]);

const getUniqueColor = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const colors = [
      '#3498db',
      '#e74c3c',
      '#2ecc71',
      '#f39c12',
      '#9b59b6',
      '#1abc9c',
      '#d35400',
      '#2980b9',
      '#8e44ad',
      '#27ae60',
      '#f1c40f',
      '#16a085',
      '#e67e22',
      '#c0392b',
      '#7f8c8d'
    ];
    
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

const calculateMarkerLabelPositions = (locations) => {
  const positionMap = {};
  const locationGroups = {};
  
  Object.entries(locations).forEach(([userId, userData]) => {
    if (!userData || !userData.Latitude || !userData.Longitude) return;
    
    const coord = { latitude: userData.Latitude, longitude: userData.Longitude };
    let foundGroup = false;
    
    Object.keys(locationGroups).forEach(groupId => {
      const groupCoord = locationGroups[groupId];
        if (calculateDistance(coord, groupCoord) < 30) {
        if (!locationGroups[groupId].members) {
          locationGroups[groupId].members = [];
        }
        locationGroups[groupId].members.push(userId);
        foundGroup = true;
      }
    });
    
    if (!foundGroup) {
      locationGroups[userId] = {
        latitude: coord.latitude,
        longitude: coord.longitude,
        members: [userId]
      };
    }
  });
  
  Object.values(locationGroups).forEach(group => {
    if (!group.members || group.members.length <= 1) {
      if (group.members && group.members.length === 1) {
        positionMap[group.members[0]] = 'bottom';
      }
    } else {
      const positionOptions = ['top', 'right', 'bottom', 'left'];
      group.members.forEach((userId, index) => {
        const position = positionOptions[index % positionOptions.length];
        if (userId) {
          positionMap[userId] = position;
        }
      });
    }
  });
  
  return positionMap;
};

useEffect(() => {
  if (Object.keys(usersLocations).length > 0) {
    const positions = calculateMarkerLabelPositions(usersLocations);
    setMarkerPositions(positions);
  }
}, [usersLocations]);

useEffect(() => {
  const checkNotifications = async () => {
    if (!auth.currentUser || !navigation) return;
    
    try {
      const db = getDatabase();
      const notificationsRef = ref(db, `notifications/${auth.currentUser.uid}`);
      
      const snapshot = await get(notificationsRef);
      if (snapshot.exists()) {
        const notifications = Object.entries(snapshot.val());
        const unreadNotifications = notifications.filter(([_, notification]) => 
          notification.read === false
        );
        
        console.log(`Found ${unreadNotifications.length} unread notifications`);
        
        for (const [notificationId, notification] of unreadNotifications) {
          if (notification.type === 'geofence_approved' || notification.type === 'geofence_rejected') {
            await set(ref(db, `notifications/${auth.currentUser.uid}/${notificationId}/read`), true);
            
            Alert.alert(
              notification.title,
              notification.message,
              [{ text: 'OK' }]
            );
            
            if (notification.type === 'geofence_approved' && userRole === 'owner') {
              const profileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
              const profileSnapshot = await get(profileRef);
              
              if (profileSnapshot.exists()) {
                const profileData = profileSnapshot.val();
                
                if (profileData.needsGeofenceSetup) {
                  setPoints([]);
                  
                  await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false);
                  
                  Alert.alert(
                    'Geofence Reset Approved',
                    'You can now set up a new geofence for your team.',
                    [
                      { 
                        text: 'Set Up Now', 
                        onPress: () => {
                          const teamCode = profileData.teamCode;
                          if (teamCode && navigation) {
                            const teamGeofenceRef = ref(db, `teams/${teamCode}/geofence/coordinates`);
                            set(teamGeofenceRef, [])
                              .then(() => {
                                console.log('Team geofence cleared successfully');
                                
                                const userNeedsGeofenceSetupRef = ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`);
                                set(userNeedsGeofenceSetupRef, false)
                                  .then(() => {
                                    console.log('needsGeofenceSetup flag explicitly cleared');
                                    navigation.navigate('OwnerInitialization', { teamCode });
                                  })
                                  .catch(err => {
                                    console.error('Error clearing needsGeofenceSetup flag:', err);
                                    navigation.navigate('OwnerInitialization', { teamCode });
                                  });
                              })
                              .catch(err => {
                                console.error('Error clearing team geofence:', err);
                                navigation.navigate('OwnerInitialization', { teamCode });
                              });
                          } else {
                            console.error('Cannot navigate: Missing teamCode or navigation object');
                          }
                        }
                      }
                    ],
                    { cancelable: false }
                  );
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  };
  
  checkNotifications();
}, [auth.currentUser, userRole, navigation, db]);

useEffect(() => {
  const handleMapRegionChange = () => {
    if (!trackViewChanges) {
      setTrackViewChanges(true);
      
      setTimeout(() => {
        setTrackViewChanges(false);
      }, 500);
    }
  };
  
  if (mapRef.current) {
    handleMapRegionChange();
  }
  
  return () => {
    setTrackViewChanges(false);
  };
}, [currentLocation, usersLocations, points, teamGeofence]);

  useEffect(() => {
    if (!auth.currentUser) {
      setRealStepCount(0);
      return;
    }

    let isMounted = true;
    const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/totalSteps`);
    let unsubscribe = () => {};

    get(stepDataRef).then((snapshot) => {
      if (isMounted) {
        if (snapshot.exists()) {
          setRealStepCount(snapshot.val() || 0);
        } else {
          setRealStepCount(0);
          console.log("No initial step data found, setting count to 0");
        }
      }
    }).catch(error => {
        console.error("Error fetching initial step count:", error);
        if (isMounted) setRealStepCount(0);
    });

    unsubscribe = onValue(stepDataRef, (snapshot) => {
      if (isMounted && snapshot.exists()) {
        const count = snapshot.val();
        setRealStepCount(count || 0);
         console.log("Realtime step count update:", count);
      } else if (isMounted) {
         // Handle case where data is deleted - maybe reset to 0?
         // setRealStepCount(0);
      }
    }, (error) => {
        console.error("Error listening to step count:", error);
        // Optionally handle listener error, e.g., setRealStepCount(NaN);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [db, auth.currentUser]);

  useEffect(() => {
    let isMounted = true;
    if (isStepCountingInitialized.current || !auth.currentUser) return; 
    console.log('🦶 STEP INIT (locTrack): Initializing step counting...');

    const checkPedometerAvailability = async () => {
      try {
        const isAvailable = await Pedometer.isAvailableAsync();
        if (isMounted) {
          setIsPedometerAvailable(String(isAvailable));
          console.log(`🦶 STEP INIT (locTrack): Pedometer Available = ${isAvailable}`);
          if (isAvailable) {
            await startPedometerTracking();
          } else {
            console.log('🦶 STEP INIT (locTrack): Pedometer not available, using simulated steps.');
            startIntervalBasedStepCounting();
          }
          isStepCountingInitialized.current = true; 
        }
      } catch (error) {
        console.error('🦶 STEP INIT (locTrack) ERROR: Error checking availability:', error);
        if (isMounted) {
          setIsPedometerAvailable('error');
          startIntervalBasedStepCounting();
          isStepCountingInitialized.current = true; 
        }
      }
    };

    checkPedometerAvailability();

    return () => {
      isMounted = false;
      console.log('🦶 STEP CLEANUP (locTrack): Cleaning up step counter...');
      if (pedometerSubscription.current) {
        pedometerSubscription.current.remove();
        pedometerSubscription.current = null;
        console.log('🦶 STEP CLEANUP (locTrack): Pedometer subscription removed.');
      }
      if (stepCounterInterval.current) {
        clearInterval(stepCounterInterval.current);
        stepCounterInterval.current = null;
        console.log('🦶 STEP CLEANUP (locTrack): Interval counter cleared.');
      }
       isStepCountingInitialized.current = false; 
    };
  }, [auth.currentUser]);

  const startPedometerTracking = async () => {
    console.log('🚶 PEDOMETER (locTrack): Starting tracking...');
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      const db = getDatabase();

      // 1. Get the last saved total steps from Firebase (Keep this part for overall total)
      const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/totalSteps`);
      const snapshot = await get(stepDataRef);
      const initialSavedSteps = snapshot.exists() ? (snapshot.val() || 0) : 0;
      console.log(`🚶 PEDOMETER (locTrack): Initial total steps loaded: ${initialSavedSteps}`);
      setStepCount(initialSavedSteps);
      stepCountRef.current = initialSavedSteps; // Sync ref too
      
      // Reset session-specific counters
      setStepsSinceLastGpsUpdate(0);
      stepsSinceLastGpsUpdateRef.current = 0;
      lastPedometerStepsRef.current = null; // *** Explicitly nullify baseline ref ***

      // 2. Request permissions
      const { status } = await Pedometer.requestPermissionsAsync();
      if (status !== 'granted') {
          console.error('🚶 PEDOMETER (locTrack) ERROR: Permission not granted!');
          setIsPedometerAvailable('denied');
          // Show Alert to guide user
          Alert.alert(
            'Permission Required',
            'This app needs permission to access your activity data to count steps accurately. Please grant the permission in settings.',
            [
              {
                text: 'Open Settings',
                onPress: () => Linking.openSettings(), // Opens app settings
              },
              {
                text: 'Use Fallback',
                onPress: () => {
                  console.log('🚶 PEDOMETER (locTrack): User chose fallback due to denied permission.');
                  startIntervalBasedStepCounting(); // Use fallback if user chooses
                },
                style: 'cancel',
              },
            ]
          );
          return; // Stop execution here, wait for user action in Alert
      }

      // 3. REMOVED: Don't get initial sensor reading baseline here - use first watch value
      console.log('🚶 PEDOMETER (locTrack): Waiting for first sensor reading to set baseline...');
       
      // 4. Start watching
      pedometerSubscription.current = Pedometer.watchStepCount(result => {
        const currentSensorSteps = result.steps; 

        // *** Set baseline on the first reading ***
        if (lastPedometerStepsRef.current === null) {
            console.log(`🚶 PEDOMETER (locTrack): Baseline set to ${currentSensorSteps}`);
            lastPedometerStepsRef.current = currentSensorSteps;
            return; // Don't process steps on the first reading
        }

        // Calculate delta based on the now-set baseline
        const deltaSteps = currentSensorSteps - lastPedometerStepsRef.current;
        // console.log(`🚶 PEDOMETER CB (locTrack): Sensor=${currentSensorSteps}, LastRef=${lastPedometerStepsRef.current}, Delta=${deltaSteps}`); // Verbose log

        // Handle sensor reset or negative values
        if (deltaSteps < 0) {
            console.warn(`🚶 PEDOMETER CB (locTrack): Negative delta (${deltaSteps}), resetting baseline to ${currentSensorSteps}`);
            lastPedometerStepsRef.current = currentSensorSteps;
            // Reset steps since last save as well, as history is broken
            setStepsSinceLastGpsUpdate(0);
            stepsSinceLastGpsUpdateRef.current = 0;
            return;
        }
        
        // Skip if no change
        if (deltaSteps === 0) {
            lastPedometerStepsRef.current = currentSensorSteps; // Keep ref updated
            return; 
        }

        // Apply positive delta
        console.log(`🚶 PEDOMETER CB (locTrack): Applying Delta: ${deltaSteps}`);
        setStepCount(prevTotal => {
          const newTotal = (stepCountRef.current || 0) + deltaSteps;
          stepCountRef.current = newTotal; 
          return newTotal;
        });
        // *** Update state AND ref for stepsSinceLastGpsUpdate ***
        setStepsSinceLastGpsUpdate(prevSinceSave => {
            const newSinceSave = (stepsSinceLastGpsUpdateRef.current || 0) + deltaSteps;
            stepsSinceLastGpsUpdateRef.current = newSinceSave;
            return newSinceSave;
        });
        
        // Update movement status when steps are detected
        if (deltaSteps > 0) {
          setIsUserMoving(true);
          setLastStepUpdateTime(Date.now());
        }
        
        // Update the reference *after* applying the delta for the next callback
        lastPedometerStepsRef.current = currentSensorSteps;

        const currentTime = Date.now();
        if (currentTime - lastStepSaveTimestamp.current >= 1000) {
          console.log('🚶 PEDOMETER CB (locTrack): 1s passed, calling save...');
          writeStepDataToFirebase();
          lastStepSaveTimestamp.current = currentTime;
        }
      });
      console.log('🚶 PEDOMETER (locTrack): Step watching started.');
      // Don't save initial state here, wait for baseline and first steps
      // writeStepDataToFirebase(true);
      // lastStepSaveTimestamp.current = Date.now();

    } catch (error) {
      console.error('🚶 PEDOMETER (locTrack) ERROR: Failed to start tracking:', error);
      startIntervalBasedStepCounting();
    }
  };

  const startIntervalBasedStepCounting = () => {
    console.log('📱 FALLBACK (locTrack): Using simulated step counting.');
    if (stepCounterInterval.current) clearInterval(stepCounterInterval.current);
     const auth = getAuth();
     if (auth.currentUser) {
         const db = getDatabase();
         const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/totalSteps`);
         get(stepDataRef).then(snapshot => {
             const initialSavedSteps = snapshot.exists() ? (snapshot.val() || 0) : 0;
             setStepCount(initialSavedSteps);
             console.log(`📱 FALLBACK (locTrack): Initial steps loaded: ${initialSavedSteps}`);
         }).catch(err => console.error("📱 FALLBACK (locTrack): Error loading initial steps:", err));
          setStepsSinceLastGpsUpdate(0); 
     }
    stepCounterInterval.current = setInterval(() => {
      const increment = 3;
      console.log(`📱 FALLBACK CB (locTrack): Incrementing by ${increment}`);
      
      setStepCount(prevCount => {
        const newTotal = (stepCountRef.current || 0) + increment;
        stepCountRef.current = newTotal;
        return newTotal;
      });
      // *** Update state AND ref for stepsSinceLastGpsUpdate ***
      setStepsSinceLastGpsUpdate(prevSteps => {
          const newSinceSave = (stepsSinceLastGpsUpdateRef.current || 0) + increment;
          stepsSinceLastGpsUpdateRef.current = newSinceSave;
          return newSinceSave;
      });
      
      // Update movement status
      setIsUserMoving(true);
      setLastStepUpdateTime(Date.now());
      
      const currentTime = Date.now();
      if (currentTime - lastStepSaveTimestamp.current >= 1000) {
        console.log('📱 FALLBACK CB (locTrack): 1s passed, calling save...');
        writeStepDataToFirebase(); // Will now use refs internally
        lastStepSaveTimestamp.current = currentTime;
      }
    }, 1500);
    console.log('📱 FALLBACK (locTrack): Saving initial state after setup...');
    writeStepDataToFirebase(true);
    lastStepSaveTimestamp.current = Date.now();
  };

  const writeStepDataToFirebase = async (isInitialReading = false) => {
    console.log(`📱 STEP SAVE (locTrack): Initiated. isInitialReading=${isInitialReading}`);
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      const db = getDatabase();
      let userTeamCode = '' // Need to get team code here, maybe from profile?
      const profileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnap = await get(profileRef);
      if (profileSnap.exists()) {
          userTeamCode = profileSnap.val()?.teamCode;
      } 
      if (!userTeamCode) {
          console.log('📱 STEP SAVE (locTrack) ERROR: No team code found in profile.');
          return; 
      }

      const timestamp = Date.now();
      const entryId = `step_${timestamp}`;
      let locationData = { latitude: 0, longitude: 0, isIndoor: true };
      // Use currentLocation state from locTrack.js
      if (currentLocation) { 
        locationData = { latitude: currentLocation.latitude, longitude: currentLocation.longitude, isIndoor: false };
      } else {
         try { 
            const locRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/lastLocation`);
            const locSnap = await get(locRef);
            if (locSnap.exists()) {
               locationData = { ...locSnap.val(), isIndoor: true };
            }
         } catch (e) { console.warn("Couldn't get last location for indoor steps:", e); }
      }

      const currentTotalSteps = stepCountRef.current; 
      // *** Use stepsSinceLastGpsUpdateRef correctly ***
      const currentStepsSinceSave = stepsSinceLastGpsUpdateRef.current;
      console.log(`📱 STEP SAVE (locTrack): Captured state: total=${currentTotalSteps}, sinceSave=${currentStepsSinceSave}`);

      if (currentStepsSinceSave <= 0 && !isInitialReading) {
          console.log(`📱 STEP SAVE (locTrack): Skipping save - no new steps (${currentStepsSinceSave})`);
          return;
      }

      const stepDataPayload = {
        location: locationData,
        steps: currentStepsSinceSave, // Uses the ref value
        totalSteps: currentTotalSteps,
        timestamp: timestamp,
        formattedTime: new Date(timestamp).toISOString(),
        userId: auth.currentUser.uid,
        isIndoorTracking: locationData.isIndoor,
        isPedometerUsed: isPedometerAvailable === 'true',
      };
      console.log(`📱 STEP SAVE (locTrack): Payload ready:`, stepDataPayload);

      const newHistoryEntry = {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          steps: currentStepsSinceSave, // Uses the ref value
          timestamp: timestamp,
          formattedTime: stepDataPayload.formattedTime,
          isIndoorTracking: locationData.isIndoor
      };
      let updatedHistoryForFirebase = [];
      setStepCountHistory(prevHistory => {
          updatedHistoryForFirebase = [newHistoryEntry, ...(prevHistory || []).slice(0, 19)];
          return updatedHistoryForFirebase;
      });
       await new Promise(resolve => setTimeout(resolve, 0)); 

      const updates = {};
      updates[`teams/${userTeamCode}/locationStepData/${auth.currentUser.uid}/${entryId}`] = stepDataPayload;
      updates[`users/${auth.currentUser.uid}/profile/stepData`] = {
        lastLocation: locationData,
        lastStepCount: currentStepsSinceSave, 
        totalSteps: currentTotalSteps, 
        lastUpdateTimestamp: timestamp,
        isPedometerUsed: isPedometerAvailable === 'true',
        history: updatedHistoryForFirebase 
      };
      updates[`appState/${auth.currentUser.uid}/stepDataInitialized`] = true;
      updates[`appState/${auth.currentUser.uid}/lastStepUpdateTimestamp`] = timestamp;
      console.log("📱 STEP SAVE (locTrack): Prepared Firebase updates object:", updates);
      
      await update(ref(db), updates);
      console.log("📱 STEP SAVE (locTrack): Firebase update successful.");

      // *** Reset state AND ref ***
      setStepsSinceLastGpsUpdate(0);
      stepsSinceLastGpsUpdateRef.current = 0; 
      console.log("📱 STEP SAVE (locTrack): Reset stepsSinceLastGpsUpdate to 0.");

    } catch (error) {
      console.error('📱 STEP SAVE (locTrack) ERROR:', error);
    }
  };

if (!db) {
  console.error("Firebase database not initialized");
    return <View style={styles.container}><Text>Loading...</Text></View>;
}

// Add a new function to reset steps and location data
const resetStepsAndLocationData = async () => {
  try {
    Alert.alert(
      "Reset Testing Data",
      "This will reset your step count and location history for testing purposes. Continue?",
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
                
                // 3. Reset team step data
                const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
                const profileSnap = await get(userProfileRef);
                if (profileSnap.exists()) {
                  const teamCode = profileSnap.val()?.teamCode;
                  if (teamCode) {
                    const teamStepDataRef = ref(db, `teams/${teamCode}/locationStepData/${auth.currentUser.uid}`);
                    await remove(teamStepDataRef);
                  }
                }
                
                // 4. Reset location history if needed
                if (currentLocation) {
                  const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
                  await update(userLocationRef, {
                    Timestamp: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                  });
                }
                
                Alert.alert("Reset Complete", "Step count and location history have been reset for testing purposes.");
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

// Add this function to export the GPS log data
const exportGpsLogData = async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `gps_log_data_${timestamp}.json`;
    const fileUri = FileSystem.documentDirectory + fileName;
    
    // Format the data for export
    const exportData = {
      timestamp: new Date().toISOString(),
      totalEntries: {
        raw: gpsLogData.raw.length,
        filtered: gpsLogData.filtered.length,
        stationaryRaw: gpsLogData.stationary.raw.length,
        stationaryFiltered: gpsLogData.stationary.filtered.length,
        walkingRaw: gpsLogData.walking.raw.length,
        walkingFiltered: gpsLogData.walking.filtered.length
      },
      data: gpsLogData
    };
    
    // Write data to file
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(exportData, null, 2));
    
    // Share the file
    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: 'Export GPS Log Data',
      UTI: 'public.json'
    });
    
    console.log(`📊 GPS DATA EXPORT: Successfully exported to ${fileName}`);
    Alert.alert(
      "Export Successful",
      `GPS data exported to ${fileName}`,
      [{ text: "OK" }]
    );
  } catch (error) {
    console.error('📊 GPS DATA EXPORT ERROR:', error);
    Alert.alert(
      "Export Failed",
      `Failed to export GPS data: ${error.message}`,
      [{ text: "OK" }]
    );
  }
};

// Add a function to toggle GPS logging
const toggleGpsLogging = () => {
  setIsLoggingGps(prev => {
    const newState = !prev;
    console.log(`📊 GPS LOGGING: ${newState ? 'Started' : 'Stopped'}`);
    
    if (!newState) {
      // If stopping logging, offer to export the data
      Alert.alert(
        "GPS Logging Stopped",
        "Would you like to export the collected GPS data?",
        [
          { 
            text: "Export", 
            onPress: exportGpsLogData 
          },
          { 
            text: "Reset Data",
            style: "destructive",
            onPress: () => {
              setGpsLogData({
                raw: [],
                filtered: [],
                stationary: {
                  raw: [],
                  filtered: []
                },
                walking: {
                  raw: [],
                  filtered: []
                }
              });
              console.log(`📊 GPS LOGGING: Data reset`);
            }
          },
          { 
            text: "Cancel", 
            style: "cancel" 
          }
        ]
      );
    }
    
    return newState;
  });
};

return (
    <SafeAreaView style={[styles.container, { paddingTop: 0 }]}>
      <View style={[styles.topLeftIndicators, { top: insets.top + 10 }]}>
    {gpsAccuracy !== null && <GPSStrengthIndicator accuracy={gpsAccuracy} />}

        <View style={styles.stepIndicator}>
          <Ionicons name="footsteps" size={16} color="#666" />
          <Text style={styles.stepIndicatorText}>{realStepCount}</Text>
        </View>
      </View>

    <MapView 
      ref={mapRef} 
      style={styles.map} 
      initialRegion={initialRegion}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={true}
      rotateEnabled={true}
      minZoomLevel={10}
      maxZoomLevel={20}
      followsUserLocation={false}
        moveOnMarkerPress={false}
        loadingEnabled={true}
      loadingIndicatorColor="#2196F3"
      loadingBackgroundColor="rgba(255,255,255,0.7)"
    >
      {userRole === 'member' ? (
        <>
          {/* Ensure teamGeofence is an array before accessing length */}
          {Array.isArray(teamGeofence) && teamGeofence.length >= 3 && (
            <Polygon 
              coordinates={teamGeofence} 
              fillColor="rgba(0,0,255,0.2)" 
              strokeColor="blue" 
              strokeWidth={2} 
            />
          )}
          {/* Ensure teamGeofence is an array before mapping */}
          {Array.isArray(teamGeofence) && teamGeofence.length >= 2 && teamGeofence.map((point, index) => {
            const nextIndex = (index + 1) % teamGeofence.length;
            const nextPoint = teamGeofence[nextIndex];
            
            if (nextIndex === 0 && teamGeofence.length < 3) return null;
            
            const midPoint = {
              latitude: (point.latitude + nextPoint.latitude) / 2,
              longitude: (point.longitude + nextPoint.longitude) / 2
            };
            
            const distance = calculateDistance(point, nextPoint);
            const distanceText = distance < 1000 
              ? `${Math.round(distance)}m` 
              : `${(distance / 1000).toFixed(2)}km`;
            
            return (
              <React.Fragment key={`distance-${index}`}>
                <Polygon
                  coordinates={[point, nextPoint]}
                  strokeColor="rgba(255, 0, 0, 0.7)"
                  strokeWidth={2}
                  fillColor="transparent"
                />
                <Marker
                  coordinate={midPoint}
                  anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={trackViewChanges}
                    zIndex={500}
                >
                  <View style={styles.distanceMarker}>
                    <Text style={styles.distanceText}>{distanceText}</Text>
                  </View>
                </Marker>
              </React.Fragment>
            );
          })}
        </>
      ) : (
        <>
          {/* Ensure points is an array before mapping */}
          {Array.isArray(points) && points.map((point, index) => (
            <Marker key={index} coordinate={point} title={`Point ${index + 1}`} />
          ))}
          {/* Ensure points is an array before accessing length */}
          {Array.isArray(points) && points.length >= 3 && (
            <Polygon 
              coordinates={points} 
              fillColor="rgba(0,0,255,0.3)" 
              strokeColor="blue" 
              strokeWidth={2} 
            />
          )}
          {/* Ensure points is an array before mapping */}
          {Array.isArray(points) && points.length >= 2 && points.map((point, index) => {
            const nextIndex = (index + 1) % points.length;
            const nextPoint = points[nextIndex];
            
            if (nextIndex === 0 && points.length < 3) return null;
            
            const midPoint = {
              latitude: (point.latitude + nextPoint.latitude) / 2,
              longitude: (point.longitude + nextPoint.longitude) / 2
            };
            
            const distance = calculateDistance(point, nextPoint);
            const distanceText = distance < 1000 
              ? `${Math.round(distance)}m` 
              : `${(distance / 1000).toFixed(2)}km`;
            
            return (
              <React.Fragment key={`distance-${index}`}>
                <Polygon
                  coordinates={[point, nextPoint]}
                  strokeColor="rgba(255, 0, 0, 0.7)"
                  strokeWidth={2}
                  fillColor="transparent"
                />
                <Marker
                  coordinate={midPoint}
                  anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={trackViewChanges}
                    zIndex={500}
                >
                  <View style={styles.distanceMarker}>
                    <Text style={styles.distanceText}>{distanceText}</Text>
                  </View>
                </Marker>
              </React.Fragment>
            );
          })}
        </>
      )}
      {/* Consolidated Current User Marker */}
      {estimatedIconPosition ? (
        <CurrentUserMarker
          coordinate={estimatedIconPosition} // Use estimated position
          // Potentially re-enable tracksViewChanges if needed for smooth updates
          // tracksViewChanges={true} 
        />
      ) : currentLocation ? (
        // Fallback to raw GPS location if estimation isn't ready yet
        <CurrentUserMarker
          coordinate={currentLocation} 
          // tracksViewChanges={isUserMarkerMoving} // This state might be less relevant now
        />
      ) : null /* Render nothing if neither is available */}

      {/* Other Users Markers Loop */}
      {/* Ensure usersLocations is an object before getting entries */}
      {typeof usersLocations === 'object' && usersLocations !== null && Object.entries(usersLocations)
        .filter(([userId, userData]) => {
          const currentUid = auth.currentUser?.uid;
          const currentUserData = currentUid ? usersLocations[currentUid] : null;
          const currentUserTeamCode = currentUserData?.teamCode;

          // Check 1: Basic data validity
          if (!userData || !userData.Latitude || !userData.Longitude) return false;
          // Check 2: Exclude current user
          if (currentUid && userId === currentUid) return false;
          
          // Check 3: Admin visibility logic (keep existing)
          if (userData.role === 'admin' || userData.isAdmin) {
            // Check if current user is also admin
            if (!currentUserData?.isAdmin && currentUserData?.role !== 'admin') {
              return false; // Non-admin cannot see admin markers
            }
          }

          // Check 4: Team visibility - *** ADDED/MODIFIED ***
          if (currentUserTeamCode) { // Only apply team filter if current user has a team code
             if (userData.teamCode !== currentUserTeamCode) {
                // console.log(`Filtering out ${userId} (${userData.teamCode}) - Different team from ${currentUserTeamCode}`);
                return false; // Filter out users from different teams
             } 
          } else {
             // If current user somehow has NO team code, maybe filter everyone else?
             // Or maybe only show admins? For now, let them pass if current user has no team.
             // Depending on requirements, could return false here for non-admins.
          }
          
          // Passed all filters
          return true;
        })
        .map(([userId, userData]) => (
          <CustomMarker
            key={userId} 
            coordinate={{
              latitude: userData.Latitude,
              longitude: userData.Longitude
            }}
            photoURL={userData.photoURL}
            name={formatUserName(userData)}
            labelPosition={'bottom'} // *** Force bottom position for testing ***
            markerColor={getUniqueColor(userId)}
            isOnline={userData.isActive !== false}
          />
        ))
      }
      {/* *** Add the Polyline for the trail *** */}
      {/* Ensure locationHistory is an array before accessing length */}
      {Array.isArray(locationHistory) && locationHistory.length >= 2 && (
        <Polyline
          coordinates={locationHistory.map(point => ({
            latitude: Number(point.latitude),
            longitude: Number(point.longitude)
          }))}
          strokeColor={debugMode ? "#FF0000" : "#FF5722"} // Red in debug mode, orange in normal mode
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
          zIndex={100} // Make sure it's above other elements
        />
      )}
      
      {/* *** Add a marker for each history point for debugging purposes *** */}
      {Array.isArray(locationHistory) && locationHistory.map((point, index) => (
        <Marker
          key={`history-point-${index}`}
          coordinate={{
            latitude: point.latitude,
            longitude: point.longitude
          }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          zIndex={50}
        >
          <View style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#FF5722',
            borderWidth: 1,
            borderColor: 'white',
          }} />
        </Marker>
      ))}
      
      {/* GPS Data Logging Buttons */}
      <TouchableOpacity 
        style={{
          position: 'absolute',
          top: insets.top + 120,
          left: 20,
          backgroundColor: isLoggingGps ? '#ff6347' : '#4682b4',
          borderRadius: 30,
          paddingVertical: 10,
          paddingHorizontal: 15,
          flexDirection: 'row',
          alignItems: 'center',
          elevation: 5,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 3,
        }}
        onPress={toggleGpsLogging}
      >
        <MaterialIcons 
          name={isLoggingGps ? "stop-circle" : "data-usage"} 
          size={24} 
          color="white" 
        />
        <Text style={{ color: 'white', marginLeft: 5, fontWeight: 'bold' }}>
          {isLoggingGps ? "Stop Logging" : "Start GPS Log"}
        </Text>
      </TouchableOpacity>
      
      {(isLoggingGps || gpsLogData.raw.length > 0) && (
        <TouchableOpacity 
          style={{
            position: 'absolute',
            top: insets.top + 180,
            left: 20,
            backgroundColor: '#32cd32',
            borderRadius: 30,
            paddingVertical: 10,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            elevation: 5,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 3,
          }}
          onPress={exportGpsLogData}
        >
          <MaterialIcons name="save-alt" size={24} color="white" />
          <Text style={{ color: 'white', marginLeft: 5, fontWeight: 'bold' }}>
            Export GPS Data
          </Text>
        </TouchableOpacity>
      )}
      
      {/* Logging status indicator */}
      {isLoggingGps && (
        <View style={{
          position: 'absolute',
          top: insets.top + 60,
          left: 10,
          right: 10,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          borderRadius: 10,
          padding: 8,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>
            Recording GPS Data: {gpsLogData.raw.length} points
          </Text>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>
            {isUserMoving ? '🚶 Walking' : '🧍 Stationary'}
          </Text>
        </View>
      )}
      
      {/* Debug Button - Only visible during development */}
      <TouchableOpacity
        style={{
          position: 'absolute',
          bottom: 250,
          right: 20,
          backgroundColor: 'rgba(0,0,0,0.7)',
          borderRadius: 30,
          padding: 10,
          elevation: 5,
        }}
        onPress={() => {
          console.log(`🧪 DEBUG: LocationHistory has ${locationHistory.length} points`);
          if (locationHistory.length > 0) {
            console.log(`🧪 First Point: Lat=${locationHistory[0].latitude.toFixed(8)}, Lon=${locationHistory[0].longitude.toFixed(8)}`);
            console.log(`🧪 Last Point: Lat=${locationHistory[locationHistory.length-1].latitude.toFixed(8)}, Lon=${locationHistory[locationHistory.length-1].longitude.toFixed(8)}`);
          }
          
          // Show alert with locationHistory info
          Alert.alert(
            "LocationHistory Debug",
            `Points: ${locationHistory.length}\n` +
            (locationHistory.length > 0 ? 
              `First: ${locationHistory[0].latitude.toFixed(8)}, ${locationHistory[0].longitude.toFixed(8)}\n` +
              `Last: ${locationHistory[locationHistory.length-1].latitude.toFixed(8)}, ${locationHistory[locationHistory.length-1].longitude.toFixed(8)}` : 
              "No points yet")
          );
        }}
      >
        <Text style={{ color: 'white', fontWeight: 'bold' }}>INFO</Text>
      </TouchableOpacity>
      
      {/* Debug Mode Toggle Button */}
      <TouchableOpacity
        style={{
          position: 'absolute',
          bottom: 250,
          right: 80, // Position to the left of the INFO button
          backgroundColor: debugMode ? 'rgba(255,0,0,0.7)' : 'rgba(0,0,0,0.7)',
          borderRadius: 30,
          padding: 10,
          elevation: 5,
        }}
        onPress={() => {
          const newDebugMode = !debugMode;
          setDebugMode(newDebugMode);
          console.log(`🐞 DEBUG MODE: ${newDebugMode ? 'ON' : 'OFF'}`);
          
          // Show alert
          Alert.alert(
            "Debug Mode",
            `Debug Mode is now ${newDebugMode ? 'ON' : 'OFF'}\n` +
            (newDebugMode ? 
              "All location updates will be added to history regardless of movement." : 
              "Normal filtering applied.")
          );
        }}
      >
        <Text style={{ color: 'white', fontWeight: 'bold' }}>
          {debugMode ? 'DEBUG ON' : 'DEBUG OFF'}
        </Text>
      </TouchableOpacity>
    </MapView>

    <View style={styles.toolbarContainer}>
      {userRole !== 'member' ? (
        <>
          <View style={styles.pointsIndicator}>
            <Text style={styles.pointsText}>Number of Geofenced Points: {points.length}</Text>
          </View>

          <View style={styles.buttonContainer}>
              <TouchableOpacity 
                style={[
                  styles.button,
                  styles.buttonSecondary, 
                  (isFetchingLocation || isRemovingLocation) && styles.disabledButton,
                  currentLocation && styles.buttonActive
                ]}
                onPress={async () => {
                  if (isFetchingLocation || isRemovingLocation) return; // Prevent double-clicks
                  
                  if (currentLocation) {
                    setIsRemovingLocation(true);
                    // Force location removal immediately
                    const db = getDatabase();
                    const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser?.uid}`);
                    
                    // Clean up location subscription right away
                    if (locationSubscriptionRef.current) {
                      try {
                        locationSubscriptionRef.current.remove();
                      } catch (e) {
                        console.error("Error removing location subscription:", e);
                      }
                      locationSubscriptionRef.current = null;
                    }
                    
                    // Clear state immediately 
                    setCurrentLocation(null);
                    setGpsAccuracy(null);
                    setLocationHistory([]);
                    setEstimatedIconPosition(null);
                    
                    // Then update Firebase in background
                    if (auth.currentUser?.uid) {
                      update(userLocationRef, { 
                        isActive: false,
                        lastSeen: new Date().toISOString(),
                      }).catch(err => console.error("Error updating location status:", err))
                      .finally(() => {
                        setIsRemovingLocation(false);
                      });
                    } else {
                      setIsRemovingLocation(false);
                    }
                  } else {
                    // Start progress indicator immediately for better UX
                    setIsFetchingLocation(true);
                    setTimeout(() => toggleCurrentLocation(), 0); // Run in next tick
                  }
                }}
                disabled={isFetchingLocation || isRemovingLocation}
              >
                {/* *** Add Wrapper View *** */}
                <View style={styles.buttonContentWrapper}>
                  {isFetchingLocation || isRemovingLocation ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons 
                        name={currentLocation ? "close-circle" : "navigate"} 
                        size={20} 
                        color="white" 
                      />
                    </>
                  )}
                  <Text style={styles.buttonText}> {/* Moved Text inside Wrapper */}
                    {isFetchingLocation ? "Loading..." : 
                     isRemovingLocation ? "Removing..." :
                     currentLocation ? "Remove Location" : "My Location"}
                  </Text>
                </View> 
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.buttonCenter]} 
              onPress={() => {
                // *** New logic: Focus on currentLocation ***
                if (currentLocation && mapRef.current) {
                  mapRef.current.animateToRegion(
                    {
                      latitude: currentLocation.latitude,
                      longitude: currentLocation.longitude,
                      latitudeDelta: 0.01, // Adjust zoom level as needed
                      longitudeDelta: 0.01,
                    },
                    1000 // Animation duration in ms
                  );
                } else {
                  Alert.alert("Location Unavailable", "Your current location isn't available yet.");
                }
              }}
            >
              <Ionicons name="locate-outline" size={20} color="white" /> {/* Changed icon */} 
              <Text style={styles.buttonText}>Center on Me</Text> {/* Changed text */} 
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={[styles.button, styles.resetButton]}
            onPress={() => {
              if (!auth.currentUser) return;
              
              get(ref(db, `users/${auth.currentUser.uid}/profile`))
                .then((snapshot) => {
                  if (snapshot.exists()) {
                    const userData = snapshot.val();
                    
                    if (userData.role === 'owner' && userData.teamCode) {
                      get(ref(db, `teams/${userData.teamCode}/geofence/coordinates`))
                        .then((geofenceSnapshot) => {
                          const hasGeofence = geofenceSnapshot.exists() && 
                                             Array.isArray(geofenceSnapshot.val()) && 
                                             geofenceSnapshot.val().length >= 3;
                          
                          if (hasGeofence) {
                            Alert.alert(
                              'Request Geofence Reset',
                              'Are you sure you want to request a reset of the existing geofence area? This will require admin approval.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { 
                                  text: 'Request Reset', 
                                  style: 'destructive',
                                  onPress: () => {
                                    const resetRequestRef = ref(db, `adminRequests/geofenceReset/${userData.teamCode}`);
                                    const currentPoints = geofenceSnapshot.val();
                                    
                                    set(resetRequestRef, {
                                      teamCode: userData.teamCode,
                                      ownerId: auth.currentUser.uid,
                                      ownerName: userData.firstName && userData.lastName ? 
                                        `${userData.firstName} ${userData.lastName}` : auth.currentUser.email,
                                      requestDate: new Date().toISOString(),
                                      status: 'pending',
                                      currentPoints: currentPoints,
                                      teamName: userData.teamName || userData.teamCode
                                    })
                                      .then(() => {
                                        console.log("Reset request created successfully");
                                        Alert.alert(
                                          'Reset Request Submitted',
                                          'Your geofence reset request has been submitted for admin approval. You will be notified when it is processed.'
                                        );
                                      })
                                      .catch((error) => {
                                        console.error("Error creating reset request:", error);
                                        Alert.alert('Error', 'Failed to submit reset request.');
                                      });
                                  }
                                }
                              ]
                            );
                          } else {
                            Alert.alert(
                              'Set Geofence Area',
                              'You need to set up location boundaries for your team. Would you like to do this now?',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { 
                                  text: 'Set Up Now', 
                                  onPress: () => {
                                    navigation.navigate('OwnerInitialization', { teamCode: userData.teamCode });
                                  }
                                }
                              ]
                            );
                          }
                        })
                        .catch(error => {
                          console.error("Error checking geofence data:", error);
                          Alert.alert('Error', 'Failed to check geofence status.');
                        });
                    } else {
                      Alert.alert('Error', 'Only team owners can manage geofence areas.');
                    }
                  }
                })
                .catch((error) => {
                  console.error("Error getting user profile:", error);
                  Alert.alert('Error', 'Failed to access user profile.');
                });
            }}
          >
            <Ionicons name={points.length >= 3 ? "refresh-circle" : "locate"} size={24} color="white" />
            <Text style={styles.buttonText}>
              {points.length >= 3 ? "Request Geofence Reset" : "Set Geofence Area"}
            </Text>
          </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.stepTrackerButton]}
              onPress={() => navigation.navigate('StepTracker')}
            >
              <Ionicons name="footsteps" size={24} color="white" />
              <Text style={styles.buttonText}>
                Step Tracker
              </Text>
            </TouchableOpacity>
            
            {/* Add Reset Button for Testing */}
            <TouchableOpacity 
              style={[styles.button, styles.resetTestingButton]}
              onPress={resetStepsAndLocationData}
            >
              <Ionicons name="refresh-circle" size={24} color="white" />
              <Text style={styles.buttonText}>
                Reset Testing Data
              </Text>
            </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.memberMessage}>
            <Text style={styles.memberText}>Member View - Location tracking active</Text>
          </View>
          <TouchableOpacity 
            style={[styles.button, styles.buttonCenter, styles.memberCenterButton]} 
            onPress={() => {
                // *** New logic: Focus on currentLocation ***
                if (currentLocation && mapRef.current) {
                  mapRef.current.animateToRegion(
                    {
                      latitude: currentLocation.latitude,
                      longitude: currentLocation.longitude,
                      latitudeDelta: 0.01, // Adjust zoom level as needed
                      longitudeDelta: 0.01,
                    },
                    1000 // Animation duration in ms
                  );
                } else {
                  Alert.alert("Location Unavailable", "Your current location isn't available yet.");
                }
            }}
          >
            <Ionicons name="locate-outline" size={20} color="white" /> {/* Changed icon */} 
            <Text style={styles.buttonText}>Center on Me</Text> {/* Changed text */} 
          </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.button, styles.stepTrackerButton, styles.memberCenterButton]}
              onPress={() => navigation.navigate('StepTracker')}
            >
              <Ionicons name="footsteps" size={20} color="white" />
              <Text style={styles.buttonText}>Step Tracker</Text>
            </TouchableOpacity>
            
            {/* Add Reset Button for Testing - Member View */}
            <TouchableOpacity 
              style={[styles.button, styles.resetTestingButton, styles.memberCenterButton]}
              onPress={resetStepsAndLocationData}
            >
              <Ionicons name="refresh-circle" size={20} color="white" />
              <Text style={styles.buttonText}>Reset Testing Data</Text>
            </TouchableOpacity>
        </>
      )}
    </View>

    <Navbar activePage="maps" />
    </SafeAreaView>
);
} 
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  map: {
    flex: 1,
  },
  toolbarContainer: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 15,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  inputWrapper: {
    marginBottom: 10,
  },
  input: {
    backgroundColor: "#F1F3F4",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10,
    color: "#1A1A1A",
    fontWeight: "500",
    fontSize: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: "#2196F3",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonSecondary: {
    backgroundColor: "#4CAF50",
  },
  buttonReset: {
    backgroundColor: "#2196F3",
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 16,
  },
  logoutButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: '#FF3B30',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -12 }, { translateY: -12 }],
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  crosshairText: {
    fontSize: 24,
    color: '#2196F3',
    fontWeight: '600',
  },
  pointsIndicator: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
    alignSelf: 'center',
  },
  pointsText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '600',
  },
  gpsIndicator: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  gpsBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 12,
  },
  gpsBar: {
    width: 3,
    borderRadius: 1.5,
  },
  gpsAccuracy: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  gpsNoSignal: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  markerContainer: {
    alignItems: 'center', // Center items horizontally within the column
    // justifyContent: 'center', // Usually not needed for column layout unless height is fixed
    flexDirection: 'column', // *** Explicitly set vertical stacking ***
    flexShrink: 1, 
  },
  markerImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: 'white',
  },
  markerFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
  },
  markerInitial: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  markerLabelContainer: {
    // Keep styles from last attempt (no alignSelf, minWidth)
    marginTop: 4, 
    paddingHorizontal: 10, 
    paddingVertical: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12, 
    borderWidth: 1,
    borderColor: '#E0E0E0',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
    minWidth: 60, 
  },
  markerLabel: {
    color: '#333333',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center', 
  },
  memberMessage: {
    padding: 15,
    alignItems: 'center',
  },
  memberText: {
    color: '#2196F3',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonCenter: {
    backgroundColor: "#2196F3",
  },
  memberCenterButton: {
    marginTop: 10,
    width: '100%',
  },
  resetButton: {
    backgroundColor: "#FF5722",
    marginTop: 10,
    width: '100%',
  },
  currentUserMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentUserMarker: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'white',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  currentUserLabelContainer: {
    backgroundColor: 'rgba(0, 122, 255, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  currentUserLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  distanceMarker: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 0, 0.7)',
  },
  distanceText: {
    color: '#333',
    fontSize: 11,
    fontWeight: 'bold',
  },
  stepTrackerButton: {
    backgroundColor: "#8E44AD",
    marginTop: 10,
    width: '100%',
  },
  topLeftIndicators: {
    position: 'absolute',
    left: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 10,
  },
  stepIndicator: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  stepIndicatorText: {
    fontSize: 14,
    color: '#E91E63',
    fontWeight: 'bold',
  },
  disabledButton: {
    backgroundColor: '#A5D6A7',
    opacity: 0.7,
  },
  buttonContentWrapper: { // *** Style for the new wrapper ***
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center', // Center content within the button space
    gap: 8, // Add space between icon and text
  },
  buttonActive: {
    backgroundColor: '#4CAF50',
    opacity: 0.7,
  },
  resetTestingButton: {
    backgroundColor: "#FF5722", // Orange color to indicate a testing/dev feature
    marginTop: 10,
    width: '100%',
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'white',
  },
  floatingButton: {
    position: 'absolute',
    right: 20,
    height: 50,
    paddingHorizontal: 15,
    borderRadius: 25,
    backgroundColor: '#4682b4',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    zIndex: 999,
  },
  buttonText: {
    color: 'white',
    marginLeft: 5,
    fontWeight: 'bold',
  },
});

// Add this new function to get location early
const requestInitialLocation = async () => {
  try {
    // Check if we already have permission
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
      if (newStatus !== 'granted') return;
    }
    
    // Get a fast, possibly cached location
    const fastLocation = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Low,
      maximumAge: 30000 // Accept a cached position up to 30 seconds old
    });
    
    if (fastLocation && fastLocation.coords) {
      console.log("Got initial fast location");
      const { latitude, longitude } = fastLocation.coords;
      setCurrentLocation({ latitude, longitude });
      setGpsAccuracy(fastLocation.coords.accuracy);
      
      // Set initial map region
      setInitialRegion({
        latitude,
        longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      });
      
      // Then get more accurate location in background
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      }).then(location => {
        setCurrentLocation({ 
          latitude: location.coords.latitude, 
          longitude: location.coords.longitude 
        });
        setGpsAccuracy(location.coords.accuracy);
      }).catch(err => {
        console.warn("Failed to get high accuracy location:", err);
      });
    }
  } catch (error) {
    console.warn("Error getting initial location:", error);
  }
};

