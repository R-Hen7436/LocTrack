import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ActivityIndicator, Alert } from 'react-native';
import { getDatabase, ref, get, query, orderByChild, set, update } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, signOut } from 'firebase/auth';
import Navbar from '../Navbar';
import { useFocusEffect } from '@react-navigation/native';

export default function AdminDashboard({ navigation, route }) {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalOwners: 0,
    totalMembers: 0,
    pendingRequests: 0
  });
  const [changeRequests, setChangeRequests] = useState([]);

  useFocusEffect(
    React.useCallback(() => {
      console.log('Dashboard focused, loading users...');
      loadUsers();
    }, [])
  );

  // Handle user deletion
  useEffect(() => {
    if (route.params?.deletedUserId) {
      console.log('User was deleted, removing from list:', route.params.deletedUserId);
      
      // Check if the user still exists in the database
      const checkIfUserStillExists = async () => {
        const db = getDatabase();
        const userRef = ref(db, `users/${route.params.deletedUserId}`);
        const snapshot = await get(userRef);
        
        if (snapshot.exists()) {
          console.error('WARNING: User still exists in database after deletion attempt!', route.params.deletedUserId);
          console.log('User data still in database:', JSON.stringify(snapshot.val()));
        } else {
          console.log('Confirmed: User successfully removed from database');
        }
      };
      
      checkIfUserStillExists();
      
      // Update the users list by removing the deleted user
      setUsers(prevUsers => prevUsers.filter(user => user.id !== route.params.deletedUserId));
      setFilteredUsers(prevUsers => prevUsers.filter(user => user.id !== route.params.deletedUserId));
      
      // Update stats
      const deletedUser = users.find(user => user.id === route.params.deletedUserId);
      if (deletedUser) {
        setStats(prevStats => {
          const newStats = { ...prevStats };
          newStats.totalUsers--;
          
          if (deletedUser.role === 'owner') newStats.totalOwners--;
          if (deletedUser.role === 'member') newStats.totalMembers--;
          
          return newStats;
        });
      }
      
      // Clear the params to prevent repeated processing
      navigation.setParams({ deletedUserId: null, refreshUsers: null });
    } else if (route.params?.refreshUsers) {
      console.log('Refreshing user list');
      loadUsers();
      navigation.setParams({ refreshUsers: null });
    }
  }, [route.params?.deletedUserId, route.params?.refreshUsers]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity
            onPress={handleRefresh}
            style={{ marginRight: 15 }}
          >
            <Ionicons name="refresh" size={24} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              try {
                await signOut(getAuth());
              } catch (error) {
                console.error('Error logging out:', error);
              }
            }}
            style={{ marginRight: 15 }}
          >
            <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    if (users.length > 0) {
      filterUsers();
    }
  }, [searchQuery, activeTab, users]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      console.log('Loading users from database...');
      const db = getDatabase();
      const usersRef = ref(db, 'users');
      
      const snapshot = await get(usersRef);
      console.log('Got snapshot, exists:', snapshot.exists());
      
      if (snapshot.exists()) {
        // Use a Map to deduplicate users by email
        const uniqueUsers = new Map();
        let activeCount = 0;
        let ownerCount = 0;
        let memberCount = 0;
        
        let foundValues = 0;
        let missingProfileCount = 0;
        let duplicateCount = 0;

        snapshot.forEach((child) => {
          foundValues++;
          console.log(`Processing user ${child.key}`);
          
          // Check if profile data exists
          const userData = child.val().profile;
          if (!userData) {
            console.warn(`User ${child.key} missing profile data!`);
            missingProfileCount++;
            return;
          }
          
          const user = {
            id: child.key,
            ...userData
          };

          // Use email as unique identifier
          if (userData.email) {
            // If this email already exists in our Map, we have a duplicate
            if (uniqueUsers.has(userData.email)) {
              duplicateCount++;
              console.log(`Found duplicate user with email: ${userData.email}`);
              
              // Keep the entry with the highest role priority
              const existingUser = uniqueUsers.get(userData.email);
              const rolePriority = { 'owner': 1, 'admin': 2, 'member': 3 };
              
              // Lower number means higher priority
              const existingPriority = rolePriority[existingUser.role] || 10;
              const newPriority = rolePriority[userData.role] || 10;
              
              // Only replace if the new entry has a higher priority role
              if (newPriority < existingPriority) {
                uniqueUsers.set(userData.email, user);
              }
            } else {
              // First time seeing this email, add to Map
              uniqueUsers.set(userData.email, user);
            }
          } else {
            // No email, use ID as key
            uniqueUsers.set(child.key, user);
          }
        });

        // Convert Map to array
        const usersData = Array.from(uniqueUsers.values());
        
        // Count stats on the deduplicated list
        usersData.forEach(user => {
          if (user.lastActive) activeCount++;
          if (user.role === 'owner') ownerCount++;
          if (user.role === 'member') memberCount++;
        });

        console.log(`Found ${foundValues} total users, ${missingProfileCount} missing profiles, ${duplicateCount} duplicates, ${usersData.length} unique users`);

        // Sort by registration date (newest first)
        usersData.sort((a, b) => {
          if (!a.createdAt || !b.createdAt) return 0;
          return new Date(b.createdAt) - new Date(a.createdAt);
        });

        setUsers(usersData);
        setFilteredUsers(usersData);
        setStats({
          totalUsers: usersData.length,
          activeUsers: activeCount,
          totalOwners: ownerCount,
          totalMembers: memberCount,
          pendingRequests: 0
        });
      } else {
        console.warn('No users found in database!');
        setUsers([]);
        setFilteredUsers([]);
        setStats({
          totalUsers: 0,
          activeUsers: 0,
          totalOwners: 0,
          totalMembers: 0,
          pendingRequests: 0
        });
      }
    } catch (error) {
      console.error('Error loading users:', error);
      Alert.alert('Error', 'Failed to load users. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const filterUsers = () => {
    let filtered = [...users];
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(user => 
        (user.firstName && user.firstName.toLowerCase().includes(query)) ||
        (user.lastName && user.lastName.toLowerCase().includes(query)) ||
        (user.email && user.email.toLowerCase().includes(query))
      );
    }
    
    // Filter by tab
    if (activeTab === 'owners') {
      filtered = filtered.filter(user => user.role === 'owner');
    } else if (activeTab === 'members') {
      filtered = filtered.filter(user => user.role === 'member');
    } else if (activeTab === 'admins') {
      filtered = filtered.filter(user => user.role === 'admin' || user.isAdmin);
    }
    
    setFilteredUsers(filtered);
  };

  const toggleUserStatus = async (user) => {
    try {
      const db = getDatabase();
      const isCurrentlyActive = user.isActive !== false; // undefined or true means active
      await set(ref(db, `users/${user.id}/profile/isActive`), !isCurrentlyActive);
      
      // Update local state
      const updatedUsers = users.map(u => {
        if (u.id === user.id) {
          return { ...u, isActive: !isCurrentlyActive };
        }
        return u;
      });
      
      setUsers(updatedUsers);
    } catch (error) {
      console.error('Error toggling user status:', error);
    }
  };

  const handleRefresh = () => {
    Alert.alert(
      'Refresh Users',
      'Do you want to refresh the user list?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Refresh',
          onPress: () => {
            console.log('Manually refreshing user list');
            loadUsers();
          }
        },
        {
          text: 'Deep Check',
          onPress: () => {
            console.log('Performing deep check of user data');
            checkDatabaseIntegrity();
          }
        },
        {
          text: 'Repair Data',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Repair Database',
              'This will attempt to fix common issues with user data. Continue?',
              [
                { text: 'Cancel', style: 'cancel' },
                { 
                  text: 'Repair',
                  style: 'destructive',
                  onPress: () => repairDatabaseIntegrity()
                }
              ]
            );
          }
        }
      ]
    );
  };
  
  const checkDatabaseIntegrity = async () => {
    try {
      setLoading(true);
      console.log('Starting database integrity check...');
      
      const db = getDatabase();
      
      console.log('Checking users path...');
      const checkPaths = ['users', 'UsersCurrentLocation', 'teams', 'invitations'];
      
      for (const path of checkPaths) {
        try {
          const pathRef = ref(db, path);
          const snapshot = await get(pathRef);
          console.log(`Path '${path}' exists:`, snapshot.exists());
          if (snapshot.exists()) {
            const childCount = Object.keys(snapshot.val() || {}).length;
            console.log(`Path '${path}' has ${childCount} children`);
          }
        } catch (pathError) {
          console.error(`Error checking path '${path}':`, pathError);
        }
      }
      
      console.log('Checking for users with missing profiles...');
      const usersRef = ref(db, 'users');
      const usersSnapshot = await get(usersRef);
      
      if (usersSnapshot.exists()) {
        let missingProfileCount = 0;
        let incompleteProfileCount = 0;
        
        usersSnapshot.forEach(child => {
          const userData = child.val();
          if (!userData.profile) {
            console.warn(`User ${child.key} is missing profile data entirely`);
            missingProfileCount++;
          } else {
            // Check for required fields
            const profile = userData.profile;
            if (!profile.email || !profile.role) {
              console.warn(`User ${child.key} has incomplete profile data:`, profile);
              incompleteProfileCount++;
            }
          }
        });
        
        if (missingProfileCount > 0 || incompleteProfileCount > 0) {
          console.error(`Found ${missingProfileCount} users with missing profiles and ${incompleteProfileCount} with incomplete profiles`);
          Alert.alert(
            'Database Issues Found',
            `Found ${missingProfileCount} users with missing profiles and ${incompleteProfileCount} with incomplete profiles. Check console for details.`
          );
        } else {
          console.log('All users have complete profiles');
          Alert.alert('Check Complete', 'All users have valid profile data. Issue may be with permissions or how data is being queried.');
        }
      } else {
        console.warn('No users found in database!');
        Alert.alert('No Users Found', 'No users found in the database. This may indicate a permissions issue or data structure problem.');
      }
    } catch (error) {
      console.error('Error during database integrity check:', error);
      Alert.alert('Error', 'Failed to check database integrity. See console for details.');
    } finally {
      setLoading(false);
      loadUsers(); // Refresh the user list after check
    }
  };

  const repairDatabaseIntegrity = async () => {
    try {
      setLoading(true);
      console.log('Starting database repair...');
      
      const db = getDatabase();
      const usersRef = ref(db, 'users');
      const usersSnapshot = await get(usersRef);
      
      if (!usersSnapshot.exists()) {
        console.warn('No users found to repair!');
        Alert.alert('Error', 'No users found in database to repair');
        return;
      }
      
      let repairCount = 0;
      let errorCount = 0;
      
      // For each user in the database
      const repairOperations = [];
      
      usersSnapshot.forEach(child => {
        const userId = child.key;
        const userData = child.val();
        
        // Check if profile exists
        if (!userData.profile) {
          console.log(`Repairing missing profile for user ${userId}`);
          
          // Create a default profile
          const defaultProfile = {
            email: userData.email || 'unknown@example.com',
            firstName: '',
            lastName: '',
            role: 'member',
            createdAt: new Date().toISOString(),
          };
          
          // Add to repair operations
          repairOperations.push(
            set(ref(db, `users/${userId}/profile`), defaultProfile)
              .then(() => {
                console.log(`Fixed profile for user ${userId}`);
                repairCount++;
              })
              .catch(error => {
                console.error(`Failed to fix profile for user ${userId}:`, error);
                errorCount++;
              })
          );
        }
        
        // Check if UsersCurrentLocation exists for this user
        repairOperations.push(
          get(ref(db, `UsersCurrentLocation/${userId}`))
            .then(locSnapshot => {
              if (!locSnapshot.exists()) {
                console.log(`Adding missing location data for user ${userId}`);
                return set(ref(db, `UsersCurrentLocation/${userId}`), {
                  Latitude: null,
                  Longitude: null,
                  Accuracy: null,
                  Timestamp: new Date().toISOString(),
                  userId: userId
                })
                .then(() => {
                  console.log(`Fixed location data for user ${userId}`);
                  repairCount++;
                });
              }
              return Promise.resolve();
            })
            .catch(error => {
              console.error(`Failed to fix location data for user ${userId}:`, error);
              errorCount++;
            })
        );
      });
      
      // Wait for all repair operations to complete
      await Promise.all(repairOperations);
      
      Alert.alert(
        'Repair Complete',
        `Repaired ${repairCount} issues with ${errorCount} errors. Please check the console for details.`
      );
      
      // Reload users after repair
      loadUsers();
    } catch (error) {
      console.error('Error during database repair:', error);
      Alert.alert('Error', 'Failed to repair database. See console for details.');
    } finally {
      setLoading(false);
    }
  };

  const loadResetRequests = async () => {
    try {
      const db = getDatabase();
      const requestsRef = ref(db, 'adminRequests/geofenceReset');
      const snapshot = await get(requestsRef);
      
      if (snapshot.exists()) {
        const requestsData = [];
        snapshot.forEach((child) => {
          const requestData = child.val();
          requestsData.push({
            id: child.key,
            type: 'reset',
            ...requestData
          });
        });
        
        // Add reset requests to change requests
        setChangeRequests(prevRequests => {
          // First get all non-reset requests
          const nonResetRequests = prevRequests.filter(req => req.type !== 'reset');
          return [...nonResetRequests, ...requestsData].sort((a, b) => {
            if (!a.requestDate || !b.requestDate) return 0;
            return new Date(b.requestDate) - new Date(a.requestDate);
          });
        });
        
        // Update pending count
        setStats(prevStats => ({
          ...prevStats,
          pendingRequests: prevStats.pendingRequests + requestsData.filter(req => req.status === 'pending').length
        }));
      }
    } catch (error) {
      console.error('Error loading reset requests:', error);
    }
  };

  const loadChangeRequests = async () => {
    try {
      const db = getDatabase();
      const requestsRef = ref(db, 'adminRequests/geofenceChanges');
      const snapshot = await get(requestsRef);
      
      if (snapshot.exists()) {
        const requestsData = [];
        snapshot.forEach((child) => {
          const requestData = child.val();
          requestsData.push({
            id: child.key,
            type: 'change',
            ...requestData
          });
        });
        
        // Sort by date (newest first)
        requestsData.sort((a, b) => {
          if (!a.requestDate || !b.requestDate) return 0;
          return new Date(b.requestDate) - new Date(a.requestDate);
        });
        
        setChangeRequests(requestsData);
        setStats(prevStats => ({
          ...prevStats,
          pendingRequests: requestsData.filter(req => req.status === 'pending').length
        }));
      } else {
        setChangeRequests([]);
        setStats(prevStats => ({
          ...prevStats,
          pendingRequests: 0
        }));
      }
    } catch (error) {
      console.error('Error loading change requests:', error);
    }
  };

  useEffect(() => {
    loadChangeRequests();
    loadResetRequests();
  }, []);

  const handleResetRequestAction = async (teamCode, action) => {
    try {
      const db = getDatabase();
      
      if (action === 'approve') {
        // Delete current geofence data
        await set(ref(db, `teams/${teamCode}/geofence`), null);
        
        // Also clear global geofence for compatibility
        await set(ref(db, `geofence/coordinates`), null);
        
        // Find all users with this team code and clear their profile cache
        const usersRef = ref(db, 'users');
        const snapshot = await get(usersRef);
        
        if (snapshot.exists()) {
          const userUpdates = {};
          
          snapshot.forEach((childSnapshot) => {
            const userId = childSnapshot.key;
            const userData = childSnapshot.val();
            
            if (userData?.profile?.teamCode === teamCode) {
              // Clear geofence data from profile
              userUpdates[`${userId}/profile/geofenceData`] = null;
              
              // For members, clear the cache
              if (userData?.profile?.role === 'member') {
                userUpdates[`${userId}/profile/teamGeofenceCache`] = null;
              }
            }
          });
          
          // Apply all updates at once
          if (Object.keys(userUpdates).length > 0) {
            await update(ref(db, 'users'), userUpdates);
          }
        }
        
        // Update request status
        await set(ref(db, `adminRequests/geofenceReset/${teamCode}/status`), 'approved');
        
        Alert.alert('Success', 'Geofence reset request approved');
      } else {
        // Update request status to rejected
        await set(ref(db, `adminRequests/geofenceReset/${teamCode}/status`), 'rejected');
        
        Alert.alert('Success', 'Geofence reset request rejected');
      }
      
      // Reload requests
      loadChangeRequests();
      loadResetRequests();
    } catch (error) {
      console.error('Error handling reset request:', error);
      Alert.alert('Error', 'Failed to process reset request');
    }
  };

  const renderUser = ({ item }) => (
    <TouchableOpacity 
      style={styles.userCard}
      onPress={() => navigation.navigate('UserDetail', { userId: item.id })}
    >
      <View style={styles.userInfo}>
        <View style={styles.userInitials}>
          <Text style={styles.initialsText}>
            {item.firstName ? item.firstName.charAt(0) : ''}
            {item.lastName ? item.lastName.charAt(0) : ''}
          </Text>
        </View>
        <View style={styles.userDetails}>
          <Text style={styles.userName}>{item.firstName} {item.lastName}</Text>
          <Text style={styles.userEmail}>{item.email}</Text>
          <View style={styles.roleContainer}>
            <Text style={[
              styles.userRole,
              item.role === 'admin' ? styles.adminRole : 
              item.role === 'owner' ? styles.ownerRole : 
              styles.memberRole
            ]}>
              {item.role}
            </Text>
            {item.isActive === false && (
              <Text style={styles.inactiveStatus}>Inactive</Text>
            )}
          </View>
        </View>
      </View>
      
      <TouchableOpacity 
        style={styles.actionButton}
        onPress={() => toggleUserStatus(item)}
      >
        <Ionicons 
          name={item.isActive === false ? "checkmark-circle" : "close-circle"} 
          size={24} 
          color={item.isActive === false ? "#4CD964" : "#FF3B30"} 
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderChangeRequest = ({ item }) => (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <Text style={styles.requestTeam}>Team: {item.teamCode}</Text>
        <Text style={[
          styles.requestStatus,
          item.status === 'pending' ? styles.statusPending :
          item.status === 'approved' ? styles.statusApproved :
          styles.statusRejected
        ]}>
          {item.status.toUpperCase()}
        </Text>
      </View>
      
      <View style={styles.requestInfo}>
        <Text style={styles.requestOwner}>
          Requested by: {item.ownerName}
        </Text>
        <Text style={styles.requestDate}>
          {new Date(item.requestDate).toLocaleDateString()} 
          {' '}
          {new Date(item.requestDate).toLocaleTimeString()}
        </Text>
        <Text style={styles.requestDetail}>
          {item.type === 'reset' 
            ? 'Request Type: RESET GEOFENCE' 
            : `Points: ${item.newCoordinates?.length || 0}`}
        </Text>
      </View>
      
      {item.status === 'pending' && (
        <View style={styles.requestActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={() => {
              if (item.type === 'reset') {
                handleResetRequestAction(item.teamCode, 'approve');
              } else {
                handleRequestAction(
                  item.id,
                  item.teamCode,
                  item.newCoordinates,
                  'approve'
                );
              }
            }}
          >
            <Ionicons name="checkmark" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Approve</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={() => {
              if (item.type === 'reset') {
                handleResetRequestAction(item.teamCode, 'reject');
              } else {
                handleRequestAction(
                  item.id,
                  item.teamCode,
                  item.newCoordinates,
                  'reject'
                );
              }
            }}
          >
            <Ionicons name="close" size={18} color="#fff" />
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search users..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.statsContainer}>
        <TouchableOpacity 
          style={[styles.statCard, activeTab === 'all' && styles.activeStatCard]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={styles.statNumber}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>All Users</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.statCard, activeTab === 'owners' && styles.activeStatCard]}
          onPress={() => setActiveTab('owners')}
        >
          <Text style={styles.statNumber}>{stats.totalOwners}</Text>
          <Text style={styles.statLabel}>Owners</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.statCard, activeTab === 'members' && styles.activeStatCard]}
          onPress={() => setActiveTab('members')}
        >
          <Text style={styles.statNumber}>{stats.totalMembers}</Text>
          <Text style={styles.statLabel}>Members</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.statCard, activeTab === 'admins' && styles.activeStatCard]}
          onPress={() => setActiveTab('admins')}
        >
          <Text style={styles.statNumber}>
            {users.filter(u => u.role === 'admin' || u.isAdmin).length}
          </Text>
          <Text style={styles.statLabel}>Admins</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading users...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
          renderItem={renderUser}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people" size={48} color="#CCC" />
              <Text style={styles.emptyText}>No users found</Text>
            </View>
          }
        />
      )}

      <Navbar activePage="admin" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 100,
    backgroundColor: '#F2F2F7',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  activeStatCard: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
    borderWidth: 1,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 100,
  },
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userInitials: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  initialsText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 18,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userRole: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  adminRole: {
    backgroundColor: '#FF3B30',
    color: '#FFFFFF',
  },
  ownerRole: {
    backgroundColor: '#007AFF',
    color: '#FFFFFF',
  },
  memberRole: {
    backgroundColor: '#34C759',
    color: '#FFFFFF',
  },
  inactiveStatus: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#8E8E93',
    color: '#FFFFFF',
  },
  actionButton: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: '#999',
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  requestTeam: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  requestStatus: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  statusPending: {
    backgroundColor: '#FF3B30',
    color: '#FFFFFF',
  },
  statusApproved: {
    backgroundColor: '#34C759',
    color: '#FFFFFF',
  },
  statusRejected: {
    backgroundColor: '#8E8E93',
    color: '#FFFFFF',
  },
  requestInfo: {
    marginBottom: 8,
  },
  requestOwner: {
    fontSize: 14,
    color: '#666',
  },
  requestDate: {
    fontSize: 12,
    color: '#999',
  },
  requestDetail: {
    fontSize: 12,
    color: '#666',
  },
  requestActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  approveButton: {
    backgroundColor: '#34C759',
  },
  rejectButton: {
    backgroundColor: '#FF3B30',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
}); 