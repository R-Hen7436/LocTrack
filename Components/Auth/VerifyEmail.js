import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { getAuth, sendEmailVerification, signOut } from 'firebase/auth';

export default function VerifyEmail({ route, navigation }) {
  const { email } = route.params || {};
  const [timeLeft, setTimeLeft] = useState(60);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentEmail, setCurrentEmail] = useState(email || '');
  const auth = getAuth();
  const verificationCheckInterval = useRef(null);

  // Set up to get the current user's email
  useEffect(() => {
    if (auth.currentUser) {
      setCurrentEmail(auth.currentUser.email || email || '');
    }
  }, [auth.currentUser, email]);

  // Countdown timer for resend button
  useEffect(() => {
    if (timeLeft > 0) {
      const timerId = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timerId);
    }
  }, [timeLeft]);

  // Set up active listener for email verification status
  useEffect(() => {
    // Start checking verification status
    verificationCheckInterval.current = setInterval(async () => {
      if (auth.currentUser) {
        try {
          await auth.currentUser.reload();
          if (auth.currentUser.emailVerified) {
            // Email is verified, clear interval and navigate to Dashboard
            clearInterval(verificationCheckInterval.current);
            alert('Email verified! Redirecting you to the Dashboard.');
            navigation.replace('Dashboard');
          }
        } catch (error) {
          console.error('Error checking verification status:', error);
        }
      }
    }, 5000); // Check every 5 seconds

    // Clean up interval on component unmount
    return () => {
      if (verificationCheckInterval.current) {
        clearInterval(verificationCheckInterval.current);
      }
    };
  }, [navigation]);

  const resendVerification = async () => {
    if (timeLeft > 0) {
      alert(`Please wait ${timeLeft} seconds before requesting another email`);
      return;
    }

    setSending(true);
    try {
      if (auth.currentUser) {
        await sendEmailVerification(auth.currentUser);
        setTimeLeft(60);
        alert('Verification email sent! Please check your inbox and spam folder.');
      } else {
        alert('You are not currently signed in. Please sign in again.');
        goToLogin();
      }
    } catch (error) {
      console.error('Error sending verification email:', error);
      alert('Error sending verification email: ' + error.message);
    } finally {
      setSending(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      // Navigate to Login screen after successful sign out
      navigation.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      });
    } catch (error) {
      console.error('Error signing out:', error);
      alert('Failed to sign out: ' + error.message);
      // Still try to navigate even if sign out fails
      navigation.navigate('Login');
    }
  };

  // Add check verification function
  const checkVerification = async () => {
    setRefreshing(true);
    try {
      if (auth.currentUser) {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          alert('Email verified! Redirecting you to the Dashboard.');
          navigation.replace('Dashboard');
        } else {
          alert('Your email is not yet verified. Please check your inbox and click the verification link.');
        }
      } else {
        alert('You are not currently signed in. Please sign in again.');
        goToLogin();
      }
    } catch (error) {
      console.error('Error checking email verification:', error);
      alert('Error checking verification status. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const goToLogin = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'Login' }],
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Email</Text>
      
      <Text style={styles.message}>
        We've sent a verification email to:
        {'\n'}
        <Text style={styles.emailText}>{currentEmail}</Text>
      </Text>

      <Text style={styles.instructions}>
        Please check your email and click the verification link to access all features.
        {'\n\n'}
        Your email verification status is being checked automatically.
      </Text>

      <TouchableOpacity 
        style={[styles.button, timeLeft > 0 && styles.buttonDisabled]} 
        onPress={resendVerification}
        disabled={timeLeft > 0 || sending}
      >
        {sending ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.buttonText}>
            {timeLeft > 0 
              ? `Resend email in ${timeLeft}s` 
              : 'Resend verification email'
            }
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity 
        style={styles.refreshButton} 
        onPress={checkVerification}
        disabled={refreshing}
      >
        {refreshing ? (
          <ActivityIndicator color="white" size="small" />
        ) : (
          <Text style={styles.buttonText}>Check verification status</Text>
        )}
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
    color: '#333',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 24,
  },
  emailText: {
    fontWeight: 'bold',
    color: '#007AFF',
  },
  instructions: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: '#666',
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonDisabled: {
    backgroundColor: '#97C2F5',
  },
  signOutButton: {
    backgroundColor: '#FF3B30',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  refreshButton: {
    backgroundColor: '#4CD964',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
}); 