import { Vector3, MeshBuilder, StandardMaterial, DynamicTexture, Mesh } from '@babylonjs/core';

const COMBAT_TEXT_CONFIG = {
  poolSize: 40,
  aggregationWindowMs: 200,
  baseAnchorHeight: 1.35,
  stackStep: 0.16,
  randomOffsetRange: 0.22,
  spawnDelayMs: 70,
  damageSyncWindowMs: 2000,
  damageHitOffsetMs: 650,
  damageExtraDelayMs: 200
};

const COMBAT_TEXT_STYLES = {
  damage: {
    color: '#ffd15a',
    outlineColor: 'rgba(0, 0, 0, 0.95)',
    shadowColor: 'rgba(0, 0, 0, 0.7)',
    fontSize: 96,
    baseScale: 0.95,
    duration: 0.85,
    floatY: 0.55,
    horizontalDrift: 0.18,
    punchStrength: 0.38,
    punchDuration: 0.12,
    fadeStart: 0.55
  },
  crit: {
    color: '#ffb24a',
    outlineColor: 'rgba(0, 0, 0, 0.98)',
    shadowColor: 'rgba(0, 0, 0, 0.75)',
    fontSize: 120,
    baseScale: 1.15,
    duration: 1.05,
    floatY: 0.7,
    horizontalDrift: 0.22,
    punchStrength: 0.6,
    punchDuration: 0.16,
    fadeStart: 0.6,
    shake: 0.03,
    shakeDuration: 0.18
  },
  healing: {
    color: '#7eff9e',
    outlineColor: 'rgba(0, 0, 0, 0.9)',
    shadowColor: 'rgba(0, 0, 0, 0.65)',
    fontSize: 92,
    baseScale: 0.9,
    duration: 1.15,
    floatY: 0.8,
    horizontalDrift: 0.08,
    punchStrength: 0.18,
    punchDuration: 0.12,
    fadeStart: 0.65,
    calmFloat: true
  },
  shield: {
    color: '#7ad7ff',
    outlineColor: 'rgba(0, 0, 0, 0.9)',
    shadowColor: 'rgba(0, 0, 0, 0.65)',
    fontSize: 88,
    baseScale: 0.88,
    duration: 0.75,
    floatY: 0.4,
    horizontalDrift: 0.05,
    punchStrength: 0.32,
    punchDuration: 0.12,
    fadeStart: 0.5,
    solid: true
  },
  resourceMp: {
    color: '#3cb371',
    outlineColor: 'rgba(0, 0, 0, 0.85)',
    shadowColor: 'rgba(0, 0, 0, 0.55)',
    fontSize: 72,
    baseScale: 0.7,
    duration: 0.6,
    floatY: 0.35,
    horizontalDrift: 0.05,
    punchStrength: 0.12,
    punchDuration: 0.1,
    fadeStart: 0.45,
    baseAlpha: 0.85
  },
  resourceAp: {
    color: '#6aa5ff',
    outlineColor: 'rgba(0, 0, 0, 0.85)',
    shadowColor: 'rgba(0, 0, 0, 0.55)',
    fontSize: 72,
    baseScale: 0.7,
    duration: 0.6,
    floatY: 0.35,
    horizontalDrift: 0.05,
    punchStrength: 0.12,
    punchDuration: 0.1,
    fadeStart: 0.45,
    baseAlpha: 0.85
  }
};

