import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCharacters, getSelectedCharacter, setSelectedCharacter, deleteCharacter } from '../utils/api';
import EditCharacterLoadout from './EditCharacterLoadout';
import CharacterSelectionModal from './CharacterSelectionModal';
import '../styles/character.scss';

function CharacterManager({ onCharacterChange, onCharacterCreated, onCharacterDeleted }) {
  const { user } = useAuth();
  const [characters, setCharacters] = useState([]);
  const [selectedCharacter, setSelectedCharacterState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [showCharacterSelectionModal, setShowCharacterSelectionModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [charactersResponse, selectedResponse] = await Promise.all([
        getCharacters(user.username),
        getSelectedCharacter(user.username)
      ]);
      
      setCharacters(charactersResponse.characters || []);
      const loadedCharacter = selectedResponse.character || null;
      setSelectedCharacterState(loadedCharacter);
      
      // Notify parent of loaded character
      if (loadedCharacter && onCharacterChange) {
        onCharacterChange(loadedCharacter);
      }
    } catch (err) {
      setError(err.message || 'Failed to load characters');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectCharacter = async (characterId) => {
    try {
      await setSelectedCharacter(user.username, characterId);
      const character = characters.find(c => c._id.toString() === characterId);
      setSelectedCharacterState(character);
      setShowCharacterSelectionModal(false);
      if (onCharacterChange) {
        onCharacterChange(character);
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to select character');
    }
  };

  const handleDelete = async (characterId, characterName) => {
    if (!window.confirm(`Are you sure you want to delete "${characterName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteCharacter(user.username, characterId);
      setCharacters(characters.filter(c => c._id.toString() !== characterId));
      
      // If deleted character was selected, clear selection
      if (selectedCharacter && selectedCharacter._id.toString() === characterId) {
        setSelectedCharacterState(null);
        if (onCharacterChange) {
          onCharacterChange(null);
        }
      }
      
      if (onCharacterDeleted) {
        onCharacterDeleted(characterId);
      }
    } catch (err) {
      setError(err.message || 'Failed to delete character');
    }
  };

  const handleLoadoutUpdated = () => {
    loadData();
  };

  const handleCharacterCreated = async (newCharacter) => {
    // Reload characters to include the new one
    await loadData();
    // If a new character was created and passed, select it
    if (newCharacter && newCharacter._id) {
      await handleSelectCharacter(newCharacter._id.toString());
    }
    // Notify parent (Dashboard) to refresh
    if (onCharacterCreated) {
      onCharacterCreated();
    }
  };

  const handleCharacterDeleted = async (characterId, characterName) => {
    await handleDelete(characterId, characterName);
    // Reload data to update the list
    await loadData();
  };

  if (loading) {
    return <div className="character-loading">Loading characters...</div>;
  }

  return (
    <div className="characters-list">
      <h2>My Character</h2>
      {error && <div className="error-message">{error}</div>}
      
      {/* Selected Character Display */}
      {selectedCharacter ? (
        <div className="selected-character-section">
          <div className="selected-character-card">
            <div className="selected-character-header">
              <div className="selected-character-info">
                <div className="character-avatar-large">
                  {selectedCharacter.name.charAt(0).toUpperCase()}
                </div>
                <div className="character-details">
                  <div className="character-name-large">{selectedCharacter.name}</div>
                  <div className="character-class-badge">{selectedCharacter.classId}</div>
                  <div className="character-level-info">Level {selectedCharacter.level}</div>
                </div>
              </div>
              <div className="selected-character-actions">
                <button
                  className="change-character-btn"
                  onClick={() => setShowCharacterSelectionModal(true)}
                >
                  Change Character
                </button>
                <button
                  className="edit-loadout-btn"
                  onClick={() => setEditingCharacter(selectedCharacter)}
                >
                  Edit Loadout
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="no-selected-character-section">
          <h3>No Character Selected</h3>
          <p>Select a character to use for gameplay</p>
          {characters.length > 0 ? (
            <button
              className="select-character-btn-large"
              onClick={() => setShowCharacterSelectionModal(true)}
            >
              Select Character
            </button>
          ) : (
            <div className="no-characters-section">
              <p className="no-characters">No characters yet. Create your first character to get started!</p>
              <button
                className="create-character-btn-large"
                onClick={() => setShowCharacterSelectionModal(true)}
              >
                Create Character
              </button>
            </div>
          )}
        </div>
      )}

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

      {editingCharacter && (
        <EditCharacterLoadout
          character={editingCharacter}
          onClose={() => setEditingCharacter(null)}
          onLoadoutUpdated={handleLoadoutUpdated}
        />
      )}
    </div>
  );
}

export default CharacterManager;

