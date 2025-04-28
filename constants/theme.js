const theme = {
  colors: {
    // Modern color palette with more vibrant primary colors
    primary: '#3B82F6', // Bright blue - main brand color
    primaryDark: '#2563EB', // Darker blue for hover/active states
    primaryLight: '#93C5FD', // Lighter blue for backgrounds, etc.
    secondary: '#6366F1', // Indigo - secondary brand color
    accent: '#EC4899', // Pink - accent color for highlights
    
    // Neutral colors
    background: '#F9FAFB', // Very light grey for app background
    backgroundAlt: '#F3F4F6', // Alternative background for cards
    card: '#FFFFFF', // White for cards and panels
    
    // Text colors
    text: {
      primary: '#1F2937', // Dark grey (almost black) for primary text
      secondary: '#6B7280', // Medium grey for secondary text
      tertiary: '#9CA3AF', // Lighter grey for tertiary text
      light: '#FFFFFF', // White text on dark backgrounds
      muted: '#D1D5DB', // Very light grey for muted text
    },
    
    // UI element colors
    border: '#E5E7EB', // Light border color
    divider: '#F3F4F6', // Very light divider color
    shadow: 'rgba(0, 0, 0, 0.05)', // Subtle shadow color
    
    // Status colors
    success: '#10B981', // Green for success states
    error: '#EF4444', // Red for errors
    warning: '#F59E0B', // Amber for warnings
    info: '#3B82F6', // Blue for information
    
    // Additional UI colors
    backdrop: 'rgba(15, 23, 42, 0.5)', // Semi-transparent dark backdrop
    overlay: 'rgba(255, 255, 255, 0.8)', // Semi-transparent light overlay
  },
  
  // Typography system
  typography: {
    // Font families
    fontFamily: {
      base: 'System', // Default system font
      heading: 'System', // Can be changed to a custom font for headings
      mono: 'monospace', // Monospaced font for code, etc.
    },
    
    // Font sizes
    h1: {
      fontSize: 28,
      fontWeight: '700',
      lineHeight: 1.2,
    },
    h2: {
      fontSize: 24,
      fontWeight: '700',
      lineHeight: 1.2,
    },
    h3: {
      fontSize: 20,
      fontWeight: '600',
      lineHeight: 1.3,
    },
    h4: {
      fontSize: 18,
      fontWeight: '600',
      lineHeight: 1.3,
    },
    body: {
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 1.5,
    },
    bodySmall: {
      fontSize: 14,
      fontWeight: '400',
      lineHeight: 1.5,
    },
    caption: {
      fontSize: 12,
      fontWeight: '400',
      lineHeight: 1.4,
    },
    button: {
      fontSize: 16,
      fontWeight: '600',
      lineHeight: 1.5,
    },
    buttonSmall: {
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 1.5,
    },
  },
  
  // Spacing scale (based on 4px)
  spacing: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    '2xl': 64,
    '3xl': 80,
  },
  
  // Border radius scale
  borderRadius: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32,
    full: 9999,
  },
  
  // Shadow styles
  shadows: {
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    },
    sm: {
      shadowColor: 'rgba(0, 0, 0, 0.05)',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: 'rgba(0, 0, 0, 0.07)',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
      elevation: 3,
    },
    lg: {
      shadowColor: 'rgba(0, 0, 0, 0.1)',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 5,
    },
    xl: {
      shadowColor: 'rgba(0, 0, 0, 0.12)',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 10,
    },
  },
  
  // Component specific styles
  components: {
    // Card components
    card: {
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      padding: 16,
      ...{
        shadowColor: 'rgba(0, 0, 0, 0.07)',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
        elevation: 3,
      },
    },
    
    // Button styles
    button: {
      // Primary solid button
      primary: {
        backgroundColor: '#3B82F6',
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
        ...{
          shadowColor: 'rgba(59, 130, 246, 0.3)',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.4,
          shadowRadius: 4,
          elevation: 3,
        },
      },
      
      // Secondary outline button
      secondary: {
        backgroundColor: 'transparent',
        borderColor: '#3B82F6',
        borderWidth: 1.5,
        borderRadius: 12,
        paddingVertical: 14,
        paddingHorizontal: 24,
      },
      
      // Tertiary text button
      tertiary: {
        backgroundColor: 'transparent',
        paddingVertical: 12,
        paddingHorizontal: 16,
      },
      
      // Icon button
      icon: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
      },
    },
    
    // Input field styles
    input: {
      backgroundColor: '#F9FAFB',
      borderRadius: 12,
      borderColor: '#E5E7EB',
      borderWidth: 1.5,
      paddingVertical: 14,
      paddingHorizontal: 16,
      fontSize: 16,
      color: '#1F2937',
    },
    
    // Navigation components
    tabBar: {
      backgroundColor: '#FFFFFF',
      borderRadius: 24,
      height: 72,
      paddingHorizontal: 16,
      ...{
        shadowColor: 'rgba(0, 0, 0, 0.1)',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 5,
      },
    },
    
    // Header/navbar
    header: {
      height: 64,
      backgroundColor: '#FFFFFF',
      borderBottomColor: '#F3F4F6',
      borderBottomWidth: 1,
      ...{
        shadowColor: 'rgba(0, 0, 0, 0.05)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      },
    },
  },
};

export default theme; 