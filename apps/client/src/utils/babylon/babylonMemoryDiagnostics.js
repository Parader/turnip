/**
 * Memory Diagnostics Module for Babylon.js
 * Provides instrumentation to detect memory leaks by tracking:
 * - JS heap usage trend
 * - Active meshes, materials, textures, geometries, particle systems
 * - Observable/callback counts
 * - Draw calls
 * 
 * Usage:
 *   import { startMemoryDiagnostics, stopMemoryDiagnostics, getMemorySnapshot } from './babylonMemoryDiagnostics';
 *   const diagnostics = startMemoryDiagnostics(scene, { showOverlay: true });
 *   // Later: stopMemoryDiagnostics(diagnostics);
 */

// Snapshot history for trend analysis
const snapshotHistory = [];
const MAX_HISTORY = 60; // Keep last 60 snapshots (1 minute at 1 snapshot/sec)

/**
 * Get current memory snapshot
 * @param {Scene} scene - Babylon.js scene
 * @returns {Object} Memory snapshot with all tracked metrics
 */
export function getMemorySnapshot(scene) {
  if (!scene) return null;
  
  const now = Date.now();
  const snapshot = {
    timestamp: now,
    
    // JS Heap (if available via performance.memory)
    heap: {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
      available: false
    },
    
    // Scene resources
    meshes: {
      total: scene.meshes?.length || 0,
      active: scene.getActiveMeshes?.()?.length || 0,
      byType: {}
    },
    
    materials: {
      total: scene.materials?.length || 0,
      byType: {}
    },
    
    textures: {
      total: scene.textures?.length || 0,
      dynamicTextures: 0
    },
    
    geometries: {
      total: scene.geometries?.length || 0
    },
    
    particleSystems: {
      total: scene.particleSystems?.length || 0,
      active: 0,
      names: []
    },
    
    animationGroups: {
      total: scene.animationGroups?.length || 0,
      playing: 0
    },
    
    // Observables tracking
    observables: {
      onBeforeRender: scene.onBeforeRenderObservable?.observers?.length || 0,
      onAfterRender: scene.onAfterRenderObservable?.observers?.length || 0,
      onPointer: scene.onPointerObservable?.observers?.length || 0,
      onKeyboard: scene.onKeyboardObservable?.observers?.length || 0,
      total: 0
    },
    
    // Render statistics
    render: {
      drawCalls: 0,
      triangles: 0,
      activeParticles: 0
    },
    
    // Metadata storage sizes
    metadata: {
      playerMeshes: scene.metadata?.playerMeshes?.size || 0,
      playerAnimationGroups: scene.metadata?.playerAnimationGroups?.size || 0,
      entityMeshes: scene.metadata?.entityMeshes?.size || 0,
      modelCache: scene.metadata?.modelCache?.size || 0,
      combatTextPool: scene.metadata?.combatText?.pool?.length || 0,
      combatTextActive: scene.metadata?.combatText?.active?.length || 0,
      pendingMovementPaths: scene.metadata?.pendingMovementPaths?.size || 0,
      playerMovementAnimations: scene.metadata?.playerMovementAnimations?.size || 0,
      targetMarkers: scene.metadata?.targetMarkers?.size || 0
    }
  };
  
  // JS Heap from Performance API (Chrome/Edge)
  if (typeof performance !== 'undefined' && performance.memory) {
    snapshot.heap.usedJSHeapSize = performance.memory.usedJSHeapSize;
    snapshot.heap.totalJSHeapSize = performance.memory.totalJSHeapSize;
    snapshot.heap.jsHeapSizeLimit = performance.memory.jsHeapSizeLimit;
    snapshot.heap.available = true;
  }
  
  // Count mesh types
  if (scene.meshes) {
    scene.meshes.forEach(mesh => {
      const type = mesh.getClassName?.() || 'Unknown';
      snapshot.meshes.byType[type] = (snapshot.meshes.byType[type] || 0) + 1;
    });
  }
  
  // Count material types
  if (scene.materials) {
    scene.materials.forEach(mat => {
      const type = mat.getClassName?.() || 'Unknown';
      snapshot.materials.byType[type] = (snapshot.materials.byType[type] || 0) + 1;
    });
  }
  
  // Count dynamic textures
  if (scene.textures) {
    scene.textures.forEach(tex => {
      if (tex.getClassName?.() === 'DynamicTexture') {
        snapshot.textures.dynamicTextures++;
      }
    });
  }
  
  // Count active particle systems and collect names
  if (scene.particleSystems) {
    scene.particleSystems.forEach(ps => {
      if (ps.isStarted?.()) {
        snapshot.particleSystems.active++;
      }
      snapshot.particleSystems.names.push(ps.name || 'unnamed');
    });
  }
  
  // Count playing animation groups
  if (scene.animationGroups) {
    scene.animationGroups.forEach(ag => {
      if (ag.isPlaying) {
        snapshot.animationGroups.playing++;
      }
    });
  }
  
  // Total observables
  snapshot.observables.total = 
    snapshot.observables.onBeforeRender +
    snapshot.observables.onAfterRender +
    snapshot.observables.onPointer +
    snapshot.observables.onKeyboard;
  
  // Get render statistics if available
  const engine = scene.getEngine?.();
  if (engine) {
    const instrumentation = engine._caps?.parallelShaderCompile || {};
    snapshot.render.drawCalls = scene._activeIndices?.drawCallsCount || 0;
    snapshot.render.triangles = scene._activeIndices?.trianglesCount || 0;
  }
  
  // Count active particles
  if (scene.particleSystems) {
    scene.particleSystems.forEach(ps => {
      if (ps.particles) {
        snapshot.render.activeParticles += ps.particles.length;
      }
    });
  }
  
  return snapshot;
}

