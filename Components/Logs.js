import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, query, orderByChild, limitToLast } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import Navbar from './Navbar';

const formatTimestamp = (timestamp) => {
  if (!timestamp) return 'Unknown';
  
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
    case 'login':
      return { name: 'log-in-outline', color: '#4CD964' };
    case 'logout':
      return { name: 'log-out-outline', color: '#FF9500' };
    case 'location':
      return { name: 'location-outline', color: '#007AFF' };
    case 'geofence':
      return { name: 'radio-outline', color: '#5856D6' };
    case 'error':
      return { name: 'warning-outline', color: '#FF3B30' };
    case 'permission':
      return { name: 'key-outline', color: '#FF9500' };
    case 'system':
      return { name: 'cog-outline', color: '#8E8E93' };
    default:
      return { name: 'information-circle-outline', color: '#8E8E93' };
  }
};

export default function Logs({ navigation }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastLoadedTimestamp, setLastLoadedTimestamp] = useState(null);
  const [noMoreLogs, setNoMoreLogs] = useState(false);
  
  const auth = getAuth();
  const db = getDatabase();
  
  // Initial logs load
  useEffect(() => {
    loadLogs();
  }, [filter]);
  
  const loadLogs = async (isLoadMore = false) => {
    if (!auth.currentUser) return;
    
    try {
      if (!isLoadMore) {
        setLoading(true);
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
      
      // Base query with limit - avoiding orderByChild to prevent indexing issues
      const limit = 20;
      
      // Different queries based on role
      if (userData.role === 'owner' || userData.role === 'admin') {
        // Load team logs
        if (userData.teamCode) {
          // Use simple ref without orderByChild to avoid indexing error
          logsRef = ref(db, `logs/teams/${userData.teamCode}`);
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
      console.error('Error loading logs:', error);
      // Show a more user-friendly error message
      Alert.alert(
        "Error Loading Logs",
        "There was a problem retrieving activity logs. Please try again later.",
        [{ text: "OK" }]
      );
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
      style={[styles.filterButton, filter === filterType && styles.filterButtonActive]}
      onPress={() => setFilter(filterType)}
    >
      <Text style={[styles.filterButtonText, filter === filterType && styles.filterButtonTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
  
  const renderLogItem = ({ item }) => {
    const icon = getLogIcon(item.type);
    
    return (
      <View style={styles.logItem}>
        <View style={[styles.logIconContainer, { backgroundColor: `${icon.color}20` }]}>
          <Ionicons name={icon.name} size={24} color={icon.color} />
        </View>
        
        <View style={styles.logContent}>
          <Text style={styles.logMessage}>{item.message}</Text>
          
          <View style={styles.logDetails}>
            {item.userId && item.userDisplayName && (
              <Text style={styles.logDetailText}>
                {item.userDisplayName}
              </Text>
            )}
            <Text style={styles.logTimestamp}>{formatTimestamp(item.timestamp)}</Text>
          </View>
          
          {item.details && (
            <Text style={styles.logDetailsText}>
              {typeof item.details === 'string' 
                ? item.details 
                : JSON.stringify(item.details)}
            </Text>
          )}
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
  
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Activity Logs</Text>
          <TouchableOpacity style={styles.refreshIcon} onPress={handleRefresh}>
            <Ionicons name="refresh" size={22} color="#007AFF" />
          </TouchableOpacity>
        </View>
        
        <View style={styles.filterContainer}>
          {renderFilterButton('all', 'All')}
          {renderFilterButton('login', 'Login')}
          {renderFilterButton('location', 'Location')}
          {renderFilterButton('geofence', 'Geofence')}
          {renderFilterButton('error', 'Errors')}
        </View>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading logs...</Text>
          </View>
        ) : (
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
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  filterButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginHorizontal: 4,
    backgroundColor: '#E5E5EA',
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterButtonText: {
    fontSize: 14,
    color: '#666',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
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
}); 