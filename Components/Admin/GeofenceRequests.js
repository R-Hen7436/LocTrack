import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, TextInput, Modal } from 'react-native';
import { getDatabase, ref, get, set, remove } from 'firebase/database';
import { Ionicons } from '@expo/vector-icons';
import { getAuth } from 'firebase/auth';
import Navbar from '../Navbar';
import MapView, { Polygon, Marker } from 'react-native-maps';

export default function GeofenceRequests({ navigation }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [mapVisible, setMapVisible] = useState(false);
  const [selectedPoints, setSelectedPoints] = useState([]);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const db = getDatabase();
      const requestsRef = ref(db, 'adminRequests/geofenceChanges');
      const resetRequestsRef = ref(db, 'adminRequests/geofenceReset');
      
      // Get geofence change requests
      const changeSnapshot = await get(requestsRef);
      const resetSnapshot = await get(resetRequestsRef);
      
      const allRequests = [];
      
      // Process change requests
      if (changeSnapshot.exists()) {
        Object.entries(changeSnapshot.val()).forEach(([teamCode, requestData]) => {
          // Ensure each request has a status field
          const status = requestData.status || 'pending';
          
          allRequests.push({
            id: teamCode,
            teamCode,
            type: 'change',
            status,
            ...requestData
          });
        });
      }
      
      // Process reset requests
      if (resetSnapshot.exists()) {
        Object.entries(resetSnapshot.val()).forEach(([teamCode, requestData]) => {
          // Ensure each request has a status field
          const status = requestData.status || 'pending';
          
          allRequests.push({
            id: teamCode + '_reset',
            teamCode,
            type: 'reset',
            status,
            ...requestData
          });
        });
      }
      
      console.log(`Found ${allRequests.length} geofence requests`);
      
      // Sort requests by date (newest first)
      allRequests.sort((a, b) => {
        return new Date(b.requestDate || 0) - new Date(a.requestDate || 0);
      });
      
      setRequests(allRequests);
    } catch (error) {
      console.error('Error loading requests:', error);
      Alert.alert('Error', 'Failed to load geofence requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (request) => {
    try {
      const db = getDatabase();
      const auth = getAuth();
      
      // Ask for confirmation
      Alert.alert(
        'Confirm Approval',
        `Are you sure you want to approve this ${request.type} request from ${request.ownerName}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Approve',
            style: 'default',
            onPress: async () => {
              setLoading(true);
              
              try {
                // Update request status to approved
                const requestPath = request.type === 'change' 
                  ? `adminRequests/geofenceChanges/${request.teamCode}`
                  : `adminRequests/geofenceReset/${request.teamCode}`;
                
                await set(ref(db, `${requestPath}/status`), 'approved');
                await set(ref(db, `${requestPath}/approvedBy`), {
                  uid: auth.currentUser.uid,
                  timestamp: new Date().toISOString()
                });
                
                // Create notification for the owner
                await set(ref(db, `notifications/${request.ownerId}/${Date.now()}`), {
                  title: `Geofence ${request.type === 'reset' ? 'Reset' : 'Change'} Approved`,
                  message: `Your request to ${request.type === 'reset' ? 'reset' : 'change'} the geofence has been approved.`,
                  type: 'geofence_approved',
                  timestamp: new Date().toISOString(),
                  read: false
                });
                
                // Reset owner's geofence points if it's a reset request
                if (request.type === 'reset') {
                  try {
                    console.log('Processing geofence reset approval for team', request.teamCode);
                    
                    // Clear existing geofence coordinates
                    await set(ref(db, `teams/${request.teamCode}/geofence/coordinates`), []);
                    
                    // Update geofence metadata
                    await set(ref(db, `teams/${request.teamCode}/geofence/lastModified`), new Date().toISOString());
                    await set(ref(db, `teams/${request.teamCode}/geofence/resetBy`), {
                      uid: auth.currentUser.uid,
                      timestamp: new Date().toISOString()
                    });
                    
                    // Set flag in owner's profile to redirect to initialization
                    console.log('Setting needsGeofenceSetup flag for owner', request.ownerId);
                    await set(ref(db, `users/${request.ownerId}/profile/needsGeofenceSetup`), true);
                    
                    console.log('Geofence reset successfully processed');
                  } catch (error) {
                    console.error('Error processing geofence reset:', error);
                    throw error; // Re-throw to be caught by the outer try/catch
                  }
                }
                
                // If it's a change request, update with the new coordinates
                if (request.type === 'change' && request.newCoordinates) {
                  await set(ref(db, `teams/${request.teamCode}/geofence/coordinates`), request.newCoordinates);
                  await set(ref(db, `teams/${request.teamCode}/geofence/lastModified`), new Date().toISOString());
                }
                
                Alert.alert('Success', 'Request approved successfully');
                loadRequests();
              } catch (error) {
                console.error('Error approving request:', error);
                Alert.alert('Error', 'Failed to approve request');
              } finally {
                setLoading(false);
              }
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error in handleApprove:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    }
  };

  const showRejectModal = (request) => {
    setSelectedRequest(request);
    setRejectReason('');
    setRejectModalVisible(true);
  };

  const handleReject = async () => {
    if (!selectedRequest) return;
    
    if (!rejectReason || rejectReason.trim() === '') {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }
    
    setLoading(true);
    try {
      const db = getDatabase();
      const auth = getAuth();
      
      // Update request status to rejected
      const requestPath = selectedRequest.type === 'change' 
        ? `adminRequests/geofenceChanges/${selectedRequest.teamCode}`
        : `adminRequests/geofenceReset/${selectedRequest.teamCode}`;
      
      await set(ref(db, `${requestPath}/status`), 'rejected');
      await set(ref(db, `${requestPath}/rejectedBy`), {
        uid: auth.currentUser.uid,
        timestamp: new Date().toISOString(),
        reason: rejectReason.trim()
      });
      
      // Create notification for the owner
      await set(ref(db, `notifications/${selectedRequest.ownerId}/${Date.now()}`), {
        title: `Geofence ${selectedRequest.type === 'reset' ? 'Reset' : 'Change'} Rejected`,
        message: `Your request to ${selectedRequest.type === 'reset' ? 'reset' : 'change'} the geofence has been rejected.\n\nReason: ${rejectReason}`,
        type: 'geofence_rejected',
        timestamp: new Date().toISOString(),
        reason: rejectReason,
        read: false
      });
      
      Alert.alert('Success', 'Request rejected successfully');
      setRejectModalVisible(false);
      loadRequests();
    } catch (error) {
      console.error('Error rejecting request:', error);
      Alert.alert('Error', 'Failed to reject request');
    } finally {
      setLoading(false);
    }
  };

  const showMapPreview = (points) => {
    setSelectedPoints(points);
    setMapVisible(true);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#F39C12';
      case 'approved': return '#2ECC71';
      case 'rejected': return '#E74C3C';
      default: return '#95A5A6';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const renderItem = ({ item }) => (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.requestInfo}>
          <Text style={styles.requestTitle}>
            {item.type === 'reset' ? 'Reset Request' : 'Change Request'}
          </Text>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.requestDate}>{formatDate(item.requestDate)}</Text>
      </View>
      
      <View style={styles.requestDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Team Code:</Text>
          <Text style={styles.detailValue}>{item.teamCode}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Owner:</Text>
          <Text style={styles.detailValue}>{item.ownerName}</Text>
        </View>
        {item.type === 'change' && item.newCoordinates && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>New Points:</Text>
            <Text style={styles.detailValue}>{item.newCoordinates.length} points</Text>
          </View>
        )}
        {item.type === 'reset' && item.currentPoints && (
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Current Points:</Text>
            <Text style={styles.detailValue}>{item.currentPoints.length} points</Text>
          </View>
        )}
      </View>
      
      {item.status === 'pending' && (
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.previewButton}
            onPress={() => showMapPreview(item.type === 'reset' ? item.currentPoints : item.newCoordinates)}
          >
            <Ionicons name="map-outline" size={18} color="#2196F3" />
            <Text style={styles.previewButtonText}>Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.approveButton}
            onPress={() => handleApprove(item)}
          >
            <Ionicons name="checkmark-outline" size={18} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.rejectButton}
            onPress={() => showRejectModal(item)}
          >
            <Ionicons name="close-outline" size={18} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {item.status !== 'pending' && (
        <View style={styles.statusInfoContainer}>
          {item.status === 'approved' && item.approvedBy && (
            <Text style={styles.statusInfoText}>
              Approved on {formatDate(item.approvedBy.timestamp)}
            </Text>
          )}
          {item.status === 'rejected' && item.rejectedBy && (
            <View>
              <Text style={styles.statusInfoText}>
                Rejected on {formatDate(item.rejectedBy.timestamp)}
              </Text>
              <Text style={styles.rejectionReason}>
                Reason: {item.rejectedBy.reason}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Geofence Requests</Text>
        <TouchableOpacity 
          style={styles.refreshButton}
          onPress={loadRequests}
        >
          <Ionicons name="refresh-outline" size={24} color="#2196F3" />
        </TouchableOpacity>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading requests...</Text>
        </View>
      ) : requests.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={64} color="#95A5A6" />
          <Text style={styles.emptyText}>No geofence requests found</Text>
        </View>
      ) : (
        <FlatList
          data={requests}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}
      
      {/* Reject Modal */}
      <Modal
        visible={rejectModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reject Request</Text>
            <Text style={styles.modalSubtitle}>Please provide a reason for rejection:</Text>
            
            <TextInput
              style={styles.rejectInput}
              placeholder="Enter reason for rejection"
              multiline={true}
              numberOfLines={4}
              value={rejectReason}
              onChangeText={setRejectReason}
            />
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelButton}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.confirmButton}
                onPress={handleReject}
              >
                <Text style={styles.confirmButtonText}>Confirm Rejection</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      
      {/* Map Preview Modal */}
      <Modal
        visible={mapVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setMapVisible(false)}
      >
        <View style={styles.mapModalContainer}>
          <View style={styles.mapModalContent}>
            <Text style={styles.modalTitle}>Geofence Preview</Text>
            
            <MapView 
              style={styles.map}
              initialRegion={selectedPoints.length > 0 ? {
                latitude: selectedPoints[0].latitude,
                longitude: selectedPoints[0].longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              } : null}
            >
              {selectedPoints.map((point, index) => (
                <Marker key={index} coordinate={point} title={`Point ${index + 1}`} />
              ))}
              {selectedPoints.length >= 3 && (
                <Polygon 
                  coordinates={selectedPoints} 
                  fillColor="rgba(0,0,255,0.3)" 
                  strokeColor="blue" 
                  strokeWidth={2} 
                />
              )}
            </MapView>
            
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={() => setMapVisible(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      <Navbar activePage="requests" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333333',
  },
  refreshButton: {
    padding: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
  },
  listContainer: {
    padding: 16,
    paddingBottom: 100,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  requestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  requestTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  requestDate: {
    fontSize: 12,
    color: '#95A5A6',
  },
  requestDetails: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666666',
    width: 100,
  },
  detailValue: {
    fontSize: 14,
    color: '#333333',
    flex: 1,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap:.12,
  },
  previewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2196F3',
    marginRight: 10,
  },
  previewButtonText: {
    color: '#2196F3',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2ECC71',
    padding: 8,
    borderRadius: 8,
    marginRight: 10,
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E74C3C',
    padding: 8,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  statusInfoContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  statusInfoText: {
    fontSize: 13,
    color: '#666666',
    fontStyle: 'italic',
  },
  rejectionReason: {
    fontSize: 13,
    fontWeight: '500',
    color: '#E74C3C',
    marginTop: 4,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 16,
  },
  rejectInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 20,
    gap: 10,
  },
  cancelButton: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#95A5A6',
  },
  cancelButtonText: {
    color: '#95A5A6',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#E74C3C',
    padding: 10,
    borderRadius: 8,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  mapModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  mapModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    height: '70%',
    maxWidth: 500,
  },
  map: {
    flex: 1,
    marginVertical: 16,
    borderRadius: 8,
  },
  closeButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 