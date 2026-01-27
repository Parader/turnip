// Canonical server-side spell definitions registry
// This is the single source of truth for all spell rules

/**
 * @typedef {Object} TargetingDef
 * @property {"CELL" | "UNIT" | "SELF"} targetType
 * @property {"ENEMY" | "ALLY" | "ANY"} [unitFilter] - Only for targetType=UNIT
 * @property {{ min: number, max: number }} range
 * @property {boolean} requiresLoS
 * @property {boolean} allowBlockedCellTarget
 * @property {boolean} allowOccupiedCellTarget
 * @property {"SINGLE" | "CIRCLE1" | "LINE3"} pattern
 */

/**
 * @typedef {Object} StatusEffectDef
 * @property {string} effectId - Unique identifier (e.g., 'bleed', 'burn', 'shield')
 * @property {string} name - Display name
 * @property {number} duration - Turns the effect lasts
 * @property {boolean} [stackable] - Can stack multiple times (default: false)
 * @property {number} [maxStacks] - Maximum stacks (if stackable)
 * @property {"BUFF" | "DEBUFF" | "NEUTRAL"} type
 * @property {Object} [onApply] - Effects when applied { damage?: number, heal?: number, statModifiers?: {...} }
 * @property {Object} [onTurnStart] - Effects at start of each turn { damage?: number, heal?: number, damageType?: string }
 * @property {Object} [onTurnEnd] - Effects at end of each turn
 * @property {Object} [onRemove] - Effects when removed
 * @property {boolean} [blocksInvisibility] - If true, effect is visible even if unit is invisible
 * @property {boolean} [grantsInvisibility] - If true, this status effect grants invisibility
 */

/**
 * @typedef {Object} GroundEffectDef
 * @property {string} effectId - Unique identifier
 * @property {string} name - Display name
 * @property {number} duration - Turns the effect lasts (0 = permanent)
 * @property {number} radius - Radius in cells (default: 1)
 * @property {Object} [onEnter] - Effects when unit enters { damage?: number, heal?: number, statusEffect?: StatusEffectDef }
 * @property {Object} [onTurnStart] - Effects at start of turn for units on this cell
 * @property {Object} [onTurnEnd] - Effects at end of turn
 * @property {boolean} [blocksMovement] - If true, units cannot move through
 * @property {boolean} [blocksVision] - If true, blocks line of sight
 */

/**
 * @typedef {Object} TerrainChangeDef
 * @property {number} fromType - Terrain type to change from (TILE_TYPES value)
 * @property {number} toType - Terrain type to change to
 * @property {number} [duration] - Turns until terrain reverts (0 = permanent)
 * @property {number} [radius] - Radius of change (default: 1)
 */

/**
 * @typedef {Object} SpawnEntityDef
 * @property {string} entityType - Type identifier (e.g., 'trap', 'totem')
 * @property {string} name - Display name
 * @property {number} health - Starting health (0 = invulnerable)
 * @property {number} duration - Turns entity lasts (0 = permanent)
 * @property {Object} [trigger] - For traps: { type: 'MOVEMENT' | 'PROXIMITY', radius?: number }
 * @property {Object} [onTrigger] - Effects when triggered { damage?: number, heal?: number, statusEffect?: StatusEffectDef }
 * @property {Object} [onDeath] - Effects when entity dies { damage?: number, radius?: number }
 * @property {Object} [onTurnStart] - Effects at start of entity's turn
 */

/**
 * @typedef {Object} EffectDef
 * @property {"DAMAGE" | "HEAL" | "MOVEMENT" | "STATUS_EFFECT" | "GROUND_EFFECT" | "TERRAIN_CHANGE" | "SPAWN_ENTITY"} kind
 * @property {number} amount
 * @property {"physical" | "magic"} [damageType] - Only for DAMAGE
 * @property {StatusEffectDef} [statusEffect] - Only for STATUS_EFFECT
 * @property {GroundEffectDef} [groundEffect] - Only for GROUND_EFFECT
 * @property {TerrainChangeDef} [terrainChange] - Only for TERRAIN_CHANGE
 * @property {SpawnEntityDef} [spawnEntity] - Only for SPAWN_ENTITY
 */

/**
 * @typedef {Object} PrepAnimDef
 * @property {string} name - Animation clip name
 * @property {boolean} loop - If true, keep playing until cancelled or cast
 * @property {number} blendInMs - Blend time when entering prep
 * @property {number} blendOutMs - Blend time when leaving prep
 * @property {boolean} [canMoveWhilePreparing] - Default false
 */

