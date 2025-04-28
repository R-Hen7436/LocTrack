import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform,
  SafeAreaView,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import theme from '../../constants/theme';
import { Button, Card, Input } from '../UI';

export default function ForgotPassword({ navigation }) {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);

    const handleResetPassword = async () => {
        if (!email.trim()) {
            setError('Please enter your email');
            return;
        }

        setLoading(true);
        try {
            const auth = getAuth();
            await sendPasswordResetEmail(auth, email);
            setMessage('Password reset email sent. Please check your inbox.');
            setError('');
        } catch (error) {
            setError(error.message);
            setMessage('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardAvoidingView}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={styles.container}>
                        <View style={styles.headerContainer}>
                            <Text style={styles.title}>Reset password</Text>
                            <Text style={styles.subtitle}>Enter your email to receive a reset link</Text>
                        </View>
                        
                        <Card style={styles.formCard}>
                            <View style={styles.formContainer}>
                                <Input
                                    label="Email"
                                    value={email}
                                    onChangeText={setEmail}
                                    placeholder="Enter your email"
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    errorText={error && email.length === 0 ? 'Email is required' : ''}
                                    floatingLabel={true}
                                />
                                
                                {error && !error.includes('required') ? (
                                    <Text style={styles.errorText}>{error}</Text>
                                ) : null}
                                
                                {message ? <Text style={styles.successText}>{message}</Text> : null}
                                
                                <Button
                                    variant="primary"
                                    label="Send Reset Email"
                                    onPress={handleResetPassword}
                                    isLoading={loading}
                                    disabled={loading}
                                    size="lg"
                                    style={styles.resetButton}
                                />
                                
                                <View style={styles.loginContainer}>
                                    <Text style={styles.loginText}>Remember your password? </Text>
                                    <Button 
                                        variant="text" 
                                        label="Back to Login" 
                                        onPress={() => navigation.navigate('Login')}
                                        size="sm"
                                        style={styles.loginButton}
                                        textStyle={styles.loginButtonText}
                                    />
                                </View>
                            </View>
                        </Card>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    keyboardAvoidingView: {
        flex: 1,
    },
    container: {
        flex: 1,
        padding: 24,
        justifyContent: 'center',
    },
    headerContainer: {
        marginBottom: 8,
        alignItems: 'flex-start',
        width: '100%',
    },
    title: {
        fontSize: 32,
        fontWeight: '700',
        color: theme.colors.text.primary,
        marginBottom: 2,
    },
    subtitle: {
        ...theme.typography.bodyMedium,
        color: theme.colors.text.secondary,
        fontSize: 16,
        marginBottom: 8,
    },
    formCard: {
        padding: 24,
        marginBottom: 24,
    },
    formContainer: {
        width: '100%',
    },
    resetButton: {
        marginTop: 16,
        marginBottom: 16,
    },
    errorText: {
        color: theme.colors.error,
        ...theme.typography.bodySmall,
        marginBottom: 16,
        textAlign: 'center',
    },
    successText: {
        color: theme.colors.success,
        ...theme.typography.bodySmall,
        marginBottom: 16,
        textAlign: 'center',
    },
    loginContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 16,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: 'rgba(0,0,0,0.05)',
    },
    loginText: {
        color: '#333333',
        fontSize: 14,
        fontWeight: '400',
    },
    loginButton: {
        marginLeft: -8,
    },
    loginButtonText: {
        fontWeight: '600',
        color: theme.colors.primary,
    }
});
