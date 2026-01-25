# Game Scaling Improvements - Complex Spell Mechanics

This document outlines architectural improvements needed to support advanced spell mechanics and game features.

## Table of Contents
1. [Status Effects System](#status-effects-system)
2. [Ground Effects System](#ground-effects-system)
3. [Entity Spawning System](#entity-spawning-system)
4. [Dynamic Terrain System](#dynamic-terrain-system)
5. [Invisibility System](#invisibility-system)
6. [Multi-Target & Area Effects](#multi-target--area-effects)
7. [Multi-Step Spells](#multi-step-spells)
8. [Effect Duration & Turn Tracking](#effect-duration--turn-tracking)
9. [Implementation Priority](#implementation-priority)

---

## 1. Status Effects System

### Overview
Add persistent buffs/debuffs that last for X turns and modify player stats or behavior.

### Architecture Changes

#### Server-Side Schema Extensions

**Add to `PlayerState` in `GameRoom.js`:**
```javascript
class StatusEffectState extends Schema {
  constructor() {
    super();
    this.effectId = ''; // e.g., 'bleed', 'burn', 'shield', 'rage'
    this.sourceSpellId = ''; // Spell that applied this effect
    this.sourceUserId = ''; // Who cast the spell
    this.duration = 0; // Turns remaining
    this.stacks = 1; // For stackable effects
    this.data = ''; // JSON string for effect-specific data (damage per turn, stat modifiers, etc.)
  }
}

defineTypes(StatusEffectState, {
  effectId: 'string',
  sourceSpellId: 'string',
  sourceUserId: 'string',
  duration: 'number',
  stacks: 'number',
  data: 'string' // JSON string
});

// Add to PlayerState:
this.statusEffects = new MapSchema(); // Map of effectId -> StatusEffectState
```

#### Spell Definition Extensions

**Extend `EffectDef` in `spelldefs.js`:**
```javascript
/**
 * @typedef {Object} EffectDef
 * @property {"DAMAGE" | "HEAL" | "MOVEMENT" | "STATUS_EFFECT" | "SPAWN_ENTITY" | "TERRAIN_CHANGE"} kind
 * @property {number} amount
 * @property {"physical" | "magic"} [damageType] - Only for DAMAGE
 * @property {StatusEffectDef} [statusEffect] - Only for STATUS_EFFECT
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
 * @property {Object} [onTurnStart] - Effects at start of each turn { damage?: number, heal?: number }
 * @property {Object} [onTurnEnd] - Effects at end of each turn
 * @property {Object} [onRemove] - Effects when removed
 * @property {boolean} [blocksInvisibility] - If true, effect is visible even if unit is invisible
 */
```

#### Example Spell: Bleed

```javascript
bleed: {
  spellId: 'bleed',
  name: 'Bleed',
  description: 'Causes target to bleed for 3 turns, dealing 2 damage per turn',
  targeting: {
    targetType: 'UNIT',
    unitFilter: 'ENEMY',
    range: { min: 1, max: 2 },
    requiresLoS: true,
    allowBlockedCellTarget: false,
    allowOccupiedCellTarget: true,
    pattern: 'SINGLE'
  },
  cost: { energy: 2 },
  effects: [
    {
      kind: 'STATUS_EFFECT',
      statusEffect: {
        effectId: 'bleed',
        name: 'Bleeding',
        duration: 3,
        stackable: true,
        maxStacks: 5,
        type: 'DEBUFF',
        onTurnStart: {
          damage: 2,
          damageType: 'physical'
        }
      }
    }
  ],
  // ... presentation, animations
}
```

#### Implementation Steps

1. **Add status effect processing to turn system:**
   - In `handleEndTurn()`, process all status effects for the ending player
   - Apply `onTurnStart` effects at the start of each player's turn
   - Decrement duration and remove expired effects

2. **Add status effect application in spell casting:**
   - When spell has `STATUS_EFFECT` effect, create `StatusEffectState` and add to target player
   - Handle stacking logic if effect is stackable

3. **Client-side rendering:**
   - Display status effect icons above/below player models
   - Show duration countdown
   - Visual indicators (particles, auras) for active effects

---

## 2. Ground Effects System

### Overview
Persistent effects on map cells (burning ground, poison clouds, healing zones) that affect units standing on them.

### Architecture Changes

#### Server-Side Schema Extensions

**Add to `GameState` in `GameRoom.js`:**
```javascript
class GroundEffectState extends Schema {
  constructor() {
    super();
    this.effectId = ''; // e.g., 'burning_ground', 'poison_cloud', 'healing_zone'
    this.sourceSpellId = ''; // Spell that created this
    this.sourceUserId = ''; // Who cast the spell
    this.x = 0;
    this.y = 0;
    this.radius = 1; // Cells affected (1 = single cell, 2 = 3x3, etc.)
    this.duration = 0; // Turns remaining (0 = permanent)
    this.data = ''; // JSON string for effect-specific data
  }
}

defineTypes(GroundEffectState, {
  effectId: 'string',
  sourceSpellId: 'string',
  sourceUserId: 'string',
  x: 'number',
  y: 'number',
  radius: 'number',
  duration: 'number',
  data: 'string'
});

// Add to GameState:
this.groundEffects = new MapSchema(); // Map of "x_y" -> GroundEffectState
```

#### Spell Definition Extensions

**Extend `EffectDef`:**
```javascript
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
```

#### Example Spell: Burning Ground

```javascript
burning_ground: {
  spellId: 'burning_ground',
  name: 'Burning Ground',
  description: 'Creates a zone of fire that burns enemies for 4 turns',
  targeting: {
    targetType: 'CELL',
    range: { min: 2, max: 5 },
    requiresLoS: true,
    allowBlockedCellTarget: false,
    allowOccupiedCellTarget: false,
    pattern: 'CIRCLE1' // Area effect
  },
  cost: { energy: 4 },
  effects: [
    {
      kind: 'GROUND_EFFECT',
      groundEffect: {
        effectId: 'burning_ground',
        name: 'Burning Ground',
        duration: 4,
        radius: 1,
        onEnter: {
          damage: 3,
          damageType: 'magic'
        },
        onTurnStart: {
          damage: 2,
          damageType: 'magic'
        },
        blocksMovement: false
      }
    }
  ],
  presentation: {
    // Ground effect VFX already exists in your system!
    groundEffectVfx: {
      vfx: {
        type: 'CYLINDER',
        size: 0.1,
        color: { r: 1.0, g: 0.3, b: 0.0 },
        emissiveIntensity: 0.9,
        opacity: 0.8,
        animated: true,
        duration: 0 // Permanent until removed
      },
      duration: 0, // Will be managed by server
      radius: 1.0
    }
  }
}
```

#### Implementation Steps

1. **Add ground effect processing:**
   - When spell creates ground effect, add to `GameState.groundEffects`
   - At start/end of each turn, check if player is on a cell with ground effects
   - Apply effects based on `onEnter`, `onTurnStart`, `onTurnEnd`

2. **Movement validation:**
   - Check `blocksMovement` when calculating paths
   - Update pathfinding to avoid blocked cells

3. **Client-side rendering:**
   - Use existing `groundEffectVfx` system
   - Track ground effects in Babylon scene and render them
   - Remove VFX when effect expires

---

## 3. Entity Spawning System

### Overview
Allow spells to spawn temporary entities (summons, traps, totems) that can act independently or trigger on conditions.

### Architecture Changes

#### Server-Side Schema Extensions

**Add to `GameState`:**
```javascript
class SpawnedEntityState extends Schema {
  constructor() {
    super();
    this.entityId = ''; // Unique ID
    this.entityType = ''; // e.g., 'summon_skeleton', 'trap', 'totem'
    this.sourceSpellId = '';
    this.sourceUserId = '';
    this.team = ''; // 'A' or 'B' - which team owns this entity
    this.position = new PositionState();
    this.health = 0;
    this.maxHealth = 0;
    this.duration = 0; // Turns remaining (0 = permanent)
    this.data = ''; // JSON string for entity-specific data
  }
}

defineTypes(SpawnedEntityState, {
  entityId: 'string',
  entityType: 'string',
  sourceSpellId: 'string',
  sourceUserId: 'string',
  team: 'string',
  position: PositionState,
  health: 'number',
  maxHealth: 'number',
  duration: 'number',
  data: 'string'
});

// Add to GameState:
this.spawnedEntities = new MapSchema(); // Map of entityId -> SpawnedEntityState
```

#### Spell Definition Extensions

```javascript
/**
 * @typedef {Object} SpawnEntityDef
 * @property {string} entityType - Type identifier
 * @property {string} name - Display name
 * @property {number} health - Starting health
 * @property {number} duration - Turns entity lasts (0 = permanent)
 * @property {Object} [stats] - Entity stats { movement?: number, energy?: number, offense?: number }
 * @property {string[]} [spells] - Spells the entity can cast
 * @property {Object} [onSpawn] - Effects when spawned
 * @property {Object} [onDeath] - Effects when entity dies
 * @property {Object} [onTurnStart] - Actions at start of entity's turn
 * @property {Object} [trigger] - For traps: { type: 'MOVEMENT' | 'PROXIMITY', radius?: number }
 */
```

#### Example Spell: Summon Skeleton

```javascript
summon_skeleton: {
  spellId: 'summon_skeleton',
  name: 'Summon Skeleton',
  description: 'Summons a skeleton warrior that fights for you for 5 turns',
  targeting: {
    targetType: 'CELL',
    range: { min: 1, max: 2 },
    requiresLoS: true,
    allowBlockedCellTarget: false,
    allowOccupiedCellTarget: false,
    pattern: 'SINGLE'
  },
  cost: { energy: 5 },
  effects: [
    {
      kind: 'SPAWN_ENTITY',
      spawnEntity: {
        entityType: 'skeleton_warrior',
        name: 'Skeleton Warrior',
        health: 15,
        duration: 5,
        stats: {
          movement: 3,
          energy: 3,
          offense: 4
        },
        spells: ['slash'], // Entity can cast this spell
        onDeath: {
          damage: 2, // Explodes on death, dealing damage to nearby enemies
          radius: 1
        }
      }
    }
  ]
}
```

#### Implementation Steps

1. **Add entity spawning:**
   - When spell creates entity, add to `GameState.spawnedEntities`
   - Add entity to turn order (or give them their own turn phase)
   - Entities can move and cast spells like players

2. **Entity AI/Behavior:**
   - Simple AI: move toward nearest enemy, attack if in range
   - Or player-controlled: player can control their summons

3. **Client-side rendering:**
   - Load entity models (can reuse character models or create new ones)
   - Render entities in Babylon scene
   - Show health bars, duration indicators

---

## 4. Dynamic Terrain System

### Overview
Allow spells to destroy/create walls, change terrain types, create obstacles.

### Architecture Changes

#### Server-Side Schema Extensions

**Modify `GameState`:**
```javascript
// Add terrain modifications tracking
this.terrainModifications = new MapSchema(); // Map of "x_y" -> TerrainModState

class TerrainModState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.originalType = 0; // TILE_TYPES value before modification
    this.newType = 0; // TILE_TYPES value after modification
    this.duration = 0; // Turns until reversion (0 = permanent)
    this.sourceSpellId = '';
    this.sourceUserId = '';
  }
}

defineTypes(TerrainModState, {
  x: 'number',
  y: 'number',
  originalType: 'number',
  newType: 'number',
  duration: 'number',
  sourceSpellId: 'string',
  sourceUserId: 'string'
});
```

#### Spell Definition Extensions

```javascript
/**
 * @typedef {Object} TerrainChangeDef
 * @property {number} fromType - Terrain type to change from (TILE_TYPES value)
 * @property {number} toType - Terrain type to change to
 * @property {number} [duration] - Turns until terrain reverts (0 = permanent)
 * @property {number} [radius] - Radius of change (default: 1)
 */
```

#### Example Spell: Break Walls (Enhanced)

```javascript
break_walls: {
  // ... existing definition
  effects: [
    {
      kind: 'TERRAIN_CHANGE',
      terrainChange: {
        fromType: TILE_TYPES.WALL,
        toType: TILE_TYPES.TILE,
        duration: 0, // Permanent
        radius: 1
      }
    },
    {
      kind: 'DAMAGE',
      amount: 10,
      damageType: 'physical'
    }
  ]
}
```

#### Implementation Steps

1. **Terrain modification:**
   - When spell changes terrain, update `terrainModifications` map
   - Create modified terrain lookup function that checks modifications first
   - Update pathfinding to use modified terrain

2. **Terrain reversion:**
   - At end of each turn, decrement duration for temporary modifications
   - Remove modifications when duration reaches 0

3. **Client-side rendering:**
   - Update map mesh when terrain changes
   - Animate wall destruction (particles, collapse animation)
   - Update pathfinding visualization

---

## 5. Invisibility System

### Overview
Allow units to become invisible, affecting visibility rules and targeting.

### Architecture Changes

#### Server-Side Schema Extensions

**Add to `PlayerState`:**
```javascript
this.isInvisible = false;
this.invisibilitySource = ''; // Spell or effect that granted invisibility
this.invisibilityDuration = 0; // Turns remaining
```

#### Spell Definition Extensions

**Update `invisibility` spell:**
```javascript
invisibility: {
  // ... existing definition
  effects: [
    {
      kind: 'STATUS_EFFECT',
      statusEffect: {
        effectId: 'invisibility',
        name: 'Invisible',
        duration: 3, // Lasts 3 turns
        type: 'BUFF',
        onApply: {
          // Grant invisibility
        },
        onRemove: {
          // Remove invisibility
        }
      }
    }
  ]
}
```

#### Implementation Steps

1. **Visibility rules:**
   - Invisible units are not visible to enemies (don't send position in filtered state)
   - Invisible units can still be revealed by certain spells (like `reveal`)
   - Update line of sight calculations to account for invisibility

2. **Targeting restrictions:**
   - Enemy spells cannot target invisible units (unless spell ignores invisibility)
   - Area effects still affect invisible units (they're not invulnerable)

3. **Client-side rendering:**
   - Hide invisible enemy units (or show as transparent/shadowy)
   - Show "Invisible" status indicator
   - Reveal animation when invisibility breaks

---

## 6. Multi-Target & Area Effects

### Overview
Properly implement area patterns (CIRCLE1, LINE3) to affect multiple targets.

### Architecture Changes

#### Helper Functions

**Add to `GameRoom.js`:**
```javascript
/**
 * Get all cells affected by a spell pattern
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {string} pattern - Pattern type ('SINGLE', 'CIRCLE1', 'LINE3', etc.)
 * @param {number} [radius] - Radius for circle patterns
 * @returns {Array<{x: number, y: number}>} Array of affected cells
 */
function getPatternCells(centerX, centerY, pattern, radius = 1) {
  const cells = [];
  
  switch (pattern) {
    case 'SINGLE':
      cells.push({ x: centerX, y: centerY });
      break;
      
    case 'CIRCLE1':
      // 3x3 circle (8 surrounding cells + center)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          cells.push({ x: centerX + dx, y: centerY + dy });
        }
      }
      break;
      
    case 'CIRCLE2':
      // 5x5 circle (2-cell radius)
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist <= 2) {
            cells.push({ x: centerX + dx, y: centerY + dy });
          }
        }
      }
      break;
      
    case 'LINE3':
      // 3-cell line in direction from caster to target
      // This requires caster position - would need to pass it
      break;
      
    default:
      cells.push({ x: centerX, y: centerY });
  }
  
  return cells;
}

/**
 * Get all units in a pattern
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {string} pattern - Pattern type
 * @param {string} [unitFilter] - 'ENEMY', 'ALLY', 'ANY'
 * @param {string} casterTeam - Team of caster ('A' or 'B')
 * @returns {Array<PlayerState>} Array of affected players
 */
function getUnitsInPattern(centerX, centerY, pattern, unitFilter, casterTeam) {
  const cells = getPatternCells(centerX, centerY, pattern);
  const affectedUnits = [];
  
  cells.forEach(cell => {
    // Check Team A
    this.state.teamA.players.forEach((player, userId) => {
      if (player.position.x === cell.x && player.position.y === cell.y) {
        if (!unitFilter || unitFilter === 'ANY' || 
            (unitFilter === 'ENEMY' && casterTeam !== 'A') ||
            (unitFilter === 'ALLY' && casterTeam === 'A')) {
          affectedUnits.push(player);
        }
      }
    });
    
    // Check Team B
    this.state.teamB.players.forEach((player, userId) => {
      if (player.position.x === cell.x && player.position.y === cell.y) {
        if (!unitFilter || unitFilter === 'ANY' || 
            (unitFilter === 'ENEMY' && casterTeam !== 'B') ||
            (unitFilter === 'ALLY' && casterTeam === 'B')) {
          affectedUnits.push(player);
        }
      }
    });
  });
  
  return affectedUnits;
}
```

#### Update Spell Casting

**Modify `handleSpellCast()` in `GameRoom.js`:**
```javascript
// Replace single-target logic with pattern-based targeting
const pattern = targeting.pattern || 'SINGLE';
const affectedUnits = getUnitsInPattern(
  targetX, 
  targetY, 
  pattern, 
  targeting.unitFilter, 
  team
);

// Apply effects to all affected units
affectedUnits.forEach(targetPlayer => {
  // Apply damage/heal/effects
});
```

---

## 7. Multi-Step Spells

### Overview
Spells that have multiple phases or steps (channeling, delayed effects, combo spells).

### Architecture Changes

#### Server-Side Schema Extensions

**Add to `GameState`:**
```javascript
class ActiveSpellState extends Schema {
  constructor() {
    super();
    this.spellId = '';
    this.casterUserId = '';
    this.step = 0; // Current step (0-indexed)
    this.totalSteps = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.data = ''; // JSON string for spell-specific data
  }
}

defineTypes(ActiveSpellState, {
  spellId: 'string',
  casterUserId: 'string',
  step: 'number',
  totalSteps: 'number',
  targetX: 'number',
  targetY: 'number',
  data: 'string'
});

// Add to GameState:
this.activeSpells = new MapSchema(); // Multi-step spells in progress
```

#### Spell Definition Extensions

```javascript
/**
 * @typedef {Object} MultiStepDef
 * @property {number} steps - Number of steps
 * @property {Array<EffectDef[]>} stepEffects - Effects for each step
 * @property {number} [stepDuration] - Turns between steps (default: 1)
 * @property {boolean} [channeled] - If true, caster must maintain (can't move/cast other spells)
 */
```

#### Example Spell: Channeled Fire

```javascript
channeled_fire: {
  spellId: 'channeled_fire',
  name: 'Channeled Fire',
  description: 'Channel fire for 3 turns, dealing increasing damage each turn',
  targeting: {
    targetType: 'UNIT',
    unitFilter: 'ENEMY',
    range: { min: 2, max: 5 },
    requiresLoS: true,
    pattern: 'SINGLE'
  },
  cost: { energy: 3 },
  multiStep: {
    steps: 3,
    channeled: true,
    stepEffects: [
      [{ kind: 'DAMAGE', amount: 2, damageType: 'magic' }],
      [{ kind: 'DAMAGE', amount: 4, damageType: 'magic' }],
      [{ kind: 'DAMAGE', amount: 6, damageType: 'magic' }]
    ]
  }
}
```

#### Implementation Steps

1. **Multi-step processing:**
   - When multi-step spell is cast, add to `activeSpells`
   - At start of each turn, process active spells and advance steps
   - Apply step effects and remove when complete

2. **Channeling restrictions:**
   - If `channeled: true`, prevent caster from moving or casting other spells
   - Cancel channel if caster takes damage (optional)

3. **Client-side:**
   - Show channeling animation/VFX
   - Display step progress
   - Visual connection between caster and target

---

## 8. Effect Duration & Turn Tracking

### Overview
Centralized system for tracking and processing all time-based effects.

### Architecture Changes

**Add turn processing system to `GameRoom.js`:**
```javascript
/**
 * Process all time-based effects at the start of a player's turn
 */
processTurnStartEffects(player) {
  // Process status effects
  if (player.statusEffects) {
    player.statusEffects.forEach((effect, effectId) => {
      const effectData = JSON.parse(effect.data || '{}');
      
      // Apply onTurnStart effects
      if (effectData.onTurnStart) {
        if (effectData.onTurnStart.damage) {
          player.health -= effectData.onTurnStart.damage;
          if (player.health < 0) player.health = 0;
        }
        if (effectData.onTurnStart.heal) {
          player.health += effectData.onTurnStart.heal;
          if (player.health > player.maxHealth) player.health = player.maxHealth;
        }
      }
      
      // Decrement duration
      effect.duration--;
      if (effect.duration <= 0) {
        // Apply onRemove effects
        if (effectData.onRemove) {
          // Handle removal effects
        }
        player.statusEffects.delete(effectId);
      }
    });
  }
  
  // Process ground effects at player's position
  const posKey = `${player.position.x}_${player.position.y}`;
  const groundEffect = this.state.groundEffects.get(posKey);
  if (groundEffect) {
    const effectData = JSON.parse(groundEffect.data || '{}');
    
    if (effectData.onTurnStart) {
      // Apply ground effect
    }
    
    // Decrement duration
    groundEffect.duration--;
    if (groundEffect.duration <= 0) {
      this.state.groundEffects.delete(posKey);
    }
  }
  
  // Process spawned entities
  this.state.spawnedEntities.forEach((entity, entityId) => {
    if (entity.team === this.userTeams.get(player.userId)) {
      // Entity's turn - AI or player control
    }
    
    entity.duration--;
    if (entity.duration <= 0) {
      // Handle entity expiration
      this.state.spawnedEntities.delete(entityId);
    }
  });
  
  // Process active multi-step spells
  this.state.activeSpells.forEach((spell, spellId) => {
    if (spell.casterUserId === player.userId) {
      // Advance spell step
      spell.step++;
      if (spell.step >= spell.totalSteps) {
        this.state.activeSpells.delete(spellId);
      }
    }
  });
}

// Call in handleEndTurn before advancing to next player
```

---

## 9. Implementation Priority

### Phase 1: Foundation (Critical)
1. **Status Effects System** - Enables buffs/debuffs, bleed, burn, etc.
2. **Effect Duration Tracking** - Core system for all time-based effects
3. **Multi-Target Area Effects** - Complete CIRCLE1, LINE3 pattern implementation

### Phase 2: Environmental (High Value)
4. **Ground Effects System** - Burning ground, poison clouds, healing zones
5. **Dynamic Terrain** - Wall destruction, terrain modification

### Phase 3: Advanced Mechanics (Medium Priority)
6. **Invisibility System** - Enhance existing invisibility spell
7. **Entity Spawning** - Summons, traps, totems

### Phase 4: Complex Spells (Lower Priority)
8. **Multi-Step Spells** - Channeling, delayed effects, combo spells

---

## Additional Considerations

### Performance
- Use efficient data structures (Maps for O(1) lookups)
- Batch effect processing to minimize state updates
- Limit maximum concurrent effects per player

### Network Optimization
- Only send changed effects in state updates
- Compress effect data when possible
- Client-side prediction for visual effects

### Testing
- Unit tests for effect processing logic
- Integration tests for spell interactions
- Performance tests for large numbers of effects

### Balance
- Effect durations should be meaningful but not overwhelming
- Stack limits prevent infinite scaling
- Clear visual feedback for all effects

---

## Example: Complete Bleed Spell Implementation

```javascript
// In spelldefs.js
bleed: {
  spellId: 'bleed',
  name: 'Bleed',
  description: 'Causes target to bleed for 3 turns, dealing 2 physical damage per turn',
  targeting: {
    targetType: 'UNIT',
    unitFilter: 'ENEMY',
    range: { min: 1, max: 2 },
    requiresLoS: true,
    allowBlockedCellTarget: false,
    allowOccupiedCellTarget: true,
    pattern: 'SINGLE'
  },
  cost: { energy: 2 },
  effects: [
    {
      kind: 'STATUS_EFFECT',
      statusEffect: {
        effectId: 'bleed',
        name: 'Bleeding',
        duration: 3,
        stackable: true,
        maxStacks: 5,
        type: 'DEBUFF',
        onTurnStart: {
          damage: 2,
          damageType: 'physical'
        }
      }
    }
  ],
  presentation: {
    castAnim: 'melee',
    impactVfx: 'bleed_impact',
    sound: 'bleed_cast'
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
}
```

This document provides a comprehensive roadmap for scaling your game mechanics. Start with Phase 1 to establish the foundation, then gradually add more complex features.
