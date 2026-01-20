import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import FriendsList from './FriendsList';
import AddFriend from './AddFriend';
import FriendRequests from './FriendRequests';
import CharacterManager from './CharacterManager';
import '../styles/dashboard.scss';

function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [refreshFriends, setRefreshFriends] = useState(0);
  const [refreshRequests, setRefreshRequests] = useState(0);
  const [refreshCharacters, setRefreshCharacters] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState(null);

  const handleFriendAdded = () => {
    setRefreshFriends(prev => prev + 1);
    setRefreshRequests(prev => prev + 1);
  };

  const handleRequestUpdated = () => {
    setRefreshFriends(prev => prev + 1);
    setRefreshRequests(prev => prev + 1);
  };

  const handleCharacterCreated = () => {
    setRefreshCharacters(prev => prev + 1);
  };

  const handleCharacterDeleted = (deletedCharacterId) => {
    setRefreshCharacters(prev => prev + 1);
    // CharacterManager will reload and handle if deleted character was selected
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <h1>Turnip Game</h1>
          <div className="user-info">
            <span className="username">Welcome, {user?.username}!</span>
            <button onClick={logout} className="logout-button">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-content">
          <div className="welcome-card">
            <h2>Welcome to your Dashboard!</h2>
            <p>You are successfully logged in.</p>
            <div className="user-details">
              <p><strong>Username:</strong> {user?.username}</p>
              <p><strong>Email:</strong> {user?.email}</p>
            </div>
          </div>

          <div className="friends-section">
            <AddFriend onFriendAdded={handleFriendAdded} />
            <FriendRequests key={refreshRequests} onRequestUpdated={handleRequestUpdated} />
          </div>

          <div className="friends-list-section">
            <FriendsList key={refreshFriends} />
          </div>

          <div className="characters-section">
            <CharacterManager 
              key={refreshCharacters} 
              onCharacterChange={(character) => setSelectedCharacter(character)}
              onCharacterCreated={handleCharacterCreated}
              onCharacterDeleted={handleCharacterDeleted}
            />
          </div>

          <div className="game-container">
            <h3>Ready to Play?</h3>
            <p>Invite friends and start matchmaking</p>
            {!selectedCharacter && (
              <p className="character-required-message">
                Please select a character to play
              </p>
            )}
            <button 
              className="play-button"
              onClick={() => navigate('/lobby')}
              disabled={!selectedCharacter}
            >
              Play Now
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default Dashboard;

