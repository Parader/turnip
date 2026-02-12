/**
 * Visual Effects (VFX) system for Babylon.js spells
 * Handles rendering of spell projectiles, impacts, and ground effects
 */

import { MeshBuilder, StandardMaterial, Color3, Color4, Vector3, Animation, AnimationGroup, ParticleSystem, Texture, DynamicTexture, Material, SceneLoader, QuadraticEase, EasingFunction, TransformNode } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

// Import trap caching system for fast instantiation
import { createTrapInstance } from '../babylonScene';

// Import audio system for impact sounds
import { playSpellSound } from '../../audio';
import { getBoneWorldPosition } from './babylonAnimations';

// ============================================================================
// SHARED TEXTURE & MATERIAL CACHE
// Prevents memory leaks by reusing textures and materials across VFX instances
// ============================================================================

// Cache key prefixes
const CACHE_PREFIX = '__vfx_cache__';

/**
 * Get or create a cached texture
 * @param {Scene} scene - Babylon.js scene
 * @param {string} key - Unique cache key
 * @param {Function} createFn - Function to create texture if not cached
 * @returns {Texture} Cached or newly created texture
 */
function getCachedTexture(scene, key, createFn) {
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata[CACHE_PREFIX + 'textures']) {
    scene.metadata[CACHE_PREFIX + 'textures'] = new Map();
  }
  
  const cache = scene.metadata[CACHE_PREFIX + 'textures'];
  
  if (cache.has(key)) {
    const cached = cache.get(key);
    // Check if texture is still valid (not disposed)
    if (cached && !cached.isDisposed) {
      return cached;
    }
  }
  
  // Create new texture and cache it
  const texture = createFn();
  cache.set(key, texture);
  return texture;
}

/**
 * Get or create a cached material
 * @param {Scene} scene - Babylon.js scene
 * @param {string} key - Unique cache key
 * @param {Function} createFn - Function to create material if not cached
 * @returns {Material} Cached or newly created material
 */
function getCachedMaterial(scene, key, createFn) {
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (!scene.metadata[CACHE_PREFIX + 'materials']) {
    scene.metadata[CACHE_PREFIX + 'materials'] = new Map();
  }
  
  const cache = scene.metadata[CACHE_PREFIX + 'materials'];
  
  if (cache.has(key)) {
    const cached = cache.get(key);
    // Check if material is still valid (not disposed)
    if (cached && !cached.isDisposed) {
      return cached;
    }
  }
  
  // Create new material and cache it
  const material = createFn();
  cache.set(key, material);
  return material;
}

/**
 * Dispose all cached VFX resources
 * Call this when scene is being disposed
 * @param {Scene} scene - Babylon.js scene
 */
export function disposeVfxCache(scene) {
  if (!scene.metadata) return;
  
  // Dispose cached textures
  const textureCache = scene.metadata[CACHE_PREFIX + 'textures'];
  if (textureCache) {
    textureCache.forEach((texture, key) => {
      if (texture && !texture.isDisposed) {
        texture.dispose();
      }
    });
    textureCache.clear();
  }
  
  // Dispose cached materials
  const materialCache = scene.metadata[CACHE_PREFIX + 'materials'];
  if (materialCache) {
    materialCache.forEach((material, key) => {
      if (material && !material.isDisposed) {
        material.dispose();
      }
    });
    materialCache.clear();
  }
  
  // Dispose cached models (fireball, shard)
  if (scene.metadata.fireballModel) {
    if (!scene.metadata.fireballModel.isDisposed) {
      scene.metadata.fireballModel.dispose();
    }
    scene.metadata.fireballModel = null;
  }
  if (scene.metadata.fireballAnimationGroups) {
    scene.metadata.fireballAnimationGroups.forEach(ag => {
      if (ag && !ag.isDisposed) {
        ag.dispose();
      }
    });
    scene.metadata.fireballAnimationGroups = null;
  }
  if (scene.metadata.arcaneShardModel) {
    if (!scene.metadata.arcaneShardModel.isDisposed) {
      scene.metadata.arcaneShardModel.dispose();
    }
    scene.metadata.arcaneShardModel = null;
  }
  
  // Dispose cached trap particle texture
  const trapParticleTexture = scene.metadata[CACHE_PREFIX + 'trapParticleTexture'];
  if (trapParticleTexture && !trapParticleTexture.isDisposed) {
    trapParticleTexture.dispose();
  }
  scene.metadata[CACHE_PREFIX + 'trapParticleTexture'] = null;
  
  console.log('[VFX] Cache disposed');
}

// ============================================================================
// VFX MESH CREATION
// ============================================================================

/**
 * Create a VFX mesh based on VFX definition
 * @param {Object} vfxDef - VFX definition from spell
 * @param {Scene} scene - Babylon.js scene
 * @param {string} name - Name for the mesh
 * @returns {Mesh} Created mesh
 */
function createVfxMesh(vfxDef, scene, name) {
  let mesh = null;
  
  switch (vfxDef.type) {
    case 'SPHERE':
      mesh = MeshBuilder.CreateSphere(name, {
        diameter: vfxDef.size || 0.3,
        segments: 16
      }, scene);
      break;
    case 'CUBE':
      mesh = MeshBuilder.CreateBox(name, {
        size: vfxDef.size || 0.3
      }, scene);
      break;
    case 'CYLINDER':
      mesh = MeshBuilder.CreateCylinder(name, {
        diameter: vfxDef.size || 0.3,
        height: vfxDef.size || 0.3,
        tessellation: 16
      }, scene);
      break;
    default:
      console.warn(`Unknown VFX type: ${vfxDef.type}, defaulting to sphere`);
      mesh = MeshBuilder.CreateSphere(name, {
        diameter: vfxDef.size || 0.3,
        segments: 16
      }, scene);
  }
  
  // Create material
  const material = new StandardMaterial(`${name}_material`, scene);
  if (vfxDef.color) {
    material.diffuseColor = new Color3(vfxDef.color.r, vfxDef.color.g, vfxDef.color.b);
    material.emissiveColor = new Color3(
      vfxDef.color.r * (vfxDef.emissiveIntensity || 1.0),
      vfxDef.color.g * (vfxDef.emissiveIntensity || 1.0),
      vfxDef.color.b * (vfxDef.emissiveIntensity || 1.0)
    );
  } else {
    material.diffuseColor = new Color3(1, 0.5, 0);
    material.emissiveColor = new Color3(1, 0.5, 0);
  }
  
  material.alpha = vfxDef.opacity !== undefined ? vfxDef.opacity : 1.0;
  material.specularColor = new Color3(0.5, 0.5, 0.5);
  
  mesh.material = material;
  mesh.isPickable = false; // VFX shouldn't be pickable
  
  // Set up animations if specified
  if (vfxDef.animated && vfxDef.animation) {
    const anims = [];
    
    // Rotation animation
    if (vfxDef.animation.rotationSpeed) {
      const rotationAnim = Animation.CreateAndStartAnimation(
        `${name}_rotation`,
        mesh,
        'rotation.y',
        30,
        120, // 4 seconds at 30fps
        0,
        2 * Math.PI * vfxDef.animation.rotationSpeed,
        Animation.ANIMATIONLOOPMODE_CYCLE
      );
      anims.push(rotationAnim);
    }
    
    // Scale pulse animation
    if (vfxDef.animation.scalePulse) {
      const pulseSpeed = vfxDef.animation.pulseSpeed || 1.0;
      
      // Create pulse animations (easing removed for compatibility)
      Animation.CreateAndStartAnimation(
        `${name}_pulse`,
        mesh,
        'scaling.x',
        30,
        120,
        0.8,
        1.2,
        Animation.ANIMATIONLOOPMODE_CYCLE
      );
      
      // Also animate Y and Z scaling
      Animation.CreateAndStartAnimation(
        `${name}_pulse_y`,
        mesh,
        'scaling.y',
        30,
        120,
        0.8,
        1.2,
        Animation.ANIMATIONLOOPMODE_CYCLE
      );
      
      Animation.CreateAndStartAnimation(
        `${name}_pulse_z`,
        mesh,
        'scaling.z',
        30,
        120,
        0.8,
        1.2,
        Animation.ANIMATIONLOOPMODE_CYCLE
      );
    }
  }
  
  return mesh;
}

/**
 * Create particle system around projectile
 * @param {Mesh} projectileMesh - Projectile mesh to attach particles to
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} particleConfig - Particle configuration (optional)
 * @returns {ParticleSystem} Created particle system
 */
/**
 * Create a simple particle texture (white circle that can be tinted)
 * NOTE: Particle textures are NOT cached because ParticleSystems dispose their textures.
 * Each particle system needs its own texture instance.
 */
function createParticleTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('particleTexture', size, scene, false);
  const context = texture.getContext();
  
  // Draw a white circle with soft edges
  const center = size / 2;
  const radius = size / 2 - 2;
  
  // Create gradient for soft edges
  const gradient = context.createRadialGradient(center, center, 0, center, center, radius);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
  
  texture.update();
  return texture;
}

/**
 * Create a star texture for sparkle particles
 * NOTE: Particle textures are NOT cached because ParticleSystems dispose their textures.
 */
function createStarTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('starTexture', size, scene, false);
  const context = texture.getContext();
  
  const center = size / 2;
  const outerRadius = size / 2 - 2;
  const innerRadius = outerRadius * 0.4;
  
  // Clear with transparency
  context.clearRect(0, 0, size, size);
  
  // Draw star shape
  context.fillStyle = 'rgba(255, 255, 255, 1.0)';
  context.beginPath();
  
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
    const x = center + Math.cos(angle) * outerRadius;
    const y = center + Math.sin(angle) * outerRadius;
    
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
    
    const innerAngle = angle + (2 * Math.PI / 5);
    const innerX = center + Math.cos(innerAngle) * innerRadius;
    const innerY = center + Math.sin(innerAngle) * innerRadius;
    context.lineTo(innerX, innerY);
  }
  
  context.closePath();
  context.fill();
  
  // Add soft glow
  const glowGradient = context.createRadialGradient(center, center, 0, center, center, outerRadius);
  glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
  glowGradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.3)');
  glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  
  context.fillStyle = glowGradient;
  context.beginPath();
  context.arc(center, center, outerRadius, 0, Math.PI * 2);
  context.fill();
  
  texture.update();
  return texture;
}

/**
 * Create a diamond texture for geometric particles
 * NOTE: Particle textures are NOT cached because ParticleSystems dispose their textures.
 */
export function createDiamondTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('diamondTexture', size, scene, false);
  const context = texture.getContext();
  
  const center = size / 2;
  const radius = size / 2 - 2;
  
  // Clear with transparency
  context.clearRect(0, 0, size, size);
  
  // Draw diamond shape (rotated square)
  context.fillStyle = 'rgba(255, 255, 255, 1.0)';
  context.beginPath();
  context.moveTo(center, center - radius); // Top
  context.lineTo(center + radius, center); // Right
  context.lineTo(center, center + radius); // Bottom
  context.lineTo(center - radius, center); // Left
  context.closePath();
  context.fill();
  
  // Add soft glow
  const glowGradient = context.createRadialGradient(center, center, 0, center, center, radius);
  glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  glowGradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.5)');
  glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  
  context.fillStyle = glowGradient;
  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fill();
  
  texture.update();
  return texture;
}

/**
 * Create a line-streak texture for linear particles
 * NOTE: Particle textures are NOT cached because ParticleSystems dispose their textures.
 */
export function createLineStreakTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('lineStreakTexture', size, scene, false);
  const context = texture.getContext();
  
  const center = size / 2;
  const length = size - 4;
  const width = 4;
  
  // Clear with transparency
  context.clearRect(0, 0, size, size);
  
  // Draw horizontal line streak
  context.fillStyle = 'rgba(255, 255, 255, 1.0)';
  context.fillRect(2, center - width / 2, length, width);
  
  // Add soft fade at edges
  const gradient = context.createLinearGradient(2, center, length, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  
  context.fillStyle = gradient;
  context.fillRect(2, center - width / 2, length, width);
  
  texture.update();
  return texture;
}

function createProjectileParticles(projectileMesh, scene, particleConfig = {}) {
  const particleSystem = new ParticleSystem('projectile_particles', 500, scene);
  
  // CRITICAL: Particles need a texture to be visible!
  // Create a simple white particle texture (will be tinted by particle colors)
  particleSystem.particleTexture = createParticleTexture(scene);
  
  // Emit from the projectile mesh
  particleSystem.emitter = projectileMesh;
  
  const trailing = particleConfig.trailing === true;
  if (trailing) {
    // Tighter emit box – less disperse, trail stays close to projectile
    particleSystem.minEmitBox = new Vector3(-0.06, -0.06, -0.06);
    particleSystem.maxEmitBox = new Vector3(0.06, 0.06, 0.06);
    // Direction mostly backward (opposite movement) – trail behind projectile; small lateral spread
    particleSystem.direction1 = new Vector3(-0.15, -0.15, 1);
    particleSystem.direction2 = new Vector3(0.15, 0.15, 0.7);
    particleSystem.minEmitPower = particleConfig.minEmitPower ?? 0.08;
    particleSystem.maxEmitPower = particleConfig.maxEmitPower ?? 0.2;
    particleSystem.gravity = new Vector3(0, 0.02, 0);
    particleSystem.minLifeTime = particleConfig.minLifeTime ?? 0.35;
    particleSystem.maxLifeTime = particleConfig.maxLifeTime ?? 0.7;
  } else {
    particleSystem.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
    particleSystem.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
    particleSystem.direction1 = new Vector3(-1, -1, -1);
    particleSystem.direction2 = new Vector3(1, 1, 1);
    particleSystem.minEmitPower = particleConfig.minEmitPower || 0.3;
    particleSystem.maxEmitPower = particleConfig.maxEmitPower || 1.0;
    particleSystem.gravity = new Vector3(0, 0.1, 0);
  }
  
  // Particle colors (fire colors: orange to yellow to red)
  particleSystem.color1 = new Color4(1.0, 0.5, 0.0, 1.0); // Orange
  particleSystem.color2 = new Color4(1.0, 0.8, 0.0, 1.0); // Yellow
  particleSystem.colorDead = new Color4(0.8, 0.2, 0.0, 0.0); // Fade to dark red
  
  particleSystem.minSize = particleConfig.minSize || 0.15;
  particleSystem.maxSize = particleConfig.maxSize || 0.3;
  
  if (!trailing) {
    particleSystem.minLifeTime = particleConfig.minLifeTime || 0.2;
    particleSystem.maxLifeTime = particleConfig.maxLifeTime || 0.5;
  }
  
  particleSystem.emitRate = particleConfig.emitRate || 150;
  particleSystem.updateSpeed = 0.02;
  
  // Blend mode for fire effect (additive blending)
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  
  // Target stop duration - keep emitting
  particleSystem.targetStopDuration = undefined;
  
  // Start the particle system
  particleSystem.start();
  
  return particleSystem;
}

/**
 * Calculate point on quadratic Bezier curve
 * @param {Vector3} p0 - Start point
 * @param {Vector3} p1 - Control point
 * @param {Vector3} p2 - End point
 * @param {number} t - Parameter (0 to 1)
 * @returns {Vector3} Point on curve
 */
function bezierPoint(p0, p1, p2, t) {
  const oneMinusT = 1 - t;
  const t2 = t * t;
  const oneMinusT2 = oneMinusT * oneMinusT;
  
  return new Vector3(
    oneMinusT2 * p0.x + 2 * oneMinusT * t * p1.x + t2 * p2.x,
    oneMinusT2 * p0.y + 2 * oneMinusT * t * p1.y + t2 * p2.y,
    oneMinusT2 * p0.z + 2 * oneMinusT * t * p1.z + t2 * p2.z
  );
}