/**
 * @typedef {Object} CastAnimDef
 * @property {string} name - Clip name when spell is executed
 * @property {number} blendInMs
 * @property {number} blendOutMs
 * @property {number} lockMs - Minimum time actor is "busy" to prevent overlapping actions
 * @property {number} impactDelayMs - When spell effect should visually occur relative to cast start. Used to delay hit animations for ranged attacks (in milliseconds). 0 for instant melee hits.
 */

/**
 * @typedef {Object} VfxDef
 * @property {"SPHERE" | "CUBE" | "CYLINDER" | "PARTICLE" | "MESH"} type - Type of VFX geometry
 * @property {number} [size] - Size/diameter of the VFX (default: 0.3)
 * @property {Object} [color] - Color definition { r: number, g: number, b: number } (0-1 range)
 * @property {number} [emissiveIntensity] - How much the VFX glows (0-1, default: 1)
 * @property {number} [opacity] - Opacity/alpha (0-1, default: 1)
 * @property {boolean} [animated] - Whether the VFX has animation (rotation, scale, etc.)
 * @property {Object} [animation] - Animation properties { rotationSpeed?: number, scalePulse?: boolean, pulseSpeed?: number }
 * @property {number} [duration] - How long the VFX lasts in milliseconds (0 = permanent until manually removed)
 * @property {string} [meshPath] - Path to mesh file (for type: "MESH")
 */

/**
 * @typedef {Object} ProjectileVfxDef
 * @property {VfxDef} vfx - VFX definition for the projectile
 * @property {number} speedCellsPerSec - Speed of projectile in cells per second
 * @property {number} [startDelayMs] - Delay before projectile spawns (relative to cast start)
 * @property {number} [heightOffset] - Height offset from ground (default: 0.5)
 * @property {boolean} [trail] - Whether projectile leaves a trail
 * @property {VfxDef} [trailVfx] - VFX definition for trail (if trail: true)
 * @property {number} [trailLength] - Length of trail in cells (default: 0.5)
 */

/**
 * @typedef {Object} ImpactVfxDef
 * @property {VfxDef} vfx - VFX definition for the impact
 * @property {number} [delayMs] - Delay before impact VFX appears (relative to projectile arrival)
 * @property {number} [duration] - Duration of impact VFX in milliseconds (overrides vfx.duration)
 * @property {number} [size] - Size of impact (overrides vfx.size)
 * @property {boolean} [explosive] - Whether impact expands outward
 * @property {number} [explosionRadius] - Radius of explosion in cells (if explosive: true)
 * @property {number} [explosionDuration] - Duration of explosion expansion in milliseconds
 */

/**
 * @typedef {Object} GroundEffectVfxDef
 * @property {VfxDef} vfx - VFX definition for ground effect
 * @property {number} [delayMs] - Delay before ground effect appears (relative to impact)
 * @property {number} [duration] - Duration of ground effect in milliseconds (0 = permanent)
 * @property {number} [radius] - Radius of ground effect in cells (default: 1)
 * @property {boolean} [spread] - Whether effect spreads over time
 * @property {number} [spreadSpeed] - Speed of spread in cells per second
 * @property {number} [maxRadius] - Maximum radius if spreading (default: radius)
 * @property {boolean} [fadeOut] - Whether effect fades out at end
 * @property {number} [fadeOutDuration] - Duration of fade out in milliseconds
 */

/**
 * @typedef {Object} SpellDef
 * @property {string} spellId
 * @property {string} name
 * @property {string} [icon]
 * @property {string} [description]
 * @property {TargetingDef} targeting
 * @property {{ energy: number }} cost
 * @property {number} [cooldown] - Turns
 * @property {number} [castPerTurnLimit]
 * @property {boolean} [ignoresInvisibility] - If true, can target invisible units
 * @property {EffectDef[]} effects
 * @property {Object} presentation
 * @property {string} presentation.castAnim
 * @property {{ type: "NONE" | "BOLT" | "ARROW", speedCellsPerSec?: number }} [presentation.projectile] - Legacy projectile definition
 * @property {ProjectileVfxDef} [presentation.projectileVfx] - New detailed projectile VFX definition
 * @property {string} [presentation.impactVfx] - Legacy impact VFX string
 * @property {ImpactVfxDef} [presentation.impactVfxDef] - New detailed impact VFX definition
 * @property {GroundEffectVfxDef} [presentation.groundEffectVfx] - Ground effect VFX definition
 * @property {string} [presentation.sound]
 * @property {Object} animations
 * @property {PrepAnimDef} animations.prep
 * @property {CastAnimDef} animations.cast
 */

