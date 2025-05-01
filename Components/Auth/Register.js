import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ScrollView, 
  KeyboardAvoidingView, 
  Platform,
  SafeAreaView,
  TouchableWithoutFeedback,
  Keyboard,
  Dimensions,
  Alert
} from 'react-native';
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { getDatabase, ref, set, get } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { getAdminConfig } from '../Admin/adminConfig';
import { generateProductKey, validateProductKey, generateTeamCode, formatUserDisplayName } from '../firebaseConfig';
import theme from '../../constants/theme'; // Import theme
import { Card, Input, Button } from '../UI'; // Import UI components

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
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const windowHeight = Dimensions.get('window').height;

  const handleRegister = async () => {
    if (!acceptedTerms) {
      setError('You must accept the Terms and Conditions to register');
      return;
    }

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
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 50 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView 
            contentContainerStyle={[
              styles.container,
              { minHeight: windowHeight }
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerContainer}>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>
                Join our secure location tracking platform
              </Text>
            </View>
            
            <Card style={styles.formCard}>
              <View style={styles.formContainer}>
                <Input
                  label="First Name"
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Enter your first name *"
                  autoCapitalize="words"
                  floatingLabel={true}
                />
                <Input
                  label="Middle Name"
                  value={middleName}
                  onChangeText={setMiddleName}
                  placeholder="Enter your middle name (Optional)"
                  autoCapitalize="words"
                  floatingLabel={true}
                />
                <Input
                  label="Last Name"
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Enter your last name *"
                  autoCapitalize="words"
                  floatingLabel={true}
                />
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email *"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  floatingLabel={true}
                />
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password *"
                  secureTextEntry={!showPassword}
                  rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
                  onRightIconPress={() => setShowPassword(!showPassword)}
                  floatingLabel={true}
                />
                
                {/* Styled Role Picker */}
                <View style={styles.pickerContainer}>
                  <Text style={styles.staticLabel}>Register as:</Text>
                  <TouchableOpacity 
                    style={styles.picker}
                    onPress={() => setShowDropdown(!showDropdown)}
                  >
                    <Text style={styles.pickerText}>
                      {role === 'member' ? 'Member' : 'Owner'}
                    </Text>
                    <Ionicons 
                      name={showDropdown ? "chevron-up" : "chevron-down"} 
                      size={20} 
                      color={theme.colors.text.secondary} 
                    />
                  </TouchableOpacity>
                  
                  {showDropdown && (
                    <View style={styles.dropdownContainer}>
                      <TouchableOpacity 
                        style={styles.dropdownItem} 
                        onPress={() => { setRole('member'); setShowDropdown(false); }}
                      >
                        <Text style={[styles.dropdownText, role === 'member' && styles.selectedText]}>Member</Text>
                        {role === 'member' && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.dropdownItem, { borderBottomWidth: 0 }]}
                        onPress={() => { setRole('owner'); setShowDropdown(false); }}
                      >
                        <Text style={[styles.dropdownText, role === 'owner' && styles.selectedText]}>Owner</Text>
                        {role === 'owner' && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                
                {/* Conditional Inputs */}
                {role === 'owner' ? (
                  <Input
                    label="Product Key"
                    value={productKey}
                    onChangeText={setProductKey}
                    placeholder="Enter your product key *"
                    autoCapitalize="none"
                    floatingLabel={true}
                  />
                ) : (
                  <Input
                    label="Team Invitation Code"
                    value={teamCode}
                    onChangeText={setTeamCode}
                    placeholder="Enter team invitation code *"
                    autoCapitalize="none"
                    floatingLabel={true}
                  />
                )}
                
                {/* Terms and Conditions Checkbox */}
                <View style={styles.termsContainer}>
                  <TouchableOpacity 
                    style={styles.checkbox}
                    onPress={() => setAcceptedTerms(!acceptedTerms)}
                  >
                    {acceptedTerms && (
                      <Ionicons 
                        name="checkmark" 
                        size={18} 
                        color={theme.colors.primary} 
                      />
                    )}
                  </TouchableOpacity>
                  <View style={styles.termsTextContainer}>
                    <Text style={styles.termsText}>
                      I accept the{' '}
                      <Text 
                        style={styles.termsLink}
                        onPress={() => {
                          // You can add navigation to Terms page or show modal here
                          Alert.alert(
                            'Terms and Conditions',
                            'By accepting these terms, you agree to:\n\n' +
                            '1. Share your location data with your team\n' +
                            '2. Allow notifications for important updates\n' +
                            '3. Follow team safety guidelines\n' +
                            '4. Keep your account information secure\n' +
                            '5. Use the app responsibly\n\n' +
                            'Your privacy and security are important to us.',
                            [{ text: 'OK' }]
                          );
                        }}
                      >
                        Terms and Conditions
                      </Text>
                    </Text>
                  </View>
                </View>
                
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
                {message ? <Text style={styles.successText}>{message}</Text> : null}
                
                <Button
                  variant="primary"
                  label="Register"
                  onPress={handleRegister}
                  size="lg"
                  style={styles.registerButton}
                  disabled={!acceptedTerms}
                />
                
                <View style={styles.loginLinkContainer}>
                  <Text style={styles.loginLinkText}>Already have an account? </Text>
                  <Button 
                    variant="text" 
                    label="Login" 
                    onPress={() => navigation.navigate('Login')}
                    size="sm"
                    textStyle={styles.loginButtonText}
                  />
                </View>
              </View>
            </Card>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 60 : 30, // Extra padding at bottom for keyboard
  },
  headerContainer: {
    marginBottom: 8,
    alignItems: 'flex-start',
    width: '100%',
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: 2,
  },
  subtitle: {
    ...theme.typography.bodyMedium,
    color: theme.colors.text.secondary,
    fontSize: 16,
    marginBottom: 8,
    textAlign: 'left',
  },
  formCard: {
    padding: 24,
    marginBottom: 24,
    marginTop: 'auto', // Push form to bottom when keyboard is closed
  },
  formContainer: {
    width: '100%',
  },
  pickerContainer: {
    marginBottom: 24,
    zIndex: 2, // Ensure dropdown appears above other elements
  },
  staticLabel: {
    fontSize: 12,
    color: theme.colors.text.secondary,
    marginBottom: 4,
    marginLeft: 8,
    fontWeight: '500',
  },
  picker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 50,
    backgroundColor: theme.colors.backgroundAlt,
  },
  pickerText: {
    fontSize: 16,
    color: theme.colors.text.primary,
  },
  dropdownContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: theme.colors.backgroundAlt,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    marginTop: 4,
    zIndex: 1000,
    elevation: 3, // Add some elevation for Android
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: `${theme.colors.border}50`, // Lighter border
    minHeight: 50,
  },
  dropdownText: {
    fontSize: 16,
    color: theme.colors.text.primary,
  },
  selectedText: {
    fontWeight: '600',
    color: theme.colors.primary,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.bodySmall,
    marginBottom: 16,
    textAlign: 'center',
  },
  successText: {
    color: theme.colors.success,
    ...theme.typography.bodySmall,
    marginBottom: 16,
    textAlign: 'center',
  },
  registerButton: {
    marginTop: 8,
    marginBottom: 16,
    opacity: (props) => props.disabled ? 0.6 : 1,
  },
  loginLinkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  loginLinkText: {
    color: '#666666',
    fontSize: 14,
  },
  loginButtonText: {
    fontWeight: '600',
    color: theme.colors.primary,
  },
  termsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: 6,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.backgroundAlt,
  },
  termsTextContainer: {
    flex: 1,
  },
  termsText: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    lineHeight: 20,
  },
  termsLink: {
    color: theme.colors.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
}); 