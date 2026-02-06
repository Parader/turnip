/**
 * Teleport VFX Controller
 * Phase-based state machine for teleport visual effects
 * Handles vortex, particles, character visibility, and server synchronization
 */

import { Vector3, StandardMaterial, Color3, Color4, Material, MeshBuilder, ParticleSystem, TransformNode, Animation, DynamicTexture } from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { createDiamondTexture, createLineStreakTexture } from './babylonVfx';

/**
 * Dispose teleport cache (placeholder for compatibility)
 * Particle textures are not cached since ParticleSystems dispose them.
 */
export function disposeTeleportCache(scene) {
  // No-op: Particle textures are created per-use and disposed with their particle systems
}

/**
 * Teleport VFX Controller - Phase-based state machine
 */
export class TeleportVFXController {
  constructor(scene, userId) {
    this.scene = scene;
    this.userId = userId;
    this.state = 'idle'; // idle, casting, vanishing, invisible, appearing, cleaning
    this.phaseStartTime = 0;
    this.serverDestination = null;
    this.pendingDestination = null;
    
    // Phase timing parameters (in milliseconds)
    this.timings = {
      castLeadIn: 1300,       // Time before shrink starts (delayed to happen later)
      vanishDuration: 300,     // Shrink to invisible (quicker)
      holdInvisibleMax: 2000,  // Max time waiting for server
      appearDuration: 500,    // Grow back to full size
      cleanupDuration: 400    // Vortex shrink + particle fade
    };
    
    // VFX elements
    this.originVortex = null;
    this.destVortex = null;
    this.originParticles = null;
    this.destParticles = null;
    this.characterMesh = null;
    this.originalScale = null;
    this.phaseObserver = null;
    
    // Vortex parameters
    this.vortexStartScale = 0.01; // Initial scale (very small)
    this.vortexFullScale = 1.0; // Full size scale
  }
  
  /**
   * Start teleport VFX sequence
   * @param {Vector3} origin - Origin position (character position)
   * @param {Vector3} predictedDestination - Optional predicted destination (for immediate VFX start)
   */
  startTeleport(origin, predictedDestination = null) {
    if (this.state !== 'idle') {
      console.warn('[TeleportVFX] Already in progress, ignoring start');
      return;
    }
    
    console.log(`[TeleportVFX] Starting teleport for user ${this.userId}`);
    
    // Get character mesh
    if (!this.scene.metadata || !this.scene.metadata.playerMeshes) {
      console.error('[TeleportVFX] Scene metadata or playerMeshes not found');
      return;
    }
    
    this.characterMesh = this.scene.metadata.playerMeshes.get(this.userId);
    if (!this.characterMesh) {
      console.error(`[TeleportVFX] Character mesh not found for user ${this.userId}`);
      console.log(`[TeleportVFX] Available player meshes:`, Array.from(this.scene.metadata.playerMeshes.keys()));
      return;
    }
    
    console.log(`[TeleportVFX] Found character mesh for ${this.userId}`);
    
    // Store original scale
    this.originalScale = this.characterMesh.scaling.clone();
    
    // Store positions
    this.origin = origin.clone();
    this.predictedDestination = predictedDestination ? predictedDestination.clone() : null;
    
    // Start casting phase
    this.transitionToPhase('casting', origin);
  }
  
  /**
   * Called when server confirms teleport destination
   * @param {Vector3} destination - Server-confirmed destination
   */
  onServerTeleportConfirmed(destination) {
    this.serverDestination = destination.clone();
    
    console.log(`[TeleportVFX] Server teleport confirmed, current state: ${this.state}`);
    
    // If we're in invisible phase, proceed to destination appear
    if (this.state === 'invisible') {
      console.log(`[TeleportVFX] Transitioning from invisible to appearing`);
      this.transitionToPhase('appearing', this.serverDestination);
    } else if (this.state === 'vanishing') {
      // Queue destination for when vanish completes
      console.log(`[TeleportVFX] Queueing destination for after vanish completes`);
      this.pendingDestination = this.serverDestination.clone();
    } else if (this.state === 'casting') {
      // Server confirmed before vanish started - queue it
      console.log(`[TeleportVFX] Server confirmed during casting, will queue for after vanish`);
      this.pendingDestination = this.serverDestination.clone();
    }
    // If we're already appearing/cleaning, destination is already set
  }
  
  /**
   * Transition to a new phase
   * @param {string} newPhase - Phase name
   * @param {Vector3} position - Position for this phase
   */
  transitionToPhase(newPhase, position) {
    const now = Date.now();
    const elapsed = this.phaseStartTime > 0 ? now - this.phaseStartTime : 0;
    
    // Clean up previous phase
    this.cleanupPhase();
    
    this.state = newPhase;
    this.phaseStartTime = now;
    
    switch (newPhase) {
      case 'casting':
        this.startCastingPhase(position);
        break;
      case 'vanishing':
        this.startVanishingPhase(position);
        break;
      case 'invisible':
        this.startInvisiblePhase();
        break;
      case 'appearing':
        this.startAppearingPhase(position);
        break;
      case 'cleaning':
        this.startCleaningPhase();
        break;
      case 'idle':
        this.reset();
        break;
    }
  }
  
