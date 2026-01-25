/**
 * Arcane Missile VFX Renderer
 * Self-contained rendering class for arcane missile visual effects
 * Babylon.js v6+ (WebGL) compatible
 * 
 * @typedef {Object} ArcaneMissileRenderOptions
 * @property {number} [trailPoints=28] - Number of trail points to maintain
 * @property {number} [headWidth=0.12] - Width of trail at head
 * @property {number} [coreSize=0.2] - Diameter of missile core sphere
 * @property {BABYLON.Color3} [color1] - Primary arcane color (default: purple)
 * @property {BABYLON.Color3} [color2] - Secondary color (default: blue)
 * @property {boolean} [enableParticles=true] - Enable particle burst on impact
 * @property {boolean} [ringBillboard=true] - Make impact ring face camera
 * @property {boolean} [autoDisposeAfterImpact=true] - Auto-dispose after impact animation
 * @property {Function} [onDone] - Callback when impact animation completes
 */

import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  ParticleSystem,
  Texture,
  DynamicTexture,
  Animation
} from '@babylonjs/core';

// GlowLayer - In Babylon.js v8+, GlowLayer should be available from @babylonjs/core
// If you get an error, try: import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
// Or check if you need to install @babylonjs/layers package
// The ensureGlowLayer() method will handle missing GlowLayer gracefully with a stub

/**
 * Arcane Missile VFX Renderer Class
 * Handles rendering of missile core, trail, and impact effects
 */
export class ArcaneMissileRender {
  /**
   * @param {Scene} scene - Babylon.js scene
   * @param {ArcaneMissileRenderOptions} [options={}] - Configuration options
   */
  constructor(scene, options = {}) {
    this.scene = scene;
    
    // Options with defaults
    this.trailPoints = options.trailPoints || 28;
    this.headWidth = options.headWidth || 0.12;
    this.coreSize = options.coreSize || 0.2;
    this.color1 = options.color1 || new Color3(0.6, 0.4, 1.0); // Purple
    this.color2 = options.color2 || new Color3(0.4, 0.6, 1.0); // Blue
    this.enableParticles = options.enableParticles !== false;
    this.ringBillboard = options.ringBillboard !== false;
    this.autoDisposeAfterImpact = options.autoDisposeAfterImpact !== false;
    this.onDone = options.onDone || null;
    
    // State
    this.positionBuffer = [];
    this.lastForward = new Vector3(0, 0, 1);
    this.timeAccumulator = 0;
    this.isImpacted = false;
    this.impactStartTime = 0;
    
    // Reusable vectors (performance optimization)
    this._tempVec1 = new Vector3();
    this._tempVec2 = new Vector3();
    this._tempVec3 = new Vector3();
    this._tempVec4 = new Vector3();
    this._worldUp = new Vector3(0, 1, 0);
    
    // Meshes
    this.coreMesh = null;
    this.auraMesh = null;
    this.trailRibbon = null;
    this.impactFlash = null;
    this.impactRing = null;
    this.impactParticles = null;
    
    // Materials
    this.coreMaterial = null;
    this.auraMaterial = null;
    this.trailMaterial = null;
    this.impactFlashMaterial = null;
    this.impactRingMaterial = null;
    
    // Initialize glow layer
    this.ensureGlowLayer();
    
    // Create missile core and aura
    this.createCore();
    
    // Initialize trail
    this.trailPath = [];
    this.trailWidths = [];
  }
  
