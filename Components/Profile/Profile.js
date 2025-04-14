import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, Modal, TextInput, ActivityIndicator, SafeAreaView, KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { getAuth, signOut, updateProfile } from 'firebase/auth';
import { ref, get, set, remove, onValue } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import Navbar from '../Navbar';
import { auth, db, storage } from '../firebaseConfig';
import EditProfile from './EditProfile';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from 'firebase/database';
import { Clipboard } from 'react-native';
import { logAudit } from '../../utils/auditUtils';
import { AUDIT_ACTIONS } from '../../constants/auditActions';
import ActivityLog from './ActivityLog';
import { createUserWithTempPassword } from '../../utils/userUtils';

// Add this helper function at the top level, before the component definition
// Format name function to safely handle empty or null fields
const formatName = (firstName, middleName, lastName) => {
  const parts = [];
  if (firstName && firstName.trim()) parts.push(firstName.trim());
  if (middleName && middleName.trim()) parts.push(middleName.trim());
  if (lastName && lastName.trim()) parts.push(lastName.trim());
  
  return parts.length > 0 ? parts.join(' ') : 'User';
}

// Add a helper function to safely get initials
const getInitials = (firstName, lastName) => {
  let initials = '';
  if (firstName && firstName.trim()) {
    initials += firstName.trim()[0].toUpperCase();
  }
  if (lastName && lastName.trim()) {
    initials += lastName.trim()[0].toUpperCase();
  }
  return initials || '?';
};

// Add delay function to ensure auth is initialized
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatLastSeen = (timestamp) => {
  if (!timestamp) return 'Never';
  
  const lastSeen = new Date(timestamp);
  const now = new Date();
  const diffMinutes = Math.floor((now - lastSeen) / (1000 * 60));
  
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return lastSeen.toLocaleDateString();
};

