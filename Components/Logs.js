import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, query, orderByChild, limitToLast } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import Navbar from './Navbar';

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'Unknown';
  
  // Handle Firebase server timestamps which might be objects
  if (typeof timestamp === 'object' && timestamp !== null) {
    // For server timestamps
    if (timestamp.seconds) {
      const date = new Date(timestamp.seconds * 1000);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
    
    // If it's a different kind of object with a toDate() method (Firestore Timestamp)
    if (typeof timestamp.toDate === 'function') {
      const date = timestamp.toDate();
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    }
  }
  
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

const getLogIcon = (logType) => {
  switch (logType) {
    case 'warning':
      return { name: 'warning-outline', color: '#FF9500' };
    case 'error':
      return { name: 'alert-circle-outline', color: '#FF3B30' };
    case 'userOnline':
      return { name: 'person', color: '#4CD964' };
    case 'userOffline':
      return { name: 'person-outline', color: '#8E8E93' };
    case 'location':
      return { name: 'location-outline', color: '#5AC8FA' };
    case 'activity':
      return { name: 'analytics-outline', color: '#4CD964' };
    case 'geofenceEnter':
      return { name: 'shield-checkmark', color: '#4CD964' }; // Green shield for entering geofence
    case 'geofenceExit':
      return { name: 'shield-outline', color: '#FF3B30' }; // Red outline shield for exiting geofence
    case 'rssi':
      return { name: 'pulse-outline', color: '#007AFF' };
    default:
      return { name: 'information-circle-outline', color: '#8E8E93' };
  }
};

export default function Logs({ navigation }) {
  const [logs, setLogs] = useState([]);
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastLoadedTimestamp, setLastLoadedTimestamp] = useState(null);
  const [noMoreLogs, setNoMoreLogs] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  
  const auth = getAuth();
  const db = getDatabase();
  
  useEffect(() => {
    if (auth.currentUser) {
      setUserEmail(auth.currentUser.email);
    }
  }, [auth.currentUser]);
  
  useEffect(() => {
    loadLogs();
  }, [filter]);
  
  const loadLogs = async (isLoadMore = false) => {
    if (!auth.currentUser) return;
    
    try {
      if (!isLoadMore) {
        setLoading(true);
        setDeviceInfo(null);
      } else {
        setLoadingMore(true);
      }
      
      let logsRef;
      const userId = auth.currentUser.uid;
      
      // Get user's team code to determine which logs to load
      const userRef = ref(db, `users/${userId}/profile`);
      const userSnap = await get(userRef);
      const userData = userSnap.val();
      
      if (!userData) {
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      
      // Base query with limit
      const limit = 20;
      
      // Special handling for location filter to include RSSI logs
      if (filter === 'location') {
        try {
          // Get the MAC address from registeredMac using the email
          const registeredMacRef = ref(db, `registeredMac/${auth.currentUser.email.replace('.', ',')}/macAddress`);
          const macSnapshot = await get(registeredMacRef);
          
          if (macSnapshot.exists()) {
            const macAddress = macSnapshot.val();
            
            // Use this MAC address to get RSSI logs
            const rssiLogsRef = ref(db, `RSSI_logs/${macAddress}`);
            const rssiLogsSnap = await get(rssiLogsRef);
            
            if (rssiLogsSnap.exists()) {
              let rssiLogs = [];
              
              // Get device info
              const deviceInfoRef = ref(db, `RSSI_logs/${macAddress}/device_info`);
              const locationHistoryRef = ref(db, `RSSI_logs/${macAddress}/location_history`);

              const [deviceInfoSnap, locationHistorySnap] = await Promise.all([
                get(deviceInfoRef),
                get(locationHistoryRef)
              ]);

              // Store device info
              if (deviceInfoSnap.exists()) {
                const deviceInfo = deviceInfoSnap.val();
                setDeviceInfo({
                  deviceId: macAddress,
                  mac_address: deviceInfo.mac_address,
                  name: deviceInfo.name,
                  email: auth.currentUser.email
                });
              }

              // Handle location history
              if (locationHistorySnap.exists()) {
                const locationHistory = locationHistorySnap.val();
                Object.entries(locationHistory).forEach(([key, entry]) => {
                  const timestamp = typeof entry.timestamp === 'string' ? 
                    Number(entry.timestamp) : entry.timestamp;
                    
                  rssiLogs.push({
                    id: `${macAddress}_${key}`,
                    type: 'location',
                    message: `Location Update - ${entry.location || 'Unknown Location'}`,
                    timestamp: timestamp,
                    details: {
                      deviceId: macAddress,
                      location: entry.location,
                      rssi: entry.rssi || { kalman: 'N/A', raw: 'N/A' },
                      timestamp: timestamp,
                      timestamp_readable: entry.timestamp_readable,
                      email: auth.currentUser.email
                    },
                    isLocationHistory: true
                  });
                });
              }

              // Sort and apply pagination as before
              rssiLogs.sort((a, b) => b.timestamp - a.timestamp);

              // Apply pagination
              if (isLoadMore && lastLoadedTimestamp) {
                const lastIndex = rssiLogs.findIndex(log => log.timestamp === lastLoadedTimestamp);
                if (lastIndex !== -1 && lastIndex + 1 < rssiLogs.length) {
                  rssiLogs = rssiLogs.slice(lastIndex + 1, lastIndex + 1 + limit);
                } else {
                  setNoMoreLogs(true);
                  rssiLogs = [];
                }
              } else {
                rssiLogs = rssiLogs.slice(0, limit);
              }

              if (rssiLogs.length < limit) {
                setNoMoreLogs(true);
              }

              if (isLoadMore) {
                setLogs(prevLogs => [...prevLogs, ...rssiLogs]);
              } else {
                setLogs(rssiLogs);
              }

              if (rssiLogs.length > 0) {
                const oldestLog = rssiLogs[rssiLogs.length - 1];
                setLastLoadedTimestamp(oldestLog.timestamp);
              }

              setLoading(false);
              setLoadingMore(false);
              return;
            }
          }
        } catch (error) {
          console.error('Error loading RSSI logs:', error);
          setLoading(false);
          setLoadingMore(false);
        }
      }
      
      // Different queries based on role
      if (userData.role === 'owner' || userData.role === 'admin') {
        // Load team logs & activity logs
        if (userData.teamCode) {
          try {
            // First try to fetch from the activityLog path where our new logs are stored
            const activityLogRef = ref(db, `teams/${userData.teamCode}/activityLog`);
            console.log(`📋 Checking for activity logs at: teams/${userData.teamCode}/activityLog`);
            const activitySnapshot = await get(activityLogRef);
            
            if (activitySnapshot.exists()) {
              console.log(`✅ Activity logs found! Count: ${Object.keys(activitySnapshot.val()).length}`);
              let activityLogs = [];
              activitySnapshot.forEach((childSnapshot) => {
                const eventType = childSnapshot.val().eventType || 'activity';
                const message = childSnapshot.val().message;
                
                console.log(`📌 Found log entry: type=${eventType}, message=${message}`);
                
                const log = {
                  id: childSnapshot.key,
                  type: eventType,
                  message: message,
                  timestamp: childSnapshot.val().timestamp,
                  clientTimestamp: childSnapshot.val().clientTimestamp,
                  userId: childSnapshot.val().userId,
                  userDisplayName: childSnapshot.val().userName,
                  details: null
                };
                // Apply filter
                if (filter === 'all' || log.type === filter) {
                  activityLogs.push(log);
                  console.log(`✓ Added log to display list: ${log.type} - ${log.message}`);
                } else {
                  console.log(`✗ Filtered out log due to type mismatch: current filter=${filter}, log type=${log.type}`);
                }
              });
              
              // If we have activity logs, use them
              if (activityLogs.length > 0) {
                // Client-side sorting (newest first)
                activityLogs.sort((a, b) => {
                  // Handle server timestamps which might be objects with .seconds property
                  const getTime = (log) => {
                    const timestamp = log.timestamp;
                    if (timestamp && typeof timestamp === 'object' && timestamp.seconds) {
                      return timestamp.seconds * 1000;
                    }
                    // If serverTimestamp doesn't exist or is invalid, fall back to clientTimestamp
                    if (log.clientTimestamp) {
                      return log.clientTimestamp;
                    }
                    return timestamp || 0;
                  };
                  return getTime(b) - getTime(a);
                });
                
                // Apply pagination logic
                if (isLoadMore && lastLoadedTimestamp) {
                  // Find the index of the last loaded log
                  const lastIndex = activityLogs.findIndex(log => log.timestamp === lastLoadedTimestamp);
                  if (lastIndex !== -1 && lastIndex + 1 < activityLogs.length) {
                    // Get the next batch after the last loaded log
                    activityLogs = activityLogs.slice(lastIndex + 1, lastIndex + 1 + limit);
                  } else {
                    setNoMoreLogs(true);
                    activityLogs = [];
                  }
                } else {
                  activityLogs = activityLogs.slice(0, limit);
                }
                
                if (activityLogs.length < limit) {
                  setNoMoreLogs(true);
                }
                
                if (isLoadMore) {
                  setLogs(prevLogs => [...prevLogs, ...activityLogs]);
                } else {
                  setLogs(activityLogs);
                }
                
                if (activityLogs.length > 0) {
                  const oldestLog = activityLogs[activityLogs.length - 1];
                  setLastLoadedTimestamp(oldestLog.timestamp);
                }
                
                setLoading(false);
                setLoadingMore(false);
                return; // Exit early since we've handled the logs
              }
            }
            
            // If no activity logs found, fall back to traditional logs
            logsRef = ref(db, `logs/teams/${userData.teamCode}`);
          } catch (error) {
            console.error('Error loading activity logs:', error);
            // Fall back to traditional logs
            logsRef = ref(db, `logs/teams/${userData.teamCode}`);
          }
        }
      } else {
        // Regular user only sees their own logs
        logsRef = ref(db, `logs/users/${userId}`);
      }
      
      if (logsRef) {
        const snapshot = await get(logsRef);
        
        if (snapshot.exists()) {
          let fetchedLogs = [];
          snapshot.forEach((childSnapshot) => {
            const log = {
              id: childSnapshot.key,
              ...childSnapshot.val()
            };
            
            // Apply filter if needed
            if (filter === 'all' || log.type === filter) {
              fetchedLogs.push(log);
            }
          });
          
          // Client-side sorting by timestamp (newer first)
          fetchedLogs.sort((a, b) => b.timestamp - a.timestamp);
          
          // Client-side pagination
          const totalLogsCount = fetchedLogs.length;
          
          if (isLoadMore && lastLoadedTimestamp) {
            // Find the index of the last loaded log
            const lastIndex = fetchedLogs.findIndex(log => log.timestamp === lastLoadedTimestamp);
            if (lastIndex !== -1 && lastIndex + 1 < totalLogsCount) {
              // Get the next batch after the last loaded log
              fetchedLogs = fetchedLogs.slice(lastIndex + 1, lastIndex + 1 + limit);
            } else {
              setNoMoreLogs(true);
              fetchedLogs = [];
            }
          } else {
            // First batch - just take the first 'limit' logs
            fetchedLogs = fetchedLogs.slice(0, limit);
          }
          
          // Check if there are more logs to load
          if (fetchedLogs.length < limit) {
            setNoMoreLogs(true);
          }
          
          // Update state
          if (isLoadMore) {
            // Add new logs to existing logs
            setLogs(prevLogs => [...prevLogs, ...fetchedLogs]);
          } else {
            setLogs(fetchedLogs);
          }
          
          // Update last loaded timestamp for pagination
          if (fetchedLogs.length > 0) {
            const oldestLog = fetchedLogs[fetchedLogs.length - 1];
            setLastLoadedTimestamp(oldestLog.timestamp);
          }
        } else {
          if (!isLoadMore) {
            setLogs([]);
          }
          setNoMoreLogs(true);
        }
      }
      
      setLoading(false);
      setLoadingMore(false);
    } catch (error) {
      console.error('Error in loadLogs:', error);
      setLoading(false);
      setLoadingMore(false);
    }
  };
  
  const handleLoadMore = () => {
    if (!loadingMore && !noMoreLogs) {
      loadLogs(true);
    }
  };
  
  const handleRefresh = () => {
    setNoMoreLogs(false);
    setLastLoadedTimestamp(null);
    loadLogs();
  };
  
  const renderFilterButton = (filterType, label) => (
    <TouchableOpacity
      style={[
        styles.filterButton,
        filter === filterType && styles.filterButtonActive
      ]}
      onPress={() => setFilter(filterType)}
    >
      <Text
        style={[
          styles.filterButtonText,
          filter === filterType && styles.filterButtonTextActive
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
  
  const renderLogItem = ({ item }) => {
    const icon = getLogIcon(item.type);
    
    const renderRssiDetails = (details) => {
      if (!details) return null;

      if (item.isDeviceInfo) {
        return (
          <View style={styles.rssiDetailsContainer}>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>Device ID:</Text>
              <Text style={styles.rssiValue}>{details.deviceId || 'Unknown'}</Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>MAC Address:</Text>
              <Text style={styles.rssiValue}>{details.mac_address || 'Unknown'}</Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>Name:</Text>
              <Text style={styles.rssiValue}>{details.name || 'Unknown'}</Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>Email:</Text>
              <Text style={styles.rssiValue}>{userEmail || 'Unknown'}</Text>
            </View>
          </View>
        );
      }

      if (item.isLocationHistory) {
        // Get RSSI values safely
        const kalmanRssi = details.rssi?.kalman || 'N/A';
        const rawRssi = details.rssi?.raw || 'N/A';
        
        // Helper function to get color based on RSSI value
        const getRssiColor = (rssi) => {
          if (rssi === 'N/A') return '#666';
          const rssiNum = Number(rssi);
          return rssiNum > -70 ? '#4CD964' : rssiNum > -90 ? '#FF9500' : '#FF3B30';
        };

        return (
          <View style={styles.rssiDetailsContainer}>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>Device ID:</Text>
              <Text style={styles.rssiValue}>{details.deviceId || 'Unknown'}</Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>Location:</Text>
              <Text style={styles.rssiValue}>{details.location || 'Unknown'}</Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>RSSI (Kalman):</Text>
              <Text style={[styles.rssiValue, { color: getRssiColor(kalmanRssi) }]}>
                {kalmanRssi} dBm
              </Text>
            </View>
            <View style={styles.rssiDetailRow}>
              <Text style={styles.rssiLabel}>RSSI (Raw):</Text>
              <Text style={[styles.rssiValue, { color: getRssiColor(rawRssi) }]}>
                {rawRssi} dBm
              </Text>
            </View>
          </View>
        );
      }

      return null;
    };
    
    return (
      <View style={styles.logItem}>
        <View style={[styles.logIconContainer, { backgroundColor: `${icon.color}20` }]}>
          <Ionicons name={icon.name} size={24} color={icon.color} />
        </View>
        
        <View style={styles.logContent}>
          <Text style={styles.logMessage}>{item.message}</Text>
          
          <View style={styles.logDetails}>
            {!item.isDeviceInfo && (
              <Text style={styles.logTimestamp}>
                {item.details?.timestamp_readable || (
                  item.clientTimestamp ? 
                  formatTimestamp(item.clientTimestamp) : 
                  formatTimestamp(item.timestamp)
                )}
              </Text>
            )}
          </View>
          
          {renderRssiDetails(item.details)}
        </View>
      </View>
    );
  };
  
  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="documents-outline" size={60} color="#CCCCCC" />
      <Text style={styles.emptyText}>No logs found</Text>
      <Text style={styles.emptySubtext}>
        {filter === 'all' 
          ? 'No activity logs are available at this time.' 
          : `No logs of type "${filter}" are available.`}
      </Text>
      <TouchableOpacity 
        style={styles.refreshButton}
        onPress={handleRefresh}
      >
        <Ionicons name="refresh-outline" size={16} color="#007AFF" />
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
  
  const renderFooter = () => {
    if (!loadingMore) return null;
    
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#007AFF" />
        <Text style={styles.footerText}>Loading more logs...</Text>
      </View>
    );
  };
  
  const renderDeviceInfo = () => {
    if (!deviceInfo) return null;

    return (
      <View style={styles.deviceInfoCard}>
        <View style={styles.deviceInfoHeader}>
          <Ionicons name="phone-portrait-outline" size={24} color="#007AFF" />
          <Text style={styles.deviceInfoTitle}>Device Information</Text>
        </View>
        <View style={styles.rssiDetailsContainer}>
          <View style={styles.rssiDetailRow}>
            <Text style={styles.rssiLabel}>Device ID:</Text>
            <Text style={styles.rssiValue}>{deviceInfo.deviceId}</Text>
          </View>
          <View style={styles.rssiDetailRow}>
            <Text style={styles.rssiLabel}>MAC Address:</Text>
            <Text style={styles.rssiValue}>{deviceInfo.mac_address}</Text>
          </View>
          <View style={styles.rssiDetailRow}>
            <Text style={styles.rssiLabel}>Name:</Text>
            <Text style={styles.rssiValue}>{deviceInfo.name}</Text>
          </View>
        </View>
      </View>
    );
  };
  
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Logs</Text>
          <TouchableOpacity onPress={handleRefresh} style={styles.refreshIcon}>
            <Ionicons name="refresh" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterScrollContainer}
        >
          <View style={styles.filterContainer}>
            {renderFilterButton('all', 'All')}
            {renderFilterButton('activity', 'Activity')}
            {renderFilterButton('location', 'Location')}
            {renderFilterButton('userOnline', 'Online')}
            {renderFilterButton('userOffline', 'Offline')}
            {renderFilterButton('warning', 'Warnings')}
            {renderFilterButton('error', 'Errors')}
            {renderFilterButton('geofenceEnter', 'Enter Geofence')}
            {renderFilterButton('geofenceExit', 'Exit Geofence')}
          </View>
        </ScrollView>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading logs...</Text>
          </View>
        ) : (
          <>
            {filter === 'location' && renderDeviceInfo()}
            <FlatList
              data={logs}
              renderItem={renderLogItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContainer}
              ListEmptyComponent={ListEmptyComponent}
              ListFooterComponent={renderFooter}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
            />
          </>
        )}
      </SafeAreaView>
      <Navbar activePage="logs" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F2F5',
  },
  content: {
    flex: 1,
    paddingBottom: 80, // Space for navbar
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  refreshIcon: {
    padding: 8,
  },
  filterScrollContainer: {
    flexGrow: 0,
    marginBottom: 8,
  },
  filterContainer: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginHorizontal: 4,
    backgroundColor: '#F0F0F5',
    minWidth: 80,
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 2,
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
    shadowColor: "#007AFF",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 4,
  },
  filterButtonText: {
    fontSize: 15,
    color: '#333333',
    fontWeight: '600',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  listContainer: {
    padding: 12,
    paddingBottom: 20,
  },
  logItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  logIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  logContent: {
    flex: 1,
  },
  logMessage: {
    fontSize: 15,
    fontWeight: '500',
    color: '#000',
    marginBottom: 4,
  },
  logDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  logDetailText: {
    fontSize: 13,
    color: '#666',
    marginRight: 8,
  },
  logTimestamp: {
    fontSize: 12,
    color: '#8E8E93',
  },
  logDetailsText: {
    fontSize: 13,
    color: '#666',
    backgroundColor: '#F2F2F7',
    padding: 6,
    borderRadius: 6,
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    marginTop: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    padding: 10,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 8,
  },
  refreshButtonText: {
    marginLeft: 4,
    color: '#007AFF',
    fontWeight: '600',
  },
  footerLoader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  footerText: {
    marginLeft: 8,
    color: '#666',
  },
  rssiDetailsContainer: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  rssiDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rssiLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  rssiValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#212121',
    flex: 1,
    textAlign: 'right',
  },
  deviceInfoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    margin: 16,
    marginTop: 0,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  deviceInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceInfoTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginLeft: 8,
  },
}); 