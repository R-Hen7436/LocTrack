/**
 * Generate a secure random password
 * @param {number} length - Password length (default: 12)
 * @returns {string} - The generated password
 */
export const generateSecurePassword = (length = 12) => {
  const uppercaseChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluding similar-looking characters like I, O
  const lowercaseChars = 'abcdefghijkmnpqrstuvwxyz'; // Excluding similar-looking characters like l, o
  const numberChars = '23456789'; // Excluding 0, 1 for clarity
  const specialChars = '@#$%&*!?';
  
  const allChars = uppercaseChars + lowercaseChars + numberChars + specialChars;
  
  // Ensure minimum requirements (at least one of each character type)
  let password = '';
  password += uppercaseChars.charAt(Math.floor(Math.random() * uppercaseChars.length));
  password += lowercaseChars.charAt(Math.floor(Math.random() * lowercaseChars.length));
  password += numberChars.charAt(Math.floor(Math.random() * numberChars.length));
  password += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
  
  // Fill the rest with random characters
  for (let i = password.length; i < length; i++) {
    const randomChar = allChars.charAt(Math.floor(Math.random() * allChars.length));
    password += randomChar;
  }
  
  // Shuffle the password characters to avoid predictable patterns
  return shuffleString(password);
};

/**
 * Shuffle a string to randomize character order
 * @param {string} str - The string to shuffle
 * @returns {string} - Shuffled string
 */
const shuffleString = (str) => {
  const arr = str.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}; 