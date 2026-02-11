/**
 * UI Sound Definitions
 */

import { registerSounds } from './SoundBank';
import { AudioGroup } from './constants';
import { audioManager } from './AudioManager';

/**
 * Register UI sounds
 */
export function registerUISounds() {
  registerSounds({
    // Button/interaction sounds
    ui_click: {
      url: '/audio/ui/click.ogg',
      group: AudioGroup.SFX,
      volume: 0.5,
      maxInstances: 2,
      cooldownMs: 30
    },
    ui_hover: {
      url: '/audio/ui/hover.ogg',
      group: AudioGroup.SFX,
      volume: 0.3,
      maxInstances: 1,
      cooldownMs: 50
    },
    
    // Panel sounds
    ui_open: {
      url: '/audio/ui/panel_open.ogg',
      group: AudioGroup.SFX,
      volume: 0.6
    },
    ui_close: {
      url: '/audio/ui/panel_close.ogg',
      group: AudioGroup.SFX,
      volume: 0.5
    },
    
    // Feedback sounds
    ui_error: {
      url: '/audio/ui/error.ogg',
      group: AudioGroup.SFX,
      volume: 0.7
    },
    ui_success: {
      url: '/audio/ui/success.ogg',
      group: AudioGroup.SFX,
      volume: 0.6
    },
    
    // Game flow sounds
    ui_turn_start: {
      url: '/audio/ui/turn_start.ogg',
      group: AudioGroup.SFX,
      volume: 0.8
    },
    ui_turn_end: {
      url: '/audio/ui/turn_end.ogg',
      group: AudioGroup.SFX,
      volume: 0.6
    },
    ui_victory: {
      url: '/audio/ui/victory.ogg',
      group: AudioGroup.SFX,
      volume: 0.9
    },
    ui_defeat: {
      url: '/audio/ui/defeat.ogg',
      group: AudioGroup.SFX,
      volume: 0.9
    }
  });
}

// Convenience functions for common UI sounds
export function playClick() {
  return audioManager.playUI('ui_click');
}

export function playHover() {
  return audioManager.playUI('ui_hover');
}

export function playError() {
  return audioManager.playUI('ui_error');
}

export function playSuccess() {
  return audioManager.playUI('ui_success');
}

export function playTurnStart() {
  return audioManager.playUI('ui_turn_start');
}

export function playTurnEnd() {
  return audioManager.playUI('ui_turn_end');
}
