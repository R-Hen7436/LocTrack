import { getDatabase, ref, push, serverTimestamp } from 'firebase/database';
import { getAuth } from 'firebase/auth';

// Action types for audit logging
export const AUDIT_ACTIONS = {
  // Auth actions
  USER_REGISTERED: 'user_registered',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  PASSWORD_RESET: 'password_reset',
  EMAIL_VERIFIED: 'email_verified',
  
  // Admin actions
  USER_ROLE_CHANGED: 'user_role_changed',
  USER_STATUS_CHANGED: 'user_status_changed',
  USER_DELETED: 'user_deleted',
  PRODUCT_KEY_GENERATED: 'product_key_generated',
  PRODUCT_KEY_USED: 'product_key_used',
  
  // Team actions
  TEAM_CREATED: 'team_created',
  MEMBER_INVITED: 'member_invited',
  MEMBER_JOINED: 'member_joined',
  MEMBER_REMOVED: 'member_removed',
  TEAM_SETTINGS_CHANGED: 'team_settings_changed',
  
  // Location actions
  LOCATION_SHARED: 'location_shared',
  LOCATION_STOPPED: 'location_stopped',
  GEOFENCE_CREATED: 'geofence_created',
  GEOFENCE_ENTERED: 'geofence_entered',
  GEOFENCE_EXITED: 'geofence_exited',
  
  // Profile actions
  PROFILE_UPDATED: 'profile_updated'
};

/**
 * Log an audit event to Firebase
 * @param {string} actionType - Type of action (use AUDIT_ACTIONS constants)
 * @param {Object} details - Additional details about the action
 * @param {string} [userId] - User ID who performed the action (defaults to current user)
 * @param {string} [targetId] - ID of the target resource (optional)
 * @returns {Promise<string>} ID of the audit log entry
 */
export const logAudit = async (actionType, details = {}, userId = null, targetId = null) => {
  try {
    const db = getDatabase();
    const auth = getAuth();
    
    // Default to current user if userId not provided
    const actorId = userId || (auth.currentUser ? auth.currentUser.uid : 'system');
    
    const auditRef = ref(db, 'auditLogs');
    const newAuditRef = push(auditRef);
    
    // Create the audit entry
    const auditEntry = {
      actionType,
      actorId,
      timestamp: new Date().toISOString(),
      details: details || {},
    };
    
    // Add target if provided
    if (targetId) {
      auditEntry.targetId = targetId;
    }
    
    // Save to Firebase
    await push(auditRef, auditEntry);
    
    return newAuditRef.key;
  } catch (error) {
    console.error('Error logging audit event:', error);
    // Don't throw, we don't want to break functionality if audit logging fails
    return null;
  }
};

/**
 * Get audit logs for a specific user
 * @param {string} userId - User ID to get logs for
 * @param {number} limit - Maximum number of logs to retrieve
 * @returns {Promise<Array>} Array of audit log entries
 */
export const getUserAuditLogs = async (userId, limit = 100) => {
  try {
    const db = getDatabase();
    const auditRef = ref(db, 'auditLogs');
    
    // Get logs where user is either the actor or target
    const query = await get(auditRef);
    
    if (!query.exists()) {
      return [];
    }
    
    const logs = [];
    query.forEach((snapshot) => {
      const log = snapshot.val();
      if (log.actorId === userId || log.targetId === userId) {
        logs.push({
          id: snapshot.key,
          ...log
        });
      }
    });
    
    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Apply limit
    return logs.slice(0, limit);
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return [];
  }
}; 