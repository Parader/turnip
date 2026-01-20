import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { getFriends, removeFriend } from '../utils/api';
import '../styles/friends.scss';

function FriendsList() {
  const { user } = useAuth();
  const { onlineStatus, friendListUpdates, clearFriendListUpdate } = useColyseus();
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    loadFriends();
  }, [user]);

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
                <div className={`status-indicator ${onlineStatus[friend.id] ? 'online' : 'offline'}`}>
                  {onlineStatus[friend.id] ? 'Online' : 'Offline'}
                </div>
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

