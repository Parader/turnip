/**
 * PerformancePanel - Real-time performance monitoring
 * Shows FPS, memory usage, and Babylon.js scene statistics
 */

import React, { useState, useEffect, useRef } from 'react';

const PerformancePanel = ({ scene, isOpen, onClose }) => {
  const [stats, setStats] = useState({
    fps: 0,
    frameTime: 0,
    jsHeapUsed: 0,
    jsHeapTotal: 0,
    meshCount: 0,
    activeMeshes: 0,
    drawCalls: 0,
    totalVertices: 0,
    totalFaces: 0,
    activeParticles: 0,
    activeBones: 0,
    textureCount: 0,
    materialCount: 0,
    animationGroups: 0,
    activeAnimatables: 0,
  });
  
  const frameTimesRef = useRef([]);
  const lastFrameTimeRef = useRef(performance.now());
  const animationFrameRef = useRef(null);
  
  useEffect(() => {
    if (!isOpen) return;
    
    let running = true;
    
    const updateStats = () => {
      if (!running) return;
      
      const now = performance.now();
      const frameTime = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      
      // Track frame times for FPS calculation (rolling average)
      frameTimesRef.current.push(frameTime);
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }
      
      // Calculate FPS from rolling average
      const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      const fps = avgFrameTime > 0 ? Math.round(1000 / avgFrameTime) : 0;
      
      // Get JS heap memory (Chrome only)
      let jsHeapUsed = 0;
      let jsHeapTotal = 0;
      if (performance.memory) {
        jsHeapUsed = performance.memory.usedJSHeapSize;
        jsHeapTotal = performance.memory.totalJSHeapSize;
      }
      
      // Get Babylon.js scene statistics
      let meshCount = 0;
      let activeMeshes = 0;
      let drawCalls = 0;
      let totalVertices = 0;
      let totalFaces = 0;
      let activeParticles = 0;
      let activeBones = 0;
      let textureCount = 0;
      let materialCount = 0;
      let animationGroups = 0;
      let activeAnimatables = 0;
      
      if (scene && !scene.isDisposed) {
        // Enable instrumentation if not already enabled
        if (!scene.instrumentationEnabled) {
          scene.instrumentationEnabled = true;
        }
        
        meshCount = scene.meshes?.length || 0;
        activeMeshes = scene.getActiveMeshes()?.length || 0;
        
        // Get draw calls from scene instrumentation
        const sceneInstrumentation = scene._sceneInstrumentation;
        if (sceneInstrumentation) {
          drawCalls = sceneInstrumentation.drawCallsCounter?.current || 0;
        } else {
          // Fallback: estimate from active meshes
          drawCalls = activeMeshes;
        }
        
        // Count vertices and faces
        scene.meshes?.forEach(mesh => {
          if (mesh.getTotalVertices) {
            totalVertices += mesh.getTotalVertices();
          }
          if (mesh.getTotalIndices) {
            totalFaces += Math.floor(mesh.getTotalIndices() / 3);
          }
        });
        
        // Particle systems
        activeParticles = scene.particleSystems?.reduce((sum, ps) => {
          return sum + (ps.getActiveCount?.() || 0);
        }, 0) || 0;
        
        // Bones (skeletons)
        activeBones = scene.skeletons?.reduce((sum, skeleton) => {
          return sum + (skeleton.bones?.length || 0);
        }, 0) || 0;
        
        // Textures and materials
        textureCount = scene.textures?.length || 0;
        materialCount = scene.materials?.length || 0;
        
        // Animation groups
        animationGroups = scene.animationGroups?.length || 0;
        activeAnimatables = scene._activeAnimatables?.length || 0;
      }
      
      setStats({
        fps,
        frameTime: avgFrameTime.toFixed(1),
        jsHeapUsed,
        jsHeapTotal,
        meshCount,
        activeMeshes,
        drawCalls,
        totalVertices,
        totalFaces,
        activeParticles,
        activeBones,
        textureCount,
        materialCount,
        animationGroups,
        activeAnimatables,
      });
      
      animationFrameRef.current = requestAnimationFrame(updateStats);
    };
    
    animationFrameRef.current = requestAnimationFrame(updateStats);
    
    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isOpen, scene]);
  
  if (!isOpen) return null;
  
  const formatBytes = (bytes) => {
    if (bytes === 0) return 'N/A';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };
  
  const formatNumber = (num) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };
  
  // Determine FPS color based on performance
  const getFpsColor = (fps) => {
    if (fps >= 55) return '#4ade80'; // Green
    if (fps >= 30) return '#fbbf24'; // Yellow
    return '#ef4444'; // Red
  };
  
  return (
    <div className="performance-panel">
      <div className="performance-header">
        <h3>Performance</h3>
        <button className="performance-close" onClick={onClose}>✕</button>
      </div>
      
      <div className="performance-content">
        {/* FPS Section */}
        <div className="perf-section">
          <div className="perf-section-title">Rendering</div>
          <div className="perf-row">
            <span className="perf-label">FPS</span>
            <span className="perf-value" style={{ color: getFpsColor(stats.fps) }}>
              {stats.fps}
            </span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Frame Time</span>
            <span className="perf-value">{stats.frameTime}ms</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Draw Calls</span>
            <span className="perf-value">{stats.drawCalls}</span>
          </div>
        </div>
        
        {/* Memory Section */}
        <div className="perf-section">
          <div className="perf-section-title">Memory (Chrome)</div>
          <div className="perf-row">
            <span className="perf-label">JS Heap Used</span>
            <span className="perf-value">{formatBytes(stats.jsHeapUsed)}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">JS Heap Total</span>
            <span className="perf-value">{formatBytes(stats.jsHeapTotal)}</span>
          </div>
          {stats.jsHeapUsed > 0 && (
            <div className="perf-bar">
              <div 
                className="perf-bar-fill"
                style={{ 
                  width: `${(stats.jsHeapUsed / stats.jsHeapTotal) * 100}%`,
                  backgroundColor: stats.jsHeapUsed / stats.jsHeapTotal > 0.8 ? '#ef4444' : '#4ade80'
                }}
              />
            </div>
          )}
        </div>
        
        {/* Scene Section */}
        <div className="perf-section">
          <div className="perf-section-title">Scene Objects</div>
          <div className="perf-row">
            <span className="perf-label">Total Meshes</span>
            <span className="perf-value">{stats.meshCount}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Active Meshes</span>
            <span className="perf-value">{stats.activeMeshes}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Vertices</span>
            <span className="perf-value">{formatNumber(stats.totalVertices)}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Faces</span>
            <span className="perf-value">{formatNumber(stats.totalFaces)}</span>
          </div>
        </div>
        
        {/* Assets Section */}
        <div className="perf-section">
          <div className="perf-section-title">Assets</div>
          <div className="perf-row">
            <span className="perf-label">Textures</span>
            <span className="perf-value">{stats.textureCount}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Materials</span>
            <span className="perf-value">{stats.materialCount}</span>
          </div>
        </div>
        
        {/* Animation Section */}
        <div className="perf-section">
          <div className="perf-section-title">Animation</div>
          <div className="perf-row">
            <span className="perf-label">Animation Groups</span>
            <span className="perf-value">{stats.animationGroups}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Active Animatables</span>
            <span className="perf-value">{stats.activeAnimatables}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Active Particles</span>
            <span className="perf-value">{stats.activeParticles}</span>
          </div>
          <div className="perf-row">
            <span className="perf-label">Active Bones</span>
            <span className="perf-value">{stats.activeBones}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PerformancePanel;
