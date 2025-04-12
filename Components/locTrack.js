import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, SafeAreaView, Animated, Image, Alert, Platform } from "react-native";
import MapView, { Marker, Polygon, Circle } from "react-native-maps";
import * as Location from "expo-location";
import { getDatabase, ref, set, push, get, remove, child, onValue, onDisconnect, update } from "firebase/database";
import { db, auth } from "./firebaseConfig";
import { getAuth, signOut } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Navbar from './Navbar';

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

// Optimize the CustomMarker component to better handle rendering
const CustomMarker = ({ coordinate, photoURL, name, labelPosition = 'bottom', markerColor, isOnline = true }) => {
  // Get first character of name if it exists, otherwise use empty string
  const nameInitial = name && typeof name === 'string' && name.trim() !== '' ? name.trim()[0].toUpperCase() : '';
  
  // Determine label position style based on the labelPosition prop
  const labelPositionStyle = {
    top: { marginTop: -46, marginBottom: 4 },
    bottom: { marginTop: 4 },
    left: { position: 'absolute', left: -80, top: -8 },
    right: { position: 'absolute', right: -80, top: -8 },
  }[labelPosition] || { marginTop: 4 };
  
  // Style modifications for offline users
  const offlineStyle = !isOnline ? {
    opacity: 0.7,
    borderStyle: 'dashed',
  } : {};
  
  // OPTIMIZATION: Use useMemo to optimize the marker content
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
          !isOnline && { borderStyle: 'dashed', opacity: 0.8 }
        ]}>
          <Text style={[
            styles.markerLabel, 
            { color: markerColor ? '#FFFFFF' : '#333333', fontWeight: '700' }
          ]}>
            {name} {!isOnline && '(offline)'}
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

// Improved function to format user names
const formatUserName = (userData) => {
  if (!userData) return '';
  
  // Create a clean name from firstName and lastName
  const firstName = userData.firstName && userData.firstName.trim ? userData.firstName.trim() : '';
  const lastName = userData.lastName && userData.lastName.trim ? userData.lastName.trim() : '';
  
  // Build the full name
  if (firstName && lastName) {
    return `${firstName} ${lastName}`;
  } else if (firstName) {
    return firstName;
  } else if (lastName) {
    return lastName;
  }
  
  // Fallback to email if available
  if (userData.email) {
    const emailParts = userData.email.split('@');
    return emailParts[0].charAt(0).toUpperCase() + emailParts[0].slice(1);
  }
  
  return ''; // Return empty string if no usable name data
};

// Create a special marker for the current user
const CurrentUserMarker = ({ coordinate }) => {
  // OPTIMIZATION: Use useMemo to optimize the marker content
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
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1000} // OPTIMIZATION: Higher zIndex to ensure it's always visible
    >
      {markerContent}
    </Marker>
  );
};

