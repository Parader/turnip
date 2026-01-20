import pkg from 'colyseus';
const { Room } = pkg;
import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';

export class FriendRoom extends Room {
  // Map to store user sessions: userId -> Set of sessionIds
  userSessions = new Map();
  // Map to store last ping time for each session: sessionId -> timestamp
  lastPingTime = new Map();
  // Map to track users in lobby: userId -> boolean
  usersInLobby = new Map();
  // Matchmaking queues: queueType -> Set of { userId, partyMembers, characterId, characterName, client }
  matchmakingQueues = new Map();
  // Map to track which queues a user is in: userId -> Set of queueTypes
  userMatchmakingQueues = new Map();
  // Ping interval in milliseconds (30 seconds)
  pingInterval = 30000;
  // Timeout before marking as offline (60 seconds)
  pingTimeout = 60000;
  pingTimer = null;
  // Matchmaking check interval (every 2 seconds)
  matchmakingCheckInterval = 2000;
  matchmakingTimer = null;

  onCreate(options) {
    console.log('FriendRoom created');
    this.maxClients = 1000; // Allow many connections
    
    // Listen for pong responses from clients
    this.onMessage('pong', (client, message) => {
      this.lastPingTime.set(client.sessionId, Date.now());
    });

    // Listen for lobby invitation requests
    this.onMessage('sendLobbyInvitation', (client, message) => {
      const inviterUserId = client.userId;
      const { recipientId, partyInfo } = message;
      
      // Get inviter username from database
      this.getUserInfo(inviterUserId).then(inviterUser => {
        if (inviterUser) {
          this.sendLobbyInvitation(
            inviterUserId,
            inviterUser.username,
            recipientId,
            partyInfo
          );
        }
      }).catch(error => {
        console.error('Error sending lobby invitation:', error);
      });
    });

    // Listen for invitation responses
    this.onMessage('respondToInvitation', (client, message) => {
      const recipientUserId = client.userId;
      const { inviterId, accepted, partyInfo } = message;
      
      // Get recipient username from database
      this.getUserInfo(recipientUserId).then(recipientUser => {
        if (recipientUser) {
          this.notifyInvitationResponse(
            inviterId,
            recipientUserId,
            recipientUser.username,
            accepted,
            partyInfo
          );
        }
      }).catch(error => {
        console.error('Error responding to invitation:', error);
      });
    });

    // Listen for lobby status updates (entering/leaving lobby)
    this.onMessage('updateLobbyStatus', (client, message) => {
      const userId = client.userId;
      const { inLobby } = message;
      
      if (userId) {
        this.usersInLobby.set(userId, inLobby);
        // Broadcast lobby status to friends
        this.broadcastLobbyStatus(userId, inLobby);
      }
    });

    // Listen for party updates (when someone leaves or is removed)
    this.onMessage('updateParty', (client, message) => {
      const userId = client.userId;
      const { partyMembers, partyLeaderId, queues, removedMemberId } = message;
      
      if (userId && partyMembers) {
        // Broadcast party update to all party members (including removed member if specified)
        this.broadcastPartyUpdate(partyMembers, partyLeaderId, queues, removedMemberId);
      }
    });

    // Listen for matchmaking requests
    this.onMessage('startMatchmaking', (client, message) => {
      const userId = client.userId;
      const { queues, partyMembers, characterId, characterName } = message;
      
      if (userId && queues && queues.length > 0) {
        this.handleMatchmakingRequest(userId, client, queues, partyMembers, characterId, characterName);
      }
    });

    // Listen for matchmaking cancellation
    this.onMessage('cancelMatchmaking', (client, message) => {
      const userId = client.userId;
      if (userId) {
        this.handleMatchmakingCancel(userId);
      }
    });
    
    // Start ping interval
    this.pingTimer = setInterval(() => {
      this.checkClientConnections();
    }, this.pingInterval);

    // Initialize matchmaking queues
    this.matchmakingQueues.set('1v1', new Set());
    this.matchmakingQueues.set('2v2', new Set());
    this.matchmakingQueues.set('3v3', new Set());

    // Start matchmaking check interval
    this.matchmakingTimer = setInterval(() => {
      this.checkMatchmaking();
    }, this.matchmakingCheckInterval);
  }