/**
 * Compare two snapshots and detect growth
 * @param {Object} older - Older snapshot
 * @param {Object} newer - Newer snapshot
 * @returns {Object} Growth report
 */
export function compareSnapshots(older, newer) {
  if (!older || !newer) return null;
  
  const growth = {
    timeElapsed: newer.timestamp - older.timestamp,
    
    heap: {
      usedDelta: newer.heap.usedJSHeapSize - older.heap.usedJSHeapSize,
      usedDeltaMB: ((newer.heap.usedJSHeapSize - older.heap.usedJSHeapSize) / 1024 / 1024).toFixed(2)
    },
    
    meshes: {
      totalDelta: newer.meshes.total - older.meshes.total,
      activeDelta: newer.meshes.active - older.meshes.active
    },
    
    materials: {
      totalDelta: newer.materials.total - older.materials.total
    },
    
    textures: {
      totalDelta: newer.textures.total - older.textures.total,
      dynamicDelta: newer.textures.dynamicTextures - older.textures.dynamicTextures
    },
    
    geometries: {
      totalDelta: newer.geometries.total - older.geometries.total
    },
    
    particleSystems: {
      totalDelta: newer.particleSystems.total - older.particleSystems.total,
      activeDelta: newer.particleSystems.active - older.particleSystems.active
    },
    
    animationGroups: {
      totalDelta: newer.animationGroups.total - older.animationGroups.total,
      playingDelta: newer.animationGroups.playing - older.animationGroups.playing
    },
    
    observables: {
      onBeforeRenderDelta: newer.observables.onBeforeRender - older.observables.onBeforeRender,
      totalDelta: newer.observables.total - older.observables.total
    },
    
    metadata: {
      combatTextPoolDelta: newer.metadata.combatTextPool - older.metadata.combatTextPool,
      combatTextActiveDelta: newer.metadata.combatTextActive - older.metadata.combatTextActive
    },
    
    // Warnings for potential leaks
    warnings: []
  };
  
  // Check for potential leaks (continuous growth)
  if (growth.meshes.totalDelta > 5) {
    growth.warnings.push(`Mesh count growing: +${growth.meshes.totalDelta}`);
  }
  if (growth.materials.totalDelta > 3) {
    growth.warnings.push(`Material count growing: +${growth.materials.totalDelta}`);
  }
  if (growth.textures.dynamicDelta > 3) {
    growth.warnings.push(`DynamicTexture count growing: +${growth.textures.dynamicDelta}`);
  }
  if (growth.particleSystems.totalDelta > 5) {
    growth.warnings.push(`ParticleSystem count growing: +${growth.particleSystems.totalDelta}`);
  }
  if (growth.observables.onBeforeRenderDelta > 5) {
    growth.warnings.push(`onBeforeRender observers growing: +${growth.observables.onBeforeRenderDelta}`);
  }
  if (growth.heap.usedDelta > 10 * 1024 * 1024) { // 10MB
    growth.warnings.push(`Heap growing significantly: +${growth.heap.usedDeltaMB}MB`);
  }
  
  return growth;
}

