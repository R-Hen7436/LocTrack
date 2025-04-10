import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, set, get } from 'firebase/database';
import { getAdminConfig } from '../Components/Admin/adminConfig';

export const initializeAdmin = async () => {
  try {
    const auth = getAuth();
    const adminConfig = getAdminConfig();
    console.log('Initializing admin with config:', adminConfig);
    
    let uid;
    
    try {
      // Try to sign in first to check if account exists
      const signInResult = await signInWithEmailAndPassword(
        auth,
        adminConfig.email,
        adminConfig.password
      );
      console.log('Admin account exists, signed in:', signInResult.user.uid);
      uid = signInResult.user.uid;
      
      // Sign out immediately after confirming account exists
      await auth.signOut();
      
    } catch (signInError) {
      if (signInError.code === 'auth/user-not-found') {
        // Create admin account if it doesn't exist
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          adminConfig.email,
          adminConfig.password
        );
        console.log('Admin account created:', userCredential.user.uid);
        uid = userCredential.user.uid;
        
        // Sign out after creating
        await auth.signOut();
      } else {
        throw signInError; // Re-throw other errors
      }
    }
    
    // If we have a valid UID, ensure the profile exists
    if (uid) {
      const db = getDatabase();
      
      // Check if profile already exists
      const profileRef = ref(db, `users/${uid}/profile`);
      const profileSnapshot = await get(profileRef);
      
      if (!profileSnapshot.exists()) {
        // Create admin profile
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
        
        await set(ref(db, `users/${uid}/profile`), adminProfile);
        await set(ref(db, `users/${uid}/emailVerified`), true);
        
        console.log('Admin profile created successfully');
      } else {
        console.log('Admin profile already exists');
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error initializing admin account:', error);
    return false;
  }
}; 