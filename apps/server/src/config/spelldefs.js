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
 * @typedef {Object} EffectDef
 * @property {"DAMAGE" | "HEAL"} kind
 * @property {number} amount
 * @property {"physical" | "magic"} [damageType] - Only for DAMAGE
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
 * @property {number} impactDelayMs - When spell effect should visually occur relative to cast start
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
 * @property {EffectDef[]} effects
 * @property {Object} presentation
 * @property {string} presentation.castAnim
 * @property {{ type: "NONE" | "BOLT" | "ARROW", speedCellsPerSec?: number }} [presentation.projectile]
 * @property {string} [presentation.impactVfx]
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
        requiresLoS: false, // MVP: no LoS initially
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
        projectile: { type: 'BOLT', speedCellsPerSec: 4 },
        impactVfx: 'explosion_small',
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
        range: { min: 1, max: 4 },
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
        castAnim: 'cast',
        impactVfx: 'heal_glow',
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
          name: 'cast',
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
          amount: 0 // Movement spell, no damage
        }
      ],
      presentation: {
        castAnim: 'dash',
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
          name: 'dash',
          blendInMs: 50,
          blendOutMs: 100,
          lockMs: 400,
          impactDelayMs: 200
        }
      }
    },
  
    smoke_trap: {
      spellId: 'smoke_trap',
      name: 'Smoke Trap',
      description: 'Place a smoke trap on a target cell',
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
        castAnim: 'melee',
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
          name: 'melee',
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
    earth_wall: {
      spellId: 'earth_wall',
      name: 'Earth Wall',
      description: 'Summon a wall of earth to block movement',
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
          kind: 'DAMAGE',
          amount: 0 // Utility spell
        }
      ],
      presentation: {
        castAnim: 'cast',
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
          name: 'cast',
          blendInMs: 100,
          blendOutMs: 200,
          lockMs: 1000,
          impactDelayMs: 600
        }
      }
    },
  
    arcane_explosion: {
      spellId: 'arcane_explosion',
      name: 'Arcane Explosion',
      description: 'Explosive arcane energy in an area',
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
          amount: 6,
          damageType: 'magic'
        }
      ],
      presentation: {
        castAnim: 'cast',
        impactVfx: 'arcane_explosion',
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
          impactDelayMs: 600
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
        sound: spellDef.presentation.sound
      },
      animations: {
        prep: spellDef.animations?.prep || null,
        cast: spellDef.animations?.cast || null
      }
    };
  };
  
  export default SpellDefs;
  
  