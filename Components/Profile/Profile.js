import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get, set } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import Navbar from '../Navbar';
import { auth, db } from '../firebaseConfig';

export default function Profile({ navigation }) {
  const [userProfile, setUserProfile] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const snapshot = await get(userProfileRef);
      
      if (snapshot.exists()) {
        const profileData = snapshot.val();
        console.log('User Profile Data:', profileData);
        setUserProfile(profileData);
        
        if (profileData.role === 'owner' && profileData.teamCode) {
          await loadTeamMembers();
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading profile:', error);
      setLoading(false);
    }
  };

  const loadTeamMembers = async () => {
    if (!auth.currentUser || userProfile?.role !== 'owner') return;
    
    try {
      const teamRef = ref(db, `teams/${auth.currentUser.uid}/members`);
      const snapshot = await get(teamRef);
      
      if (snapshot.exists()) {
        const members = [];
        const memberPromises = [];
        
        snapshot.forEach((child) => {
          const memberPromise = get(ref(db, `users/${child.key}`))
            .then((userSnapshot) => {
              if (userSnapshot.exists()) {
                const userData = userSnapshot.val();
                return {
                  id: child.key,
                  email: userData.email,
                  role: userData.role,
                  name: userData.name || 'No Name'
                };
              }
              return null;
            })
            .catch((error) => {
              console.error(`Error fetching member ${child.key}:`, error);
              return null;
            });
          
          memberPromises.push(memberPromise);
        });

        const resolvedMembers = await Promise.all(memberPromises);
        const validMembers = resolvedMembers.filter(member => member !== null);
        
        if (validMembers.length === 0) {
          // If no valid members found, clear the team members from Firebase
          await set(teamRef, null);
          setTeamMembers([]);
        } else {
          setTeamMembers(validMembers);
        }
      } else {
        setTeamMembers([]);
      }
    } catch (error) {
      console.error("Error loading team members:", error);
      setTeamMembers([]);
    }
  };

  const renderMember = ({ item }) => (
    <View style={styles.memberCard}>
      <Ionicons name="person" size={24} color="#007AFF" />
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>
          {item.name}
        </Text>
        <Text style={styles.memberEmail}>{item.email}</Text>
        <Text style={styles.memberTeamCode}>Team Code: {userProfile?.teamCode || 'No team code found'}</Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Ionicons name="person-circle-outline" size={80} color="#007AFF" />
          <Text style={styles.name}>
            {userProfile?.firstName} {userProfile?.middleName} {userProfile?.lastName}
          </Text>
        </View>

        <View style={styles.infoContainer}>
          <InfoItem label="Email" value={userProfile?.email} />
          <InfoItem label="Role" value={userProfile?.role?.charAt(0).toUpperCase() + userProfile?.role?.slice(1)} />
          {userProfile?.role === 'owner' && (
            <>
              <View style={styles.teamCodeContainer}>
                <Text style={styles.label}>Team Code</Text>
                <View style={styles.codeBox}>
                  <Text style={styles.teamCode}>{userProfile?.teamCode || 'No team code found'}</Text>
                </View>
              </View>
              
              <View style={styles.teamMembersContainer}>
                <Text style={styles.teamMembersTitle}>Team Members ({teamMembers.length})</Text>
                <FlatList
                  data={teamMembers}
                  renderItem={renderMember}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={
                    <Text style={styles.noMembers}>No team members yet</Text>
                  }
                />
              </View>
            </>
          )}
        </View>
      </View>
      <Navbar activePage="profile" />
    </View>
  );
}

const InfoItem = ({ label, value }) => (
  <View style={styles.infoItem}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    padding: 20,
    paddingBottom: 100, // Add padding to prevent content from being hidden behind navbar
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 10,
  },
  infoContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 15,
  },
  infoItem: {
    marginBottom: 15,
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  value: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  teamCodeContainer: {
    marginTop: 20,
  },
  codeBox: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  teamCode: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
    letterSpacing: 2,
  },
  teamMembersContainer: {
    marginTop: 20,
  },
  teamMembersTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  memberCard: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  memberInfo: {
    marginLeft: 10,
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  memberEmail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  memberTeamCode: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 2,
  },
  noMembers: {
    textAlign: 'center',
    color: '#666',
    fontStyle: 'italic',
    marginTop: 10,
  }
}); 