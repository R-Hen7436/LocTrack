import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { getDatabase, ref, get } from 'firebase/database';
import theme from '../constants/theme';

const NavItem = ({ icon, label, isActive, onPress }) => (
  <TouchableOpacity 
    style={styles.navItem} 
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={[styles.iconContainer, isActive && styles.activeIconContainer]}>
      <Ionicons 
        name={isActive ? icon : `${icon}-outline`} 
        size={22} 
        color={isActive ? theme.colors.primary : theme.colors.text.secondary} 
      />
    </View>
    <Text style={[styles.navText, isActive && styles.activeNavText]}>
      {label}
    </Text>
  </TouchableOpacity>
);

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
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      );
    }
  
    if (isAdmin) {
      // Admin navbar
      return (
        <View style={styles.navbar}>
          <NavItem 
            icon="people" 
            label="Users" 
            isActive={activePage === 'admin'} 
            onPress={() => navigation.navigate('AdminDashboard')} 
          />
          
          <NavItem 
            icon="key" 
            label="Keys" 
            isActive={activePage === 'keys'} 
            onPress={() => navigation.navigate('ProductKeyManager')} 
          />
          
          <NavItem 
            icon="notifications" 
            label="Requests" 
            isActive={activePage === 'requests'} 
            onPress={() => navigation.navigate('GeofenceRequests')} 
          />
          
          <NavItem 
            icon="person" 
            label="Profile" 
            isActive={activePage === 'profile'} 
            onPress={() => navigation.navigate('Profile')} 
          />
        </View>
      );
    }
  
    // Check for Team Owner role (if not Super Admin)
    if (isOwner) {
      // Owner Navbar: IoTs, Maps, User Management, Logs, Profile
      return (
        <View style={styles.navbar}>
          <NavItem 
            icon="grid" 
            label="IoTs" 
            isActive={activePage === 'dashboard'} 
            onPress={() => navigation.navigate('Dashboard')} 
          />
          
          <NavItem 
            icon="map" 
            label="Maps" 
            isActive={activePage === 'maps'} 
            onPress={() => navigation.navigate('LocTrack')} 
          />
          
          <NavItem 
            icon="people-circle" 
            label="Manage" 
            isActive={activePage === 'userManagement'} 
            onPress={() => navigation.navigate('UserManagement')} 
          />
          
          <NavItem 
            icon="receipt" 
            label="Logs" 
            isActive={activePage === 'logs'} 
            onPress={() => navigation.navigate('Logs')} 
          />
          
          <NavItem 
            icon="person" 
            label="Profile" 
            isActive={activePage === 'profile'} 
            onPress={() => navigation.navigate('Profile')} 
          />
        </View>
      );
    }
  
    // Regular user navbar
    return (
      <View style={styles.navbar}>
        <NavItem 
          icon="grid" 
          label="IoTs" 
          isActive={activePage === 'dashboard'} 
          onPress={() => navigation.navigate('Dashboard')} 
        />
        
        <NavItem 
          icon="map" 
          label="Maps" 
          isActive={activePage === 'maps'} 
          onPress={() => navigation.navigate('LocTrack')} 
        />
        
        <NavItem 
          icon="person" 
          label="Profile" 
          isActive={activePage === 'profile'} 
          onPress={() => navigation.navigate('Profile')} 
        />
      </View>
    );
  }, [isAdmin, isOwner, activePage, loading, navigation]);

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
    backgroundColor: Platform.OS === 'ios' 
      ? 'rgba(255, 255, 255, 0.92)' 
      : 'rgba(255, 255, 255, 0.97)',
    height: 100,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 25 : 15,
    borderTopWidth: 1,
    borderTopColor: 'rgba(235, 235, 235, 0.5)',
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
      },
      android: {
        elevation: 8,
      },
    }),
    zIndex: 10,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIconContainer: {
    backgroundColor: `${theme.colors.primaryLight}40`,
    width: 44,
    height: 44,
    borderRadius: 14,
  },
  navText: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.colors.text.secondary,
    marginTop: 4,
  },
  activeNavText: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
}); 