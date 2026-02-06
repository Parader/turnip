/**
 * Player character management for Babylon.js scene
 * Handles loading, updating, and managing player character models
 */

import { MeshBuilder, StandardMaterial, Color3, Vector3, SceneLoader, TransformNode } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { findPath } from '../pathfinding';
import { startMovementAnimation } from './babylonAnimations';

/**
 * Convert server orientation (atan2-based, 0 = +X in map coords) to Babylon rotation.y
 * Server: atan2(dy, dx) where 0 = +X, PI/2 = +Y (map coordinates)
 * Babylon: rotation.y where 0 = +Z, PI/2 = +X
 * Conversion: babylonRotation = PI/2 - serverOrientation
 * @param {number} serverOrientation - Orientation in radians from server
 * @returns {number} Babylon rotation.y value
 */
export function serverOrientationToBabylon(serverOrientation) {
  return Math.PI / 2 - serverOrientation;
}

/**
 * Convert Babylon rotation.y to server orientation (for sending updates)
 * @param {number} babylonRotation - Babylon rotation.y value
 * @returns {number} Server orientation in radians
 */
export function babylonToServerOrientation(babylonRotation) {
  return Math.PI / 2 - babylonRotation;
}

/**
 * Get Babylon rotation for a player based on their orientation or team fallback
 * @param {Object} player - Player data with optional orientation and team
 * @returns {number} Babylon rotation.y value
 */
function getPlayerRotation(player) {
  // Use server orientation if available
  if (player.orientation !== undefined && player.orientation !== null) {
    return serverOrientationToBabylon(player.orientation);
  }
  
  // Fallback to team-based default
  if (player.team === 'A') {
    return Math.PI / 2; // Face right (+X)
  } else if (player.team === 'B') {
    return 3 * Math.PI / 2; // Face left (-X)
  }
  return 0;
}

/**
 * Get model path for character class
 * @param {string} characterClass - Character class name
 * @returns {string} Path to model file
 */
function getModelPath(characterClass) {
  if (!characterClass) {
    console.warn('getModelPath: characterClass is missing, defaulting to warrior');
    return '/models/warrior/master.glb';
  }
  const classId = characterClass.toLowerCase();
  const validClasses = ['assassin', 'warrior', 'archer', 'mage'];
  const normalizedClass = validClasses.includes(classId) ? classId : 'warrior';
  if (normalizedClass !== classId) {
    console.warn(`getModelPath: Invalid characterClass "${characterClass}", using "${normalizedClass}"`);
  }
  return `/models/${normalizedClass}/master.glb`;
}

/**
 * Create a fallback sphere if model loading fails
 * @param {Object} player - Player data
 * @param {boolean} isMyTeam - Whether player is on my team
 * @param {number} xPos - X position
 * @param {number} zPos - Z position
 * @param {Scene} scene - Babylon.js scene
 * @returns {Object} Sphere mesh and empty animation groups
 */
function createPlayerSphereFallback(player, isMyTeam, xPos, zPos, scene) {
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
  
  // Make sphere non-pickable so clicks pass through to tiles
  sphere.isPickable = false;

  sphere.metadata = {
    userId: player.userId,
    username: player.username,
    team: player.team,
    characterId: player.characterId,
    isMyTeam: isMyTeam
  };

  return { root: sphere, animationGroups: [] };
}

/**
 * Create a player character model
 * @param {Object} player - Player data
 * @param {boolean} isMyTeam - Whether player is on my team
 * @param {Scene} scene - Babylon.js scene
 * @param {number} tileSize - Size of each tile
 * @returns {Promise<Object>} Model root and animation groups
 */
async function createPlayerModel(player, isMyTeam, scene, tileSize) {
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
      
      // Make cloned meshes non-pickable
      if (modelRoot.isPickable !== undefined) {
        modelRoot.isPickable = false;
      }
      if (modelRoot.getChildMeshes) {
        modelRoot.getChildMeshes().forEach(childMesh => {
          if (childMesh.isPickable !== undefined) {
            childMesh.isPickable = false;
          }
        });
      }
    } else {
      // Load new model
      const result = await SceneLoader.ImportMeshAsync('', modelPath, '', scene);
      modelRoot = result.meshes[0];
      
      // Make loaded meshes non-pickable
      if (modelRoot.isPickable !== undefined) {
        modelRoot.isPickable = false;
      }
      if (modelRoot.getChildMeshes) {
        modelRoot.getChildMeshes().forEach(childMesh => {
          if (childMesh.isPickable !== undefined) {
            childMesh.isPickable = false;
          }
        });
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
      
      // Apply rotation from server orientation (or team fallback)
      const rotationY = getPlayerRotation(player);
      characterContainer.rotation.y = rotationY;
      
      // Position container at tile location
      characterContainer.position = new Vector3(xPos, size.y, zPos);
      
      // Make model a child of the container
      modelRoot.parent = characterContainer;
      
      // Reset model's local position/rotation since it's now relative to container
      modelRoot.position = Vector3.Zero();
      modelRoot.rotation = Vector3.Zero();
      
      // Scale model to appropriate size
      const scale = 0.8;
      modelRoot.scaling = new Vector3(scale, scale, scale);
      
      // Use container as the root for tracking
      const actualRoot = characterContainer;
      
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
      
      // Make character meshes non-pickable so clicks pass through to tiles
      modelRoot.isPickable = false;
      if (modelRoot.getChildMeshes) {
        modelRoot.getChildMeshes().forEach(childMesh => {
          childMesh.isPickable = false;
        });
      }
      actualRoot.isPickable = false;
      
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
    return createPlayerSphereFallback(player, isMyTeam, xPos, zPos, scene);
  }
}