/**
 * Create debug overlay DOM element
 * @returns {HTMLElement} Overlay element
 */
function createDebugOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'babylon-memory-diagnostics-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.85);
    color: #00ff00;
    font-family: 'Consolas', 'Monaco', monospace;
    font-size: 11px;
    padding: 10px;
    border-radius: 4px;
    z-index: 10000;
    max-width: 350px;
    max-height: 80vh;
    overflow-y: auto;
    pointer-events: none;
    user-select: none;
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Update overlay with current snapshot
 * @param {HTMLElement} overlay - Overlay element
 * @param {Object} snapshot - Current memory snapshot
 * @param {Object} growth - Growth comparison (optional)
 */
function updateOverlay(overlay, snapshot, growth = null) {
  if (!overlay || !snapshot) return;
  
  const formatNumber = (n) => n.toLocaleString();
  const formatBytes = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
  const formatDelta = (d) => d > 0 ? `+${d}` : `${d}`;
  const deltaColor = (d) => d > 0 ? '#ff6666' : d < 0 ? '#66ff66' : '#ffffff';
  
  let html = `<div style="color: #66ccff; font-weight: bold; margin-bottom: 8px;">🔍 Memory Diagnostics</div>`;
  
  // Heap usage
  if (snapshot.heap.available) {
    html += `<div style="margin-bottom: 4px;">
      <span style="color: #888;">Heap:</span> ${formatBytes(snapshot.heap.usedJSHeapSize)} / ${formatBytes(snapshot.heap.totalJSHeapSize)}
      ${growth ? `<span style="color: ${deltaColor(growth.heap.usedDelta)}">(${growth.heap.usedDeltaMB}MB)</span>` : ''}
    </div>`;
  }
  
  // Scene resources
  html += `<div style="color: #ffcc00; margin-top: 8px;">Scene Resources</div>`;
  html += `<div>Meshes: ${formatNumber(snapshot.meshes.total)} (active: ${snapshot.meshes.active}) ${growth ? `<span style="color: ${deltaColor(growth.meshes.totalDelta)}">${formatDelta(growth.meshes.totalDelta)}</span>` : ''}</div>`;
  html += `<div>Materials: ${formatNumber(snapshot.materials.total)} ${growth ? `<span style="color: ${deltaColor(growth.materials.totalDelta)}">${formatDelta(growth.materials.totalDelta)}</span>` : ''}</div>`;
  html += `<div>Textures: ${formatNumber(snapshot.textures.total)} (dynamic: ${snapshot.textures.dynamicTextures}) ${growth ? `<span style="color: ${deltaColor(growth.textures.dynamicDelta)}">${formatDelta(growth.textures.dynamicDelta)}</span>` : ''}</div>`;
  html += `<div>Geometries: ${formatNumber(snapshot.geometries.total)} ${growth ? `<span style="color: ${deltaColor(growth.geometries.totalDelta)}">${formatDelta(growth.geometries.totalDelta)}</span>` : ''}</div>`;
  html += `<div>Particle Systems: ${formatNumber(snapshot.particleSystems.total)} (active: ${snapshot.particleSystems.active}) ${growth ? `<span style="color: ${deltaColor(growth.particleSystems.totalDelta)}">${formatDelta(growth.particleSystems.totalDelta)}</span>` : ''}</div>`;
  html += `<div>Animation Groups: ${formatNumber(snapshot.animationGroups.total)} (playing: ${snapshot.animationGroups.playing})</div>`;
  
  // Observables
  html += `<div style="color: #ffcc00; margin-top: 8px;">Observables</div>`;
  html += `<div>onBeforeRender: ${snapshot.observables.onBeforeRender} ${growth ? `<span style="color: ${deltaColor(growth.observables.onBeforeRenderDelta)}">${formatDelta(growth.observables.onBeforeRenderDelta)}</span>` : ''}</div>`;
  html += `<div>onPointer: ${snapshot.observables.onPointer}</div>`;
  html += `<div>Total: ${snapshot.observables.total}</div>`;
  
  // Metadata
  html += `<div style="color: #ffcc00; margin-top: 8px;">Scene Metadata</div>`;
  html += `<div>Player Meshes: ${snapshot.metadata.playerMeshes}</div>`;
  html += `<div>Entity Meshes: ${snapshot.metadata.entityMeshes}</div>`;
  html += `<div>Model Cache: ${snapshot.metadata.modelCache}</div>`;
  html += `<div>Combat Text Pool: ${snapshot.metadata.combatTextPool}</div>`;
  html += `<div>Combat Text Active: ${snapshot.metadata.combatTextActive}</div>`;
  html += `<div>Target Markers: ${snapshot.metadata.targetMarkers}</div>`;
  
  // Warnings
  if (growth && growth.warnings.length > 0) {
    html += `<div style="color: #ff6666; margin-top: 8px; font-weight: bold;">⚠️ Warnings</div>`;
    growth.warnings.forEach(w => {
      html += `<div style="color: #ff9999;">• ${w}</div>`;
    });
  }
  
  // Particle system names (if any active)
  if (snapshot.particleSystems.names.length > 0 && snapshot.particleSystems.names.length <= 20) {
    html += `<div style="color: #888; margin-top: 8px; font-size: 9px;">PS: ${snapshot.particleSystems.names.join(', ')}</div>`;
  }
  
  overlay.innerHTML = html;
}

