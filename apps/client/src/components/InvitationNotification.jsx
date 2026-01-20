import React from 'react';
import '../styles/lobby.scss';

function InvitationNotification({ invitation, onAccept, onDecline }) {
  if (!invitation) return null;

  return (
    <div className="invitation-notification" onClick={(e) => {
      // Close on backdrop click (but not on content click)
      if (e.target === e.currentTarget) {
        onDecline();
      }
    }}>
      <div className="invitation-content" onClick={(e) => e.stopPropagation()}>
        <div className="invitation-header">
          <h3>🎮 Lobby Invitation</h3>
        </div>
        <div className="invitation-body">
          <p>
            <strong>{invitation.inviterUsername}</strong> invited you to join their party!
          </p>
          {invitation.partyInfo && (
            <div className="invitation-details">
              <div><strong>Queues:</strong> {invitation.partyInfo.queues?.join(', ') || 'N/A'}</div>
              <div><strong>Party Size:</strong> {invitation.partyInfo.currentSize || 1}/{invitation.partyInfo.maxSize || 1}</div>
            </div>
          )}
        </div>
        <div className="invitation-actions">
          <button className="invitation-btn accept-btn" onClick={onAccept}>
            ✓ Accept
          </button>
          <button className="invitation-btn decline-btn" onClick={onDecline}>
            ✕ Decline
          </button>
        </div>
      </div>
    </div>
  );
}

export default InvitationNotification;

