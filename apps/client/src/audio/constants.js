/**
 * Audio system constants
 */

export const AudioGroup = {
  MASTER: 'master',
  MUSIC: 'music',
  SFX: 'sfx',
  AMBIENT: 'ambient',
  VOICE: 'voice'
};

export const DEFAULT_SETTINGS = {
  [AudioGroup.MASTER]: 1.0,
  [AudioGroup.MUSIC]: 0.7,
  [AudioGroup.SFX]: 1.0,
  [AudioGroup.AMBIENT]: 0.5,
  [AudioGroup.VOICE]: 1.0,
  muted: false
};

// Global limits
export const MAX_CONCURRENT_SOUNDS = 32;
export const DEFAULT_COOLDOWN_MS = 50;
export const EVENT_ID_TTL_MS = 2000;

// 3D audio defaults
export const DEFAULT_3D_OPTIONS = {
  distanceModel: 'exponential',
  maxDistance: 100,
  refDistance: 1,
  rolloffFactor: 1.5
};
