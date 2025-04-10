import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, Alert } from 'react-native';
import { getAuth, signInWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase, ref, get, set } from 'firebase/database';
import InvitationHandler, { checkForInvitation, acceptInvitation, checkPendingInvitations } from './InvitationHandler';
import { logAudit } from '../../utils/auditUtils';
import { AUDIT_ACTIONS } from '../../constants/auditActions';

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
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        
        // Check if user has admin privileges
        if (!userCredential.user.emailVerified && !userData.isAdmin) {
          // Redirect to email verification
          navigation.navigate('VerifyEmail', { email });
          return;
        }
        
        // Check for pending invitations
        const invitation = await checkPendingInvitations(email);
        if (invitation) {
          // Handle invitation UI flow
          navigation.navigate('InvitationScreen', { invitation });
          return;
        }
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
      let errorMessage = 'Login failed. Please check your email and password.';
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
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      
      <View style={styles.passwordContainer}>
        <TextInput
          style={styles.passwordInput}
          placeholder="Password"
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
      
      {error ? <Text style={styles.error}>{error}</Text> : null}
      
      <View style={styles.linkContainer}>
        <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>  
          <Text style={styles.link2}>Forgot Password?</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleResendVerification} disabled={isResending}>
          <Text style={[styles.link2, isResending && styles.linkDisabled]}>
            {isResending ? 'Sending...' : 'Resend Verification Email'}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity 
        style={[styles.button, loading && styles.buttonDisabled]} 
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Login</Text>
        )}
      </TouchableOpacity>
    
      <TouchableOpacity onPress={() => navigation.navigate('Register')}>
        <Text style={styles.link}>Don't have an account? Register</Text>
      </TouchableOpacity>

      <Modal
        visible={invitation !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setInvitation(null)}
      >
        <View style={styles.modalContainer}>
          {invitation && (
            <InvitationHandler
              invitation={invitation}
              onAccept={handleAcceptInvitation}
              onDecline={handleDeclineInvitation}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
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
    backgroundColor: 'black',
    padding: 15,
    borderRadius: 5,
    marginBottom: 10,
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  link: {
    color: 'blue',
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    color: 'red',
    marginBottom: 10,
    textAlign: 'center',
  },
  link2: {
    color: 'blue',
    textAlign: 'right',
    marginBotttom: 10,
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
    padding: 12,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  linkDisabled: {
    opacity: 0.5,
  },
}); 