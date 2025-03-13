import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, SafeAreaView, Animated } from "react-native";
import MapView, { Marker, Polygon, Circle } from "react-native-maps";
import * as Location from "expo-location";
import { getDatabase, ref, set, push, get, remove, child, onValue } from "firebase/database";
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

export default function App() {
const mapRef = useRef(null);
const [points, setPoints] = useState([]);
const [subZones, setSubZones] = useState([]);
const [currentLocation, setCurrentLocation] = useState(null);
const [isFetchingLocation, setIsFetchingLocation] = useState(false);
 const [locationButtonText, setLocationButtonText] = useState("My Location");
const [subZoneDiameter, setSubZoneDiameter] = useState(10);
const [selectedSubZone, setSelectedSubZone] = useState(null);
const [subZoneCount, setSubZoneCount] = useState(0);
const [previewCircle, setPreviewCircle] = useState(null);
const [isDrawingComplete, setIsDrawingComplete] = useState(false);
const [isDrawing, setIsDrawing] = useState(false);
const [initialRegion, setInitialRegion] = useState({
  latitude: 14.5995,
  longitude: 120.9842,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
});
const navigation = useNavigation();
const [userRole, setUserRole] = useState(null);
const [teamGeofence, setTeamGeofence] = useState([]);
const [teamSubzones, setTeamSubzones] = useState([]);
const [gpsAccuracy, setGpsAccuracy] = useState(null);

// Replace the first useEffect with this updated version
useEffect(() => {
  const initializeApp = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        setUserRole(profileData.role);
        
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
        
        // Load subzones
        const subzonesRef = ref(db, "geofence/subzones");
        const subzonesSnapshot = await get(subzonesRef);
        if (subzonesSnapshot.exists()) {
          setTeamSubzones(Object.values(subzonesSnapshot.val()));
        }
      }
    } catch (error) {
      console.error("Error loading team geofence:", error);
    }
  };

  loadTeamGeofence();
}, [userRole]);

const getLocation = async () => {
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
};

const isSubZoneCrossingPolygonEdges = (subZone, polygon) => {
  const radius = subZone.diameter / 2;

  for (let i = 0; i < polygon.length; i++) {
    let p1 = polygon[i];
    let p2 = polygon[(i + 1) % polygon.length]; // Next point in the polygon

    // Compute the closest distance from the subzone center to the edge
    const distance = distanceFromPointToLine(subZone, p1, p2);

    if (distance < radius) {
      return true; // Subzone crosses the edge
    }
  }
  return false;
};

// Function to compute the shortest distance from a point to a line segment
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
  if (currentLocation && userRole !== 'member') {
    setCurrentLocation(null);
    setLocationButtonText("My Location");
    console.log("Location removed");
    return;
  }

  setIsFetchingLocation(true);
  try {
    // First check if location services are enabled
    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      alert("Please enable location services in your device settings");
      setIsFetchingLocation(false);
      return;
    }

    // Check location permissions
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      // Request permission if not granted
      const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
      if (newStatus !== 'granted') {
        alert("Permission to access location was denied. Please enable it in your device settings.");
        setIsFetchingLocation(false);
        return;
      }
    }

    // Get current position with balanced accuracy
    let location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10000, // Increased to 10 seconds
      distanceInterval: 10, // Increased to 10 meters
    });

    if (!location) {
      throw new Error("Could not get location");
    }

    const { latitude, longitude } = location.coords;
    setCurrentLocation({ latitude, longitude });
    setLocationButtonText("Remove Loc");

    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude,
        longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    }

    const dbRef = ref(db, `UsersCurrentLocation/${auth.currentUser.uid}`);
    await set(dbRef, { 
      Latitude: latitude, 
      Longitude: longitude,
      timestamp: new Date().toISOString(),
    });
    
    // If user is a member, set up continuous location tracking with optimized settings
    if (userRole === 'member') {
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000, // Increased to 10 seconds
          distanceInterval: 10, // Increased to 10 meters
        },
        (location) => {
          if (location) {
            const { latitude, longitude } = location.coords;
            setCurrentLocation({ latitude, longitude });
            set(dbRef, { 
              Latitude: latitude, 
              Longitude: longitude,
              timestamp: new Date().toISOString(),
            });
          }
        },
        (error) => {
          console.error("Error in location tracking:", error);
          // Try to restart tracking if there's an error
          if (error.code === 'kCLErrorLocationUnknown') {
            toggleCurrentLocation();
          }
        }
      );
    }
  } catch (error) {
    console.error("Error fetching location:", error);
    let errorMessage = "Could not get your location. ";
    
    if (error.code === 'kCLErrorLocationUnknown') {
      errorMessage += "Please check your GPS signal and try again.";
    } else if (error.code === 'kCLErrorDenied') {
      errorMessage += "Location access was denied.";
    } else if (error.code === 'kCLErrorNetwork') {
      errorMessage += "Network error occurred.";
    } else {
      errorMessage += "Please try again.";
    }
    
    alert(errorMessage);
    setLocationButtonText("My Location");
  } finally {
    setIsFetchingLocation(false);
  }
};

