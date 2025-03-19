import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getDatabase, ref, get, set, remove } from 'firebase/database';

export const checkForInvitation = async (email) => {
  try {
    const db = getDatabase();
    const invitationsRef = ref(db, 'invitations');
    const snapshot = await get(invitationsRef);

    if (snapshot.exists()) {
      const invitations = snapshot.val();
      const invitation = Object.entries(invitations).find(([_, inv]) => 
        inv.inviteeEmail.toLowerCase() === email.toLowerCase() && 
        inv.status === 'pending'
      );

      if (invitation) {
        return {
          id: invitation[0],
          ...invitation[1]
        };
      }
    }
    return null;
  } catch (error) {
    console.error('Error checking for invitation:', error);
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
        role: 'member'
      });
    }

    // Remove the invitation
    const invitationRef = ref(db, `invitations/${invitation.id}`);
    await remove(invitationRef);

    return true;
  } catch (error) {
    console.error('Error accepting invitation:', error);
    return false;
  }
};

export default function InvitationHandler({ invitation, onAccept, onDecline }) {
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
            onPress={onAccept}
          >
            <Text style={styles.buttonText}>Accept</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.declineButton]} 
            onPress={onDecline}
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
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    marginBottom: 10,
    textAlign: 'center',
  },
  details: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 100,
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
  },
  declineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF5252',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
  },
  declineText: {
    color: '#FF5252',
  },
}); 