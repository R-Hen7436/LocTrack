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
  const [personCount, setPersonCount] = useState(0);
  
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
      operator: '>' // Default operator
    }
  });

  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deviceToDelete, setDeviceToDelete] = useState(null);
  const longPressTimer = useRef(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const auth = getAuth();
        if (!auth.currentUser) return;
        
        const db = getDatabase();
        
        // Load user profile
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const profileSnapshot = await get(userProfileRef);
        
        if (profileSnapshot.exists()) {
          const profileData = profileSnapshot.val();
          setUserProfile(profileData);
          
          // Handle geofence checks for owner
          if (profileData.role === 'owner') {
            handleGeofenceCheck(profileData);
          }
        }

        // Set up real-time listener for camera analytics
        const cameraAnalyticsRef = ref(db, `cameraAnalytics/history`);
        console.log('Setting up camera analytics listener...'); // Debug initial setup
        const unsubscribeCamera = onValue(cameraAnalyticsRef, (snapshot) => {
          console.log('Camera analytics snapshot received'); // Debug listener trigger
          if (snapshot.exists()) {
            const analyticsData = snapshot.val();
            console.log('Raw camera analytics data:', JSON.stringify(analyticsData, null, 2));
            
            let count = 0;
            if (typeof analyticsData === 'object' && analyticsData.latest) {
              // Get count from the latest entry
              count = analyticsData.latest.count;
              console.log('Latest count value:', count);
            }
            
            console.log('Final count value:', count);
            setPersonCount(count !== undefined ? Number(count) : 0);
          } else {
            console.log('No camera analytics data exists in Firebase');
            setPersonCount(0);
          }
        }, (error) => {
          console.error('Error in camera analytics listener:', error);
        });

        // Set up real-time listener for IoT devices
        const iotRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
        const unsubscribeDevices = onValue(iotRef, async (snapshot) => {
          if (snapshot.exists()) {
            const deviceData = snapshot.val();
            const formattedDevices = [];

            // Process each device and set up individual listeners
            for (const [key, device] of Object.entries(deviceData)) {
              if (device.deviceId) {
                // Get initial IOT data
                const iotDataRef = ref(db, `IOTs/${device.deviceId}`);
                const iotSnapshot = await get(iotDataRef);
                
                const formattedDevice = {
                  id: key,
                  deviceId: device.deviceId,
                  name: device.name,
                  type: device.type,
                  location: device.location,
                  lastUpdated: device.lastUpdated,
                  isDynamic: device.isDynamic,
                  conditions: device.conditions,
                  data: {
                    ...(iotSnapshot.exists() ? iotSnapshot.val() : {}),
                    isOnline: iotSnapshot.exists() ? iotSnapshot.val().isOnline : false
                  }
                };

                formattedDevices.push(formattedDevice);

                // Set up real-time listener for each IOT device
                onValue(iotDataRef, (iotDataSnapshot) => {
                  if (iotDataSnapshot.exists()) {
                    const iotData = iotDataSnapshot.val();
                    setIotDevices(currentDevices => 
                      currentDevices.map(d => 
                        d.deviceId === device.deviceId 
                          ? {
                              ...d,
                              data: {
                                ...iotData,
                                isOnline: iotData.isOnline || false
                              }
                            }
                          : d
                      )
                    );
                  }
                });
              }
            }

            setIotDevices(formattedDevices);
          } else {
            setIotDevices([]);
          }
          setLoading(false);
        });

        // Cleanup function
        return () => {
          if (unsubscribeDevices && typeof unsubscribeDevices === 'function') {
            unsubscribeDevices();
          }
          if (unsubscribeCamera && typeof unsubscribeCamera === 'function') {
            unsubscribeCamera();
          }
          // Clean up individual IOT listeners
          const db = getDatabase();
          iotDevices.forEach(device => {
            if (device.deviceId) {
              const iotRef = ref(db, `IOTs/${device.deviceId}`);
              off(iotRef);
            }
          });
        };
      } catch (error) {
        console.error('Error loading data:', error);
        setLoading(false);
      }
    };

    const handleGeofenceCheck = async (profileData) => {
      if (profileData.geofenceData && 
          profileData.geofenceData.coordinates && 
          profileData.geofenceData.coordinates.length >= 3) {
        return;
      }

      if (profileData.teamCode) {
        const db = getDatabase();
        const teamGeofenceRef = ref(db, `teams/${profileData.teamCode}/geofence`);
        const geofenceSnapshot = await get(teamGeofenceRef);
        
        if (!geofenceSnapshot.exists() || !hasValidCoordinates(geofenceSnapshot.val())) {
          showGeofenceAlert(profileData.teamCode);
        }
      }
    };

    const hasValidCoordinates = (geofenceData) => {
      return geofenceData && 
        ((Array.isArray(geofenceData.coordinates) && geofenceData.coordinates.length >= 3) ||
         (Array.isArray(geofenceData) && geofenceData.length >= 3));
    };

    const showGeofenceAlert = (teamCode) => {
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
        }, 500);
      }
    };

    // Start loading data
    const unsubscribe = loadData();

    // Cleanup on unmount
    return () => {
      if (unsubscribe && typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigation]);

  const loadIoTDevices = () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;
      
      const db = getDatabase();
      const iotRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      
      // Store all active listeners
      const listeners = new Map();
      
      // Main devices listener
      const devicesUnsubscribe = onValue(iotRef, async (snapshot) => {
        if (snapshot.exists()) {
          const deviceData = snapshot.val();
          const deviceMap = new Map();

          // Remove old listeners that are no longer needed
          const currentDeviceIds = Object.values(deviceData).map(device => device.deviceId);
          for (const [deviceId, unsubscribe] of listeners.entries()) {
            if (!currentDeviceIds.includes(deviceId)) {
              unsubscribe();
              listeners.delete(deviceId);
            }
          }

          // For each device, set up or maintain a listener for its IOTs data
          for (const [key, device] of Object.entries(deviceData)) {
            if (device.deviceId && !listeners.has(device.deviceId)) {
              const iotDataRef = ref(db, `IOTs/${device.deviceId}`);
              
              // Create a listener for each device's IOTs data
              const iotUnsubscribe = onValue(iotDataRef, (iotSnapshot) => {
                if (iotSnapshot.exists()) {
                  const iotData = iotSnapshot.val();
                  
                  // Update the device in state with latest IOTs data
                  setIotDevices(currentDevices => {
                    const deviceIndex = currentDevices.findIndex(d => d.deviceId === device.deviceId);
                    if (deviceIndex === -1) {
                      // Device not in state yet, add it
                      return [...currentDevices, {
                        id: key,
                        deviceId: device.deviceId,
                        name: device.name,
                        type: device.type,
                        location: device.location,
                        lastUpdated: device.lastUpdated,
                        isDynamic: device.isDynamic,
                        conditions: device.conditions,
                        data: {
                          ...iotData,
                          isOnline: iotData.isOnline || false
                        }
                      }];
                    } else {
                      // Update existing device
                      const updatedDevices = [...currentDevices];
                      updatedDevices[deviceIndex] = {
                        ...updatedDevices[deviceIndex],
                        data: {
                          ...iotData,
                          isOnline: iotData.isOnline || false
                        }
                      };
                      return updatedDevices;
                    }
                  });
                }
              }, (error) => {
                console.error(`Error in IOTs listener for device ${device.deviceId}:`, error);
              });

              // Store the unsubscribe function
              listeners.set(device.deviceId, iotUnsubscribe);
            }

            // Store the latest version of each device
            if (!deviceMap.has(device.deviceId) || 
                new Date(device.lastUpdated) > new Date(deviceMap.get(device.deviceId).lastUpdated)) {
              deviceMap.set(device.deviceId, {
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
          
          // Set initial state with latest device data
          const uniqueDevices = Array.from(deviceMap.values());
          setIotDevices(uniqueDevices);
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

      // Return a cleanup function that removes all listeners
      return () => {
        if (devicesUnsubscribe && typeof devicesUnsubscribe === 'function') {
          devicesUnsubscribe();
        }
        for (const unsubscribe of listeners.values()) {
          if (unsubscribe && typeof unsubscribe === 'function') {
            unsubscribe();
          }
        }
      };
    } catch (error) {
      console.error('Error loading IoT devices:', error);
      setLoading(false);
      return () => {}; // Return empty cleanup function in case of error
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

  const renderDeviceContent = (item) => {
    // Helper function to render device details based on type
    if (item.data?.Status !== undefined) {
      // Device with Status field
      return (
        <>
          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Status</Text>
            <Text style={styles.dataValue}>
              {item.data.Status === '1' ? <Text>Door Locked</Text> : <Text>Door Unlocked</Text>}
            </Text>
          </View>

          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Last Status Update</Text>
            <Text style={styles.dataValue}>
              {item.data.lastStatusUpdate || 'Not available'}
            </Text>
          </View>
        </>
      );
    } else if (item.data?.Threshold !== undefined) {
      // Device with Threshold field
      return (
        <>
          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Operator</Text>
            <Text style={styles.dataValue}>
              {item.data.Operator || '>'}
            </Text>
          </View>

          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Environment</Text>
            <Text style={styles.dataValue}>
              {item.data.Environment || 'Not set'}
            </Text>
          </View>

          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Threshold</Text>
            <Text style={styles.dataValue}>
              {item.data.Threshold}
            </Text>
          </View>

          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Last Status Update</Text>
            <Text style={styles.dataValue}>
              {item.data.lastStatusUpdate || 'Not available'}
            </Text>
          </View>
        </>
      );
    } else if (item.data?.Readings !== undefined) {
      // Device with Readings field
      return (
        <>
          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Readings</Text>
            <Text style={styles.dataValue}>
              {item.data.Readings}
            </Text>
          </View>

          <View style={styles.deviceDataRow}>
            <Text style={styles.dataLabel}>Last Status Update</Text>
            <Text style={styles.dataValue}>
              {item.data.lastStatusUpdate || 'Not available'}
            </Text>
          </View>
        </>
      );
    } else {
      // Default/fallback content
      return (
        <View style={styles.deviceDataRow}>
          <Text style={styles.dataLabel}>Status</Text>
          <Text style={styles.dataValue}>No data available</Text>
        </View>
      );
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
          <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
          <Text style={styles.deviceLocation}>{item.location || 'No Location'}</Text>
        </View>
        <View style={styles.deviceStatus}>
          <View style={[
            styles.statusIndicator, 
            { backgroundColor: item.data?.isOnline ? '#4CAF50' : '#FF3B30' }
          ]} />
          <Text style={styles.statusText}>
            {item.data?.isOnline ? <Text>Online</Text> : <Text>Offline</Text>}
          </Text>
        </View>
      </View>
      
      <View style={styles.deviceDetails}>
        {renderDeviceContent(item)}

        {/* Toggle if device is dynamic and has toggle type */}
        {item.isDynamic && item.conditions?.type === 'toggle' && (
          <View style={styles.toggleContainer}>
            <TouchableOpacity onPress={() => handleToggleChange(item)} activeOpacity={0.8}>
              <View style={[styles.toggleBackground, { backgroundColor: item.data?.Status === '1' ? '#4CAF50' : '#FF3B30' }]}>
                <Text style={styles.toggleText}>
                  {item.data?.Status === '1' ? item.conditions.toggleStates.onText || 'ON' : item.conditions.toggleStates.offText || 'OFF'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Threshold configuration edit button */}
        {item.isDynamic && item.conditions?.type === 'threshold' && !item.isEditing && (
          <TouchableOpacity 
            style={styles.editButton}
            onPress={() => handleThresholdEdit(item)}
          >
            <Ionicons name="create-outline" size={18} color="#FFFFFF" />
            <Text style={styles.editButtonText}>Edit Threshold</Text>
          </TouchableOpacity>
        )}

        {/* Threshold inline editing interface */}
        {item.isDynamic && item.conditions?.type === 'threshold' && item.isEditing && (
          <View style={styles.inlineEditContainer}>
            <View style={styles.operatorRow}>
              <Text style={styles.inlineEditLabel}>Operator:</Text>
              <View style={styles.operatorInlineButtons}>
                <TouchableOpacity
                  style={[
                    styles.operatorInlineButton,
                    item.conditions.threshold.operator === '>' && styles.operatorInlineButtonSelected
                  ]}
                  onPress={() => {
                    setIotDevices(currentDevices => 
                      currentDevices.map(d => 
                        d.id === item.id ? { 
                          ...d, 
                          conditions: {
                            ...d.conditions,
                            threshold: {
                              ...d.conditions.threshold,
                              operator: '>'
                            }
                          }
                        } : d
                      )
                    );
                  }}
                >
                  <Text style={[
                    styles.operatorInlineButtonText,
                    item.conditions.threshold.operator === '>' && styles.operatorInlineButtonTextSelected
                  ]}>{'>'}</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.operatorInlineButton,
                    item.conditions.threshold.operator === '<' && styles.operatorInlineButtonSelected
                  ]}
                  onPress={() => {
                    setIotDevices(currentDevices => 
                      currentDevices.map(d => 
                        d.id === item.id ? { 
                          ...d, 
                          conditions: {
                            ...d.conditions,
                            threshold: {
                              ...d.conditions.threshold,
                              operator: '<'
                            }
                          }
                        } : d
                      )
                    );
                  }}
                >
                  <Text style={[
                    styles.operatorInlineButtonText,
                    item.conditions.threshold.operator === '<' && styles.operatorInlineButtonTextSelected
                  ]}>{'<'}</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.valueRow}>
              <Text style={styles.inlineEditLabel}>Value:</Text>
              <View style={styles.valueControls}>
                <TouchableOpacity
                  style={styles.valueButton}
                  onPress={() => {
                    const currentValue = Number(item.conditions.threshold.value) || 0;
                    const newValue = Math.max(0, currentValue - 1).toString();
                    
                    setIotDevices(currentDevices => 
                      currentDevices.map(d => 
                        d.id === item.id ? { 
                          ...d, 
                          conditions: {
                            ...d.conditions,
                            threshold: {
                              ...d.conditions.threshold,
                              value: newValue
                            }
                          }
                        } : d
                      )
                    );
                  }}
                >
                  <Ionicons name="remove-circle" size={28} color="#2196F3" />
                </TouchableOpacity>
                
                <TextInput
                  style={styles.valueDisplayInput}
                  value={item.conditions.threshold.value || '0'}
                  onChangeText={(newValue) => {
                    // Only allow numeric input
                    if (/^\d*$/.test(newValue)) {
                      setIotDevices(currentDevices => 
                        currentDevices.map(d => 
                          d.id === item.id ? { 
                            ...d, 
                            conditions: {
                              ...d.conditions,
                              threshold: {
                                ...d.conditions.threshold,
                                value: newValue
                              }
                            }
                          } : d
                        )
                      );
                    }
                  }}
                  keyboardType="numeric"
                />
                
                <TouchableOpacity
                  style={styles.valueButton}
                  onPress={() => {
                    const currentValue = Number(item.conditions.threshold.value) || 0;
                    const newValue = (currentValue + 1).toString();
                    
                    setIotDevices(currentDevices => 
                      currentDevices.map(d => 
                        d.id === item.id ? { 
                          ...d, 
                          conditions: {
                            ...d.conditions,
                            threshold: {
                              ...d.conditions.threshold,
                              value: newValue
                            }
                          }
                        } : d
                      )
                    );
                  }}
                >
                  <Ionicons name="add-circle" size={28} color="#2196F3" />
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.inlineButtonsRow}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => {
                  setIotDevices(currentDevices => 
                    currentDevices.map(d => 
                      d.id === item.id ? { ...d, isEditing: false } : d
                    )
                  );
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={() => {
                  saveThresholdChanges(
                    item, 
                    item.conditions.threshold.operator,
                    item.conditions.threshold.value
                  );
                }}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.deviceActions}>
          <Text style={styles.lastUpdated}>
            Last updated: {formatRelativeTime(item.lastUpdated)}
          </Text>
          <Text style={styles.deleteHint}>
            <Ionicons name="trash-outline" size={12} color="#999" /> Long-press for 3 seconds to delete
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
          setIsDynamic(true);
        
        // Check if device has a Readings field first
        if ('Readings' in deviceData) {
          setConditions({
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
              operator: '>', 
              action: 'alert'
            }
          });
        }
        // Then check if device has a Threshold field
        else if ('Threshold' in deviceData) {
          setConditions({
            type: 'threshold',
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
              value: deviceData.Threshold.toString(),
              operator: deviceData.Operator || '>', 
              action: 'alert'
            }
          });
        }
        // Then check for LockStatus or Status
        else if ('LockStatus' in deviceData || 'Status' in deviceData) {
          setConditions({
            type: 'toggle',
            minValue: '',
            maxValue: '',
            buttonActions: [],
            toggleStates: { 
              on: '1', 
              off: '0',
              onText: 'LockStatus' in deviceData ? 'Locked' : 'ON',
              offText: 'LockStatus' in deviceData ? 'Unlocked' : 'OFF'
            },
            truefalseValue: { true: '', false: '' },
            threshold: {
              value: '',
              operator: '>'
            }
          });
        }
      } else {
        Alert.alert('Error', 'Device not found');
      }
    } catch (error) {
      console.error('Error searching device:', error);
      Alert.alert('Error', 'Failed to search device: ' + error.message);
    }
  };

  // Modify the saveThresholdChanges function to work with inline editing
  const saveThresholdChanges = async (device, newOperator, newValue) => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      
      // Update the device in user's devices
      const userDevicesRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      const snapshot = await get(userDevicesRef);
      
      if (snapshot.exists()) {
        const userDevices = snapshot.val();
        
        // Find the key for the device
        let deviceKey = null;
        Object.entries(userDevices).forEach(([key, value]) => {
          if ((value.id === device.id) || 
              (value.deviceId === device.deviceId) || 
              (JSON.stringify(value) === JSON.stringify(device))) {
            deviceKey = key;
          }
        });
        
        if (deviceKey) {
          const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${deviceKey}`);
          const deviceSnapshot = await get(deviceRef);
          
          if (deviceSnapshot.exists()) {
            const deviceData = deviceSnapshot.val();
            const updatedDevice = {
              ...deviceData,
              conditions: {
                ...deviceData.conditions,
                threshold: {
                  operator: newOperator,
                  value: newValue
                }
              }
            };
            
            await set(deviceRef, updatedDevice);
          }
        }
      }
      
      // Update the threshold in IOTs collection
      const iotRef = ref(db, `IOTs/${device.deviceId}`);
      const iotSnapshot = await get(iotRef);
      
      if (iotSnapshot.exists()) {
        const iotData = iotSnapshot.val();
        await set(iotRef, {
          ...iotData,
          Operator: newOperator,
          Threshold: Number(newValue) || 0
        });
      }
      
      // Update the local state and exit edit mode
      setIotDevices(currentDevices => 
        currentDevices.map(d => 
          d.id === device.id ? { 
            ...d, 
            isEditing: false,
            conditions: {
              ...d.conditions,
              threshold: {
                ...d.conditions.threshold,
                operator: newOperator,
                value: newValue
              }
            }
          } : d
        )
      );
      
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
      <View style={styles.toggleContainer}>
        <TouchableOpacity onPress={onToggle} activeOpacity={0.8}>
          <View style={[styles.toggleBackground, { backgroundColor: value ? '#4CAF50' : '#FF3B30' }]}>
            <Text style={styles.toggleText}>
              {value ? onText || 'ON' : offText || 'OFF'}
            </Text>
          </View>
        </TouchableOpacity>
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
        <View style={[styles.modalContent, styles.thresholdModalContent]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Threshold Configuration</Text>
            <TouchableOpacity 
              onPress={() => setIsThresholdModalVisible(false)}
            >
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.thresholdModalBody}>
            <View style={styles.thresholdEditSection}>
              <Text style={styles.thresholdEditLabel}>Select Operator</Text>
              <View style={styles.operatorButtonsContainer}>
                <TouchableOpacity
                  style={[
                    styles.operatorButtonNew,
                    thresholdOperator === '>' && styles.operatorButtonNewSelected
                  ]}
                  onPress={() => setThresholdOperator('>')}
                >
                  <Ionicons 
                    name="arrow-up" 
                    size={22} 
                    color={thresholdOperator === '>' ? '#FFFFFF' : '#2196F3'} 
                  />
                  <Text style={[
                    styles.operatorButtonNewText,
                    thresholdOperator === '>' && styles.operatorButtonNewTextSelected
                  ]}>Greater Than</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.operatorButtonNew,
                    thresholdOperator === '<' && styles.operatorButtonNewSelected
                  ]}
                  onPress={() => setThresholdOperator('<')}
                >
                  <Ionicons 
                    name="arrow-down" 
                    size={22} 
                    color={thresholdOperator === '<' ? '#FFFFFF' : '#2196F3'} 
                  />
                  <Text style={[
                    styles.operatorButtonNewText,
                    thresholdOperator === '<' && styles.operatorButtonNewTextSelected
                  ]}>Less Than</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.thresholdEditSection}>
              <Text style={styles.thresholdEditLabel}>Threshold Value</Text>
              <View style={styles.thresholdValueContainer}>
                <View style={styles.thresholdInputWrapper}>
                  <TextInput
                    style={styles.thresholdValueInput}
                    value={thresholdValue}
                    onChangeText={setThresholdValue}
                    placeholder="Enter value"
                    keyboardType="numeric"
                  />
                </View>
                
                <View style={styles.thresholdValueButtons}>
                  <TouchableOpacity 
                    style={styles.thresholdValueButton}
                    onPress={() => {
                      const currentValue = Number(thresholdValue) || 0;
                      setThresholdValue((currentValue + 1).toString());
                    }}
                  >
                    <Ionicons name="add" size={24} color="#2196F3" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={styles.thresholdValueButton}
                    onPress={() => {
                      const currentValue = Number(thresholdValue) || 0;
                      setThresholdValue(Math.max(0, currentValue - 1).toString());
                    }}
                  >
                    <Ionicons name="remove" size={24} color="#2196F3" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={styles.thresholdEditSection}>
              <Text style={styles.thresholdEditLabel}>Action When Triggered</Text>
              <View style={styles.actionButtonsNew}>
                <TouchableOpacity
                  style={[
                    styles.actionButtonNew,
                    thresholdAction === 'alert' && styles.actionButtonNewSelected
                  ]}
                  onPress={() => setThresholdAction('alert')}
                >
                  <Ionicons 
                    name="warning-outline" 
                    size={22} 
                    color={thresholdAction === 'alert' ? '#FFFFFF' : '#2196F3'} 
                  />
                  <Text style={[
                    styles.actionButtonNewText,
                    thresholdAction === 'alert' && styles.actionButtonNewTextSelected
                  ]}>Alert</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[
                    styles.actionButtonNew,
                    thresholdAction === 'notify' && styles.actionButtonNewSelected
                  ]}
                  onPress={() => setThresholdAction('notify')}
                >
                  <Ionicons 
                    name="notifications-outline" 
                    size={22} 
                    color={thresholdAction === 'notify' ? '#FFFFFF' : '#2196F3'} 
                  />
                  <Text style={[
                    styles.actionButtonNewText,
                    thresholdAction === 'notify' && styles.actionButtonNewTextSelected
                  ]}>Notify</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.thresholdSummary}>
              <Text style={styles.thresholdSummaryTitle}>Configuration Summary</Text>
              <Text style={styles.thresholdSummaryText}>
                When value is <Text style={styles.thresholdHighlight}>{thresholdOperator}</Text> than{' '}
                <Text style={styles.thresholdHighlight}>{thresholdValue || '0'}</Text>
              </Text>
            </View>

            <TouchableOpacity 
              style={styles.thresholdSaveButton}
              onPress={() => saveThresholdChanges(device, thresholdOperator, thresholdValue, thresholdAction)}
            >
              <Text style={styles.thresholdSaveButtonText}>Save Changes</Text>
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
                <Text style={styles.cancelButtonText}>Cancel</Text>
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

  // Modify saveDeviceWithConditions function
  const saveDeviceWithConditions = async () => {
    if (!deviceSearchId) {
      Alert.alert('Error', 'Device ID is required');
      return;
    }

    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }
      
      const db = getDatabase();
      
      // Check if device already exists in user's devices
      const userDevicesRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      const snapshot = await get(userDevicesRef);
      let existingDeviceKey = null;
      
      if (snapshot.exists()) {
        const userDevices = snapshot.val();
        // Find if device with same deviceId exists
        Object.entries(userDevices).forEach(([key, value]) => {
          if (value.deviceId === deviceSearchId) {
            existingDeviceKey = key;
          }
        });
      }
      
      // Prepare the device data
      const newDevice = {
        deviceId: deviceSearchId,
        name: deviceName || deviceFound?.deviceType || 'Unknown Device',
        type: deviceFound?.deviceType?.toLowerCase() || 'other',
        location: deviceLocation || 'Not specified',
        lastUpdated: new Date().toISOString(),
        isDynamic: isDynamic,
        conditions: isDynamic ? conditions : null,
        data: {
          isOnline: deviceFound?.isOnline || false
        }
      };

      // If device exists, update it. Otherwise, create new
      const deviceKey = existingDeviceKey || `${new Date().getTime()}_${Math.random().toString(36).substring(2, 8)}`;
      const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${deviceKey}`);
      
      await set(deviceRef, newDevice);
      
      // Update the IOTs collection based on condition type
      if (isDynamic) {
        const iotRef = ref(db, `IOTs/${deviceSearchId}`);
        const iotSnapshot = await get(iotRef);
        
        if (iotSnapshot.exists()) {
          const iotData = iotSnapshot.val();
          
          if (conditions.type === 'threshold') {
            // Update Threshold and Operator fields in IOTs collection
            await set(iotRef, {
              ...iotData,
              Operator: conditions.threshold.operator,
              Threshold: Number(conditions.threshold.value) || 0
            });
            console.log('Updated threshold settings in IOTs collection');
          }
        }
      }
      
      console.log(`Successfully ${existingDeviceKey ? 'updated' : 'added'} device with ID:`, deviceSearchId);
      
      // Reset form
      setDeviceSearchId('');
      setDeviceName('');
      setDeviceLocation('');
      setDeviceFound(null);
      setIsDynamic(false);
      setConditions({
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
          operator: '>', 
          action: 'alert'
        }
      });
      
      // Close modal and reset search step
      setIsAddModalVisible(false);
      setIsSearchStep(true);
      
      Alert.alert('Success', `Device ${existingDeviceKey ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error('Error saving device:', error);
      Alert.alert('Error', 'Failed to save device: ' + error.message);
    }
  };

  // Create a custom component for WiFi with slash
  const WifiSlashIcon = ({ size = 16, color = "#FFFFFF" }) => (
    <View style={styles.iconOverlayContainer}>
      <Ionicons name="wifi" size={size} color={color} />
      <View style={styles.slashOverlay}>
        <View style={[styles.slashLine, { transform: [{ rotate: '45deg' }] }]} />
      </View>
    </View>
  );

  // Add back the renderAddDeviceModal function
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
                {!deviceFound && (
                  <TouchableOpacity 
                    style={styles.modalButton}
                    onPress={searchDevice}
                  >
                    <Text style={styles.modalButtonText}>Search Device</Text>
                  </TouchableOpacity>
                )}

                {deviceFound && (
                  <View style={styles.devicePreview}>
                    <Text style={styles.previewTitle}>Device Information</Text>
                    {Object.entries(deviceFound).map(([key, value]) => (
                      <View key={key} style={styles.deviceDataRow}>
                        <Text style={styles.dataLabel}>{key}:</Text>
                        <Text style={styles.dataValue}>
                          {typeof value === 'boolean' ? <Text>{value.toString()}</Text> : <Text>{value}</Text>}
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
                        {deviceFound?.isOnline ? <Text>Online</Text> : <Text>Offline</Text>}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Device Name</Text>
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
                        {/* Show Threshold option if device has Threshold field */}
                        {(deviceFound && 'Threshold' in deviceFound) ? (
                          <TouchableOpacity
                            style={[
                              styles.conditionTypeButton,
                              styles.conditionTypeButtonSelected,
                              { borderColor: '#4CAF50', borderWidth: 2 }
                            ]}
                            disabled={true}
                          >
                            <Ionicons 
                              name="analytics-outline" 
                              size={24} 
                              color="#FFFFFF"
                            />
                            <Text style={[
                              styles.conditionTypeText,
                              styles.conditionTypeTextSelected
                            ]}>
                              Threshold
                            </Text>
                          </TouchableOpacity>
                        ) : (deviceFound && ('LockStatus' in deviceFound || 'Status' in deviceFound)) ? (
                          // Show Toggle option if device has LockStatus or Status
                          <TouchableOpacity
                            style={[
                              styles.conditionTypeButton,
                              styles.conditionTypeButtonSelected,
                              { borderColor: '#4CAF50', borderWidth: 2 }
                            ]}
                            disabled={true}
                          >
                            <Ionicons 
                              name="toggle-outline" 
                              size={24} 
                              color="#FFFFFF"
                            />
                            <Text style={[
                              styles.conditionTypeText,
                              styles.conditionTypeTextSelected
                            ]}>
                              Toggle
                            </Text>
                          </TouchableOpacity>
                        ) : (deviceFound && 'Readings' in deviceFound) ? (
                          // Show only Static option if device has Readings field
                          <TouchableOpacity
                            style={[
                              styles.conditionTypeButton,
                              styles.conditionTypeButtonSelected,
                              { borderColor: '#4CAF50', borderWidth: 2 }
                            ]}
                            disabled={true}
                          >
                            <Ionicons 
                              name="document-text-outline" 
                              size={24} 
                              color="#FFFFFF"
                            />
                            <Text style={[
                              styles.conditionTypeText,
                              styles.conditionTypeTextSelected
                            ]}>
                              Static
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          // Show all options if device has no special fields
                          <>
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
                          </>
                        )}
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
                          editable={!deviceFound || (!('LockStatus' in deviceFound) && !('Status' in deviceFound))}
                        />
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.off}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, off: value}
                          })}
                          placeholder="Off State Value ( 0 or 1 )"
                          editable={!deviceFound || (!('LockStatus' in deviceFound) && !('Status' in deviceFound))}
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
                          editable={!deviceFound || (!('LockStatus' in deviceFound) && !('Status' in deviceFound))}
                        />
                        <TextInput
                          style={styles.input}
                          value={conditions.toggleStates.offText}
                          onChangeText={(value) => setConditions({
                            ...conditions,
                            toggleStates: {...conditions.toggleStates, offText: value}
                          })}
                          placeholder="Off State Label (OFF, Stopped, Unlocked)"
                          editable={!deviceFound || (!('LockStatus' in deviceFound) && !('Status' in deviceFound))}
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
  
  const handleConditionChange = (type) => {
    setConditions({
      ...conditions,
      type,
      // Reset values when changing type
      minValue: '',
      maxValue: '',
      buttonActions: [],
      toggleStates: type === 'toggle' ? { 
        on: '1', 
        off: '0',
        onText: 'ON',
        offText: 'OFF'
      } : conditions.toggleStates,
      truefalseValue: type === 'truefalse' ? { true: '', false: '' } : conditions.truefalseValue,
      threshold: type === 'threshold' ? {
        value: '',
        operator: '>'
      } : conditions.threshold
    });
  };

  const handleDeviceLongPress = (device) => {
    setDeviceToDelete(device);
    setIsDeleteModalVisible(true);
  };

  const deleteDevice = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      
      // Find the device key in user's devices
      const userDevicesRef = ref(db, `iotDevices/${auth.currentUser.uid}`);
      const snapshot = await get(userDevicesRef);
      
      if (snapshot.exists()) {
        const userDevices = snapshot.val();
        let deviceKey = null;
        
        // Find the key for the device to delete
        Object.entries(userDevices).forEach(([key, value]) => {
          if ((value.id === deviceToDelete.id) || 
              (value.deviceId === deviceToDelete.deviceId) || 
              (JSON.stringify(value) === JSON.stringify(deviceToDelete))) {
            deviceKey = key;
          }
        });
        
        if (deviceKey) {
          // Delete the device from user's devices
          const deviceRef = ref(db, `iotDevices/${auth.currentUser.uid}/${deviceKey}`);
          await set(deviceRef, null);
          
          // Update local state
          setIotDevices(currentDevices => 
            currentDevices.filter(d => d.id !== deviceToDelete.id)
          );
          
          // Close modal and reset state
          setIsDeleteModalVisible(false);
          setDeviceToDelete(null);
          
          Alert.alert('Success', 'Device deleted successfully');
        } else {
          Alert.alert('Error', 'Device not found');
        }
      }
    } catch (error) {
      console.error('Error deleting device:', error);
      Alert.alert('Error', 'Failed to delete device: ' + error.message);
    }
  };

  const handleThresholdEdit = (device) => {
    setIotDevices(currentDevices => 
      currentDevices.map(d => 
        d.id === device.id ? { ...d, isEditing: true } : d
      )
    );
  };

  const handleToggleChange = async (device) => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        Alert.alert('Error', 'User not authenticated');
        return;
      }

      const db = getDatabase();
      const iotRef = ref(db, `IOTs/${device.deviceId}`);
      const snapshot = await get(iotRef);

      if (snapshot.exists()) {
        const currentData = snapshot.val();
        let newValue;

        // Determine which field to toggle (LockStatus or Status)
        const fieldToToggle = 'LockStatus' in currentData ? 'LockStatus' : 'Status';
        const currentValue = currentData[fieldToToggle];

        // Get the toggle states from device conditions
        const { on, off } = device.conditions?.toggleStates || { on: '1', off: '0' };

        // Toggle the value
        newValue = currentValue === on ? off : on;

        // Update the device state in Firebase
        await set(iotRef, {
          ...currentData,
          [fieldToToggle]: newValue,
          lastStatusUpdate: new Date().toISOString()
        });

        // Update local state
        setIotDevices(currentDevices =>
          currentDevices.map(d =>
            d.id === device.id
              ? {
                  ...d,
                  data: {
                    ...d.data,
                    [fieldToToggle]: newValue,
                    lastStatusUpdate: new Date().toISOString()
                  }
                }
              : d
          )
        );

        console.log(`Successfully toggled ${fieldToToggle} to ${newValue}`);
      } else {
        Alert.alert('Error', 'Device data not found');
      }
    } catch (error) {
      console.error('Error toggling device:', error);
      Alert.alert('Error', 'Failed to toggle device: ' + error.message);
    }
  };

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
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <View style={styles.statIconContainer}>
              <Ionicons name="wifi" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.statNumber}>
              {iotDevices.filter(d => d.data?.isOnline === true).length}
            </Text>
            <Text style={styles.statLabel}>Online</Text>
          </View>

          <View style={styles.statBadge}>
            <View style={styles.statIconContainerRed}>
              <WifiSlashIcon size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.statNumber}>
              {iotDevices.filter(d => d.data?.isOnline === false).length}
            </Text>
            <Text style={styles.statLabel}>Offline</Text>
          </View>
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
          data={[{ id: 'camera_card' }, ...iotDevices]}
          renderItem={({ item }) => {
            if (item.id === 'camera_card') {
              return (
                <TouchableOpacity 
                  style={[styles.deviceCard, styles.cameraCard]}
                  onPress={() => navigation.navigate('Camera')}
                >
                  <View style={styles.deviceHeader}>
                    <View style={[styles.deviceIconContainer, { backgroundColor: '#9C27B0' }]}>
                      <Ionicons name="camera" size={28} color="#FFFFFF" />
                    </View>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName}>Security Camera</Text>
                      <Text style={styles.deviceLocation}>View Live Feed</Text>
                      <View style={styles.personCountContainer}>
                        <Ionicons name="people" size={16} color="#666" />
                        <Text style={styles.personCountText}>
                          {personCount + ' ' + (personCount === 1 ? 'person' : 'people') + ' detected'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.cameraArrow}>
                      <Ionicons name="chevron-forward" size={24} color="#666" />
                    </View>
                  </View>
                  <View style={styles.cameraBadge}>
                    <Text style={styles.cameraBadgeText}>LIVE</Text>
                  </View>
                </TouchableOpacity>
              );
            }
            return renderDevice({ item });
          }}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.deviceList}
        />
      )}
      
      {renderAddDeviceModal()}
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
    justifyContent: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginHorizontal: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  statIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  statIconContainerRed: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  statNumber: {
    fontSize: 16,
    fontWeight: '700',
    marginRight: 5,
  },
  statLabel: {
    fontSize: 14,
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
  deleteHint: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 5,
  },
  deviceActions: {
    flexDirection: 'column',
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
    fontWeight: '600',
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
    fontWeight: '600',
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
    marginHorizontal: 'auto',
    alignSelf: 'center',
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
    backgroundColor: '#F5F5F5',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flex: 1,
    marginRight: 10,
  },
  cancelButtonText: {
    color: '#666666',
    fontWeight: '600',
    fontSize: 16,
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
    flex: 1,
    marginLeft: 10,
  },
  recommendedBadge: {
    backgroundColor: '#4CAF50',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 4,
    marginTop: 5,
  },
  thresholdModalContent: {
    backgroundColor: '#FFFFFF',
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
  thresholdModalBody: {
    padding: 15,
  },
  thresholdEditSection: {
    marginBottom: 15,
  },
  thresholdEditLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 5,
  },
  operatorButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  operatorButtonNew: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  operatorButtonNewSelected: {
    backgroundColor: '#2196F3',
  },
  operatorButtonNewText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  thresholdValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  thresholdInputWrapper: {
    flex: 1,
  },
  thresholdValueButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 5,
  },
  thresholdValueButton: {
    padding: 10,
  },
  thresholdValueInput: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  actionButtonsNew: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  actionButtonNew: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  actionButtonNewSelected: {
    backgroundColor: '#2196F3',
  },
  actionButtonNewText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  thresholdSummary: {
    padding: 15,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginTop: 15,
  },
  thresholdSummaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 10,
  },
  thresholdSummaryText: {
    color: '#666',
    fontSize: 14,
  },
  thresholdHighlight: {
    fontWeight: '600',
  },
  thresholdSaveButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  thresholdSaveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  inlineEditContainer: {
    padding: 10,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginTop: 5,
  },
  operatorRow: {
    marginBottom: 15,
  },
  inlineEditLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
    marginBottom: 5,
  },
  operatorInlineButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  operatorInlineButton: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  operatorInlineButtonSelected: {
    backgroundColor: '#2196F3',
  },
  operatorInlineButtonText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  operatorInlineButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  valueRow: {
    marginBottom: 15,
  },
  valueControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  valueButton: {
    padding: 10,
  },
  valueDisplay: {
    fontSize: 20,
    color: '#212121',
    fontWeight: '600',
    paddingHorizontal: 20,
    textAlign: 'center',
  },
  valueDisplayInput: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginHorizontal: 5,
    textAlign: 'center',
    minWidth: 80,
  },
  actionRow: {
    marginBottom: 15,
  },
  actionInlineButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  actionInlineButton: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 8,
    marginHorizontal: 5,
    alignItems: 'center',
  },
  actionInlineButtonSelected: {
    backgroundColor: '#2196F3',
  },
  actionInlineButtonText: {
    color: '#2196F3',
    fontWeight: '500',
  },
  actionInlineButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inlineButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
  },
  iconOverlayContainer: {
    position: 'relative',
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slashLine: {
    width: '130%',
    height: 2,
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
    marginLeft: 10,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  disabledInput: {
    backgroundColor: '#F0F0F0',
    color: '#999',
  },
  disabledText: {
    color: '#999',
  },
  thresholdInfoContainer: {
    padding: 15,
    backgroundColor: '#FFF3E0',
    borderRadius: 8,
    marginTop: 15,
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  thresholdInfoText: {
    color: '#F57C00',
    fontSize: 14,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  cameraCard: {
    backgroundColor: '#FFFFFF',
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
    transform: [{ scale: 1.02 }],
  },
  cameraArrow: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
  },
  cameraBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#9C27B0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  cameraBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  personCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    backgroundColor: '#F0F0F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  personCountText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
    fontWeight: '500',
  },
  toggleBackground: {
    padding: 5,
    borderRadius: 15,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
}); 