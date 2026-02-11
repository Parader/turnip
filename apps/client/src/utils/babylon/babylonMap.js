/**
 * Map building utilities for Babylon.js scene
 * Handles 3D map construction from terrain data
 */

import { MeshBuilder, StandardMaterial, PBRMaterial, Color3, Vector2, Vector3, Material, Texture, DynamicTexture, Animation, Mesh, SceneLoader, VertexData, Matrix, Effect, ShaderMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TILE_TYPES } from '../mapRenderer';

/**
 * TRIPLANAR TERRAIN MATERIAL
 * 
 * WHY TRIPLANAR MAPPING:
 * Standard UV mapping stretches textures on slopes because UVs are designed for
 * flat surfaces. Triplanar mapping projects textures from 3 world axes (XY, XZ, YZ)
 * and blends based on surface normal, ensuring consistent texture scale regardless
 * of mesh geometry.
 * 
 * WHY WORLD-SPACE PROJECTION:
 * - No UV dependency = no stretching on ramps/slopes
 * - Consistent texture scale across all terrain meshes
 * - Seamless transitions between slope and flat skirt
 * 
 * WHY SHARED MATERIAL:
 * - GPU batches draw calls for meshes sharing the same material
 * - Textures loaded once, shared across all terrain meshes
 * - Identical appearance guarantees no visible seams
 */

// Register triplanar shader code
Effect.ShadersStore['triplanarTerrainVertexShader'] = `
  precision highp float;
  
  // Attributes
  attribute vec3 position;
  attribute vec3 normal;
  
  // Uniforms
  uniform mat4 world;
  uniform mat4 worldViewProjection;
  
  // Varyings
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  
  void main() {
    vec4 worldPos = world * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize((world * vec4(normal, 0.0)).xyz);
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

Effect.ShadersStore['triplanarTerrainFragmentShader'] = `
  precision highp float;
  
  // Varyings
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  
  // Textures
  uniform sampler2D diffuseTexture;
  uniform sampler2D normalTexture;
  uniform sampler2D roughnessTexture;
  uniform sampler2D macroNoiseTexture;
  
  // Parameters
  uniform float worldTilingScale;
  uniform float blendSharpness;
  uniform float normalStrength;
  uniform float roughnessMultiplier;
  uniform vec3 tintColor;
  uniform vec3 lightDirection;
  uniform float ambientLevel;
  
  // Macro variation parameters (breaks up tiling repetition)
  uniform float macroScaleLarge;      // Large scale noise (0.01-0.02)
  uniform float macroScaleMedium;     // Medium scale noise (0.04-0.08)
  uniform float macroStrengthColor;   // Color variation strength
  uniform float macroStrengthRoughness; // Roughness variation strength
  uniform vec2 macroOffset;
  
  // Coordinate warping parameters (distorts UV sampling to break grid pattern)
  uniform float warpScale;            // Noise frequency for warp (0.02-0.05)
  uniform float warpStrength;         // World-unit offset strength (0.5-2.0)
  
  // Triplanar blend weights from world normal
  vec3 getTriplanarBlend(vec3 worldNormal) {
    vec3 blend = abs(worldNormal);
    blend = pow(blend, vec3(blendSharpness));
    blend /= (blend.x + blend.y + blend.z + 0.0001);
    return blend;
  }
  
  // Sample texture with triplanar projection using warped coordinates
  vec4 triplanarSampleWarped(sampler2D tex, vec3 worldPos, vec3 warpedPos, vec3 blend, float scale) {
    vec4 xProj = texture2D(tex, warpedPos.yz * scale);
    vec4 yProj = texture2D(tex, warpedPos.xz * scale);
    vec4 zProj = texture2D(tex, warpedPos.xy * scale);
    return xProj * blend.x + yProj * blend.y + zProj * blend.z;
  }
  
  // Triplanar normal mapping with warped coordinates
  vec3 triplanarNormalWarped(sampler2D normalTex, vec3 warpedPos, vec3 worldNormal, vec3 blend, float scale) {
    vec3 tnormalX = texture2D(normalTex, warpedPos.yz * scale).rgb * 2.0 - 1.0;
    vec3 tnormalY = texture2D(normalTex, warpedPos.xz * scale).rgb * 2.0 - 1.0;
    vec3 tnormalZ = texture2D(normalTex, warpedPos.xy * scale).rgb * 2.0 - 1.0;
    
    tnormalX.xy *= normalStrength;
    tnormalY.xy *= normalStrength;
    tnormalZ.xy *= normalStrength;
    
    vec3 normalX = vec3(tnormalX.xy + worldNormal.zy, abs(tnormalX.z) * worldNormal.x);
    vec3 normalY = vec3(tnormalY.xy + worldNormal.xz, abs(tnormalY.z) * worldNormal.y);
    vec3 normalZ = vec3(tnormalZ.xy + worldNormal.xy, abs(tnormalZ.z) * worldNormal.z);
    
    return normalize(
      normalX.zyx * blend.x +
      normalY.xzy * blend.y +
      normalZ.xyz * blend.z
    );
  }
  
  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 blend = getTriplanarBlend(normal);
    
    // ========== COORDINATE WARPING ==========
    // Sample noise at warp scale to create UV distortion
    // This breaks up the regular grid pattern of tiling
    vec2 warpUV = vWorldPosition.xz * warpScale;
    vec2 warpNoise = texture2D(macroNoiseTexture, warpUV).rg;
    
    // Convert noise (0-1) to offset (-1 to 1) and scale by warp strength
    vec2 warpOffset = (warpNoise - 0.5) * 2.0 * warpStrength;
    
    // Create warped world position for texture sampling
    vec3 warpedPos = vWorldPosition;
    warpedPos.x += warpOffset.x;
    warpedPos.z += warpOffset.y;
    
    // ========== SAMPLE DETAIL TEXTURES WITH WARPED COORDS ==========
    vec4 diffuse = triplanarSampleWarped(diffuseTexture, vWorldPosition, warpedPos, blend, worldTilingScale);
    float roughness = triplanarSampleWarped(roughnessTexture, vWorldPosition, warpedPos, blend, worldTilingScale).r;
    vec3 perturbedNormal = triplanarNormalWarped(normalTexture, warpedPos, normal, blend, worldTilingScale);
    
    // ========== DUAL-FREQUENCY MACRO VARIATION ==========
    // Two noise frequencies create more organic, less repetitive patterns
    vec2 macroUVLarge = vWorldPosition.xz * macroScaleLarge + macroOffset;
    vec2 macroUVMedium = vWorldPosition.xz * macroScaleMedium + macroOffset * 1.7; // Offset to decorrelate
    
    float noiseLarge = texture2D(macroNoiseTexture, macroUVLarge).r;
    float noiseMedium = texture2D(macroNoiseTexture, macroUVMedium).r;
    
    // Blend two frequencies: large for broad variation, medium for detail breakup
    // Weight large more heavily for natural terrain look
    float macroNoise = noiseLarge * 0.6 + noiseMedium * 0.4;
    float macroVar = (macroNoise - 0.5) * 2.0; // Range: -1 to 1
    
    // Apply macro variation to color and roughness
    float colorVar = 1.0 + macroVar * macroStrengthColor;
    diffuse.rgb *= colorVar;
    roughness += macroVar * macroStrengthRoughness;
    
    // ========== LIGHTING ==========
    float NdotL = max(dot(perturbedNormal, -lightDirection), 0.0);
    float lighting = ambientLevel + (1.0 - ambientLevel) * NdotL;
    
    roughness = clamp(roughness * roughnessMultiplier, 0.0, 1.0);
    float roughnessDarken = 1.0 - roughness * 0.15;
    
    vec3 finalColor = diffuse.rgb * tintColor * lighting * roughnessDarken;
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

/**
 * Create a triplanar-mapped terrain material for slope + skirt
 * Uses world-space projection to avoid UV stretching on slopes
 * 
 * Anti-tiling techniques:
 * 1. Coordinate warping - distorts UV sampling to break regular grid pattern
 * 2. Dual-frequency macro noise - two noise scales for organic variation
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} options - Material configuration
 * @param {number} options.worldTilingScale - Detail texture scale (default 0.1)
 * @param {number} options.blendSharpness - Triplanar blend sharpness (default 4.0)
 * @param {number} options.normalStrength - Normal map intensity (default 0.5)
 * @param {number} options.roughnessMultiplier - Roughness adjustment (default 1.0)
 * @param {Color3} options.tint - Color tint
 * @param {boolean} options.useTriplanar - Use triplanar or XZ planar fallback
 * @param {number} options.warpScale - Warp noise frequency (default 0.03)
 * @param {number} options.warpStrength - Warp offset in world units (default 1.5)
 * @param {number} options.macroScaleLarge - Large macro noise scale (default 0.012)
 * @param {number} options.macroScaleMedium - Medium macro noise scale (default 0.045)
 * @param {number} options.macroStrengthColor - Color variation strength (default 0.12)
 * @param {number} options.macroStrengthRoughness - Roughness variation (default 0.1)
 */
function createTerrainMaterial(scene, options = {}) {
  const {
    worldTilingScale = 0.1,
    blendSharpness = 4.0,
    normalStrength = 0.5,
    roughnessMultiplier = 1.0,
    tint = new Color3(0.9, 0.85, 0.8),
    useTriplanar = true,
    // Coordinate warping - breaks up grid pattern
    warpScale = 0.03,            // Noise frequency for warp (~30m)
    warpStrength = 1.5,          // World-unit offset (subtle distortion)
    // Dual-frequency macro variation
    macroScaleLarge = 0.012,     // Large scale (~80m per tile)
    macroScaleMedium = 0.045,    // Medium scale (~22m per tile)
    macroStrengthColor = 0.12,   // Color variation
    macroStrengthRoughness = 0.1, // Roughness variation
    macroOffsetX = 0,
    macroOffsetY = 0
  } = options;
  
  const basePath = '/assets/decor/forest_leaves_02';
  
  if (!useTriplanar) {
    return createPlanarTerrainMaterial(scene, {
      worldTilingScale,
      normalStrength,
      roughnessMultiplier,
      tint
    });
  }
  
  // Create shader material with warping + dual macro variation
  const mat = new ShaderMaterial('triplanarTerrain', scene, {
    vertex: 'triplanarTerrain',
    fragment: 'triplanarTerrain'
  }, {
    attributes: ['position', 'normal'],
    uniforms: [
      'world', 'worldViewProjection',
      'worldTilingScale', 'blendSharpness', 'normalStrength', 'roughnessMultiplier',
      'tintColor', 'lightDirection', 'ambientLevel',
      'warpScale', 'warpStrength',
      'macroScaleLarge', 'macroScaleMedium', 'macroStrengthColor', 'macroStrengthRoughness', 'macroOffset'
    ],
    samplers: ['diffuseTexture', 'normalTexture', 'roughnessTexture', 'macroNoiseTexture']
  });
  
  // Load textures
  const diffuseTex = new Texture(`${basePath}_diffuse_1k.jpg`, scene);
  const normalTex = new Texture(`${basePath}_nor_gl_1k.jpg`, scene);
  const roughTex = new Texture(`${basePath}_rough_1k.jpg`, scene);
  const macroNoiseTex = new Texture('/assets/noise.png', scene);
  
  [diffuseTex, normalTex, roughTex, macroNoiseTex].forEach(tex => {
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
  });
  
  mat.setTexture('diffuseTexture', diffuseTex);
  mat.setTexture('normalTexture', normalTex);
  mat.setTexture('roughnessTexture', roughTex);
  mat.setTexture('macroNoiseTexture', macroNoiseTex);
  
  // Base uniforms
  mat.setFloat('worldTilingScale', worldTilingScale);
  mat.setFloat('blendSharpness', blendSharpness);
  mat.setFloat('normalStrength', normalStrength);
  mat.setFloat('roughnessMultiplier', roughnessMultiplier);
  mat.setColor3('tintColor', tint);
  mat.setVector3('lightDirection', new Vector3(0.5, -1, 0.3).normalize());
  mat.setFloat('ambientLevel', 0.4);
  
  // Warp uniforms
  mat.setFloat('warpScale', warpScale);
  mat.setFloat('warpStrength', warpStrength);
  
  // Macro variation uniforms
  mat.setFloat('macroScaleLarge', macroScaleLarge);
  mat.setFloat('macroScaleMedium', macroScaleMedium);
  mat.setFloat('macroStrengthColor', macroStrengthColor);
  mat.setFloat('macroStrengthRoughness', macroStrengthRoughness);
  mat.setVector2('macroOffset', new Vector2(macroOffsetX, macroOffsetY));
  
  mat.backFaceCulling = false;
  
  // Runtime tweaking methods
  mat.updateTilingScale = (scale) => mat.setFloat('worldTilingScale', scale);
  mat.updateBlendSharpness = (sharpness) => mat.setFloat('blendSharpness', sharpness);
  mat.updateNormalStrength = (strength) => mat.setFloat('normalStrength', strength);
  mat.updateRoughnessMultiplier = (mult) => mat.setFloat('roughnessMultiplier', mult);
  mat.updateTint = (color) => mat.setColor3('tintColor', color);
  mat.updateWarpScale = (scale) => mat.setFloat('warpScale', scale);
  mat.updateWarpStrength = (strength) => mat.setFloat('warpStrength', strength);
  mat.updateMacroScaleLarge = (scale) => mat.setFloat('macroScaleLarge', scale);
  mat.updateMacroScaleMedium = (scale) => mat.setFloat('macroScaleMedium', scale);
  mat.updateMacroStrengthColor = (strength) => mat.setFloat('macroStrengthColor', strength);
  mat.updateMacroStrengthRoughness = (strength) => mat.setFloat('macroStrengthRoughness', strength);
  
  return mat;
}

