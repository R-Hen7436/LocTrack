import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import theme from '../constants/theme';

const TabBarIcon = ({ iconName, isFilled, color, size = 24 }) => (
  <Ionicons 
    name={isFilled ? iconName : `${iconName}-outline`} 
    size={size} 
    color={color} 
  />
);

const TabItem = ({ label, iconName, isActive, onPress }) => {
  // Using scale animation for active tab
  const animatedScale = React.useRef(new Animated.Value(isActive ? 1.1 : 1)).current;
  
  React.useEffect(() => {
    Animated.spring(animatedScale, {
      toValue: isActive ? 1.1 : 1,
      friction: 7,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [isActive, animatedScale]);

  return (
    <TouchableOpacity 
      style={styles.tabItem} 
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Animated.View 
        style={[
          styles.tabItemContainer,
          isActive && styles.activeTabItemContainer,
          { transform: [{ scale: animatedScale }] }
        ]}
      >
        <TabBarIcon 
          iconName={iconName} 
          isFilled={isActive} 
          color={isActive ? theme.colors.primary : theme.colors.text.secondary} 
          size={isActive ? 24 : 22} 
        />
      </Animated.View>
      <Text 
        style={[
          styles.tabText, 
          isActive && styles.activeTabText
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const BottomTabBar = ({ activeRoute }) => {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.tabBarContainer}>
        <TabItem 
          label="Map"
          iconName="map"
          isActive={activeRoute === 'maps'}
          onPress={() => navigation.navigate('LocTrack')}
        />
        
        <TabItem 
          label="Steps"
          iconName="footsteps"
          isActive={activeRoute === 'steps'}
          onPress={() => navigation.navigate('StepTracker')}
        />
        
        <TabItem 
          label="Profile"
          iconName="person"
          isActive={activeRoute === 'profile'}
          onPress={() => navigation.navigate('Profile')}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    left: 15,
    right: 15,
    alignItems: 'center',
    zIndex: 10,
  },
  tabBarContainer: {
    flexDirection: 'row',
    backgroundColor: Platform.OS === 'ios' 
      ? 'rgba(255, 255, 255, 0.9)' 
      : 'rgba(255, 255, 255, 0.95)',
    borderRadius: 28,
    height: 64,
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabItemContainer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  activeTabItemContainer: {
    backgroundColor: `${theme.colors.primaryLight}55`, // Adding transparency
    borderRadius: 14,
  },
  tabText: {
    fontSize: 11,
    color: theme.colors.text.secondary,
    fontWeight: '500',
    marginTop: 2,
  },
  activeTabText: {
    color: theme.colors.primary,
    fontWeight: '600',
  }
});

export default BottomTabBar; 