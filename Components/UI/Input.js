import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import theme from '../../constants/theme';

/**
 * Modern input component with floating label, icon, and animated focus effects
 * 
 * @param {Object} props - Component props
 * @param {string} props.label - Input label
 * @param {string} props.value - Input value
 * @param {Function} props.onChangeText - Function to call when text changes
 * @param {string} props.placeholder - Input placeholder
 * @param {boolean} props.secureTextEntry - Whether the input is password field
 * @param {string} props.leftIcon - Name of icon to show on the left
 * @param {string} props.rightIcon - Name of icon to show on the right
 * @param {Function} props.onRightIconPress - Function to call when right icon is pressed
 * @param {string} props.keyboardType - Keyboard type
 * @param {string} props.autoCapitalize - Auto capitalize behavior
 * @param {Object} props.containerStyle - Additional styles for container
 * @param {Object} props.inputStyle - Additional styles for input
 * @param {string} props.errorText - Error message to display
 * @param {boolean} props.disabled - Whether the input is disabled
 * @param {boolean} props.floatingLabel - Whether to use floating label animation
 */
const Input = ({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  leftIcon,
  rightIcon,
  onRightIconPress,
  keyboardType = 'default',
  autoCapitalize = 'none',
  containerStyle,
  inputStyle,
  errorText,
  disabled = false,
  floatingLabel = false,
  returnKeyType,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const animatedLabelPosition = React.useRef(new Animated.Value(value ? 1 : 0)).current;
  const animatedBorderWidth = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Animate label position when value changes
    Animated.timing(animatedLabelPosition, {
      toValue: (isFocused || value) ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();

    // Animate border width when focus changes
    Animated.timing(animatedBorderWidth, {
      toValue: isFocused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [isFocused, value, animatedLabelPosition, animatedBorderWidth]);

  // Interpolate animated values
  const labelFontSize = animatedLabelPosition.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 12],
  });

  const labelTop = animatedLabelPosition.interpolate({
    inputRange: [0, 1],
    outputRange: [16, -10],
  });

  const borderColor = animatedBorderWidth.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.colors.border, theme.colors.primary],
  });

  const handleFocus = () => setIsFocused(true);
  const handleBlur = () => setIsFocused(false);

  return (
    <View style={[styles.container, containerStyle]}>
      <Animated.View
        style={[
          styles.inputContainer,
          !floatingLabel && styles.inputContainerNonFloating,
          {
            borderColor: errorText ? theme.colors.error : borderColor,
            backgroundColor: disabled ? `${theme.colors.backgroundAlt}80` : theme.colors.backgroundAlt,
          },
        ]}
      >
        {/* Floating label */}
        {floatingLabel && (
          <Animated.Text
            style={[
              styles.label,
              leftIcon && styles.labelWithLeftIcon,
              {
                top: labelTop,
                fontSize: labelFontSize,
                color: errorText 
                  ? theme.colors.error 
                  : isFocused 
                    ? theme.colors.primary 
                    : theme.colors.text.secondary,
                zIndex: 1,
              },
            ]}
          >
            {label}
          </Animated.Text>
        )}

        {/* Regular label for non-floating */}
        {!floatingLabel && label && (
          <Text style={styles.staticLabel}>{label}</Text>
        )}

        <View style={styles.inputRow}>
          {/* Left icon */}
          {leftIcon && (
            <View style={styles.leftIconContainer}>
              <Ionicons
                name={leftIcon}
                size={20}
                color={
                  errorText
                    ? theme.colors.error
                    : isFocused
                      ? theme.colors.primary
                      : theme.colors.text.secondary
                }
              />
            </View>
          )}

          {/* Input field */}
          <TextInput
            style={[
              styles.input,
              leftIcon && styles.inputWithLeftIcon,
              rightIcon && styles.inputWithRightIcon,
              inputStyle,
              disabled && styles.disabledInput,
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={(!floatingLabel || isFocused) ? placeholder : ''}
            placeholderTextColor={theme.colors.text.tertiary}
            secureTextEntry={secureTextEntry}
            keyboardType={keyboardType}
            autoCapitalize={autoCapitalize}
            onFocus={handleFocus}
            onBlur={handleBlur}
            editable={!disabled}
            returnKeyType={returnKeyType}
          />

          {/* Right icon */}
          {rightIcon && (
            <TouchableOpacity
              style={styles.rightIconContainer}
              onPress={onRightIconPress}
              disabled={disabled}
            >
              <Ionicons
                name={rightIcon}
                size={20}
                color={
                  errorText
                    ? theme.colors.error
                    : isFocused
                      ? theme.colors.primary
                      : theme.colors.text.secondary
                }
              />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Error message */}
      {errorText && (
        <Text style={styles.errorText}>{errorText}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },
  inputContainer: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.backgroundAlt,
    position: 'relative',
    minHeight: 50,
  },
  inputContainerNonFloating: {
    paddingVertical: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 24,
  },
  label: {
    position: 'absolute',
    left: 16,
    top: -8,
    backgroundColor: theme.colors.backgroundAlt,
    paddingHorizontal: 4,
    fontWeight: '500',
    marginLeft: 6,
    zIndex: 1,
    fontSize: 11,
  },
  labelWithLeftIcon: {
    marginLeft: 24,
  },
  staticLabel: {
    fontSize: 14,
    color: theme.colors.text.secondary,
    marginBottom: 6,
    fontWeight: '500',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.text.primary,
    paddingVertical: 0,
    height: 24,
  },
  inputWithLeftIcon: {
    paddingLeft: 8,
  },
  inputWithRightIcon: {
    paddingRight: 8,
  },
  leftIconContainer: {
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: 20,
    height: 20,
  },
  rightIconContainer: {
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
    width: 20,
    height: 20,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 11,
    marginTop: 4,
    marginLeft: 8,
  },
  disabledInput: {
    color: theme.colors.text.tertiary,
  },
});

export default Input; 