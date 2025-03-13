import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, ScrollView, Image } from 'react-native';
import { getAuth, signOut, updateProfile } from 'firebase/auth';
import { ref, get, set } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import Navbar from '../Navbar';
import { auth, db, storage } from '../firebaseConfig';
import EditProfile from './EditProfile';
import { useFocusEffect } from '@react-navigation/native';

export default function Profile({ navigation }) {
  const [userProfile, setUserProfile] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    React.useCallback(() => {
      loadUserProfile();
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

  const loadUserProfile = async () => {
    try {
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data:', profileData);
        setUserProfile(profileData);
        
        if (profileData.role === 'owner' && profileData.teamCode) {
          await loadTeamMembers();
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
      const teamRef = ref(db, `teams/${auth.currentUser.uid}/members`);
      const snapshot = await get(teamRef);
      
      if (snapshot.exists()) {
        const members = [];
        const memberPromises = [];
        
        snapshot.forEach((child) => {
          const memberPromise = get(ref(db, `users/${child.key}`))
            .then((userSnapshot) => {
              if (userSnapshot.exists()) {
                const userData = userSnapshot.val();
                return {
                  id: child.key,
                  email: userData.email,
                  role: userData.role,
                  name: userData.name || 'No Name'
                };
              }
              return null;
            })
            .catch((error) => {
              console.error(`Error fetching member ${child.key}:`, error);
              return null;
            });
          
          memberPromises.push(memberPromise);
        });

        const resolvedMembers = await Promise.all(memberPromises);
        const validMembers = resolvedMembers.filter(member => member !== null);
        
        if (validMembers.length === 0) {
          // If no valid members found, clear the team members from Firebase
          await set(teamRef, null);
          setTeamMembers([]);
        } else {
          setTeamMembers(validMembers);
        }
      } else {
        setTeamMembers([]);
      }
    } catch (error) {
      console.error("Error loading team members:", error);
      setTeamMembers([]);
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

  const renderMember = ({ item }) => (
    <View style={styles.memberCard}>
      <Ionicons name="person" size={24} color="#007AFF" />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{item.name}</Text>
        <Text style={styles.memberEmail}>{item.email}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <View style={styles.profileHeader}>
            <TouchableOpacity onPress={pickImage}>
              {userProfile?.photoURL ? (
                <Image
                  source={{ uri: userProfile.photoURL }}
                  style={styles.profileImage}
                />
              ) : (
                <View style={styles.profileImagePlaceholder}>
                  <Ionicons name="person-circle-outline" size={80} color="#007AFF" />
                </View>
              )}
            </TouchableOpacity>
            <Text style={styles.name}>
              {userProfile?.firstName} {userProfile?.middleName} {userProfile?.lastName}
            </Text>
            <TouchableOpacity 
              style={styles.editButton} 
              onPress={() => navigation.navigate('EditProfile', { userProfile })}
            >
              <Text style={styles.editButtonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoSection}>
            <Text style={styles.sectionTitle}>Profile Information</Text>
            <View style={styles.infoCard}>
              <InfoRow label="Email" value={userProfile?.email} />
              <InfoRow label="Role" value={userProfile?.role?.charAt(0).toUpperCase() + userProfile?.role?.slice(1)} />
            </View>
          </View>

          {userProfile?.role === 'owner' && (
            <>
              <View style={styles.infoSection}>
                <Text style={styles.sectionTitle}>Team Information</Text>
                <View style={styles.infoCard}>
                  <Text style={styles.label}>Team Code</Text>
                  <View style={styles.codeBox}>
                    <Text style={styles.teamCode}>{userProfile?.teamCode || 'No team code found'}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.infoSection}>
                <Text style={styles.sectionTitle}>Team Members ({teamMembers.length})</Text>
                <FlatList
                  data={teamMembers}
                  renderItem={renderMember}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={
                    <Text style={styles.noMembers}>No team members yet</Text>
                  }
                  scrollEnabled={false}
                  nestedScrollEnabled={true}
                />
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <Navbar activePage="profile" />
    </View>
  );
}

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  titleContainer: {
    paddingTop: 60,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 120,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 30,
  },
  name: {
    fontSize: 24,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 5,
    color: '#000',
    textAlign: 'center',
  },
  editButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 10,
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  codeBox: {
    backgroundColor: '#007AFF',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  teamCode: {
    fontSize: 20,
    color: '#fff',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  memberCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  memberInfo: {
    marginLeft: 10,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  memberEmail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  noMembers: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    padding: 20,
  },
  logoutButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 20,
    marginBottom: 80,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 10,
  },
  profileImagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
}); 