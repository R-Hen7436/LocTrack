import * as Location from 'expo-location';
import { Alert } from 'react-native';
import { db as database } from './firebaseConfig';
import { ref, update, get } from 'firebase/database';

// Function to calculate distance between two coordinates in meters
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // distance in meters
};

// Function to check if a point is inside a geofence
export const isPointInGeofence = (point, geofence) => {
  if (!geofence || !geofence.latitude || !geofence.longitude || !geofence.radius) {
    return false;
  }
  
  const distance = calculateDistance(
    point.coords.latitude, 
    point.coords.longitude, 
    geofence.latitude, 
    geofence.longitude
  );
  
  return distance <= geofence.radius;
};

// Function to setup geofence monitoring
export const setupGeofenceMonitoring = async (userId, onEnterGeofence, onExitGeofence) => {
  try {
    // Request permissions first
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required for geofencing');
      return false;
    }

    // Setup location subscription
    const locationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 10, // minimum distance in meters before update
        timeInterval: 10000  // minimum time in milliseconds between updates
      },
      async (location) => {
        // Fetch geofences from Firebase
        const userRef = ref(database, `users/${userId}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          const geofences = userData.geofences || {};
          
          // Process each geofence
          Object.keys(geofences).forEach(geofenceId => {
            const geofence = geofences[geofenceId];
            const isInside = isPointInGeofence(location, geofence);
            
            // Track entry and exit events
            if (isInside && !geofence.isInside) {
              // User entered geofence
              update(ref(database, `users/${userId}/geofences/${geofenceId}`), {
                isInside: true,
                lastEntryTime: new Date().toISOString()
              });
              
              if (onEnterGeofence) {
                onEnterGeofence(geofence);
              }
            } else if (!isInside && geofence.isInside) {
              // User exited geofence
              update(ref(database, `users/${userId}/geofences/${geofenceId}`), {
                isInside: false,
                lastExitTime: new Date().toISOString()
              });
              
              if (onExitGeofence) {
                onExitGeofence(geofence);
              }
            }
          });
        }
      }
    );

    return locationSubscription;
  } catch (error) {
    console.error('Error setting up geofence monitoring:', error);
    return null;
  }
};

// Function to create a new geofence
export const createGeofence = async (userId, geofenceData) => {
  try {
    const geofenceId = `geofence_${Date.now()}`;
    const geofenceRef = ref(database, `users/${userId}/geofences/${geofenceId}`);
    
    await update(geofenceRef, {
      ...geofenceData,
      id: geofenceId,
      createdAt: new Date().toISOString(),
      isInside: false
    });
    
    return geofenceId;
  } catch (error) {
    console.error('Error creating geofence:', error);
    return null;
  }
};

// Function to delete a geofence
export const deleteGeofence = async (userId, geofenceId) => {
  try {
    const geofenceRef = ref(database, `users/${userId}/geofences/${geofenceId}`);
    await update(geofenceRef, null);
    return true;
  } catch (error) {
    console.error('Error deleting geofence:', error);
    return false;
  }
}; 