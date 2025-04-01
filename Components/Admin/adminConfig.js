const ADMIN_CONFIG = {
  email: 'ab@loctrack.com',  // Change this to your desired admin email
  password: '123456',    // Change this to your desired admin password
  firstName: 'Shrekinator',
  lastName: 'ForLayf'
};

export const isAdminEmail = (email) => {
  return email.toLowerCase() === ADMIN_CONFIG.email.toLowerCase();
};

export const getAdminConfig = () => ADMIN_CONFIG; 