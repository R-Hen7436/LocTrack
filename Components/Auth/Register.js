import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { getDatabase, ref, set, get } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { getAdminConfig } from '../Admin/adminConfig';
import { generateProductKey, validateProductKey, generateTeamCode, formatUserDisplayName } from '../firebaseConfig';

export default function Register({ navigation }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [productKey, setProductKey] = useState('');
  const [teamCode, setTeamCode] = useState('');
  const [role, setRole] = useState('member'); 
  const [isAdmin, setIsAdmin] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const handleRegister = async () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim()) {
      setError('First name, last name, email, and password are required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    // Prevent admin registration through normal flow
    if (email.toLowerCase() === getAdminConfig().email.toLowerCase()) {
      setError('This email address is reserved');
      return;
    }

    if (role === 'owner' && !productKey.trim()) {
      setError('Product key is required for owner registration');
      return;
    }

    if (role === 'member' && !teamCode.trim()) {
      setError('Team invitation code is required for member registration');
      return;
    }

    try {
      const auth = getAuth();
      const db = getDatabase();
      
      console.log('Starting registration process, selected role:', role);

      // Validate product key for owner registration
      let isValidOwner = false;
      if (role === 'owner') {
        try {
          console.log('Attempting to validate product key during registration:', productKey.trim());
          await validateProductKey(productKey.trim(), email);
          console.log('Product key validation successful');
          isValidOwner = true;
        } catch (error) {
          console.error('Product key validation failed:', error.message);
          setError(error.message);
          return;
        }
      }

      // If member, verify team code exists
      if (role === 'member') {
        const teamsRef = ref(db, 'users');
        const snapshot = await get(teamsRef);
        let teamFound = false;
        
        if (snapshot.exists()) {
          snapshot.forEach((child) => {
            const userData = child.val();
            if (userData?.profile?.teamCode === teamCode.trim() && userData?.profile?.role === 'owner') {
              teamFound = true;
            }
          });
        }
        
        if (!teamFound) {
          setError('Invalid team code');
          return;
        }
      }

      console.log('Creating user account...');
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      console.log('User created with ID:', userCredential.user.uid);
      
      // Generate team code for owner
      const generatedTeamCode = role === 'owner' ? generateTeamCode() : null;
      console.log('Generated Team Code:', generatedTeamCode);
      
      // First update the display name in Firebase Auth
      await updateProfile(userCredential.user, {
        displayName: formatUserDisplayName(firstName, middleName, lastName)
      });
      console.log('User display name updated to:', formatUserDisplayName(firstName, middleName, lastName));
      
      // Then create the user profile with full data
      await createUserProfile(
        userCredential.user, 
        generatedTeamCode, 
        role === 'owner'
      );
      console.log('User profile created with role:', role === 'owner' ? 'owner' : 'member');
      
      // Initialize location data
      await set(ref(db, `UsersCurrentLocation/${userCredential.user.uid}`), {
        Latitude: null,
        Longitude: null,
        Accuracy: null,
        Timestamp: new Date().toISOString(),
        userId: userCredential.user.uid
      });
      console.log('User location data initialized');
      
      try {
        await sendEmailVerification(userCredential.user);
        console.log('Verification email sent successfully');
        setMessage('Registration successful! Please check your email for verification.');
        if (role === 'owner') {
          setMessage(msg => msg + `\nYour team code is: ${generatedTeamCode}`);
        }
      } catch (error) {
        console.error('Error sending verification email:', error);
        // Don't block registration if email verification fails
        setMessage('Registration successful! However, there was an issue sending the verification email. You can request a new verification email from the login screen.');
      }
      
      setError('');
      
      // Add a delay before navigation to show the success message
      setTimeout(() => {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          })
        );
      }, 3000);

    } catch (error) {
      console.error('Registration Error:', error);
      setError(error.message);
      setMessage('');
    }
  };

  const createUserProfile = async (user, newTeamCode, isOwner) => {
    try {
      console.log(`Creating profile for user ${user.uid}, isOwner: ${isOwner}, teamCode: ${newTeamCode || teamCode}`);
      
      const database = getDatabase();
      const userProfileRef = ref(database, `users/${user.uid}/profile`);
      
      // Basic profile data
      const profileData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        middleName: middleName.trim() || '',
        email: email.trim().toLowerCase(),
        role: isOwner ? 'owner' : 'member',
        teamCode: isOwner ? newTeamCode : teamCode.trim(),
        photoURL: '',
        isOwner: isOwner, // Explicitly set the isOwner flag
        createdAt: new Date().toISOString(),
      };
      
      console.log('Saving profile data:', profileData);
      
      // Save user profile
      await set(userProfileRef, profileData);
      console.log('Profile data saved successfully');
      
      // If owner, create team record
      if (isOwner) {
        console.log(`Creating new team with code ${newTeamCode}`);
        const teamRef = ref(database, `teams/${newTeamCode}`);
        const teamData = {
          name: `${firstName.trim()}'s Team`,
          createdBy: user.uid,
          ownerId: user.uid,
          createdAt: new Date().toISOString(),
          members: {
            [user.uid]: {
              role: 'owner',
              joinedAt: new Date().toISOString(),
            }
          },
          teamCode: newTeamCode
        };
        
        await set(teamRef, teamData);
        console.log('Team created successfully');
      } 
      // If member, add to existing team
      else if (teamCode) {
        console.log(`Adding user to existing team with code ${teamCode}`);
        const teamMemberRef = ref(database, `teams/${teamCode}/members/${user.uid}`);
        await set(teamMemberRef, {
          role: 'member',
          joinedAt: new Date().toISOString(),
          email: email.trim().toLowerCase(),
          name: `${firstName.trim()} ${lastName.trim()}`
        });
        console.log('User added to team successfully');
      }
      
      return true;
    } catch (error) {
      console.error('Error creating user profile:', error);
      throw error;
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerContainer}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>
          Join our secure location tracking platform
        </Text>
      </View>
      
      <TextInput
        style={styles.input}
        placeholder="First Name *"
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
      />

      <TextInput
        style={styles.input}
        placeholder="Middle Name (Optional)"
        value={middleName}
        onChangeText={setMiddleName}
        autoCapitalize="words"
      />

      <TextInput
        style={styles.input}
        placeholder="Last Name *"
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
      />
      
      <TextInput
        style={styles.input}
        placeholder="Email *"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <View style={styles.passwordContainer}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password *"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity 
          style={styles.eyeIcon} 
          onPress={() => setShowPassword(!showPassword)}
        >
          <Ionicons 
            name={showPassword ? "eye-off" : "eye"} 
            size={24} 
            color="gray" 
          />
        </TouchableOpacity>
      </View>
      
      <View style={styles.pickerContainer}>
        <Text style={styles.label}>Register as:</Text>
        <TouchableOpacity 
          style={styles.picker}
          onPress={() => setShowDropdown(!showDropdown)}
        >
          <Text style={[styles.dropdownText, role !== 'member' && styles.selectedText]}>
            {role === 'member' ? 'Member' : 'Owner'}
          </Text>
          <Ionicons 
            name={showDropdown ? "chevron-up" : "chevron-down"} 
            size={24} 
            color="#999" 
          />
        </TouchableOpacity>
        
        {showDropdown && (
          <View style={styles.dropdownContainer}>
            <TouchableOpacity 
              style={styles.dropdownItem} 
              onPress={() => {
                setRole('member');
                setShowDropdown(false);
              }}
            >
              <Text style={[styles.dropdownText, role === 'member' && styles.selectedText]}>
                Member
              </Text>
              {role === 'member' && <Ionicons name="checkmark" size={20} color="#007AFF" />}
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.dropdownItem, { borderBottomWidth: 0 }]}
              onPress={() => {
                setRole('owner');
                setShowDropdown(false);
              }}
            >
              <Text style={[styles.dropdownText, role === 'owner' && styles.selectedText]}>
                Owner
              </Text>
              {role === 'owner' && <Ionicons name="checkmark" size={20} color="#007AFF" />}
            </TouchableOpacity>
          </View>
        )}
      </View>
      
      {role === 'owner' ? (
        <TextInput
          style={styles.input}
          placeholder="Product Key *"
          value={productKey}
          onChangeText={setProductKey}
          autoCapitalize="none"
        />
      ) : (
        <TextInput
          style={styles.input}
          placeholder="Team Invitation Code *"
          value={teamCode}
          onChangeText={setTeamCode}
          autoCapitalize="none"
        />
      )}
      
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{message}</Text> : null}
      
      <TouchableOpacity style={styles.button} onPress={handleRegister}>
        <Text style={styles.buttonText}>Register</Text>
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginBottom: 20,
    borderRadius: 5,
    height: 48,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 5,
    marginBottom: 10,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  link: {
    color: '#007AFF',
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    color: 'red',
    marginBottom: 10,
    textAlign: 'center',
  },
  success: {
    color: 'green',
    marginBottom: 10,
    textAlign: 'center',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    marginBottom: 20,
    height: 48,
  },
  passwordInput: {
    flex: 1,
    padding: 12,
  },
  eyeIcon: {
    padding: 10,
  },
  pickerContainer: {
    marginBottom: 20,
    zIndex: 2,
  },
  label: {
    fontSize: 16,
    marginBottom: 8,
    color: '#999',
  },
  picker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    borderRadius: 5,
    height: 48,
  },
  dropdownContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    marginTop: 5,
    zIndex: 1000,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    overflow: 'hidden',
  },
  dropdownItem: {
    padding: 12,
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: {
    fontSize: 16,
    color: '#333',
  },
  selectedText: {
    color: 'black',
    fontWeight: 'bold',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 10,
  },
}); 