export default function App() {
const mapRef = useRef(null);
const [points, setPoints] = useState([]);
const [currentLocation, setCurrentLocation] = useState(null);
const [isFetchingLocation, setIsFetchingLocation] = useState(false);
const [locationButtonText, setLocationButtonText] = useState("My Location");
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

// Replace the first useEffect with this updated version
useEffect(() => {
  const initializeApp = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser || !navigation) return;
      
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data:', profileData);
        setUserRole(profileData.role);
        console.log('Setting user role to:', profileData.role);
        
        // Check if the user needs to set up a new geofence (after reset approval)
        if (profileData.role === 'owner' && profileData.needsGeofenceSetup === true) {
          console.log('User needs to set up a new geofence');
          
          // Reset the local points array
          setPoints([]);
          
          // Clear the flag
          await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false);
          
          // Redirect to initialization if we have navigation and teamCode
          if (profileData.teamCode && navigation) {
            console.log('Navigating to OwnerInitialization with teamCode:', profileData.teamCode);
            
            // Clear the team's geofence first
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
                    // Double-check that the flag is set to false to prevent redirect loops
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
        
        // Check for geofence points in the user profile first (fastest)
        if (profileData.role === 'owner') {
          // Try to load from user profile first for immediate display
          if (profileData.geofenceData && profileData.geofenceData.coordinates) {
            console.log('Loading geofence from user profile data');
            setPoints(profileData.geofenceData.coordinates);
          } else {
            // If not in profile, check team geofence
            console.log('No geofence in profile, checking team geofence');
            const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
            const geofenceSnapshot = await get(teamGeofenceRef);
            
            if (geofenceSnapshot.exists()) {
              const geofenceData = geofenceSnapshot.val();
              
              // Handle both data structures
              const coordinates = Array.isArray(geofenceData) 
                ? geofenceData 
                : (geofenceData.coordinates || []);
              
              console.log('Found team geofence with', coordinates.length, 'points');
              setPoints(coordinates);
              
              // Also update the profile for next time
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
              // Owner needs to set up geofence points - redirect to initialization
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
          // For members, get team code and load team geofence
          if (profileData.teamCode) {
            // Try to load from local cache first
            if (profileData.teamGeofenceCache && profileData.teamGeofenceCache.coordinates) {
              console.log('Loading team geofence from local cache');
              setTeamGeofence(profileData.teamGeofenceCache.coordinates);
            }
            
            // Always check for updated team geofence
            const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
            const geofenceSnapshot = await get(teamGeofenceRef);
            
            if (geofenceSnapshot.exists()) {
              const geofenceData = geofenceSnapshot.val();
              
              // Handle both data structures
              const coordinates = Array.isArray(geofenceData) 
                ? geofenceData 
                : (geofenceData.coordinates || []);
              
              console.log('Found team geofence with', coordinates.length, 'points');
              setTeamGeofence(coordinates);
              
              // Cache team geofence in user profile
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
        
        // Auto-trigger location tracking for all users
        await toggleCurrentLocation();
      }
    } catch (error) {
      console.error('Error initializing app:', error);
    }
  };

  initializeApp();
}, []);

// Add this useEffect after your other useEffects
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
        
        // Auto-trigger location tracking for members
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

// Add this new useEffect
useEffect(() => {
  const loadTeamGeofence = async () => {
    if (!auth.currentUser || userRole !== 'member') return;
    
    try {
      // Get user's team code
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnapshot = await get(userProfileRef);
      const teamCode = profileSnapshot.val()?.teamCode;
      
      if (teamCode) {
        // Load geofence coordinates
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

// Update the initializeMap function to use fitAllMarkers
const initializeMap = async () => {
  try {
    // Get last known location from Firebase
    const locationsRef = ref(db, "UsersCurrentLocation");
    const locSnapshot = await get(locationsRef);
    
    // If we have user locations stored, initialize map with them
    if (locSnapshot.exists() && Object.keys(locSnapshot.val()).length > 0) {
      // Load user locations into state
      const locations = {};
      Object.entries(locSnapshot.val()).forEach(([userId, userData]) => {
        if (userData.Latitude && userData.Longitude) {
          locations[userId] = userData;
        }
      });
      
      setUsersLocations(locations);
      
      // If we have a current user location, set it
      const currentUserLoc = locSnapshot.val()[auth.currentUser.uid];
      if (currentUserLoc && currentUserLoc.Latitude && currentUserLoc.Longitude) {
        setCurrentLocation({
          latitude: currentUserLoc.Latitude,
          longitude: currentUserLoc.Longitude
        });
      }
      
      // After loading the locations, we'll call fitAllMarkers after a short delay
      // to ensure the locations and points are all loaded
      setTimeout(() => {
        // Force map update during initialization
        fitAllMarkers(true);
      }, 1000);
    } else {
      // If no locations stored, try to get the user's current location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({});
        if (location) {
          const { latitude, longitude } = location.coords;
          setInitialRegion({
            latitude,
            longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          });
          
          // Also set current location if we got it
          setCurrentLocation({
            latitude,
            longitude
          });
        }
      }
    }
  } catch (error) {
    console.error("Error initializing map:", error);
  }
};

const getLocation = async () => {
  // This function is no longer used as we've removed the Set Point button
  console.log("Set Point functionality has been disabled");
  return;
  
  /* 
  // Original code commented out
  if (mapRef.current) {
    const region = await mapRef.current.getMapBoundaries();
    const centerLatitude = (region.northEast.latitude + region.southWest.latitude) / 2;
    const centerLongitude = (region.northEast.longitude + region.southWest.longitude) / 2;
    const newPoint = { latitude: centerLatitude, longitude: centerLongitude };
    
    setPoints((prevPoints) => {
      const updatedPoints = prevPoints.length < 4 ? [...prevPoints, newPoint] : [newPoint];

      if (updatedPoints.length === 4) {
        saveCoordinatesToFirebase(updatedPoints);
      }

      return updatedPoints;
    });
  }
  */
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
    // If location is already set, remove it
    if (currentLocation) {
      console.log("Removing current location");
      setCurrentLocation(null);
      setGpsAccuracy(null);
      
      // OPTIMIZATION: Only update necessary fields when toggling off
      const db = getDatabase();
      const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
      
      // Update with minimal data - only status fields
      await update(userLocationRef, { 
        isActive: false,
        lastSeen: new Date().toISOString(),
      });
      
      return;
    }
    
    // Otherwise, proceed with setting the location
    setIsFetchingLocation(true);
    
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required to share your location.');
      setIsFetchingLocation(false);
      return;
    }

    // OPTIMIZATION: Use lower accuracy for initial location to save battery
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });

    const { latitude, longitude } = location.coords;
    setCurrentLocation({ latitude, longitude });
    setGpsAccuracy(location.coords.accuracy);

    // Update user's location and presence
    const db = getDatabase();
    const userPresenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
    const userLocationRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);

    // Get user profile data - only fetch once
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    let profileData = profileSnapshot.exists() ? profileSnapshot.val() : {};

    // Update location with presence data
    await set(userLocationRef, { 
      Latitude: latitude, 
      Longitude: longitude,
      timestamp: new Date().toISOString(),
      isActive: true,
      lastSeen: new Date().toISOString(),
      ...profileData
    });

    // Set up presence system
    const presenceData = {
      status: 'online',
      lastSeen: new Date().toISOString(),
      deviceInfo: Platform.OS
    };
    await set(userPresenceRef, presenceData);

    // OPTIMIZATION: Set up disconnect hook only once
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // When we disconnect, update the last seen time and status
        onDisconnect(userPresenceRef).update({
          status: 'offline',
          lastSeen: new Date().toISOString()
        });

        // Also update location active status
        onDisconnect(userLocationRef).update({
          isActive: false,
          lastSeen: new Date().toISOString()
        });
      }
    }, { onlyOnce: true }); // OPTIMIZATION: Only run once

    // If user is a member, set up continuous location tracking
    if (userRole === 'member') {
      // Location tracking is now handled by the useEffect hook
      // This avoids duplicate watchers which can cause high battery drain
    }
  } catch (error) {
    console.error("Error toggling location:", error);
    Alert.alert('Error', 'Failed to update location');
  } finally {
    setIsFetchingLocation(false);
  }
};

