import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getClassSpells, updateCharacter } from '../utils/api';
import SpellSelectionModal from './SpellSelectionModal';
import '../styles/character.scss';

function EditCharacterLoadout({ character, onClose, onLoadoutUpdated }) {
  const { user } = useAuth();
  const [spellLoadout, setSpellLoadout] = useState([...character.spellLoadout]);
  const [availableSpells, setAvailableSpells] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(null);

  useEffect(() => {
    loadAvailableSpells();
  }, [character]);

  const loadAvailableSpells = async () => {
    try {
      setLoading(true);
      // Pass character level to get all spells (available and locked)
      const response = await getClassSpells(character.classId, character.level);
      setAvailableSpells(response.spells || []);
    } catch (err) {
      setError(err.message || 'Failed to load available spells');
    } finally {
      setLoading(false);
    }
  };

  const handleSlotClick = (slotIndex) => {
    setSelectedSlotIndex(slotIndex);
  };

  const handleSpellSelect = (slotIndex, spellId, swapSlotIndex = null) => {
    const newLoadout = [...spellLoadout];
    
    if (swapSlotIndex !== null) {
      // Swap spells between slots
      [newLoadout[slotIndex], newLoadout[swapSlotIndex]] = 
        [newLoadout[swapSlotIndex], newLoadout[slotIndex]];
    } else {
      // Set spell in selected slot
      newLoadout[slotIndex] = spellId;
    }
    
    setSpellLoadout(newLoadout);
  };

  const handleClearSlot = (slotIndex) => {
    const newLoadout = [...spellLoadout];
    newLoadout[slotIndex] = '';
    setSpellLoadout(newLoadout);
  };

  const handleSave = async () => {
    // Validate all slots are filled
    if (spellLoadout.some(slot => !slot)) {
      setError('All spell slots must be filled');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await updateCharacter(user.username, character._id.toString(), {
        spellLoadout: spellLoadout
      });
      
      if (onLoadoutUpdated) {
        onLoadoutUpdated();
      }
      
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update spell loadout');
    } finally {
      setSaving(false);
    }
  };

  const getSpellInfo = (spellId) => {
    return availableSpells.find(s => s.id === spellId);
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="character-loading">Loading available spells...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content loadout-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Edit Spell Loadout - {character.name}</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="action-bar-container">
            <div className="action-bar">
              {[0, 1, 2, 3, 4].map(index => {
                const spellId = spellLoadout[index];
                const spellInfo = spellId ? getSpellInfo(spellId) : null;
                
                return (
                  <div
                    key={index}
                    className={`action-bar-slot ${spellId ? 'filled' : 'empty'}`}
                    onClick={() => handleSlotClick(index)}
                  >
                    <div className="spell-icon-large">
                      {spellInfo ? spellInfo.name.charAt(0).toUpperCase() : index + 1}
                    </div>
                    <div className="spell-slot-name">
                      {spellInfo ? spellInfo.name : `Slot ${index + 1}`}
                    </div>
                    {spellId && (
                      <button
                        className="clear-slot-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearSlot(index);
                        }}
                        title="Clear slot"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="action-bar-info">
              <p className="info-text">
                Click on a slot to select a spell. If a spell is already in another slot, they will swap positions.
              </p>
              <div className="character-level-info">
                Level {character.level} - {availableSpells.length} spells available
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Loadout'}
            </button>
          </div>
        </div>
      </div>

      {selectedSlotIndex !== null && (
        <SpellSelectionModal
          availableSpells={availableSpells}
          currentLoadout={spellLoadout}
          selectedSlotIndex={selectedSlotIndex}
          onSpellSelect={handleSpellSelect}
          onClose={() => setSelectedSlotIndex(null)}
        />
      )}
    </>
  );
}

export default EditCharacterLoadout;
