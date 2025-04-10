import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  FlatList,
  TextInput,
  Alert,
  Keyboard,
  ActivityIndicator
} from 'react-native';
import { getDatabase, ref, get, query, orderByChild, set, remove } from 'firebase/database';
import { generateProductKey, storeProductKey } from '../firebaseConfig';
import { getAuth, signOut } from 'firebase/auth';
import { Ionicons } from '@expo/vector-icons';
import Navbar from '../Navbar';

export default function ProductKeyManager({ navigation }) {
  const [productKeys, setProductKeys] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'used', 'unused'
  const [selectedKeys, setSelectedKeys] = useState({});
  const [isSelectMode, setIsSelectMode] = useState(false);
  
  // Compute number of selected keys
  const selectedCount = Object.values(selectedKeys).filter(Boolean).length;

  useEffect(() => {
    loadProductKeys();
  }, [filterStatus]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => null,  // Remove the back button
      headerBackVisible: false,  // Ensure back button is hidden
    });
  }, [navigation]);

  const loadProductKeys = async () => {
    try {
      const db = getDatabase();
      const keysRef = ref(db, 'productKeys');
      console.log('Loading keys from database path: productKeys');
      const snapshot = await get(keysRef);
      
      if (snapshot.exists()) {
        const keys = [];
        console.log('Found keys in database:', snapshot.val());
        snapshot.forEach((child) => {
          console.log('Processing key:', child.key, child.val());
          const data = child.val();
          if (filterStatus === 'all' || 
              (filterStatus === 'used' && data.status === 'used') ||
              (filterStatus === 'unused' && data.status === 'unused')) {
            keys.push({
              ...data,
              databaseKey: child.key // Store the actual database key
            });
          }
        });
        // Sort by createdAt on the client side
        keys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        console.log('Processed keys:', keys);
        setProductKeys(keys);
      } else {
        console.log('No keys found in database');
        setProductKeys([]);
      }
    } catch (error) {
      console.error('Load keys error:', error);
      Alert.alert('Error', 'Failed to load product keys');
    }
  };

  const handleGenerateKeys = async () => {
    setLoading(true);
    try {
      const numKeys = parseInt(quantity);
      if (numKeys > 0 && numKeys <= 100) {
        for (let i = 0; i < numKeys; i++) {
          const newKey = generateProductKey();
          console.log('Generated new key:', newKey);
          await storeProductKey(newKey);
          console.log('Stored key in database');
        }
        console.log(`Successfully generated ${numKeys} keys`);
        Alert.alert('Success', `Generated ${numKeys} new product key(s)`);
        await loadProductKeys(); // Make sure to await this
      } else {
        Alert.alert('Error', 'Please enter a quantity between 1 and 100');
      }
    } catch (error) {
      console.error('Error generating keys:', error);
      Alert.alert('Error', 'Failed to generate product keys');
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
    } catch (error) {
      Alert.alert('Error', 'Failed to log out');
    }
  };

  // Toggle selection mode
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedKeys({});
  };

  // Toggle selection of a specific key
  const toggleKeySelection = (keyId) => {
    setSelectedKeys(prev => ({
      ...prev,
      [keyId]: !prev[keyId]
    }));
  };

  // Select all keys
  const selectAllKeys = () => {
    const newSelected = {};
    productKeys.forEach(key => {
      newSelected[key.key] = true;
    });
    setSelectedKeys(newSelected);
  };

  // Deselect all keys
  const deselectAllKeys = () => {
    setSelectedKeys({});
  };

  // Delete selected keys
  const deleteSelectedKeys = async () => {
    const selectedKeyIds = Object.keys(selectedKeys).filter(key => selectedKeys[key]);
    
    if (selectedKeyIds.length === 0) {
      Alert.alert('Warning', 'No keys selected');
      return;
    }
    
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete ${selectedKeyIds.length} product key(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const db = getDatabase();
              
              // Delete each selected key
              const deletePromises = selectedKeyIds.map(keyId => {
                const keyToDelete = productKeys.find(k => k.key === keyId);
                if (keyToDelete) {
                  return remove(ref(db, `productKeys/${keyToDelete.databaseKey}`));
                }
                return Promise.resolve();
              });
              
              await Promise.all(deletePromises);
              
              // Reload keys and exit selection mode
              await loadProductKeys();
              setIsSelectMode(false);
              setSelectedKeys({});
              
              Alert.alert('Success', `Deleted ${selectedKeyIds.length} product key(s)`);
            } catch (error) {
              console.error('Error deleting keys:', error);
              Alert.alert('Error', 'Failed to delete product keys');
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  const renderKey = ({ item }) => (
    <TouchableOpacity
      onPress={() => isSelectMode ? toggleKeySelection(item.key) : null}
      style={[
        styles.keyItem,
        isSelectMode && selectedKeys[item.key] && styles.selectedKeyItem
      ]}
    >
      <View style={styles.keyRow}>
        {isSelectMode && (
          <View style={styles.checkboxContainer}>
            <View style={[
              styles.checkbox, 
              selectedKeys[item.key] && styles.checkboxSelected
            ]}>
              {selectedKeys[item.key] && (
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              )}
            </View>
          </View>
        )}
        <View style={styles.keyContent}>
          <Text style={styles.keyText}>{item.key}</Text>
          <Text style={styles.keySubtext}>DB Key: {item.databaseKey}</Text>
          <View style={styles.keyDetails}>
            <Text style={[
              styles.status, 
              item.status === 'used' ? styles.usedStatus : styles.unusedStatus
            ]}>
              {item.status}
            </Text>
            <Text style={styles.date}>
              Created: {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
          {item.status === 'used' && (
            <View style={styles.usedDetails}>
              <Text style={styles.usedBy}>Used by: {item.usedBy}</Text>
              <Text style={styles.usedDate}>
                Used on: {new Date(item.usedAt).toLocaleDateString()}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Product Key Manager</Text>
      </View>
      
      {!isSelectMode ? (
        <View style={styles.generateSection}>
          <TextInput
            style={styles.input}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            placeholder="Enter quantity (1-100)"
            returnKeyType="done"
            onSubmitEditing={() => {
              Keyboard.dismiss();
            }}
          />
          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleGenerateKeys}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Generating...' : 'Generate Keys'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.selectionControlsContainer}>
          <Text style={styles.selectionText}>
            {selectedCount} key{selectedCount !== 1 ? 's' : ''} selected
          </Text>
          <View style={styles.selectionControls}>
            <TouchableOpacity 
              style={styles.selectionButton}
              onPress={selectAllKeys}
            >
              <Text style={styles.selectionButtonText}>Select All</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.selectionButton}
              onPress={deselectAllKeys}
            >
              <Text style={styles.selectionButtonText}>Deselect All</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.selectionButton, styles.deleteButton, selectedCount === 0 && styles.buttonDisabled]}
              onPress={deleteSelectedKeys}
              disabled={selectedCount === 0}
            >
              <Text style={styles.deleteButtonText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.actionsRow}>
        <View style={styles.filterSection}>
          <TouchableOpacity 
            style={[styles.filterButton, filterStatus === 'all' && styles.activeFilter]}
            onPress={() => setFilterStatus('all')}
          >
            <Text style={[styles.filterText, filterStatus === 'all' && styles.activeFilterText]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterButton, filterStatus === 'used' && styles.activeFilter]}
            onPress={() => setFilterStatus('used')}
          >
            <Text style={[styles.filterText, filterStatus === 'used' && styles.activeFilterText]}>Used</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.filterButton, filterStatus === 'unused' && styles.activeFilter]}
            onPress={() => setFilterStatus('unused')}
          >
            <Text style={[styles.filterText, filterStatus === 'unused' && styles.activeFilterText]}>Unused</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.selectButton}
          onPress={toggleSelectMode}
        >
          <Text style={styles.selectButtonText}>
            {isSelectMode ? 'Cancel' : 'Select'}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading product keys...</Text>
        </View>
      ) : (
        <FlatList
          data={productKeys}
          renderItem={renderKey}
          keyExtractor={item => item.key}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No product keys found</Text>
            </View>
          }
        />
      )}
      
      <Navbar activePage="keys" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingBottom: 100,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  generateSection: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 12,
    marginRight: 10,
    borderRadius: 5,
    height: 48,
  },
  button: {
    backgroundColor: 'black',
    padding: 12,
    borderRadius: 5,
    justifyContent: 'center',
    minWidth: 120,
  },
  buttonDisabled: {
    backgroundColor: '#666',
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  filterSection: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 10,
  },
  filterButton: {
    flex: 1,
    padding: 8,
    marginHorizontal: 2,
    borderRadius: 5,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeFilter: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    textAlign: 'center',
    fontWeight: '500',
    color: '#333',
  },
  activeFilterText: {
    color: '#FFFFFF',
  },
  list: {
    flex: 1,
  },
  keyItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  keyText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 5,
  },
  keyDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: {
    fontWeight: '500',
    fontSize: 14,
  },
  usedStatus: {
    color: '#FF3B30',
  },
  unusedStatus: {
    color: '#34C759',
  },
  date: {
    color: '#666',
    fontSize: 14,
  },
  usedDetails: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#f8f8f8',
    borderRadius: 4,
  },
  usedBy: {
    color: '#666',
    fontSize: 14,
    marginBottom: 4,
  },
  usedDate: {
    color: '#888',
    fontSize: 12,
  },
  logoutButton: {
    backgroundColor: '#ff4444',
    padding: 10,
    borderRadius: 5,
  },
  logoutText: {
    color: 'white',
    fontWeight: 'bold',
  },
  keySubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 50,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  selectionControlsContainer: {
    marginBottom: 20,
  },
  selectionText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 10,
  },
  selectionControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionButton: {
    padding: 10,
    marginRight: 8,
    borderRadius: 5,
    backgroundColor: '#f0f0f0',
  },
  selectionButtonText: {
    fontWeight: '500',
  },
  deleteButton: {
    backgroundColor: '#ff4444',
  },
  deleteButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  keyContent: {
    flex: 1,
  },
  checkboxContainer: {
    marginRight: 10,
    paddingTop: 3,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  selectButton: {
    padding: 10,
    borderRadius: 5,
    backgroundColor: '#007AFF',
  },
  selectButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  selectedKeyItem: {
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
  },
  listContent: {
    paddingBottom: 100, // Extra padding for the navbar
  },
}); 