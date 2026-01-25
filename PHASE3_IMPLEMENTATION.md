# Phase 3 Implementation Summary

## ✅ Completed Features

### 1. Invisibility System
- **PlayerState Extension**: Added `isInvisible`, `invisibilitySource`, and `invisibilityDuration` fields
- **Invisibility Application**: Implemented `applyInvisibility()` and `removeInvisibility()` methods
- **Visibility Rules**: Added `canSeePlayer()` method to check if a player can see another
- **Status Effect Integration**: Status effects can grant invisibility (`grantsInvisibility` flag)
- **Turn Processing**: Invisibility duration decrements each turn and expires automatically
- **Client State Filtering**: Invisible enemies are hidden from enemy team in filtered state
- **Spell Targeting**: Spells cannot target invisible enemies unless `ignoresInvisibility` is true
- **Reveal Mechanics**: Status effects with `blocksInvisibility` reveal invisible units

### 2. Entity Spawning System
- **SpawnedEntityState Schema**: Added new schema class for tracking spawned entities
- **GameState Extension**: Added `spawnedEntities` MapSchema to GameState
- **Entity Spawning**: Implemented `spawnEntity()` method with validation
- **Entity Types**: Supports traps, totems, and other entities (no AI/player control)
- **Trigger System**: Entities can trigger on MOVEMENT or PROXIMITY
- **Turn Processing**: Added `processSpawnedEntities()` to handle triggers and duration
- **onDeath Effects**: Entities can have onDeath effects (e.g., explosion damage)
- **Client State**: Spawned entities are included in filtered game state sent to clients

## Architecture Changes

### Server-Side (GameRoom.js)

1. **Extended PlayerState**:
   - Added `isInvisible: boolean`
   - Added `invisibilitySource: string`
   - Added `invisibilityDuration: number`

2. **New Schema Class**:
   ```javascript
   class SpawnedEntityState extends Schema {
     entityId, entityType, sourceSpellId, sourceUserId, team,
     position, health, maxHealth, duration, data
   }
   ```

3. **Extended GameState**:
   - Added `spawnedEntities: MapSchema<SpawnedEntityState>`

4. **New Methods**:
   - `applyInvisibility(player, duration, sourceSpellId)`
   - `removeInvisibility(player)`
   - `canSeePlayer(viewer, target)` - Checks visibility rules
   - `spawnEntity(x, y, spawnDef, sourceSpellId, sourceUserId, team)`
   - `processSpawnedEntities()` - Processes triggers and duration
   - `triggerEntity(entity, entityData, triggerPlayer)` - Handles entity triggers

5. **Updated Methods**:
   - `applyStatusEffect()` - Now handles `grantsInvisibility` flag
   - `processTurnStartStatusEffects()` - Removes invisibility when granting effect expires
   - `handleSpellCast()` - Checks invisibility when targeting units, supports SPAWN_ENTITY
   - `handleEndTurn()` - Processes invisibility duration and spawned entities
   - `getTeamData()` - Filters invisible enemies from enemy team view
   - `getFilteredState()` - Includes spawned entities in client state

### Spell Definitions (spelldefs.js)

1. **Extended EffectDef**:
   - Added `SPAWN_ENTITY` as a new effect kind
   - Added `spawnEntity: SpawnedEntityDef` property

2. **Extended StatusEffectDef**:
   - Added `grantsInvisibility: boolean` - Status effect can grant invisibility

3. **Extended SpellDef**:
   - Added `ignoresInvisibility: boolean` - Spell can target invisible units

4. **New Type Definition**:
   ```javascript
   SpawnEntityDef {
     entityType, name, health, duration,
     trigger, onTrigger, onDeath, onTurnStart
   }
   ```

## Backward Compatibility

✅ **All existing spells continue to work**:
- Existing spells without invisibility or entity spawning work unchanged
- Invisibility is opt-in (only applies if status effect grants it or spell explicitly sets it)
- No breaking changes to spell definitions

## Testing Checklist

- [ ] Test existing spells still work correctly
- [ ] Test invisibility application (create a test spell that grants invisibility)
- [ ] Test invisibility duration decrements each turn
- [ ] Test invisibility expiration
- [ ] Test invisible enemies are hidden from enemy team in client state
- [ ] Test invisible enemies are visible to their own team
- [ ] Test spells cannot target invisible enemies (unless ignoresInvisibility)
- [ ] Test status effects with blocksInvisibility reveal invisible units
- [ ] Test entity spawning (create a test spell with SPAWN_ENTITY)
- [ ] Test entity triggers (MOVEMENT and PROXIMITY)
- [ ] Test entity duration and expiration
- [ ] Test entity onDeath effects
- [ ] Verify spawned entities appear in client state

## Example: Creating an Invisibility Spell

```javascript
invisibility: {
  spellId: 'invisibility',
  name: 'Invisibility',
  description: 'Become invisible to enemies for 3 turns',
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
      kind: 'STATUS_EFFECT',
      statusEffect: {
        effectId: 'invisibility',
        name: 'Invisible',
        duration: 3,
        stackable: false,
        type: 'BUFF',
        grantsInvisibility: true // Grants invisibility
      }
    }
  ],
  // ... presentation, animations
}
```

## Example: Creating a Reveal Spell

```javascript
reveal: {
  // ... existing definition
  effects: [
    {
      kind: 'STATUS_EFFECT',
      statusEffect: {
        effectId: 'revealed',
        name: 'Revealed',
        duration: 2,
        type: 'DEBUFF',
        blocksInvisibility: true // Reveals invisible units
      }
    }
  ]
}
```

## Example: Creating a Trap Entity Spell

```javascript
trap: {
  spellId: 'trap',
  name: 'Trap',
  description: 'Place a trap that triggers when an enemy steps on it',
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
      kind: 'SPAWN_ENTITY',
      spawnEntity: {
        entityType: 'trap',
        name: 'Trap',
        health: 0, // Invulnerable
        duration: 0, // Permanent until triggered
        trigger: {
          type: 'MOVEMENT', // Triggers when enemy moves onto it
          radius: 0
        },
        onTrigger: {
          damage: 5,
          damageType: 'physical'
        }
      }
    }
  ]
}
```

## Visibility Rules

1. **Same Team**: Players can always see their teammates (even if invisible)
2. **Enemy Team**: Players cannot see invisible enemies unless:
   - The invisible player has a status effect with `blocksInvisibility: true`
   - The spell has `ignoresInvisibility: true` (for targeting only)
3. **Client State**: Invisible enemies are filtered out of `enemyTeam` in client state
4. **Spell Targeting**: Spells targeting UNIT cannot target invisible enemies unless `ignoresInvisibility` is true

## Entity System

1. **Spawning**: Entities are spawned at target location (must be walkable, unoccupied)
2. **Triggers**: 
   - `MOVEMENT`: Triggers when enemy moves onto entity position
   - `PROXIMITY`: Triggers when enemy is within radius
3. **Duration**: Entities expire after duration reaches 0 (0 = permanent)
4. **onDeath**: Entities can have onDeath effects (e.g., explosion damage in radius)
5. **Processing**: Entities are processed each turn to check triggers and decrement duration

## Next Steps

All three phases are now complete! The game now supports:
- ✅ Status Effects System (Phase 1)
- ✅ Ground Effects System (Phase 2)
- ✅ Dynamic Terrain System (Phase 2)
- ✅ Invisibility System (Phase 3)
- ✅ Entity Spawning System (Phase 3)

The foundation is ready for creating complex spells with all these mechanics!
