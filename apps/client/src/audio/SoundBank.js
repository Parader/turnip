/**
 * SoundBank
 * Registry of sound definitions with preloading and variation support
 */

import { AudioGroup, DEFAULT_COOLDOWN_MS } from './constants';

// Sound definitions registry
const soundDefinitions = new Map();

// Preloaded ArrayBuffers
const loadedBuffers = new Map();

// Loading promises (to avoid duplicate loads)
const loadingPromises = new Map();

/**
 * Register a sound definition
 * @param {string} id - Sound identifier
 * @param {Object} definition - Sound definition
 * @param {string|string[]} definition.url - Single URL or array for variations
 * @param {string} definition.group - Volume group (AudioGroup)
 * @param {number} [definition.volume=1] - Base volume (0-1)
 * @param {boolean} [definition.loop=false] - Whether to loop
 * @param {boolean} [definition.spatial=false] - 3D positional audio
 * @param {number} [definition.maxInstances=4] - Max concurrent instances
 * @param {number} [definition.cooldownMs=50] - Min time between plays
 * @param {number} [definition.maxDistance=50] - 3D max audible distance
 * @param {number} [definition.refDistance=1] - 3D reference distance
 */
export function registerSound(id, definition) {
  const def = {
    volume: 1,
    loop: false,
    spatial: false,
    maxInstances: 4,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    maxDistance: 50,
    refDistance: 1,
    ...definition,
    // Normalize url to array for variations
    urls: Array.isArray(definition.url) ? definition.url : [definition.url]
  };
  soundDefinitions.set(id, def);
}

/**
 * Register multiple sounds at once
 */
export function registerSounds(definitions) {
  Object.entries(definitions).forEach(([id, def]) => registerSound(id, def));
}

/**
 * Get a sound definition
 */
export function getDefinition(id) {
  return soundDefinitions.get(id);
}

/**
 * Get a random variation URL for a sound
 */
export function getVariationUrl(id) {
  const def = soundDefinitions.get(id);
  if (!def) return null;
  const urls = def.urls;
  return urls[Math.floor(Math.random() * urls.length)];
}

/**
 * Preload a single sound (all variations)
 */
export async function preloadSound(id) {
  const def = soundDefinitions.get(id);
  if (!def) {
    console.warn(`[SoundBank] Unknown sound: ${id}`);
    return;
  }

  const promises = def.urls.map(url => preloadUrl(url));
  await Promise.all(promises);
}

/**
 * Preload a URL (returns cached if already loaded)
 */
async function preloadUrl(url) {
  // Already loaded
  if (loadedBuffers.has(url)) {
    return loadedBuffers.get(url);
  }

  // Currently loading
  if (loadingPromises.has(url)) {
    return loadingPromises.get(url);
  }

  // Start loading
  const promise = fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(buffer => {
      loadedBuffers.set(url, buffer);
      loadingPromises.delete(url);
      return buffer;
    })
    .catch(error => {
      console.error(`[SoundBank] Failed to load ${url}:`, error);
      loadingPromises.delete(url);
      throw error;
    });

  loadingPromises.set(url, promise);
  return promise;
}

/**
 * Preload multiple sounds
 */
export async function preloadSounds(ids) {
  await Promise.all(ids.map(id => preloadSound(id)));
}

/**
 * Preload all registered sounds
 */
export async function preloadAll() {
  const ids = Array.from(soundDefinitions.keys());
  await preloadSounds(ids);
}

/**
 * Check if a sound is loaded
 */
export function isLoaded(id) {
  const def = soundDefinitions.get(id);
  if (!def) return false;
  return def.urls.every(url => loadedBuffers.has(url));
}

/**
 * Get preloaded buffer for a URL
 */
export function getBuffer(url) {
  return loadedBuffers.get(url);
}

/**
 * Clear all loaded buffers (for cleanup)
 */
export function clearBuffers() {
  loadedBuffers.clear();
}

/**
 * Get all registered sound IDs
 */
export function getAllSoundIds() {
  return Array.from(soundDefinitions.keys());
}
