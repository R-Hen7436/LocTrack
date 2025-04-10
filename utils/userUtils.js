import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set, get } from 'firebase/database';
import { generateSecurePassword } from './passwordUtils';
import { logAudit } from './auditUtils';
import { AUDIT_ACTIONS } from '../constants/auditActions';

/**
 * Create a new user with a temporary password
 * @param {string} email - User's email address
 * @param {string} teamCode - Team code to associate with user
 * @param {string} ownerName - Name of the team owner
 * @param {string} ownerId - Firebase UID of the team owner
 * @param {string} [invitationId] - Optional unique ID for the invitation
 * @returns {Promise<{success: boolean, password?: string, error?: string}>} - Result object
 */
export const createUserWithTempPassword = async (email, teamCode, ownerName, ownerId, invitationId = null) => {
  try {
    // Check if user already exists in Firebase Auth
    const auth = getAuth();
    const db = getDatabase();
    
    // Generate a secure temporary password
    const tempPassword = generateSecurePassword();
    
    // Use the provided invitation ID or generate one from the email
    // Replace @ and . with _ to avoid Firebase path issues
    const safeEmail = email.replace(/[@.]/g, '_');
    const inviteId = invitationId || safeEmail;
    
    // First create invitation record
    const invitationRef = ref(db, `invitations/${inviteId}`);
    const invitationData = {
      teamCode: teamCode,
      ownerId: ownerId,
      ownerName: ownerName,
      status: 'pending',
      email: email,
      tempPassword: tempPassword, // Store encrypted in production
      createdAt: new Date().toISOString(),
    };
    
    await set(invitationRef, invitationData);
    
    // Try to create user in Firebase Auth (will be used when user first logs in)
    let userCreated = false;
    let userId = null;
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, tempPassword);
      const user = userCredential.user;
      userId = user.uid;
      userCreated = true;
      
      // Create initial user profile with team association
      const userProfileRef = ref(db, `users/${user.uid}/profile`);
      await set(userProfileRef, {
        email: email,
        firstName: '',
        lastName: '',
        middleName: '',
        teamCode: teamCode,
        role: 'member',
        ownerID: ownerId,
        requiresPasswordChange: true,
        createdAt: new Date().toISOString(),
      });
      
      // Add user to team members
      const teamMemberRef = ref(db, `teams/${teamCode}/members/${user.uid}`);
      await set(teamMemberRef, {
        email: email,
        role: 'member',
        joinedAt: new Date().toISOString(),
      });
      
      // Log the audit event
      await logAudit(
        AUDIT_ACTIONS.MEMBER_CREATED, 
        { memberEmail: email },
        ownerId
      );
    } catch (authError) {
      console.log('User may already exist, invitation created only:', authError);
      userCreated = false;
    }
    
    return { 
      success: true, 
      password: tempPassword,
      userId: userId,
      userCreated: userCreated,
      message: userCreated 
        ? 'User created successfully' 
        : 'Invitation record created for existing user'
    };
  } catch (error) {
    console.error('Error creating user with temp password:', error);
    return { 
      success: false, 
      error: error.message || 'Failed to create user'
    };
  }
}; 