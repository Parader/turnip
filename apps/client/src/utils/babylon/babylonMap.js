/**
 * Map building utilities for Babylon.js scene
 * Handles 3D map construction from terrain data
 */

import { MeshBuilder, StandardMaterial, Color3, Vector3, Material, Texture, DynamicTexture, Animation, Mesh, SceneLoader, VertexData, Matrix } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TILE_TYPES } from '../mapRenderer';

/**
 * Scatter trees on the skirt around the map
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} skirtBounds - Map bounds {mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight}
 * @param {Object} options - {modelFile, treeCount, minDistance, maxDistance, minScale, maxScale, groundY, seed}
 */
async function scatterTrees(scene, skirtBounds, options = {}) {
  const {
    modelFile = 'tree1.glb',
    treeCount = 50,
    minDistance = 10,
    maxDistance = 60,
    minScale = 1.0,
    maxScale = 1.0,
    groundY = -0.25,
    seed = 42069
  } = options;
  
  const { mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight } = skirtBounds;
  const treeName = modelFile.replace('.glb', '');
  
  try {
    const result = await SceneLoader.ImportMeshAsync('', '/assets/decor/', modelFile, scene);
    
    const meshes = result.meshes.filter(m => m.name !== '__root__' && m.getTotalVertices() > 0);
    
    if (meshes.length === 0) {
      console.warn(`[Trees] No meshes found in ${modelFile}`);
      return { treeInstances: [], instanceCount: 0 };
    }
    
    // Hide source meshes
    meshes.forEach(m => {
      m.isVisible = false;
      m.setEnabled(false);
    });
    
    // Seeded random for consistent placement
    let currentSeed = seed;
    const random = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };
    
    // Generate positions in ring around map
    const positions = [];
    const distanceRange = maxDistance - minDistance;
    const keepOutX = mapHalfWidth + minDistance;
    const keepOutZ = mapHalfHeight + minDistance;
    const outerX = mapHalfWidth + maxDistance;
    const outerZ = mapHalfHeight + maxDistance;
    
    let attempts = 0;
    while (positions.length < treeCount && attempts < treeCount * 20) {
      attempts++;
      
      const x = mapCenterX + (random() * 2 - 1) * outerX;
      const z = mapCenterZ + (random() * 2 - 1) * outerZ;
      
      // Skip if too close to map
      if (Math.abs(x - mapCenterX) < keepOutX && Math.abs(z - mapCenterZ) < keepOutZ) continue;
      
      // Skip if too close to another tree
      if (positions.some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      
      // Calculate scale based on distance
      const dist = Math.max(Math.abs(x - mapCenterX) - mapHalfWidth, Math.abs(z - mapCenterZ) - mapHalfHeight);
      const t = Math.min(1, Math.max(0, (dist - minDistance) / distanceRange));
      const baseScale = minScale + t * (maxScale - minScale);
      const scale = baseScale * (0.7 + random() * 0.6); // ±30% variation
      
      // Random rotation and slight tilt
      const rotationY = random() * Math.PI * 2;
      const tiltX = (random() - 0.5) * 0.1;
      const tiltZ = (random() - 0.5) * 0.1;
      
      positions.push({ x, z, scale, rotationY, tiltX, tiltZ });
    }
    
    // Get mesh bounds for ground positioning
    const meshMinY = meshes[0].getBoundingInfo().boundingBox.minimumWorld.y;
    
    // Clone trees at each position
    const treeInstances = [];
    const maxTrees = Math.min(positions.length, 100);
    
    for (let i = 0; i < maxTrees; i++) {
      const pos = positions[i];
      
      meshes.forEach((sourceMesh, j) => {
        const clone = sourceMesh.clone(`${treeName}_${i}_${j}`);
        if (!clone) return;
        
        clone.parent = null;
        clone.scaling = new Vector3(pos.scale, pos.scale, pos.scale);
        clone.position = new Vector3(pos.x, groundY - meshMinY * pos.scale, pos.z);
        clone.rotationQuaternion = null;
        clone.rotation = new Vector3(pos.tiltX || 0, pos.rotationY, pos.tiltZ || 0);
        clone.setEnabled(true);
        clone.isVisible = true;
        clone.isPickable = false;
        clone.applyFog = true;
        
        treeInstances.push(clone);
      });
    }
    
    console.log(`[Trees] Placed ${maxTrees} ${treeName}`);
    
    return {
      treeInstances,
      instanceCount: maxTrees,
      dispose: () => {
        treeInstances.forEach(t => t.dispose());
        result.meshes.forEach(m => m.dispose());
      }
    };
    
  } catch (error) {
    console.error(`[Trees] Failed to load ${modelFile}:`, error);
    return { treeInstances: [], instanceCount: 0 };
  }
}

/**
 * Detect contiguous regions of solid terrain (TILE + WALL) using flood fill
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @returns {Array<Set<string>>} Array of regions, each region is a Set of "x_y" tile keys
 */