/**
 * Fallback: Simple XZ planar projection using standard PBR
 * Lighter weight than triplanar, works well for mostly-horizontal surfaces
 */
function createPlanarTerrainMaterial(scene, options = {}) {
  const {
    worldTilingScale = 0.1,
    normalStrength = 0.5,
    roughnessMultiplier = 1.0,
    tint = new Color3(0.9, 0.85, 0.8)
  } = options;
  
  const mat = new PBRMaterial('planarTerrain', scene);
  const basePath = '/assets/decor/forest_leaves_02';
  
  // Load textures with world-space UV scale
  const albedoTex = new Texture(`${basePath}_diffuse_1k.jpg`, scene);
  albedoTex.uScale = worldTilingScale;
  albedoTex.vScale = worldTilingScale;
  albedoTex.coordinatesMode = Texture.PLANAR_MODE;
  mat.albedoTexture = albedoTex;
  mat.albedoColor = tint;
  
  const normalTex = new Texture(`${basePath}_nor_gl_1k.jpg`, scene);
  normalTex.uScale = worldTilingScale;
  normalTex.vScale = worldTilingScale;
  normalTex.coordinatesMode = Texture.PLANAR_MODE;
  mat.bumpTexture = normalTex;
  mat.bumpTexture.level = normalStrength;
  
  const roughTex = new Texture(`${basePath}_rough_1k.jpg`, scene);
  roughTex.uScale = worldTilingScale;
  roughTex.vScale = worldTilingScale;
  roughTex.coordinatesMode = Texture.PLANAR_MODE;
  mat.metallicTexture = roughTex;
  mat.useRoughnessFromMetallicTextureGreen = true;
  mat.useMetallnessFromMetallicTextureBlue = false;
  
  mat.metallic = 0;
  mat.roughness = 0.9 * roughnessMultiplier;
  mat.backFaceCulling = false;
  
  return mat;
}

/**
 * WALL MATERIAL - Mossy Stone/Rock with Triplanar Mapping
 * 
 * Uses the same triplanar technique as terrain but with stone wall textures.
 * Supports multiple texture sets for variety (mossy_stone_wall, mossy_rock).
 * Includes noise-based variation to prevent visible repetition on walls.
 */

/**
 * Create a triplanar-mapped wall material
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} options - Material configuration
 * @param {string} options.textureSet - Texture set name ('mossy_stone_wall' or 'mossy_rock')
 */
function createWallMaterial(scene, options = {}) {
  const {
    textureSet = 'mossy_stone_wall', // Which texture set to use
    worldTilingScale = 0.8,        // Walls are smaller, so larger texture scale
    blendSharpness = 4.0,          // Sharp triplanar blending
    normalStrength = 0.7,          // Strong normal detail for stone
    roughnessMultiplier = 1.0,
    tint = new Color3(0.75, 0.78, 0.72), // Slight greenish tint for moss
    // Coordinate warping - breaks up grid pattern
    warpScale = 0.15,              // Higher frequency for walls
    warpStrength = 0.3,            // Subtle distortion
    // Macro variation
    macroScaleLarge = 0.05,
    macroScaleMedium = 0.15,
    macroStrengthColor = 0.08,
    macroStrengthRoughness = 0.06
  } = options;
  
  const basePath = `/assets/decor/${textureSet}`;
  
  // Reuse the triplanar shader (already registered)
  const mat = new ShaderMaterial(`triplanarWall_${textureSet}`, scene, {
    vertex: 'triplanarTerrain',
    fragment: 'triplanarTerrain'
  }, {
    attributes: ['position', 'normal'],
    uniforms: [
      'world', 'worldViewProjection',
      'worldTilingScale', 'blendSharpness', 'normalStrength', 'roughnessMultiplier',
      'tintColor', 'lightDirection', 'ambientLevel',
      'warpScale', 'warpStrength',
      'macroScaleLarge', 'macroScaleMedium', 'macroStrengthColor', 'macroStrengthRoughness', 'macroOffset'
    ],
    samplers: ['diffuseTexture', 'normalTexture', 'roughnessTexture', 'macroNoiseTexture']
  });
  
  // Load wall textures
  const diffuseTex = new Texture(`${basePath}_diff_1k.jpg`, scene);
  const normalTex = new Texture(`${basePath}_nor_gl_1k.jpg`, scene);
  const roughTex = new Texture(`${basePath}_rough_1k.jpg`, scene);
  const macroNoiseTex = new Texture('/assets/noise.png', scene);
  
  [diffuseTex, normalTex, roughTex, macroNoiseTex].forEach(tex => {
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
  });
  
  mat.setTexture('diffuseTexture', diffuseTex);
  mat.setTexture('normalTexture', normalTex);
  mat.setTexture('roughnessTexture', roughTex);
  mat.setTexture('macroNoiseTexture', macroNoiseTex);
  
  // Set uniforms
  mat.setFloat('worldTilingScale', worldTilingScale);
  mat.setFloat('blendSharpness', blendSharpness);
  mat.setFloat('normalStrength', normalStrength);
  mat.setFloat('roughnessMultiplier', roughnessMultiplier);
  mat.setColor3('tintColor', tint);
  mat.setVector3('lightDirection', new Vector3(0.5, -1, 0.3).normalize());
  mat.setFloat('ambientLevel', 0.35); // Slightly darker for walls
  
  // Warp uniforms
  mat.setFloat('warpScale', warpScale);
  mat.setFloat('warpStrength', warpStrength);
  
  // Macro variation uniforms
  mat.setFloat('macroScaleLarge', macroScaleLarge);
  mat.setFloat('macroScaleMedium', macroScaleMedium);
  mat.setFloat('macroStrengthColor', macroStrengthColor);
  mat.setFloat('macroStrengthRoughness', macroStrengthRoughness);
  mat.setVector2('macroOffset', new Vector2(0, 0));
  
  mat.backFaceCulling = true; // Walls don't need back faces
  
  return mat;
}

/**
 * Create wall crumble debris meshes
 * Adds rubble/crumbles on top and corners of some walls for a ruined effect
 * 
 * @param {Scene} scene - Babylon.js scene
 * @param {Array<{x: number, y: number, height: number, materialIndex: number}>} wallData - Wall positions, heights, and material indices
 * @param {number} tileSize - Size of each tile
 * @param {Array<Material>} wallMaterials - Array of materials to apply to crumbles (matches wall)
 * @param {Mesh} mapContainer - Parent container
 * @param {Object} options - Configuration
 */
function createWallCrumbles(scene, wallData, tileSize, wallMaterials, mapContainer, options = {}) {
  const {
    crumbleChance = 0.35,          // 35% of walls get crumbles
    cornerCrumbleChance = 0.5,     // 50% of eligible corners get crumbles
    maxCrumblesPerWall = 3,        // Max debris pieces per wall top
    minCrumbleSize = 0.08,
    maxCrumbleSize = 0.2,
    seed = 12345
  } = options;
  
  const crumbleMeshes = [];
  
  // Deterministic random function
  let seedValue = seed;
  const random = () => {
    seedValue = (seedValue * 1103515245 + 12345) & 0x7fffffff;
    return seedValue / 0x7fffffff;
  };
  
  // Create a set for quick wall lookups
  const wallSet = new Set(wallData.map(w => `${w.x}_${w.y}`));
  
  wallData.forEach(wall => {
    const { x, y, height, materialIndex = 0 } = wall;
    const worldX = x * tileSize;
    const worldZ = y * tileSize;
    const wallTopY = height - 0.05; // Top of wall
    
    // Get the matching material for this wall's crumbles
    const wallMaterial = wallMaterials[materialIndex] || wallMaterials[0];
    
    // Determine if this wall gets crumbles
    if (random() > crumbleChance) return;
    
    // Check neighbors to determine crumble placement
    const hasWallNorth = wallSet.has(`${x}_${y - 1}`);
    const hasWallSouth = wallSet.has(`${x}_${y + 1}`);
    const hasWallEast = wallSet.has(`${x + 1}_${y}`);
    const hasWallWest = wallSet.has(`${x - 1}_${y}`);
    
    // Add top crumbles (rubble on the surface)
    const numTopCrumbles = Math.floor(random() * maxCrumblesPerWall) + 1;
    for (let i = 0; i < numTopCrumbles; i++) {
      const crumbleSize = minCrumbleSize + random() * (maxCrumbleSize - minCrumbleSize);
      
      // Create irregular polygon-like crumble using scaled box
      const crumble = MeshBuilder.CreateBox(`crumble_top_${x}_${y}_${i}`, {
        width: crumbleSize * (0.6 + random() * 0.8),
        height: crumbleSize * (0.4 + random() * 0.5),
        depth: crumbleSize * (0.6 + random() * 0.8)
      }, scene);
      
      // Random position on top of wall
      const offsetX = (random() - 0.5) * tileSize * 0.7;
      const offsetZ = (random() - 0.5) * tileSize * 0.7;
      
      crumble.position = new Vector3(
        worldX + offsetX,
        wallTopY + crumbleSize * 0.2,
        worldZ + offsetZ
      );
      
      // Random rotation for variety
      crumble.rotation = new Vector3(
        random() * 0.4 - 0.2,
        random() * Math.PI * 2,
        random() * 0.4 - 0.2
      );
      
      crumble.material = wallMaterial;
      crumble.parent = mapContainer;
      crumble.isPickable = false;
      crumbleMeshes.push(crumble);
    }
    
    // Add corner/edge crumbles (fallen debris at base)
    // Only add if there's an exposed edge (no neighbor wall)
    const exposedEdges = [];
    if (!hasWallNorth) exposedEdges.push({ dx: 0, dz: -0.5 });
    if (!hasWallSouth) exposedEdges.push({ dx: 0, dz: 0.5 });
    if (!hasWallEast) exposedEdges.push({ dx: 0.5, dz: 0 });
    if (!hasWallWest) exposedEdges.push({ dx: -0.5, dz: 0 });
    
    exposedEdges.forEach(edge => {
      if (random() > cornerCrumbleChance) return;
      
      // Create 1-3 debris pieces at this edge
      const numDebris = Math.floor(random() * 2) + 1;
      for (let i = 0; i < numDebris; i++) {
        const debrisSize = minCrumbleSize + random() * (maxCrumbleSize - minCrumbleSize) * 1.5;
        
        const debris = MeshBuilder.CreateBox(`crumble_edge_${x}_${y}_${edge.dx}_${edge.dz}_${i}`, {
          width: debrisSize * (0.5 + random() * 0.7),
          height: debrisSize * (0.3 + random() * 0.4),
          depth: debrisSize * (0.5 + random() * 0.7)
        }, scene);
        
        // Position at edge with slight scatter
        const scatter = 0.15;
        debris.position = new Vector3(
          worldX + edge.dx * tileSize + (random() - 0.5) * scatter,
          debrisSize * 0.15 - 0.05, // Slightly in ground
          worldZ + edge.dz * tileSize + (random() - 0.5) * scatter
        );
        
        // Random rotation, tilted to look fallen
        debris.rotation = new Vector3(
          random() * 0.6 - 0.3,
          random() * Math.PI * 2,
          random() * 0.6 - 0.3
        );
        
        debris.material = wallMaterial;
        debris.parent = mapContainer;
        debris.isPickable = false;
        crumbleMeshes.push(debris);
      }
    });
    
    // Add corner pile crumbles (at wall intersections that are exposed)
    const corners = [
      { dx: -0.5, dz: -0.5, needsNoWall: [`${x - 1}_${y}`, `${x}_${y - 1}`, `${x - 1}_${y - 1}`] },
      { dx: 0.5, dz: -0.5, needsNoWall: [`${x + 1}_${y}`, `${x}_${y - 1}`, `${x + 1}_${y - 1}`] },
      { dx: -0.5, dz: 0.5, needsNoWall: [`${x - 1}_${y}`, `${x}_${y + 1}`, `${x - 1}_${y + 1}`] },
      { dx: 0.5, dz: 0.5, needsNoWall: [`${x + 1}_${y}`, `${x}_${y + 1}`, `${x + 1}_${y + 1}`] }
    ];
    
    corners.forEach(corner => {
      // Only add corner crumbles if corner is exposed (at least 2 of the 3 adjacent cells have no wall)
      const exposedCount = corner.needsNoWall.filter(key => !wallSet.has(key)).length;
      if (exposedCount < 2) return;
      if (random() > cornerCrumbleChance * 0.7) return; // Less common than edge
      
      const pileSize = minCrumbleSize + random() * maxCrumbleSize;
      
      const pile = MeshBuilder.CreateBox(`crumble_corner_${x}_${y}_${corner.dx}_${corner.dz}`, {
        width: pileSize * (0.8 + random() * 0.4),
        height: pileSize * (0.5 + random() * 0.3),
        depth: pileSize * (0.8 + random() * 0.4)
      }, scene);
      
      pile.position = new Vector3(
        worldX + corner.dx * tileSize * 0.8,
        pileSize * 0.2 - 0.05,
        worldZ + corner.dz * tileSize * 0.8
      );
      
      pile.rotation = new Vector3(
        random() * 0.5 - 0.25,
        random() * Math.PI * 2,
        random() * 0.5 - 0.25
      );
      
      pile.material = wallMaterial;
      pile.parent = mapContainer;
      pile.isPickable = false;
      crumbleMeshes.push(pile);
    });
  });
  
  console.log(`Created ${crumbleMeshes.length} wall crumble meshes`);
  return crumbleMeshes;
}

