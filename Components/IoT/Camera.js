import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, ActivityIndicator, Modal, Image, FlatList } from 'react-native';
import { WebView } from 'react-native-webview';
import io from 'socket.io-client';
import { Ionicons } from '@expo/vector-icons';
import Navbar from '../Navbar';
import { uploadImage, getUploadedImagesInfo, listImages, trackUpload } from '../../utils/imgbbStorage';
import { getDatabase, ref, set, serverTimestamp } from 'firebase/database';
import { getAuth } from 'firebase/auth';

export default function Camera({ navigation }) {
  const [connected, setConnected] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(null);
  const [faceData, setFaceData] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [serverAddress, setServerAddress] = useState('http://192.168.1.19:5000');
  const [streamUrl, setStreamUrl] = useState(null);
  const [loadingWebView, setLoadingWebView] = useState(true);
  const [checkingStorage, setCheckingStorage] = useState(false);
  const [storageInfo, setStorageInfo] = useState(null);
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);
  const socketRef = useRef(null);
  const webViewRef = useRef(null);
  const [forceHideLoading, setForceHideLoading] = useState(false);

  const updatePersonCount = async (count) => {
    try {
      const auth = getAuth();
      if (!auth.currentUser) {
        console.log('No authenticated user found');
        return;
      }

      const db = getDatabase();
      const cameraAnalyticsRef = ref(db, `cameraAnalytics/${auth.currentUser.uid}`);
      
      await set(cameraAnalyticsRef, {
        personCount: count,
        lastUpdated: serverTimestamp(),
        deviceId: serverAddress // Store the camera's IP/identifier
      });

      // Store historical data
      const historyRef = ref(db, `cameraAnalytics/${auth.currentUser.uid}/history/${Date.now()}`);
      await set(historyRef, {
        personCount: count,
        timestamp: serverTimestamp()
      });

    } catch (error) {
      console.error('Error updating person count:', error);
    }
  };

  useEffect(() => {
    console.log('Using server address:', serverAddress);
    connectToServer();
    
    return () => {
      disconnectServer();
    };
  }, []);

  const connectToServer = () => {
    console.log(`Connecting to server at ${serverAddress}`);
    const socket = io(serverAddress, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    socketRef.current = socket;
    
    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to camera server');
      
      // Request video stream on connection
      socket.emit('request_stream');
      console.log('Requested video stream');
      
      // Set quality to medium immediately after connection
      socket.emit('set_quality', { quality: 'medium' });
    });
    
    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from camera server');
    });
    
    socket.on('face_detected', (data) => {
      if (data && data.image) {
        setCurrentFrame(`data:image/jpeg;base64,${data.image}`);
        if (data.faces) {
          setFaceData(data.faces);
          console.log(`Detected ${data.faces.length} faces`);
          // Update person count in Firebase
          updatePersonCount(data.faces.length);
        }
      }
    });
    
    socket.on('stream_acknowledged', (data) => {
      console.log('Stream acknowledged:', data);
      if (data.stream_url) {
        setStreamUrl(data.stream_url);
      }
    });
    
    socket.on('frame_update', (data) => {
      if (data && data.faces) {
        setFaceData(data.faces);
        // Update person count in Firebase for frame updates too
        updatePersonCount(data.faces.length);
      }
    });
  };

  const disconnectServer = () => {
    if (socketRef.current) {
      console.log('Disconnecting socket');
      socketRef.current.disconnect();
    }
  };

  const changeServerIP = () => {
    Alert.prompt(
      "Change Server IP",
      "Enter server IP address:",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "OK",
          onPress: ip => {
            if (ip) {
              disconnectServer();
              setServerAddress(`http://${ip}:5000`);
              setTimeout(connectToServer, 500);
            }
          }
        }
      ],
      "plain-text",
      "192.168.1.19"
    );
  };

  const captureFrame = async () => {
    if (!socketRef.current || !socketRef.current.connected) {
      Alert.alert('Connection Error', 'Not connected to detection server');
      return;
    }
    
    setUploading(true);
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      console.log('Capturing frame...');
      socketRef.current.emit('request_capture');
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Capture request timed out')), 10000);
      });
      
      const resultPromise = new Promise((resolve) => {
        socketRef.current.once('capture_result', resolve);
      });
      
      const captureData = await Promise.race([resultPromise, timeoutPromise]);
      
      if (captureData.error) {
        throw new Error(captureData.error);
      }
      
      if (!captureData.image) {
        throw new Error('No image data received');
      }
      
      const filename = `capture_${timestamp}.jpg`;
      const imageUri = `data:image/jpeg;base64,${captureData.image}`;
      
      console.log('Uploading captured frame...');
      const result = await uploadImage(imageUri, filename);
      trackUpload(result);
      
      console.log('Successfully uploaded frame to ImgBB:', result.url);
      
      Alert.alert(
        "Frame Captured",
        "Image has been captured and uploaded to cloud storage. You can view it by clicking 'View Uploaded Images'.",
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("Error in capture process:", error);
      Alert.alert("Error", `Failed to capture image: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const checkStorage = async () => {
    try {
      setCheckingStorage(true);
      
      const info = getUploadedImagesInfo();
      setStorageInfo(info);
      
      const images = listImages();
      setUploadedImages(images);
      
      setShowStorageModal(true);
    } catch (error) {
      console.error("Error checking storage:", error);
      Alert.alert("Storage Check Error", `Could not check storage: ${error.message}`);
    } finally {
      setCheckingStorage(false);
    }
  };

  const handleWebViewMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === 'contentCheck' && data.hasContent) {
        setLoadingWebView(false);
        console.log('Content detected in WebView');
      }
      
      if (data.type === 'pageLoaded') {
        setLoadingWebView(false);
        console.log('WebView page loaded');
      }
    } catch (error) {
      console.log('Error parsing WebView message:', error);
    }
  };

  const WEBVIEW_INJECT_SCRIPT = `
    (function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'pageStartedLoading',
        time: Date.now()
      }));

      function checkContent() {
        const hasContent = document.body && 
          (document.getElementsByTagName('video').length > 0 ||
           document.getElementsByTagName('img').length > 0 ||
           document.getElementsByTagName('canvas').length > 0);

        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'contentCheck',
          hasContent: hasContent,
          time: Date.now()
        }));

        if (!hasContent) {
          setTimeout(checkContent, 500);
        }
      }

      checkContent();

      window.addEventListener('load', function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pageLoaded',
          time: Date.now()
        }));
        checkContent();
      });

      true;
    })();
  `;

  useEffect(() => {
    if (streamUrl) {
      const hideTimer = setTimeout(() => {
        setForceHideLoading(true);
        setLoadingWebView(false);
      }, 5000);
      
      return () => clearTimeout(hideTimer);
    }
  }, [streamUrl]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Camera Feed</Text>
        <View style={styles.headerInfo}>
          <Text style={[styles.statusText, { color: connected ? '#4CAF50' : '#F44336' }]}>
            {connected ? 'Connected' : 'Disconnected'}
          </Text>
          <Text style={styles.facesText}>Persons: {faceData.length}</Text>
          {!connected && (
            <TouchableOpacity 
              style={styles.changeIPButton}
              onPress={changeServerIP}
            >
              <Text style={styles.buttonText}>Change IP</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      <View style={styles.content}>
        {streamUrl ? (
          <>
            <WebView
              ref={webViewRef}
              source={{ uri: streamUrl }}
              style={styles.webView}
              onLoadStart={() => {
                if (!forceHideLoading) {
                  setLoadingWebView(true);
                }
              }}
              onLoad={() => setLoadingWebView(false)}
              onLoadEnd={() => setLoadingWebView(false)}
              onError={(e) => {
                console.log('WebView error:', e.nativeEvent);
                setLoadingWebView(false);
              }}
              onMessage={handleWebViewMessage}
              injectedJavaScript={WEBVIEW_INJECT_SCRIPT}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              scrollEnabled={false}
              bounces={false}
              originWhitelist={['*']}
              mixedContentMode="always"
              androidHardwareAccelerationDisabled={false}
              androidLayerType="hardware"
            />
            
            {(streamUrl && !forceHideLoading && loadingWebView) && (
              <TouchableOpacity 
                style={styles.loadingContainer}
                activeOpacity={0.9}
                onPress={() => {
                  setForceHideLoading(true);
                  setLoadingWebView(false);
                }}
              >
                <ActivityIndicator size="large" color="#2196F3" />
                <Text style={styles.loadingText}>Loading video stream...</Text>
                <Text style={styles.tapToDismissText}>Tap anywhere to dismiss</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.noFeedContainer}>
            <Text style={styles.noFeedText}>Waiting for camera stream...</Text>
            {!connected && (
              <TouchableOpacity 
                style={styles.retryButton}
                onPress={() => {
                  disconnectServer();
                  setTimeout(connectToServer, 500);
                }}
              >
                <Text style={styles.buttonText}>Retry Connection</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, uploading && styles.buttonDisabled]} 
          onPress={captureFrame}
          disabled={uploading || !streamUrl}
        >
          <Text style={styles.buttonText}>
            {uploading ? 'Uploading...' : 'Capture'}
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, styles.storageButton, checkingStorage && styles.buttonDisabled]} 
          onPress={checkStorage}
          disabled={checkingStorage}
        >
          <Text style={styles.buttonText}>
            {checkingStorage ? 'Checking Storage...' : 'View Uploaded Images'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showStorageModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowStorageModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Uploaded Images</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowStorageModal(false)}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
          
          {storageInfo && (
            <View style={styles.storageInfo}>
              <View style={styles.storageInfoRow}>
                <Text style={styles.storageInfoText}>
                  Total Files: {storageInfo.totalFiles}
                </Text>
                <TouchableOpacity 
                  style={styles.refreshButton}
                  onPress={checkStorage}
                >
                  <Text style={styles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          
          <FlatList
            data={uploadedImages}
            keyExtractor={(item, index) => `${item.name}-${index}`}
            numColumns={2}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.gridImageItem}
                onPress={() => setSelectedImage(item)}
              >
                <Image
                  source={{ uri: item.thumbnail || item.url }}
                  style={styles.gridThumbnail}
                  resizeMode="cover"
                />
                <View style={styles.gridImageDetails}>
                  <Text style={styles.gridImageName} numberOfLines={1} ellipsizeMode="middle">
                    {item.name.length > 20 ? item.name.substring(0, 18) + '...' : item.name}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.imageGridList}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={styles.emptyText}>No images uploaded yet. Capture some faces first!</Text>
              </View>
            }
          />
        </View>
      </Modal>

      <Modal
        visible={selectedImage !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <TouchableOpacity 
          style={styles.fullImageModalContainer} 
          activeOpacity={1} 
          onPress={() => setSelectedImage(null)}
        >
          <View style={styles.fullImageModalContent}>
            <View style={styles.fullImageHeader}>
              <Text style={styles.fullImageTitle} numberOfLines={1}>
                {selectedImage?.name || 'Image Preview'}
              </Text>
              <TouchableOpacity 
                style={styles.closeFullImageButton}
                onPress={() => setSelectedImage(null)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fullImageWrapper}>
              {selectedImage && (
                <Image
                  source={{ uri: selectedImage.url }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

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
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    zIndex: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
  },
  headerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  statusText: {
    fontWeight: '600',
    fontSize: 14,
  },
  facesText: {
    fontWeight: '600',
    fontSize: 14,
    color: '#424242',
  },
  changeIPButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  content: {
    flex: 1,
    backgroundColor: '#000',
    marginTop: -1,
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
    marginBottom: 200,
  },
  noFeedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    marginBottom: 200,
  },
  noFeedText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  loadingText: {
    color: '#fff',
    marginTop: 10,
    fontSize: 16,
  },
  tapToDismissText: {
    color: '#fff',
    marginTop: 15,
    opacity: 0.8,
    fontSize: 14,
  },
  buttonContainer: {
    padding: 15,
    paddingBottom: 110,
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 10,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    zIndex: 1,
  },
  button: {
    flex: 1,
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  storageButton: {
    backgroundColor: '#FF9800',
  },
  buttonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#2196F3',
  },
  modalTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
  },
  closeButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  storageInfo: {
    padding: 15,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  storageInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  storageInfoText: {
    fontSize: 16,
    color: '#333',
    fontWeight: 'bold',
  },
  refreshButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  refreshButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  imageGridList: {
    padding: 5,
  },
  gridImageItem: {
    flex: 1,
    margin: 5,
    backgroundColor: 'white',
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    maxWidth: '48%',
  },
  gridThumbnail: {
    width: '100%',
    height: 150,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  gridImageDetails: {
    padding: 8,
  },
  gridImageName: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyList: {
    padding: 50,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  fullImageModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImageModalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    width: '90%',
    height: '80%',
    overflow: 'hidden',
  },
  fullImageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#2196F3',
  },
  fullImageTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
    flex: 1,
    marginRight: 10,
  },
  closeFullImageButton: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 4,
  },
  fullImageWrapper: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
}); 