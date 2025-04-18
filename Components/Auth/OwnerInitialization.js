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
  Modal,
  BackHandler
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, set, update } from 'firebase/database';
import MapView, { Marker, Polygon, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  const debouncedForceUpdate = useDebounce(forceUpdate, 300);

  // Memoize points to prevent unnecessary re-renders
  const memoizedPoints = useMemo(() => points, [points.length]);

  // Add handler for back button/navigation to ensure cleanup
  const handleBackPress = useCallback(async () => {
    try {
      // Check if we're in a reset scenario
      const inResetMode = await AsyncStorage.getItem('inGeofenceResetMode');
      if (inResetMode === 'true') {
        // Ask user to confirm they want to exit without saving
        Alert.alert(
          'Exit Without Saving?',
          'You have not saved your geofence boundaries. If you exit now, you will need to set them up again later.',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Exit', 
              style: 'destructive',
              onPress: async () => {
                try {
                  // Clear cache to prevent old data from reappearing
                  const auth = getAuth();
                  if (!auth.currentUser) {
                    navigation.goBack();
                    return;
                  }
                  
                  const db = getDatabase();
                  
                  // Clear the user's geofenceData cache to prevent old data from loading
                  await set(ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`), null);
                  
                  // Update the geofence status
                  await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), true);
                  
                  // Reset flags
                  await AsyncStorage.removeItem('inGeofenceResetMode');
                  
                  console.log('Successfully cleaned up before navigation');
                  navigation.goBack();
                } catch (error) {
                  console.error('Error cleaning up before exit:', error);
                  navigation.goBack();
                }
              }
            }
          ]
        );
        return true; // Prevents default back behavior
      } else {
        // Normal back behavior for non-reset scenarios
        navigation.goBack();
        return true;
      }
    } catch (error) {
      console.error('Error in back handler:', error);
      navigation.goBack();
      return true;
    }
  }, [navigation]);

  // Set up back handler when the component mounts
  useEffect(() => {
    // Add back button handler
    const backHandler = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
    
    // Also handle the navigation header back button
    navigation.setOptions({
      headerLeft: () => (
        <TouchableOpacity onPress={handleBackPress} style={{ marginLeft: 15 }}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      )
    });
    
    return () => {
      // Remove handler when component unmounts
      backHandler.remove();
    };
  }, [handleBackPress, navigation]);

  useEffect(() => {
    // Store existing points to ensure they're not lost during re-render
    const existingPoints = [...points];
    
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
      
      // Restore points if they were somehow cleared
      if (existingPoints.length > 0 && points.length === 0) {
        console.log("Restoring points during team code check:", existingPoints.length);
        setPoints(existingPoints);
      }
    };
    
    checkTeamCode();
    
    // Initialize map with current location
    // Use a small delay to ensure any state updates complete first
    setTimeout(() => {
      getCurrentLocation();
      
      // Double-check that points are preserved after location fetch
      if (existingPoints.length > 0 && points.length === 0) {
        console.log("Re-restoring points after location init:", existingPoints.length);
        setPoints(existingPoints);
      }
    }, 300);
  }, [route.params]);

  // Add a separate effect to monitor points for debugging purposes
  useEffect(() => {
    console.log("Points state changed:", points.length, "points");
  }, [points]);

  // Remove or modify the monitoring effect to reduce excessive updates and prevent screen twitching
  useEffect(() => {
    // This effect monitors for potential point loss but runs much less frequently
    if (points.length === 0 && forceUpdate > 1) {
      console.warn('Points array unexpectedly empty, attempting to restore from last update');
      // Use a longer timeout to reduce screen updates
      setTimeout(() => {
        setForceUpdate(prev => prev + 1);
      }, 500); // Increased from immediate to 500ms
    }
  }, [points.length, forceUpdate]); // Only depend on points.length instead of entire points array

  // Add useEffect to get location on mount
  useEffect(() => {
    // Get location as soon as component mounts
    getCurrentLocation();
    
    // Clean up any location subscriptions on unmount
    return () => {
      // Any cleanup needed
    };
  }, []);

  // Add a cleanup effect to handle quitting without saving
  useEffect(() => {
    // This effect will run on component mount
    const handleSetupStateAsync = async () => {
      try {
        // Check if we're in a reset scenario by looking at needsGeofenceSetup flag
        const auth = getAuth();
        if (!auth.currentUser) return;
        
        const db = getDatabase();
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const snapshot = await get(userProfileRef);
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          if (userData.needsGeofenceSetup) {
            console.log('In geofence reset mode - will clear caches on exit if not saved');
            
            // Store this state to handle cleanup properly on exit
            await AsyncStorage.setItem('inGeofenceResetMode', 'true');
          }
        }
      } catch (error) {
        console.error('Error checking geofence setup state:', error);
      }
    };
    
    handleSetupStateAsync();
    
    // Cleanup function that runs when component unmounts
    return async () => {
      try {
        // Check if we're in reset mode and haven't saved
        const inResetMode = await AsyncStorage.getItem('inGeofenceResetMode');
        const setupComplete = await AsyncStorage.getItem('needsGeofenceSetup');
        
        // If we're exiting while in reset mode and setup is still needed, 
        // clear any potential cache to prevent old data reappearing
        if (inResetMode === 'true' && setupComplete !== 'false') {
          console.log('Quitting initialization without saving - clearing caches');
          
          const auth = getAuth();
          if (!auth.currentUser) return;
          
          const db = getDatabase();
          
          // Clear user profile cached geofence data to prevent old data from reappearing
          await set(ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`), null);
          
          // Reset the reset mode flag
          await AsyncStorage.removeItem('inGeofenceResetMode');
        }
      } catch (error) {
        console.error('Error in cleanup when exiting initialization:', error);
      }
    };
  }, []);

  // Modify getCurrentLocation to simply save step data when location is obtained
  const getCurrentLocation = async () => {
    // Store existing points first to avoid losing them
    const existingPoints = [...points];
    setLoadingLocation(true);
    
    try {
      console.log('Getting location permissions...');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required for this feature.');
        setLoadingLocation(false);
        return;
      }

      // Use a faster approach to get location
      const lastKnownLocation = await Location.getLastKnownPositionAsync({
        maxAge: 60000 // Accept locations up to 1 minute old
      });
      
      if (lastKnownLocation) {
        const { latitude, longitude } = lastKnownLocation.coords;
        
        // Update location state
        setCurrentLocation({ latitude, longitude });
        
        // Update region immediately
        const initialRegion = {
          latitude,
          longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005
        };
        setInitialRegion(initialRegion);
        
        // Restore points if needed
        if (existingPoints.length > 0 && points.length === 0) {
          setPoints(existingPoints);
        }
        
        // Move map to location
        if (mapRef.current) {
          mapRef.current.animateToRegion(initialRegion, 300);
        }
      }
      
      // Then try to get a fresh location with lowered accuracy requirements
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
        maxAge: 10000,
        timeout: 5000
      }).then(location => {
        const { latitude, longitude } = location.coords;
        
        // Only update if we have a better position than before
        setCurrentLocation({ latitude, longitude });
        
        // Animate map if needed
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude,
            longitude,
            latitudeDelta: 0.005,
            longitudeDelta: 0.005
          }, 300);
        }
        
        // Make sure points are preserved
        if (existingPoints.length > 0 && points.length === 0) {
          setPoints(existingPoints);
        }
      }).catch(error => {
        console.log('Could not get high accuracy location:', error);
      });
      
    } catch (error) {
      console.error('Error in location process:', error);
      // Restore points even in error case
      if (existingPoints.length > 0 && points.length === 0) {
        setPoints(existingPoints);
      }
    } finally {
      setLoadingLocation(false);
    }
  };

  // Simplify startLocationTracking to save step data on each location update
  const startLocationTracking = async () => {
    if (!currentLocation) return;
    
    try {
      console.log('Starting continuous location tracking with step correlation');
      
      // Request permissions if not already granted
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      
      // Start watching position with a balanced accuracy for good performance
      const locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 10, // Update if moved at least 10 meters
          timeInterval: 5000,   // Or at least every 5 seconds
        },
        (location) => {
          const { latitude, longitude, accuracy } = location.coords;
          
          // Only update if the accuracy is reasonable
          if (accuracy <= 50) {
            console.log('Location update in watchPosition:', latitude, longitude, 'accuracy:', accuracy);
            
            // Update current location
            setCurrentLocation({ latitude, longitude });
          }
        }
      );
      
      // Return the subscription for cleanup
      return locationSubscription;
    } catch (error) {
      console.error('Error setting up location tracking:', error);
    }
  };

  const centerOnUserLocation = () => {
    // Don't do anything if location is loading or not available
    if (loadingLocation || !currentLocation) return;
    
    // Store existing points to ensure they're not lost
    const existingPoints = [...points];
    
    // Animate to user location
    if (mapRef.current && currentLocation) {
      const region = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005
      };
      
      mapRef.current.animateToRegion(region, 300);
      
      // Safety check to restore points after animation if they got cleared
      setTimeout(() => {
        if (existingPoints.length > 0 && points.length === 0) {
          setPoints(existingPoints);
        }
      }, 400);
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
      // Store existing points as backup
      const existingPoints = [...points];
      
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
      
      // Update points state with functional update - all at once to reduce flickering
      setPoints(prevPoints => {
        // Safety check
        if (prevPoints.length === 0 && existingPoints.length > 0) {
          console.warn('Points lost during add, restoring from backup and adding new point');
          return [...existingPoints, newPoint];
        }
        
        console.log('Adding point:', newPoint, 'to existing', prevPoints.length, 'points');
        return [...prevPoints, newPoint];
      });
      
      // Calculate distances in a separate update with delay to prevent jitter
      setTimeout(() => {
        setPoints(currentPoints => {
          const newDistances = [];
          for (let i = 0; i < currentPoints.length; i++) {
            const currentPoint = currentPoints[i];
            const nextPoint = currentPoints[(i + 1) % currentPoints.length];
            
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
          
          // Update distances state and force update only once
          setDistances(newDistances);
          setTimeout(() => setForceUpdate(prev => prev + 1), 200);
          
          return currentPoints;
        });
      }, 300);
      
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

  // Function to save owner geofence data with proper cleanup of old data
  const saveOwnerGeofence = async (coordinates) => {
    try {
      if (!coordinates || coordinates.length < 3) {
        return { success: false, error: 'Not enough points to create a valid geofence' };
      }

      const auth = getAuth();
      if (!auth.currentUser) {
        return { success: false, error: 'No authenticated user found' };
      }

      const db = getDatabase();
      
      // Get user profile to retrieve team code
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const userSnapshot = await get(userProfileRef);
      
      if (!userSnapshot.exists()) {
        return { success: false, error: 'User profile not found' };
      }
      
      const userData = userSnapshot.val();
      
      // Ensure we have a team code to work with
      const userTeamCode = userData.teamCode || teamCode;
      if (!userTeamCode) {
        return { success: false, error: 'No team code available' };
      }

      console.log(`Saving geofence for team: ${userTeamCode} with ${coordinates.length} points`);
      
      // IMPORTANT: Clear any cached geofence data in all possible locations
      
      // 1. First, clear the global geofence (for backward compatibility)
      await set(ref(db, 'geofence/coordinates'), []);
      
      // 2. Clear team-specific geofence coordinates
      await set(ref(db, `teams/${userTeamCode}/geofence/coordinates`), []);
      
      // 3. Clear user profile cached geofence data
      await set(ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`), null);
      
      // Short delay to ensure clearing operations complete before saving new data
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Now save the new geofence data
      
      // 4. Save to team-specific geofence
      const teamGeofenceRef = ref(db, `teams/${userTeamCode}/geofence`);
      const geofenceData = {
        coordinates: coordinates,
        owner: {
          uid: auth.currentUser.uid,
          name: auth.currentUser.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || auth.currentUser.email,
          email: userData.email || auth.currentUser.email
        },
        createdAt: userData.geofenceData?.createdAt || new Date().toISOString(),
        lastModified: new Date().toISOString()
      };
      
      await set(teamGeofenceRef, geofenceData);
      
      // 5. Save to user profile for quick access (but with an explicit flag indicating this is post-reset)
      const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
      await set(userProfileGeofenceRef, {
        coordinates: coordinates,
        teamCode: userTeamCode,
        lastModified: new Date().toISOString(),
        isReset: true,
        resetComplete: true
      });
      
      // 6. Clear the needsGeofenceSetup flag in the user's profile
      await set(ref(db, `users/${auth.currentUser.uid}/profile/needsGeofenceSetup`), false);
      
      // 7. Mark geofence as modified for the first time or update existing
      await set(ref(db, `teams/${userTeamCode}/geofenceModified`), true);
      
      console.log("Geofence saved successfully with all caches properly cleared");
      return { success: true };
    } catch (error) {
      console.error("Error in saveOwnerGeofence:", error);
      return { 
        success: false, 
        error: error.message || 'An unexpected error occurred while saving the geofence'
      };
    }
  };

  const saveGeofence = async () => {
    if (points.length < 3) {
      Alert.alert('Not enough points', 'Please add at least 3 points to create a valid geofence.');
      return;
    }

    // Confirm with user before saving
    Alert.alert(
      'Save Geofence',
      'Are you sure you want to save this geofence? Once saved, it will be used to monitor your team members.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Save', 
          onPress: async () => {
            try {
              setLoading(true);
              
              // Process the points for saving
              const processedPoints = points.map(point => ({
                latitude: point.latitude,
                longitude: point.longitude
              }));

              // Save the geofence with app-specific team code
              const result = await saveOwnerGeofence(processedPoints);
              
              if (result && result.success) {
                // Mark geofence setup as complete
                await AsyncStorage.setItem('needsGeofenceSetup', 'false');
                
                // Success notification
                Alert.alert(
                  'Geofence Saved',
                  'Your geofence has been successfully saved and will be used to monitor activity.',
                  [{ text: 'OK', onPress: () => navigation.navigate('LocTrack') }]
                );
              } else {
                const errorMsg = result?.error || 'Unknown error occurred';
                throw new Error(errorMsg);
              }
            } catch (error) {
              console.error('Error saving geofence:', error);
              Alert.alert('Error', `Failed to save geofence: ${error.message}`);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Restore the handleDragStart function with optimizations
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

  const handleDragEnd = (index, e) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    console.log(`Finished dragging point ${index + 1} to`, latitude, longitude);
    
    // Store existing points just in case
    const existingPoints = [...points];
    
    // Reset dragging state first
    setIsDragging(false);
    setActiveIndex(null);
    
    // Update the point in our state array - but do it all at once
    setPoints(currentPoints => {
      // Safety check - make sure we still have the points
      if (currentPoints.length === 0 && existingPoints.length > 0) {
        console.warn('Points lost during drag, restoring from backup');
        const newPoints = [...existingPoints];
        if (index < newPoints.length) {
          newPoints[index] = { latitude, longitude };
        }
        
        // Calculate new distances after a short delay to avoid twitching
        setTimeout(() => {
          const newDistances = calculateDistancesForPoints(newPoints);
          setDistances(newDistances);
        }, 300);
        
        return newPoints;
      }
      
      // Normal flow
      const newPoints = [...currentPoints];
      newPoints[index] = { latitude, longitude };
      
      // Calculate distances on next frame to avoid visual stuttering
      setTimeout(() => {
        const newDistances = calculateDistancesForPoints(newPoints);
        setDistances(newDistances);
      }, 300);
      
      return newPoints;
    });
    
    // Animate opacity back
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
    
    // Only force update once all animations are complete
    setTimeout(() => {
      setForceUpdate(prev => prev + 1);
    }, 400);
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
          onRegionChangeComplete={(region) => {
            if (!isDragging) {
              setInitialRegion(region);
            }
          }}
          moveOnMarkerPress={false}
          maxZoomLevel={20}
          minZoomLevel={12}
          rotateEnabled={false}
          pitchEnabled={false}
          scrollEnabled={true}
          zoomEnabled={true}
          zoomTapEnabled={true}
          toolbarEnabled={false}
          loadingEnabled={true}
          loadingIndicatorColor="#2196F3"
          loadingBackgroundColor="#FFFFFF"
          key="mainMap"
        >
          {/* Add current location marker */}
          {currentLocation && (
            <Marker
              coordinate={currentLocation}
              anchor={{ x: 0.5, y: 0.5 }}
              zIndex={1000}
              tracksViewChanges={false}
            >
              <View style={styles.currentLocationMarker}>
                <View style={styles.currentLocationDot} />
                <View style={styles.currentLocationRing} />
              </View>
            </Marker>
          )}
          
          {/* Draw polygon fill first (lowest z-index) */}
          {points.length >= 3 && (
            <Polygon
              coordinates={points}
              fillColor="rgba(33, 150, 243, 0.2)"
              strokeColor="rgba(33, 150, 243, 0.8)"
              strokeWidth={2}
              strokeOpacity={polygonOpacity}
              key="polygon"
            />
          )}
          
          {/* Draw lines second */}
          {points.length >= 2 && points.map((point, index) => {
            const nextIndex = (index + 1) % points.length;
            if (nextIndex === 0 && points.length < 3) return null;
            
            const nextPoint = points[nextIndex];
            const lineKey = `line-${index}`;
            
            return (
              <Polyline
                key={lineKey}
                coordinates={[point, nextPoint]}
                strokeColor="rgba(255, 0, 0, 0.7)"
                strokeWidth={2}
              />
            );
          })}
          
          {/* Distance markers */}
          {distances.map((dist, index) => {
            if (index === points.length - 1 && points.length < 3) return null;
            
            const distKey = `distance-${index}`;
            
            return (
              <Marker
                key={distKey}
                coordinate={dist.midpoint}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                zIndex={300}
              >
                <View style={styles.distanceMarker}>
                  <Text style={styles.distanceText}>{formatDistance(dist.distance)}</Text>
                </View>
              </Marker>
            );
          })}
          
          {/* Point markers as simple fixed circles */}
          {points.map((point, index) => {
            // Use a more stable key structure that won't change as often
            const pointKey = `point-${index}`;
            
            return (
              <Marker 
                key={pointKey}
                coordinate={point} 
                title={`Point ${index + 1}`}
                tracksViewChanges={false}
                flat={true}
                draggable={true}
                stopPropagation={true}
                pinColor="blue"
                anchor={{ x: 0.5, y: 0.5 }}
                zIndex={500}
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
            );
          })}
        </MapView>
        
        <View style={styles.centerMarker}>
          <Ionicons name="add" size={30} color="red" />
        </View>
      </View>
      
      <View style={styles.controlPanel}>
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

      {/* Move location status indicator below for better visibility */}
      {loadingLocation && (
        <View style={styles.locationStatus}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.locationStatusText}>Getting your location...</Text>
        </View>
      )}
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
  locationStatus: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationStatusText: {
    color: '#FFFFFF',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  currentLocationMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#2196F3',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  currentLocationRing: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(33, 150, 243, 0.5)',
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
  },
}); 