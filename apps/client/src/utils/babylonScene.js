import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, StandardMaterial, Color3, DirectionalLight, SceneLoader, AnimationGroup, ShadowGenerator, PBRMaterial, TransformNode, ActionManager, ExecuteCodeAction, PointerEventTypes, ArcRotateCameraPointersInput, Animation, DynamicTexture } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TILE_TYPES, doesTileBlockLOS } from './mapRenderer';
import { findPath, getMovementRange } from './pathfinding';
import { build3DMap } from './babylon/babylonMap';
import { buildPlayerCharacters, updatePlayerCharacters } from './babylon/babylonPlayers';
import { startMovementAnimation, startStanceAnimation, stopStanceAnimation, playCastAnimation, playHitAnimation, updateMovementAnimations, blendAnimations } from './babylon/babylonAnimations';
import { playSpellVfx } from './babylon/babylonVfx';
import { hasLOS, createTerrainBlocksFunction } from './lineOfSight';

// Helper to convert angle in radians to Babylon.js rotation (Y axis)
// In Babylon.js, rotation around Y axis: 
// 0 = facing +Z (forward), PI/2 = facing +X (right), PI = facing -Z (back), -PI/2 = facing -X (left)
const angleToRotation = (angle) => {
  // Models typically face +Z by default, so to face a direction:
  // - Facing +X (right): PI/2
  // - Facing -X (left): -PI/2 or 3*PI/2
  // - Facing +Z (forward): 0
  // - Facing -Z (back): PI
  return angle;
};

/**
 * Creates and initializes a Babylon.js scene with a 3D map
 * @param {HTMLCanvasElement} canvas - The canvas element to render to
 * @param {Object} mapData - Map data with terrain array
 * @param {Object} matchInfo - Match information with team data
 * @param {string} userId - Current user's ID
 * @param {Object} gameState - Current game state with player positions
 * @returns {Object} - Object containing engine, scene, camera, and cleanup function
 */
