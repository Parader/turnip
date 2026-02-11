/**
 * AudioSettingsStore
 * Manages audio settings with persistence and reactive updates
 */

import { DEFAULT_SETTINGS, AudioGroup } from './constants';

const STORAGE_KEY = 'turnip_audio_settings';

class AudioSettingsStore {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.listeners = new Set();
    this.groupListeners = new Map();
    this._load();
  }

  _load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (e) {
      console.warn('[AudioSettings] Failed to load:', e);
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (e) {
      console.warn('[AudioSettings] Failed to save:', e);
    }
  }

  /**
   * Get a setting value
   */
  get(key) {
    return this.settings[key];
  }

  /**
   * Set a setting value
   */
  set(key, value) {
    const clamped = typeof value === 'number' ? Math.max(0, Math.min(1, value)) : value;
    if (this.settings[key] !== clamped) {
      this.settings[key] = clamped;
      this._save();
      this._emit(key, clamped);
    }
  }

  /**
   * Get effective volume for a group (master * group, or 0 if muted)
   */
  getEffectiveVolume(group) {
    if (this.settings.muted) return 0;
    const groupVol = this.settings[group] ?? 1.0;
    return this.settings[AudioGroup.MASTER] * groupVol;
  }

  /**
   * Toggle global mute
   */
  toggleMute() {
    this.set('muted', !this.settings.muted);
  }

  /**
   * Subscribe to all setting changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Subscribe to a specific group's volume changes
   */
  subscribeToGroup(group, callback) {
    if (!this.groupListeners.has(group)) {
      this.groupListeners.set(group, new Set());
    }
    this.groupListeners.get(group).add(callback);
    return () => this.groupListeners.get(group)?.delete(callback);
  }

  _emit(key, value) {
    // Notify general listeners
    this.listeners.forEach(cb => {
      try {
        cb(key, value, this.settings);
      } catch (e) {
        console.error('[AudioSettings] Listener error:', e);
      }
    });

    // Notify group-specific listeners
    if (this.groupListeners.has(key)) {
      const effectiveVol = this.getEffectiveVolume(key);
      this.groupListeners.get(key).forEach(cb => {
        try {
          cb(effectiveVol);
        } catch (e) {
          console.error('[AudioSettings] Group listener error:', e);
        }
      });
    }

    // Master/mute changes affect all groups
    if (key === AudioGroup.MASTER || key === 'muted') {
      Object.values(AudioGroup).forEach(group => {
        if (group !== AudioGroup.MASTER && this.groupListeners.has(group)) {
          const effectiveVol = this.getEffectiveVolume(group);
          this.groupListeners.get(group).forEach(cb => {
            try {
              cb(effectiveVol);
            } catch (e) {
              console.error('[AudioSettings] Group listener error:', e);
            }
          });
        }
      });
    }
  }

  /**
   * Get all settings (for UI binding)
   */
  getAll() {
    return { ...this.settings };
  }

  /**
   * Reset to defaults
   */
  reset() {
    this.settings = { ...DEFAULT_SETTINGS };
    this._save();
    Object.keys(this.settings).forEach(key => this._emit(key, this.settings[key]));
  }
}

// Singleton export
export const audioSettings = new AudioSettingsStore();