function detectSolidTerrainRegions(terrain) {
  const mapHeight = terrain.length;
  const mapWidth = terrain[0]?.length || 0;
  const visited = new Set();
  const regions = [];
  
  // Check if a tile is solid terrain (TILE or WALL)
  const isSolidTerrain = (x, y) => {
    if (y < 0 || y >= mapHeight || x < 0 || x >= mapWidth) return false;
    const tileType = terrain[y][x];
    return tileType === TILE_TYPES.TILE || tileType === TILE_TYPES.WALL;
  };
  
  // Flood fill from a starting position
  const floodFill = (startX, startY) => {
    const region = new Set();
    const queue = [{ x: startX, y: startY }];
    
    while (queue.length > 0) {
      const { x, y } = queue.shift();
      const key = `${x}_${y}`;
      
      if (visited.has(key)) continue;
      if (!isSolidTerrain(x, y)) continue;
      
      visited.add(key);
      region.add(key);
      
      // Check orthogonal neighbors (no diagonals)
      queue.push({ x: x + 1, y: y }); // right
      queue.push({ x: x - 1, y: y }); // left
      queue.push({ x: x, y: y + 1 }); // down
      queue.push({ x: x, y: y - 1 }); // up
    }
    
    return region;
  };
  
  // Scan all tiles and detect regions
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const key = `${x}_${y}`;
      if (!visited.has(key) && isSolidTerrain(x, y)) {
        const region = floodFill(x, y);
        if (region.size > 0) {
          regions.push(region);
        }
      }
    }
  }
  
  return regions;
}

/**
 * Create 1x1 ground tiles for each tile in the region
 * All tiles same size = no visible scale differences
 * @param {Set<string>} region - Set of "x_y" tile keys
 * @returns {Array<Object>} Array of 1x1 squares
 */
function findRegionRectangles(region) {
  if (region.size === 0) return [];
  
  const squares = [];
  
  // Create one 1x1 ground piece per tile
  region.forEach(key => {
    const [x, y] = key.split('_').map(Number);
    
    squares.push({
      minX: x,
      maxX: x,
      minY: y,
      maxY: y,
      width: 1,
      height: 1,
      centerX: x,
      centerZ: y
    });
  });
  
  return squares;
}

/**
 * Build continuous ground terrain underneath the map using ground.glb
 * Creates multiple ground pieces that follow the actual terrain shape (avoids water/empty)
 * @param {Scene} scene - Babylon.js scene
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 * @param {Mesh} mapContainer - Parent container for ground meshes
 * @returns {Object} Ground building result with meshes (async loading)
 */
export function buildGroundTerrain(scene, terrain, mapWidth, mapHeight, mapContainer) {
  const tileSize = 1;
  const groundMeshes = [];
  const groundY = -0.05; // Slightly below gameplay tiles
  
  // Detect contiguous regions of solid terrain
  const regions = detectSolidTerrainRegions(terrain);
  
  console.log(`Ground terrain: detected ${regions.length} solid terrain region(s)`);
  
  if (regions.length === 0) {
    return {
      groundMeshes: [],
      regionCount: 0
    };
  }
  
  // Find all rectangles needed (across all regions)
  const allRectangles = [];
  regions.forEach((region, regionIndex) => {
    const rectangles = findRegionRectangles(region);
    rectangles.forEach(rect => {
      rect.regionIndex = regionIndex;
      allRectangles.push(rect);
    });
    console.log(`Region ${regionIndex}: ${region.size} tiles -> ${rectangles.length} rectangles`);
  });
  
  console.log(`Ground terrain: total ${allRectangles.length} ground rectangles to create`);
  
  if (allRectangles.length === 0) {
    return {
      groundMeshes: [],
      regionCount: regions.length
    };
  }
  
  // Possible rotations (0°, 90°, 180°, 270°) for visual variety
  const rotations = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  
  // Load both ground.glb and ground2.glb models for variety
  Promise.all([
    SceneLoader.ImportMeshAsync('', '/assets/', 'ground.glb', scene),
    SceneLoader.ImportMeshAsync('', '/assets/', 'ground2.glb', scene)
  ]).then(([result1, result2]) => {
    const groundModels = [result1.meshes[0], result2.meshes[0]];
    
    // Hide the original models (we'll clone them for each rectangle)
    groundModels.forEach(model => model.setEnabled(false));
    
    // Get bounds for each model to calculate scaling
    const modelData = groundModels.map((model, i) => {
      const bounds = model.getHierarchyBoundingVectors();
      const width = bounds.max.x - bounds.min.x;
      const depth = bounds.max.z - bounds.min.z;
      console.log(`Ground GLB ${i + 1} loaded: original size ${width.toFixed(2)} x ${depth.toFixed(2)}`);
      return { model, width, depth };
    });
    
    // Create a ground instance for each rectangle
    allRectangles.forEach((rect, index) => {
      // Calculate required size in world units
      const requiredWidth = rect.width * tileSize;
      const requiredDepth = rect.height * tileSize;
      
      // Randomly choose between the two ground models
      const modelIndex = Math.floor(Math.random() * 2);
      const { model, width: originalWidth, depth: originalDepth } = modelData[modelIndex];
      
      // Clone the model for this rectangle
      const rectGround = model.clone(`ground_r${rect.regionIndex}_${index}`, null);
      rectGround.setEnabled(true);
      
      // Enable all child meshes
      rectGround.getChildMeshes().forEach(child => {
        child.setEnabled(true);
        child.isPickable = false;
      });
      
      // Calculate scale to fit the rectangle
      const scaleX = requiredWidth / originalWidth;
      const scaleZ = requiredDepth / originalDepth;
      
      // Apply scaling
      rectGround.scaling = new Vector3(scaleX, 1, scaleZ);
      
      // Position at rectangle center
      rectGround.position = new Vector3(rect.centerX, groundY, rect.centerZ);
      
      // Apply random rotation (one of 4 directions) for visual variety
      // Clear quaternion so euler rotation works (GLB models use quaternion by default)
      rectGround.rotationQuaternion = null;
      const rotationIndex = Math.floor(Math.random() * 4);
      rectGround.rotation.y = rotations[rotationIndex];
      
      // Make not pickable
      rectGround.isPickable = false;
      
      groundMeshes.push(rectGround);
    });
    
    console.log(`Created ${groundMeshes.length} ground meshes (using 2 ground variants)`);
    
    // Dispose the original hidden models
    groundModels.forEach(model => model.dispose());
    
  }).catch((error) => {
    console.error('Failed to load ground GLB models:', error);
    
    // Fallback: create simple ground planes
    allRectangles.forEach((rect, index) => {
      const requiredWidth = rect.width * tileSize;
      const requiredDepth = rect.height * tileSize;
      
      const fallbackGround = MeshBuilder.CreateGround(`ground_fallback_${index}`, {
        width: requiredWidth,
        height: requiredDepth
      }, scene);
      
      fallbackGround.position = new Vector3(rect.centerX, groundY, rect.centerZ);
      
      // Apply random rotation for visual variety
      const rotationIndex = Math.floor(Math.random() * 4);
      fallbackGround.rotation.y = rotations[rotationIndex];
      
      const fallbackMaterial = new StandardMaterial(`groundMaterial_${index}`, scene);
      fallbackMaterial.diffuseColor = new Color3(0.5, 0.4, 0.3);
      fallbackMaterial.emissiveColor = new Color3(0.15, 0.1, 0.08);
      fallbackGround.material = fallbackMaterial;
      fallbackGround.isPickable = false;
      
      groundMeshes.push(fallbackGround);
    });
    
    console.log(`Created ${groundMeshes.length} fallback ground meshes`);
  });
  
  return {
    groundMeshes,
    regionCount: regions.length
  };
}

