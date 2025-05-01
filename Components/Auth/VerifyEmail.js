import React, { useEffect, useState, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform,
  SafeAreaView
} from 'react-native';
import { getAuth, sendEmailVerification, signOut } from 'firebase/auth';
import theme from '../../constants/theme';
import { Button, Card } from '../UI';

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
      // Clear the verification check interval first
      if (verificationCheckInterval.current) {
        clearInterval(verificationCheckInterval.current);
      }
      await signOut(auth);
      // Navigate to Login screen after successful sign out
      navigation.navigate('Login');
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
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <View style={styles.container}>
          <View style={styles.headerContainer}>
            <Text style={styles.title}>Verify email</Text>
            <Text style={styles.subtitle}>Complete your account setup</Text>
          </View>
          
          <Card style={styles.formCard}>
            <View style={styles.formContainer}>
              <Text style={styles.message}>
                We've sent a verification email to:
              </Text>
              <Text style={styles.emailText}>{currentEmail}</Text>

              <Text style={styles.instructions}>
                Please check your email and click the verification link to access all features.
                Your email verification status is being checked automatically.
              </Text>

              <Button
                variant="primary"
                label={timeLeft > 0 ? `Resend email in ${timeLeft}s` : 'Resend verification email'}
                onPress={resendVerification}
                isLoading={sending}
                disabled={timeLeft > 0 || sending}
                size="lg"
                style={styles.resendButton}
              />

              <Button
                variant="secondary"
                label="Check verification status"
                onPress={checkVerification}
                isLoading={refreshing}
                disabled={refreshing}
                size="lg"
                style={styles.checkButton}
              />

              <Button
                variant="outline"
                label="Sign Out"
                onPress={handleSignOut}
                size="lg"
                style={styles.signOutButton}
                textStyle={styles.signOutButtonText}
              />
            </View>
          </Card>
        </View>
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
    alignItems: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 10,
    color: theme.colors.text.primary,
  },
  emailText: {
    fontWeight: 'bold',
    fontSize: 18,
    color: theme.colors.primary,
    marginBottom: 20,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 30,
    color: theme.colors.text.secondary,
    lineHeight: 22,
  },
  resendButton: {
    width: '100%',
    marginBottom: 16,
  },
  checkButton: {
    width: '100%',
    marginBottom: 16,
  },
  signOutButton: {
    width: '100%',
    marginTop: 8,
  },
  signOutButtonText: {
    color: theme.colors.error,
  }
}); 