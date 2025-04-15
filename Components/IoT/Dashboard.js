import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image, ScrollView, Alert, TextInput, Modal, Switch, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase, ref, get, onValue, set, push, off } from 'firebase/database';
import Navbar from '../Navbar';
import { getAuth } from 'firebase/auth';

const SAMPLE_IOT_DEVICES = [
  {
    id: '3',
    name: 'Motion Sensor',
    type: 'motion',
    status: 'online',
    location: 'Garage',
    lastUpdated: new Date(Date.now() - 5 * 60000).toISOString(), 
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
  const [selectedDevice, setSelectedDevice] = useState(null);
  
  // Form states for new device
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [deviceLocation, setDeviceLocation] = useState('');
  const [sensorValue, setSensorValue] = useState('');
  const [sensorUnit, setSensorUnit] = useState('');
  
  // New state variables for device search and configuration
  const [deviceSearchId, setDeviceSearchId] = useState('');
  const [deviceFound, setDeviceFound] = useState(null);
  const [isSearchStep, setIsSearchStep] = useState(true);
  const [isDynamic, setIsDynamic] = useState(false);
  const [conditions, setConditions] = useState({
    type: 'static',
    minValue: '',
    maxValue: '',
    buttonActions: [],
    toggleStates: { 
      on: '', 
      off: '',
      onText: '',
      offText: ''
    },
    truefalseValue: { true: '', false: '' },
    threshold: {
      value: '',
      operator: '>', // Default operator
      action: 'alert' // Default action
    }
  });

  const [editingThreshold, setEditingThreshold] = useState(null);
  const [thresholdValue, setThresholdValue] = useState('');
  const [thresholdOperator, setThresholdOperator] = useState('>');
  const [thresholdAction, setThresholdAction] = useState('alert');
  const [isThresholdModalVisible, setIsThresholdModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState(null);
  const longPressTimer = useRef(null);

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

    // Cleanup function to remove listeners when component unmounts
    return () => {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const db = getDatabase();
      // Remove main devices listener
      const iotRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      off(iotRef);

      // Remove individual device listeners
      iotDevices.forEach(device => {
        if (device.deviceId) {
          const iotDataRef = ref(db, `IOTs/${device.deviceId}`);
          off(iotDataRef);
        }
      });
    };
  }, [navigation]);

  // Modify the loadIoTDevices function to only use isOnline from Firebase
  const loadIoTDevices = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const db = getDatabase();
      const iotRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      
      // Listen to user's registered devices
      onValue(iotRef, async (snapshot) => {
        if (snapshot.exists()) {
          const deviceData = snapshot.val();
          const formattedDevices = [];

          // For each device, set up a listener for its IOTs data
          for (const [key, device] of Object.entries(deviceData)) {
            if (device.deviceId) {
              const iotDataRef = ref(db, `IOTs/${device.deviceId}`);
              
              // Create a listener for each device's IOTs data
              onValue(iotDataRef, (iotSnapshot) => {
                if (iotSnapshot.exists()) {
                  const iotData = iotSnapshot.val();
                  
                  // Update the device in state with latest IOTs data
                  setIotDevices(currentDevices => 
                    currentDevices.map(d => 
                      d.deviceId === device.deviceId 
                        ? { 
                            ...d,
                            type: device.type,
                            data: {
                              ...iotData,
                              isOnline: iotData.isOnline || false
                            }
                          }
                        : d
                    )
                  );
                }
              }, (error) => {
                console.error(`Error in IOTs listener for device ${device.deviceId}:`, error);
              });

              // Add device to initial formatted devices array
              formattedDevices.push({
                id: key,
                deviceId: device.deviceId,
                name: device.name,
                type: device.type,
                location: device.location,
                lastUpdated: device.lastUpdated,
                isDynamic: device.isDynamic,
                conditions: device.conditions,
                data: {
                  ...device.data,
                  isOnline: device.data?.isOnline || false
                }
              });
            }
          }
          
          setIotDevices(formattedDevices);
          console.log('Successfully loaded IoT devices from Firebase');
        } else {
          console.log('No IoT devices found');
          setIotDevices([]);
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
        !item.data?.isOnline && styles.deviceCardOffline
      ]}
      onPress={() => {
        if (item.isDynamic && item.conditions?.type === 'toggle') {
          handleToggleChange(item);
        }
      }}
      onLongPress={() => handleDeviceLongPress(item)}
      delayLongPress={3000}
    >
      <View style={styles.deviceHeader}>
        <View style={styles.deviceIconContainer}>
          <Ionicons 
            name={getDeviceIcon(item.type)} 
            size={28} 
            color={item.data?.isOnline ? '#2196F3' : '#999'} 
          />
        </View>
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName}>{item.name || 'SmartLock'}</Text>
          <Text style={styles.deviceLocation}>{item.location || 'Door'}</Text>
        </View>
        <View style={styles.deviceStatus}>
          <View style={[
            styles.statusIndicator, 
            { backgroundColor: item.data?.isOnline ? '#4CAF50' : '#FF3B30' }
          ]} />
          <Text style={styles.statusText}>
            {item.data?.isOnline ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>
      
      <View style={styles.deviceDetails}>
        {/* isOnline status */}
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>isOnline</Text>
          <Text style={styles.dataValue}>{item.data?.isOnline ? 'true' : 'false'}</Text>
        </View>

        {/* Status (0/1) */}
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>Status</Text>
          <Text style={styles.dataValue}>{item.data?.Status || '0'}</Text>
        </View>

        {/* Last Status Update */}
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>lastStatusUpdate</Text>
          <Text style={styles.dataValue}>{item.data?.lastStatusUpdate || new Date().toISOString()}</Text>
        </View>

        {/* Smoke Level */}
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>Smoke Level</Text>
          <Text style={styles.dataValue}>{item.data?.smokeLevel || '0'}</Text>
        </View>

        {/* Toggle if device is dynamic */}
        {item.isDynamic && item.conditions?.type === 'toggle' && (
          <View style={styles.toggleContainer}>
            <AnimatedToggle
              value={Number(item.data?.Status) === Number(item.conditions.toggleStates.on)}
              onToggle={() => handleToggleChange(item)}
              onText={item.conditions.toggleStates.onText || 'ON'}
              offText={item.conditions.toggleStates.offText || 'OFF'}
            />
          </View>
        )}

        {/* Threshold configuration display with direct editing */}
        {item.isDynamic && item.conditions?.type === 'threshold' && (
          <View style={styles.thresholdDisplayContainer}>
            <Text style={styles.thresholdTitle}>Threshold Configuration</Text>
            <View style={styles.deviceDataRow}>
              <Text style={styles.dataLabel}>Operator</Text>
              <Text style={styles.dataValue}>{item.conditions.threshold.operator}</Text>
            </View>
            <View style={styles.deviceDataRow}>
              <Text style={styles.dataLabel}>Value</Text>
              <Text style={styles.dataValue}>{item.conditions.threshold.value}</Text>
            </View>
            <View style={styles.deviceDataRow}>
              <Text style={styles.dataLabel}>Action</Text>
              <Text style={styles.dataValue}>{item.conditions.threshold.action}</Text>
            </View>
            <TouchableOpacity 
              style={styles.editButton}
              onPress={() => handleThresholdEdit(item)}
            >
              <Ionicons name="create-outline" size={18} color="#FFFFFF" />
              <Text style={styles.editButtonText}>Edit Threshold</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.deviceActions}>
          <Text style={styles.lastUpdated}>
            Last updated: {formatRelativeTime(item.lastUpdated)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // Modify the searchDevice function
  const searchDevice = async () => {
    if (!deviceSearchId) {
      Alert.alert('Error', 'Please enter a Device ID');
      return;
    }

    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      const deviceRef = ref(db, `IOTs/${deviceSearchId}`);
      const snapshot = await get(deviceRef);

      if (snapshot.exists()) {
        const deviceData = snapshot.val();
        console.log('Found device data:', deviceData);
        setDeviceFound(deviceData);
        setDeviceName(deviceData.deviceType || 'Unknown Device');
        
        // Load existing threshold configuration if available
        if (deviceData.Operator && deviceData.Threshold !== undefined) {
          setConditions(prev => ({
            ...prev,
            type: 'threshold',
            threshold: {
              ...prev.threshold,
              operator: deviceData.Operator,
              value: deviceData.Threshold.toString()
            }
          }));
          setIsDynamic(true);
        }
      } else {
        Alert.alert('Error', 'Device not found');
      }
    } catch (error) {
      console.error('Error searching device:', error);
      Alert.alert('Error', 'Failed to search device: ' + error.message);
    }
  };

  // Modify the search step in renderAddDeviceModal to show device data
  const renderAddDeviceModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isAddModalVisible}
      onRequestClose={() => {
        setIsAddModalVisible(false);
        setIsSearchStep(true);
        setDeviceFound(null);
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {isSearchStep ? 'Search Device' : 'Configure Device'}
            </Text>
            <TouchableOpacity 
              onPress={() => {
                setIsAddModalVisible(false);
                setIsSearchStep(true);
                setDeviceFound(null);
              }}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody}>
            {isSearchStep ? (
              // Search Step
              <>
                <Text style={styles.inputLabel}>Device ID *</Text>
                <TextInput
                  style={styles.input}
                  value={deviceSearchId}
                  onChangeText={setDeviceSearchId}
                  placeholder="Enter Device ID (e.g. SL_0000)"
                />
                <TouchableOpacity 
                  style={styles.modalButton}
                  onPress={searchDevice}
                >
                  <Text style={styles.modalButtonText}>Search Device</Text>
                </TouchableOpacity>

                {deviceFound && (
                  <View style={styles.devicePreview}>
                    <Text style={styles.previewTitle}>Device Information</Text>
                    {Object.entries(deviceFound).map(([key, value]) => (
                      <View key={key} style={styles.deviceDataRow}>
                        <Text style={styles.dataLabel}>{key}:</Text>
                        <Text style={styles.dataValue}>
                          {typeof value === 'boolean' ? value.toString() : value}
                        </Text>
                      </View>
                    ))}
                    
                    <TouchableOpacity 
                      style={[styles.modalButton, { marginTop: 20 }]}
                      onPress={() => setIsSearchStep(false)}
                    >
                      <Text style={styles.modalButtonText}>Configure Device</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </>
            ) : (
              // Configuration Step
              <>
                <View style={styles.devicePreview}>
                  <Text style={styles.previewTitle}>Selected Device: {deviceSearchId}</Text>
                  <View style={styles.deviceDataRow}>
                    <Text style={styles.dataLabel}>Status:</Text>
                    <View style={styles.statusContainer}>
                      <View style={[
                        styles.statusIndicator,
                        { backgroundColor: deviceFound?.isOnline ? '#4CAF50' : '#FF3B30' }
                      ]} />
                      <Text style={[
                        styles.statusText,
                        { color: deviceFound?.isOnline ? '#4CAF50' : '#FF3B30' }
                      ]}>
                        {deviceFound?.isOnline ? 'Online' : 'Offline'}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Device Name (Auto-filled from Device Type)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: '#E8E8E8' }]}
                  value={deviceName}
                  editable={false}
                  placeholder="Device name will be set from device type"
                />

                <Text style={styles.inputLabel}>Location</Text>
                <TextInput
                  style={styles.input}
                  value={deviceLocation}
                  onChangeText={setDeviceLocation}
                  placeholder="Where is this device located?"
                />

                <View style={styles.switchContainer}>
                  <Text style={styles.inputLabel}>Dynamic Configuration</Text>
                  <Switch
                    value={isDynamic}
                    onValueChange={setIsDynamic}
                    trackColor={{ false: "#767577", true: "#81b0ff" }}
                    thumbColor={isDynamic ? "#2196F3" : "#f4f3f4"}
                  />
                </View>

                {isDynamic && (
                  <View style={styles.conditionsContainer}>
                    <Text style={styles.inputLabel}>Condition Type</Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      style={styles.conditionTypeScroll}
                    >
                      <View style={styles.conditionButtons}>
                        <TouchableOpacity
                          style={[
                            styles.conditionTypeButton,
                            conditions.type === 'static' && styles.conditionTypeButtonSelected
                          ]}
                          onPress={() => handleConditionChange('static')}
                        >
                          <Ionicons 
                            name="document-text-outline" 
                            size={24} 
                            color={conditions.type === 'static' ? '#FFFFFF' : '#2196F3'} 
                          />
                          <Text style={[
                            styles.conditionTypeText,
                            conditions.type === 'static' && styles.conditionTypeTextSelected
                          ]}>
                            Static
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.conditionTypeButton,
                            conditions.type === 'range' && styles.conditionTypeButtonSelected
                          ]}
                          onPress={() => handleConditionChange('range')}
                        >
                          <Ionicons 
                            name="options-outline" 
                            size={24} 
                            color={conditions.type === 'range' ? '#FFFFFF' : '#2196F3'} 
                          />
                          <Text style={[
                            styles.conditionTypeText,
                            conditions.type === 'range' && styles.conditionTypeTextSelected
                          ]}>
                            Range
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.conditionTypeButton,
                            conditions.type === 'toggle' && styles.conditionTypeButtonSelected
                          ]}
                          onPress={() => handleConditionChange('toggle')}
                        >
                          <Ionicons 
                            name="toggle-outline" 
                            size={24} 
                            color={conditions.type === 'toggle' ? '#FFFFFF' : '#2196F3'} 
                          />
                          <Text style={[
                            styles.conditionTypeText,
                            conditions.type === 'toggle' && styles.conditionTypeTextSelected
                          ]}>
                            Toggle
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.conditionTypeButton,
                            conditions.type === 'truefalse' && styles.conditionTypeButtonSelected
                          ]}
                          onPress={() => handleConditionChange('truefalse')}
                        >
                          <Ionicons 
                            name="git-compare-outline" 
                            size={24} 
                            color={conditions.type === 'truefalse' ? '#FFFFFF' : '#2196F3'} 
                          />
                          <Text style={[
                            styles.conditionTypeText,
                            conditions.type === 'truefalse' && styles.conditionTypeTextSelected
                          ]}>
                            True/False
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.conditionTypeButton,
                            conditions.type === 'threshold' && styles.conditionTypeButtonSelected
                          ]}
                          onPress={() => handleConditionChange('threshold')}
                        >
                          <Ionicons 
                            name="analytics-outline" 
                            size={24} 
                            color={conditions.type === 'threshold' ? '#FFFFFF' : '#2196F3'} 
                          />
                          <Text style={[
                            styles.conditionTypeText,
                            conditions.type === 'threshold' && styles.conditionTypeTextSelected
                          ]}>
                            Threshold
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </ScrollView>

                    {conditions.type === 'static' && (
                      <View style={styles.staticInfoContainer}>
                        <Text style={styles.staticInfoText}>
                          Static mode will display the raw device data without modifications
                        </Text>
                      </View>
                    )}

                    {conditions.type === 'range' && (
                      <>
                        <Text style={styles.inputLabel}>Range Values</Text>
                        <View style={styles.rangeContainer}>
                          <TextInput
                            style={[styles.input, styles.rangeInput]}
                            value={conditions.minValue}
                            onChangeText={(value) => setConditions({...conditions, minValue: value})}
                            placeholder="Min"
                            keyboardType="numeric"
                          />
                          <Text style={styles.rangeSeparator}>to</Text>
                          <TextInput
                            style={[styles.input, styles.rangeInput]}
                            value={conditions.maxValue}
                            onChangeText={(value) => setConditions({...conditions, maxValue: value})}
                            placeholder="Max"
                            keyboardType="numeric"
                          />
                        </View>
                      </>
                    )}

                    {conditions.type === 'toggle' && (
                      <>
                        <Text style={styles.inputLabel}>Toggle States</Text>
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.on}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, on: value}
                          })}
                          placeholder="On State Value ( 0 or 1 )"
                        />
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.off}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, off: value}
                          })}
                          placeholder="Off State Value ( 0 or 1 )"
                        />
                        <Text style={styles.inputLabel}>Toggle Labels</Text>
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.onText}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, onText: value}
                          })}
                          placeholder="On State Label (ON, Running, Locked)"
                        />
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.offText}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, offText: value}
                          })}
                          placeholder="Off State Label (OFF, Stopped, Unlocked)"
                        />
                      </>
                    )}

                    {conditions.type === 'truefalse' && (
                      <>
                        <Text style={styles.inputLabel}>True/False Values</Text>
                        <TextInput
                          style={styles.input}
                          value={conditions.truefalseValue.true}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            truefalseValue: {...conditions.truefalseValue, true: value}
                          })}
                          placeholder="True Value"
                        />
                        <TextInput
                          style={styles.input}
                          value={conditions.truefalseValue.false}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            truefalseValue: {...conditions.truefalseValue, false: value}
                          })}
                          placeholder="False Value"
                        />
                      </>
                    )}

                    {conditions.type === 'threshold' && (
                      <>
                        <Text style={styles.inputLabel}>Threshold Configuration</Text>
                        <View style={styles.thresholdContainer}>
                          <View style={styles.operatorContainer}>
                            <Text style={styles.inputLabel}>Operator</Text>
                            <View style={styles.operatorButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.operatorButton,
                                  conditions.threshold.operator === '>' && styles.operatorButtonSelected
                                ]}
                                onPress={() => setConditions({
                                  ...conditions,
                                  threshold: { ...conditions.threshold, operator: '>' }
                                })}
                              >
                                <Text style={[
                                  styles.operatorButtonText,
                                  conditions.threshold.operator === '>' && styles.operatorButtonTextSelected
                                ]}>Greater Than</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.operatorButton,
                                  conditions.threshold.operator === '<' && styles.operatorButtonSelected
                                ]}
                                onPress={() => setConditions({
                                  ...conditions,
                                  threshold: { ...conditions.threshold, operator: '<' }
                                })}
                              >
                                <Text style={[
                                  styles.operatorButtonText,
                                  conditions.threshold.operator === '<' && styles.operatorButtonTextSelected
                                ]}>Less Than</Text>
                              </TouchableOpacity>
                            </View>
                          </View>

                          <TextInput
                            style={styles.input}
                            value={conditions.threshold.value}
                            onChangeText={(value) => setConditions({
                              ...conditions,
                              threshold: { ...conditions.threshold, value }
                            })}
                            placeholder="Threshold Value"
                            keyboardType="numeric"
                          />

                          <View style={styles.actionContainer}>
                            <Text style={styles.inputLabel}>Action</Text>
                            <View style={styles.actionButtons}>
                              <TouchableOpacity
                                style={[
                                  styles.actionButton,
                                  conditions.threshold.action === 'alert' && styles.actionButtonSelected
                                ]}
                                onPress={() => setConditions({
                                  ...conditions,
                                  threshold: { ...conditions.threshold, action: 'alert' }
                                })}
                              >
                                <Text style={[
                                  styles.actionButtonText,
                                  conditions.threshold.action === 'alert' && styles.actionButtonTextSelected
                                ]}>Alert</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.actionButton,
                                  conditions.threshold.action === 'notify' && styles.actionButtonSelected
                                ]}
                                onPress={() => setConditions({
                                  ...conditions,
                                  threshold: { ...conditions.threshold, action: 'notify' }
                                })}
                              >
                                <Text style={[
                                  styles.actionButtonText,
                                  conditions.threshold.action === 'notify' && styles.actionButtonTextSelected
                                ]}>Notify</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>
                      </>
                    )}
                  </View>
                )}

                <TouchableOpacity 
                  style={styles.modalButton}
                  onPress={saveDeviceWithConditions}
                >
                  <Text style={styles.modalButtonText}>Add Device</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
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

  // Modify handleConditionChange function
  const handleConditionChange = (type) => {
    setConditions({
      type,
      minValue: '',
      maxValue: '',
      buttonActions: [],
      toggleStates: { 
        on: '', 
        off: '',
        onText: '',
        offText: ''
      },
      truefalseValue: { true: '', false: '' },
      threshold: {
        value: '',
        operator: '>', // Default operator
        action: 'alert' // Default action
      }
    });
  };

  // Modify handleToggleChange function to preserve isOnline status
  const handleToggleChange = async (device) => {
    if (!device.isDynamic || !device.conditions || device.conditions.type !== 'toggle') {
      return;
    }

    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      const deviceStatusRef = ref(db, `IOTs/${device.deviceId}/Status`);
      
      // Get current status
      const snapshot = await get(deviceStatusRef);
      const currentStatus = snapshot.exists() ? Number(snapshot.val()) : 1;
      
      // Determine new status based on current value
      const { on, off } = device.conditions.toggleStates;
      const onValue = Number(on);
      const offValue = Number(off);
      const newStatus = currentStatus === onValue ? offValue : onValue;
      
      // Update the status in Firebase while preserving isOnline
      const deviceRef = ref(db, `IOTs/${device.deviceId}`);
      const deviceSnapshot = await get(deviceRef);
      if (deviceSnapshot.exists()) {
        const currentData = deviceSnapshot.val();
        await set(deviceRef, {
          ...currentData,
          Status: newStatus,
          isOnline: currentData.isOnline // Preserve the isOnline status
        });
      } else {
        await set(deviceStatusRef, newStatus);
      }
      
      console.log('Successfully toggled device status:', newStatus);
    } catch (error) {
      console.error('Error toggling device:', error);
      Alert.alert('Error', 'Failed to toggle device status: ' + error.message);
    }
  };

  // Add a function to handle long press for device deletion
  const handleDeviceLongPress = (device) => {
    setDeviceToDelete(device);
    setIsDeleteModalVisible(true);
  };

  // Add a function to handle device deletion
  const deleteDevice = async () => {
    if (!deviceToDelete) return;
    
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      
      // Delete from user's devices
      const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${deviceToDelete.deviceId}`);
      await set(deviceRef, null);
      
      // If it's a threshold device, we don't delete from IOTs collection
      // as other users might be using the same device
      
      setIsDeleteModalVisible(false);
      setDeviceToDelete(null);
      Alert.alert('Success', 'Device deleted successfully');
    } catch (error) {
      console.error('Error deleting device:', error);
      Alert.alert('Error', 'Failed to delete device: ' + error.message);
    }
  };

  // Add a function to handle threshold editing
  const handleThresholdEdit = (device) => {
    setEditingThreshold(device);
    setThresholdValue(device.conditions.threshold.value);
    setThresholdOperator(device.conditions.threshold.operator);
    setThresholdAction(device.conditions.threshold.action);
    setIsThresholdModalVisible(true);
  };

  // Add a function to save threshold changes
  const saveThresholdChanges = async () => {
    if (!editingThreshold) return;
    
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      
      // Update the device in user's devices
      const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${editingThreshold.deviceId}`);
      const deviceSnapshot = await get(deviceRef);
      
      if (deviceSnapshot.exists()) {
        const deviceData = deviceSnapshot.val();
        const updatedDevice = {
          ...deviceData,
          conditions: {
            ...deviceData.conditions,
            threshold: {
              operator: thresholdOperator,
              value: thresholdValue,
              action: thresholdAction
            }
          }
        };
        
        await set(deviceRef, updatedDevice);
      }
      
      // Update the threshold in IOTs collection
      const iotRef = ref(db, `IOTs/${editingThreshold.deviceId}`);
      const iotSnapshot = await get(iotRef);
      
      if (iotSnapshot.exists()) {
        const iotData = iotSnapshot.val();
        await set(iotRef, {
          ...iotData,
          Operator: thresholdOperator,
          Threshold: Number(thresholdValue) || 0
        });
      }
      
      setIsThresholdModalVisible(false);
      setEditingThreshold(null);
      Alert.alert('Success', 'Threshold updated successfully');
    } catch (error) {
      console.error('Error updating threshold:', error);
      Alert.alert('Error', 'Failed to update threshold: ' + error.message);
    }
  };

  // Add new animated toggle component
  const AnimatedToggle = ({ value, onToggle, size = 28, onText = '', offText = '' }) => {
    const translation = useRef(new Animated.Value(value ? size : 0)).current;

    useEffect(() => {
      Animated.spring(translation, {
        toValue: value ? size : 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    }, [value, size]);

    return (
      <View style={styles.toggleWrapper}>
        <Text style={styles.toggleLabel}>
          {value ? (onText || 'ON') : (offText || 'OFF')}
        </Text>
        <Pressable
          onPress={onToggle}
          style={[
            styles.toggleTrack,
            {
              width: size * 2,
              height: size + 4,
              backgroundColor: value ? '#4CAF50' : '#FF3B30',
            },
          ]}
        >
          <Animated.View
            style={[
              styles.toggleThumb,
              {
                width: size - 4,
                height: size - 4,
                transform: [{ translateX: translation }],
              },
            ]}
          />
        </Pressable>
      </View>
    );
  };

  // Add a render function for the threshold edit modal
  const renderThresholdEditModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isThresholdModalVisible}
      onRequestClose={() => setIsThresholdModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Threshold</Text>
            <TouchableOpacity 
              onPress={() => setIsThresholdModalVisible(false)}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.inputLabel}>Operator</Text>
            <View style={styles.operatorButtons}>
              <TouchableOpacity
                style={[
                  styles.operatorButton,
                  thresholdOperator === '>' && styles.operatorButtonSelected
                ]}
                onPress={() => setThresholdOperator('>')}
              >
                <Text style={[
                  styles.operatorButtonText,
                  thresholdOperator === '>' && styles.operatorButtonTextSelected
                ]}>Greater Than</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.operatorButton,
                  thresholdOperator === '<' && styles.operatorButtonSelected
                ]}
                onPress={() => setThresholdOperator('<')}
              >
                <Text style={[
                  styles.operatorButtonText,
                  thresholdOperator === '<' && styles.operatorButtonTextSelected
                ]}>Less Than</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Threshold Value</Text>
            <TextInput
              style={styles.input}
              value={thresholdValue}
              onChangeText={setThresholdValue}
              placeholder="Enter threshold value"
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Action</Text>
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  thresholdAction === 'alert' && styles.actionButtonSelected
                ]}
                onPress={() => setThresholdAction('alert')}
              >
                <Text style={[
                  styles.actionButtonText,
                  thresholdAction === 'alert' && styles.actionButtonTextSelected
                ]}>Alert</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  thresholdAction === 'notify' && styles.actionButtonSelected
                ]}
                onPress={() => setThresholdAction('notify')}
              >
                <Text style={[
                  styles.actionButtonText,
                  thresholdAction === 'notify' && styles.actionButtonTextSelected
                ]}>Notify</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={styles.modalButton}
              onPress={saveThresholdChanges}
            >
              <Text style={styles.modalButtonText}>Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Add a render function for the delete confirmation modal
  const renderDeleteConfirmationModal = () => (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isDeleteModalVisible}
      onRequestClose={() => setIsDeleteModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Delete Device</Text>
            <TouchableOpacity 
              onPress={() => setIsDeleteModalVisible(false)}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.modalBody}>
            <Text style={styles.deleteConfirmationText}>
              Are you sure you want to delete this device?
            </Text>
            <Text style={styles.deviceNameText}>
              {deviceToDelete?.name || 'Unknown Device'}
            </Text>
            <Text style={styles.deviceIdText}>
              ID: {deviceToDelete?.deviceId || 'Unknown'}
            </Text>
            
            <View style={styles.deleteModalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsDeleteModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.deleteButton]}
                onPress={deleteDevice}
              >
                <Text style={styles.modalButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
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
          <Text style={styles.statNumber}>
            {iotDevices.filter(d => d.data?.isOnline === true).length}
          </Text>
          <Text style={styles.statLabel}>Online</Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="alert-circle" size={24} color="#FF3B30" />
          <Text style={styles.statNumber}>
            {iotDevices.filter(d => d.data?.isOnline === false).length}
          </Text>
          <Text style={styles.statLabel}>Offline</Text>
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
      {renderThresholdEditModal()}
      {renderDeleteConfirmationModal()}
      
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
    justifyContent: 'space-around',
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
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  dataLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  dataValue: {
    fontSize: 14,
    color: '#212121',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
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
  switchContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
  },
  conditionsContainer: {
    marginTop: 15,
  },
  conditionTypeScroll: {
    marginVertical: 10,
  },
  conditionButtons: {
    flexDirection: 'row',
    paddingHorizontal: 5,
  },
  conditionTypeButton: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    marginHorizontal: 5,
    width: 100,
    height: 100,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2196F3',
    backgroundColor: '#FFFFFF',
  },
  conditionTypeButtonSelected: {
    backgroundColor: '#2196F3',
  },
  conditionTypeText: {
    color: '#2196F3',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  conditionTypeTextSelected: {
    color: '#FFFFFF',
  },
  rangeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  rangeInput: {
    flex: 1,
  },
  rangeSeparator: {
    marginHorizontal: 10,
  },
  devicePreview: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 10,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  staticInfoContainer: {
    padding: 15,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    marginTop: 15,
  },
  staticInfoText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  toggleContainer: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    alignItems: 'center',
  },
  toggleWrapper: {
    alignItems: 'center',
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 10,
  },
  toggleTrack: {
    borderRadius: 34,
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    backgroundColor: '#FFF',
    borderRadius: 50,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  thresholdContainer: {
    marginTop: 10,
  },
  operatorContainer: {
    marginBottom: 15,
  },
  operatorButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  operatorButton: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  operatorButtonSelected: {
    backgroundColor: '#2196F3',
  },
  operatorButtonText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  operatorButtonTextSelected: {
    color: '#FFFFFF',
  },
  actionContainer: {
    marginTop: 15,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  actionButton: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  actionButtonSelected: {
    backgroundColor: '#2196F3',
  },
  actionButtonText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  actionButtonTextSelected: {
    color: '#FFFFFF',
  },
  thresholdDisplayContainer: {
    marginTop: 15,
    padding: 15,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  thresholdTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 10,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2196F3',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginTop: 10,
  },
  editButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  deleteConfirmationText: {
    fontSize: 16,
    color: '#212121',
    textAlign: 'center',
    marginBottom: 10,
  },
  deviceNameText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#212121',
    textAlign: 'center',
    marginBottom: 5,
  },
  deviceIdText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  deleteModalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  cancelButton: {
    backgroundColor: '#9E9E9E',
    flex: 1,
    marginRight: 10,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    flex: 1,
    marginLeft: 10,
  },
}); 