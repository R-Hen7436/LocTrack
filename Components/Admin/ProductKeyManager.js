import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  FlatList,
  TextInput,
  Alert 
} from 'react-native';
import { getDatabase, ref, get, query, orderByChild, set } from 'firebase/database';
import { generateProductKey, storeProductKey } from '../firebaseConfig';
import { getAuth, signOut } from 'firebase/auth';

export default function ProductKeyManager({ navigation }) {
  const [productKeys, setProductKeys] = useState([]);
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'used', 'unused'

  useEffect(() => {
    loadProductKeys();
  }, [filterStatus]);

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

  const renderKey = ({ item }) => (
    <View style={styles.keyItem}>
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
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Product Key Manager</Text>
        <TouchableOpacity 
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.generateSection}>
        <TextInput
          style={styles.input}
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
          placeholder="Enter quantity (1-100)"
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

      <View style={styles.filterSection}>
        <TouchableOpacity 
          style={[styles.filterButton, filterStatus === 'all' && styles.activeFilter]}
          onPress={() => setFilterStatus('all')}
        >
          <Text style={styles.filterText}>All</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.filterButton, filterStatus === 'used' && styles.activeFilter]}
          onPress={() => setFilterStatus('used')}
        >
          <Text style={styles.filterText}>Used</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.filterButton, filterStatus === 'unused' && styles.activeFilter]}
          onPress={() => setFilterStatus('unused')}
        >
          <Text style={styles.filterText}>Unused</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={productKeys}
        renderItem={renderKey}
        keyExtractor={item => item.key}
        style={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
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
    marginBottom: 20,
    justifyContent: 'space-between',
  },
  filterButton: {
    flex: 1,
    padding: 10,
    marginHorizontal: 5,
    borderRadius: 5,
    backgroundColor: '#f0f0f0',
  },
  activeFilter: {
    backgroundColor: '#007AFF',
  },
  filterText: {
    textAlign: 'center',
    fontWeight: '500',
  },
  list: {
    flex: 1,
  },
  keyItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
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
}); 