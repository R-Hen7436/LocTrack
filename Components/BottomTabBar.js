import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

const BottomTabBar = ({ activeRoute }) => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.tabBarContainer}>
        <TouchableOpacity 
          style={[styles.tabItem, activeRoute === 'maps' && styles.activeTab]} 
          onPress={() => navigation.navigate('LocTrack')}
        >
          <View style={activeRoute === 'maps' ? styles.iconBackground : null}>
            <Ionicons 
              name={activeRoute === 'maps' ? 'map' : 'map-outline'} 
              size={24} 
              color={activeRoute === 'maps' ? '#FFFFFF' : '#555'} 
            />
          </View>
          <Text style={[styles.tabText, activeRoute === 'maps' && styles.activeTabText]}>Map</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeRoute === 'steps' && styles.activeTab]} 
          onPress={() => navigation.navigate('StepTracker')}
        >
          <View style={activeRoute === 'steps' ? styles.iconBackground : null}>
            <Ionicons 
              name={activeRoute === 'steps' ? 'footsteps' : 'footsteps-outline'} 
              size={24} 
              color={activeRoute === 'steps' ? '#FFFFFF' : '#555'} 
            />
          </View>
          <Text style={[styles.tabText, activeRoute === 'steps' && styles.activeTabText]}>Steps</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeRoute === 'profile' && styles.activeTab]} 
          onPress={() => navigation.navigate('Profile')}
        >
          <View style={activeRoute === 'profile' ? styles.iconBackground : null}>
            <Ionicons 
              name={activeRoute === 'profile' ? 'person' : 'person-outline'} 
              size={24} 
              color={activeRoute === 'profile' ? '#FFFFFF' : '#555'} 
            />
          </View>
          <Text style={[styles.tabText, activeRoute === 'profile' && styles.activeTabText]}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 10,
  },
  tabBarContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    height: 60,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 15,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  iconBackground: {
    backgroundColor: '#766AC8',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  activeTab: {
    transform: [{translateY: -2}],
  },
  tabText: {
    fontSize: 12,
    color: '#555',
    marginTop: 0,
  },
  activeTabText: {
    color: '#766AC8',
    fontWeight: '600',
  }
});

export default BottomTabBar; 