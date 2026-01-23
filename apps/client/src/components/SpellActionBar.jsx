import React, { useState, useEffect } from 'react';
import '../styles/spellActionBar.scss';

const KEYBINDS = ['1', '2', '3', '4', '5'];
const MAX_SLOTS = 5;

const SpellActionBar = ({ gameState, currentUserId, onSpellClick, spellDefs = {}, selectedSpell: externalSelectedSpell, clearMovementVisualization }) => {
  // Use external selected spell if provided, otherwise manage internally
  const [internalSelectedSpell, setInternalSelectedSpell] = useState(null);
  const selectedSpell = externalSelectedSpell !== undefined ? externalSelectedSpell : internalSelectedSpell;
  
  // Get current player's spell loadout
  const currentPlayer = gameState?.myTeam && 
    Object.values(gameState.myTeam.players || {}).find(p => p.userId === currentUserId);
  
  const spellLoadout = currentPlayer?.spellLoadout 
    ? (typeof currentPlayer.spellLoadout === 'string' 
        ? JSON.parse(currentPlayer.spellLoadout) 
        : currentPlayer.spellLoadout)
    : [];
  
  const isMyTurn = gameState?.phase === 'game' && gameState?.currentPlayerId === currentUserId;
  // Energy might not be in game state yet, use defaults
  const currentEnergy = currentPlayer?.energy ?? 10;
  const maxEnergy = currentPlayer?.maxEnergy ?? 10;
  // Health
  const currentHealth = currentPlayer?.health ?? 100;
  const maxHealth = currentPlayer?.maxHealth ?? 100;
  // Movement
  const totalMovement = currentPlayer?.movementPoints ?? 0;
  const usedMovement = currentPlayer?.usedMovementPoints ?? 0;
  const availableMovement = totalMovement - usedMovement;
  
  // Handle spell slot click
  const handleSpellClick = (spellId, slotIndex) => {
    if (!isMyTurn || !spellId) return;
    
    const spell = spellDefs[spellId];
    if (!spell) return;
    
    // Check if player has enough energy
    const cost = spell.cost?.energy || 0;
    if (currentEnergy < cost) {
      // TODO: Show "Not enough energy" message
      return;
    }
    
    // Toggle selection or call callback
    if (selectedSpell === spellId) {
      if (externalSelectedSpell === undefined) {
        setInternalSelectedSpell(null);
      }
      if (onSpellClick) onSpellClick(null);
    } else {
      if (externalSelectedSpell === undefined) {
        setInternalSelectedSpell(spellId);
      }
      if (onSpellClick) onSpellClick(spellId, spell);
    }
  };
  
  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isMyTurn) return;
    
    const handleKeyPress = (e) => {
      const keyIndex = KEYBINDS.indexOf(e.key);
      if (keyIndex >= 0 && keyIndex < spellLoadout.length) {
        const spellId = spellLoadout[keyIndex];
        if (spellId) {
          handleSpellClick(spellId, keyIndex);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isMyTurn, spellLoadout, currentEnergy, spellDefs]);
  
  // Clear selection when turn ends
  useEffect(() => {
    if (!isMyTurn) {
      if (externalSelectedSpell === undefined) {
        setInternalSelectedSpell(null);
      }
    }
  }, [isMyTurn]);
  
  // Create spell slots
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const spellId = spellLoadout[i] || null;
    const spell = spellId ? spellDefs[spellId] : null;
    const isSelected = selectedSpell === spellId;
    const canAfford = spell ? (currentEnergy >= (spell.cost?.energy || 0)) : false;
    const isOnCooldown = false; // TODO: Implement cooldown tracking
    
    slots.push(
      <div key={i} className="spell-slot-wrapper">
        <div
          className={`spell-slot ${spellId ? 'has-spell' : 'empty'} ${isSelected ? 'selected' : ''} ${!canAfford && spellId ? 'insufficient-energy' : ''} ${isOnCooldown ? 'on-cooldown' : ''}`}
          onClick={() => handleSpellClick(spellId, i)}
          onMouseEnter={() => {
            // Clear movement visualization when hovering over spell slots
            if (clearMovementVisualization) {
              clearMovementVisualization();
            }
          }}
          title={spell ? `${spell.name} - ${spell.description || ''} (Cost: ${spell.cost?.energy || 0} Energy)` : 'Empty Slot'}
        >
        {spell && (
          <>
            {/* Spell Icon */}
            <div className="spell-icon">
              {spell.icon ? (
                <img src={spell.icon} alt={spell.name} />
              ) : (
                <div className="spell-icon-placeholder">
                  {spell.name.charAt(0).toUpperCase()}
                </div>
              )}
              {/* Cooldown overlay */}
              {isOnCooldown && (
                <div className="cooldown-overlay">
                  <span className="cooldown-text">CD</span>
                </div>
              )}
              {/* Insufficient energy overlay */}
              {!canAfford && spellId && (
                <div className="energy-overlay">
                  <span className="energy-text">!</span>
                </div>
              )}
            </div>
            
            {/* Keybind number */}
            <div className="keybind-number">{KEYBINDS[i]}</div>
            
            {/* Energy cost badge */}
            {spell.cost?.energy && (
              <div className="energy-cost">{spell.cost.energy}</div>
            )}
          </>
        )}
        
        {/* Empty slot indicator */}
        {!spellId && (
          <div className="empty-slot-indicator">
            <span className="keybind-number">{KEYBINDS[i]}</span>
          </div>
        )}
        
        {/* Spell name below slot */}
        {spell && (
          <div className="spell-name-label">{spell.name}</div>
        )}
      </div>
      </div>
    );
  }
  
  return (
    <div className={`spell-action-bar ${!isMyTurn ? 'disabled' : ''}`}>
      <div className="action-bar-container">
        {slots}
      </div>
      {gameState?.phase === 'game' && (
        <div className="resource-bars">
          {/* HP Bar */}
          <div className="resource-bar hp-bar">
            <div className="resource-label">HP</div>
            <div className="resource-bar-container">
              <div 
                className="resource-fill hp-fill" 
                style={{ width: `${Math.max(0, (currentHealth / maxHealth) * 100)}%` }}
              />
              <span className="resource-text">{Math.max(0, currentHealth)} / {maxHealth}</span>
            </div>
          </div>
          
          {/* Movement Bar */}
          <div className="resource-bar movement-bar">
            <div className="resource-label">MP</div>
            <div className="resource-bar-container">
              <div 
                className="resource-fill movement-fill" 
                style={{ width: `${totalMovement > 0 ? (availableMovement / totalMovement) * 100 : 0}%` }}
              />
              <span className="resource-text">{availableMovement} / {totalMovement}</span>
            </div>
          </div>
          
          {/* Energy Bar */}
          <div className="resource-bar energy-bar">
            <div className="resource-label">EN</div>
            <div className="resource-bar-container">
              <div 
                className="resource-fill energy-fill" 
                style={{ width: `${(currentEnergy / maxEnergy) * 100}%` }}
              />
              <span className="resource-text">{currentEnergy} / {maxEnergy}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpellActionBar;
