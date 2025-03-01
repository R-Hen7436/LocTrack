import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { getDatabase, ref, get, query, orderByChild } from 'firebase/database';

export default function AdminDashboard({ navigation }) {
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalOwners: 0,
    totalMembers: 0
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
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
        usersData.push({
          id: child.key,
          ...userData
        });

        if (userData.lastActive) activeCount++;
        if (userData.role === 'owner') ownerCount++;
        if (userData.role === 'member') memberCount++;
      });

      setUsers(usersData);
      setStats({
        totalUsers: usersData.length,
        activeUsers: activeCount,
        totalOwners: ownerCount,
        totalMembers: memberCount
      });
    }
  };

  const renderUser = ({ item }) => (
    <TouchableOpacity 
      style={styles.userCard}
      onPress={() => navigation.navigate('UserDetail', { userId: item.id })}
    >
      <Text style={styles.userName}>{item.firstName} {item.lastName}</Text>
      <Text style={styles.userRole}>{item.role}</Text>
      <Text style={styles.userEmail}>{item.email}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalUsers}</Text>
          <Text style={styles.statLabel}>Total Users</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalOwners}</Text>
          <Text style={styles.statLabel}>Owners</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{stats.totalMembers}</Text>
          <Text style={styles.statLabel}>Members</Text>
        </View>
      </View>

      <FlatList
        data={users}
        renderItem={renderUser}
        keyExtractor={item => item.id}
        style={styles.list}
      />
    </View>
  );
} 