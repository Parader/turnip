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
 * Play spell VFX based on spell definition
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} spellDef - Spell definition
 * @param {Vector3} startPos - Start position
 * @param {Vector3} endPos - End position
 * @param {number} castStartTime - Timestamp when cast started
 */
export function playSpellVfx(scene, spellDef, startPos, endPos, castStartTime) {
  // Route to specific spell VFX handler
  if (spellDef.spellId === 'fireball') {
    playFireballVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else if (spellDef.spellId === 'heal') {
    playHealVfx(scene, spellDef, startPos, endPos, castStartTime);
  } else {
    console.warn(`VFX not implemented for spell: ${spellDef.spellId}`);
  }
}