// Replace the existing location tracking useEffect with this:
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

      const isConnected = await checkDatabaseConnection();
      if (!isConnected) {
        console.warn("No database connection, location updates will not be saved");
        return;
      }

      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10000,
          distanceInterval: 10,
        },
        async (location) => {
          try {
            const { latitude, longitude, accuracy } = location.coords;
            
            if (location.coords.accuracy <= 20) {
              setCurrentLocation({ latitude, longitude });
              setGpsAccuracy(accuracy);
              
              const dbRef = ref(db, "UsersCurrentLocation");
              await set(dbRef, { 
                Latitude: latitude, 
                Longitude: longitude,
                Accuracy: accuracy,
                Timestamp: new Date().toISOString(),
                userId: auth.currentUser?.uid
              });
            }
          } catch (error) {
            console.error("Error updating location:", error);
            setGpsAccuracy(null); // Set to null on error
          }
        },
        (error) => {
          console.error("Error in location tracking:", error);
          setGpsAccuracy(null); // Set to null on error
          if (error.code === 'kCLErrorLocationUnknown' || error.code === 'kCLErrorDenied') {
            startLocationTracking();
          }
        }
      );
    } catch (error) {
      console.error("Error starting location tracking:", error);
      setGpsAccuracy(null); // Set to null on error
    }
  };

  if (currentLocation) {
    startLocationTracking();
  }

  return () => {
    if (locationSubscription) {
      locationSubscription.remove();
    }
  };
}, [currentLocation]);

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

// Add this helper function to find the next available number
const findNextAvailableNumber = (existingSubzones) => {
  const usedNumbers = new Set();
  
  // Get all existing subzone numbers
  existingSubzones.forEach(key => {
    if (key.startsWith('Subzone ')) {
      const num = parseInt(key.split(' ')[1]);
      if (!isNaN(num)) usedNumbers.add(num);
    }
  });
  
  // Find the first available number
  let nextNum = 1;
  while (usedNumbers.has(nextNum)) {
    nextNum++;
  }
  return nextNum;
};

const addSubZone = async () => {
  if (!await checkDatabaseConnection()) {
    alert("No connection to database. Please check your internet connection.");
    return;
  }
  if (!mapRef.current || points.length < 3) {
    alert("Please define the geofence area first (minimum 3 points needed).");
    return;
  }

  const region = await mapRef.current.getMapBoundaries();
  const centerLatitude = (region.northEast.latitude + region.southWest.latitude) / 2;
  const centerLongitude = (region.northEast.longitude + region.southWest.longitude) / 2;
  const newSubZone = { latitude: centerLatitude, longitude: centerLongitude, diameter: subZoneDiameter };

  // Check if the subzone is inside the geofence
  if (!isPointInsidePolygon(newSubZone, points)) {
    alert("Subzone must be inside the geofence.");
    return;
  }

  // Check if the subzone overlaps with existing subzones
  for (let zone of subZones) {
    const distance = calculateDistance(zone, newSubZone);
    if (distance < (zone.diameter / 2 + newSubZone.diameter / 2)) {
      alert("Subzone overlaps with an existing one.");
      return;
    }
  }

  // Check if subzone crosses the polygon's sides
  for (let i = 0; i < points.length; i++) {
    let p1 = points[i];
    let p2 = points[(i + 1) % points.length];

    let d1 = calculateDistance(p1, newSubZone);
    let d2 = calculateDistance(p2, newSubZone);
    
    if (d1 < newSubZone.diameter / 2 || d2 < newSubZone.diameter / 2) {
      alert("Subzone cannot cross the geofence boundary.");
      return;
    }
  }

  try {
    // Get current subzones to find next available number
    const subzonesRef = ref(db, "geofence/subzones");
    const snapshot = await get(subzonesRef);
    const existingKeys = snapshot.exists() ? Object.keys(snapshot.val()) : [];
    const nextNumber = findNextAvailableNumber(existingKeys);

    // Save the valid subzone
    setSubZones((prevZones) => [...prevZones, newSubZone]);
    const dbRef = ref(db, `geofence/subzones/Subzone ${nextNumber}`);
    await set(dbRef, newSubZone);
    console.log(`Subzone ${nextNumber} saved to Firebase:`, newSubZone);
  } catch (error) {
    console.error("Error saving subzone:", error);
    alert("Failed to save subzone. Please try again.");
  }
};