/**
 * Calculate approximate arc length of Bezier curve for distance-based animation
 * @param {Vector3} p0 - Start point
 * @param {Vector3} p1 - Control point
 * @param {Vector3} p2 - End point
 * @param {number} samples - Number of samples for approximation
 * @returns {number} Approximate arc length
 */
function bezierArcLength(p0, p1, p2, samples = 20) {
  let length = 0;
  let prevPoint = p0.clone();
  
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const currentPoint = bezierPoint(p0, p1, p2, t);
    length += Vector3.Distance(prevPoint, currentPoint);
    prevPoint = currentPoint;
  }
  
  return length;
}

/**
 * Animate projectile along a smooth curved path (Bezier curve)
 * @param {Mesh} projectileMesh - Projectile mesh
 * @param {Vector3} startPos - Start position
 * @param {Vector3} endPos - End position
 * @param {number} speedCellsPerSec - Speed in cells per second
 * @param {Scene} scene - Babylon.js scene
 * @param {Function} onComplete - Callback when projectile reaches destination
 * @param {ParticleSystem} particleSystem - Optional particle system to dispose
 * @param {number} curvePattern - Curve pattern: -1 (left), 0 (center/minimal), 1 (right)
 * @param {number} speedMultiplier - Speed multiplier for staggering (default: 1.0)
 */
function animateProjectileCurved(projectileMesh, startPos, endPos, speedCellsPerSec, scene, onComplete, particleSystem = null, curvePattern = 0, speedMultiplier = 1.0) {
  // Calculate control point for smooth lateral (side-to-side) arc
  // Position it at the midpoint, offset laterally to create a horizontal steering arc
  const midpoint = Vector3.Center(startPos, endPos);
  const distance = Vector3.Distance(startPos, endPos);
  
  // Calculate direction vector from start to end
  const direction = endPos.subtract(startPos).normalize();
  
  // Calculate perpendicular vector for lateral offset
  // Use cross product with up vector (0, 1, 0) to get a horizontal perpendicular
  const up = new Vector3(0, 1, 0);
  let lateralDir = Vector3.Cross(direction, up);
  
  // If cross product is too small (direction is nearly vertical), use alternative
  if (lateralDir.length() < 0.1) {
    // Use X-axis as fallback for vertical paths
    lateralDir = new Vector3(1, 0, 0);
  } else {
    lateralDir.normalize();
  }
  
  // Determine arc offset based on curve pattern for fan-out effect:
  // -1: left curve (negative offset, fans left)
  //  0: center/minimal curve (very small offset, stays near center)
  //  1: right curve (positive offset, fans right)
  let arcOffset = 0;
  if (curvePattern === -1) {
    // Left curve - pronounced fan-out to the left
    arcOffset = distance * -0.28; // Stronger negative offset for left fan
  } else if (curvePattern === 1) {
    // Right curve - pronounced fan-out to the right
    arcOffset = distance * 0.28; // Stronger positive offset for right fan
  } else {
    // Center - minimal curve, stays near centerline
    arcOffset = distance * 0.0; // No offset for center missile
  }
  
  // Position control point closer to start (1/3 of the way) for earlier divergence
  // This creates immediate fan-out rather than mid-journey bending
  const controlPointDistance = distance * 0.33; // Control point at 1/3 of distance
  const controlPointBase = startPos.clone().add(direction.scale(controlPointDistance));
  
  // Offset control point laterally (side-to-side) for fan-out
  const controlPoint = controlPointBase.clone();
  controlPoint.addInPlace(lateralDir.scale(arcOffset)); // Lateral offset for horizontal fan
  
  // Ensure Y coordinate stays consistent (no vertical movement)
  controlPoint.y = startPos.y + (endPos.y - startPos.y) * 0.33; // Match Y at 1/3 point
  
  // Apply speed multiplier for subtle staggering
  const adjustedSpeed = speedCellsPerSec * speedMultiplier;
  
  // Calculate approximate arc length for distance-based animation
  const arcLength = bezierArcLength(startPos, controlPoint, endPos);
  const duration = arcLength / adjustedSpeed;
  
  
  const startTime = Date.now();
  const speed = adjustedSpeed;
  
  // Store observer reference for cleanup
  let observer = null;
  
  // Store animation state
  projectileMesh.metadata = {
    startPos: startPos.clone(),
    controlPoint: controlPoint.clone(),
    endPos: endPos.clone(),
    arcLength: arcLength,
    speed: speed,
    startTime: startTime,
    onComplete: onComplete,
    observer: null,
    particleSystem: particleSystem,
    lastPosition: startPos.clone(), // For orientation
    // Cleanup function to ensure observer is removed
    cleanup: () => {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      if (particleSystem && !particleSystem.isDisposed?.()) {
        particleSystem.dispose();
      }
    }
  };
  
  // Use scene's render loop to update position along curve
  observer = scene.onBeforeRenderObservable.add(() => {
    // Safety check: if mesh was disposed externally, clean up observer
    if (!projectileMesh || projectileMesh.isDisposed?.()) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      return;
    }
    
    if (!projectileMesh.metadata) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      return;
    }
    
    const elapsed = (Date.now() - projectileMesh.metadata.startTime) / 1000; // seconds
    const distanceTraveled = elapsed * projectileMesh.metadata.speed;
    const progress = Math.min(distanceTraveled / projectileMesh.metadata.arcLength, 1.0);
    
    // Map progress to curve parameter t using approximation
    // For smooth motion, we use t directly (uniform parameterization)
    // For distance-based, we'd need to solve for t given distance, but uniform is close enough
    const t = progress;
    
    // Calculate position on Bezier curve
    const newPos = bezierPoint(
      projectileMesh.metadata.startPos,
      projectileMesh.metadata.controlPoint,
      projectileMesh.metadata.endPos,
      t
    );
    
    // Calculate direction for orientation and orient shard along path
    const directionVec = newPos.subtract(projectileMesh.metadata.lastPosition);
    if (directionVec.length() > 0.001) {
      const normalizedDir = directionVec.clone().normalize();
      // Orient shard to face direction of travel
      // Calculate target point ahead in the direction of travel
      const targetPoint = newPos.clone().add(normalizedDir.scale(1.0));
      projectileMesh.lookAt(targetPoint);
    }
    projectileMesh.metadata.lastPosition = newPos.clone();
    
    // Store references locally to avoid issues if metadata is cleared
    const metadata = projectileMesh.metadata;
    if (!metadata) {
      scene.onBeforeRenderObservable.remove(observer);
      observer = null;
      return;
    }
    
    // Trigger impact slightly before arrival (at 95% of journey)
    if (!metadata.explosionTriggered && progress >= 0.95) {
      metadata.explosionTriggered = true;
      if (metadata.onComplete) {
        metadata.onComplete();
      }
    }
    
    if (progress >= 1.0) {
      // Reached destination - store endPos before any cleanup
      const finalPos = metadata.endPos.clone();
      const particleSys = metadata.particleSystem;
      const onCompleteCallback = metadata.onComplete;
      const wasTriggered = metadata.explosionTriggered;
      
      // Clear metadata first to prevent race conditions
      projectileMesh.metadata = null;
      
      // Set final position
      projectileMesh.position = finalPos;
      scene.onBeforeRenderObservable.remove(observer);
      observer = null;
      
      // Dispose particle system if it exists
      if (particleSys) {
        particleSys.dispose();
      }
      
      // Only call onComplete if explosion wasn't already triggered
      if (!wasTriggered && onCompleteCallback) {
        onCompleteCallback();
      }
    } else {
      // Update position along curve
      projectileMesh.position = newPos;
    }
  });
  
  // Store observer reference
  projectileMesh.metadata.observer = observer;
  
  // Ensure mesh is visible
  projectileMesh.isVisible = true;
  projectileMesh.setEnabled(true);
  
}

/**
 * Animate projectile from start to destination
 * @param {Mesh} projectileMesh - Projectile mesh
 * @param {Vector3} startPos - Start position
 * @param {Vector3} endPos - End position
 * @param {number} speedCellsPerSec - Speed in cells per second
 * @param {Scene} scene - Babylon.js scene
 * @param {Function} onComplete - Callback when projectile reaches destination
 * @param {ParticleSystem} particleSystem - Optional particle system to dispose
 * @param {{ orientToDestination?: boolean }} options - If true, mesh faces endPos each frame (like magic missile)
 */
function animateProjectile(projectileMesh, startPos, endPos, speedCellsPerSec, scene, onComplete, particleSystem = null, options = {}) {
  const distance = Vector3.Distance(startPos, endPos);
  const { orientToDestination = false } = options;
  
  const startTime = Date.now();
  const speed = speedCellsPerSec;
  
  // Store observer reference for cleanup
  let observer = null;
  
  projectileMesh.metadata = {
    startPos: startPos.clone(),
    endPos: endPos.clone(),
    speed: speed,
    startTime: startTime,
    onComplete: onComplete,
    observer: null,
    particleSystem: particleSystem,
    // Cleanup function to ensure observer is removed
    cleanup: () => {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      if (particleSystem && !particleSystem.isDisposed?.()) {
        particleSystem.dispose();
      }
    }
  };
  
  const startPosLocal = startPos.clone();
  const endPosLocal = endPos.clone();
  
  observer = scene.onBeforeRenderObservable.add(() => {
    // Safety check: if mesh was disposed externally, clean up observer
    if (!projectileMesh || projectileMesh.isDisposed?.()) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      return;
    }
    
    if (!projectileMesh.metadata) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
        observer = null;
      }
      return;
    }
    
    const elapsed = (Date.now() - projectileMesh.metadata.startTime) / 1000; // seconds
    const distanceTraveled = elapsed * projectileMesh.metadata.speed;
    const totalDistance = Vector3.Distance(startPosLocal, endPosLocal);
    const progress = distanceTraveled / totalDistance;
    
    // Trigger explosion slightly before arrival (at 95% of journey) for better sync
    if (!projectileMesh.metadata.explosionTriggered && progress >= 0.95) {
      projectileMesh.metadata.explosionTriggered = true;
      scene.onBeforeRenderObservable.remove(observer);
      observer = null;
      projectileMesh.isVisible = false;
      projectileMesh.setEnabled(false);
      if (projectileMesh.metadata.onComplete) {
        projectileMesh.metadata.onComplete();
      }
      projectileMesh.metadata = null;
      return;
    }
    
    if (distanceTraveled >= totalDistance) {
      // Reached destination - hide mesh before impact, then complete
      projectileMesh.position = endPosLocal.clone();
      scene.onBeforeRenderObservable.remove(observer);
      observer = null;
      projectileMesh.isVisible = false;
      projectileMesh.setEnabled(false);
      
      if (projectileMesh.metadata.particleSystem) {
        projectileMesh.metadata.particleSystem.dispose();
      }
      
      if (!projectileMesh.metadata.explosionTriggered && projectileMesh.metadata.onComplete) {
        projectileMesh.metadata.onComplete();
      }
      projectileMesh.metadata = null;
      return;
    } else {
      const t = distanceTraveled / totalDistance;
      const newPos = new Vector3(
        startPosLocal.x + (endPosLocal.x - startPosLocal.x) * t,
        startPosLocal.y + (endPosLocal.y - startPosLocal.y) * t,
        startPosLocal.z + (endPosLocal.z - startPosLocal.z) * t
      );
      projectileMesh.position = newPos;
      if (orientToDestination) {
        projectileMesh.lookAt(endPosLocal);
      }
    }
  });
  
  projectileMesh.metadata.observer = observer;
  projectileMesh.isVisible = true;
  projectileMesh.setEnabled(true);
}

/**
 * Create explosion particle system
 * @param {Vector3} position - Impact position
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} config - Explosion configuration
 * @returns {ParticleSystem} Created particle system
 */
function createExplosionParticles(position, scene, config = {}) {
  // Create a small invisible emitter mesh at the explosion position
  const emitterMesh = MeshBuilder.CreateSphere('explosion_emitter', { diameter: 0.1 }, scene);
  emitterMesh.position = position.clone();
  emitterMesh.isVisible = false;
  
  const particleSystem = new ParticleSystem('explosion_particles', 500, scene);
  
  // Use the same particle texture as fireball
  particleSystem.particleTexture = createParticleTexture(scene);
  
  // Emit from the position
  particleSystem.emitter = emitterMesh;
  particleSystem.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
  particleSystem.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
  
  // Particle colors (fire colors: orange to yellow to red)
  particleSystem.color1 = new Color4(1.0, 0.5, 0.0, 1.0); // Orange
  particleSystem.color2 = new Color4(1.0, 0.8, 0.0, 1.0); // Yellow
  particleSystem.colorDead = new Color4(0.8, 0.2, 0.0, 0.0); // Fade to dark red
  
  // Particle size - restored for explosion
  particleSystem.minSize = config.minSize || 0.15;
  particleSystem.maxSize = config.maxSize || 0.25;
  
  // Particle lifetime - shorter for explosion burst
  particleSystem.minLifeTime = config.minLifeTime || 0.3;
  particleSystem.maxLifeTime = config.maxLifeTime || 0.8;
  
  // Higher emission rate for burst effect
  particleSystem.emitRate = config.emitRate || 300;
  
  // Direction - reduced spread (less outward burst)
  particleSystem.direction1 = new Vector3(-1, -1, -1);
  particleSystem.direction2 = new Vector3(1, 1, 1);
  particleSystem.minEmitPower = config.minEmitPower || 1.0;
  particleSystem.maxEmitPower = config.maxEmitPower || 2.0;
  particleSystem.updateSpeed = 0.02;
  
  // Gravity (slight downward)
  particleSystem.gravity = new Vector3(0, -0.5, 0);
  
  // Blend mode for fire effect
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  
  // Burst duration - emit for a short time then stop
  const burstDuration = config.burstDuration || 0.2; // 200ms burst
  particleSystem.targetStopDuration = burstDuration;
  
  // Start the particle system
  particleSystem.start();
  
  // Clean up emitter and particle system after particles fade
  const cleanupTime = (particleSystem.maxLifeTime + burstDuration) * 1000;
  setTimeout(() => {
    particleSystem.dispose();
    emitterMesh.dispose();
  }, cleanupTime);
  
  return particleSystem;
}

/**
 * Create and animate explosion effect
 * @param {Object} impactVfxDef - Impact VFX definition
 * @param {Vector3} position - Impact position
 * @param {Scene} scene - Babylon.js scene
 * @param {string} name - Name for the effect
 */
function createExplosion(impactVfxDef, position, scene, name) {
  // Use particle system for explosion instead of mesh
  const explosionPos = position.clone();
  explosionPos.y += 0.3;
  const isFireball = name === 'fireball_impact';
  createExplosionParticles(explosionPos, scene, isFireball ? {
    minSize: 0.11,
    maxSize: 0.19,
    minLifeTime: 0.28,
    maxLifeTime: 0.7,
    emitRate: 230,
    minEmitPower: 0.75,
    maxEmitPower: 1.5,
    burstDuration: 0.18
  } : {
    minSize: 0.15,
    maxSize: 0.25,
    minLifeTime: 0.3,
    maxLifeTime: 0.8,
    emitRate: 300,
    minEmitPower: 1.0,
    maxEmitPower: 2.0,
    burstDuration: 0.2
  });
}