/**
 * Canonical spell definitions registry
 * @type {Record<string, SpellDef>}
 */
export const SpellDefs = {
    // Minimal initial spell set
    fireball: {
      spellId: 'fireball',
      name: 'Fireball',
      description: 'Hurl a ball of fire at a target cell',
      targeting: {
        targetType: 'CELL',
        range: { min: 2, max: 6 },
        requiresLoS: true, // MVP: no LoS initially
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 5,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        // Legacy projectile (kept for backward compatibility)
        projectile: { type: 'BOLT', speedCellsPerSec: 4 },
        // New detailed VFX system
        projectileVfx: {
          vfx: {
            type: 'SPHERE',
            size: 0.4, // Diameter of fireball
            color: { r: 1.0, g: 0.4, b: 0.0 }, // Bright orange-red
            emissiveIntensity: 1.0, // Full glow
            opacity: 0.9,
            animated: true,
            animation: {
              rotationSpeed: 2.0, // Rotations per second
              scalePulse: true, // Pulsing effect
              pulseSpeed: 3.0 // Pulse cycles per second
            },
            duration: 0 // Lasts until impact
          },
          speedCellsPerSec: 4, // Speed in cells per second
          startDelayMs: 200, // Spawn 200ms after cast animation starts
          heightOffset: 0.6, // Float 0.6 units above ground
          trail: true, // Leave a fire trail
          trailVfx: {
            type: 'SPHERE',
            size: 0.15, // Smaller trail particles
            color: { r: 1.0, g: 0.6, b: 0.0 }, // Yellow-orange
            emissiveIntensity: 0.8,
            opacity: 0.6,
            animated: false,
            duration: 300 // Trail particles fade after 300ms
          },
          trailLength: 0.8 // Trail extends 0.8 cells behind projectile
        },
        // Legacy impact VFX (kept for backward compatibility)
        impactVfx: 'explosion_small',
        // New detailed impact VFX
        impactVfxDef: {
          vfx: {
            type: 'SPHERE',
            size: 0.2, // Starting size
            color: { r: 1.0, g: 0.8, b: 0.0 }, // Bright yellow
            emissiveIntensity: 1.0,
            opacity: 1.0,
            animated: true,
            animation: {
              scalePulse: false // No pulse, just expand
            },
            duration: 400 // Impact effect lasts 400ms
          },
          delayMs: 0, // Instant on impact
          duration: 400,
          size: 1.2, // Final explosion size (overrides vfx.size)
          explosive: true, // Expands outward
          explosionRadius: 1.5, // Explosion reaches 1.5 cells radius
          explosionDuration: 300 // Expansion takes 300ms
        },
        // Hit animation delay to sync with explosion VFX
        hitDelayMs: 1000, // Delay hit animation by 550ms to match explosion timing
        // Ground effect: burning fire
        groundEffectVfx: {
          vfx: {
            type: 'CYLINDER', // Flat cylinder for ground effect
            size: 0.1, // Height of flame
            color: { r: 1.0, g: 0.3, b: 0.0 }, // Deep red-orange
            emissiveIntensity: 0.9,
            opacity: 0.8,
            animated: true,
            animation: {
              rotationSpeed: 0.5, // Slow rotation
              scalePulse: true, // Flickering flames
              pulseSpeed: 2.0 // Flicker speed
            },
            duration: 3000 // Burns for 3 seconds
          },
          delayMs: 100, // Appears 100ms after impact
          duration: 3000, // Lasts 3 seconds
          radius: 1.0, // Covers 1 cell radius
          spread: false, // Doesn't spread (could be true for area spells)
          fadeOut: true, // Fades out at end
          fadeOutDuration: 500 // Fade out over 500ms
        },
        sound: 'fireball_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    slash: {
      spellId: 'slash',
      name: 'Slash',
      description: 'Melee attack on an enemy unit',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 1 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true, // UNIT targeting always allows occupied
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 4,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'slash_impact',
        sound: 'slash_swing'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    heal: {
      spellId: 'heal',
      name: 'Heal',
      description: 'Restore health to an ally unit',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ALLY',
        range: { min: 0, max: 4 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'HEAL',
          amount: 6
        }
      ],
      presentation: {
        castAnim: 'cast2',
        // Legacy impact VFX (kept for backward compatibility)
        impactVfx: 'heal_glow',
        // New detailed impact VFX
        impactVfxDef: {
          vfx: {
            type: 'CYLINDER', // Flat circle on ground
            size: 0.05, // Height of circle
            color: { r: 0.2, g: 1.0, b: 0.4 }, // Green
            emissiveIntensity: 0.5, // Dim green glow
            opacity: 0.4, // 40% opacity
            animated: true,
            animation: {
              scalePulse: false // No pulse, just expand
            },
            duration: 1000 // Effect lasts 1 second
          },
          delayMs: 0, // Instant on impact
          duration: 1000,
          size: 1.2, // Final circle size (overrides vfx.size)
          explosive: false, // Expands but not explosive
          explosionRadius: 1.2, // Circle reaches 1.2 cells radius
          explosionDuration: 1000 // Expansion takes 1 second
        },
        // Hit animation delay to sync with heal VFX
        hitDelayMs: 600, // Delay hit animation to match heal timing
        sound: 'heal_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast2',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 600
        }
      }
    },
  
    // Assassin spells
    dash: {
      spellId: 'dash',
      name: 'Dash',
      description: 'Quickly move to an adjacent cell',
      targeting: {
        targetType: 'CELL',
        range: { min: 0, max: 0 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'MOVEMENT',
          amount: 3 // Movement spell, no damage
        }
      ],
      presentation: {
        castAnim: 'cast1',
        impactVfx: 'dash_trail',
        sound: 'dash_woosh'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast1',
          blendInMs: 50,
          blendOutMs: 100,
          lockMs: 400,
          impactDelayMs: 200
        }
      }
    },
  
    trap: {
      spellId: 'trap',
      name: 'Trap',
      description: 'Place a trap on a target cell',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 3 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 2,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'smoke_cloud',
        sound: 'trap_place'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 400
        }
      }
    },
  
    backstab: {
      spellId: 'backstab',
      name: 'Backstab',
      description: 'Sneak attack an enemy from behind',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 1 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 6,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'backstab_impact',
        sound: 'backstab_hit'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 700,
          impactDelayMs: 400
        }
      }
    },
  
    poison_dagger: {
      spellId: 'poison_dagger',
      name: 'Poison Dagger',
      description: 'Strike with a poisoned blade',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 1 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 3,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'poison_cloud',
        sound: 'dagger_swing'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    kick: {
      spellId: 'kick',
      name: 'Kick',
      description: 'Kick an enemy unit',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 1 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 1 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 2,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'attack2',
        impactVfx: 'kick_impact',
        sound: 'kick_hit'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'attack2',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 500,
          impactDelayMs: 250
        }
      }
    },
  
    dodge: {
      spellId: 'dodge',
      name: 'Dodge',
      description: 'Quickly evade and reposition',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 2 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 0
        }
      ],
      presentation: {
        castAnim: 'dash',
        impactVfx: 'dodge_trail',
        sound: 'dodge_woosh'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'dash',
          blendInMs: 50,
          blendOutMs: 100,
          lockMs: 400,
          impactDelayMs: 200
        }
      }
    },
  
    shadowstep: {
      spellId: 'shadowstep',
      name: 'Shadowstep',
      description: 'Teleport to a nearby cell',
      targeting: {
        targetType: 'CELL',
        range: { min: 2, max: 4 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 0
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'shadow_portal',
        sound: 'shadowstep_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    invisibility: {
      spellId: 'invisibility',
      name: 'Invisibility',
      description: 'Become invisible to enemies',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'HEAL',
          amount: 0 // Buff spell, no heal
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'invisibility_glow',
        sound: 'invisibility_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    // Warrior spells
    cut: {
      spellId: 'cut',
      name: 'Cut',
      description: 'Slash an enemy with your weapon',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 1 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 3,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'slash_impact',
        sound: 'sword_swing'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    shield: {
      spellId: 'shield',
      name: 'Shield',
      description: 'Raise your shield to block attacks',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'HEAL',
          amount: 0 // Buff spell
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'shield_glow',
        sound: 'shield_raise'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    taunt: {
      spellId: 'taunt',
      name: 'Taunt',
      description: 'Provoke an enemy to attack you',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 1, max: 3 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 0 // Debuff spell
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'taunt_effect',
        sound: 'taunt_shout'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 300
        }
      }
    },
  
    rage: {
      spellId: 'rage',
      name: 'Rage',
      description: 'Enter a berserker rage',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'HEAL',
          amount: 0 // Buff spell
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'rage_aura',
        sound: 'rage_roar'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 700,
          impactDelayMs: 400
        }
      }
    },
  
    unstoppable: {
      spellId: 'unstoppable',
      name: 'Unstoppable',
      description: 'Become immune to crowd control',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'HEAL',
          amount: 0 // Buff spell
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'unstoppable_glow',
        sound: 'unstoppable_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    break_walls: {
      spellId: 'break_walls',
      name: 'Break Walls',
      description: 'Destroy a wall or obstacle',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 2 },
        requiresLoS: true,
        allowBlockedCellTarget: true,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 10,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'wall_break',
        sound: 'wall_smash'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    spin: {
      spellId: 'spin',
      name: 'Spin Attack',
      description: 'Whirl around attacking all nearby enemies',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'CIRCLE1'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 5,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'melee',
        impactVfx: 'spin_whirl',
        sound: 'spin_attack'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'melee',
          blendInMs: 50,
          blendOutMs: 150,
          lockMs: 900,
          impactDelayMs: 500
        }
      }
    },
  
    // Archer spells
    shoot_arrow: {
      spellId: 'shoot_arrow',
      name: 'Shoot Arrow',
      description: 'Fire an arrow at an enemy',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 2, max: 5 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 4,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        projectile: { type: 'ARROW', speedCellsPerSec: 5 },
        impactVfx: 'arrow_hit',
        sound: 'bow_draw'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 700,
          impactDelayMs: 400
        }
      }
    },
  
    stun_trap: {
      spellId: 'stun_trap',
      name: 'Stun Trap',
      description: 'Place a trap that stuns enemies',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 3 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 1,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'trap_place',
        sound: 'trap_set'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 400
        }
      }
    },
  
    push_shot: {
      spellId: 'push_shot',
      name: 'Push Shot',
      description: 'Knockback an enemy with a powerful arrow',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 2, max: 4 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 3,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        projectile: { type: 'ARROW', speedCellsPerSec: 5 },
        impactVfx: 'push_impact',
        sound: 'bow_draw'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 700,
          impactDelayMs: 400
        }
      }
    },
  
    raining_arrows: {
      spellId: 'raining_arrows',
      name: 'Raining Arrows',
      description: 'Rain arrows down on a target area',
      targeting: {
        targetType: 'CELL',
        range: { min: 3, max: 6 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'CIRCLE1'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 4,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        projectile: { type: 'ARROW', speedCellsPerSec: 3 },
        impactVfx: 'arrow_rain',
        sound: 'arrow_volley'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 600
        }
      }
    },
  
    incapacitating_shot: {
      spellId: 'incapacitating_shot',
      name: 'Incapacitating Shot',
      description: 'A precise shot that disables an enemy',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 2, max: 5 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 2,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        projectile: { type: 'ARROW', speedCellsPerSec: 6 },
        impactVfx: 'stun_effect',
        sound: 'bow_draw'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    reveal: {
      spellId: 'reveal',
      name: 'Reveal',
      description: 'Reveal hidden enemies in an area',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 4 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'CIRCLE1'
      },
      cost: { energy: 2 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 0 // Utility spell
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'reveal_glow',
        sound: 'reveal_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 600,
          impactDelayMs: 400
        }
      }
    },
  
    morale_boost: {
      spellId: 'morale_boost',
      name: 'Morale Boost',
      description: 'Inspire nearby allies',
      targeting: {
        targetType: 'SELF',
        range: { min: 0, max: 0 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'CIRCLE1'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'HEAL',
          amount: 4
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'morale_aura',
        sound: 'morale_shout'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    rapid_shot: {
      spellId: 'rapid_shot',
      name: 'Rapid Shot',
      description: 'Fire multiple arrows in quick succession',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 2, max: 4 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 6,
          damageType: 'physical'
        }
      ],
      presentation: {
        castAnim: 'cast',
        projectile: { type: 'ARROW', speedCellsPerSec: 7 },
        impactVfx: 'rapid_hits',
        sound: 'rapid_fire'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 900,
          impactDelayMs: 500
        }
      }
    },
  
    // Mage spells
    earth_block: {
      spellId: 'earth_block',
      name: 'Earth Block',
      description: 'Summon a block of earth that blocks movement and line of sight',
      targeting: {
        targetType: 'CELL',
        range: { min: 1, max: 3 },
        requiresLoS: true,
        allowBlockedCellTarget: true,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'SPAWN_ENTITY',
          amount: 0,
          spawnEntity: {
            entityType: 'earth_block',
            name: 'Earth Block',
            health: 0, // Invulnerable
            duration: 0, // Permanent
            data: JSON.stringify({
              blocksMovement: true,
              blocksVision: true
            })
          }
        }
      ],
      presentation: {
        castAnim: 'cast3',
        impactVfx: 'earth_rise',
        sound: 'earth_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast3',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 600
        }
      }
    },
  
    arcane_missile: {
      spellId: 'arcane_missile',
      name: 'Arcane Missile',
      description: 'Hurl a bolt of arcane energy at a target',
      targeting: {
        targetType: 'CELL',
        range: { min: 2, max: 6 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE',
        multiTarget: true, // Allow multiple target selections
        maxTargets: 3 // Maximum number of targets
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 1,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        // Legacy projectile (kept for backward compatibility)
        projectile: { type: 'BOLT', speedCellsPerSec: 5 },
        // New detailed VFX system
        projectileVfx: {
          vfx: {
            type: 'SPHERE',
            size: 0.3, // Diameter of missile
            color: { r: 0.6, g: 0.4, b: 1.0 }, // Purple arcane color
            emissiveIntensity: 1.0, // Full glow
            opacity: 0.9,
            animated: true,
            animation: {
              rotationSpeed: 3.0, // Rotations per second
              scalePulse: true, // Pulsing effect
              pulseSpeed: 4.0 // Pulse cycles per second
            },
            duration: 0 // Lasts until impact
          },
          speedCellsPerSec: 5, // Speed in cells per second
          startDelayMs: 200, // Spawn 200ms after cast animation starts
          heightOffset: 0.6, // Float 0.6 units above ground
          trail: true, // Leave a trail
          trailVfx: {
            type: 'SPHERE',
            size: 0.12, // Smaller trail particles
            color: { r: 0.7, g: 0.5, b: 1.0 }, // Lighter purple
            emissiveIntensity: 0.8,
            opacity: 0.6,
            animated: false,
            duration: 300 // Trail particles fade after 300ms
          },
          trailLength: 0.8 // Trail extends 0.8 cells behind projectile
        },
        // Legacy impact VFX (kept for backward compatibility)
        impactVfx: 'arcane_explosion',
        // New detailed impact VFX
        impactVfxDef: {
          vfx: {
            type: 'SPHERE',
            size: 0.2, // Starting size
            color: { r: 0.8, g: 0.6, b: 1.0 }, // Bright purple
            emissiveIntensity: 1.0,
            opacity: 1.0,
            animated: true,
            animation: {
              scalePulse: false // No pulse, just expand
            },
            duration: 400 // Impact effect lasts 400ms
          },
          delayMs: 0, // Instant on impact
          duration: 400,
          size: 1.0, // Final explosion size (overrides vfx.size)
          explosive: true, // Expands outward
          explosionRadius: 1.2, // Explosion reaches 1.2 cells radius
          explosionDuration: 300 // Expansion takes 300ms
        },
        sound: 'arcane_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 1600
        }
      }
    },
  
    entangle: {
      spellId: 'entangle',
      name: 'Entangle',
      description: 'Root an enemy in place with vines',
      targeting: {
        targetType: 'UNIT',
        unitFilter: 'ENEMY',
        range: { min: 2, max: 4 },
        requiresLoS: true,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: true,
        pattern: 'SINGLE'
      },
      cost: { energy: 3 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 2,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'vines_grow',
        sound: 'entangle_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 800,
          impactDelayMs: 500
        }
      }
    },
  
    teleportation: {
      spellId: 'teleportation',
      name: 'Teleportation',
      description: 'Instantly teleport to a target cell',
      targeting: {
        targetType: 'CELL',
        range: { min: 2, max: 5 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'SINGLE'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 0
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'teleport_portal',
        sound: 'teleport_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 700,
          impactDelayMs: 400
        }
      }
    },
  
    ice_spikes: {
      spellId: 'ice_spikes',
      name: 'Ice Spikes',
      description: 'Summon spikes of ice from the ground',
      targeting: {
        targetType: 'CELL',
        range: { min: 2, max: 5 },
        requiresLoS: false,
        allowBlockedCellTarget: false,
        allowOccupiedCellTarget: false,
        pattern: 'CIRCLE1'
      },
      cost: { energy: 4 },
      effects: [
        {
          kind: 'DAMAGE',
          amount: 5,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'ice_spikes',
        sound: 'ice_cast'
      },
      animations: {
        prep: {
          name: 'stance',
          loop: true,
          blendInMs: 200,
          blendOutMs: 150,
          canMoveWhilePreparing: false
        },
        cast: {
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 600
        }
      }
    }
  };
  
  /**
   * Get a spell definition by ID
   * @param {string} spellId
   * @returns {SpellDef | null}
   */
  export const getSpell = (spellId) => {
    return SpellDefs[spellId] || null;
  };
  
  /**
   * Validate if a spell can be cast by a caster
   * @param {string} spellId
   * @param {Object} casterState - { userId, loadout: string[], energyLeft: number, position: {x, y} }
   * @returns {{ valid: boolean, error?: string }}
   */
  export const validateSpellForCaster = (spellId, casterState) => {
    const spell = getSpell(spellId);
    
    if (!spell) {
      return { valid: false, error: `Spell "${spellId}" not found` };
    }
    
    // Check spell is in loadout
    if (!casterState.loadout || !casterState.loadout.includes(spellId)) {
      return { valid: false, error: `Spell "${spellId}" is not in your loadout` };
    }
    
    // Check energy cost
    if (casterState.energyLeft < spell.cost.energy) {
      return { valid: false, error: `Not enough energy (need ${spell.cost.energy}, have ${casterState.energyLeft})` };
    }
    
    return { valid: true };
  };
  
  /**
   * Get available spells for a character (starter + unlocked)
   * @param {string} classId
   * @param {number} level
   * @param {Object} classSpellTable - Class spell table from gameData
   * @returns {string[]}
   */
  export const getPlayerAvailableSpells = (classId, level, classSpellTable) => {
    if (!classSpellTable || !classSpellTable[classId]) {
      return [];
    }
    
    const classData = classSpellTable[classId];
    const available = [...(classData.starter || [])];
    
    // Add unlocked spells
    if (classData.unlocks) {
      classData.unlocks.forEach(unlock => {
        if (level >= unlock.level) {
          available.push(unlock.spellId);
        }
      });
    }
    
    return available;
  };
  
  /**
   * Get player's loadout spell IDs from character
   * @param {Object} character - Character document with spellLoadout
   * @returns {string[]}
   */
  export const getPlayerLoadoutSpellIds = (character) => {
    return character?.spellLoadout || [];
  };
  
  /**
   * Convert a full SpellDef to a client-safe SpellClientDef
   * @param {SpellDef} spellDef
   * @returns {Object} SpellClientDef
   */
  export const toClientDef = (spellDef) => {
    return {
      spellId: spellDef.spellId,
      name: spellDef.name,
      icon: spellDef.icon,
      description: spellDef.description,
      targeting: {
        targetType: spellDef.targeting.targetType,
        unitFilter: spellDef.targeting.unitFilter,
        range: spellDef.targeting.range,
        requiresLoS: spellDef.targeting.requiresLoS,
        allowBlockedCellTarget: spellDef.targeting.allowBlockedCellTarget,
        allowOccupiedCellTarget: spellDef.targeting.allowOccupiedCellTarget,
        pattern: spellDef.targeting.pattern
      },
      cost: {
        energy: spellDef.cost.energy
      },
      cooldown: spellDef.cooldown,
      presentation: {
        castAnim: spellDef.presentation.castAnim,
        projectile: spellDef.presentation.projectile,
        impactVfx: spellDef.presentation.impactVfx,
        sound: spellDef.presentation.sound,
        hitDelayMs: spellDef.presentation.hitDelayMs
      },
      animations: {
        prep: spellDef.animations?.prep || null,
        cast: spellDef.animations?.cast || null
      }
    };
  };
  
  export default SpellDefs;
  
  