/**
 * Create rock debris at the bottom of water tiles for visual relief
 * @param {Scene} scene - Babylon.js scene
 * @param {Array} waterTileData - Array of {x, y, worldX, worldZ} for water tiles
 * @param {Mesh} mapContainer - Parent container for meshes
 * @param {Object} options - Configuration options
 */
function createWaterRocks(scene, waterTileData, mapContainer, options = {}) {
  const {
    tileSize = 1,
    waterBottomY = -0.52, // Bottom of water channel
    minRockSize = 0.06,
    maxRockSize = 0.15,
    rocksPerTile = { min: 2, max: 5 }, // Random rocks per tile
    edgeRockChance = 0.7, // Chance for rocks along edges
    seed = 98765
  } = options;
  
  // Create a simple rock material (dark gray stone)
  const rockMaterial = new StandardMaterial('waterRockMaterial', scene);
  rockMaterial.diffuseColor = new Color3(0.35, 0.32, 0.28); // Dark gray-brown
  rockMaterial.specularColor = new Color3(0.1, 0.1, 0.1); // Low specular
  rockMaterial.emissiveColor = new Color3(0.05, 0.05, 0.05); // Slight self-illumination for visibility underwater
  
  const rockMeshes = [];
  
  // Seeded random for consistent placement
  let currentSeed = seed;
  const seededRandom = () => {
    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    return (currentSeed / 0x7fffffff);
  };
  
  // Build a set of water tile positions for neighbor checking
  const waterSet = new Set(waterTileData.map(t => `${t.x}_${t.y}`));
  
  waterTileData.forEach(({ x, y, worldX, worldZ }) => {
    const random = seededRandom;
    
    // Determine number of rocks for this tile
    const numRocks = Math.floor(rocksPerTile.min + random() * (rocksPerTile.max - rocksPerTile.min + 1));
    
    // Create scattered rocks across the tile
    for (let i = 0; i < numRocks; i++) {
      const rockSize = minRockSize + random() * (maxRockSize - minRockSize);
      
      // Random position within the tile (with some margin from edges)
      const margin = 0.1;
      const rx = worldX + (random() - 0.5) * (tileSize - margin * 2);
      const rz = worldZ + (random() - 0.5) * (tileSize - margin * 2);
      
      // Vary rock shape (wider vs taller)
      const widthFactor = 0.7 + random() * 0.6;
      const heightFactor = 0.4 + random() * 0.4;
      const depthFactor = 0.7 + random() * 0.6;
      
      const rock = MeshBuilder.CreateBox(`waterRock_${x}_${y}_${i}`, {
        width: rockSize * widthFactor,
        height: rockSize * heightFactor,
        depth: rockSize * depthFactor
      }, scene);
      
      // Position at bottom of water, partially embedded
      rock.position = new Vector3(
        rx,
        waterBottomY + (rockSize * heightFactor * 0.3), // Partially above the ground
        rz
      );
      
      // Random rotation for natural look
      rock.rotation = new Vector3(
        random() * 0.4 - 0.2,
        random() * Math.PI * 2,
        random() * 0.4 - 0.2
      );
      
      rock.material = rockMaterial;
      rock.parent = mapContainer;
      rock.isPickable = false;
      rockMeshes.push(rock);
    }
    
    // Add larger rocks along edges where water meets land
    const edges = [
      { dx: 0, dz: -0.5, nx: 0, ny: -1 }, // top edge
      { dx: 0.5, dz: 0, nx: 1, ny: 0 },   // right edge
      { dx: 0, dz: 0.5, nx: 0, ny: 1 },   // bottom edge
      { dx: -0.5, dz: 0, nx: -1, ny: 0 }  // left edge
    ];
    
    edges.forEach(edge => {
      const neighborKey = `${x + edge.nx}_${y + edge.ny}`;
      const isWaterNeighbor = waterSet.has(neighborKey);
      
      // Only add edge rocks where water meets non-water (land)
      if (!isWaterNeighbor && random() < edgeRockChance) {
        // Add 1-3 rocks along this edge
        const edgeRockCount = 1 + Math.floor(random() * 2);
        
        for (let i = 0; i < edgeRockCount; i++) {
          const rockSize = minRockSize * 1.2 + random() * maxRockSize * 1.5; // Slightly larger edge rocks
          
          // Position along the edge with scatter
          const edgeOffset = (random() - 0.5) * 0.7; // Scatter along edge
          const depthOffset = random() * 0.15; // Slight offset from wall
          
          let rx, rz;
          if (edge.nx !== 0) {
            // Horizontal edge (left/right)
            rx = worldX + edge.dx * tileSize - edge.nx * depthOffset;
            rz = worldZ + edgeOffset * tileSize;
          } else {
            // Vertical edge (top/bottom)
            rx = worldX + edgeOffset * tileSize;
            rz = worldZ + edge.dz * tileSize - edge.ny * depthOffset;
          }
          
          const rock = MeshBuilder.CreateBox(`waterEdgeRock_${x}_${y}_${edge.dx}_${edge.dz}_${i}`, {
            width: rockSize * (0.8 + random() * 0.4),
            height: rockSize * (0.5 + random() * 0.3),
            depth: rockSize * (0.8 + random() * 0.4)
          }, scene);
          
          rock.position = new Vector3(
            rx,
            waterBottomY + (rockSize * 0.25),
            rz
          );
          
          rock.rotation = new Vector3(
            random() * 0.5 - 0.25,
            random() * Math.PI * 2,
            random() * 0.5 - 0.25
          );
          
          rock.material = rockMaterial;
          rock.parent = mapContainer;
          rock.isPickable = false;
          rockMeshes.push(rock);
        }
      }
    });
  });
  
  console.log(`Created ${rockMeshes.length} water rock meshes`);
  return rockMeshes;
}

/**
 * Scatter trees on the skirt around the map
 * @param {Scene} scene - Babylon.js scene
 * @param {Object} skirtBounds - Map bounds {mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight}
 * @param {Object} options - {modelFile, treeCount, minDistance, maxDistance, minScale, maxScale, groundY, seed}
 */
async function scatterTrees(scene, skirtBounds, options = {}) {
  const {
    modelFile = 'tree1.glb',
    treeCount = 50,
    minDistance = 10,
    maxDistance = 60,
    minScale = 1.0,
    maxScale = 1.0,
    groundY = -0.25,
    seed = 42069
  } = options;
  
  const { mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight } = skirtBounds;
  const treeName = modelFile.replace('.glb', '');
  
  try {
    // Load model (will use browser cache if already preloaded)
    const result = await SceneLoader.ImportMeshAsync('', '/assets/decor/', modelFile, scene);
    
    const meshes = result.meshes.filter(m => m.name !== '__root__' && m.getTotalVertices() > 0);
    
    if (meshes.length === 0) {
      console.warn(`[Trees] No meshes found in ${modelFile}`);
      return { treeInstances: [], instanceCount: 0 };
    }
    
    // Hide source meshes
    meshes.forEach(m => {
      m.isVisible = false;
      m.setEnabled(false);
    });
    
    // Seeded random for consistent placement
    let currentSeed = seed;
    const random = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };
    
    // Generate positions in ring around map
    const positions = [];
    const distanceRange = maxDistance - minDistance;
    const keepOutX = mapHalfWidth + minDistance;
    const keepOutZ = mapHalfHeight + minDistance;
    const outerX = mapHalfWidth + maxDistance;
    const outerZ = mapHalfHeight + maxDistance;
    
    let attempts = 0;
    while (positions.length < treeCount && attempts < treeCount * 20) {
      attempts++;
      
      const x = mapCenterX + (random() * 2 - 1) * outerX;
      const z = mapCenterZ + (random() * 2 - 1) * outerZ;
      
      // Skip if too close to map
      if (Math.abs(x - mapCenterX) < keepOutX && Math.abs(z - mapCenterZ) < keepOutZ) continue;
      
      // Skip if too close to another tree
      if (positions.some(p => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      
      // Calculate scale based on distance
      const dist = Math.max(Math.abs(x - mapCenterX) - mapHalfWidth, Math.abs(z - mapCenterZ) - mapHalfHeight);
      const t = Math.min(1, Math.max(0, (dist - minDistance) / distanceRange));
      const baseScale = minScale + t * (maxScale - minScale);
      const scale = baseScale * (0.7 + random() * 0.6); // ±30% variation
      
      // Random rotation and slight tilt
      const rotationY = random() * Math.PI * 2;
      const tiltX = (random() - 0.5) * 0.1;
      const tiltZ = (random() - 0.5) * 0.1;
      
      positions.push({ x, z, scale, rotationY, tiltX, tiltZ });
    }
    
    // Get mesh bounds for ground positioning
    const meshMinY = meshes[0].getBoundingInfo().boundingBox.minimumWorld.y;
    
    // Clone trees at each position
    const treeInstances = [];
    const maxTrees = Math.min(positions.length, 100);
    
    for (let i = 0; i < maxTrees; i++) {
      const pos = positions[i];
      
      meshes.forEach((sourceMesh, j) => {
        const clone = sourceMesh.clone(`${treeName}_${i}_${j}`);
        if (!clone) return;
        
        clone.parent = null;
        clone.scaling = new Vector3(pos.scale, pos.scale, pos.scale);
        clone.position = new Vector3(pos.x, groundY - meshMinY * pos.scale, pos.z);
        clone.rotationQuaternion = null;
        clone.rotation = new Vector3(pos.tiltX || 0, pos.rotationY, pos.tiltZ || 0);
        clone.setEnabled(true);
        clone.isVisible = true;
        clone.isPickable = false;
        clone.applyFog = true;
        
        treeInstances.push(clone);
      });
    }
    
    console.log(`[Trees] Placed ${maxTrees} ${treeName}`);
    
    return {
      treeInstances,
      instanceCount: maxTrees,
      dispose: () => {
        treeInstances.forEach(t => t.dispose());
        result.meshes.forEach(m => m.dispose());
      }
    };
    
  } catch (error) {
    console.error(`[Trees] Failed to load ${modelFile}:`, error);
    return { treeInstances: [], instanceCount: 0 };
  }
}

/**
 * Scatter decorative wall ruins in the forest for visual consistency with game board
 * Creates various shapes: single walls, L-shapes, lines, and small clusters
 * @param {Scene} scene - Babylon scene
 * @param {Object} skirtBounds - Map bounds {mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight}
 * @param {Array} wallMaterials - Array of wall materials to use
 * @param {Object} options - Configuration options
 */
function scatterRuins(scene, skirtBounds, wallMaterials, options = {}) {
  const {
    ruinCount = 30,
    minDistance = 12,
    maxDistance = 45,
    groundY = -0.25,
    tileSize = 1,
    seed = 98765
  } = options;
  
  const { mapCenterX, mapCenterZ, mapHalfWidth, mapHalfHeight } = skirtBounds;
  
  // Seeded random for consistent placement
  let currentSeed = seed;
  const random = () => {
    currentSeed = (currentSeed * 9301 + 49297) % 233280;
    return currentSeed / 233280;
  };
  
  // Define ruin shape templates (relative tile positions)
  const ruinShapes = [
    // Single blocks (most common)
    [{ x: 0, z: 0 }],
    [{ x: 0, z: 0 }],
    [{ x: 0, z: 0 }],
    // Two-block lines
    [{ x: 0, z: 0 }, { x: 1, z: 0 }],
    [{ x: 0, z: 0 }, { x: 0, z: 1 }],
    // L-shapes
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }],
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }],
    // Three-block lines
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
    [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }],
    // Small clusters
    [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }],
  ];
  
  // Generate positions in ring around map
  const positions = [];
  const keepOutX = mapHalfWidth + minDistance;
  const keepOutZ = mapHalfHeight + minDistance;
  const outerX = mapHalfWidth + maxDistance;
  const outerZ = mapHalfHeight + maxDistance;
  
  let attempts = 0;
  while (positions.length < ruinCount && attempts < ruinCount * 30) {
    attempts++;
    
    const x = mapCenterX + (random() * 2 - 1) * outerX;
    const z = mapCenterZ + (random() * 2 - 1) * outerZ;
    
    // Skip if too close to map
    if (Math.abs(x - mapCenterX) < keepOutX && Math.abs(z - mapCenterZ) < keepOutZ) continue;
    
    // Skip if too close to another ruin (need more space than trees)
    if (positions.some(p => Math.hypot(p.x - x, p.z - z) < 6)) continue;
    
    // Pick a random shape and rotation
    const shapeIndex = Math.floor(random() * ruinShapes.length);
    const rotationIndex = Math.floor(random() * 4); // 0, 90, 180, 270 degrees
    const materialIndex = Math.floor(random() * wallMaterials.length);
    
    positions.push({ 
      x, z, 
      shapeIndex, 
      rotationIndex,
      materialIndex,
      heightScale: 0.4 + random() * 0.6 // 40-100% height for variety (ruined look)
    });
  }
  
  const ruinMeshes = [];
  const cornerRadius = 0.15;
  
  // Create ruins at each position
  positions.forEach((pos, ruinIdx) => {
    const shape = ruinShapes[pos.shapeIndex];
    const material = wallMaterials[pos.materialIndex];
    const rotation = pos.rotationIndex * Math.PI / 2;
    
    // Build a local grid to check neighbors for corner cylinders
    const localTiles = new Set();
    const rotatedTiles = shape.map(tile => {
      // Rotate tile around origin
      let rx = tile.x, rz = tile.z;
      for (let r = 0; r < pos.rotationIndex; r++) {
        const temp = rx;
        rx = -rz;
        rz = temp;
      }
      localTiles.add(`${rx}_${rz}`);
      return { x: rx, z: rz };
    });
    
    // Create each wall block in the shape
    rotatedTiles.forEach((tile, tileIdx) => {
      const worldX = pos.x + tile.x * tileSize;
      const worldZ = pos.z + tile.z * tileSize;
      
      // Vary height per block and apply ruin scale
      const baseHeight = 0.8 + random() * 1.2; // 0.8 to 2.0 base height
      const wallHeight = baseHeight * pos.heightScale;
      
      // Create wall box
      const wall = MeshBuilder.CreateBox(`ruin_${ruinIdx}_wall_${tileIdx}`, {
        width: tileSize,
        height: wallHeight,
        depth: tileSize
      }, scene);
      wall.position = new Vector3(worldX, groundY + wallHeight / 2, worldZ);
      wall.material = material;
      wall.isPickable = false;
      wall.applyFog = true;
      ruinMeshes.push(wall);
      
      // Check neighbors for corner cylinders (in local grid)
      const hasWallN = localTiles.has(`${tile.x}_${tile.z - 1}`);
      const hasWallS = localTiles.has(`${tile.x}_${tile.z + 1}`);
      const hasWallE = localTiles.has(`${tile.x + 1}_${tile.z}`);
      const hasWallW = localTiles.has(`${tile.x - 1}_${tile.z}`);
      
      // Corner definitions - only exposed if both adjacent sides are free
      const corners = [
        { dx: -1, dz: -1, exposed: !hasWallW && !hasWallN }, // NW
        { dx: 1, dz: -1, exposed: !hasWallE && !hasWallN },  // NE
        { dx: -1, dz: 1, exposed: !hasWallW && !hasWallS },  // SW
        { dx: 1, dz: 1, exposed: !hasWallE && !hasWallS }    // SE
      ];
      
      // Add corner cylinders
      corners.forEach((corner, cIdx) => {
        if (!corner.exposed) return;
        
        // Random variation
        const cornerSeed = ruinIdx * 1000 + tileIdx * 10 + cIdx;
        const cornerRandom = (offset) => {
          const n = Math.sin(cornerSeed + offset * 127.1) * 43758.5453;
          return n - Math.floor(n);
        };
        
        // Some randomness to skip corners for ruined look
        if (cornerRandom(0) > 0.75) return;
        
        const offsetInward = 0.12 + cornerRandom(10) * 0.06;
        const jitterX = (cornerRandom(20) - 0.5) * 0.04;
        const jitterZ = (cornerRandom(30) - 0.5) * 0.04;
        const radiusVar = 0.9 + cornerRandom(40) * 0.2;
        
        const cylinder = MeshBuilder.CreateCylinder(`ruin_${ruinIdx}_corner_${tileIdx}_${cIdx}`, {
          diameter: cornerRadius * 2.5 * radiusVar,
          height: wallHeight + 0.02,
          tessellation: 8
        }, scene);
        
        const cylX = worldX + corner.dx * (tileSize * 0.5 - offsetInward) + jitterX;
        const cylZ = worldZ + corner.dz * (tileSize * 0.5 - offsetInward) + jitterZ;
        
        cylinder.position = new Vector3(cylX, groundY + wallHeight / 2, cylZ);
        cylinder.material = material;
        cylinder.isPickable = false;
        cylinder.applyFog = true;
        ruinMeshes.push(cylinder);
      });
    });
  });
  
  console.log(`[Ruins] Placed ${positions.length} decorative wall ruins`);
  
  return {
    ruinMeshes,
    ruinCount: positions.length,
    dispose: () => {
      ruinMeshes.forEach(m => m.dispose());
    }
  };
}