/**
 * Create ground effect (like burning fire)
 * @param {Object} groundEffectVfxDef - Ground effect VFX definition
 * @param {Vector3} position - Position on ground
 * @param {Scene} scene - Babylon.js scene
 * @param {string} name - Name for the effect
 * @returns {Mesh} Ground effect mesh
 */
function createGroundEffect(groundEffectVfxDef, position, scene, name) {
  const vfx = groundEffectVfxDef.vfx;
  const radius = groundEffectVfxDef.radius || 1.0;
  
  // Create ground effect mesh
  const groundMesh = createVfxMesh(vfx, scene, name);
  
  // Position on ground (Y = 0 or slightly above)
  groundMesh.position = new Vector3(position.x, 0.05, position.z);
  
  // Scale to cover radius
  groundMesh.scaling = new Vector3(radius, vfx.size || 0.1, radius);
  
  // If it's a cylinder, rotate it to lay flat
  if (vfx.type === 'CYLINDER') {
    groundMesh.rotation.x = Math.PI / 2; // Rotate 90 degrees to lay flat
  }
  
  // Handle fade out if specified
  if (groundEffectVfxDef.fadeOut && groundEffectVfxDef.duration) {
    const fadeStart = groundEffectVfxDef.duration - (groundEffectVfxDef.fadeOutDuration || 500);
    const fadeDuration = groundEffectVfxDef.fadeOutDuration || 500;
    
    setTimeout(() => {
      const fadeAnim = Animation.CreateAndStartAnimation(
        `${name}_fade`,
        groundMesh.material,
        'alpha',
        60,
        (fadeDuration / 1000) * 60,
        vfx.opacity !== undefined ? vfx.opacity : 1.0,
        0,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      setTimeout(() => {
        // MEMORY FIX: Dispose material before mesh to prevent leak
        if (groundMesh.material && !groundMesh.material.isDisposed) {
          groundMesh.material.dispose();
        }
        groundMesh.dispose();
      }, fadeDuration);
    }, fadeStart);
  } else if (groundEffectVfxDef.duration) {
    // Clean up after duration
    setTimeout(() => {
      // MEMORY FIX: Dispose material before mesh to prevent leak
      if (groundMesh.material && !groundMesh.material.isDisposed) {
        groundMesh.material.dispose();
      }
      groundMesh.dispose();
    }, groundEffectVfxDef.duration);
  }
  
  return groundMesh;
}

/**
 * Load fireball.glb once and cache in scene.metadata (fireballModel, fireballAnimationGroups).
 * Returns { template, animationGroups } for cloning projectiles.
 * @param {Scene} scene - Babylon.js scene
 * @returns {Promise<{ template: AbstractMesh, animationGroups: AnimationGroup[] }>}
 */
function getOrLoadFireballModel(scene) {
  if (scene.metadata && scene.metadata.fireballModel) {
    return Promise.resolve({
      template: scene.metadata.fireballModel,
      animationGroups: scene.metadata.fireballAnimationGroups || []
    });
  }
  const rootUrl = '/assets/';
  const filename = 'fireball.glb';
  return SceneLoader.ImportMeshAsync('', rootUrl, filename, scene).then((result) => {
    if (!result.meshes || result.meshes.length === 0) {
      throw new Error('Fireball GLB: no meshes in model');
    }
    let rootMesh = result.meshes[0];
    for (const mesh of result.meshes) {
      if (!mesh.parent) {
        rootMesh = mesh;
        break;
      }
    }
    rootMesh.name = 'fireball_model_template';
    rootMesh.setEnabled(false);
    rootMesh.isVisible = false;
    const animationGroups = result.animationGroups || [];
    if (!scene.metadata) {
      scene.metadata = {};
    }
    scene.metadata.fireballModel = rootMesh;
    scene.metadata.fireballAnimationGroups = animationGroups;
    return { template: rootMesh, animationGroups };
  });
}

/**
 * Dispose a mesh and all its descendants (for GLB clone cleanup).
 * Does not dispose materials so template model can be cloned again.
 * @param {AbstractMesh} mesh - Root mesh to dispose
 */
function disposeMeshAndChildren(mesh) {
  if (!mesh) return;
  const children = mesh.getChildMeshes ? mesh.getChildMeshes(false) : [];
  children.forEach((child) => disposeMeshAndChildren(child));
  if (!mesh.isDisposed) {
    mesh.dispose();
  }
}

/**
 * Play fireball VFX
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition with VFX
 * @param {Vector3} startPos - Start position (caster position)
 * @param {Vector3} endPos - End position (target position)
 * @param {number} castStartTime - Timestamp when cast animation started
 */
export function playFireballVfx(scene, spellDef, startPos, endPos, castStartTime, options = {}) {
  const presentation = spellDef.presentation;
  if (!presentation) {
    console.warn('Fireball VFX: No presentation data found in spell definition');
    return;
  }

  const { targetUserId, onImpact } = options;

  const projectileVfx = presentation.projectileVfx;
  const impactVfx = presentation.impactVfxDef;

  // If no VFX components, skip
  if (!projectileVfx && !impactVfx) {
    console.warn('Fireball VFX: No VFX components found (projectileVfx or impactVfxDef)');
    return;
  }
  
  // Playing fireball VFX
  
  // Calculate start delay - allow cast animation to play before projectile spawns
  const baseDelay = 550; // Wait for cast animation wind-up
  const projectileDelay = projectileVfx ? (projectileVfx.startDelayMs || 0) : 0;
  const startDelay = baseDelay + projectileDelay;
  const actualStartTime = castStartTime + startDelay;
  const now = Date.now();
  const delay = Math.max(0, actualStartTime - now);
  
  setTimeout(() => {
    if (projectileVfx) {
      // Validate start and end positions
      if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(startPos.z) ||
          isNaN(endPos.x) || isNaN(endPos.y) || isNaN(endPos.z)) {
        console.error('Invalid positions for fireball VFX:', { startPos, endPos });
        return;
      }
      
      const heightOffset = projectileVfx.heightOffset || 0.5;
      const projectileStart = startPos.clone();
      projectileStart.y = startPos.y + heightOffset + 0.1; // Slightly higher (hand height), a bit lower
      const projectileEnd = endPos.clone();
      projectileEnd.y = endPos.y + heightOffset;
      // Offset start to character's right and a bit forward (simulating from hand, further from body)
      const dir = endPos.subtract(startPos);
      if (dir.length() > 0.001) {
        const right = Vector3.Cross(dir, new Vector3(0, 1, 0)).normalize();
        projectileStart.addInPlace(right.scale(0.35));
        const forward = dir.clone().normalize();
        projectileStart.addInPlace(forward.scale(0.6)); // Start further from character
      }
      
      // Use fireball.glb model; fallback to sphere if load fails
      getOrLoadFireballModel(scene).then(({ template, animationGroups }) => {
        const uniqueId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const uniqueName = `fireball_projectile_${uniqueId}`;
        const projectileMesh = template.clone(uniqueName, null, false);
        if (!projectileMesh) {
          runFireballFallback();
          return;
        }
        projectileMesh.setEnabled(true);
        projectileMesh.isVisible = true;
        projectileMesh.parent = null;
        projectileMesh.position = projectileStart.clone();
        projectileMesh.computeWorldMatrix(true);
        
        // Clone and play fireball.glb animations, retargeted to this projectile clone
        const clonedAnimGroups = [];
        if (animationGroups && animationGroups.length > 0) {
          const templateDescendants = template.getDescendants ? template.getDescendants() : [template, ...(template.getChildMeshes ? template.getChildMeshes(true) : [])];
          const cloneDescendants = projectileMesh.getDescendants ? projectileMesh.getDescendants() : [projectileMesh, ...(projectileMesh.getChildMeshes ? projectileMesh.getChildMeshes(true) : [])];
          const targetMap = new Map();
          targetMap.set(template, projectileMesh);
          templateDescendants.forEach((tNode, i) => {
            if (cloneDescendants[i]) targetMap.set(tNode, cloneDescendants[i]);
          });
          animationGroups.forEach((ag, idx) => {
            if (!ag || ag.isDisposed) return;
            const cloneName = `fireball_anim_${uniqueId}_${idx}`;
            try {
              const cloned = ag.clone(cloneName, (oldTarget) => {
                const newTarget = targetMap.get(oldTarget);
                if (newTarget) return newTarget;
                if (oldTarget === template) return projectileMesh;
                const found = cloneDescendants.find(d => d.name === oldTarget.name);
                return found || projectileMesh;
              }, true);
              if (cloned) {
                cloned.play(true);
                clonedAnimGroups.push(cloned);
              }
            } catch (e) {
              console.warn('[Fireball] Animation group clone/play failed:', e);
            }
          });
        }
        projectileMesh.metadata = projectileMesh.metadata || {};
        projectileMesh.metadata.fireballAnimationGroups = clonedAnimGroups;
        
        const particleSystem = createProjectileParticles(projectileMesh, scene, {
          trailing: true,
          minSize: 0.075,
          maxSize: 0.15,
          emitRate: 150
        });
        
        animateProjectile(
          projectileMesh,
          projectileStart,
          projectileEnd,
          projectileVfx.speedCellsPerSec * 1.5,
          scene,
          () => {
            if (particleSystem) {
              particleSystem.dispose();
            }
            if (projectileMesh.metadata && projectileMesh.metadata.fireballAnimationGroups) {
              projectileMesh.metadata.fireballAnimationGroups.forEach(ag => {
                if (ag && !ag.isDisposed) {
                  ag.stop();
                  ag.dispose();
                }
              });
            }
            disposeMeshAndChildren(projectileMesh);
            if (impactVfx) {
              const impactDelay = impactVfx.delayMs || 0;
              setTimeout(() => {
                createExplosion(impactVfx, endPos, scene, 'fireball_impact');
                // Play impact sound at target position
                playSpellSound('fireball', 'impact', {
                  position: endPos,
                  eventId: `fireball_impact_${Date.now()}`
                });
                // Hit animation in sync with impact (avoids delay from server spellHit)
                if (targetUserId && typeof onImpact === 'function') {
                  onImpact(targetUserId);
                }
              }, impactDelay);
            }
          },
          particleSystem,
          { orientToDestination: true }
        );
      }).catch(() => {
        runFireballFallback();
      });
      
      function runFireballFallback() {
        const modifiedVfx = { ...projectileVfx.vfx, opacity: 0.05 };
        const projectileMesh = createVfxMesh(modifiedVfx, scene, 'fireball_projectile');
        if (projectileMesh.material) {
          projectileMesh.material.alpha = 0.05;
          projectileMesh.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
          projectileMesh.material.backFaceCulling = false;
          projectileMesh.material.disableDepthWrite = true;
        }
        projectileMesh.position = projectileStart.clone();
        projectileMesh.isVisible = true;
        projectileMesh.setEnabled(true);
        projectileMesh.parent = null;
        projectileMesh.computeWorldMatrix(true);
        
        const particleSystem = createProjectileParticles(projectileMesh, scene, {
          trailing: true,
          minSize: 0.075,
          maxSize: 0.15,
          emitRate: 150
        });
        
        animateProjectile(
          projectileMesh,
          projectileStart,
          projectileEnd,
          projectileVfx.speedCellsPerSec * 1.5,
          scene,
          () => {
            if (particleSystem) {
              particleSystem.dispose();
            }
            // MEMORY FIX: Dispose material before mesh to prevent leak
            if (projectileMesh.material && !projectileMesh.material.isDisposed) {
              projectileMesh.material.dispose();
            }
            projectileMesh.dispose();
            if (impactVfx) {
              const impactDelay = impactVfx.delayMs || 0;
              setTimeout(() => {
                createExplosion(impactVfx, endPos, scene, 'fireball_impact');
                // Play impact sound at target position
                playSpellSound('fireball', 'impact', {
                  position: endPos,
                  eventId: `fireball_impact_fallback_${Date.now()}`
                });
                if (targetUserId && typeof onImpact === 'function') {
                  onImpact(targetUserId);
                }
              }, impactDelay);
            }
          },
          particleSystem
        );
      }
    } else {
      // No projectile, but we might have impact
      // Create impact (add 200ms delay for this spell)
      if (impactVfx) {
        const impactDelay = (impactVfx.delayMs || 0) + 200; // Add 200ms delay
        setTimeout(() => {
          createExplosion(impactVfx, endPos, scene, 'fireball_impact');
          // Play impact sound at target position
          playSpellSound('fireball', 'impact', {
            position: endPos,
            eventId: `fireball_impact_noproj_${Date.now()}`
          });
          if (targetUserId && typeof onImpact === 'function') {
            onImpact(targetUserId);
          }
        }, impactDelay);
      }
    }
  }, delay);
}

/**
 * Create heal particles that move upward from the ground
 * @param {Vector3} position - Position on ground
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} config - Particle configuration
 * @returns {ParticleSystem} Particle system
 */
function createHealParticles(position, scene, config = {}) {
  // Create invisible emitter at ground level
  const emitterMesh = MeshBuilder.CreateSphere('heal_emitter', { diameter: 0.1 }, scene);
  emitterMesh.position = position.clone();
  emitterMesh.position.y = 0.1; // Slightly above ground
  emitterMesh.isVisible = false;
  
  const particleSystem = new ParticleSystem('heal_particles', 150, scene);
  
  // Use the same particle texture as fireball
  particleSystem.particleTexture = createParticleTexture(scene);
  
  // Emit from the position
  particleSystem.emitter = emitterMesh;
  particleSystem.minEmitBox = new Vector3(-0.2, 0, -0.2);
  particleSystem.maxEmitBox = new Vector3(0.2, 0, 0.2);
  
  // Particle colors (green colors, more transparent)
  particleSystem.color1 = new Color4(0.3, 1.0, 0.4, 0.6); // Light green, 60% opacity
  particleSystem.color2 = new Color4(0.5, 1.0, 0.6, 0.8); // Brighter green, 80% opacity
  particleSystem.colorDead = new Color4(0.2, 0.8, 0.3, 0.0); // Fade to dark green
  
  // Particle size
  particleSystem.minSize = config.minSize || 0.1;
  particleSystem.maxSize = config.maxSize || 0.2;
  
  // Particle lifetime
  particleSystem.minLifeTime = config.minLifeTime || 0.8;
  particleSystem.maxLifeTime = config.maxLifeTime || 1.5;
  
  // Emission rate
  particleSystem.emitRate = config.emitRate || 50;
  
  // Direction - particles move upward
  particleSystem.direction1 = new Vector3(-0.3, 1.0, -0.3); // Upward and slightly outward
  particleSystem.direction2 = new Vector3(0.3, 1.5, 0.3); // More upward
  particleSystem.minEmitPower = config.minEmitPower || 0.5;
  particleSystem.maxEmitPower = config.maxEmitPower || 1.2;
  particleSystem.updateSpeed = 0.02;
  
  // Gravity (slight upward drift to keep particles floating)
  particleSystem.gravity = new Vector3(0, 0.2, 0);
  
  // Blend mode for soft glow effect
  particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  
  // Emit for a duration then stop
  const emitDuration = config.emitDuration || 1.0; // 1 second
  particleSystem.targetStopDuration = emitDuration;
  
  // Start the particle system
  particleSystem.start();
  
  // Clean up emitter and particle system after particles fade
  const cleanupTime = (particleSystem.maxLifeTime + emitDuration) * 1000;
  setTimeout(() => {
    particleSystem.dispose();
    emitterMesh.dispose();
  }, cleanupTime);
  
  return particleSystem;
}