const saveCoordinatesToFirebase = (coordinates) => {
  const dbRef = ref(db, "geofence/coordinates");
  set(dbRef, coordinates)
    .then(() => console.log("Coordinates saved successfully"))
    .catch((error) => console.error("Error saving coordinates:", error));
};

const checkCrosshairOverSubZone = async () => {
  if (!mapRef.current) return;
  
  const region = await mapRef.current.getMapBoundaries();
  const centerLatitude = (region.northEast.latitude + region.southWest.latitude) / 2;
  const centerLongitude = (region.northEast.longitude + region.southWest.longitude) / 2;
  const crosshairPoint = { latitude: centerLatitude, longitude: centerLongitude };

  // Check each subzone
  for (let zone of subZones) {
    const distance = calculateDistance(zone, crosshairPoint);
    if (distance <= zone.diameter / 2) {
      setSelectedSubZone(zone);
      return;
    }
  }
  setSelectedSubZone(null);
};

const removeSubZone = async () => {
  if (!selectedSubZone) return;

  try {
    // Remove from state
    setSubZones(prevZones => prevZones.filter(zone => 
      zone.latitude !== selectedSubZone.latitude || 
      zone.longitude !== selectedSubZone.longitude
    ));

    // Remove from Firebase
    const dbRef = ref(db, "geofence/subzones");
    const snapshot = await get(dbRef);
    
    if (snapshot.exists()) {
      snapshot.forEach((childSnapshot) => {
        const zoneData = childSnapshot.val();
        if (zoneData.latitude === selectedSubZone.latitude && 
            zoneData.longitude === selectedSubZone.longitude) {
          remove(ref(db, `geofence/subzones/${childSnapshot.key}`));
        }
      });
    }

    setSelectedSubZone(null);
    console.log("Subzone removed successfully");
  } catch (error) {
    console.error("Error removing subzone:", error);
    alert("Failed to remove subzone. Please try again.");
  }
};

const updatePreviewCircle = async () => {
  if (!mapRef.current) return;
  
  const region = await mapRef.current.getMapBoundaries();
  const centerLatitude = (region.northEast.latitude + region.southWest.latitude) / 2;
  const centerLongitude = (region.northEast.longitude + region.southWest.longitude) / 2;
  
  setPreviewCircle({
    latitude: centerLatitude,
    longitude: centerLongitude,
    diameter: subZoneDiameter
  });
};

useEffect(() => {
  const loadSubZones = async () => {
    if (!db) {
      console.error("Database not initialized");
      return;
    }

    try {
      const dbRef = ref(db, "geofence/subzones");
      if (!dbRef) {
        console.error("Failed to create database reference");
        return;
      }

      const snapshot = await get(dbRef);
      if (snapshot.exists()) {
        const subZonesData = [];
        let maxNumber = 0;
        
        snapshot.forEach((childSnapshot) => {
          subZonesData.push(childSnapshot.val());
          // Extract number from "Subzone X" format
          const subzoneNumber = parseInt(childSnapshot.key.split(' ')[1]);
          maxNumber = Math.max(maxNumber, subzoneNumber);
        });
        
        setSubZones(subZonesData);
        setSubZoneCount(maxNumber);
      }
    } catch (error) {
      console.error("Error loading subzones:", error);
      // Add more specific error handling
      if (error.message.includes('sendRequest')) {
        console.error("Firebase connection error. Please check your internet connection.");
      }
    }
  };

  loadSubZones();
}, []);

