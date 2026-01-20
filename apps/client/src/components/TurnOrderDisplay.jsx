import React from 'react';
import '../styles/turnOrderDisplay.scss';

const TurnOrderDisplay = ({ gameState, currentUserId }) => {
  if (!gameState || !gameState.turnOrder || gameState.turnOrder.length === 0) {
    return null;
  }

  // Get all players from both teams to display their info
  const allPlayers = {};
  if (gameState.myTeam && gameState.myTeam.players) {
    Object.values(gameState.myTeam.players).forEach(player => {
      allPlayers[player.userId] = { ...player, isMyTeam: true };
    });
  }
  if (gameState.enemyTeam && gameState.enemyTeam.players) {
    Object.values(gameState.enemyTeam.players).forEach(player => {
      allPlayers[player.userId] = { ...player, isMyTeam: false };
    });
  }

  const isMyTurn = gameState.currentPlayerId === currentUserId;

  return (
    <div className={`turn-order-display ${isMyTurn ? 'my-turn' : ''}`}>
      <div className="turn-order-header">
        <span className="turn-number">Turn {gameState.turn}</span>
        {isMyTurn && <span className="your-turn-badge">Your Turn</span>}
      </div>
      <div className="turn-order-cards">
        {gameState.turnOrder.map((userId, index) => {
          const player = allPlayers[userId];
          if (!player) return null;

          const isCurrentPlayer = userId === gameState.currentPlayerId;
          const isMe = userId === currentUserId;
          const turnNumber = index + 1;

          return (
            <div
              key={userId}
              className={`turn-order-card ${isCurrentPlayer ? 'current' : ''} ${isMe ? 'me' : ''} ${player.isMyTeam ? 'my-team' : 'enemy-team'}`}
            >
              <div className="card-header">
                <span className="turn-position">{turnNumber}</span>
                {isMe && <span className="me-badge">You</span>}
              </div>
              <div className="card-body">
                <div className="player-name">{player.username || userId}</div>
                <div className="player-class">{player.characterClass || 'Unknown'}</div>
                {player.team && (
                  <div className="player-team">Team {player.team}</div>
                )}
              </div>
              {isCurrentPlayer && (
                <div className="current-indicator">▶</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TurnOrderDisplay;
