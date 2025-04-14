import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import { getDatabase, ref, onValue, get, remove } from 'firebase/database';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';

const { width } = Dimensions.get('window');

const LocationLog = () => {
  const navigation = useNavigation();
  const [locationHistory, setLocationHistory] = useState([]);
  const [searchDate, setSearchDate] = useState('');
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const setupLocationHistory = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const auth = getAuth();
        if (!auth.currentUser) {
          setError('User not authenticated');
          setIsLoading(false);
          return;
        }

        const db = getDatabase();
        const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
        const profileSnapshot = await get(userProfileRef);
        
        if (!profileSnapshot.exists()) {
          setError('User profile not found');
          setIsLoading(false);
          return;
        }

        const profileData = profileSnapshot.val();
        if (!profileData.MacAddress) {
          setError('No MAC address found in profile');
          setIsLoading(false);
          return;
        }

        const macAddress = profileData.MacAddress.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
        const historyRef = ref(db, `Sentinel/location_history/${macAddress}`);

        const unsubscribe = onValue(historyRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            const historyArray = Object.entries(data).map(([id, entry]) => ({
              id,
              ...entry
            }));
            
            historyArray.sort((a, b) => new Date(b.last_update) - new Date(a.last_update));
            setLocationHistory(historyArray);
            setFilteredHistory(historyArray);
          } else {
            setLocationHistory([]);
            setFilteredHistory([]);
            setError('No location history found');
          }
          setIsLoading(false);
        }, (error) => {
          console.error('Error in onValue:', error);
          setError('Error accessing location history: ' + error.message);
          setIsLoading(false);
        });

        return () => unsubscribe();
      } catch (error) {
        console.error('Error in setupLocationHistory:', error);
        setError('Error setting up location history: ' + error.message);
        setIsLoading(false);
      }
    };

    setupLocationHistory();
  }, []);

  const formatDate = (dateString) => {
    return dateString.replace(/"/g, '');
  };

  const searchHistoryByDate = (dateStr) => {
    setSearchDate(dateStr);
    
    if (!dateStr) {
      setFilteredHistory(locationHistory);
      return;
    }

    const filtered = locationHistory.filter((item) => {
      return item.last_update.toLowerCase().includes(dateStr.toLowerCase());
    });

    setFilteredHistory(filtered);
  };

  const deleteEntry = async (entryId) => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;

      const db = getDatabase();
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnapshot = await get(userProfileRef);
      
      if (!profileSnapshot.exists()) return;
      
      const profileData = profileSnapshot.val();
      if (!profileData.MacAddress) return;

      const macAddress = profileData.MacAddress.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
      const entryPath = `Sentinel/location_history/${macAddress}/${entryId}`;
      
      Alert.alert(
        "Delete Entry",
        "Are you sure you want to delete this location entry?",
        [
          {
            text: "Cancel",
            style: "cancel"
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setIsDeleting(true);
              try {
                await remove(ref(db, entryPath));
              } catch (error) {
                console.error('Error deleting entry:', error);
                Alert.alert('Error', 'Failed to delete entry: ' + error.message);
              } finally {
                setIsDeleting(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error preparing delete:', error);
      Alert.alert('Error', 'Failed to prepare deletion');
      setIsDeleting(false);
    }
  };

  const deleteAllEntries = async () => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) return;

      const db = getDatabase();
      const userProfileRef = ref(db, `users/${auth.currentUser.uid}/profile`);
      const profileSnapshot = await get(userProfileRef);
      
      if (!profileSnapshot.exists()) return;
      
      const profileData = profileSnapshot.val();
      if (!profileData.MacAddress) return;

      const macAddress = profileData.MacAddress.replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
      
      Alert.alert(
        "Delete All History",
        "Are you sure you want to delete all location history? This action cannot be undone.",
        [
          {
            text: "Cancel",
            style: "cancel"
          },
          {
            text: "Delete All",
            style: "destructive",
            onPress: async () => {
              setIsDeleting(true);
              try {
                const historyRef = ref(db, `Sentinel/location_history/${macAddress}`);
                await remove(historyRef);
                setLocationHistory([]);
                setFilteredHistory([]);
              } catch (error) {
                console.error('Error deleting all entries:', error);
                Alert.alert('Error', 'Failed to delete all entries: ' + error.message);
              } finally {
                setIsDeleting(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error preparing delete all:', error);
      Alert.alert('Error', 'Failed to prepare deletion');
      setIsDeleting(false);
    }
  };

  const renderLocationItem = ({ item }) => {
    const isOutdoor = item.location === 'outdoor';
    
    return (
      <View style={styles.locationItem}>
        <View style={styles.locationIconContainer}>
          <View style={[
            styles.iconBackground,
            isOutdoor ? styles.outdoorIconBg : styles.indoorIconBg
          ]}>
            <Ionicons 
              name={isOutdoor ? 'sunny-outline' : 'home-outline'} 
              size={24} 
              color={isOutdoor ? '#FF9500' : '#32ADE6'} 
            />
          </View>
        </View>
        <View style={styles.locationContent}>
          <View style={styles.locationHeader}>
            <Text style={styles.locationText}>
              {item.location.charAt(0).toUpperCase() + item.location.slice(1)}
            </Text>
            <TouchableOpacity 
              style={[
                styles.deleteButton,
                (isLoading || isDeleting) && styles.deleteButtonDisabled
              ]}
              onPress={() => {
                if (!isLoading && !isDeleting) {
                  deleteEntry(item.id);
                }
              }}
              disabled={isLoading || isDeleting}
            >
              <Ionicons 
                name="trash-outline" 
                size={20} 
                color={(isLoading || isDeleting) ? "#999" : "#FF3B30"} 
              />
            </TouchableOpacity>
          </View>
          <Text style={styles.timestamp}>{formatDate(item.last_update)}</Text>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.actionsContainer}>
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#8E8E93" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by date..."
            value={searchDate}
            onChangeText={searchHistoryByDate}
            placeholderTextColor="#8E8E93"
          />
          {searchDate ? (
            <TouchableOpacity 
              onPress={() => searchHistoryByDate('')}
              style={styles.clearButton}
            >
              <Ionicons name="close-circle" size={20} color="#8E8E93" />
            </TouchableOpacity>
          ) : null}
        </View>
        {locationHistory.length > 0 && (
          <TouchableOpacity 
            style={[
              styles.deleteAllButton,
              (isLoading || isDeleting) && styles.deleteAllButtonDisabled
            ]}
            onPress={deleteAllEntries}
            disabled={isLoading || isDeleting}
          >
            <Ionicons name="trash-outline" size={20} color="white" />
            <Text style={styles.deleteAllText}>
              {isDeleting ? 'Deleting...' : 'Delete All History'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      
      {filteredHistory.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="time-outline" size={48} color="#8E8E93" />
          </View>
          <Text style={styles.emptyText}>No location history found</Text>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      ) : (
        <FlatList
          data={filteredHistory}
          renderItem={renderLocationItem}
          keyExtractor={item => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  actionsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    height: '100%',
  },
  clearButton: {
    padding: 4,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  locationItem: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 16,
    marginBottom: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  locationIconContainer: {
    marginRight: 16,
    justifyContent: 'center',
  },
  iconBackground: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  outdoorIconBg: {
    backgroundColor: '#FFF5EB',
  },
  indoorIconBg: {
    backgroundColor: '#EBF7FF',
  },
  locationContent: {
    flex: 1,
  },
  locationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  locationText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  timestamp: {
    fontSize: 14,
    color: '#8E8E93',
  },
  deleteButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
  },
  deleteButtonDisabled: {
    backgroundColor: '#F5F5F5',
    opacity: 0.5,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#FF3B30',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#8E8E93',
  },
  deleteAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B30',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  deleteAllButtonDisabled: {
    opacity: 0.5,
  },
  deleteAllText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});

export default LocationLog;
