import { getDatabase, ref, push, serverTimestamp } from 'firebase/database';

export const logAudit = async (action, details, userId) => {
  const db = getDatabase();
  const logsRef = ref(db, 'auditLogs');
  
  await push(logsRef, {
    action,
    details,
    userId,
    timestamp: serverTimestamp()
  });
};

export const AUDIT_ACTIONS = {
  KEY_GENERATED: 'key_generated',
  KEY_USED: 'key_used',
  USER_REGISTERED: 'user_registered',
  USER_LOGGED_IN: 'user_logged_in',
  LOCATION_UPDATED: 'location_updated',
  TEAM_CREATED: 'team_created',
  MEMBER_ADDED: 'member_added'
}; 