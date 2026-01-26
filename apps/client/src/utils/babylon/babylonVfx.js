/**
 * Visual Effects (VFX) system for Babylon.js spells
 * Handles rendering of spell projectiles, impacts, and ground effects
 */

import { MeshBuilder, StandardMaterial, Color3, Color4, Vector3, Animation, AnimationGroup, ParticleSystem, Texture, DynamicTexture, Material } from '@babylonjs/core';

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
 */
function createDiamondTexture(scene) {
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
 */
function createLineStreakTexture(scene) {
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
  // Larger emit box to ensure particles are visible
  particleSystem.minEmitBox = new Vector3(-0.2, -0.2, -0.2);
  particleSystem.maxEmitBox = new Vector3(0.2, 0.2, 0.2);
  
  // Particle colors (fire colors: orange to yellow to red)
  particleSystem.color1 = new Color4(1.0, 0.5, 0.0, 1.0); // Orange
  particleSystem.color2 = new Color4(1.0, 0.8, 0.0, 1.0); // Yellow
  particleSystem.colorDead = new Color4(0.8, 0.2, 0.0, 0.0); // Fade to dark red
  
  // Particle size - make them larger and more visible
  particleSystem.minSize = particleConfig.minSize || 0.15;
  particleSystem.maxSize = particleConfig.maxSize || 0.3;
  
  // Particle lifetime
  particleSystem.minLifeTime = particleConfig.minLifeTime || 0.2;
  particleSystem.maxLifeTime = particleConfig.maxLifeTime || 0.5;
  
  // Emission rate - higher for more visible effect
  particleSystem.emitRate = particleConfig.emitRate || 150;
  
  // Direction and speed - particles spread outward from center
  particleSystem.direction1 = new Vector3(-1, -1, -1);
  particleSystem.direction2 = new Vector3(1, 1, 1);
  particleSystem.minEmitPower = particleConfig.minEmitPower || 0.3;
  particleSystem.maxEmitPower = particleConfig.maxEmitPower || 1.0;
  particleSystem.updateSpeed = 0.02;
  
  // Gravity (slight upward drift)
  particleSystem.gravity = new Vector3(0, 0.1, 0);
  
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
  
  console.log(`Starting curved projectile animation: arcLength=${arcLength.toFixed(2)}, speed=${adjustedSpeed.toFixed(2)}, pattern=${curvePattern}, duration=${duration.toFixed(2)}s`);
  
  const startTime = Date.now();
  const speed = adjustedSpeed;
  
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
    lastPosition: startPos.clone() // For orientation
  };
  
  // Use scene's render loop to update position along curve
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!projectileMesh || !projectileMesh.metadata) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
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
    
    // Calculate direction for orientation (optional - can orient missile along path)
    const direction = newPos.subtract(projectileMesh.metadata.lastPosition);
    if (direction.length() > 0.001) {
      direction.normalize();
      // Optional: Orient missile along path
      // projectileMesh.lookAt(newPos.add(direction));
    }
    projectileMesh.metadata.lastPosition = newPos.clone();
    
    // Store references locally to avoid issues if metadata is cleared
    const metadata = projectileMesh.metadata;
    if (!metadata) {
      scene.onBeforeRenderObservable.remove(observer);
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
      
      // Dispose particle system if it exists
      if (particleSys) {
        particleSys.dispose();
      }
      
      // Only call onComplete if explosion wasn't already triggered
      if (!wasTriggered && onCompleteCallback) {
        onCompleteCallback();
      }
      console.log('Curved projectile reached destination');
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
  
  console.log('Curved projectile animation observer added');
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
 */
function animateProjectile(projectileMesh, startPos, endPos, speedCellsPerSec, scene, onComplete, particleSystem = null) {
  const distance = Vector3.Distance(startPos, endPos);
  const duration = distance / speedCellsPerSec; // Duration in seconds
  
  console.log(`Starting projectile animation: distance=${distance.toFixed(2)}, speed=${speedCellsPerSec}, duration=${duration.toFixed(2)}s`);
  console.log(`Start: (${startPos.x.toFixed(2)}, ${startPos.y.toFixed(2)}, ${startPos.z.toFixed(2)}), End: (${endPos.x.toFixed(2)}, ${endPos.y.toFixed(2)}, ${endPos.z.toFixed(2)})`);
  
  // Use render loop for smooth animation instead of Animation.CreateAndStartAnimation
  const startTime = Date.now();
  const speed = speedCellsPerSec; // units per second
  
  // Store animation state in mesh metadata
  projectileMesh.metadata = {
    startPos: startPos.clone(),
    endPos: endPos.clone(),
    speed: speed,
    startTime: startTime,
    onComplete: onComplete,
    observer: null, // Will store observer reference
    particleSystem: particleSystem // Store particle system for cleanup
  };
  
  // Store positions locally to avoid null reference issues
  const startPosLocal = startPos.clone();
  const endPosLocal = endPos.clone();
  
  // Use scene's render loop to update position
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!projectileMesh || !projectileMesh.metadata) {
      if (observer) {
        scene.onBeforeRenderObservable.remove(observer);
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
      if (projectileMesh.metadata.onComplete) {
        projectileMesh.metadata.onComplete();
      }
    }
    
    if (distanceTraveled >= totalDistance) {
      // Reached destination
      projectileMesh.position = endPosLocal.clone();
      scene.onBeforeRenderObservable.remove(observer);
      
      // Dispose particle system if it exists (stored in metadata)
      if (projectileMesh.metadata.particleSystem) {
        projectileMesh.metadata.particleSystem.dispose();
      }
      
      // Only call onComplete if explosion wasn't already triggered
      if (!projectileMesh.metadata.explosionTriggered && projectileMesh.metadata.onComplete) {
        projectileMesh.metadata.onComplete();
      }
      projectileMesh.metadata = null;
      console.log('Projectile reached destination');
    } else {
      // Interpolate position using local copies
      const t = distanceTraveled / totalDistance;
      const newPos = new Vector3(
        startPosLocal.x + (endPosLocal.x - startPosLocal.x) * t,
        startPosLocal.y + (endPosLocal.y - startPosLocal.y) * t,
        startPosLocal.z + (endPosLocal.z - startPosLocal.z) * t
      );
      projectileMesh.position = newPos;
    }
  });
  
  // Store observer reference
  projectileMesh.metadata.observer = observer;
  
  // Ensure mesh is visible
  projectileMesh.isVisible = true;
  projectileMesh.setEnabled(true);
  
  console.log('Projectile animation observer added, mesh visible:', projectileMesh.isVisible);
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
  // Raise explosion position slightly higher
  const explosionPos = position.clone();
  explosionPos.y += 0.3; // Raise explosion by 0.3 units
  createExplosionParticles(explosionPos, scene, {
    minSize: 0.15,
    maxSize: 0.25,
    minLifeTime: 0.3,
    maxLifeTime: 0.8,
    emitRate: 300,
    minEmitPower: 1.0,
    maxEmitPower: 2.0,
    burstDuration: 0.2 // 200ms burst
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
        groundMesh.dispose();
      }, fadeDuration);
    }, fadeStart);
  } else if (groundEffectVfxDef.duration) {
    // Clean up after duration
    setTimeout(() => {
      groundMesh.dispose();
    }, groundEffectVfxDef.duration);
  }
  
  return groundMesh;
}

