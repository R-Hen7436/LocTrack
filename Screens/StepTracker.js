import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { database } from '../../firebase';
import { ref, onValue } from 'firebase/database';
import { auth } from '../../firebase';
import BottomTabBar from '../Components/BottomTabBar';

const StepTracker = () => {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stepData, setStepData] = useState({
    labels: [],
    datasets: [{ data: [] }]
  });

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const userRef = ref(database, `users/${currentUser.uid}`);
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        setUserData(data);
        
        // Process step history data for chart
        if (data.stepHistory) {
          processStepHistory(data.stepHistory);
        }
        
        setLoading(false);
      } else {
        console.log("No user data available");
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const processStepHistory = (history) => {
    // Convert history object to array and sort by timestamp
    const historyArray = Object.entries(history).map(([key, value]) => ({
      timestamp: key,
      ...value
    }));
    
    // Sort by timestamp (newest first)
    historyArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Take the last 7 entries (or fewer if there aren't 7)
    const recentEntries = historyArray.slice(0, 7).reverse();
    
    // Format the data for the chart
    const labels = recentEntries.map(entry => {
      const date = new Date(entry.timestamp);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });
    
    const stepCounts = recentEntries.map(entry => entry.steps || 0);
    
    setStepData({
      labels,
      datasets: [{ data: stepCounts }]
    });
  };

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
    return (todaySteps / goal) * 100;
  };

  const chartConfig = {
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    color: (opacity = 1) => `rgba(0, 128, 255, ${opacity})`,
    strokeWidth: 2,
    decimalPlaces: 0,
    labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
  };

  if (loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#0080ff" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Step Tracker</Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statTitle}>Today's Steps</Text>
            <Text style={styles.statValue}>{getTodaySteps().toLocaleString()}</Text>
          </View>
          
          <View style={styles.statBox}>
            <Text style={styles.statTitle}>Step Goal</Text>
            <Text style={styles.statValue}>{getStepGoal().toLocaleString()}</Text>
          </View>
        </View>

        <View style={styles.progressContainer}>
          <Text style={styles.progressTitle}>Progress</Text>
          <View style={styles.progressBarContainer}>
            <View 
              style={[
                styles.progressBar,
                { width: `${Math.min(calculateProgress(), 100)}%` }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>{Math.round(calculateProgress())}% of daily goal</Text>
        </View>

        <View style={styles.chartContainer}>
          <Text style={styles.chartTitle}>7-Day Step History</Text>
          {stepData.labels.length > 0 ? (
            <LineChart
              data={stepData}
              width={Dimensions.get('window').width - 40}
              height={220}
              chartConfig={chartConfig}
              bezier
              style={styles.chart}
            />
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>No step history available yet</Text>
            </View>
          )}
        </View>
      </ScrollView>
      <BottomTabBar activeTab="Steps" />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '48%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  statTitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  progressContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  progressTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  progressBarContainer: {
    height: 15,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0080ff',
    borderRadius: 10,
  },
  progressText: {
    fontSize: 14,
    color: '#666',
  },
  chartContainer: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  chart: {
    marginVertical: 8,
    borderRadius: 16,
  },
  noDataContainer: {
    height: 220,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    fontSize: 16,
    color: '#666',
  },
});

export default StepTracker; 