import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { getDatabase, ref, get, set, remove } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { logAudit, AUDIT_ACTIONS } from '../../utils/auditLogger';

export const checkPendingInvitations = async (email) => {
  try {
    const db = getDatabase();
    const invitationsRef = ref(db, 'invitations');
    const snapshot = await get(invitationsRef);
    
    if (snapshot.exists()) {
      const invitations = snapshot.val();
      // Check if there's an invitation for this email
      if (invitations[encodeURIComponent(email)]) {
        return {
          ...invitations[encodeURIComponent(email)],
          id: encodeURIComponent(email)
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error checking invitations:', error);
    return null;
  }
};

export const acceptInvitation = async (invitation, userId) => {
  try {
    const db = getDatabase();
    
    // Add user to team members
    const teamMemberRef = ref(db, `teams/${invitation.teamCode}/members/${userId}`);
    await set(teamMemberRef, {
      role: 'member',
      joinedAt: new Date().toISOString()
    });

    // Update user's profile with team code
    const userProfileRef = ref(db, `users/${userId}/profile`);
    const userSnapshot = await get(userProfileRef);
    if (userSnapshot.exists()) {
      const userData = userSnapshot.val();
      await set(userProfileRef, {
        ...userData,
        teamCode: invitation.teamCode,
        role: 'member',
        isOwner: false
      });
    }

    // Remove the invitation
    const invitationRef = ref(db, `invitations/${invitation.id}`);
    await remove(invitationRef);
    
    // Log the audit event
    await logAudit(
      AUDIT_ACTIONS.MEMBER_JOINED,
      {
        teamCode: invitation.teamCode,
        ownerEmail: invitation.ownerEmail
      },
      userId,
      invitation.ownerId
    );

    return true;
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return false;
  }
};

export const declineInvitation = async (invitation) => {
  try {
    const db = getDatabase();
    const invitationRef = ref(db, `invitations/${invitation.id}`);
    await remove(invitationRef);
    return true;
  } catch (error) {
    console.error('Error declining invitation:', error);
    return false;
  }
};

export default function InvitationHandler({ invitation, onAccept, onDecline }) {
  const handleAccept = async () => {
    const auth = getAuth();
    if (!auth.currentUser) {
      Alert.alert('Error', 'You must be logged in to accept an invitation');
      return;
    }

    const result = await acceptInvitation(invitation, auth.currentUser.uid);
    if (result) {
      onAccept && onAccept();
    } else {
      Alert.alert('Error', 'Failed to accept invitation. Please try again.');
    }
  };

  const handleDecline = async () => {
    const result = await declineInvitation(invitation);
    if (result) {
      onDecline && onDecline();
    } else {
      Alert.alert('Error', 'Failed to decline invitation. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Team Invitation</Text>
        <Text style={styles.message}>
          You've been invited to join {invitation.ownerName}'s team!
        </Text>
        <Text style={styles.details}>
          Team Owner: {invitation.ownerEmail}
        </Text>
        
        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.button, styles.acceptButton]} 
            onPress={handleAccept}
          >
            <Text style={styles.buttonText}>Accept</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.declineButton]} 
            onPress={handleDecline}
          >
            <Text style={[styles.buttonText, styles.declineText]}>Decline</Text>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    marginBottom: 15,
    textAlign: 'center',
  },
  details: {
    fontSize: 14,
    color: '#666',
    marginBottom: 25,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  acceptButton: {
    backgroundColor: '#007AFF',
  },
  declineButton: {
    backgroundColor: '#F2F2F2',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  declineText: {
    color: '#FF3B30',
  },
}); 