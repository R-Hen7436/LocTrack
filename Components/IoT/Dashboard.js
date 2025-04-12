import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ScrollView, Alert, TextInput, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase, ref, get, onValue, set, push } from 'firebase/database';
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

// Add device types array at the top level of the component
const DEVICE_TYPES = [
  { id: 'temperature', name: 'Temperature Sensor', icon: 'thermometer' },
  { id: 'humidity', name: 'Humidity Sensor', icon: 'water' },
  { id: 'pressure', name: 'Pressure Sensor', icon: 'speedometer' },
  { id: 'motion', name: 'Motion Sensor', icon: 'walk' },
  { id: 'door', name: 'Door Sensor', icon: 'log-in' },
  { id: 'window', name: 'Window Sensor', icon: 'grid' },
  { id: 'smoke', name: 'Smoke Detector', icon: 'flame' },
  { id: 'camera', name: 'Security Camera', icon: 'videocam' },
  { id: 'tripwire', name: 'Trip Wire', icon: 'git-network' },
  { id: 'other', name: 'Other Device', icon: 'hardware-chip' }
];

export default function Dashboard({ navigation }) {
  const [iotDevices, setIotDevices] = useState(SAMPLE_IOT_DEVICES);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  
  // Form states for new device
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [deviceLocation, setDeviceLocation] = useState('');
  const [sensorValue, setSensorValue] = useState('');
  const [sensorUnit, setSensorUnit] = useState('');
  
  // Form state for updating device
  const [updateValue, setUpdateValue] = useState('');

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
          
          // Check if user is an owner and needs to set up geofence
          if (profileData.role === 'owner') {
            // First check user profile for geofence data (fastest)
            if (profileData.geofenceData && profileData.geofenceData.coordinates && 
                profileData.geofenceData.coordinates.length >= 3) {
              console.log('Owner has geofence in profile data');
            } else {
              // If not in profile, check team geofence
              if (profileData.teamCode) {
                const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
                const geofenceSnapshot = await get(teamGeofenceRef);
                
                // Only show alert if team exists but has no geofence data
                if (geofenceSnapshot.exists()) {
                  const geofenceData = geofenceSnapshot.val();
                  const hasCoordinates = geofenceData && 
                                        ((Array.isArray(geofenceData.coordinates) && geofenceData.coordinates.length >= 3) ||
                                        (Array.isArray(geofenceData) && geofenceData.length >= 3));
                  
                  if (!hasCoordinates) {
                    showGeofenceAlert(profileData.teamCode);
                  }
                } else {
                  showGeofenceAlert(profileData.teamCode);
                }
              }
            }
          }
        }
        setLoading(false);
      } catch (error) {
        console.error('Error loading profile:', error);
        setLoading(false);
      }
    };
    
    const showGeofenceAlert = (teamCode) => {
      // Only show alert if navigation is available and team code exists
      if (navigation && teamCode) {
        setTimeout(() => {
          Alert.alert(
            'Geofence Setup Required',
            'You need to set up location boundaries for your team.',
            [
              { 
                text: 'Set Up Now', 
                onPress: () => navigation.navigate('OwnerInitialization', { teamCode: teamCode })
              },
              {
                text: 'Later',
                style: 'cancel'
              }
            ]
          );
        }, 500); // Short delay to ensure UI is ready
      }
    };

    loadUserProfile();
    loadIoTDevices();
  }, [navigation]);

  const loadIoTDevices = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const db = getDatabase();
      const iotRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      
      onValue(iotRef, (snapshot) => {
        if (snapshot.exists()) {
          const deviceData = snapshot.val();
          const formattedDevices = Object.keys(deviceData).map(key => ({
            id: key,
            ...deviceData[key]
          }));
          setIotDevices(formattedDevices);
          console.log('Successfully loaded IoT devices from Firebase');
        } else {
          console.log('No IoT devices found, using sample data');
          // Keep sample data for visualization but don't write it to Firebase
        }
        setLoading(false);
      }, (error) => {
        console.error('Error in IoT devices listener:', error);
        setLoading(false);
      });
    } catch (error) {
      console.error('Error loading IoT devices:', error);
      setLoading(false);
    }
  };

  const addNewDevice = async () => {
    if (!deviceName || !deviceType) {
      Alert.alert('Error', 'Device name and type are required');
      return;
    }

    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      
      // Generate a unique ID for this device
      const timestamp = new Date().getTime();
      const randomString = Math.random().toString(36).substring(2, 8);
      const deviceId = `device_${timestamp}_${randomString}`;
      
      const db = getDatabase();
      const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${deviceId}`);
      
      const newDevice = {
        name: deviceName,
        type: deviceType.toLowerCase(),
        status: 'online',
        location: deviceLocation || 'Not specified',
        lastUpdated: new Date().toISOString(),
        batteryLevel: 100, // Start with full battery
        data: {
          value: sensorValue || '0',
          unit: sensorUnit || '',
        }
      };
      
      // Use set instead of push to avoid generating random keys that might conflict
      await set(deviceRef, newDevice);
      console.log('Successfully added new device with ID:', deviceId);
      
      // Reset form
      setDeviceName('');
      setDeviceType('');
      setDeviceLocation('');
      setSensorValue('');
      setSensorUnit('');
      
      // Close modal
      setIsAddModalVisible(false);
      
      Alert.alert('Success', 'Device added successfully');
    } catch (error) {
      console.error('Error adding device:', error);
      Alert.alert('Error', 'Failed to add device: ' + error.message);
    }
  };

  const updateDeviceValue = async () => {
    if (!selectedDevice || !selectedDevice.id) {
      Alert.alert('Error', 'No device selected');
      return;
    }
    
    if (!updateValue) {
      Alert.alert('Error', 'Please enter a value to update');
      return;
    }

    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      
      const db = getDatabase();
      const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${selectedDevice.id}`);
      
      // Get current device data
      const snapshot = await get(deviceRef);
      if (snapshot.exists()) {
        const deviceData = snapshot.val();
        
        // Update device data
        const updatedDevice = {
          ...deviceData,
          lastUpdated: new Date().toISOString(),
          data: {
            ...deviceData.data,
            value: updateValue
          }
        };
        
        await set(deviceRef, updatedDevice);
        console.log('Successfully updated device value for:', selectedDevice.name);
        
        // Reset form and close modal
        setUpdateValue('');
        setSelectedDevice(null);
        setIsUpdateModalVisible(false);
        
        Alert.alert('Success', 'Device value updated successfully');
      } else {
        Alert.alert('Error', 'Device no longer exists');
      }
    } catch (error) {
      console.error('Error updating device:', error);
      Alert.alert('Error', 'Failed to update device value: ' + error.message);
    }
  };

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
        setSelectedDevice(item);
        setIsUpdateModalVisible(true);
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
        
        {item.data && (
          <View>
            {item.data.value && (
              <View style={styles.deviceDataRow}>
                <Text style={styles.dataLabel}>Current Reading</Text>
                <Text style={styles.dataValue}>
                  {item.data.value}{item.data.unit ? ` ${item.data.unit}` : ''}
                </Text>
              </View>
            )}
            
            {Object.entries(item.data).map(([key, value]) => {
              // Skip the main value and unit which we display separately
              if (key === 'value' || key === 'unit') return null;
              
              return (
                <View key={key} style={styles.deviceDataRow}>
                  <Text style={styles.dataLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                  <Text style={styles.dataValue}>{value.toString()}</Text>
                </View>
              );
            })}
          </View>
        )}
        
        <View style={styles.deviceActions}>
          <Text style={styles.lastUpdated}>
            Last updated: {formatRelativeTime(item.lastUpdated)}
          </Text>
          
          <TouchableOpacity 
            style={styles.updateButton}
            onPress={() => {
              setSelectedDevice(item);
              setIsUpdateModalVisible(true);
            }}
          >
            <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
            <Text style={styles.updateButtonText}>Update</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  // Add Device Modal
  const renderAddDeviceModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isAddModalVisible}
      onRequestClose={() => setIsAddModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add New IoT Device</Text>
            <TouchableOpacity onPress={() => setIsAddModalVisible(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          
          <ScrollView style={styles.modalBody}>
            <Text style={styles.inputLabel}>Device Name *</Text>
            <TextInput
              style={styles.input}
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder="Enter device name"
            />
            
            <Text style={styles.inputLabel}>Device Type *</Text>
            {renderDeviceTypeSelector()}
            
            <Text style={styles.inputLabel}>Location</Text>
            <TextInput
              style={styles.input}
              value={deviceLocation}
              onChangeText={setDeviceLocation}
              placeholder="Where is this device located?"
            />
            
            <Text style={styles.inputLabel}>Sensor Value</Text>
            <TextInput
              style={styles.input}
              value={sensorValue}
              onChangeText={setSensorValue}
              placeholder="Current sensor reading"
              keyboardType="numeric"
            />
            
            <Text style={styles.inputLabel}>Unit</Text>
            <TextInput
              style={styles.input}
              value={sensorUnit}
              onChangeText={setSensorUnit}
              placeholder="e.g., °C, %, ppm"
            />
            
            <TouchableOpacity 
              style={styles.modalButton}
              onPress={addNewDevice}
            >
              <Text style={styles.modalButtonText}>Add Device</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
  
  // Update Device Modal
  const renderUpdateDeviceModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isUpdateModalVisible}
      onRequestClose={() => setIsUpdateModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Update {selectedDevice?.name || 'Device'}
            </Text>
            <TouchableOpacity onPress={() => setIsUpdateModalVisible(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalBody}>
            <Text style={styles.inputLabel}>New Value</Text>
            <TextInput
              style={styles.input}
              value={updateValue}
              onChangeText={setUpdateValue}
              placeholder="Enter new value"
              keyboardType="numeric"
            />
            
            <TouchableOpacity 
              style={styles.modalButton}
              onPress={updateDeviceValue}
            >
              <Text style={styles.modalButtonText}>Update Value</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Add renderDeviceTypeSelector function
  const renderDeviceTypeSelector = () => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      style={styles.typeSelector}
    >
      {DEVICE_TYPES.map(type => (
        <TouchableOpacity
          key={type.id}
          style={[
            styles.typeButton,
            deviceType === type.id && styles.typeButtonSelected
          ]}
          onPress={() => setDeviceType(type.id)}
        >
          <Ionicons 
            name={type.icon} 
            size={24} 
            color={deviceType === type.id ? '#FFFFFF' : '#2196F3'} 
          />
          <Text 
            style={[
              styles.typeButtonText,
              deviceType === type.id && styles.typeButtonTextSelected
            ]}
          >
            {type.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>IoT Devices</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity 
            style={styles.addButton}
            onPress={() => setIsAddModalVisible(true)}
          >
            <Ionicons name="add-circle" size={24} color="#2196F3" />
            <Text style={styles.addButtonText}>Add Device</Text>
          </TouchableOpacity>
        </View>
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
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading devices...</Text>
        </View>
      ) : iotDevices.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="hardware-chip-outline" size={80} color="#CCCCCC" />
          <Text style={styles.emptyTitle}>No IoT Devices</Text>
          <Text style={styles.emptyText}>
            You haven't added any IoT devices yet. Start by adding your first device.
          </Text>
          <TouchableOpacity 
            style={styles.emptyButton}
            onPress={() => setIsAddModalVisible(true)}
          >
            <Text style={styles.emptyButtonText}>Add Your First Device</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={iotDevices}
          renderItem={renderDevice}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.deviceList}
        />
      )}
      
      {renderAddDeviceModal()}
      {renderUpdateDeviceModal()}
      
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
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
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
    fontStyle: 'italic',
  },
  deviceActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2196F3',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '100%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212121',
  },
  modalBody: {
    padding: 15,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  modalButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  typeSelector: {
    flexDirection: 'row',
    marginVertical: 10,
  },
  typeButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginRight: 10,
    width: 100,
    height: 80,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: '#FFFFFF',
  },
  typeButtonSelected: {
    backgroundColor: '#2196F3',
  },
  typeButtonText: {
    color: '#2196F3',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
  },
  typeButtonTextSelected: {
    color: '#FFFFFF',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#212121',
    marginTop: 20,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
  },
  emptyButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
}); 