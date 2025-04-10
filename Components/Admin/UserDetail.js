import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Switch } from 'react-native';
import { getDatabase, ref, get, set, remove } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { getAuth, deleteUser } from 'firebase/auth';

export default function UserDetail({ route, navigation }) {
  const { userId } = route.params;
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);

  useEffect(() => {
    loadUserData();
  }, [userId]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: 'User Details',
      headerRight: () => (
        <TouchableOpacity
          onPress={handleDelete}
          style={{ marginRight: 15 }}
        >
          <Ionicons name="trash-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, userData]);

  const loadUserData = async () => {
    try {
      const db = getDatabase();
      const userRef = ref(db, `users/${userId}/profile`);
      const snapshot = await get(userRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserData(data);

        // If user is an owner, load their team members
        if (data.role === 'owner' && data.teamCode) {
          await loadTeamMembers(data.teamCode);
        }
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading user data:', error);
      setLoading(false);
      Alert.alert('Error', 'Failed to load user data');
    }
  };

  const loadTeamMembers = async (teamCode) => {
    try {
      const db = getDatabase();
      const teamsRef = ref(db, `teams/${teamCode}/members`);
      const snapshot = await get(teamsRef);
      
      if (snapshot.exists()) {
        const members = [];
        snapshot.forEach((child) => {
          members.push({
            id: child.key,
            ...child.val()
          });
        });
        setTeamMembers(members);
      }
    } catch (error) {
      console.error('Error loading team members:', error);
    }
  };

  const handleChangeRole = async (newRole) => {
    try {
      const db = getDatabase();
      
      // If changing from owner to member, need to handle team ownership
      if (userData.role === 'owner' && newRole === 'member') {
        Alert.alert(
          'Warning',
          'Changing role from owner to member will delete their team. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Continue', 
              style: 'destructive',
              onPress: async () => {
                // Delete team if exists
                if (userData.teamCode) {
                  await remove(ref(db, `teams/${userData.teamCode}`));
                }
                
                // Update user role
                await set(ref(db, `users/${userId}/profile`), {
                  ...userData,
                  role: newRole,
                  isOwner: false,
                  teamCode: null
                });
                
                // Reload user data
                await loadUserData();
                Alert.alert('Success', 'User role updated successfully');
              }
            }
          ]
        );
        return;
      }
      
      // If changing from member to owner, generate new team code
      if (userData.role === 'member' && newRole === 'owner') {
        const teamCode = Math.random().toString(36).substring(2, 10);
        
        // Create new team
        await set(ref(db, `teams/${teamCode}`), {
          ownerId: userId,
          createdAt: new Date().toISOString(),
          name: `${userData.firstName}'s Team`,
          members: {},
          teamCode: teamCode
        });
        
        // Update user role
        await set(ref(db, `users/${userId}/profile`), {
          ...userData,
          role: newRole,
          isOwner: true,
          teamCode: teamCode
        });
        
        await loadUserData();
        Alert.alert('Success', 'User role updated successfully');
        return;
      }
      
      // Simple role change for other cases
      await set(ref(db, `users/${userId}/profile`), {
        ...userData,
        role: newRole,
        isOwner: newRole === 'owner',
        isAdmin: newRole === 'admin'
      });
      
      await loadUserData();
      Alert.alert('Success', 'User role updated successfully');
    } catch (error) {
      console.error('Error changing role:', error);
      Alert.alert('Error', 'Failed to change user role');
    }
  };

  const handleToggleStatus = async (isActive) => {
    try {
      const db = getDatabase();
      await set(ref(db, `users/${userId}/profile`), {
        ...userData,
        isActive: isActive
      });
      
      await loadUserData();
      Alert.alert('Success', `User ${isActive ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      console.error('Error toggling status:', error);
      Alert.alert('Error', 'Failed to update user status');
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Confirm Delete',
      'Are you sure you want to delete this user? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const db = getDatabase();
              
              // Delete user from database
              await remove(ref(db, `users/${userId}`));
              
              // Delete location data
              await remove(ref(db, `UsersCurrentLocation/${userId}`));
              
              // If owner, delete team
              if (userData.role === 'owner' && userData.teamCode) {
                await remove(ref(db, `teams/${userData.teamCode}`));
              }
              
              // Navigate back with success parameter
              navigation.navigate('AdminDashboard', { 
                deletedUserId: userId,
                refreshUsers: true
              });
              
              Alert.alert('Success', 'User deleted successfully');
            } catch (error) {
              console.error('Error deleting user:', error);
              Alert.alert('Error', 'Failed to delete user');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading user data...</Text>
      </View>
    );
  }

  if (!userData) {
    return (
      <View style={styles.loadingContainer}>
        <Text>User not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.headerSection}>
        <View style={styles.profileIcon}>
          <Text style={styles.profileInitials}>
            {userData.firstName ? userData.firstName.charAt(0) : ''}
            {userData.lastName ? userData.lastName.charAt(0) : ''}
          </Text>
        </View>
        <Text style={styles.userName}>{userData.firstName} {userData.lastName}</Text>
        <Text style={styles.userEmail}>{userData.email}</Text>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.sectionTitle}>Account Information</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Role</Text>
            <Text style={styles.value}>{userData.role}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.label}>Created</Text>
            <Text style={styles.value}>
              {userData.createdAt ? new Date(userData.createdAt).toLocaleDateString() : 'N/A'}
            </Text>
          </View>
          
          {userData.teamCode && (
            <View style={styles.infoRow}>
              <Text style={styles.label}>Team Code</Text>
              <Text style={styles.value}>{userData.teamCode}</Text>
            </View>
          )}
          
          <View style={styles.infoRow}>
            <Text style={styles.label}>Status</Text>
            <View style={styles.statusToggle}>
              <Text style={styles.statusText}>
                {userData.isActive === false ? 'Inactive' : 'Active'}
              </Text>
              <Switch
                value={userData.isActive !== false}
                onValueChange={handleToggleStatus}
                trackColor={{ false: '#767577', true: '#81b0ff' }}
                thumbColor={userData.isActive !== false ? '#007AFF' : '#f4f3f4'}
              />
            </View>
          </View>
        </View>
      </View>

      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>Actions</Text>
        
        <View style={styles.roleButtons}>
          <TouchableOpacity
            style={[
              styles.roleButton,
              userData.role === 'admin' && styles.activeRoleButton
            ]}
            onPress={() => handleChangeRole('admin')}
            disabled={userData.role === 'admin'}
          >
            <Text style={[
              styles.roleButtonText,
              userData.role === 'admin' && styles.activeRoleButtonText
            ]}>Make Admin</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.roleButton,
              userData.role === 'owner' && styles.activeRoleButton
            ]}
            onPress={() => handleChangeRole('owner')}
            disabled={userData.role === 'owner'}
          >
            <Text style={[
              styles.roleButtonText,
              userData.role === 'owner' && styles.activeRoleButtonText
            ]}>Make Owner</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.roleButton,
              userData.role === 'member' && styles.activeRoleButton
            ]}
            onPress={() => handleChangeRole('member')}
            disabled={userData.role === 'member'}
          >
            <Text style={[
              styles.roleButtonText,
              userData.role === 'member' && styles.activeRoleButtonText
            ]}>Make Member</Text>
          </TouchableOpacity>
        </View>
      </View>

      {userData.role === 'owner' && teamMembers.length > 0 && (
        <View style={styles.teamSection}>
          <Text style={styles.sectionTitle}>Team Members</Text>
          {teamMembers.map(member => (
            <View key={member.id} style={styles.memberCard}>
              <Text style={styles.memberName}>{member.name || member.id}</Text>
              <Text style={styles.memberJoined}>
                Joined: {new Date(member.joinedAt).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  headerSection: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  profileIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  profileInitials: {
    fontSize: 30,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  userEmail: {
    fontSize: 16,
    color: '#666666',
  },
  infoSection: {
    marginBottom: 20,
    paddingHorizontal: 15,
  },
  actionsSection: {
    marginBottom: 20,
    paddingHorizontal: 15,
  },
  teamSection: {
    marginBottom: 20,
    paddingHorizontal: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 15,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  label: {
    fontSize: 16,
    color: '#666666',
  },
  value: {
    fontSize: 16,
    fontWeight: '500',
  },
  roleButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  roleButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
  },
  activeRoleButton: {
    backgroundColor: '#007AFF',
  },
  roleButtonText: {
    fontWeight: '600',
    color: '#333333',
  },
  activeRoleButtonText: {
    color: '#FFFFFF',
  },
  memberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
  },
  memberJoined: {
    fontSize: 14,
    color: '#666666',
    marginTop: 5,
  },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    marginRight: 10,
    fontSize: 16,
    fontWeight: '500',
  },
}); 