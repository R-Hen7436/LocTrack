import React, { useState, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import * as Location from "expo-location";

export default function App() {
  const mapRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);

  const getCurrentLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Permission to access location was denied');
      return;
    }

    try {
      const location = await Location.getCurrentPositionAsync({});
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch (error) {
      setErrorMsg('Error getting location');
    }
  };

  const getLocation = async () => {
    let { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Permission to access location was denied');
      return;
    }

    try {
      const location = await Location.getCurrentPositionAsync({});
      const newPoint = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      };
      
      console.log('New point:', newPoint); // Debug log

      setPoints((prevPoints) => {
        console.log('Previous points:', prevPoints); // Debug log
        
        // Check if the new coordinates already exist in prevPoints
        const isDuplicate = prevPoints.some(point => {
          const isDup = point.latitude === newPoint.latitude && 
                       point.longitude === newPoint.longitude;
          console.log('Checking point:', point, 'isDuplicate:', isDup); // Debug log
          return isDup;
        });

        if (isDuplicate) {
          console.log('Duplicate point detected'); // Debug log
          setErrorMsg('This location has already been added');
          return prevPoints;
        }

        if (prevPoints.length < 4) {
          console.log('Adding new point'); // Debug log
          return [...prevPoints, newPoint];
        } else {
          console.log('Resetting points with new point'); // Debug log
          return [newPoint];
        }
      });
    } catch (error) {
      console.error('Error:', error); // Debug log
      setErrorMsg('Error getting location');
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: 14.5995,
          longitude: 120.9842,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        {points.map((point, index) => (
          <Marker key={index} coordinate={point} title={`Point ${index + 1}`} />
        ))}

        {points.length === 4 && <Polygon coordinates={points} fillColor="rgba(0,0,255,0.3)" strokeColor="blue" strokeWidth={2} />}
      </MapView>

      {/* Crosshair Indicator */}
      <View style={styles.crosshair}>
        <Text style={styles.crosshairText}>+</Text>
      </View>

      {/* Button to Get Coordinates */}
      <TouchableOpacity style={styles.button} onPress={getLocation}>
        <Text style={styles.buttonText}>Get Location</Text>
      </TouchableOpacity>

      {/* Add new Current Location button */}
      <TouchableOpacity style={[styles.button, styles.currentLocationButton]} onPress={getCurrentLocation}>
        <Text style={styles.buttonText}>Current Location</Text>
      </TouchableOpacity>

      {/* Display Coordinates */}
      {points.length > 0 && (
        <View style={styles.locationBox}>
          {points.map((point, index) => (
            <Text key={index} style={styles.locationText}>
              📍 Point {index + 1}: {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
            </Text>
          ))}
        </View>
      )}

      {errorMsg && <Text style={styles.error}>{errorMsg}</Text>}
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
  crosshair: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: [{ translateX: -10 }, { translateY: -10 }],
  },
  crosshairText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "red",
  },
  button: {
    position: "absolute",
    bottom: 150,  
    left: "50%",
    transform: [{ translateX: -75 }],
    backgroundColor: "blue",
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
  locationBox: {
    position: "absolute",
    bottom: 40,
    left: "50%",
    transform: [{ translateX: -100 }],
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 10,
    borderRadius: 10,
    width: 250,
    alignItems: "center",
  },
  locationText: {
    color: "white",
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
  },
  error: {
    fontSize: 18,
    color: "red",
    textAlign: "center",
    marginTop: 20,
  },
  currentLocationButton: {
    bottom: 220, // Position above the existing button
  },
});