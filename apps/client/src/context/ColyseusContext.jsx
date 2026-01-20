import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { connectToFriendRoom } from '../utils/colyseus';

const ColyseusContext = createContext(null);

// Module-level connection tracking to prevent duplicates across component instances
const globalConnections = new Map();

export function ColyseusProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [onlineStatus, setOnlineStatus] = useState({});
  const [lobbyStatus, setLobbyStatus] = useState({}); // friendId -> inLobby boolean
  const [partyUpdate, setPartyUpdate] = useState(null); // Party update from server
  const [friendRequestUpdates, setFriendRequestUpdates] = useState(null);
  const [friendListUpdates, setFriendListUpdates] = useState(null);
  const [lobbyInvitation, setLobbyInvitation] = useState(null);
  const [invitationResponse, setInvitationResponse] = useState(null);
  const [matchmakingStatus, setMatchmakingStatus] = useState(null); // { queues: [], message: '' }
  const [matchFound, setMatchFound] = useState(null); // Match info when found
  const [room, setRoom] = useState(null); // Track room in state so React re-renders when it changes
  const roomRef = useRef(null);
  const connectingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      // Clean up if user logs out
      if (roomRef.current) {
        const currentRoom = roomRef.current;
        roomRef.current.leave();
        roomRef.current = null;
        setRoom(null); // Update state to trigger re-render
        // Clean up from global connections
        for (const [uid, room] of globalConnections.entries()) {
          if (room === currentRoom) {
            globalConnections.delete(uid);
            break;
          }
        }
      }
      setOnlineStatus({});
      setLobbyStatus({});
      return;
    }

    const userId = user.id;
    let currentRoom = roomRef.current;

    // Clean up old connection if user changed
    if (currentRoom) {
      // Check if current room belongs to a different user
      let belongsToCurrentUser = false;
      for (const [uid, room] of globalConnections.entries()) {
        if (room === currentRoom && uid === userId) {
          belongsToCurrentUser = true;
          break;
        }
      }
      
      if (!belongsToCurrentUser) {
        // User changed, clean up old connection
        currentRoom.leave();
        roomRef.current = null;
        setRoom(null); // Update state to trigger re-render
        for (const [uid, room] of globalConnections.entries()) {
          if (room === currentRoom) {
            globalConnections.delete(uid);
            break;
          }
        }
        currentRoom = null;
      }
    }

    // Check if there's already a global connection for this user
    if (globalConnections.has(userId)) {
      const existingRoom = globalConnections.get(userId);
      // Verify the room is still connected (has sessionId means it's connected)
      if (existingRoom && existingRoom.sessionId) {
        roomRef.current = existingRoom;
        setRoom(existingRoom);
        return;
      } else {
        // Room exists but is disconnected, remove it
        globalConnections.delete(userId);
      }
    }

    // Prevent multiple simultaneous connections
    if (connectingRef.current) {
      return;
    }

    const connectToRoom = async () => {
      connectingRef.current = true;
      try {
        const friendRoom = await connectToFriendRoom(userId);
        roomRef.current = friendRoom;
        setRoom(friendRoom); // Update state to trigger re-render
        globalConnections.set(userId, friendRoom);

        // Listen for friend status updates
        friendRoom.onMessage('friendStatusUpdate', (message) => {
          setOnlineStatus(prev => {
            // Create a new object to ensure React detects the change
            const updated = { ...prev };
            updated[message.friendId] = message.isOnline;
            return updated;
          });
        });

        // Listen for new friend requests
        friendRoom.onMessage('newFriendRequest', (message) => {
          setFriendRequestUpdates({
            type: 'newRequest',
            requester: message.requester,
            timestamp: Date.now(),
          });
        });

        // Listen for friend request updates (accepted/declined)
        friendRoom.onMessage('friendRequestUpdate', (message) => {
          setFriendRequestUpdates({
            type: message.type,
            user: message.user,
            timestamp: Date.now(),
          });
        });

        // Listen for friend list updates (friend added/removed)
        friendRoom.onMessage('friendListUpdate', (message) => {
          setFriendListUpdates({
            type: message.type, // 'added', 'removed'
            friend: message.friend,
            timestamp: Date.now(),
          });
        });

        // Listen for ping and respond with pong
        friendRoom.onMessage('ping', (message) => {
          try {
            friendRoom.send('pong', { timestamp: message.timestamp });
          } catch (error) {
            console.error('Error sending pong:', error);
          }
        });

        // Listen for lobby invitations
        friendRoom.onMessage('lobbyInvitation', (message) => {
          setLobbyInvitation({
            inviterId: message.inviterId,
            inviterUsername: message.inviterUsername,
            partyInfo: message.partyInfo,
            timestamp: message.timestamp,
          });
        });

        // Listen for invitation responses
        friendRoom.onMessage('invitationResponse', (message) => {
          setInvitationResponse({
            recipientId: message.recipientId,
            recipientUsername: message.recipientUsername,
            accepted: message.accepted,
            partyInfo: message.partyInfo,
            timestamp: message.timestamp,
          });
        });

        // Listen for lobby status updates
        friendRoom.onMessage('lobbyStatusUpdate', (message) => {
          setLobbyStatus(prev => {
            const updated = { ...prev };
            updated[message.friendId] = message.inLobby;
            return updated;
          });
        });

        // Listen for invitation errors
        friendRoom.onMessage('invitationError', (message) => {
          console.warn('Invitation error:', message.error);
        });

        // Listen for party updates
        friendRoom.onMessage('partyUpdate', (message) => {
          setPartyUpdate({
            partyMembers: message.partyMembers,
            partyLeaderId: message.partyLeaderId,
            queues: message.queues,
            timestamp: message.timestamp
          });
        });

        // Listen for matchmaking status updates
        friendRoom.onMessage('matchmakingStarted', (message) => {
          setMatchmakingStatus({
            queues: message.queues,
            message: message.message
          });
        });

        // Listen for match found
        friendRoom.onMessage('matchFound', (message) => {
          setMatchFound({
            queueType: message.queueType,
            team1: message.team1,
            team2: message.team2,
            matchId: message.matchId
          });
          setMatchmakingStatus(null); // Clear matchmaking status
        });

        // Handle room leave/disconnect
        friendRoom.onLeave(() => {
          globalConnections.delete(userId);
          if (roomRef.current === friendRoom) {
            roomRef.current = null;
            setRoom(null); // Update state to trigger re-render
          }
        });
      } catch (error) {
        console.error('Failed to connect to friend room:', error);
        globalConnections.delete(userId);
        roomRef.current = null;
        setRoom(null); // Update state to trigger re-render
      } finally {
        connectingRef.current = false;
      }
    };

    connectToRoom();

    // Cleanup function
    return () => {
      // Only clean up if this is still the current user's connection
      if (roomRef.current && globalConnections.get(userId) === roomRef.current) {
        // Don't leave here - let the onLeave handler or user change handle it
        // This cleanup runs on unmount or dependency change
      }
      connectingRef.current = false;
    };
  }, [user?.id, isAuthenticated]);

  const value = {
    room, // Use state instead of ref so React re-renders when it changes
    onlineStatus,
    lobbyStatus,
    partyUpdate,
    friendRequestUpdates,
    friendListUpdates,
    lobbyInvitation,
    invitationResponse,
    matchmakingStatus,
    matchFound,
    clearFriendRequestUpdate: () => setFriendRequestUpdates(null),
    clearFriendListUpdate: () => setFriendListUpdates(null),
    clearLobbyInvitation: () => setLobbyInvitation(null),
    clearInvitationResponse: () => setInvitationResponse(null),
    clearPartyUpdate: () => setPartyUpdate(null),
    clearMatchmakingStatus: () => setMatchmakingStatus(null),
    clearMatchFound: () => setMatchFound(null),
    isConnected: !!room,
  };

  return (
    <ColyseusContext.Provider value={value}>
      {children}
    </ColyseusContext.Provider>
  );
}

export function useColyseus() {
  const context = useContext(ColyseusContext);
  if (!context) {
    throw new Error('useColyseus must be used within a ColyseusProvider');
  }
  return context;
}