/**
 * Create poison status particles emanating from a character (pooled, start/stop when effect applied/removed).
 * A few green particles drifting outward/up from the body; no targetStopDuration so caller controls start/stop.
 * @param {TransformNode|Mesh} emitterMesh - Character mesh to emit from
 * @param {Scene} scene - Babylon.js scene
 * @param {string} name - Unique name for the particle system
 * @returns {ParticleSystem} Particle system (call .start() / .stop(), do not dispose until effect removed for good)
 */
export function createPoisonStatusParticles(emitterMesh, scene, name = 'poison_status') {
  const particleSystem = new ParticleSystem(`${name}_particles`, 80, scene);
  particleSystem.particleTexture = createParticleTexture(scene);
  particleSystem.emitter = emitterMesh;
  // Emit from shoulder to above head (slight spread around body)
  particleSystem.minEmitBox = new Vector3(-0.25, 0.7, -0.25);
  particleSystem.maxEmitBox = new Vector3(0.25, 1.2, 0.25);
  // Green poison colors, semi-transparent
  particleSystem.color1 = new Color4(0.2, 0.9, 0.35, 0.7);
  particleSystem.color2 = new Color4(0.4, 1.0, 0.5, 0.5);
  particleSystem.colorDead = new Color4(0.1, 0.5, 0.2, 0);
  particleSystem.minSize = 0.06;
  particleSystem.maxSize = 0.12;
  particleSystem.minLifeTime = 0.6;
  particleSystem.maxLifeTime = 1.2;
  particleSystem.emitRate = 18;
  particleSystem.updateSpeed = 0.02;
  // Emanate outward and slightly up from body
  particleSystem.direction1 = new Vector3(-0.5, 0.3, -0.5);
  particleSystem.direction2 = new Vector3(0.5, 0.8, 0.5);
  particleSystem.minEmitPower = 0.08;
  particleSystem.maxEmitPower = 0.2;
  particleSystem.gravity = new Vector3(0, 0.05, 0);
  particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return particleSystem;
}

/**
 * Create slash impact VFX - red blood spray at impact point (simulates blood from sword).
 * Particles burst outward in slash direction and fall down.
 * @param {Vector3} position - Impact position (target)
 * @param {Scene} scene - Babylon.js scene
 * @param {Vector3} [slashDirection] - Direction of slash (from caster to target), normalized
 */
export function createSlashBloodImpact(position, scene, slashDirection = null) {
  if (!scene || scene.isDisposed) return null;
  const emitterMesh = MeshBuilder.CreateSphere('slash_blood_emitter', { diameter: 0.12 }, scene);
  const impactPos = position.clone();
  impactPos.y += 0.5; // At body height for visible impact
  emitterMesh.position = impactPos;
  emitterMesh.isVisible = false;

  const particleSystem = new ParticleSystem('slash_blood_particles', 200, scene);
  particleSystem.particleTexture = createParticleTexture(scene);
  particleSystem.emitter = emitterMesh;
  particleSystem.minEmitBox = new Vector3(-0.08, -0.08, -0.08);
  particleSystem.maxEmitBox = new Vector3(0.08, 0.08, 0.08);

  particleSystem.color1 = new Color4(0.95, 0.2, 0.2, 0.95);
  particleSystem.color2 = new Color4(0.8, 0.1, 0.1, 0.85);
  particleSystem.colorDead = new Color4(0.5, 0.05, 0.05, 0);
  particleSystem.minSize = 0.1;
  particleSystem.maxSize = 0.2;
  particleSystem.minLifeTime = 0.4;
  particleSystem.maxLifeTime = 0.9;
  particleSystem.emitRate = 220;
  particleSystem.minEmitPower = 0.5;
  particleSystem.maxEmitPower = 1.0;
  particleSystem.updateSpeed = 0.02;
  particleSystem.gravity = new Vector3(0, -0.35, 0);

  if (slashDirection && (slashDirection.x !== 0 || slashDirection.z !== 0)) {
    const dx = slashDirection.x;
    const dz = slashDirection.z;
    particleSystem.direction1 = new Vector3(dx - 0.5, -0.2, dz - 0.5);
    particleSystem.direction2 = new Vector3(dx + 0.5, 0.4, dz + 0.5);
  } else {
    particleSystem.direction1 = new Vector3(-0.7, -0.2, -0.7);
    particleSystem.direction2 = new Vector3(0.7, 0.4, 0.7);
  }
  particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  particleSystem.targetStopDuration = 0.28;
  particleSystem.start();

  const cleanupTime = 2000;
  setTimeout(() => {
    particleSystem.dispose();
    emitterMesh.dispose();
  }, cleanupTime);
  return particleSystem;
}

/**
 * Create slash wound bleed status particles - red droplets/drips going downward from character.
 * Similar to poison but red and gravity-driven downward.
 * @param {TransformNode|Mesh} emitterMesh - Character mesh to emit from
 * @param {Scene} scene - Babylon.js scene
 * @param {string} name - Unique name for the particle system
 * @returns {ParticleSystem} Particle system (call .start() / .stop(), do not dispose until effect removed)
 */
export function createSlashWoundStatusParticles(emitterMesh, scene, name = 'slash_wound_status') {
  const particleSystem = new ParticleSystem(`${name}_particles`, 60, scene);
  particleSystem.particleTexture = createParticleTexture(scene);
  particleSystem.emitter = emitterMesh;
  // Emit from torso/shoulders - bleed drips down
  particleSystem.minEmitBox = new Vector3(-0.3, 0.4, -0.3);
  particleSystem.maxEmitBox = new Vector3(0.3, 1.0, 0.3);
  // Red bleed colors, semi-transparent
  particleSystem.color1 = new Color4(0.9, 0.15, 0.15, 0.6);
  particleSystem.color2 = new Color4(0.7, 0.1, 0.1, 0.4);
  particleSystem.colorDead = new Color4(0.4, 0.05, 0.05, 0);
  particleSystem.minSize = 0.04;
  particleSystem.maxSize = 0.1;
  particleSystem.minLifeTime = 0.5;
  particleSystem.maxLifeTime = 1.0;
  particleSystem.emitRate = 12;
  particleSystem.updateSpeed = 0.02;
  // Direction downward with slight outward spread
  particleSystem.direction1 = new Vector3(-0.3, -0.9, -0.3);
  particleSystem.direction2 = new Vector3(0.3, -0.5, 0.3);
  particleSystem.minEmitPower = 0.05;
  particleSystem.maxEmitPower = 0.15;
  particleSystem.gravity = new Vector3(0, -0.15, 0); // Pull downward
  particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return particleSystem;
}

/**
 * Create expanding green sphere on the ground
 * @param {Vector3} position - Position on ground
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} config - Sphere configuration
 * @returns {Mesh} Sphere mesh
 */
function createHealCircle(position, scene, config = {}) {
  const radius = config.radius || 0.5;
  const maxRadius = config.maxRadius || 1.5;
  const duration = config.duration || 1000; // 1 second
  
  // Create a sphere for the expanding effect
  const circleMesh = MeshBuilder.CreateSphere('heal_circle', {
    diameter: radius,
    segments: 32
  }, scene);
  
  // Position on ground (center the sphere at ground level)
  circleMesh.position = new Vector3(position.x, radius / 2, position.z);
  
  // Create green material
  const material = new StandardMaterial('heal_circle_material', scene);
  material.diffuseColor = new Color3(0.2, 1.0, 0.4); // Green
  material.emissiveColor = new Color3(0.1, 0.5, 0.2); // Dim green glow
  material.alpha = 0.08; // 8% opacity
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  
  circleMesh.material = material;
  circleMesh.isPickable = false;
  
  // Animate expansion
  const startTime = Date.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1.0);
    
    // Expand from radius to maxRadius (uniform scaling for sphere)
    const currentRadius = radius + (maxRadius - radius) * progress;
    const scale = currentRadius / radius;
    circleMesh.scaling = new Vector3(scale, scale, scale);
    
    // Update Y position to keep sphere centered at ground level as it expands
    circleMesh.position.y = currentRadius / 2;
    
    // Fade out as it expands
    const fadeStart = 0.5; // Start fading at 50% progress
    if (progress > fadeStart) {
      const fadeProgress = (progress - fadeStart) / (1 - fadeStart);
      material.alpha = 0.08 * (1 - fadeProgress); // Fade from 8% to 0%
    }
    
    // Clean up when done
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(observer);
      // MEMORY FIX: Dispose material before mesh to prevent leak
      if (material && !material.isDisposed) {
        material.dispose();
      }
      circleMesh.dispose();
    }
  });
  
  return circleMesh;
}

/**
 * Play heal VFX
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition
 * @param {Vector3} startPos - Start position (caster)
 * @param {Vector3} endPos - End position (target)
 * @param {number} castStartTime - Timestamp when cast started
 */
export function playHealVfx(scene, spellDef, startPos, endPos, castStartTime) {
  const presentation = spellDef.presentation;
  if (!presentation) {
    console.warn('Heal VFX: No presentation data found in spell definition');
    return;
  }
  
  const impactVfx = presentation.impactVfxDef;
  
  // Playing heal VFX
  
  // Calculate delay based on cast animation timing
  const baseDelay = 600; // Match character animation
  const impactDelay = impactVfx ? (impactVfx.delayMs || 0) : 0;
  const startDelay = baseDelay + impactDelay;
  const actualStartTime = castStartTime + startDelay;
  const now = Date.now();
  const delay = Math.max(0, actualStartTime - now);
  
  setTimeout(() => {
    // Use values from impactVfxDef if available, otherwise use defaults
    const circleRadius = impactVfx?.vfx?.size || 0.3;
    const maxRadius = impactVfx?.explosionRadius || 1.2;
    const circleDuration = impactVfx?.explosionDuration || impactVfx?.duration || 1000;
    
    // Create expanding green circle on the ground
    createHealCircle(endPos, scene, {
      radius: circleRadius,
      maxRadius: maxRadius,
      duration: circleDuration
    });
    
    // Create upward-moving green particles
    const particleDuration = impactVfx?.duration || 1000;
    createHealParticles(endPos, scene, {
      minSize: 0.1,
      maxSize: 0.2,
      minLifeTime: 0.8,
      maxLifeTime: 1.5,
      emitRate: 50, // Reduced from 100
      minEmitPower: 0.5,
      maxEmitPower: 1.2,
      emitDuration: particleDuration / 1000 // Convert ms to seconds
    });
  }, delay);
}

/**
 * Minimal pre-warming for arcane missile VFX shaders
 * Creates offscreen instances to compile shaders at initialization, not at cast time
 * This is a minimal, safe optimization that doesn't change VFX behavior
 */
export function preWarmArcaneMissileShaders(scene) {
  const offscreenPos = new Vector3(-1000, -1000, -1000);
  
  // Pre-warm textures by creating them once
  const warmLineStreak = createLineStreakTexture(scene);
  const warmDiamond = createDiamondTexture(scene);
  
  // Pre-load magic shard GLB model and cache it
  const shardModelPath = '/assets/magicshard.glb';
  SceneLoader.ImportMeshAsync('', shardModelPath, '', scene).then((result) => {
    if (result.meshes && result.meshes.length > 0) {
      const shardRoot = result.meshes[0];
      // Find root mesh (one without parent, or use first)
      let rootMesh = shardRoot;
      for (const mesh of result.meshes) {
        if (!mesh.parent) {
          rootMesh = mesh;
          break;
        }
      }
      
      // Position offscreen and make invisible
      rootMesh.position = offscreenPos;
      rootMesh.isVisible = false;
      rootMesh.name = 'arcane_warm_shard_model';
      
      // Store in scene metadata for cloning later
      if (!scene.metadata) {
        scene.metadata = {};
      }
      scene.metadata.arcaneShardModel = rootMesh;
      
      // Magic shard GLB model pre-loaded successfully
    } else {
      console.warn('[ArcaneMissile] Failed to load magic shard GLB model, will use fallback box');
    }
  }).catch((error) => {
    console.warn('[ArcaneMissile] Error loading magic shard GLB model:', error);
  });
  
  // Pre-warm fallback core mesh (in case GLB fails to load)
  const warmCore = MeshBuilder.CreateBox('arcane_warm_core', {
    width: 0.04,
    height: 0.15,
    depth: 0.04
  }, scene);
  warmCore.position = offscreenPos;
  warmCore.rotation.z = Math.PI / 4;
  warmCore.rotation.x = -Math.PI / 12;
  const warmCoreMaterial = new StandardMaterial('arcane_warm_core_material', scene);
  warmCoreMaterial.diffuseColor = new Color3(0.38, 0.18, 0.92);
  warmCoreMaterial.emissiveColor = new Color3(0.75, 0.85, 1.0);
  warmCoreMaterial.alpha = 0.95;
  warmCoreMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  warmCoreMaterial.backFaceCulling = false;
  warmCoreMaterial.disableDepthWrite = true;
  warmCore.material = warmCoreMaterial;
  warmCore.isVisible = false;
  
  // Pre-warm particle systems (create but don't start)
  const warmEmitter = MeshBuilder.CreateSphere('arcane_warm_emitter', { diameter: 0.1 }, scene);
  warmEmitter.position = offscreenPos;
  warmEmitter.isVisible = false;
  
  // Pre-warm ribbon particle system - fully configure it
  const warmRibbon = new ParticleSystem('arcane_warm_ribbon', 10, scene);
  warmRibbon.particleTexture = warmLineStreak;
  warmRibbon.emitter = warmEmitter;
  warmRibbon.color1 = new Color4(0.45, 0.25, 1.0, 1.0);
  warmRibbon.color2 = new Color4(0.30, 0.15, 0.85, 1.0);
  warmRibbon.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  warmRibbon.minSize = 0.08;
  warmRibbon.maxSize = 0.15;
  warmRibbon.minLifeTime = 0.12;
  warmRibbon.maxLifeTime = 0.25;
  warmRibbon.emitRate = 250;
  warmRibbon.direction1 = new Vector3(-0.1, -0.05, -0.6);
  warmRibbon.direction2 = new Vector3(0.1, 0.05, -0.4);
  warmRibbon.gravity = new Vector3(0, 0, 0);
  warmRibbon.updateSpeed = 0.02;
  
  // Pre-warm facet particle system - fully configure it
  const warmFacet = new ParticleSystem('arcane_warm_facet', 10, scene);
  warmFacet.particleTexture = warmDiamond;
  warmFacet.emitter = warmEmitter;
  warmFacet.color1 = new Color4(0.35, 0.18, 0.85, 1.0);
  warmFacet.color2 = new Color4(0.25, 0.12, 0.65, 1.0);
  warmFacet.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  warmFacet.minSize = 0.03;
  warmFacet.maxSize = 0.06;
  warmFacet.minLifeTime = 0.1;
  warmFacet.maxLifeTime = 0.2;
  warmFacet.emitRate = 80;
  warmFacet.direction1 = new Vector3(-0.2, -0.1, -0.5);
  warmFacet.direction2 = new Vector3(0.2, 0.1, -0.3);
  warmFacet.gravity = new Vector3(0, 0, 0);
  warmFacet.updateSpeed = 0.02;
  
  // Pre-warm impact flare particle system - fully configure it
  const warmFlare = new ParticleSystem('arcane_warm_flare', 10, scene);
  warmFlare.particleTexture = warmDiamond;
  warmFlare.emitter = warmEmitter;
  warmFlare.color1 = new Color4(1.0, 1.0, 1.0, 1.0);
  warmFlare.color2 = new Color4(0.45, 0.55, 1.0, 1.0);
  warmFlare.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  warmFlare.minSize = 0.04;
  warmFlare.maxSize = 0.08;
  warmFlare.minLifeTime = 0.08;
  warmFlare.maxLifeTime = 0.15;
  warmFlare.emitRate = 300;
  
  // Pre-warm impact ring mesh
  const warmRing = MeshBuilder.CreateBox('arcane_warm_ring', {
    size: 0.12,
    height: 0.005
  }, scene);
  warmRing.position = offscreenPos;
  warmRing.rotation.x = Math.PI / 2;
  warmRing.rotation.z = Math.PI / 4;
  const warmRingMaterial = new StandardMaterial('arcane_warm_ring_material', scene);
  warmRingMaterial.emissiveColor = new Color3(0.35, 0.45, 0.85);
  warmRingMaterial.alpha = 0.8;
  warmRingMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  warmRingMaterial.backFaceCulling = false;
  warmRingMaterial.disableDepthWrite = true;
  warmRing.material = warmRingMaterial;
  warmRing.isVisible = false;
  
  // Start particle systems briefly to ensure shaders are fully compiled
  // This ensures first cast looks identical to subsequent casts
  warmRibbon.start();
  warmFacet.start();
  warmFlare.start();
  
  // Force multiple render passes to ensure everything is compiled and uploaded
  // This ensures first cast looks identical to subsequent casts
  const renderPasses = 3;
  let renderCount = 0;
  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    renderCount++;
    if (renderCount >= renderPasses) {
      scene.onBeforeRenderObservable.remove(renderObserver);
      
      // Stop particle systems
      warmRibbon.stop();
      warmFacet.stop();
      warmFlare.stop();
      
      // Clean up pre-warm objects after shaders are fully compiled
      setTimeout(() => {
        warmCore.dispose();
        warmCoreMaterial.dispose();
        warmRibbon.dispose();
        warmFacet.dispose();
        warmFlare.dispose();
        warmRing.dispose();
        warmRingMaterial.dispose();
        warmEmitter.dispose();
        // Textures are fine to keep - they're small and reusable
      }, 50);
    }
  });
}

