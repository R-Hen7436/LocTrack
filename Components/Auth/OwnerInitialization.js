const saveGeofence = async () => {
  if (points.length < 3) {
    Alert.alert('Error', 'Please set at least 3 points to create a valid geofence.');
    return;
  }

  setLoading(true);
  try {
    const db = getDatabase();
    const auth = getAuth();
    
    // Get user profile data
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const profileSnapshot = await get(userProfileRef);
    const userData = profileSnapshot.exists() ? profileSnapshot.val() : {};
    
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
    
    // Save to team geofence
    const teamGeofenceRef = ref(db, `teams/${teamCode}/geofence`);
    await set(teamGeofenceRef, geofenceData);
    
    // Also save to global geofence for compatibility
    const geofenceRef = ref(db, `geofence/coordinates`);
    await set(geofenceRef, points);
    
    // Save to user profile for quick access on login
    const userProfileGeofenceRef = ref(db, `users/${auth.currentUser.uid}/profile/geofenceData`);
    await set(userProfileGeofenceRef, {
      coordinates: points,
      teamCode: teamCode,
      lastModified: new Date().toISOString()
    });
    
    // Mark as modified to track future changes
    await set(ref(db, `teams/${teamCode}/geofenceModified`), true);
    
    Alert.alert(
      'Success', 
      'Geofence boundary set successfully. You can modify these points later from the Maps screen, but it will require admin approval.',
      [
        { text: 'OK', onPress: () => navigation.replace('Dashboard') }
      ]
    );
  } catch (error) {
    console.error('Error saving geofence:', error);
    Alert.alert('Error', 'Failed to save geofence boundaries. Please try again.');
  } finally {
    setLoading(false);
  }
}; 