  /**
   * Remove this controller from activeTeleports map
   * This allows normal movement animations to resume after teleport completes
   */
  removeFromActiveTeleports() {
    // activeTeleports is exported from this same file, so we can access it
    // We'll handle this in the cleanup functions that have access to the exported map
  }
  
  /**
   * Start casting phase - vortex appears and starts rotating
   */
  startCastingPhase(position) {
    console.log(`[TeleportVFX] Starting casting phase at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
    
    // Create origin vortex
    this.createVortex(position, 'origin').then(vortex => {
      // Check if controller was disposed or state changed while loading
      if (this.state !== 'casting' || !vortex) {
        console.warn(`[TeleportVFX] Vortex created but state changed or vortex invalid. State: ${this.state}, vortex: ${!!vortex}`);
        if (vortex && !vortex.isDisposed) {
          vortex.dispose();
        }
        return;
      }
      
      this.originVortex = vortex;
      console.log(`[TeleportVFX] Origin vortex created and assigned`);
      
      // Start scaling animation immediately: grow from 0.01 to 1.0 during castLeadIn
      this.animateVortexScale(this.originVortex, this.vortexStartScale, this.vortexFullScale, this.timings.castLeadIn);
      
      // Create origin particles (falling from top) - start 600ms later
      this.originParticles = this.createTeleportParticles(vortex, 'origin', false); // false = isOrigin
      setTimeout(() => {
        if (this.originParticles && this.state === 'casting') {
          this.originParticles.start();
          console.log('[TeleportVFX] Started origin particles after 600ms delay');
        }
      }, 600);
      
      // Schedule transition to vanishing
      setTimeout(() => {
        if (this.state === 'casting') {
          console.log(`[TeleportVFX] Transitioning from casting to vanishing`);
          this.transitionToPhase('vanishing', position);
        } else {
          console.warn(`[TeleportVFX] Cannot transition to vanishing, state is ${this.state}`);
        }
      }, this.timings.castLeadIn);
    }).catch(error => {
      console.error('[TeleportVFX] Failed to create origin vortex:', error);
    });
  }
  
  /**
   * Start vanishing phase - character shrinks, vortex scales up
   */
  startVanishingPhase(position) {
    if (!this.characterMesh || !this.originVortex) return;
    
    // Stop and dispose origin particles when character starts shrinking
    if (this.originParticles) {
      this.originParticles.stop();
      this.originParticles.dispose();
      this.originParticles = null;
      console.log('[TeleportVFX] Stopped origin particles as character starts shrinking');
    }
    
    // Animate character shrinking
    this.animateCharacterScale(this.originalScale, Vector3.Zero(), this.timings.vanishDuration);
    
    // Shrink vortex back down from 1.0 to 0.01 BEFORE character moves
    this.animateVortexScale(this.originVortex, this.vortexFullScale, this.vortexStartScale, this.timings.vanishDuration);
    
    // Schedule transition to invisible
    setTimeout(() => {
      if (this.state === 'vanishing') {
        // Make character invisible
        if (this.characterMesh) {
          this.characterMesh.isVisible = false;
        }
        
        // Check if we have pending destination
        if (this.pendingDestination) {
          this.transitionToPhase('appearing', this.pendingDestination);
        } else {
          this.transitionToPhase('invisible', null);
        }
      }
    }, this.timings.vanishDuration);
  }
  
  /**
   * Start invisible phase - waiting for server confirmation
   */
  startInvisiblePhase() {
    // Character is already invisible
    // Wait for server confirmation (handled by onServerTeleportConfirmed)
    // Or timeout after holdInvisibleMax
    setTimeout(() => {
      if (this.state === 'invisible' && this.serverDestination) {
        this.transitionToPhase('appearing', this.serverDestination);
      } else if (this.state === 'invisible') {
        // Timeout - proceed anyway if we have predicted destination
        const dest = this.serverDestination || this.predictedDestination;
        if (dest) {
          this.transitionToPhase('appearing', dest);
        } else {
          console.warn('[TeleportVFX] Invisible phase timeout, no destination available');
          this.transitionToPhase('idle', null);
        }
      }
    }, this.timings.holdInvisibleMax);
  }
  
  /**
   * Start appearing phase - character appears at destination, vortex and particles play
   */
  startAppearingPhase(position) {
    console.log(`[TeleportVFX] Starting appearing phase at (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`);
    
    // Clean up origin vortex and particles (we're done with them)
    if (this.originVortex) {
      console.log(`[TeleportVFX] Disposing origin vortex before appearing phase`);
      // Dispose the entire vortex (including all meshes from GLB)
      this.disposeVortex(this.originVortex);
      this.originVortex = null;
      
      // Clean up any orphaned meshes with origin vortex name pattern
      this.cleanupOrphanedMeshes('origin');
      
      console.log('[TeleportVFX] Origin vortex disposed');
    }
    
    if (this.originParticles) {
      this.originParticles.stop();
      this.originParticles.dispose();
      this.originParticles = null;
    }
    
    // Move character to destination (while invisible)
    if (this.characterMesh) {
      // Handle both TransformNode containers and direct meshes
      const isContainer = this.characterMesh instanceof TransformNode;
      if (isContainer) {
        this.characterMesh.position.x = position.x;
        this.characterMesh.position.y = position.y;
        this.characterMesh.position.z = position.z;
      } else {
        this.characterMesh.position = position.clone();
      }
      this.characterMesh.isVisible = true;
    }
    
    // Create destination vortex
    this.createVortex(position, 'destination').then(vortex => {
      // Check if controller was disposed or state changed while loading
      if (this.state !== 'appearing' || !vortex) {
        if (vortex && !vortex.isDisposed) {
          vortex.dispose();
        }
        return;
      }
      
      this.destVortex = vortex;
      
      // Start at very small scale - scale the container directly
      if (vortex instanceof TransformNode) {
        vortex.scaling = new Vector3(this.vortexStartScale, this.vortexStartScale, this.vortexStartScale);
      } else {
        vortex.scaling = new Vector3(this.vortexStartScale, this.vortexStartScale, this.vortexStartScale);
      }
      
      // Create destination particles (falling from top of character)
      this.destParticles = this.createTeleportParticles(vortex, 'destination', true); // true = isDestination
      this.destParticles.start();
      
      // Animate destination vortex growing from 0.01 to 1.0 (same as origin)
      this.animateVortexScale(this.destVortex, this.vortexStartScale, this.vortexFullScale, this.timings.appearDuration);
      
      // Animate character appearing (scaling up)
      this.animateCharacterScale(Vector3.Zero(), this.originalScale, this.timings.appearDuration);
      
      // Schedule transition to cleaning - wait for grow animation to complete
      setTimeout(() => {
        if (this.state === 'appearing') {
          console.log(`[TeleportVFX] Grow animation complete, transitioning to cleaning phase`);
          this.transitionToPhase('cleaning', position);
        }
      }, this.timings.appearDuration);
    }).catch(error => {
      console.error('[TeleportVFX] Failed to create destination vortex:', error);
    });
  }
  
  /**
   * Start cleaning phase - vortex shrinks, particles fade
   */
  startCleaningPhase() {
    console.log(`[TeleportVFX] Starting cleaning phase`);
    
    // Animate destination vortex shrinking from 1.0 back to 0.01 (completing the cycle)
    if (this.destVortex) {
      // Check if disposed
      try {
        if (typeof this.destVortex.isDisposed === 'function' && this.destVortex.isDisposed()) {
          console.warn(`[TeleportVFX] Destination vortex is disposed, cannot shrink`);
          return;
        }
      } catch (e) {
        // Ignore
      }
      
      // Get current scale (might be different from expected)
      const currentScale = this.destVortex.scaling ? this.destVortex.scaling.x : this.vortexFullScale;
      console.log(`[TeleportVFX] Destination vortex current scale: ${currentScale.toFixed(3)}, will shrink to ${this.vortexStartScale}`);
      
      // Ensure vortex is at full scale before starting shrink
      if (this.destVortex.scaling) {
        this.destVortex.scaling.x = this.vortexFullScale;
        this.destVortex.scaling.y = this.vortexFullScale;
        this.destVortex.scaling.z = this.vortexFullScale;
        console.log(`[TeleportVFX] Set destination vortex to full scale (${this.vortexFullScale}) before shrinking`);
      } else {
        console.warn(`[TeleportVFX] Destination vortex has no scaling property!`);
      }
      
      // Start shrink animation
      console.log(`[TeleportVFX] Calling animateVortexScale to shrink from ${this.vortexFullScale} to ${this.vortexStartScale}`);
      this.animateVortexScale(this.destVortex, this.vortexFullScale, this.vortexStartScale, this.timings.cleanupDuration);
    } else {
      console.warn(`[TeleportVFX] No destination vortex to shrink!`);
    }
    
    // Fade out destination particles
    if (this.destParticles) {
      this.animateParticleFade(this.destParticles, this.timings.cleanupDuration);
    }
    
    // Schedule transition to idle - wait for shrink animation to complete
    // Add buffer to ensure animation finishes
    const disposalDelay = this.timings.cleanupDuration + 500; // 500ms buffer
    setTimeout(() => {
      if (this.state === 'cleaning') {
        // Dispose destination vortex after shrink animation completes
        if (this.destVortex && !this.destVortex.isDisposed) {
          this.disposeVortex(this.destVortex);
          this.destVortex = null;
          
          // Clean up any orphaned meshes with destination vortex name pattern
          this.cleanupOrphanedMeshes('destination');
          
          console.log('[TeleportVFX] Destination vortex disposed after shrink animation');
        }
        
        // Remove from activeTeleports map BEFORE transitioning to idle so normal movement can resume
        // activeTeleports is defined in this file, so we can reference it directly
        if (activeTeleports && activeTeleports.has(this.userId)) {
          activeTeleports.delete(this.userId);
          console.log(`[TeleportVFX] Removed ${this.userId} from activeTeleports, normal movement can resume`);
        }
        
        this.transitionToPhase('idle', null);
      }
    }, disposalDelay);
  }
  
  /**
   * Create vortex mesh at position
   * @param {Vector3} position - Position for vortex
   * @param {string} name - Name prefix for this vortex
   * @returns {Promise<Mesh>} Vortex mesh
   */
  async createVortex(position, name) {
    const vortexPath = '/assets/tp_ground.glb';
    const uniqueName = `teleport_vortex_${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const result = await SceneLoader.ImportMeshAsync('', vortexPath, '', this.scene);
      
      if (result.meshes && result.meshes.length > 0) {
        console.log(`[TeleportVFX] Loaded ${result.meshes.length} meshes for ${name} vortex`);
        
        // Find root mesh
        let rootMesh = result.meshes[0];
        for (const mesh of result.meshes) {
          if (!mesh.parent) {
            rootMesh = mesh;
            break;
          }
        }
        
        // Store all meshes for later disposal
        if (!rootMesh.metadata) {
          rootMesh.metadata = {};
        }
        rootMesh.metadata.allMeshes = result.meshes.slice(); // Store copy of all meshes from the import
        rootMesh.metadata.skeletons = result.skeletons || []; // Store skeletons if any
        rootMesh.metadata.animationGroups = result.animationGroups || []; // Store animation groups if any
        
        // Rename all meshes to ensure unique names
        result.meshes.forEach((mesh, index) => {
          mesh.name = `${uniqueName}_mesh_${index}`;
        });
        
        // Create a container TransformNode for rotation
        const container = new TransformNode(`${uniqueName}_container`, this.scene);
        container.position = new Vector3(position.x, 0.01, position.z); // Always at ground level
        container.rotation.x = 0; // No X rotation - model is already horizontal
        container.rotation.y = 0; // Start rotation at 0 (will animate continuously)
        container.rotation.z = 0;
        container.scaling = new Vector3(this.vortexStartScale, this.vortexStartScale, this.vortexStartScale); // Scale container
        
        // Make root mesh a child of container
        rootMesh.parent = container;
        rootMesh.position = Vector3.Zero(); // Reset local position
        rootMesh.rotation = Vector3.Zero(); // Reset local rotation
        rootMesh.scaling = new Vector3(1, 1, 1); // Keep child meshes at scale 1 (container handles scaling)
        
        // Ensure visibility
        rootMesh.isVisible = true;
        rootMesh.setEnabled(true);
        rootMesh.isPickable = false;
        
        // Ensure all child meshes are visible
        result.meshes.forEach(mesh => {
          mesh.isVisible = true;
          if (mesh.setEnabled) mesh.setEnabled(true);
        });
        
        container.isVisible = true;
        container.setEnabled(true);
        container.isPickable = false;
        
        // Store container as the root for rotation
        // Copy metadata and ensure allMeshes is accessible
        container.metadata = rootMesh.metadata || {};
        container.metadata.allMeshes = result.meshes.slice(); // Ensure meshes are stored in container metadata
        container.name = uniqueName;
        
        // Start animation groups from GLB file if available
        if (result.animationGroups && result.animationGroups.length > 0) {
          result.animationGroups.forEach(animGroup => {
            if (animGroup) {
              animGroup.play(true); // Loop the animation
              console.log(`[TeleportVFX] Started animation: ${animGroup.name || 'unnamed'}`);
            }
          });
        }
        
        console.log(`[TeleportVFX] Created ${name} vortex container at (${position.x.toFixed(2)}, 0.01, ${position.z.toFixed(2)}), scale: ${this.vortexStartScale}`);
        console.log(`[TeleportVFX] Container visible: ${container.isVisible}, enabled: ${container.isEnabled()}, child meshes: ${result.meshes.length}`);
        
        return container; // Return container instead of rootMesh
      } else {
        // Fallback: create a simple disc
        return this.createFallbackVortex(position, uniqueName);
      }
    } catch (error) {
      console.warn(`[TeleportVFX] Failed to load vortex model, using fallback:`, error);
      return this.createFallbackVortex(position, uniqueName);
    }
  }
  
  /**
   * Clean up any orphaned meshes that might have been left behind
   */
  cleanupOrphanedMeshes(vortexType) {
    const namePattern = `teleport_vortex_${vortexType}`;
    const meshesToRemove = [];
    
    // Search scene meshes for any matching vortex meshes
    this.scene.meshes.forEach(mesh => {
      if (mesh && mesh.name && mesh.name.includes(namePattern)) {
        meshesToRemove.push(mesh);
      }
    });
    
    if (meshesToRemove.length > 0) {
      console.log(`[TeleportVFX] Found ${meshesToRemove.length} orphaned ${vortexType} vortex meshes, cleaning up`);
      meshesToRemove.forEach(mesh => {
        try {
          if (!mesh.isDisposed) {
            mesh.setEnabled(false);
            mesh.isVisible = false;
            if (mesh.material && !mesh.material.isDisposed) {
              mesh.material.dispose();
            }
            mesh.dispose();
          }
        } catch (e) {
          console.warn(`[TeleportVFX] Error cleaning up orphaned mesh:`, e);
        }
      });
    }
  }
  
  /**
   * Dispose vortex and all its associated meshes
   */
  disposeVortex(vortex) {
    if (!vortex) return;
    
    const vortexName = vortex.name || 'unknown';
    console.log(`[TeleportVFX] Disposing vortex: ${vortexName}, isDisposed: ${vortex.isDisposed}`);
    
    // If it's a container, dispose child meshes first
    if (vortex instanceof TransformNode && vortex.getChildMeshes) {
      const childMeshes = vortex.getChildMeshes();
      childMeshes.forEach(child => {
        if (child && !child.isDisposed) {
          if (child.material && !child.material.isDisposed) {
            child.material.dispose();
          }
          child.dispose();
        }
      });
    }
    
    // Dispose skeletons and animation groups first
    if (vortex.metadata) {
      if (vortex.metadata.skeletons) {
        vortex.metadata.skeletons.forEach(skeleton => {
          if (skeleton && !skeleton.isDisposed) {
            skeleton.dispose();
          }
        });
      }
      if (vortex.metadata.animationGroups) {
        vortex.metadata.animationGroups.forEach(animGroup => {
          if (animGroup && !animGroup.isDisposed) {
            animGroup.dispose();
          }
        });
      }
    }
    
    // Dispose all meshes from the GLB import
    if (vortex.metadata && vortex.metadata.allMeshes) {
      const allMeshes = vortex.metadata.allMeshes;
      console.log(`[TeleportVFX] Disposing ${allMeshes.length} meshes from GLB import`);
      
      allMeshes.forEach((mesh, index) => {
        if (mesh) {
          try {
            // Make invisible and disabled first
            if (mesh.setEnabled) mesh.setEnabled(false);
            mesh.isVisible = false;
            
            // Dispose child meshes recursively
            if (mesh.getChildMeshes) {
              const childMeshes = mesh.getChildMeshes();
              childMeshes.forEach(child => {
                if (child) {
                  try {
                    if (child.setEnabled) child.setEnabled(false);
                    child.isVisible = false;
                    if (child.material && !child.material.isDisposed) {
                      child.material.dispose();
                    }
                    if (!child.isDisposed) {
                      child.dispose();
                    }
                  } catch (e) {
                    console.warn(`[TeleportVFX] Error disposing child mesh:`, e);
                  }
                }
              });
            }
            // Dispose mesh material
            if (mesh.material && !mesh.material.isDisposed) {
              mesh.material.dispose();
            }
            // Remove from scene meshes array if present
            const sceneMeshes = this.scene.meshes;
            const meshIndex = sceneMeshes.indexOf(mesh);
            if (meshIndex !== -1) {
              sceneMeshes.splice(meshIndex, 1);
            }
            // Dispose the mesh itself
            if (!mesh.isDisposed) {
              mesh.dispose();
            }
          } catch (e) {
            console.warn(`[TeleportVFX] Error disposing mesh ${index}:`, e);
          }
        }
      });
    } else {
      // Fallback: dispose just this mesh and its children
      console.log(`[TeleportVFX] Disposing single mesh (no allMeshes metadata)`);
      
      try {
        // Make invisible first
        if (vortex.setEnabled) vortex.setEnabled(false);
        vortex.isVisible = false;
        
        if (vortex.getChildMeshes) {
          const childMeshes = vortex.getChildMeshes();
          childMeshes.forEach(child => {
            if (child) {
              try {
                if (child.setEnabled) child.setEnabled(false);
                child.isVisible = false;
                if (child.material && !child.material.isDisposed) {
                  child.material.dispose();
                }
                if (!child.isDisposed) {
                  child.dispose();
                }
              } catch (e) {
                console.warn(`[TeleportVFX] Error disposing child:`, e);
              }
            }
          });
        }
        if (vortex.material && !vortex.material.isDisposed) {
          vortex.material.dispose();
        }
      // Remove from scene meshes array if present
      const sceneMeshes = this.scene.meshes;
      const meshIndex = sceneMeshes.indexOf(vortex);
      if (meshIndex !== -1) {
        sceneMeshes.splice(meshIndex, 1);
      }
      // Dispose the container if it's a TransformNode
      if (vortex instanceof TransformNode) {
        if (!vortex.isDisposed) {
          vortex.dispose();
        }
      } else if (!vortex.isDisposed) {
        vortex.dispose();
      }
      } catch (e) {
        console.warn(`[TeleportVFX] Error disposing vortex:`, e);
      }
    }
    
    console.log(`[TeleportVFX] Vortex disposal complete for ${vortexName}`);
  }
  
  /**
   * Create fallback vortex disc
   */
  createFallbackVortex(position, name) {
    // Create a container TransformNode for rotation
    const container = new TransformNode(`${name}_container`, this.scene);
    container.position = new Vector3(position.x, 0.01, position.z); // Always at ground level
    container.rotation.x = Math.PI / 2; // Rotate container to lay flat (disc needs this)
    container.rotation.y = 0; // Start rotation at 0 (will animate continuously)
    container.rotation.z = 0;
    
    const vortex = MeshBuilder.CreateDisc(`${name}_disc`, {
      radius: 0.5,
      tessellation: 32
    }, this.scene);
    
    // Make vortex a child of container
    vortex.parent = container;
    vortex.position = Vector3.Zero(); // Reset local position
    vortex.rotation = Vector3.Zero(); // Reset local rotation
    vortex.scaling = new Vector3(this.vortexStartScale, this.vortexStartScale, this.vortexStartScale);
    
    const material = new StandardMaterial(`${name}_material`, this.scene);
    material.emissiveColor = new Color3(0.5, 0.3, 0.8); // Purple
    material.alpha = 0.7;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    material.backFaceCulling = false;
    vortex.material = material;
    
    // Ensure visibility
    vortex.isVisible = true;
    vortex.setEnabled(true);
    vortex.isPickable = false;
    
    container.isVisible = true;
    container.setEnabled(true);
    container.isPickable = false;
    
    // Store as single mesh array for consistent disposal
    if (!container.metadata) {
      container.metadata = {};
    }
    container.metadata.allMeshes = [vortex];
    container.name = name;
    
    return container; // Return container instead of vortex
  }
  
  /**
   * Create vertical line texture for particles
   * NOTE: Particle textures are NOT cached because ParticleSystems dispose their textures.
   */
  createVerticalLineTexture() {
    const size = 64;
    const texture = new DynamicTexture('verticalLineTexture', size, this.scene, false);
    const context = texture.getContext();
    
    const center = size / 2;
    const length = size - 4;
    const width = 4;
    
    // Clear with transparency
    context.clearRect(0, 0, size, size);
    
    // Draw vertical line streak
    context.fillStyle = 'rgba(255, 255, 255, 1.0)';
    context.fillRect(center - width / 2, 2, width, length);
    
    // Add soft fade at edges (top and bottom)
    const gradient = context.createLinearGradient(center, 2, center, length);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.0)');
    gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    
    context.fillStyle = gradient;
    context.fillRect(center - width / 2, 2, width, length);
    
    texture.update();
    return texture;
  }
  
  /**
   * Create teleport particles (TEST: vertical lines only)
   * @param {TransformNode|Mesh} emitter - Emitter mesh (vortex container)
   * @param {string} name - Name for the particle system
   * @param {boolean} isDestination - If true, particles rise from ground; if false, fall from top
   */
  createTeleportParticles(emitter, name, isDestination = false) {
    let emitterMesh = emitter;
    
    // For origin (casting), create emitter above character's head (particles fall down)
    if (!isDestination && this.characterMesh) {
      // Get character position
      let characterX = 0;
      let characterY = 0.5; // Default fallback
      let characterZ = 0;
      
      if (this.characterMesh.position) {
        characterX = this.characterMesh.position.x;
        characterY = this.characterMesh.position.y;
        characterZ = this.characterMesh.position.z;
      }
      
      // Set emitter position above character's head (tiny bit higher)
      const emitterY = characterY + 1.2; // Fixed offset above character
      
      // Create emitter above character's head
      emitterMesh = MeshBuilder.CreateSphere(`teleport_emitter_${name}`, { diameter: 0.1 }, this.scene);
      emitterMesh.position = new Vector3(
        characterX,
        emitterY,
        characterZ
      );
      emitterMesh.isVisible = false;
      console.log(`[TeleportVFX] Created origin emitter above character head: Y=${emitterY.toFixed(2)} (character Y: ${characterY.toFixed(2)})`);
    } else if (!emitterMesh) {
      // Fallback: create emitter at ground level
      emitterMesh = MeshBuilder.CreateSphere(`teleport_emitter_${name}`, { diameter: 0.1 }, this.scene);
      emitterMesh.isVisible = false;
    }
    
    // TEST: Vertical line particles only
    const verticalLineParticles = new ParticleSystem(`teleport_vertical_lines_${name}`, 80, this.scene);
    verticalLineParticles.particleTexture = this.createVerticalLineTexture();
    verticalLineParticles.emitter = emitterMesh;
    
    if (isDestination) {
      // Destination: particles rise from ground (vortex)
      verticalLineParticles.minEmitBox = new Vector3(-0.3, -0.1, -0.3);
      verticalLineParticles.maxEmitBox = new Vector3(0.3, 0.1, 0.3);
      
      // Rise upward from vortex - faster
      verticalLineParticles.direction1 = new Vector3(-0.05, 1.2, -0.05);
      verticalLineParticles.direction2 = new Vector3(0.05, 1.6, 0.05);
      verticalLineParticles.minEmitPower = 2.2;
      verticalLineParticles.maxEmitPower = 3.2;
      verticalLineParticles.gravity = new Vector3(0, -0.1, 0); // Less gravity so they go higher
    } else {
      // Origin: particles fall from top
      verticalLineParticles.minEmitBox = new Vector3(-0.2, -0.1, -0.2);
      verticalLineParticles.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
      
      // Fall downward to ground - faster
      verticalLineParticles.direction1 = new Vector3(-0.05, -1.2, -0.05);
      verticalLineParticles.direction2 = new Vector3(0.05, -1.6, 0.05);
      verticalLineParticles.minEmitPower = 2.2;
      verticalLineParticles.maxEmitPower = 3.2;
      verticalLineParticles.gravity = new Vector3(0, 0.2, 0); // Positive gravity to help fall
    }
    
    // Greenish white
    verticalLineParticles.color1 = new Color4(0.85, 1.0, 0.9, 1.0);   // Greenish white
    verticalLineParticles.color2 = new Color4(0.75, 0.95, 0.85, 1.0); // Slightly softer green-white
    verticalLineParticles.colorDead = new Color4(0.6, 0.85, 0.75, 0.0);  // Fade to transparent
    
    verticalLineParticles.minSize = 0.1;
    verticalLineParticles.maxSize = 0.2;
    
    // Origin particles stop sooner (shorter lifetime), destination particles last longer
    if (isDestination) {
      verticalLineParticles.minLifeTime = 0.35;
      verticalLineParticles.maxLifeTime = 0.65;
    } else {
      // Origin: shorter lifetime so particles stop sooner
      verticalLineParticles.minLifeTime = 0.2;
      verticalLineParticles.maxLifeTime = 0.4;
    }
    
    verticalLineParticles.emitRate = 80;
    verticalLineParticles.updateSpeed = 0.03;
    verticalLineParticles.blendMode = ParticleSystem.BLENDMODE_ONEONE;
    
    // Return particle system container (keeping same interface for compatibility)
    return {
      shards: verticalLineParticles, // Keep same property name for compatibility
      streaks: verticalLineParticles, // Keep same property name for compatibility
      start: () => {
        verticalLineParticles.start();
      },
      stop: () => {
        verticalLineParticles.stop();
      },
      dispose: () => {
        verticalLineParticles.dispose();
        // Also dispose the emitter mesh if we created it
        if (emitterMesh && emitterMesh.name && emitterMesh.name.includes('teleport_emitter')) {
          emitterMesh.dispose();
        }
      }
    };
  }
  
  /**
   * Animate character scale
   */
  animateCharacterScale(fromScale, toScale, duration) {
    if (!this.characterMesh) return;
    
    const startTime = Date.now();
    const startScale = fromScale.clone();
    const scaleDelta = toScale.clone().subtract(fromScale);
    
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      
      // Ease in-out
      const eased = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentScale = startScale.clone().add(scaleDelta.clone().scale(eased));
      this.characterMesh.scaling = currentScale;
      
      if (progress >= 1.0) {
        this.scene.onBeforeRenderObservable.remove(observer);
      }
    });
  }
  
  /**
   * Animate vortex scale
   */
  animateVortexScale(vortex, fromScale, toScale, duration) {
    if (!vortex) {
      console.warn('[TeleportVFX] animateVortexScale: vortex is null');
      return;
    }
    
    console.log(`[TeleportVFX] Starting scale animation from ${fromScale} to ${toScale} over ${duration}ms`);
    
    // Stop any existing animations using scene.stopAnimation
    try {
      this.scene.stopAnimation(vortex);
    } catch (e) {
      // Ignore errors
    }
    
    // Use render loop observer (same approach as character scaling) for reliable animation
    const startTime = Date.now();
    const startScale = fromScale;
    const scaleDelta = toScale - fromScale;
    
    let frameCount = 0;
    let firstCall = true;
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      frameCount++;
      if (firstCall) {
        console.log(`[TeleportVFX] Scale animation observer called for first time!`);
        firstCall = false;
      }
      
      if (!vortex) {
        console.warn(`[TeleportVFX] Vortex is null in observer, removing`);
        this.scene.onBeforeRenderObservable.remove(observer);
        return;
      }
      
      // Check if disposed
      try {
        if (typeof vortex.isDisposed === 'function' && vortex.isDisposed()) {
          console.warn(`[TeleportVFX] Vortex is disposed in observer, removing`);
          this.scene.onBeforeRenderObservable.remove(observer);
          return;
        }
      } catch (e) {
        // Ignore
      }
      
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      
      // Ease in-out
      const eased = progress < 0.5 
        ? 2 * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      
      const currentScale = startScale + scaleDelta * eased;
      
      // Apply scale to container
      if (vortex.scaling) {
        const oldScale = vortex.scaling.x;
        vortex.scaling.x = currentScale;
        vortex.scaling.y = currentScale;
        vortex.scaling.z = currentScale;
        
        // Log periodically
        if (frameCount % 30 === 0 || progress < 0.1 || progress > 0.9) {
          console.log(`[TeleportVFX] Frame ${frameCount}: Scaling from ${oldScale.toFixed(3)} to ${currentScale.toFixed(3)} (progress: ${(progress * 100).toFixed(1)}%)`);
        }
      } else {
        console.warn(`[TeleportVFX] Vortex has no scaling property in observer!`);
      }
      
      if (progress >= 1.0) {
        console.log(`[TeleportVFX] Scale animation complete after ${frameCount} frames, final scale: ${currentScale.toFixed(3)}`);
        this.scene.onBeforeRenderObservable.remove(observer);
      }
    });
    
    console.log(`[TeleportVFX] Scale animation observer registered`);
  }
  
  /**
   * Animate particle fade out
   */
  animateParticleFade(particleSystem, duration) {
    if (!particleSystem) return;
    
    const startTime = Date.now();
    const originalEmitRate = particleSystem.shards.emitRate;
    
    const observer = this.scene.onBeforeRenderObservable.add(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      
      // Fade out emit rate
      const fade = 1.0 - progress;
      particleSystem.shards.emitRate = originalEmitRate * fade;
      particleSystem.streaks.emitRate = (particleSystem.streaks.emitRate || 50) * fade;
      
      if (progress >= 1.0) {
        particleSystem.stop();
        this.scene.onBeforeRenderObservable.remove(observer);
      }
    });
  }
  
  /**
   * Clean up current phase resources
   */
  cleanupPhase() {
    // Phase cleanup (rotation is now handled by GLB animation)
  }
  
  /**
   * Reset controller to idle state
   */
  reset() {
    // Stop all observers
    this.cleanupPhase();
    
    // Dispose origin vortex (if not already disposed)
    if (this.originVortex) {
      this.disposeVortex(this.originVortex);
      this.originVortex = null;
    }
    
    // Dispose destination vortex (if not already disposed)
    if (this.destVortex) {
      this.disposeVortex(this.destVortex);
      this.destVortex = null;
    }
    
    // Final cleanup pass for any orphaned meshes
    this.cleanupOrphanedMeshes('origin');
    this.cleanupOrphanedMeshes('destination');
    
    // Dispose origin particles (if not already disposed)
    if (this.originParticles) {
      try {
        this.originParticles.stop();
        this.originParticles.dispose();
      } catch (e) {
        // Already disposed, ignore
      }
      this.originParticles = null;
    }
    
    // Dispose destination particles (if not already disposed)
    if (this.destParticles) {
      try {
        this.destParticles.stop();
        this.destParticles.dispose();
      } catch (e) {
        // Already disposed, ignore
      }
      this.destParticles = null;
    }
    
    // Restore character visibility and scale
    if (this.characterMesh) {
      this.characterMesh.isVisible = true;
      if (this.originalScale) {
        this.characterMesh.scaling = this.originalScale.clone();
      }
    }
    
    // Reset state
    this.state = 'idle';
    this.phaseStartTime = 0;
    this.serverDestination = null;
    this.pendingDestination = null;
    this.characterMesh = null;
    this.originalScale = null;
  }
  
  /**
   * Dispose controller and clean up all resources
   */
  dispose() {
    this.reset();
  }
}

