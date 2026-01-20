import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder, StandardMaterial, Color3, DirectionalLight, SceneLoader, AnimationGroup, ShadowGenerator, PBRMaterial, TransformNode, ActionManager, ExecuteCodeAction, PointerEventTypes, ArcRotateCameraPointersInput } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TILE_TYPES } from './mapRenderer';
import { findPath, getMovementRange } from './pathfinding';

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

  // Build player characters (spheres) if game state is available
  if (gameState) {
    buildPlayerCharacters(scene, gameState, userId, mapWidth, mapHeight);
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
  let currentGameState = gameState; // Store current game state
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
  
  // Set up pointer picking with proper event types
  console.log(`Setting up pointer observable, startPositionTiles size: ${startPositionTiles.size}`);
  console.log('Start position tiles:', Array.from(startPositionTiles.entries()).map(([id, tile]) => ({ id, x: tile.x, y: tile.y, meshName: tile.mesh.name })));
  
  scene.onPointerObservable.add((pointerInfo) => {
    // Handle game phase movement
    if (currentGameState && currentGameState.phase === 'game' && currentGameState.currentPlayerId === userId) {
      // Get current player
      const currentPlayer = currentGameState.myTeam && Object.values(currentGameState.myTeam.players || {}).find(p => p.userId === userId);
      if (!currentPlayer || !currentPlayer.position) {
        if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
          clearMovementVisualization();
        }
        return;
      }
      
      // Calculate available movement points
      const availableMP = (currentPlayer.movementPoints || 0) - (currentPlayer.usedMovementPoints || 0);
      
      // Get all occupied tiles
      const occupiedTiles = new Set();
      if (currentGameState.myTeam && currentGameState.myTeam.players) {
        Object.values(currentGameState.myTeam.players).forEach(player => {
          if (player.position && player.userId !== userId) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      if (currentGameState.enemyTeam && currentGameState.enemyTeam.players) {
        Object.values(currentGameState.enemyTeam.players).forEach(player => {
          if (player.position) {
            occupiedTiles.add(`${player.position.x}_${player.position.y}`);
          }
        });
      }
      
      // Get pick result
      const x = pointerInfo.event.pointerX !== undefined ? pointerInfo.event.pointerX : (pointerInfo.event.offsetX || pointerInfo.event.clientX);
      const y = pointerInfo.event.pointerY !== undefined ? pointerInfo.event.pointerY : (pointerInfo.event.offsetY || pointerInfo.event.clientY);
      const pickResult = scene.pick(x, y);
      
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
                  
                  // Send movement request to server
                  onMovementRequest(targetPos.x, targetPos.y);
                  
                  // Clear visualization after moving
                  clearMovementVisualization();
                  previousHoveredPath = [];
                  previousHoveredTarget = null;
                }
              }
            }
        }
      } else {
        // Clear visualization when not hovering over a tile (only on move, not on click)
        if (isHover) {
          clearMovementVisualization();
          previousHoveredPath = [];
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
    const currentPlayer = currentGameState.myTeam && Object.values(currentGameState.myTeam.players || {}).find(p => p.userId === userId);
    const isPlayerReady = currentPlayer?.ready || false;
    
    if (isPlayerReady) {
      // Player is ready - restore hover and disable interaction
      if (hoveredTile && hoveredTile.userData && hoveredTile.userData.originalMaterial) {
        hoveredTile.material = hoveredTile.userData.originalMaterial;
        hoveredTile = null;
      }
      return; // Don't process hover/click when ready
    }
    
    // Get pick result - use scene.pick with proper coordinates
    // Babylon.js provides pointerX and pointerY in the event
    const x = pointerInfo.event.pointerX !== undefined ? pointerInfo.event.pointerX : (pointerInfo.event.offsetX || pointerInfo.event.clientX);
    const y = pointerInfo.event.pointerY !== undefined ? pointerInfo.event.pointerY : (pointerInfo.event.offsetY || pointerInfo.event.clientY);
    const pickResult = scene.pick(x, y);
    
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
        
        // Update starting position tiles material based on phase
        // During preparation: show colored tiles (blue/red)
        // During game: show as regular tiles
        if (playerStartMaterial && enemyStartMaterial && createTileMaterial) {
          const isPreparationPhase = newGameState.phase === 'preparation';
          allStartPositionTiles.forEach(tile => {
            // Check if this is a player start tile or enemy start tile from userData
            const isPlayerStart = tile.userData?.isPlayerStart;
            
            // Only update if not currently highlighted by movement system
            const tileKey = `${tile.userData?.tileX}_${tile.userData?.tileY}`;
            const isInMovementPath = movementPath.includes(tileKey);
            
            // During game phase, always show as regular tiles (not blue/red)
            if (!isInMovementPath) {
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
      onMovementRequest = callback;
    },
    setOnPositionChangeRequest: (callback) => {
      onPositionChangeRequest = callback;
    }
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
 */
function build3DMap(scene, terrain, mapWidth, mapHeight, startZones, playerTeam, enemyTeam, userId, gameState) {
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
          width: tileSize * 0.95,
          height: 0.01,
          depth: tileSize * 0.95
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
          width: tileSize * 0.95,
          height: tileHeight,
          depth: tileSize * 0.95
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

        // If it's a starting position, make it slightly elevated
        if (isPlayerStart || isEnemyStart) {
          tile.position.y = tileHeight;
        }
      } else if (tileType === TILE_TYPES.WALL) {
        // Create wall
        const wall = MeshBuilder.CreateBox('wall', {
          width: tileSize * 0.95,
          height: wallHeight,
          depth: tileSize * 0.95
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

/**
 * Build player characters as spheres at their positions
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} gameState - Game state with player data
 * @param {string} userId - Current user's ID
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 */
function buildPlayerCharacters(scene, gameState, userId, mapWidth, mapHeight) {
  const tileSize = 1;
  const sphereRadius = 0.3;
  const sphereHeight = sphereRadius + 0.15; // Position sphere above the tile

  // Store player meshes and animation groups in scene metadata for updates
  if (!scene.metadata) {
    scene.metadata = { 
      playerMeshes: new Map(),
      playerAnimationGroups: new Map(),
      modelCache: new Map() // Cache loaded models to avoid reloading
    };
  }

  // Clear existing player meshes
  scene.metadata.playerMeshes.forEach((mesh) => {
    if (mesh.rootMesh) {
      mesh.rootMesh.dispose();
    } else {
      mesh.dispose();
    }
  });
  scene.metadata.playerMeshes.clear();
  
  // Clear animation groups
  scene.metadata.playerAnimationGroups.forEach((animGroup) => {
    animGroup.dispose();
  });
  scene.metadata.playerAnimationGroups.clear();

  // Helper function to get model path for character class
  const getModelPath = (characterClass) => {
    const classId = characterClass?.toLowerCase() || 'warrior';
    const validClasses = ['assassin', 'warrior', 'archer', 'mage'];
    const normalizedClass = validClasses.includes(classId) ? classId : 'warrior';
    return `/models/${normalizedClass}/master.glb`;
  };

  // Helper function to load and create a character model
  const createPlayerModel = async (player, isMyTeam) => {
    const xPos = player.position.x * tileSize;
    const zPos = player.position.y * tileSize;
    const modelPath = getModelPath(player.characterClass);
    
    try {
      // Check if model is cached
      let modelRoot = null;
      let animationGroups = [];
      
      if (scene.metadata.modelCache.has(modelPath)) {
        // Clone from cache
        const cached = scene.metadata.modelCache.get(modelPath);
        modelRoot = cached.root.clone(`player_${player.userId}`);
        animationGroups = cached.animationGroups.map(ag => ag.clone(`anim_${player.userId}_${ag.name}`));
      } else {
        // Load new model
        const result = await SceneLoader.ImportMeshAsync('', modelPath, '', scene);
        // The first mesh might be a root/container, find the actual character mesh
        // GLB files often have a root node, so we might need to find the actual mesh
        modelRoot = result.meshes[0];
        
        // If the root has children, we might need to rotate those instead
        // Or create a parent container to rotate
        if (modelRoot.getChildMeshes && modelRoot.getChildMeshes().length > 0) {
          // Model has child meshes - we'll rotate the root which will rotate all children
          console.log(`Model has ${modelRoot.getChildMeshes().length} child meshes`);
        }
        
        animationGroups = result.animationGroups || [];
        
        // Cache the original for future clones
        scene.metadata.modelCache.set(modelPath, {
          root: modelRoot,
          animationGroups: animationGroups
        });
      }

      // Position the model
      if (modelRoot) {
        // Create a parent transform node to handle rotation reliably
        const characterContainer = new TransformNode(`characterContainer_${player.userId}`, scene);
        
        // Get bounding box to center the model
        const boundingInfo = modelRoot.getBoundingInfo();
        const size = boundingInfo.boundingBox.extendSize;
        
        // Calculate rotation based on team - ignore server orientation for now
        let rotationY = 0;
        if (player.team === 'A') {
          rotationY = Math.PI / 2; // 90 degrees - face right (+X)
        } else if (player.team === 'B') {
          rotationY = 3 * Math.PI / 2; // 270 degrees - face left (-X)
        }
        
        // TODO: Use orientation from game state when server-side orientation is fixed
        // For now, always use team-based rotation
        
        console.log(`Rotating player ${player.userId} (team ${player.team}): rotation.y=${rotationY} radians (${(rotationY * 180 / Math.PI).toFixed(1)} degrees)`);
        console.log(`Model root: "${modelRoot.name}", type: ${modelRoot.constructor.name}, has children: ${modelRoot.getChildMeshes ? modelRoot.getChildMeshes().length : 0}`);
        
        // Apply rotation to container
        characterContainer.rotation.y = rotationY;
        
        // Position container at tile location
        characterContainer.position = new Vector3(xPos, size.y, zPos);
        
        // Make model a child of the container (this ensures rotation propagates)
        modelRoot.parent = characterContainer;
        
        // Reset model's local position/rotation since it's now relative to container
        modelRoot.position = Vector3.Zero();
        modelRoot.rotation = Vector3.Zero();
        
        // Scale model to appropriate size - make them bigger
        const scale = 0.8; // Increased from 0.5 to make models bigger
        modelRoot.scaling = new Vector3(scale, scale, scale);
        
        // Use container as the root for tracking
        const actualRoot = characterContainer;
        
        // Don't apply team color - use original model materials
        
        // Store all animation groups for this player
        if (animationGroups.length > 0) {
          // Store all animation groups in a map for easy access
          const animMap = new Map();
          animationGroups.forEach(ag => {
            const animName = ag.name ? ag.name.toLowerCase() : '';
            animMap.set(animName, ag);
          });
          scene.metadata.playerAnimationGroups.set(player.userId, animMap);
          
          // Start idle animation if available (with full weight)
          const idleAnim = animationGroups.find(ag => {
            const name = ag.name ? ag.name.toLowerCase() : '';
            return name.includes('idle') || name.includes('stand');
          });
          if (idleAnim) {
            idleAnim.setWeightForAllAnimatables(1.0);
            idleAnim.play(true); // Loop the animation
          }
        }
        
        // Store metadata on the container
        actualRoot.metadata = {
          userId: player.userId,
          username: player.username,
          team: player.team,
          characterId: player.characterId,
          isMyTeam: isMyTeam,
          modelMesh: modelRoot // Keep reference to actual model mesh
        };
        
        return { root: actualRoot, animationGroups };
      }
    } catch (error) {
      console.error(`Failed to load model for ${player.characterId}:`, error);
      // Fallback to sphere if model fails to load
      return createPlayerSphereFallback(player, isMyTeam, xPos, zPos);
    }
  };

  // Fallback function to create a sphere if model loading fails
  const createPlayerSphereFallback = (player, isMyTeam, xPos, zPos) => {
    const sphere = MeshBuilder.CreateSphere(`player_${player.userId}`, {
      diameter: 0.6,
      segments: 16
    }, scene);

    sphere.position = new Vector3(xPos, 0.3, zPos);

    const material = new StandardMaterial(`playerMaterial_${player.userId}`, scene);
    if (isMyTeam) {
      material.diffuseColor = new Color3(0.2, 0.6, 1.0);
      material.emissiveColor = new Color3(0.1, 0.3, 0.5);
    } else {
      material.diffuseColor = new Color3(1.0, 0.3, 0.3);
      material.emissiveColor = new Color3(0.5, 0.1, 0.1);
    }
    material.specularColor = new Color3(0.5, 0.5, 0.5);
    sphere.material = material;

    sphere.metadata = {
      userId: player.userId,
      username: player.username,
      team: player.team,
      characterId: player.characterId,
      isMyTeam: isMyTeam
    };

    return { root: sphere, animationGroups: [] };
  };


  // Load all player models asynchronously
  const loadPlayers = async () => {
    const loadPromises = [];

    // Add players from my team
    if (gameState.myTeam && gameState.myTeam.players) {
      Object.values(gameState.myTeam.players).forEach(player => {
        if (player.position && player.position.x !== undefined && player.position.y !== undefined) {
          loadPromises.push(
            createPlayerModel(player, true).then(result => {
              if (result) {
                scene.metadata.playerMeshes.set(player.userId, result.root);
                if (result.animationGroups.length > 0) {
                  scene.metadata.playerAnimationGroups.set(player.userId, result.animationGroups[0]);
                }
              }
            })
          );
        }
      });
    }

    // Add players from enemy team (only if visible in current phase - not during preparation)
    if (gameState.enemyTeam && gameState.enemyTeam.players && gameState.phase !== 'preparation') {
      Object.values(gameState.enemyTeam.players).forEach(player => {
        if (player.position && player.position.x !== undefined && player.position.y !== undefined) {
          loadPromises.push(
            createPlayerModel(player, false).then(result => {
              if (result) {
                scene.metadata.playerMeshes.set(player.userId, result.root);
                if (result.animationGroups.length > 0) {
                  scene.metadata.playerAnimationGroups.set(player.userId, result.animationGroups[0]);
                }
              }
            })
          );
        }
      });
    }

    await Promise.all(loadPromises);
  };

  // Start loading models
  loadPlayers().catch(error => {
    console.error('Error loading player models:', error);
  });
}

/**
 * Update player character positions when game state changes
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} gameState - Updated game state
 * @param {string} userId - Current user's ID
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 */
async function updatePlayerCharacters(scene, gameState, userId, mapWidth, mapHeight) {
  if (!scene.metadata) {
    scene.metadata = {};
  }
  
  // Ensure all required maps exist
  if (!scene.metadata.playerMeshes) {
    scene.metadata.playerMeshes = new Map();
  }
  if (!scene.metadata.playerAnimationGroups) {
    scene.metadata.playerAnimationGroups = new Map();
  }
  if (!scene.metadata.modelCache) {
    scene.metadata.modelCache = new Map();
  }
  if (!scene.metadata.playerPreviousPositions) {
    scene.metadata.playerPreviousPositions = new Map();
  }
  if (!scene.metadata.playerMovementAnimations) {
    scene.metadata.playerMovementAnimations = new Map();
  }

  const tileSize = 1;

  // Update or create player meshes
  const allPlayers = [];
  if (gameState.myTeam && gameState.myTeam.players) {
    allPlayers.push(...Object.values(gameState.myTeam.players).map(p => ({ ...p, isMyTeam: true })));
  }
  // Only include enemy team if not in preparation phase
  if (gameState.enemyTeam && gameState.enemyTeam.players && gameState.phase !== 'preparation') {
    allPlayers.push(...Object.values(gameState.enemyTeam.players).map(p => ({ ...p, isMyTeam: false })));
  }

  const loadPromises = [];

  allPlayers.forEach(player => {
    if (!player.position || player.position.x === undefined || player.position.y === undefined) {
      return;
    }

    // Ensure playerMeshes exists
    if (!scene.metadata.playerMeshes) {
      scene.metadata.playerMeshes = new Map();
    }
    
    const existingMesh = scene.metadata.playerMeshes.get(player.userId);
    const xPos = player.position.x * tileSize;
    const zPos = player.position.y * tileSize;

    // Check if player has moved (for animation)
    const previousPos = scene.metadata.playerPreviousPositions.get(player.userId);
    const hasMoved = !previousPos || 
                     previousPos.x !== player.position.x || 
                     previousPos.y !== player.position.y;
    
    if (existingMesh) {
      // Check if this is a TransformNode container (new approach) or a direct mesh (old approach)
      const isContainer = existingMesh instanceof TransformNode;
      
      // If player has moved, start movement animation
      if (hasMoved && previousPos) {
        const startX = previousPos.x;
        const startY = previousPos.y;
        const endX = player.position.x;
        const endY = player.position.y;
        const distance = Math.abs(endX - startX) + Math.abs(endY - startY);
        
        // Check if we have a pending movement path (from previsualization)
        let path = [];
        const pendingPath = scene.metadata.pendingMovementPaths?.get(player.userId);
        
        if (pendingPath && pendingPath.path && pendingPath.path.length > 0) {
          // Use the previsualized path (it already includes the start position)
          path = pendingPath.path.map(pos => ({ x: pos.x, y: pos.y }));
          
          // Verify the path matches the actual movement
          const pathStart = path[0];
          const pathEnd = path[path.length - 1];
          if (pathStart.x === startX && pathStart.y === startY && 
              pathEnd.x === endX && pathEnd.y === endY) {
            // Path is valid, use it
            // Clear pending path after using it
            scene.metadata.pendingMovementPaths.delete(player.userId);
          } else {
            // Path doesn't match, recalculate
            path = [];
          }
        }
        
        // If no previsualized path or it doesn't match, calculate path
        if (path.length === 0) {
          if (scene.metadata && scene.metadata.terrain) {
            // Get occupied tiles (excluding the moving player)
            const occupiedTiles = new Set();
            allPlayers.forEach(p => {
              if (p.userId !== player.userId && p.position) {
                occupiedTiles.add(`${p.position.x}_${p.position.y}`);
              }
            });
            
            // Use pathfinding to get the actual path
            const calculatedPath = findPath(
              scene.metadata.terrain,
              startX,
              startY,
              endX,
              endY,
              occupiedTiles
            );
            
            if (calculatedPath.length > 0) {
              path = calculatedPath;
            } else {
              // Fallback to simple straight path if pathfinding fails
              let currentX = startX;
              let currentY = startY;
              const dx = endX > startX ? 1 : (endX < startX ? -1 : 0);
              const dy = endY > startY ? 1 : (endY < startY ? -1 : 0);
              
              while (currentX !== endX || currentY !== endY) {
                path.push({ x: currentX, y: currentY });
                if (currentX !== endX) currentX += dx;
                if (currentY !== endY) currentY += dy;
              }
              path.push({ x: endX, y: endY });
            }
          } else {
            // Fallback to simple straight path if terrain not available
            let currentX = startX;
            let currentY = startY;
            const dx = endX > startX ? 1 : (endX < startX ? -1 : 0);
            const dy = endY > startY ? 1 : (endY < startY ? -1 : 0);
            
            while (currentX !== endX || currentY !== endY) {
              path.push({ x: currentX, y: currentY });
              if (currentX !== endX) currentX += dx;
              if (currentY !== endY) currentY += dy;
            }
            path.push({ x: endX, y: endY });
          }
        }
        
        // Determine animation type (walk for 2 tiles or less, run for more)
        const animationType = distance <= 2 ? 'walk' : 'run';
        
        // Start movement animation
        startMovementAnimation(scene, player.userId, existingMesh, path, animationType, tileSize);
      }
      
      // If it's not a container, we need to wrap it in one for proper rotation
      if (!isContainer) {
        console.log(`Wrapping existing mesh for player ${player.userId} in TransformNode container`);
        const characterContainer = new TransformNode(`characterContainer_${player.userId}`, scene);
        
        // Get the model mesh (might be the existingMesh itself or a child)
        const modelMesh = existingMesh.metadata?.modelMesh || existingMesh;
        
        // Calculate rotation based on team - ignore server orientation for now
        let rotationY = 0;
        if (player.team === 'A') {
          rotationY = Math.PI / 2; // 90 degrees - face right (+X)
        } else if (player.team === 'B') {
          rotationY = 3 * Math.PI / 2; // 270 degrees - face left (-X)
        }
        
        // TODO: Use orientation from game state when server-side orientation is fixed
        // For now, always use team-based rotation
        
        // Set container position and rotation
        characterContainer.position = new Vector3(xPos, existingMesh.position.y, zPos);
        characterContainer.rotation.y = rotationY;
        
        // Parent the model to the container
        modelMesh.parent = characterContainer;
        modelMesh.position = Vector3.Zero();
        modelMesh.rotation = Vector3.Zero();
        
        // Update metadata
        characterContainer.metadata = existingMesh.metadata || {};
        characterContainer.metadata.modelMesh = modelMesh;
        
        // Replace in the map
        scene.metadata.playerMeshes.set(player.userId, characterContainer);
        
        console.log(`Wrapped player ${player.userId} (team ${player.team}) in container with rotation.y=${rotationY}`);
      } else {
        // It's already a container, just update position and rotation
        if (existingMesh.position) {
          existingMesh.position.x = xPos;
          existingMesh.position.z = zPos;
        }
        
        // Update orientation based on team - ignore server orientation for now
        let rotationY = 0;
        if (player.team === 'A') {
          rotationY = Math.PI / 2; // 90 degrees - face right (+X)
        } else if (player.team === 'B') {
          rotationY = 3 * Math.PI / 2; // 270 degrees - face left (-X)
        }
        
        // TODO: Use orientation from game state when server-side orientation is fixed
        // For now, always use team-based rotation
        
        // Only update rotation if not animating (animation system handles rotation during movement)
        const isAnimating = scene.metadata.playerMovementAnimations.has(player.userId) && 
                           scene.metadata.playerMovementAnimations.get(player.userId).isAnimating;
        
        if (!isAnimating) {
          // Don't update rotation - it should stay as it was set during movement animation
          // The rotation from the last movement step is preserved
        }
      }
    } else {
      // Create new model if it doesn't exist
      const getModelPath = (characterClass) => {
        const classId = characterClass?.toLowerCase() || 'warrior';
        const validClasses = ['assassin', 'warrior', 'archer', 'mage'];
        const normalizedClass = validClasses.includes(classId) ? classId : 'warrior';
        return `/models/${normalizedClass}/master.glb`;
      };

      const createPlayerModel = async () => {
        const modelPath = getModelPath(player.characterClass);
        
        try {
          let modelRoot = null;
          let animationGroups = [];
          
          if (scene.metadata.modelCache.has(modelPath)) {
            const cached = scene.metadata.modelCache.get(modelPath);
            modelRoot = cached.root.clone(`player_${player.userId}`);
            animationGroups = cached.animationGroups.map(ag => ag.clone(`anim_${player.userId}_${ag.name}`));
          } else {
            const result = await SceneLoader.ImportMeshAsync('', modelPath, '', scene);
            modelRoot = result.meshes[0];
            animationGroups = result.animationGroups || [];
            scene.metadata.modelCache.set(modelPath, {
              root: modelRoot,
              animationGroups: animationGroups
            });
          }

          if (modelRoot) {
            const boundingInfo = modelRoot.getBoundingInfo();
            const size = boundingInfo.boundingBox.extendSize;
            modelRoot.position = new Vector3(xPos, size.y, zPos);
            const scale = 0.8; // Increased from 0.5 to make models bigger
            modelRoot.scaling = new Vector3(scale, scale, scale);
            
            // Create container for rotation
            const characterContainer = new TransformNode(`characterContainer_${player.userId}`, scene);
            
            // Calculate rotation based on team - ignore server orientation for now
            let rotationY = 0;
            if (player.team === 'A') {
              rotationY = Math.PI / 2; // 90 degrees - face right (+X)
            } else if (player.team === 'B') {
              rotationY = 3 * Math.PI / 2; // 270 degrees - face left (-X)
            }
            
            // TODO: Use orientation from game state when server-side orientation is fixed
            // For now, always use team-based rotation
            
            console.log(`Rotating player ${player.userId} (team ${player.team}): rotation.y=${rotationY} radians (${(rotationY * 180 / Math.PI).toFixed(1)} degrees)`);
            
            // Apply rotation to container
            characterContainer.rotation.y = rotationY;
            characterContainer.position = new Vector3(xPos, size.y, zPos);
            
            // Parent model to container
            modelRoot.parent = characterContainer;
            modelRoot.position = Vector3.Zero();
            modelRoot.rotation = Vector3.Zero();
            
            // Use container as root
            const actualRoot = characterContainer;
            
            // Use original model materials - no team color tinting
            
            // Store all animation groups for this player
            if (animationGroups.length > 0) {
              // Store all animation groups in a map for easy access
              const animMap = new Map();
              animationGroups.forEach(ag => {
                const animName = ag.name ? ag.name.toLowerCase() : '';
                animMap.set(animName, ag);
              });
              scene.metadata.playerAnimationGroups.set(player.userId, animMap);
              
              // Start idle animation if available (with full weight)
              const idleAnim = animationGroups.find(ag => {
                const name = ag.name ? ag.name.toLowerCase() : '';
                return name.includes('idle') || name.includes('stand');
              });
              if (idleAnim) {
                idleAnim.setWeightForAllAnimatables(1.0);
                idleAnim.play(true);
              }
            }
            
            actualRoot.metadata = {
              userId: player.userId,
              username: player.username,
              team: player.team,
              characterId: player.characterId,
              isMyTeam: player.isMyTeam,
              modelMesh: modelRoot
            };
            
            scene.metadata.playerMeshes.set(player.userId, actualRoot);
          }
        } catch (error) {
          console.error(`Failed to load model for ${player.characterId}:`, error);
          // Fallback to sphere
          const sphere = MeshBuilder.CreateSphere(`player_${player.userId}`, {
            diameter: 0.6,
            segments: 16
          }, scene);
          sphere.position = new Vector3(xPos, 0.3, zPos);
          const material = new StandardMaterial(`playerMaterial_${player.userId}`, scene);
          material.diffuseColor = player.isMyTeam ? new Color3(0.2, 0.6, 1.0) : new Color3(1.0, 0.3, 0.3);
          sphere.material = material;
          sphere.metadata = {
            userId: player.userId,
            username: player.username,
            team: player.team,
            characterId: player.characterId,
            isMyTeam: player.isMyTeam
          };
          scene.metadata.playerMeshes.set(player.userId, sphere);
        }
      };

      loadPromises.push(createPlayerModel());
    }
  });

  await Promise.all(loadPromises);
  
  // Update previous positions for movement detection
  if (!scene.metadata.playerPreviousPositions) {
    scene.metadata.playerPreviousPositions = new Map();
  }
  allPlayers.forEach(player => {
    if (player.position && player.position.x !== undefined && player.position.y !== undefined) {
      scene.metadata.playerPreviousPositions.set(player.userId, { 
        x: player.position.x, 
        y: player.position.y 
      });
    }
  });

  // Remove meshes for players that are no longer in the game
  const currentPlayerIds = new Set(allPlayers.map(p => p.userId));
  scene.metadata.playerMeshes.forEach((mesh, userId) => {
    if (!currentPlayerIds.has(userId)) {
      if (mesh.rootMesh) {
        mesh.rootMesh.dispose();
      } else {
        mesh.dispose();
      }
      scene.metadata.playerMeshes.delete(userId);
      
      // Dispose animation groups
      const animGroup = scene.metadata.playerAnimationGroups.get(userId);
      if (animGroup) {
        if (animGroup instanceof Map) {
          // Dispose all animation groups in the map
          animGroup.forEach(anim => {
            if (anim && typeof anim.dispose === 'function') {
              anim.dispose();
            }
          });
        } else if (typeof animGroup.dispose === 'function') {
          animGroup.dispose();
        }
        scene.metadata.playerAnimationGroups.delete(userId);
      }
      
      // Clean up movement animation tracking
      if (scene.metadata.playerPreviousPositions) {
        scene.metadata.playerPreviousPositions.delete(userId);
      }
      if (scene.metadata.playerMovementAnimations) {
        scene.metadata.playerMovementAnimations.delete(userId);
      }
    }
  });
}

/**
 * Start movement animation for a character
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @param {TransformNode|Mesh} characterMesh - Character mesh or container
 * @param {Array<{x: number, y: number}>} path - Path to follow
 * @param {string} animationType - 'walk' or 'run'
 * @param {number} tileSize - Size of each tile
 */
function startMovementAnimation(scene, userId, characterMesh, path, animationType, tileSize) {
  // Ensure metadata exists
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.playerMovementAnimations) {
    scene.metadata.playerMovementAnimations = new Map();
  }
  
  // Stop any existing movement animation and reset weights
  const playerMovementAnimations = scene.metadata.playerMovementAnimations;
  const existingAnim = playerMovementAnimations.get(userId);
  if (existingAnim && existingAnim.isAnimating) {
    // Reset weights before stopping
    if (existingAnim.movementAnim) {
      existingAnim.movementAnim.setWeightForAllAnimatables(0.0);
      existingAnim.movementAnim.stop();
    }
    if (existingAnim.idleAnim) {
      existingAnim.idleAnim.setWeightForAllAnimatables(1.0);
    }
    existingAnim.isAnimating = false;
  }
  
  // Find animation groups for this player
  // Animation groups are stored in scene metadata as a Map
  let movementAnim = null;
  
  if (scene.metadata && scene.metadata.playerAnimationGroups) {
    const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
    if (playerAnims instanceof Map) {
      // Search for walk or run animation
      for (const [animName, anim] of playerAnims) {
        if (animName.includes(animationType) || 
            (animationType === 'walk' && animName.includes('walk')) ||
            (animationType === 'run' && animName.includes('run'))) {
          movementAnim = anim;
          break;
        }
      }
    } else if (playerAnims) {
      // Fallback: if stored as single animation group, check its name
      const animName = playerAnims.name ? playerAnims.name.toLowerCase() : '';
      if (animName.includes(animationType) || 
          (animationType === 'walk' && animName.includes('walk')) ||
          (animationType === 'run' && animName.includes('run'))) {
        movementAnim = playerAnims;
      }
    }
  }
  
  // If still not found, search all animation groups in the scene
  if (!movementAnim && scene.animationGroups) {
    for (const ag of scene.animationGroups) {
      const animName = ag.name ? ag.name.toLowerCase() : '';
      if (animName.includes(animationType) || 
          (animationType === 'walk' && animName.includes('walk')) ||
          (animationType === 'run' && animName.includes('run'))) {
        movementAnim = ag;
        break;
      }
    }
  }
  
  // Animation timing
  const timePerTile = animationType === 'walk' ? 0.5 : 0.3; // seconds per tile
  const totalDuration = path.length * timePerTile;
  
  // Find idle animation for smooth transition
  let idleAnim = null;
  if (scene.metadata && scene.metadata.playerAnimationGroups) {
    const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
    if (playerAnims instanceof Map) {
      for (const [animName, anim] of playerAnims) {
        if (animName.includes('idle') || animName.includes('stand')) {
          idleAnim = anim;
          break;
        }
      }
    }
  }
  
  // Store animation state
  const animState = {
    isAnimating: true,
    animationType: animationType,
    startTime: Date.now(),
    path: path,
    currentStep: 0,
    characterMesh: characterMesh,
    movementAnim: movementAnim,
    idleAnim: idleAnim,
    timePerTile: timePerTile,
    transitionStartTime: null, // Will be set when starting transition
    isTransitioning: false
  };
  
  // Start movement animation with full weight
  if (movementAnim) {
    movementAnim.setWeightForAllAnimatables(1.0);
    movementAnim.play(true);
  }
  
  // Prepare idle animation for transition (start with weight 0)
  if (idleAnim) {
    idleAnim.setWeightForAllAnimatables(0.0);
    idleAnim.play(true);
  }
  
  playerMovementAnimations.set(userId, animState);
}

/**
 * Update movement animations in the render loop
 * @param {Scene} scene - Babylon.js scene
 */
function updateMovementAnimations(scene) {
  if (!scene.metadata || !scene.metadata.playerMovementAnimations) {
    return;
  }
  
  const playerMovementAnimations = scene.metadata.playerMovementAnimations;
  const currentTime = Date.now();
  
  playerMovementAnimations.forEach((animState, userId) => {
    if (!animState.isAnimating) return;
    
    const elapsed = (currentTime - animState.startTime) / 1000; // Convert to seconds
    const totalDuration = animState.path.length * animState.timePerTile;
    const transitionDuration = 0.3; // 300ms transition
    // Different transition timing for walk vs run
    const transitionStartOffset = animState.animationType === 'run' ? 0.1 : 0.2; // Run: 100ms, Walk: 200ms before movement completes
    const transitionStartTime = totalDuration - transitionDuration - transitionStartOffset; // Start transition earlier
    
    // Start transition early (ease-out effect)
    if (elapsed >= transitionStartTime && !animState.isTransitioning) {
      animState.isTransitioning = true;
      animState.transitionStartTime = currentTime - (elapsed - transitionStartTime) * 1000; // Adjust for smooth start
    }
    
    // Handle smooth transition between movement and idle animations
    if (animState.isTransitioning) {
      const transitionElapsed = (currentTime - animState.transitionStartTime) / 1000;
      
      if (transitionElapsed < transitionDuration) {
        // Ease-out function for smoother transition (easeOutQuad)
        const t = transitionElapsed / transitionDuration;
        const easeOutProgress = 1 - (1 - t) * (1 - t); // Quadratic ease-out
        
        // Blend between movement and idle animations
        const movementWeight = 1.0 - easeOutProgress;
        const idleWeight = easeOutProgress;
        
        if (animState.movementAnim) {
          animState.movementAnim.setWeightForAllAnimatables(movementWeight);
        }
        if (animState.idleAnim) {
          animState.idleAnim.setWeightForAllAnimatables(idleWeight);
        }
      } else {
        // Transition complete - ensure weights are set correctly
        if (animState.movementAnim) {
          animState.movementAnim.setWeightForAllAnimatables(0.0);
        }
        if (animState.idleAnim) {
          animState.idleAnim.setWeightForAllAnimatables(1.0);
        }
      }
    }
    
    // Check if movement is complete
    if (elapsed >= totalDuration) {
      // Set final position
      const finalPos = animState.path[animState.path.length - 1];
      if (animState.characterMesh instanceof TransformNode) {
        animState.characterMesh.position.x = finalPos.x * 1; // tileSize = 1
        animState.characterMesh.position.z = finalPos.y * 1;
      } else {
        animState.characterMesh.position.x = finalPos.x * 1;
        animState.characterMesh.position.z = finalPos.y * 1;
      }
      
      // Stop movement animation if transition is complete
      if (animState.isTransitioning) {
        const transitionElapsed = (currentTime - animState.transitionStartTime) / 1000;
        if (transitionElapsed >= transitionDuration) {
          if (animState.movementAnim) {
            animState.movementAnim.stop();
          }
          // Animation complete
          animState.isAnimating = false;
          animState.isTransitioning = false;
        }
      } else {
        // If transition didn't start (very short movement), stop immediately
        if (animState.movementAnim) {
          animState.movementAnim.setWeightForAllAnimatables(0.0);
          animState.movementAnim.stop();
        }
        if (animState.idleAnim) {
          animState.idleAnim.setWeightForAllAnimatables(1.0);
        }
        animState.isAnimating = false;
      }
      
      // Keep the final rotation from the last movement step
      // Don't change rotation - it should stay as it was during movement
      
      return;
    }
    
    // Calculate current step in path
    const currentStep = Math.floor(elapsed / animState.timePerTile);
    const stepProgress = (elapsed % animState.timePerTile) / animState.timePerTile;
    
    if (currentStep < animState.path.length - 1) {
      // Interpolate between current and next step
      const currentPos = animState.path[currentStep];
      const nextPos = animState.path[currentStep + 1];
      
      const x = currentPos.x + (nextPos.x - currentPos.x) * stepProgress;
      const y = currentPos.y + (nextPos.y - currentPos.y) * stepProgress;
      
      // Update position
      if (animState.characterMesh instanceof TransformNode) {
        animState.characterMesh.position.x = x * 1; // tileSize = 1
        animState.characterMesh.position.z = y * 1;
      } else {
        animState.characterMesh.position.x = x * 1;
        animState.characterMesh.position.z = y * 1;
      }
      
      // Rotate character to face movement direction
      const dx = nextPos.x - currentPos.x;
      const dy = nextPos.y - currentPos.y;
      if (dx !== 0 || dy !== 0) {
        // Calculate rotation angle based on movement direction
        // In our coordinate system:
        // - X increases to the right
        // - Y increases downward (in map coordinates, but Z increases in 3D)
        // - Models face +Z by default (forward)
        // 
        // Movement directions:
        // - Moving right (+X): rotation.y = PI/2 (90 degrees)
        // - Moving left (-X): rotation.y = -PI/2 or 3*PI/2 (270 degrees)
        // - Moving down (+Y, which is +Z in 3D): rotation.y = 0 (forward)
        // - Moving up (-Y, which is -Z in 3D): rotation.y = PI (180 degrees)
        
        let targetAngle = 0;
        if (dx > 0) {
          // Moving right (+X)
          targetAngle = Math.PI / 2;
        } else if (dx < 0) {
          // Moving left (-X)
          targetAngle = -Math.PI / 2;
        } else if (dy > 0) {
          // Moving down (+Y, forward in Z)
          targetAngle = 0;
        } else if (dy < 0) {
          // Moving up (-Y, backward in Z)
          targetAngle = Math.PI;
        }
        
        // Normalize to [0, 2*PI] range
        while (targetAngle < 0) targetAngle += 2 * Math.PI;
        while (targetAngle >= 2 * Math.PI) targetAngle -= 2 * Math.PI;
        
        // Smoothly rotate to the new angle
        const currentRotation = animState.characterMesh.rotation.y;
        
        // Calculate shortest rotation path
        let rotationDiff = targetAngle - currentRotation;
        if (rotationDiff > Math.PI) rotationDiff -= 2 * Math.PI;
        if (rotationDiff < -Math.PI) rotationDiff += 2 * Math.PI;
        
        // Smooth rotation with lerp (faster rotation for more responsive feel)
        const rotationLerp = 0.5; // Higher = faster rotation
        const newRotation = currentRotation + rotationDiff * rotationLerp;
        
        if (animState.characterMesh instanceof TransformNode) {
          animState.characterMesh.rotation.y = newRotation;
        } else {
          animState.characterMesh.rotation.y = newRotation;
        }
      }
      
      animState.currentStep = currentStep;
    }
  });
}

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
