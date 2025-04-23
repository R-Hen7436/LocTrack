import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';

export default function Navbar({ activePage }) {
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Fetch user status only once on component mount and when focus changes
  useEffect(() => {
    const checkUserStatus = async () => {
      try {
        setLoading(true);
        const auth = getAuth();
        if (!auth.currentUser) {
          setLoading(false);
          return;
        }
        
        const db = getDatabase();
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const snapshot = await get(userProfileRef);
        
        if (snapshot.exists()) {
          const userData = snapshot.val();
          const isAdminStatus = userData.isAdmin === true || userData.role === 'admin';
          const isOwnerStatus = userData.role === 'owner';

          setIsAdmin(isAdminStatus);
          setIsOwner(isOwnerStatus);
          console.log(`Navbar Status: isAdmin=${isAdminStatus}, isOwner=${isOwnerStatus}`);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error checking user status:', error);
        setLoading(false);
      }
    };
    
    checkUserStatus();
  }, [isFocused]);

  // Memoize the navbar content based on user role to prevent unnecessary re-renders
  const navbarContent = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.navbar}>
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      );
    }
  
    if (isAdmin) {
      // Admin navbar
      return (
        <View style={styles.navbar}>
          <TouchableOpacity 
            style={[styles.navItem, activePage === 'admin' && styles.activeNavItem]}
            onPress={() => navigation.navigate('AdminDashboard')}
          >
            <Ionicons name="people-outline" size={24} color="white" />
            <Text style={styles.navText}>Users</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.navItem, activePage === 'keys' && styles.activeNavItem]}
            onPress={() => navigation.navigate('ProductKeyManager')}
          >
            <Ionicons name="key-outline" size={24} color="white" />
            <Text style={styles.navText}>Keys</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.navItem, activePage === 'requests' && styles.activeNavItem]}
            onPress={() => navigation.navigate('GeofenceRequests')}
          >
            <Ionicons name="notifications-outline" size={24} color="white" />
            <Text style={styles.navText}>Requests</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.navItem, activePage === 'profile' && styles.activeNavItem]}
            onPress={() => navigation.navigate('Profile')}
          >
            <Ionicons name="person-outline" size={24} color="white" />
            <Text style={styles.navText}>Profile</Text>
          </TouchableOpacity>
        </View>
      );
    }
  
    // Check for Team Owner role (if not Super Admin)
    if (isOwner) {
      // Owner Navbar: IoTs, Maps, User Management, Logs, Profile
      return (
        <View style={styles.navbar}>
          {/* IoTs Tab */}
          <TouchableOpacity
            style={[styles.navItem, activePage === 'dashboard' && styles.activeNavItem]}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Ionicons name="grid-outline" size={24} color="white" />
            <Text style={styles.navText}>IoTs</Text>
          </TouchableOpacity>
  
          {/* Maps Tab */}
          <TouchableOpacity
            style={[styles.navItem, activePage === 'maps' && styles.activeNavItem]}
            onPress={() => navigation.navigate('LocTrack')}
          >
            <Ionicons name="map-outline" size={24} color="white" />
            <Text style={styles.navText}>Maps</Text>
          </TouchableOpacity>
  
          {/* User Management Tab */}
          <TouchableOpacity
            style={[styles.navItem, activePage === 'userManagement' && styles.activeNavItem]}
            onPress={() => navigation.navigate('UserManagement')}
          >
            <Ionicons name="people-circle-outline" size={24} color="white" />
            <Text style={styles.navText}>Manage</Text>
          </TouchableOpacity>
  
          {/* Logs Tab */}
          <TouchableOpacity
            style={[styles.navItem, activePage === 'logs' && styles.activeNavItem]}
            onPress={() => navigation.navigate('Logs')}
          >
            <Ionicons name="receipt-outline" size={24} color="white" />
            <Text style={styles.navText}>Logs</Text>
          </TouchableOpacity>
  
          {/* Profile Tab */}
          <TouchableOpacity
            style={[styles.navItem, activePage === 'profile' && styles.activeNavItem]}
            onPress={() => navigation.navigate('Profile')}
          >
            <Ionicons name="person-outline" size={24} color="white" />
            <Text style={styles.navText}>Profile</Text>
          </TouchableOpacity>
        </View>
      );
    }
  
    // Regular user navbar
    return (
      <View style={styles.navbar}>
        <TouchableOpacity 
          style={[styles.navItem, activePage === 'dashboard' && styles.activeNavItem]}
          onPress={() => navigation.navigate('Dashboard')}
        >
          <Ionicons name="grid-outline" size={24} color="white" />
          <Text style={styles.navText}>IoTs</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.navItem, activePage === 'maps' && styles.activeNavItem]}
          onPress={() => navigation.navigate('LocTrack')}
        >
          <Ionicons name="map-outline" size={24} color="white" />
          <Text style={styles.navText}>Maps</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.navItem, activePage === 'profile' && styles.activeNavItem]}
          onPress={() => navigation.navigate('Profile')}
        >
          <Ionicons name="person-outline" size={24} color="white" />
          <Text style={styles.navText}>Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }, [isAdmin, isOwner, activePage, loading]);

  return navbarContent;
}

const styles = StyleSheet.create({
  navbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    height: 80,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
    paddingHorizontal: 10,
    zIndex: 1000,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    borderRadius: 15,
    height: '70%',
    marginHorizontal: 4,
    flex: 1,
    maxWidth: 70,
  },
  navText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  activeNavItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
}); 