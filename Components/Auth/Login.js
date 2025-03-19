import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase, ref, get, set } from 'firebase/database';
import InvitationHandler, { checkForInvitation, acceptInvitation } from './InvitationHandler';

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [isCheckingInvitation, setIsCheckingInvitation] = useState(false);

  const handleLogin = async () => {
    try {
      setIsCheckingInvitation(true);
      const auth = getAuth();
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      const db = getDatabase();
      const userProfileRef = ref(db, `users/${userCredential.user.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const userData = snapshot.val();
        if (!userCredential.user.emailVerified && !userData.isAdmin) {
          await auth.signOut();
          setError('Please verify your email before logging in');
          setEmail('');
          setPassword('');
          return;
        }
        
        if (userData.isAdmin) {
          await set(ref(db, `adminSessions/${userCredential.user.uid}`), {
            lastLogin: new Date().toISOString()
          });
        }

        // Check for pending invitations
        const pendingInvitation = await checkForInvitation(email);
        if (pendingInvitation) {
          setInvitation(pendingInvitation);
        }
      }
    } catch (error) {
      let errorMessage = "An error occurred. Please try again.";

      switch (error.code) {
        case 'auth/invalid-email':
          errorMessage = 'Invalid email address format';
          break;
        case 'auth/user-not-found':
          errorMessage = 'Email not registered';
          break;
        case 'auth/wrong-password':
          errorMessage = 'Incorrect password';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'Too many attempts. Please try again later';
          break;
        case 'auth/network-request-failed':
          errorMessage = 'Network error. Please check your connection';
          break;
      }
      setError(errorMessage);
      setEmail('');
      setPassword('');

      setTimeout(() => {
        setError('');
      }, 3000);
    } finally {
      setIsCheckingInvitation(false);
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Login</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
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
      <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>  
        <Text style={styles.link2}>Forgot Password?</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={[styles.button, isCheckingInvitation && styles.buttonDisabled]} 
        onPress={handleLogin}
        disabled={isCheckingInvitation}
      >
        {isCheckingInvitation ? (
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
}); 