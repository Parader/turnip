/**
 * Animation system for Babylon.js scene
 * Handles all character animations: movement, stance, cast, hit
 */

import { AnimationGroup, TransformNode, Vector3, SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { activeTeleports } from './babylonTeleport';

/**
 * Blend two animations smoothly over a duration
 * @param {AnimationGroup} fromAnim - Animation to blend from
 * @param {AnimationGroup} toAnim - Animation to blend to
 * @param {number} durationMs - Blend duration in milliseconds
 * @param {Scene} scene - Babylon.js scene
 * @param {Function} onComplete - Callback when blend completes
 */
export function blendAnimations(fromAnim, toAnim, durationMs, scene, onComplete) {
  if (!fromAnim || !toAnim) {
    if (onComplete) onComplete();
    return;
  }

  // Ensure both animations are playing
  if (!fromAnim.isPlaying) {
    fromAnim.play(true);
  }
  if (!toAnim.isPlaying) {
    toAnim.play(true);
  }

  // Set initial weights
  fromAnim.setWeightForAllAnimatables(1.0);
  toAnim.setWeightForAllAnimatables(0.0);

  const startTime = Date.now();
  const duration = durationMs / 1000; // Convert to seconds

  // Ease-in-out function
  const easeInOut = (t) => {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  };

  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(elapsed / duration, 1.0);
    const easedProgress = easeInOut(progress);

    const fromWeight = 1.0 - easedProgress;
    const toWeight = easedProgress;

    fromAnim.setWeightForAllAnimatables(fromWeight);
    toAnim.setWeightForAllAnimatables(toWeight);

    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(observer);
      fromAnim.setWeightForAllAnimatables(0.0);
      fromAnim.stop();
      if (onComplete) onComplete();
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
export function startMovementAnimation(scene, userId, characterMesh, path, animationType, tileSize, onComplete = null) {
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
    isTransitioning: false,
    onComplete: onComplete // Callback when animation finishes (for orientation sync)
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
 * Start stance animation for spell preparation
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @param {Object} prepAnimDef - Prep animation definition from spell
 */
export function startStanceAnimation(scene, userId, prepAnimDef) {
  if (!scene.metadata || !scene.metadata.playerAnimationGroups) {
    console.warn(`startStanceAnimation: scene.metadata or playerAnimationGroups not found for player ${userId}`);
    return;
  }
  
  const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
  if (!playerAnims || !(playerAnims instanceof Map)) {
    console.warn(`startStanceAnimation: Player ${userId} has no animation groups or not a Map`);
    return;
  }
  
  // Find stance animation by name
  let stanceAnim = null;
  const stanceName = prepAnimDef?.name?.toLowerCase() || 'stance';
  
  // Try exact match first
  if (playerAnims.has(stanceName)) {
    stanceAnim = playerAnims.get(stanceName);
  } else {
    // Try partial match
    for (const [animName, anim] of playerAnims) {
      if (animName === stanceName || animName.includes(stanceName) || stanceName.includes(animName)) {
        stanceAnim = anim;
        break;
      }
    }
  }
  
  if (!stanceAnim) {
    const availableAnims = Array.from(playerAnims.keys());
    console.warn(`Stance animation "${stanceName}" not found for player ${userId}. Available animations:`, availableAnims);
    return;
  }
  
  // Find current active animation (idle or other)
  let currentAnim = null;
  let currentWeight = 0;
  playerAnims.forEach((anim) => {
    if (anim !== stanceAnim) {
      const animName = anim.name ? anim.name.toLowerCase() : '';
      // Check if this animation is currently playing with weight > 0
      if (anim.isPlaying) {
        // Try to get current weight (approximate by checking if it's likely active)
        if (animName.includes('idle') || animName.includes('stand')) {
          currentAnim = anim;
          currentWeight = 1.0; // Assume full weight if it's the active idle
        }
      }
    }
  });
  
  // If we have a current animation, blend from it to stance
  const blendInMs = prepAnimDef.blendInMs || 200;
  if (currentAnim && blendInMs > 0) {
    // Smoothly blend from current to stance
    blendAnimations(currentAnim, stanceAnim, blendInMs, scene, () => {
      // After blend completes, ensure stance is at 100% and stop other animations
      stanceAnim.setWeightForAllAnimatables(1.0);
      playerAnims.forEach((anim) => {
        if (anim !== stanceAnim) {
          anim.setWeightForAllAnimatables(0.0);
          anim.stop();
        }
      });
    });
  } else {
    // No current animation or no blend time, start stance immediately at 100%
    playerAnims.forEach((anim) => {
      if (anim !== stanceAnim) {
        anim.setWeightForAllAnimatables(0.0);
        anim.stop();
      }
    });
    stanceAnim.setWeightForAllAnimatables(1.0);
    stanceAnim.play(prepAnimDef.loop || false);
  }
  
  // Store stance animation state
  if (!scene.metadata.playerStanceAnimations) {
    scene.metadata.playerStanceAnimations = new Map();
  }
  scene.metadata.playerStanceAnimations.set(userId, {
    animation: stanceAnim,
    prepAnimDef: prepAnimDef
  });
}

/**
 * Stop stance animation and return to idle with smooth transition
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 */
export function stopStanceAnimation(scene, userId) {
  if (!scene.metadata || !scene.metadata.playerStanceAnimations) {
    return;
  }
  
  const stanceState = scene.metadata.playerStanceAnimations.get(userId);
  if (!stanceState || !stanceState.animation) {
    return;
  }
  
  const stanceAnim = stanceState.animation;
  const blendOutMs = stanceState.prepAnimDef?.blendOutMs || 150;
  
  // Find idle animation
  const playerAnims = scene.metadata.playerAnimationGroups?.get(userId);
  if (playerAnims && playerAnims instanceof Map) {
    for (const [animName, idleAnim] of playerAnims) {
      if (animName.includes('idle') || animName.includes('stand')) {
        // Smoothly blend from stance to idle
        blendAnimations(stanceAnim, idleAnim, blendOutMs, scene, () => {
          scene.metadata.playerStanceAnimations.delete(userId);
        });
        return;
      }
    }
  }
  
  // Fallback: immediate stop if no idle found
  stanceAnim.setWeightForAllAnimatables(0.0);
  stanceAnim.stop();
  scene.metadata.playerStanceAnimations.delete(userId);
}

/**
 * Get skeleton and the mesh that owns it (for character models).
 * @param {import('@babylonjs/core').Node} node - Mesh or TransformNode
 * @returns {{ skeleton: import('@babylonjs/core').Skeleton, ownerMesh: import('@babylonjs/core').TransformNode }|null}
 */
function getSkeletonAndOwner(node) {
  if (!node) return null;
  if (node.skeleton) return { skeleton: node.skeleton, ownerMesh: node };
  const children = node.getChildMeshes?.() || [];
  for (const child of children) {
    const found = getSkeletonAndOwner(child);
    if (found) return found;
  }
  return null;
}

/** @type {Map<string, import('@babylonjs/core').AbstractMesh|null>} */
const weaponTemplateCache = new Map();
/** @type {Map<string, Promise<import('@babylonjs/core').AbstractMesh|null>>} */
const weaponTemplateLoadPromises = new Map();

/**
 * Load a weapon mesh template for attachment (cached by url).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} meshUrl - e.g. '/assets/dagger.glb'
 * @returns {Promise<import('@babylonjs/core').AbstractMesh|null>} Root mesh of the model (template, do not parent)
 */
async function loadWeaponTemplate(scene, meshUrl) {
  const cached = weaponTemplateCache.get(meshUrl);
  if (cached !== undefined) return cached;
  let promise = weaponTemplateLoadPromises.get(meshUrl);
  if (promise) return promise;
  const lastSlash = meshUrl.lastIndexOf('/');
  const rootUrl = lastSlash >= 0 ? meshUrl.slice(0, lastSlash + 1) : '/';
  const filename = lastSlash >= 0 ? meshUrl.slice(lastSlash + 1) : meshUrl;
  promise = SceneLoader.ImportMeshAsync('', rootUrl, filename, scene)
    .then((result) => {
      if (!result.meshes || result.meshes.length === 0) {
        weaponTemplateCache.set(meshUrl, null);
        weaponTemplateLoadPromises.delete(meshUrl);
        return null;
      }
      // Use root (no parent) so hierarchy is intact; fallback to first mesh with geometry
      let root = result.meshes.find((m) => !m.parent) || result.meshes[0];
      const withVerts = result.meshes.find((m) => (m.getTotalVertices?.() ?? 0) > 0);
      if (withVerts && (root.getTotalVertices?.() ?? 0) === 0) {
        root = withVerts;
      }
      root.setEnabled(false);
      root.parent = null;
      weaponTemplateCache.set(meshUrl, root);
      weaponTemplateLoadPromises.delete(meshUrl);
      return root;
    })
    .catch((err) => {
      console.warn(`[WeaponAttachment] Failed to load ${meshUrl}:`, err);
      weaponTemplateCache.delete(meshUrl);
      weaponTemplateLoadPromises.delete(meshUrl);
      return null;
    });
  weaponTemplateLoadPromises.set(meshUrl, promise);
  return promise;
}

/**
 * Attach a weapon mesh to a player's bone for the duration of a cast animation.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} userId
 * @param {{ meshUrl: string, boneName: string, scale?: number, positionOffset?: {x,y,z}, rotationOffset?: {x,y,z} }} def
 * @returns {Promise<import('@babylonjs/core').AbstractMesh|TransformNode|null>} Attached mesh/container to pass to detachWeaponFromPlayer
 */
export async function attachWeaponToPlayer(scene, userId, def) {
  if (!def?.meshUrl || !def?.boneName) return null;
  const playerMesh = scene.metadata?.playerMeshes?.get(userId);
  if (!playerMesh) return null;
  const modelMesh = playerMesh.metadata?.modelMesh || playerMesh;
  const skeletonAndOwner = getSkeletonAndOwner(modelMesh);
  if (!skeletonAndOwner) {
    console.warn(`[WeaponAttachment] No skeleton found for player ${userId}`);
    return null;
  }
  const { skeleton, ownerMesh } = skeletonAndOwner;
  const boneNames = skeleton.bones?.map((b) => b.name) ?? [];
  let bone = skeleton.bones?.find((b) => b.name === def.boneName) ?? null;
  if (!bone) {
    const lower = def.boneName.toLowerCase();
    bone = skeleton.bones?.find((b) => (b.name || '').toLowerCase() === lower || (b.name || '').toLowerCase().endsWith(lower)) ?? null;
  }
  if (!bone) {
    console.warn(`[WeaponAttachment] Bone "${def.boneName}" not found on player ${userId}. Available:`, boneNames);
    return null;
  }
  const template = await loadWeaponTemplate(scene, def.meshUrl);
  if (!template) {
    console.warn(`[WeaponAttachment] Failed to load template ${def.meshUrl}`);
    return null;
  }
  const name = `weapon_${userId}_${Date.now()}`;
  const weaponRoot = template.clone(name, null, false);
  if (!weaponRoot) return null;
  weaponRoot.setEnabled(true);
  weaponRoot.visibility = 1;
  weaponRoot.position = Vector3.Zero();
  weaponRoot.rotation = Vector3.Zero();
  const scale = def.scale ?? 1;
  weaponRoot.scaling = new Vector3(scale, scale, scale);
  if (def.positionOffset) {
    weaponRoot.position = new Vector3(
      def.positionOffset.x ?? 0,
      def.positionOffset.y ?? 0,
      def.positionOffset.z ?? 0
    );
  }
  if (def.rotationOffset) {
    weaponRoot.rotation = new Vector3(
      def.rotationOffset.x ?? 0,
      def.rotationOffset.y ?? 0,
      def.rotationOffset.z ?? 0
    );
  }
  const allWeaponMeshes = [weaponRoot, ...(weaponRoot.getChildMeshes?.() || [])];
  allWeaponMeshes.forEach((m) => {
    m.setEnabled(true);
    m.visibility = 1;
    m.isPickable = false;
    if (m.material && m.material.alpha !== undefined) m.material.alpha = 1;
  });
  try {
    weaponRoot.attachToBone(bone, ownerMesh);
    console.log(`[WeaponAttachment] Attached to bone "${bone.name}" (${allWeaponMeshes.length} mesh(es))`);
  } catch (err) {
    console.warn(`[WeaponAttachment] attachToBone failed:`, err);
    detachWeaponFromPlayer(weaponRoot);
    return null;
  }
  return weaponRoot;
}

/**
 * Detach and dispose a weapon that was attached for a cast animation.
 * @param {import('@babylonjs/core').AbstractMesh|TransformNode|null} weaponRoot
 */
export function detachWeaponFromPlayer(weaponRoot) {
  if (!weaponRoot) return;
  try {
    if (typeof weaponRoot.detachFromBone === 'function') {
      weaponRoot.detachFromBone(false);
    }
    weaponRoot.setEnabled(false);
    weaponRoot.parent = null;
    if (!weaponRoot.isDisposed) weaponRoot.dispose();
  } catch (e) {
    // ignore
  }
}

/**
 * Play cast animation for a spell using Babylon.js animation chaining
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @param {Object} castAnimDef - Cast animation definition from spell
 */
export async function playCastAnimation(scene, userId, castAnimDef) {
  if (!scene.metadata || !scene.metadata.playerAnimationGroups) {
    console.warn(`playCastAnimation: scene.metadata or playerAnimationGroups not found`);
    return;
  }
  
  const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
  if (!playerAnims || !(playerAnims instanceof Map)) {
    console.warn(`playCastAnimation: Player ${userId} has no animation groups or not a Map`);
    return;
  }
  
  // Find cast animation by name from spell definition
  let castAnim = null;
  // Use the animation name from the spell definition
  const castName = castAnimDef.name?.toLowerCase() || 'cast';
  
  // Try exact match first (animations are stored with lowercase names)
  if (playerAnims.has(castName)) {
    castAnim = playerAnims.get(castName);
  } else {
    // Try partial match
    for (const [animName, anim] of playerAnims) {
      if (animName === castName || animName.includes(castName) || castName.includes(animName)) {
        castAnim = anim;
        break;
      }
    }
  }
  
  // If still not found, try common cast animation names as fallback
  if (!castAnim) {
    const commonCastNames = ['attack', 'cast', 'spell', 'shoot', 'fire'];
    for (const commonName of commonCastNames) {
      if (playerAnims.has(commonName)) {
        castAnim = playerAnims.get(commonName);
        break;
      }
      // Also try partial match
      for (const [animName, anim] of playerAnims) {
        if (animName.includes(commonName)) {
          castAnim = anim;
          break;
        }
      }
      if (castAnim) break;
    }
  }
  
  if (!castAnim) {
    const availableAnims = Array.from(playerAnims.keys());
    console.warn(`Cast animation "${castName}" not found for player ${userId}. Available animations:`, availableAnims);
    return;
  }
  
  // Find current animation (stance or idle)
  let currentAnim = null;
  const stanceState = scene.metadata.playerStanceAnimations?.get(userId);
  if (stanceState && stanceState.animation) {
    currentAnim = stanceState.animation;
  } else {
    // Find idle animation
    for (const [animName, anim] of playerAnims) {
      if (animName.includes('idle') || animName.includes('stand')) {
        if (anim.isPlaying) {
          currentAnim = anim;
          break;
        }
      }
    }
  }
  
  // Find idle animation for transition after cast
  let idleAnim = null;
  for (const [animName, anim] of playerAnims) {
    if (animName.includes('idle') || animName.includes('stand')) {
      idleAnim = anim;
      break;
    }
  }
  
  // Stop any active movement animations first
  const movementAnimState = scene.metadata.playerMovementAnimations?.get(userId);
  if (movementAnimState && movementAnimState.isAnimating) {
    if (movementAnimState.movementAnim) {
      movementAnimState.movementAnim.setWeightForAllAnimatables(0.0);
      movementAnimState.movementAnim.stop();
    }
    if (movementAnimState.idleAnim) {
      movementAnimState.idleAnim.setWeightForAllAnimatables(0.0);
      movementAnimState.idleAnim.stop();
    }
    movementAnimState.isAnimating = false;
    scene.metadata.playerMovementAnimations.delete(userId);
  }
  
  // Clear stance state FIRST and stop stance animation immediately
  // This must happen before stopping other animations to ensure stance doesn't interfere
  if (stanceState && stanceState.animation) {
    const stanceAnim = stanceState.animation;
    // Force stop the stance animation - set weight to 0 and stop it
    stanceAnim.setWeightForAllAnimatables(0.0);
    stanceAnim.stop();
    // Clear the stance state from metadata
    scene.metadata.playerStanceAnimations.delete(userId);
    // Also clear currentAnim if it was the stance
    if (currentAnim === stanceAnim) {
      currentAnim = null;
    }
  }
  
  // Stop ALL animations and set their weights to 0 BEFORE starting cast
  // This ensures no animation interference
  playerAnims.forEach((anim) => {
    if (anim !== castAnim) {
      // Stop and zero weight for all animations except cast
      anim.setWeightForAllAnimatables(0.0);
      anim.stop();
    }
  });
  
  // Stop current animation if it exists and is different from cast
  if (currentAnim && currentAnim !== castAnim) {
    currentAnim.setWeightForAllAnimatables(0.0);
    currentAnim.stop();
  }
  
  // Prepare idle for transition (keep it stopped and at 0 weight for now)
  if (idleAnim && idleAnim !== castAnim) {
    idleAnim.setWeightForAllAnimatables(0.0);
    idleAnim.stop(); // Stop it, we'll start it later for transition
  }
  
  // Optional: attach weapon to bone for this cast (e.g. dagger in hand for attack4)
  let attachedWeapon = null;
  if (castAnimDef.weaponAttachment) {
    try {
      attachedWeapon = await attachWeaponToPlayer(scene, userId, castAnimDef.weaponAttachment);
    } catch (e) {
      console.warn('[WeaponAttachment] Attach failed:', e);
    }
  }

  // Start cast animation at 100% weight - ensure it's the ONLY animation playing
  castAnim.setWeightForAllAnimatables(1.0);
  castAnim.play(false); // Don't loop

  // Store cast animation state to prevent interruption
  if (!scene.metadata.playerCastAnimations) {
    scene.metadata.playerCastAnimations = new Map();
  }
  scene.metadata.playerCastAnimations.set(userId, {
    animation: castAnim,
    startTime: Date.now(),
    attachedWeapon
  });

  const cleanupWeapon = () => {
    const state = scene.metadata.playerCastAnimations?.get(userId);
    if (state?.attachedWeapon) {
      detachWeaponFromPlayer(state.attachedWeapon);
      state.attachedWeapon = null;
    }
  };

  try {
    // Wait for cast animation to complete using onAnimationGroupEndObservable
    // AnimationGroup doesn't have waitAsync, so we use the observable pattern
    const animationEnded = new Promise((resolve) => {
      const observer = castAnim.onAnimationGroupEndObservable.add(() => {
        castAnim.onAnimationGroupEndObservable.remove(observer);
        resolve();
      });
    });
    
    await animationEnded;
    
    // Calculate if we need to wait for lockMs (minimum busy time)
    const frameRange = castAnim.to - castAnim.from;
    let fps = 30;
    if (castAnim.targetedAnimations && castAnim.targetedAnimations.length > 0) {
      const firstAnim = castAnim.targetedAnimations[0].animation;
      if (firstAnim && firstAnim.framePerSecond) {
        fps = firstAnim.framePerSecond;
      }
    }
    const actualDurationMs = (frameRange / fps) * 1000;
    const lockMs = castAnimDef.lockMs || 1000;
    const totalDurationMs = Math.max(actualDurationMs, lockMs);
    
    const castStateCheck = scene.metadata.playerCastAnimations?.get(userId);
    if (castStateCheck && castStateCheck.animation === castAnim) {
      const elapsed = Date.now() - castStateCheck.startTime;
      const remainingTime = Math.max(0, totalDurationMs - elapsed);
      
      if (remainingTime > 0) {
        // Wait for remaining time to ensure full duration
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }
    }
    
    // Cast animation has completed at 100% weight, now transition to idle
    const castState = scene.metadata.playerCastAnimations?.get(userId);
    if (castState && castState.animation === castAnim) {
      cleanupWeapon();
      scene.metadata.playerCastAnimations.delete(userId);

      // Transition to idle using blend timing
      const blendOutMs = castAnimDef.blendOutMs || 200;
      if (idleAnim) {
        // Ensure cast is still at 100% before blending
        castAnim.setWeightForAllAnimatables(1.0);
        // Smoothly blend from cast to idle
        blendAnimations(castAnim, idleAnim, blendOutMs, scene, () => {
          castAnim.setWeightForAllAnimatables(0.0);
          castAnim.stop();
        });
      } else {
        // Fallback: find idle animation
        const playerAnims = scene.metadata.playerAnimationGroups?.get(userId);
        if (playerAnims && playerAnims instanceof Map) {
          for (const [animName, anim] of playerAnims) {
            if (animName.includes('idle') || animName.includes('stand')) {
              castAnim.setWeightForAllAnimatables(1.0);
              blendAnimations(castAnim, anim, blendOutMs, scene, () => {
                castAnim.setWeightForAllAnimatables(0.0);
                castAnim.stop();
              });
              break;
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error playing cast animation for player ${userId}:`, error);
    // Cleanup on error
    const castState = scene.metadata.playerCastAnimations?.get(userId);
    if (castState && castState.animation === castAnim) {
      cleanupWeapon();
      scene.metadata.playerCastAnimations.delete(userId);
      castAnim.setWeightForAllAnimatables(0.0);
      castAnim.stop();

      // Return to idle
      if (idleAnim) {
        idleAnim.setWeightForAllAnimatables(1.0);
        idleAnim.play(true);
      }
    }
  }
}

/**
 * Play hit animation when a character takes damage
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID who got hit
 */
export async function playHitAnimation(scene, userId) {
  if (!scene.metadata || !scene.metadata.playerAnimationGroups) {
    console.warn(`playHitAnimation: scene.metadata or playerAnimationGroups not found for player ${userId}`);
    return;
  }
  
  const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
  if (!playerAnims || !(playerAnims instanceof Map)) {
    console.warn(`playHitAnimation: Player ${userId} has no animation groups or not a Map`);
    return;
  }
  
  // Find hit animation by name
  let hitAnim = null;
  const hitNames = ['hit', 'hurt', 'damage', 'stagger', 'recoil'];
  
  // Try to find hit animation
  for (const hitName of hitNames) {
    if (playerAnims.has(hitName)) {
      hitAnim = playerAnims.get(hitName);
      break;
    }
    // Try partial match
    for (const [animName, anim] of playerAnims) {
      if (animName.includes(hitName)) {
        hitAnim = anim;
        break;
      }
    }
    if (hitAnim) break;
  }
  
  if (!hitAnim) {
    const availableAnims = Array.from(playerAnims.keys());
    console.warn(`Hit animation not found for player ${userId}. Available animations:`, availableAnims);
    return;
  }
  
  // Check if player is currently teleporting
  const teleportController = activeTeleports?.get(userId);
  if (teleportController && teleportController.state !== 'idle' && teleportController.state !== 'cleaning') {
    // Player is teleporting - wait for teleport to complete before playing hit
    console.log(`[HitAnim] Player ${userId} is teleporting (state: ${teleportController.state}), waiting for completion`);
    waitForTeleportAndPlayHit(scene, userId, hitAnim);
    return;
  }
  
  // Find current animation (stance, cast, idle, or movement)
  let currentAnim = null;
  const stanceState = scene.metadata.playerStanceAnimations?.get(userId);
  const castState = scene.metadata.playerCastAnimations?.get(userId);
  const movementState = scene.metadata.playerMovementAnimations?.get(userId);
  
  if (castState && castState.animation) {
    // Don't interrupt cast animation - hit should play after cast
    // Store hit request to play after cast
    if (!scene.metadata.pendingHitAnimations) {
      scene.metadata.pendingHitAnimations = new Map();
    }
    scene.metadata.pendingHitAnimations.set(userId, hitAnim);
    return;
  } else if (stanceState && stanceState.animation) {
    currentAnim = stanceState.animation;
  } else if (movementState && movementState.isAnimating && movementState.movementAnim) {
    currentAnim = movementState.movementAnim;
  } else {
    // Find idle animation
    for (const [animName, anim] of playerAnims) {
      if (animName.includes('idle') || animName.includes('stand')) {
        if (anim.isPlaying) {
          currentAnim = anim;
          break;
        }
      }
    }
  }
  
  // Find idle animation for transition after hit
  let idleAnim = null;
  for (const [animName, anim] of playerAnims) {
    if (animName.includes('idle') || animName.includes('stand')) {
      idleAnim = anim;
      break;
    }
  }
  
  // Stop other animations (but keep idle ready)
  playerAnims.forEach((anim) => {
    if (anim !== hitAnim && anim !== currentAnim && anim !== idleAnim) {
      anim.setWeightForAllAnimatables(0.0);
      anim.stop();
    }
  });
  
  // Stop current animation immediately (hit takes priority)
  if (currentAnim && currentAnim !== hitAnim && currentAnim !== idleAnim) {
    currentAnim.setWeightForAllAnimatables(0.0);
    currentAnim.stop();
  }
  
  // Prepare idle for transition (keep it playing but at 0 weight)
  if (idleAnim) {
    idleAnim.setWeightForAllAnimatables(0.0);
    idleAnim.play(true);
  }
  
  // Start hit animation at 100% weight
  hitAnim.setWeightForAllAnimatables(1.0);
  hitAnim.play(false); // Don't loop
  
  // Store hit animation state
  if (!scene.metadata.playerHitAnimations) {
    scene.metadata.playerHitAnimations = new Map();
  }
  scene.metadata.playerHitAnimations.set(userId, {
    animation: hitAnim,
    startTime: Date.now()
  });
  
  try {
    // Wait for hit animation to complete using onAnimationGroupEndObservable
    const animationEnded = new Promise((resolve) => {
      const observer = hitAnim.onAnimationGroupEndObservable.add(() => {
        hitAnim.onAnimationGroupEndObservable.remove(observer);
        resolve();
      });
    });
    
    await animationEnded;
    
    // Hit animation has completed, now transition to idle
    const hitState = scene.metadata.playerHitAnimations?.get(userId);
    if (hitState && hitState.animation === hitAnim) {
      scene.metadata.playerHitAnimations.delete(userId);
      
      // Transition to idle using blend timing
      const blendOutMs = 200; // Default blend time for hit
      if (idleAnim) {
        // Ensure hit is still at 100% before blending
        hitAnim.setWeightForAllAnimatables(1.0);
        // Smoothly blend from hit to idle
        blendAnimations(hitAnim, idleAnim, blendOutMs, scene, () => {
          hitAnim.setWeightForAllAnimatables(0.0);
          hitAnim.stop();
        });
      } else {
        // Fallback: just stop the hit animation
        hitAnim.setWeightForAllAnimatables(0.0);
        hitAnim.stop();
      }
    }
  } catch (error) {
    console.error(`Error playing hit animation for player ${userId}:`, error);
    // Cleanup on error
    const hitState = scene.metadata.playerHitAnimations?.get(userId);
    if (hitState && hitState.animation === hitAnim) {
      scene.metadata.playerHitAnimations.delete(userId);
      hitAnim.setWeightForAllAnimatables(0.0);
      hitAnim.stop();
      
      // Return to idle
      if (idleAnim) {
        idleAnim.setWeightForAllAnimatables(1.0);
        idleAnim.play(true);
      }
    }
  }
}

/**
 * Wait for a player's teleport to complete, then play hit animation
 * Polls for teleport completion with a timeout
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @param {AnimationGroup} hitAnim - The hit animation to play
 */
const TELEPORT_WAIT_POLL_MS = 50;
const TELEPORT_WAIT_MAX_MS = 2000; // Max 2 seconds wait

function waitForTeleportAndPlayHit(scene, userId, hitAnim) {
  const startTime = Date.now();
  
  const pollForCompletion = () => {
    const elapsed = Date.now() - startTime;
    const teleportController = activeTeleports?.get(userId);
    
    // Check if teleport is complete (idle/cleaning state or no longer in map)
    const teleportComplete = !teleportController || 
                            teleportController.state === 'idle' || 
                            teleportController.state === 'cleaning';
    
    if (teleportComplete) {
      console.log(`[HitAnim] Teleport complete for ${userId} after ${elapsed}ms, playing hit animation`);
      // Small additional delay to ensure character is fully visible
      setTimeout(() => {
        playHitAnimationDirect(scene, userId, hitAnim);
      }, 200);
      return;
    }
    
    // Check for timeout
    if (elapsed >= TELEPORT_WAIT_MAX_MS) {
      console.log(`[HitAnim] Timeout waiting for teleport (${userId}), playing hit animation anyway`);
      playHitAnimationDirect(scene, userId, hitAnim);
      return;
    }
    
    // Continue polling
    setTimeout(pollForCompletion, TELEPORT_WAIT_POLL_MS);
  };
  
  pollForCompletion();
}

/**
 * Play hit animation directly (internal function, skips teleport check)
 * @param {Scene} scene - Babylon.js scene  
 * @param {string} userId - Player's user ID
 * @param {AnimationGroup} hitAnim - The hit animation to play
 */
function playHitAnimationDirect(scene, userId, hitAnim) {
  if (!scene.metadata || !scene.metadata.playerAnimationGroups) {
    return;
  }
  
  const playerAnims = scene.metadata.playerAnimationGroups.get(userId);
  if (!playerAnims || !(playerAnims instanceof Map)) {
    return;
  }
  
  // Find idle animation for transition after hit
  let idleAnim = null;
  for (const [animName, anim] of playerAnims) {
    if (animName.includes('idle') || animName.includes('stand')) {
      idleAnim = anim;
      break;
    }
  }
  
  // Stop other animations
  playerAnims.forEach((anim) => {
    if (anim !== hitAnim && anim !== idleAnim) {
      anim.setWeightForAllAnimatables(0.0);
      anim.stop();
    }
  });
  
  // Prepare idle for transition
  if (idleAnim) {
    idleAnim.setWeightForAllAnimatables(0.0);
    idleAnim.play(true);
  }
  
  // Start hit animation
  hitAnim.setWeightForAllAnimatables(1.0);
  hitAnim.play(false);
  
  console.log(`[HitAnim] Playing hit animation for ${userId}`);
  
  // Store hit animation state
  if (!scene.metadata.playerHitAnimations) {
    scene.metadata.playerHitAnimations = new Map();
  }
  scene.metadata.playerHitAnimations.set(userId, {
    animation: hitAnim,
    startTime: Date.now()
  });
  
  // Handle animation completion
  const observer = hitAnim.onAnimationGroupEndObservable.add(() => {
    hitAnim.onAnimationGroupEndObservable.remove(observer);
    
    const hitState = scene.metadata.playerHitAnimations?.get(userId);
    if (hitState && hitState.animation === hitAnim) {
      scene.metadata.playerHitAnimations.delete(userId);
      
      // Blend to idle
      if (idleAnim) {
        blendAnimations(hitAnim, idleAnim, 200, scene, () => {
          hitAnim.setWeightForAllAnimatables(0.0);
          hitAnim.stop();
        });
      } else {
        hitAnim.setWeightForAllAnimatables(0.0);
        hitAnim.stop();
      }
    }
  });
}

/**
 * Update movement animations in the render loop
 * @param {Scene} scene - Babylon.js scene
 */
export function updateMovementAnimations(scene) {
  if (!scene.metadata || !scene.metadata.playerMovementAnimations) {
    return;
  }
  
  const playerMovementAnimations = scene.metadata.playerMovementAnimations;
  const currentTime = Date.now();
  
  playerMovementAnimations.forEach((animState, userId) => {
    if (!animState.isAnimating) {
      return;
    }
    
    const elapsed = (currentTime - animState.startTime) / 1000; // Convert to seconds
    const totalDuration = animState.path.length * animState.timePerTile;
    const baseTransitionDuration = animState.animationType === 'walk' ? 0.2 : 0.1; // seconds for transition
    const transitionLead = animState.animationType === 'walk' ? 0.18 : 0.12; // start blending earlier
    const transitionDuration = Math.min(baseTransitionDuration, totalDuration);
    
    // Start transition to idle animation before movement completes
    const transitionStartAt = Math.max(0, totalDuration - transitionDuration - transitionLead);
    if (!animState.isTransitioning && elapsed >= transitionStartAt) {
      animState.isTransitioning = true;
      animState.transitionStartTime = currentTime;
      
      // Start blending from movement to idle
      if (animState.movementAnim && animState.idleAnim) {
        const easeOutDuration = transitionDuration;
        
        // Ease-out function for smooth transition
        const easeOut = (t) => {
          return 1 - Math.pow(1 - t, 3); // Cubic ease-out
        };
        
        const startWeight = 1.0;
        const endWeight = 0.0;
        
        const observer = scene.onBeforeRenderObservable.add(() => {
          const transitionElapsed = (Date.now() - animState.transitionStartTime) / 1000;
          const progress = Math.min(transitionElapsed / easeOutDuration, 1.0);
          const easedProgress = easeOut(progress);
          
          const movementWeight = startWeight * (1 - easedProgress);
          const idleWeight = endWeight + (1.0 - endWeight) * easedProgress;
          
          animState.movementAnim.setWeightForAllAnimatables(movementWeight);
          animState.idleAnim.setWeightForAllAnimatables(idleWeight);
          
          if (progress >= 1.0) {
            scene.onBeforeRenderObservable.remove(observer);
            animState.movementAnim.setWeightForAllAnimatables(0.0);
            animState.idleAnim.setWeightForAllAnimatables(1.0);
          }
        });
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
          
          // Call onComplete callback with final rotation for orientation sync
          if (animState.onComplete && animState.characterMesh) {
            const finalRotation = animState.characterMesh.rotation?.y ?? 0;
            animState.onComplete(userId, finalRotation);
          }
          
          // Execute any pending trap triggers for this player
          executePendingTrapTriggers(scene, userId);
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
        
        // Call onComplete callback with final rotation for orientation sync
        if (animState.onComplete && animState.characterMesh) {
          const finalRotation = animState.characterMesh.rotation?.y ?? 0;
          animState.onComplete(userId, finalRotation);
        }
        
        // Execute any pending trap triggers for this player
        executePendingTrapTriggers(scene, userId);
      }
      
      // Keep the final rotation from the last movement step
      // Don't change rotation - it should stay as it was during movement
      
      return;
    }
    
    // Calculate current step in path
    const currentStep = Math.floor(elapsed / animState.timePerTile);
    const stepProgress = (elapsed % animState.timePerTile) / animState.timePerTile;
    
    if (currentStep < animState.path.length - 1) {
      const currentPos = animState.path[currentStep];
      const nextPos = animState.path[currentStep + 1];
      
      // Interpolate position between current and next step
      const x = currentPos.x + (nextPos.x - currentPos.x) * stepProgress;
      const y = currentPos.y + (nextPos.y - currentPos.y) * stepProgress;
      
      // Update character position
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
  });
}

// ============================================================================
// PENDING TRAP TRIGGER SYSTEM
// Queues trap triggers to execute after movement animation completes
// ============================================================================

/**
 * Check if a player is currently animating movement
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @returns {boolean} True if player has active movement animation
 */
export function isPlayerMoving(scene, userId) {
  if (!scene.metadata || !scene.metadata.playerMovementAnimations) {
    return false;
  }
  
  const animState = scene.metadata.playerMovementAnimations.get(userId);
  return animState && animState.isAnimating;
}

/**
 * Check if a player has a pending movement path that hasn't started animating yet
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @returns {boolean} True if player has pending movement path
 */
export function hasPendingMovement(scene, userId) {
  if (!scene.metadata || !scene.metadata.pendingMovementPaths) {
    return false;
  }
  
  const pending = scene.metadata.pendingMovementPaths.get(userId);
  return pending && pending.path && pending.path.length > 0;
}

/**
 * Check if a player is either moving or about to move
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @returns {boolean} True if player is moving or has pending movement
 */
export function isPlayerMovingOrPending(scene, userId) {
  return isPlayerMoving(scene, userId) || hasPendingMovement(scene, userId);
}

/**
 * Queue a trap trigger to execute when player's movement animation completes
 * 
 * This handles the timing issue where the trap message may arrive before the
 * movement animation starts on the client (especially for remote players).
 * We poll briefly to wait for the animation to start, then queue the callback.
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID (the one who triggered the trap)
 * @param {Function} callback - Function to call when movement completes
 */
export function queueTrapTrigger(scene, userId, callback) {
  // Initialize pending trap triggers storage if needed
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata.pendingTrapTriggers) {
    scene.metadata.pendingTrapTriggers = new Map(); // userId -> Array of callbacks
  }
  
  // Check if player is currently moving OR has pending movement about to start
  if (isPlayerMovingOrPending(scene, userId)) {
    // Queue the callback
    const pending = scene.metadata.pendingTrapTriggers.get(userId) || [];
    pending.push(callback);
    scene.metadata.pendingTrapTriggers.set(userId, pending);
    console.log(`[TrapTrigger] Queued trap trigger for ${userId} (waiting for movement to complete)`);
  } else {
    // Player isn't moving yet - this can happen if the trap message arrives
    // before the movement animation starts (common for remote players)
    // Poll briefly to see if movement starts
    console.log(`[TrapTrigger] Player ${userId} not moving yet, waiting for animation to start...`);
    waitForMovementAndQueue(scene, userId, callback, 0);
  }
}

/**
 * Poll to wait for movement animation to start, then queue the callback
 * Times out after a short period and executes immediately if no movement starts
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 * @param {Function} callback - Callback to execute
 * @param {number} attempts - Current number of poll attempts
 */
const MAX_WAIT_ATTEMPTS = 20; // ~500ms max wait (20 * 25ms)
const POLL_INTERVAL_MS = 25;

function waitForMovementAndQueue(scene, userId, callback, attempts) {
  // Check if movement has started
  if (isPlayerMovingOrPending(scene, userId)) {
    // Movement started - queue the callback
    const pending = scene.metadata.pendingTrapTriggers.get(userId) || [];
    pending.push(callback);
    scene.metadata.pendingTrapTriggers.set(userId, pending);
    console.log(`[TrapTrigger] Movement detected for ${userId} after ${attempts} polls, queued trap trigger`);
    return;
  }
  
  // Check if we've exceeded max attempts
  if (attempts >= MAX_WAIT_ATTEMPTS) {
    // Timeout - execute immediately (animation may have already completed or never started)
    console.log(`[TrapTrigger] Timeout waiting for ${userId} movement, executing immediately`);
    callback();
    return;
  }
  
  // Schedule another poll
  setTimeout(() => {
    waitForMovementAndQueue(scene, userId, callback, attempts + 1);
  }, POLL_INTERVAL_MS);
}

/**
 * Execute all pending trap triggers for a player
 * Called when a player's movement animation completes
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Player's user ID
 */
export function executePendingTrapTriggers(scene, userId) {
  if (!scene.metadata || !scene.metadata.pendingTrapTriggers) {
    return;
  }
  
  const pending = scene.metadata.pendingTrapTriggers.get(userId);
  if (!pending || pending.length === 0) {
    return;
  }
  
  console.log(`[TrapTrigger] Executing ${pending.length} pending trap trigger(s) for ${userId}`);
  
  // Execute all pending callbacks
  pending.forEach(callback => {
    try {
      callback();
    } catch (error) {
      console.error(`[TrapTrigger] Error executing pending trap trigger:`, error);
    }
  });
  
  // Clear pending triggers for this player
  scene.metadata.pendingTrapTriggers.delete(userId);
}
