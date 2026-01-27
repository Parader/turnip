/**
 * Map building utilities for Babylon.js scene
 * Handles 3D map construction from terrain data
 */

import { MeshBuilder, StandardMaterial, Color3, Vector3, Material, Texture, DynamicTexture, Animation } from '@babylonjs/core';
import { TILE_TYPES } from '../mapRenderer';

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

  // Base tile material - transparent
  const createTileMaterial = (color, scene) => {
    const material = new StandardMaterial('tileMaterial', scene);
    material.diffuseColor = color;
    material.alpha = 0.3; // Transparent
    material.wireframe = false;
    material.emissiveColor = color.scale(0.2); // Slight glow
    return material;
  };

  // Starting position materials
  const playerStartMaterial = new StandardMaterial('playerStartMaterial', scene);
  playerStartMaterial.diffuseColor = new Color3(0.2, 0.4, 1.0); // Blue
  playerStartMaterial.emissiveColor = new Color3(0.2, 0.4, 1.0);
  playerStartMaterial.alpha = 0.6;

  const enemyStartMaterial = new StandardMaterial('enemyStartMaterial', scene);
  enemyStartMaterial.diffuseColor = new Color3(1.0, 0.2, 0.2); // Red
  enemyStartMaterial.emissiveColor = new Color3(1.0, 0.2, 0.2);
  enemyStartMaterial.alpha = 0.6;

  // Wall material
  const wallMaterial = new StandardMaterial('wallMaterial', scene);
  wallMaterial.diffuseColor = new Color3(0.35, 0.35, 0.35); // Gray
  wallMaterial.specularColor = new Color3(0.2, 0.2, 0.2);

  // Empty material
  const emptyMaterial = new StandardMaterial('emptyMaterial', scene);
  emptyMaterial.diffuseColor = new Color3(0.05, 0.05, 0.05); // Very dark
  emptyMaterial.alpha = 0.1;

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
    tileFlowDirections: tileFlowDirections
  };
  
  // Array to store all water meshes
  const waterMeshes = [];

  // Create a parent mesh to hold all tiles
  const mapContainer = MeshBuilder.CreateBox('mapContainer', { size: 0.01 }, scene);
  mapContainer.isVisible = false;

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
        wall.position = new Vector3(xPos, wallHeight / 2, zPos);
        wall.material = wallMaterial;
        wall.parent = mapContainer;
      } else if (tileType === TILE_TYPES.WATER) {
        // Water channel depth (below floor level)
        const channelDepth = 0.8; // Depth of the channel (increased from 0.15)
        const groundHeight = 0.01; // Height of ground layer
        const waterSurfaceHeight = 0.005; // Height of water surface layer
        const wallThickness = 0.02; // Thickness of side walls
        
        // 1. Create brown ground/earth layer at the bottom of the channel
        const ground = MeshBuilder.CreateBox('waterGround', {
          width: tileSize,
          height: groundHeight,
          depth: tileSize
        }, scene);
        ground.position = new Vector3(xPos, -channelDepth + groundHeight / 2, zPos);
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
            
            if (neighbor.dir === 'top') {
              // Wall on top edge (facing negative Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_top`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, -channelDepth / 2, zPos - tileSize / 2 + wallThickness / 2);
            } else if (neighbor.dir === 'right') {
              // Wall on right edge (facing positive X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_right`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos + tileSize / 2 - wallThickness / 2, -channelDepth / 2, zPos);
            } else if (neighbor.dir === 'bottom') {
              // Wall on bottom edge (facing positive Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_bottom`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, -channelDepth / 2, zPos + tileSize / 2 - wallThickness / 2);
            } else if (neighbor.dir === 'left') {
              // Wall on left edge (facing negative X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_left`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos - tileSize / 2 + wallThickness / 2, -channelDepth / 2, zPos);
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
        waterSurface.position = new Vector3(xPos, 0.01, zPos);
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
  
  return {
    interactiveTiles: startPositionTiles, // Tiles that can be clicked (player team only)
    allStartTiles: allStartPositionTiles, // All starting position tiles (player + enemy) for visibility
    allTiles: allTiles, // All tiles for movement range highlighting
    playerStartMaterial: playerStartMaterial, // Material for player team starting positions
    enemyStartMaterial: enemyStartMaterial, // Material for enemy team starting positions
    createTileMaterial: createTileMaterial, // Function to create regular tile material
    waterMeshes: waterMeshes, // Water meshes for potential future updates
    waterAnimationData: waterAnimationData // Water animation observer for cleanup
  };
}
