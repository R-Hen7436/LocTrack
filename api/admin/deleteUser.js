import { getAuth } from 'firebase-admin/auth';
import initializeFirebaseAdmin from '../../config/firebase-admin';

// Initialize Firebase Admin
initializeFirebaseAdmin();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Get Auth instance
    const auth = getAuth();

    // Delete the user using Admin SDK
    await auth.deleteUser(userId);

    // Log successful deletion
    console.log(`Successfully deleted auth user: ${userId}`);

    return res.status(200).json({ 
      message: 'User authentication deleted successfully',
      userId: userId 
    });
  } catch (error) {
    console.error('Error deleting user authentication:', error);
    
    // Check if user doesn't exist
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ 
        error: 'User authentication not found',
        code: error.code 
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to delete user authentication',
      code: error.code 
    });
  }
} 