/**
 * Create arcane missile core (Layer 1): Sharp, elongated arcane shard fragment
 * Uses magicshard.glb model if available, falls back to box geometry
 * Thin, pointy, slicing fragment with white-hot center and purple falloff
 */
function createArcaneMissileCore(scene, name) {
  let core;
  
  // Try to use pre-loaded GLB model, fall back to box if not available
  if (scene.metadata && scene.metadata.arcaneShardModel) {
    // Clone the pre-loaded shard model
    const shardModel = scene.metadata.arcaneShardModel;
    core = shardModel.clone(`${name}_core`);
    
    // Reset position and rotation (clone preserves original)
    core.position = Vector3.Zero();
    core.rotation = Vector3.Zero();
    
    // Scale the model to match the original shard size
    // Original was 0.04 x 0.15 x 0.04, so we'll scale to match roughly
    // Adjust scale based on the model's original bounding box
    const boundingInfo = shardModel.getBoundingInfo();
    if (boundingInfo) {
      const size = boundingInfo.boundingBox.maximum.subtract(boundingInfo.boundingBox.minimum);
      // Scale to make height ~0.15 (forward direction)
      const targetHeight = 0.15;
      const scale = targetHeight / Math.max(size.y, 0.001);
      core.scaling = new Vector3(scale, scale, scale);
    } else {
      // Default scale if bounding box not available
      core.scaling = new Vector3(0.1, 0.1, 0.1);
    }
    
    // Using GLB shard model
  } else {
    // Fallback: Create a thin, elongated shard using box geometry
    // Using fallback box geometry
    core = MeshBuilder.CreateBox(`${name}_core`, {
      width: 0.04,   // Very thin width (X axis) - sharp sliver
      height: 0.15,  // Elongated length (Y axis - forward direction) - smaller overall
      depth: 0.04   // Very thin depth (Z axis) - sharp edge
    }, scene);
    
    // Rotate 45 degrees on Z axis to create diamond cross-section when viewed from above
    core.rotation.z = Math.PI / 4; // 45 degree rotation for diamond silhouette
    
    // Add forward tilt to align with projectile direction - slicing forward
    // Tilt forward slightly (around X axis) so shard points in direction of travel
    core.rotation.x = -Math.PI / 12; // ~15 degrees forward tilt
  }
  
  // Create material with white-hot center and purple/blue falloff
  const material = new StandardMaterial(`${name}_core_material`, scene);
  
  // Cooler, sharper arcane look - blue dominates, red suppressed
  material.diffuseColor = new Color3(0.38, 0.18, 0.92); // Deep indigo base - blue dominates over red
  material.emissiveColor = new Color3(0.75, 0.85, 1.0); // Hot edge - near-white blue highlight
  material.alpha = 0.95; // Slightly more opaque for crisp edges
  
  // High specular for crisp edges and highlights
  material.specularColor = new Color3(1.0, 1.0, 1.0); // Bright white specular for edges
  material.specularPower = 64; // Sharp, focused highlights
  
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  
  // Apply material to the core mesh
  // If it's a cloned GLB model, apply to all child meshes as well
  if (core.getChildMeshes && core.getChildMeshes().length > 0) {
    // GLB model with children - apply material to root and all children
    core.material = material;
    core.getChildMeshes().forEach(child => {
      child.material = material;
    });
  } else {
    // Simple mesh (fallback box) - just apply to root
    core.material = material;
  }
  core.isPickable = false;
  
  // Add subtle pulsing animation - maintains sharp silhouette
  const pulseSpeed = 6.0; // 6 pulses per second
  const startTime = Date.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    // Very subtle pulse - maintains sharp, crisp edges
    const pulse = 0.95 + 0.05 * Math.sin(elapsed * pulseSpeed * Math.PI * 2);
    core.scaling = new Vector3(pulse, pulse, pulse);
    
    // Pulse brightness - hot edge highlight pulses, base stays deep indigo
    // Brightness oscillates between hot and slightly dimmer
    const brightness = 0.9 + 0.1 * Math.sin(elapsed * pulseSpeed * Math.PI * 2);
    // Hot edge emissive pulses - near-white blue highlight at edges
    material.emissiveColor = new Color3(
      0.75 * brightness,  // Blue-dominated, red suppressed
      0.85 * brightness,  // Slight green for cool white-blue
      1.0 * brightness    // Blue dominates
    );
  });
  
  core.metadata = { observer };
  
  return core;
}

/**
 * Create arcane missile trail (Layer 2): Structured linear energy ribbon with thin streaks and angular flow
 */
function createArcaneMissileTrail(projectileMesh, scene, name) {
  // Create trail particle systems
  
  // Primary trail: Linear energy ribbon using line-streak particles
  const ribbonParticles = new ParticleSystem(`${name}_trail_ribbon`, 80, scene);
  
  // Use line-streak texture for structured, linear appearance
  ribbonParticles.particleTexture = createLineStreakTexture(scene);
  
  ribbonParticles.emitter = projectileMesh;
  ribbonParticles.minEmitBox = new Vector3(-0.03, -0.03, -0.03);
  ribbonParticles.maxEmitBox = new Vector3(0.03, 0.03, 0.03);
  
  // Cooler, sharper arcane trail - blue dominates, pink removed
  ribbonParticles.color1 = new Color4(0.45, 0.25, 1.0, 1.0); // Hot inner trail - blue dominates
  ribbonParticles.color2 = new Color4(0.30, 0.15, 0.85, 1.0); // Outer/cooler - deep indigo
  ribbonParticles.colorDead = new Color4(0.20, 0.10, 0.55, 0.0); // Fade to deep indigo, not lavender
  
  // Thin, elongated streaks for linear ribbon
  ribbonParticles.minSize = 0.08;
  ribbonParticles.maxSize = 0.15;
  
  // Short lifetime for clean tapering
  ribbonParticles.minLifeTime = 0.12;
  ribbonParticles.maxLifeTime = 0.25;
  
  // High emission for continuous structured trail
  ribbonParticles.emitRate = 250;
  
  // Linear backward flow - controlled, minimal turbulence
  ribbonParticles.direction1 = new Vector3(-0.1, -0.05, -0.6);
  ribbonParticles.direction2 = new Vector3(0.1, 0.05, -0.4);
  ribbonParticles.minEmitPower = 0.15;
  ribbonParticles.maxEmitPower = 0.35;
  ribbonParticles.updateSpeed = 0.02;
  
  // No gravity - straight linear flow
  ribbonParticles.gravity = new Vector3(0, 0, 0);
  
  // Additive blending for energy glow
  ribbonParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  
  // Start ribbon particles
  ribbonParticles.start();
  
  // Secondary trail: Segmented facets using diamond particles for angular flow lines
  const facetParticles = new ParticleSystem(`${name}_trail_facets`, 40, scene);
  
  // Use diamond texture for angular, geometric segments
  facetParticles.particleTexture = createDiamondTexture(scene);
  
  facetParticles.emitter = projectileMesh;
  facetParticles.minEmitBox = new Vector3(-0.02, -0.02, -0.02);
  facetParticles.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
  
  // Darker, sharper arcane fragments - not bright candy
  facetParticles.color1 = new Color4(0.35, 0.18, 0.85, 1.0); // Arcane fragments - blue dominates
  facetParticles.color2 = new Color4(0.25, 0.12, 0.65, 1.0); // Darker fragments
  facetParticles.colorDead = new Color4(0.15, 0.08, 0.40, 0.0); // Fade to deep indigo
  
  // Small angular facets
  facetParticles.minSize = 0.03;
  facetParticles.maxSize = 0.06;
  
  facetParticles.minLifeTime = 0.1;
  facetParticles.maxLifeTime = 0.2;
  
  // Lower emission for segmented appearance
  facetParticles.emitRate = 80;
  
  // Angular flow - controlled symmetry
  facetParticles.direction1 = new Vector3(-0.2, -0.1, -0.5);
  facetParticles.direction2 = new Vector3(0.2, 0.1, -0.3);
  facetParticles.minEmitPower = 0.1;
  facetParticles.maxEmitPower = 0.25;
  facetParticles.updateSpeed = 0.02;
  
  facetParticles.gravity = new Vector3(0, 0, 0);
  facetParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  
  // Start facet particles
  facetParticles.start();
  
  // Store particle system references for proper cleanup
  // Ensure they're properly tracked to prevent stacking
  ribbonParticles.name = `${name}_trail_ribbon`;
  facetParticles.name = `${name}_trail_facets`;
  
  // Trail particle systems created
  
  // Return both systems for cleanup
  return { ribbon: ribbonParticles, facets: facetParticles };
}

/**
 * Create arcane sparkles (Layer 3): Geometric shard particles with controlled drift
 */
function createArcaneSparkles(projectileMesh, scene, name) {
  const particleSystem = new ParticleSystem(`${name}_sparkles`, 100, scene);
  
  // Use diamond texture for geometric sparkles instead of organic stars
  particleSystem.particleTexture = createDiamondTexture(scene);
  
  particleSystem.emitter = projectileMesh;
  particleSystem.minEmitBox = new Vector3(-0.08, -0.08, -0.08);
  particleSystem.maxEmitBox = new Vector3(0.08, 0.08, 0.08);
  
  // Cool arcane glints - almost white-blue, not fairy glitter
  particleSystem.color1 = new Color4(0.80, 0.90, 1.0, 1.0); // Almost white-blue (G > R avoids magenta)
  particleSystem.color2 = new Color4(0.45, 0.60, 1.0, 1.0); // Cool blue glint
  particleSystem.colorDead = new Color4(0.25, 0.35, 0.70, 0.0); // Fade to cool blue
  
  // Small geometric shards
  particleSystem.minSize = 0.02;
  particleSystem.maxSize = 0.05;
  
  // Short lifetime
  particleSystem.minLifeTime = 0.12;
  particleSystem.maxLifeTime = 0.3;
  
  // Sporadic emission (not constant)
  particleSystem.emitRate = 25; // Lower rate for sporadic feel
  
  // Controlled drift - more structured, less organic
  particleSystem.direction1 = new Vector3(-0.3, -0.2, -0.3);
  particleSystem.direction2 = new Vector3(0.3, 0.2, 0.3);
  particleSystem.minEmitPower = 0.15;
  particleSystem.maxEmitPower = 0.4;
  particleSystem.updateSpeed = 0.02;
  
  // No gravity - controlled geometric motion
  particleSystem.gravity = new Vector3(0, 0, 0);
  
  // Additive blending for energy glow
  particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  
  particleSystem.start();
  
  return particleSystem;
}

/**
 * Create runic motes (Layer 4): Subtle geometric shards
 */
function createRunicMotes(projectileMesh, scene, name) {
  const motes = [];
  const moteCount = 3;
  
  for (let i = 0; i < moteCount; i++) {
    const mote = MeshBuilder.CreateBox(`${name}_mote_${i}`, {
      size: 0.05
    }, scene);
    
    mote.parent = projectileMesh;
    mote.position = new Vector3(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2
    );
    
    const material = new StandardMaterial(`${name}_mote_material_${i}`, scene);
    // Calm, deep, authoritative runes - blue dominates
    material.emissiveColor = new Color3(0.30, 0.20, 0.65); // Deep indigo runes
    material.alpha = 0.4;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    
    mote.material = material;
    mote.isPickable = false;
    
    // Rotate slowly with optional highlight pulse
    const startTime = Date.now();
    const rotationSpeed = 2.0; // Rotations per second
    const pulseSpeed = 3.0; // Pulse speed for highlight
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (!projectileMesh || !projectileMesh.metadata) {
        scene.onBeforeRenderObservable.remove(observer);
        return;
      }
      const elapsed = (Date.now() - startTime) / 1000;
      mote.rotation.y = elapsed * rotationSpeed * Math.PI * 2;
      mote.rotation.x = elapsed * rotationSpeed * 0.5 * Math.PI * 2;
      
      // Optional highlight pulse - pulse between deep indigo and bright blue
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * pulseSpeed * Math.PI * 2);
      const baseColor = new Color3(0.30, 0.20, 0.65); // Deep indigo
      const highlightColor = new Color3(0.55, 0.65, 1.0); // Pulse peak - bright blue
      material.emissiveColor = Color3.Lerp(baseColor, highlightColor, pulse);
      
      // Fade out over time
      const fadeTime = 0.3; // Fade in 300ms
      if (elapsed < fadeTime) {
        material.alpha = 0.4 * (elapsed / fadeTime);
      } else {
        material.alpha = 0.4 * (1 - (elapsed - fadeTime) / fadeTime);
        if (material.alpha <= 0) {
          scene.onBeforeRenderObservable.remove(observer);
          // MEMORY FIX: Dispose material before mesh to prevent leak
          if (material && !material.isDisposed) {
            material.dispose();
          }
          mote.dispose();
        }
      }
    });
    
    motes.push({ mote, observer, material });
  }
  
  return motes;
}

/**
 * Create arcane impact effect: Small, concentrated, precise discharge - NOT an explosion
 */
