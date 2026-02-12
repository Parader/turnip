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
  },

  /** Warrior: -20% damage resistance (take more damage), +20% damage dealt. Server must apply incomingDamageResistPercent when resolving damage to bearer. */
  rage: {
    effectId: 'rage',
    name: 'Rage',
    duration: 2,
    stackable: false,
    type: 'BUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    outgoingDamagePercent: 120,
    /** Stored in effect data: multiply incoming damage by (100 + this) / 100. -20 => take 20% more damage. */
    incomingDamageResistPercent: -20
  },

  /** Warrior slam: -1 AP, -1 MP for the affected turn. Expires at turn end so effect is visible during victim's turn. */
  dizzy: {
    effectId: 'dizzy',
    name: 'Dizzy',
    duration: 1,
    stackable: false,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    apModifier: -1,
    mpModifier: -1,
    /** Decrement duration at turn end (not start) so effect stays visible during victim's turn */
    expireAtTurnEnd: true
  },

  /** Warrior Slash: for victim's whole next turn, take 10 damage per movement point spent. Effect expires at turn end (not removed when moving). */
  slash_wound: {
    effectId: 'slash_wound',
    name: 'Slash Wound',
    duration: 1,
    stackable: false,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    expireAtTurnEnd: true,
    /** When bearer moves: 10 damage per MP spent. Effect is NOT removed; expires at turn end. */
    onMove: { damagePerMovementPoint: 10, damageType: 'physical', removeOnTrigger: false }
  },

  /** Warrior taunt: -2 MP. Expires at turn end so effect visible during victim's turn. */
  taunt_debuff: {
    effectId: 'taunt_debuff',
    name: 'Taunted',
    duration: 1,
    stackable: false,
    type: 'DEBUFF',
    onApply: {},
    onTurnStart: {},
    onTurnEnd: {},
    onRemove: {},
    mpModifier: -2,
    expireAtTurnEnd: true
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
