import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { getDatabase, ref, set, push, get } from 'firebase/database';
import { logAudit, AUDIT_ACTIONS } from '../utils/auditLogger';

export default function TeamManager({ navigation, userId }) {
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [inviteCode, setInviteCode] = useState('');

  const generateInviteCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  const createTeam = async () => {
    const db = getDatabase();
    const teamRef = ref(db, `teams/${userId}`);
    const newCode = generateInviteCode();

    await set(teamRef, {
      name: teamName,
      owner: userId,
      inviteCode: newCode,
      createdAt: new Date().toISOString()
    });

    setInviteCode(newCode);
    await logAudit(AUDIT_ACTIONS.TEAM_CREATED, { teamName }, userId);
  };

  // Add more team management functions here
} 