function createCombatTextMesh(scene) {
  const mesh = MeshBuilder.CreatePlane('combat_text', { width: 1.4, height: 0.7 }, scene);
  const texture = new DynamicTexture('combat_text_texture', { width: 512, height: 256 }, scene, false);
  texture.hasAlpha = true;

  const material = new StandardMaterial('combat_text_material', scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.opacityTexture = texture;
  material.disableLighting = true;
  material.backFaceCulling = false;

  mesh.material = material;
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.isPickable = false;
  mesh.setEnabled(false);
  mesh.isVisible = false;
  mesh.metadata = {
    texture,
    material
  };

  return mesh;
}

function drawCombatText(texture, text, style) {
  const context = texture.getContext();
  const width = texture.getSize().width;
  const height = texture.getSize().height;

  context.clearRect(0, 0, width, height);
  context.save();
  context.font = `bold ${style.fontSize}px "Arial Black", "Arial", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = Math.max(6, Math.floor(style.fontSize * 0.12));

  context.shadowColor = style.shadowColor;
  context.shadowBlur = Math.max(8, Math.floor(style.fontSize * 0.2));
  context.shadowOffsetX = 0;
  context.shadowOffsetY = Math.max(2, Math.floor(style.fontSize * 0.05));

  context.strokeStyle = style.outlineColor;
  context.strokeText(text, width * 0.5, height * 0.55);

  context.fillStyle = style.color;
  context.fillText(text, width * 0.5, height * 0.55);
  context.restore();

  texture.update();
}

function formatCombatText(type, amount, label) {
  const absAmount = Math.abs(Math.round(amount));
  if (type === 'resourceMp' || type === 'resourceAp') {
    const sign = amount >= 0 ? '+' : '-';
    return `${sign}${absAmount}`;
  }
  if (type === 'healing' || type === 'shield') {
    return `+${absAmount}`;
  }
  return `${absAmount}`;
}

function queueCombatText(scene, payload) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || !payload || !payload.targetKey) {
    return;
  }

  const now = Date.now();
  const delayMs = Math.max(0, payload.delayMs || 0);
  const availableAt = now + delayMs;
  const key = `${payload.targetKey}:${payload.type}:${payload.label || ''}`;
  const existing = combatText.pending.get(key);

  if (existing && now - existing.lastTime <= COMBAT_TEXT_CONFIG.aggregationWindowMs) {
    existing.amount += payload.amount;
    existing.lastTime = now;
    existing.availableAt = Math.max(existing.availableAt, availableAt);
    return;
  }

  combatText.pending.set(key, {
    ...payload,
    lastTime: now,
    availableAt
  });
}

function flushCombatTextAggregates(scene, now) {
  const combatText = scene.metadata?.combatText;
  if (!combatText) {
    return;
  }

  combatText.pending.forEach((entry, key) => {
    if (now >= entry.availableAt && now - entry.lastTime >= COMBAT_TEXT_CONFIG.aggregationWindowMs) {
      combatText.pending.delete(key);
      spawnCombatText(scene, entry);
    }
  });
}

function resolveTargetAnchorHeight(targetMesh) {
  if (!targetMesh || !targetMesh.getBoundingInfo) {
    return COMBAT_TEXT_CONFIG.baseAnchorHeight;
  }
  try {
    const boundingInfo = targetMesh.getBoundingInfo();
    const maxWorldY = boundingInfo?.boundingBox?.maximumWorld?.y;
    if (typeof maxWorldY === 'number' && targetMesh.position) {
      const height = maxWorldY - targetMesh.position.y;
      return Math.max(COMBAT_TEXT_CONFIG.baseAnchorHeight, height + 0.2);
    }
  } catch (error) {
    // Ignore bounding errors, fall back to default height
  }
  return COMBAT_TEXT_CONFIG.baseAnchorHeight;
}

function spawnCombatText(scene, payload) {
  const combatText = scene.metadata?.combatText;
  if (!combatText) {
    return;
  }
  
  const style = COMBAT_TEXT_STYLES[payload.type] || COMBAT_TEXT_STYLES.damage;
  const mesh = combatText.pool.pop() || reuseOldestCombatText(combatText) || createCombatTextMesh(scene);

  const targetStack = combatText.targetStacks.get(payload.targetKey) || [];
  const stackIndex = targetStack.length;
  const offsetX = (Math.random() - 0.5) * 2 * COMBAT_TEXT_CONFIG.randomOffsetRange;
  const offsetZ = (Math.random() - 0.5) * 2 * COMBAT_TEXT_CONFIG.randomOffsetRange;
  const driftX = (Math.random() - 0.5) * 2 * style.horizontalDrift;
  const driftZ = (Math.random() - 0.5) * 2 * style.horizontalDrift;

  const entry = {
    mesh,
    targetKey: payload.targetKey,
    targetMesh: payload.targetMesh,
    type: payload.type,
    label: payload.label,
    amount: payload.amount,
    startTime: Date.now(),
    duration: style.duration,
    fadeStart: style.fadeStart,
    baseScale: style.baseScale,
    floatY: style.floatY,
    driftX,
    driftZ,
    offsetX,
    offsetZ,
    stackIndex,
    punchStrength: style.punchStrength,
    punchDuration: style.punchDuration,
    baseAlpha: style.baseAlpha ?? 1,
    calmFloat: style.calmFloat,
    solid: style.solid,
    shake: style.shake || 0,
    shakeDuration: style.shakeDuration || 0,
    anchorHeight: resolveTargetAnchorHeight(payload.targetMesh)
  };

  targetStack.push(entry);
  combatText.targetStacks.set(payload.targetKey, targetStack);

  const text = formatCombatText(payload.type, payload.amount, payload.label);
  drawCombatText(entry.mesh.metadata.texture, text, style);

  entry.mesh.material.alpha = entry.baseAlpha;
  entry.mesh.setEnabled(true);
  entry.mesh.isVisible = true;

  combatText.active.push(entry);
}

function reuseOldestCombatText(combatText) {
  if (!combatText.active.length) {
    return null;
  }

  const entry = combatText.active.shift();
  const stack = combatText.targetStacks.get(entry.targetKey);
  if (stack) {
    const index = stack.indexOf(entry);
    if (index !== -1) {
      stack.splice(index, 1);
    }
    if (stack.length === 0) {
      combatText.targetStacks.delete(entry.targetKey);
    }
  }

  return entry.mesh;
}

function updateCombatTextSystem(scene, now) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || combatText.active.length === 0) {
    flushPendingDamageTimeouts(scene, now);
    return;
  }

  flushPendingDamageTimeouts(scene, now);

  for (let i = combatText.active.length - 1; i >= 0; i -= 1) {
    const entry = combatText.active[i];
    const age = (now - entry.startTime) / 1000;
    const progress = age / entry.duration;

    if (progress >= 1) {
      entry.mesh.setEnabled(false);
      entry.mesh.isVisible = false;
      combatText.active.splice(i, 1);
      combatText.pool.push(entry.mesh);

      const stack = combatText.targetStacks.get(entry.targetKey);
      if (stack) {
        const index = stack.indexOf(entry);
        if (index !== -1) {
          stack.splice(index, 1);
        }
        if (stack.length === 0) {
          combatText.targetStacks.delete(entry.targetKey);
        }
      }
      continue;
    }

    const easedProgress = entry.calmFloat
      ? Math.pow(progress, 0.7)
      : progress;
    const moveProgress = entry.solid
      ? Math.min(progress / 0.5, 1)
      : easedProgress;

    const baseAlpha = entry.baseAlpha;
    let alpha = baseAlpha;
    if (progress >= entry.fadeStart) {
      const fadeProgress = (progress - entry.fadeStart) / (1 - entry.fadeStart);
      alpha = baseAlpha * (1 - fadeProgress);
    }

    let punch = 0;
    if (age < entry.punchDuration) {
      const punchT = age / entry.punchDuration;
      punch = Math.sin(punchT * Math.PI) * (1 - punchT) * entry.punchStrength;
    }
    const scale = entry.baseScale * (1 + punch);

    const targetMesh = entry.targetMesh;
    const baseX = targetMesh?.position?.x ?? 0;
    const baseY = (targetMesh?.position?.y ?? 0) + entry.anchorHeight;
    const baseZ = targetMesh?.position?.z ?? 0;

    let shakeX = 0;
    let shakeZ = 0;
    if (entry.shake && age < entry.shakeDuration) {
      shakeX = (Math.random() - 0.5) * entry.shake;
      shakeZ = (Math.random() - 0.5) * entry.shake;
    }

    entry.mesh.position.set(
      baseX + entry.offsetX + entry.driftX * moveProgress + shakeX,
      baseY + entry.stackIndex * COMBAT_TEXT_CONFIG.stackStep + entry.floatY * moveProgress,
      baseZ + entry.offsetZ + entry.driftZ * moveProgress + shakeZ
    );

    entry.mesh.scaling.set(scale, scale, scale);
    entry.mesh.material.alpha = Math.max(0, alpha);
  }
}

function flushPendingDamageTimeouts(scene, now) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || combatText.pendingDamage.size === 0) {
    return;
  }

  combatText.pendingDamage.forEach((pending, key) => {
    if (now >= pending.expiresAt) {
      combatText.pendingDamage.delete(key);
      
      // Skip if unit not yet initialized (startup noise)
      if (!combatText.initializedUnits.has(key)) {
        return;
      }
      
      const baseDelay = pending.hitDelayMs ?? COMBAT_TEXT_CONFIG.damageHitOffsetMs;
      queueCombatText(scene, {
        targetKey: key,
        targetMesh: pending.targetMesh,
        type: 'damage',
        amount: pending.amount,
        delayMs: baseDelay + COMBAT_TEXT_CONFIG.damageExtraDelayMs
      });
    }
  });
}

function flushPendingDamage(scene, targetKey) {
  const combatText = scene.metadata?.combatText;
  if (!combatText) {
    return;
  }
  const pending = combatText.pendingDamage.get(targetKey);
  if (!pending) {
    return;
  }

  combatText.pendingDamage.delete(targetKey);
  if (!combatText.initializedUnits.has(targetKey)) {
    return;
  }

  const baseDelay = pending.hitDelayMs ?? combatText.hitDelays.get(targetKey) ?? COMBAT_TEXT_CONFIG.damageHitOffsetMs;
  queueCombatText(scene, {
    targetKey,
    targetMesh: pending.targetMesh,
    type: 'damage',
    amount: pending.amount,
    delayMs: baseDelay + COMBAT_TEXT_CONFIG.damageExtraDelayMs
  });
}

/**
 * Flush any pending damage for this target and show it immediately (0 delay).
 * Call from VFX impact callback so damage text appears in sync with impact/hit animation.
 * @param {Scene} scene - Babylon.js scene
 * @param {string} targetUserId - Target player's user ID
 */
export function flushPendingDamageForImpact(scene, targetUserId) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || !targetUserId) return;
  const targetKey = `player:${targetUserId}`;
  const pending = combatText.pendingDamage.get(targetKey);
  if (!pending) return;

  combatText.pendingDamage.delete(targetKey);
  if (!combatText.initializedUnits.has(targetKey)) return;

  queueCombatText(scene, {
    targetKey,
    targetMesh: pending.targetMesh,
    type: 'damage',
    amount: pending.amount,
    delayMs: 0
  });
}

function getShieldGainAmount(prevEffects = {}, nextEffects = {}) {
  let total = 0;
  const prevKeys = new Set(Object.keys(prevEffects || {}));

  Object.entries(nextEffects || {}).forEach(([effectId, effect]) => {
    if (prevKeys.has(effectId)) {
      return;
    }

    const id = effect?.effectId || effectId;
    if (!id || !id.toLowerCase().includes('shield')) {
      return;
    }

    try {
      const data = effect?.data ? JSON.parse(effect.data) : {};
      const amount = data.amount ?? data.shield ?? data.value ?? 0;
      if (amount > 0) {
        total += amount;
      }
    } catch (error) {
      // Ignore malformed shield effect data
    }
  });

  return total;
}

/**
 * Initialize the combat text system for a scene
 * @param {Scene} scene - Babylon.js scene
 * @param {Camera} camera - Scene camera for billboarding
 */
export function initCombatTextSystem(scene, camera) {
  if (!scene.metadata) {
    scene.metadata = {};
  }
  if (scene.metadata.combatText) {
    return;
  }

  // Store observer reference for cleanup
  let updateObserver = null;

  const combatText = {
    pool: [],
    active: [],
    pending: new Map(),
    pendingDamage: new Map(),
    targetStacks: new Map(),
    lastUnits: new Map(),
    lastTurn: null,
    hitTimes: new Map(),
    hitDelays: new Map(),
    /** When we showed effect (e.g. poison) damage so state update does not show it again: key -> { amount, at } */
    effectDamageShown: new Map(),
    tempVec: new Vector3(),
    camera,
    initializedUnits: new Set(),
    updateObserver: null
  };

  for (let i = 0; i < COMBAT_TEXT_CONFIG.poolSize; i += 1) {
    combatText.pool.push(createCombatTextMesh(scene));
  }

  scene.metadata.combatText = combatText;

  updateObserver = scene.onBeforeRenderObservable.add(() => {
    const now = Date.now();
    flushCombatTextAggregates(scene, now);
    updateCombatTextSystem(scene, now);
  });
  
  combatText.updateObserver = updateObserver;
}

/**
 * Dispose the combat text system and clean up all resources
 * Call this when disposing the scene
 * @param {Scene} scene - Babylon.js scene
 */
export function disposeCombatTextSystem(scene) {
  if (!scene.metadata || !scene.metadata.combatText) {
    return;
  }
  
  const combatText = scene.metadata.combatText;
  
  // Remove the update observer
  if (combatText.updateObserver) {
    scene.onBeforeRenderObservable.remove(combatText.updateObserver);
    combatText.updateObserver = null;
  }
  
  // Dispose all pooled meshes (including textures and materials)
  combatText.pool.forEach(mesh => {
    if (mesh && !mesh.isDisposed()) {
      if (mesh.metadata) {
        if (mesh.metadata.texture && !mesh.metadata.texture.isDisposed) {
          mesh.metadata.texture.dispose();
        }
        if (mesh.metadata.material && !mesh.metadata.material.isDisposed) {
          mesh.metadata.material.dispose();
        }
      }
      mesh.dispose();
    }
  });
  combatText.pool.length = 0;
  
  // Dispose all active combat text meshes
  combatText.active.forEach(entry => {
    if (entry.mesh && !entry.mesh.isDisposed()) {
      if (entry.mesh.metadata) {
        if (entry.mesh.metadata.texture && !entry.mesh.metadata.texture.isDisposed) {
          entry.mesh.metadata.texture.dispose();
        }
        if (entry.mesh.metadata.material && !entry.mesh.metadata.material.isDisposed) {
          entry.mesh.metadata.material.dispose();
        }
      }
      entry.mesh.dispose();
    }
  });
  combatText.active.length = 0;
  
  // Clear all maps
  combatText.pending.clear();
  combatText.pendingDamage.clear();
  combatText.effectDamageShown?.clear();
  combatText.targetStacks.clear();
  combatText.lastUnits.clear();
  combatText.hitTimes.clear();
  combatText.hitDelays.clear();
  combatText.initializedUnits.clear();
  
  // Remove reference
  scene.metadata.combatText = null;
  
  console.log('[CombatText] System disposed');
}

/**
 * Update combat text based on game state changes
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} newGameState - Current game state
 */
export function updateCombatTextFromState(scene, newGameState) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || !newGameState) {
    return;
  }

  const now = Date.now();
  const suppressResource = combatText.lastTurn !== null && newGameState.turn !== combatText.lastTurn;
  const prevUnits = combatText.lastUnits || new Map();
  const nextUnits = new Map();

  const collectPlayers = (team) => {
    if (!team || !team.players) return [];
    return Object.values(team.players).map(player => ({
      key: `player:${player.userId}`,
      kind: 'player',
      id: player.userId,
      data: player
    }));
  };

  const units = [
    ...collectPlayers(newGameState.myTeam),
    ...collectPlayers(newGameState.enemyTeam)
  ];

  if (newGameState.spawnedEntities) {
    Object.values(newGameState.spawnedEntities).forEach(entity => {
      units.push({
        key: `entity:${entity.entityId}`,
        kind: 'entity',
        id: entity.entityId,
        data: entity
      });
    });
  }

  units.forEach(unit => {
    const { key, kind, id, data } = unit;
    const health = data.health ?? 0;
    const energy = data.energy ?? 0;
    const movementPoints = data.movementPoints ?? 0;
    const usedMovementPoints = data.usedMovementPoints ?? 0;
    const statusEffects = data.statusEffects || {};

    nextUnits.set(key, {
      health,
      energy,
      movementPoints,
      usedMovementPoints,
      statusEffects
    });

    const prev = prevUnits.get(key);
    if (!prev) {
      return;
    }

    const targetMesh = kind === 'player'
      ? scene.metadata?.playerMeshes?.get(id)
      : scene.metadata?.entityMeshes?.get(id);

    if (!targetMesh) {
      return;
    }

    // Skip combat text for first time we process a unit (initialization)
    if (!combatText.initializedUnits.has(key)) {
      combatText.initializedUnits.add(key);
      return;
    }

    const healthDelta = health - prev.health;
    // Skip damage if prev.health was 0 (initialization) or current health is 0 (init quirk)
    if (healthDelta < 0 && prev.health > 0 && health > 0) {
      const amount = Math.abs(healthDelta);
      let skipDamage = false;
      const shown = combatText.effectDamageShown?.get(key);
      if (shown) {
        const age = now - shown.at;
        if (age <= EFFECT_DAMAGE_DEDUP_MS && shown.amount === amount) {
          combatText.effectDamageShown.delete(key);
          skipDamage = true;
        } else if (age > EFFECT_DAMAGE_DEDUP_MS) {
          combatText.effectDamageShown.delete(key);
        }
      }
      if (!skipDamage) {
        const existing = combatText.pendingDamage.get(key);
        if (existing) {
          existing.amount += amount;
          existing.expiresAt = Math.max(existing.expiresAt, now + COMBAT_TEXT_CONFIG.damageSyncWindowMs);
          existing.hitDelayMs = combatText.hitDelays.get(key) ?? existing.hitDelayMs;
        } else {
          combatText.pendingDamage.set(key, {
            targetMesh,
            amount,
            createdAt: now,
            expiresAt: now + COMBAT_TEXT_CONFIG.damageSyncWindowMs,
            hitDelayMs: combatText.hitDelays.get(key)
          });
        }
      }
    } else if (healthDelta > 0 && prev.health > 0) {
      // Only show healing if prev.health > 0 (skip initial health population)
      queueCombatText(scene, {
        targetKey: key,
        targetMesh,
        type: 'healing',
        amount: Math.abs(healthDelta),
        delayMs: COMBAT_TEXT_CONFIG.spawnDelayMs
      });
    }

    if (kind === 'player') {
      const prevAvailableMP = (prev.movementPoints ?? 0) - (prev.usedMovementPoints ?? 0);
      const nextAvailableMP = (movementPoints ?? 0) - (usedMovementPoints ?? 0);
      const mpDelta = nextAvailableMP - prevAvailableMP;
      if (!suppressResource && mpDelta !== 0) {
        queueCombatText(scene, {
          targetKey: key,
          targetMesh,
          type: 'resourceMp',
          amount: mpDelta,
          delayMs: COMBAT_TEXT_CONFIG.spawnDelayMs
        });
      }

      const energyDelta = (energy ?? 0) - (prev.energy ?? 0);
      if (!suppressResource && energyDelta !== 0) {
        queueCombatText(scene, {
          targetKey: key,
          targetMesh,
          type: 'resourceAp',
          amount: energyDelta,
          delayMs: COMBAT_TEXT_CONFIG.spawnDelayMs
        });
      }

      const shieldAmount = getShieldGainAmount(prev.statusEffects, statusEffects);
      if (shieldAmount > 0) {
        queueCombatText(scene, {
          targetKey: key,
          targetMesh,
          type: 'shield',
          amount: shieldAmount,
          delayMs: COMBAT_TEXT_CONFIG.spawnDelayMs
        });
      }
    }
  });

  combatText.lastUnits = nextUnits;
  combatText.lastTurn = newGameState.turn ?? combatText.lastTurn;
}

/**
 * Record spell hit for combat text timing: set hit delay for this target and flush any pending
 * damage so it shows in sync with the hit. Damage numbers come from state only (no per-hit from server).
 */
export function recordCombatTextHit(scene, targetUserId, hitDelayMs = 0) {
  const combatText = scene.metadata?.combatText;
  if (!combatText || !targetUserId) return;
  const targetKey = `player:${targetUserId}`;
  combatText.hitTimes.set(targetKey, Date.now());
  combatText.hitDelays.set(targetKey, hitDelayMs);
  flushPendingDamage(scene, targetKey);
}

const EFFECT_DAMAGE_DEDUP_MS = 3000;

/**
 * Queue damage text for turn-start effect damage (e.g. poison) so it shows in sync with hit animation.
 * Bypasses aggregation window so the number appears on the next frame with the hit.
 * Records that we showed this damage so updateCombatTextFromState does not show it again when state arrives.
 * @param {Scene} scene - Babylon.js scene
 * @param {string} userId - Target player's user ID (activeEntityId)
 * @param {number} amount - Total damage amount to show
 */
export function queueEffectDamageText(scene, userId, amount) {
  const combatText = scene.metadata?.combatText;
  const playerMeshes = scene.metadata?.playerMeshes;
  if (!combatText || !playerMeshes || !userId || amount <= 0) {
    return;
  }
  const targetMesh = playerMeshes.get(userId);
  if (!targetMesh) {
    return;
  }
  const targetKey = `player:${userId}`;
  const now = Date.now();
  combatText.effectDamageShown.set(targetKey, { amount, at: now });
  const key = `${targetKey}:damage:effect`;
  combatText.pending.set(key, {
    targetKey,
    targetMesh,
    type: 'damage',
    amount,
    lastTime: now - (COMBAT_TEXT_CONFIG.aggregationWindowMs + 50),
    availableAt: now
  });
}
