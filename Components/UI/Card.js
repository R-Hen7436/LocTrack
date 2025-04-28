import React from 'react';
import { View, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import theme from '../../constants/theme';

/**
 * A customizable card component with various variants
 * 
 * @param {Object} props - Component props
 * @param {string} props.variant - Card variant ('default', 'elevated', 'outlined', 'flat')
 * @param {boolean} props.interactive - Whether the card is touchable
 * @param {Function} props.onPress - Function to call when card is pressed (if interactive)
 * @param {Object} props.style - Additional styles for the card
 * @param {number} props.elevation - Custom elevation level (1-5)
 * @param {string} props.backgroundColor - Custom background color
 * @param {ReactNode} props.children - Card content
 */
const Card = ({
  variant = 'default',
  interactive = false,
  onPress,
  style,
  elevation = 2,
  backgroundColor,
  children,
}) => {
  // Determine card style based on variant
  const getCardStyle = () => {
    switch (variant) {
      case 'elevated':
        return styles.elevatedCard;
      case 'outlined':
        return styles.outlinedCard;
      case 'flat':
        return styles.flatCard;
      default:
        return styles.defaultCard;
    }
  };

  // Generate custom shadow based on elevation
  const getShadowStyle = () => {
    if (variant === 'flat' || variant === 'outlined') return {};

    // Calculate shadow properties based on elevation
    const shadowOpacity = 0.1 + (elevation * 0.03);
    const shadowRadius = 2 + (elevation * 2);
    const shadowHeight = 1 + (elevation);
    
    return Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: shadowHeight },
        shadowOpacity,
        shadowRadius,
      },
      android: {
        elevation: elevation + 1,
      },
    });
  };

  // Wrapper component based on interactivity
  const CardWrapper = interactive ? TouchableOpacity : View;
  const interactiveProps = interactive ? {
    onPress,
    activeOpacity: 0.9,
  } : {};

  return (
    <CardWrapper
      style={[
        styles.card,
        getCardStyle(),
        getShadowStyle(),
        backgroundColor && { backgroundColor },
        style,
      ]}
      {...interactiveProps}
    >
      {children}
    </CardWrapper>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    backgroundColor: theme.colors.card,
  },
  defaultCard: {
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  elevatedCard: {
    ...Platform.select({
      ios: {
        shadowColor: theme.colors.shadow,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  outlinedCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...Platform.select({
      ios: {
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
      },
      android: {
        elevation: 0,
      },
    }),
  },
  flatCard: {
    borderWidth: 0,
    backgroundColor: theme.colors.backgroundAlt,
    ...Platform.select({
      ios: {
        shadowColor: 'transparent',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0,
        shadowRadius: 0,
      },
      android: {
        elevation: 0,
      },
    }),
  },
});

export default Card; 