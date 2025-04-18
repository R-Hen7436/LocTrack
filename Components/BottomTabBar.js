import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const BottomTabBar = ({ activeRoute }) => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.tabItem, activeRoute === 'maps' && styles.activeTab]} 
        onPress={() => navigation.navigate('LocTrack')}
      >
        <Ionicons 
          name={activeRoute === 'maps' ? 'map' : 'map-outline'} 
          size={24} 
          color={activeRoute === 'maps' ? '#2196F3' : '#555'} 
        />
        <Text style={[styles.tabText, activeRoute === 'maps' && styles.activeTabText]}>Map</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.tabItem, activeRoute === 'steps' && styles.activeTab]} 
        onPress={() => navigation.navigate('StepTracker')}
      >
        <Ionicons 
          name={activeRoute === 'steps' ? 'footsteps' : 'footsteps-outline'} 
          size={24} 
          color={activeRoute === 'steps' ? '#8E44AD' : '#555'} 
        />
        <Text style={[styles.tabText, activeRoute === 'steps' && styles.activeTabText]}>Steps</Text>
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.tabItem, activeRoute === 'profile' && styles.activeTab]} 
        onPress={() => navigation.navigate('Profile')}
      >
        <Ionicons 
          name={activeRoute === 'profile' ? 'person' : 'person-outline'} 
          size={24} 
          color={activeRoute === 'profile' ? '#4CAF50' : '#555'} 
        />
        <Text style={[styles.tabText, activeRoute === 'profile' && styles.activeTabText]}>Profile</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    height: 60,
    paddingBottom: 5,
    justifyContent: 'space-around',
    alignItems: 'center',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: -3,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4.65,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
  },
  activeTab: {
    borderTopWidth: 3,
    borderTopColor: '#2196F3',
    paddingTop: 2,
  },
  tabText: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  activeTabText: {
    color: '#2196F3',
    fontWeight: '600',
  }
});

export default BottomTabBar; 