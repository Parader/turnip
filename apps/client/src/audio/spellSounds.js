/**
 * Spell Sound Profiles
 * Defines sound events for each spell
 */

import { registerSounds } from './SoundBank';
import { AudioGroup } from './constants';
import { audioManager } from './AudioManager';

/**
 * Spell sound profiles by spell ID
 * Each profile maps events to sound IDs
 * 
 * Events:
 *   castStart - When cast begins (caster position)
 *   castLoop  - Looping during channel
 *   castEnd   - Cast complete
 *   launch    - Projectile launched
 *   travel    - Projectile traveling (loop)
 *   impact    - Hit target (target position)
 *   impactCrit - Critical hit
 *   fizzle    - Spell interrupted
 */
export const spellSoundProfiles = {
  // ========== MAGE SPELLS ==========
  
  fireball: {
    castStart: 'fireball_cast',
    impact: 'fireball_hit'
  },
  
  teleportation: {
    castStart: 'teleport_cast'
    // Could add: castEnd for vanish, impact for appear
  },
  
  heal: {
    castStart: 'heal_cast'
  },
  
  earth_block: {
    castStart: 'rock_cast'
  },
  
  arcane_missile: {
    castStart: 'arcane_missile_cast',
    impact: 'arcane_missile_hit'
  }
  
  // Add more spells as you get sounds
};

/**
 * Register all spell sounds
 * Call this during audio system initialization
 */
export function registerSpellSounds() {
  console.log('[Audio] Registering spell sounds...');
  registerSounds({
    // ========== MAGE SPELLS ==========
    
    // Fireball
    fireball_cast: {
      url: '/audio/sfx/spells/FIREBAL_CAST_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.8,
      maxInstances: 1,
      cooldownMs: 500 // Prevent duplicate casts
    },
    fireball_hit: {
      url: '/audio/sfx/spells/FIREBAL_HIT_01.mp3',
      group: AudioGroup.SFX,
      volume: 1.0,
      spatial: true,
      maxInstances: 2,
      cooldownMs: 200
    },

    // Teleport
    teleport_cast: {
      url: '/audio/sfx/spells/TELEPORT_CAST_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.8,
      spatial: true,
      maxInstances: 1,
      cooldownMs: 500
    },

    // Heal
    heal_cast: {
      url: '/audio/sfx/spells/HEAL_CAST_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.8,
      spatial: true,
      maxInstances: 1,
      cooldownMs: 500
    },

    // Earth Block (Rock) - spatial disabled as it's a spawn spell, not targeted
    rock_cast: {
      url: '/audio/sfx/spells/ROCK_CAST_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.8,
      spatial: false,
      maxInstances: 1,
      cooldownMs: 500
    },

    // Arcane Missile
    arcane_missile_cast: {
      url: '/audio/sfx/spells/ARCANEMISSILE_CAST_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.8,
      spatial: true,
      maxInstances: 1,
      cooldownMs: 500
    },
    arcane_missile_hit: {
      url: '/audio/sfx/spells/ARCANEMISSILE_HIT_01.mp3',
      group: AudioGroup.SFX,
      volume: 0.9,
      spatial: true,
      maxInstances: 3, // Allow multiple hits for multi-target
      cooldownMs: 100
    }
  });
  console.log('[Audio] Spell sounds registered:', Object.keys(spellSoundProfiles));
}

/**
 * Get the sound profile for a spell
 * @param {string} spellId - Spell identifier
 * @returns {Object|null} Sound profile or null
 */
export function getSpellSoundProfile(spellId) {
  return spellSoundProfiles[spellId] || null;
}

// Track last play time per spell+event to prevent rapid duplicates
const lastSpellSoundTime = new Map();
const SPELL_SOUND_DEBOUNCE_MS = 300;

/**
 * Play a spell sound event
 * @param {string} spellId - Spell identifier
 * @param {string} event - Sound event (castStart, impact, etc.)
 * @param {Object} options - Play options (position, eventId, etc.)
 * @returns {Object|null} Sound handle or null
 */
export function playSpellSound(spellId, event, options = {}) {
  const key = `${spellId}_${event}`;
  const now = Date.now();
  const lastTime = lastSpellSoundTime.get(key) || 0;
  
  // Debounce: ignore if called within debounce window
  if (now - lastTime < SPELL_SOUND_DEBOUNCE_MS) {
    console.log(`[Audio] Debounced: ${key} (${now - lastTime}ms since last)`);
    return null;
  }
  lastSpellSoundTime.set(key, now);
  
  console.log(`[Audio] playSpellSound: spell=${spellId}, event=${event}`);
  const profile = spellSoundProfiles[spellId];
  
  if (!profile) {
    console.log(`[Audio] No sound profile for spell: ${spellId}`);
    return null;
  }
  
  if (!profile[event]) {
    console.log(`[Audio] No ${event} sound for spell: ${spellId}`);
    return null;
  }
  
  console.log(`[Audio] Playing: ${profile[event]}`);
  return audioManager.play(profile[event], options);
}

/**
 * Add or update a spell sound profile at runtime
 * Useful for testing or dynamic content
 */
export function setSpellSoundProfile(spellId, profile) {
  spellSoundProfiles[spellId] = profile;
}
