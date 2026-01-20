import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { getFriends, getSelectedCharacter, getCharacters, setSelectedCharacter, deleteCharacter } from '../utils/api';
import EditCharacterLoadout from './EditCharacterLoadout';
import CharacterSelectionModal from './CharacterSelectionModal';
import '../styles/lobby.scss';

function Lobby() {
  const { user } = useAuth();
  const { onlineStatus, lobbyStatus, room, partyUpdate, lobbyInvitation, invitationResponse, matchmakingStatus, matchFound, clearLobbyInvitation, clearInvitationResponse, clearPartyUpdate, clearMatchmakingStatus, clearMatchFound } = useColyseus();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [party, setParty] = useState([user]); // Start with current user
  const [partyLeaderId, setPartyLeaderId] = useState(user?.id || null); // Track party leader
  const [selectedQueues, setSelectedQueues] = useState(['1v1', '2v2', '3v3']); // Array of selected queues - default to all
  const [pendingInvitations, setPendingInvitations] = useState({}); // Map of friendId -> invitation info
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [showCharacterSelectionModal, setShowCharacterSelectionModal] = useState(false);
  const [editingLoadout, setEditingLoadout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Track if we're in the process of joining a party via invitation
  const isJoiningPartyRef = useRef(false);
  // Track if we've navigated to game to prevent duplicate navigation
  const hasNavigatedToGameRef = useRef(false);

  // Check if user should be in lobby - redirect if not
  useEffect(() => {
    if (!user) {
      navigate('/dashboard');
      return;
    }
  }, [user, navigate]);

  useEffect(() => {
    if (user) {
      loadFriends();
      loadSelectedCharacter();
      loadCharacters();
      
      // Only initialize party if we're not joining someone else's party
      // and party is actually empty
      if (!isJoiningPartyRef.current && party.length === 0) {
        setParty([user]);
        setPartyLeaderId(user.id);
      } else if (!partyLeaderId && party.length > 0) {
        // If party exists but no leader, set first member as leader
        setPartyLeaderId(party[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Notify server when entering/leaving lobby
  useEffect(() => {
    if (room && user) {
      // Notify server that we're in lobby
      room.send('updateLobbyStatus', { inLobby: true });

      // Cleanup: notify server when leaving lobby
      return () => {
        if (room) {
          room.send('updateLobbyStatus', { inLobby: false });
        }
      };
    }
  }, [room, user]);

  // Handle invitation acceptance triggered from global handler
  useEffect(() => {
    const handleInvitationAccepted = (event) => {
      // Global handler triggered acceptance, now handle it here
      // Use invitation from event detail since it was cleared from context
      const invitation = event.detail?.invitation;
      console.log('Lobby: Received invitation acceptance event', invitation);
      
      if (invitation && room && user) {
        // Mark that we're joining a party (prevent initialization from resetting)
        isJoiningPartyRef.current = true;

        // Get inviter info from the invitation
        const inviterInfo = {
          id: invitation.inviterId,
          username: invitation.inviterUsername
        };

        // Join the inviter's party (use party info from invitation)
        // The inviter is the party leader
        if (invitation.partyInfo && invitation.partyInfo.partyMembers) {
          // Use the party info from the invitation
          const invitedParty = invitation.partyInfo.partyMembers.map(member => ({
            id: member.id,
            username: member.username
          }));
          
          // Add current user to the party
          if (!invitedParty.some(m => m.id === user.id)) {
            invitedParty.push({ id: user.id, username: user.username });
          }
          
          console.log('Lobby: Setting party to', invitedParty);
          
          // Set party to the inviter's party (including inviter, existing members, and us)
          setParty(invitedParty);
          
          // Set inviter as party leader
          setPartyLeaderId(invitation.inviterId);
          
          // Update selected queues to match inviter's queues
          if (invitation.partyInfo.queues) {
            setSelectedQueues(invitation.partyInfo.queues);
          }
        } else {
          // Fallback: create party with inviter and current user
          const fallbackParty = [inviterInfo, { id: user.id, username: user.username }];
          console.log('Lobby: Setting fallback party to', fallbackParty);
          setParty(fallbackParty);
          // Inviter is the leader
          setPartyLeaderId(invitation.inviterId);
        }

        // Send response to server
        room.send('respondToInvitation', {
          inviterId: invitation.inviterId,
          accepted: true,
          partyInfo: {
            queues: invitation.partyInfo?.queues || selectedQueues,
            currentSize: invitation.partyInfo?.currentSize || 1,
            maxSize: invitation.partyInfo?.maxSize || 1,
            partyMembers: invitation.partyInfo?.partyMembers || []
          }
        });

        // Broadcast party update to all party members (including inviter)
        // This ensures everyone sees the updated party
        const finalParty = invitation.partyInfo && invitation.partyInfo.partyMembers
          ? invitedParty
          : [inviterInfo, { id: user.id, username: user.username }];
        
        room.send('updateParty', {
          partyMembers: finalParty.map(m => ({ id: m.id, username: m.username })),
          partyLeaderId: invitation.inviterId,
          queues: invitation.partyInfo?.queues || selectedQueues
        });

        // Reset the flag after a short delay to allow state updates
        setTimeout(() => {
          isJoiningPartyRef.current = false;
        }, 1000);
      }
    };

    window.addEventListener('lobbyInvitationAccepted', handleInvitationAccepted);
    return () => {
      window.removeEventListener('lobbyInvitationAccepted', handleInvitationAccepted);
    };
  }, [room, user, selectedQueues]); // Removed lobbyInvitation since we use event detail

  // Handle invitation responses
  useEffect(() => {
    if (invitationResponse) {
      const { recipientId, recipientUsername, accepted } = invitationResponse;
      
      // Remove from pending invitations
      setPendingInvitations(prev => {
        const newPending = { ...prev };
        delete newPending[recipientId];
        return newPending;
      });

      if (accepted) {
        // Find the friend and add to party
        const friend = friends.find(f => f.id === recipientId);
        if (friend && !party.some(m => m.username === friend.username)) {
          const maxPartySize = getMaxPartySizeForQueues(selectedQueues);
          if (party.length < maxPartySize) {
            const newParty = [...party, friend];
            setParty(newParty);
            setError('');
            
            // Ensure party leader is set (current user is leader if they sent the invitation)
            const currentLeaderId = partyLeaderId || user.id;
            if (!partyLeaderId) {
              setPartyLeaderId(user.id);
            }
            
            // Broadcast party update to all party members
            if (room) {
              room.send('updateParty', {
                partyMembers: newParty.map(m => ({ id: m.id, username: m.username })),
                partyLeaderId: currentLeaderId,
                queues: selectedQueues
              });
            }
          } else {
            setError(`Party is full. ${friend.username} cannot join.`);
          }
        }
      } else {
        setError(`${recipientUsername} declined your invitation.`);
      }

      clearInvitationResponse();
    }
  }, [invitationResponse, friends, party, selectedQueues, clearInvitationResponse]);

  // Handle party updates from server (when someone leaves or is removed)
  useEffect(() => {
    if (partyUpdate && user) {
      const { partyMembers, partyLeaderId: updateLeaderId, queues } = partyUpdate;
      
      // Check if we're still in this party
      const isInParty = partyMembers.some(m => m.id === user.id);
      
      if (isInParty) {
        // Update party members
        const updatedParty = partyMembers.map(member => ({
          id: member.id,
          username: member.username
        }));
        setParty(updatedParty);
        
        // Update party leader if provided
        if (updateLeaderId) {
          setPartyLeaderId(updateLeaderId);
        }
        
        // Update queues if provided
        if (queues && queues.length > 0) {
          setSelectedQueues(queues);
        }
      } else {
        // We were removed from the party - redirect to dashboard
        // Notify server that we're leaving the lobby
        if (room) {
          room.send('updateLobbyStatus', { inLobby: false });
        }
        
        // Reset party state
        setParty([user]);
        setPartyLeaderId(user.id);
        
        // Navigate to dashboard
        navigate('/dashboard');
      }
      
      clearPartyUpdate();
    }
  }, [partyUpdate, user, room, navigate, clearPartyUpdate]);

  // Navigate to game when match is found
  useEffect(() => {
    if (matchFound && !hasNavigatedToGameRef.current) {
      hasNavigatedToGameRef.current = true;
      // Navigate to game with match info
      navigate('/game', {
        state: { matchInfo: matchFound }
      });
      // Clear match found from context after navigation
      clearMatchFound();
    }
  }, [matchFound, navigate, clearMatchFound]);

  const loadFriends = async () => {
    try {
      setLoading(true);
      const response = await getFriends(user.username);
      setFriends(response.friends || []);
    } catch (err) {
      setError(err.message || 'Failed to load friends');
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedCharacter = async () => {
    try {
      const response = await getSelectedCharacter(user.username);
      setSelectedCharacter(response.character || null);
    } catch (err) {
      console.error('Failed to load selected character:', err);
    }
  };

  const loadCharacters = async () => {
    try {
      const response = await getCharacters(user.username);
      setCharacters(response.characters || []);
    } catch (err) {
      console.error('Failed to load characters:', err);
    }
  };

  const handleSelectCharacter = async (characterId) => {
    try {
      await setSelectedCharacter(user.username, characterId);
      const character = characters.find(c => c._id.toString() === characterId);
      setSelectedCharacter(character);
      setShowCharacterSelectionModal(false);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to select character');
    }
  };

  const handleLoadoutUpdated = () => {
    loadSelectedCharacter();
    loadCharacters();
  };

  const handleCharacterCreated = async (newCharacter) => {
    // Reload characters to include the new one
    await loadCharacters();
    // If a new character was created and passed, select it
    if (newCharacter && newCharacter._id) {
      await handleSelectCharacter(newCharacter._id.toString());
    }
  };

  const handleCharacterDeleted = async (characterId, characterName) => {
    try {
      await deleteCharacter(user.username, characterId);
      // Reload characters and selected character
      await loadCharacters();
      await loadSelectedCharacter();
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to delete character');
    }
  };

  const handleInviteFriend = (friend) => {
    // Check if friend is already in party
    if (party.some(member => member.username === friend.username)) {
      return;
    }

    // Check if friend is in a lobby (can't invite)
    if (lobbyStatus[friend.id] === true) {
      setError(`${friend.username} is already in a lobby`);
      return;
    }

    // Check if invitation is already pending
    if (pendingInvitations[friend.id]) {
      setError('Invitation already sent to this friend');
      return;
    }

    // Check party size limits based on largest selected queue
    const maxPartySize = getMaxPartySizeForQueues(selectedQueues);
    if (party.length >= maxPartySize) {
      setError(`Party is full for selected queues (max ${maxPartySize} players)`);
      return;
    }

    // Send invitation via Colyseus
    if (room) {
      const partyInfo = {
        queues: selectedQueues,
        currentSize: party.length,
        maxSize: maxPartySize,
        partyMembers: party.map(m => ({ username: m.username, id: m.id }))
      };

      room.send('sendLobbyInvitation', {
        recipientId: friend.id,
        partyInfo: partyInfo
      });

      // Mark invitation as pending
      setPendingInvitations(prev => ({
        ...prev,
        [friend.id]: {
          friend: friend,
          timestamp: Date.now()
        }
      }));

      setError('');
    } else {
      setError('Not connected to server. Please refresh the page.');
    }
  };

  const handleRemoveFromParty = (username) => {
    // Only party leader can remove members
    if (partyLeaderId !== user.id) {
      setError('Only the party leader can remove members');
      return;
    }

    // Don't allow removing yourself (leader should leave instead)
    if (username === user.username) {
      return;
    }

    const memberToRemove = party.find(m => m.username === username);
    if (!memberToRemove) return;

    // Remove the member
    const newParty = party.filter(member => member.username !== username);
    let newLeaderId = partyLeaderId;

    // If removed member was the leader (shouldn't happen, but handle it), transfer leadership
    if (memberToRemove.id === partyLeaderId && newParty.length > 0) {
      newLeaderId = newParty[0].id;
      setPartyLeaderId(newLeaderId);
    }

    setParty(newParty);

    // Broadcast party update to ALL original party members (including the removed one)
    // This ensures the removed player receives the update and gets redirected
    if (room) {
      room.send('updateParty', {
        partyMembers: newParty.map(m => ({ id: m.id, username: m.username })),
        partyLeaderId: newLeaderId,
        queues: selectedQueues,
        // Include removed member ID so server can notify them too
        removedMemberId: memberToRemove.id
      });
    }
  };

  const handleLeaveParty = () => {
    // Cancel matchmaking if active
    if (room && matchmakingStatus) {
      room.send('cancelMatchmaking');
      clearMatchmakingStatus();
    }
    // Reset navigation ref
    hasNavigatedToGameRef.current = false;

    // Remove current user from party
    const newParty = party.filter(member => member.id !== user.id);
    let newLeaderId = partyLeaderId;

    // If leader leaves, transfer leadership to next member
    if (partyLeaderId === user.id && newParty.length > 0) {
      newLeaderId = newParty[0].id;
      setPartyLeaderId(newLeaderId);
    } else if (newParty.length === 0) {
      // If party is empty, reset leader
      newLeaderId = null;
      setPartyLeaderId(null);
    }

    setParty(newParty);

    // Broadcast party update to remaining party members
    if (room && newParty.length > 0) {
      room.send('updateParty', {
        partyMembers: newParty.map(m => ({ id: m.id, username: m.username })),
        partyLeaderId: newLeaderId,
        queues: selectedQueues
      });
    }

    // Notify server that we're leaving the lobby
    if (room) {
      room.send('updateLobbyStatus', { inLobby: false });
    }

    // Navigate back to dashboard
    navigate('/dashboard');
  };

  const handleQueueToggle = (queueType) => {
    // Check if queue is available for current party size
    const availableQueues = getAvailableQueues(party.length);
    if (!availableQueues.includes(queueType)) {
      // Queue is not available, don't allow selection
      return;
    }

    setSelectedQueues(prev => {
      const isSelected = prev.includes(queueType);
      let newQueues;
      
      if (isSelected) {
        // Remove queue
        newQueues = prev.filter(q => q !== queueType);
        // Ensure at least one queue is selected
        if (newQueues.length === 0) {
          return prev; // Don't allow deselecting all queues
        }
      } else {
        // Add queue (only if available)
        if (availableQueues.includes(queueType)) {
          newQueues = [...prev, queueType];
        } else {
          return prev; // Queue not available
        }
      }
      
      return newQueues;
    });
  };

  const getMaxPartySize = (queueType) => {
    switch (queueType) {
      case '1v1': return 1;
      case '2v2': return 2;
      case '3v3': return 3;
      default: return 1;
    }
  };

  const getMaxPartySizeForQueues = (queues) => {
    if (queues.length === 0) return 1;
    return Math.max(...queues.map(q => getMaxPartySize(q)));
  };

  // Get available queues based on current party size
  const getAvailableQueues = (partySize) => {
    const available = [];
    if (partySize <= 1) {
      available.push('1v1', '2v2', '3v3'); // All available for solo
    } else if (partySize === 2) {
      available.push('2v2', '3v3'); // 1v1 not available
    } else {
      available.push('3v3'); // Only 3v3 available for 3+
    }
    return available;
  };

  // Automatically remove unavailable queues when party size changes
  useEffect(() => {
    const availableQueues = getAvailableQueues(party.length);
    const currentAvailable = selectedQueues.filter(q => availableQueues.includes(q));
    
    // If some queues were removed, update selection
    if (currentAvailable.length !== selectedQueues.length) {
      // If no queues remain selected, select all available ones
      if (currentAvailable.length === 0) {
        setSelectedQueues(availableQueues);
      } else {
        setSelectedQueues(currentAvailable);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party.length]); // Only depend on party length, selectedQueues is used but we filter it

  const handleAcceptInvitation = () => {
    if (!lobbyInvitation || !room) return;

    // Get inviter info from the invitation
    const inviterInfo = {
      id: lobbyInvitation.inviterId,
      username: lobbyInvitation.inviterUsername
    };

    // Join the inviter's party (use party info from invitation)
    // The inviter is the party leader
    if (lobbyInvitation.partyInfo && lobbyInvitation.partyInfo.partyMembers) {
      // Use the party info from the invitation
      const invitedParty = lobbyInvitation.partyInfo.partyMembers.map(member => ({
        id: member.id,
        username: member.username
      }));
      
      // Add current user to the party
      if (!invitedParty.some(m => m.id === user.id)) {
        invitedParty.push({ id: user.id, username: user.username });
      }
      
      // Set party to the inviter's party (including inviter, existing members, and us)
      setParty(invitedParty);
      
      // Set inviter as party leader
      setPartyLeaderId(lobbyInvitation.inviterId);
      
      // Update selected queues to match inviter's queues
      if (lobbyInvitation.partyInfo.queues) {
        setSelectedQueues(lobbyInvitation.partyInfo.queues);
      }
    } else {
      // Fallback: create party with inviter and current user
      setParty([inviterInfo, { id: user.id, username: user.username }]);
      // Inviter is the leader
      setPartyLeaderId(lobbyInvitation.inviterId);
    }

    room.send('respondToInvitation', {
      inviterId: lobbyInvitation.inviterId,
      accepted: true,
      partyInfo: {
        queues: lobbyInvitation.partyInfo?.queues || selectedQueues,
        currentSize: lobbyInvitation.partyInfo?.currentSize || 1,
        maxSize: lobbyInvitation.partyInfo?.maxSize || getMaxPartySizeForQueues(selectedQueues),
        partyMembers: lobbyInvitation.partyInfo?.partyMembers || []
      }
    });

    clearLobbyInvitation();
    // Navigate to lobby if not already there
    if (window.location.pathname !== '/lobby') {
      navigate('/lobby');
    }
  };

  const handleDeclineInvitation = () => {
    if (!lobbyInvitation || !room) return;

    room.send('respondToInvitation', {
      inviterId: lobbyInvitation.inviterId,
      accepted: false,
      partyInfo: null
    });

    clearLobbyInvitation();
  };

  const handleStartMatchmaking = () => {
    if (!selectedCharacter) {
      setError('Please select a character before starting matchmaking');
      return;
    }

    if (!room) {
      setError('Not connected to server. Please wait for connection...');
      console.error('Room is null when trying to start matchmaking');
      return;
    }

    // Check if room is actually connected
    if (!room.sessionId) {
      setError('Connection not ready. Please wait...');
      console.error('Room exists but sessionId is missing');
      return;
    }

    try {
      // Send matchmaking request to server
      room.send('startMatchmaking', {
        queues: selectedQueues,
        partyMembers: party.map(m => ({ id: m.id, username: m.username })),
        characterId: selectedCharacter._id,
        characterName: selectedCharacter.name
      });

      console.log('Starting matchmaking:', {
        queues: selectedQueues,
        party: party.map(m => m.username),
        selectedCharacter: selectedCharacter
      });
      setError(''); // Clear any previous errors
    } catch (err) {
      console.error('Error sending matchmaking request:', err);
      setError('Failed to start matchmaking. Please try again.');
    }
  };

  const handleBackToDashboard = () => {
    // Cancel matchmaking if active
    if (room && matchmakingStatus) {
      room.send('cancelMatchmaking');
      clearMatchmakingStatus();
    }
    // Reset navigation ref
    hasNavigatedToGameRef.current = false;
    // Notify server that we're leaving the lobby
    if (room) {
      room.send('updateLobbyStatus', { inLobby: false });
    }
    // Navigate to dashboard
    navigate('/dashboard');
  };

  // Filter friends: show online friends who are NOT in party
  // Friends in lobby should be shown with different status
  const onlineFriends = friends.filter(friend => 
    onlineStatus[friend.id] === true && !party.some(m => m.id === friend.id)
  );

  const maxPartySize = getMaxPartySizeForQueues(selectedQueues);
  const isPartyFull = party.length >= maxPartySize;
  // Solo players can queue for any queue (matchmaking will find teammates)
  // For parties, check that party size doesn't exceed the maximum required size
  const isPartySizeValid = party.length === 1 || selectedQueues.length === 0 || party.length <= maxPartySize;

  return (
    <div className="lobby">
      <div className="lobby-header">
        <h1>Game Lobby</h1>
        <button className="back-button" onClick={handleBackToDashboard}>
          ← Back to Dashboard
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="lobby-content">
        <div className="lobby-left">
          <div className="character-display-lobby">
            {selectedCharacter ? (
              <div className="lobby-character-card">
                <div className="lobby-character-header">
                  <h3>Your Character</h3>
                  <div className="lobby-character-actions">
                    <button
                      className="change-character-btn-small"
                      onClick={() => setShowCharacterSelectionModal(true)}
                    >
                      Change
                    </button>
                    <button
                      className="edit-loadout-btn-small"
                      onClick={() => setEditingLoadout(true)}
                    >
                      Edit Loadout
                    </button>
                  </div>
                </div>
                <div className="lobby-character-info">
                  <div className="character-avatar-medium">
                    {selectedCharacter.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="lobby-character-details">
                    <div className="lobby-character-name">{selectedCharacter.name}</div>
                    <div className="lobby-character-meta">
                      <span className="lobby-character-class">{selectedCharacter.classId}</span>
                      <span className="lobby-character-level">Level {selectedCharacter.level}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="lobby-no-character">
                <h3>No Character Selected</h3>
                <p>Please select a character to play</p>
                {characters.length > 0 ? (
                  <button
                    className="select-character-btn-large"
                    onClick={() => setShowCharacterSelectionModal(true)}
                  >
                    Select Character
                  </button>
                ) : (
                  <p>No characters available. Create one on the dashboard.</p>
                )}
              </div>
            )}
          </div>

          <div className="queue-selection">
            <h2>Select Queues (Multiple)</h2>
            {party.length === 1 && (
              <p className="queue-info">
                When alone, you can queue for all three modes. You'll be matched in any available queue depending on player availability.
              </p>
            )}
            <div className="queue-options">
              {(() => {
                const availableQueues = getAvailableQueues(party.length);
                const is1v1Available = availableQueues.includes('1v1');
                const is2v2Available = availableQueues.includes('2v2');
                const is3v3Available = availableQueues.includes('3v3');
                
                return (
                  <>
                    <label className={`queue-option ${selectedQueues.includes('1v1') ? 'active' : ''} ${!is1v1Available ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedQueues.includes('1v1')}
                        onChange={() => handleQueueToggle('1v1')}
                        className="queue-checkbox"
                        disabled={!is1v1Available}
                      />
                      <div className="queue-content">
                        <div className="queue-icon">⚔️</div>
                        <div className="queue-name">1v1</div>
                        <div className="queue-desc">Solo Duel</div>
                        {!is1v1Available && <div className="queue-unavailable">Not available (party too large)</div>}
                      </div>
                    </label>
                    <label className={`queue-option ${selectedQueues.includes('2v2') ? 'active' : ''} ${!is2v2Available ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedQueues.includes('2v2')}
                        onChange={() => handleQueueToggle('2v2')}
                        className="queue-checkbox"
                        disabled={!is2v2Available}
                      />
                      <div className="queue-content">
                        <div className="queue-icon">⚔️⚔️</div>
                        <div className="queue-name">2v2</div>
                        <div className="queue-desc">Team Battle</div>
                        {!is2v2Available && <div className="queue-unavailable">Not available (party too large)</div>}
                      </div>
                    </label>
                    <label className={`queue-option ${selectedQueues.includes('3v3') ? 'active' : ''} ${!is3v3Available ? 'disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selectedQueues.includes('3v3')}
                        onChange={() => handleQueueToggle('3v3')}
                        className="queue-checkbox"
                        disabled={!is3v3Available}
                      />
                      <div className="queue-content">
                        <div className="queue-icon">⚔️⚔️⚔️</div>
                        <div className="queue-name">3v3</div>
                        <div className="queue-desc">Squad Match</div>
                        {!is3v3Available && <div className="queue-unavailable">Not available (party too large)</div>}
                      </div>
                    </label>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="party-section">
            <h2>Your Party ({party.length}/{maxPartySize})</h2>
            <div className="party-list">
              {party.map((member) => {
                const isLeader = member.id === partyLeaderId;
                const isCurrentUser = member.id === user.id;
                const canRemove = partyLeaderId === user.id && !isCurrentUser;
                
                return (
                  <div key={member.username} className="party-member">
                    <div className="member-info">
                      <div className="member-avatar">
                        {member.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="member-details">
                        <div className="member-name">
                          {member.username}
                          {isLeader && (
                            <span className="party-leader">
                              <span className="crown-icon">👑</span> Leader
                            </span>
                          )}
                        </div>
                        <div className="member-status online">Online</div>
                      </div>
                    </div>
                    {canRemove && (
                      <button
                        className="remove-member-btn"
                        onClick={() => handleRemoveFromParty(member.username)}
                        title="Remove from party"
                      >
                        ×
                      </button>
                    )}
                    {isCurrentUser && !isLeader && (
                      <button
                        className="leave-party-btn"
                        onClick={handleLeaveParty}
                        title="Leave party"
                      >
                        Leave
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="lobby-right">
          <div className="friends-section">
            <h2>Online Friends</h2>
            {loading ? (
              <div className="loading">Loading friends...</div>
            ) : onlineFriends.length === 0 ? (
              <div className="no-friends">No online friends available</div>
            ) : (
              <div className="friends-list">
                {onlineFriends.map(friend => {
                  const isInLobby = lobbyStatus[friend.id] === true;
                  const canInvite = !isInLobby && !isPartyFull;
                  
                  return (
                    <div key={friend.id} className={`friend-item ${isInLobby ? 'in-lobby' : ''}`}>
                      <div className="friend-info">
                        <div className="friend-avatar">
                          {friend.username.charAt(0).toUpperCase()}
                        </div>
                        <div className="friend-details">
                          <div className="friend-name">{friend.username}</div>
                          <div className={`friend-status ${isInLobby ? 'in-lobby' : 'online'}`}>
                            {isInLobby ? 'In Lobby' : 'Online'}
                          </div>
                        </div>
                      </div>
                      <button
                        className={`invite-btn ${canInvite ? '' : 'disabled'} ${pendingInvitations[friend.id] ? 'pending' : ''}`}
                        onClick={() => handleInviteFriend(friend)}
                        disabled={!canInvite || !!pendingInvitations[friend.id]}
                        title={
                          isInLobby ? 'Already in a lobby' : 
                          isPartyFull ? 'Party is full' : 
                          pendingInvitations[friend.id] ? 'Invitation pending' :
                          'Invite to party'
                        }
                      >
                        {isInLobby ? 'In Lobby' : pendingInvitations[friend.id] ? 'Pending...' : 'Invite'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lobby-actions">
        {!selectedCharacter && (
          <div className="character-warning">
            ⚠️ Please select a character before starting matchmaking
          </div>
        )}
        {matchmakingStatus && (
          <div className="matchmaking-status">
            <div className="matchmaking-message">
              🔍 {matchmakingStatus.message}
            </div>
            <button
              className="cancel-matchmaking-btn"
              onClick={() => {
                if (room) {
                  room.send('cancelMatchmaking');
                  clearMatchmakingStatus();
                }
              }}
            >
              Cancel Matchmaking
            </button>
          </div>
        )}
        {matchFound && (
          <div className="match-found">
            <h3>🎮 Match Found!</h3>
            <p>Redirecting to game...</p>
            <p>Queue: {matchFound.queueType}</p>
            <p>Team 1: {matchFound.team1.map(m => m.username).join(', ')}</p>
            <p>Team 2: {matchFound.team2.map(m => m.username).join(', ')}</p>
            <p>Match ID: {matchFound.matchId}</p>
          </div>
        )}
        {!matchmakingStatus && !matchFound && (
          <button
            className="start-matchmaking-btn"
            onClick={handleStartMatchmaking}
            disabled={!isPartySizeValid || selectedQueues.length === 0 || !selectedCharacter}
          >
            Start Matchmaking ({selectedQueues.length > 0 ? selectedQueues.join(', ') : 'No Queue Selected'})
          </button>
        )}
      </div>


      {showCharacterSelectionModal && (
        <CharacterSelectionModal
          characters={characters}
          selectedCharacter={selectedCharacter}
          onSelect={handleSelectCharacter}
          onClose={() => setShowCharacterSelectionModal(false)}
          onCharacterCreated={handleCharacterCreated}
          onCharacterDeleted={handleCharacterDeleted}
        />
      )}

      {editingLoadout && selectedCharacter && (
        <EditCharacterLoadout
          character={selectedCharacter}
          onClose={() => setEditingLoadout(false)}
          onLoadoutUpdated={handleLoadoutUpdated}
        />
      )}
    </div>
  );
}

export default Lobby;

