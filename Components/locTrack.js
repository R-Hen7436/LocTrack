import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

/**
 * Optimized Kalman filter for 2D location data with battery efficiency
 * Based on the algorithm described in "Kalman Filter For Beginners" with performance optimizations
 */
class OptimizedKalmanFilter {
  /**
   * Create a Kalman filter for 2D location tracking with dynamic adjustment
   * @param {number} processNoise - How much we expect the process to change randomly between updates (Q)
   * @param {number} initialMeasurementNoise - Default inaccuracy expectation (R), dynamically updated
   */
  constructor(processNoise = 0.01, initialMeasurementNoise = 15) { // Increased initialMeasurementNoise from 10 to 15
    // State vector [x, y, vx, vy]
    this.state = null;
    
    // Covariance matrix 4x4
    this.covariance = null;
    
    // Process noise (Q) - dynamically adjusted based on movement patterns
    this.baseProcessNoise = processNoise;
    this.processNoise = processNoise;
    
    // Measurement noise (R) - Initial value, updated dynamically
    this.measurementNoise = initialMeasurementNoise; // Use the adjusted initial value
    
    // Precomputed transition matrix (F) - constant velocity model
    this.transitionMatrix = [
      [1, 0, 1, 0], // x = x + vx * dt (dt=1)
      [0, 1, 0, 1], // y = y + vy * dt (dt=1)
      [0, 0, 1, 0], // vx = vx
      [0, 0, 0, 1]  // vy = vy
    ];
    
    // Precomputed observation matrix (H) - we only observe x and y
    this.observationMatrix = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];
    
    // Precomputed identity matrix 4x4
    this.identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1]
    ];
    
    // Movement history to adapt process noise dynamically
    this.movementHistory = [];
    this.maxHistoryLength = 10;
    
    // Store the last filtered position for noise filtering
    this.lastFilteredPosition = null;
    this.lastRawPosition = null;
    
    // Minimum movement threshold (optimized to reduce processing on small movements)
    this.minMovementThreshold = 0.0000001; // Keep this small for detection
    
    // Battery-saving mode flags
    this.lowBatteryMode = false;
    this.staticPeriodCounter = 0;
    this.staticThreshold = 8; // Increased from 5 to 8 for more confidence in static state
    
    // Processing optimization - cache frequently used calculations
    this.predictionCache = null;
    this.lastProcessNoiseAdjustment = Date.now();
  }
  
  /**
   * Enable or disable low battery mode
   * @param {boolean} enabled - Whether low battery mode is enabled
   */
  setLowBatteryMode(enabled) {
    this.lowBatteryMode = enabled;
    // Adjust process noise for more aggressive filtering in low battery mode
    this.processNoise = enabled ? this.baseProcessNoise * 0.5 : this.baseProcessNoise;
  }
  
  /**
   * Calculate distance between two points in lat/lon degrees (optimized approximation)
   */
  calculateDistanceApprox(pos1, pos2) {
    if (!pos1 || !pos2) return 0;
    // Use squared distance to avoid expensive sqrt operations when possible
    const latDiff = pos1.latitude - pos2.latitude;
    const lonDiff = pos1.longitude - pos2.longitude;
    return latDiff * latDiff + lonDiff * lonDiff;
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
    this.lastRawPosition = { latitude: x, longitude: y };
  }
  
  /**
   * Update the filter with a new GPS measurement
   * @param {number} x - Latitude
   * @param {number} y - Longitude
   * @param {number} accuracy - GPS accuracy in meters
   * @param {number} batteryLevel - Battery level percentage (0-100)
   * @param {boolean} [isFirstUpdateAfterLock=false] - Flag for the first update after lock break
   * @returns {Object} Filtered position
   */
  update(x, y, accuracy, batteryLevel = 100, isFirstUpdateAfterLock = false) { // *** Added isFirstUpdateAfterLock parameter ***
    console.log(`KF Update Start: Raw(lat=${x.toFixed(6)}, lon=${y.toFixed(6)}), Acc=${accuracy?.toFixed(1)}, FirstAfterLock=${isFirstUpdateAfterLock}`); // Log Input
    // Automatically adjust to low battery mode if battery level is below 20%
    if (batteryLevel < 20 && !this.lowBatteryMode) {
      this.setLowBatteryMode(true);
    } else if (batteryLevel >= 20 && this.lowBatteryMode) {
      this.setLowBatteryMode(false);
    }
    
    if (!this.state) {
      this.init(x, y);
      return { latitude: x, longitude: y };
    }
    
    // Store current raw position
    const currentRawPosition = { latitude: x, longitude: y };
    
    // Adaptive measurement noise based on accuracy - MORE AGGRESSIVE
    let currentMeasurementNoise = this.measurementNoise; // Start with base
    if (accuracy && !isNaN(accuracy) && accuracy > 0) {
      // Be much more aggressive if accuracy is poor
      if (accuracy > 50) { 
        currentMeasurementNoise = accuracy * 8; // ** Increased from 5 ** Heavily distrust very inaccurate points
        console.log(`KF Update: High Accuracy Error (>50m), Using VERY HIGH MeasurementNoise: ${currentMeasurementNoise.toFixed(1)}`);
      } else if (accuracy > 20) {
         currentMeasurementNoise = accuracy * 4; // ** Increased from 2 ** Moderately distrust inaccurate points
         console.log(`KF Update: Moderate Accuracy Error (>20m), Using HIGH MeasurementNoise: ${currentMeasurementNoise.toFixed(1)}`);
      } else { // Accuracy <= 20m (Good)
        currentMeasurementNoise = Math.max(1.0, accuracy * 0.9); // Slightly increased factor, still trust good points mostly
        console.log(`KF Update: Good Accuracy (<=20m), Using MeasurementNoise: ${currentMeasurementNoise.toFixed(1)}`);
      }
    } else {
       console.log(`KF Update: No valid accuracy, using base MeasurementNoise: ${currentMeasurementNoise.toFixed(1)}`);
    }
    
    // *** Smooth Transition: Temporarily increase noise on first update after lock break ***
    if (isFirstUpdateAfterLock) {
      const noiseFactor = 2.5; // Increase noise 2.5x temporarily
      currentMeasurementNoise *= noiseFactor;
      console.log(`KF Update: SMOOTH TRANSITION active. Temp MeasurementNoise = ${currentMeasurementNoise.toFixed(1)} (Factor: ${noiseFactor})`);
    }
    
    // Check if the device is static to save processing
    const distance = this.calculateDistanceApprox(currentRawPosition, this.lastRawPosition);
    console.log(`KF Update: Dist from last raw=${distance.toExponential(2)}, StaticCounter=${this.staticPeriodCounter}`); // Log distance
    this.lastRawPosition = currentRawPosition;
    
    // Add to movement history for adaptive processing
    this.movementHistory.push(distance);
    if (this.movementHistory.length > this.maxHistoryLength) {
      this.movementHistory.shift();
    }
    
    // If static and in low battery mode OR confidently static, skip full filtering
    if (distance < this.minMovementThreshold) {
      this.staticPeriodCounter++;
      // If static threshold is met (regardless of battery), return last known good position
      if (this.staticPeriodCounter > this.staticThreshold) { 
        console.log(`KF Update: STATIC LOCK (${this.staticPeriodCounter} > ${this.staticThreshold}), returning last filtered pos.`);
        // DO NOT reset counter here - stay locked until genuine movement
      return this.lastFilteredPosition;
    }
      // If low battery mode is active AND counter is high (but below strict threshold), also return last position
      if (this.lowBatteryMode && this.staticPeriodCounter > this.staticThreshold / 2) { 
         console.log(`KF Low battery static (${this.staticPeriodCounter} counts), returning last position.`);
        return this.lastFilteredPosition;
      }
    } else {
      // Reset counter only if movement exceeds threshold
      if (this.staticPeriodCounter > 0) {
         console.log(`KF Movement detected, resetting static counter from ${this.staticPeriodCounter}`);
      }
      this.staticPeriodCounter = 0;
      
      // Dynamically adjust process noise based on movement patterns (every 30 seconds)
      const now = Date.now();
      if (now - this.lastProcessNoiseAdjustment > 15000) { // Check more frequently (15s)
        this.adaptProcessNoise();
        this.lastProcessNoiseAdjustment = now;
      }
    }
    
    // Full Kalman filter processing for non-static situations
    
    // PREDICT step (optimize computations for battery savings)
    const predictedState = this.matrixMultiply(this.transitionMatrix, this.state);
    
    // Only do full covariance prediction if we've moved significantly
    let predictedCovariance;
    if (this.lowBatteryMode && this.predictionCache && distance < this.minMovementThreshold) {
      predictedCovariance = this.predictionCache;
    } else {
      predictedCovariance = this.matrixMultiply(
      this.transitionMatrix,
      this.matrixMultiply(this.covariance, this.transpose(this.transitionMatrix))
    );
      
    for (let i = 0; i < 4; i++) {
      predictedCovariance[i][i] += this.processNoise;
    }
    
      // Cache this result for low battery mode
      if (this.lowBatteryMode) {
        this.predictionCache = predictedCovariance;
      }
    }
    
    // UPDATE step
    const observationTranspose = this.transpose(this.observationMatrix);
    const hph = this.matrixMultiply(
      this.observationMatrix,
      this.matrixMultiply(predictedCovariance, observationTranspose)
    );
    
    for (let i = 0; i < 2; i++) {
      hph[i][i] += currentMeasurementNoise;
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

  /**
   * Dynamically adapt process noise based on movement patterns
   * This helps filter more aggressively during periods of consistent movement
   * and be more responsive during erratic movement
   */
  adaptProcessNoise() {
    if (this.movementHistory.length < 5) return; // Require a bit more history
    
    // Calculate variance of movement
    const mean = this.movementHistory.reduce((sum, val) => sum + val, 0) / this.movementHistory.length;
    const variance = this.movementHistory.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.movementHistory.length;
    
    // Scale variance relative to mean movement to better handle slow vs fast erratic movement
    const meanMovementThreshold = 0.000001; // Make threshold even smaller for static detection
    let normalizedVariance = 0;

    // *** Force low process noise if mean movement is extremely small ***
    if (mean < meanMovementThreshold) {
        console.log(`KF adaptProcessNoise: Mean movement very low (${mean.toExponential(1)}), forcing minimal process noise.`);
        this.processNoise = this.baseProcessNoise * 0.05; // Set to very small value
    } else { 
        // Original logic for calculating variance
        if (mean > meanMovementThreshold * 10) { // Use a slightly higher threshold for relative variance calculation
            normalizedVariance = Math.min(1, variance / (mean * mean)); 
        } else {
            normalizedVariance = Math.min(1, variance * 100000); // Slightly increased scaling for low absolute variance
        }

        const movementFactor = Math.min(1, mean / (meanMovementThreshold * 50)); // Make factor scale up a bit faster
    
    if (this.lowBatteryMode) {
          this.processNoise = this.baseProcessNoise * (0.15 + 0.35 * normalizedVariance * movementFactor); // Slightly lower base
    } else {
          this.processNoise = this.baseProcessNoise * (0.3 + 0.7 * normalizedVariance * movementFactor); // Slightly lower base
    }
    }
     console.log(`KF adaptProcessNoise: Mean=${mean.toExponential(2)}, Var=${variance.toExponential(2)}, NormVar=${normalizedVariance.toFixed(3)}, NewProcessNoise=${this.processNoise.toExponential(2)}`);
  }

  // Keep existing matrix helper methods...
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

  /**
   * *** NEW: Method to reset velocity components of the state ***
   */
  resetVelocity() {
    if (this.state) {
      this.state[2][0] = 0; // Reset vx
      this.state[3][0] = 0; // Reset vy
      console.log('KF Velocity Reset');
    }
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

const CustomMarker = ({ coordinate, photoURL, name, labelPosition = 'bottom', markerColor, isOnline = true, isOutsideGeofence = false }) => { // Add isOutsideGeofence prop
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
  
  // *** NEW: Style for being outside geofence ***
  const outsideGeofenceStyle = isOutsideGeofence === true ? {
      borderColor: '#FF3B30', // Red border
      borderWidth: 4, // Make it thicker
  } : {};
  
  const markerContent = React.useMemo(() => (
    <View style={styles.markerContainer}>
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={[
            styles.markerImage, 
            markerColor && { borderColor: markerColor },
            offlineStyle,
            outsideGeofenceStyle // Apply outside style
          ]}
        />
      ) : (
        <View style={[
          styles.markerFallback, 
          markerColor && { backgroundColor: markerColor },
          offlineStyle,
          outsideGeofenceStyle // Apply outside style
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
        ]}>
          <Text style={[
            styles.markerLabel, 
            { color: markerColor ? '#FFFFFF' : '#333333', fontWeight: '700' }
          ]}>
            {name} {!isOnline && <Text style={{fontStyle: 'italic', fontSize: 10}}>(last known)</Text>}
          </Text>
        </View>
      )}
    </View>
  ), [photoURL, name, nameInitial, labelPosition, markerColor, isOnline, isOutsideGeofence, offlineStyle, labelPositionStyle, outsideGeofenceStyle]); // Add dependencies
  
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

// Constants for location tracking
const MAX_HISTORY_POINTS = 200; // Increased from 50 to 200
const RAW_HISTORY_POINTS = 300; // Even larger for raw history
const MIN_DISTANCE_THRESHOLD = 1.5; // ** Reduced from 3.5m ** to 1.5m for finer detail in small areas
const AVERAGE_STEP_LENGTH_METERS = 0.762;
const STEPS_PER_TRAIL_POINT = 3; // Add a trail point every 3 steps
const METERS_TO_DEGREE_LAT = 111111; // Approx meters in 1 degree latitude
const METERS_TO_DEGREE_LON = 111111; // Add equivalent for longitude (will be adjusted based on latitude)
const MIN_GPS_DISTANCE_FOR_DIRECTION = 1; // Reduced from 1.0 to 0.1 meters

// Static lock parameters
const STATIC_TIME_LOCK_MS = 5000; // 5 second timer before considering new movement
const SIGNIFICANT_MOVEMENT_THRESHOLD = 3.0; // Increased to 3 meters (Used for INITIAL lock activation / deciding if movement occurred when NOT locked)
const STATIC_LOCK_BREAK_DISTANCE_THRESHOLD = 5.0; // *** NEW: Higher threshold (5m) to break an EXISTING lock based on distance ONLY ***

// Jump threshold
const UNREALISTIC_JUMP_THRESHOLD_METERS = 20; // Reduced from 50m to 10m for testing in small areas

// Add this function at the top of the file, right after the imports
// Safely get the user role with a default value
function safeGetUserRole(userRole) {
  return userRole || 'member';
}

// Near the top of the file, after imports but before the App component
// Create a user role context to prevent reference errors
const UserRoleContext = React.createContext({ 
  userRole: 'member', 
  setUserRole: () => {}
});

// Create a hook to safely access userRole
function useUserRole() {
  return React.useContext(UserRoleContext);
}

// Create a provider component
function UserRoleProvider({ children }) {
  const [userRoleState, setUserRoleState] = useState('member');
  
  // Create a memoized value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    userRole: userRoleState,
    setUserRole: setUserRoleState
  }), [userRoleState]);
  
  return (
    <UserRoleContext.Provider value={value}>
      {children}
    </UserRoleContext.Provider>
  );
}