/**
 * WALL HEIGHT ALGORITHM - Distance Transform Approach
 * 
 * Computes height levels for wall tiles based on distance to nearest edge.
 * Uses multi-source BFS from all edge tiles for O(n) efficiency.
 * 
 * Behavior:
 * - Isolated wall: height 1 (edge tile with no interior)
 * - Line of walls: ends=1, middle increases (e.g., 1,2,3,2,1 for 5-tile line)
 * - Thick clusters: center tiles reach max height
 * 
 * Examples:
 *   Single tile:     [1]
 *   2-tile line:     [1,1]
 *   5-tile line:     [1,2,3,2,1]
 *   3x3 block:       [1,1,1]
 *                    [1,2,1]
 *                    [1,1,1]
 *   5x5 block:       [1,1,1,1,1]
 *                    [1,2,2,2,1]
 *                    [1,2,3,2,1]
 *                    [1,2,2,2,1]
 *                    [1,1,1,1,1]
 * 
 * @param {Array<Array<number>>} terrain - 2D grid of tile types
 * @param {Object} config - Height configuration
 * @param {number} config.minHeight - Minimum height level (default 1)
 * @param {number} config.maxHeight - Maximum height level cap (default 5)
 * @param {number} config.baseHeight - Starting height for edge tiles (default 1)
 * @returns {Map<string, number>} Map of "x_y" -> height level
 */
function computeWallHeights(terrain, config = {}) {
  const {
    minHeight = 1,
    maxHeight = 5,
    baseHeight = 1
  } = config;
  
  const height = terrain.length;
  const width = terrain[0]?.length || 0;
  const heightMap = new Map();
  
  if (height === 0 || width === 0) return heightMap;
  
  // Helper to check if a tile is a wall
  const isWall = (x, y) => {
    if (y < 0 || y >= height || x < 0 || x >= width) return false;
    return terrain[y][x] === TILE_TYPES.WALL;
  };
  
  // 4-neighbor directions (N, E, S, W)
  const directions = [
    { dx: 0, dy: -1 },  // North
    { dx: 1, dy: 0 },   // East
    { dx: 0, dy: 1 },   // South
    { dx: -1, dy: 0 }   // West
  ];
  
  // Step 1: Find all wall tiles and identify edge tiles
  // An edge tile is a wall that has at least one non-wall neighbor
  const wallTiles = [];
  const edgeTiles = [];
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWall(x, y)) continue;
      
      wallTiles.push({ x, y });
      
      // Check if this is an edge tile (has non-wall neighbor)
      let isEdge = false;
      for (const { dx, dy } of directions) {
        if (!isWall(x + dx, y + dy)) {
          isEdge = true;
          break;
        }
      }
      
      if (isEdge) {
        edgeTiles.push({ x, y });
      }
    }
  }
  
  // Step 2: Multi-source BFS from all edge tiles
  // This computes the distance to nearest edge for every wall tile
  const distance = new Map();
  const queue = [];
  
  // Initialize: all edge tiles have distance 0
  for (const { x, y } of edgeTiles) {
    const key = `${x}_${y}`;
    distance.set(key, 0);
    queue.push({ x, y, dist: 0 });
  }
  
  // BFS to compute distances
  let head = 0;
  while (head < queue.length) {
    const { x, y, dist } = queue[head++];
    
    for (const { dx, dy } of directions) {
      const nx = x + dx;
      const ny = y + dy;
      const nkey = `${nx}_${ny}`;
      
      // Skip if not a wall or already visited
      if (!isWall(nx, ny)) continue;
      if (distance.has(nkey)) continue;
      
      distance.set(nkey, dist + 1);
      queue.push({ x: nx, y: ny, dist: dist + 1 });
    }
  }
  
  // Step 3: Convert distance to height level
  // height = baseHeight + distance, clamped to [minHeight, maxHeight]
  for (const { x, y } of wallTiles) {
    const key = `${x}_${y}`;
    const dist = distance.get(key) || 0;
    const heightLevel = Math.min(maxHeight, Math.max(minHeight, baseHeight + dist));
    heightMap.set(key, heightLevel);
  }
  
  return heightMap;
}

/**
 * Detect contiguous regions of solid terrain (TILE + WALL) using flood fill
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @returns {Array<Set<string>>} Array of regions, each region is a Set of "x_y" tile keys
 */
function detectSolidTerrainRegions(terrain) {
  const mapHeight = terrain.length;
  const mapWidth = terrain[0]?.length || 0;
  const visited = new Set();
  const regions = [];
  
  // Check if a tile is solid terrain (TILE or WALL)
  const isSolidTerrain = (x, y) => {
    if (y < 0 || y >= mapHeight || x < 0 || x >= mapWidth) return false;
    const tileType = terrain[y][x];
    return tileType === TILE_TYPES.TILE || tileType === TILE_TYPES.WALL;
  };
  
  // Flood fill from a starting position
  const floodFill = (startX, startY) => {
    const region = new Set();
    const queue = [{ x: startX, y: startY }];
    
    while (queue.length > 0) {
      const { x, y } = queue.shift();
      const key = `${x}_${y}`;
      
      if (visited.has(key)) continue;
      if (!isSolidTerrain(x, y)) continue;
      
      visited.add(key);
      region.add(key);
      
      // Check orthogonal neighbors (no diagonals)
      queue.push({ x: x + 1, y: y }); // right
      queue.push({ x: x - 1, y: y }); // left
      queue.push({ x: x, y: y + 1 }); // down
      queue.push({ x: x, y: y - 1 }); // up
    }
    
    return region;
  };
  
  // Scan all tiles and detect regions
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const key = `${x}_${y}`;
      if (!visited.has(key) && isSolidTerrain(x, y)) {
        const region = floodFill(x, y);
        if (region.size > 0) {
          regions.push(region);
        }
      }
    }
  }
  
  return regions;
}

/**
 * Create 1x1 ground tiles for each tile in the region
 * All tiles same size = no visible scale differences
 * @param {Set<string>} region - Set of "x_y" tile keys
 * @returns {Array<Object>} Array of 1x1 squares
 */
function findRegionRectangles(region) {
  if (region.size === 0) return [];
  
  const squares = [];
  
  // Create one 1x1 ground piece per tile
  region.forEach(key => {
    const [x, y] = key.split('_').map(Number);
    
    squares.push({
      minX: x,
      maxX: x,
      minY: y,
      maxY: y,
      width: 1,
      height: 1,
      centerX: x,
      centerZ: y
    });
  });
  
  return squares;
}

/**
 * Build continuous ground terrain underneath the map using textured planes
 * Creates multiple ground pieces that follow the actual terrain shape (avoids water/empty)
 * Uses rocky terrain textures for better performance than GLB models
 * @param {Scene} scene - Babylon.js scene
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 * @param {Mesh} mapContainer - Parent container for ground meshes
 * @returns {Object} Ground building result with meshes
 */
