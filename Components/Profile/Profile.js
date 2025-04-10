import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image, Modal, TextInput, ActivityIndicator, SafeAreaView } from 'react-native';
import { getAuth, signOut, updateProfile } from 'firebase/auth';
import { ref, get, set, remove } from 'firebase/database';
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

export default function Profile({ navigation }) {
  const [userProfile, setUserProfile] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isInviteModalVisible, setIsInviteModalVisible] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  useEffect(() => {
    console.log("Profile component mounted");
    console.log("Auth state:", auth?.currentUser?.uid);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      console.log("Focus effect triggered");
      if (auth?.currentUser?.uid) {
        console.log("Loading profile for user:", auth.currentUser.uid);
        loadUserProfile();
      } else {
        console.error("No current user in auth");
        setLoading(false);
      }
    }, [])
  );

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
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data loaded:', profileData);
        
        // Ensure all required fields exist with fallbacks
        const cleanedProfile = {
          firstName: profileData.firstName || '',
          lastName: profileData.lastName || '',
          middleName: profileData.middleName || '',
          email: profileData.email || auth.currentUser.email || '',
          photoURL: profileData.photoURL || auth.currentUser.photoURL || '',
          role: profileData.role || 'member',
          teamCode: profileData.teamCode || '',
          ...profileData // keep any other fields
        };
        
        setUserProfile(cleanedProfile);
        
        if (cleanedProfile.role === 'owner' && cleanedProfile.teamCode) {
          await loadTeamMembers();
        }
      } else {
        console.log("No profile data found, creating default profile");
        
        // Create default profile from auth data
        const defaultProfile = {
          firstName: auth.currentUser.displayName ? auth.currentUser.displayName.split(' ')[0] : '',
          lastName: auth.currentUser.displayName ? auth.currentUser.displayName.split(' ').slice(1).join(' ') : '',
          middleName: '',
          email: auth.currentUser.email || '',
          photoURL: auth.currentUser.photoURL || '',
          role: 'member',
          teamCode: '',
          createdAt: new Date().toISOString()
        };
        
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
    if (!auth.currentUser || userProfile?.role !== 'owner') return;
    
    try {
      const teamCode = userProfile.teamCode;
      if (!teamCode) return;
      
      const db = getDatabase();
      const teamRef = ref(db, `teams/${teamCode}/members`);
      const snapshot = await get(teamRef);
      
      const members = [];
      
      if (snapshot.exists()) {
        snapshot.forEach((child) => {
          members.push({
            id: child.key,
            ...child.val()
          });
        });
      }
      
      for (const member of members) {
        const userRef = ref(db, `users/${member.id}/profile`);
        const userSnapshot = await get(userRef);
        
        if (userSnapshot.exists()) {
          const userData = userSnapshot.val();
          member.name = formatName(userData.firstName, userData.middleName, userData.lastName);
          member.email = userData.email || '';
          member.isActive = userData.isActive !== false;
        }
      }
      
      setTeamMembers(members);
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

  const handleInvite = async () => {
    if (!inviteEmail || !inviteEmail.trim()) {
      Alert.alert('Error', 'Please enter an email address');
      return;
    }

    setIsInviting(true);
    try {
      const invitationRef = ref(db, `invitations/${encodeURIComponent(inviteEmail.trim())}`);
      
      const existingInvitation = await get(invitationRef);
      if (existingInvitation.exists()) {
        Alert.alert('Error', 'An invitation has already been sent to this email');
        setIsInviting(false);
        return;
      }
      
      await set(invitationRef, {
        teamCode: userProfile.teamCode,
        ownerId: auth.currentUser.uid,
        ownerEmail: userProfile.email || '',
        ownerName: formatName(userProfile.firstName, userProfile.middleName, userProfile.lastName),
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      await logAudit(
        AUDIT_ACTIONS.MEMBER_INVITED, 
        { inviteeEmail: inviteEmail.trim() },
        auth.currentUser.uid
      );

      Alert.alert(
        'Success',
        'Invitation sent successfully!',
        [{ text: 'OK', onPress: () => setIsInviteModalVisible(false) }]
      );
      setInviteEmail('');
    } catch (error) {
      console.error('Error sending invitation:', error);
      Alert.alert('Error', 'Failed to send invitation. Please try again.');
    } finally {
      setIsInviting(false);
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

  const InviteModal = () => (
    <Modal
      visible={isInviteModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setIsInviteModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Invite Team Member</Text>
          <TextInput
            style={styles.emailInput}
            placeholder="Enter email address"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton]}
              onPress={() => {
                setIsInviteModalVisible(false);
                setInviteEmail('');
              }}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalButton, styles.inviteButton]}
              onPress={handleInvite}
              disabled={isInviting}
            >
              {isInviting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.inviteButtonText}>Send Invite</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <SafeAreaView style={styles.safeArea}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Loading profile...</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContainer}>
              {userProfile ? (
                <>
                  <View style={styles.profileCard}>
                    <View style={styles.profileHeader}>
                      <TouchableOpacity onPress={pickImage} style={styles.profileImageContainer}>
                        {userProfile.photoURL ? (
                          <Image source={{ uri: userProfile.photoURL }} style={styles.profileImage} />
                        ) : (
                          <View style={styles.profileImageFallback}>
                            <Text style={styles.profileImageFallbackText}>
                              {getInitials(userProfile.firstName, userProfile.lastName)}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                      <View style={styles.profileInfo}>
                        <Text style={styles.userName}>
                          {formatName(userProfile.firstName, userProfile.middleName, userProfile.lastName)}
                        </Text>
                        <Text style={styles.userRole}>{userProfile.role ? userProfile.role.charAt(0).toUpperCase() + userProfile.role.slice(1) : 'User'}</Text>
                      </View>
                    </View>
                    <TouchableOpacity 
                      style={styles.editButton} 
                      onPress={() => navigation.navigate('EditProfile', { userProfile })}
                    >
                      <Text style={styles.editButtonText}>Edit Profile</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.infoSection}>
                    <Text style={styles.sectionTitle}>Personal Information</Text>
                    <View style={styles.infoCard}>
                      <InfoRow label="Email" value={userProfile.email || 'Not provided'} />
                      <InfoRow 
                        label="Role" 
                        value={
                          userProfile.role 
                            ? userProfile.role.charAt(0).toUpperCase() + userProfile.role.slice(1) 
                            : 'Not specified'
                        } 
                      />
                    </View>
                  </View>

                  <ActivityLog />

                  {userProfile.role === 'owner' && (
                    <>
                      <View style={styles.infoSection}>
                        <Text style={styles.sectionTitle}>Team Information</Text>
                        <View style={styles.infoCard}>
                          <Text style={styles.label}>Team Code</Text>
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
                            >
                              <Ionicons name="copy-outline" size={20} color="#007AFF" />
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity
                            style={styles.inviteTeamButton}
                            onPress={() => setIsInviteModalVisible(true)}
                          >
                            <Ionicons name="person-add" size={20} color="#FFFFFF" />
                            <Text style={styles.inviteTeamButtonText}>Invite Member</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.infoSection}>
                        <Text style={styles.sectionTitle}>Team Members ({teamMembers.length})</Text>
                        {teamMembers.length > 0 ? (
                          <View>
                            {teamMembers.map(item => (
                              <View key={item.id} style={styles.memberCard}>
                                <View style={styles.memberInfo}>
                                  <Ionicons name="person" size={24} color="#007AFF" />
                                  <View style={styles.memberTextInfo}>
                                    <Text style={styles.memberName}>{item.name || 'Unknown User'}</Text>
                                    <Text style={styles.memberEmail}>{item.email || 'No email'}</Text>
                                    <Text style={styles.memberJoined}>
                                      Joined: {item.joinedAt ? new Date(item.joinedAt).toLocaleDateString() : 'Unknown'}
                                    </Text>
                                  </View>
                                </View>
                                
                                <View style={styles.memberActions}>
                                  <TouchableOpacity
                                    style={styles.memberAction}
                                    onPress={() => handleTransferOwnership(item)}
                                  >
                                    <Ionicons name="star" size={18} color="#FFD700" />
                                  </TouchableOpacity>
                                  
                                  <TouchableOpacity
                                    style={styles.memberAction}
                                    onPress={() => handleRemoveMember(item)}
                                  >
                                    <Ionicons name="close-circle" size={18} color="#FF3B30" />
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={styles.noMembers}>No team members yet</Text>
                        )}
                      </View>
                    </>
                  )}
                </>
              ) : (
                <View style={styles.profileCard}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.loadingText}>Unable to load profile</Text>
                </View>
              )}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
      <InviteModal />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 20,
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
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
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
    fontSize: 22,
    fontWeight: '600',
    color: '#000',
    marginBottom: 5,
  },
  userRole: {
    fontSize: 16,
    color: '#666',
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignSelf: 'center',
  },
  editButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  infoSection: {
    marginBottom: 25,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 15,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  label: {
    fontSize: 16,
    color: '#666',
  },
  value: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
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
  memberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  memberInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  memberTextInfo: {
    marginLeft: 10,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
  },
  memberEmail: {
    fontSize: 14,
    color: '#666666',
    marginTop: 2,
  },
  memberJoined: {
    fontSize: 12,
    color: '#888888',
    marginTop: 4,
  },
  memberActions: {
    flexDirection: 'row',
  },
  memberAction: {
    padding: 8,
    marginLeft: 8,
  },
  inviteTeamButton: {
    backgroundColor: '#007AFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    marginTop: 15,
    gap: 8,
  },
  inviteTeamButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  noMembers: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: 20,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 20,
    width: '100%',
    maxWidth: 400,
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
  inviteButton: {
    backgroundColor: '#007AFF',
  },
  cancelButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '600',
  },
  inviteButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 