// Modify the App component to use the UserRoleProvider
export default function App() {
  return (
    <UserRoleProvider>
      <AppContent />
    </UserRoleProvider>
  );
}

// Then create the main content component
function AppContent() {
  // *** PERFORMANCE OPTIMIZATION FIXES ***
  // The following optimizations have been implemented to prevent infinite re-renders:
  // 1. Removed usersLocations from the handleMapRegionChange useEffect dependencies
  // 2. Optimized marker position calculation to prevent unnecessary state updates
  // 3. Added memoization for team members filtering with useMemo
  // 4. Added useCallback for fitAllMarkers with proper dependencies
  // 5. Added debouncing to fitAllMarkers to prevent frequent map updates
  // 6. Added null checks and error handling to prevent crashes
  // 7. Added proper dependency arrays to all useEffect hooks
  // 8. Used functional state updates where appropriate to prevent stale state

  // Access userRole from context
  const { userRole, setUserRole } = useUserRole();
  
  // Make sure we initialize teamGeofence to prevent "doesn't exist" errors
  
  // Rest of your component remains the same
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
const [teamGeofence, setTeamGeofence] = useState([]);
  const [teamGeofenceData, setTeamGeofenceData] = useState({});
const [gpsAccuracy, setGpsAccuracy] = useState(null);
const [usersLocations, setUsersLocations] = useState({});
  
  // ... existing code ...

const [shouldAutoFit, setShouldAutoFit] = useState(true);
const [markerPositions, setMarkerPositions] = useState({});
const [trackViewChanges, setTrackViewChanges] = useState(false);
  const [realStepCount, setRealStepCount] = useState(0);
  const insets = useSafeAreaInsets();
  // Add new state here
  const [userGeofenceStatuses, setUserGeofenceStatuses] = useState({});

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
  const [isPositionLocked, setIsPositionLocked] = useState(false); // *** NEW: Is position currently locked
  const prevIsPositionLockedRef = useRef(isPositionLocked); // *** NEW: Ref for previous lock state ***
  const lastStepCountRef = useRef(0); // Track last step count for comparison
  const lastLockTimeRef = useRef(0); // Track when we last locked position
  const stepsAtLockTimeRef = useRef(0); // Steps when we last locked
  const hasMovedSinceLastLockRef = useRef(false); // If genuine movement detected since lock
  const wasMovingRef = useRef(false); // *** NEW: Ref to track if previous state was moving ***
  const hasLockedOnceRef = useRef(false); // *** NEW: Ref to track if lock has engaged at least once ***

  // Keep refs synced with state
  useEffect(() => { stepCountRef.current = stepCount; }, [stepCount]);
  useEffect(() => { stepsSinceLastGpsUpdateRef.current = stepsSinceLastGpsUpdate; }, [stepsSinceLastGpsUpdate]); // *** Reinstate useEffect ***
  // No longer need stepsSinceLastGpsUpdateRef here

  // *** NEW: useEffect to update the previous lock state ref ***
  useEffect(() => {
    prevIsPositionLockedRef.current = isPositionLocked;
  }, [isPositionLocked]);

  // Make sure the locationHistory state is correctly initialized at the top of your component
  const [locationHistory, setLocationHistory] = useState([]); // Initialize as empty array
  const [rawLocationHistory, setRawLocationHistory] = useState([]); // State for raw history

  // Add at the top with other state variables
  const [isRemovingLocation, setIsRemovingLocation] = useState(false);

  // Add this state variable at the top of your component (in the App function)
  const [debugMode, setDebugMode] = useState(false);

  // Add this code where other state declarations are (near the top of the App function)
  const teamMembers = useMemo(() => {
    const auth = getAuth();
    if (!usersLocations || !auth?.currentUser?.uid) return [];
    
    const currentUid = auth.currentUser.uid;
    const currentUserData = usersLocations[currentUid];
    const currentUserTeamCode = currentUserData?.teamCode;
    
    return Object.entries(usersLocations)
      .filter(([userId, userData]) => {
        // Check 1: Basic data validity
        if (!userData || !userData.Latitude || !userData.Longitude) {
          return false;
        }
        // Check 2: Exclude current user
        if (userId === currentUid) return false;
        
        // Check 3: Admin visibility logic
        if (userData.role === 'admin' || userData.isAdmin) {
          if (!currentUserData?.isAdmin && currentUserData?.role !== 'admin') {
            return false; // Non-admin cannot see admin markers
          }
        }

        // Check 4: Team visibility
        if (currentUserTeamCode) {
          const userTeamCode = userData.teamCode;
          if (userTeamCode !== currentUserTeamCode) {
            return false; // Filter out users from different teams
          }
        }
        
        return true;
      });
  }, [usersLocations]); // Remove auth.currentUser?.uid dependency

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

const loadUserRole = async () => {
  try {
    if (!auth.currentUser) return;
    
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const snapshot = await get(userProfileRef);
    
    if (snapshot.exists()) {
      const profileData = snapshot.val();
      
      // Store the role properly
      if (profileData.role) {
        // Use the context-based setUserRole
        setUserRole(profileData.role);
        
        // Save to storage for fast loading next time
        try {
          await AsyncStorage.setItem('userRole', profileData.role);
          console.log('UserRole saved to storage:', profileData.role);
        } catch (storageError) {
          console.error('Error saving user role to storage:', storageError);
        }
      }
    }
  } catch (error) {
    console.error('Error loading user role:', error);
  }
};

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
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;

      const cachedGeofenceData = await AsyncStorage.getItem('teamGeofenceData');
      const cachedTimestamp = await AsyncStorage.getItem('teamGeofenceTimestamp');
      const currentTime = Date.now();
      
      // Use cached data if available and less than 15 minutes old
      if (cachedGeofenceData && cachedTimestamp) {
        const parsedTimestamp = parseInt(cachedTimestamp);
        if (currentTime - parsedTimestamp < 15 * 60 * 1000) {
          console.log('Using cached geofence data');
          const parsedGeofenceData = JSON.parse(cachedGeofenceData);
          setTeamGeofenceData(parsedGeofenceData);
          return;
        }
      }
      
      // If no valid cache, fetch from Firebase
      const userTeamsRef = ref(db, `users/${auth.currentUser.uid}/teams`);
      const userTeamsSnapshot = await get(userTeamsRef);
      
      if (userTeamsSnapshot.exists()) {
        const userTeams = userTeamsSnapshot.val();
        const teamIds = Object.keys(userTeams);
        
        // Get geofence data for each team
        const geofencePromises = teamIds.map(async (teamId) => {
          const geofenceRef = ref(db, `teams/${teamId}/geofence`);
        const geofenceSnapshot = await get(geofenceRef);
          return { teamId, geofence: geofenceSnapshot.exists() ? geofenceSnapshot.val() : null };
        });
        
        const geofenceResults = await Promise.all(geofencePromises);
        const geofenceData = {};
        
        for (const result of geofenceResults) {
          if (result.geofence) {
            geofenceData[result.teamId] = result.geofence;
          }
        }
        
        setTeamGeofenceData(geofenceData);
        
        // Cache the geofence data
        await AsyncStorage.setItem('teamGeofenceData', JSON.stringify(geofenceData));
        await AsyncStorage.setItem('teamGeofenceTimestamp', currentTime.toString());
      }
    } catch (error) {
      console.error('Error loading team geofence data:', error);
    }
  };

  loadTeamGeofence();
}, []); // Remove auth.currentUser from dependency array

