import { Client } from 'colyseus.js';

const getWsUrl = () => {
  // Get base URL from environment or default
  const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
  const url = new URL(apiUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}`;
};

export const colyseusClient = new Client(getWsUrl());

export async function connectToFriendRoom(userId) {
  try {
    const room = await colyseusClient.joinOrCreate('friendRoom', { userId });
    return room;
  } catch (error) {
    console.error('Failed to connect to friend room:', error);
    throw error;
  }
}

export async function connectToGameRoom(matchId, userId, matchInfo = null) {
  try {
    // Pass match info if available to help initialize the room
    const options = { matchId, userId };
    if (matchInfo) {
      options.queueType = matchInfo.queueType;
      options.team1 = matchInfo.team1;
      options.team2 = matchInfo.team2;
    }
    const room = await colyseusClient.joinOrCreate('gameRoom', options);
    return room;
  } catch (error) {
    console.error('Failed to connect to game room:', error);
    throw error;
  }
}

