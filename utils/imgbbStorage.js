import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage for uploaded images metadata
let uploadedImages = [];
const STORAGE_KEY = '@loctrack_captured_images';

const IMGBB_API_KEY = '2fd6dd451112e14b78d9795bed49504d';
const IMGBB_API_URL = 'https://api.imgbb.com/1/upload';

// Load saved images from AsyncStorage
const loadSavedImages = async () => {
  try {
    const savedImages = await AsyncStorage.getItem(STORAGE_KEY);
    if (savedImages) {
      uploadedImages = JSON.parse(savedImages);
      console.log('Loaded saved images:', uploadedImages.length);
    }
  } catch (error) {
    console.error('Error loading saved images:', error);
  }
};

// Save images to AsyncStorage
const saveImages = async () => {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(uploadedImages));
    console.log('Saved images to storage:', uploadedImages.length);
  } catch (error) {
    console.error('Error saving images:', error);
  }
};

// Initialize by loading saved images
loadSavedImages();

export const uploadImage = async (imageUri, filename) => {
  try {
    // Generate a more descriptive filename
    const date = new Date();
    const formattedDate = date.toISOString().split('T')[0];
    const formattedTime = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const captureNumber = (uploadedImages.length + 1).toString().padStart(3, '0');
    const newFilename = `capture_${formattedDate}_${formattedTime}_${captureNumber}.jpg`;

    // Remove the data:image/jpeg;base64, prefix if it exists
    const base64Data = imageUri.includes('base64,') 
      ? imageUri.split('base64,')[1] 
      : imageUri;

    // Prepare form data
    const formData = new FormData();
    formData.append('key', IMGBB_API_KEY);
    formData.append('image', base64Data);
    formData.append('name', newFilename);

    // Upload to ImgBB
    const response = await fetch(IMGBB_API_URL, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`ImgBB API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to upload to ImgBB');
    }

    // Create image metadata with more information
    const imageData = {
      name: newFilename,
      url: result.data.url,
      thumbnail: result.data.thumb?.url || result.data.url,
      deleteUrl: result.data.delete_url,
      timestamp: date.toISOString(),
      captureNumber: parseInt(captureNumber),
      size: result.data.size,
      width: result.data.width,
      height: result.data.height,
    };

    // Store metadata
    uploadedImages.push(imageData);
    
    // Save to persistent storage
    await saveImages();

    return imageData;
  } catch (error) {
    console.error('Error uploading to ImgBB:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

export const getUploadedImagesInfo = () => {
  return {
    totalFiles: uploadedImages.length,
    oldestCapture: uploadedImages[0]?.timestamp,
    newestCapture: uploadedImages[uploadedImages.length - 1]?.timestamp,
  };
};

export const listImages = () => {
  return [...uploadedImages].reverse(); // Most recent first
};

export const deleteImage = async (imageData) => {
  try {
    // Remove from array
    uploadedImages = uploadedImages.filter(img => img.url !== imageData.url);
    // Save updated list
    await saveImages();
    return true;
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
};

export const trackUpload = (imageData) => {
  console.log('Image uploaded to ImgBB:', {
    name: imageData.name,
    size: imageData.size,
    dimensions: `${imageData.width}x${imageData.height}`,
    captureNumber: imageData.captureNumber,
  });
}; 