import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCharacters, getSelectedCharacter, setSelectedCharacter } from '../utils/api';
import '../styles/character.scss';

function CharacterSelector({ onCharacterChange, initialCharacter = null }) {
  const { user } = useAuth();
  const [characters, setCharacters] = useState([]);
  const [selectedCharacter, setSelectedCharacterState] = useState(initialCharacter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  // Update when initialCharacter prop changes (from parent)
  useEffect(() => {
    if (initialCharacter) {
      setSelectedCharacterState(initialCharacter);
      if (onCharacterChange) {
        onCharacterChange(initialCharacter);
      }
    }
  }, [initialCharacter, onCharacterChange]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [charactersResponse, selectedResponse] = await Promise.all([
        getCharacters(user.username),
        getSelectedCharacter(user.username)
      ]);
      
      setCharacters(charactersResponse.characters || []);
      const loadedCharacter = selectedResponse.character || initialCharacter || null;
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
      if (onCharacterChange) {
        onCharacterChange(character);
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to select character');
    }
  };

  if (loading) {
    return <div className="character-selector-loading">Loading characters...</div>;
  }

  if (characters.length === 0) {
    return (
      <div className="character-selector">
        <div className="no-characters-message">
          <p>No characters available. Create a character to get started!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="character-selector">
      <h3>Selected Character</h3>
      {error && <div className="error-message">{error}</div>}
      
      {selectedCharacter ? (
        <div className="selected-character-display">
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
        </div>
      ) : (
        <div className="no-selected-character">
          <p>No character selected</p>
        </div>
      )}

      <div className="character-selector-list">
        <h4>Select Character</h4>
        <div className="character-selector-grid">
          {characters.map(character => {
            const isSelected = selectedCharacter && selectedCharacter._id.toString() === character._id.toString();
            return (
              <div
                key={character._id}
                className={`character-selector-item ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectCharacter(character._id.toString())}
              >
                <div className="selector-character-avatar">
                  {character.name.charAt(0).toUpperCase()}
                </div>
                <div className="selector-character-name">{character.name}</div>
                <div className="selector-character-class">{character.classId}</div>
                {isSelected && <div className="selected-badge">✓ Selected</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default CharacterSelector;