function createArcaneImpact(position, scene, name) {
  const impactPos = position.clone();
  impactPos.y += 0.5; // Higher impact position
  
  // 1. Bright central hit point - Small white/cyan core (compact, focused)
  const coreGlow = MeshBuilder.CreateSphere(`${name}_core_glow`, {
    diameter: 0.16, // 2x larger - focused point
    segments: 12
  }, scene);
  coreGlow.position = impactPos.clone();
  
  const coreMaterial = new StandardMaterial(`${name}_core_material`, scene);
  coreMaterial.emissiveColor = new Color3(0.85, 0.95, 1.0); // Core flash - near-white blue highlight
  coreMaterial.diffuseColor = new Color3(0.38, 0.18, 0.92); // Deep indigo base - blue dominates
  coreMaterial.alpha = 1.0;
  coreMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  coreMaterial.backFaceCulling = false;
  coreMaterial.disableDepthWrite = true;
  
  coreGlow.material = coreMaterial;
  coreGlow.isPickable = false;
  
  // Core glow animation - sharp, short-lived (100ms)
  const coreStartTime = Date.now();
  const coreDuration = 100; // 100ms - very short
  const coreObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - coreStartTime;
    const progress = Math.min(elapsed / coreDuration, 1.0);
    
    if (progress < 1.0) {
      const fade = 1.0 - progress;
      coreMaterial.alpha = fade;
      // Minimal expansion - stays focused (2x larger overall)
      coreGlow.scaling = new Vector3(1.0 + progress * 0.15, 1.0 + progress * 0.15, 1.0 + progress * 0.15);
    } else {
      scene.onBeforeRenderObservable.remove(coreObserver);
      // MEMORY FIX: Dispose material before mesh to prevent leak
      if (coreMaterial && !coreMaterial.isDisposed) {
        coreMaterial.dispose();
      }
      coreGlow.dispose();
    }
  });
  
  // 2. Minimal geometric burst - Small diamond or star-shaped flare (very compact, 2x larger)
  const flareEmitter = MeshBuilder.CreateSphere(`${name}_flare_emitter`, { diameter: 0.04 }, scene);
  flareEmitter.position = impactPos.clone();
  flareEmitter.isVisible = false;
  
  const flareParticles = new ParticleSystem(`${name}_flare`, 50, scene); // 2x more particles
  flareParticles.particleTexture = createDiamondTexture(scene);
  flareParticles.emitter = flareEmitter;
  flareParticles.minEmitBox = new Vector3(-0.02, -0.02, -0.02);
  flareParticles.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
  
  // Precise arcane discharge - not confetti
  flareParticles.color1 = new Color4(1.0, 1.0, 1.0, 1.0); // White flash
  flareParticles.color2 = new Color4(0.45, 0.55, 1.0, 1.0); // Cool blue flare - blue dominates
  flareParticles.colorDead = new Color4(0.25, 0.30, 0.70, 0.0); // Fade to deep indigo
  
  // Small, compact particles (2x larger)
  flareParticles.minSize = 0.08;
  flareParticles.maxSize = 0.16;
  flareParticles.minLifeTime = 0.08;
  flareParticles.maxLifeTime = 0.15;
  flareParticles.emitRate = 600; // 2x rate
  // Very tight, controlled burst - minimal spread (2x larger spread)
  flareParticles.direction1 = new Vector3(-0.8, -0.4, -0.8);
  flareParticles.direction2 = new Vector3(0.8, 0.4, 0.8);
  flareParticles.minEmitPower = 2.0;
  flareParticles.maxEmitPower = 4.0;
  flareParticles.updateSpeed = 0.02;
  flareParticles.gravity = new Vector3(0, 0, 0); // No gravity
  flareParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  flareParticles.targetStopDuration = 0.1; // 100ms - very short
  
  flareParticles.start();
  
  // 3. Subtle arcane ring or glyph - Small, brief appearance (2x larger)
  const ringSize = 0.24; // 2x larger starting size
  const ring = MeshBuilder.CreateBox(`${name}_ring`, {
    size: ringSize,
    height: 0.005 // Very thin
  }, scene);
  ring.position = impactPos.clone();
  ring.rotation.x = Math.PI / 2; // Lay flat
  ring.rotation.z = Math.PI / 4; // Diamond orientation
  
  const ringMaterial = new StandardMaterial(`${name}_ring_material`, scene);
  ringMaterial.emissiveColor = new Color3(0.35, 0.45, 0.85); // Arcane discharge ring - blue dominates
  ringMaterial.alpha = 0.8;
  ringMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  ringMaterial.backFaceCulling = false;
  ringMaterial.disableDepthWrite = true;
  
  ring.material = ringMaterial;
  ring.isPickable = false;
  
  // Ring expansion - small, brief (120ms, 2x larger)
  const ringStartTime = Date.now();
  const ringDuration = 120; // 120ms
  const maxSize = 0.70; // 2x larger max size
  const ringObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - ringStartTime;
    const progress = Math.min(elapsed / ringDuration, 1.0);
    
    const currentSize = ringSize + (maxSize - ringSize) * progress;
    ring.scaling = new Vector3(currentSize / ringSize, 1, currentSize / ringSize);
    ringMaterial.alpha = 0.8 * (1 - progress); // Fade quickly
    
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(ringObserver);
      // MEMORY FIX: Dispose material before mesh to prevent leak
      if (ringMaterial && !ringMaterial.isDisposed) {
        ringMaterial.dispose();
      }
      ring.dispose();
    }
  });
  
  // Cleanup - ensure particle system is removed from scene
  setTimeout(() => {
    // Stop and dispose flare particles
    try {
      if (flareParticles && typeof flareParticles.isDisposed === 'function' && !flareParticles.isDisposed()) {
        flareParticles.stop();
        flareParticles.emitter = null;
        flareParticles.dispose();
        // Explicitly remove from scene's particleSystems array
        const index = scene.particleSystems.indexOf(flareParticles);
        if (index !== -1) {
          scene.particleSystems.splice(index, 1);
        }
      } else if (flareParticles) {
        // Fallback: if isDisposed doesn't exist, just try to dispose
        try {
          flareParticles.stop();
          flareParticles.emitter = null;
          flareParticles.dispose();
        } catch (e) {
          console.warn(`[ArcaneMissile] Error disposing flare particles:`, e);
        }
        // Explicitly remove from scene's particleSystems array
        const index = scene.particleSystems.indexOf(flareParticles);
        if (index !== -1) {
          scene.particleSystems.splice(index, 1);
        }
      }
    } catch (e) {
      console.error(`[ArcaneMissile] Error in impact cleanup:`, e);
    }
    
    if (flareEmitter && typeof flareEmitter.isDisposed === 'function' && !flareEmitter.isDisposed()) {
      flareEmitter.dispose();
    } else if (flareEmitter) {
      try {
        flareEmitter.dispose();
      } catch (e) {
        console.warn(`[ArcaneMissile] Error disposing flare emitter:`, e);
      }
    }
  }, 500); // Shorter cleanup time
}

/**
 * Play arcane missile VFX
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition with VFX
 * @param {Vector3} startPos - Start position (caster position)
 * @param {Vector3} endPos - End position (target position)
 * @param {number} castStartTime - Timestamp when cast animation started
 * @param {number} missileIndex - Index of missile in multi-missile cast (0, 1, 2) for curve pattern
 * @param {number} totalMissiles - Total number of missiles in this cast
 */