// Add status formatting function before the component definition
const formatStatus = (status) => {
  if (!status) return 'Offline';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// Add MAC address formatter
const formatMacAddress = (parts) => {
  return parts.map(part => part.toUpperCase()).join(':');
};

// Add MAC address validator
const isValidMacAddress = (parts) => {
  const regex = /^[0-9A-Fa-f]{2}$/;
  return parts.every(part => regex.test(part)) && parts.length === 6;
};

export default function Profile({ navigation }) {
  const [userProfile, setUserProfile] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userStatus, setUserStatus] = useState('offline'); // Add state for user status
  const [isEditingMac, setIsEditingMac] = useState(false);
  const [macParts, setMacParts] = useState(['', '', '', '', '', '']);
  const macInputRefs = Array(6).fill(0).map(() => React.createRef());

  useEffect(() => {
    console.log("Profile component mounted");
    console.log("Auth state:", auth?.currentUser?.uid);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      console.log("Focus effect triggered");
      if (auth?.currentUser?.uid) {
        console.log("Loading profile for user:", auth.currentUser.uid);
        const loadData = async () => {
          await loadUserProfile();
          // Load team members after profile is loaded if user is an owner
          if (userProfile?.role === 'owner' && userProfile?.teamCode) {
            console.log("User is an owner with team code, loading team members");
            await loadTeamMembers();
          }
        };
        loadData();
      } else {
        console.error("No current user in auth");
        setLoading(false);
      }
      
      // Return cleanup function
      return () => {
        console.log("Focus effect cleanup");
      };
    }, [userProfile?.teamCode]) // Include userProfile.teamCode as a dependency
  );

  // Add a new effect to monitor the user's presence status
  useEffect(() => {
    let presenceUnsubscribe = null;
    
    const monitorUserPresence = async () => {
      if (!auth?.currentUser?.uid) return;
      
      try {
        const presenceRef = ref(db, `users/${auth.currentUser.uid}/presence`);
        presenceUnsubscribe = onValue(presenceRef, (snapshot) => {
          if (snapshot.exists()) {
            const presenceData = snapshot.val();
            setUserStatus(presenceData.status || 'offline');
          } else {
            setUserStatus('offline');
          }
        });
      } catch (error) {
        console.error('Error monitoring presence:', error);
        setUserStatus('offline');
      }
    };
    
    monitorUserPresence();
    
    return () => {
      if (presenceUnsubscribe) {
        presenceUnsubscribe();
      }
    };
  }, []);

  // Add this new effect to monitor team members' presence in real-time
  useEffect(() => {
    let presenceUnsubscribers = [];
    
    const monitorTeamMembersPresence = () => {
      // Clear any existing listeners
      presenceUnsubscribers.forEach(unsubscribe => unsubscribe());
      presenceUnsubscribers = [];
      
      // If no team members or not team owner, do nothing
      if (teamMembers.length === 0 || userProfile?.role !== 'owner') {
        return;
      }
      
      // Set up listeners for each team member
      teamMembers.forEach(member => {
        if (!member.id) return;
        
        const presenceRef = ref(db, `users/${member.id}/presence`);
        const unsubscribe = onValue(presenceRef, (snapshot) => {
          if (snapshot.exists()) {
            const presenceData = snapshot.val();
            const isOnline = presenceData.status === 'online';
            const lastSeen = presenceData.lastSeen || '';
            
            // Update the team members state with the new status
            setTeamMembers(prevMembers => 
              prevMembers.map(m => 
                m.id === member.id 
                  ? { ...m, isActive: isOnline, lastSeen: lastSeen }
                  : m
              )
            );
          }
        });
        
        presenceUnsubscribers.push(unsubscribe);
      });
    };
    
    monitorTeamMembersPresence();
    
    return () => {
      // Clean up all listeners when component unmounts
      presenceUnsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [teamMembers.length, userProfile?.role]); // Only re-run when team members count changes or role changes

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={async () => {
            try {
              await signOut(auth);
            } catch (error) {
              console.error('Error logging out:', error);
              Alert.alert('Error', 'Failed to log out');
            }
          }}
          style={{ marginRight: 15 }}
        >
          <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Load profile with retry logic
  const loadUserProfile = async (retryCount = 0) => {
    try {
      setLoading(true);
      
      // Check if auth is initialized
      if (!auth || !auth.currentUser) {
        console.log("Auth not ready, waiting...");
        if (retryCount < 3) {
          // Wait 1 second and retry
          await delay(1000);
          return loadUserProfile(retryCount + 1);
        } else {
          console.error("Failed to get auth after retries");
          setLoading(false);
          return;
        }
      }
      
      console.log("Loading profile for user ID:", auth.currentUser.uid);
      console.log("Current display name from Auth:", auth.currentUser.displayName);
      
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data loaded from database:', profileData);
        
        // Parse display name from Auth if needed
        let authFirstName = '';
        let authLastName = '';
        if (auth.currentUser.displayName) {
          const nameParts = auth.currentUser.displayName.split(' ');
          authFirstName = nameParts[0] || '';
          authLastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
        }
        
        // Ensure all required fields exist with fallbacks
        const cleanedProfile = {
          firstName: profileData.firstName || authFirstName || '',
          lastName: profileData.lastName || authLastName || '',
          middleName: profileData.middleName || '',
          email: profileData.email || auth.currentUser.email || '',
          photoURL: profileData.photoURL || auth.currentUser.photoURL || '',
          role: profileData.role || 'member',
          teamCode: profileData.teamCode || '',
          isOwner: profileData.isOwner || profileData.role === 'owner', // Ensure role consistency
          ...profileData // keep any other fields
        };
        
        console.log('Cleaned profile data:', cleanedProfile);
        setUserProfile(cleanedProfile);
        
        // Ensure role and isOwner are consistent
        if (cleanedProfile.role === 'owner' && !cleanedProfile.isOwner) {
          console.log('Fixing inconsistent owner role...');
          await set(userProfileRef, {
            ...cleanedProfile,
            isOwner: true
          });
        }
        
        if (cleanedProfile.role === 'owner' && cleanedProfile.teamCode) {
          await loadTeamMembers();
        }
      } else {
        console.log("No profile data found, creating default profile");
        console.log("Auth display name:", auth.currentUser.displayName);
        
        // Parse display name for better name extraction
        let firstName = '';
        let lastName = '';
        if (auth.currentUser.displayName) {
          const nameParts = auth.currentUser.displayName.split(' ');
          firstName = nameParts[0] || '';
          lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
        }
        
        // Create default profile from auth data
        const defaultProfile = {
          firstName: firstName,
          lastName: lastName,
          middleName: '',
          email: auth.currentUser.email || '',
          photoURL: auth.currentUser.photoURL || '',
          role: 'member',
          teamCode: '',
          createdAt: new Date().toISOString()
        };
        
        console.log('Created default profile:', defaultProfile);
        setUserProfile(defaultProfile);
        
        // Save the default profile
        try {
          await set(userProfileRef, defaultProfile);
          console.log("Created default profile for user");
        } catch (error) {
          console.error("Error creating default profile:", error);
        }
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading profile:', error);
      setLoading(false);
    }
  };

  const loadTeamMembers = async () => {
    try {
      console.log('Loading team members, team code:', userProfile?.teamCode);
      
      if (!userProfile || !userProfile.teamCode) {
        console.log('No team code found in profile, cannot load members');
        setTeamMembers([]);
        return;
      }
      
      const teamCode = userProfile.teamCode;
      console.log('Loading team members for team code:', teamCode);
      
      const db = getDatabase();
      
      // Check if team exists first
      const teamRef = ref(db, `teams/${teamCode}`);
      const teamSnapshot = await get(teamRef);
      
      if (!teamSnapshot.exists()) {
        console.log('Team does not exist for code:', teamCode);
        setTeamMembers([]);
        return;
      }
      
      console.log('Team found, fetching members...');
      const membersRef = ref(db, `teams/${teamCode}/members`);
      const snapshot = await get(membersRef);
      
      if (!snapshot.exists()) {
        console.log('No members found for team');
        setTeamMembers([]);
        return;
      }
      
      console.log('Team members snapshot exists, processing data...');
      const members = [];
      
      snapshot.forEach((child) => {
        members.push({
          id: child.key,
          ...child.val()
        });
      });
      
      console.log(`Found ${members.length} members, fetching user profiles...`);
      
      // Fetch additional details for each member
      const enhancedMembers = await Promise.all(
        members.map(async (member) => {
          try {
            const userRef = ref(db, `users/${member.id}/profile`);
            const userSnapshot = await get(userRef);
            
            // Get presence data to check online status
            const presenceRef = ref(db, `users/${member.id}/presence`);
            const presenceSnapshot = await get(presenceRef);
            
            let isOnline = false;
            let lastSeen = '';
            
            if (presenceSnapshot.exists()) {
              const presenceData = presenceSnapshot.val();
              isOnline = presenceData.status === 'online';
              lastSeen = presenceData.lastSeen || '';
            }
            
            if (userSnapshot.exists()) {
              const userData = userSnapshot.val();
              return {
                ...member,
                name: formatName(userData.firstName || '', userData.middleName || '', userData.lastName || ''),
                email: userData.email || member.email || '',
                isActive: isOnline, // Use the real-time presence status
                photoURL: userData.photoURL || '',
                lastSeen: lastSeen || userData.lastSeen || '',
              };
            }
            return member;
          } catch (error) {
            console.error(`Error fetching profile for member ${member.id}:`, error);
            return member;
          }
        })
      );
      
      console.log(`Enhanced data for ${enhancedMembers.length} members`);
      setTeamMembers(enhancedMembers);
    } catch (error) {
      console.error('Error loading team members:', error);
      Alert.alert('Error', 'Failed to load team members');
    }
  };

  const pickImage = async () => {
    try {
      // Request permission
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please grant permission to access your photos.');
        return;
      }

      // Launch image picker
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        await uploadImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const uploadImage = async (uri) => {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      
      // Use the storage instance from firebaseConfig
      const imageRef = storageRef(storage, `profile_pictures/${auth.currentUser.uid}`);
      console.log('Uploading to:', imageRef.fullPath);
      
      // Upload image to Firebase Storage
      const uploadResult = await uploadBytes(imageRef, blob);
      console.log('Upload successful:', uploadResult);
      
      // Get download URL
      const downloadURL = await getDownloadURL(imageRef);
      console.log('Download URL:', downloadURL);
      
      // Update auth profile
      await updateProfile(auth.currentUser, {
        photoURL: downloadURL
      });
      
      // Update database profile
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      await set(userProfileRef, {
        ...userProfile,
        photoURL: downloadURL
      });
      
      // Update local state
      setUserProfile(prev => ({
        ...prev,
        photoURL: downloadURL
      }));
      
      Alert.alert('Success', 'Profile picture updated successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', 'Failed to upload image. Please try again.');
    }
  };

  const handleRemoveMember = (member) => {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${member.name || member.email} from your team?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              const db = getDatabase();
              
              await remove(ref(db, `teams/${userProfile.teamCode}/members/${member.id}`));
              
              const memberProfileRef = ref(db, `users/${member.id}/profile`);
              const memberSnapshot = await get(memberProfileRef);
              
              if (memberSnapshot.exists()) {
                const profileData = memberSnapshot.val();
                await set(memberProfileRef, {
                  ...profileData,
                  teamCode: null,
                  role: 'member'
                });
              }
              
              await logAudit(
                AUDIT_ACTIONS.MEMBER_REMOVED, 
                { memberEmail: member.email, memberName: member.name },
                auth.currentUser.uid,
                member.id
              );
              
              await loadTeamMembers();
              
              Alert.alert('Success', 'Team member removed successfully');
            } catch (error) {
              console.error('Error removing team member:', error);
              Alert.alert('Error', 'Failed to remove team member');
            }
          }
        }
      ]
    );
  };

  const handleTransferOwnership = (member) => {
    const memberName = member.name || member.email || 'this user';
    Alert.alert(
      'Transfer Ownership',
      `Are you sure you want to transfer ownership to ${memberName}? You will become a team member.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Transfer', 
          style: 'destructive',
          onPress: async () => {
            try {
              const db = getDatabase();
              
              // Update the team member's profile
              const memberProfileRef = ref(db, `users/${member.id}/profile`);
              const memberSnapshot = await get(memberProfileRef);
              
              if (memberSnapshot.exists()) {
                const profileData = memberSnapshot.val();
                await set(memberProfileRef, {
                  ...profileData,
                  role: 'owner'
                });
              }
              
              // Update current user's profile
              const ownerProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
              await set(ownerProfileRef, {
                ...userProfile,
                role: 'member'
              });

              await logAudit(
                AUDIT_ACTIONS.OWNERSHIP_TRANSFERRED, 
                { newOwnerId: member.id, newOwnerName: memberName },
                auth.currentUser.uid
              );
              
              // Get the updated profile
              await loadUserProfile();
              
              Alert.alert('Success', 'Ownership transferred successfully');
            } catch (error) {
              console.error('Error transferring ownership:', error);
              Alert.alert('Error', 'Failed to transfer ownership. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleMacPartChange = (text, index) => {
    // Remove non-hex characters
    const cleaned = text.replace(/[^0-9A-Fa-f]/g, '');
    
    if (cleaned.length <= 2) {
      const newParts = [...macParts];
      newParts[index] = cleaned;
      setMacParts(newParts);
      
      // Auto-advance to next input if 2 characters entered
      if (cleaned.length === 2 && index < 5) {
        macInputRefs[index + 1].current.focus();
      }
    }
  };

  const handleMacKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && macParts[index] === '' && index > 0) {
      // Move to previous input on backspace if current input is empty
      macInputRefs[index - 1].current.focus();
    }
  };

  const handleSaveMacAddress = async () => {
    if (!isValidMacAddress(macParts)) {
      Alert.alert('Invalid MAC Address', 'Please enter a valid MAC address in all fields');
      return;
    }

    try {
      const formattedMac = formatMacAddress(macParts);
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      await set(userProfileRef, {
        ...userProfile,
        MacAddress: formattedMac
      });

      setUserProfile(prev => ({
        ...prev,
        MacAddress: formattedMac
      }));
      setIsEditingMac(false);
      Alert.alert('Success', 'MAC address updated successfully');
    } catch (error) {
      console.error('Error updating MAC address:', error);
      Alert.alert('Error', 'Failed to update MAC address');
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContainer}>
            {/* Profile Card */}
            <View style={styles.card}>
              <View style={styles.profileHeader}>
                <TouchableOpacity onPress={pickImage} style={styles.profileImageContainer}>
                  {userProfile?.photoURL ? (
                    <Image source={{ uri: userProfile.photoURL }} style={styles.profileImage} />
                  ) : (
                    <View style={styles.profileImageFallback}>
                      <Text style={styles.profileImageFallbackText}>
                        {getInitials(userProfile?.firstName || '', userProfile?.lastName || '')}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <View style={styles.profileInfo}>
                  <Text style={styles.userName}>
                    {formatName(
                      userProfile?.firstName || '', 
                      userProfile?.middleName || '', 
                      userProfile?.lastName || ''
                    )}
                  </Text>
                  <Text style={styles.userRole}>
                    {userProfile?.role ? userProfile.role.charAt(0).toUpperCase() + userProfile.role.slice(1) : 'User'}
                  </Text>
                  
                  <View style={styles.statusIndicator}>
                    <View 
                      style={[
                        styles.statusDot, 
                        { backgroundColor: userStatus === 'online' ? '#4CD964' : '#8E8E93' }
                      ]} 
                    />
                    <Text style={styles.statusText}>{formatStatus(userStatus)}</Text>
                  </View>
                  
                  <TouchableOpacity 
                    style={styles.editButton} 
                    onPress={() => navigation.navigate('EditProfile', { userProfile })}
                  >
                    <Text style={styles.editButtonText}>Edit Profile</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Personal Information */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Personal Information</Text>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{userProfile?.email || 'Not provided'}</Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>Role</Text>
                <Text style={styles.infoValue}>
                  {userProfile?.role 
                    ? userProfile.role.charAt(0).toUpperCase() + userProfile.role.slice(1) 
                    : 'Not specified'}
                </Text>
              </View>
              <View style={styles.infoItem}>
                <Text style={styles.infoLabel}>MAC Address</Text>
                {isEditingMac ? (
                  <View style={styles.macAddressEditContainer}>
                    <View style={styles.macInputWrapper}>
                      {macParts.map((part, index) => (
                        <React.Fragment key={index}>
                          <TextInput
                            ref={macInputRefs[index]}
                            style={styles.macAddressPartInput}
                            value={part}
                            onChangeText={(text) => handleMacPartChange(text, index)}
                            onKeyPress={(e) => handleMacKeyPress(e, index)}
                            placeholder="XX"
                            placeholderTextColor="#999"
                            autoCapitalize="characters"
                            maxLength={2}
                            selectTextOnFocus={true}
                          />
                          {index < 5 && <Text style={styles.macAddressColon}>:</Text>}
                        </React.Fragment>
                      ))}
                    </View>
                    <View style={styles.macAddressActions}>
                      <TouchableOpacity
                        style={[styles.macAddressButton, styles.macAddressCancelButton]}
                        onPress={() => {
                          setIsEditingMac(false);
                          if (userProfile?.MacAddress) {
                            const parts = userProfile.MacAddress.split(':');
                            setMacParts(parts);
                          } else {
                            setMacParts(['', '', '', '', '', '']);
                          }
                        }}
                      >
                        <Ionicons name="close" size={20} color="#FF3B30" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.macAddressButton, styles.macAddressSaveButton]}
                        onPress={handleSaveMacAddress}
                      >
                        <Ionicons name="checkmark" size={20} color="#34C759" />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.macAddressHint}>Enter MAC address in hexadecimal format</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.macAddressDisplay}
                    onPress={() => {
                      if (userProfile?.MacAddress) {
                        const parts = userProfile.MacAddress.split(':');
                        setMacParts(parts);
                      }
                      setIsEditingMac(true);
                    }}
                  >
                    <Text style={[
                      styles.infoValue,
                      !userProfile?.MacAddress && styles.macAddressPlaceholder
                    ]}>
                      {userProfile?.MacAddress || 'Set MAC Address'}
                    </Text>
                    <Ionicons name="pencil" size={16} color="#007AFF" style={styles.editIcon} />
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity 
                style={styles.locationHistoryButton}
                onPress={() => navigation.navigate('locationLogs')}
              >
                <Ionicons name="location-outline" size={20} color="#007AFF" />
                <Text style={styles.locationHistoryButtonText}>View Location History</Text>
              </TouchableOpacity>
            </View>

            {/* Activity Log */}
            <ActivityLog />

            {/* Team Section - Only for owners */}
            {userProfile?.role === 'owner' && (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Team Information</Text>
                  <View style={styles.teamCodeContainer}>
                    <View>
                      <Text style={styles.infoLabel}>Team Code</Text>
                      <Text style={styles.teamCodeDescription}>Share this code to invite team members</Text>
                    </View>
                    <View style={styles.codeBox}>
                      <Text style={styles.teamCode}>{userProfile.teamCode || 'No team code found'}</Text>
                      <TouchableOpacity 
                        onPress={() => {
                          if (userProfile.teamCode) {
                            Clipboard.setString(userProfile.teamCode);
                            Alert.alert('Copied', 'Team code copied to clipboard');
                          }
                        }}
                        disabled={!userProfile.teamCode}
                        style={styles.copyButton}
                      >
                        <Ionicons name="copy-outline" size={20} color="#007AFF" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Team Members ({teamMembers.length})</Text>
                  {teamMembers.length > 0 ? (
                    <View>
                      {teamMembers.map(item => (
                        <View key={item.id} style={styles.memberItem}>
                          <View style={styles.memberInfo}>
                            {item.photoURL ? (
                              <Image source={{ uri: item.photoURL }} style={styles.memberAvatar} />
                            ) : (
                              <View style={styles.memberAvatarFallback}>
                                <Text style={styles.memberAvatarText}>
                                  {item.name ? item.name[0].toUpperCase() : '?'}
                                </Text>
                              </View>
                            )}
                            <View style={styles.memberTextInfo}>
                              <Text style={styles.memberName}>{item.name || 'Unknown User'}</Text>
                              <Text style={styles.memberEmail}>{item.email || 'No email'}</Text>
                              <Text style={styles.lastSeen}>
                                {item.isActive ? 'Online' : `Last seen ${formatLastSeen(item.lastSeen)}`}
                              </Text>
                            </View>
                            <View style={[
                              styles.statusDot,
                              { backgroundColor: item.isActive ? '#4CD964' : '#8E8E93' }
                            ]} />
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.emptyTeamContainer}>
                      <Text style={styles.emptyTeamText}>No team members yet</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <Navbar activePage="profile" />
    </View>
  );
}

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value || 'Not provided'}</Text>
  </View>
);

const InviteTeamMemberButton = ({ teamCode, onInviteSent }) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const inputRef = React.useRef(null);

  useEffect(() => {
    if (modalVisible && inputRef.current) {
      setTimeout(() => {
        inputRef.current.focus();
      }, 300);
    }
  }, [modalVisible]);

  const handleSendInvite = async () => {
    if (!email || !email.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }

    Keyboard.dismiss();
    setIsInviting(true);
    
    try {
      if (!auth.currentUser) {
        throw new Error("You must be logged in to send invitations");
      }
      
      // Generate a safer invitation ID that doesn't use encodeURIComponent
      // Replace @ and . with _ to avoid Firebase path issues
      const safeEmail = email.trim().replace(/[@.]/g, '_');
      const uniqueInviteId = `${safeEmail}_${Date.now()}`;
      const invitationRef = ref(db, `invitations/${uniqueInviteId}`);
      
      // Get owner profile for name
      const ownerProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const ownerSnapshot = await get(ownerProfileRef);
      const ownerData = ownerSnapshot.exists() ? ownerSnapshot.val() : {};
      
      const ownerName = formatName(
        ownerData.firstName || '', 
        ownerData.middleName || '', 
        ownerData.lastName || ''
      );
      
      // Create user with temporary password
      const result = await createUserWithTempPassword(
        email.trim(),
        teamCode,
        ownerName,
        auth.currentUser.uid,
        uniqueInviteId // Pass the unique ID to avoid conflicts
      );
      
      if (result.success) {
        await logAudit(
          AUDIT_ACTIONS.MEMBER_INVITED, 
          { inviteeEmail: email.trim() },
          auth.currentUser.uid
        );

        const successMessage = `Invitation created successfully for ${email.trim()}!\n\nTemporary password: ${result.password}\n\nPlease share these credentials with the user manually.`;

        Alert.alert(
          'Success',
          successMessage,
          [{ text: 'OK', onPress: () => {
            setEmail('');
            setModalVisible(false);
            if (onInviteSent) onInviteSent();
          }}]
        );
      } else {
        throw new Error(result.error || 'Failed to create user and send invitation');
      }
    } catch (error) {
      console.error('Error sending invitation:', error);
      Alert.alert('Error', 'Failed to send invitation: ' + error.message);
    } finally {
      setIsInviting(false);
    }
  };
  
  return (
    <>
      <TouchableOpacity
        style={styles.inviteButton}
        onPress={() => setModalVisible(true)}
      >
        <Ionicons name="person-add" size={20} color="#FFFFFF" />
        <Text style={styles.inviteButtonText}>Invite Team Member</Text>
      </TouchableOpacity>
      
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="none"
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}>
          <View style={{
            position: 'absolute',
            top: 100,
            left: 20,
            right: 20,
            backgroundColor: 'white',
            borderRadius: 15,
            padding: 20,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.3,
            shadowRadius: 4,
            elevation: 5,
          }}>
            <Text style={{
              fontSize: 18,
              fontWeight: 'bold',
              marginBottom: 15,
              textAlign: 'center',
              color: '#000'
            }}>Invite Team Member</Text>
            
            <TextInput
              ref={inputRef}
              style={{
                borderWidth: 1,
                borderColor: '#ccc',
                borderRadius: 10,
                padding: 15,
                fontSize: 16,
                color: '#000',
                backgroundColor: '#fff',
                marginBottom: 20
              }}
              placeholder="Enter email address"
              placeholderTextColor="#888"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCompleteType="email"
              textContentType="emailAddress"
              clearButtonMode="while-editing"
            />
            
            <View style={{
              flexDirection: 'row',
              justifyContent: 'space-between'
            }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  marginRight: 10,
                  backgroundColor: '#f2f2f2',
                  padding: 15,
                  borderRadius: 10,
                  alignItems: 'center'
                }}
                onPress={() => {
                  Keyboard.dismiss();
                  setModalVisible(false);
                }}
              >
                <Text style={{
                  color: '#666',
                  fontWeight: 'bold',
                  fontSize: 16
                }}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={{
                  flex: 1,
                  backgroundColor: '#007AFF',
                  padding: 15,
                  borderRadius: 10,
                  alignItems: 'center'
                }}
                onPress={handleSendInvite}
                disabled={isInviting}
              >
                {isInviting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={{
                    color: '#FFF',
                    fontWeight: 'bold',
                    fontSize: 16
                  }}>Invite</Text>
                )}
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                padding: 5
              }}
              onPress={() => {
                Keyboard.dismiss();
                setModalVisible(false);
              }}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
  safeArea: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 120, // Extra padding for the navbar
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 15,
    overflow: 'hidden',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  profileImageFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImageFallbackText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#007AFF',
  },
  profileInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  userRole: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  editButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  infoLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardHeaderButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  teamCodeContainer: {
    marginBottom: 16,
  },
  teamCodeDescription: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  teamCode: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  copyButton: {
    padding: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 16,
  },
  inviteButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  inviteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  memberItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  memberAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  memberTextInfo: {
    flex: 1,
    marginLeft: 12,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  memberStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginLeft: 10,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
  },
  memberStatus: {
    fontSize: 12,
    color: '#666666',
  },
  memberActions: {
    flexDirection: 'row',
  },
  memberAction: {
    padding: 8,
    marginLeft: 8,
  },
  viewMoreButton: {
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  viewMoreText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  emptyTeamContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyTeamText: {
    color: '#666',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 20,
    textAlign: 'center',
  },
  emailInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: '#F9F9F9'
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F2F2F2',
  },
  inviteModalButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '600',
  },
  inviteModalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  simpleModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  simpleModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    width: '100%',
    paddingBottom: Platform.OS === 'ios' ? 40 : 20
  },
  simpleModalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 20,
    textAlign: 'center',
  },
  simpleModalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 15,
  },
  simpleModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  simpleModalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  simpleModalCancelButton: {
    backgroundColor: '#F2F2F2',
  },
  simpleModalCancelButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '600',
  },
  simpleModalInviteButton: {
    backgroundColor: '#007AFF',
  },
  simpleModalInviteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  lastSeen: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 2,
  },
  locationHistoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  locationHistoryButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 8,
    fontWeight: '500',
  },
  macAddressEditContainer: {
    width: '100%',
    marginTop: 8,
  },
  macInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  macAddressPartInput: {
    width: 40,
    height: 44,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 16,
    color: '#000',
    backgroundColor: '#F9F9F9',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    padding: 0,
  },
  macAddressColon: {
    fontSize: 18,
    color: '#8E8E93',
    marginHorizontal: 4,
    fontWeight: '600',
  },
  macAddressActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
  },
  macAddressButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  macAddressCancelButton: {
    backgroundColor: '#FFE5E5',
  },
  macAddressSaveButton: {
    backgroundColor: '#E5FFE9',
  },
  macAddressDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  macAddressPlaceholder: {
    color: '#007AFF',
    fontStyle: 'italic',
  },
  editIcon: {
    marginLeft: 8,
  },
  macAddressHint: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 12,
    textAlign: 'center',
  },
}); 