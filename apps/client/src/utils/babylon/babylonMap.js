/**
 * Map building utilities for Babylon.js scene
 * Handles 3D map construction from terrain data
 */

import { MeshBuilder, StandardMaterial, Color3, Vector3 } from '@babylonjs/core';
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
      }
    }
  }
  
  return {
    interactiveTiles: startPositionTiles, // Tiles that can be clicked (player team only)
    allStartTiles: allStartPositionTiles, // All starting position tiles (player + enemy) for visibility
    allTiles: allTiles, // All tiles for movement range highlighting
    playerStartMaterial: playerStartMaterial, // Material for player team starting positions
    enemyStartMaterial: enemyStartMaterial, // Material for enemy team starting positions
    createTileMaterial: createTileMaterial // Function to create regular tile material
  };
}
