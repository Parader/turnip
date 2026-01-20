import React from 'react';
import '../styles/character.scss';

function SpellSelectionModal({ 
  availableSpells, 
  currentLoadout, 
  selectedSlotIndex, 
  onSpellSelect, 
  onClose 
}) {
  const handleSpellClick = (spell) => {
    // Don't allow selecting locked spells
    if (!spell.available) {
      return;
    }

    const spellId = spell.id;
    
    // Check if spell is already in another slot
    const existingSlotIndex = currentLoadout.findIndex((s, index) => 
      s === spellId && index !== selectedSlotIndex
    );

    if (existingSlotIndex !== -1) {
      // Swap spells between slots
      onSpellSelect(selectedSlotIndex, spellId, existingSlotIndex);
    } else {
      // Just set the spell in the selected slot
      onSpellSelect(selectedSlotIndex, spellId);
    }
    
    onClose();
  };

  return (
    <div className="modal-overlay spell-selection-overlay" onClick={onClose} style={{ zIndex: 1001 }}>
      <div className="modal-content spell-selection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select Spell for Slot {selectedSlotIndex + 1}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="spell-selection-grid">
          {[...availableSpells]
            .sort((a, b) => {
              // Sort: available spells first, then locked spells
              if (a.available && !b.available) return -1;
              if (!a.available && b.available) return 1;
              // Within same group, sort by name
              return a.name.localeCompare(b.name);
            })
            .map(spell => {
            const isInLoadout = currentLoadout.includes(spell.id);
            const inSlotIndex = currentLoadout.findIndex(s => s === spell.id);
            const isLocked = !spell.available;
            
            return (
              <div
                key={spell.id}
                className={`spell-selection-card ${isInLoadout ? 'in-loadout' : ''} ${isLocked ? 'locked' : ''}`}
                onClick={() => handleSpellClick(spell)}
              >
                <div className={`spell-icon ${isLocked ? 'locked-icon' : ''}`}>
                  {isLocked ? '🔒' : spell.name.charAt(0).toUpperCase()}
                </div>
                <div className="spell-selection-info">
                  <div className="spell-selection-name">
                    {spell.name}
                    {isLocked && <span className="locked-badge">Locked</span>}
                  </div>
                  <div className="spell-selection-description">
                    {isLocked 
                      ? `Unlocks at level ${spell.unlockLevel || '?'}`
                      : (spell.description || '')
                    }
                  </div>
                  {!isLocked && spell.cost && (
                    <div className="spell-selection-cost">Energy: {spell.cost.energy}</div>
                  )}
                  {isInLoadout && !isLocked && (
                    <div className="spell-selection-location">Currently in Slot {inSlotIndex + 1}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default SpellSelectionModal;

