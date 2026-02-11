/**
 * AudioManager
 * Core audio system - handles playback, buses, pooling, and polyphony
 */

import { Sound } from '@babylonjs/core/Audio/sound';
import { Engine } from '@babylonjs/core/Engines/engine';
import { audioSettings } from './AudioSettingsStore';
import { getDefinition, getVariationUrl } from './SoundBank';
import { AudioGroup, MAX_CONCURRENT_SOUNDS, EVENT_ID_TTL_MS, DEFAULT_3D_OPTIONS } from './constants';

class AudioManager {
  constructor() {
    this.initialized = false;
    this.unlocked = false;
    this.scene = null;
    
    // WebAudio context and buses
    this.audioContext = null;
    this.buses = {};
    
    // Active sound tracking
    this.activeSounds = new Map(); // id -> Set of handles
    this.activeCount = 0;
    
    // Cooldown tracking
    this.lastPlayTime = new Map(); // soundId -> timestamp
    
    // Event deduplication
    this.playedEventIds = new Map(); // eventId -> timestamp
    
    // Tab visibility
    this.wasPlayingBeforeHidden = new Set();
    
    // Pending sounds (before unlock)
    this.pendingPlays = [];
    
    // Cleanup interval
    this.cleanupInterval = null;
  }

  /**
   * Initialize the audio system
   * @param {Scene} scene - Babylon.js scene
   */
  init(scene) {
    if (this.initialized) return;
    
    this.scene = scene;
    
    // Get or create AudioContext
    this.audioContext = Engine.audioEngine?.audioContext || new (window.AudioContext || window.webkitAudioContext)();
    
    // Create bus structure
    this._createBuses();
    
    // Subscribe to settings changes
    this._subscribeToSettings();
    
    // Handle tab visibility
    this._setupVisibilityHandling();
    
    // Cleanup event ID cache periodically
    this._startEventIdCleanup();
    
    this.initialized = true;
    
    // Check if already unlocked
    if (this.audioContext.state === 'running') {
      this.unlocked = true;
      console.log('[AudioManager] Already unlocked!');
    }
    
    console.log('[AudioManager] Initialized, context state:', this.audioContext.state);
    console.log('[AudioManager] Scene available:', !!this.scene);
  }

  /**
   * Create the bus/gain node structure
   */
  _createBuses() {
    const ctx = this.audioContext;
    
    // Master bus
    this.buses.master = ctx.createGain();
    this.buses.master.connect(ctx.destination);
    this.buses.master.gain.value = audioSettings.getEffectiveVolume(AudioGroup.MASTER);
    
    // Group buses
    [AudioGroup.MUSIC, AudioGroup.SFX, AudioGroup.AMBIENT, AudioGroup.VOICE].forEach(group => {
      this.buses[group] = ctx.createGain();
      this.buses[group].connect(this.buses.master);
      this.buses[group].gain.value = audioSettings.get(group);
    });
  }

  /**
   * Subscribe to settings changes and update buses
   */
  _subscribeToSettings() {
    audioSettings.subscribe((key, value) => {
      // Update WebAudio buses
      if (key === 'muted') {
        this.buses.master.gain.setTargetAtTime(
          audioSettings.getEffectiveVolume(AudioGroup.MASTER),
          this.audioContext.currentTime,
          0.1
        );
      } else if (key === AudioGroup.MASTER) {
        this.buses.master.gain.setTargetAtTime(
          audioSettings.settings.muted ? 0 : value,
          this.audioContext.currentTime,
          0.1
        );
      } else if (this.buses[key]) {
        this.buses[key].gain.setTargetAtTime(value, this.audioContext.currentTime, 0.1);
      }
      
      // Update volumes on all active HTML5 Audio elements
      // This is necessary because HTML5 Audio isn't connected to WebAudio buses
      this._updateActiveVolumes();
    });
  }