  /**
   * Ensure a GlowLayer exists on the scene
   */
  ensureGlowLayer() {
    if (!this.scene.metadata) {
      this.scene.metadata = {};
    }
    
    if (!this.scene.metadata.glowLayer) {
      // Try to get GlowLayer from @babylonjs/core
      // In v8+, it should be available directly or via subpath
      let GlowLayerClass = null;
      
      // Try direct access (if imported at top level)
      try {
        // Check if GlowLayer is available in the scene's engine or as a global
        // For now, we'll try to import it dynamically
        const core = this.scene.getEngine()._glowLayerClass || null;
        if (core) {
          GlowLayerClass = core;
        }
      } catch (e) {
        // Ignore
      }
      
      // If not found, try to require/import it
      if (!GlowLayerClass) {
        try {
          // Try ES6 import (if supported in this context)
          // Note: This may not work in all build systems, so we'll also try require
          if (typeof require !== 'undefined') {
            const coreModule = require('@babylonjs/core');
            GlowLayerClass = coreModule.GlowLayer;
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // If still not found, create a stub
      if (!GlowLayerClass) {
        console.warn('GlowLayer not found in @babylonjs/core, creating stub. Glow effects may not work.');
        GlowLayerClass = class GlowLayerStub {
          constructor(name, scene) {
            this.name = name;
            this.scene = scene;
            this.includedOnlyMeshes = [];
          }
          addIncludedOnlyMesh(mesh) {
            this.includedOnlyMeshes.push(mesh);
          }
        };
      }
      
      this.scene.metadata.glowLayer = new GlowLayerClass('glowLayer', this.scene);
      console.log('Created GlowLayer for scene');
    }
    
    this.glowLayer = this.scene.metadata.glowLayer;
  }
  
  /**
   * Create missile core (sphere) and aura
   */
  createCore() {
    // Core sphere
    this.coreMesh = MeshBuilder.CreateSphere('arcaneMissileCore', {
      diameter: this.coreSize,
      segments: 16
    }, this.scene);
    
    this.coreMaterial = new StandardMaterial('arcaneMissileCoreMat', this.scene);
    this.coreMaterial.emissiveColor = this.color1.clone();
    this.coreMaterial.disableLighting = true;
    this.coreMaterial.alpha = 1.0;
    this.coreMesh.material = this.coreMaterial;
    this.coreMesh.isVisible = false;
    
    // Add to glow layer
    this.glowLayer.addIncludedOnlyMesh(this.coreMesh);
    
    // Aura sphere (slightly larger, semi-transparent)
    const auraSize = this.coreSize * 1.4;
    this.auraMesh = MeshBuilder.CreateSphere('arcaneMissileAura', {
      diameter: auraSize,
      segments: 16
    }, this.scene);
    
    this.auraMaterial = new StandardMaterial('arcaneMissileAuraMat', this.scene);
    this.auraMaterial.emissiveColor = this.color1.clone();
    this.auraMaterial.disableLighting = true;
    this.auraMaterial.alpha = 0.3;
    this.auraMesh.material = this.auraMaterial;
    this.auraMesh.isVisible = false;
    
    // Add to glow layer
    this.glowLayer.addIncludedOnlyMesh(this.auraMesh);
  }
  
  /**
   * Create trail ribbon material
   */
  createTrailMaterial() {
    if (!this.trailMaterial) {
      this.trailMaterial = new StandardMaterial('arcaneMissileTrailMat', this.scene);
      this.trailMaterial.emissiveColor = this.color1.clone();
      this.trailMaterial.disableLighting = true;
      this.trailMaterial.alpha = 0.6;
      this.trailMaterial.backFaceCulling = false;
      // Make it look additive-ish
      this.trailMaterial.emissiveTexture = null;
    }
    return this.trailMaterial;
  }
  
  /**
   * Update trail ribbon from position buffer
   * @param {Vector3} forward - Forward direction vector (optional)
   */
  updateTrail(forward = null) {
    if (this.positionBuffer.length < 2) {
      return;
    }
    
    // Compute forward from last two positions if not provided
    if (!forward || forward.lengthSquared() < 0.001) {
      if (this.positionBuffer.length >= 2) {
        const last = this.positionBuffer[this.positionBuffer.length - 1];
        const prev = this.positionBuffer[this.positionBuffer.length - 2];
        Vector3.SubtractToRef(last, prev, this._tempVec1);
        const len = this._tempVec1.length();
        if (len > 0.001) {
          this._tempVec1.scaleInPlace(1.0 / len);
          forward = this._tempVec1;
        } else {
          forward = this.lastForward;
        }
      } else {
        forward = this.lastForward;
      }
    }
    
    this.lastForward.copyFrom(forward);
    
    // Compute perpendicular vector for trail width
    Vector3.CrossToRef(forward, this._worldUp, this._tempVec2);
    const perpLen = this._tempVec2.length();
    
    if (perpLen < 0.001) {
      // Degenerate case: forward is parallel to world up
      // Use a fallback perpendicular (e.g., cross with X axis)
      const fallbackAxis = new Vector3(1, 0, 0);
      Vector3.CrossToRef(forward, fallbackAxis, this._tempVec2);
      const fallbackLen = this._tempVec2.length();
      if (fallbackLen > 0.001) {
        this._tempVec2.scaleInPlace(1.0 / fallbackLen);
      } else {
        this._tempVec2.set(0, 0, 1);
      }
    } else {
      this._tempVec2.scaleInPlace(1.0 / perpLen);
    }
    
    // Build ribbon path arrays
    const paths = [];
    const widths = [];
    
    for (let i = 0; i < this.positionBuffer.length; i++) {
      const pos = this.positionBuffer[i];
      const t = i / (this.positionBuffer.length - 1); // 0 at head, 1 at tail
      const width = this.headWidth * (1.0 - t); // Taper from head to tail
      
      // Create left and right points
      this._tempVec3.copyFrom(this._tempVec2);
      this._tempVec3.scaleInPlace(width * 0.5);
      
      const left = pos.add(this._tempVec3);
      const right = pos.subtract(this._tempVec3);
      
      paths.push([left, right]);
      widths.push(width);
    }
    
    // Create or update ribbon
    if (!this.trailRibbon) {
      this.trailRibbon = MeshBuilder.CreateRibbon('arcaneMissileTrail', {
        pathArray: paths,
        closeArray: false,
        closePath: false,
        updatable: true
      }, this.scene);
      
      this.trailMaterial = this.createTrailMaterial();
      this.trailRibbon.material = this.trailMaterial;
      this.trailRibbon.isVisible = false;
    } else {
      // Update existing ribbon
      MeshBuilder.CreateRibbon('arcaneMissileTrail', {
        pathArray: paths,
        closeArray: false,
        closePath: false,
        updatable: true,
        instance: this.trailRibbon
      }, this.scene);
    }
  }
  
  /**
   * Set missile position (called every frame)
   * @param {Vector3} pos - Current position
   * @param {Vector3} [forward] - Forward direction (optional, helps orient trail)
   */
  setPosition(pos, forward = null) {
    if (this.isImpacted) {
      return; // Don't update position after impact
    }
    
    // Update time accumulator for pulsation
    this.timeAccumulator += this.scene.getEngine().getDeltaTime() / 1000.0;
    
    // Add position to buffer
    this.positionBuffer.push(pos.clone());
    
    // Maintain fixed buffer size
    if (this.positionBuffer.length > this.trailPoints) {
      this.positionBuffer.shift();
    }
    
    // Update core and aura position
    if (this.coreMesh) {
      this.coreMesh.position.copyFrom(pos);
      this.coreMesh.isVisible = true;
      
      // Subtle pulsation (scale oscillation)
      const pulseScale = 1.0 + Math.sin(this.timeAccumulator * 8.0) * 0.1;
      this.coreMesh.scaling.setAll(pulseScale);
    }
    
    if (this.auraMesh) {
      this.auraMesh.position.copyFrom(pos);
      this.auraMesh.isVisible = true;
    }
    
    // Update trail
    if (this.positionBuffer.length >= 2) {
      this.updateTrail(forward);
      if (this.trailRibbon) {
        this.trailRibbon.isVisible = true;
      }
    }
  }
  
  /**
   * Create procedural particle texture (tiny white dot)
   * @returns {Texture} Procedural texture
   */
  createParticleTexture() {
    const size = 64;
    const texture = new DynamicTexture('particleTexture', size, this.scene, false);
    const context = texture.getContext();
    
    // Draw white circle
    context.fillStyle = 'white';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2);
    context.fill();
    
    texture.update();
    return texture;
  }
  
  /**
   * Play impact effects
   * @param {Vector3} at - Impact position
   */
  impact(at) {
    if (this.isImpacted) {
      return; // Already impacted
    }
    
    this.isImpacted = true;
    this.impactStartTime = Date.now();
    
    // Stop updating position
    // Core and trail remain visible until disposed
    
    // Create impact flash
    this.impactFlash = MeshBuilder.CreateSphere('impactFlash', {
      diameter: 0.2,
      segments: 16
    }, this.scene);
    
    this.impactFlashMaterial = new StandardMaterial('impactFlashMat', this.scene);
    this.impactFlashMaterial.emissiveColor = this.color2.clone();
    this.impactFlashMaterial.disableLighting = true;
    this.impactFlashMaterial.alpha = 1.0;
    this.impactFlash.material = this.impactFlashMaterial;
    this.impactFlash.position.copyFrom(at);
    this.impactFlash.isVisible = true;
    
    this.glowLayer.addIncludedOnlyMesh(this.impactFlash);
    
    // Animate flash (scale up and fade)
    const flashDuration = 120; // ms
    const flashStartScale = 0.2;
    const flashEndScale = 1.2;
    
    const flashAnimation = Animation.CreateAndStartAnimation(
      'impactFlashAnim',
      this.impactFlash,
      'scaling',
      60, // fps
      flashDuration / 1000.0 * 60, // frames
      Vector3.Zero(),
      new Vector3(flashEndScale, flashEndScale, flashEndScale),
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    // Fade alpha
    const alphaAnimation = Animation.CreateAndStartAnimation(
      'impactFlashAlpha',
      this.impactFlashMaterial,
      'alpha',
      60,
      flashDuration / 1000.0 * 60,
      1.0,
      0.0,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    // Create impact ring
    if (this.ringBillboard) {
      // Billboard plane (faces camera)
      this.impactRing = MeshBuilder.CreatePlane('impactRing', {
        size: 0.4,
        sideOrientation: 2 // Double-sided
      }, this.scene);
      
      // Make it billboard (face camera)
      this.impactRing.billboardMode = 7; // BILLBOARDMODE_ALL
    } else {
      // Torus on ground (Y-up)
      this.impactRing = MeshBuilder.CreateTorus('impactRing', {
        diameter: 0.4,
        thickness: 0.02,
        tessellation: 32
      }, this.scene);
      this.impactRing.rotation.x = Math.PI / 2; // Rotate to lie flat
    }
    
    this.impactRingMaterial = new StandardMaterial('impactRingMat', this.scene);
    this.impactRingMaterial.emissiveColor = this.color2.clone();
    this.impactRingMaterial.disableLighting = true;
    this.impactRingMaterial.alpha = 0.8;
    this.impactRing.material = this.impactRingMaterial;
    this.impactRing.position.copyFrom(at);
    this.impactRing.isVisible = true;
    
    this.glowLayer.addIncludedOnlyMesh(this.impactRing);
    
    // Animate ring (expand and fade)
    const ringDuration = 250; // ms
    const ringStartSize = 0.4;
    const ringEndSize = 2.5;
    
    const ringScaleAnimation = Animation.CreateAndStartAnimation(
      'impactRingScale',
      this.impactRing,
      'scaling',
      60,
      ringDuration / 1000.0 * 60,
      Vector3.One(),
      new Vector3(ringEndSize / ringStartSize, ringEndSize / ringStartSize, 1),
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    const ringAlphaAnimation = Animation.CreateAndStartAnimation(
      'impactRingAlpha',
      this.impactRingMaterial,
      'alpha',
      60,
      ringDuration / 1000.0 * 60,
      0.8,
      0.0,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );
    
    // Create particle burst
    if (this.enableParticles) {
      this.impactParticles = new ParticleSystem('impactParticles', 120, this.scene);
      
      // Use procedural texture
      const particleTexture = this.createParticleTexture();
      this.impactParticles.particleTexture = particleTexture;
      
      // Emitter at impact point
      const emitter = MeshBuilder.CreateBox('particleEmitter', { size: 0.01 }, this.scene);
      emitter.position.copyFrom(at);
      emitter.isVisible = false;
      this.impactParticles.emitter = emitter;
      
      // Particle properties
      this.impactParticles.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
      this.impactParticles.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
      
      this.impactParticles.color1 = new Color4(this.color1.r, this.color1.g, this.color1.b, 1.0);
      this.impactParticles.color2 = new Color4(this.color2.r, this.color2.g, this.color2.b, 1.0);
      this.impactParticles.colorDead = new Color4(0, 0, 0, 0);
      
      this.impactParticles.minSize = 0.05;
      this.impactParticles.maxSize = 0.15;
      
      this.impactParticles.minLifeTime = 0.15;
      this.impactParticles.maxLifeTime = 0.35;
      
      this.impactParticles.emitRate = 0; // Manual burst
      this.impactParticles.targetStopDuration = 0.4; // Stop after 0.4s
      
      // Burst emission
      this.impactParticles.manualEmitCount = 80; // Emit 80 particles
      
      // Direction (outward from impact)
      this.impactParticles.minEmitPower = 0.5;
      this.impactParticles.maxEmitPower = 2.0;
      this.impactParticles.updateSpeed = 0.02;
      
      // Blend mode (additive)
      this.impactParticles.blendMode = ParticleSystem.BLENDMODE_ADD;
      
      // Gravity
      this.impactParticles.gravity = new Vector3(0, -2, 0);
      
      // Start particles
      this.impactParticles.start();
      
      // Auto-dispose particles after animation
      setTimeout(() => {
        if (this.impactParticles) {
          this.impactParticles.dispose();
          this.impactParticles = null;
        }
        if (emitter) {
          emitter.dispose();
        }
      }, 400);
    }
    
    // Auto-dispose impact meshes after animation
    if (this.autoDisposeAfterImpact) {
      setTimeout(() => {
        this.disposeImpactMeshes();
        if (this.onDone) {
          this.onDone();
        }
      }, 400);
    }
  }
  
  /**
   * Dispose impact meshes (flash and ring)
   */
  disposeImpactMeshes() {
    if (this.impactFlash) {
      this.impactFlash.dispose();
      this.impactFlash = null;
    }
    if (this.impactFlashMaterial) {
      this.impactFlashMaterial.dispose();
      this.impactFlashMaterial = null;
    }
    if (this.impactRing) {
      this.impactRing.dispose();
      this.impactRing = null;
    }
    if (this.impactRingMaterial) {
      this.impactRingMaterial.dispose();
      this.impactRingMaterial = null;
    }
  }
  
  /**
   * Dispose all resources
   */
  dispose() {
    // Dispose core
    if (this.coreMesh) {
      this.coreMesh.dispose();
      this.coreMesh = null;
    }
    if (this.coreMaterial) {
      this.coreMaterial.dispose();
      this.coreMaterial = null;
    }
    
    // Dispose aura
    if (this.auraMesh) {
      this.auraMesh.dispose();
      this.auraMesh = null;
    }
    if (this.auraMaterial) {
      this.auraMaterial.dispose();
      this.auraMaterial = null;
    }
    
    // Dispose trail
    if (this.trailRibbon) {
      this.trailRibbon.dispose();
      this.trailRibbon = null;
    }
    if (this.trailMaterial) {
      this.trailMaterial.dispose();
      this.trailMaterial = null;
    }
    
    // Dispose impact
    this.disposeImpactMeshes();
    
    // Dispose particles
    if (this.impactParticles) {
      this.impactParticles.dispose();
      this.impactParticles = null;
    }
    
    // Clear buffers
    this.positionBuffer = [];
  }
}

/**
 * Usage example:
 * 
 * // Create renderer once
 * const renderer = new ArcaneMissileRender(scene, {
 *   trailPoints: 28,
 *   headWidth: 0.12,
 *   coreSize: 0.2,
 *   color1: new Color3(0.6, 0.4, 1.0), // Purple
 *   color2: new Color3(0.4, 0.6, 1.0), // Blue
 *   enableParticles: true,
 *   ringBillboard: true,
 *   autoDisposeAfterImpact: true,
 *   onDone: () => {
 *     console.log('Impact animation complete');
 *   }
 * });
 * 
 * // In render loop: update position
 * renderer.setPosition(missilePos, missileForward);
 * 
 * // When hit: play impact
 * renderer.impact(hitPos);
 * 
 * // Cleanup when done
 * renderer.dispose();
 */
