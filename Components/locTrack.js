import React, { useState, useRef, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import MapView, { Marker, Polygon, Circle } from "react-native-maps";
import * as Location from "expo-location";
import { getDatabase, ref, set, push, get, remove, child, onValue } from "firebase/database";
import { db } from "./firebaseConfig";

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

// Add this new useEffect right after your state declarations (around line 26)
useEffect(() => {
  const getInitialLocation = async () => {
    setIsFetchingLocation(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.error("Permission to access location was denied");
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
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

      // Initial location save to Firebase
      const dbRef = ref(db, "UsersCurrentLocation");
      await set(dbRef, { Latitude: latitude, Longitude: longitude });
      console.log("Current location saved to Firebase:", { latitude, longitude });
    } catch (error) {
      console.error("Error getting initial location:", error);
    }
    setIsFetchingLocation(false);
  };

  getInitialLocation();
}, []);

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
  if (currentLocation) {
    setCurrentLocation(null);
    setLocationButtonText("My Location");
    console.log("Location removed");
  } else {
    setIsFetchingLocation(true);
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      console.error("Permission to access location was denied");
      setIsFetchingLocation(false);
      return;
    }
    try {
      let location = await Location.getCurrentPositionAsync({});
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
      // Initial location save to Firebase
      const dbRef = ref(db, "UsersCurrentLocation");
      await set(dbRef, { Latitude: latitude, Longitude: longitude });
      console.log("Current location saved to Firebase:", { latitude, longitude });
    } catch (error) {
      console.error("Error fetching location:", error);
    }
    setIsFetchingLocation(false);
  }
};

// Replace the existing location tracking useEffect (around line 167-203) with this:
useEffect(() => {
  let locationSubscription = null;

  const startLocationTracking = async () => {
    if (currentLocation) {
      locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,    // 5 seconds between updates
          distanceInterval: 0.508,    // Only update if moved by 20 inches
        },
        async (location) => {
          const { latitude, longitude } = location.coords;
          
          // Only update if the location has significantly changed
          // and accuracy is good enough (less than 10 meters)
          if (location.coords.accuracy <= 10 && 
              isSignificantMove(currentLocation, location.coords)) {
            
            setCurrentLocation({ latitude, longitude });
            
            // Update Firebase
            try {
              const dbRef = ref(db, "UsersCurrentLocation");
              await set(dbRef, { 
                Latitude: latitude, 
                Longitude: longitude,
                Accuracy: location.coords.accuracy,
                Timestamp: new Date().toISOString()
              });
              console.log("Location updated in Firebase:", { 
                latitude, 
                longitude, 
                accuracy: location.coords.accuracy 
              });
            } catch (error) {
              console.error("Error updating location in Firebase:", error);
            }
          }
        }
      );
    }
  };

  // Add this helper function to check if movement is significant
  const isSignificantMove = (prevLocation, newLocation) => {
    if (!prevLocation) return true;

    // Calculate distance between points using Haversine formula
    const distance = calculateDistance(
      { latitude: prevLocation.latitude, longitude: prevLocation.longitude },
      { latitude: newLocation.latitude, longitude: newLocation.longitude }
    );

    // Only consider movements greater than 5 meters as significant
    return distance > 5;
  };

  startLocationTracking();

  // Cleanup subscription
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
  if (!mapRef.current || points.length !== 4) {
    alert("Please define the geofence area first.");
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
    <MapView 
      ref={mapRef} 
      style={styles.map} 
      initialRegion={currentLocation ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      } : {
        latitude: 14.5995,
        longitude: 120.9842,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }}
      onPress={(e) => {
        if (isDrawing) {
          const newPoint = e.nativeEvent.coordinate;
          setPoints(prevPoints => [...prevPoints, newPoint]);
        }
      }}
    >
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
      {currentLocation && (
        <Marker coordinate={currentLocation} title="Current Location" pinColor="green" />
      )}
      {previewCircle && !selectedSubZone && (
        <Circle
          center={{ 
            latitude: previewCircle.latitude, 
            longitude: previewCircle.longitude 
          }}
          radius={previewCircle.diameter * 0.5}
          fillColor="rgba(85, 84, 83, 0.3)"
          strokeColor="gray"
          strokeWidth={2}
          strokePattern={[10, 5]}
        />
      )}
    </MapView>
    <View style={styles.crosshair}>
      <Text style={styles.crosshairText}>+</Text>
    </View>

    <TextInput
      style={styles.input}
      placeholder="Enter Diameter"
      keyboardType="numeric"
      onChangeText={(text) => {
        const newDiameter = parseFloat(text) || 10;
        setSubZoneDiameter(newDiameter);
        updatePreviewCircle();
      }}
    />

    <TouchableOpacity style={styles.button} onPress={getLocation}>
      <Text style={styles.buttonText}>Set Point</Text>
    </TouchableOpacity>

    <TouchableOpacity style={styles.buttonSecondary} onPress={toggleCurrentLocation}>
      <Text style={styles.buttonText}>{isFetchingLocation ? "Loading..." : currentLocation ? "Remove Loc" : "My Location"}</Text>
    </TouchableOpacity>

    <TouchableOpacity 
      style={[
        styles.buttonSubZone,
        selectedSubZone && { backgroundColor: 'black' }
      ]} 
      onPress={selectedSubZone ? removeSubZone : addSubZone}
    >
      <Text style={styles.buttonText}>
        {selectedSubZone ? "Remove" : "SubZone"}
      </Text>
    </TouchableOpacity>

    <TouchableOpacity 
      style={[
        styles.buttonReset, 
        (points.length > 0 || isDrawing) && { display: 'flex' }
      ]} 
      onPress={() => {
        if (isDrawing) {
          // Finish drawing
          if (points.length >= 3) {
            setIsDrawing(false);
            saveCoordinatesToFirebase(points);
          } else {
            alert("Please add at least 3 points to create a valid area");
          }
        } else {
          // Reset points
          setPoints([]);
          setIsDrawing(true);
        }
      }}
    >
      <Text style={styles.buttonText}>
        {isDrawing ? "Done Set" : "Reset Points"}
      </Text>
    </TouchableOpacity>
  </View>
);
} 

