import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { getAuth, sendEmailVerification, signOut } from 'firebase/auth';

export default function VerifyEmail() {
  const [timeLeft, setTimeLeft] = useState(60);
  const auth = getAuth();

  useEffect(() => {
    if (timeLeft > 0) {
      const timerId = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timerId);
    }
  }, [timeLeft]);

  const resendVerification = async () => {
    if (timeLeft > 0) {
      alert(`Please wait ${timeLeft} seconds before requesting another email`);
      return;
    }

    try {
      await sendEmailVerification(auth.currentUser);
      setTimeLeft(60);
      alert('Verification email sent! Please check your inbox and spam folder.');
    } catch (error) {
      alert('Error sending verification email: ' + error.message);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Failed to sign out');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Email</Text>
      
      <Text style={styles.message}>
        We've sent a verification email to:
        {'\n'}
        <Text style={styles.emailText}>{auth.currentUser?.email}</Text>
      </Text>

      <Text style={styles.instructions}>
        Please check your email and click the verification link to access all features.
      </Text>

      <TouchableOpacity 
        style={[styles.button, timeLeft > 0 && styles.buttonDisabled]} 
        onPress={resendVerification}
      >
        <Text style={styles.buttonText}>
          {timeLeft > 0 
            ? `Resend email in ${timeLeft}s` 
            : 'Resend verification email'
          }
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
  },
  emailText: {
    fontWeight: 'bold',
  },
  instructions: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
  },
  button: {
    backgroundColor: 'black',
    padding: 15,
    borderRadius: 5,
    marginBottom: 10,
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  signOutButton: {
    backgroundColor: '#ff3b30',
    padding: 15,
    borderRadius: 5,
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  }
}); 