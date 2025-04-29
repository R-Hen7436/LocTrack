import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, Modal, TextInput, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { getAuth, signOut, updateProfile } from 'firebase/auth';
import { ref, get, set, onValue } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Device from 'expo-device';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import Navbar from '../Navbar';
import { auth, db, storage } from '../firebaseConfig';
import { useFocusEffect } from '@react-navigation/native';
import { getDatabase } from 'firebase/database';
import { Clipboard } from 'react-native';
import { logAudit } from '../../utils/auditUtils';
import { AUDIT_ACTIONS } from '../../constants/auditActions';
import ActivityLog from './ActivityLog';
import theme from '../../constants/theme';
import { Button, Card, Input } from '../UI';

// Helper function for formatting names
const formatName = (firstName, middleName, lastName) => {
  const parts = [];
  if (firstName && firstName.trim()) parts.push(firstName.trim());
  if (middleName && middleName.trim()) parts.push(middleName.trim());
  if (lastName && lastName.trim()) parts.push(lastName.trim());
  
  return parts.length > 0 ? parts.join(' ') : 'User';
}

// Helper function for getting initials
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

// Helper for formatting status
const formatStatus = (status) => {
  if (!status) return 'Offline';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

// Helper for formatting MAC address
const formatMacAddress = (parts) => {
  return parts.map(part => part.toUpperCase()).join(':');
};

// Helper for validating MAC address
const isValidMacAddress = (parts) => {
  const regex = /^[0-9A-Fa-f]{2}$/;
  return parts.every(part => regex.test(part)) && parts.length === 6;
};

// InfoRow component
const InfoRow = ({ label, value, icon, copyable = false }) => {
  const handleCopy = () => {
    if (value && copyable) {
      Clipboard.setString(value.toString());
      Alert.alert('Copied', `${label} copied to clipboard`);
    }
  };

  return (
    <View style={styles.infoRow}>
      <View style={styles.infoLabelContainer}>
        {icon && <Ionicons name={icon} size={18} color="#666" style={styles.infoIcon} />}
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <View style={styles.infoValueContainer}>
        <Text style={styles.infoValue}>{value || 'Not set'}</Text>
        {copyable && value && (
          <TouchableOpacity onPress={handleCopy} style={styles.copyButton}>
            <Ionicons name="copy-outline" size={18} color="#007AFF" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// InviteTeamMemberButton component
const InviteTeamMemberButton = ({ teamCode, onInviteSent }) => {
  const [email, setEmail] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSendInvite = async () => {
    if (!email || !email.trim()) {
      setError('Please enter an email address');
      return;
    }

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    setSending(true);
    setError('');

    try {
      // Create an invitation record in the database
      const database = getDatabase();
      const invitationId = `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      await set(ref(database, `invitations/${invitationId}`), {
        teamCode: teamCode,
        email: email.trim().toLowerCase(),
        sentAt: new Date().toISOString(),
        status: 'pending',
      });

      // Log the invitation
      await logAudit(AUDIT_ACTIONS.SEND_INVITATION, {
        teamCode: teamCode,
        recipientEmail: email.trim().toLowerCase(),
        invitationId,
      });

      // Success
      setSending(false);
      setEmail('');
      setShowModal(false);
      
      if (onInviteSent) {
        onInviteSent();
      }
      
      Alert.alert(
        'Invitation Sent',
        `An invitation has been sent to ${email.trim().toLowerCase()} to join your team.`
      );
    } catch (error) {
      console.error('Error sending invitation:', error);
      setError('Failed to send invitation. Please try again.');
      setSending(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        label="Invite Team Member"
        leftIcon="person-add-outline"
        onPress={() => setShowModal(true)}
        style={styles.inviteButton}
      />

      <Modal
        visible={showModal}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Team Member</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#666" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              Enter the email address of the person you want to invite to your team.
            </Text>
            
            <Input
              label="Email Address"
              leftIcon="mail-outline"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              errorText={error}
              placeholder="colleague@example.com"
            />
            
            <View style={styles.modalButtons}>
              <Button
                variant="outline"
                label="Cancel"
                onPress={() => setShowModal(false)}
                style={styles.modalCancelButton}
              />
              <Button
                variant="primary"
                label="Send Invitation"
                onPress={handleSendInvite}
                isLoading={sending}
                disabled={sending}
                style={styles.modalSendButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

export default function Profile({ navigation }) {
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userStatus, setUserStatus] = useState('offline');
  const [isEditingMac, setIsEditingMac] = useState(false);
  const [macParts, setMacParts] = useState(['', '', '', '', '', '']);
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' or 'activity'
  const [deviceName, setDeviceName] = useState('Unknown Device');
  const macInputRefs = Array(6).fill(0).map(() => React.createRef());

  // Add this to hide the navigation header
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: false, // Hide the default navigation header
    });
  }, [navigation]);

  // Load user profile on component focus
  useFocusEffect(
    React.useCallback(() => {
      if (auth?.currentUser?.uid) {
        loadUserProfile();
      } else {
        setLoading(false);
      }
      
      return () => {};
    }, [auth.currentUser?.uid])
  );

  // Monitor user presence status
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

  // Get device name on component mount
  useEffect(() => {
    const getDeviceInfo = async () => {
      try {
        // Get basic device information
        const modelName = Device.modelName || '';
        const brand = Device.brand || '';
        const manufacturer = Device.manufacturer || '';
        
        // Construct device info
        let deviceInfo = '';
        if (brand && modelName) {
          deviceInfo = `${brand} ${modelName}`;
        } else if (manufacturer && modelName) {
          deviceInfo = `${manufacturer} ${modelName}`;
        } else if (modelName) {
          deviceInfo = modelName;
        }

        // Set the device name without additional system info
        setDeviceName(deviceInfo || `${Platform.OS} Device`);
      } catch (error) {
        console.error('Error getting device info:', error);
        setDeviceName(`${Platform.OS} Device`);
      }
    };
    
    getDeviceInfo();
  }, []);

  // Logout handler
  const handleLogout = async () => {
    Alert.alert(
      "Log Out",
      "Are you sure you want to log out?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Log Out", 
          style: "destructive",
          onPress: async () => {
            try {
              await signOut(auth);
            } catch (error) {
              console.error('Error logging out:', error);
              Alert.alert('Error', 'Failed to log out');
            }
          }
        }
      ]
    );
  };

  // Load profile function
  const loadUserProfile = async () => {
    try {
      setLoading(true);
      
      if (!auth || !auth.currentUser) {
          setLoading(false);
          return;
      }
      
      console.log("Loading profile for user ID:", auth.currentUser.uid);
      
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
        
        // Load existing MAC address
        let macAddress = profileData.macAddress || null;
        if (macAddress) {
          const parts = macAddress.split(':');
          if (parts.length === 6) {
            setMacParts(parts);
          }
        }
        
        setUserProfile({
          ...profileData,
          // Fill in any missing fields from auth if needed
          firstName: profileData.firstName || authFirstName,
          lastName: profileData.lastName || authLastName,
          email: profileData.email || auth.currentUser.email,
          uid: auth.currentUser.uid,
          photoURL: profileData.photoURL || auth.currentUser.photoURL,
        });
      } else {
        console.log('No profile data found, creating from auth data');
        
        // Create a basic profile from auth data
        const nameParts = auth.currentUser.displayName ? auth.currentUser.displayName.split(' ') : [];
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
        
        const basicProfile = {
          firstName,
          lastName,
          email: auth.currentUser.email,
          uid: auth.currentUser.uid,
          photoURL: auth.currentUser.photoURL,
          createdAt: new Date().toISOString(),
        };
        
        // Save this basic profile
        await set(userProfileRef, basicProfile);
        setUserProfile(basicProfile);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading user profile:', error);
      setLoading(false);
      Alert.alert('Error', 'Failed to load profile data');
    }
  };

  // Image picker function
  const pickImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permission Denied', 'Permission to access camera roll is required');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        console.log('Image selected:', result.assets[0].uri);
        await uploadImage(result.assets[0].uri);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  // Upload image function
  const uploadImage = async (uri) => {
    try {
      if (!auth?.currentUser?.uid) {
        throw new Error('User not authenticated');
      }
      
      setLoading(true);
      
      // Convert URI to blob
      const response = await fetch(uri);
      const blob = await response.blob();
      
      // Upload to Firebase Storage
      const userImageRef = storageRef(storage, `profile_images/${auth.currentUser.uid}`);
      await uploadBytes(userImageRef, blob);
      
      // Get the download URL
      const downloadURL = await getDownloadURL(userImageRef);
      
      // Update user profile in Authentication
      await updateProfile(auth.currentUser, {
        photoURL: downloadURL
      });
      
      // Update user profile in Database
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      await set(userProfileRef, {
        ...userProfile,
        photoURL: downloadURL,
        updatedAt: new Date().toISOString()
      });
      
      // Update local state
      setUserProfile(prev => ({
        ...prev,
        photoURL: downloadURL
      }));
      
      setLoading(false);
      
    } catch (error) {
      console.error('Error uploading image:', error);
      setLoading(false);
      Alert.alert('Error', 'Failed to upload image');
    }
  };

  // MAC address handlers
  const handleMacPartChange = (text, index) => {
    // Only allow hex characters
    const hexOnly = text.replace(/[^0-9A-Fa-f]/g, '').substring(0, 2);
    
    // Update the MAC parts array
      const newParts = [...macParts];
    newParts[index] = hexOnly;
      setMacParts(newParts);
      
    // Auto-focus next input if this one is filled
    if (hexOnly.length === 2 && index < 5) {
      macInputRefs[index + 1].current?.focus();
    }
  };

  const handleMacKeyPress = (e, index) => {
    // Handle backspace key - move to previous input when empty
    if (e.nativeEvent.key === 'Backspace' && macParts[index] === '' && index > 0) {
      macInputRefs[index - 1].current?.focus();
    }
  };

  const handleSaveMacAddress = async () => {
    try {
      // Validate MAC address format
    if (!isValidMacAddress(macParts)) {
        Alert.alert('Invalid MAC Address', 'Please enter a valid MAC address (6 hex pairs)');
      return;
    }

      setLoading(true);
      
      // Format the MAC address
      const macAddress = formatMacAddress(macParts);
      
      // Update the profile in the database
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      await set(userProfileRef, {
        ...userProfile,
        macAddress,
        updatedAt: new Date().toISOString()
      });

      // Update local state
      setUserProfile(prev => ({
        ...prev,
        macAddress
      }));
      
      setIsEditingMac(false);
      setLoading(false);
      
      Alert.alert('Success', 'MAC address has been updated');
      
    } catch (error) {
      console.error('Error saving MAC address:', error);
      setLoading(false);
      Alert.alert('Error', 'Failed to save MAC address');
    }
  };

  if (loading) {
  return (
          <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4682B4" />
            <Text style={styles.loadingText}>Loading profile...</Text>
          </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Update header to match Logs and UserManagement style */}
      <View style={styles.headerContainer}>
        <Text style={styles.header}>My Profile</Text>
        <TouchableOpacity 
          style={styles.refreshButton}
          onPress={loadUserProfile}
        >
          <Ionicons name="refresh" size={20} color="#007AFF" />
        </TouchableOpacity>
      </View>
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card (NOT a header) */}
        <View style={styles.profileCard}>
              <View style={styles.profileHeader}>
                <TouchableOpacity onPress={pickImage} style={styles.profileImageContainer}>
                  {userProfile?.photoURL ? (
                <Image 
                  source={{ uri: userProfile.photoURL }} 
                  style={styles.profileImage}
                />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Text style={styles.profileImagePlaceholderText}>
                    {getInitials(userProfile?.firstName, userProfile?.lastName)}
                      </Text>
                    </View>
                  )}
              <View style={styles.cameraIconContainer}>
                <Ionicons name="camera" size={16} color="#FFFFFF" />
              </View>
                </TouchableOpacity>
            
                <View style={styles.profileInfo}>
              <Text style={styles.profileName}>
                {formatName(userProfile?.firstName, userProfile?.middleName, userProfile?.lastName)}
                  </Text>
              <Text style={styles.profileEmail}>{userProfile?.email}</Text>
                  
              <View style={styles.statusRow}>
                <View style={[
                        styles.statusDot, 
                  userStatus === 'online' ? styles.statusOnline : 
                  userStatus === 'away' ? styles.statusAway : 
                  styles.statusOffline
                ]} />
                    <Text style={styles.statusText}>{formatStatus(userStatus)}</Text>
              </View>
                  </View>
                  
                  <TouchableOpacity 
                    style={styles.editButton} 
                    onPress={() => navigation.navigate('EditProfile', { userProfile })}
                  >
              <Ionicons name="pencil-outline" size={18} color="#4682B4" />
                  </TouchableOpacity>
              </View>
            </View>

        {/* Tabs */}
        <View style={styles.tabContainer}>
                      <TouchableOpacity
            style={[styles.tab, activeTab === 'profile' && styles.activeTab]}
            onPress={() => setActiveTab('profile')}
          >
            <Ionicons 
              name="person" 
              size={20} 
              color={activeTab === 'profile' ? "#4682B4" : "#666666"} 
            />
            <Text style={[
              styles.tabText, 
              activeTab === 'profile' && styles.activeTabText
            ]}>
              Profile
            </Text>
                      </TouchableOpacity>
          
                      <TouchableOpacity
            style={[styles.tab, activeTab === 'activity' && styles.activeTab]}
            onPress={() => setActiveTab('activity')}
          >
            <Ionicons 
              name="time" 
              size={20} 
              color={activeTab === 'activity' ? "#4682B4" : "#666666"} 
            />
                    <Text style={[
              styles.tabText, 
              activeTab === 'activity' && styles.activeTabText
                    ]}>
              Activity
                    </Text>
              </TouchableOpacity>
            </View>

        {activeTab === 'profile' ? (
          <>
            {/* Account Information */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Account Information</Text>
              
              <InfoRow 
                label="Email" 
                value={userProfile?.email} 
                icon="mail-outline"
                copyable
              />
              
              <InfoRow 
                label="Role" 
                value={userProfile?.role === 'owner' ? 'Team Owner' : 'Team Member'}
                icon="people-outline"
              />
              
              {userProfile?.role === 'owner' && userProfile?.teamCode && (
                <InfoRow 
                  label="Team Code" 
                  value={userProfile.teamCode}
                  icon="key-outline"
                  copyable
                />
              )}
              
              <InfoRow 
                label="Account Created" 
                value={userProfile?.createdAt ? new Date(userProfile.createdAt).toLocaleDateString() : 'Unknown'}
                icon="calendar-outline"
              />
              
              {userProfile?.lastLogin && (
                <InfoRow 
                  label="Last Login" 
                  value={new Date(userProfile.lastLogin).toLocaleString()}
                  icon="log-in-outline"
                />
              )}
            </View>
            
            {/* Device Information */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionTitleContainer}>
                <Text style={styles.sectionTitle}>Device Information</Text>
                <TouchableOpacity
                  onPress={() => setIsEditingMac(!isEditingMac)}
                  style={styles.actionButton}
                >
                  <Ionicons 
                    name={isEditingMac ? "close-outline" : "pencil-outline"} 
                    size={20} 
                    color="#4682B4" 
                  />
                </TouchableOpacity>
              </View>
              
              <InfoRow 
                label="Device Name" 
                value={deviceName}
                icon="phone-portrait-outline"
              />
              
              {isEditingMac ? (
                <>
                  <Text style={styles.macAddressLabel}>
                    Enter your device's MAC address:
                  </Text>
                  <View style={styles.macInputContainer}>
                    {macParts.map((part, index) => (
                      <React.Fragment key={index}>
            <TextInput
                          ref={macInputRefs[index]}
                          style={styles.macInput}
                          value={part}
                          onChangeText={(text) => handleMacPartChange(text, index)}
                          onKeyPress={(e) => handleMacKeyPress(e, index)}
                          maxLength={2}
                          autoCapitalize="characters"
                          keyboardType="ascii-capable"
                          selectionColor="#4682B4"
                        />
                        {index < 5 && <Text style={styles.macSeparator}>:</Text>}
                      </React.Fragment>
                    ))}
                  </View>
                  
                  <View style={styles.buttonRow}>
              <TouchableOpacity
                      style={[styles.button, styles.cancelButton]} 
                      onPress={() => setIsEditingMac(false)}
                    >
                      <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                      style={[styles.button, styles.saveButton]} 
                      onPress={handleSaveMacAddress}
                    >
                      <Text style={styles.saveButtonText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <InfoRow 
                  label="MAC Address" 
                  value={userProfile?.macAddress || 'Not set'}
                  icon="wifi-outline"
                  copyable={!!userProfile?.macAddress}
                />
              )}
            </View>
            
            {/* Sign Out Button */}
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={20} color="#4682B4" />
              <Text style={styles.signOutButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityLog userId={auth.currentUser.uid} />
        )}
      </ScrollView>
      
      <View style={styles.navbarContainer}>
        <Navbar activePage="profile" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
  headerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  refreshButton: {
    padding: 8,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 140, // Extra padding for navbar
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileImageContainer: {
    position: 'relative',
    marginRight: 16,
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  profileImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileImagePlaceholderText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 2,
  },
  profileEmail: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusOnline: {
    backgroundColor: '#4682B4',
  },
  statusAway: {
    backgroundColor: '#FFCC00',
  },
  statusOffline: {
    backgroundColor: '#8E8E93',
  },
  statusText: {
    fontSize: 12,
    color: '#666666',
  },
  editButton: {
    backgroundColor: '#F0F0F0',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  activeTab: {
    backgroundColor: 'rgba(70, 130, 180, 0.1)',
  },
  tabText: {
    fontSize: 14,
    color: '#666666',
    marginLeft: 6,
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: 'bold',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 12,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionButton: {
    backgroundColor: '#F0F0F0',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  infoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoIcon: {
    marginRight: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: '#666666',
  },
  infoValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoValue: {
    fontSize: 14,
    color: '#333333',
    fontWeight: '500',
  },
  copyButton: {
    marginLeft: 8,
    padding: 4,
  },
  macAddressLabel: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 12,
  },
  macInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  macInput: {
    width: 32,
    height: 40,
    borderWidth: 1,
    borderColor: '#DDDDDD',
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 14,
    color: '#333333',
    backgroundColor: '#FFFFFF',
  },
  macSeparator: {
    marginHorizontal: 4,
    color: '#666666',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
  },
  cancelButton: {
    backgroundColor: '#F0F0F0',
  },
  saveButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    fontSize: 14,
    color: '#666666',
    fontWeight: '500',
  },
  saveButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  teamDescription: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  inviteButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  inviteButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 8,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#007AFF',
    marginBottom: 32,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
  },
  signOutButtonText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    width: '90%',
    padding: 20,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333333',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalCancelButton: {
    marginRight: 8,
  },
  navbarContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 12,
    color: '#666666',
    fontSize: 16,
  },
}); 