import { initializeApp, getApps, cert } from 'firebase-admin/app';

const initializeFirebaseAdmin = () => {
  try {
    // Check if Firebase Admin is already initialized
    if (getApps().length === 0) {
      // Get service account credentials from environment variables
      const serviceAccount = {
        type: process.env.FIREBASE_ADMIN_TYPE,
        project_id: process.env.FIREBASE_ADMIN_PROJECT_ID,
        private_key_id: process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_ADMIN_CLIENT_ID,
        auth_uri: process.env.FIREBASE_ADMIN_AUTH_URI,
        token_uri: process.env.FIREBASE_ADMIN_TOKEN_URI,
        auth_provider_x509_cert_url: process.env.FIREBASE_ADMIN_AUTH_PROVIDER_CERT_URL,
        client_x509_cert_url: process.env.FIREBASE_ADMIN_CLIENT_CERT_URL
      };

      // Initialize the app with credentials
      initializeApp({
        credential: cert(serviceAccount)
      });

      console.log('Firebase Admin initialized successfully');
    }
  } catch (error) {
    console.error('Error initializing Firebase Admin:', error);
    throw new Error('Failed to initialize Firebase Admin');
  }
};

export default initializeFirebaseAdmin; 