/**
 * Builds a 3D representation of the map terrain
 * @param {Scene} scene - Babylon.js scene
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 * @param {Object} startZones - Starting positions for teams A and B
 * @param {string} playerTeam - Player's team ('A' or 'B')
 * @param {string} enemyTeam - Enemy team ('A' or 'B')
 * @param {string} userId - Current user's ID
 * @param {Object} gameState - Current game state
 * @returns {Object} Map building result with tiles and materials
 */
export function build3DMap(scene, terrain, mapWidth, mapHeight, startZones, playerTeam, enemyTeam, userId, gameState) {
  const tileSize = 1; // Size of each tile in 3D units
  const tileHeight = 0.02; // Minimal height for walkable tiles
  const wallHeight = 0.5; // Height of walls

  // Create a set of starting positions for quick lookup
  const playerStartPositions = new Set();
  const enemyStartPositions = new Set();
  
  if (startZones) {
    // Player team starting positions
    if (startZones[playerTeam]) {
      startZones[playerTeam].forEach(pos => {
        playerStartPositions.add(`${pos.x}_${pos.y}`);
      });
    }
    // Enemy team starting positions
    if (startZones[enemyTeam]) {
      startZones[enemyTeam].forEach(pos => {
        enemyStartPositions.add(`${pos.x}_${pos.y}`);
      });
    }
  }

  // Base tile material - fully transparent with wireframe outline
  const createTileMaterial = (color, scene) => {
    const material = new StandardMaterial('tileMaterial', scene);
    material.diffuseColor = new Color3(0, 0, 0); // Black (invisible when alpha is 0)
    material.alpha = 0; // Fully transparent
    material.wireframe = true; // Show outline only
    material.emissiveColor = color.scale(0.5); // Outline color based on tile color
    material.disableLighting = true; // Ensure outline is always visible
    return material;
  };

  // Starting position materials - filled tiles visible during preparation phase
  const playerStartMaterial = new StandardMaterial('playerStartMaterial', scene);
  playerStartMaterial.diffuseColor = new Color3(0.2, 0.4, 1.0); // Blue
  playerStartMaterial.emissiveColor = new Color3(0.2, 0.4, 0.8); // Blue glow
  playerStartMaterial.alpha = 0.5; // Semi-transparent fill
  playerStartMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;

  const enemyStartMaterial = new StandardMaterial('enemyStartMaterial', scene);
  enemyStartMaterial.diffuseColor = new Color3(1.0, 0.2, 0.2); // Red
  enemyStartMaterial.emissiveColor = new Color3(0.8, 0.2, 0.2); // Red glow
  enemyStartMaterial.alpha = 0.5; // Semi-transparent fill
  enemyStartMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;

  // Wall material
  const wallMaterial = new StandardMaterial('wallMaterial', scene);
  wallMaterial.diffuseColor = new Color3(0.35, 0.35, 0.35); // Gray
  wallMaterial.specularColor = new Color3(0.2, 0.2, 0.2);

  // Empty material - invisible (no ground underneath empty tiles)
  const emptyMaterial = new StandardMaterial('emptyMaterial', scene);
  emptyMaterial.diffuseColor = new Color3(0, 0, 0);
  emptyMaterial.alpha = 0; // Fully invisible

  // Brown ground/earth material for water channel base
  const waterGroundMaterial = new StandardMaterial('waterGroundMaterial', scene);
  waterGroundMaterial.diffuseColor = new Color3(0.42, 0.31, 0.24); // Brown earth color (#6b4e3d)
  waterGroundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
  
  // Dirt/earth wall material for water channel sides
  const waterWallMaterial = new StandardMaterial('waterWallMaterial', scene);
  waterWallMaterial.diffuseColor = new Color3(0.35, 0.24, 0.18); // Darker brown (#5a3e2d)
  waterWallMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
  
  // Analyze water regions first to determine flow directions
  // Build a map of water tile positions
  const waterTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      if (terrain[y][x] === TILE_TYPES.WATER) {
        waterTiles.push({ x, y });
      }
    }
  }
  
  // Find connected water regions using flood fill
  const visited = new Set();
  const waterRegions = [];
  
  const getWaterNeighbors = (x, y) => {
    return [
      { x: x - 1, y: y }, // left
      { x: x + 1, y: y }, // right
      { x: x, y: y - 1 }, // top
      { x: x, y: y + 1 }  // bottom
    ].filter(n => 
      n.x >= 0 && n.x < mapWidth && 
      n.y >= 0 && n.y < mapHeight &&
      terrain[n.y][n.x] === TILE_TYPES.WATER
    );
  };
  
  // Flood fill to find connected regions
  waterTiles.forEach(tile => {
    const key = `${tile.x}_${tile.y}`;
    if (visited.has(key)) return;
    
    const region = [];
    const queue = [tile];
    visited.add(key);
    
    while (queue.length > 0) {
      const current = queue.shift();
      region.push(current);
      
      getWaterNeighbors(current.x, current.y).forEach(neighbor => {
        const neighborKey = `${neighbor.x}_${neighbor.y}`;
        if (!visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      });
    }
    
    if (region.length > 0) {
      waterRegions.push(region);
    }
  });
  
  // Determine flow direction for each region based on dominant axis
  const tileFlowDirections = new Map(); // "x_y" -> { uSpeed, vSpeed }
  const baseScrollSpeed = 0.05; // Base scroll speed for water animation
  
  waterRegions.forEach(region => {
    // Calculate region bounds
    const xs = region.map(t => t.x);
    const ys = region.map(t => t.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    
    // Count connections to determine dominant axis
    let horizontalConnections = 0; // left-right
    let verticalConnections = 0;   // up-down
    
    region.forEach(tile => {
      const neighbors = getWaterNeighbors(tile.x, tile.y);
      neighbors.forEach(n => {
        if (n.x !== tile.x) horizontalConnections++;
        if (n.y !== tile.y) verticalConnections++;
      });
    });
    
    // Determine dominant axis: if wider than tall, flow horizontally; otherwise vertically
    // Also consider connection counts as a tiebreaker
    const isHorizontal = width > height || (width === height && horizontalConnections >= verticalConnections);
    
    // Set flow direction: horizontal regions flow along X (U axis), vertical regions flow along Y (V axis)
    let uSpeed, vSpeed;
    
    if (isHorizontal) {
      // Flow horizontally (along the channel) - scroll U axis primarily
      uSpeed = baseScrollSpeed;
      vSpeed = baseScrollSpeed * 0.2; // Minimal perpendicular drift
    } else {
      // Flow vertically (along the channel) - scroll V axis primarily
      uSpeed = baseScrollSpeed * 0.2; // Minimal perpendicular drift
      vSpeed = baseScrollSpeed;
    }
    
    // Store flow direction for all tiles in this region
    region.forEach(tile => {
      const key = `${tile.x}_${tile.y}`;
      tileFlowDirections.set(key, { uSpeed, vSpeed });
    });
  });
  
  // Create base water texture (shared)
  const waterSurfaceTexture = new Texture('/assets/watertexture.png', scene);
  waterSurfaceTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  waterSurfaceTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  waterSurfaceTexture.uScale = 1.0;
  waterSurfaceTexture.vScale = 1.0;
  
  // Create materials and textures per region for independent flow directions
  // Group regions by flow direction to minimize material/texture count
  const flowDirectionGroups = new Map(); // "uSpeed_vSpeed" -> { uSpeed, vSpeed, texture, material, tiles: [] }
  
  waterRegions.forEach((region, regionIndex) => {
    // Get flow direction for this region (all tiles in region have same flow)
    const firstTile = region[0];
    const tileKey = `${firstTile.x}_${firstTile.y}`;
    const flow = tileFlowDirections.get(tileKey) || { uSpeed: baseScrollSpeed, vSpeed: baseScrollSpeed * 0.3 };
    const flowKey = `${flow.uSpeed.toFixed(4)}_${flow.vSpeed.toFixed(4)}`;
    
    if (!flowDirectionGroups.has(flowKey)) {
      // Create new texture and material for this flow direction
      const regionTexture = new Texture('/assets/watertexture.png', scene);
      regionTexture.wrapU = Texture.WRAP_ADDRESSMODE;
      regionTexture.wrapV = Texture.WRAP_ADDRESSMODE;
      regionTexture.uScale = 1.0;
      regionTexture.vScale = 1.0;
      
      const regionMaterial = new StandardMaterial(`waterMaterial_${flowKey}`, scene);
      regionMaterial.diffuseTexture = regionTexture;
      regionMaterial.diffuseColor = new Color3(1.0, 1.0, 1.0);
      regionMaterial.emissiveColor = new Color3(0.15, 0.25, 0.4);
      regionMaterial.alpha = 0.5;
      regionMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      
      flowDirectionGroups.set(flowKey, {
        uSpeed: flow.uSpeed,
        vSpeed: flow.vSpeed,
        texture: regionTexture,
        material: regionMaterial,
        tiles: []
      });
    }
    
    // Add all tiles from this region to the flow group
    region.forEach(tile => {
      flowDirectionGroups.get(flowKey).tiles.push(tile);
    });
  });
  
  // Soft, performance-aware water animation with per-region flow direction
  let animationStartTime = Date.now();
  
  const waterScrollObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = (Date.now() - animationStartTime) / 1000;
    
    // Update texture offsets for each flow direction group
    flowDirectionGroups.forEach((group, flowKey) => {
      const uOffset = (elapsed * group.uSpeed) % 1.0;
      const vOffset = (elapsed * group.vSpeed) % 1.0;
      
      group.texture.uOffset = uOffset;
      group.texture.vOffset = vOffset;
    });
  });
  
  const waterAnimationData = {
    observer: waterScrollObserver,
    flowDirectionGroups: flowDirectionGroups,
    tileFlowDirections: tileFlowDirections,
    // Cleanup function to dispose water animation resources
    dispose: () => {
      // Remove the observer
      if (waterScrollObserver) {
        scene.onBeforeRenderObservable.remove(waterScrollObserver);
      }
      // Dispose textures and materials
      flowDirectionGroups.forEach((group, flowKey) => {
        if (group.texture && !group.texture.isDisposed) {
          group.texture.dispose();
        }
        if (group.material && !group.material.isDisposed) {
          group.material.dispose();
        }
      });
      flowDirectionGroups.clear();
    }
  };
  
  // Array to store all water meshes
  const waterMeshes = [];

  // Create a parent mesh to hold all tiles
  const mapContainer = MeshBuilder.CreateBox('mapContainer', { size: 0.01 }, scene);
  mapContainer.isVisible = false;

  // Build continuous ground terrain underneath the gameplay tiles
  // This creates merged ground meshes for contiguous regions of solid terrain (TILE + WALL)
  const groundResult = buildGroundTerrain(scene, terrain, mapWidth, mapHeight, mapContainer);

  // Map to store starting position tiles for interaction (player team only)
  const startPositionTiles = new Map();
  // Array to store all starting position tiles (player + enemy) for visibility control
  const allStartPositionTiles = [];
  // Map to store all tiles for movement range highlighting: "x_y" -> mesh
  const allTiles = new Map();

  // Build tiles
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const tileType = terrain[y][x];
      const xPos = x * tileSize;
      const zPos = y * tileSize;
      const tileKey = `${x}_${y}`;
      const isPlayerStart = playerStartPositions.has(tileKey);
      const isEnemyStart = enemyStartPositions.has(tileKey);

      if (tileType === TILE_TYPES.NONE) {
        // Create a very low ground plane for empty spaces
        const emptyTile = MeshBuilder.CreateBox('emptyTile', {
          width: tileSize,
          height: 0.01,
          depth: tileSize
        }, scene);
        emptyTile.position = new Vector3(xPos, -0.05, zPos);
        emptyTile.material = emptyMaterial;
        emptyTile.parent = mapContainer;
      } else if (tileType === TILE_TYPES.TILE) {
        // Determine tile color based on checkerboard pattern
        const isLight = (x + y) % 2 === 0;
        const baseColor = isLight 
          ? new Color3(0.83, 0.65, 0.45) // Light beige
          : new Color3(0.72, 0.58, 0.42); // Dark beige

        // Create transparent tile
        const tile = MeshBuilder.CreateBox('tile', {
          width: tileSize,
          height: tileHeight,
          depth: tileSize
        }, scene);
        tile.position = new Vector3(xPos, tileHeight / 2, zPos);
        
        // Use starting position material if applicable, otherwise use transparent tile
        if (isPlayerStart) {
          tile.material = playerStartMaterial;
          // Make tile pickable and enable pointer events
          tile.isPickable = true;
          tile.enablePointerMoveEvents = true;
          // Store tile reference for interaction
          startPositionTiles.set(tile.uniqueId, {
            mesh: tile,
            x: x,
            y: y,
            isPlayerStart: true
          });
          // Also store by name for easier lookup
          tile.name = `startTile_${x}_${y}`;
          // Store tile coordinates in userData for material switching
          if (!tile.userData) {
            tile.userData = {};
          }
          tile.userData.tileX = x;
          tile.userData.tileY = y;
          tile.userData.isPlayerStart = true;
          // Add to all start tiles array for visibility control
          allStartPositionTiles.push(tile);
        } else if (isEnemyStart) {
          tile.material = enemyStartMaterial;
          tile.isPickable = false; // Enemy tiles not interactive
          // Store tile coordinates in userData for material switching
          if (!tile.userData) {
            tile.userData = {};
          }
          tile.userData.tileX = x;
          tile.userData.tileY = y;
          tile.userData.isPlayerStart = false;
          // Add to all start tiles array for visibility control
          allStartPositionTiles.push(tile);
        } else {
          tile.material = createTileMaterial(baseColor, scene);
          tile.isPickable = true; // Make tiles pickable for movement during game phase
        }
        tile.parent = mapContainer;
        
        // Store all walkable tiles for movement range highlighting
        const tileKey = `${x}_${y}`;
        allTiles.set(tileKey, tile);
        
        // Store tile coordinates in userData
        if (!tile.userData) {
          tile.userData = {};
        }
        tile.userData.tileX = x;
        tile.userData.tileY = y;
      } else if (tileType === TILE_TYPES.WALL) {
        // Create wall
        const wall = MeshBuilder.CreateBox('wall', {
          width: tileSize,
          height: wallHeight,
          depth: tileSize
        }, scene);
        wall.position = new Vector3(xPos, wallHeight / 2 - 0.05, zPos); // Lowered to match ground level
        wall.material = wallMaterial;
        wall.parent = mapContainer;
      } else if (tileType === TILE_TYPES.WATER) {
        // Water channel - flush with ground level at -0.15
        const waterSurfaceY = -0.05; // Slightly below gameplay tiles
        const channelDepth = 0.5; // Depth below water surface
        const groundHeight = 0.01; // Height of ground layer at bottom
        const wallThickness = 0.02; // Thickness of side walls
        
        // 1. Create brown ground/earth layer at the bottom of the channel
        const ground = MeshBuilder.CreateBox('waterGround', {
          width: tileSize,
          height: groundHeight,
          depth: tileSize
        }, scene);
        ground.position = new Vector3(xPos, waterSurfaceY - channelDepth + groundHeight / 2, zPos);
        ground.material = waterGroundMaterial;
        ground.parent = mapContainer;
        
        // 2. Create conditional side walls based on neighbors
        const mapHeight = terrain.length;
        const mapWidth = terrain[0]?.length || 0;
        
        // Check each edge: top, right, bottom, left
        const neighbors = [
          { x: x, y: y - 1, dir: 'top', normal: new Vector3(0, 0, -1) },    // Top (negative Z)
          { x: x + 1, y: y, dir: 'right', normal: new Vector3(1, 0, 0) },  // Right (positive X)
          { x: x, y: y + 1, dir: 'bottom', normal: new Vector3(0, 0, 1) }, // Bottom (positive Z)
          { x: x - 1, y: y, dir: 'left', normal: new Vector3(-1, 0, 0) }    // Left (negative X)
        ];
        
        neighbors.forEach(neighbor => {
          const isWater = neighbor.y >= 0 && neighbor.y < mapHeight &&
                          neighbor.x >= 0 && neighbor.x < mapWidth &&
                          terrain[neighbor.y][neighbor.x] === TILE_TYPES.WATER;
          
          // Only create wall if neighbor is NOT water
          if (!isWater) {
            let wall;
            let wallPosition;
            
            // Wall center Y position (from water surface down to channel bottom)
            const wallCenterY = waterSurfaceY - channelDepth / 2;
            
            if (neighbor.dir === 'top') {
              // Wall on top edge (facing negative Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_top`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, wallCenterY, zPos - tileSize / 2 + wallThickness / 2);
            } else if (neighbor.dir === 'right') {
              // Wall on right edge (facing positive X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_right`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos + tileSize / 2 - wallThickness / 2, wallCenterY, zPos);
            } else if (neighbor.dir === 'bottom') {
              // Wall on bottom edge (facing positive Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_bottom`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, wallCenterY, zPos + tileSize / 2 - wallThickness / 2);
            } else if (neighbor.dir === 'left') {
              // Wall on left edge (facing negative X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_left`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos - tileSize / 2 + wallThickness / 2, wallCenterY, zPos);
            }
            
            if (wall) {
              wall.position = wallPosition;
              wall.material = waterWallMaterial;
              wall.parent = mapContainer;
            }
          }
        });
        
        // 3. Create simple water surface plane with region-specific material
        const waterSurface = MeshBuilder.CreatePlane('waterSurface', {
          width: tileSize,
          height: tileSize
        }, scene);
        waterSurface.position = new Vector3(xPos, waterSurfaceY, zPos);
        waterSurface.rotation.x = Math.PI / 2; // Rotate to horizontal
        
        // Get flow direction for this tile and use corresponding material
        const tileKey = `${x}_${y}`;
        const flow = tileFlowDirections.get(tileKey);
        let materialToUse = null;
        
        if (flow) {
          // Find the material group for this flow direction
          const flowKey = `${flow.uSpeed.toFixed(4)}_${flow.vSpeed.toFixed(4)}`;
          const group = flowDirectionGroups.get(flowKey);
          if (group) {
            materialToUse = group.material;
          }
        }
        
        // Fallback to first available material if not found
        if (!materialToUse && flowDirectionGroups.size > 0) {
          materialToUse = Array.from(flowDirectionGroups.values())[0].material;
        }
        
        // Use the region-specific material (should always exist if water tiles were found)
        if (materialToUse) {
          waterSurface.material = materialToUse;
        } else {
          // Fallback: create a default material if somehow no flow direction was found
          const fallbackTexture = new Texture('/assets/watertexture.png', scene);
          fallbackTexture.wrapU = Texture.WRAP_ADDRESSMODE;
          fallbackTexture.wrapV = Texture.WRAP_ADDRESSMODE;
          fallbackTexture.uScale = 1.0;
          fallbackTexture.vScale = 1.0;
          
          const fallbackMaterial = new StandardMaterial('waterFallbackMaterial', scene);
          fallbackMaterial.diffuseTexture = fallbackTexture;
          fallbackMaterial.diffuseColor = new Color3(1.0, 1.0, 1.0);
          fallbackMaterial.emissiveColor = new Color3(0.15, 0.25, 0.4);
          fallbackMaterial.alpha = 0.5;
          fallbackMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
          waterSurface.material = fallbackMaterial;
        }
        waterSurface.parent = mapContainer;
        
        // Store water surface mesh for potential future updates
        waterMeshes.push(waterSurface);
      }
    }
  }
  
  // Tiles are centered at (x * tileSize, z * tileSize), so actual map edges are offset by half a tile
  const mapLeftEdge = -tileSize / 2;
  const mapRightEdge = (mapWidth - 1) * tileSize + tileSize / 2;
  const mapBottomEdge = -tileSize / 2;
  const mapTopEdge = (mapHeight - 1) * tileSize + tileSize / 2;
  const actualMapWidth = mapRightEdge - mapLeftEdge;
  const actualMapHeight = mapTopEdge - mapBottomEdge;
  const mapCenterX = (mapRightEdge + mapLeftEdge) / 2;
  const mapCenterZ = (mapTopEdge + mapBottomEdge) / 2;
  
  // Ramp parameters
  const rampWidth = 3.0; // How far the ramp extends outward
  const innerY = -0.05; // Height at board edge (matches ground mesh level)
  const outerY = -0.25; // Height at skirt level
  const innerRadius = 0.3; // Corner roundness at board edge
  const outerRadius = rampWidth + innerRadius; // Corner roundness at outer edge
  const segmentsPerCorner = 8; // Quality of rounded corners
  const skirtSize = 100; // How far the flat skirt extends beyond the ramp
  const skirtMeshes = [];
  
  // Create skirt/ramp material (shared)
  const skirtMaterial = new StandardMaterial('skirtMaterial', scene);
  skirtMaterial.diffuseColor = new Color3(0.35, 0.3, 0.22);
  skirtMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
  skirtMaterial.emissiveColor = new Color3(0.05, 0.04, 0.03);
  skirtMaterial.backFaceCulling = false;
  
  /**
   * Generate points for a rounded rectangle centered at origin
   * @param {number} width - Total width of rectangle
   * @param {number} height - Total height of rectangle  
   * @param {number} radius - Corner radius
   * @param {number} segments - Segments per corner
   * @param {number} y - Y height
   * @returns {Vector3[]} Array of points forming the rounded rectangle
   */
  function generateRoundedRectPoints(width, height, radius, segments, y) {
    const points = [];
    const halfW = width / 2;
    const halfH = height / 2;
    
    // Clamp radius to maximum possible
    const maxRadius = Math.min(halfW, halfH);
    const r = Math.min(radius, maxRadius);
    
    // Corner centers (inside the rectangle)
    const corners = [
      { cx: halfW - r, cz: halfH - r, startAngle: 0 },           // Top-right
      { cx: -halfW + r, cz: halfH - r, startAngle: Math.PI / 2 }, // Top-left
      { cx: -halfW + r, cz: -halfH + r, startAngle: Math.PI },    // Bottom-left
      { cx: halfW - r, cz: -halfH + r, startAngle: 3 * Math.PI / 2 } // Bottom-right
    ];
    
    corners.forEach(corner => {
      for (let i = 0; i <= segments; i++) {
        const angle = corner.startAngle + (i / segments) * (Math.PI / 2);
        const x = corner.cx + r * Math.cos(angle);
        const z = corner.cz + r * Math.sin(angle);
        points.push(new Vector3(x, y, z));
      }
    });
    
    return points;
  }
  
  // Generate inner and outer rounded rectangle paths
  const innerPoints = generateRoundedRectPoints(actualMapWidth, actualMapHeight, innerRadius, segmentsPerCorner, innerY);
  const outerPoints = generateRoundedRectPoints(actualMapWidth + rampWidth * 2, actualMapHeight + rampWidth * 2, outerRadius, segmentsPerCorner, outerY);
  
  // Offset points to map center
  innerPoints.forEach(p => { p.x += mapCenterX; p.z += mapCenterZ; });
  outerPoints.forEach(p => { p.x += mapCenterX; p.z += mapCenterZ; });
  
  // Close the paths by adding first point at the end
  innerPoints.push(innerPoints[0].clone());
  outerPoints.push(outerPoints[0].clone());
  
  // Create the ramp surface using ribbon
  const rampMesh = MeshBuilder.CreateRibbon('pyramidRamp', {
    pathArray: [outerPoints, innerPoints],
    closeArray: false,
    closePath: false,
    sideOrientation: Mesh.DOUBLESIDE
  }, scene);
  rampMesh.material = skirtMaterial;
  rampMesh.isPickable = false;
  rampMesh.receiveShadows = true;
  skirtMeshes.push(rampMesh);
  
  // Create flat skirt around the map (extends from map edge outward, under the ramp)
  // Left skirt - from map left edge outward
  const leftSkirt = MeshBuilder.CreateGround('skirtLeft', {
    width: skirtSize + rampWidth,
    height: actualMapHeight + skirtSize * 2
  }, scene);
  leftSkirt.position = new Vector3(mapCenterX - actualMapWidth / 2 - (skirtSize + rampWidth) / 2, outerY, mapCenterZ);
  leftSkirt.material = skirtMaterial;
  leftSkirt.isPickable = false;
  leftSkirt.receiveShadows = true;
  skirtMeshes.push(leftSkirt);
  
  // Right skirt - from map right edge outward
  const rightSkirt = MeshBuilder.CreateGround('skirtRight', {
    width: skirtSize + rampWidth,
    height: actualMapHeight + skirtSize * 2
  }, scene);
  rightSkirt.position = new Vector3(mapCenterX + actualMapWidth / 2 + (skirtSize + rampWidth) / 2, outerY, mapCenterZ);
  rightSkirt.material = skirtMaterial;
  rightSkirt.isPickable = false;
  rightSkirt.receiveShadows = true;
  skirtMeshes.push(rightSkirt);
  
  // Top skirt - from map top edge outward
  const topSkirt = MeshBuilder.CreateGround('skirtTop', {
    width: actualMapWidth,
    height: skirtSize + rampWidth
  }, scene);
  topSkirt.position = new Vector3(mapCenterX, outerY, mapCenterZ + actualMapHeight / 2 + (skirtSize + rampWidth) / 2);
  topSkirt.material = skirtMaterial;
  topSkirt.isPickable = false;
  topSkirt.receiveShadows = true;
  skirtMeshes.push(topSkirt);
  
  // Bottom skirt - from map bottom edge outward
  const bottomSkirt = MeshBuilder.CreateGround('skirtBottom', {
    width: actualMapWidth,
    height: skirtSize + rampWidth
  }, scene);
  bottomSkirt.position = new Vector3(mapCenterX, outerY, mapCenterZ - actualMapHeight / 2 - (skirtSize + rampWidth) / 2);
  bottomSkirt.material = skirtMaterial;
  bottomSkirt.isPickable = false;
  bottomSkirt.receiveShadows = true;
  skirtMeshes.push(bottomSkirt);
  
  // Scatter trees on the skirt
  const skirtBounds = {
    mapCenterX,
    mapCenterZ,
    mapHalfWidth: actualMapWidth / 2,
    mapHalfHeight: actualMapHeight / 2
  };
  
  // Load different tree types with their own placement rules
  const treePromise = Promise.all([
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree1.glb',
      treeCount: 100,
      minDistance: 10,
      maxDistance: 50,
      groundY: outerY,
      seed: 42069
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree2.glb',
      treeCount: 10,
      minDistance: 10,
      maxDistance: 30,
      groundY: outerY,
      seed: 12345
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree3.glb',
      treeCount: 40,
      minDistance: 15,
      maxDistance: 40,
      groundY: outerY,
      seed: 77777
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree5.glb',
      treeCount: 80,
      minDistance: 20,
      maxDistance: 50,
      groundY: outerY,
      seed: 55555
    })
  ]);
  
  return {
    interactiveTiles: startPositionTiles,
    allStartTiles: allStartPositionTiles,
    allTiles: allTiles,
    playerStartMaterial,
    enemyStartMaterial,
    createTileMaterial,
    waterMeshes,
    waterAnimationData,
    groundMeshes: groundResult.groundMeshes,
    skirtMeshes,
    treePromise
  };
}
