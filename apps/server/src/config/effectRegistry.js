/**
 * Data-driven status effect definitions and safety limits.
 * Single source of truth for effect IDs and behavior; spells reference these by effectId.
 * Effects trigger only on turn events (turn start for active character); no tick-based updates.
 */

/** Max status effects per entity to prevent state bloat */
export const MAX_EFFECTS_PER_ENTITY = 32;

/** Max stacks per effect (stackable effects) */
export const MAX_STACKS = 10;

/** Max outcomes per turn start to prevent infinite loops */
export const MAX_OUTCOMES_PER_TURN = 20;

/**
 * Effect definitions keyed by effectId.
 * Shape matches StatusEffectDef (spelldefs): effectId, name, duration, stackable, maxStacks, type,
 * onApply, onTurnStart, onTurnEnd, onRemove, and optional blocksCasting / outgoingDamagePercent in data.
 */
export const EffectRegistry = {
  poison: {
    effectId: 'poison',
    name: 'Poison',
    duration: 3,
    stackable: true,
    maxStacks: 10,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: { damage: 8 },
    onTurnEnd: {},
    onRemove: {}
  },
  weakness: {
    effectId: 'weakness',
    name: 'Weakness',
    duration: 2,
    stackable: false,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    /** Stored in effect data: outgoing damage multiplier (0-1). 0.8 = -20% damage. */
    outgoingDamagePercent: 80
  },
  silence: {
    effectId: 'silence',
    name: 'Silence',
    duration: 2,
    stackable: false,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    /** When present, blocks spell casting (checked in spell validation). */
    blocksCasting: true
  }
};

/**
 * Get effect definition by id.
 * @param {string} effectId
 * @returns {Object|undefined} StatusEffectDef or undefined
 */
export function getEffectDef(effectId) {
  return EffectRegistry[effectId];
}