export function playArcaneMissileVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex = 0, totalMissiles = 1, options = {}) {
  const presentation = spellDef.presentation;
  if (!presentation) {
    console.warn('Arcane Missile VFX: No presentation data found');
    return;
  }

  const { targetUserId, onImpact } = options;

  const projectileVfx = presentation.projectileVfx;
  const impactVfx = presentation.impactVfxDef;
  
  // Calculate start delay - allow cast animation to play before projectile spawns
  const baseDelay = 550; // Wait for cast animation wind-up
  const projectileDelay = projectileVfx ? (projectileVfx.startDelayMs || 0) : 0;
  const startDelay = baseDelay + projectileDelay;
  const actualStartTime = castStartTime + startDelay;
  const now = Date.now();
  const delay = Math.max(0, actualStartTime - now);
  
  setTimeout(() => {
    if (isNaN(startPos.x) || isNaN(startPos.y) || isNaN(startPos.z) ||
        isNaN(endPos.x) || isNaN(endPos.y) || isNaN(endPos.z)) {
      console.error('Invalid positions for arcane missile VFX:', { startPos, endPos });
      return;
    }
    
    // Position projectile
    const projectileStart = startPos.clone();
    const heightOffset = projectileVfx ? (projectileVfx.heightOffset || 0.6) : 0.6;
    projectileStart.y = startPos.y + heightOffset;
    
    const projectileEnd = endPos.clone();
    projectileEnd.y = endPos.y + heightOffset + 0.3; // Add extra height for target destination
    
    const baseSpeed = projectileVfx ? (projectileVfx.speedCellsPerSec || 5) : 5;
    
    // Calculate curve pattern for mirrored lateral curves
    // For 3 missiles: index 0 = left (-1), index 1 = center (0), index 2 = right (1)
    let curvePattern = 0; // Default to center
    if (totalMissiles === 3) {
      if (missileIndex === 0) {
        curvePattern = -1; // Left curve
      } else if (missileIndex === 1) {
        curvePattern = 0; // Center/minimal curve
      } else if (missileIndex === 2) {
        curvePattern = 1; // Right curve
      }
    } else if (totalMissiles === 2) {
      // For 2 missiles, use left and right
      curvePattern = missileIndex === 0 ? -1 : 1;
    } else if (totalMissiles > 3) {
      // For more than 3, distribute: first left, middle center, last right
      if (missileIndex === 0) {
        curvePattern = -1;
      } else if (missileIndex === totalMissiles - 1) {
        curvePattern = 1;
      } else {
        curvePattern = 0;
      }
    }
    
    // Calculate speed multiplier for subtle staggering
    // Center missile slightly faster, outer missiles slightly slower for depth
    let speedMultiplier = 1.0;
    if (totalMissiles >= 2) {
      if (curvePattern === 0) {
        // Center missile - slightly faster
        speedMultiplier = 1.05;
      } else {
        // Outer missiles - slightly slower
        speedMultiplier = 0.98;
      }
    }
    
    const speed = baseSpeed * speedMultiplier;
    
    // Generate unique name for this missile instance to prevent stacking
    const uniqueId = `${missileIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const uniqueName = `arcane_missile_${uniqueId}`;
    
    // Layer 1: Core
    const core = createArcaneMissileCore(scene, uniqueName);
    core.position = projectileStart.clone();
    
    // Set initial orientation toward target
    const initialDirection = projectileEnd.subtract(projectileStart);
    if (initialDirection.length() > 0.001) {
      const normalizedDir = initialDirection.clone().normalize();
      const initialTarget = projectileStart.clone().add(normalizedDir.scale(1.0));
      core.lookAt(initialTarget);
    }
    
    // Layer 2: Trail
    const trail = createArcaneMissileTrail(core, scene, uniqueName);
    
    // Layer 3: Sparkles - DISABLED (removed circle particles)
    // const sparkles = createArcaneSparkles(core, scene, uniqueName);
    const sparkles = null;
    
    // Layer 4: Runic motes
    const motes = createRunicMotes(core, scene, uniqueName);
    
    // Store all particle systems for cleanup
    core.metadata = core.metadata || {};
    core.metadata.trail = trail;
    core.metadata.sparkles = sparkles;
    core.metadata.motes = motes;
    
    // Animate projectile along curved path with pattern and speed variation
    animateProjectileCurved(
      core,
      projectileStart,
      projectileEnd,
      baseSpeed, // Base speed, multiplier applied inside function
      scene,
      () => {
        // Cleanup on impact - ensure proper order to prevent stacking
        
        if (core && core.metadata) {
          // First: Stop and dispose particle systems (trail) - CRITICAL to prevent stacking
          if (core.metadata.trail) {
            const trail = core.metadata.trail;
            
                // Stop and dispose ribbon particles - CRITICAL: Remove from scene to prevent stacking
                if (trail.ribbon && !trail.ribbon.isDisposed()) {
                  const ribbon = trail.ribbon;
                  
                  // Stop emission immediately
                  ribbon.stop();
                  // Verify it's stopped
                  if (ribbon.isStarted()) {
                    ribbon.reset(); // Force reset if stop didn't work
                  }
                  // Clear emitter to prevent any further updates
                  ribbon.emitter = null;
                  // Dispose the particle system first (should remove from scene automatically)
                  ribbon.dispose();
                  // Explicitly remove from scene's particleSystems array as backup
                  const index = scene.particleSystems.indexOf(ribbon);
                  if (index !== -1) {
                    scene.particleSystems.splice(index, 1);
                  }
                }
            
                // Stop and dispose facet particles - CRITICAL: Remove from scene to prevent stacking
                if (trail.facets && !trail.facets.isDisposed()) {
                  const facets = trail.facets;
                  
                  // Stop emission immediately
                  facets.stop();
                  // Verify it's stopped
                  if (facets.isStarted()) {
                    facets.reset(); // Force reset if stop didn't work
                  }
                  // Clear emitter to prevent any further updates
                  facets.emitter = null;
                  // Dispose the particle system first (should remove from scene automatically)
                  facets.dispose();
                  // Explicitly remove from scene's particleSystems array as backup
                  const index = scene.particleSystems.indexOf(facets);
                  if (index !== -1) {
                    scene.particleSystems.splice(index, 1);
                  }
                }
            
            // Clear trail reference
            core.metadata.trail = null;
          }
          
          // Second: Clean up sparkles (disabled but handle if exists)
          if (core.metadata.sparkles && !core.metadata.sparkles.isDisposed()) {
            core.metadata.sparkles.stop();
            core.metadata.sparkles.emitter = null;
            core.metadata.sparkles.dispose();
            core.metadata.sparkles = null;
          }
          
          // Third: Clean up motes
          if (core.metadata.motes) {
            core.metadata.motes.forEach(({ observer, mote, material }) => {
              if (observer) scene.onBeforeRenderObservable.remove(observer);
              // MEMORY FIX: Dispose material before mesh to prevent leak
              if (material && !material.isDisposed) {
                material.dispose();
              }
              if (mote && !mote.isDisposed()) mote.dispose();
            });
            core.metadata.motes = null;
          }
          
          // Fourth: Clean up core observer
          if (core.metadata.observer) {
            scene.onBeforeRenderObservable.remove(core.metadata.observer);
            core.metadata.observer = null;
          }
          
          // Clear all metadata
          core.metadata = null;
        }
        
        // Finally: Dispose core mesh and its material
        if (core && !core.isDisposed()) {
          // MEMORY FIX: Dispose material before mesh to prevent leak
          if (core.material && !core.material.isDisposed) {
            core.material.dispose();
          }
          // Also dispose materials on child meshes (for GLB models)
          if (core.getChildMeshes) {
            core.getChildMeshes().forEach(child => {
              if (child.material && !child.material.isDisposed) {
                child.material.dispose();
              }
            });
          }
          core.dispose();
        }
        
        // Safety check: If there are too many particle systems, try to clean up disposed ones
        // Note: With 3 missiles per cast (2 particle systems each = 6), plus impact effects, 15+ is normal during active casting
        const afterCleanupCount = scene.particleSystems.length;
        if (afterCleanupCount > 20) {
          // Try to clean up any disposed particle systems that are still in the array
          for (let i = scene.particleSystems.length - 1; i >= 0; i--) {
            const ps = scene.particleSystems[i];
            try {
              if (ps && typeof ps.isDisposed === 'function' && ps.isDisposed()) {
                scene.particleSystems.splice(i, 1);
              }
            } catch (e) {
              // If we can't check, remove it anyway (might be corrupted)
              scene.particleSystems.splice(i, 1);
            }
          }
        }
        
        // Layer 5: Impact - use unique name to prevent conflicts
        if (impactVfx) {
          const impactDelay = impactVfx.delayMs || 0;
          setTimeout(() => {
            const impactName = `${core?.name || 'arcane_missile'}_impact`;
            createArcaneImpact(endPos, scene, impactName);
            // Play impact sound at target position
            playSpellSound('arcane_missile', 'impact', {
              position: endPos,
              eventId: `arcane_impact_${impactName}_${Date.now()}`
            });
            if (targetUserId && typeof onImpact === 'function') {
              onImpact(targetUserId);
            }
          }, impactDelay);
        }
      },
      null, // No single particle system to pass
      curvePattern, // Curve pattern: -1 (left), 0 (center), 1 (right)
      speedMultiplier // Speed multiplier for subtle staggering
    );
  }, delay);
}

/**
 * Play spell VFX based on spell definition
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition
 * @param {Vector3} startPos - Start position
 * @param {Vector3} endPos - End position
 * @param {number} castStartTime - Timestamp when cast started
 * @param {number} missileIndex - Index of missile in multi-missile cast (for arcane_missile)
 * @param {number} totalMissiles - Total number of missiles in this cast (for arcane_missile)
 * @param {{ targetUserId?: string, onImpact?: (userId: string) => void }} options - Optional: trigger hit animation on impact (sync with VFX)
 */
export function playSpellVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex = 0, totalMissiles = 1, options = {}) {
  // Route to specific spell VFX handler
  if (spellDef.spellId === 'fireball') {
    playFireballVfx(scene, spellDef, startPos, endPos, castStartTime, options);
  } else if (spellDef.spellId === 'heal') {
    playHealVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'arcane_missile') {
    playArcaneMissileVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex, totalMissiles, options);
  } else if (spellDef.spellId === 'slash') {
    playSlashVfx(scene, spellDef, startPos, endPos, castStartTime, options);
  } else if (spellDef.spellId === 'slam') {
    playSlamVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'taunt') {
    playTauntVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'aid') {
    playAidVfx(scene, spellDef, startPos, endPos, castStartTime, options);
  } else if (spellDef.spellId === 'teleport') {
    // Teleport VFX is handled separately via TeleportVFXController
    console.warn(`Teleport VFX should be handled via TeleportVFXController, not playSpellVfx`);
  } else {
    console.warn(`VFX not implemented for spell: ${spellDef.spellId}`);
  }
}

/**
 * Play slash (melee) VFX - blood impact at ~700ms when sword connects
 */
function playSlashVfx(scene, spellDef, startPos, endPos, castStartTime, options = {}) {
  const SLASH_BLOOD_DELAY_MS = 700;
  const now = Date.now();
  const delay = Math.max(0, castStartTime + SLASH_BLOOD_DELAY_MS - now);

  const slashDirection = new Vector3(endPos.x - startPos.x, 0, endPos.z - startPos.z);
  const len = Math.sqrt(slashDirection.x * slashDirection.x + slashDirection.z * slashDirection.z);
  if (len > 0.001) {
    slashDirection.x /= len;
    slashDirection.z /= len;
  } else {
    slashDirection.set(1, 0, 0);
  }

  setTimeout(() => {
    createSlashBloodImpact(endPos, scene, slashDirection);
    if (options?.targetUserId && typeof options?.onImpact === 'function') {
      options.onImpact(options.targetUserId);
    }
  }, delay);
}

/**
 * Create slam ground effect - dust burst + expanding shockwave ring at ground level.
 * Used when warrior slams the ground (CIRCLE1 AoE).
 * @param {Vector3} position - Center position (caster position)
 * @param {Scene} scene - Babylon.js scene
 */
function createSlamGroundEffect(position, scene) {
  if (!scene || scene.isDisposed) return;
  const groundPos = new Vector3(position.x, 0.08, position.z);

  // 1. Light brown dust particles - spread outward in circular pattern (horizontal XZ plane)
  const emitterMesh = MeshBuilder.CreateSphere('slam_dust_emitter', { diameter: 0.25 }, scene);
  emitterMesh.position = groundPos.clone();
  emitterMesh.isVisible = false;

  const dustParticles = new ParticleSystem('slam_dust_particles', 450, scene);
  dustParticles.particleTexture = createParticleTexture(scene);
  dustParticles.emitter = emitterMesh;
  dustParticles.minEmitBox = new Vector3(-0.22, -0.03, -0.22);
  dustParticles.maxEmitBox = new Vector3(0.22, 0.02, 0.22);

  // Light brown / dust colors - tan, beige, sand
  dustParticles.color1 = new Color4(0.82, 0.72, 0.58, 0.92);
  dustParticles.color2 = new Color4(0.7, 0.6, 0.48, 0.85);
  dustParticles.colorDead = new Color4(0.55, 0.47, 0.38, 0);
  dustParticles.minSize = 0.18;
  dustParticles.maxSize = 0.38;
  dustParticles.minLifeTime = 0.5;
  dustParticles.maxLifeTime = 1.0;
  dustParticles.emitRate = 550;
  // Radial spread in circle - direction covers full 360° in horizontal plane
  dustParticles.direction1 = new Vector3(-1, 0.02, -1);
  dustParticles.direction2 = new Vector3(1, 0.08, 1);
  dustParticles.minEmitPower = 1.0;
  dustParticles.maxEmitPower = 2.0;
  dustParticles.updateSpeed = 0.02;
  dustParticles.gravity = new Vector3(0, -0.12, 0);
  dustParticles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  dustParticles.targetStopDuration = 0.25;
  dustParticles.start();

  setTimeout(() => {
    dustParticles.dispose();
    emitterMesh.dispose();
  }, 2000);

  // 2. Expanding shockwave ring on ground (flat disc in XZ plane)
  const ringRadius = 0.25;
  const ring = MeshBuilder.CreateDisc('slam_ring', { radius: ringRadius, tessellation: 32 }, scene);
  ring.position = groundPos.clone();
  ring.rotation.x = Math.PI / 2; // Lay flat on ground (XZ plane)

  const ringMaterial = new StandardMaterial('slam_ring_material', scene);
  ringMaterial.emissiveColor = new Color3(0.58, 0.5, 0.42);
  ringMaterial.alpha = 0.78;
  ringMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  ringMaterial.backFaceCulling = false;
  ringMaterial.disableDepthWrite = true;
  ring.material = ringMaterial;
  ring.isPickable = false;

  const ringStartTime = Date.now();
  const ringDuration = 420;
  const maxRadius = 1.85;
  const ringObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - ringStartTime;
    const progress = Math.min(elapsed / ringDuration, 1.0);
    const currentRadius = ringRadius + (maxRadius - ringRadius) * progress;
    const scale = currentRadius / ringRadius;
    ring.scaling = new Vector3(scale, scale, 1);
    ringMaterial.alpha = 0.75 * (1 - progress);
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(ringObserver);
      if (ringMaterial && !ringMaterial.isDisposed) ringMaterial.dispose();
      ring.dispose();
    }
  });
}

/**
 * Play slam (ground AoE) VFX - ground slam effect at 1.6s when attack connects.
 */
function playSlamVfx(scene, spellDef, startPos, endPos, castStartTime) {
  const SLAM_IMPACT_DELAY_MS = 1600;
  const now = Date.now();
  const delay = Math.max(0, castStartTime + SLAM_IMPACT_DELAY_MS - now);
  const slamPos = endPos.clone(); // Self-target: endPos = caster position
  setTimeout(() => {
    createSlamGroundEffect(slamPos, scene);
  }, delay);
}

/**
 * Create taunt shouting effect - short red shockwave pulse from warrior's feet with air distortion ripple outward.
 */
function createTauntShockwaveEffect(position, scene) {
  if (!scene || scene.isDisposed) return;
  const groundPos = new Vector3(position.x, 0.08, position.z);

  // 1. Air distortion ripple - subtle, slightly above ground
  const ringRadius = 0.25;
  const rippleY = 0.18;
  const ripplePos = new Vector3(groundPos.x, rippleY, groundPos.z);
  const ripple = MeshBuilder.CreateDisc('taunt_ripple', { radius: ringRadius, tessellation: 32 }, scene);
  ripple.position = ripplePos;
  ripple.rotation.x = Math.PI / 2;

  const rippleMaterial = new StandardMaterial('taunt_ripple_material', scene);
  rippleMaterial.emissiveColor = new Color3(0.9, 0.35, 0.3);
  rippleMaterial.alpha = 0.25;
  rippleMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  rippleMaterial.backFaceCulling = false;
  rippleMaterial.disableDepthWrite = true;
  ripple.material = rippleMaterial;
  ripple.isPickable = false;

  const rippleStartTime = Date.now();
  const rippleDuration = 380;
  // Slightly smaller final size so the red ring clearly overtakes it
  const rippleMaxRadius = 1.1;
  const rippleObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - rippleStartTime;
    const progress = Math.min(elapsed / rippleDuration, 1.0);
    const currentRadius = ringRadius + (rippleMaxRadius - ringRadius) * progress;
    const scale = currentRadius / ringRadius;
    ripple.scaling = new Vector3(scale, scale, 1);
    rippleMaterial.alpha = 0.45 * (1 - progress);
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(rippleObserver);
      if (rippleMaterial && !rippleMaterial.isDisposed) rippleMaterial.dispose();
      ripple.dispose();
    }
  });

  // 2. Red shockwave ring - draw last and slightly higher so it visually sits on top
  const ring = MeshBuilder.CreateDisc('taunt_ring', { radius: ringRadius, tessellation: 32 }, scene);
  ring.position = groundPos.clone();
  ring.rotation.x = Math.PI / 2;

  const ringMaterial = new StandardMaterial('taunt_ring_material', scene);
  // Make the ring very bright and obviously red
  ringMaterial.diffuseColor = new Color3(1.0, 0.0, 0.0);
  ringMaterial.emissiveColor = new Color3(1.0, 0.2, 0.15);
  ringMaterial.alpha = 1.0;
  ringMaterial.disableLighting = true; // Ignore scene lights so color is not washed out
  ringMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  ringMaterial.backFaceCulling = false;
  ringMaterial.disableDepthWrite = true;
  ring.material = ringMaterial;
  ring.isPickable = false;

  const ringStartTime = Date.now();
  const ringDuration = 360;
  // Make red ring grow noticeably larger than the grey ripple
  const maxRadius = 1.6;
  const ringObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - ringStartTime;
    const progress = Math.min(elapsed / ringDuration, 1.0);
    const currentRadius = ringRadius + (maxRadius - ringRadius) * progress;
    const scale = currentRadius / ringRadius;
    ring.scaling = new Vector3(scale, scale, 1);
    ringMaterial.alpha = 0.9 * (1 - progress);
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(ringObserver);
      if (ringMaterial && !ringMaterial.isDisposed) ringMaterial.dispose();
      ring.dispose();
    }
  });
}

/**
 * Play taunt (shout) VFX - red shockwave pulse from caster's feet at impact time.
 */
function playTauntVfx(scene, spellDef, startPos, endPos, castStartTime) {
  const TAUNT_IMPACT_DELAY_MS = 320;
  const now = Date.now();
  const delay = Math.max(0, castStartTime + TAUNT_IMPACT_DELAY_MS - now);
  const tauntPos = endPos.clone();
  setTimeout(() => {
    createTauntShockwaveEffect(tauntPos, scene);
  }, delay);
}

/**
 * Create holy crest texture - radiant insignia in gold and soft white.
 */
function createHolyCrestTexture(scene) {
  const size = 128;
  const texture = new DynamicTexture('aid_crest_texture', size, scene, false);
  const ctx = texture.getContext();
  const c = size / 2;

  ctx.clearRect(0, 0, size, size);
  const grd = ctx.createRadialGradient(c, c, 0, c, c, c);
  grd.addColorStop(0, 'rgba(255, 250, 235, 0.95)');
  grd.addColorStop(0.4, 'rgba(255, 215, 120, 0.7)');
  grd.addColorStop(0.7, 'rgba(218, 165, 32, 0.4)');
  grd.addColorStop(1, 'rgba(255, 250, 235, 0)');
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 248, 220, 0.9)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  const r = c * 0.45;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255, 215, 100, 0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  texture.update();
  return texture;
}

/**
 * Create aid radiant effect - holy insignia crest, shimmer particles, downward drift (centered on hand), chest glow.
 * @param {Vector3} handPos - Hand position
 * @param {Vector3} chestPos - Character center / chest position
 * @param {Scene} scene - Babylon.js scene
 */
function createAidRadiantEffect(handPos, chestPos, scene) {
  if (!scene || scene.isDisposed) return;
  const pos = handPos.clone();

  // 1. Expanding holy aura ring - explodes outward from center
  const ringRadius = 0.15;
  const crest = MeshBuilder.CreateTorus('aid_crest', { diameter: ringRadius * 2, thickness: 0.02, tessellation: 32 }, scene);
  crest.position = pos.clone();
  crest.rotation.x = Math.PI / 2; // Lie flat (XZ plane)
  const crestMat = new StandardMaterial('aid_crest_mat', scene);
  crestMat.emissiveColor = new Color3(0.98, 0.93, 0.78);
  crestMat.alpha = 0.88;
  crestMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  crestMat.backFaceCulling = false;
  crestMat.disableDepthWrite = true;
  crest.material = crestMat;
  crest.isPickable = false;

  const crestStart = Date.now();
  const crestDur = 1100;
  const expandDur = 0.7; // 70% of duration: burst from point to full size
  const maxScale = 2.5; // Ring expands to 2.5x base size
  crest.scaling = new Vector3(0.01, 0.01, 0.01);
  const crestObs = scene.onBeforeRenderObservable.add(() => {
    const t = (Date.now() - crestStart) / crestDur;
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(crestObs);
      crestMat.dispose();
      crest.dispose();
      return;
    }
    const growT = Math.min(t / expandDur, 1);
    const scale = 0.01 + (maxScale - 0.01) * (1 - Math.pow(1 - growT, 2)); // Ease-out: burst then settle
    crest.scaling.set(scale, scale, scale);
    crest.position.y = pos.y + Math.sin(t * Math.PI * 2) * 0.05;
    crestMat.alpha = 0.88 * (1 - t);
  });

  // 2. Shimmer particles - dust in sunlight, gold and white
  const shimmerEmitter = MeshBuilder.CreateSphere('aid_shimmer_emitter', { diameter: 0.5 }, scene);
  shimmerEmitter.position = pos.clone();
  shimmerEmitter.isVisible = false;

  const shimmer = new ParticleSystem('aid_shimmer', 150, scene);
  shimmer.particleTexture = createStarTexture(scene);
  shimmer.emitter = shimmerEmitter;
  shimmer.minEmitBox = new Vector3(-0.15, -0.08, -0.15);
  shimmer.maxEmitBox = new Vector3(0.15, 0.1, 0.15);
  shimmer.color1 = new Color4(1, 0.98, 0.85, 0.9);
  shimmer.color2 = new Color4(1, 0.92, 0.7, 0.6);
  shimmer.colorDead = new Color4(0.95, 0.85, 0.5, 0);
  shimmer.minSize = 0.04;
  shimmer.maxSize = 0.1;
  shimmer.minLifeTime = 0.3;
  shimmer.maxLifeTime = 0.65;
  shimmer.emitRate = 80;
  shimmer.direction1 = new Vector3(-0.3, -0.7, -0.3);
  shimmer.direction2 = new Vector3(0.3, -0.3, 0.3);
  shimmer.minEmitPower = 0.08;
  shimmer.maxEmitPower = 0.22;
  shimmer.updateSpeed = 0.02;
  shimmer.gravity = new Vector3(0, -0.18, 0);
  shimmer.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  shimmer.targetStopDuration = 0.7;
  shimmer.start();

  setTimeout(() => {
    shimmer.dispose();
    shimmerEmitter.dispose();
  }, 1400);

  // 3. Faint downward drifting particles
  const driftEmitter = MeshBuilder.CreateSphere('aid_drift_emitter', { diameter: 0.25 }, scene);
  driftEmitter.position = pos.clone();
  driftEmitter.isVisible = false;

  const drift = new ParticleSystem('aid_drift', 100, scene);
  drift.particleTexture = createParticleTexture(scene);
  drift.emitter = driftEmitter;
  drift.minEmitBox = new Vector3(-0.1, -0.06, -0.1);
  drift.maxEmitBox = new Vector3(0.1, 0.06, 0.1);
  drift.color1 = new Color4(1, 0.95, 0.8, 0.5);
  drift.color2 = new Color4(0.95, 0.88, 0.6, 0.35);
  drift.colorDead = new Color4(0.9, 0.82, 0.55, 0);
  drift.minSize = 0.05;
  drift.maxSize = 0.12;
  drift.minLifeTime = 0.35;
  drift.maxLifeTime = 0.75;
  drift.emitRate = 55;
  drift.direction1 = new Vector3(-0.15, -0.98, -0.15);
  drift.direction2 = new Vector3(0.15, -0.9, 0.15);
  drift.minEmitPower = 0.15;
  drift.maxEmitPower = 0.35;
  drift.updateSpeed = 0.025;
  drift.gravity = new Vector3(0, -0.25, 0);
  drift.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  drift.targetStopDuration = 0.6;
  drift.start();

  setTimeout(() => {
    drift.dispose();
    driftEmitter.dispose();
  }, 1300);

  // 4. Second expanding ring - same position as first, rotated 90°
  const chestRing = MeshBuilder.CreateTorus('aid_chest_ring', { diameter: ringRadius * 2, thickness: 0.02, tessellation: 32 }, scene);
  chestRing.position = pos.clone();
  chestRing.rotation.x = Math.PI / 2;
  chestRing.rotation.y = Math.PI / 2;
  const chestRingMat = new StandardMaterial('aid_chest_ring_mat', scene);
  chestRingMat.emissiveColor = new Color3(0.98, 0.93, 0.78);
  chestRingMat.alpha = 0.88;
  chestRingMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
  chestRingMat.backFaceCulling = false;
  chestRingMat.disableDepthWrite = true;
  chestRing.material = chestRingMat;
  chestRing.isPickable = false;

  chestRing.scaling = new Vector3(0.01, 0.01, 0.01);
  const chestRingStart = Date.now();
  const chestRingDur = 1100;
  const chestRingExpandDur = 0.7;
  const chestRingMaxScale = 2.5;
  const chestRingObs = scene.onBeforeRenderObservable.add(() => {
    const t = (Date.now() - chestRingStart) / chestRingDur;
    if (t >= 1) {
      scene.onBeforeRenderObservable.remove(chestRingObs);
      chestRingMat.dispose();
      chestRing.dispose();
      return;
    }
    const growT = Math.min(t / chestRingExpandDur, 1);
    const scale = 0.01 + (chestRingMaxScale - 0.01) * (1 - Math.pow(1 - growT, 2));
    chestRing.scaling.set(scale, scale, scale);
    chestRingMat.alpha = 0.88 * (1 - t);
  });
}

/**
 * Play aid (self-heal) VFX - radiant holy crest, shimmer, drift around hand, chest ring at 800ms.
 */
function playAidVfx(scene, spellDef, startPos, endPos, castStartTime, options = {}) {
  const AID_VFX_DELAY_MS = 800;
  const castUserId = options?.castUserId;
  const now = Date.now();
  const delay = Math.max(0, castStartTime + AID_VFX_DELAY_MS - now);

  setTimeout(() => {
    let handPos = null;
    if (castUserId) {
      handPos = getBoneWorldPosition(scene, castUserId, 'RightHand') ||
        getBoneWorldPosition(scene, castUserId, 'mixamorig:RightHand');
    }
    if (!handPos) {
      handPos = endPos.clone();
      handPos.y += 0.55;
    }
    const chestPos = endPos.clone();
    chestPos.y = 1.1;
    createAidRadiantEffect(handPos, chestPos, scene);
  }, delay);
}

// ============================================================================
// TRAP VFX SYSTEM
// Visual effects for trap triggers
// ============================================================================

/**
 * Find a trap entity mesh at the given world position
 * @param {Scene} scene - Babylon.js scene
 * @param {Vector3} position - World position to search at
 * @returns {TransformNode|Mesh|null} The trap mesh/container or null if not found
 */
function findTrapMeshAtPosition(scene, position) {
  if (!scene.metadata || !scene.metadata.entityMeshes) {
    return null;
  }
  
  const tileSize = 1;
  const tolerance = tileSize * 0.5; // Allow some tolerance for position matching
  
  // Search through all entity meshes
  for (const [entityId, mesh] of scene.metadata.entityMeshes) {
    // Check if this is a trap entity
    if (mesh.metadata && mesh.metadata.entityType === 'trap') {
      // Check if position matches (using grid position if available, otherwise world position)
      if (mesh.metadata.gridPosition) {
        const gridX = mesh.metadata.gridPosition.x;
        const gridY = mesh.metadata.gridPosition.y;
        const worldX = gridX * tileSize;
        const worldZ = gridY * tileSize;
        
        if (Math.abs(worldX - position.x) < tolerance && Math.abs(worldZ - position.z) < tolerance) {
          return mesh;
        }
      } else if (mesh.position) {
        // Fallback to world position comparison
        if (Math.abs(mesh.position.x - position.x) < tolerance && 
            Math.abs(mesh.position.z - position.z) < tolerance) {
          return mesh;
        }
      }
    }
  }
  
  return null;
}

/**
 * Play trap trigger VFX at the specified position
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} trapData - Trap trigger data from server
 * @param {string} trapData.entitySubtype - Type of trap (e.g., 'spike_trap')
 * @param {Object} trapData.position - Position where trap triggered { x, y }
 * @param {number} trapData.damage - Damage dealt by the trap
 */
export function playTrapTriggerVfx(scene, trapData) {
  const { entitySubtype, position, damage } = trapData;
  const tileSize = 1;
  
  // Convert grid position to world position
  const worldPos = new Vector3(position.x * tileSize, 0.1, position.y * tileSize);
  
  // Route to specific trap VFX handler based on subtype
  switch (entitySubtype) {
    case 'spike_trap':
      playSpikeTrapVfx(scene, worldPos, damage);
      break;
    default:
      // Default trap trigger effect
      playGenericTrapVfx(scene, worldPos, damage);
      break;
  }
}

/**
 * Play spike trap trigger VFX
 * Plays the trap model's animation and adds particle burst
 * If the trap mesh doesn't exist (hidden from enemy), spawns a temporary one.
 * @param {Scene} scene - Babylon.js scene
 * @param {Vector3} position - World position
 * @param {number} damage - Damage dealt
 */
function playSpikeTrapVfx(scene, position, damage) {
  // Find the trap entity mesh at this position and play its animation
  const trapMesh = findTrapMeshAtPosition(scene, position);
  
  if (trapMesh && trapMesh.metadata && trapMesh.metadata.animationGroups) {
    const animationGroups = trapMesh.metadata.animationGroups;
    
    // Check if removal animation is already handling this
    if (trapMesh.metadata.isAnimatingRemoval) {
      // Animation is already playing via removal handler, just add particles below
    } else if (animationGroups.length > 0) {
      // Play all animation groups at once (no individual logging to reduce overhead)
      animationGroups.forEach(animGroup => {
        animGroup.reset();
        animGroup.play(false);
      });
    }
  } else {
    // Trap mesh doesn't exist - either disposed already or hidden from this player (enemy)
    // Spawn a temporary trap mesh so the triggered player can see it
    spawnTemporaryTrapMesh(scene, position);
  }
  
  // Create blood/damage burst particle system
  const particleSystem = new ParticleSystem(`trapBurst`, 50, scene);
  
  // Use cached particle texture (don't create new one each time)
  particleSystem.particleTexture = getTrapParticleTexture(scene);
  // IMPORTANT: Don't dispose texture when particle system disposes (it's cached)
  particleSystem.disposeOnStop = false;
  
  // Emitter at trap position
  particleSystem.emitter = position.clone();
  particleSystem.emitter.y = 0.3;
  
  // Particle colors - blood red
  particleSystem.color1 = new Color4(0.8, 0.1, 0.1, 1.0);
  particleSystem.color2 = new Color4(0.6, 0.05, 0.05, 0.8);
  particleSystem.colorDead = new Color4(0.3, 0.02, 0.02, 0);
  
  // Particle size
  particleSystem.minSize = 0.05;
  particleSystem.maxSize = 0.15;
  
  // Particle lifetime
  particleSystem.minLifeTime = 0.3;
  particleSystem.maxLifeTime = 0.6;
  
  // Emission - burst
  particleSystem.emitRate = 200;
  particleSystem.manualEmitCount = 30;
  
  // Particle direction - upward burst
  particleSystem.direction1 = new Vector3(-0.5, 1, -0.5);
  particleSystem.direction2 = new Vector3(0.5, 2, 0.5);
  
  // Gravity pulls particles down
  particleSystem.gravity = new Vector3(0, -3, 0);
  
  // Start particle system
  particleSystem.start();
  
  // Stop and dispose after particles finish
  setTimeout(() => {
    particleSystem.stop();
    setTimeout(() => {
      // Don't dispose texture (it's cached and shared)
      particleSystem.particleTexture = null;
      particleSystem.dispose();
    }, 700);
  }, 200);
}

/**
 * Spawn a temporary trap mesh for VFX when the trap was hidden from this player
 * Loads the trap model, plays its animation, then disposes
 * @param {Scene} scene - Babylon.js scene
 * @param {Vector3} position - World position to spawn at
 */
async function spawnTemporaryTrapMesh(scene, position) {
  try {
    // Use cached trap asset for fast instantiation (no GLB parsing lag)
    const tempId = `temp_trap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Adjust Y position to match regular trap placement (position.y is for particles at 0.1)
    const trapPosition = position.clone();
    trapPosition.y = 0.01; // Slightly above ground to be visible over hit tile effect
    
    const trapInstance = await createTrapInstance(scene, tempId, trapPosition);
    const tempContainer = trapInstance.container;
    const animationGroups = trapInstance.animationGroups;
    
    // Play animations
    let longestDuration = 0;
    if (animationGroups && animationGroups.length > 0) {
      animationGroups.forEach(animGroup => {
        // Calculate duration
        const fps = animGroup.targetedAnimations?.[0]?.animation?.framePerSecond || 30;
        const fromFrame = animGroup.from || 0;
        const toFrame = animGroup.to || 0;
        const durationMs = ((toFrame - fromFrame) / fps) * 1000;
        
        if (durationMs > longestDuration) {
          longestDuration = durationMs;
        }
        
        // Play animation once
        animGroup.reset();
        animGroup.play(false);
      });
    }
    
    // Schedule disposal after animation
    const disposalDelay = Math.max(longestDuration + 500, 1500);
    
    setTimeout(() => {
      // Stop and dispose animation groups (they're cloned instances, not shared)
      if (animationGroups) {
        animationGroups.forEach(ag => {
          ag.stop();
          ag.dispose(); // Must dispose cloned animation groups to prevent leaks
        });
      }
      
      // Dispose container and all children
      // Note: Don't dispose materials as they're shared from the AssetContainer
      tempContainer.getChildMeshes().forEach(m => {
        m.dispose(false, false); // Don't dispose materials
      });
      tempContainer.dispose();
    }, disposalDelay);
    
  } catch (error) {
    console.error('[TrapVFX] Failed to spawn temporary trap mesh:', error);
    
    // Fallback: create a simple visual indicator if cache fails
    const fallbackMesh = MeshBuilder.CreateBox('fallback_trap', {
      width: 0.6,
      height: 0.15,
      depth: 0.6
    }, scene);
    fallbackMesh.position = position.clone();
    fallbackMesh.position.y = 0.01; // Match regular trap position
    
    const fallbackMat = new StandardMaterial('fallback_trap_mat', scene);
    fallbackMat.diffuseColor = new Color3(0.3, 0.2, 0.2);
    fallbackMat.emissiveColor = new Color3(0.1, 0.05, 0.05);
    fallbackMesh.material = fallbackMat;
    
    // Dispose after a short time
    setTimeout(() => {
      fallbackMat.dispose();
      fallbackMesh.dispose();
    }, 1500);
  }
}

/**
 * Get or create cached trap particle texture
 * Uses scene metadata cache to avoid creating new textures repeatedly
 * @param {Scene} scene - Babylon.js scene
 * @returns {DynamicTexture} Cached particle texture
 */
function getTrapParticleTexture(scene) {
  const cacheKey = CACHE_PREFIX + 'trapParticleTexture';
  
  // Return cached texture if available
  if (scene.metadata && scene.metadata[cacheKey]) {
    return scene.metadata[cacheKey];
  }
  
  // Create new texture and cache it
  const size = 32;
  const texture = new DynamicTexture('trapParticleTex_cached', size, scene, false);
  const context = texture.getContext();
  
  // Draw a simple circular gradient
  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.5, 'rgba(255, 200, 200, 0.8)');
  gradient.addColorStop(1, 'rgba(255, 100, 100, 0)');
  
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  
  texture.update();
  texture.hasAlpha = true;
  
  // Cache in scene metadata
  if (!scene.metadata) {
    scene.metadata = {};
  }
  scene.metadata[cacheKey] = texture;
  
  return texture;
}

