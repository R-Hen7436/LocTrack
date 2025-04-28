import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import theme from '../../constants/theme';

/**
 * A customizable button component with various styles and animation effects
 * 
 * @param {Object} props - Component props
 * @param {string} props.variant - Button variant ('primary', 'secondary', 'outline', 'text')
 * @param {string} props.size - Button size ('lg', 'md', 'sm')
 * @param {string} props.label - Button text
 * @param {Function} props.onPress - Function to call when button is pressed
 * @param {boolean} props.isLoading - Whether to show a loading indicator
 * @param {boolean} props.disabled - Whether the button is disabled
 * @param {string} props.leftIcon - Name of icon to show on the left
 * @param {string} props.rightIcon - Name of icon to show on the right
 * @param {Object} props.style - Additional styles for the button
 * @param {Object} props.textStyle - Additional styles for the button text
 */
const Button = ({
  variant = 'primary',
  size = 'md',
  label,
  onPress,
  isLoading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
}) => {
  // Animation value for press effect
  const animatedScale = React.useRef(new Animated.Value(1)).current;

  // Handle button press animations
  const handlePressIn = () => {
    Animated.spring(animatedScale, {
      toValue: 0.97,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(animatedScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
  };

  // Determine button style based on variant
  const getButtonStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.secondaryButton;
      case 'outline':
        return styles.outlineButton;
      case 'text':
        return styles.textButton;
      default:
        return styles.primaryButton;
    }
  };

  // Determine text style based on variant
  const getTextStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.secondaryButtonText;
      case 'outline':
        return styles.outlineButtonText;
      case 'text':
        return styles.textButtonText;
      default:
        return styles.primaryButtonText;
    }
  };

  // Determine button size
  const getSizeStyle = () => {
    switch (size) {
      case 'lg':
        return styles.lgButton;
      case 'sm':
        return styles.smButton;
      default:
        return styles.mdButton;
    }
  };

  // Determine text size
  const getTextSizeStyle = () => {
    switch (size) {
      case 'lg':
        return styles.lgButtonText;
      case 'sm':
        return styles.smButtonText;
      default:
        return styles.mdButtonText;
    }
  };

  return (
    <Animated.View style={{ transform: [{ scale: animatedScale }] }}>
      <TouchableOpacity
        style={[
          styles.button,
          getButtonStyle(),
          getSizeStyle(),
          disabled && styles.disabledButton,
          style,
        ]}
        onPress={onPress}
        disabled={disabled || isLoading}
        activeOpacity={0.8}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        {isLoading ? (
          <ActivityIndicator
            color={variant === 'primary' ? 'white' : theme.colors.primary}
            size={size === 'sm' ? 'small' : 'small'}
          />
        ) : (
          <View style={styles.buttonContent}>
            {leftIcon && (
              <Ionicons
                name={leftIcon}
                size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20}
                color={
                  variant === 'primary'
                    ? 'white'
                    : variant === 'text' 
                      ? theme.colors.primary 
                      : theme.colors.primary
                }
                style={styles.leftIcon}
              />
            )}
            
            <Text
              style={[
                styles.buttonText,
                getTextStyle(),
                getTextSizeStyle(),
                textStyle,
              ]}
            >
              {label}
            </Text>
            
            {rightIcon && (
              <Ionicons
                name={rightIcon}
                size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20}
                color={
                  variant === 'primary'
                    ? 'white'
                    : variant === 'text' 
                      ? theme.colors.primary 
                      : theme.colors.primary
                }
                style={styles.rightIcon}
              />
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontWeight: '600',
    textAlign: 'center',
  },
  // Variants
  primaryButton: {
    backgroundColor: theme.colors.primary,
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  primaryButtonText: {
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: `${theme.colors.primary}20`, // Primary with 20% opacity
  },
  secondaryButtonText: {
    color: theme.colors.primary,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
  },
  outlineButtonText: {
    color: theme.colors.primary,
  },
  textButton: {
    backgroundColor: 'transparent',
  },
  textButtonText: {
    color: theme.colors.primary,
  },
  // Sizes
  lgButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  mdButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  smButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  // Text sizes
  lgButtonText: {
    fontSize: 18,
  },
  mdButtonText: {
    fontSize: 16,
  },
  smButtonText: {
    fontSize: 14,
  },
  // States
  disabledButton: {
    opacity: 0.5,
  },
  // Icons
  leftIcon: {
    marginRight: 8,
  },
  rightIcon: {
    marginLeft: 8,
  },
});

export default Button; 