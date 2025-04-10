import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { acceptInvitation, declineInvitation } from './InvitationHandler';
import { getAuth } from 'firebase/auth';
import { CommonActions } from '@react-navigation/native';

export default function InvitationScreen({ route, navigation }) {
  const { invitation } = route.params;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleAccept = async () => {
    setLoading(true);
    setError('');
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        setError('You must be logged in to accept an invitation');
        setLoading(false);
        return;
      }
      
      const result = await acceptInvitation(invitation, auth.currentUser.uid);
      if (result) {
        // Reset navigation and go to main screen
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'LocTrack' }],
          })
        );
      } else {
        setError('Failed to accept invitation. Please try again.');
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDecline = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await declineInvitation(invitation);
      if (result) {
        // Reset navigation and go to main screen
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'LocTrack' }],
          })
        );
      } else {
        setError('Failed to decline invitation. Please try again.');
      }
    } catch (error) {
      console.error('Error declining invitation:', error);
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Ionicons name="people" size={60} color="#007AFF" style={styles.icon} />
          <Text style={styles.title}>Team Invitation</Text>
        </View>
        
        <Text style={styles.message}>
          You've been invited to join a team!
        </Text>
        
        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Team Owner:</Text>
            <Text style={styles.detailValue}>{invitation.ownerName}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Owner Email:</Text>
            <Text style={styles.detailValue}>{invitation.ownerEmail}</Text>
          </View>
          
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Invitation Date:</Text>
            <Text style={styles.detailValue}>
              {new Date(invitation.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
        
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.button, styles.declineButton, loading && styles.buttonDisabled]} 
            onPress={handleDecline}
            disabled={loading}
          >
            <Text style={styles.declineButtonText}>Decline</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.acceptButton, loading && styles.buttonDisabled]} 
            onPress={handleAccept}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.acceptButtonText}>Accept</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F2F2F7',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    color: '#666666',
  },
  detailsContainer: {
    backgroundColor: '#F9F9F9',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  detailLabel: {
    fontWeight: '600',
    width: 100,
    color: '#666666',
  },
  detailValue: {
    flex: 1,
    color: '#333333',
  },
  errorText: {
    color: '#FF3B30',
    textAlign: 'center',
    marginBottom: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButton: {
    backgroundColor: '#007AFF',
  },
  declineButton: {
    backgroundColor: '#F2F2F2',
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  declineButtonText: {
    color: '#FF3B30',
    fontWeight: '600',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}); 