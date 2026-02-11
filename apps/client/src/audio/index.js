/**
 * Audio System Public Exports
 */

import { audioManager } from './AudioManager';
import { audioSettings } from './AudioSettingsStore';
import { AudioGroup, DEFAULT_SETTINGS } from './constants';
import { 
  registerSound, 
  registerSounds, 
  preloadSound, 
  preloadSounds, 
  preloadAll,
  isLoaded,
  getDefinition,
  getAllSoundIds
} from './SoundBank';
import { 
  registerSpellSounds, 
  getSpellSoundProfile, 
  playSpellSound,
  spellSoundProfiles,
  setSpellSoundProfile
} from './spellSounds';
import { 
  registerUISounds,
  playClick,
  playHover,
  playError,
  playSuccess,
  playTurnStart,
  playTurnEnd
} from './uiSounds';

// Re-export everything
export { audioManager };
export { audioSettings };
export { AudioGroup, DEFAULT_SETTINGS };
export { 
  registerSound, 
  registerSounds, 
  preloadSound, 
  preloadSounds, 
  preloadAll,
  isLoaded,
  getDefinition,
  getAllSoundIds
};
export { 
  registerSpellSounds, 
  getSpellSoundProfile, 
  playSpellSound,
  spellSoundProfiles,
  setSpellSoundProfile
};
export { 
  registerUISounds,
  playClick,
  playHover,
  playError,
  playSuccess,
  playTurnStart,
  playTurnEnd
};

/**
 * Initialize the entire audio system
 * @param {Scene} scene - Babylon.js scene
 * @returns {AudioManager} The audio manager instance
 */
export function initAudioSystem(scene) {
  // Register all sound definitions
  registerSpellSounds();
  registerUISounds();
  
  // Initialize the manager with the scene
  audioManager.init(scene);
  
  console.log('[Audio] System initialized');
  
  return audioManager;
}