  /**
   * Update volume on all active sounds based on current settings
   */
  _updateActiveVolumes() {
    this.activeSounds.forEach((instances, soundId) => {
      instances.forEach(handle => {
        if (handle.isDisposed || !handle.sound) return;
        
        const def = handle.def;
        if (!def) return;
        
        // Calculate new volume: base * group effective volume
        const groupVolume = audioSettings.getEffectiveVolume(def.group);
        const newVolume = def.volume * groupVolume;
        
        if (handle.isHtmlAudio) {
          // HTML5 Audio - set volume directly
          handle.sound.volume = newVolume;
        } else if (handle.sound.setVolume) {
          // Babylon.Sound
          handle.sound.setVolume(newVolume);
        }
      });
    });
  }

  /**
   * Handle tab visibility changes
   */
  _setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Pause all sounds
        this.activeSounds.forEach((instances) => {
          instances.forEach(handle => {
            if (handle.isPlaying) {
              this.wasPlayingBeforeHidden.add(handle);
              handle.pause();
            }
          });
        });
      } else {
        // Resume sounds
        this.wasPlayingBeforeHidden.forEach(handle => {
          if (!handle.isDisposed) {
            handle.resume();
          }
        });
        this.wasPlayingBeforeHidden.clear();
      }
    });
  }

  /**
   * Periodically clean up old event IDs
   */
  _startEventIdCleanup() {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      this.playedEventIds.forEach((timestamp, eventId) => {
        if (now - timestamp > EVENT_ID_TTL_MS) {
          this.playedEventIds.delete(eventId);
        }
      });
    }, EVENT_ID_TTL_MS);
  }

  /**
   * Attempt to unlock audio (call on user interaction)
   */
  async unlock() {
    if (this.unlocked) return true;
    
    if (!this.audioContext) {
      console.warn('[AudioManager] Cannot unlock - not initialized');
      return false;
    }

    try {
      // Resume our WebAudio context
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // IMPORTANT: Also unlock Babylon's audio engine
      const audioEngine = Engine.audioEngine;
      if (audioEngine && !audioEngine.unlocked) {
        console.log('[AudioManager] Unlocking Babylon audio engine...');
        await audioEngine.unlock();
      }
      
      // Play a silent buffer to fully unlock on iOS
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      
      this.unlocked = true;
      console.log('[AudioManager] Audio unlocked, context state now:', this.audioContext.state);
      console.log('[AudioManager] Babylon audioEngine unlocked:', audioEngine?.unlocked);
      
      // Play any pending sounds
      console.log('[AudioManager] Pending plays:', this.pendingPlays.length);
      this.pendingPlays.forEach(args => this.play(...args));
      this.pendingPlays = [];
      
      return true;
    } catch (e) {
      console.error('[AudioManager] Failed to unlock:', e);
      return false;
    }
  }

  /**
   * Check if audio is unlocked
   */
  isUnlocked() {
    return this.unlocked && this.audioContext?.state === 'running';
  }

  /**
   * Play a sound
   * @param {string} soundId - Registered sound ID
   * @param {Object} options - Play options
   * @param {Vector3} [options.position] - 3D position (for spatial sounds)
   * @param {string} [options.eventId] - Unique event ID for deduplication
   * @param {string} [options.source] - 'local' or 'server' for double-play prevention
   * @param {string} [options.tag] - Tag for grouped stop operations
   * @param {number} [options.volume] - Volume override (0-1)
   * @param {Function} [options.onEnd] - Callback when sound ends
   * @returns {Object|null} Sound handle or null if not played
   */
  play(soundId, options = {}) {
    console.log(`[AudioManager] play() called for: ${soundId}, eventId: ${options.eventId}, unlocked: ${this.isUnlocked()}`);
    
    // Queue if not unlocked
    if (!this.isUnlocked()) {
      console.log(`[AudioManager] Audio not unlocked, queueing: ${soundId}`);
      if (options.eventId) {
        this.playedEventIds.set(options.eventId, Date.now());
      }
      this.pendingPlays.push([soundId, options]);
      return null;
    }

    const def = getDefinition(soundId);
    if (!def) {
      console.warn(`[AudioManager] Unknown sound: ${soundId}`);
      return null;
    }
    
    console.log(`[AudioManager] Playing sound: ${soundId}, url: ${def.urls[0]}`);

    // Event ID deduplication
    if (options.eventId) {
      if (this.playedEventIds.has(options.eventId)) {
        console.log(`[AudioManager] Blocked duplicate event: ${options.eventId}`);
        return null;
      }
      this.playedEventIds.set(options.eventId, Date.now());
    }

    // Cooldown check
    const now = Date.now();
    const lastPlay = this.lastPlayTime.get(soundId) || 0;
    if (now - lastPlay < def.cooldownMs) {
      console.log(`[AudioManager] Blocked by cooldown: ${soundId} (${now - lastPlay}ms < ${def.cooldownMs}ms)`);
      return null;
    }
    this.lastPlayTime.set(soundId, now);

    // Polyphony check for this sound
    const instances = this.activeSounds.get(soundId) || new Set();
    if (instances.size >= def.maxInstances) {
      const oldest = instances.values().next().value;
      if (oldest) {
        this._stopInstance(oldest);
      }
    }

    // Global polyphony check
    if (this.activeCount >= MAX_CONCURRENT_SOUNDS) {
      this._cullOldestSound();
    }

    // Get variation URL
    const url = getVariationUrl(soundId);
    if (!url) return null;

    // Calculate effective volume
    const groupVolume = audioSettings.getEffectiveVolume(def.group);
    const finalVolume = def.volume * (options.volume ?? 1) * groupVolume;

    // Create Babylon.Sound
    const soundOptions = {
      autoplay: true, // Auto-play when ready
      loop: def.loop,
      volume: finalVolume,
      spatialSound: def.spatial,
      maxDistance: def.maxDistance,
      refDistance: def.refDistance,
      distanceModel: DEFAULT_3D_OPTIONS.distanceModel,
      rolloffFactor: DEFAULT_3D_OPTIONS.rolloffFactor
    };

    // Create handle first so we can reference it
    const handle = {
      id: soundId,
      sound: null,
      tag: options.tag,
      startTime: now,
      isPlaying: false,
      isDisposed: false,
      def,
      pause: () => {
        if (!handle.isDisposed && handle.sound) {
          handle.sound.pause();
          handle.isPlaying = false;
        }
      },
      resume: () => {
        if (!handle.isDisposed && handle.sound && !handle.isPlaying) {
          handle.sound.play();
          handle.isPlaying = true;
        }
      },
      stop: () => this._stopInstance(handle),
      setVolume: (vol) => {
        if (!handle.isDisposed && handle.sound) {
          const newVol = def.volume * vol * audioSettings.getEffectiveVolume(def.group);
          handle.sound.setVolume(newVol);
        }
      },
      setPosition: (pos) => {
        if (!handle.isDisposed && handle.sound && def.spatial) {
          handle.sound.setPosition(pos);
        }
      }
    };

    // Create sound instance
    console.log(`[AudioManager] Creating Babylon.Sound: ${soundId}, URL: ${url}`);
    console.log(`[AudioManager] Scene available: ${!!this.scene}, audioEnabled: ${this.scene?.audioEnabled}`);
    
    // Check if Babylon audio engine is ready
    const audioEngine = Engine.audioEngine;
    console.log(`[AudioManager] AudioEngine: ${!!audioEngine}, unlocked: ${audioEngine?.unlocked}, state: ${audioEngine?.audioContext?.state}`);
    
    // Try HTML5 Audio first for reliability
    console.log(`[AudioManager] Using HTML5 Audio for: ${soundId}, URL: ${url}`);
    
    const audio = new Audio(url);
    audio.volume = finalVolume;
    
    audio.addEventListener('canplaythrough', () => {
      console.log(`[AudioManager] HTML5 Audio ready: ${soundId}`);
    });
    
    audio.addEventListener('error', (e) => {
      // Only log if there's an actual error code
      if (audio.error) {
        console.error(`[AudioManager] HTML5 Audio error: ${soundId}`, audio.error.code, audio.error.message);
      }
    });
    
    // Play immediately
    audio.play()
      .then(() => {
        console.log(`[AudioManager] HTML5 Audio playing: ${soundId}`);
        handle.isPlaying = true;
      })
      .catch(err => {
        console.error(`[AudioManager] HTML5 Audio play failed: ${soundId}`, err);
      });
    
    handle.sound = audio;
    handle.isHtmlAudio = true; // Flag to handle cleanup differently

    // Track instance
    if (!this.activeSounds.has(soundId)) {
      this.activeSounds.set(soundId, new Set());
    }
    this.activeSounds.get(soundId).add(handle);
    this.activeCount++;

    // Handle end
    audio.addEventListener('ended', () => {
      if (!def.loop) {
        this._stopInstance(handle);
        options.onEnd?.();
      }
    });

    return handle;
  }

  /**
   * Stop a sound instance
   */
  _stopInstance(handle) {
    if (handle.isDisposed) return;
    
    handle.isDisposed = true;
    handle.isPlaying = false;
    
    try {
      if (handle.sound) {
        if (handle.isHtmlAudio) {
          // HTML5 Audio cleanup
          handle.sound.pause();
          handle.sound.currentTime = 0;
          handle.sound.src = ''; // Release resource
        } else {
          // Babylon.Sound cleanup
          handle.sound.stop();
          handle.sound.dispose();
        }
      }
    } catch (e) {
      // Sound might already be disposed
    }

    const instances = this.activeSounds.get(handle.id);
    if (instances) {
      instances.delete(handle);
      if (instances.size === 0) {
        this.activeSounds.delete(handle.id);
      }
    }
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  /**
   * Stop oldest active sound (for global polyphony limit)
   */
  _cullOldestSound() {
    let oldest = null;
    let oldestTime = Infinity;
    
    this.activeSounds.forEach(instances => {
      instances.forEach(handle => {
        if (handle.startTime < oldestTime) {
          oldestTime = handle.startTime;
          oldest = handle;
        }
      });
    });
    
    if (oldest) {
      this._stopInstance(oldest);
    }
  }

  /**
   * Stop all sounds with a specific tag
   */
  stopByTag(tag) {
    this.activeSounds.forEach(instances => {
      instances.forEach(handle => {
        if (handle.tag === tag) {
          this._stopInstance(handle);
        }
      });
    });
  }

  /**
   * Stop all instances of a sound
   */
  stopSound(soundId) {
    const instances = this.activeSounds.get(soundId);
    if (instances) {
      Array.from(instances).forEach(handle => this._stopInstance(handle));
    }
  }

  /**
   * Stop all sounds
   */
  stopAll() {
    this.activeSounds.forEach(instances => {
      Array.from(instances).forEach(handle => this._stopInstance(handle));
    });
  }

  /**
   * Play a 2D UI sound (convenience method)
   */
  playUI(soundId, options = {}) {
    return this.play(soundId, { ...options, position: null });
  }

  /**
   * Play a 3D sound at a position
   */
  play3D(soundId, position, options = {}) {
    return this.play(soundId, { ...options, position });
  }

  /**
   * Fade out a sound
   */
  fadeOut(handle, durationMs = 500) {
    if (!handle || handle.isDisposed || !handle.sound) return;
    
    const startVolume = handle.sound.getVolume();
    const startTime = Date.now();
    
    const fade = () => {
      if (handle.isDisposed) return;
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      handle.sound.setVolume(startVolume * (1 - progress));
      
      if (progress < 1) {
        requestAnimationFrame(fade);
      } else {
        this._stopInstance(handle);
      }
    };
    
    requestAnimationFrame(fade);
  }

  /**
   * Fade in a sound
   */
  fadeIn(soundId, options = {}, durationMs = 500) {
    const handle = this.play(soundId, { ...options, volume: 0 });
    if (!handle) return null;
    
    const targetVolume = options.volume ?? 1;
    const startTime = Date.now();
    
    const fade = () => {
      if (handle.isDisposed) return;
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      
      handle.setVolume(targetVolume * progress);
      
      if (progress < 1) {
        requestAnimationFrame(fade);
      }
    };
    
    requestAnimationFrame(fade);
    return handle;
  }

  /**
   * Cleanup
   */
  dispose() {
    this.stopAll();
    this.activeSounds.clear();
    this.playedEventIds.clear();
    this.lastPlayTime.clear();
    this.pendingPlays = [];
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.initialized = false;
  }
}

// Singleton export
export const audioManager = new AudioManager();
