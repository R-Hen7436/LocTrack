import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Alert, 
  ActivityIndicator,
  ScrollView,
  Animated,
  TextInput,
  Modal
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

// Add a debounceForceUpdate function that will batch updates
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  
  return debouncedValue;
};

export default function OwnerInitialization({ navigation, route }) {
  const mapRef = useRef(null);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialRegion, setInitialRegion] = useState({
    latitude: 14.5995,
    longitude: 120.9842,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  });
  const [currentLocation, setCurrentLocation] = useState(null);
  const [teamCode, setTeamCode] = useState(route.params?.teamCode || '');
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [distances, setDistances] = useState([]);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const markerOpacity = useRef(new Animated.Value(1)).current;
  const polygonOpacity = useRef(new Animated.Value(1)).current;
  const [activeIndex, setActiveIndex] = useState(null);
  const [showTeamCodeModal, setShowTeamCodeModal] = useState(false);
  const [teamCodeInput, setTeamCodeInput] = useState('');
  
  // Add debounce for smoother updates when dragging
  const debouncedForceUpdate = useDebounce(forceUpdate, 100);

  useEffect(() => {
    const checkTeamCode = async () => {
      console.log("Route params:", route.params);
      if (route.params?.teamCode) {
        console.log("Setting teamCode from params:", route.params.teamCode);
        setTeamCode(route.params.teamCode);
      } else {
        console.log("No teamCode in params, current value:", teamCode);
        
        // If no teamCode after a delay, show the modal
        if (!teamCode) {
          setTimeout(() => {
            setShowTeamCodeModal(true);
          }, 1000);
        }
      }
    };
    
    checkTeamCode();
    
    // Initialize map with current location
    getCurrentLocation();
  }, [route.params]);

  const getCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for this feature.');
        setLoadingLocation(false);
        return;
      }

      console.log('Getting current position...');
      
      // Use a single toast instead of a blocking alert
      Alert.alert('Locating', 'Getting your location...', [], { cancelable: true });
      
      // Use balanced accuracy from the start with a shorter timeout
      const location = await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maximumAge: 1000, // Allow slightly cached location (1 second)
          timeout: 5000
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Location timeout')), 5000)
        )
      ]).catch(async err => {
        console.log('Balanced accuracy location failed, trying low accuracy', err);
        // Fall back to low accuracy location as last resort
        return await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Low,
          maximumAge: 3000,
          timeout: 3000
        });
      });
      
      if (location) {
        const { latitude, longitude } = location.coords;
        console.log('Successfully got location:', latitude, longitude);
        setCurrentLocation({ latitude, longitude });
        
        // Update region to center on user's location
        const newRegion = {
          latitude,
          longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005
        };
        
        setInitialRegion(newRegion);
        
        // Animate map to user's location
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
        }
      } else {
        throw new Error('Failed to get location data');
      }
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert(
        'Location Error', 
        'Could not determine your location. Please try again or set points manually.',
        [{ text: 'OK' }]
      );
    } finally {
      setLoadingLocation(false);
    }
  };

  const centerOnUserLocation = () => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        ...currentLocation,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 1000);
    } else {
      getCurrentLocation();
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // in meters

    return distance;
  };

  const addPoint = async () => {
    if (!mapRef.current) return;
    
    try {
      // Get the center of the map (where the + marker is positioned)
      const camera = await mapRef.current.getCamera();
      if (!camera || !camera.center) {
        console.error('Could not get camera position:', camera);
        return;
      }
      
      const newPoint = { 
        latitude: camera.center.latitude, 
        longitude: camera.center.longitude 
      };
      
      console.log('Adding point:', newPoint);
      
      // Update points state with functional update to ensure we get the latest state
      setPoints(prevPoints => {
        console.log('Adding point:', newPoint, 'to existing', prevPoints.length, 'points');
        const updatedPoints = [...prevPoints, newPoint];
        
        // Calculate distances between consecutive points
        const newDistances = [];
        for (let i = 0; i < updatedPoints.length; i++) {
          const currentPoint = updatedPoints[i];
          const nextPoint = updatedPoints[(i + 1) % updatedPoints.length]; // Loop back to first point
          
          const distance = calculateDistance(
            currentPoint.latitude,
            currentPoint.longitude,
            nextPoint.latitude,
            nextPoint.longitude
          );
          
          newDistances.push({
            distance,
            midpoint: {
              latitude: (currentPoint.latitude + nextPoint.latitude) / 2,
              longitude: (currentPoint.longitude + nextPoint.longitude) / 2
            }
          });
        }
        
        // Update distances state
        setDistances(newDistances);
        
        // Force a re-render to show points immediately
        setForceUpdate(prev => prev + 1);
        
        return updatedPoints;
      });
    } catch (error) {
      console.error('Error adding point:', error);
      Alert.alert('Error', 'Failed to add point. Please try again.');
    }
  };

  const removeLastPoint = () => {
    if (points.length > 0) {
      setPoints(prevPoints => {
        const updatedPoints = prevPoints.slice(0, -1);
        
        // Recalculate distances
        const newDistances = [];
        for (let i = 0; i < updatedPoints.length; i++) {
          const currentPoint = updatedPoints[i];
          const nextPoint = updatedPoints[(i + 1) % updatedPoints.length]; // Loop back to first point
          
          const distance = calculateDistance(
            currentPoint.latitude,
            currentPoint.longitude,
            nextPoint.latitude,
            nextPoint.longitude
          );
          
          newDistances.push({
            distance,
            midpoint: {
              latitude: (currentPoint.latitude + nextPoint.latitude) / 2,
              longitude: (currentPoint.longitude + nextPoint.longitude) / 2
            }
          });
        }
        
        setDistances(newDistances);
        return updatedPoints;
      });
    }
  };

  const clearAllPoints = () => {
    Alert.alert(
      'Clear All Points',
      'Are you sure you want to remove all points?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear All', 
          style: 'destructive',
          onPress: () => {
            setPoints([]);
            setDistances([]);
          }
        }
      ]
    );
  };

  const formatDistance = (meters) => {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    } else {
      return `${(meters / 1000).toFixed(2)}km`;
    }
  };

  const saveGeofence = async () => {
    console.log("saveGeofence called with points:", points.length, "and teamCode:", teamCode);
    
    if (points.length < 3) {
      Alert.alert('Error', 'Please set at least 3 points to create a valid geofence.');
      return;
    }
    
    if (!teamCode) {
      console.error("No teamCode available");
      Alert.alert('Error', 'Team code is missing. Please restart the setup process.');
      return;
    }

    setLoading(true);
    try {
      console.log("Getting Firebase database and auth");
      const db = getDatabase();
      const auth = getAuth();
      
      if (!auth.currentUser) {
        throw new Error("User not authenticated");
      }
      
      console.log("Getting user profile data for:", auth.currentUser.uid);
      // Get user profile data
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnapshot = await get(userProfileRef);
      console.log("Profile data exists:", profileSnapshot.exists());
      const userData = profileSnapshot.exists() ? profileSnapshot.val() : {};
      
      console.log("Creating geofence data with owner:", auth.currentUser.uid);
      // Create geofence data with ownership information
      const geofenceData = {
        coordinates: points,
        owner: {
          uid: auth.currentUser.uid,
          name: auth.currentUser.displayName || `${userData.firstName} ${userData.lastName}`,
          email: userData.email || auth.currentUser.email
        },
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };
      
      console.log("Saving to team geofence:", teamCode);
      // Save to team geofence
      const teamGeofenceRef = ref(db, `teams/${teamCode}/geofence`);
      await set(teamGeofenceRef, geofenceData);
      console.log("Team geofence saved successfully");
      
      console.log("Saving to global geofence for compatibility");
      // Also save to global geofence for compatibility
      const geofenceRef = ref(db, `geofence/coordinates`);
      await set(geofenceRef, points);
      console.log("Global geofence saved successfully");
      
      console.log("Saving to user profile");
      // Save to user profile for quick access on login
      const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
      await set(userProfileGeofenceRef, {
        coordinates: points,
        teamCode: teamCode,
        lastModified: new Date().toISOString()
      });
      console.log("User profile geofence saved successfully");
      
      console.log("Marking as modified");
      // Mark as modified to track future changes
      await set(ref(db, `teams/${teamCode}/geofenceModified`), true);
      console.log("All geofence data saved successfully");
      
      Alert.alert(
        'Success', 
        'Geofence boundary set successfully. You can modify these points later from the Maps screen, but it will require admin approval.',
        [
          { text: 'OK', onPress: () => {
            console.log("Navigating to LocTrack");
            navigation.replace('LocTrack');
          }}
        ]
      );
    } catch (error) {
      console.error('Error saving geofence:', error);
      Alert.alert('Error', `Failed to save geofence: ${error.message}. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  // Fix the handleDragStart function
  const handleDragStart = (index) => {
    console.log(`Started dragging point ${index + 1}`);
    setIsDragging(true);
    setActiveIndex(index);
    
    // Animate the marker and polygon opacity
    Animated.parallel([
      Animated.timing(markerOpacity, {
        toValue: 0.7,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(polygonOpacity, {
        toValue: 0.5,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();
  };

  // Fix the handleDragEnd function
  const handleDragEnd = (index, e) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    console.log(`Finished dragging point ${index + 1} to`, latitude, longitude);
    
    // Update the point in our state array
    setPoints(currentPoints => {
      const newPoints = [...currentPoints];
      newPoints[index] = { latitude, longitude };
      
      // Recalculate distances but don't immediately update UI
      const newDistances = calculateDistancesForPoints(newPoints);
      setDistances(newDistances);
      
      return newPoints;
    });
    
    // Reset dragging state and animate opacity back
    setIsDragging(false);
    setActiveIndex(null);
    
    Animated.parallel([
      Animated.timing(markerOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(polygonOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();
    
    // Force update but use the debounced version
    setForceUpdate(prev => prev + 1);
  };
  
  // Add helper function to calculate distances
  const calculateDistancesForPoints = (pointsArray) => {
    const newDistances = [];
    for (let i = 0; i < pointsArray.length; i++) {
      const currentPoint = pointsArray[i];
      const nextPoint = pointsArray[(i + 1) % pointsArray.length];
      
      const distance = calculateDistance(
        currentPoint.latitude,
        currentPoint.longitude,
        nextPoint.latitude,
        nextPoint.longitude
      );
      
      newDistances.push({
        distance,
        midpoint: {
          latitude: (currentPoint.latitude + nextPoint.latitude) / 2,
          longitude: (currentPoint.longitude + nextPoint.longitude) / 2
        }
      });
    }
    return newDistances;
  };

  const handleTeamCodeSubmit = () => {
    if (teamCodeInput.trim() === '') {
      Alert.alert('Error', 'Please enter a valid team code.');
      return;
    }
    
    setTeamCode(teamCodeInput.trim());
    setShowTeamCodeModal(false);
    Alert.alert('Team Code Set', `Using team code: ${teamCodeInput.trim()}`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          showsUserLocation={true}
          showsMyLocationButton={false}
          followsUserLocation={false}
          maxZoomLevel={20}
          rotateEnabled={true}
          pitchEnabled={true}
          zoomEnabled={true}
        >
          {/* Draw polygon fill first (lowest z-index) */}
          {points.length >= 3 && (
            <Polygon
              coordinates={points}
              fillColor="rgba(33, 150, 243, 0.2)"
              strokeColor="rgba(33, 150, 243, 0.8)"
              strokeWidth={2}
              strokeOpacity={polygonOpacity}
            />
          )}
          
          {/* Draw lines second */}
          {points.length >= 2 && points.map((point, index) => {
            const nextIndex = (index + 1) % points.length;
            if (nextIndex === 0 && points.length < 3) return null;
            
            return (
              <Polyline
                key={`line-${index}-${debouncedForceUpdate}`}
                coordinates={[point, points[nextIndex]]}
                strokeColor="rgba(255, 0, 0, 0.7)"
                strokeWidth={2}
              />
            );
          })}
          
          {/* Distance markers */}
          {distances.map((dist, index) => {
            if (index === points.length - 1 && points.length < 3) return null;
            
            return (
              <Marker
                key={`distance-${index}-${debouncedForceUpdate}`}
                coordinate={dist.midpoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={styles.distanceMarker}>
                  <Text style={styles.distanceText}>{formatDistance(dist.distance)}</Text>
                </View>
              </Marker>
            );
          })}
          
          {/* Point markers as simple fixed circles */}
          {points.map((point, index) => (
            <Marker 
              key={`point-${index}-${debouncedForceUpdate}`}
              coordinate={point} 
              title={`Point ${index + 1}`}
              tracksViewChanges={false}
              flat={true}
              draggable={true}
              stopPropagation={true}
              pinColor="blue"
              calloutVisible={false}
              tracksInfoWindowChanges={false}
              onSelect={() => null}
              onDragStart={() => handleDragStart(index)}
              onDragEnd={(e) => handleDragEnd(index, e)}
            >
              <View style={[
                styles.simpleMarker,
                isDragging && index === activeIndex ? { opacity: 0.7 } : null
              ]}>
                <Text style={styles.simpleMarkerText}>{index + 1}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
        
        <View style={styles.centerMarker}>
          <Ionicons name="add" size={30} color="red" />
        </View>

        <TouchableOpacity 
          style={styles.locationButton}
          onPress={getCurrentLocation}
          disabled={loadingLocation}
        >
          {loadingLocation ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Ionicons name="compass" size={24} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
      
      <View style={styles.controlPanel}>
        <TouchableOpacity 
          style={styles.getLocationButton}
          onPress={getCurrentLocation}
          disabled={loadingLocation}
        >
          {loadingLocation ? (
            <ActivityIndicator color="#FFFFFF" size="small" style={{marginRight: 8}} />
          ) : (
            <Ionicons name="locate" size={24} color="#FFFFFF" style={{marginRight: 8}} />
          )}
          <Text style={styles.getLocationButtonText}>
            {loadingLocation ? 'Finding Location...' : 'Get My Location'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.instructions}>
          Position the map and tap "Add Point" to place boundary markers. Add at least 3 points to create a valid geofence area. The distance between points will be shown.
        </Text>
        
        <View style={styles.pointCounter}>
          <Text style={styles.pointCounterText}>
            Points: {points.length} {points.length < 3 ? '(Need at least 3)' : ''}
          </Text>
        </View>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.button, styles.addButton]}
            onPress={addPoint}
          >
            <Ionicons name="add-circle-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Add Point</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.removeButton]}
            onPress={removeLastPoint}
            disabled={points.length === 0}
          >
            <Ionicons name="remove-circle-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Remove Last</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.clearButton]}
            onPress={clearAllPoints}
            disabled={points.length === 0}
          >
            <Ionicons name="trash-outline" size={20} color="white" />
            <Text style={styles.buttonText}>Clear All</Text>
          </TouchableOpacity>
        </View>
        
        <TouchableOpacity 
          style={[
            styles.saveButton,
            points.length < 3 && styles.disabledButton
          ]}
          onPress={saveGeofence}
          disabled={points.length < 3 || loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="white" />
              <Text style={styles.saveButtonText}>Save Geofence</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={showTeamCodeModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowTeamCodeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Team Code</Text>
            <Text style={styles.modalText}>
              Team code is required to save the geofence. Please enter your team code:
            </Text>
            <TextInput
              style={styles.input}
              value={teamCodeInput}
              onChangeText={setTeamCodeInput}
              placeholder="Team Code"
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.button, styles.cancelButton]}
                onPress={() => setShowTeamCodeModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.button, styles.addButton]}
                onPress={handleTeamCodeSubmit}
              >
                <Text style={styles.buttonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  centerMarker: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -15,
    marginTop: -30,
  },
  controlPanel: {
    backgroundColor: 'white',
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
  },
  instructions: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    textAlign: 'center',
  },
  pointCounter: {
    alignItems: 'center',
    marginBottom: 12,
  },
  pointCounterText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  addButton: {
    backgroundColor: '#2196F3',
  },
  removeButton: {
    backgroundColor: '#FF9800',
  },
  clearButton: {
    backgroundColor: '#9E9E9E',
  },
  buttonText: {
    color: 'white',
    fontWeight: '500',
    marginLeft: 4,
    fontSize: 14,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 12,
    borderRadius: 8,
  },
  disabledButton: {
    backgroundColor: '#A5D6A7',
  },
  saveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    marginLeft: 8,
    fontSize: 16,
  },
  getLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  getLocationButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
  locationButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#2196F3',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  distanceMarker: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    elevation: 3,
  },
  distanceText: {
    color: '#333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  simpleMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    borderWidth: 2.5,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 6,
  },
  simpleMarkerText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '80%',
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 14,
    marginBottom: 15,
    textAlign: 'center',
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 10,
    marginBottom: 15,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    backgroundColor: '#9E9E9E',
    flex: 1,
    marginRight: 5,
  },
}); 