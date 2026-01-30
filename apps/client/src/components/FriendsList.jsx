import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { getFriends, removeFriend } from '../utils/api';
import '../styles/friends.scss';

function FriendsList() {
  const { user } = useAuth();
  const { onlineStatus, lobbyStatus, gameStatus, friendListUpdates, clearFriendListUpdate, room } = useColyseus();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    loadFriends();
  }, [user]);

  // Request friend statuses when component mounts and room is connected
  useEffect(() => {
    if (room && room.sessionId && user) {
      // Request fresh friend statuses to ensure accuracy
      try {
        room.send('requestFriendStatuses', {});
      } catch (error) {
        console.error('Error requesting friend statuses in FriendsList:', error);
      }
    }
  }, [room, user]);


  // Listen for real-time friend list updates
  useEffect(() => {
    if (friendListUpdates && user) {
      // Reload friends when we get a real-time update
      loadFriends();
      
      // Clear the update after processing
      if (clearFriendListUpdate) {
        clearFriendListUpdate();
      }
    }
  }, [friendListUpdates, user, clearFriendListUpdate]);

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

  // Request friend statuses after friends are loaded
  useEffect(() => {
    if (friends.length > 0 && room && room.sessionId) {
      // Request fresh friend statuses after loading friends to ensure accuracy
      try {
        room.send('requestFriendStatuses', {});
      } catch (error) {
        console.error('Error requesting friend statuses after loading friends:', error);
      }
    }
  }, [friends.length, room]);

  const handleRemoveFriend = async (friendUsername) => {
    if (!window.confirm('Are you sure you want to remove this friend?')) {
      return;
    }

    try {
      await removeFriend(user.username, friendUsername);
      // Real-time update will automatically reload the friends list
    } catch (err) {
      setError(err.message || 'Failed to remove friend');
    }
  };

  if (loading) {
    return <div className="friends-loading">Loading friends...</div>;
  }

  return (
    <div className="friends-list">
      <h2>Friends ({friends.length})</h2>
      {error && <div className="error-message">{error}</div>}
      
      {friends.length === 0 ? (
        <p className="no-friends">No friends yet. Add some friends to see them here!</p>
      ) : (
        <div className="friends-grid">
          {friends.map(friend => (
            <div key={friend.id} className="friend-card">
              <div className="friend-info">
                <div className="friend-avatar">
                  {friend.username.charAt(0).toUpperCase()}
                </div>
                <div className="friend-details">
                  <div className="friend-name">{friend.username}</div>
                  <div className="friend-email">{friend.email}</div>
                </div>
              </div>
              <div className="friend-actions">
                {(() => {
                  const isOnline = onlineStatus[friend.id] === true;
                  const isInLobby = lobbyStatus[friend.id] === true;
                  const isInGame = gameStatus[friend.id] === true;
                  
                  let statusText = 'Offline';
                  let statusClass = 'offline';
                  
                  if (isInGame) {
                    statusText = 'In Game';
                    statusClass = 'in-game';
                  } else if (isInLobby) {
                    statusText = 'In Lobby';
                    statusClass = 'in-lobby';
                  } else if (isOnline) {
                    statusText = 'Online';
                    statusClass = 'online';
                  }
                  
                  return (
                    <div className={`status-indicator ${statusClass}`}>
                      {statusText}
                    </div>
                  );
                })()}
                <button
                  onClick={() => handleRemoveFriend(friend.username)}
                  className="remove-friend-btn"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FriendsList;