export function buildGroundTerrain(scene, terrain, mapWidth, mapHeight, mapContainer) {
  const tileSize = 1;
  const groundMeshes = [];
  const groundY = -0.02; // Slightly below gameplay tiles
  
  // Detect contiguous regions of solid terrain
  const regions = detectSolidTerrainRegions(terrain);
  
  console.log(`Ground terrain: detected ${regions.length} solid terrain region(s)`);
  
  if (regions.length === 0) {
    return {
      groundMeshes: [],
      regionCount: 0,
      loadPromise: Promise.resolve()
    };
  }
  
  // Find all rectangles needed (across all regions)
  const allRectangles = [];
  regions.forEach((region, regionIndex) => {
    const rectangles = findRegionRectangles(region);
    rectangles.forEach(rect => {
      rect.regionIndex = regionIndex;
      allRectangles.push(rect);
    });
    console.log(`Region ${regionIndex}: ${region.size} tiles -> ${rectangles.length} rectangles`);
  });
  
  console.log(`Ground terrain: total ${allRectangles.length} ground rectangles to create`);
  
  if (allRectangles.length === 0) {
    return {
      groundMeshes: [],
      regionCount: regions.length,
      loadPromise: Promise.resolve()
    };
  }
  
  // Create GPU-based anti-tiling shader for ground (SHARED by all ground planes)
  const groundMaterial = new ShaderMaterial('groundAntiTile', scene, {
    vertexSource: `
      precision highp float;
      
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      
      uniform mat4 world;
      uniform mat4 viewProjection;
      
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      
      void main() {
        vec4 worldPos = world * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize((world * vec4(normal, 0.0)).xyz);
        vUV = uv;
        gl_Position = viewProjection * worldPos;
      }
    `,
    fragmentSource: `
      precision highp float;
      
      uniform sampler2D diffuseTexture;
      uniform float tileSize;
      uniform float textureScale;
      
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec2 vUV;
      
      // Hash function for pseudo-random values
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      
      // 2D noise function for organic blending
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      
      // Fractal noise for more organic patterns
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 3; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }
      
      // Get random rotation (0, 90, 180, or 270 degrees)
      float getRotation(vec2 tileId) {
        return floor(hash(tileId) * 4.0) * 1.5708;
      }
      
      // Rotate UV coordinates
      vec2 rotateUV(vec2 uv, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        vec2 center = vec2(0.5);
        uv -= center;
        uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        uv += center;
        return uv;
      }
      
      // Sample texture for a specific tile
      vec3 sampleTile(vec2 tileId, vec2 localUV) {
        float rotation = getRotation(tileId);
        vec2 offset = vec2(hash(tileId + 0.5), hash(tileId + 1.5)) * 0.5;
        vec2 rotatedUV = rotateUV(localUV, rotation);
        vec2 finalUV = (rotatedUV + offset) * textureScale;
        return texture2D(diffuseTexture, finalUV).rgb;
      }
      
      void main() {
        // Calculate which virtual tile this pixel is in
        vec2 worldUV = vWorldPos.xz / tileSize;
        vec2 tileId = floor(worldUV);
        vec2 tileUV = fract(worldUV);
        
        // Blend zone size
        float blendZone = 0.35;
        
        // Add noise to create organic, irregular blend boundaries
        float noiseScale = 8.0;
        float noiseValue = fbm(vWorldPos.xz * noiseScale / tileSize) * 0.3;
        
        // Calculate distance to nearest edge
        float distToEdgeX = min(tileUV.x, 1.0 - tileUV.x);
        float distToEdgeY = min(tileUV.y, 1.0 - tileUV.y);
        
        // Determine neighbor directions
        float dirX = tileUV.x < 0.5 ? -1.0 : 1.0;
        float dirY = tileUV.y < 0.5 ? -1.0 : 1.0;
        
        vec2 neighborX = tileId + vec2(dirX, 0.0);
        vec2 neighborY = tileId + vec2(0.0, dirY);
        vec2 neighborXY = tileId + vec2(dirX, dirY);
        
        // Calculate blend weights with noise for organic edges
        float weightX = smoothstep(0.0, blendZone, distToEdgeX + noiseValue);
        float weightY = smoothstep(0.0, blendZone, distToEdgeY + noiseValue);
        
        // Sample all tiles
        vec3 colorMain = sampleTile(tileId, tileUV);
        vec3 colorX = sampleTile(neighborX, tileUV);
        vec3 colorY = sampleTile(neighborY, tileUV);
        vec3 colorXY = sampleTile(neighborXY, tileUV);
        
        // Bilinear blend with noise-modulated weights
        vec3 blendX = mix(colorX, colorMain, weightX);
        vec3 blendXY = mix(colorXY, colorY, weightX);
        vec3 finalColor = mix(blendXY, blendX, weightY);
        
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float NdotL = max(dot(vNormal, lightDir), 0.0);
        float ambient = 0.4;
        float light = ambient + NdotL * 0.6;
        
        gl_FragColor = vec4(finalColor * light, 1.0);
      }
    `
  }, {
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['world', 'viewProjection', 'diffuseTexture', 'tileSize', 'textureScale']
  });
  
  // Load textures
  const texturePath = '/assets/decor/';
  const diffuseTex = new Texture(texturePath + 'rocky_terrain_03_diff_1k.jpg', scene);
  
  groundMaterial.setTexture('diffuseTexture', diffuseTex);
  groundMaterial.setFloat('tileSize', 6.0); // Virtual tile size for ground
  groundMaterial.setFloat('textureScale', 0.8);
  
  // Create a ground plane for each rectangle, all sharing the same shader material
  allRectangles.forEach((rect, index) => {
    const requiredWidth = rect.width * tileSize;
    const requiredDepth = rect.height * tileSize;
    
    // Create ground plane
    const groundPlane = MeshBuilder.CreateGround(`ground_r${rect.regionIndex}_${index}`, {
      width: requiredWidth,
      height: requiredDepth,
      subdivisions: 1
    }, scene);
    
    // Position at rectangle center
    groundPlane.position = new Vector3(rect.centerX, groundY, rect.centerZ);
    
    // Use shared shader material
    groundPlane.material = groundMaterial;
    groundPlane.isPickable = false;
    groundPlane.receiveShadows = true;
    
    groundMeshes.push(groundPlane);
  });
  
  console.log(`Ground terrain: created ${groundMeshes.length} planes with shared GPU anti-tiling shader`);
  
  return {
    groundMeshes,
    regionCount: regions.length,
    loadPromise: Promise.resolve()
  };
}

/**
 * Builds a 3D representation of the map terrain
 * @param {Scene} scene - Babylon.js scene
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} mapWidth - Width of the map
 * @param {number} mapHeight - Height of the map
 * @param {Object} startZones - Starting positions for teams A and B
 * @param {string} playerTeam - Player's team ('A' or 'B')
 * @param {string} enemyTeam - Enemy team ('A' or 'B')
 * @param {string} userId - Current user's ID
 * @param {Object} gameState - Current game state
 * @returns {Object} Map building result with tiles and materials
 */
