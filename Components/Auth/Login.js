import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import { getAuth, signInWithEmailAndPassword, sendEmailVerification, updateProfile } from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';
import InvitationHandler, { checkForInvitation, acceptInvitation, checkPendingInvitations } from './InvitationHandler';
import { logAudit } from '../../utils/auditUtils';
import { AUDIT_ACTIONS } from '../../constants/auditActions';
import { formatUserDisplayName } from '../firebaseConfig';
import theme from '../../constants/theme';
import { Button, Card, Input } from '../UI';

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [isCheckingInvitation, setIsCheckingInvitation] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    // Validate inputs
    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const auth = getAuth();
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Log the login event
      await logAudit(AUDIT_ACTIONS.USER_LOGIN, { email });
      
      // Get user profile data
      const db = getDatabase();
      const userProfileRef = ref(db, `users/${userCredential.user.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      console.log("User logged in:", userCredential.user.uid, userCredential.user.email);
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        console.log('User profile data from database:', userData);
        
        // Check if names exist in profile but not in Auth display name
        if ((userData.firstName || userData.lastName) && 
            (!userCredential.user.displayName || userCredential.user.displayName === 'User')) {
          
          console.log('Updating Auth display name from profile data');
          
          // Format display name from profile data
          const displayName = formatUserDisplayName(
            userData.firstName || '', 
            userData.middleName || '', 
            userData.lastName || ''
          );
          
          // Update Auth display name
          await updateProfile(userCredential.user, {
            displayName: displayName
          });
          
          console.log('Updated Auth display name to:', displayName);
        }
        
        // Check if password change is required (for users with temporary passwords)
        if (userData.requiresPasswordChange === true) {
          console.log('User needs to change temporary password');
          navigation.navigate('ChangePassword', { email });
          setLoading(false);
          return;
        }
        
        // Check if user has admin privileges
        if (!userCredential.user.emailVerified && !userData.isAdmin) {
          // Redirect to email verification
          navigation.navigate('VerifyEmail', { email });
          setLoading(false);
          return;
        }
        
        // Check for pending invitations
        const invitation = await checkPendingInvitations(email);
        if (invitation) {
          // Handle invitation UI flow
          navigation.navigate('InvitationScreen', { invitation });
          setLoading(false);
          return;
        }
      } else {
        // No profile found, create one from auth data
        console.log('No user profile found, creating from auth data');
        
        // Extract name parts from display name
        const displayNameParts = userCredential.user.displayName ? 
          userCredential.user.displayName.split(' ') : [];
          
        const firstName = displayNameParts.length > 0 ? displayNameParts[0] : '';
        const lastName = displayNameParts.length > 1 ? 
          displayNameParts.slice(1).join(' ') : '';
        
        const defaultProfile = {
          firstName: firstName,
          lastName: lastName,
          middleName: '',
          email: userCredential.user.email,
          photoURL: userCredential.user.photoURL || '',
          role: 'member',
          isOwner: false,
          createdAt: new Date().toISOString(),
          lastLogin: new Date().toISOString()
        };
        
        console.log('Creating default profile:', defaultProfile);
        await set(userProfileRef, defaultProfile);
      }
      
      // Update profile last login
      if (snapshot.exists()) {
        const userData = snapshot.val();
        await set(userProfileRef, {
          ...userData,
          lastLogin: new Date().toISOString()
        });
      }
      
      setEmail('');
      setPassword('');
      setLoading(false);
      
    } catch (error) {
      let errorMessage = 'Login failed. Please check your credentials.';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        errorMessage = 'Invalid email or password.';
      } else if (error.code === 'auth/too-many-requests') {
        errorMessage = 'Too many unsuccessful login attempts. Please try again later.';
      }
      
      console.error('Login error:', error.code, error.message);
      setError(errorMessage);
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;

      const success = await acceptInvitation(invitation, auth.currentUser.uid);
      if (success) {
        setInvitation(null);
      } else {
        Alert.alert('Error', 'Failed to accept invitation. Please try again.');
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      Alert.alert('Error', 'Failed to accept invitation. Please try again.');
    }
  };

  const handleDeclineInvitation = () => {
    setInvitation(null);
  };

  const handleResendVerification = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address first');
      return;
    }

    setIsResending(true);
    try {
      const auth = getAuth();
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(userCredential.user);
      Alert.alert('Success', 'Verification email sent! Please check your inbox and spam folder.');
      await auth.signOut(); // Sign out after sending verification
    } catch (error) {
      console.error('Error resending verification:', error);
      let errorMessage = 'Failed to send verification email. Please try again.';
      
      if (error.code === 'auth/invalid-email') {
        errorMessage = 'Please enter a valid email address';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.container}>
            <View style={styles.headerContainer}>
              <Text style={styles.title}>Login</Text>
              <Text style={styles.subtitle}>Sign in to continue</Text>
            </View>
            
            <Card style={styles.formCard}>
              <View style={styles.formContainer}>
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  keyboardType="email-address"
                  errorText={error && email.length === 0 ? 'Email is required' : ''}
                  floatingLabel={true}
                />
                
                <Input
                  label="Password"
                  rightIcon={showPassword ? "eye-off-outline" : "eye-outline"}
                  onRightIconPress={() => setShowPassword(!showPassword)}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter your password"
                  secureTextEntry={!showPassword}
                  errorText={error && password.length === 0 ? 'Password is required' : ''}
                  floatingLabel={true}
                />
                
                {error && !error.includes('required') ? (
                  <Text style={styles.errorText}>{error}</Text>
                ) : null}
                
                <View style={styles.forgotPasswordContainer}>
                  <Button 
                    variant="text" 
                    label="Forgot Password?" 
                    onPress={() => navigation.navigate('ForgotPassword')}
                    size="sm"
                  />
                </View>
                
                <Button
                  variant="primary"
                  label="Sign In"
                  onPress={handleLogin}
                  isLoading={loading}
                  disabled={loading}
                  size="lg"
                  style={styles.loginButton}
                />
                
                <View style={styles.registerContainer}>
                  <Text style={styles.registerText}>Don't have an account? </Text>
                  <Button 
                    variant="text" 
                    label="Sign-up" 
                    onPress={() => navigation.navigate('Register')}
                    size="sm"
                    style={styles.registerButton}
                    textStyle={styles.registerButtonText}
                  />
                </View>
              </View>
            </Card>
          </View>
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
    flex: 1,
    padding: 24,
    justifyContent: 'center',
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
  },
  formCard: {
    padding: 24,
    marginBottom: 24,
  },
  formContainer: {
    width: '100%',
  },
  forgotPasswordContainer: {
    alignSelf: 'flex-end',
    marginBottom: 16,
    marginTop: -8,
  },
  loginButton: {
    marginTop: 8,
    marginBottom: 16,
  },
  errorText: {
    color: theme.colors.error,
    ...theme.typography.bodySmall,
    marginBottom: 16,
    textAlign: 'center',
  },
  registerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  registerText: {
    color: '#333333',
    fontSize: 14,
    fontWeight: '400',
  },
  registerButton: {
    marginLeft: -8,
  },
  registerButtonText: {
    fontWeight: '600',
    color: theme.colors.primary,
  }
}); 