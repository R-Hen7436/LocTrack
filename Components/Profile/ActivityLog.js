import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getUserAuditLogs } from '../../utils/auditUtils';
import { getAuth } from 'firebase/auth';
import { AUDIT_ACTIONS } from '../../constants/auditActions';

// Map audit action types to human-readable descriptions
const getActionDescription = (action, details) => {
  switch (action) {
    case AUDIT_ACTIONS.USER_REGISTERED:
      return 'Account created';
    case AUDIT_ACTIONS.USER_LOGIN:
      return 'Logged in';
    case AUDIT_ACTIONS.USER_LOGOUT:
      return 'Logged out';
    case AUDIT_ACTIONS.PASSWORD_RESET:
      return 'Reset password';
    case AUDIT_ACTIONS.EMAIL_VERIFIED:
      return 'Email verified';
    case AUDIT_ACTIONS.PROFILE_UPDATED:
      return 'Updated profile';
    case AUDIT_ACTIONS.TEAM_CREATED:
      return 'Created a team';
    case AUDIT_ACTIONS.MEMBER_INVITED:
      return `Invited ${details?.inviteeEmail || 'a user'} to team`;
    case AUDIT_ACTIONS.MEMBER_JOINED:
      return 'Joined a team';
    case AUDIT_ACTIONS.MEMBER_REMOVED:
      return `Removed ${details?.memberName || 'a member'} from team`;
    case AUDIT_ACTIONS.TEAM_SETTINGS_CHANGED:
      return details?.action === 'ownership_transferred' 
        ? 'Transferred team ownership' 
        : 'Changed team settings';
    case AUDIT_ACTIONS.LOCATION_SHARED:
      return 'Started sharing location';
    case AUDIT_ACTIONS.LOCATION_STOPPED:
      return 'Stopped sharing location';
    case AUDIT_ACTIONS.GEOFENCE_CREATED:
      return 'Created a geofence';
    case AUDIT_ACTIONS.GEOFENCE_ENTERED:
      return 'Entered a geofence area';
    case AUDIT_ACTIONS.GEOFENCE_EXITED:
      return 'Exited a geofence area';
    default:
      return action.replace(/_/g, ' ').toLowerCase();
  }
};

// Map action types to icons
const getActionIcon = (action) => {
  switch (action) {
    case AUDIT_ACTIONS.USER_REGISTERED:
      return { name: 'person-add', color: '#007AFF' };
    case AUDIT_ACTIONS.USER_LOGIN:
      return { name: 'log-in', color: '#4CD964' };
    case AUDIT_ACTIONS.USER_LOGOUT:
      return { name: 'log-out', color: '#FF9500' };
    case AUDIT_ACTIONS.PASSWORD_RESET:
      return { name: 'key', color: '#FF3B30' };
    case AUDIT_ACTIONS.EMAIL_VERIFIED:
      return { name: 'checkmark-circle', color: '#4CD964' };
    case AUDIT_ACTIONS.PROFILE_UPDATED:
      return { name: 'person', color: '#007AFF' };
    case AUDIT_ACTIONS.TEAM_CREATED:
      return { name: 'people', color: '#007AFF' };
    case AUDIT_ACTIONS.MEMBER_INVITED:
      return { name: 'mail', color: '#5856D6' };
    case AUDIT_ACTIONS.MEMBER_JOINED:
      return { name: 'enter', color: '#4CD964' };
    case AUDIT_ACTIONS.MEMBER_REMOVED:
      return { name: 'person-remove', color: '#FF3B30' };
    case AUDIT_ACTIONS.TEAM_SETTINGS_CHANGED:
      return { name: 'settings', color: '#5856D6' };
    case AUDIT_ACTIONS.LOCATION_SHARED:
      return { name: 'locate', color: '#4CD964' };
    case AUDIT_ACTIONS.LOCATION_STOPPED:
      return { name: 'location-slash', color: '#FF9500' };
    case AUDIT_ACTIONS.GEOFENCE_CREATED:
      return { name: 'map', color: '#007AFF' };
    case AUDIT_ACTIONS.GEOFENCE_ENTERED:
      return { name: 'enter', color: '#4CD964' };
    case AUDIT_ACTIONS.GEOFENCE_EXITED:
      return { name: 'exit', color: '#FF9500' };
    default:
      return { name: 'ellipsis-horizontal', color: '#8E8E93' };
  }
};

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  
  useEffect(() => {
    loadLogs();
  }, []);
  
  const loadLogs = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const userLogs = await getUserAuditLogs(auth.currentUser.uid, 20);
      setLogs(userLogs);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  };
  
  const renderLogItem = (item) => {
    const icon = getActionIcon(item.actionType);
    const timestamp = new Date(item.timestamp);
    const today = new Date();
    
    // Format date to show time for today, date for older entries
    const isSameDay = timestamp.getDate() === today.getDate() &&
                      timestamp.getMonth() === today.getMonth() &&
                      timestamp.getFullYear() === today.getFullYear();
    
    const timeString = isSameDay 
      ? timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : timestamp.toLocaleDateString();
    
    return (
      <View style={styles.activityItem} key={item.id}>
        <View style={[styles.activityIcon, { backgroundColor: `${icon.color}20` }]}>
          <Ionicons name={icon.name} size={20} color={icon.color} />
        </View>
        <View style={styles.activityInfo}>
          <Text style={styles.activityText}>
            {getActionDescription(item.actionType, item.details)}
          </Text>
          <Text style={styles.activityTime}>{timeString}</Text>
        </View>
      </View>
    );
  };
  
  // Display only 3 logs if not expanded
  const displayLogs = expanded ? logs : logs.slice(0, 3);
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recent Activity</Text>
        {logs.length > 3 && (
          <TouchableOpacity 
            onPress={() => setExpanded(!expanded)}
          >
            <Text style={styles.showLessText}>
              {expanded ? 'Show Less' : 'Show More'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      ) : logs.length > 0 ? (
        <View style={[styles.logsList, expanded && styles.expandedList]}>
          {displayLogs.map(item => renderLogItem(item))}
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No recent activity</Text>
        </View>
      )}
      
      {logs.length > 0 && (
        <Text style={styles.activityCountText}>
          {logs.length} {logs.length === 1 ? 'activity' : 'activities'} recorded
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  showLessText: {
    color: '#007AFF',
    fontSize: 14,
    padding: 4,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  activityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E8F5E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityInfo: {
    flex: 1,
  },
  activityText: {
    fontSize: 15,
    color: '#1A1A1A',
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 13,
    color: '#8E8E93',
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  logsList: {
    maxHeight: 200,
  },
  expandedList: {
    maxHeight: 400,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#8E8E93',
    fontStyle: 'italic',
  },
  activityCountText: {
    color: '#8E8E93',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
}); 