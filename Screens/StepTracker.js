import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  ActivityIndicator,
  SafeAreaView,
  StatusBar
} from 'react-native';
import { database } from '../../firebase';
import { ref, onValue } from 'firebase/database';
import { auth } from '../../firebase';
import BottomTabBar from '../Components/BottomTabBar';
import { Ionicons } from '@expo/vector-icons';
import CircularProgress from 'react-native-circular-progress-indicator';

const StepTracker = () => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const userRef = ref(database, `users/${currentUser.uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserData(data);
        setLoading(false);
      } else {
        console.log("No user data available");
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const getTodaySteps = () => {
    if (!userData || !userData.totalSteps) return 0;
    return userData.totalSteps;
  };

  const getStepGoal = () => {
    if (!userData || !userData.stepGoal) return 10000; // Default goal
    return userData.stepGoal;
  };

  const calculateProgress = () => {
    const todaySteps = getTodaySteps();
    const goal = getStepGoal();
    return Math.min((todaySteps / goal) * 100, 100);
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#766AC8" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor="#F5F6FA" barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Step Tracker</Text>
          <Ionicons name="footsteps" size={24} color="#766AC8" />
        </View>

        {/* Progress Circle */}
        <View style={styles.progressCircleContainer}>
          <CircularProgress
            value={getTodaySteps()}
            maxValue={getStepGoal()}
            radius={90}
            activeStrokeColor="#766AC8"
            inActiveStrokeColor="#E8E8F7"
            activeStrokeWidth={15}
            inActiveStrokeWidth={15}
            title={'Steps'}
            titleStyle={{ fontSize: 16, color: '#333' }}
            valueSuffix={''}
            valueStyle={{ fontSize: 36, fontWeight: 'bold', color: '#766AC8' }}
            progressValueColor={'#766AC8'}
          />
          <Text style={styles.goalText}>
            {Math.round(calculateProgress())}% of daily goal
          </Text>
        </View>
      </ScrollView>
      <BottomTabBar activeTab="steps" />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F6FA',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F6FA',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
  },
  header: {
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#333',
  },
  progressCircleContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  goalText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  }
});

export default StepTracker; 