useEffect(() => {
  const interval = setInterval(checkCrosshairOverSubZone, 500);
  return () => clearInterval(interval);
}, [subZones]);

useEffect(() => {
  const interval = setInterval(updatePreviewCircle, 500);
  return () => clearInterval(interval);
}, [subZoneDiameter]);

useEffect(() => {
  const loadCoordinates = async () => {
    try {
      const coordRef = ref(db, "geofence/coordinates");
      const snapshot = await get(coordRef);
      
      if (snapshot.exists()) {
        const coordinates = snapshot.val();
        if (Array.isArray(coordinates) && coordinates.length >= 3) {
          setPoints(coordinates);
          setIsDrawing(false); 
          setIsDrawingComplete(true); 
          console.log("Coordinates loaded from Firebase:", coordinates);
        }
      }
    } catch (error) {
      console.error("Error loading coordinates:", error);
    }
  };

  loadCoordinates();
}, []); 

useEffect(() => {
  if (!isDrawing && points.length >= 3) {
    setIsDrawingComplete(true);
    saveCoordinatesToFirebase(points);
  }
}, [isDrawing, points]);

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
      onPress={(e) => {
        if (userRole !== 'member') {
          const newPoint = e.nativeEvent.coordinate;
          setPoints(prevPoints => {
            const updatedPoints = [...prevPoints, newPoint];
            if (updatedPoints.length === 4) {
              saveCoordinatesToFirebase(updatedPoints);
            }
            return updatedPoints;
          });
        }
      }}
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
          {teamSubzones.map((zone, index) => (
            <Circle
              key={index}
              center={{ latitude: zone.latitude, longitude: zone.longitude }}
              radius={zone.diameter * 0.5}
              fillColor="rgba(255,0,0,0.2)"
              strokeColor="red"
              strokeWidth={2}
            />
          ))}
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
          {subZones.map((zone, index) => (
            <Circle
              key={index}
              center={{ latitude: zone.latitude, longitude: zone.longitude }}
              radius={zone.diameter * 0.5}
              fillColor="rgba(255,0,0,0.3)"
              strokeColor="red"
              strokeWidth={2}
            />
          ))}
        </>
      )}
      {currentLocation && (
        <Marker coordinate={currentLocation} title="Current Location" pinColor="green" />
      )}
    </MapView>

    {userRole !== 'member' && (
      <View style={styles.crosshair} pointerEvents="none">
        <Text style={styles.crosshairText}>+</Text>
      </View>
    )}

    <View style={styles.toolbarContainer}>
      {userRole !== 'member' ? (
        <>
          <View style={styles.pointsIndicator}>
            <Text style={styles.pointsText}>Number of Geofenced Points: {points.length}</Text>
          </View>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              placeholder="Enter Diameter (meters)"
              keyboardType="numeric"
              placeholderTextColor="#666"
              onChangeText={(text) => {
                const newDiameter = parseFloat(text) || 10;
                setSubZoneDiameter(newDiameter);
                updatePreviewCircle();
              }}
            />
          </View>
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.button} onPress={getLocation}>
              <Ionicons name="location" size={20} color="white" />
              <Text style={styles.buttonText}>Set Point</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={toggleCurrentLocation}>
              <Ionicons name="navigate" size={20} color="white" />
              <Text style={styles.buttonText}>
                {isFetchingLocation ? "Loading..." : currentLocation ? "Remove Loc" : "My Location"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.buttonSubZone, selectedSubZone && { backgroundColor: '#FF3B30' }]} 
              onPress={selectedSubZone ? removeSubZone : addSubZone}
            >
              <Ionicons name={selectedSubZone ? "trash" : "add-circle"} size={20} color="white" />
              <Text style={styles.buttonText}>
                {selectedSubZone ? "Remove" : "Add Zone"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, styles.buttonReset]} 
              onPress={() => {
                setPoints([]);
                setSubZones([]);
                // Clear subzones from Firebase
                const dbRef = ref(db, "geofence/subzones");
                set(dbRef, {});
              }}
            >
              <Ionicons name="refresh" size={20} color="white" />
              <Text style={styles.buttonText}>Reset All</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
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
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  button: {
    flex: 1,
    minWidth: '45%',
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
    backgroundColor: "#2196F3",
  },
  buttonSubZone: {
    backgroundColor: "#2196F3",
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
});
