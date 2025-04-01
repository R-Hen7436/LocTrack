import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase, ref, get, onValue } from 'firebase/database';
import Navbar from '../Navbar';
import { getAuth } from 'firebase/auth';

const SAMPLE_IOT_DEVICES = [
  {
    id: '1',
    name: 'Security Camera',
    type: 'camera',
    status: 'online',
    location: 'Front Door',
    lastUpdated: new Date(Date.now() - 15 * 60000).toISOString(), 
    batteryLevel: 78,
    data: {
      isRecording: true,
      motionDetected: false,
      storageRemaining: "64%"
    }
  },
  {
    id: '2',
    name: 'Smoke Detector',
    type: 'smoke',
    status: 'online',
    location: 'Kitchen',
    lastUpdated: new Date(Date.now() - 32 * 60000).toISOString(), 
    batteryLevel: 92,
    data: {
      smokeLevel: "2%",
      temperature: "24°C",
      humidity: "45%"
    }
  },
  {
    id: '3',
    name: 'Motion Sensor',
    type: 'motion',
    status: 'online',
    location: 'Garage',
    lastUpdated: new Date(Date.now() - 5 * 60000).toISOString(), 
    batteryLevel: 65,
    data: {
      motionDetected: false,
      lightLevel: "12%",
      sensitivity: "High"
    }
  },
  {
    id: '4',
    name: 'Door Sensor',
    type: 'door',
    status: 'offline',
    location: 'Back Door',
    lastUpdated: new Date(Date.now() - 120 * 60000).toISOString(), 
    batteryLevel: 23,
    data: {
      isOpen: false,
      lastOpened: "2 days ago",
      timesOpened: 8
    }
  },
  {
    id: '5',
    name: 'Window Sensor',
    type: 'window',
    status: 'online',
    location: 'Living Room',
    lastUpdated: new Date(Date.now() - 45 * 60000).toISOString(), 
    batteryLevel: 81,
    data: {
      isOpen: false,
      lastOpened: "Yesterday",
      timesOpened: 3
    }
  },
  {
    id: '6',
    name: 'Trip Wire',
    type: 'tripwire',
    status: 'online',
    location: 'Backyard',
    lastUpdated: new Date(Date.now() - 18 * 60000).toISOString(), 
    batteryLevel: 87,
    data: {
      tripped: false,
      sensitivity: "Medium",
      lastTripped: "3 days ago"
    }
  }
];

export default function Dashboard({ navigation }) {
  const [iotDevices, setIotDevices] = useState(SAMPLE_IOT_DEVICES);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const auth = getAuth();
        const db = getDatabase();
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const snapshot = await get(userProfileRef);
        
        if (snapshot.exists()) {
          const profileData = snapshot.val();
          setUserProfile(profileData);
        }
        setLoading(false);
      } catch (error) {
        console.error('Error loading profile:', error);
        setLoading(false);
      }
    };

    loadUserProfile();
  }, []);
  const formatRelativeTime = (timestamp) => {
    const now = new Date();
    const updatedTime = new Date(timestamp);
    const diffInMinutes = Math.floor((now - updatedTime) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };
  const getDeviceIcon = (type) => {
    switch (type) {
      case 'camera':
        return 'videocam';
      case 'smoke':
        return 'flame';
      case 'motion':
        return 'walk';
      case 'door':
        return 'log-in';
      case 'window':
        return 'grid';
      case 'tripwire':
        return 'git-network';
      default:
        return 'hardware-chip';
    }
  };
  const renderDevice = ({ item }) => (
    <TouchableOpacity 
      style={[
        styles.deviceCard,
        item.status === 'offline' && styles.deviceCardOffline
      ]}
      onPress={() => {
        alert(`Details for ${item.name} would be shown here`);
      }}
    >
      <View style={styles.deviceHeader}>
        <View style={styles.deviceIconContainer}>
          <Ionicons 
            name={getDeviceIcon(item.type)} 
            size={28} 
            color={item.status === 'online' ? '#2196F3' : '#999'} 
          />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name}</Text>
          <Text style={styles.deviceLocation}>{item.location}</Text>
        </View>
        <View style={styles.deviceStatus}>
          <View style={[
            styles.statusIndicator, 
            { backgroundColor: item.status === 'online' ? '#4CAF50' : '#FF3B30' }
          ]} />
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      
      <View style={styles.deviceDetails}>
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>Battery</Text>
          <View style={styles.batteryContainer}>
            <View style={[
              styles.batteryLevel, 
              { 
                width: `${item.batteryLevel}%`,
                backgroundColor: item.batteryLevel > 20 ? '#4CAF50' : '#FF3B30' 
              }
            ]} />
          </View>
          <Text style={styles.dataValue}>{item.batteryLevel}%</Text>
        </View>
        
        {Object.entries(item.data).map(([key, value]) => (
          <View key={key} style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
            <Text style={styles.dataValue}>{value.toString()}</Text>
          </View>
        ))}
        
        <Text style={styles.lastUpdated}>
          Last updated: {formatRelativeTime(item.lastUpdated)}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>IoT Devices</Text>
        <TouchableOpacity style={styles.addButton}>
          <Ionicons name="add-circle" size={24} color="#2196F3" />
          <Text style={styles.addButtonText}>Add Device</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
          <Text style={styles.statNumber}>{iotDevices.filter(d => d.status === 'online').length}</Text>
          <Text style={styles.statLabel}>Online</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="alert-circle" size={24} color="#FF3B30" />
          <Text style={styles.statNumber}>{iotDevices.filter(d => d.status === 'offline').length}</Text>
          <Text style={styles.statLabel}>Offline</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="battery-half" size={24} color="#FF9500" />
          <Text style={styles.statNumber}>
            {iotDevices.filter(d => d.batteryLevel < 30).length}
          </Text>
          <Text style={styles.statLabel}>Low Battery</Text>
        </View>
      </View>
      
      <FlatList
        data={iotDevices}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.deviceList}
      />
      
      <Navbar activePage="dashboard" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#212121',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addButtonText: {
    color: '#2196F3',
    fontWeight: '600',
    fontSize: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 15,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 5,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
  deviceList: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 100, 
  },
  deviceCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginBottom: 15,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  deviceCardOffline: {
    opacity: 0.7,
  },
  deviceHeader: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#F8F9FA',
  },
  deviceIconContainer: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ECEFF1',
    borderRadius: 25,
  },
  deviceInfo: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'center',
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
  },
  deviceLocation: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  deviceStatus: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  statusText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  deviceDetails: {
    padding: 15,
  },
  deviceDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 5,
  },
  dataLabel: {
    fontSize: 13,
    color: '#666',
    width: '40%',
  },
  dataValue: {
    fontSize: 13,
    color: '#212121',
    fontWeight: '500',
    marginLeft: 10,
  },
  batteryContainer: {
    flex: 1,
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    overflow: 'hidden',
    marginHorizontal: 10,
  },
  batteryLevel: {
    height: '100%',
    borderRadius: 3,
  },
  lastUpdated: {
    fontSize: 12,
    color: '#999',
    marginTop: 10,
    textAlign: 'right',
    fontStyle: 'italic',
  },
}); 