/**
 * Start memory diagnostics
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} options - Configuration options
 * @returns {Object} Diagnostics controller
 */
export function startMemoryDiagnostics(scene, options = {}) {
  const {
    showOverlay = true,
    updateIntervalMs = 1000,
    logToConsole = false,
    onSnapshot = null
  } = options;
  
  let overlay = null;
  let intervalId = null;
  let baselineSnapshot = null;
  
  if (showOverlay) {
    overlay = createDebugOverlay();
  }
  
  // Take initial baseline
  baselineSnapshot = getMemorySnapshot(scene);
  snapshotHistory.push(baselineSnapshot);
  
  // Update loop
  intervalId = setInterval(() => {
    const snapshot = getMemorySnapshot(scene);
    
    // Add to history
    snapshotHistory.push(snapshot);
    if (snapshotHistory.length > MAX_HISTORY) {
      snapshotHistory.shift();
    }
    
    // Compare with previous snapshot (or baseline if first)
    const prevSnapshot = snapshotHistory[snapshotHistory.length - 2] || baselineSnapshot;
    const growth = compareSnapshots(prevSnapshot, snapshot);
    
    // Update overlay
    if (overlay) {
      updateOverlay(overlay, snapshot, growth);
    }
    
    // Log to console if enabled
    if (logToConsole && growth && growth.warnings.length > 0) {
      console.warn('[Memory Diagnostics]', growth.warnings);
      console.log('[Memory Diagnostics] Snapshot:', snapshot);
    }
    
    // Callback
    if (onSnapshot) {
      onSnapshot(snapshot, growth);
    }
  }, updateIntervalMs);
  
  return {
    overlay,
    intervalId,
    getSnapshot: () => getMemorySnapshot(scene),
    getHistory: () => [...snapshotHistory],
    getBaseline: () => baselineSnapshot,
    compareWithBaseline: () => compareSnapshots(baselineSnapshot, getMemorySnapshot(scene))
  };
}

/**
 * Stop memory diagnostics
 * @param {Object} controller - Diagnostics controller from startMemoryDiagnostics
 */
export function stopMemoryDiagnostics(controller) {
  if (!controller) return;
  
  if (controller.intervalId) {
    clearInterval(controller.intervalId);
  }
  
  if (controller.overlay && controller.overlay.parentNode) {
    controller.overlay.parentNode.removeChild(controller.overlay);
  }
  
  // Clear history
  snapshotHistory.length = 0;
}

/**
 * Log a detailed memory report to console
 * @param {Scene} scene - Babylon.js scene
 */
