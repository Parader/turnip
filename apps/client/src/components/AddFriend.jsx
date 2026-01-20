import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { sendFriendRequest } from '../utils/api';
import '../styles/friends.scss';

function AddFriend({ onFriendAdded }) {
  const { user } = useAuth();
  const [friendUsername, setFriendUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!friendUsername.trim()) {
      setError('Please enter a username');
      return;
    }

    setLoading(true);

    try {
      await sendFriendRequest(user.username, friendUsername.trim());
      setSuccess('Friend request sent successfully!');
      setFriendUsername('');
      if (onFriendAdded) {
        onFriendAdded();
      }
    } catch (err) {
      setError(err.message || 'Failed to send friend request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="add-friend">
      <h2>Add Friend</h2>
      <form onSubmit={handleSubmit} className="add-friend-form">
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        
        <div className="form-group">
          <label htmlFor="friendUsername">Username</label>
          <input
            type="text"
            id="friendUsername"
            value={friendUsername}
            onChange={(e) => setFriendUsername(e.target.value)}
            placeholder="Enter friend's username"
            disabled={loading}
            required
          />
          <small>Enter the username of the person you want to send a friend request to (case insensitive)</small>
        </div>

        <button type="submit" className="add-friend-btn" disabled={loading}>
          {loading ? 'Sending...' : 'Send Friend Request'}
        </button>
      </form>
    </div>
  );
}

export default AddFriend;

