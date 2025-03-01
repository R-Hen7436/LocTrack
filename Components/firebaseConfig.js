import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, get } from "firebase/database"; // Import Realtime Database
import { getAuth } from "firebase/auth";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyALi0028_ngjDDmAFc0BfW5WYnCKsd5W3c",
  authDomain: "geofencing-2fcd0.firebaseapp.com",
  databaseURL: "https://geofencing-2fcd0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "geofencing-2fcd0",
  storageBucket: "geofencing-2fcd0.appspot.com",
  messagingSenderId: "439986173789",
  appId: "1:439986173789:web:def850b445ffcb0d1adab4"
};

// Initialize Firebase
let app;
let db;
let auth;

try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (error) {
  console.error("Error initializing Firebase:", error);
}

// Add connection state monitoring
if (db) {
  const connectedRef = ref(db, '.info/connected');
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      console.log('Connected to Firebase');
    } else {
      console.log('Not connected to Firebase');
    }
  }, (error) => {
    console.error('Error monitoring connection:', error);
  });
}

// Helper function to check database connection
const checkDatabaseConnection = () => {
  return new Promise((resolve) => {
    if (!db) {
      console.error('Database not initialized');
      resolve(false);
      return;
    }

    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
      resolve(snap.val() === true);
    }, (error) => {
      console.error('Error checking connection:', error);
      resolve(false);
    });
  });
};

// Function to generate a secure 12-character product key
const generateProductKey = () => {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding similar-looking characters
  const length = 12;
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  
  // Insert dashes every 4 characters for readability
  return result.match(/.{1,4}/g).join('-');
};

// Function to store a new product key
const storeProductKey = async (productKey) => {
  const db = getDatabase();
  await set(ref(db, `productKeys/${productKey}`), {
    key: productKey,
    status: 'unused',
    createdAt: new Date().toISOString(),
    usedBy: null,
    usedAt: null
  });
};

// Function to validate and claim a product key
const validateProductKey = async (productKey, userId) => {
  const formattedKey = productKey.replace(/-/g, '').toUpperCase();
  const keyRef = ref(db, `productKeys/${formattedKey}`);
  
  const snapshot = await get(keyRef);
  if (!snapshot.exists()) {
    throw new Error('Invalid product key');
  }
  
  const keyData = snapshot.val();
  if (keyData.status === 'used') {
    throw new Error('Product key has already been used');
  }
  
  // Mark the key as used
  await set(keyRef, {
    ...keyData,
    status: 'used',
    usedBy: userId,
    usedAt: new Date().toISOString()
  });
  
  return true;
};

export { db, auth, checkDatabaseConnection, generateProductKey, storeProductKey, validateProductKey };