export function build3DMap(scene, terrain, mapWidth, mapHeight, startZones, playerTeam, enemyTeam, userId, gameState) {
  const tileSize = 1; // Size of each tile in 3D units
  const tileHeight = 0.02; // Minimal height for walkable tiles
  
  // Wall height based on neighbor count (simpler, works better for thin walls)
  // Counts ALL 8 neighbors (cardinal + diagonal) to detect connectedness
  const wallHeightConfig = {
    minWorldHeight: 0.8,   // Isolated wall (0 neighbors)
    maxWorldHeight: 4.0,   // Fully surrounded wall (8 neighbors)
    noiseAmount: 0.3       // Random variation per wall
  };
  
  const isWallTile = (x, y) => {
    if (y < 0 || y >= terrain.length || x < 0 || x >= (terrain[0]?.length || 0)) return false;
    return terrain[y][x] === TILE_TYPES.WALL;
  };
  
  // Count all 8 neighbors (including diagonals)
  const countWallNeighbors = (x, y) => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (isWallTile(x + dx, y + dy)) count++;
      }
    }
    return count;
  };
  
  // Pre-compute neighbor counts for all walls
  const wallNeighborCounts = new Map();
  for (let y = 0; y < terrain.length; y++) {
    for (let x = 0; x < (terrain[0]?.length || 0); x++) {
      if (terrain[y][x] === TILE_TYPES.WALL) {
        wallNeighborCounts.set(`${x}_${y}`, countWallNeighbors(x, y));
      }
    }
  }
  
  // Deterministic noise for variation
  const wallNoise = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + 31337) * 43758.5453;
    return (n - Math.floor(n)) - 0.5; // -0.5 to 0.5
  };
  
  // Get wall height based on neighbor count (0-8)
  const getWallHeight = (x, y) => {
    const neighbors = wallNeighborCounts.get(`${x}_${y}`) || 0;
    const { minWorldHeight, maxWorldHeight, noiseAmount } = wallHeightConfig;
    // Map 0-8 neighbors to height range
    const t = neighbors / 8;
    const baseHeight = minWorldHeight + t * (maxWorldHeight - minWorldHeight);
    return baseHeight + wallNoise(x, y) * noiseAmount;
  };

  // Create a set of starting positions for quick lookup
  const playerStartPositions = new Set();
  const enemyStartPositions = new Set();
  
  if (startZones) {
    // Player team starting positions
    if (startZones[playerTeam]) {
      startZones[playerTeam].forEach(pos => {
        playerStartPositions.add(`${pos.x}_${pos.y}`);
      });
    }
    // Enemy team starting positions
    if (startZones[enemyTeam]) {
      startZones[enemyTeam].forEach(pos => {
        enemyStartPositions.add(`${pos.x}_${pos.y}`);
      });
    }
  }

  // Base tile material - fully transparent with wireframe outline
  const createTileMaterial = (color, scene) => {
    const material = new StandardMaterial('tileMaterial', scene);
    material.diffuseColor = new Color3(0, 0, 0); // Black (invisible when alpha is 0)
    material.alpha = 0; // Fully transparent
    material.wireframe = true; // Show outline only
    material.emissiveColor = color.scale(0.5); // Outline color based on tile color
    material.disableLighting = true; // Ensure outline is always visible
    return material;
  };

  // Starting position materials - filled tiles visible during preparation phase
  const playerStartMaterial = new StandardMaterial('playerStartMaterial', scene);
  playerStartMaterial.diffuseColor = new Color3(0.2, 0.4, 1.0); // Blue
  playerStartMaterial.emissiveColor = new Color3(0.2, 0.4, 0.8); // Blue glow
  playerStartMaterial.alpha = 0.5; // Semi-transparent fill
  playerStartMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;

  const enemyStartMaterial = new StandardMaterial('enemyStartMaterial', scene);
  enemyStartMaterial.diffuseColor = new Color3(1.0, 0.2, 0.2); // Red
  enemyStartMaterial.emissiveColor = new Color3(0.8, 0.2, 0.2); // Red glow
  enemyStartMaterial.alpha = 0.5; // Semi-transparent fill
  enemyStartMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  
  // Neutral tile material - used to reset starting tiles after preparation phase
  // This is a simple transparent material without the colored wireframe
  const neutralTileMaterial = new StandardMaterial('neutralTileMaterial', scene);
  neutralTileMaterial.diffuseColor = new Color3(0, 0, 0);
  neutralTileMaterial.alpha = 0;
  neutralTileMaterial.wireframe = true;
  neutralTileMaterial.emissiveColor = new Color3(0.3, 0.3, 0.3); // Neutral gray outline
  neutralTileMaterial.disableLighting = true;

  // Wall materials - two texture variants for variety
  const wallMaterialOptions = {
    worldTilingScale: 0.8,           // Good scale for wall-sized blocks
    normalStrength: 0.7,             // Strong detail for stone texture
    tint: new Color3(0.75, 0.78, 0.72), // Slight green/moss tint
    warpScale: 0.08,                 // Reduced warp frequency
    warpStrength: 0.1,               // Subtle distortion
    macroStrengthColor: 0.03,        // Very subtle color variation
    macroStrengthRoughness: 0.02     // Minimal roughness variation
  };
  
  // Create both wall materials for texture variety
  const wallMaterial1 = createWallMaterial(scene, {
    ...wallMaterialOptions,
    textureSet: 'mossy_stone_wall'
  });
  
  const wallMaterial2 = createWallMaterial(scene, {
    ...wallMaterialOptions,
    textureSet: 'mossy_rock'
  });
  
  const wallMaterials = [wallMaterial1, wallMaterial2];
  
  // Detect connected wall regions and assign one material per region
  // This ensures touching walls have the same texture
  const wallTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      if (terrain[y][x] === TILE_TYPES.WALL) {
        wallTiles.push({ x, y });
      }
    }
  }
  
  // Flood fill to find connected wall regions
  const wallVisited = new Set();
  const wallRegions = [];
  
  const getWallNeighbors = (x, y) => {
    return [
      { x: x - 1, y: y }, // left
      { x: x + 1, y: y }, // right
      { x: x, y: y - 1 }, // top
      { x: x, y: y + 1 }  // bottom
    ].filter(n => 
      n.x >= 0 && n.x < mapWidth && 
      n.y >= 0 && n.y < mapHeight &&
      terrain[n.y][n.x] === TILE_TYPES.WALL
    );
  };
  
  wallTiles.forEach(tile => {
    const key = `${tile.x}_${tile.y}`;
    if (wallVisited.has(key)) return;
    
    const region = [];
    const queue = [tile];
    wallVisited.add(key);
    
    while (queue.length > 0) {
      const current = queue.shift();
      region.push(current);
      
      getWallNeighbors(current.x, current.y).forEach(neighbor => {
        const neighborKey = `${neighbor.x}_${neighbor.y}`;
        if (!wallVisited.has(neighborKey)) {
          wallVisited.add(neighborKey);
          queue.push(neighbor);
        }
      });
    }
    
    if (region.length > 0) {
      wallRegions.push(region);
    }
  });
  
  // Assign one material per region (deterministic based on region index)
  const wallMaterialMap = new Map(); // "x_y" -> materialIndex
  wallRegions.forEach((region, regionIndex) => {
    const materialIndex = regionIndex % 2; // Alternate between materials per region
    region.forEach(tile => {
      wallMaterialMap.set(`${tile.x}_${tile.y}`, materialIndex);
    });
  });
  
  console.log(`Detected ${wallRegions.length} connected wall region(s)`);
  
  // Collect wall data for crumbles generation
  const wallDataForCrumbles = [];
  
  // Collect water tile data for rock debris generation
  const waterTileDataForRocks = [];

  // Empty material - invisible (no ground underneath empty tiles)
  const emptyMaterial = new StandardMaterial('emptyMaterial', scene);
  emptyMaterial.diffuseColor = new Color3(0, 0, 0);
  emptyMaterial.alpha = 0; // Fully invisible

  // Brown ground/earth material for water channel base
  const waterGroundMaterial = new StandardMaterial('waterGroundMaterial', scene);
  waterGroundMaterial.diffuseColor = new Color3(0.42, 0.31, 0.24); // Brown earth color (#6b4e3d)
  waterGroundMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
  
  // Dirt/earth wall material for water channel sides
  const waterWallMaterial = new StandardMaterial('waterWallMaterial', scene);
  waterWallMaterial.diffuseColor = new Color3(0.35, 0.24, 0.18); // Darker brown (#5a3e2d)
  waterWallMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
  
  // Analyze water regions first to determine flow directions
  // Build a map of water tile positions
  const waterTiles = [];
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      if (terrain[y][x] === TILE_TYPES.WATER) {
        waterTiles.push({ x, y });
      }
    }
  }
  
  // Find connected water regions using flood fill
  const visited = new Set();
  const waterRegions = [];
  
  const getWaterNeighbors = (x, y) => {
    return [
      { x: x - 1, y: y }, // left
      { x: x + 1, y: y }, // right
      { x: x, y: y - 1 }, // top
      { x: x, y: y + 1 }  // bottom
    ].filter(n => 
      n.x >= 0 && n.x < mapWidth && 
      n.y >= 0 && n.y < mapHeight &&
      terrain[n.y][n.x] === TILE_TYPES.WATER
    );
  };
  
  // Flood fill to find connected regions
  waterTiles.forEach(tile => {
    const key = `${tile.x}_${tile.y}`;
    if (visited.has(key)) return;
    
    const region = [];
    const queue = [tile];
    visited.add(key);
    
    while (queue.length > 0) {
      const current = queue.shift();
      region.push(current);
      
      getWaterNeighbors(current.x, current.y).forEach(neighbor => {
        const neighborKey = `${neighbor.x}_${neighbor.y}`;
        if (!visited.has(neighborKey)) {
          visited.add(neighborKey);
          queue.push(neighbor);
        }
      });
    }
    
    if (region.length > 0) {
      waterRegions.push(region);
    }
  });
  
  // Determine flow direction for each region based on dominant axis
  const tileFlowDirections = new Map(); // "x_y" -> { uSpeed, vSpeed }
  const baseScrollSpeed = 0.05; // Base scroll speed for water animation
  
  waterRegions.forEach(region => {
    // Calculate region bounds
    const xs = region.map(t => t.x);
    const ys = region.map(t => t.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    
    // Count connections to determine dominant axis
    let horizontalConnections = 0; // left-right
    let verticalConnections = 0;   // up-down
    
    region.forEach(tile => {
      const neighbors = getWaterNeighbors(tile.x, tile.y);
      neighbors.forEach(n => {
        if (n.x !== tile.x) horizontalConnections++;
        if (n.y !== tile.y) verticalConnections++;
      });
    });
    
    // Determine dominant axis: if wider than tall, flow horizontally; otherwise vertically
    // Also consider connection counts as a tiebreaker
    const isHorizontal = width > height || (width === height && horizontalConnections >= verticalConnections);
    
    // Set flow direction: horizontal regions flow along X (U axis), vertical regions flow along Y (V axis)
    let uSpeed, vSpeed;
    
    if (isHorizontal) {
      // Flow horizontally (along the channel) - scroll U axis primarily
      uSpeed = baseScrollSpeed;
      vSpeed = baseScrollSpeed * 0.2; // Minimal perpendicular drift
    } else {
      // Flow vertically (along the channel) - scroll V axis primarily
      uSpeed = baseScrollSpeed * 0.2; // Minimal perpendicular drift
      vSpeed = baseScrollSpeed;
    }
    
    // Store flow direction for all tiles in this region
    region.forEach(tile => {
      const key = `${tile.x}_${tile.y}`;
      tileFlowDirections.set(key, { uSpeed, vSpeed });
    });
  });
  
  // Create base water texture (shared)
  const waterSurfaceTexture = new Texture('/assets/watertexture.png', scene);
  waterSurfaceTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  waterSurfaceTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  waterSurfaceTexture.uScale = 1.0;
  waterSurfaceTexture.vScale = 1.0;
  
  // Create materials and textures per region for independent flow directions
  // Group regions by flow direction to minimize material/texture count
  const flowDirectionGroups = new Map(); // "uSpeed_vSpeed" -> { uSpeed, vSpeed, texture, material, tiles: [] }
  
  waterRegions.forEach((region, regionIndex) => {
    // Get flow direction for this region (all tiles in region have same flow)
    const firstTile = region[0];
    const tileKey = `${firstTile.x}_${firstTile.y}`;
    const flow = tileFlowDirections.get(tileKey) || { uSpeed: baseScrollSpeed, vSpeed: baseScrollSpeed * 0.3 };
    const flowKey = `${flow.uSpeed.toFixed(4)}_${flow.vSpeed.toFixed(4)}`;
    
    if (!flowDirectionGroups.has(flowKey)) {
      // Create new texture and material for this flow direction
      const regionTexture = new Texture('/assets/watertexture.png', scene);
      regionTexture.wrapU = Texture.WRAP_ADDRESSMODE;
      regionTexture.wrapV = Texture.WRAP_ADDRESSMODE;
      regionTexture.uScale = 1.0;
      regionTexture.vScale = 1.0;
      
      const regionMaterial = new StandardMaterial(`waterMaterial_${flowKey}`, scene);
      regionMaterial.diffuseTexture = regionTexture;
      regionMaterial.diffuseColor = new Color3(1.0, 1.0, 1.0);
      regionMaterial.emissiveColor = new Color3(0.15, 0.25, 0.4);
      regionMaterial.alpha = 0.5;
      regionMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      
      flowDirectionGroups.set(flowKey, {
        uSpeed: flow.uSpeed,
        vSpeed: flow.vSpeed,
        texture: regionTexture,
        material: regionMaterial,
        tiles: []
      });
    }
    
    // Add all tiles from this region to the flow group
    region.forEach(tile => {
      flowDirectionGroups.get(flowKey).tiles.push(tile);
    });
  });
  
  // Soft, performance-aware water animation with per-region flow direction
  let animationStartTime = Date.now();
  
  const waterScrollObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = (Date.now() - animationStartTime) / 1000;
    
    // Update texture offsets for each flow direction group
    flowDirectionGroups.forEach((group, flowKey) => {
      const uOffset = (elapsed * group.uSpeed) % 1.0;
      const vOffset = (elapsed * group.vSpeed) % 1.0;
      
      group.texture.uOffset = uOffset;
      group.texture.vOffset = vOffset;
    });
  });
  
  const waterAnimationData = {
    observer: waterScrollObserver,
    flowDirectionGroups: flowDirectionGroups,
    tileFlowDirections: tileFlowDirections,
    // Cleanup function to dispose water animation resources
    dispose: () => {
      // Remove the observer
      if (waterScrollObserver) {
        scene.onBeforeRenderObservable.remove(waterScrollObserver);
      }
      // Dispose textures and materials
      flowDirectionGroups.forEach((group, flowKey) => {
        if (group.texture && !group.texture.isDisposed) {
          group.texture.dispose();
        }
        if (group.material && !group.material.isDisposed) {
          group.material.dispose();
        }
      });
      flowDirectionGroups.clear();
    }
  };
  
  // Array to store all water meshes
  const waterMeshes = [];

  // Create a parent mesh to hold all tiles
  const mapContainer = MeshBuilder.CreateBox('mapContainer', { size: 0.01 }, scene);
  mapContainer.isVisible = false;

  // Build continuous ground terrain underneath the gameplay tiles
  // This creates merged ground meshes for contiguous regions of solid terrain (TILE + WALL)
  const groundResult = buildGroundTerrain(scene, terrain, mapWidth, mapHeight, mapContainer);

  // Map to store starting position tiles for interaction (player team only)
  const startPositionTiles = new Map();
  // Array to store all starting position tiles (player + enemy) for visibility control
  const allStartPositionTiles = [];
  // Map to store all tiles for movement range highlighting: "x_y" -> mesh
  const allTiles = new Map();

  // Build tiles
  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const tileType = terrain[y][x];
      const xPos = x * tileSize;
      const zPos = y * tileSize;
      const tileKey = `${x}_${y}`;
      const isPlayerStart = playerStartPositions.has(tileKey);
      const isEnemyStart = enemyStartPositions.has(tileKey);

      if (tileType === TILE_TYPES.NONE) {
        // Create a very low ground plane for empty spaces
        const emptyTile = MeshBuilder.CreateBox('emptyTile', {
          width: tileSize,
          height: 0.01,
          depth: tileSize
        }, scene);
        emptyTile.position = new Vector3(xPos, -0.05, zPos);
        emptyTile.material = emptyMaterial;
        emptyTile.parent = mapContainer;
      } else if (tileType === TILE_TYPES.TILE) {
        // Determine tile color based on checkerboard pattern
        const isLight = (x + y) % 2 === 0;
        const baseColor = isLight 
          ? new Color3(0.83, 0.65, 0.45) // Light beige
          : new Color3(0.72, 0.58, 0.42); // Dark beige

        // Create transparent tile
        const tile = MeshBuilder.CreateBox('tile', {
          width: tileSize,
          height: tileHeight,
          depth: tileSize
        }, scene);
        tile.position = new Vector3(xPos, tileHeight / 2, zPos);
        
        // Use starting position material if applicable, otherwise use transparent tile
        if (isPlayerStart) {
          tile.material = playerStartMaterial;
          // Make tile pickable and enable pointer events
          tile.isPickable = true;
          tile.enablePointerMoveEvents = true;
          // Store tile reference for interaction
          startPositionTiles.set(tile.uniqueId, {
            mesh: tile,
            x: x,
            y: y,
            isPlayerStart: true
          });
          // Also store by name for easier lookup
          tile.name = `startTile_${x}_${y}`;
          // Store tile coordinates in userData for material switching
          if (!tile.userData) {
            tile.userData = {};
          }
          tile.userData.tileX = x;
          tile.userData.tileY = y;
          tile.userData.isPlayerStart = true;
          // Add to all start tiles array for visibility control
          allStartPositionTiles.push(tile);
        } else if (isEnemyStart) {
          tile.material = enemyStartMaterial;
          tile.isPickable = false; // Enemy tiles not interactive
          // Store tile coordinates in userData for material switching
          if (!tile.userData) {
            tile.userData = {};
          }
          tile.userData.tileX = x;
          tile.userData.tileY = y;
          tile.userData.isPlayerStart = false;
          // Add to all start tiles array for visibility control
          allStartPositionTiles.push(tile);
        } else {
          tile.material = createTileMaterial(baseColor, scene);
          tile.isPickable = true; // Make tiles pickable for movement during game phase
        }
        tile.parent = mapContainer;
        
        // Store all walkable tiles for movement range highlighting
        const tileKey = `${x}_${y}`;
        allTiles.set(tileKey, tile);
        
        // Store tile coordinates in userData
        if (!tile.userData) {
          tile.userData = {};
        }
        tile.userData.tileX = x;
        tile.userData.tileY = y;
      } else if (tileType === TILE_TYPES.WALL) {
        // Create wall with smooth height variation
        // Adjacent walls have similar heights, larger sections vary gradually
        const wallHeight = getWallHeight(x, y);
        
        // Get material from region-based assignment (connected walls share material)
        const materialIndex = wallMaterialMap.get(`${x}_${y}`) || 0;
        const wallMat = wallMaterials[materialIndex];
        
        // Corner rounding parameters
        const cornerRadius = 0.15; // Larger radius for visibility
        const randomCornerChance = 0.25; // 25% chance for non-structural corners
        
        // Deterministic random for this wall's corners
        const wallCornerSeed = x * 1000 + y * 31337;
        const cornerRandom = (offset) => {
          const n = Math.sin(wallCornerSeed + offset * 127.1) * 43758.5453;
          return n - Math.floor(n);
        };
        
        // Check neighbors (4-directional and diagonals)
        // Safe access with optional chaining
        const hasWallN = y > 0 && terrain[y - 1][x] === TILE_TYPES.WALL;
        const hasWallS = y < mapHeight - 1 && terrain[y + 1][x] === TILE_TYPES.WALL;
        const hasWallE = x < mapWidth - 1 && terrain[y][x + 1] === TILE_TYPES.WALL;
        const hasWallW = x > 0 && terrain[y][x - 1] === TILE_TYPES.WALL;
        const hasWallNW = y > 0 && x > 0 && terrain[y - 1][x - 1] === TILE_TYPES.WALL;
        const hasWallNE = y > 0 && x < mapWidth - 1 && terrain[y - 1][x + 1] === TILE_TYPES.WALL;
        const hasWallSW = y < mapHeight - 1 && x > 0 && terrain[y + 1][x - 1] === TILE_TYPES.WALL;
        const hasWallSE = y < mapHeight - 1 && x < mapWidth - 1 && terrain[y + 1][x + 1] === TILE_TYPES.WALL;
        
        // Create main wall box
        const wall = MeshBuilder.CreateBox('wall', {
          width: tileSize,
          height: wallHeight,
          depth: tileSize
        }, scene);
        wall.position = new Vector3(xPos, wallHeight / 2 - 0.05, zPos);
        wall.material = wallMat;
        wall.parent = mapContainer;
        
        // Corner cylinder logic:
        // A corner gets a cylinder only if BOTH adjacent sides are free of walls
        // This prevents cylinders from appearing where two walls connect
        // dx/dz are direction multipliers (-1 or 1) for positioning at wall edges
        const corners = [
          { 
            dx: -1, dz: -1, // NW corner
            // Only add cylinder if no wall to West AND no wall to North
            isExposed: !hasWallW && !hasWallN,
            randomSeed: 0
          },
          { 
            dx: 1, dz: -1, // NE corner
            // Only add cylinder if no wall to East AND no wall to North
            isExposed: !hasWallE && !hasWallN,
            randomSeed: 1
          },
          { 
            dx: -1, dz: 1, // SW corner
            // Only add cylinder if no wall to West AND no wall to South
            isExposed: !hasWallW && !hasWallS,
            randomSeed: 2
          },
          { 
            dx: 1, dz: 1, // SE corner
            // Only add cylinder if no wall to East AND no wall to South
            isExposed: !hasWallE && !hasWallS,
            randomSeed: 3
          }
        ];
        
        corners.forEach((corner, idx) => {
          // Add cylinder only if corner is fully exposed (no walls on either adjacent side)
          // Random chance to skip some exposed corners for variety
          const shouldAdd = corner.isExposed && (cornerRandom(corner.randomSeed) < (1 - randomCornerChance * 0.5));
          
          if (shouldAdd) {
            // Random offset for unique positioning - pull cylinders closer to wall structure
            const offsetInward = 0.12 + cornerRandom(corner.randomSeed + 10) * 0.06; // 0.12-0.18 inward
            const randomJitterX = (cornerRandom(corner.randomSeed + 20) - 0.5) * 0.04; // +/- 0.02
            const randomJitterZ = (cornerRandom(corner.randomSeed + 30) - 0.5) * 0.04;
            const randomRadiusVar = 0.9 + cornerRandom(corner.randomSeed + 40) * 0.2; // 0.9-1.1 scale
            
            const cylinderDiameter = cornerRadius * 2.5 * randomRadiusVar;
            
            const cylinder = MeshBuilder.CreateCylinder(`wallCorner_${x}_${y}_${idx}`, {
              diameter: cylinderDiameter,
              height: wallHeight + 0.02, // Slightly taller than wall
              tessellation: 12
            }, scene);
            
            // Position at corner of the wall (dx/dz are -1 or 1, so multiply by half tile size)
            // offsetInward pulls the cylinder slightly inside the wall corner
            const posX = xPos + corner.dx * (tileSize * 0.5 - offsetInward) + randomJitterX;
            const posZ = zPos + corner.dz * (tileSize * 0.5 - offsetInward) + randomJitterZ;
            
            cylinder.position = new Vector3(posX, wallHeight / 2 - 0.04, posZ);
            cylinder.material = wallMat;
            cylinder.parent = mapContainer;
            cylinder.isPickable = false;
          }
        });
        
        // Collect wall data for crumbles generation
        wallDataForCrumbles.push({ x, y, height: wallHeight, materialIndex });
      } else if (tileType === TILE_TYPES.WATER) {
        // Water channel - flush with ground level at -0.15
        const waterSurfaceY = -0.02; // Flush with ground level
        const channelDepth = 0.5; // Depth below water surface
        const groundHeight = 0.01; // Height of ground layer at bottom
        const wallThickness = 0.02; // Thickness of side walls
        
        // 1. Create brown ground/earth layer at the bottom of the channel
        const ground = MeshBuilder.CreateBox('waterGround', {
          width: tileSize,
          height: groundHeight,
          depth: tileSize
        }, scene);
        ground.position = new Vector3(xPos, waterSurfaceY - channelDepth + groundHeight / 2, zPos);
        ground.material = waterGroundMaterial;
        ground.parent = mapContainer;
        
        // Collect water tile data for rock debris generation
        waterTileDataForRocks.push({ x, y, worldX: xPos, worldZ: zPos });
        
        // 2. Create conditional side walls based on neighbors
        const mapHeight = terrain.length;
        const mapWidth = terrain[0]?.length || 0;
        
        // Check each edge: top, right, bottom, left
        const neighbors = [
          { x: x, y: y - 1, dir: 'top', normal: new Vector3(0, 0, -1) },    // Top (negative Z)
          { x: x + 1, y: y, dir: 'right', normal: new Vector3(1, 0, 0) },  // Right (positive X)
          { x: x, y: y + 1, dir: 'bottom', normal: new Vector3(0, 0, 1) }, // Bottom (positive Z)
          { x: x - 1, y: y, dir: 'left', normal: new Vector3(-1, 0, 0) }    // Left (negative X)
        ];
        
        neighbors.forEach(neighbor => {
          const isWater = neighbor.y >= 0 && neighbor.y < mapHeight &&
                          neighbor.x >= 0 && neighbor.x < mapWidth &&
                          terrain[neighbor.y][neighbor.x] === TILE_TYPES.WATER;
          
          // Only create wall if neighbor is NOT water
          if (!isWater) {
            let wall;
            let wallPosition;
            
            // Wall center Y position (from water surface down to channel bottom)
            const wallCenterY = waterSurfaceY - channelDepth / 2;
            
            if (neighbor.dir === 'top') {
              // Wall on top edge (facing negative Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_top`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, wallCenterY, zPos - tileSize / 2 + wallThickness / 2);
            } else if (neighbor.dir === 'right') {
              // Wall on right edge (facing positive X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_right`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos + tileSize / 2 - wallThickness / 2, wallCenterY, zPos);
            } else if (neighbor.dir === 'bottom') {
              // Wall on bottom edge (facing positive Z)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_bottom`, {
                width: tileSize,
                height: channelDepth,
                depth: wallThickness
              }, scene);
              wallPosition = new Vector3(xPos, wallCenterY, zPos + tileSize / 2 - wallThickness / 2);
            } else if (neighbor.dir === 'left') {
              // Wall on left edge (facing negative X)
              wall = MeshBuilder.CreateBox(`waterWall_${x}_${y}_left`, {
                width: wallThickness,
                height: channelDepth,
                depth: tileSize
              }, scene);
              wallPosition = new Vector3(xPos - tileSize / 2 + wallThickness / 2, wallCenterY, zPos);
            }
            
            if (wall) {
              wall.position = wallPosition;
              wall.material = waterWallMaterial;
              wall.parent = mapContainer;
            }
          }
        });
        
        // 3. Create simple water surface plane with region-specific material
        const waterSurface = MeshBuilder.CreatePlane('waterSurface', {
          width: tileSize,
          height: tileSize
        }, scene);
        waterSurface.position = new Vector3(xPos, waterSurfaceY, zPos);
        waterSurface.rotation.x = Math.PI / 2; // Rotate to horizontal
        
        // Get flow direction for this tile and use corresponding material
        const tileKey = `${x}_${y}`;
        const flow = tileFlowDirections.get(tileKey);
        let materialToUse = null;
        
        if (flow) {
          // Find the material group for this flow direction
          const flowKey = `${flow.uSpeed.toFixed(4)}_${flow.vSpeed.toFixed(4)}`;
          const group = flowDirectionGroups.get(flowKey);
          if (group) {
            materialToUse = group.material;
          }
        }
        
        // Fallback to first available material if not found
        if (!materialToUse && flowDirectionGroups.size > 0) {
          materialToUse = Array.from(flowDirectionGroups.values())[0].material;
        }
        
        // Use the region-specific material (should always exist if water tiles were found)
        if (materialToUse) {
          waterSurface.material = materialToUse;
        } else {
          // Fallback: create a default material if somehow no flow direction was found
          const fallbackTexture = new Texture('/assets/watertexture.png', scene);
          fallbackTexture.wrapU = Texture.WRAP_ADDRESSMODE;
          fallbackTexture.wrapV = Texture.WRAP_ADDRESSMODE;
          fallbackTexture.uScale = 1.0;
          fallbackTexture.vScale = 1.0;
          
          const fallbackMaterial = new StandardMaterial('waterFallbackMaterial', scene);
          fallbackMaterial.diffuseTexture = fallbackTexture;
          fallbackMaterial.diffuseColor = new Color3(1.0, 1.0, 1.0);
          fallbackMaterial.emissiveColor = new Color3(0.15, 0.25, 0.4);
          fallbackMaterial.alpha = 0.5;
          fallbackMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
          waterSurface.material = fallbackMaterial;
        }
        waterSurface.parent = mapContainer;
        
        // Store water surface mesh for potential future updates
        waterMeshes.push(waterSurface);
      }
    }
  }
  
  // Create wall crumbles/debris for ruined effect
  const crumbleMeshes = createWallCrumbles(scene, wallDataForCrumbles, tileSize, wallMaterials, mapContainer, {
    crumbleChance: 0.35,        // 35% of walls get crumbles
    cornerCrumbleChance: 0.5,   // 50% of eligible corners get debris
    maxCrumblesPerWall: 3,
    minCrumbleSize: 0.08,
    maxCrumbleSize: 0.2
  });
  
  // Create rock debris at the bottom of water tiles for visual relief
  const waterRocks = createWaterRocks(scene, waterTileDataForRocks, mapContainer, {
    tileSize: tileSize,
    waterBottomY: -0.52, // Match water channel bottom position (waterSurfaceY - channelDepth)
    minRockSize: 0.05,
    maxRockSize: 0.12,
    rocksPerTile: { min: 2, max: 4 },
    edgeRockChance: 0.6,
    seed: 54321
  });
  
  // Tiles are centered at (x * tileSize, z * tileSize), so actual map edges are offset by half a tile
  const mapLeftEdge = -tileSize / 2;
  const mapRightEdge = (mapWidth - 1) * tileSize + tileSize / 2;
  const mapBottomEdge = -tileSize / 2;
  const mapTopEdge = (mapHeight - 1) * tileSize + tileSize / 2;
  const actualMapWidth = mapRightEdge - mapLeftEdge;
  const actualMapHeight = mapTopEdge - mapBottomEdge;
  const mapCenterX = (mapRightEdge + mapLeftEdge) / 2;
  const mapCenterZ = (mapTopEdge + mapBottomEdge) / 2;
  
  // Ramp parameters
  const rampWidth = 3.0; // How far the ramp extends outward
  const innerY = -0.02; // Height at board edge (matches ground mesh level)
  const outerY = -0.25; // Height at skirt level
  const innerRadius = 0.3; // Corner roundness at board edge
  const outerRadius = rampWidth + innerRadius; // Corner roundness at outer edge
  const segmentsPerCorner = 8; // Quality of rounded corners
  const skirtSize = 100; // How far the flat skirt extends beyond the ramp
  const skirtMeshes = [];
  
  // Create ramp material with triplanar anti-tiling shader (for slopes)
  const rampMaterial = new ShaderMaterial('rampAntiTile', scene, {
    vertexSource: `
      precision highp float;
      
      attribute vec3 position;
      attribute vec3 normal;
      
      uniform mat4 world;
      uniform mat4 viewProjection;
      
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      
      void main() {
        vec4 worldPos = world * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = normalize((world * vec4(normal, 0.0)).xyz);
        gl_Position = viewProjection * worldPos;
      }
    `,
    fragmentSource: `
      precision highp float;
      
      uniform sampler2D diffuseTexture;
      uniform float tileSize;
      uniform float textureScale;
      uniform float blendSharpness;
      
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      
      // Hash function for pseudo-random values
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      
      // 2D noise function for organic blending
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      
      // Fractal noise
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 3; i++) {
          value += amplitude * noise(p);
          p *= 2.0;
          amplitude *= 0.5;
        }
        return value;
      }
      
      // Get random rotation (0, 90, 180, or 270 degrees)
      float getRotation(vec2 tileId) {
        return floor(hash(tileId) * 4.0) * 1.5708;
      }
      
      // Rotate UV coordinates
      vec2 rotateUV(vec2 uv, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        vec2 center = vec2(0.5);
        uv -= center;
        uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
        uv += center;
        return uv;
      }
      
      // Sample texture for a specific tile with anti-tiling
      vec3 sampleTileAntiTiled(vec2 worldUV, vec2 tileId, vec2 localUV) {
        float rotation = getRotation(tileId);
        vec2 offset = vec2(hash(tileId + 0.5), hash(tileId + 1.5)) * 0.5;
        vec2 rotatedUV = rotateUV(localUV, rotation);
        vec2 finalUV = (rotatedUV + offset) * textureScale;
        return texture2D(diffuseTexture, finalUV).rgb;
      }
      
      // Anti-tiled texture sampling with noise blending
      vec3 sampleWithAntiTiling(vec2 worldUV) {
        vec2 scaledUV = worldUV / tileSize;
        vec2 tileId = floor(scaledUV);
        vec2 tileUV = fract(scaledUV);
        
        float blendZone = 0.35;
        float noiseScale = 8.0;
        float noiseValue = fbm(worldUV * noiseScale / tileSize) * 0.3;
        
        float distToEdgeX = min(tileUV.x, 1.0 - tileUV.x);
        float distToEdgeY = min(tileUV.y, 1.0 - tileUV.y);
        
        float dirX = tileUV.x < 0.5 ? -1.0 : 1.0;
        float dirY = tileUV.y < 0.5 ? -1.0 : 1.0;
        
        vec2 neighborX = tileId + vec2(dirX, 0.0);
        vec2 neighborY = tileId + vec2(0.0, dirY);
        vec2 neighborXY = tileId + vec2(dirX, dirY);
        
        float weightX = smoothstep(0.0, blendZone, distToEdgeX + noiseValue);
        float weightY = smoothstep(0.0, blendZone, distToEdgeY + noiseValue);
        
        vec3 colorMain = sampleTileAntiTiled(worldUV, tileId, tileUV);
        vec3 colorX = sampleTileAntiTiled(worldUV, neighborX, tileUV);
        vec3 colorY = sampleTileAntiTiled(worldUV, neighborY, tileUV);
        vec3 colorXY = sampleTileAntiTiled(worldUV, neighborXY, tileUV);
        
        vec3 blendX = mix(colorX, colorMain, weightX);
        vec3 blendXY = mix(colorXY, colorY, weightX);
        return mix(blendXY, blendX, weightY);
      }
      
      void main() {
        // Triplanar blend weights
        vec3 blend = abs(vNormal);
        blend = pow(blend, vec3(blendSharpness));
        blend /= (blend.x + blend.y + blend.z);
        
        // Sample with anti-tiling on each projection plane
        vec3 xProjection = sampleWithAntiTiling(vWorldPos.yz);
        vec3 yProjection = sampleWithAntiTiling(vWorldPos.xz);
        vec3 zProjection = sampleWithAntiTiling(vWorldPos.xy);
        
        // Blend the three projections
        vec3 finalColor = xProjection * blend.x + yProjection * blend.y + zProjection * blend.z;
        
        // Simple lighting
        vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
        float NdotL = max(dot(vNormal, lightDir), 0.0);
        float ambient = 0.4;
        float light = ambient + NdotL * 0.6;
        
        gl_FragColor = vec4(finalColor * light, 1.0);
      }
    `
  }, {
    attributes: ['position', 'normal'],
    uniforms: ['world', 'viewProjection', 'diffuseTexture', 'tileSize', 'textureScale', 'blendSharpness']
  });
  
  // Load ramp texture (same as skirt)
  const rampDiffuseTex = new Texture('/assets/decor/forest_leaves_02_diffuse_1k.jpg', scene);
  rampMaterial.setTexture('diffuseTexture', rampDiffuseTex);
  rampMaterial.setFloat('tileSize', 12.0);
  rampMaterial.setFloat('textureScale', 0.8);
  rampMaterial.setFloat('blendSharpness', 4.0);
  
  // Create anti-tiling shader material for skirt (GPU-based, no extra meshes)
  // This shader divides the surface into virtual tiles and applies random rotation/offset per tile
  const skirtTexturePath = '/assets/decor/';
  
  /**
   * Create a shader material with GPU-based anti-tiling
   * Uses hash functions to generate per-tile random rotation and offset
   */
  function createAntiTilingSkirtMaterial(name) {
    const shaderMaterial = new ShaderMaterial(name, scene, {
      vertexSource: `
        precision highp float;
        
        attribute vec3 position;
        attribute vec3 normal;
        attribute vec2 uv;
        
        uniform mat4 world;
        uniform mat4 viewProjection;
        
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUV;
        
        void main() {
          vec4 worldPos = world * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          vNormal = normalize((world * vec4(normal, 0.0)).xyz);
          vUV = uv;
          gl_Position = viewProjection * worldPos;
        }
      `,
      fragmentSource: `
        precision highp float;
        
        uniform sampler2D diffuseTexture;
        uniform sampler2D normalTexture;
        uniform sampler2D roughTexture;
        uniform float tileSize;
        uniform float textureScale;
        
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec2 vUV;
        
        // Hash function for pseudo-random values
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        // 2D noise function for organic blending
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f); // smoothstep
          
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        
        // Fractal noise for more organic patterns
        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 3; i++) {
            value += amplitude * noise(p);
            p *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }
        
        // Get random rotation (0, 90, 180, or 270 degrees)
        float getRotation(vec2 tileId) {
          return floor(hash(tileId) * 4.0) * 1.5708;
        }
        
        // Rotate UV coordinates
        vec2 rotateUV(vec2 uv, float angle) {
          float c = cos(angle);
          float s = sin(angle);
          vec2 center = vec2(0.5);
          uv -= center;
          uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
          uv += center;
          return uv;
        }
        
        // Sample texture for a specific tile
        vec3 sampleTile(vec2 tileId, vec2 localUV) {
          float rotation = getRotation(tileId);
          vec2 offset = vec2(hash(tileId + 0.5), hash(tileId + 1.5)) * 0.5;
          vec2 rotatedUV = rotateUV(localUV, rotation);
          vec2 finalUV = (rotatedUV + offset) * textureScale;
          return texture2D(diffuseTexture, finalUV).rgb;
        }
        
        void main() {
          // Calculate which virtual tile this pixel is in
          vec2 worldUV = vWorldPos.xz / tileSize;
          vec2 tileId = floor(worldUV);
          vec2 tileUV = fract(worldUV);
          
          // Blend zone size (0.0 to 0.5)
          float blendZone = 0.35;
          
          // Add noise to create organic, irregular blend boundaries
          float noiseScale = 8.0;
          float noiseValue = fbm(vWorldPos.xz * noiseScale / tileSize) * 0.3;
          
          // Calculate distance to nearest edge (with noise offset)
          float distToEdgeX = min(tileUV.x, 1.0 - tileUV.x);
          float distToEdgeY = min(tileUV.y, 1.0 - tileUV.y);
          
          // Determine neighbor directions
          float dirX = tileUV.x < 0.5 ? -1.0 : 1.0;
          float dirY = tileUV.y < 0.5 ? -1.0 : 1.0;
          
          vec2 neighborX = tileId + vec2(dirX, 0.0);
          vec2 neighborY = tileId + vec2(0.0, dirY);
          vec2 neighborXY = tileId + vec2(dirX, dirY);
          
          // Calculate blend weights with noise for organic edges
          float weightX = smoothstep(0.0, blendZone, distToEdgeX + noiseValue);
          float weightY = smoothstep(0.0, blendZone, distToEdgeY + noiseValue);
          
          // Sample all tiles
          vec3 colorMain = sampleTile(tileId, tileUV);
          vec3 colorX = sampleTile(neighborX, tileUV);
          vec3 colorY = sampleTile(neighborY, tileUV);
          vec3 colorXY = sampleTile(neighborXY, tileUV);
          
          // Bilinear blend with noise-modulated weights
          vec3 blendX = mix(colorX, colorMain, weightX);
          vec3 blendXY = mix(colorXY, colorY, weightX);
          vec3 finalColor = mix(blendXY, blendX, weightY);
          
          // Simple lighting
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          float NdotL = max(dot(vNormal, lightDir), 0.0);
          float ambient = 0.4;
          float light = ambient + NdotL * 0.6;
          
          gl_FragColor = vec4(finalColor * light, 1.0);
        }
      `
    }, {
      attributes: ['position', 'normal', 'uv'],
      uniforms: ['world', 'viewProjection', 'diffuseTexture', 'normalTexture', 'roughTexture', 'tileSize', 'textureScale']
    });
    
    // Load textures
    const diffuseTex = new Texture(skirtTexturePath + 'forest_leaves_02_diffuse_1k.jpg', scene);
    const normalTex = new Texture(skirtTexturePath + 'forest_leaves_02_nor_gl_1k.jpg', scene);
    const roughTex = new Texture(skirtTexturePath + 'forest_leaves_02_rough_1k.jpg', scene);
    
    shaderMaterial.setTexture('diffuseTexture', diffuseTex);
    shaderMaterial.setTexture('normalTexture', normalTex);
    shaderMaterial.setTexture('roughTexture', roughTex);
    shaderMaterial.setFloat('tileSize', 12.0); // Virtual tile size in world units
    shaderMaterial.setFloat('textureScale', 0.8); // How much of texture to show per tile
    
    return shaderMaterial;
  }
  
  // Create single shared skirt material
  const skirtAntiTileMaterial = createAntiTilingSkirtMaterial('skirtAntiTile');
  
  /**
   * Generate points for a rounded rectangle centered at origin
   * @param {number} width - Total width of rectangle
   * @param {number} height - Total height of rectangle  
   * @param {number} radius - Corner radius
   * @param {number} segments - Segments per corner
   * @param {number} y - Y height
   * @returns {Vector3[]} Array of points forming the rounded rectangle
   */
  function generateRoundedRectPoints(width, height, radius, segments, y) {
    const points = [];
    const halfW = width / 2;
    const halfH = height / 2;
    
    // Clamp radius to maximum possible
    const maxRadius = Math.min(halfW, halfH);
    const r = Math.min(radius, maxRadius);
    
    // Corner centers (inside the rectangle)
    const corners = [
      { cx: halfW - r, cz: halfH - r, startAngle: 0 },           // Top-right
      { cx: -halfW + r, cz: halfH - r, startAngle: Math.PI / 2 }, // Top-left
      { cx: -halfW + r, cz: -halfH + r, startAngle: Math.PI },    // Bottom-left
      { cx: halfW - r, cz: -halfH + r, startAngle: 3 * Math.PI / 2 } // Bottom-right
    ];
    
    corners.forEach(corner => {
      for (let i = 0; i <= segments; i++) {
        const angle = corner.startAngle + (i / segments) * (Math.PI / 2);
        const x = corner.cx + r * Math.cos(angle);
        const z = corner.cz + r * Math.sin(angle);
        points.push(new Vector3(x, y, z));
      }
    });
    
    return points;
  }
  
  // Generate inner and outer rounded rectangle paths
  const innerPoints = generateRoundedRectPoints(actualMapWidth, actualMapHeight, innerRadius, segmentsPerCorner, innerY);
  const outerPoints = generateRoundedRectPoints(actualMapWidth + rampWidth * 2, actualMapHeight + rampWidth * 2, outerRadius, segmentsPerCorner, outerY);
  
  // Offset points to map center
  innerPoints.forEach(p => { p.x += mapCenterX; p.z += mapCenterZ; });
  outerPoints.forEach(p => { p.x += mapCenterX; p.z += mapCenterZ; });
  
  // Close the paths by adding first point at the end
  innerPoints.push(innerPoints[0].clone());
  outerPoints.push(outerPoints[0].clone());
  
  // Create the ramp surface using ribbon (uses triplanar for slopes)
  const rampMesh = MeshBuilder.CreateRibbon('pyramidRamp', {
    pathArray: [outerPoints, innerPoints],
    closeArray: false,
    closePath: false,
    sideOrientation: Mesh.DOUBLESIDE
  }, scene);
  rampMesh.material = rampMaterial;
  rampMesh.isPickable = false;
  rampMesh.receiveShadows = true;
  skirtMeshes.push(rampMesh);
  
  // Create 4 large skirt planes with GPU-based anti-tiling shader
  
  // Left skirt - from map left edge outward
  const leftSkirtWidth = skirtSize + rampWidth;
  const leftSkirtHeight = actualMapHeight + skirtSize * 2;
  const leftSkirt = MeshBuilder.CreateGround('skirtLeft', {
    width: leftSkirtWidth,
    height: leftSkirtHeight
  }, scene);
  leftSkirt.position = new Vector3(mapCenterX - actualMapWidth / 2 - leftSkirtWidth / 2, outerY, mapCenterZ);
  leftSkirt.material = skirtAntiTileMaterial;
  leftSkirt.isPickable = false;
  leftSkirt.receiveShadows = true;
  skirtMeshes.push(leftSkirt);
  
  // Right skirt - from map right edge outward
  const rightSkirtWidth = skirtSize + rampWidth;
  const rightSkirtHeight = actualMapHeight + skirtSize * 2;
  const rightSkirt = MeshBuilder.CreateGround('skirtRight', {
    width: rightSkirtWidth,
    height: rightSkirtHeight
  }, scene);
  rightSkirt.position = new Vector3(mapCenterX + actualMapWidth / 2 + rightSkirtWidth / 2, outerY, mapCenterZ);
  rightSkirt.material = skirtAntiTileMaterial;
  rightSkirt.isPickable = false;
  rightSkirt.receiveShadows = true;
  skirtMeshes.push(rightSkirt);
  
  // Top skirt - from map top edge outward
  const topSkirtWidth = actualMapWidth;
  const topSkirtHeight = skirtSize + rampWidth;
  const topSkirt = MeshBuilder.CreateGround('skirtTop', {
    width: topSkirtWidth,
    height: topSkirtHeight
  }, scene);
  topSkirt.position = new Vector3(mapCenterX, outerY, mapCenterZ + actualMapHeight / 2 + topSkirtHeight / 2);
  topSkirt.material = skirtAntiTileMaterial;
  topSkirt.isPickable = false;
  topSkirt.receiveShadows = true;
  skirtMeshes.push(topSkirt);
  
  // Bottom skirt - from map bottom edge outward
  const bottomSkirtWidth = actualMapWidth;
  const bottomSkirtHeight = skirtSize + rampWidth;
  const bottomSkirt = MeshBuilder.CreateGround('skirtBottom', {
    width: bottomSkirtWidth,
    height: bottomSkirtHeight
  }, scene);
  bottomSkirt.position = new Vector3(mapCenterX, outerY, mapCenterZ - actualMapHeight / 2 - bottomSkirtHeight / 2);
  bottomSkirt.material = skirtAntiTileMaterial;
  bottomSkirt.isPickable = false;
  bottomSkirt.receiveShadows = true;
  skirtMeshes.push(bottomSkirt);
  
  // Scatter trees on the skirt
  const skirtBounds = {
    mapCenterX,
    mapCenterZ,
    mapHalfWidth: actualMapWidth / 2,
    mapHalfHeight: actualMapHeight / 2
  };
  
  // Load different tree types with their own placement rules
  // NOTE: Tree counts reduced to 1 for testing - restore to 100, 10, 40, 80 for production
  const treePromise = Promise.all([
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree1.glb',
      treeCount: 1,
      minDistance: 10,
      maxDistance: 50,
      groundY: outerY,
      seed: 42069
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree2.glb',
      treeCount: 1,
      minDistance: 10,
      maxDistance: 30,
      groundY: outerY,
      seed: 12345
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree3.glb',
      treeCount: 1,
      minDistance: 15,
      maxDistance: 40,
      groundY: outerY,
      seed: 77777
    }),
    scatterTrees(scene, skirtBounds, {
      modelFile: 'tree5.glb',
      treeCount: 1,
      minDistance: 20,
      maxDistance: 50,
      groundY: outerY,
      seed: 55555
    })
  ]);
  
  // Scatter decorative wall ruins in the forest for visual consistency
  const ruinsResult = scatterRuins(scene, skirtBounds, wallMaterials, {
    ruinCount: 30,
    minDistance: 12,
    maxDistance: 45,
    groundY: outerY,
    tileSize: tileSize,
    seed: 31415
  });
  
  // Combine all async loading promises so caller can wait for everything
  const mapLoadPromise = Promise.all([
    groundResult.loadPromise,
    treePromise
  ]);
  
  return {
    interactiveTiles: startPositionTiles,
    allStartTiles: allStartPositionTiles,
    allTiles: allTiles,
    playerStartMaterial,
    enemyStartMaterial,
    neutralTileMaterial, // Pre-made material for resetting starting tiles after preparation phase
    waterMeshes,
    waterAnimationData,
    groundMeshes: groundResult.groundMeshes,
    skirtMeshes,
    treePromise,
    mapLoadPromise
  };
}