// Global map to track active teleport controllers
// Declared before export so it can be referenced in the class
const activeTeleports = new Map();
export { activeTeleports };

/**
 * Start teleport VFX
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - User ID of character teleporting
 * @param {Vector3} origin - Origin position
 * @param {Vector3} predictedDestination - Optional predicted destination
 * @returns {TeleportVFXController} Controller instance
 */
export function startTeleportVFX(scene, userId, origin, predictedDestination = null) {
  // Dispose existing controller if any
  if (activeTeleports.has(userId)) {
    activeTeleports.get(userId).dispose();
  }
  
  // Create new controller
  const controller = new TeleportVFXController(scene, userId);
  activeTeleports.set(userId, controller);
  
  controller.startTeleport(origin, predictedDestination);
  
  return controller;
}

/**
 * Handle server teleport confirmation
 * @param {string} userId - User ID
 * @param {Vector3} destination - Server-confirmed destination
 */
export function onServerTeleportConfirmed(userId, destination) {
  const controller = activeTeleports.get(userId);
  if (controller) {
    controller.onServerTeleportConfirmed(destination);
  } else {
    console.warn(`[TeleportVFX] No active controller for user ${userId}`);
  }
}

/**
 * Clean up teleport controller for user
 * @param {string} userId - User ID
 */
export function cleanupTeleportVFX(userId) {
  const controller = activeTeleports.get(userId);
  if (controller) {
    controller.dispose();
    activeTeleports.delete(userId);
    console.log(`[TeleportVFX] Cleaned up teleport VFX for ${userId}, normal movement can resume`);
  }
}
