import React, { useEffect, useRef, useState } from 'react';
import { Text, View, Button, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { registerForPushNotificationsAsync, sendLocalNotification } from './Components/notificationService';
import { ref, onValue } from 'firebase/database';
import { db } from './Components/firebaseConfig';
import { registerBackgroundFetch, BACKGROUND_FETCH_TASK } from './Components/backgroundTask';

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState('');
  const [smartlockStatus, setSmartlockStatus] = useState(null);
  const previousValueRef = useRef(null);
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Register for notifications
    registerForPushNotificationsAsync().then(token => setExpoPushToken(token));

    // Register background fetch
    registerBackgroundFetch();

    // Listen for app state changes
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to the foreground
        checkSmartlockStatus();
      }
      appState.current = nextAppState;
    });

    // Set up Firebase listener for when app is in foreground
    const smartlockRef = ref(db, 'IOTs/Smartlock');
    const unsubscribe = onValue(smartlockRef, (snapshot) => {
      const currentValue = snapshot.val();
      setSmartlockStatus(currentValue);
      
      // Only send notification if value changed from something else to 0
      if (previousValueRef.current !== null && 
          previousValueRef.current !== 0 && 
          currentValue === 0) {
        sendLocalNotification(
          'Smart Lock Alert',
          'Your smart lock has been deactivated!'
        );
      }
      
      previousValueRef.current = currentValue;
    });

    // Cleanup
    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);

  const checkSmartlockStatus = async () => {
    const smartlockRef = ref(db, 'IOTs/Smartlock');
    onValue(smartlockRef, (snapshot) => {
      const currentValue = snapshot.val();
      
      // Only send notification if value changed from something else to 0
      if (previousValueRef.current !== null && 
          previousValueRef.current !== 0 && 
          currentValue === 0) {
        sendLocalNotification(
          'Smart Lock Alert',
          'Your smart lock has been deactivated!'
        );
      }
      
      previousValueRef.current = currentValue;
    }, { onlyOnce: true });
  };

  // Function to display the status text
  const getStatusText = (status) => {
    if (status === null) return 'Loading...';
    return status === 1 ? 'Locked' : 'Unlocked';
  };

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Your expo push token: {expoPushToken}</Text>
      <Text>Smart Lock Status: {getStatusText(smartlockStatus)}</Text>
      <Button
        title="Check Smart Lock"
        onPress={checkSmartlockStatus}
      />
    </View>
  );
}