const initializeMap = useCallback(async () => {
  try {
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
    
    // Load current user profile
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    const currentUserProfile = profileSnapshot.exists() ? profileSnapshot.val() : {};
    const currentUserTeamCode = currentUserProfile.teamCode;
    
    console.log("Current user team code:", currentUserTeamCode);
    
    // Load all user locations
    const locationsRef = ref(db, "UsersCurrentLocation");
    const locSnapshot = await get(locationsRef);
    
    if (locSnapshot.exists() && Object.keys(locSnapshot.val()).length > 0) {
      const locations = {};
      
      // First, add current user to locations if available
      const currentUserLoc = locSnapshot.val()[auth.currentUser.uid];
      if (currentUserLoc) {
        locations[auth.currentUser.uid] = {
          ...currentUserLoc,
          teamCode: currentUserTeamCode, // Ensure team code is set
          isActive: true // Make sure current user is active
        };
        
        if (currentUserLoc.Latitude && currentUserLoc.Longitude) {
        setCurrentLocation({
          latitude: currentUserLoc.Latitude,
          longitude: currentUserLoc.Longitude
        });
        }
      }
      
      // Then add other users based on team membership
      await Promise.all(Object.entries(locSnapshot.val()).map(async ([userId, userData]) => {
        // Skip current user (already added)
        if (userId === auth.currentUser.uid) return;
        
        // Skip users without location data
        if (!userData || !userData.Latitude || !userData.Longitude) return;
        
        try {
          // Get user profile to check team membership
          const userProfileRef = ref(db, `users/${userId}/profile`);
          const profileSnapshot = await get(userProfileRef);
          
          if (profileSnapshot.exists()) {
            const profileData = profileSnapshot.val();
            
            // Only add users from the same team
            if (profileData.teamCode === currentUserTeamCode) {
              console.log(`Adding team member: ${userId} (${profileData.firstName || ''} ${profileData.lastName || ''})`);
              
              locations[userId] = {
                ...userData,
                firstName: profileData.firstName || '',
                lastName: profileData.lastName || '',
                photoURL: profileData.photoURL || '',
                role: profileData.role || '',
                teamCode: profileData.teamCode,
                name: formatUserName(profileData)
              };
            }
          }
        } catch (error) {
          console.error(`Error loading profile for user ${userId}:`, error);
        }
      }));
      
      console.log(`Loaded ${Object.keys(locations).length} user locations (including ${Object.keys(locations).filter(id => id !== auth.currentUser.uid).length} team members)`);
      setUsersLocations(locations);
      
      // Use the memoized function to fit markers
      setTimeout(() => {
        fitAllMarkers(true);
      }, 1000);
    } else {
      // Start location tracking automatically if we have permission
      requestInitialLocation();
    }
    
    // Set up real-time listener for location updates
    const locationsListener = onValue(locationsRef, async (snapshot) => {
      if (!snapshot.exists()) return;
      
      const locationsData = snapshot.val();
      const updatedLocations = { ...usersLocations };
      
      // Process each location update
      for (const [userId, userData] of Object.entries(locationsData)) {
        // Skip invalid entries
        if (!userData || !userData.Latitude || !userData.Longitude) continue;
        
        // If this is a new user we don't have yet, get their profile
        if (!updatedLocations[userId] && userId !== auth.currentUser.uid) {
          try {
            const userProfileRef = ref(db, `users/${userId}/profile`);
            const profileSnapshot = await get(userProfileRef);
            
            if (profileSnapshot.exists()) {
              const profileData = profileSnapshot.val();
              
              // Only add team members
              if (profileData.teamCode === currentUserTeamCode) {
                updatedLocations[userId] = {
                  ...userData,
                  firstName: profileData.firstName || '',
                  lastName: profileData.lastName || '',
                  photoURL: profileData.photoURL || '',
                  role: profileData.role || '',
                  teamCode: profileData.teamCode,
                  name: formatUserName(profileData)
                };
              }
    }
  } catch (error) {
            console.error(`Error loading profile for user ${userId}:`, error);
          }
        } 
        // Update existing user's location data
        else if (updatedLocations[userId]) {
          updatedLocations[userId] = {
            ...updatedLocations[userId],
            ...userData
          };
        }
      }
      
      setUsersLocations(updatedLocations);
    });
    
    // Return cleanup function
    return () => {
      locationsListener && locationsListener();
    };
  } catch (error) {
    console.error("Error initializing map:", error);
  }
}, [db, fitAllMarkers, formatUserName, usersLocations, requestInitialLocation, setInitialRegion, setCurrentLocation, setUsersLocations]);

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

