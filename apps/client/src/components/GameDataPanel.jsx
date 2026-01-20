import React, { useState } from 'react';
import '../styles/gameDataPanel.scss';

const GameDataPanel = ({ gameState, isOpen, onClose }) => {
  if (!isOpen) return null;

  if (!gameState) {
    return (
      <div className="game-data-panel">
        <div className="panel-header">
          <h3>Game Data</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="panel-content">
          <p>No game data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="game-data-panel">
      <div className="panel-header">
        <h3>Game Data</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>
      <div className="panel-content">
        <div className="game-info-section">
          <h4>Match Info</h4>
          <div className="info-item">
            <span className="label">Match ID:</span>
            <span className="value">{gameState.matchId}</span>
          </div>
          <div className="info-item">
            <span className="label">Map:</span>
            <span className="value">{gameState.mapId}</span>
          </div>
          <div className="info-item">
            <span className="label">Queue:</span>
            <span className="value">{gameState.queueType}</span>
          </div>
          <div className="info-item">
            <span className="label">Phase:</span>
            <span className="value phase-badge" data-phase={gameState.phase}>
              {gameState.phase}
            </span>
          </div>
          <div className="info-item">
            <span className="label">Turn:</span>
            <span className="value">{gameState.turn}</span>
          </div>
          {gameState.currentPlayerId && (
            <div className="info-item">
              <span className="label">Current Player:</span>
              <span className="value">{gameState.currentPlayerId}</span>
            </div>
          )}
        </div>

        {gameState.myTeam && (
          <div className="team-section">
            <h4>My Team ({gameState.myTeam.teamId})</h4>
            <div className="players-list">
              {Object.values(gameState.myTeam.players).map(player => (
                <div key={player.userId} className="player-item">
                  <div className="player-name">{player.username}</div>
                  <div className="player-details">
                    <span>Character: {player.characterName}</span>
                    <span>Health: {player.health}/{player.maxHealth}</span>
                    {player.position && (
                      <span>Position: ({player.position.x}, {player.position.y})</span>
                    )}
                    {gameState.phase === 'preparation' && (
                      <span className={player.ready ? 'ready' : 'not-ready'}>
                        {player.ready ? '✓ Ready' : 'Not Ready'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {gameState.enemyTeam && (
          <div className="team-section enemy-team">
            <h4>Enemy Team ({gameState.enemyTeam.teamId})</h4>
            <div className="players-list">
              {Object.values(gameState.enemyTeam.players).map(player => (
                <div key={player.userId} className="player-item">
                  <div className="player-name">{player.username}</div>
                  <div className="player-details">
                    <span>Character: {player.characterName}</span>
                    <span>Health: {player.health}/{player.maxHealth}</span>
                    {player.position && (
                      <span>Position: ({player.position.x}, {player.position.y})</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {gameState.stats && (
          <div className="stats-section">
            <h4>Match Stats</h4>
            <div className="info-item">
              <span className="label">Winner:</span>
              <span className="value">{gameState.stats.winner}</span>
            </div>
            <div className="info-item">
              <span className="label">Duration:</span>
              <span className="value">{Math.floor(gameState.stats.duration / 1000)}s</span>
            </div>
          </div>
        )}

        <div className="raw-data-section">
          <details>
            <summary>Raw Game State (Debug)</summary>
            <pre>{JSON.stringify(gameState, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
};

export default GameDataPanel;
