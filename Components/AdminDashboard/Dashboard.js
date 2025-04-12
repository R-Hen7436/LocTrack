import React, { useEffect, useState } from 'react';
import { ref, get } from 'firebase/database';
import { Alert } from 'react-native';
import { db } from '../../firebase/firebaseConfig';

const Dashboard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load users from Firebase
    const loadUsers = async () => {
      setLoading(true);
      try {
        // Get all user profiles
        const userProfilesRef = ref(db, 'users');
        const userProfilesSnapshot = await get(userProfilesRef);
        
        if (userProfilesSnapshot.exists()) {
          const userProfilesData = userProfilesSnapshot.val();
          
          // Create a unique map of users by email to avoid duplicates
          const uniqueUsers = new Map();
          
          // Process user profiles
          for (const [userId, userData] of Object.entries(userProfilesData)) {
            if (userData.profile) {
              const user = {
                id: userId,
                email: userData.profile.email || '',
                firstName: userData.profile.firstName || '',
                lastName: userData.profile.lastName || '',
                role: userData.profile.role || 'member',
                teamCode: userData.profile.teamCode || '',
                isAdmin: userData.profile.isAdmin || false,
                photoURL: userData.profile.photoURL || '',
                createdAt: userData.profile.createdAt || '',
                lastActive: userData.profile.lastActive || '',
                status: 'offline' // Default status
              };
              
              // Use email as unique key (or userId if email not available)
              const uniqueKey = user.email || userId;
              uniqueUsers.set(uniqueKey, user);
            }
          }
          
          // Convert map to array
          const usersArray = Array.from(uniqueUsers.values());
          
          // Update user status from presence data
          const userLocationsRef = ref(db, 'UsersCurrentLocation');
          const userLocationsSnapshot = await get(userLocationsRef);
          
          if (userLocationsSnapshot.exists()) {
            const locationsData = userLocationsSnapshot.val();
            
            for (const user of usersArray) {
              if (locationsData[user.id]) {
                user.status = locationsData[user.id].isActive ? 'online' : 'offline';
                user.lastActive = locationsData[user.id].lastSeen || user.lastActive;
              }
            }
          }
          
          // Sort users by role and then by name
          usersArray.sort((a, b) => {
            // Sort by role priority
            const rolePriority = { 'owner': 1, 'admin': 2, 'member': 3 };
            const roleDiff = (rolePriority[a.role] || 10) - (rolePriority[b.role] || 10);
            
            if (roleDiff !== 0) return roleDiff;
            
            // Then by name
            const nameA = `${a.firstName} ${a.lastName}`.trim().toLowerCase();
            const nameB = `${b.firstName} ${b.lastName}`.trim().toLowerCase();
            return nameA.localeCompare(nameB);
          });
          
          setUsers(usersArray);
        }
      } catch (error) {
        console.error('Error loading users:', error);
        Alert.alert('Error', 'Failed to load user data');
      } finally {
        setLoading(false);
      }
    };
    
    loadUsers();
  }, []);

  return (
    <div>
      {/* Render your component content here */}
    </div>
  );
};

export default Dashboard; 