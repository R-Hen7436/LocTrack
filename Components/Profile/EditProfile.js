import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ScrollView } from 'react-native';
import { updateProfile, updatePassword } from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { auth, db } from '../firebaseConfig';

export default function EditProfile({ navigation, route }) {
  const { userProfile } = route.params;
  const [editedProfile, setEditedProfile] = useState({
    firstName: userProfile.firstName || '',
    middleName: userProfile.middleName || '',
    lastName: userProfile.lastName || '',
  });
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSave = async () => {
    try {
      // Validate required fields
      if (!editedProfile.firstName || !editedProfile.lastName) {
        Alert.alert('Error', 'First name and last name are required');
        return;
      }

      // Validate password if it's being changed
      if (newPassword || confirmPassword) {
        if (newPassword !== confirmPassword) {
          Alert.alert('Error', 'Passwords do not match');
          return;
        }
        if (newPassword.length < 6) {
          Alert.alert('Error', 'Password must be at least 6 characters long');
          return;
        }
      }

      // Update Firebase Auth profile
      if (editedProfile.firstName !== userProfile.firstName || 
          editedProfile.lastName !== userProfile.lastName) {
        await updateProfile(auth.currentUser, {
          displayName: `${editedProfile.firstName} ${editedProfile.lastName}`
        });
      }

      // Update password if changed
      if (newPassword) {
        await updatePassword(auth.currentUser, newPassword);
      }

      // Update profile in database
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const updatedProfile = {
        ...userProfile,
        firstName: editedProfile.firstName,
        lastName: editedProfile.lastName,
        middleName: editedProfile.middleName || '',
      };
      
      await set(userProfileRef, updatedProfile);
      Alert.alert(
        'Success', 
        'Profile updated successfully',
        [
          { 
            text: 'OK', 
            onPress: () => {
              // Navigate back to refresh the profile
              navigation.navigate('Profile', { refresh: Date.now() });
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="chevron-back" size={24} color="#007AFF" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Information</Text>
          
          <View style={styles.inputContainer}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput
              style={styles.input}
              value={editedProfile.firstName}
              onChangeText={(text) => setEditedProfile({...editedProfile, firstName: text})}
              placeholder="Enter your first name"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Middle Name</Text>
            <TextInput
              style={styles.input}
              value={editedProfile.middleName}
              onChangeText={(text) => setEditedProfile({...editedProfile, middleName: text})}
              placeholder="Enter your middle name (optional)"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Last Name *</Text>
            <TextInput
              style={styles.input}
              value={editedProfile.lastName}
              onChangeText={(text) => setEditedProfile({...editedProfile, lastName: text})}
              placeholder="Enter your last name"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change Password</Text>
          <Text style={styles.passwordNote}>Leave blank if you don't want to change your password</Text>
          
          <View style={styles.inputContainer}>
            <Text style={styles.label}>New Password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              secureTextEntry
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              secureTextEntry
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.saveButton}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#fff',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
    marginLeft: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  placeholder: {
    width: 70,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: '#000',
    backgroundColor: '#fff',
  },
  passwordNote: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginBottom: 20,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#fff',
  },
  saveButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 