export function logMemoryReport(scene) {
  const snapshot = getMemorySnapshot(scene);
  
  console.group('🔍 Babylon.js Memory Report');
  
  if (snapshot.heap.available) {
    console.log(`Heap: ${(snapshot.heap.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB / ${(snapshot.heap.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
  }
  
  console.group('Scene Resources');
  console.log(`Meshes: ${snapshot.meshes.total} (active: ${snapshot.meshes.active})`);
  console.log('  By type:', snapshot.meshes.byType);
  console.log(`Materials: ${snapshot.materials.total}`);
  console.log('  By type:', snapshot.materials.byType);
  console.log(`Textures: ${snapshot.textures.total} (dynamic: ${snapshot.textures.dynamicTextures})`);
  console.log(`Geometries: ${snapshot.geometries.total}`);
  console.log(`Particle Systems: ${snapshot.particleSystems.total} (active: ${snapshot.particleSystems.active})`);
  console.log('  Names:', snapshot.particleSystems.names);
  console.log(`Animation Groups: ${snapshot.animationGroups.total} (playing: ${snapshot.animationGroups.playing})`);
  console.groupEnd();
  
  console.group('Observables');
  console.log(`onBeforeRender: ${snapshot.observables.onBeforeRender}`);
  console.log(`onAfterRender: ${snapshot.observables.onAfterRender}`);
  console.log(`onPointer: ${snapshot.observables.onPointer}`);
  console.log(`Total: ${snapshot.observables.total}`);
  console.groupEnd();
  
  console.group('Scene Metadata');
  console.log(`Player Meshes: ${snapshot.metadata.playerMeshes}`);
  console.log(`Entity Meshes: ${snapshot.metadata.entityMeshes}`);
  console.log(`Model Cache: ${snapshot.metadata.modelCache}`);
  console.log(`Combat Text Pool: ${snapshot.metadata.combatTextPool}`);
  console.log(`Combat Text Active: ${snapshot.metadata.combatTextActive}`);
  console.log(`Target Markers: ${snapshot.metadata.targetMarkers}`);
  console.groupEnd();
  
  console.groupEnd();
  
  return snapshot;
}

/**
 * Run a simple memory leak test
 * Takes snapshots before and after a callback, reports any resource growth
 * @param {Scene} scene - Babylon.js scene
 * @param {Function} testCallback - Async function to run (e.g., cast spell 10 times)
 * @param {string} testName - Name for the test
 */
export async function runLeakTest(scene, testCallback, testName = 'Leak Test') {
  console.group(`🧪 ${testName}`);
  
  // Force GC if available (Chrome with --expose-gc flag)
  if (typeof window !== 'undefined' && window.gc) {
    window.gc();
    await new Promise(r => setTimeout(r, 100));
  }
  
  const before = getMemorySnapshot(scene);
  console.log('Before:', {
    meshes: before.meshes.total,
    materials: before.materials.total,
    textures: before.textures.total,
    particleSystems: before.particleSystems.total,
    observables: before.observables.total,
    heap: before.heap.available ? `${(before.heap.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB` : 'N/A'
  });
  
  // Run the test
  await testCallback();
  
  // Wait for cleanup
  await new Promise(r => setTimeout(r, 2000));
  
  // Force GC again if available
  if (typeof window !== 'undefined' && window.gc) {
    window.gc();
    await new Promise(r => setTimeout(r, 100));
  }
  
  const after = getMemorySnapshot(scene);
  const growth = compareSnapshots(before, after);
  
  console.log('After:', {
    meshes: after.meshes.total,
    materials: after.materials.total,
    textures: after.textures.total,
    particleSystems: after.particleSystems.total,
    observables: after.observables.total,
    heap: after.heap.available ? `${(after.heap.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB` : 'N/A'
  });
  
  console.log('Growth:', {
    meshes: growth.meshes.totalDelta,
    materials: growth.materials.totalDelta,
    textures: `${growth.textures.totalDelta} (dynamic: ${growth.textures.dynamicDelta})`,
    particleSystems: growth.particleSystems.totalDelta,
    observables: growth.observables.totalDelta,
    heap: growth.heap.usedDeltaMB + ' MB'
  });
  
  if (growth.warnings.length > 0) {
    console.warn('⚠️ Potential leaks detected:', growth.warnings);
  } else {
    console.log('✅ No obvious leaks detected');
  }
  
  console.groupEnd();
  
  return { before, after, growth };
}
