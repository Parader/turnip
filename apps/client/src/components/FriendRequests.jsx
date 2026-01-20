import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useColyseus } from '../context/ColyseusContext';
import { getPendingRequests, acceptFriendRequest, declineFriendRequest } from '../utils/api';
import '../styles/friends.scss';

function FriendRequests({ onRequestUpdated }) {
  const { user } = useAuth();
  const { friendRequestUpdates, clearFriendRequestUpdate } = useColyseus();
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      loadRequests();
    }
  }, [user]);

  // Listen for real-time friend request updates
  useEffect(() => {
    if (friendRequestUpdates) {
      // Reload requests when we get a real-time update
      loadRequests();
      
      // Clear the update after processing
      if (clearFriendRequestUpdate) {
        clearFriendRequestUpdate();
      }
    }
  }, [friendRequestUpdates]);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const response = await getPendingRequests(user.username);
      setRequests(response);
    } catch (err) {
      setError(err.message || 'Failed to load friend requests');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (friendUsername) => {
    try {
      await acceptFriendRequest(user.username, friendUsername);
      await loadRequests();
      if (onRequestUpdated) {
        onRequestUpdated();
      }
    } catch (err) {
      setError(err.message || 'Failed to accept friend request');
    }
  };

  const handleDecline = async (friendUsername) => {
    try {
      await declineFriendRequest(user.username, friendUsername);
      await loadRequests();
    } catch (err) {
      setError(err.message || 'Failed to decline friend request');
    }
  };

  if (loading) {
    return <div className="friends-loading">Loading requests...</div>;
  }

  const hasRequests = requests.incoming.length > 0 || requests.outgoing.length > 0;

  return (
    <div className="friend-requests">
      <h2>Friend Requests</h2>
      {error && <div className="error-message">{error}</div>}
      
      {!hasRequests ? (
        <p className="no-requests">No pending friend requests</p>
      ) : (
        <>
          {requests.incoming.length > 0 && (
            <div className="requests-section">
              <h3>Incoming Requests ({requests.incoming.length})</h3>
              <div className="requests-grid">
                {requests.incoming.map(request => (
                  <div key={request.id} className="request-card">
                    <div className="request-info">
                      <div className="request-avatar">
                        {request.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="request-details">
                        <div className="request-name">{request.username}</div>
                        <div className="request-email">{request.email}</div>
                      </div>
                    </div>
                    <div className="request-actions">
                      <button
                        onClick={() => handleAccept(request.username)}
                        className="accept-btn"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleDecline(request.username)}
                        className="decline-btn"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {requests.outgoing.length > 0 && (
            <div className="requests-section">
              <h3>Outgoing Requests ({requests.outgoing.length})</h3>
              <div className="requests-grid">
                {requests.outgoing.map(request => (
                  <div key={request.id} className="request-card">
                    <div className="request-info">
                      <div className="request-avatar">
                        {request.username.charAt(0).toUpperCase()}
                      </div>
                      <div className="request-details">
                        <div className="request-name">{request.username}</div>
                        <div className="request-email">{request.email}</div>
                      </div>
                    </div>
                    <div className="request-status">
                      <span className="pending-badge">Pending</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FriendRequests;

