import React, { useState } from 'react';
import CreateCharacter from './CreateCharacter';
import '../styles/character.scss';

function CharacterSelectionModal({ characters, selectedCharacter, onSelect, onClose, onCharacterCreated, onCharacterDeleted }) {
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCharacterCreated = async (newCharacter) => {
    setShowCreateForm(false);
    // Notify parent to reload characters
    if (onCharacterCreated) {
      await onCharacterCreated(newCharacter);
    }
    // The parent will handle selecting the new character after reloading
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content character-selection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select Character</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {showCreateForm ? (
            <div className="character-selection-create">
              <div className="create-character-header">
                <button 
                  className="back-to-list-btn"
                  onClick={() => setShowCreateForm(false)}
                >
                  ← Back to List
                </button>
                <h3>Create New Character</h3>
              </div>
              <CreateCharacter 
                onCharacterCreated={handleCharacterCreated}
                compact={true}
              />
            </div>
          ) : (
            <>
              <div className="character-selection-actions">
                <button
                  className="create-character-btn-modal"
                  onClick={() => setShowCreateForm(true)}
                >
                  + Create New Character
                </button>
              </div>
              {characters.length === 0 ? (
                <div className="no-characters-message">
                  <p>No characters available</p>
                  <button
                    className="create-character-btn-modal"
                    onClick={() => setShowCreateForm(true)}
                  >
                    Create Your First Character
                  </button>
                </div>
              ) : (
                <div className="character-selection-grid">
                  {characters.map(character => {
                    const isSelected = selectedCharacter && selectedCharacter._id.toString() === character._id.toString();
                    return (
                      <div
                        key={character._id}
                        className={`character-selection-item ${isSelected ? 'selected' : ''}`}
                      >
                        <div
                          className="character-selection-item-content"
                          onClick={() => {
                            if (!isSelected) {
                              onSelect(character._id.toString());
                            }
                          }}
                        >
                          <div className="selection-character-avatar">
                            {character.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="selection-character-name">{character.name}</div>
                          <div className="selection-character-class">{character.classId}</div>
                          <div className="selection-character-level">Level {character.level}</div>
                          {isSelected && <div className="selection-selected-badge">✓ Selected</div>}
                        </div>
                        <button
                          className="character-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to delete "${character.name}"? This action cannot be undone.`)) {
                              if (onCharacterDeleted) {
                                onCharacterDeleted(character._id.toString(), character.name);
                              }
                            }
                          }}
                          title="Delete character"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CharacterSelectionModal;