// Replace the existing location tracking useEffect with this optimized version:
useEffect(() => {
  let locationSubscription = null;

  const startLocationTracking = async () => {
    if (!currentLocation) {
      setGpsAccuracy(null); // Set to null when location is removed
      return;
    }

    try {
      // Check if location services are enabled
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        console.warn("Location services are disabled");
        return;
      }

      // Check and request permissions
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

      // Only check connection when needed - avoid constant checks
      const isConnected = await checkDatabaseConnection();
      if (!isConnected) {
        console.warn("No database connection, location updates will not be saved");
        // Schedule a retry after 30 seconds instead of failing
        setTimeout(startLocationTracking, 30000);
        return;
      }

      // OPTIMIZATION: Increase time intervals to reduce location polling frequency
      // and increase the distance threshold for updates
      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          // Increased from 10 seconds to 15 seconds
          timeInterval: 15000,
          // Increased from 10 meters to 15 meters
          distanceInterval: 15,
        },
        async (location) => {
          try {
            const { latitude, longitude, accuracy } = location.coords;
            
            // OPTIMIZATION: Only process location updates with reasonable accuracy
            if (location.coords.accuracy <= 20) {
              // OPTIMIZATION: Use significant location change detection
              // to minimize processing and battery consumption
              const prevLocation = currentLocation;
              const isSignificant = isSignificantLocationChange(
                prevLocation, 
                { latitude, longitude },
                15 // Increased threshold from 10 to 15 meters
              );
              
              if (isSignificant) {
                // Update location state
                setCurrentLocation({ latitude, longitude });
                setGpsAccuracy(accuracy);
                
                // OPTIMIZATION: Batch Firebase updates to reduce network activity
                if (auth && auth.currentUser && auth.currentUser.uid) {
                  // Cache profile data to avoid redundant fetches
                  if (!userProfileCache) {
                    // Only fetch profile data if not already cached
                    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
                    const profileSnapshot = await get(userProfileRef);
                    userProfileCache = profileSnapshot.exists() ? profileSnapshot.val() : {};
                  }
                  
                  // Use the cached profile data
                  const dbRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
                  const updateData = { 
                    Latitude: latitude, 
                    Longitude: longitude,
                    Accuracy: accuracy,
                    Timestamp: new Date().toISOString(),
                    userId: auth.currentUser.uid,
                    // Use cached profile data
                    firstName: userProfileCache.firstName || '',
                    lastName: userProfileCache.lastName || '',
                    photoURL: userProfileCache.photoURL || '',
                    role: userProfileCache.role || '',
                    teamCode: userProfileCache.teamCode || ''
                  };
                  
                  // OPTIMIZATION: Use update instead of set to reduce data transfer
                  update(dbRef, updateData);
                }
              }
            }
          } catch (error) {
            console.error("Error updating location:", error);
            setGpsAccuracy(null);
          }
        }
      );
    } catch (error) {
      console.error("Error starting location tracking:", error);
      setGpsAccuracy(null);
    }
  };

  // Initialize tracking with user profile cache
  let userProfileCache = null;
  if (currentLocation) {
    startLocationTracking();
  }

  return () => {
    if (locationSubscription) {
      locationSubscription.remove();
    }
    // Clear cache on cleanup
    userProfileCache = null;
  };
}, [currentLocation]);

