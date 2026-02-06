/**
 * Asset Loader - Preloads game assets with progress tracking
 * 
 * Fetches all asset files to warm up the browser cache before the game starts.
 * This prevents visual pop-in of assets during gameplay as subsequent loads
 * will use the cached files.
 */
import '@babylonjs/loaders/glTF';

// Asset manifest - all assets that need to be preloaded
const ASSET_MANIFEST = {
  models: [
    // Ground terrain
    '/assets/ground.glb',
    '/assets/ground2.glb',
    
    // Environment/decor trees
    '/assets/decor/tree1.glb',
    '/assets/decor/tree2.glb',
    '/assets/decor/tree3.glb',
    '/assets/decor/tree5.glb',
    
    // VFX models
    '/assets/fireball.glb',
    '/assets/magicshard.glb',
    '/assets/rock.glb',
    '/assets/tp_ground.glb',
    
    // Character models
    '/models/archer/master.glb',
    '/models/assassin/master.glb',
    '/models/mage/master.glb',
    '/models/warrior/master.glb',
  ],
  
  textures: [
    // Core textures
    '/assets/noise.png',
    '/assets/watertexture.png',
    
    // Terrain textures
    '/assets/decor/forest_leaves_02_diffuse_1k.jpg',
    '/assets/decor/forest_leaves_02_nor_gl_1k.jpg',
    '/assets/decor/forest_leaves_02_rough_1k.jpg',
    
    // Wall textures - mossy stone
    '/assets/decor/mossy_stone_wall_diff_1k.jpg',
    '/assets/decor/mossy_stone_wall_nor_gl_1k.jpg',
    '/assets/decor/mossy_stone_wall_rough_1k.jpg',
    
    // Wall textures - mossy rock
    '/assets/decor/mossy_rock_diff_1k.jpg',
    '/assets/decor/mossy_rock_nor_gl_1k.jpg',
    '/assets/decor/mossy_rock_rough_1k.jpg',
    
    // Skybox
    '/assets/skybox.env',
  ],
};

/**
 * Preload all game assets by fetching them to warm up the browser cache
 * @param {Function} onProgress - Callback with progress (0-100)
 * @returns {Promise<void>}
 */
export async function preloadGameAssets(onProgress = () => {}) {
  const allAssets = [...ASSET_MANIFEST.models, ...ASSET_MANIFEST.textures];
  const totalAssets = allAssets.length;
  let loadedCount = 0;
  
  const updateProgress = () => {
    loadedCount++;
    const progress = Math.round((loadedCount / totalAssets) * 100);
    onProgress(progress);
  };
  
  // Fetch all assets in parallel to warm up browser cache
  const fetchPromises = allAssets.map(async (url) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to preload ${url}: ${response.status}`);
      }
      // Read the response to ensure it's fully cached
      await response.arrayBuffer();
      updateProgress();
    } catch (error) {
      console.warn(`Failed to preload ${url}:`, error.message);
      updateProgress(); // Still count as processed
    }
  });
  
  await Promise.all(fetchPromises);
  
  console.log(`[AssetLoader] Preloaded ${loadedCount}/${totalAssets} assets into browser cache`);
}

/**
 * No-op dispose function (browser cache doesn't need cleanup)
 */
export function disposePreloadedAssets() {
  // Browser cache cleanup not needed
}

export { ASSET_MANIFEST };
