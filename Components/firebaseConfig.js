import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database"; // Import Realtime Database
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

export { db, auth, checkDatabaseConnection };