  async getUserInfo(userId) {
    try {
      const db = getDatabase();
      const user = await db.collection('accounts').findOne({ _id: new ObjectId(userId) });
      if (user) {
        delete user.password;
      }
      return user;
    } catch (error) {
      console.error('Error getting user info:', error);
      return null;
    }
  }

  async onJoin(client, options) {
    const { userId } = options;
    
    if (!userId) {
      client.leave();
      return;
    }

    // Add session to user's sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId).add(client.sessionId);

    // Store userId in client metadata
    client.userId = userId;
    
    // Initialize ping time
    this.lastPingTime.set(client.sessionId, Date.now());

    // Send initial online status of all friends to the newly joined user
    await this.sendInitialFriendStatuses(userId, client);

    // Broadcast online status to friends
    await this.broadcastFriendStatus(userId, true);

    console.log(`User ${userId} joined (session: ${client.sessionId})`);
  }

  async sendInitialFriendStatuses(userId, client) {
    try {
      const db = getDatabase();
      const friendships = await db.collection('friendships').find({
        $or: [
          { userId: new ObjectId(userId), status: 'accepted' },
          { friendId: new ObjectId(userId), status: 'accepted' }
        ]
      }).toArray();

      const friendIds = friendships.map(f => 
        f.userId.toString() === userId ? f.friendId.toString() : f.userId.toString()
      );

      // Send status of all online friends
      for (const friendId of friendIds) {
        const isOnline = this.userSessions.has(friendId);
        client.send('friendStatusUpdate', {
          friendId: friendId,
          isOnline: isOnline,
        });
      }
    } catch (error) {
      console.error('Error sending initial friend statuses:', error);
    }
  }

  async onLeave(client, consented) {
    const userId = client.userId;

    // Clean up ping tracking
    this.lastPingTime.delete(client.sessionId);

    if (userId && this.userSessions.has(userId)) {
      const sessions = this.userSessions.get(userId);
      sessions.delete(client.sessionId);

      // If user has no more sessions, mark as offline and remove from matchmaking
      if (sessions.size === 0) {
        this.userSessions.delete(userId);
        await this.broadcastFriendStatus(userId, false);
        // Remove from matchmaking queues
        this.handleMatchmakingCancel(userId);
      }
    }

    console.log(`User ${userId} left (session: ${client.sessionId})`);
  }

  // Check client connections and send pings
  checkClientConnections() {
    const now = Date.now();
    const disconnectedSessions = [];

    // Send ping to all clients and check for timeouts
    for (const client of this.clients) {
      const sessionId = client.sessionId;
      const lastPing = this.lastPingTime.get(sessionId) || now;

      // Check if client hasn't responded to ping in timeout period
      if (now - lastPing > this.pingTimeout) {
        disconnectedSessions.push({ client, sessionId });
      } else {
        // Send ping
        try {
          client.send('ping', { timestamp: now });
        } catch (error) {
          console.error(`Error sending ping to session ${sessionId}:`, error);
          disconnectedSessions.push({ client, sessionId });
        }
      }
    }

    // Handle disconnected clients
    for (const { client, sessionId } of disconnectedSessions) {
      const userId = client.userId;
      this.lastPingTime.delete(sessionId);

      if (userId && this.userSessions.has(userId)) {
        const sessions = this.userSessions.get(userId);
        sessions.delete(sessionId);

        // If user has no more active sessions, mark as offline
        if (sessions.size === 0) {
          this.userSessions.delete(userId);
          this.broadcastFriendStatus(userId, false).catch(error => {
            console.error('Error broadcasting offline status:', error);
          });
        }
      }

      // Remove the client
      client.leave();
    }
  }

