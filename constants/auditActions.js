export const AUDIT_ACTIONS = {
  // Auth actions
  USER_REGISTERED: 'user_registered',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_CHANGED: 'password_changed',
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