/**
 * Build player characters at their positions
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} gameState - Game state with player data
 * @param {string} userId - Current user's ID
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 */
export function buildPlayerCharacters(scene, gameState, userId, mapWidth, mapHeight) {
  const tileSize = 1;

  // Store player meshes and animation groups in scene metadata for updates
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.playerMeshes) {
    scene.metadata.playerMeshes = new Map();
  }
  if (!scene.metadata.playerAnimationGroups) {
    scene.metadata.playerAnimationGroups = new Map();
  }
  if (!scene.metadata.modelCache) {
    scene.metadata.modelCache = new Map(); // Cache loaded models to avoid reloading
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

  // Load all player models asynchronously
  const loadPlayers = async () => {
    const loadPromises = [];

    // Add players from my team
    if (gameState.myTeam && gameState.myTeam.players) {
      Object.values(gameState.myTeam.players).forEach(player => {
        if (player.position && player.position.x !== undefined && player.position.y !== undefined) {
          if (!player.characterClass) {
            console.warn(`Player ${player.userId} (${player.username}) missing characterClass in gameState`);
          }
          loadPromises.push(
            createPlayerModel(player, true, scene, tileSize).then(result => {
              if (result) {
                scene.metadata.playerMeshes.set(player.userId, result.root);
                // Animation groups are already stored as a Map in createPlayerModel
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
            createPlayerModel(player, false, scene, tileSize).then(result => {
              if (result) {
                scene.metadata.playerMeshes.set(player.userId, result.root);
                // Animation groups are already stored as a Map in createPlayerModel
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
export async function updatePlayerCharacters(scene, gameState, userId, mapWidth, mapHeight) {
  // Import teleport module to check for active teleports
  let activeTeleports = null;
  try {
    const teleportModule = await import('./babylonTeleport');
    activeTeleports = teleportModule.activeTeleports;
  } catch (e) {
    // Module not available, continue without teleport check
  }
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
      
      // If player has moved, handle movement (animation or teleport)
      if (hasMoved && previousPos) {
        const startX = previousPos.x;
        const startY = previousPos.y;
        const endX = player.position.x;
        const endY = player.position.y;
        const distance = Math.abs(endX - startX) + Math.abs(endY - startY);
        
        // Check if this player has an active teleport VFX controller
        // If so, skip normal movement animation (teleport controller handles position)
        if (activeTeleports && activeTeleports.has(player.userId)) {
          // Teleport VFX is handling the position change, skip normal movement
          console.log(`Skipping normal movement animation for ${player.userId} - teleport VFX active`);
          // Still update the position silently (teleport controller will handle visual)
          if (isContainer) {
            existingMesh.position.x = xPos;
            existingMesh.position.z = zPos;
          } else {
            existingMesh.position.x = xPos;
            existingMesh.position.z = zPos;
          }
          // Update previous position to prevent re-triggering
          if (scene.metadata.playerPreviousPositions) {
            scene.metadata.playerPreviousPositions.set(player.userId, { x: endX, y: endY });
          }
          return; // Skip normal movement handling
        }
        
        // During preparation phase, just teleport to destination (no animation)
        if (gameState.phase === 'preparation') {
          // Teleport immediately to new position
          if (isContainer) {
            existingMesh.position.x = xPos;
            existingMesh.position.z = zPos;
          } else {
            existingMesh.position.x = xPos;
            existingMesh.position.z = zPos;
          }
        } else {
          // Game phase: use movement animation
          // Priority 1: Use server-provided path (most accurate, same for all clients)
          let path = [];
          if (player.movementPath && Array.isArray(player.movementPath) && player.movementPath.length > 0) {
            path = player.movementPath.map(pos => ({ x: pos.x, y: pos.y }));
            
            // Verify the path matches the actual movement
            const pathStart = path[0];
            const pathEnd = path[path.length - 1];
            if (pathStart.x === startX && pathStart.y === startY && 
                pathEnd.x === endX && pathEnd.y === endY) {
              // Server path is valid, use it
              console.log(`Using server-provided path for player ${player.userId}, length: ${path.length}`);
            } else {
              // Path doesn't match, clear it and fall back
              path = [];
            }
          }
          
          // Priority 2: Check if we have a pending movement path (from previsualization)
          if (path.length === 0) {
            const pendingPath = scene.metadata.pendingMovementPaths?.get(player.userId);
            
            if (pendingPath && pendingPath.path && pendingPath.path.length > 0) {
              path = pendingPath.path.map(pos => ({ x: pos.x, y: pos.y }));
              
              const pathStart = path[0];
              const pathEnd = path[path.length - 1];
              if (pathStart.x === startX && pathStart.y === startY && 
                  pathEnd.x === endX && pathEnd.y === endY) {
                scene.metadata.pendingMovementPaths.delete(player.userId);
                console.log(`Using previsualized path for player ${player.userId}, length: ${path.length}`);
              } else {
                path = [];
              }
            }
          }
          
          // Priority 3: If no server path or previsualized path, calculate path (fallback)
          if (path.length === 0) {
            if (scene.metadata && scene.metadata.terrain) {
              const occupiedTiles = new Set();
              allPlayers.forEach(p => {
                if (p.userId !== player.userId && p.position) {
                  occupiedTiles.add(`${p.position.x}_${p.position.y}`);
                }
              });
              
              // Add spawned entities that block movement
              const gameState = scene.metadata.gameState;
              if (gameState && gameState.spawnedEntities) {
                Object.values(gameState.spawnedEntities).forEach(entity => {
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
                // Fallback to simple straight path
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
          
          // Create onComplete callback to sync orientation with server
          const onMovementComplete = (completedUserId, finalBabylonRotation) => {
            if (scene.metadata?.onOrientationChange) {
              scene.metadata.onOrientationChange(completedUserId, finalBabylonRotation);
            }
          };
          
          // Start movement animation with orientation sync callback
          startMovementAnimation(scene, player.userId, existingMesh, path, animationType, tileSize, onMovementComplete);
        }
      }
      
      // If it's not a container, we need to wrap it in one for proper rotation
      if (!isContainer) {
        console.log(`Wrapping existing mesh for player ${player.userId} in TransformNode container`);
        const characterContainer = new TransformNode(`characterContainer_${player.userId}`, scene);
        
        const modelMesh = existingMesh.metadata?.modelMesh || existingMesh;
        
        const rotationY = getPlayerRotation(player);
        
        characterContainer.position = new Vector3(xPos, existingMesh.position.y, zPos);
        characterContainer.rotation.y = rotationY;
        
        modelMesh.parent = characterContainer;
        modelMesh.position = Vector3.Zero();
        modelMesh.rotation = Vector3.Zero();
        
        characterContainer.metadata = existingMesh.metadata || {};
        characterContainer.metadata.modelMesh = modelMesh;
        
        scene.metadata.playerMeshes.set(player.userId, characterContainer);
      } else {
        // It's already a container, just update position and rotation
        const isAnimating = scene.metadata.playerMovementAnimations.has(player.userId) && 
                           scene.metadata.playerMovementAnimations.get(player.userId).isAnimating;
        
        if (!isAnimating && existingMesh.position) {
          existingMesh.position.x = xPos;
          existingMesh.position.z = zPos;
          
          // Apply server orientation when not animating
          if (player.orientation !== undefined && player.orientation !== null) {
            existingMesh.rotation.y = getPlayerRotation(player);
          }
        }
      }
    } else {
      // Create new model if it doesn't exist
      const createPlayerModelAsync = async () => {
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
            const scale = 0.8;
            modelRoot.scaling = new Vector3(scale, scale, scale);
            
            const characterContainer = new TransformNode(`characterContainer_${player.userId}`, scene);
            
            const rotationY = getPlayerRotation(player);
            characterContainer.rotation.y = rotationY;
            characterContainer.position = new Vector3(xPos, size.y, zPos);
            
            modelRoot.parent = characterContainer;
            modelRoot.position = Vector3.Zero();
            modelRoot.rotation = Vector3.Zero();
            
            const actualRoot = characterContainer;
            
            if (animationGroups.length > 0) {
              const animMap = new Map();
              animationGroups.forEach(ag => {
                const animName = ag.name ? ag.name.toLowerCase() : '';
                animMap.set(animName, ag);
              });
              scene.metadata.playerAnimationGroups.set(player.userId, animMap);
              
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

      loadPromises.push(createPlayerModelAsync());
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