export function createBabylonScene(canvas, mapData, matchInfo, userId, gameState = null) {
  // Validate canvas
  if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('createBabylonScene: canvas element required');
  }

  // Create Babylon.js engine
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  // Create scene
  const scene = new Scene(engine);
  scene.clearColor = new Color3(0.1, 0.1, 0.15); // Dark blue-gray background

  // Create camera - positioned to look down at the map at an angle
  const terrain = mapData?.terrain || [];
  const mapWidth = terrain[0]?.length || 10;
  const mapHeight = terrain.length || 10;
  
  // Position camera to view the entire map initially
  // Will be updated to follow player character
  const maxCameraDistance = 10; // Maximum zoom out distance
  const minCameraDistance = 3; // Minimum zoom in distance
  // Initial alpha will be set when player character loads
  const camera = new ArcRotateCamera(
    'camera',
    0, // Horizontal angle (will be set behind character)
    Math.PI / 3,  // Vertical angle (looking down at character)
    maxCameraDistance, // Start at maximum zoom out
    new Vector3(mapWidth / 2, 1, mapHeight / 2), // Initial target (will follow player)
    scene
  );
  
  // Set camera limits for third-person view
  camera.lowerRadiusLimit = minCameraDistance; // Minimum distance
  camera.upperRadiusLimit = maxCameraDistance; // Maximum distance
  camera.lowerBetaLimit = Math.PI / 6; // Don't go too low
  camera.upperBetaLimit = Math.PI / 2.1; // Don't go too high
  
  // Explicitly set initial radius to maximum zoom out
  camera.radius = maxCameraDistance;
  
  // Set camera as active and attach controls
  scene.activeCamera = camera;
  // Only allow orbit control with middle mouse button
  camera.attachControl(canvas, false); // false = don't attach default controls
  camera.inputs.removeByType("ArcRotateCameraPointersInput");
  const pointersInput = new ArcRotateCameraPointersInput();
  pointersInput.buttons = [1]; // 1 = middle mouse button (0 = left, 1 = middle, 2 = right)
  camera.inputs.add(pointersInput);
  
  // Enable pointer events on the scene for picking
  scene.enablePointerEvents = true;
  
  // Make sure the scene can be picked
  scene.constantlyUpdateMeshUnderPointer = true;

  // Create ambient light
  const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), scene);
  ambientLight.intensity = 0.6;

  // Create directional light for better shadows
  const directionalLight = new DirectionalLight('directionalLight', new Vector3(-1, -1, -1), scene);
  directionalLight.intensity = 0.8;
  directionalLight.position = new Vector3(mapWidth, 10, mapHeight);

  // Determine which team the user is on
  const isOnTeam1 = matchInfo?.team1?.some(m => m.id === userId) || false;
  const playerTeam = isOnTeam1 ? 'A' : 'B';
  const enemyTeam = isOnTeam1 ? 'B' : 'A';

  // Build 3D map from terrain data
  let startPositionTiles = new Map(); // Store starting position tiles for interaction
  let allStartPositionTiles = []; // Store all starting position tiles (player + enemy) for visibility control
  let playerStartMaterial = null;
  let enemyStartMaterial = null;
  let createTileMaterial = null;
  let allTiles = new Map(); // Store all tiles for movement range highlighting
  if (mapData && terrain.length > 0) {
    const mapResult = build3DMap(scene, terrain, mapWidth, mapHeight, mapData.startZones, playerTeam, enemyTeam, userId, gameState);
    startPositionTiles = mapResult.interactiveTiles;
    allStartPositionTiles = mapResult.allStartTiles;
    playerStartMaterial = mapResult.playerStartMaterial;
    enemyStartMaterial = mapResult.enemyStartMaterial;
    createTileMaterial = mapResult.createTileMaterial;
    allTiles = mapResult.allTiles;
    
    // Store terrain data in scene metadata for pathfinding during movement animation
    if (!scene.metadata) {
      scene.metadata = {};
    }
    scene.metadata.terrain = terrain;
  }
  
  // Store callback for position change requests
  let onPositionChangeRequest = null;
  
  // Spell casting state
  let selectedSpell = null; // Currently selected spell for casting
  let selectedSpellDef = null; // Spell definition
  let isCasting = false; // Track if currently casting (prevents movement during cast animation)

  // Build player characters (spheres) if game state is available
  if (gameState) {
    buildPlayerCharacters(scene, gameState, userId, mapWidth, mapHeight);
    buildSpawnedEntities(scene, gameState, mapWidth, mapHeight);
  }
  
  // Initialize entity meshes storage
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.entityMeshes) {
    scene.metadata.entityMeshes = new Map(); // entityId -> mesh
  }

  // Store last camera target for smoothing
  let lastCameraTarget = camera.getTarget().clone();
  let cameraInitialized = false; // Track if camera has been positioned behind character
  let cameraRadiusInitialized = false; // Track if camera radius has been set to max
  
  // Initialize scene metadata if not already done
  if (!scene.metadata) {
    scene.metadata = {};
  }
  
  // Track player positions for movement animation (store in scene metadata for access)
  if (!scene.metadata.playerPreviousPositions) {
    scene.metadata.playerPreviousPositions = new Map(); // userId -> { x, y }
  }
  if (!scene.metadata.playerMovementAnimations) {
    scene.metadata.playerMovementAnimations = new Map(); // userId -> { isAnimating, animationType, startTime, path, currentStep }
  }
  
  // Function to update camera to follow player character (position only, not rotation)
  const updateCameraToFollowPlayer = () => {
    if (!scene.metadata || !scene.metadata.playerMeshes) return;
    
    // Get the current player's character mesh
    const playerMesh = scene.metadata.playerMeshes.get(userId);
    if (!playerMesh) return;
    
    // Get the world position of the player (could be container or mesh)
    let playerPosition;
    
    if (playerMesh instanceof TransformNode) {
      // It's a container, get its position
      playerPosition = playerMesh.getAbsolutePosition();
    } else {
      // It's a mesh, get its absolute position
      playerPosition = playerMesh.getAbsolutePosition();
    }
    
    // Calculate target position (look slightly above character)
    const targetPosition = new Vector3(
      playerPosition.x,
      playerPosition.y + 1, // Look slightly above character
      playerPosition.z
    );
    
    // Smooth interpolation factor for camera following
    const targetLerpFactor = 0.1;
    
    if (!cameraInitialized) {
      // First time: set camera target directly
      camera.setTarget(targetPosition);
      lastCameraTarget = targetPosition.clone();
      
      // Rotate Team A camera 180 degrees at game start
      if (playerTeam === 'A') {
        camera.alpha += Math.PI; // Rotate 180 degrees
        // Normalize to [0, 2*PI] range
        while (camera.alpha < 0) camera.alpha += 2 * Math.PI;
        while (camera.alpha >= 2 * Math.PI) camera.alpha -= 2 * Math.PI;
      }
      
      cameraInitialized = true;
    } else {
      // Smoothly move camera target to follow character position
      // Camera rotation (alpha) is controlled by the player, not automatically updated
      const newTarget = Vector3.Lerp(lastCameraTarget, targetPosition, targetLerpFactor);
      camera.setTarget(newTarget);
      lastCameraTarget = newTarget;
    }
    
    // Ensure camera radius is at max on first initialization
    if (!cameraRadiusInitialized) {
      camera.radius = maxCameraDistance;
      cameraRadiusInitialized = true;
    }
  };
  
  // Start render loop with camera following and movement animations
  engine.runRenderLoop(() => {
    updateCameraToFollowPlayer();
    updateMovementAnimations(scene);
    scene.render();
  });

  // Handle window resize
  const handleResize = () => {
    engine.resize();
  };
  window.addEventListener('resize', handleResize);

  // Set up pointer picking for starting position tiles
  let hoveredTile = null;
  let currentGameState = gameState; // Store current game state (will be updated via updatePlayers callback)
  const hoverMaterial = new StandardMaterial('hoverMaterial', scene);
  hoverMaterial.diffuseColor = new Color3(0.5, 0.7, 1.0); // Brighter blue
  hoverMaterial.emissiveColor = new Color3(0.3, 0.5, 1.0);
  hoverMaterial.alpha = 0.8;
  
  // Helper function to check if a tile is occupied
  const isTileOccupied = (x, y, currentGameState, currentUserId) => {
    if (!currentGameState || !currentGameState.myTeam) return false;
    
    // Check all players in my team (including current user - any occupied tile shouldn't show hover)
    const players = Object.values(currentGameState.myTeam.players || {});
    const occupied = players.some(player => 
      player.position && 
      player.position.x === x && 
      player.position.y === y
      // Removed userId check - we don't want hover on ANY occupied tile, including our own position
    );
    
    // Debug log
    if (occupied) {
      console.log(`Tile (${x}, ${y}) is occupied`);
    }
    
    return occupied;
  };
  
  // Movement system state
  let movementPath = []; // Current path being highlighted
  let previousHoveredPath = []; // Previous hovered path for path preference
  let previousHoveredTarget = null; // Previous hovered target tile {x, y}
  let movementPathMaterial = null; // Material for path tiles
  let onMovementRequest = null; // Callback for movement requests
  let onSpellCast = null; // Callback for spell cast requests
  
  // Multi-target spell system state
  let selectedTargets = []; // Array of {x, y} for multi-target spells
  let multiTargetSpell = null; // Reference to spell definition for multi-target spells
  let targetMarkers = new Map(); // Map of tileKey -> Array of {marker: Mesh, observer: Observer} objects
  
  // Initialize scene metadata for pending movement paths
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.pendingMovementPaths) {
    scene.metadata.pendingMovementPaths = new Map(); // userId -> { path, startTime }
  }
  
  // Create material for path visualization
  movementPathMaterial = new StandardMaterial('movementPathMaterial', scene);
  movementPathMaterial.diffuseColor = new Color3(0.0, 0.8, 0.0); // Bright green
  movementPathMaterial.emissiveColor = new Color3(0.0, 0.5, 0.0);
  movementPathMaterial.alpha = 0.6;
  
  // Create material for spell range visualization (light blue)
  let spellRangeMaterial = new StandardMaterial('spellRangeMaterial', scene);
  spellRangeMaterial.diffuseColor = new Color3(0.4, 0.6, 0.9); // Light blue
  spellRangeMaterial.emissiveColor = new Color3(0.2, 0.3, 0.5);
  spellRangeMaterial.alpha = 0.5;
  
  // Create material for spell target visualization (red)
  let spellTargetMaterial = new StandardMaterial('spellTargetMaterial', scene);
  spellTargetMaterial.diffuseColor = new Color3(0.8, 0.2, 0.2); // Red
  spellTargetMaterial.emissiveColor = new Color3(0.5, 0.1, 0.1);
  spellTargetMaterial.alpha = 0.7;
  
  // Create material for disabled/invalid spell target tiles (dimmed)
  let spellDisabledMaterial = new StandardMaterial('spellDisabledMaterial', scene);
  spellDisabledMaterial.diffuseColor = new Color3(0.3, 0.3, 0.3); // Dark gray
  spellDisabledMaterial.emissiveColor = new Color3(0.1, 0.1, 0.1); // Very dim
  spellDisabledMaterial.alpha = 0.3; // More transparent
  
  let spellRangeTiles = []; // Currently highlighted spell range tiles
  let spellTargetTiles = []; // Currently highlighted spell target tiles
  
  // Function to clear movement visualization
  const clearMovementVisualization = () => {
    // Clear path
    movementPath.forEach(tileKey => {
      const tile = allTiles.get(tileKey);
      if (tile && tile.userData && tile.userData.originalMaterial) {
        tile.material = tile.userData.originalMaterial;
      }
    });
    movementPath = [];
  };
  
  // Function to clear spell targeting visualization
  const clearSpellTargeting = () => {
    // Clear range tiles
    spellRangeTiles.forEach(tileKey => {
      const tile = allTiles.get(tileKey);
      if (tile && tile.userData && tile.userData.originalMaterial) {
        tile.material = tile.userData.originalMaterial;
      }
    });
    spellRangeTiles = [];
    
    // Clear target tiles
    spellTargetTiles.forEach(tileKey => {
      const tile = allTiles.get(tileKey);
      if (tile && tile.userData && tile.userData.originalMaterial) {
        tile.material = tile.userData.originalMaterial;
      }
    });
    spellTargetTiles = [];
  };
  
  // Function to update target markers (3D arcane torus rings) for multi-target spells
  const updateTargetMarkers = () => {
    // Clear existing markers and their animations
    targetMarkers.forEach((markers, tileKey) => {
      markers.forEach(markerData => {
        if (markerData && markerData.marker && !markerData.marker.isDisposed()) {
          // Remove animation observer if it exists
          if (markerData.observer) {
            scene.onBeforeRenderObservable.remove(markerData.observer);
          }
          markerData.marker.dispose();
        }
      });
    });
    targetMarkers.clear();
    
    // Count selections per tile
    const selectionCounts = new Map(); // tileKey -> count
    selectedTargets.forEach(target => {
      const tileKey = `${target.x}_${target.y}`;
      selectionCounts.set(tileKey, (selectionCounts.get(tileKey) || 0) + 1);
    });
    
    // Create markers for each selected tile
    selectionCounts.forEach((count, tileKey) => {
      const [x, y] = tileKey.split('_').map(Number);
      const markers = [];
      
      // Torus parameters
      const baseDiameter = 0.7; // Base torus diameter
      const thickness = 0.02; // Thin, elegant torus
      const baseHeight = 0.15; // Hover above ground
      const verticalSpacing = 0.12; // Clean spacing between stacked rings
      const rotationSpeed = 0.5; // Slow, deliberate rotation (radians per second)
      const bobAmplitude = 0.02; // Minimal bobbing
      const bobSpeed = 2.0; // Bobbing frequency
      
      for (let i = 0; i < count; i++) {
        // Create 3D torus ring
        const torus = MeshBuilder.CreateTorus(`targetMarker_${tileKey}_${i}`, {
          diameter: baseDiameter,
          thickness: thickness,
          tessellation: 32
        }, scene);
        
        // Position torus above the tile, stacked vertically
        // Torus is already horizontal (parallel to XZ plane) by default in Babylon.js
        const height = baseHeight + (i * verticalSpacing);
        torus.position.x = x;
        torus.position.y = height;
        torus.position.z = y; // game y maps to Babylon z
        
        // No X rotation needed - torus is already horizontal/parallel to ground
        // This creates a magical seal/binding placed on the ground
        
        // Create arcane purple/violet material
        const markerMaterial = new StandardMaterial(`targetMarkerMaterial_${tileKey}_${i}`, scene);
        markerMaterial.emissiveColor = new Color3(0.7, 0.4, 1.0); // Rich arcane purple
        markerMaterial.diffuseColor = new Color3(0.5, 0.2, 0.8); // Deep violet
        markerMaterial.alpha = 0.85;
        markerMaterial.specularColor = new Color3(0.8, 0.6, 1.0); // Soft purple specular
        markerMaterial.transparencyMode = 2; // MATERIAL_ALPHABLEND
        markerMaterial.backFaceCulling = false;
        markerMaterial.disableDepthWrite = true;
        
        torus.material = markerMaterial;
        torus.isPickable = false;
        
        // Add slow rotation and minimal bobbing animation
        const startTime = Date.now();
        const rotationPhase = (i * Math.PI * 0.3); // Phase difference for stacked rings
        const bobPhase = (i * Math.PI * 0.4); // Different bob phase for each ring
        
        const observer = scene.onBeforeRenderObservable.add(() => {
          if (!torus || torus.isDisposed()) {
            scene.onBeforeRenderObservable.remove(observer);
            return;
          }
          
          const elapsed = (Date.now() - startTime) / 1000; // seconds
          
          // Slow, deliberate rotation around Y axis
          torus.rotation.y = (elapsed * rotationSpeed) + rotationPhase;
          
          // Minimal bobbing - subtle vertical movement
          const bobOffset = Math.sin(elapsed * bobSpeed + bobPhase) * bobAmplitude;
          torus.position.y = height + bobOffset;
        });
        
        markers.push({ marker: torus, observer: observer });
      }
      
      targetMarkers.set(tileKey, markers);
    });
    
    // Store in scene metadata for cleanup
    if (!scene.metadata) {
      scene.metadata = {};
    }
    scene.metadata.targetMarkers = targetMarkers;
  };
  
  // Function to get all tiles within spell range
  const getSpellRangeTiles = (startX, startY, minRange, maxRange, terrain) => {
    const rangeTiles = [];
    const mapHeight = terrain.length;
    const mapWidth = terrain[0]?.length || 0;
    
    // Check all tiles in a square around the player
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        // Calculate Manhattan distance
        const distance = Math.abs(x - startX) + Math.abs(y - startY);
        
        // Check if tile is within range and walkable
        if (distance >= minRange && distance <= maxRange) {
          if (terrain[y][x] === TILE_TYPES.TILE) {
            rangeTiles.push({ x, y });
          }
        }
      }
    }
    
    return rangeTiles;
  };
  
  // Function to handle spell targeting visualization
  const handleSpellTargeting = (pointerInfo, currentPlayer, spellDef, terrain, allTiles, scene) => {
    const isLeftClick = pointerInfo.type === PointerEventTypes.POINTERDOWN && 
                        (pointerInfo.event.button === undefined || pointerInfo.event.button === 0);
    const isHover = pointerInfo.type === PointerEventTypes.POINTERMOVE;
    
    const targeting = spellDef.targeting || {};
    const range = targeting.range || { min: 0, max: 10 };
    const playerX = currentPlayer.position.x;
    const playerY = currentPlayer.position.y;
    
    // Check if this is a multi-target spell
    const isMultiTarget = targeting.multiTarget === true;
    const maxTargets = targeting.maxTargets || 1;
    
    // Initialize multi-target state if this is a multi-target spell
    if (isMultiTarget && !multiTargetSpell) {
      multiTargetSpell = spellDef;
      selectedTargets = [];
      console.log(`Multi-target spell selected: ${spellDef.spellId}, max targets: ${maxTargets}`);
    } else if (!isMultiTarget) {
      // Clear multi-target state if switching to single-target spell
      selectedTargets = [];
      multiTargetSpell = null;
      updateTargetMarkers(); // Clear markers
    }
    
    // Get the latest game state from scene metadata (always up-to-date)
    const latestGameState = scene.metadata?.gameState || currentGameState;
    
    // Build occupied tiles set ONCE at the start - used for ALL LOS calculations in this function
    // This ensures entities and players are calculated at the same time for all checks
    const occupiedTiles = new Set();
    if (latestGameState) {
      // Add all players from my team
      if (latestGameState.myTeam && latestGameState.myTeam.players) {
        Object.values(latestGameState.myTeam.players).forEach(player => {
          if (player.position) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      // Add all players from enemy team
      if (latestGameState.enemyTeam && latestGameState.enemyTeam.players) {
        Object.values(latestGameState.enemyTeam.players).forEach(player => {
          if (player.position) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      // Add spawned entities that block vision - calculated at the same time as players
      if (latestGameState.spawnedEntities) {
        Object.values(latestGameState.spawnedEntities).forEach(entity => {
          if (entity.position) {
            try {
              const entityData = JSON.parse(entity.data || '{}');
              if (entityData.blocksVision) {
                occupiedTiles.add(`${entity.position.x}_${entity.position.y}`);
              }
            } catch (error) {
              // Ignore parse errors
            }
          }
        });
      }
    }
    
    // Create blocks function for LOS checking ONCE (exclude caster's position)
    // This blocks function is used for ALL LOS checks: spell range visualization AND individual tile checks
    const blocks = createTerrainBlocksFunction(terrain, TILE_TYPES, occupiedTiles, { x: playerX, y: playerY }, doesTileBlockLOS);
    
    // Always show spell range when in cast mode
    if (isHover || isLeftClick) {
      // Clear previous visualization
      clearSpellTargeting();
      
      // Show spell range in light blue, with disabled tiles dimmed
      const rangeTiles = getSpellRangeTiles(playerX, playerY, range.min, range.max, terrain);
      rangeTiles.forEach(({ x, y }) => {
        const tileKey = `${x}_${y}`;
        const tile = allTiles.get(tileKey);
        if (tile) {
          if (!tile.userData) {
            tile.userData = {};
          }
          if (!tile.userData.originalMaterial) {
            tile.userData.originalMaterial = tile.material;
          }
          
          // Check if this tile is a valid target
          let isValidTarget = true;
          
          // For CELL targeting, check if tile is valid (not water, not wall, etc.)
          if (targeting.targetType === 'CELL') {
            const tileType = terrain[y][x];
            // Water tiles cannot be targeted
            if (tileType === TILE_TYPES.WATER) {
              isValidTarget = false;
            }
            // Only walkable tiles (TILE) can be targeted
            else if (tileType !== TILE_TYPES.TILE) {
              isValidTarget = false;
            }
          }
          
          // Check line of sight if required
          if (targeting.requiresLoS && isValidTarget) {
            const hasLineOfSight = hasLOS(
              { x: playerX, y: playerY },
              { x, y },
              blocks
            );
            if (!hasLineOfSight) {
              isValidTarget = false;
            }
          }
          
          if (targeting.targetType === 'UNIT') {
            // For UNIT targeting, must have a unit at the position that matches unitFilter
            isValidTarget = false;
            
            // Find unit at target position
            let targetUnit = null;
            if (currentGameState && currentGameState.myTeam && currentGameState.myTeam.players) {
              targetUnit = Object.values(currentGameState.myTeam.players).find(p => 
                p.position && p.position.x === x && p.position.y === y
              );
            }
            
            if (!targetUnit && currentGameState && currentGameState.enemyTeam && currentGameState.enemyTeam.players) {
              targetUnit = Object.values(currentGameState.enemyTeam.players).find(p => 
                p.position && p.position.x === x && p.position.y === y
              );
            }
            
            if (targetUnit) {
              // Check if unit matches the filter
              const isAlly = currentGameState && currentGameState.myTeam && 
                            currentGameState.myTeam.players && 
                            Object.values(currentGameState.myTeam.players).some(p => p.userId === targetUnit.userId);
              const isEnemy = !isAlly;
              
              const unitFilter = targeting.unitFilter || 'ANY';
              if (unitFilter === 'ALLY' && isAlly) {
                isValidTarget = true;
              } else if (unitFilter === 'ENEMY' && isEnemy) {
                isValidTarget = true;
              } else if (unitFilter === 'ANY') {
                isValidTarget = true;
              }
            }
          } else if (targeting.targetType === 'SELF') {
            // For SELF targeting, only valid if targeting the caster's own position
            isValidTarget = (x === playerX && y === playerY);
          }
          
          // Use disabled material for invalid targets, normal range material for valid ones
          tile.material = isValidTarget ? spellRangeMaterial : spellDisabledMaterial;
          spellRangeTiles.push(tileKey);
        }
      });
    }
    
    // Get pick result for target tile highlighting
    const x = pointerInfo.event.pointerX !== undefined ? pointerInfo.event.pointerX : (pointerInfo.event.offsetX || pointerInfo.event.clientX);
    const y = pointerInfo.event.pointerY !== undefined ? pointerInfo.event.pointerY : (pointerInfo.event.offsetY || pointerInfo.event.clientY);
    const pickResult = scene.pick(x, y, (mesh) => {
      return mesh.userData && mesh.userData.tileX !== undefined && mesh.userData.tileY !== undefined;
    });
    
    if (pickResult && pickResult.hit && pickResult.pickedMesh) {
      const pickedMesh = pickResult.pickedMesh;
      const tileX = pickedMesh.userData?.tileX;
      const tileY = pickedMesh.userData?.tileY;
      
      if (tileX !== undefined && tileY !== undefined) {
        // Calculate distance (Manhattan for now)
        const distance = Math.abs(tileX - playerX) + Math.abs(tileY - playerY);
        
        // Check if target is in range
        if (distance >= range.min && distance <= range.max) {
          // Check if target is valid based on targeting type and unitFilter
          let isValidTarget = true;
          
          // Check line of sight if required
          // Use the SAME blocks function that was created above for spell range visualization
          // This ensures entities and players are calculated at the same time
          if (targeting.requiresLoS) {
            const hasLineOfSight = hasLOS(
              { x: playerX, y: playerY },
              { x: tileX, y: tileY },
              blocks  // Reuse the same blocks function from above
            );
            if (!hasLineOfSight) {
              isValidTarget = false;
            }
          }
          
          if (targeting.targetType === 'UNIT') {
            // For UNIT targeting, must have a unit at the position that matches unitFilter
            isValidTarget = false;
            
            // Find unit at target position
            let targetUnit = null;
            if (currentGameState && currentGameState.myTeam && currentGameState.myTeam.players) {
              targetUnit = Object.values(currentGameState.myTeam.players).find(p => 
                p.position && p.position.x === tileX && p.position.y === tileY
              );
            }
            
            if (!targetUnit && currentGameState && currentGameState.enemyTeam && currentGameState.enemyTeam.players) {
              targetUnit = Object.values(currentGameState.enemyTeam.players).find(p => 
                p.position && p.position.x === tileX && p.position.y === tileY
              );
            }
            
            if (targetUnit) {
              // Check if unit matches the filter
              const isAlly = currentGameState && currentGameState.myTeam && 
                            currentGameState.myTeam.players && 
                            Object.values(currentGameState.myTeam.players).some(p => p.userId === targetUnit.userId);
              const isEnemy = !isAlly;
              
              const unitFilter = targeting.unitFilter || 'ANY';
              if (unitFilter === 'ALLY' && isAlly) {
                isValidTarget = true;
              } else if (unitFilter === 'ENEMY' && isEnemy) {
                isValidTarget = true;
              } else if (unitFilter === 'ANY') {
                isValidTarget = true;
              }
            }
            // If no unit found, isValidTarget remains false
          } else if (targeting.targetType === 'SELF') {
            // For SELF targeting, only valid if targeting the caster's own position
            isValidTarget = (tileX === playerX && tileY === playerY);
          }
          // For CELL targeting, any tile in range is valid (isValidTarget stays true)
          
          // Only highlight if target is valid
          if (isValidTarget) {
            // Highlight target tile in red (overrides range blue)
            const tileKey = `${tileX}_${tileY}`;
            const tile = allTiles.get(tileKey);
            if (tile) {
              if (!tile.userData) {
                tile.userData = {};
              }
              // Don't overwrite originalMaterial if already set
              if (!tile.userData.originalMaterial) {
                tile.userData.originalMaterial = tile.material;
              }
              tile.material = spellTargetMaterial;
              spellTargetTiles.push(tileKey);
            }
            
            // Handle spell cast on click
            if (isLeftClick) {
              if (isMultiTarget) {
                // Multi-target spell: add target to selection
                if (selectedTargets.length < maxTargets) {
                  selectedTargets.push({ x: tileX, y: tileY });
                  console.log(`Added target (${tileX}, ${tileY}), total: ${selectedTargets.length}/${maxTargets}`);
                  updateTargetMarkers(); // Update visual markers
                  
                  // If we've reached max targets, send spell cast request to server
                  if (selectedTargets.length >= maxTargets) {
                    console.log(`Multi-target spell complete, casting with ${selectedTargets.length} targets`);
                    
                    // Send spell cast request to server with targets array
                    if (onSpellCast) {
                      onSpellCast(spellDef.spellId || spellDef.name, selectedTargets);
                    }
                    
                    // Clear selection after sending request
                    selectedTargets = [];
                    multiTargetSpell = null;
                    updateTargetMarkers(); // Clear markers
                    
                    // Clear spell selection
                    selectedSpell = null;
                    selectedSpellDef = null;
                    if (scene.metadata) {
                      scene.metadata.selectedSpell = null;
                      scene.metadata.selectedSpellDef = null;
                    }
                    clearSpellTargeting();
                  }
                } else {
                  console.log(`Max targets (${maxTargets}) reached, cannot add more`);
                }
              } else {
                // Single-target spell: cast immediately
                if (onSpellCast) {
                  onSpellCast(spellDef.spellId || spellDef.name, tileX, tileY);
                }
              }
            }
          }
        }
      }
    }
  };
  
  // Set up pointer picking with proper event types
  console.log(`Setting up pointer observable, startPositionTiles size: ${startPositionTiles.size}`);
  console.log('Start position tiles:', Array.from(startPositionTiles.entries()).map(([id, tile]) => ({ id, x: tile.x, y: tile.y, meshName: tile.mesh.name })));
  
  scene.onPointerObservable.add((pointerInfo) => {
    // Handle game phase movement or spell casting
    if (currentGameState && currentGameState.phase === 'game' && currentGameState.currentPlayerId === userId) {
      // Get current player
      const currentPlayer = currentGameState.myTeam && Object.values(currentGameState.myTeam.players || {}).find(p => p.userId === userId);
      if (!currentPlayer || !currentPlayer.position) {
        if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
          clearMovementVisualization();
        }
        return;
      }
      
      // Check if we're in cast mode or currently casting
      const isCastMode = selectedSpell !== null && selectedSpellDef !== null;
      
      // If currently casting, disable movement to prevent animation glitches
      if (isCasting) {
        return; // Don't allow movement during cast animation
      }
      
      // If in cast mode, handle spell targeting
      if (isCastMode) {
        handleSpellTargeting(pointerInfo, currentPlayer, selectedSpellDef, terrain, allTiles, scene);
        return;
      }
      
      // Clear spell targeting when switching back to movement mode
      clearSpellTargeting();
      
      // Movement mode - existing movement logic
      // Calculate available movement points
      const availableMP = (currentPlayer.movementPoints || 0) - (currentPlayer.usedMovementPoints || 0);
      
      // Get the latest game state from scene metadata (always up-to-date)
      const latestGameStateForMovement = scene.metadata?.gameState || currentGameState;
      
      // Get all occupied tiles
      const occupiedTiles = new Set();
      if (latestGameStateForMovement.myTeam && latestGameStateForMovement.myTeam.players) {
        Object.values(latestGameStateForMovement.myTeam.players).forEach(player => {
          if (player.position && player.userId !== userId) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      if (latestGameStateForMovement.enemyTeam && latestGameStateForMovement.enemyTeam.players) {
        Object.values(latestGameStateForMovement.enemyTeam.players).forEach(player => {
          if (player.position) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      
      // Add spawned entities that block movement
      if (latestGameStateForMovement.spawnedEntities) {
        Object.values(latestGameStateForMovement.spawnedEntities).forEach(entity => {
          if (entity.position) {
            try {
              const entityData = JSON.parse(entity.data || '{}');
              if (entityData.blocksMovement) {
                occupiedTiles.add(`${entity.position.x}_${entity.position.y}`);
              }
            } catch (error) {
              // Ignore parse errors
            }
          }
        });
      }
      
      // Get pick result - use predicate to only pick tile meshes (skip character meshes)
      const x = pointerInfo.event.pointerX !== undefined ? pointerInfo.event.pointerX : (pointerInfo.event.offsetX || pointerInfo.event.clientX);
      const y = pointerInfo.event.pointerY !== undefined ? pointerInfo.event.pointerY : (pointerInfo.event.offsetY || pointerInfo.event.clientY);
      const pickResult = scene.pick(x, y, (mesh) => {
        // Only pick meshes that have tile coordinates (tiles), skip character meshes
        return mesh.userData && mesh.userData.tileX !== undefined && mesh.userData.tileY !== undefined;
      });
      
      if (pickResult && pickResult.hit && pickResult.pickedMesh) {
        const pickedMesh = pickResult.pickedMesh;
        const tileX = pickedMesh.userData?.tileX;
        const tileY = pickedMesh.userData?.tileY;
        
        if (tileX !== undefined && tileY !== undefined) {
            // Only process on pointer move (hover) or pointer down (click)
            // For clicks, only process left mouse button (button 0)
            // Middle mouse button (button 1) is for camera orbit, right button (button 2) is for context menu
            const isLeftClick = pointerInfo.type === PointerEventTypes.POINTERDOWN && 
                                (pointerInfo.event.button === undefined || pointerInfo.event.button === 0);
            const isHover = pointerInfo.type === PointerEventTypes.POINTERMOVE;
            
            if (isHover || isLeftClick) {
              // Determine preferred path: use previous hovered path if it's still valid and not longer
              let preferredPath = [];
              if (previousHoveredPath.length > 0 && previousHoveredTarget) {
                // Check if previous path is still valid (same start position)
                const prevStart = previousHoveredPath[0];
                if (prevStart && prevStart.x === currentPlayer.position.x && prevStart.y === currentPlayer.position.y) {
                  // Check if we can extend the previous path to the new target
                  // If the new target is on the previous path, use that portion
                  const prevTargetIndex = previousHoveredPath.findIndex(p => p.x === tileX && p.y === tileY);
                  if (prevTargetIndex >= 0) {
                    // New target is on previous path, use that portion
                    preferredPath = previousHoveredPath.slice(0, prevTargetIndex + 1);
                  } else {
                    // Check if we can use previous path as a prefix
                    // This is a simplified approach - we'll let the pathfinding handle it
                    preferredPath = previousHoveredPath;
                  }
                }
              }
              
              // Find path with preference for previous hovered path
              const path = findPath(
                terrain,
                currentPlayer.position.x,
                currentPlayer.position.y,
                tileX,
                tileY,
                occupiedTiles,
                preferredPath
              );
              
              // Debug: log pathfinding results
              if (path.length === 0) {
                console.log(`No path found from (${currentPlayer.position.x}, ${currentPlayer.position.y}) to (${tileX}, ${tileY}), availableMP: ${availableMP}`);
              }
              
              // Clear previous visualization
              clearMovementVisualization();
              
              // Show path if valid (only on hover, not click)
              if (isHover && path.length > 0) {
                const pathCost = path.length - 1; // -1 because path includes start position
                if (pathCost <= availableMP && pathCost > 0) { // Only show if path has movement (cost > 0)
                  // Highlight path (skip first tile - character's current position)
                  path.forEach((pos, index) => {
                    // Skip the first tile (character's current position)
                    if (index === 0) return;
                    
                    const tileKey = `${pos.x}_${pos.y}`;
                    const tile = allTiles.get(tileKey);
                    if (tile) {
                      if (!tile.userData) {
                        tile.userData = {};
                      }
                      if (!tile.userData.originalMaterial) {
                        tile.userData.originalMaterial = tile.material;
                      }
                      tile.material = movementPathMaterial;
                      movementPath.push(tileKey);
                    }
                  });
                  
                  // Store path and target for next hover preference
                  previousHoveredPath = path.map(pos => ({ x: pos.x, y: pos.y }));
                  previousHoveredTarget = { x: tileX, y: tileY };
                }
              }
              
              // Handle click to move (only left mouse button)
              if (isLeftClick && path.length > 0 && onMovementRequest) {
                const targetPos = path[path.length - 1];
                const pathCost = path.length - 1; // Movement cost is path length - 1
                
                if (pathCost <= availableMP) {
                  // Store the full path for animation (including start position)
                  // This is the exact path that was previsualized
                  const fullPath = path.map(pos => ({ x: pos.x, y: pos.y }));
                  
                  // Store in scene metadata so it persists
                  scene.metadata.pendingMovementPaths.set(userId, {
                    path: fullPath,
                    startTime: Date.now()
                  });
                  
                  // Send movement request to server with the previsualized path
                  onMovementRequest(targetPos.x, targetPos.y, fullPath);
                  
                  // Clear visualization after moving
                  clearMovementVisualization();
                  previousHoveredPath = [];
                  previousHoveredTarget = null;
                }
              }
            }
        }
      } 
      
      return; // Don't process preparation phase logic
    }
    
    // Preparation phase logic (existing code)
    if (!currentGameState || currentGameState.phase !== 'preparation') {
      // Restore hover if we're not in preparation
      if (hoveredTile && hoveredTile.userData && hoveredTile.userData.originalMaterial) {
        hoveredTile.material = hoveredTile.userData.originalMaterial;
        hoveredTile = null;
      }
      return;
    }
    
    // Check if current player is ready - if so, disable tile interaction
    const prepPhasePlayer = currentGameState.myTeam && Object.values(currentGameState.myTeam.players || {}).find(p => p.userId === userId);
    const isPlayerReady = prepPhasePlayer?.ready || false;
    
    if (isPlayerReady) {
      // Player is ready - restore hover and disable interaction
      if (hoveredTile && hoveredTile.userData && hoveredTile.userData.originalMaterial) {
        hoveredTile.material = hoveredTile.userData.originalMaterial;
        hoveredTile = null;
      }
      return; // Don't process hover/click when ready
    }
    
    // Get pick result - use predicate to only pick tile meshes (skip character meshes)
    // Babylon.js provides pointerX and pointerY in the event
    const x = pointerInfo.event.pointerX !== undefined ? pointerInfo.event.pointerX : (pointerInfo.event.offsetX || pointerInfo.event.clientX);
    const y = pointerInfo.event.pointerY !== undefined ? pointerInfo.event.pointerY : (pointerInfo.event.offsetY || pointerInfo.event.clientY);
    const pickResult = scene.pick(x, y, (mesh) => {
      // Only pick meshes that are start position tiles (for preparation phase)
      // Check if it's a start position tile by checking the startPositionTiles map
      return startPositionTiles.has(mesh.uniqueId);
    });
    
    if (!pickResult || !pickResult.hit) {
      // No hit, restore hover if needed
      if (hoveredTile && hoveredTile.userData && hoveredTile.userData.originalMaterial) {
        hoveredTile.material = hoveredTile.userData.originalMaterial;
        hoveredTile = null;
      }
      return;
    }
    
    // Debug: log what we picked
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      console.log(`Picked mesh: ${pickResult.pickedMesh?.name}, uniqueId: ${pickResult.pickedMesh?.uniqueId}, isPickable: ${pickResult.pickedMesh?.isPickable}`);
    }
    
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) { // PointerMove (hover)
      // Handle hover
      const pickedMesh = pickResult.pickedMesh;
      const tile = pickedMesh ? startPositionTiles.get(pickedMesh.uniqueId) : null;
      
      if (tile && tile.isPlayerStart) {
        // Check if tile is occupied
        const occupied = isTileOccupied(tile.x, tile.y, currentGameState, userId);
        
        // Only show hover effect if tile is not occupied
        if (!occupied) {
          // Restore previous hover if different tile
          if (hoveredTile && hoveredTile !== tile.mesh) {
            if (hoveredTile.userData && hoveredTile.userData.originalMaterial) {
              hoveredTile.material = hoveredTile.userData.originalMaterial;
            }
          }
          
          // Apply hover material
          if (tile.mesh !== hoveredTile) {
            // Initialize userData if it doesn't exist
            if (!tile.mesh.userData) {
              tile.mesh.userData = {};
            }
            if (!tile.mesh.userData.originalMaterial) {
              tile.mesh.userData.originalMaterial = tile.mesh.material;
            }
            tile.mesh.material = hoverMaterial;
            hoveredTile = tile.mesh;
          }
        } else {
          // Tile is occupied - don't show hover and restore if we were hovering
          if (hoveredTile === tile.mesh) {
            if (hoveredTile.userData && hoveredTile.userData.originalMaterial) {
              hoveredTile.material = hoveredTile.userData.originalMaterial;
            }
            hoveredTile = null;
          }
          // Don't apply hover material for occupied tiles
          return;
        }
      } else if (hoveredTile) {
        // Restore original material when not hovering
        if (hoveredTile.userData && hoveredTile.userData.originalMaterial) {
          hoveredTile.material = hoveredTile.userData.originalMaterial;
        }
        hoveredTile = null;
      }
    } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) { // PointerDown (click)
      // Only process left mouse button clicks (button 0)
      // Middle mouse button (button 1) is for camera orbit, right button (button 2) is for context menu
      if (pointerInfo.event.button !== 0) {
        return; // Ignore non-left clicks
      }
      
      // Prevent camera movement on click if we hit a tile
      if (pickResult.pickedMesh) {
        pointerInfo.event.preventDefault();
      }
      
      const pickedMesh = pickResult.pickedMesh;
      const tile = pickedMesh ? startPositionTiles.get(pickedMesh.uniqueId) : null;
      
      if (tile && tile.isPlayerStart) {
        console.log(`Clicked on tile (${tile.x}, ${tile.y})`);
        
        if (onPositionChangeRequest) {
          // Check if tile is occupied
          const occupied = isTileOccupied(tile.x, tile.y, currentGameState, userId);
          
          if (!occupied) {
            console.log(`Requesting position change to (${tile.x}, ${tile.y})`);
            onPositionChangeRequest(tile.x, tile.y);
          } else {
            console.log(`Tile (${tile.x}, ${tile.y}) is already occupied`);
          }
        } else {
          console.log('Position change request callback not set');
        }
      }
    }
  }, PointerEventTypes.POINTERMOVE | PointerEventTypes.POINTERDOWN); // Only listen to PointerMove and PointerDown events
  
  return { 
    engine, 
    scene, 
    camera, 
    handleResize, 
    updatePlayers: (newGameState) => {
      // Function to update player positions when game state changes
      if (newGameState) {
        currentGameState = newGameState; // Update current game state reference
        
        // Store game state in scene metadata for movement animation
        if (!scene.metadata) {
          scene.metadata = {};
        }
        scene.metadata.gameState = newGameState;
        
        updatePlayerCharacters(scene, newGameState, userId, mapWidth, mapHeight);
        updateSpawnedEntities(scene, newGameState, mapWidth, mapHeight);
        
        // If player is in cast mode, recalculate spell range to include newly spawned entities
        if (selectedSpell && selectedSpellDef && newGameState.phase === 'game') {
          const currentPlayer = newGameState.myTeam && 
            Object.values(newGameState.myTeam.players || {}).find(p => p.userId === userId);
          
          if (currentPlayer && currentPlayer.position && terrain) {
            const targeting = selectedSpellDef.targeting || {};
            const range = targeting.range || { min: 0, max: 10 };
            const playerX = currentPlayer.position.x;
            const playerY = currentPlayer.position.y;
            
            // Get the latest game state (should be newGameState, but use scene.metadata to be safe)
            const latestGameState = scene.metadata?.gameState || newGameState;
            
            // Build occupied tiles set with entities included
            const occupiedTiles = new Set();
            if (latestGameState) {
              // Add all players from my team
              if (latestGameState.myTeam && latestGameState.myTeam.players) {
                Object.values(latestGameState.myTeam.players).forEach(player => {
                  if (player.position) {
                    occupiedTiles.add(`${player.position.x}_${player.position.y}`);
                  }
                });
              }
              // Add all players from enemy team
              if (latestGameState.enemyTeam && latestGameState.enemyTeam.players) {
                Object.values(latestGameState.enemyTeam.players).forEach(player => {
                  if (player.position) {
                    occupiedTiles.add(`${player.position.x}_${player.position.y}`);
                  }
                });
              }
              // Add spawned entities that block vision - calculated at the same time as players
              if (latestGameState.spawnedEntities) {
                Object.values(latestGameState.spawnedEntities).forEach(entity => {
                  if (entity.position) {
                    try {
                      const entityData = JSON.parse(entity.data || '{}');
                      if (entityData.blocksVision) {
                        occupiedTiles.add(`${entity.position.x}_${entity.position.y}`);
                      }
                    } catch (error) {
                      // Ignore parse errors
                    }
                  }
                });
              }
            }
            
            // Create blocks function for LOS checking
            const blocks = createTerrainBlocksFunction(terrain, TILE_TYPES, occupiedTiles, { x: playerX, y: playerY }, doesTileBlockLOS);
            
            // Clear and recalculate spell range
            clearSpellTargeting();
            
            const rangeTiles = getSpellRangeTiles(playerX, playerY, range.min, range.max, terrain);
            rangeTiles.forEach(({ x, y }) => {
              const tileKey = `${x}_${y}`;
              const tile = allTiles.get(tileKey);
              if (tile) {
                if (!tile.userData) {
                  tile.userData = {};
                }
                if (!tile.userData.originalMaterial) {
                  tile.userData.originalMaterial = tile.material;
                }
                
                // Check if this tile is a valid target
                let isValidTarget = true;
                
                // For CELL targeting, check if tile is valid (not water, not wall, etc.)
                if (targeting.targetType === 'CELL') {
                  const tileType = terrain[y][x];
                  // Water tiles cannot be targeted
                  if (tileType === TILE_TYPES.WATER) {
                    isValidTarget = false;
                  }
                  // Only walkable tiles (TILE) can be targeted
                  else if (tileType !== TILE_TYPES.TILE) {
                    isValidTarget = false;
                  }
                }
                
                // Check line of sight if required
                if (targeting.requiresLoS && isValidTarget) {
                  const hasLineOfSight = hasLOS(
                    { x: playerX, y: playerY },
                    { x, y },
                    blocks
                  );
                  if (!hasLineOfSight) {
                    isValidTarget = false;
                  }
                }
                
                if (targeting.targetType === 'UNIT') {
                  // For UNIT targeting, must have a unit at the position that matches unitFilter
                  isValidTarget = false;
                  
                  // Find unit at target position
                  let targetUnit = null;
                  if (latestGameState && latestGameState.myTeam && latestGameState.myTeam.players) {
                    targetUnit = Object.values(latestGameState.myTeam.players).find(p => 
                      p.position && p.position.x === x && p.position.y === y
                    );
                  }
                  
                  if (!targetUnit && latestGameState && latestGameState.enemyTeam && latestGameState.enemyTeam.players) {
                    targetUnit = Object.values(latestGameState.enemyTeam.players).find(p => 
                      p.position && p.position.x === x && p.position.y === y
                    );
                  }
                  
                  if (targetUnit) {
                    // Check if unit matches the filter
                    const isAlly = latestGameState && latestGameState.myTeam && 
                                  latestGameState.myTeam.players && 
                                  Object.values(latestGameState.myTeam.players).some(p => p.userId === targetUnit.userId);
                    const isEnemy = !isAlly;
                    
                    const unitFilter = targeting.unitFilter || 'ANY';
                    if (unitFilter === 'ALLY' && isAlly) {
                      isValidTarget = true;
                    } else if (unitFilter === 'ENEMY' && isEnemy) {
                      isValidTarget = true;
                    } else if (unitFilter === 'ANY') {
                      isValidTarget = true;
                    }
                  }
                } else if (targeting.targetType === 'SELF') {
                  // For SELF targeting, only valid if targeting the caster's own position
                  isValidTarget = (x === playerX && y === playerY);
                }
                
                // Use disabled material for invalid targets, normal range material for valid ones
                tile.material = isValidTarget ? spellRangeMaterial : spellDisabledMaterial;
                spellRangeTiles.push(tileKey);
              }
            });
          }
        }
        
        // Update starting position tiles material based on phase
        // During preparation: show colored tiles (blue/red)
        // During game: show as regular tiles
        if (playerStartMaterial && enemyStartMaterial && createTileMaterial) {
          const isPreparationPhase = newGameState.phase === 'preparation';
          allStartPositionTiles.forEach(tile => {
            // Check if this is a player start tile or enemy start tile from userData
            const isPlayerStart = tile.userData?.isPlayerStart;
            
            // Only update if not currently highlighted by movement system or spell targeting
            const tileKey = `${tile.userData?.tileX}_${tile.userData?.tileY}`;
            const isInMovementPath = movementPath.includes(tileKey);
            const isInSpellRange = spellRangeTiles.includes(tileKey);
            const isInSpellTarget = spellTargetTiles.includes(tileKey);
            
            // During game phase, always show as regular tiles (not blue/red)
            // But preserve spell range and target highlights
            if (!isInMovementPath && !isInSpellRange && !isInSpellTarget) {
              if (isPreparationPhase) {
                // Restore original starting position material
                if (isPlayerStart) {
                  tile.material = playerStartMaterial;
                } else {
                  tile.material = enemyStartMaterial;
                }
              } else {
                // Always change to regular tile material during game phase
                const isLight = (tile.userData?.tileX + tile.userData?.tileY) % 2 === 0;
                const baseColor = isLight 
                  ? new Color3(0.83, 0.65, 0.45) // Light beige
                  : new Color3(0.72, 0.58, 0.42); // Dark beige
                tile.material = createTileMaterial(baseColor, scene);
              }
            }
          });
        }
        
        // Clear movement visualization when game state changes (e.g., turn changes)
        if (newGameState.phase === 'game' && newGameState.currentPlayerId !== userId) {
          clearMovementVisualization();
          previousHoveredPath = [];
          previousHoveredTarget = null;
        }
        
        // Clear movement visualization if player position changed (they moved)
        const currentPlayer = newGameState.myTeam && Object.values(newGameState.myTeam.players || {}).find(p => p.userId === userId);
        if (currentPlayer && currentPlayer.position) {
          if (previousHoveredPath.length > 0) {
            const prevStart = previousHoveredPath[0];
            if (prevStart && (prevStart.x !== currentPlayer.position.x || prevStart.y !== currentPlayer.position.y)) {
              // Player moved, clear previous path
              clearMovementVisualization();
              previousHoveredPath = [];
              previousHoveredTarget = null;
            }
          }
        }
        
        // Camera will follow automatically in render loop, but we can also update immediately
        // The render loop will handle smooth following
      }
    },
    setOnMovementRequest: (callback) => {
      onMovementRequest = callback; // Callback signature: (x, y, path) => void
    },
    setOnPositionChangeRequest: (callback) => {
      onPositionChangeRequest = callback;
    },
    setOnSpellCast: (callback) => {
      onSpellCast = callback; // Callback signature: (spellId, targetX, targetY) => void
    },
    setSelectedSpell: (spellId, spellDef) => {
      selectedSpell = spellId;
      selectedSpellDef = spellDef;
      
      // Reset multi-target state when spell changes
      selectedTargets = [];
      multiTargetSpell = null;
      
      // Clear target markers and their animations
      targetMarkers.forEach((markers, tileKey) => {
        markers.forEach(markerData => {
          if (markerData && markerData.marker && !markerData.marker.isDisposed()) {
            // Remove animation observer if it exists
            if (markerData.observer) {
              scene.onBeforeRenderObservable.remove(markerData.observer);
            }
            markerData.marker.dispose();
          }
        });
      });
      targetMarkers.clear();
      
      // Store in scene metadata
      if (!scene.metadata) {
        scene.metadata = {};
      }
      scene.metadata.selectedSpell = spellId;
      scene.metadata.selectedSpellDef = spellDef;
      
      // If spell is selected, start stance animation
      if (spellId && spellDef && spellDef.animations && spellDef.animations.prep) {
        startStanceAnimation(scene, userId, spellDef.animations.prep);
        
        // Show spell range immediately when entering cast mode
        if (currentGameState && currentGameState.phase === 'game') {
          const currentPlayer = currentGameState.myTeam && 
            Object.values(currentGameState.myTeam.players || {}).find(p => p.userId === userId);
          
          if (currentPlayer && currentPlayer.position && terrain) {
            const targeting = spellDef.targeting || {};
            const range = targeting.range || { min: 0, max: 10 };
            const playerX = currentPlayer.position.x;
            const playerY = currentPlayer.position.y;
            
            // Clear previous visualization
            clearSpellTargeting();
            
            // Show spell range with dimmed invalid tiles
            // Get the latest game state from scene metadata (always up-to-date)
            const latestGameState = scene.metadata?.gameState || currentGameState;
            
            // Collect all occupied tiles (player positions and blocking entities)
            // This ensures entities and players are calculated at the same time
            const occupiedTiles = new Set();
            if (latestGameState) {
              // Add all players from my team
              if (latestGameState.myTeam && latestGameState.myTeam.players) {
                Object.values(latestGameState.myTeam.players).forEach(player => {
                  if (player.position) {
                    occupiedTiles.add(`${player.position.x}_${player.position.y}`);
                  }
                });
              }
              // Add all players from enemy team
              if (latestGameState.enemyTeam && latestGameState.enemyTeam.players) {
                Object.values(latestGameState.enemyTeam.players).forEach(player => {
                  if (player.position) {
                    occupiedTiles.add(`${player.position.x}_${player.position.y}`);
                  }
                });
              }
              // Add spawned entities that block vision - calculated at the same time as players
              if (latestGameState.spawnedEntities) {
                Object.values(latestGameState.spawnedEntities).forEach(entity => {
                  if (entity.position) {
                    try {
                      const entityData = JSON.parse(entity.data || '{}');
                      if (entityData.blocksVision) {
                        occupiedTiles.add(`${entity.position.x}_${entity.position.y}`);
                      }
                    } catch (error) {
                      // Ignore parse errors
                    }
                  }
                });
              }
            }
            
            // Create blocks function for LOS checking (exclude caster's position)
            const blocks = createTerrainBlocksFunction(terrain, TILE_TYPES, occupiedTiles, { x: playerX, y: playerY }, doesTileBlockLOS);
            
            const rangeTiles = getSpellRangeTiles(playerX, playerY, range.min, range.max, terrain);
            rangeTiles.forEach(({ x, y }) => {
              const tileKey = `${x}_${y}`;
              const tile = allTiles.get(tileKey);
              if (tile) {
                if (!tile.userData) {
                  tile.userData = {};
                }
                if (!tile.userData.originalMaterial) {
                  tile.userData.originalMaterial = tile.material;
                }
                
                // Check if this tile is a valid target
                let isValidTarget = true;
                
                // For CELL targeting, check if tile is valid (not water, not wall, etc.)
                if (targeting.targetType === 'CELL') {
                  const tileType = terrain[y][x];
                  // Water tiles cannot be targeted
                  if (tileType === TILE_TYPES.WATER) {
                    isValidTarget = false;
                  }
                  // Only walkable tiles (TILE) can be targeted
                  else if (tileType !== TILE_TYPES.TILE) {
                    isValidTarget = false;
                  }
                }
                
                // Check line of sight if required
                if (targeting.requiresLoS && isValidTarget) {
                  const hasLineOfSight = hasLOS(
                    { x: playerX, y: playerY },
                    { x, y },
                    blocks
                  );
                  if (!hasLineOfSight) {
                    isValidTarget = false;
                  }
                }
                
                if (targeting.targetType === 'UNIT') {
                  // For UNIT targeting, must have a unit at the position that matches unitFilter
                  isValidTarget = false;
                  
                  // Find unit at target position
                  let targetUnit = null;
                  if (currentGameState && currentGameState.myTeam && currentGameState.myTeam.players) {
                    targetUnit = Object.values(currentGameState.myTeam.players).find(p => 
                      p.position && p.position.x === x && p.position.y === y
                    );
                  }
                  
                  if (!targetUnit && currentGameState && currentGameState.enemyTeam && currentGameState.enemyTeam.players) {
                    targetUnit = Object.values(currentGameState.enemyTeam.players).find(p => 
                      p.position && p.position.x === x && p.position.y === y
                    );
                  }
                  
                  if (targetUnit) {
                    // Check if unit matches the filter
                    const isAlly = currentGameState && currentGameState.myTeam && 
                                  currentGameState.myTeam.players && 
                                  Object.values(currentGameState.myTeam.players).some(p => p.userId === targetUnit.userId);
                    const isEnemy = !isAlly;
                    
                    const unitFilter = targeting.unitFilter || 'ANY';
                    if (unitFilter === 'ALLY' && isAlly) {
                      isValidTarget = true;
                    } else if (unitFilter === 'ENEMY' && isEnemy) {
                      isValidTarget = true;
                    } else if (unitFilter === 'ANY') {
                      isValidTarget = true;
                    }
                  }
                } else if (targeting.targetType === 'SELF') {
                  // For SELF targeting, only valid if targeting the caster's own position
                  isValidTarget = (x === playerX && y === playerY);
                }
                
                // Use disabled material for invalid targets, normal range material for valid ones
                tile.material = isValidTarget ? spellRangeMaterial : spellDisabledMaterial;
                spellRangeTiles.push(tileKey);
              }
            });
          }
        }
      } else if (!spellId) {
        // Cancel stance animation and return to idle
        stopStanceAnimation(scene, userId);
        // Clear spell targeting visualization
        clearSpellTargeting();
      }
      
      // Clear movement visualization when switching modes
      clearMovementVisualization();
    },
    playSpellCastAnimation: (castUserId, spellId, castAnimDef, spellDef = null, targetX = null, targetY = null, targets = null) => {
      // Determine if this is a multi-target spell
      const isMultiTarget = Array.isArray(targets) && targets.length > 0;
      
      // For rotation, use first target if multi-target, or single target
      const rotationTargetX = isMultiTarget ? (targets[0]?.x ?? null) : targetX;
      const rotationTargetY = isMultiTarget ? (targets[0]?.y ?? null) : targetY;
      
      // Rotate player to face target before casting
      if (rotationTargetX !== null && rotationTargetY !== null && scene.metadata && scene.metadata.playerMeshes) {
        const playerMesh = scene.metadata.playerMeshes.get(castUserId);
        if (playerMesh) {
          // Get caster position from game state or mesh
          const gameState = currentGameState || scene.metadata?.gameState;
          let casterX = null;
          let casterY = null;
          
          // Try to get from game state first
          if (gameState) {
            const myTeam = gameState.myTeam?.players;
            const enemyTeam = gameState.enemyTeam?.players;
            let caster = null;
            if (myTeam) {
              caster = Object.values(myTeam).find(p => p.userId === castUserId);
            }
            if (!caster && enemyTeam) {
              caster = Object.values(enemyTeam).find(p => p.userId === castUserId);
            }
            if (caster && caster.position) {
              casterX = caster.position.x;
              casterY = caster.position.y;
            }
          }
          
          // Fallback to mesh position if game state not available
          if (casterX === null && playerMesh.position) {
            casterX = playerMesh.position.x;
            casterY = playerMesh.position.z; // Z in Babylon = Y in game
          }
          
          if (casterX !== null && casterY !== null) {
            // Check if this is a self-cast (target is same as caster position)
            const isSelfCast = Math.abs(rotationTargetX - casterX) < 0.1 && Math.abs(rotationTargetY - casterY) < 0.1;
            
            // Only rotate if not self-casting
            if (!isSelfCast) {
              // Calculate direction from caster to target
              const dx = rotationTargetX - casterX;
              const dy = rotationTargetY - casterY;
              
              // Calculate target angle using atan2
              // In game coordinates: dx = X difference, dy = Y difference
              // In Babylon: 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X
              // atan2(dy, dx) gives angle from +X axis, but we need angle for +Z axis
              // So we use atan2(dx, dy) to get angle from +Z axis
              let targetAngle = Math.atan2(dx, dy);
              
              // Normalize to [0, 2*PI] range
              while (targetAngle < 0) targetAngle += 2 * Math.PI;
              while (targetAngle >= 2 * Math.PI) targetAngle -= 2 * Math.PI;
              
              // Get current rotation
              const currentRotation = playerMesh.rotation.y;
              
              // Calculate shortest rotation path
              let rotationDiff = targetAngle - currentRotation;
              if (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
              if (rotationDiff < -Math.PI) rotationDiff += 2 * Math.PI;
              
              // Smoothly rotate to target angle using render loop
              const rotationDuration = 200; // 200ms rotation duration
              const rotationStartTime = Date.now();
              const startRotation = currentRotation;
              const targetRotation = currentRotation + rotationDiff;
              
              // Store rotation state in mesh metadata
              if (!playerMesh.metadata) {
                playerMesh.metadata = {};
              }
              playerMesh.metadata.isRotating = true;
              playerMesh.metadata.rotationStartTime = rotationStartTime;
              playerMesh.metadata.rotationStartAngle = startRotation;
              playerMesh.metadata.rotationTargetAngle = targetRotation;
              playerMesh.metadata.rotationDuration = rotationDuration;
              
              // Use render loop for smooth rotation
              const rotationObserver = scene.onBeforeRenderObservable.add(() => {
                if (!playerMesh || !playerMesh.metadata || !playerMesh.metadata.isRotating) {
                  if (rotationObserver) {
                    scene.onBeforeRenderObservable.remove(rotationObserver);
                  }
                  return;
                }
                
                const elapsed = Date.now() - playerMesh.metadata.rotationStartTime;
                const progress = Math.min(elapsed / playerMesh.metadata.rotationDuration, 1.0);
                
                // Ease-in-out function for smooth rotation
                const easeInOut = (t) => {
                  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                };
                
                const easedProgress = easeInOut(progress);
                const currentAngle = playerMesh.metadata.rotationStartAngle + 
                  (playerMesh.metadata.rotationTargetAngle - playerMesh.metadata.rotationStartAngle) * easedProgress;
                
                playerMesh.rotation.y = currentAngle;
                
                if (progress >= 1.0) {
                  // Rotation complete
                  playerMesh.metadata.isRotating = false;
                  scene.onBeforeRenderObservable.remove(rotationObserver);
                }
              });
            }
            // If self-casting, keep current rotation (do nothing)
          }
        }
      }
      
      // Play cast animation for any player (for observers)
      if (castAnimDef) {
        const castStartTime = Date.now();
        
        // If casting as current user, set casting flag to disable movement
        if (castUserId === userId) {
          isCasting = true;
        }
        
        // Play cast animation and wait for it to complete
        playCastAnimation(scene, castUserId, castAnimDef).then(() => {
          // Cast animation completed - wait for blend-out before re-enabling movement
          const blendOutMs = castAnimDef.blendOutMs || 200;
          setTimeout(() => {
            // Re-enable movement for current user after blend-out completes
            if (castUserId === userId) {
              isCasting = false;
            }
          }, blendOutMs);
        }).catch((error) => {
          // On error, still clear the casting flag
          if (castUserId === userId) {
            isCasting = false;
          }
          console.error('Error in cast animation:', error);
        });
        
        // Play VFX if spell definition is provided
        // Ensure spellDef has spellId for routing
        if (spellDef && !spellDef.spellId) {
          spellDef.spellId = spellId;
        }
        
        // Play VFX for each target
        const targetsToProcess = isMultiTarget ? targets : (targetX !== null && targetY !== null ? [{ x: targetX, y: targetY }] : []);
        
        if (spellDef && spellDef.presentation && (spellDef.presentation.projectileVfx || spellDef.presentation.impactVfxDef || spellDef.presentation.groundEffectVfx) && targetsToProcess.length > 0) {
          // Get caster position - prioritize player mesh (most accurate)
          let casterPos = null;
          let casterOrientation = 0;
          
          // First try: get from player meshes in scene (most reliable for 3D position)
          if (scene.metadata && scene.metadata.playerMeshes) {
            const playerMesh = scene.metadata.playerMeshes.get(castUserId);
            if (playerMesh) {
              // Handle both TransformNode containers and direct meshes
              if (playerMesh.position) {
                casterPos = new Vector3(
                  playerMesh.position.x, 
                  playerMesh.position.y || 0.5, // Default height if not set
                  playerMesh.position.z
                );
                console.log(`Found caster position from player mesh: (${casterPos.x.toFixed(2)}, ${casterPos.y.toFixed(2)}, ${casterPos.z.toFixed(2)})`);
              } else if (playerMesh.metadata && playerMesh.metadata.modelMesh && playerMesh.metadata.modelMesh.position) {
                // Fallback: try to get from modelMesh if it's a container
                const modelMesh = playerMesh.metadata.modelMesh;
                casterPos = new Vector3(
                  playerMesh.position.x || modelMesh.position.x,
                  playerMesh.position.y || modelMesh.position.y || 0.5,
                  playerMesh.position.z || modelMesh.position.z
                );
                console.log(`Found caster position from modelMesh: (${casterPos.x.toFixed(2)}, ${casterPos.y.toFixed(2)}, ${casterPos.z.toFixed(2)})`);
              }
            }
          }
          
          // Get game state for orientation and fallback position
          const gameState = currentGameState || scene.metadata?.gameState;
          let caster = null;
          if (gameState) {
            const myTeam = gameState.myTeam?.players;
            const enemyTeam = gameState.enemyTeam?.players;
            
            if (myTeam) {
              caster = Object.values(myTeam).find(p => p.userId === castUserId);
            }
            if (!caster && enemyTeam) {
              caster = Object.values(enemyTeam).find(p => p.userId === castUserId);
            }
            
            if (caster) {
              // Get orientation
              if (caster.orientation !== undefined) {
                casterOrientation = caster.orientation;
              }
              
              // Fallback: use game state position if mesh position not found
              if (!casterPos && caster.position) {
                casterPos = new Vector3(caster.position.x, 0.5, caster.position.y); // Y=0.5 for character height, map y->z
                console.log(`Found caster position from gameState: (${caster.position.x}, ${caster.position.y})`);
              }
            }
          }
          
          if (casterPos && (Math.abs(casterPos.x) > 0.01 || Math.abs(casterPos.z) > 0.01)) {
            // Calculate spawn position in front of caster (0.3 units forward at character height)
            const spawnOffset = 0.3;
            // In Babylon.js: orientation 0 = +Z, PI/2 = +X, PI = -Z, -PI/2 = -X
            // So cos(orientation) gives X direction, sin(orientation) gives Z direction
            const spawnX = casterPos.x + Math.cos(casterOrientation) * spawnOffset;
            const spawnZ = casterPos.z + Math.sin(casterOrientation) * spawnOffset;
            const spawnY = casterPos.y + 0.3; // Slightly above character center
            const spawnPos = new Vector3(spawnX, spawnY, spawnZ);
            
            // Process each target
            targetsToProcess.forEach((target, index) => {
              // Convert target grid coordinates to world coordinates
              // tileSize is 1 in Babylon.js, so grid coordinates = world coordinates
              // But ensure we're using the correct coordinate system: game y -> Babylon z
              const tileSize = 1; // Babylon.js uses 1 unit per tile
              const targetWorldX = target.x * tileSize;
              const targetWorldZ = target.y * tileSize; // game y maps to Babylon z
              const targetPos = new Vector3(targetWorldX, 0.3, targetWorldZ); // Target at same height
              
              // Delay each projectile slightly for multi-target spells
              const delay = index * 150; // 150ms delay between each projectile
              setTimeout(() => {
                console.log(`Playing VFX for spell ${spellId} target ${index + 1}/${targetsToProcess.length}: spawn at (${spawnPos.x.toFixed(2)}, ${spawnPos.y.toFixed(2)}, ${spawnPos.z.toFixed(2)}), target at (${targetPos.x.toFixed(2)}, ${targetPos.z.toFixed(2)}), orientation: ${casterOrientation.toFixed(2)}`);
                // Use actual spell definition for VFX
                const vfxSpellDef = {
                  spellId: spellId,
                  presentation: spellDef.presentation || {}
                };
                // Pass missile index and total count for arcane_missile multi-target pattern
                const totalMissiles = targetsToProcess.length;
                playSpellVfx(scene, vfxSpellDef, spawnPos, targetPos, castStartTime, index, totalMissiles);
              }, delay);
            });
          } else {
            console.error(`Could not find valid caster position for VFX: ${castUserId}. Position: ${casterPos ? `(${casterPos.x}, ${casterPos.y}, ${casterPos.z})` : 'null'}. GameState: ${!!gameState}, Player meshes: ${!!(scene.metadata && scene.metadata.playerMeshes)}`);
            if (scene.metadata && scene.metadata.playerMeshes) {
              console.log('Available player meshes:', Array.from(scene.metadata.playerMeshes.keys()));
            }
          }
        } else {
          if (!spellDef) {
            console.warn(`No spell definition provided for VFX: ${spellId}`);
          } else if (!spellDef.presentation) {
            console.warn(`No presentation data in spell definition for: ${spellId}`);
          } else if (targetsToProcess.length === 0) {
            console.warn(`No targets provided for VFX: targetsToProcess=${targetsToProcess.length}`);
          }
        }
      } else {
        console.warn(`Cannot play cast animation: cast animation definition not provided for spell "${spellId}"`);
      }
    },
    playSpellPrepAnimation: (prepUserId, spellId, prepAnimDef) => {
      // Play stance animation for any player (for observers)
      if (prepAnimDef) {
        startStanceAnimation(scene, prepUserId, prepAnimDef);
      } else {
        console.warn(`Cannot play prep animation: prep animation definition not provided for spell "${spellId}"`);
      }
    },
    stopSpellPrepAnimation: (prepUserId) => {
      // Stop stance animation for any player (for observers)
      stopStanceAnimation(scene, prepUserId);
    },
    playHitAnimation: (targetUserId) => {
      // Play hit animation for any player (for observers)
      playHitAnimation(scene, targetUserId);
    },
    clearMovementVisualization: () => {
      // Clear movement visualization
      clearMovementVisualization();
    }
  };
}

/**
 * Create a mesh for a spawned entity
 * @param {Object} entity - Entity data
 * @param {Scene} scene - Babylon.js scene
 * @param {number} tileSize - Size of each tile
 * @returns {Promise<Mesh>} Created mesh
 */
async function createEntityMesh(entity, scene, tileSize) {
  const xPos = entity.position.x * tileSize;
  const zPos = entity.position.y * tileSize;
  
  let mesh = null;
  const entityId = entity.entityId;
  
  // Create mesh based on entity type
  switch (entity.entityType) {
    case 'earth_block':
      // Load rock model from assets
      try {
        const modelPath = '/assets/rock.glb';
        console.log(`Loading rock model for earth_block entity ${entityId} from: ${modelPath}`);
        const result = await SceneLoader.ImportMeshAsync('', modelPath, '', scene);
        
        console.log(`Rock model loaded: ${result.meshes.length} meshes found`);
        
        if (result.meshes && result.meshes.length > 0) {
          // Find the root mesh (one without a parent, or use the first one)
          let rootMesh = result.meshes.find(m => !m.parent) || result.meshes[0];
          
          // Create a TransformNode container to handle rotation reliably
          const entityContainer = new TransformNode(`entityContainer_${entityId}`, scene);
          
          // Make the root mesh a child of the container
          rootMesh.parent = entityContainer;
          rootMesh.position = Vector3.Zero();
          rootMesh.rotation = Vector3.Zero();
          
          // Use container as the mesh reference
          mesh = entityContainer;
          mesh.name = `entity_${entityId}`;
          
          // Store reference to the actual model mesh
          mesh.metadata = mesh.metadata || {};
          mesh.metadata.modelMesh = rootMesh;
          
          // Make all child meshes non-pickable
          result.meshes.forEach(m => {
            m.isPickable = false;
          });
          
          // Compute bounding box from all meshes
          // Sometimes the root mesh doesn't have proper bounding info, so we compute it from all meshes
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          
          result.meshes.forEach(m => {
            if (m.getBoundingInfo) {
              const info = m.getBoundingInfo();
              if (info && info.boundingBox) {
                const min = info.boundingBox.minimum;
                const max = info.boundingBox.maximum;
                minX = Math.min(minX, min.x);
                minY = Math.min(minY, min.y);
                minZ = Math.min(minZ, min.z);
                maxX = Math.max(maxX, max.x);
                maxY = Math.max(maxY, max.y);
                maxZ = Math.max(maxZ, max.z);
              }
            }
          });
          
          // If bounding box is still invalid, use default size
          let size, maxSize;
          if (minX === Infinity || maxX === -Infinity) {
            console.warn('Could not compute bounding box from meshes, using default size');
            size = { x: 1, y: 1, z: 1 };
            maxSize = 1;
          } else {
            size = {
              x: maxX - minX,
              y: maxY - minY,
              z: maxZ - minZ
            };
            maxSize = Math.max(size.x, size.y, size.z);
          }
          
          console.log(`Rock model size: ${size.x}, ${size.y}, ${size.z}, max: ${maxSize}`);
          
          // Scale to fit within tile, then make it bigger (4x for more presence)
          const targetSize = tileSize * 0.8;
          const baseScale = maxSize > 0 ? targetSize / maxSize : 0.8;
          const scale = baseScale * 4; // Make it bigger
          // Apply scaling to the actual model mesh, not the container
          rootMesh.scaling = new Vector3(scale, scale, scale);
          
          console.log(`Rock model scaled by: ${scale} (base: ${baseScale} * 4), target size: ${targetSize}`);
          
          // Refresh bounding info after scaling to get accurate dimensions (use rootMesh for bounding box)
          rootMesh.refreshBoundingInfo();
          const boundingInfoAfterScale = rootMesh.getBoundingInfo();
          const meshMinY = boundingInfoAfterScale.boundingBox.minimum.y;
          const meshMaxY = boundingInfoAfterScale.boundingBox.maximum.y;
          const modelHeight = meshMaxY - meshMinY;
          
          // Position so the bottom of the rock is slightly below ground level
          // The mesh origin is at (0,0,0) relative to the mesh, but the bounding box minY tells us
          // where the bottom is relative to the origin. To place the bottom at ground level (Y=0),
          // we need to offset by -meshMinY. Then add a small offset to sink it slightly.
          const groundOffset = -0.05; // Lower it a bit more into the ground
          const finalY = -meshMinY + groundOffset; // This positions the bottom slightly below Y=0
          
          // Start position well below ground for animation
          // Make sure startY is significantly different from finalY
          let startY = finalY - Math.max(modelHeight * 6, 3.0); // Start at least 3.0 units below, or 6x model height
          
          // Ensure mesh is visible
          mesh.isVisible = true;
          mesh.setEnabled(true);
          
          // Set initial position below ground
          mesh.position = new Vector3(xPos, startY, zPos);
          
          // Apply random rotation to make each rock look different (different each time spell is cast)
          // Apply rotation to the container (TransformNode) - this will rotate all child meshes
          const randomRotationY = Math.random() * Math.PI * 2; // Random rotation around Y axis (0 to 360 degrees)
          mesh.rotation.y = randomRotationY;
          
          // Store rotation and animation data in metadata
          if (!mesh.metadata) {
            mesh.metadata = {};
          }
          mesh.metadata.initialRotationY = randomRotationY;
          mesh.metadata.animationStartY = startY;
          mesh.metadata.animationFinalY = finalY;
          mesh.metadata.animationXPos = xPos;
          mesh.metadata.animationZPos = zPos;
          
          console.log(`Rock ${entityId} rotated randomly: ${(randomRotationY * 180 / Math.PI).toFixed(1)} degrees, container.rotation.y = ${mesh.rotation.y}`);
          
          console.log(`Rock model - modelHeight: ${modelHeight}, meshMinY: ${meshMinY}, meshMaxY: ${meshMaxY}`);
          console.log(`Rock model - finalY: ${finalY}, startY: ${startY}, difference: ${finalY - startY}`);
          console.log(`Rock model positioned at: (${xPos}, ${startY} -> ${finalY}, ${zPos})`);
          
          // Ensure startY is actually different from finalY
          if (Math.abs(finalY - startY) < 0.01) {
            console.warn(`Warning: startY and finalY are too close! Using fallback values.`);
            const fallbackStartY = finalY - 0.5; // Force at least 0.5 units difference
            console.log(`Using fallback startY: ${fallbackStartY}`);
            startY = fallbackStartY;
          }
          
          console.log(`Starting rock rise animation from Y=${startY} to Y=${finalY}`);
          
          // Mark as animating (metadata already stored above)
          mesh.metadata.isAnimating = true;
          
          // Animate rock rising from ground using scene render loop for reliability
          // Delay animation start by 0.8 seconds for dramatic effect
          setTimeout(() => {
            const animationDuration = 2.0; // 2 seconds (slower movement)
            const animationStartTime = Date.now();
            const shakeIntensity = 0.04; // Shake intensity (increased for more shake)
            
            console.log(`Rock animation starting now, mesh Y position: ${mesh.position.y}`);
            
            const observer = scene.onBeforeRenderObservable.add(() => {
              if (!mesh || mesh.isDisposed()) {
                scene.onBeforeRenderObservable.remove(observer);
                return;
              }
              
              const elapsed = (Date.now() - animationStartTime) / 1000; // Convert to seconds
              const progress = Math.min(elapsed / animationDuration, 1.0);
              
              // Ease-out function for smooth animation
              const easedProgress = 1 - Math.pow(1 - progress, 3);
              
              // Interpolate Y position (main movement)
              const currentY = startY + (finalY - startY) * easedProgress;
              
              // Add shaking effect (random small offsets that decrease as rock reaches top)
              const shakeFactor = 1 - progress; // Shake less as it reaches top
              const shakeX = (Math.random() - 0.5) * shakeIntensity * shakeFactor;
              const shakeY = (Math.random() - 0.5) * shakeIntensity * 0.5 * shakeFactor; // Vertical shake (smaller)
              const shakeZ = (Math.random() - 0.5) * shakeIntensity * shakeFactor;
              
              // Apply position with shake (rotation is already set and should persist)
              mesh.position.x = xPos + shakeX;
              mesh.position.y = currentY + shakeY;
              mesh.position.z = zPos + shakeZ;
              
              // Ensure rotation persists during animation
              if (mesh.rotation.y === 0 && mesh.metadata?.initialRotationY !== undefined) {
                mesh.rotation.y = mesh.metadata.initialRotationY;
              }
              
              // Remove observer when animation completes
              if (progress >= 1.0) {
                scene.onBeforeRenderObservable.remove(observer);
                // Ensure final position is exact (no shake)
                mesh.position.x = xPos;
                mesh.position.y = finalY;
                mesh.position.z = zPos;
                if (mesh.metadata) {
                  mesh.metadata.isAnimating = false;
                }
                console.log(`Rock rise animation completed, final position: ${finalY}`);
              }
            });
            
            console.log(`Rock animation observer registered, mesh visible: ${mesh.isVisible}`);
          }, 800); // Delay animation start by 0.8 seconds
          
          // Check and preserve textures/materials from GLB
          // GLB loader should preserve materials, but we verify they're loaded
          result.meshes.forEach(m => {
            if (m.material) {
              console.log(`Mesh ${m.name} has material: ${m.material.name}, type: ${m.material.getClassName()}`);
              // If it's a PBR material, check textures
              if (m.material.getClassName() === 'PBRMaterial') {
                const pbrMat = m.material;
                console.log(`PBR Material - Albedo texture: ${pbrMat.albedoTexture ? pbrMat.albedoTexture.name : 'none'}`);
                console.log(`PBR Material - Normal texture: ${pbrMat.normalTexture ? pbrMat.normalTexture.name : 'none'}`);
                // Ensure material is not disposed
                pbrMat.doNotSerialize = false;
              } else if (m.material.getClassName() === 'StandardMaterial') {
                const stdMat = m.material;
                console.log(`Standard Material - Diffuse texture: ${stdMat.diffuseTexture ? stdMat.diffuseTexture.name : 'none'}`);
              }
            } else {
              console.warn(`Mesh ${m.name} has no material - textures may be missing`);
              // If no material, the GLB might not have materials embedded
              // In that case, textures would need to be loaded separately
            }
          });
        } else {
          throw new Error('No meshes found in rock model');
        }
      } catch (error) {
        console.error(`Failed to load rock model for earth_block entity ${entityId}:`, error);
        console.warn(`Using fallback cube instead`);
        // Fallback to cube if model fails to load
        mesh = MeshBuilder.CreateBox(`entity_${entityId}`, {
          size: tileSize * 0.8,
          height: tileSize * 0.6
        }, scene);
        
        const material = new StandardMaterial(`entity_material_${entityId}`, scene);
        material.diffuseColor = new Color3(0.4, 0.25, 0.15);
        material.specularColor = new Color3(0.2, 0.1, 0.05);
        material.emissiveColor = new Color3(0.05, 0.03, 0.02);
        mesh.material = material;
        mesh.position = new Vector3(xPos, (tileSize * 0.6) / 2, zPos);
      }
      break;
      
    default:
      // Default: create a simple sphere
      mesh = MeshBuilder.CreateSphere(`entity_${entityId}`, {
        diameter: tileSize * 0.5,
        segments: 16
      }, scene);
      
      const defaultMaterial = new StandardMaterial(`entity_material_${entityId}`, scene);
      defaultMaterial.diffuseColor = new Color3(0.5, 0.5, 0.5);
      mesh.material = defaultMaterial;
      mesh.position = new Vector3(xPos, tileSize * 0.25, zPos);
  }
  
  // Store entity metadata (merge with existing metadata to preserve animation state)
  if (!mesh.metadata) {
    mesh.metadata = {};
  }
  mesh.metadata.entityId = entityId;
  mesh.metadata.entityType = entity.entityType;
  
  // Make entity non-pickable (so it doesn't interfere with tile picking)
  mesh.isPickable = false;
  
  return mesh;
}

/**
 * Build all spawned entities in the scene
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} gameState - Game state with spawned entities
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 */
function buildSpawnedEntities(scene, gameState, mapWidth, mapHeight) {
  if (!gameState || !gameState.spawnedEntities) {
    return;
  }
  
  const tileSize = 1; // Match the tile size used in map rendering
  
  // Initialize entity meshes storage if not exists
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.entityMeshes) {
    scene.metadata.entityMeshes = new Map();
  }
  
  // Create meshes for all entities (async)
  const loadPromises = [];
  Object.values(gameState.spawnedEntities).forEach(entity => {
    if (entity.position && !scene.metadata.entityMeshes.has(entity.entityId)) {
      loadPromises.push(
        createEntityMesh(entity, scene, tileSize).then(mesh => {
          if (mesh) {
            scene.metadata.entityMeshes.set(entity.entityId, mesh);
          }
        }).catch(error => {
          console.error(`Failed to create mesh for entity ${entity.entityId}:`, error);
        })
      );
    }
  });
  
  // Wait for all entities to load (but don't block)
  Promise.all(loadPromises).catch(error => {
    console.error('Error loading entity meshes:', error);
  });
}

/**
 * Update spawned entities when game state changes
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} gameState - Updated game state
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
 */
function updateSpawnedEntities(scene, gameState, mapWidth, mapHeight) {
  if (!scene.metadata || !scene.metadata.entityMeshes) {
    scene.metadata = scene.metadata || {};
    scene.metadata.entityMeshes = new Map();
  }
  
  const tileSize = 1;
  const currentEntityIds = new Set();
  
  // Update or create entities
  if (gameState && gameState.spawnedEntities) {
    Object.values(gameState.spawnedEntities).forEach(entity => {
      if (entity.position) {
        currentEntityIds.add(entity.entityId);
        
        const existingMesh = scene.metadata.entityMeshes.get(entity.entityId);
        if (existingMesh) {
          // Update position if it changed (but don't override Y if animating)
          const xPos = entity.position.x * tileSize;
          const zPos = entity.position.y * tileSize;
          existingMesh.position.x = xPos;
          existingMesh.position.z = zPos;
          // Don't update Y position if animation is in progress
          if (existingMesh.metadata && existingMesh.metadata.isAnimating) {
            // Skip Y position update during animation
          } else {
            // Y position can be updated if not animating
          }
        } else {
          // Create new mesh (async)
          createEntityMesh(entity, scene, tileSize).then(mesh => {
            if (mesh) {
              scene.metadata.entityMeshes.set(entity.entityId, mesh);
            }
          }).catch(error => {
            console.error(`Failed to create mesh for entity ${entity.entityId}:`, error);
          });
        }
      }
    });
  }
  
  // Remove meshes for entities that no longer exist
  scene.metadata.entityMeshes.forEach((mesh, entityId) => {
    if (!currentEntityIds.has(entityId)) {
      // Check if this is an earth_block that needs to animate out
      const entityType = mesh.metadata?.entityType;
      const isEarthBlock = entityType === 'earth_block';
      
      if (isEarthBlock && mesh.metadata?.animationFinalY !== undefined) {
        // Animate the rock sinking back into the ground
        animateEarthBlockRemoval(mesh, scene, entityId);
      } else {
        // For other entities, dispose immediately
        mesh.dispose();
        scene.metadata.entityMeshes.delete(entityId);
      }
    }
  });
}

/**
 * Animate earth block removal - sink it back into the ground
 * @param {Mesh|TransformNode} mesh - The entity mesh/container
 * @param {Scene} scene - Babylon.js scene
 * @param {string} entityId - Entity ID
 */
function animateEarthBlockRemoval(mesh, scene, entityId) {
  const metadata = mesh.metadata;
  if (!metadata || metadata.animationFinalY === undefined) {
    // No animation data, dispose immediately
    mesh.dispose();
    if (scene.metadata && scene.metadata.entityMeshes) {
      scene.metadata.entityMeshes.delete(entityId);
    }
    return;
  }
  
  const finalY = metadata.animationFinalY;
  const startY = metadata.animationStartY || (finalY - 3.0); // Fallback if startY not stored
  const xPos = metadata.animationXPos || mesh.position.x;
  const zPos = metadata.animationZPos || mesh.position.z;
  
  // Mark as animating removal
  metadata.isAnimatingRemoval = true;
  
  console.log(`Animating earth block removal: ${entityId} from Y=${finalY} to Y=${startY}`);
  
  // Animate sinking back into ground (reverse of spawn animation)
  const animationDuration = 2.0; // Same duration as spawn (2 seconds)
  const animationStartTime = Date.now();
  const shakeIntensity = 0.04; // Same shake intensity
  
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!mesh || mesh.isDisposed()) {
      scene.onBeforeRenderObservable.remove(observer);
      return;
    }
    
    const elapsed = (Date.now() - animationStartTime) / 1000; // Convert to seconds
    const progress = Math.min(elapsed / animationDuration, 1.0);
    
    // Ease-in function for smooth animation (reverse of ease-out)
    const easedProgress = Math.pow(progress, 3);
    
    // Interpolate Y position (sinking down)
    const currentY = finalY - (finalY - startY) * easedProgress;
    
    // Add shaking effect (random small offsets that decrease as it sinks)
    const shakeFactor = 1 - progress; // Shake less as it reaches bottom
    const shakeX = (Math.random() - 0.5) * shakeIntensity * shakeFactor;
    const shakeY = (Math.random() - 0.5) * shakeIntensity * 0.5 * shakeFactor; // Vertical shake (smaller)
    const shakeZ = (Math.random() - 0.5) * shakeIntensity * shakeFactor;
    
    // Apply position with shake (rotation persists)
    mesh.position.x = xPos + shakeX;
    mesh.position.y = currentY + shakeY;
    mesh.position.z = zPos + shakeZ;
    
    // Remove observer and dispose when animation completes
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(observer);
      // Dispose the mesh and all its children
      if (mesh.metadata?.modelMesh) {
        // If it's a container, dispose the model mesh first
        mesh.metadata.modelMesh.dispose();
      }
      mesh.dispose();
      if (scene.metadata && scene.metadata.entityMeshes) {
        scene.metadata.entityMeshes.delete(entityId);
      }
      console.log(`Earth block removal animation completed, disposed: ${entityId}`);
    }
  });
}

// build3DMap moved to babylon/babylonMap.js

// buildPlayerCharacters moved to babylon/babylonPlayers.js

// updatePlayerCharacters moved to babylon/babylonPlayers.js
// Animation functions (startMovementAnimation, startStanceAnimation, stopStanceAnimation, 
// blendAnimations, updateMovementAnimations) are imported from './babylon/babylonAnimations'




/**
 * Cleanup function to dispose of Babylon.js resources
 * @param {Object} babylonResources - Object containing engine, scene, camera, and handleResize
 */
export function disposeBabylonScene({ engine, scene, camera, handleResize }) {
  // Clean up player meshes
  if (scene && scene.metadata && scene.metadata.playerMeshes) {
    scene.metadata.playerMeshes.forEach((mesh) => {
      if (mesh.rootMesh) {
        mesh.rootMesh.dispose();
      } else {
        mesh.dispose();
      }
    });
    scene.metadata.playerMeshes.clear();
  }
  
  // Clean up animation groups
  if (scene && scene.metadata && scene.metadata.playerAnimationGroups) {
    scene.metadata.playerAnimationGroups.forEach((animGroup) => {
      animGroup.dispose();
    });
    scene.metadata.playerAnimationGroups.clear();
  }
  
  // Clear model cache
  if (scene && scene.metadata && scene.metadata.modelCache) {
    scene.metadata.modelCache.clear();
  }

  if (camera) {
    // Detach camera controls if the method exists
    if (typeof camera.detachControls === 'function') {
    camera.detachControls();
    } else if (camera.inputs && typeof camera.inputs.removeByType === 'function') {
      // Alternative method for some Babylon.js versions
      camera.inputs.removeByType('ArcRotateCameraPointersInput');
      camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
      camera.inputs.removeByType('ArcRotateCameraMouseWheelInput');
    }
  }
  if (handleResize) {
    window.removeEventListener('resize', handleResize);
  }
  if (scene) {
    scene.dispose();
  }
  if (engine) {
    engine.dispose();
  }
}
