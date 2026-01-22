/**
 * Animation system for Babylon.js scene
 * Handles all character animations: movement, stance, cast, hit
 */

import { AnimationGroup, TransformNode } from '@babylonjs/core';

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
export function startMovementAnimation(scene, userId, characterMesh, path, animationType, tileSize) {
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
  
  // Start cast animation at 100% weight - ensure it's the ONLY animation playing
  castAnim.setWeightForAllAnimatables(1.0);
  castAnim.play(false); // Don't loop
  
  // Store cast animation state to prevent interruption
  if (!scene.metadata.playerCastAnimations) {
    scene.metadata.playerCastAnimations = new Map();
  }
  scene.metadata.playerCastAnimations.set(userId, {
    animation: castAnim,
    startTime: Date.now()
  });
  
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
    const transitionDuration = animState.animationType === 'walk' ? 0.2 : 0.1; // seconds for transition
    
    // Start transition to idle animation before movement completes
    if (!animState.isTransitioning && elapsed >= totalDuration - transitionDuration) {
      animState.isTransitioning = true;
      animState.transitionStartTime = currentTime;
      
      // Start blending from movement to idle
      if (animState.movementAnim && animState.idleAnim) {
        const transitionStartOffset = animState.animationType === 'walk' ? 200 : 100; // ms before end
        const easeOutDuration = transitionStartOffset / 1000; // Convert to seconds
        
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