/**
 * Play generic trap trigger VFX (fallback for unknown trap types)
 * @param {Scene} scene - Babylon.js scene
 * @param {Vector3} position - World position
 * @param {number} damage - Damage dealt
 */
function playGenericTrapVfx(scene, position, damage) {
  // Simple flash effect
  const flash = MeshBuilder.CreatePlane(`trapFlash_${Date.now()}`, {
    width: 1,
    height: 1
  }, scene);
  
  flash.position = position.clone();
  flash.position.y = 0.1;
  flash.rotation.x = Math.PI / 2; // Lay flat on ground
  
  const flashMaterial = new StandardMaterial(`flashMat_${Date.now()}`, scene);
  flashMaterial.diffuseColor = new Color3(1, 0.5, 0);
  flashMaterial.emissiveColor = new Color3(1, 0.8, 0);
  flashMaterial.alpha = 0.8;
  flashMaterial.backFaceCulling = false;
  flash.material = flashMaterial;
  
  // Animate flash expanding and fading
  const scaleAnimation = new Animation(
    'flashScale',
    'scaling',
    60,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  
  scaleAnimation.setKeys([
    { frame: 0, value: new Vector3(0.3, 0.3, 0.3) },
    { frame: 15, value: new Vector3(1.5, 1.5, 1.5) }
  ]);
  
  const alphaAnimation = new Animation(
    'flashAlpha',
    'material.alpha',
    60,
    Animation.ANIMATIONTYPE_FLOAT,
    Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  
  alphaAnimation.setKeys([
    { frame: 0, value: 0.8 },
    { frame: 15, value: 0 }
  ]);
  
  flash.animations = [scaleAnimation, alphaAnimation];
  scene.beginAnimation(flash, 0, 15, false, 1.0, () => {
    flashMaterial.dispose();
    flash.dispose();
  });
}