// Add this function to ensure all location updates include profile data
const updateLocationWithFullProfile = async (userLocationRef, locationData) => {
  try {
    // Get user's full profile to ensure we have team code
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    
    if (profileSnapshot.exists()) {
      const profileData = profileSnapshot.val();
      // Ensure we have the team code and essential profile data
      await update(userLocationRef, {
        ...locationData,
        teamCode: profileData.teamCode || '',
        role: profileData.role || 'member',
        firstName: profileData.firstName || '',
        lastName: profileData.lastName || '',
        photoURL: profileData.photoURL || '',
        isActive: true,
        lastSeen: new Date().toISOString(),
      });
      console.log(`Updated location with team code: ${profileData.teamCode}`);
    } else {
      // If profile doesn't exist, at least update location with basic info
      await update(userLocationRef, {
        ...locationData,
        isActive: true,
        lastSeen: new Date().toISOString(),
      });
      console.log('Updated location without profile data (profile not found)');
    }
  } catch (error) {
    console.error('Error updating location with profile:', error);
  }
};

// Update toggleCurrentLocation function to always include profile data
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
    }).catch(err => {
      console.warn("High accuracy location fetch failed:", err);
    });

    // Set up location tracking
    try {
      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 30000,
          distanceInterval: 20,
        },
        newLocation => {
          const { latitude, longitude, accuracy } = newLocation.coords;
          setCurrentLocation({ latitude, longitude });
          setGpsAccuracy(accuracy);
          
          // Update online status and last seen in Firebase
          const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
          update(userPresenceRef, {
            status: 'online',
            lastSeen: new Date().toISOString()
          }).catch(err => console.error("Error updating presence:", err));
          
          // Update location with isActive flag set to true to indicate user is online
          const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
          
          // Include profile data with every update to ensure team code is always present
          const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
          get(userProfileRef).then(snapshot => {
            if (snapshot.exists()) {
              const profileData = snapshot.val();
              update(userLocationRef, {
                Latitude: latitude,
                Longitude: longitude,
                Accuracy: accuracy,
                Timestamp: new Date().toISOString(),
                isActive: true,
                lastSeen: new Date().toISOString(),
                teamCode: profileData.teamCode || '', // Ensure team code is included
                role: profileData.role || 'member',
                firstName: profileData.firstName || '',
                lastName: profileData.lastName || '',
                photoURL: profileData.photoURL || ''
              }).catch(err => console.error("Error updating location:", err));
            } else {
              update(userLocationRef, {
                Latitude: latitude,
                Longitude: longitude,
                Accuracy: accuracy,
                Timestamp: new Date().toISOString(),
                isActive: true,
                lastSeen: new Date().toISOString()
              }).catch(err => console.error("Error updating location:", err));
            }
          }).catch(err => console.error("Error getting profile data:", err));
        }
      );
    } catch (error) {
      console.error("Error setting up location subscription:", error);
    }

    const auth = getAuth();
    const db = getDatabase();
    const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
    const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);

    // Get user profile data
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    let profileData = {};
    
    if (profileSnapshot.exists()) {
      profileData = profileSnapshot.val();
      console.log("Using profile with team code:", profileData.teamCode);
    } else {
      console.log("Profile not found for current user");
    }

    // Update Firebase in background with full profile data
    set(userLocationRef, { 
      Latitude: currentLocation?.latitude || 0, 
      Longitude: currentLocation?.longitude || 0,
      Accuracy: currentLocation ? gpsAccuracy : 0,
      Timestamp: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      ...profileData, // This should include teamCode and other profile data
      // Explicitly include important fields to ensure they're set
      teamCode: profileData.teamCode || '',
      role: profileData.role || 'member'
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
            accuracy: Location.Accuracy.BestForNavigation, // Keep BestForNavigation
            timeInterval: 2000, // Increased from 500ms to 2000ms
            distanceInterval: 1, // Added: Only update if moved at least 1 meter
            mayShowUserSettingsDialog: true 
        },
        async (location) => {
          try { // Outer try
            const { latitude, longitude, accuracy } = location.coords;
            const currentRawCoords = { latitude, longitude }; // Store raw coords
            const currentTimestamp = Date.now();

            // *** Populate Raw History (Always) - with timestamp ***
            setRawLocationHistory(prevRawHistory => {
                const history = [...(prevRawHistory || []), {
                  latitude: currentRawCoords.latitude, // Keep latitude
                  longitude: currentRawCoords.longitude, // Keep longitude
                  timestamp: location.timestamp, // Use sensor timestamp
                  accuracy: accuracy, // Include accuracy
                  speed: location.coords.speed ?? null, // Include speed (handle null)
                  heading: location.coords.heading ?? null, // Include heading (handle null)
                  altitude: location.coords.altitude ?? null // Include altitude (handle null)
                }];
                 // Keep history limited but larger
                if (history.length > RAW_HISTORY_POINTS) { 
                    return history.slice(-RAW_HISTORY_POINTS); 
                }
                return history;
            });

            console.log(`Raw GPS: Lat=${latitude.toFixed(8)}, Lon=${longitude.toFixed(8)}, Acc=${accuracy.toFixed(1)}m`); // Log Raw Data with more precision
            
            // Log full location data for diagnosis
            console.log(`FULL: Timestamp=${location.timestamp}, Speed=${location.coords.speed?.toFixed(3) || 'null'}, Heading=${location.coords.heading?.toFixed(2) || 'null'}, Alt=${location.coords.altitude?.toFixed(2) || 'null'}, Acc=${location.coords.accuracy?.toFixed(1) || 'null'}`);

            // Default values for step-related variables if we can't access step data
            let currentStepCount = 0;
            let stepDelta = 0;
            let stepsInLockPeriod = 0;
            
            try {
              // Check for movement from steps - using the steps state safely
              currentStepCount = stepCount || 0; // Use stepCount instead of dailySteps
              stepDelta = currentStepCount - lastStepCountRef.current;
              lastStepCountRef.current = currentStepCount;
              
              // If steps have increased, mark as moved since last lock
              if (stepDelta > 0) {
                hasMovedSinceLastLockRef.current = true;
                console.log(`Step movement detected: +${stepDelta} steps since last GPS update`);
              }
              
              // Calculate steps in lock period
              stepsInLockPeriod = currentStepCount - stepsAtLockTimeRef.current;
            } catch (error) {
              console.warn("Error handling step data:", error);
              // We'll continue with default values (0) for step-related variables
            }
            
            // --- Time-based static lock check --- // *** Renaming slightly - it's now persistent lock check ***
            // Check if we're in a persistent static lock (and no steps taken) 
            // const timeSinceLastLock = currentTimestamp - lastLockTimeRef.current; // Time check no longer needed here
            
            if (isPositionLocked && stepsInLockPeriod === 0) { 
              console.log(`Persistent position lock active. Holding until movement detected.`);
              // Only update raw position indicators
              setCurrentLocation(currentRawCoords);
              setGpsAccuracy(accuracy);
              return; // Early return, skipping all filter/state updates
            }

            // --- Pre-filtering --- 
            // 1. Accuracy Filter - much more generous now
            if (accuracy > 100) { // Changed from 20m to 100m to accept more points
              console.log(`KF Using low accuracy point: ${Math.round(accuracy)}m`);
              setGpsAccuracy(accuracy); // Still update GPS indicator
              // We'll still update rather than return, just logging the poor accuracy
            }
            
            // 2. Jump Detection
            if (kalmanFilterRef.current && kalmanFilterRef.current.lastFilteredPosition) {
              const jumpDistance = calculateDistance( // Use Haversine distance function
                currentRawCoords, 
                kalmanFilterRef.current.lastFilteredPosition
              );
              
              if (jumpDistance > UNREALISTIC_JUMP_THRESHOLD_METERS) {
                console.warn(`KF Skipping unrealistic jump: ${jumpDistance.toFixed(1)}m`);
                // Don't update GPS accuracy here, as the point is likely bad
                return; 
              }
            }
            // --- End Pre-filtering --- 
            
            // Initialize filter if needed
            if (!kalmanFilterRef.current) {
              console.warn("Kalman filter not initialized, using raw GPS.");
              kalmanFilterRef.current = new OptimizedKalmanFilter(0.01, 15); // Use tuned constructor
              kalmanFilterRef.current.init(latitude, longitude);
            }
            
            // *** Check for significant movement compared to last filtered position ***
            const lastFilteredPos = estimatedIconPosition || kalmanFilterRef.current.lastFilteredPosition; 
            let distFromLastFiltered = 0;
            
            if (lastFilteredPos) {
                distFromLastFiltered = calculateDistance(currentRawCoords, lastFilteredPos);
            }

            // --- Determine Significant Movement --- 
            // 1. Check for step-based movement first (always breaks lock)
            const stepsDetected = (stepDelta > 2) || hasMovedSinceLastLockRef.current;
            
            // 2. Determine the appropriate distance threshold based on lock state
            const distanceThresholdForBreaking = isPositionLocked 
                ? STATIC_LOCK_BREAK_DISTANCE_THRESHOLD // Use 5.0m if currently locked
                : SIGNIFICANT_MOVEMENT_THRESHOLD;      // Use 3.0m if not locked (for activation check)
            
            // 3. Check if distance movement occurred based on the relevant threshold
            const distanceMovementDetected = distFromLastFiltered >= distanceThresholdForBreaking;
            
            // 4. Combine step and distance checks
            const isSignificantMovement = stepsDetected || distanceMovementDetected;
            console.log(`Movement Check: Steps=${stepsDetected}, Dist=${distFromLastFiltered.toFixed(1)}m >= Thresh=${distanceThresholdForBreaking}m -> DistMov=${distanceMovementDetected}. RESULT -> isSignificantMovement=${isSignificantMovement}`);

            // *** NEW: Detect transition from moving to stopped and reset filter velocity ***
            if (wasMovingRef.current === true && isSignificantMovement === false) {
              console.log("Transition Detected: Moving -> Stopped. Resetting KF velocity.");
            if (kalmanFilterRef.current) {
                kalmanFilterRef.current.resetVelocity();
              }
            }
            // Update the ref for the next cycle
            wasMovingRef.current = isSignificantMovement;
            // *** End NEW section ***

            if (!isSignificantMovement && kalmanFilterRef.current.staticPeriodCounter > 0) {
                // Static detection - update lock time & counter, skip update
                console.log(`Static position maintained (Dist: ${distFromLastFiltered.toFixed(1)}m < ${SIGNIFICANT_MOVEMENT_THRESHOLD}m, Steps: ${stepDelta}). Lock timer reset.`);
                
                // Start/Renew the time-based position lock
                lastLockTimeRef.current = currentTimestamp;
                stepsAtLockTimeRef.current = currentStepCount;
                setIsPositionLocked(true);
                
                // *** NEW: Set flag indicating lock has engaged at least once ***
                if (!hasLockedOnceRef.current) {
                  hasLockedOnceRef.current = true;
                  console.log("First position lock engaged.");
                }
                
                // Make sure internal counter stays high
                if(kalmanFilterRef.current.staticPeriodCounter <= kalmanFilterRef.current.staticThreshold) {
                    kalmanFilterRef.current.staticPeriodCounter++; 
                }
                
                // Update raw GPS indicator, but not filtered position
                setCurrentLocation(currentRawCoords); 
                setGpsAccuracy(accuracy);
                return; // Skip filter update and state setting
            } else {
                 // Significant movement detected
                 if (kalmanFilterRef.current.staticPeriodCounter > 0 || isPositionLocked) {
                    console.log(`Movement detected! (Dist: ${distFromLastFiltered.toFixed(1)}m, Steps Since Lock: ${stepsInLockPeriod})`);
                    kalmanFilterRef.current.staticPeriodCounter = 0; // Reset the filter's counter
                    setIsPositionLocked(false); // Turn off position lock
                    hasMovedSinceLastLockRef.current = false; // Reset movement flag
                 }
            }
            // --- End Static Lock Check ---
            
            // --- Filter the location (only runs if not determined static above) ---
            let filteredCoordinate = { latitude, longitude }; // Default to raw if KF fails
            let iconPositionCoordinate = { latitude, longitude }; 
            
              try { // Inner try for KF
                // *** Determine if lock just broke ***
                const justUnlocked = prevIsPositionLockedRef.current === true && isPositionLocked === false;
                console.log(`KF Call Params: justUnlocked = ${justUnlocked} (Prev: ${prevIsPositionLockedRef.current}, Curr: ${isPositionLocked})`);

                // Get the actual filtered coordinate for the icon, passing the flag
                iconPositionCoordinate = kalmanFilterRef.current.update(
                  latitude,
                  longitude,
                  accuracy,
                  100, // Assuming battery level is not critical here, can pass actual if available
                  justUnlocked // *** Pass the flag ***
                );
                
                // Use filtered coordinate for polyline history
                filteredCoordinate = iconPositionCoordinate; 
                console.log(`Using FILTERED GPS for polyline history`);

              } catch (kfError) {
                 console.error("Kalman Filter Error:", kfError);
                 // Reset filter if it errors out
                 kalmanFilterRef.current = new OptimizedKalmanFilter(0.01, 15);
                 kalmanFilterRef.current.init(latitude, longitude);
                 // Use raw for both if filter fails
              filteredCoordinate = { latitude, longitude };
              iconPositionCoordinate = { latitude, longitude }; 
            }
            
            console.log(`Icon Coord (Filtered): Lat=${iconPositionCoordinate.latitude.toFixed(6)}, Lon=${iconPositionCoordinate.longitude.toFixed(6)}`); // Log Filtered Data for Icon
            console.log(`?History Coord (Filtered): Lat=${filteredCoordinate.latitude.toFixed(6)}, Lon=${filteredCoordinate.longitude.toFixed(6)}`); // Log Coord used for History
            
            // Update state for icon and raw GPS display
            const currentGpsCoordinate = { latitude, longitude };
            setCurrentLocation(currentGpsCoordinate); // Update raw display
            setGpsAccuracy(accuracy); 
            setEstimatedIconPosition(iconPositionCoordinate); // Update filtered icon position

            setLocationHistory(prevHistory => {
              // *** MODIFIED: Only add to history if the lock has engaged at least once ***
              if (!hasLockedOnceRef.current) {
                // console.log("? Skipping history add - Initial lock not yet engaged.");
                return prevHistory; // Return existing history (likely empty or null)
              }
              
              const history = prevHistory || []; // Now safe to assume it might be empty initially
              const lastPoint = history.length > 0 ? history[history.length - 1] : null;
              
              // In debug mode, always add the point
              if (debugMode) {
                console.log(`DEBUG: Force adding point to history. New length: ${history.length + 1}`);
                const newHistory = [...history, {
                  // Use the filtered coordinate even in debug for consistency display
                  latitude: filteredCoordinate.latitude, 
                  longitude: filteredCoordinate.longitude,
                  timestamp: Date.now() 
                }];
                
                // Keep history limited
                if (newHistory.length > MAX_HISTORY_POINTS + 20) { // Keep slightly more for debug inspection
                  return newHistory.slice(-(MAX_HISTORY_POINTS + 10)); 
                }
                return newHistory;
              }
              
              // Normal mode - check if point is different enough using actual distance
              let distanceMoved = 0;
              if (lastPoint) {
                  distanceMoved = calculateDistance(filteredCoordinate, lastPoint); // Use Haversine distance
              }

              // Use MIN_DISTANCE_THRESHOLD (currently 1m)
              if (!lastPoint || distanceMoved > MIN_DISTANCE_THRESHOLD) 
              {
                console.log(`Adding point to history (Dist: ${distanceMoved.toFixed(1)}m). New length: ${history.length + 1}`);
                const newHistory = [...history, filteredCoordinate]; // Add the filtered coordinate
                
                // Keep history limited (original logic)
                if (newHistory.length > MAX_HISTORY_POINTS + 10) {
                  return newHistory.slice(-(MAX_HISTORY_POINTS + 5)); 
                }
                return newHistory;
              } else {
                // console.log(`? Skipping history add - distance ${distanceMoved.toFixed(1)}m <= ${MIN_DISTANCE_THRESHOLD}m`); // Optional log
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

// Add this safe getter function inside AppContent
const getRole = () => userRole || 'member';

// Update the fitAllMarkers function
const fitAllMarkers = useCallback((forceUpdate = false) => {
  if (!mapRef.current) return;
  
  if (!forceUpdate && !shouldAutoFit) return;
  
  setShouldAutoFit(true);
  
  // Debounce the actual fit operation to prevent too frequent updates
  if (fitMarkersTimeoutRef.current) {
    clearTimeout(fitMarkersTimeoutRef.current);
  }
  
  fitMarkersTimeoutRef.current = setTimeout(() => {
    try {
    const allCoordinates = [];
    
      // Use the safe getter function
      const effectiveUserRole = getRole();
      const geofencePoints = effectiveUserRole === 'member' ? teamGeofence : points;
      
      if (Array.isArray(geofencePoints) && geofencePoints.length >= 3) {
        // Add geofence points
      geofencePoints.forEach(point => {
          if (point && typeof point.latitude === 'number' && typeof point.longitude === 'number') {
        allCoordinates.push(point);
          }
      });
      
        // Add current location
        if (currentLocation && typeof currentLocation.latitude === 'number' && typeof currentLocation.longitude === 'number') {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
        // Add team members from the memoized array
        if (Array.isArray(teamMembers)) {
          teamMembers.forEach(([_, userData]) => {
            if (userData && typeof userData.Latitude === 'number' && typeof userData.Longitude === 'number') {
          allCoordinates.push({
            latitude: userData.Latitude,
            longitude: userData.Longitude
          });
            }
        });
      }
    } else {
        // Simplified logic for when there's no proper geofence
        if (currentLocation && typeof currentLocation.latitude === 'number' && typeof currentLocation.longitude === 'number') {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
        // Add all user locations using memoized team members
        if (Array.isArray(teamMembers)) {
          teamMembers.forEach(([_, userData]) => {
            if (userData && typeof userData.Latitude === 'number' && typeof userData.Longitude === 'number') {
            allCoordinates.push({
                latitude: userData.Latitude,
                longitude: userData.Longitude
            });
          }
        });
      }
      
        // Add any geofence points
        if (Array.isArray(geofencePoints) && geofencePoints.length > 0) {
        geofencePoints.forEach(point => {
            if (point && typeof point.latitude === 'number' && typeof point.longitude === 'number') {
          allCoordinates.push(point);
            }
        });
      }
    }
    
      // Only fit if we have coordinates
    if (allCoordinates.length > 0) {
        try {
      mapRef.current.fitToCoordinates(allCoordinates, {
            edgePadding: { top: 100, right: 100, bottom: 100, left: 100 },
        animated: true
      });
        } catch (error) {
          console.error('Error fitting to coordinates:', error);
        }
      }
    } catch (error) {
      console.error('Error in fitAllMarkers:', error);
    }
    }, 100);
}, [currentLocation, points, teamGeofence, teamMembers, userRole, shouldAutoFit, getRole]);

// Add a missing ref for debouncing
const fitMarkersTimeoutRef = useRef(null);

useEffect(() => {
  if (shouldAutoFit && (Object.keys(usersLocations).length > 0 || currentLocation)) {
    fitAllMarkers();
    setShouldAutoFit(false);
  }
}, [usersLocations, currentLocation, shouldAutoFit]);

useEffect(() => {
  initializeMap();
}, []);

// Commenting out the potentially problematic useEffect and helpers
/*
useEffect(() => {
  const loadAllUserLocations = async () => {
    if (!userId || !isLocationSharing) return;
    
    try {
      // Check if we need to update based on last fetch time
      const lastFetchTime = parseInt(await AsyncStorage.getItem('lastUserLocationsFetchTime') || '0');
      const currentTime = Date.now();
      const timeSinceLastFetch = currentTime - lastFetchTime;
      
      // Only fetch if more than 10 seconds have passed since last fetch or if it's forced
      if (timeSinceLastFetch < 10000 && allUserData.length > 0) {
        console.log('Using cached user locations data');
        return;
      }
      
      // Get current user's team
      const userTeamRef = ref(database, `users/${userId}/teams`);
      const userTeamSnapshot = await get(userTeamRef);
      
      if (!userTeamSnapshot.exists()) return;
      
      // Only subscribe to location updates for team members instead of all users
      const userTeams = Object.keys(userTeamSnapshot.val());
      
      for (const teamId of userTeams) {
        const teamRef = ref(database, `teams/${teamId}/members`);
        const teamMembersSnapshot = await get(teamRef);
        
        if (teamMembersSnapshot.exists()) {
          const teamMembers = Object.keys(teamMembersSnapshot.val());
          
          // For each team member, get their location
          await fetchUserProfiles(teamMembers);
        }
      }
      
      // Save fetch timestamp
      await AsyncStorage.setItem('lastUserLocationsFetchTime', currentTime.toString());
    } catch (error) {
      console.error('Error loading user locations:', error);
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
  }, [db]); // Dependency array might need review

// Helper function to fetch and cache user profile
const fetchAndCacheUserProfile = async (userId) => {
  try {
    const userProfileRef = ref(database, `users/${userId}/profile`);
    const profileSnapshot = await get(userProfileRef);
    
    if (profileSnapshot.exists()) {
      const profileData = profileSnapshot.val();
      // Add timestamp for cache invalidation
      profileData._timestamp = Date.now();
      
      // Cache the profile data
      await AsyncStorage.setItem(`userProfile_${userId}`, JSON.stringify(profileData));
      return profileData;
    }
  } catch (error) {
    console.error(`Error fetching profile for user ${userId}:`, error);
  }
  return null;
};

const fetchUserProfiles = async (teamMemberIds) => {
  if (!teamMemberIds || teamMemberIds.length === 0) return;
  
  const formattedLocations = { ...usersLocations };
  
  for (const memberId of teamMemberIds) {
    // Skip if it's the current user
    if (memberId === userId) continue;
    
    try {
      // Get user location
      const userLocationRef = ref(database, `UsersCurrentLocation/${memberId}`);
      const locationSnapshot = await get(userLocationRef);
      
      if (locationSnapshot.exists()) {
        const locationData = locationSnapshot.val();
        
        // Only process if valid coordinates exist
        if (locationData && locationData.Latitude && locationData.Longitude) {
          // Check if user profile data exists in cache
          const cachedProfileData = await AsyncStorage.getItem(`userProfile_${memberId}`);
          let profileData;
          
          if (cachedProfileData) {
            profileData = JSON.parse(cachedProfileData);
            // Check if profile data is stale (older than 30 minutes)
            const profileTimestamp = profileData._timestamp || 0;
            if (Date.now() - profileTimestamp > 30 * 60 * 1000) {
              // Profile data is stale, fetch new data
              profileData = await fetchAndCacheUserProfile(memberId);
            }
          } else {
            // No cached data, fetch from Firebase
            profileData = await fetchAndCacheUserProfile(memberId);
          }
          
          if (profileData) {
            formattedLocations[memberId] = {
              ...locationData,
              firstName: profileData.firstName || '',
              lastName: profileData.lastName || '',
              photoURL: profileData.photoURL || '',
              role: profileData.role || '',
              teamCode: profileData.teamCode || '',
              name: formatUserName(profileData)
            };
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching data for user ${memberId}:`, error);
    }
  }
  
  setUsersLocations(formattedLocations);
};
*/

// *** NEW: Real-time listener for all user locations ***
useEffect(() => {
  const db = getDatabase();
  const currentUserId = auth.currentUser?.uid;
  if (!currentUserId) return;

  let currentUserTeamCode = null; // To store the current user's team code
  let currentGeofence = []; // Store the relevant geofence here
  let currentUserRole = null; // Store the current user's role

  // 1. Get current user's team code AND the relevant geofence
  const profileRef = ref(db, `users/${currentUserId}/profile`);
  get(profileRef).then(profileSnap => {
    if (profileSnap.exists()) {
      const profileData = profileSnap.val();
      currentUserTeamCode = profileData?.teamCode;
      currentUserRole = profileData?.role; // Store the role
      console.log(`Realtime Listener: Current user team code is ${currentUserTeamCode}`);

      // Determine which geofence to use based on role (needs teamGeofence state)
      // Assuming 'teamGeofence' state holds the coordinates for members
      if (profileData?.role === 'member' && Array.isArray(teamGeofence) && teamGeofence.length >= 3) {
          currentGeofence = teamGeofence;
          console.log(`Realtime Listener: Using TEAM geofence (${currentGeofence.length} points) for checks.`);
      } else if (profileData?.role === 'owner' && Array.isArray(points) && points.length >= 3) {
          // Owner might want to see status relative to their defined fence? Let's use 'points'
          currentGeofence = points;
           console.log(`Realtime Listener: Using OWNER geofence (${currentGeofence.length} points) for checks.`);
      } else {
           console.log("Realtime Listener: No valid geofence available for checks.");
      }
    }

    // 2. Set up the listener
    const locationsRef = ref(db, 'UsersCurrentLocation');
    const unsubscribe = onValue(locationsRef, (snapshot) => {
      if (!snapshot.exists()) {
        setUsersLocations({});
        setUserGeofenceStatuses({}); // Clear statuses too
        return;
      }

      const allLocationsData = snapshot.val();
      // Instead of creating a new empty object, start with existing locations
      // This preserves offline users' last known coordinates
      const formattedLocations = { ...usersLocations };
      const newGeofenceStatuses = { ...userGeofenceStatuses }; // Copy previous statuses

      Object.entries(allLocationsData).forEach(([userId, userData]) => {
          // Basic validity check
          if (!userData || typeof userData.Latitude !== 'number' || typeof userData.Longitude !== 'number') {
            // Don't remove the user from the state if they already exist and just have invalid new data
            // This preserves their last known good coordinates
            return; 
          }

          // Team filtering (only apply if current user HAS a team code)
          // Check if the current user is an owner - owners see everyone in their org
          if (currentUserRole === 'owner') {
            // Owners see all members in the organization with any teamCode 
            // This assumes members in the organization have some teamCode set
            if (!userData.teamCode) {
              return; // Skip users without any team (not part of ANY organization)
            }
          } else if (currentUserTeamCode && userData.teamCode !== currentUserTeamCode) {
            // For non-owners (members), only show those with matching teamCode
            return;
          }
          
          // Check 3: Geofence Status Check (only if geofence is valid)
          let isOutsideGeofence = null; // Default to null if no check performed
          const userName = formatUserName(userData) || userId; // For logging

          if (currentGeofence.length >= 3 && userId !== currentUserId) { // Only check others for now
              const userPoint = { latitude: userData.Latitude, longitude: userData.Longitude };
              const isInside = isPointInsidePolygon(userPoint, currentGeofence);
              isOutsideGeofence = !isInside;

              // Check against previous status for logging
              const previousStatus = userGeofenceStatuses[userId];
              if (previousStatus !== undefined && previousStatus.wasOutside !== isOutsideGeofence) {
                  if (isOutsideGeofence) {
                      console.log(`GEOFENCE LOG: ${userName} EXITED the geofence area at ${new Date().toISOString()}`);
                  } else {
                      console.log(`GEOFENCE LOG: ${userName} ENTERED the geofence area at ${new Date().toISOString()}`);
                  }
              }
              // Update status for the next check
              newGeofenceStatuses[userId] = { wasOutside: isOutsideGeofence };
          }

          // Check if we should update the user's location
          // For offline users, we may want to keep their existing entry with last known position
          const isUserOffline = userData.isActive === false;
          
          // Include user (online or offline) if they pass filters
          formattedLocations[userId] = {
              ...userData, // Spread all data (includes Lat, Lon, Accuracy, isActive, profile info)
              name: formatUserName(userData), // Ensure name is formatted
              isOutsideGeofence: isOutsideGeofence, // Add the flag
              lastUpdated: Date.now(), // Add timestamp of when this entry was last updated
          };
          
          // For debugging
          if (isUserOffline) {
            console.log(`Preserving location for offline user: ${userName}`);
          }
      });

      // Update states
      console.log(`Realtime Listener: Updating usersLocations with ${Object.keys(formattedLocations).length} users.`);
      setUsersLocations(formattedLocations); 
      setUserGeofenceStatuses(newGeofenceStatuses); // Update the tracked statuses

    }, (error) => {
      console.error("Error listening to user locations:", error);
      // Handle error appropriately, maybe clear locations
      setUsersLocations({});
      setUserGeofenceStatuses({}); // Clear statuses on error
    });

    // Return the unsubscribe function for cleanup
    return () => {
      console.log("Realtime Listener: Unsubscribing from user locations.");
      unsubscribe();
    };

  }).catch(error => {
    console.error("Error fetching current user profile for team code/geofence:", error);
  });

  // Initial return function (in case profile fetch fails)
  return () => {}; 

}, [teamGeofence, points]); // Remove auth.currentUser from dependencies

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
  if (Object.keys(usersLocations || {}).length > 0) {
    // Only recalculate if we have a significant change in locations
    // This helps prevent unnecessary state updates
    const positions = calculateMarkerLabelPositions(usersLocations);
    
    // Use functional update to avoid stale state issues
    setMarkerPositions(prevPositions => {
      // Only update if positions have actually changed
      const hasChanged = !prevPositions || 
        Object.keys(positions).length !== Object.keys(prevPositions).length ||
        Object.keys(positions).some(id => positions[id] !== prevPositions[id]);
        
      return hasChanged ? positions : prevPositions;
    });
  }
}, [usersLocations]);

useEffect(() => {
  const checkNotifications = async () => {
    const auth = getAuth();
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
            
            if (notification.type === 'geofence_approved' && getRole() === 'owner') {
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
}, [userRole, navigation, db]); // Remove auth.currentUser from dependencies

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
}, [currentLocation, points, teamGeofence]); // Removed usersLocations from dependencies

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
    // Get auth inside the effect
    const auth = getAuth();
    if (isStepCountingInitialized.current || !auth.currentUser) return; 
    console.log('STEP INIT (locTrack): Initializing step counting...');

    const checkPedometerAvailability = async () => {
      try {
        const isAvailable = await Pedometer.isAvailableAsync();
        if (isMounted) {
          setIsPedometerAvailable(String(isAvailable));
          console.log(`STEP INIT (locTrack): Pedometer Available = ${isAvailable}`);
          if (isAvailable) {
            await startPedometerTracking();
          } else {
            console.log('STEP INIT (locTrack): Pedometer not available, using simulated steps.');
            startIntervalBasedStepCounting();
          }
          isStepCountingInitialized.current = true; 
        }
      } catch (error) {
        console.error('STEP INIT (locTrack) ERROR: Error checking availability:', error);
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
      console.log('STEP CLEANUP (locTrack): Cleaning up step counter...');
      if (pedometerSubscription.current) {
        pedometerSubscription.current.remove();
        pedometerSubscription.current = null;
        console.log('STEP CLEANUP (locTrack): Pedometer subscription removed.');
      }
      if (stepCounterInterval.current) {
        clearInterval(stepCounterInterval.current);
        stepCounterInterval.current = null;
        console.log('STEP CLEANUP (locTrack): Interval counter cleared.');
      }
       isStepCountingInitialized.current = false; 
    };
  }, []); // Remove auth.currentUser dependency

  const startPedometerTracking = async () => {
    console.log('PEDOMETER (locTrack): Starting tracking...');
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      const db = getDatabase();

      // 1. Get the last saved total steps from Firebase (Keep this part for overall total)
      const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/totalSteps`);
      const snapshot = await get(stepDataRef);
      const initialSavedSteps = snapshot.exists() ? (snapshot.val() || 0) : 0;
      console.log(`PEDOMETER (locTrack): Initial total steps loaded: ${initialSavedSteps}`);
      setStepCount(initialSavedSteps);
      stepCountRef.current = initialSavedSteps; // Sync ref too
      
      // Reset session-specific counters
      setStepsSinceLastGpsUpdate(0);
      stepsSinceLastGpsUpdateRef.current = 0;
      lastPedometerStepsRef.current = null; // *** Explicitly nullify baseline ref ***

      // 2. Request permissions
      const { status } = await Pedometer.requestPermissionsAsync();
      if (status !== 'granted') {
          console.error('PEDOMETER (locTrack) ERROR: Permission not granted!');
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
                  console.log('PEDOMETER (locTrack): User chose fallback due to denied permission.');
                  startIntervalBasedStepCounting(); // Use fallback if user chooses
                },
                style: 'cancel',
              },
            ]
          );
          return; // Stop execution here, wait for user action in Alert
      }

      // 3. REMOVED: Don't get initial sensor reading baseline here - use first watch value
      console.log('PEDOMETER (locTrack): Waiting for first sensor reading to set baseline...');
       
      // 4. Start watching
      pedometerSubscription.current = Pedometer.watchStepCount(result => {
        const currentSensorSteps = result.steps; 

        // *** Set baseline on the first reading ***
        if (lastPedometerStepsRef.current === null) {
            console.log(`PEDOMETER (locTrack): Baseline set to ${currentSensorSteps}`);
            lastPedometerStepsRef.current = currentSensorSteps;
            // Optionally save initial state right after baseline is set
            // writeStepDataToFirebase(true);
            // lastStepSaveTimestamp.current = Date.now();
            return; // Don't process steps on the first reading
        }

        // Calculate delta based on the now-set baseline
        const deltaSteps = currentSensorSteps - lastPedometerStepsRef.current;
        // console.log(`PEDOMETER CB (locTrack): Sensor=${currentSensorSteps}, LastRef=${lastPedometerStepsRef.current}, Delta=${deltaSteps}`); // Verbose log

        // Handle sensor reset or negative values
        if (deltaSteps < 0) {
            console.warn(`PEDOMETER CB (locTrack): Negative delta (${deltaSteps}), resetting baseline to ${currentSensorSteps}`);
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
        console.log(`PEDOMETER CB (locTrack): Applying Delta: ${deltaSteps}`);
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
        
        // Update the reference *after* applying the delta for the next callback
        lastPedometerStepsRef.current = currentSensorSteps;

        const currentTime = Date.now();
        if (currentTime - lastStepSaveTimestamp.current >= 1000) {
          console.log('PEDOMETER CB (locTrack): 1s passed, calling save...');
          writeStepDataToFirebase();
          lastStepSaveTimestamp.current = currentTime;
        }
      });
      console.log('PEDOMETER (locTrack): Step watching started.');
      // Don't save initial state here, wait for baseline and first steps
      // writeStepDataToFirebase(true);
      // lastStepSaveTimestamp.current = Date.now();

    } catch (error) {
      console.error('PEDOMETER (locTrack) ERROR: Failed to start tracking:', error);
      startIntervalBasedStepCounting();
    }
  };

  const startIntervalBasedStepCounting = () => {
    console.log('FALLBACK (locTrack): Using simulated step counting.');
    if (stepCounterInterval.current) clearInterval(stepCounterInterval.current);
     const auth = getAuth();
     if (auth.currentUser) {
         const db = getDatabase();
         const stepDataRef = ref(db, `users/${auth.currentUser.uid}/profile/stepData/totalSteps`);
         get(stepDataRef).then(snapshot => {
             const initialSavedSteps = snapshot.exists() ? (snapshot.val() || 0) : 0;
             setStepCount(initialSavedSteps);
             console.log(`FALLBACK (locTrack): Initial steps loaded: ${initialSavedSteps}`);
         }).catch(err => console.error("FALLBACK (locTrack): Error loading initial steps:", err));
          setStepsSinceLastGpsUpdate(0); 
     }
    stepCounterInterval.current = setInterval(() => {
      const increment = 3;
      console.log(`FALLBACK CB (locTrack): Incrementing by ${increment}`);
      
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
      
      const currentTime = Date.now();
      if (currentTime - lastStepSaveTimestamp.current >= 1000) {
        console.log('FALLBACK CB (locTrack): 1s passed, calling save...');
        writeStepDataToFirebase(); // Will now use refs internally
        lastStepSaveTimestamp.current = currentTime;
      }
    }, 1500);
    console.log('FALLBACK (locTrack): Saving initial state after setup...');
    writeStepDataToFirebase(true);
    lastStepSaveTimestamp.current = Date.now();
  };

  const writeStepDataToFirebase = async (isInitialReading = false) => {
    console.log(`STEP SAVE (locTrack): Initiated. isInitialReading=${isInitialReading}`);
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
          console.log('STEP SAVE (locTrack) ERROR: No team code found in profile.');
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
      console.log(`STEP SAVE (locTrack): Captured state: total=${currentTotalSteps}, sinceSave=${currentStepsSinceSave}`);

      if (currentStepsSinceSave <= 0 && !isInitialReading) {
          console.log(`STEP SAVE (locTrack): Skipping save - no new steps (${currentStepsSinceSave})`);
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
      console.log(`STEP SAVE (locTrack): Payload ready:`, stepDataPayload);

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
      console.log("STEP SAVE (locTrack): Prepared Firebase updates object:", updates);
      
      await update(ref(db), updates);
      console.log("STEP SAVE (locTrack): Firebase update successful.");

      // *** Reset state AND ref ***
      setStepsSinceLastGpsUpdate(0);
      stepsSinceLastGpsUpdateRef.current = 0; 
      console.log("STEP SAVE (locTrack): Reset stepsSinceLastGpsUpdate to 0.");

    } catch (error) {
      console.error('STEP SAVE (locTrack) ERROR:', error);
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

// *** NEW Function to Save and Share History ***
const saveAndShareHistory = async (historyData, historyType) => {
  if (!historyData || historyData.length === 0) {
    Alert.alert("No History", `There is no ${historyType} history data to export.`);
    return;
  }

  const filename = `${historyType}_history_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fileUri = FileSystem.documentDirectory + filename;

  try {
    const jsonString = JSON.stringify(historyData, null, 2); // Pretty print JSON
    await FileSystem.writeAsStringAsync(fileUri, jsonString, { encoding: FileSystem.EncodingType.UTF8 });
    console.log(`History saved to: ${fileUri}`);

    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert("Sharing Unavailable", "Sharing is not available on this device.");
      return;
    }

    await Sharing.shareAsync(fileUri, {
      mimeType: 'application/json',
      dialogTitle: `Share ${historyType} History`,
    });
  } catch (error) {
    console.error(`Error saving or sharing ${historyType} history:`, error);
    Alert.alert("Export Error", `Failed to export ${historyType} history.`);
  }
};

// ... existing code ...
// Update the current user to make sure they're active when tracking is enabled
useEffect(() => {
  // Get auth inside the effect
  const auth = getAuth();
  // Set user presence and location active status when app is running
  if (auth?.currentUser?.uid && currentLocation) {
    const db = getDatabase();
    const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
    const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
    
    // Update user presence
    update(userPresenceRef, {
      status: 'online',
      lastSeen: new Date().toISOString(),
      deviceInfo: Platform.OS
    }).catch(err => console.error("Error updating presence:", err));
    
    // Update location active status
    update(userLocationRef, {
      isActive: true,
      lastSeen: new Date().toISOString()
    }).catch(err => console.error("Error updating location active status:", err));
    
    // Set up disconnect hooks
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // When we disconnect, update status
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
  }
}, [currentLocation]); // Remove auth.currentUser?.uid from dependency

// Log users_locations every time they change for debugging
useEffect(() => {
  console.log('Users locations updated, count:', Object.keys(usersLocations).length);
  
  // Debug: log each user location
  Object.entries(usersLocations).forEach(([userId, userData]) => {
    console.log(`User ${userId} location: ${userData.Latitude},${userData.Longitude} - Team: ${userData.teamCode} - isActive: ${userData.isActive}`);
  });
  
  // Re-check team member visibility each time locations change
  fitAllMarkers(true);
}, [usersLocations]);
// ... existing code ...

// Inside the render function, update the filter for team members
{teamMembers.map(([userId, userData]) => (
  <CustomMarker
    key={userId}
    coordinate={{
      latitude: userData.Latitude,
      longitude: userData.Longitude
    }}
    photoURL={userData.photoURL}
    name={formatUserName(userData)}
    labelPosition={markerPositions[userId] || 'bottom'}
    markerColor={getUniqueColor(userId)}
    isOnline={userData.isActive !== false}
  />
))}
// ... existing code ...

return (
    <SafeAreaView style={[styles.container, { paddingTop: 0 }]}>
      <View style={[styles.topLeftIndicators, { top: insets.top + 10 }]}>
    {gpsAccuracy !== null && <GPSStrengthIndicator accuracy={gpsAccuracy} />}
        <View style={styles.stepIndicator}>
          <Ionicons name="footsteps" size={16} color="#666" />
          <Text style={styles.stepIndicatorText}>{realStepCount}</Text>
        </View>
        {/* *** Moved Export RAW History Button *** */}
        <TouchableOpacity
          style={styles.exportButtonRaw} // Use new style
          onPress={() => saveAndShareHistory(rawLocationHistory, 'RawLocation')}
        >
          <Text style={styles.exportButtonText}>EXPORT RAW</Text>
        </TouchableOpacity>
        {/* *** Moved Export History Button *** */}
        <TouchableOpacity
          style={styles.exportButtonFiltered} // Use new style
          onPress={() => saveAndShareHistory(locationHistory, 'FilteredLocation')}
        >
          <Text style={styles.exportButtonText}>EXPORT</Text>
        </TouchableOpacity>
      </View>

    <MapView 
      ref={mapRef} 
      style={styles.map} 
      initialRegion={initialRegion}
      rotateEnabled={true}
      minZoomLevel={10}
      maxZoomLevel={20}
      followsUserLocation={false}
        moveOnMarkerPress={false}
        loadingEnabled={true}
      loadingIndicatorColor="#2196F3"
      loadingBackgroundColor="rgba(255,255,255,0.7)"
    >
      {/* SAFE CONDITIONAL RENDERING BASED ON USER ROLE */}
      {getRole() === 'member' ? (
        <>
          {/* MEMBER VIEW - SHOW TEAM GEOFENCE */}
          {Array.isArray(teamGeofence) && teamGeofence.length >= 3 && (
            <Polygon 
              coordinates={teamGeofence} 
              fillColor="rgba(0,0,255,0.2)" 
              strokeColor="blue" 
              strokeWidth={2} 
            />
          )}
          
          {Array.isArray(teamGeofence) && teamGeofence.length >= 2 && teamGeofence.map((point, index) => {
            if (!point) return null;
            
            const nextIndex = (index + 1) % teamGeofence.length;
            if (nextIndex === 0 && teamGeofence.length < 3) return null;
            
            const nextPoint = teamGeofence[nextIndex];
            if (!nextPoint) return null;
            
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
          {/* OWNER/ADMIN VIEW - SHOW POINTS */}
          {Array.isArray(points) && points.map((point, index) => (
            point ? <Marker key={index} coordinate={point} title={`Point ${index + 1}`} /> : null
          ))}
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
    </MapView>

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
    flexDirection: 'row', // Keep items in a row
    alignItems: 'center',
    gap: 10, // Space between indicators and buttons
    zIndex: 10, // Ensure it's above the map
    // top is set dynamically using insets
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
  exportButtonBase: { // Base style for export buttons
    borderRadius: 15,
    paddingVertical: 5,
    paddingHorizontal: 10,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  exportButtonRaw: {
    backgroundColor: 'rgba(33, 150, 243, 0.9)', // Blue
    // Inherits from exportButtonBase
  },
  exportButtonFiltered: {
    backgroundColor: 'rgba(76, 175, 80, 0.9)', // Green
    // Inherits from exportButtonBase
  },
  exportButtonText: { // Text style for export buttons
    color: 'white',
    fontWeight: 'bold',
    fontSize: 10,
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

// Make sure any useEffect calling fitAllMarkers uses the ref version
useEffect(() => {
  // Only fit markers when user role or team geofence changes
  // This is a meaningful time to refit the map
  if (mapRef.current) {
    fitAllMarkers(true);
  }
}, [teamGeofence?.length, fitAllMarkers]); // Add the optional chaining operator to prevent errors

// Add this useEffect to ensure userRole is loaded as soon as possible
useEffect(() => {
  // Ensure user role is loaded immediately if possible
  const loadUserRoleFromStorage = async () => {
    try {
      // Try to load the role from storage first
      const storedRole = await AsyncStorage.getItem('userRole');
      if (storedRole) {
        setUserRole(storedRole);
        console.log('UserRole loaded from storage:', storedRole);
      }

      // Also trigger a fresh load
      loadUserRole();
    } catch (error) {
      console.error('Error loading user role from storage:', error);
      loadUserRole();
    }
  };

  loadUserRoleFromStorage();
}, []);

useEffect(() => {
  // Get auth inside the effect
  const auth = getAuth();
  if (auth?.currentUser?.uid && currentLocation) {
    get(ref(db, `users/${auth.currentUser.uid}/presence`)).then(snapshot => {
      if (!snapshot.exists()) {
        const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
        const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
        
        set(userPresenceRef, {
          status: 'online',
          lastSeen: new Date().toISOString()
        });
        
        onDisconnect(userLocationRef).update({
          isActive: false,
          lastSeen: new Date().toISOString()
        });
      }
    }, { onlyOnce: true });
  }
}, [currentLocation]); // Remove auth.currentUser?.uid from dependency