const styles = StyleSheet.create({
container: {
  flex: 1,
},
map: {
  width: "100%",
  height: "100%",
},
input: {
  position: "absolute",
  bottom: 155,
  right: 20,
  backgroundColor: "gray",
  paddingVertical: 5,
  paddingHorizontal: 10,
  borderRadius: 5,
  width: 150,
  textAlign: "center",
  color: "yellow",
  fontWeight: "bold",
},
button: {
  position: "absolute",
  bottom: 200,
  right: -55,
  transform: [{ translateX: -75 }],
  backgroundColor: "blue",
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 10,
  width: 150,
  alignItems: "center",
  justifyContent: "center",
},
buttonSecondary: {
  position: "absolute",
  bottom: 200,
  left: 95,
  transform: [{ translateX: -75 }],
  backgroundColor: "green",
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 10,
  width: 150,
  alignItems: "center",
  justifyContent: "center",
},
buttonSubZone: {
  position: "absolute",
  bottom: 150,
  left: 20,
  backgroundColor: "red",
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 10,
  width: 150,
  alignItems: "center",
  justifyContent: "center",
},
buttonText: {
  color: "white",
  fontSize: 16,
  fontWeight: "bold",
},
crosshair: {
  position: "absolute",
  top: "49%",
  left: "51%",
  transform: [{ translateX: -10 }, { translateY: -10 }],
  zIndex: 10, // Ensures it's above other elements
},
crosshairText: {
  fontSize: 24,
  fontWeight: "bold",
  color: "red",
},
buttonReset: {
  position: "absolute",
  bottom: 200,
  right: 20,
  backgroundColor: "blue",
  paddingVertical: 10,
  paddingHorizontal: 20,
  borderRadius: 10,
  width: 150,
  alignItems: "center",
  justifyContent: "center",
},
});
