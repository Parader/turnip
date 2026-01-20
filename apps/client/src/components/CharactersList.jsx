import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getCharacters, deleteCharacter } from '../utils/api';
import EditCharacterLoadout from './EditCharacterLoadout';
import '../styles/character.scss';

function CharactersList({ onCharacterDeleted }) {
  const { user } = useAuth();
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingCharacter, setEditingCharacter] = useState(null);

  useEffect(() => {
    if (user) {
      loadCharacters();
    }
  }, [user]);

  const loadCharacters = async () => {
    try {
      setLoading(true);
      const response = await getCharacters(user.username);
      setCharacters(response.characters || []);
    } catch (err) {
      setError(err.message || 'Failed to load characters');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (characterId, characterName) => {
    if (!window.confirm(`Are you sure you want to delete "${characterName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteCharacter(user.username, characterId);
      setCharacters(characters.filter(c => c._id.toString() !== characterId));
      if (onCharacterDeleted) {
        onCharacterDeleted(characterId); // Pass characterId to notify if it was selected
      }
    } catch (err) {
      setError(err.message || 'Failed to delete character');
    }
  };

  const handleLoadoutUpdated = () => {
    loadCharacters();
  };

  if (loading) {
    return <div className="character-loading">Loading characters...</div>;
  }

  return (
    <div className="characters-list">
      <h2>My Characters ({characters.length})</h2>
      {error && <div className="error-message">{error}</div>}
      
      {characters.length === 0 ? (
        <p className="no-characters">No characters yet. Create your first character to get started!</p>
      ) : (
        <div className="characters-grid">
          {characters.map(character => (
            <div key={character._id} className="character-card">
              <div className="character-header">
                <h3>{character.name}</h3>
                <span className="character-class">{character.classId}</span>
              </div>
              <div className="character-info">
                <div className="character-level">
                  <span>Level {character.level}</span>
                  <span className="character-exp">EXP: {character.exp}</span>
                </div>
                <div className="character-spells">
                  <strong>Spells:</strong>
                  <div className="spell-list">
                    {character.spellLoadout.map((spellId, index) => (
                      <span key={index} className="spell-tag">{spellId}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="character-actions">
                <button
                  onClick={() => setEditingCharacter(character)}
                  className="edit-loadout-btn"
                >
                  Edit Loadout
                </button>
                <button
                  onClick={() => handleDelete(character._id.toString(), character.name)}
                  className="delete-character-btn"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
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

export default CharactersList;

