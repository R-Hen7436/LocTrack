import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';

// User roles
export const ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  MEMBER: 'member'
};

// Permission types
export const PERMISSIONS = {
  // Admin permissions
  MANAGE_PRODUCT_KEYS: 'manage_product_keys',
  MANAGE_ALL_USERS: 'manage_all_users',
  VIEW_ANALYTICS: 'view_analytics',
  
  // Owner permissions
  MANAGE_TEAM: 'manage_team',
  INVITE_MEMBERS: 'invite_members',
  REMOVE_MEMBERS: 'remove_members',
  VIEW_TEAM_LOCATIONS: 'view_team_locations',
  SET_GEOFENCE: 'set_geofence',
  
  // Member permissions
  VIEW_OWN_LOCATION: 'view_own_location',
  SHARE_LOCATION: 'share_location',
  
  // General permissions
  EDIT_PROFILE: 'edit_profile',
  VIEW_DASHBOARD: 'view_dashboard'
};

// Permission matrix - which roles have which permissions
const permissionMatrix = {
  [ROLES.ADMIN]: [
    PERMISSIONS.MANAGE_PRODUCT_KEYS,
    PERMISSIONS.MANAGE_ALL_USERS,
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.MANAGE_TEAM,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.REMOVE_MEMBERS,
    PERMISSIONS.VIEW_TEAM_LOCATIONS,
    PERMISSIONS.SET_GEOFENCE,
    PERMISSIONS.VIEW_OWN_LOCATION,
    PERMISSIONS.SHARE_LOCATION,
    PERMISSIONS.EDIT_PROFILE,
    PERMISSIONS.VIEW_DASHBOARD
  ],
  [ROLES.OWNER]: [
    PERMISSIONS.MANAGE_TEAM,
    PERMISSIONS.INVITE_MEMBERS,
    PERMISSIONS.REMOVE_MEMBERS,
    PERMISSIONS.VIEW_TEAM_LOCATIONS,
    PERMISSIONS.SET_GEOFENCE,
    PERMISSIONS.VIEW_OWN_LOCATION,
    PERMISSIONS.SHARE_LOCATION,
    PERMISSIONS.EDIT_PROFILE,
    PERMISSIONS.VIEW_DASHBOARD
  ],
  [ROLES.MEMBER]: [
    PERMISSIONS.VIEW_OWN_LOCATION,
    PERMISSIONS.SHARE_LOCATION,
    PERMISSIONS.EDIT_PROFILE,
    PERMISSIONS.VIEW_DASHBOARD
  ]
};

/**
 * Get current user's profile from Firebase
 * @returns {Promise<Object|null>} User profile or null if not logged in
 */
export const getCurrentUserProfile = async () => {
  const auth = getAuth();
  if (!auth.currentUser) return null;
  
  try {
    const db = getDatabase();
    const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
    const snapshot = await get(userProfileRef);
    
    if (snapshot.exists()) {
      return {
        id: auth.currentUser.uid,
        ...snapshot.val()
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
};

/**
 * Check if current user has a specific permission
 * @param {string} permission - Permission to check
 * @returns {Promise<boolean>} True if user has permission
 */
export const hasPermission = async (permission) => {
  const userProfile = await getCurrentUserProfile();
  if (!userProfile) return false;
  
  if (userProfile.isAdmin || userProfile.role === ROLES.ADMIN) {
    return true;
  }
  
  const rolePermissions = permissionMatrix[userProfile.role] || [];
  return rolePermissions.includes(permission);
};

/**
 * Check if user has a specific role
 * @param {string} role - Role to check
 * @returns {Promise<boolean>} True if user has the role
 */
export const hasRole = async (role) => {
  const userProfile = await getCurrentUserProfile();
  if (!userProfile) return false;
  
  if (userProfile.isAdmin || userProfile.role === ROLES.ADMIN) {
    return true;
  }
  
  return userProfile.role === role;
};

/**
 * Check if a user can perform an action on a resource
 * @param {string} action - Action to perform
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - ID of resource
 * @returns {Promise<boolean>} True if user can perform action
 */
export const canPerformAction = async (action, resourceType, resourceId) => {
  const userProfile = await getCurrentUserProfile();
  if (!userProfile) return false;
  
  if (userProfile.isAdmin || userProfile.role === ROLES.ADMIN) {
    return true;
  }
  
  if (resourceType === 'team') {
    if (userProfile.role === ROLES.OWNER && userProfile.teamCode === resourceId) {
      return true;
    }
    
    if (userProfile.role === ROLES.MEMBER && 
        userProfile.teamCode === resourceId && 
        action === 'view') {
      return true;
    }
  }
  
  if (resourceType === 'user') {
    if (userProfile.id === resourceId) {
      return true;
    }
    
    if (userProfile.role === ROLES.OWNER && action === 'manage') {
      const db = getDatabase();
      const memberRef = ref(db, `users/${resourceId}/profile`);
      const snapshot = await get(memberRef);
      
      if (snapshot.exists()) {
        const memberProfile = snapshot.val();
        return memberProfile.role === ROLES.MEMBER && 
               memberProfile.teamCode === userProfile.teamCode;
      }
    }
  }
  
  return false;
}; 