  async broadcastFriendStatus(userId, isOnline) {
    try {
      const db = getDatabase();
      const friendships = await db.collection('friendships').find({
        $or: [
          { userId: new ObjectId(userId), status: 'accepted' },
          { friendId: new ObjectId(userId), status: 'accepted' }
        ]
      }).toArray();

      const friendIds = friendships.map(f => 
        f.userId.toString() === userId ? f.friendId.toString() : f.userId.toString()
      );

      // Send status update to all online friends
      for (const friendId of friendIds) {
        if (this.userSessions.has(friendId)) {
          const friendSessions = this.userSessions.get(friendId);
          for (const sessionId of friendSessions) {
            const client = this.clients.find(c => c.sessionId === sessionId);
            if (client) {
              client.send('friendStatusUpdate', {
                friendId: userId,
                isOnline,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error broadcasting friend status:', error);
    }
  }

  // Notify user about new friend request
  notifyFriendRequest(recipientUserId, requesterUser) {
    if (this.userSessions.has(recipientUserId)) {
      const sessions = this.userSessions.get(recipientUserId);
      for (const sessionId of sessions) {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send('newFriendRequest', {
            requester: {
              id: requesterUser._id.toString(),
              username: requesterUser.username,
              email: requesterUser.email,
            }
          });
        }
      }
    }
  }

  // Notify user about accepted/declined friend request
  notifyRequestUpdate(recipientUserId, updateType, otherUser) {
    if (this.userSessions.has(recipientUserId)) {
      const sessions = this.userSessions.get(recipientUserId);
      for (const sessionId of sessions) {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send('friendRequestUpdate', {
            type: updateType, // 'accepted', 'declined', 'cancelled'
            user: {
              id: otherUser._id.toString(),
              username: otherUser.username,
              email: otherUser.email,
            }
          });
        }
      }
    }
  }

  // Notify user about friend list changes (friend added/removed)
  notifyFriendListUpdate(userId, updateType, friendUser) {
    if (this.userSessions.has(userId)) {
      const sessions = this.userSessions.get(userId);
      for (const sessionId of sessions) {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send('friendListUpdate', {
            type: updateType, // 'added', 'removed'
            friend: {
              id: friendUser._id.toString(),
              username: friendUser.username,
              email: friendUser.email,
            }
          });
        }
      }
    }
  }

  // Send lobby invitation to a user
  sendLobbyInvitation(inviterUserId, inviterUsername, recipientId, partyInfo) {
    // Check if recipient is in a lobby (can't invite if already in lobby)
    if (this.usersInLobby.get(recipientId) === true) {
      // Notify inviter that recipient is in lobby
      if (this.userSessions.has(inviterUserId)) {
        const sessions = this.userSessions.get(inviterUserId);
        for (const sessionId of sessions) {
          const client = this.clients.find(c => c.sessionId === sessionId);
          if (client) {
            client.send('invitationError', {
              recipientId: recipientId,
              error: 'User is already in a lobby'
            });
          }
        }
      }
      return;
    }

    // Check if recipient is online
    if (!this.userSessions.has(recipientId)) {
      // Notify inviter that recipient is offline
      if (this.userSessions.has(inviterUserId)) {
        const sessions = this.userSessions.get(inviterUserId);
        for (const sessionId of sessions) {
          const client = this.clients.find(c => c.sessionId === sessionId);
          if (client) {
            client.send('invitationError', {
              recipientId: recipientId,
              error: 'User is offline'
            });
          }
        }
      }
      return;
    }

    // Send invitation to recipient
    const sessions = this.userSessions.get(recipientId);
    for (const sessionId of sessions) {
      const client = this.clients.find(c => c.sessionId === sessionId);
      if (client) {
        client.send('lobbyInvitation', {
          inviterId: inviterUserId,
          inviterUsername: inviterUsername,
          partyInfo: partyInfo,
          timestamp: Date.now()
        });
      }
    }
  }

  // Notify inviter about invitation response
  notifyInvitationResponse(inviterId, recipientUserId, recipientUsername, accepted, partyInfo) {
    if (this.userSessions.has(inviterId)) {
      const sessions = this.userSessions.get(inviterId);
      for (const sessionId of sessions) {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send('invitationResponse', {
            recipientId: recipientUserId,
            recipientUsername: recipientUsername,
            accepted: accepted,
            partyInfo: partyInfo,
            timestamp: Date.now()
          });
        }
      }
    }
  }

  // Broadcast lobby status to friends
  async broadcastLobbyStatus(userId, inLobby) {
    try {
      const db = getDatabase();
      const friendships = await db.collection('friendships').find({
        $or: [
          { userId: new ObjectId(userId), status: 'accepted' },
          { friendId: new ObjectId(userId), status: 'accepted' }
        ]
      }).toArray();

      const friendIds = friendships.map(f => 
        f.userId.toString() === userId ? f.friendId.toString() : f.userId.toString()
      );

      // Send status update to all online friends
      for (const friendId of friendIds) {
        if (this.userSessions.has(friendId)) {
          const friendSessions = this.userSessions.get(friendId);
          for (const sessionId of friendSessions) {
            const client = this.clients.find(c => c.sessionId === sessionId);
            if (client) {
              client.send('lobbyStatusUpdate', {
                friendId: userId,
                inLobby: inLobby
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error broadcasting lobby status:', error);
    }
  }

  // Broadcast party update to all party members (and removed member if specified)
  broadcastPartyUpdate(partyMembers, partyLeaderId, queues, removedMemberId = null) {
    const partyMemberIds = partyMembers.map(m => m.id);
    
    // Send party update to all current party members
    for (const memberId of partyMemberIds) {
      if (this.userSessions.has(memberId)) {
        const memberSessions = this.userSessions.get(memberId);
        for (const sessionId of memberSessions) {
          const client = this.clients.find(c => c.sessionId === sessionId);
          if (client) {
            client.send('partyUpdate', {
              partyMembers: partyMembers,
              partyLeaderId: partyLeaderId,
              queues: queues,
              timestamp: Date.now()
            });
          }
        }
      }
    }
    
    // Also send update to removed member so they know they were removed
    if (removedMemberId && this.userSessions.has(removedMemberId)) {
      const removedMemberSessions = this.userSessions.get(removedMemberId);
      for (const sessionId of removedMemberSessions) {
        const client = this.clients.find(c => c.sessionId === sessionId);
        if (client) {
          client.send('partyUpdate', {
            partyMembers: partyMembers,
            partyLeaderId: partyLeaderId,
            queues: queues,
            timestamp: Date.now()
          });
        }
      }
    }
  }

  // Handle matchmaking request
  handleMatchmakingRequest(userId, client, queues, partyMembers, characterId, characterName) {
    // Remove user from all queues first (in case they were already queued)
    this.handleMatchmakingCancel(userId);

    // Add user to each selected queue
    const queueSet = new Set();
    for (const queueType of queues) {
      if (this.matchmakingQueues.has(queueType)) {
        const queue = this.matchmakingQueues.get(queueType);
        const matchmakingEntry = {
          userId,
          partyMembers,
          characterId,
          characterName,
          client,
          timestamp: Date.now()
        };
        queue.add(matchmakingEntry);
        queueSet.add(queueType);
      }
    }

    // Track which queues this user is in
    this.userMatchmakingQueues.set(userId, queueSet);

    // Notify client that matchmaking has started
    client.send('matchmakingStarted', {
      queues: Array.from(queueSet),
      message: `Searching for match in: ${Array.from(queueSet).join(', ')}`
    });

    console.log(`User ${userId} started matchmaking in queues: ${Array.from(queueSet).join(', ')}`);
  }

  // Handle matchmaking cancellation
  handleMatchmakingCancel(userId) {
    const userQueues = this.userMatchmakingQueues.get(userId);
    if (userQueues) {
      // Remove from all queues
      for (const queueType of userQueues) {
        const queue = this.matchmakingQueues.get(queueType);
        if (queue) {
          // Find and remove the entry for this user
          for (const entry of queue) {
            if (entry.userId === userId) {
              queue.delete(entry);
              break;
            }
          }
        }
      }
      this.userMatchmakingQueues.delete(userId);
    }
  }

  // Check for potential matches in all queues
  checkMatchmaking() {
    for (const [queueType, queue] of this.matchmakingQueues.entries()) {
      if (queue.size < 2) continue; // Need at least 2 entries to match

      const entries = Array.from(queue);
      const requiredPartySize = this.getRequiredPartySize(queueType);

      // Group entries by party size
      const entriesByPartySize = new Map();
      for (const entry of entries) {
        const partySize = entry.partyMembers.length;
        if (!entriesByPartySize.has(partySize)) {
          entriesByPartySize.set(partySize, []);
        }
        entriesByPartySize.get(partySize).push(entry);
      }

      // Try to match parties of the same size
      for (const [partySize, partyEntries] of entriesByPartySize.entries()) {
        if (partySize === requiredPartySize && partyEntries.length >= 2) {
          // Match the first two parties
          const party1 = partyEntries[0];
          const party2 = partyEntries[1];

          // Create match
          this.createMatch(queueType, party1, party2);
          return; // Process one match at a time
        }
      }
    }
  }

  // Get required party size for a queue type
  getRequiredPartySize(queueType) {
    switch (queueType) {
      case '1v1': return 1;
      case '2v2': return 2;
      case '3v3': return 3;
      default: return 1;
    }
  }

  // Create a match between two parties
  async createMatch(queueType, party1Entry, party2Entry) {
    // Remove both parties from all queues
    this.handleMatchmakingCancel(party1Entry.userId);
    this.handleMatchmakingCancel(party2Entry.userId);

    // Notify all party members from both parties
    const allPartyMembers = [
      ...party1Entry.partyMembers,
      ...party2Entry.partyMembers
    ];

    const matchId = `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const matchInfo = {
      queueType,
      team1: party1Entry.partyMembers,
      team2: party2Entry.partyMembers,
      matchId
    };

    // Fetch character data for both parties
    const { Character } = await import('../models/Character.js');
    const { ObjectId } = await import('mongodb');
    const { getDatabase } = await import('../config/database.js');
    
    let party1CharacterData = null;
    let party2CharacterData = null;
    
    try {
      const db = getDatabase();
      if (party1Entry.characterId) {
        party1CharacterData = await db.collection('characters').findOne({
          _id: new ObjectId(party1Entry.characterId)
        });
        if (party1CharacterData) {
          delete party1CharacterData.nameLower; // Remove internal field
        }
      }
      if (party2Entry.characterId) {
        party2CharacterData = await db.collection('characters').findOne({
          _id: new ObjectId(party2Entry.characterId)
        });
        if (party2CharacterData) {
          delete party2CharacterData.nameLower; // Remove internal field
        }
      }
    } catch (error) {
      console.error('Error fetching character data for match:', error);
    }

    // Create game room (will be created when first player joins)
    // Store match info for game room creation
    this.pendingMatches = this.pendingMatches || new Map();
    this.pendingMatches.set(matchId, {
      queueType,
      team1: party1Entry.partyMembers.map(m => ({
        id: m.id,
        username: m.username,
        characterId: party1Entry.characterId,
        characterName: party1Entry.characterName,
        characterClass: party1CharacterData?.classId || '',
        spellLoadout: party1CharacterData?.spellLoadout ? JSON.stringify(party1CharacterData.spellLoadout) : '[]'
      })),
      team2: party2Entry.partyMembers.map(m => ({
        id: m.id,
        username: m.username,
        characterId: party2Entry.characterId,
        characterName: party2Entry.characterName,
        characterClass: party2CharacterData?.classId || '',
        spellLoadout: party2CharacterData?.spellLoadout ? JSON.stringify(party2CharacterData.spellLoadout) : '[]'
      })),
      mapId: 'map_001', // Default map, can be selected based on queue
      startZones: null // Will be loaded from map data
    });

    // Send match found notification to all players
    for (const member of allPartyMembers) {
      if (this.userSessions.has(member.id)) {
        const sessions = this.userSessions.get(member.id);
        for (const sessionId of sessions) {
          const client = this.clients.find(c => c.sessionId === sessionId);
          if (client) {
            client.send('matchFound', matchInfo);
          }
        }
      }
    }

    console.log(`Match created for ${queueType}: Team 1 (${party1Entry.partyMembers.map(m => m.username).join(', ')}) vs Team 2 (${party2Entry.partyMembers.map(m => m.username).join(', ')})`);
  }

  onDispose() {
    // Clear ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    // Clear matchmaking timer
    if (this.matchmakingTimer) {
      clearInterval(this.matchmakingTimer);
      this.matchmakingTimer = null;
    }
    console.log('FriendRoom disposed');
  }
}

