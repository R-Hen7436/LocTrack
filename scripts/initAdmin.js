import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set } from 'firebase/database';
import { getAdminConfig } from '../Components/Admin/adminConfig';

export const initializeAdmin = async () => {
  try {
    const auth = getAuth();
    const adminConfig = getAdminConfig();
    
    // Create admin account
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      adminConfig.email,
      adminConfig.password
    );

    // Set email verified directly in the user profile
    const db = getDatabase();
    await set(ref(db, `users/${userCredential.user.uid}/profile`), {
      firstName: adminConfig.firstName,
      lastName: adminConfig.lastName,
      email: adminConfig.email,
      createdAt: new Date().toISOString(),
      role: 'admin',
      isAdmin: true,
      isOwner: false,
      emailVerified: true
    });

    // Force update the user's email verified status
    await set(ref(db, `users/${userCredential.user.uid}/emailVerified`), true);

    console.log('Admin account created and verified successfully');
    return true;
  } catch (error) {
    console.error('Error creating admin account:', error);
    return false;
  }
}; 