import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set } from 'firebase/database';
import { getAdminConfig } from '../Components/Admin/adminConfig';

export const initializeAdmin = async () => {
  try {
    const auth = getAuth();
    const adminConfig = getAdminConfig();
    console.log('Initializing admin with config:', adminConfig);
    
    // Create admin account
    const userCredential = await createUserWithEmailAndPassword(
      auth,
      adminConfig.email,
      adminConfig.password
    );
    console.log('Admin account created:', userCredential.user.uid);

    // Set admin profile with verified status
    const db = getDatabase();
    const adminProfile = {
      firstName: adminConfig.firstName,
      lastName: adminConfig.lastName,
      email: adminConfig.email,
      createdAt: new Date().toISOString(),
      role: 'admin',
      isAdmin: true,
      isOwner: false,
      emailVerified: true
    };
    console.log('Setting admin profile:', adminProfile);

    await set(ref(db, `users/${userCredential.user.uid}/profile`), adminProfile);

    // Force update the user's email verified status
    await set(ref(db, `users/${userCredential.user.uid}/emailVerified`), true);

    console.log('Admin account created and verified successfully');
    return true;
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      console.log('Admin account already exists');
      return true;
    }
    console.error('Error creating admin account:', error);
    return false;
  }
}; 