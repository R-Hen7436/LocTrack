import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function Navbar({ activePage }) {
  const navigation = useNavigation();

  return (
    <View style={styles.navbar}>
      <TouchableOpacity 
        style={[styles.navItem, activePage === 'dashboard' && styles.activeNavItem]}
        onPress={() => navigation.navigate('Dashboard')}
      >
        <Ionicons name="grid-outline" size={24} color="white" />
        <Text style={styles.navText}>Dashboard</Text>
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
}

const styles = StyleSheet.create({
  navbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    paddingHorizontal: 30,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 15,
    height: '100%',
    width: 80,
  },
  navText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
  activeNavItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
}); 