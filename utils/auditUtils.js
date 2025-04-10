import { getDatabase, ref, push, get, query, orderByChild, limitToLast } from 'firebase/database';
import { getAuth } from 'firebase/auth';

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
    const snapshot = await get(auditRef);
    
    if (!snapshot.exists()) {
      return [];
    }
    
    const logs = [];
    snapshot.forEach((childSnapshot) => {
      const log = childSnapshot.val();
      if (log.actorId === userId || log.targetId === userId) {
        logs.push({
          id: childSnapshot.key,
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

/**
 * Get all audit logs with pagination
 * @param {number} limit - Maximum number of logs to retrieve
 * @param {number} page - Page number (1-indexed)
 * @returns {Promise<Object>} Object with logs array and pagination info
 */
export const getAuditLogs = async (limit = 50, page = 1) => {
  try {
    const db = getDatabase();
    const auditRef = ref(db, 'auditLogs');
    
    const snapshot = await get(auditRef);
    if (!snapshot.exists()) {
      return { logs: [], totalCount: 0, currentPage: page };
    }
    
    const allLogs = [];
    snapshot.forEach((childSnapshot) => {
      allLogs.push({
        id: childSnapshot.key,
        ...childSnapshot.val()
      });
    });
    
    // Sort by timestamp (newest first)
    allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Calculate pagination
    const totalCount = allLogs.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLogs = allLogs.slice(startIndex, endIndex);
    
    return {
      logs: paginatedLogs,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: endIndex < totalCount,
      hasPrevPage: page > 1
    };
  } catch (error) {
    console.error('Error getting audit logs:', error);
    return { logs: [], totalCount: 0, currentPage: page };
  }
};

/**
 * Get recent activity for a team
 * @param {string} teamCode - Team code to get activity for
 * @param {number} limit - Maximum number of logs to retrieve
 * @returns {Promise<Array>} Array of activity log entries
 */
export const getTeamActivity = async (teamCode, limit = 20) => {
  try {
    const db = getDatabase();
    const auditRef = ref(db, 'auditLogs');
    
    // Get all logs
    const snapshot = await get(auditRef);
    if (!snapshot.exists()) {
      return [];
    }
    
    // Filter for team-related activities
    const teamLogs = [];
    snapshot.forEach((childSnapshot) => {
      const log = childSnapshot.val();
      if (log.details && log.details.teamCode === teamCode) {
        teamLogs.push({
          id: childSnapshot.key,
          ...log
        });
      }
    });
    
    // Sort by timestamp (newest first)
    teamLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Apply limit
    return teamLogs.slice(0, limit);
  } catch (error) {
    console.error('Error getting team activity:', error);
    return [];
  }
}; 