/**
 * Play fireball VFX
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition with VFX
 * @param {Vector3} startPos - Start position (caster position)
 * @param {Vector3} endPos - End position (target position)
 * @param {number} castStartTime - Timestamp when cast animation started
 */
export function playFireballVfx(scene, spellDef, startPos, endPos, castStartTime) {
  const presentation = spellDef.presentation;
  if (!presentation) {
    console.warn('Fireball VFX: No presentation data found in spell definition');
    return;
  }
  
  const projectileVfx = presentation.projectileVfx;
  const impactVfx = presentation.impactVfxDef;
  
  // If no VFX components, skip
  if (!projectileVfx && !impactVfx) {
    console.warn('Fireball VFX: No VFX components found (projectileVfx or impactVfxDef)');
    return;
  }
  
  console.log('Playing fireball VFX:', {
    hasProjectile: !!projectileVfx,
    hasImpact: !!impactVfx,
    startPos: { x: startPos.x, y: startPos.y, z: startPos.z },
    endPos: { x: endPos.x, y: endPos.y, z: endPos.z }
  });
  
  // Calculate start delay: add 150ms to match character animation + any projectileVfx delay
  const baseDelay = 600; // 150ms delay to match character animation
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
      
      // Create projectile with modified opacity (10% transparent)
      // Clone the vfx definition to avoid modifying the original
      const modifiedVfx = { ...projectileVfx.vfx, opacity: 0.05 };
      const projectileMesh = createVfxMesh(modifiedVfx, scene, 'fireball_projectile');
      
      // Ensure transparency settings are correct
      if (projectileMesh.material) {
        projectileMesh.material.alpha = 0.05;
        // Set transparency mode for proper alpha blending
        projectileMesh.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
        // Ensure back face culling is disabled for transparency to work properly
        projectileMesh.material.backFaceCulling = false;
        // Disable depth write for proper transparency blending
        projectileMesh.material.disableDepthWrite = true;
      }
      
      // Position projectile at start with height offset
      const projectileStart = startPos.clone();
      const heightOffset = projectileVfx.heightOffset || 0.5;
      projectileStart.y = startPos.y + heightOffset;
      
      // Calculate end position with height offset
      const projectileEnd = endPos.clone();
      projectileEnd.y = endPos.y + heightOffset;
      
      // Set initial position
      projectileMesh.position = projectileStart.clone();
      
      // Ensure mesh is visible and enabled, and parented to scene
      projectileMesh.isVisible = true;
      projectileMesh.setEnabled(true);
      projectileMesh.parent = null; // Ensure it's directly in the scene
      
      // Force update
      projectileMesh.computeWorldMatrix(true);
      
      console.log('Created fireball projectile:', {
        start: `(${projectileStart.x.toFixed(2)}, ${projectileStart.y.toFixed(2)}, ${projectileStart.z.toFixed(2)})`,
        end: `(${projectileEnd.x.toFixed(2)}, ${projectileEnd.y.toFixed(2)}, ${projectileEnd.z.toFixed(2)})`,
        meshPosition: `(${projectileMesh.position.x.toFixed(2)}, ${projectileMesh.position.y.toFixed(2)}, ${projectileMesh.position.z.toFixed(2)})`,
        meshWorldPos: projectileMesh.getAbsolutePosition() ? `(${projectileMesh.getAbsolutePosition().x.toFixed(2)}, ${projectileMesh.getAbsolutePosition().y.toFixed(2)}, ${projectileMesh.getAbsolutePosition().z.toFixed(2)})` : 'N/A',
        visible: projectileMesh.isVisible,
        enabled: projectileMesh.isEnabled(),
        inScene: scene.meshes.includes(projectileMesh)
      });
      
      // Create particle system around projectile
      const particleSystem = createProjectileParticles(projectileMesh, scene, {
        minSize: 0.15,
        maxSize: 0.3,
        minLifeTime: 0.2,
        maxLifeTime: 0.5,
        emitRate: 150,
        minEmitPower: 0.3,
        maxEmitPower: 1.0
      });
      
      // Animate projectile (1.5x faster)
      animateProjectile(
        projectileMesh,
        projectileStart,
        projectileEnd,
        projectileVfx.speedCellsPerSec * 1.5,
        scene,
        () => {
          // Projectile reached destination - create impact
          // Dispose particle system first
          if (particleSystem) {
            particleSystem.dispose();
          }
          projectileMesh.dispose();
          
          // Create impact explosion (reduced delay for better sync with projectile)
          if (impactVfx) {
            const impactDelay = impactVfx.delayMs || 0; // Removed the 200ms delay for better sync
            setTimeout(() => {
              createExplosion(impactVfx, endPos, scene, 'fireball_impact');
            }, impactDelay);
          }
        },
        particleSystem // Pass particle system for cleanup
      );
    } else {
      // No projectile, but we might have impact
      // Create impact (add 200ms delay for this spell)
      if (impactVfx) {
        const impactDelay = (impactVfx.delayMs || 0) + 200; // Add 200ms delay
        setTimeout(() => {
          createExplosion(impactVfx, endPos, scene, 'fireball_impact');
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
  
  console.log('Playing heal VFX:', {
    hasImpact: !!impactVfx,
    startPos: { x: startPos.x, y: startPos.y, z: startPos.z },
    endPos: { x: endPos.x, y: endPos.y, z: endPos.z }
  });
  
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
 * Create arcane missile core (Layer 1): Diamond/crystal construct with glow wrapping around geometry
 */
function createArcaneMissileCore(scene, name) {
  // Create an elongated crystal/diamond shape - elongated along forward axis
  // Create main crystal body (elongated diamond pointing forward)
  const core = MeshBuilder.CreateBox(`${name}_core`, {
    width: 0.12,   // Narrow width (X axis)
    height: 0.2,   // Elongated length (Y axis - forward direction)
    depth: 0.12    // Narrow depth (Z axis)
  }, scene);
  
  // Rotate 45 degrees on Z axis to create diamond cross-section when viewed from above
  core.rotation.z = Math.PI / 4; // 45 degree rotation for diamond silhouette
  
  // Create material - glow wraps around geometry, not defining it
  const material = new StandardMaterial(`${name}_core_material`, scene);
  material.emissiveColor = new Color3(0.7, 0.4, 1.0); // Rich arcane purple glow
  material.diffuseColor = new Color3(0.5, 0.2, 0.8); // Deep violet
  material.alpha = 0.9;
  material.specularColor = new Color3(0.9, 0.7, 1.0); // Soft purple specular for edges
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  
  core.material = material;
  core.isPickable = false;
  
  // Add subtle pulsing animation - controlled, geometric
  const pulseSpeed = 6.0; // 6 pulses per second
  const startTime = Date.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    // Subtle pulse - maintains sharp silhouette
    const pulse = 0.92 + 0.08 * Math.sin(elapsed * pulseSpeed * Math.PI * 2);
    core.scaling = new Vector3(pulse, pulse, pulse);
    
    // Pulse brightness - energy bound to geometry
    const brightness = 0.85 + 0.15 * Math.sin(elapsed * pulseSpeed * Math.PI * 2);
    material.emissiveColor = new Color3(0.7 * brightness, 0.4 * brightness, 1.0 * brightness);
  });
  
  core.metadata = { observer };
  
  return core;
}

/**
 * Create arcane missile trail (Layer 2): Structured linear energy ribbon with thin streaks and angular flow
 */
function createArcaneMissileTrail(projectileMesh, scene, name) {
  // Primary trail: Linear energy ribbon using line-streak particles
  const ribbonParticles = new ParticleSystem(`${name}_trail_ribbon`, 80, scene);
  
  // Use line-streak texture for structured, linear appearance
  ribbonParticles.particleTexture = createLineStreakTexture(scene);
  
  ribbonParticles.emitter = projectileMesh;
  ribbonParticles.minEmitBox = new Vector3(-0.03, -0.03, -0.03);
  ribbonParticles.maxEmitBox = new Vector3(0.03, 0.03, 0.03);
  
  // Rich arcane purple/violet colors - primary trail identity
  ribbonParticles.color1 = new Color4(0.7, 0.4, 1.0, 0.9); // Rich arcane purple
  ribbonParticles.color2 = new Color4(0.6, 0.3, 0.9, 0.7); // Deep violet
  ribbonParticles.colorDead = new Color4(0.4, 0.2, 0.7, 0.0); // Fade to dark violet
  
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
  
  ribbonParticles.start();
  
  // Secondary trail: Segmented facets using diamond particles for angular flow lines
  const facetParticles = new ParticleSystem(`${name}_trail_facets`, 40, scene);
  
  // Use diamond texture for angular, geometric segments
  facetParticles.particleTexture = createDiamondTexture(scene);
  
  facetParticles.emitter = projectileMesh;
  facetParticles.minEmitBox = new Vector3(-0.02, -0.02, -0.02);
  facetParticles.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
  
  // Purple/violet for layered effect with subtle cyan edge highlight
  facetParticles.color1 = new Color4(0.6, 0.3, 0.9, 0.6); // Deep violet
  facetParticles.color2 = new Color4(0.5, 0.2, 0.8, 0.4); // Darker violet
  facetParticles.colorDead = new Color4(0.3, 0.15, 0.6, 0.0); // Fade to dark purple
  
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
  
  facetParticles.start();
  
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
  
  // Arcane colors: rich purple/violet with soft magenta undertones
  particleSystem.color1 = new Color4(0.8, 0.5, 1.0, 1.0); // Rich purple with magenta
  particleSystem.color2 = new Color4(0.6, 0.3, 0.9, 1.0); // Deep violet
  particleSystem.colorDead = new Color4(0.4, 0.2, 0.7, 0.0); // Fade to dark violet
  
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
    material.emissiveColor = new Color3(0.6, 0.4, 0.9); // Rich violet with magenta undertones
    material.alpha = 0.4;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    
    mote.material = material;
    mote.isPickable = false;
    
    // Rotate slowly
    const startTime = Date.now();
    const rotationSpeed = 2.0; // Rotations per second
    const observer = scene.onBeforeRenderObservable.add(() => {
      if (!projectileMesh || !projectileMesh.metadata) {
        scene.onBeforeRenderObservable.remove(observer);
        return;
      }
      const elapsed = (Date.now() - startTime) / 1000;
      mote.rotation.y = elapsed * rotationSpeed * Math.PI * 2;
      mote.rotation.x = elapsed * rotationSpeed * 0.5 * Math.PI * 2;
      
      // Fade out over time
      const fadeTime = 0.3; // Fade in 300ms
      if (elapsed < fadeTime) {
        material.alpha = 0.4 * (elapsed / fadeTime);
      } else {
        material.alpha = 0.4 * (1 - (elapsed - fadeTime) / fadeTime);
        if (material.alpha <= 0) {
          scene.onBeforeRenderObservable.remove(observer);
          mote.dispose();
        }
      }
    });
    
    motes.push({ mote, observer });
  }
  
  return motes;
}

/**
 * Create arcane impact effect: Small, concentrated, precise discharge - NOT an explosion
 */
function createArcaneImpact(position, scene, name) {
  const impactPos = position.clone();
  impactPos.y += 0.3;
  
  // 1. Bright central hit point - Small white/cyan core (compact, focused)
  const coreGlow = MeshBuilder.CreateSphere(`${name}_core_glow`, {
    diameter: 0.08, // Much smaller - focused point
    segments: 12
  }, scene);
  coreGlow.position = impactPos.clone();
  
  const coreMaterial = new StandardMaterial(`${name}_core_material`, scene);
  coreMaterial.emissiveColor = new Color3(0.95, 0.95, 1.0); // Restrained white-hot center with slight purple tint
  coreMaterial.diffuseColor = new Color3(0.6, 0.3, 0.9); // Deep violet glow
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
      // Minimal expansion - stays focused
      coreGlow.scaling = new Vector3(1.0 + progress * 0.15, 1.0 + progress * 0.15, 1.0 + progress * 0.15);
    } else {
      scene.onBeforeRenderObservable.remove(coreObserver);
      coreGlow.dispose();
    }
  });
  
  // 2. Minimal geometric burst - Small diamond or star-shaped flare (very compact)
  const flareEmitter = MeshBuilder.CreateSphere(`${name}_flare_emitter`, { diameter: 0.02 }, scene);
  flareEmitter.position = impactPos.clone();
  flareEmitter.isVisible = false;
  
  const flareParticles = new ParticleSystem(`${name}_flare`, 25, scene); // Much fewer particles
  flareParticles.particleTexture = createDiamondTexture(scene);
  flareParticles.emitter = flareEmitter;
  flareParticles.minEmitBox = new Vector3(-0.01, -0.01, -0.01);
  flareParticles.maxEmitBox = new Vector3(0.01, 0.01, 0.01);
  
  // White → rich purple/violet
  flareParticles.color1 = new Color4(1.0, 1.0, 1.0, 1.0); // White
  flareParticles.color2 = new Color4(0.7, 0.4, 1.0, 1.0); // Rich arcane purple
  flareParticles.colorDead = new Color4(0.5, 0.2, 0.8, 0.0); // Fade to deep violet
  
  // Small, compact particles
  flareParticles.minSize = 0.04;
  flareParticles.maxSize = 0.08;
  flareParticles.minLifeTime = 0.08;
  flareParticles.maxLifeTime = 0.15;
  flareParticles.emitRate = 300; // Lower rate
  // Very tight, controlled burst - minimal spread
  flareParticles.direction1 = new Vector3(-0.4, -0.2, -0.4);
  flareParticles.direction2 = new Vector3(0.4, 0.2, 0.4);
  flareParticles.minEmitPower = 1.0;
  flareParticles.maxEmitPower = 2.0;
  flareParticles.updateSpeed = 0.02;
  flareParticles.gravity = new Vector3(0, 0, 0); // No gravity
  flareParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
  flareParticles.targetStopDuration = 0.1; // 100ms - very short
  
  flareParticles.start();
  
  // 3. Subtle arcane ring or glyph - Small, brief appearance
  const ringSize = 0.12; // Much smaller starting size
  const ring = MeshBuilder.CreateBox(`${name}_ring`, {
    size: ringSize,
    height: 0.005 // Very thin
  }, scene);
  ring.position = impactPos.clone();
  ring.rotation.x = Math.PI / 2; // Lay flat
  ring.rotation.z = Math.PI / 4; // Diamond orientation
  
  const ringMaterial = new StandardMaterial(`${name}_ring_material`, scene);
  ringMaterial.emissiveColor = new Color3(0.7, 0.4, 1.0); // Rich arcane purple
  ringMaterial.alpha = 0.8;
  ringMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  ringMaterial.backFaceCulling = false;
  ringMaterial.disableDepthWrite = true;
  
  ring.material = ringMaterial;
  ring.isPickable = false;
  
  // Ring expansion - small, brief (120ms)
  const ringStartTime = Date.now();
  const ringDuration = 120; // 120ms
  const maxSize = 0.35; // Much smaller max size - compact
  const ringObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = Date.now() - ringStartTime;
    const progress = Math.min(elapsed / ringDuration, 1.0);
    
    const currentSize = ringSize + (maxSize - ringSize) * progress;
    ring.scaling = new Vector3(currentSize / ringSize, 1, currentSize / ringSize);
    ringMaterial.alpha = 0.8 * (1 - progress); // Fade quickly
    
    if (progress >= 1.0) {
      scene.onBeforeRenderObservable.remove(ringObserver);
      ring.dispose();
    }
  });
  
  // Cleanup
  setTimeout(() => {
    flareParticles.dispose();
    flareEmitter.dispose();
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
export function playArcaneMissileVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex = 0, totalMissiles = 1) {
  const presentation = spellDef.presentation;
  if (!presentation) {
    console.warn('Arcane Missile VFX: No presentation data found');
    return;
  }
  
  const projectileVfx = presentation.projectileVfx;
  const impactVfx = presentation.impactVfxDef;
  
  // Calculate start delay
  const baseDelay = 600;
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
    projectileEnd.y = endPos.y + heightOffset;
    
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
    
    // Layer 1: Core
    const core = createArcaneMissileCore(scene, 'arcane_missile');
    core.position = projectileStart.clone();
    
    // Layer 2: Trail
    const trail = createArcaneMissileTrail(core, scene, 'arcane_missile');
    
    // Layer 3: Sparkles
    const sparkles = createArcaneSparkles(core, scene, 'arcane_missile');
    
    // Layer 4: Runic motes
    const motes = createRunicMotes(core, scene, 'arcane_missile');
    
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
        // Cleanup on impact
        if (core.metadata) {
          if (core.metadata.sparkles) core.metadata.sparkles.dispose();
          if (core.metadata.trail) {
            // Trail is now an object with ribbon and facets
            if (core.metadata.trail.ribbon) core.metadata.trail.ribbon.dispose();
            if (core.metadata.trail.facets) core.metadata.trail.facets.dispose();
          }
          if (core.metadata.motes) {
            core.metadata.motes.forEach(({ observer, mote }) => {
              scene.onBeforeRenderObservable.remove(observer);
              if (mote && !mote.isDisposed()) mote.dispose();
            });
          }
          if (core.metadata.observer) {
            scene.onBeforeRenderObservable.remove(core.metadata.observer);
          }
        }
        core.dispose();
        
        // Layer 5: Impact
        if (impactVfx) {
          const impactDelay = impactVfx.delayMs || 0;
          setTimeout(() => {
            createArcaneImpact(endPos, scene, 'arcane_missile');
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
 */
export function playSpellVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex = 0, totalMissiles = 1) {
  // Route to specific spell VFX handler
  if (spellDef.spellId === 'fireball') {
    playFireballVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'heal') {
    playHealVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'arcane_missile') {
    playArcaneMissileVfx(scene, spellDef, startPos, endPos, castStartTime, missileIndex, totalMissiles);
  } else {
    console.warn(`VFX not implemented for spell: ${spellDef.spellId}`);
  }
}