// Add optimized implementation of significant location change detection
const isSignificantLocationChange = (prevLocation, newLocation, threshold = 15) => {
  if (!prevLocation) return true;
  
  // OPTIMIZATION: Use a simplified distance calculation that's less CPU intensive
  // for frequent checks compared to the full haversine formula
  const fastDistanceCheck = (point1, point2) => {
    // Quick approximation for small distances - uses less CPU
    const latDiff = (point2.latitude - point1.latitude) * 111000; // 1 degree lat ≈ 111km
    const lngDiff = (point2.longitude - point1.longitude) * 
                    Math.cos(point1.latitude * Math.PI / 180) * 111000;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  };
  
  const distance = fastDistanceCheck(prevLocation, newLocation);
  return distance > threshold;
};

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
  const R = 6371e3; // Earth radius in meters
  const lat1 = (point1.latitude * Math.PI) / 180;
  const lat2 = (point2.latitude * Math.PI) / 180;
  const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const deltaLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
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
    
    // 1. Save to global geofence for compatibility
    const globalRef = ref(db, "geofence/coordinates");
    set(globalRef, coordinates)
      .then(() => console.log("Global coordinates saved successfully"))
      .catch((error) => console.error("Error saving global coordinates:", error));
    
    // 2. Get user profile data
    get(ref(db, `users/${auth.currentUser.uid}/profile`))
      .then((snapshot) => {
        if (snapshot.exists()) {
          const userData = snapshot.val();
          
          if (userData.role === 'owner' && userData.teamCode) {
            // 3. Save to team-specific geofence
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
            
            // 4. Save to user profile for quick access
            const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
            set(userProfileGeofenceRef, {
              coordinates: coordinates,
              teamCode: userData.teamCode,
              lastModified: new Date().toISOString()
            })
              .then(() => console.log("User profile geofence saved successfully"))
              .catch((error) => console.error("Error saving to user profile:", error));
            
            // 5. Check if this is an update after initialization
            get(ref(db, `teams/${userData.teamCode}/geofenceModified`))
              .then((modifiedSnapshot) => {
                // If already exists in database, this is an update
                if (modifiedSnapshot.exists()) {
                  // Create admin change request
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
                  // First time setup, mark as modified
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

// Optimize the fitAllMarkers function to better handle marker visibility
const fitAllMarkers = (forceUpdate = false) => {
  if (!mapRef.current) return;
  
  // Only update if we're forcing an update or auto-fit is enabled
  if (!forceUpdate && !shouldAutoFit) return;
  
  // Re-enable auto-fit for the next location change
  setShouldAutoFit(true);
  
  // OPTIMIZATION: Add slight delay to ensure map is ready
  setTimeout(() => {
    // Create an array of all coordinates to include in the view
    const allCoordinates = [];
    
    // First prioritize geofence points to ensure they're in view
    const geofencePoints = userRole === 'member' ? teamGeofence : points;
    if (geofencePoints.length >= 3) {
      // If we have a proper geofence, prioritize showing all of it
      geofencePoints.forEach(point => {
        allCoordinates.push(point);
      });
      
      // Add current location only if we have space
      if (currentLocation) {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
      // Add selected team members' locations
      if (usersLocations) {
        Object.entries(usersLocations).filter(([userId, userData]) => {
          // Only include team members
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
      // If no proper geofence, just show all points
      // Add current location if available
      if (currentLocation) {
        allCoordinates.push({
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude
        });
      }
      
      // Add all user locations
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
      
      // Add any available geofence points
      if (geofencePoints.length > 0) {
        geofencePoints.forEach(point => {
          allCoordinates.push(point);
        });
      }
    }
    
    // If we have coordinates, fit the map to show all of them
    if (allCoordinates.length > 0) {
      // OPTIMIZATION: Calculate appropriate padding based on what we're showing
      // Add more padding to ensure markers stay visible
      const edgePadding = geofencePoints.length >= 3 
        ? { top: 100, right: 100, bottom: 200, left: 100 } // More padding for geofence
        : { top: 200, right: 200, bottom: 300, left: 200 }; // Even more zoomed out for scattered points
      
      mapRef.current.fitToCoordinates(allCoordinates, {
        edgePadding: edgePadding,
        animated: true
      });
      
      // OPTIMIZATION: Temporary enable tracksViewChanges during animation
      setTrackViewChanges(true);
      
      // Disable tracking after animation completes
      setTimeout(() => {
        setTrackViewChanges(false);
      }, 1000); // 1 second timeout for animation to complete
    } else {
      // If no coordinates, just use a default view with more zoom-out
      mapRef.current.animateToRegion({
        ...initialRegion,
        latitudeDelta: 0.03,  // More zoomed out for better context
        longitudeDelta: 0.03
      }, 1000);
    }
  }, 100); // Add 100ms delay to ensure map is ready
};

// Update the useEffect to only auto-fit when needed
useEffect(() => {
  // Only auto-fit if the flag is true
  if (shouldAutoFit && (Object.keys(usersLocations).length > 0 || currentLocation)) {
    fitAllMarkers();
    // Disable auto-fitting after the first adjustment
    setShouldAutoFit(false);
  }
}, [usersLocations, currentLocation, shouldAutoFit]);

// Add this useEffect to initialize the map when first loaded
useEffect(() => {
  initializeMap();
}, []);

// Add this useEffect to properly load all user locations
useEffect(() => {
  // This function loads all user locations from Firebase
  const loadAllUserLocations = async () => {
    try {
      // Only log once at the beginning of loading
      console.log("Loading user locations...");
      const locationsRef = ref(db, "UsersCurrentLocation");
      
      // Use onValue to get real-time updates
      const unsubscribe = onValue(locationsRef, (snapshot) => {
        if (snapshot.exists()) {
          const locationsData = snapshot.val();
          
          // Convert the data to our expected format
          const formattedLocations = {};
          
          // Process each location entry and fetch corresponding user profile data
          const fetchUserProfiles = async () => {
            for (const [userId, userData] of Object.entries(locationsData)) {
              if (userData && userData.Latitude && userData.Longitude) {
                try {
                  // Get user's profile data
                  const userProfileRef = ref(db, `users/${userId}/profile`);
                  const profileSnapshot = await get(userProfileRef);
                  
                  if (profileSnapshot.exists()) {
                    const profileData = profileSnapshot.val();
                    
                    // Prepare a proper display name
                    let displayName = '';
                    if (profileData.firstName && profileData.firstName.trim() !== '') {
                      displayName = profileData.firstName;
                      if (profileData.lastName && profileData.lastName.trim() !== '') {
                        displayName += ' ' + profileData.lastName;
                      }
                    } else if (profileData.lastName && profileData.lastName.trim() !== '') {
                      displayName = profileData.lastName;
                    }
                    
                    // Combine location data with profile data
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
                    // If no profile data, still include location data but with empty fields
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
            
            // Update the state with all locations
            setUsersLocations(formattedLocations);
          };
          
          fetchUserProfiles();
        } else {
          console.log("No user locations found in database");
          setUsersLocations({});
        }
      });
      
      // Return cleanup function
      return unsubscribe;
    } catch (error) {
      console.error("Error loading user locations:", error);
    }
  };
  
  loadAllUserLocations();
}, [db]); // Only run this once when the database is available

// Add this function to get a unique color based on user ID or any string
const getUniqueColor = (str) => {
  // Generate a hash from the input string
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // List of nice, distinct colors
  const colors = [
    '#3498db', // Blue
    '#e74c3c', // Red
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Teal
    '#d35400', // Dark Orange
    '#2980b9', // Dark Blue
    '#8e44ad', // Dark Purple
    '#27ae60', // Dark Green
    '#f1c40f', // Yellow
    '#16a085', // Dark Teal
    '#e67e22', // Light Orange
    '#c0392b', // Dark Red
    '#7f8c8d'  // Gray
  ];
  
  // Use the hash to pick a color
  const index = Math.abs(hash) % colors.length;
  return colors[index];
};

// Add this function to calculate marker label positions
const calculateMarkerLabelPositions = (locations) => {
  const positionMap = {};
  const locationGroups = {};
  
  // Group markers by proximity (within 50 meters)
  Object.entries(locations).forEach(([userId, userData]) => {
    if (!userData || !userData.Latitude || !userData.Longitude) return;
    
    const coord = { latitude: userData.Latitude, longitude: userData.Longitude };
    let foundGroup = false;
    
    // Check if this location is close to an existing group
    Object.keys(locationGroups).forEach(groupId => {
      const groupCoord = locationGroups[groupId];
      if (calculateDistance(coord, groupCoord) < 30) { // Reduced from 50 to 30 meters for tighter grouping
        if (!locationGroups[groupId].members) {
          locationGroups[groupId].members = [];
        }
        locationGroups[groupId].members.push(userId);
        foundGroup = true;
      }
    });
    
    // If not close to any existing group, create a new one
    if (!foundGroup) {
      locationGroups[userId] = {
        latitude: coord.latitude,
        longitude: coord.longitude,
        members: [userId]
      };
    }
  });
  
  // Assign positions for markers in each group
  Object.values(locationGroups).forEach(group => {
    if (!group.members || group.members.length <= 1) {
      // Single marker, use bottom position
      if (group.members && group.members.length === 1) {
        positionMap[group.members[0]] = 'bottom';
      }
    } else {
      // Multiple markers close together
      // Distribute around the point: top, right, bottom, left
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

// When user locations are updated, recalculate label positions
useEffect(() => {
  if (Object.keys(usersLocations).length > 0) {
    const positions = calculateMarkerLabelPositions(usersLocations);
    setMarkerPositions(positions);
  }
}, [usersLocations]);

// Add notification checking effect
useEffect(() => {
  const checkNotifications = async () => {
    if (!auth.currentUser || !navigation) return;
    
    try {
      const db = getDatabase();
      const notificationsRef = ref(db, `notifications/${auth.currentUser.uid}`);
      
      // Check for unread notifications
      const snapshot = await get(notificationsRef);
      if (snapshot.exists()) {
        const notifications = Object.entries(snapshot.val());
        const unreadNotifications = notifications.filter(([_, notification]) => 
          notification.read === false
        );
        
        console.log(`Found ${unreadNotifications.length} unread notifications`);
        
        // Process unread geofence notifications
        for (const [notificationId, notification] of unreadNotifications) {
          if (notification.type === 'geofence_approved' || notification.type === 'geofence_rejected') {
            // Mark as read
            await set(ref(db, `notifications/${auth.currentUser.uid}/${notificationId}/read`), true);
            
            // Show alert
            Alert.alert(
              notification.title,
              notification.message,
              [{ text: 'OK' }]
            );
            
            // If geofence reset was approved, check if we need to reinitialize
            if (notification.type === 'geofence_approved' && userRole === 'owner') {
              const profileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
              const profileSnapshot = await get(profileRef);
              
              if (profileSnapshot.exists()) {
                const profileData = profileSnapshot.val();
                
                if (profileData.needsGeofenceSetup) {
                  // Set local state to trigger reinit
                  setPoints([]);
                  
                  // Clear the flag
                  await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false);
                  
                  // Redirect to initialization
                  Alert.alert(
                    'Geofence Reset Approved',
                    'You can now set up a new geofence for your team.',
                    [
                      { 
                        text: 'Set Up Now', 
                        onPress: () => {
                          const teamCode = profileData.teamCode;
                          if (teamCode && navigation) {
                            // Force clear the team's existing geofence in database
                            const teamGeofenceRef = ref(db, `teams/${teamCode}/geofence/coordinates`);
                            set(teamGeofenceRef, [])
                              .then(() => {
                                console.log('Team geofence cleared successfully');
                                
                                // Make sure to set needsGeofenceSetup flag to false to prevent redirection loops
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
                                // Try to navigate anyway if clearing fails
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
  
  // Check on component mount and when user role changes
  checkNotifications();
}, [auth.currentUser, userRole, navigation, db]);

// Add an effect to handle map region changes
useEffect(() => {
  const handleMapRegionChange = () => {
    if (!trackViewChanges) {
      // Temporarily enable tracking when region changes
      setTrackViewChanges(true);
      
      // Disable tracking after animation completes
      setTimeout(() => {
        setTrackViewChanges(false);
      }, 500);
    }
  };
  
  if (mapRef.current) {
    // We can't directly add a listener, but we can enable tracking when needed
    handleMapRegionChange();
  }
  
  // Clean up
  return () => {
    setTrackViewChanges(false);
  };
}, [currentLocation, usersLocations, points, teamGeofence]);

if (!db) {
  console.error("Firebase database not initialized");
  return;
}

return (
  <View style={styles.container}>
    {gpsAccuracy !== null && <GPSStrengthIndicator accuracy={gpsAccuracy} />}
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
      moveOnMarkerPress={false} // OPTIMIZATION: Prevent auto-centering on marker press
      loadingEnabled={true} // OPTIMIZATION: Enable loading indicator
      loadingIndicatorColor="#2196F3"
      loadingBackgroundColor="rgba(255,255,255,0.7)"
    >
      {userRole === 'member' ? (
        <>
          {teamGeofence.length >= 3 && (
            <Polygon 
              coordinates={teamGeofence} 
              fillColor="rgba(0,0,255,0.2)" 
              strokeColor="blue" 
              strokeWidth={2} 
            />
          )}
          {teamGeofence.length >= 2 && teamGeofence.map((point, index) => {
            const nextIndex = (index + 1) % teamGeofence.length;
            const nextPoint = teamGeofence[nextIndex];
            
            // Skip if we're drawing a line back to the first point but haven't completed a polygon
            if (nextIndex === 0 && teamGeofence.length < 3) return null;
            
            // Calculate the midpoint for the label
            const midPoint = {
              latitude: (point.latitude + nextPoint.latitude) / 2,
              longitude: (point.longitude + nextPoint.longitude) / 2
            };
            
            // Calculate the distance
            const distance = calculateDistance(point, nextPoint);
            const distanceText = distance < 1000 
              ? `${Math.round(distance)}m` 
              : `${(distance / 1000).toFixed(2)}km`;
            
            return (
              <React.Fragment key={`distance-${index}`}>
                {/* Polyline between points */}
                <Polygon
                  coordinates={[point, nextPoint]}
                  strokeColor="rgba(255, 0, 0, 0.7)"
                  strokeWidth={2}
                  fillColor="transparent"
                />
                {/* Distance marker */}
                <Marker
                  coordinate={midPoint}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={trackViewChanges} // Use the state instead of hardcoded false
                  zIndex={500} // Higher zIndex for better visibility
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
          {points.map((point, index) => (
            <Marker key={index} coordinate={point} title={`Point ${index + 1}`} />
          ))}
          {points.length >= 3 && (
            <Polygon 
              coordinates={points} 
              fillColor="rgba(0,0,255,0.3)" 
              strokeColor="blue" 
              strokeWidth={2} 
            />
          )}
          {points.length >= 2 && points.map((point, index) => {
            // Calculate distance to the next point (or back to the first point if this is the last one)
            const nextIndex = (index + 1) % points.length;
            const nextPoint = points[nextIndex];
            
            // Skip if we're drawing a line back to the first point but haven't completed a polygon
            if (nextIndex === 0 && points.length < 3) return null;
            
            // Calculate the midpoint for the label
            const midPoint = {
              latitude: (point.latitude + nextPoint.latitude) / 2,
              longitude: (point.longitude + nextPoint.longitude) / 2
            };
            
            // Calculate the distance
            const distance = calculateDistance(point, nextPoint);
            const distanceText = distance < 1000 
              ? `${Math.round(distance)}m` 
              : `${(distance / 1000).toFixed(2)}km`;
            
            return (
              <React.Fragment key={`distance-${index}`}>
                {/* Polyline between points */}
                <Polygon
                  coordinates={[point, nextPoint]}
                  strokeColor="rgba(255, 0, 0, 0.7)"
                  strokeWidth={2}
                  fillColor="transparent"
                />
                {/* Distance marker */}
                <Marker
                  coordinate={midPoint}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={trackViewChanges} // Use the state instead of hardcoded false
                  zIndex={500} // Higher zIndex for better visibility
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
      {currentLocation && (
        <CurrentUserMarker
          coordinate={currentLocation}
        />
      )}
      {Object.entries(usersLocations || {})
        .filter(([userId, userData]) => {
          if (!userData || !userData.Latitude || !userData.Longitude) return false;
          if (userId === auth.currentUser?.uid) return false;
          
          if (userData.role === 'admin' || userData.isAdmin) {
            const currentUserProfile = usersLocations[auth.currentUser?.uid];
            if (!currentUserProfile?.isAdmin && currentUserProfile?.role !== 'admin') {
              return false;
            }
          }
          
          if (userRole === 'member') {
            const currentUserProfile = usersLocations[auth.currentUser?.uid];
            return userData.teamCode === currentUserProfile?.teamCode;
          }
          
          if (userRole === 'owner') {
            const currentUserProfile = usersLocations[auth.currentUser?.uid];
            return userData.teamCode === currentUserProfile?.teamCode;
          }
          
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
            labelPosition={markerPositions[userId] || 'bottom'}
            markerColor={getUniqueColor(userId)}
            isOnline={userData.isActive !== false}
          />
        ))
      }
    </MapView>

    <View style={styles.toolbarContainer}>
      {userRole !== 'member' ? (
        <>
          <View style={styles.pointsIndicator}>
            <Text style={styles.pointsText}>Number of Geofenced Points: {points.length}</Text>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={toggleCurrentLocation}>
              <Ionicons name="navigate" size={20} color="white" />
              <Text style={styles.buttonText}>
                {isFetchingLocation ? "Loading..." : currentLocation ? "Remove Loc" : "My Location"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.buttonCenter]} 
              onPress={() => {
                // Focus specifically on the geofence
                if (points.length >= 3 && mapRef.current) {
                  mapRef.current.fitToCoordinates(points, {
                    edgePadding: { top: 50, right: 50, bottom: 150, left: 50 },
                    animated: true
                  });
                } else {
                  // If no complete geofence, use regular centering
                  fitAllMarkers(true);
                }
              }}
            >
              <Ionicons name="expand" size={20} color="white" />
              <Text style={styles.buttonText}>Center Map</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={[styles.button, styles.resetButton]}
            onPress={() => {
              // First check if geofence exists by checking points length
              const auth = getAuth();
              if (!auth.currentUser) return;
              
              // Check user profile and team data
              get(ref(db, `users/${auth.currentUser.uid}/profile`))
                .then((snapshot) => {
                  if (snapshot.exists()) {
                    const userData = snapshot.val();
                    
                    if (userData.role === 'owner' && userData.teamCode) {
                      // Check if geofence exists by looking at team geofence data
                      get(ref(db, `teams/${userData.teamCode}/geofence/coordinates`))
                        .then((geofenceSnapshot) => {
                          const hasGeofence = geofenceSnapshot.exists() && 
                                             Array.isArray(geofenceSnapshot.val()) && 
                                             geofenceSnapshot.val().length >= 3;
                          
                          if (hasGeofence) {
                            // Geofence exists - show reset confirmation
                            Alert.alert(
                              'Request Geofence Reset',
                              'Are you sure you want to request a reset of the existing geofence area? This will require admin approval.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                { 
                                  text: 'Request Reset', 
                                  style: 'destructive',
                                  onPress: () => {
                                    // Create admin reset request
                                    const resetRequestRef = ref(db, `adminRequests/geofenceReset/${userData.teamCode}`);
                                    const currentPoints = geofenceSnapshot.val();
                                    
                                    // Create the request with all required data
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
                            // No geofence exists - directly navigate to initialization
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
        </>
      ) : (
        <>
          <View style={styles.memberMessage}>
            <Text style={styles.memberText}>Member View - Location tracking active</Text>
          </View>
          <TouchableOpacity 
            style={[styles.button, styles.buttonCenter, styles.memberCenterButton]} 
            onPress={() => {
              // Focus specifically on the team geofence for members
              if (teamGeofence.length >= 3 && mapRef.current) {
                mapRef.current.fitToCoordinates(teamGeofence, {
                  edgePadding: { top: 50, right: 50, bottom: 150, left: 50 },
                  animated: true
                });
              } else {
                // If no complete geofence, use regular centering
                fitAllMarkers(true);
              }
            }}
          >
            <Ionicons name="expand" size={20} color="white" />
            <Text style={styles.buttonText}>Center Map</Text>
          </TouchableOpacity>
        </>
      )}
    </View>

    <Navbar activePage="maps" />
  </View>
);
} 

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  map: {
    width: "100%",
    height: "100%",
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
    shadowOffset: {
      width: 0,
      height: 2,
    },
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
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    padding: 8,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 1,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  gpsBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 16,
  },
  gpsBar: {
    width: 3,
    borderRadius: 2,
  },
  gpsAccuracy: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  gpsNoSignal: {
    color: '#FF3B30',
    fontWeight: '600',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    maxWidth: 150,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
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
});
