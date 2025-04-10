import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { getDatabase, ref, get, query, orderByChild, set } from 'firebase/database';
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
    totalMembers: 0
  });

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
    const db = getDatabase();
    const usersRef = ref(db, 'users');
    const snapshot = await get(usersRef);
    
    if (snapshot.exists()) {
      const usersData = [];
      let activeCount = 0;
      let ownerCount = 0;
      let memberCount = 0;

      snapshot.forEach((child) => {
        const userData = child.val().profile;
        if (userData) {
          usersData.push({
            id: child.key,
            ...userData
          });

          if (userData.lastActive) activeCount++;
          if (userData.role === 'owner') ownerCount++;
          if (userData.role === 'member') memberCount++;
        }
      });

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
        totalMembers: memberCount
      });
    }
    setLoading(false);
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
}); 