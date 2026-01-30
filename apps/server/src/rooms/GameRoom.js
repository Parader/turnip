import pkg from 'colyseus';
const { Room } = pkg;
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';
import { getDatabase } from '../config/database.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { SpellDefs, getSpell, validateSpellForCaster } from '../config/spelldefs.js';
import { gameData } from '../config/classes.js';
import { hasLOS, createTerrainBlocksFunction } from '../utils/lineOfSight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Game phases
export const GAME_PHASES = {
  PREPARATION: 'preparation',
  GAME: 'game',
  STATS: 'stats'
};

// Game state schema
class PositionState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
  }
}

defineTypes(PositionState, {
  x: 'number',
  y: 'number'
});

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

class PlayerState extends Schema {
  constructor() {
    super();
    this.userId = '';
    this.username = '';
    this.team = ''; // 'A' or 'B'
    this.characterId = '';
    this.characterName = '';
    this.characterClass = ''; // 'assassin', 'warrior', 'archer', 'mage'
    this.spellLoadout = ''; // JSON string array of spell IDs
    this.position = new PositionState();
    this.orientation = 0; // Rotation angle in radians (0 = facing positive X, PI/2 = facing positive Z)
    this.health = 0;
    this.maxHealth = 0;
    this.ready = false; // For preparation phase
    this.movementPoints = 0; // Total movement points available (can exceed max during turn)
    this.maxMovementPoints = 0; // Maximum movement points (base value from character class)
    this.usedMovementPoints = 0; // Movement points used this turn
    this.movementPath = ''; // JSON string array of path coordinates [{x, y}, ...]
    this.energy = 0; // Current energy
    this.maxEnergy = 0; // Maximum energy
    this.statusEffects = new MapSchema(); // Map of effectId -> StatusEffectState
    this.isInvisible = false; // Whether player is invisible
    this.invisibilitySource = ''; // Spell or effect that granted invisibility
    this.invisibilityDuration = 0; // Turns remaining
  }
}

defineTypes(PlayerState, {
  userId: 'string',
  username: 'string',
  team: 'string',
  characterId: 'string',
  characterName: 'string',
  characterClass: 'string',
  spellLoadout: 'string', // JSON string array
  position: PositionState,
  orientation: 'number', // Rotation in radians
  health: 'number',
  maxHealth: 'number',
  ready: 'boolean',
  movementPoints: 'number',
  maxMovementPoints: 'number',
  usedMovementPoints: 'number',
  movementPath: 'string', // JSON string array of path coordinates
  energy: 'number',
  maxEnergy: 'number',
  statusEffects: { map: StatusEffectState },
  isInvisible: 'boolean',
  invisibilitySource: 'string',
  invisibilityDuration: 'number'
});

class TeamState extends Schema {
  constructor() {
    super();
    this.teamId = ''; // 'A' or 'B'
    this.players = new MapSchema();
    this.startZone = new ArraySchema();
  }
}

class StartPositionState extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
  }
}

defineTypes(StartPositionState, {
  x: 'number',
  y: 'number'
});

defineTypes(TeamState, {
  teamId: 'string',
  players: { map: PlayerState },
  startZone: [StartPositionState]
});

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

class SpawnedEntityState extends Schema {
  constructor() {
    super();
    this.entityId = ''; // Unique ID
    this.entityType = ''; // e.g., 'trap', 'totem'
    this.sourceSpellId = '';
    this.sourceUserId = '';
    this.team = ''; // 'A' or 'B' - which team owns this entity
    this.position = new PositionState();
    this.health = 0;
    this.maxHealth = 0;
    this.duration = 0; // Turns remaining (0 = permanent)
    this.data = ''; // JSON string for entity-specific data (triggers, effects, etc.)
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

class GameState extends Schema {
  constructor() {
    super();
    this.phase = GAME_PHASES.PREPARATION;
    this.matchId = '';
    this.mapId = '';
    this.queueType = '';
    this.teamA = new TeamState();
    this.teamB = new TeamState();
    this.turn = 0;
    this.currentPlayerId = '';
    this.turnOrder = new ArraySchema(); // Array of userIds in playing order
    this.stats = ''; // For stats phase - stored as JSON string
    this.groundEffects = new MapSchema(); // Map of "x_y" -> GroundEffectState
    this.terrainModifications = new MapSchema(); // Map of "x_y" -> TerrainModState
    this.spawnedEntities = new MapSchema(); // Map of entityId -> SpawnedEntityState
  }
}

defineTypes(GameState, {
  phase: 'string',
  matchId: 'string',
  mapId: 'string',
  queueType: 'string',
  teamA: TeamState,
  teamB: TeamState,
  turn: 'number',
  currentPlayerId: 'string',
  turnOrder: ['string'], // Array of userIds
  stats: 'string', // Will be serialized as JSON string
  groundEffects: { map: GroundEffectState },
  terrainModifications: { map: TerrainModState },
  spawnedEntities: { map: SpawnedEntityState }
});

// TILE_TYPES constants (matching client)
const TILE_TYPES = {
  NONE: 0,
  TILE: 1,
  WALL: 2,
  WATER: 3
};

// Tile type definitions with properties (matching client)
const TILE_DEFINITIONS = {
  [TILE_TYPES.NONE]: {
    walkable: false,
    blocksLOS: false
  },
  [TILE_TYPES.TILE]: {
    walkable: true,
    blocksLOS: false
  },
  [TILE_TYPES.WALL]: {
    walkable: false,
    blocksLOS: true
  },
  [TILE_TYPES.WATER]: {
    walkable: false,
    blocksLOS: false
  }
};

/**
 * Get tile definition for a tile type
 * @param {number} tileType - Tile type value
 * @returns {Object} Tile definition with walkable and blocksLOS properties
 */
function getTileDefinition(tileType) {
  return TILE_DEFINITIONS[tileType] || TILE_DEFINITIONS[TILE_TYPES.NONE];
}

/**
 * Check if a tile type is walkable
 * @param {number} tileType - Tile type value
 * @returns {boolean} True if walkable
 */
function isTileWalkable(tileType) {
  const def = getTileDefinition(tileType);
  return def.walkable;
}

/**
 * Check if a tile type blocks line of sight
 * @param {number} tileType - Tile type value
 * @returns {boolean} True if blocks LOS
 */
function doesTileBlockLOS(tileType) {
  const def = getTileDefinition(tileType);
  return def.blocksLOS;
}

/**
 * A* pathfinding algorithm for grid movement (server-side)
 * Simplified version without preferred path support
 * @param {Array<Array<number>>} terrain - Terrain array
 * @param {number} startX - Start X coordinate
 * @param {number} startY - Start Y coordinate
 * @param {number} endX - End X coordinate
 * @param {number} endY - End Y coordinate
 * @param {Set<string>} occupiedTiles - Set of occupied tile keys
 * @param {GameRoom} [gameRoom] - Optional GameRoom instance for checking ground effects and terrain modifications
 */
function findPath(terrain, startX, startY, endX, endY, occupiedTiles = new Set(), gameRoom = null) {
  const mapHeight = terrain.length;
  const mapWidth = terrain[0]?.length || 0;
  
  // Check if coordinates are valid
  if (startX < 0 || startX >= mapWidth || startY < 0 || startY >= mapHeight) {
    return [];
  }
  if (endX < 0 || endX >= mapWidth || endY < 0 || endY >= mapHeight) {
    return [];
  }
  
  // Check if start and end are walkable (accounting for terrain modifications)
  const startTerrain = gameRoom ? getTerrainType(gameRoom, startX, startY) : terrain[startY][startX];
  const endTerrain = gameRoom ? getTerrainType(gameRoom, endX, endY) : terrain[endY][endX];
  
  if (!isTileWalkable(startTerrain)) {
    return [];
  }
  if (!isTileWalkable(endTerrain)) {
    return [];
  }
  
  // Check if end has a ground effect that blocks movement
  if (gameRoom) {
    const endKey = `${endX}_${endY}`;
    const groundEffect = gameRoom.state.groundEffects.get(endKey);
    if (groundEffect) {
      try {
        const effectData = JSON.parse(groundEffect.data || '{}');
        if (effectData.blocksMovement) {
          return []; // Cannot move to blocked cell
        }
      } catch (error) {
        // Ignore parse errors
      }
    }
  }
  
  // Check if end tile is occupied
  const endKey = `${endX}_${endY}`;
  if (occupiedTiles.has(endKey)) {
    return [];
  }
  
  // A* algorithm
  const startKey = `${startX}_${startY}`;
  const openSet = [{ x: startX, y: startY, g: 0, h: Math.abs(endX - startX) + Math.abs(endY - startY), f: 0 }];
  const closedSet = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();
  
  gScore.set(startKey, 0);
  fScore.set(startKey, Math.abs(endX - startX) + Math.abs(endY - startY));
  
  const neighbors = [
    { x: 0, y: -1 }, // up
    { x: 1, y: 0 },  // right
    { x: 0, y: 1 },  // down
    { x: -1, y: 0 }  // left
  ];
  
  while (openSet.length > 0) {
    // Sort by f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const currentKey = `${current.x}_${current.y}`;
    
    if (current.x === endX && current.y === endY) {
      // Reconstruct path
      const path = [];
      let node = { x: endX, y: endY };
      path.push({ x: node.x, y: node.y });
      
      while (cameFrom.has(`${node.x}_${node.y}`)) {
        node = cameFrom.get(`${node.x}_${node.y}`);
        path.unshift({ x: node.x, y: node.y });
      }
      
      return path;
    }
    
    closedSet.add(currentKey);
    
    for (const dir of neighbors) {
      const neighbor = { x: current.x + dir.x, y: current.y + dir.y };
      const neighborKey = `${neighbor.x}_${neighbor.y}`;
      
      // Skip if out of bounds
      if (neighbor.x < 0 || neighbor.x >= mapWidth || neighbor.y < 0 || neighbor.y >= mapHeight) {
        continue;
      }
      
      // Skip if not walkable (accounting for terrain modifications)
      const neighborTerrain = gameRoom ? getTerrainType(gameRoom, neighbor.x, neighbor.y) : terrain[neighbor.y][neighbor.x];
      if (!isTileWalkable(neighborTerrain)) {
        continue;
      }
      
      // Check if neighbor has a ground effect that blocks movement
      if (gameRoom) {
        const neighborKey = `${neighbor.x}_${neighbor.y}`;
        const groundEffect = gameRoom.state.groundEffects.get(neighborKey);
        if (groundEffect) {
          try {
            const effectData = JSON.parse(groundEffect.data || '{}');
            if (effectData.blocksMovement) {
              continue; // Skip blocked cells
            }
          } catch (error) {
            // Ignore parse errors
          }
        }
      }
      
      // Skip if occupied (except start position)
      if (neighborKey !== startKey && occupiedTiles.has(neighborKey)) {
        continue;
      }
      
      // Skip if already evaluated
      if (closedSet.has(neighborKey)) {
        continue;
      }
      
      // Calculate tentative g score
      const tentativeG = gScore.get(currentKey) + 1;
      
      // Check if this path is better
      const neighborG = gScore.get(neighborKey);
      if (!neighborG || tentativeG < neighborG) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        const h = Math.abs(neighbor.x - endX) + Math.abs(neighbor.y - endY);
        fScore.set(neighborKey, tentativeG + h);
        
        // Add to open set if not already there
        const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
        if (!existing) {
          openSet.push({ 
            x: neighbor.x, 
            y: neighbor.y, 
            g: tentativeG, 
            h: h, 
            f: tentativeG + h
          });
        } else {
          // Update existing node
          existing.g = tentativeG;
          existing.h = h;
          existing.f = tentativeG + h;
        }
      }
    }
  }
  
  // No path found
  return [];
}

/**
 * Get all cells affected by a spell pattern
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {string} pattern - Pattern type ('SINGLE', 'CIRCLE1', 'LINE3', etc.)
 * @param {number} [radius] - Radius for circle patterns
 * @param {number} [casterX] - Caster X position (for LINE patterns)
 * @param {number} [casterY] - Caster Y position (for LINE patterns)
 * @returns {Array<{x: number, y: number}>} Array of affected cells
 */
function getPatternCells(centerX, centerY, pattern, radius = 1, casterX = null, casterY = null) {
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
      if (casterX !== null && casterY !== null) {
        const dx = centerX - casterX;
        const dy = centerY - casterY;
        
        // Normalize direction (get unit vector)
        const length = Math.max(Math.abs(dx), Math.abs(dy));
        if (length > 0) {
          const dirX = Math.sign(dx);
          const dirY = Math.sign(dy);
          
          // Add center and 2 cells in direction
          cells.push({ x: centerX, y: centerY });
          cells.push({ x: centerX + dirX, y: centerY + dirY });
          cells.push({ x: centerX + dirX * 2, y: centerY + dirY * 2 });
        } else {
          // Same cell, just add center
          cells.push({ x: centerX, y: centerY });
        }
      } else {
        // Fallback to single if no caster position
        cells.push({ x: centerX, y: centerY });
      }
      break;
      
    default:
      cells.push({ x: centerX, y: centerY });
  }
  
  return cells;
}

/**
 * Get all units in a pattern area
 * @param {GameRoom} gameRoom - GameRoom instance (for accessing state)
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {string} pattern - Pattern type
 * @param {string} [unitFilter] - 'ENEMY', 'ALLY', 'ANY'
 * @param {string} casterTeam - Team of caster ('A' or 'B')
 * @param {number} [casterX] - Caster X position (for LINE patterns)
 * @param {number} [casterY] - Caster Y position (for LINE patterns)
 * @returns {Array<PlayerState>} Array of affected players
 */
function getUnitsInPattern(gameRoom, centerX, centerY, pattern, unitFilter, casterTeam, casterX = null, casterY = null) {
  const cells = getPatternCells(centerX, centerY, pattern, 1, casterX, casterY);
  const affectedUnits = [];
  
  cells.forEach(cell => {
    // Check Team A
    gameRoom.state.teamA.players.forEach((player, userId) => {
      if (player.position && player.position.x === cell.x && player.position.y === cell.y) {
        if (!unitFilter || unitFilter === 'ANY' || 
            (unitFilter === 'ENEMY' && casterTeam !== 'A') ||
            (unitFilter === 'ALLY' && casterTeam === 'A')) {
          affectedUnits.push(player);
        }
      }
    });
    
    // Check Team B
    gameRoom.state.teamB.players.forEach((player, userId) => {
      if (player.position && player.position.x === cell.x && player.position.y === cell.y) {
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

/**
 * Get all cells in a radius around a center point
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {number} radius - Radius in cells
 * @returns {Array<{x: number, y: number}>} Array of cells in radius
 */
function getCellsInRadius(centerX, centerY, radius) {
  const cells = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= radius) {
        cells.push({ x: centerX + dx, y: centerY + dy });
      }
    }
  }
  return cells;
}

/**
 * Get terrain type at a position, accounting for modifications
 * @param {GameRoom} gameRoom - GameRoom instance
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} Terrain type (TILE_TYPES value)
 */
function getTerrainType(gameRoom, x, y) {
  // Check for terrain modifications first
  const modKey = `${x}_${y}`;
  const terrainMod = gameRoom.state.terrainModifications.get(modKey);
  if (terrainMod) {
    return terrainMod.newType;
  }
  
  // Return original terrain
  if (gameRoom.terrain && y >= 0 && y < gameRoom.terrain.length && 
      x >= 0 && x < gameRoom.terrain[0].length) {
    return gameRoom.terrain[y][x];
  }
  
  return TILE_TYPES.NONE;
}

export class GameRoom extends Room {
  // Map to store user sessions: userId -> Set of sessionIds
  userSessions = new Map();
  // Map to store which team each user is on: userId -> 'A' or 'B'
  userTeams = new Map();
  // Preparation phase timer
  preparationTimer = null;
  preparationDuration = 30000; // 30 seconds
  // Game phase tracking
  gameStartTime = null;
  // Terrain data for pathfinding
  terrain = null;

  async onCreate(options) {
    console.log('GameRoom created:', options.matchId);
    
    // Initialize game state
    this.setState(new GameState());
    this.state.matchId = options.matchId || `match_${Date.now()}`;
    this.state.mapId = options.mapId || 'map_001';
    this.state.queueType = options.queueType || '1v1';
    this.state.phase = GAME_PHASES.PREPARATION;

    // Get match info from FriendRoom if available
    let matchData = null;
    if (options.matchId) {
      try {
        // Import dynamically to avoid circular dependency
        const indexModule = await import('../index.js');
        const friendRoom = indexModule.getFriendRoomInstance();
        if (friendRoom && friendRoom.pendingMatches) {
          matchData = friendRoom.pendingMatches.get(options.matchId);
          if (matchData) {
            console.log(`Found match data for ${options.matchId} in FriendRoom`);
          }
        }
      } catch (error) {
        console.error('Failed to get match data from FriendRoom:', error);
      }
    }

    // Use match data from FriendRoom or options
    const team1 = matchData?.team1 || options.team1;
    const team2 = matchData?.team2 || options.team2;
    const mapId = matchData?.mapId || options.mapId || 'map_001';
    this.state.mapId = mapId;

    // Load map data to get start zones
    let startZones = matchData?.startZones || options.startZones || null;
    if (!startZones) {
      try {
        const mapPath = join(__dirname, '..', 'maps', `${this.state.mapId}.json`);
        const mapData = await readFile(mapPath, 'utf-8');
        const map = JSON.parse(mapData);
        startZones = map.startZones || null;
        // Store terrain for pathfinding
        this.terrain = map.terrain || null;
      } catch (error) {
        console.error('Failed to load map data:', error);
      }
    }

    // Initialize teams from match info
    if (team1 && team2) {
      await this.initializeTeams(team1, team2, startZones);
    }

    // Start preparation phase
    this.startPreparationPhase();

    // Listen for player actions
    this.onMessage('playerReady', (client, message) => {
      this.handlePlayerReady(client, message);
    });

    this.onMessage('requestPositionChange', (client, message) => {
      this.handlePositionChangeRequest(client, message);
    });

    this.onMessage('requestMovement', (client, message) => {
      this.handleMovementRequest(client, message);
    });

    this.onMessage('requestSpellCast', (client, message) => {
      this.handleSpellCast(client, message);
    });

    this.onMessage('requestSpellPrep', (client, message) => {
      this.handleSpellPrep(client, message);
    });

    this.onMessage('requestSpellPrepCancel', (client, message) => {
      this.handleSpellPrepCancel(client, message);
    });

    this.onMessage('playerAction', (client, message) => {
      this.handlePlayerAction(client, message);
    });

    this.onMessage('endTurn', (client, message) => {
      this.handleEndTurn(client, message);
    });

    this.onMessage('updateOrientation', (client, message) => {
      this.handleOrientationUpdate(client, message);
    });
  }

  async onJoin(client, options) {
    const userId = options.userId;
    if (!userId) {
      client.leave();
      return;
    }

    // Track user session
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId).add(client.sessionId);
    client.userId = userId;

    // Find which team this user is on
    const team = this.userTeams.get(userId);
    if (team) {
      console.log(`User ${userId} joined game room, team: ${team}`);
      
      // Check if player exists but is missing character data, and restore it
      const teamState = team === 'A' ? this.state.teamA : this.state.teamB;
      const player = teamState.players.get(userId);
      
      if (player) {
        // Always ensure characterClass is set - restore if missing
        if (!player.characterClass || !player.spellLoadout || player.spellLoadout === '[]') {
          console.log(`Player ${userId} missing character data, restoring...`);
          await this.restorePlayerCharacterData(player, userId);
        }
        // Log character data for debugging
        console.log(`Player ${userId} characterClass: ${player.characterClass}, characterId: ${player.characterId}`);
      }
    } else {
      // Player not in any team - might be a rejoin after room was created
      // Try to restore from match data or fetch character info
      await this.handlePlayerRejoin(userId, client);
    }

    // Send initial state (filtered by phase and team)
    this.sendFilteredState(client);
  }

  /**
   * Handle player rejoin - restore player data if missing
   */
  async handlePlayerRejoin(userId, client) {
    // Try to get match data from FriendRoom
    try {
      const indexModule = await import('../index.js');
      const friendRoom = indexModule.getFriendRoomInstance();
      
      if (friendRoom && friendRoom.pendingMatches && this.state.matchId) {
        const matchData = friendRoom.pendingMatches.get(this.state.matchId);
        
        if (matchData) {
          // Find player in match data
          const allTeamMembers = [...(matchData.team1 || []), ...(matchData.team2 || [])];
          const memberData = allTeamMembers.find(m => m.id === userId);
          
          if (memberData) {
            // Determine which team
            const isTeam1 = matchData.team1?.some(m => m.id === userId);
            const team = isTeam1 ? 'A' : 'B';
            const teamState = team === 'A' ? this.state.teamA : this.state.teamB;
            
            // Check if player already exists in state
            let player = teamState.players.get(userId);
            
            if (!player) {
              // Create new player entry
              player = new PlayerState();
              player.userId = userId;
              player.username = memberData.username;
              player.team = team;
              teamState.players.set(userId, player);
              this.userTeams.set(userId, team);
            }
            
            // Restore character data
            await this.restorePlayerCharacterData(player, userId, memberData);
          }
        }
      }
    } catch (error) {
      console.error('Error handling player rejoin:', error);
    }
  }

  /**
   * Restore player character data from database or match data
   */
  async restorePlayerCharacterData(player, userId, memberData = null) {
    try {
      const { getDatabase } = await import('../config/database.js');
      const { ObjectId } = await import('mongodb');
      const db = getDatabase();
      
      // Use provided memberData or fetch from database
      let characterData = null;
      
      if (memberData && memberData.characterId) {
        // Try to get from memberData first
        if (memberData.characterClass && memberData.spellLoadout) {
          player.characterId = memberData.characterId;
          player.characterName = memberData.characterName || '';
          player.characterClass = memberData.characterClass;
          player.spellLoadout = memberData.spellLoadout;
          console.log(`Restored character data for ${userId} from match data: class=${player.characterClass}`);
          // Broadcast updated state to all clients
          this.broadcastFilteredState();
          return;
        }
      }
      
      // Fetch from database if characterId is available
      if (player.characterId) {
        characterData = await db.collection('characters').findOne({
          _id: new ObjectId(player.characterId)
        });
      }
      
      if (characterData) {
        player.characterClass = characterData.classId || '';
        player.spellLoadout = JSON.stringify(characterData.spellLoadout || []);
        console.log(`Restored character data for ${userId} from database: class=${player.characterClass}, characterId=${player.characterId}`);
        
        // Broadcast updated state to all clients
        this.broadcastFilteredState();
      } else {
        console.warn(`Could not restore character data for ${userId} - character not found. characterId=${player.characterId}`);
      }
    } catch (error) {
      console.error(`Error restoring character data for ${userId}:`, error);
    }
  }

  onLeave(client, code) {
    const userId = client.userId;
    if (userId && this.userSessions.has(userId)) {
      this.userSessions.get(userId).delete(client.sessionId);
      if (this.userSessions.get(userId).size === 0) {
        this.userSessions.delete(userId);
      }
    }
  }

  onDispose() {
    // Clear timers
    if (this.preparationTimer) {
      clearTimeout(this.preparationTimer);
    }
    console.log(`GameRoom ${this.state.matchId} disposed`);
  }

  /**
   * Initialize teams from match info
   */
  async initializeTeams(team1Members, team2Members, startZones) {
    // Initialize Team A (team1)
    this.state.teamA.teamId = 'A';
    for (const member of team1Members) {
      const player = new PlayerState();
      player.userId = member.id;
      player.username = member.username;
      player.team = 'A';
      player.characterId = member.characterId || '';
      player.characterName = member.characterName || '';
      player.characterClass = member.characterClass || '';
      player.spellLoadout = member.spellLoadout || '[]'; // JSON string array
      
      // If character data is missing, fetch it from database
      // Check for empty string as well as falsy values
      if (player.characterId && (!player.characterClass || player.characterClass === '' || !player.spellLoadout || player.spellLoadout === '[]')) {
        console.log(`Initializing Team A: Player ${member.id} missing character data, restoring...`);
        await this.restorePlayerCharacterData(player, member.id, member);
      } else {
        console.log(`Initializing Team A: Player ${member.id} has characterClass=${player.characterClass}, characterId=${player.characterId}`);
      }
      
      this.state.teamA.players.set(member.id, player);
      this.userTeams.set(member.id, 'A');
    }

    // Initialize Team B (team2)
    this.state.teamB.teamId = 'B';
    for (const member of team2Members) {
      const player = new PlayerState();
      player.userId = member.id;
      player.username = member.username;
      player.team = 'B';
      player.characterId = member.characterId || '';
      player.characterName = member.characterName || '';
      player.characterClass = member.characterClass || '';
      player.spellLoadout = member.spellLoadout || '[]'; // JSON string array
      
      // If character data is missing, fetch it from database
      // Check for empty string as well as falsy values
      if (player.characterId && (!player.characterClass || player.characterClass === '' || !player.spellLoadout || player.spellLoadout === '[]')) {
        console.log(`Initializing Team B: Player ${member.id} missing character data, restoring...`);
        await this.restorePlayerCharacterData(player, member.id, member);
      } else {
        console.log(`Initializing Team B: Player ${member.id} has characterClass=${player.characterClass}, characterId=${player.characterId}`);
      }
      
      this.state.teamB.players.set(member.id, player);
      this.userTeams.set(member.id, 'B');
    }

    // Set start zones if provided
    if (startZones) {
      if (startZones.A) {
        this.state.teamA.startZone = new ArraySchema();
        startZones.A.forEach(pos => {
          const startPos = new StartPositionState();
          startPos.x = pos.x;
          startPos.y = pos.y;
          this.state.teamA.startZone.push(startPos);
        });
      }
      if (startZones.B) {
        this.state.teamB.startZone = new ArraySchema();
        startZones.B.forEach(pos => {
          const startPos = new StartPositionState();
          startPos.x = pos.x;
          startPos.y = pos.y;
          this.state.teamB.startZone.push(startPos);
        });
      }
    }

    // Assign default positions to players from start zones
    this.assignDefaultPositions();
  }

  /**
   * Assign default positions to players from their team's start zones
   */
  assignDefaultPositions() {
    // Calculate average enemy position to determine facing direction
    const teamAPositions = this.state.teamA.startZone;
    const teamBPositions = this.state.teamB.startZone;
    
    // Calculate center positions for each team
    let teamACenterX = 0, teamACenterY = 0;
    let teamBCenterX = 0, teamBCenterY = 0;
    
    if (teamAPositions.length > 0) {
      teamACenterX = teamAPositions.reduce((sum, pos) => sum + pos.x, 0) / teamAPositions.length;
      teamACenterY = teamAPositions.reduce((sum, pos) => sum + pos.y, 0) / teamAPositions.length;
    }
    
    if (teamBPositions.length > 0) {
      teamBCenterX = teamBPositions.reduce((sum, pos) => sum + pos.x, 0) / teamBPositions.length;
      teamBCenterY = teamBPositions.reduce((sum, pos) => sum + pos.y, 0) / teamBPositions.length;
    }
    
    // Calculate default orientation for each team to face the enemy
    // Team A faces right (towards Team B), Team B faces left (towards Team A)
    // In Babylon.js, rotation around Y axis: 0 = +X, PI/2 = +Z, PI = -X, -PI/2 = -Z
    const teamAOrientation = Math.atan2(teamBCenterY - teamACenterY, teamBCenterX - teamACenterX);
    const teamBOrientation = Math.atan2(teamACenterY - teamBCenterY, teamACenterX - teamBCenterX);
    
    // Assign positions and orientations for Team A
    let posIndex = 0;
    this.state.teamA.players.forEach((player, userId) => {
      if (posIndex < teamAPositions.length) {
        const pos = teamAPositions[posIndex];
        player.position.x = pos.x;
        player.position.y = pos.y;
        player.orientation = teamAOrientation;
        posIndex++;
      }
    });

    // Assign positions and orientations for Team B
    posIndex = 0;
    this.state.teamB.players.forEach((player, userId) => {
      if (posIndex < teamBPositions.length) {
        const pos = teamBPositions[posIndex];
        player.position.x = pos.x;
        player.position.y = pos.y;
        player.orientation = teamBOrientation;
        posIndex++;
      }
    });
  }

  /**
   * Start preparation phase
   */
  startPreparationPhase() {
    this.state.phase = GAME_PHASES.PREPARATION;
    console.log(`Game ${this.state.matchId} entered PREPARATION phase`);

    // Reset all players' ready status
    this.state.teamA.players.forEach((player) => {
      player.ready = false;
    });
    this.state.teamB.players.forEach((player) => {
      player.ready = false;
    });

    // No automatic timer - wait for all players to be ready
    // Notify all clients of phase change
    this.broadcast('phaseChanged', { phase: GAME_PHASES.PREPARATION });
    this.broadcastFilteredState();
  }

  /**
   * Start game phase
   */
  startGamePhase() {
    this.state.phase = GAME_PHASES.GAME;
    this.gameStartTime = Date.now();
    console.log(`Game ${this.state.matchId} entered GAME phase`);

    // Clear preparation timer if it exists
    if (this.preparationTimer) {
      clearTimeout(this.preparationTimer);
      this.preparationTimer = null;
    }

    // Ensure positions are set (they should already be set from initialization, but verify)
    this.ensurePositionsSet();

    // Initialize movement points for all players
    this.initializeMovementPoints();
    this.initializeEnergy();

    // Set the first player's turn (alternate between teams)
    this.initializeTurnOrder();

    // Notify all clients of phase change
    this.broadcast('phaseChanged', { phase: GAME_PHASES.GAME });

    // Send full state to all clients
    this.broadcastFilteredState();
  }

  /**
   * Initialize movement points for all players based on their character class
   */
  initializeMovementPoints() {
    // Set movement points for Team A
    this.state.teamA.players.forEach((player, userId) => {
      const classData = gameData.classes[player.characterClass?.toLowerCase()];
      const defaultMP = classData?.baseStats?.movement || 3;
      player.movementPoints = defaultMP;
      player.maxMovementPoints = defaultMP;
      player.usedMovementPoints = 0;
    });

    // Set movement points for Team B
    this.state.teamB.players.forEach((player, userId) => {
      const classData = gameData.classes[player.characterClass?.toLowerCase()];
      const defaultMP = classData?.baseStats?.movement || 3;
      player.movementPoints = defaultMP;
      player.maxMovementPoints = defaultMP;
      player.usedMovementPoints = 0;
    });
  }

  /**
   * Initialize energy and health for all players based on their character class
   */
  initializeEnergy() {
    // Set energy and health for Team A
    this.state.teamA.players.forEach((player, userId) => {
      const classData = gameData.classes[player.characterClass?.toLowerCase()];
      if (classData?.baseStats) {
        player.energy = classData.baseStats.energy || 5;
        player.maxEnergy = classData.baseStats.energy || 5;
        player.health = classData.baseStats.hp || 20;
        player.maxHealth = classData.baseStats.hp || 20;
      } else {
        player.energy = 5;
        player.maxEnergy = 5;
        player.health = 20;
        player.maxHealth = 20;
      }
    });

    // Set energy and health for Team B
    this.state.teamB.players.forEach((player, userId) => {
      const classData = gameData.classes[player.characterClass?.toLowerCase()];
      if (classData?.baseStats) {
        player.energy = classData.baseStats.energy || 5;
        player.maxEnergy = classData.baseStats.energy || 5;
        player.health = classData.baseStats.hp || 20;
        player.maxHealth = classData.baseStats.hp || 20;
      } else {
        player.energy = 5;
        player.maxEnergy = 5;
        player.health = 20;
        player.maxHealth = 20;
      }
    });
  }

  /**
   * Initialize turn order - shuffle all players from both teams
   */
  initializeTurnOrder() {
    // Collect all players from both teams
    const allPlayers = [];
    
    // Add Team A players
    this.state.teamA.players.forEach((player, userId) => {
      allPlayers.push({
        userId: userId,
        username: player.username,
        team: 'A',
        characterClass: player.characterClass
      });
    });
    
    // Add Team B players
    this.state.teamB.players.forEach((player, userId) => {
      allPlayers.push({
        userId: userId,
        username: player.username,
        team: 'B',
        characterClass: player.characterClass
      });
    });
    
    // Shuffle players using Fisher-Yates algorithm
    for (let i = allPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
    }
    
    // Create turn order array
    this.state.turnOrder = new ArraySchema();
    allPlayers.forEach(player => {
      this.state.turnOrder.push(player.userId);
    });
    
    // Set first player
    if (this.state.turnOrder.length > 0) {
      this.state.currentPlayerId = this.state.turnOrder[0];
      this.state.turn = 1;
      console.log(`Turn order initialized: ${allPlayers.map(p => `${p.username} (${p.team})`).join(' -> ')}`);
      console.log(`Current player: ${allPlayers[0].username} (${allPlayers[0].userId})`);
    } else {
      console.warn('No players to set turn order');
    }
  }

  /**
   * Ensure all player positions are set from start zones
   * This is called when game phase starts to verify positions are set
   * Preserves positions chosen during preparation phase
   */
  ensurePositionsSet() {
    // Calculate orientations for teams (needed for players without positions)
    const teamAPositions = this.state.teamA.startZone;
    const teamBPositions = this.state.teamB.startZone;
    
    // Calculate center positions for orientation
    let teamACenterX = 0, teamACenterY = 0;
    let teamBCenterX = 0, teamBCenterY = 0;
    
    if (teamAPositions.length > 0) {
      teamACenterX = teamAPositions.reduce((sum, pos) => sum + pos.x, 0) / teamAPositions.length;
      teamACenterY = teamAPositions.reduce((sum, pos) => sum + pos.y, 0) / teamAPositions.length;
    }
    
    if (teamBPositions.length > 0) {
      teamBCenterX = teamBPositions.reduce((sum, pos) => sum + pos.x, 0) / teamBPositions.length;
      teamBCenterY = teamBPositions.reduce((sum, pos) => sum + pos.y, 0) / teamBPositions.length;
    }
    
    const teamAOrientation = Math.atan2(teamBCenterY - teamACenterY, teamBCenterX - teamACenterX);
    const teamBOrientation = Math.atan2(teamACenterY - teamBCenterY, teamACenterX - teamBCenterX);
    
    // Check and set positions for Team A - only if position is unset (preserve positions chosen during preparation)
    let posIndex = 0;
    this.state.teamA.players.forEach((player, userId) => {
      // Only set position if it's unset (0, 0) - this preserves positions chosen during preparation
      if (player.position.x === 0 && player.position.y === 0) {
        if (posIndex < teamAPositions.length) {
          const pos = teamAPositions[posIndex];
          player.position.x = pos.x;
          player.position.y = pos.y;
          player.orientation = teamAOrientation;
          posIndex++;
          console.log(`Set default position for Team A player ${userId}: (${pos.x}, ${pos.y})`);
        }
      } else {
        // Position is already set (chosen during preparation) - preserve it and ensure orientation is set
        console.log(`Preserving position for Team A player ${userId}: (${player.position.x}, ${player.position.y})`);
        if (!player.orientation || player.orientation === 0) {
          player.orientation = teamAOrientation;
        }
      }
    });

    // Check and set positions for Team B - only if position is unset (preserve positions chosen during preparation)
    posIndex = 0;
    this.state.teamB.players.forEach((player, userId) => {
      // Only set position if it's unset (0, 0) - this preserves positions chosen during preparation
      if (player.position.x === 0 && player.position.y === 0) {
        if (posIndex < teamBPositions.length) {
          const pos = teamBPositions[posIndex];
          player.position.x = pos.x;
          player.position.y = pos.y;
          player.orientation = teamBOrientation;
          posIndex++;
          console.log(`Set default position for Team B player ${userId}: (${pos.x}, ${pos.y})`);
        }
      } else {
        // Position is already set (chosen during preparation) - preserve it and ensure orientation is set
        console.log(`Preserving position for Team B player ${userId}: (${player.position.x}, ${player.position.y})`);
        if (!player.orientation || player.orientation === 0) {
          player.orientation = teamBOrientation;
        }
      }
    });
  }

  /**
   * Initialize player positions from start zones
   * (Positions are already assigned in assignDefaultPositions, but this can be used to reset positions)
   */
  initializeGamePositions() {
    // Positions are already assigned when teams are initialized
    // This method can be used to reset positions if needed
    this.assignDefaultPositions();
  }

  /**
   * End game and enter stats phase
   */
  endGame(winnerTeam) {
    this.state.phase = GAME_PHASES.STATS;
    const gameDuration = Date.now() - this.gameStartTime;

    // Calculate stats (store as JSON string since stats is a string field)
    const statsData = {
      winner: winnerTeam,
      duration: gameDuration,
      teamA: {
        players: Array.from(this.state.teamA.players.values()).map(p => ({
          userId: p.userId,
          username: p.username,
          health: p.health,
          // Add more stats as needed
        }))
      },
      teamB: {
        players: Array.from(this.state.teamB.players.values()).map(p => ({
          userId: p.userId,
          username: p.username,
          health: p.health,
          // Add more stats as needed
        }))
      }
    };
    this.state.stats = JSON.stringify(statsData);

    console.log(`Game ${this.state.matchId} ended, winner: ${winnerTeam}`);

    // Notify all clients of phase change
    this.broadcast('phaseChanged', { phase: GAME_PHASES.STATS });

    // Send stats to all clients
    this.broadcastFilteredState();

    // Auto-dispose after stats phase (e.g., 30 seconds)
    setTimeout(() => {
      this.disconnect();
    }, 30000);
  }

  /**
   * Send filtered state to a specific client based on phase and team
   */
  sendFilteredState(client) {
    const userId = client.userId;
    const team = this.userTeams.get(userId);
    
    if (!team) {
      return;
    }

    const filteredState = this.getFilteredState(userId, team);
    client.send('gameState', filteredState);
  }

  /**
   * Broadcast filtered state to all clients
   */
  broadcastFilteredState() {
    this.clients.forEach(client => {
      this.sendFilteredState(client);
    });
  }

  /**
   * Get filtered state based on phase and user's team
   */
  getFilteredState(userId, userTeam) {
    // Convert ground effects to object for client
    const groundEffects = {};
    this.state.groundEffects.forEach((effect, key) => {
      groundEffects[key] = {
        effectId: effect.effectId,
        sourceSpellId: effect.sourceSpellId,
        sourceUserId: effect.sourceUserId,
        x: effect.x,
        y: effect.y,
        radius: effect.radius,
        duration: effect.duration,
        data: effect.data
      };
    });
    
    // Convert terrain modifications to object for client
    const terrainModifications = {};
    this.state.terrainModifications.forEach((mod, key) => {
      terrainModifications[key] = {
        x: mod.x,
        y: mod.y,
        originalType: mod.originalType,
        newType: mod.newType,
        duration: mod.duration,
        sourceSpellId: mod.sourceSpellId,
        sourceUserId: mod.sourceUserId
      };
    });
    
    // Convert spawned entities to object for client
    const spawnedEntities = {};
    this.state.spawnedEntities.forEach((entity, entityId) => {
      spawnedEntities[entityId] = {
        entityId: entity.entityId,
        entityType: entity.entityType,
        sourceSpellId: entity.sourceSpellId,
        sourceUserId: entity.sourceUserId,
        team: entity.team,
        position: { x: entity.position.x, y: entity.position.y },
        health: entity.health,
        maxHealth: entity.maxHealth,
        duration: entity.duration,
        data: entity.data
      };
    });
    
    const baseState = {
      matchId: this.state.matchId,
      mapId: this.state.mapId,
      queueType: this.state.queueType,
      phase: this.state.phase,
      turn: this.state.turn,
      currentPlayerId: this.state.currentPlayerId,
      turnOrder: Array.from(this.state.turnOrder), // Convert ArraySchema to regular array
      groundEffects: groundEffects,
      terrainModifications: terrainModifications,
      spawnedEntities: spawnedEntities
    };

    if (this.state.phase === GAME_PHASES.PREPARATION) {
      // Preparation phase: only send own team's data WITH positions, NO enemy team data
      return {
        ...baseState,
        myTeam: userTeam === 'A' 
          ? this.getTeamData(this.state.teamA, true) // Include positions during preparation
          : this.getTeamData(this.state.teamB, true),
        enemyTeam: null // Explicitly null - no enemy team data at all during preparation
      };
    } else if (this.state.phase === GAME_PHASES.GAME) {
      // Game phase: send all players' data with positions (respect invisibility)
      return {
        ...baseState,
        myTeam: userTeam === 'A' ? this.getTeamData(this.state.teamA, true, userTeam) : this.getTeamData(this.state.teamB, true, userTeam),
        enemyTeam: userTeam === 'A' ? this.getTeamData(this.state.teamB, true, userTeam) : this.getTeamData(this.state.teamA, true, userTeam)
      };
    } else if (this.state.phase === GAME_PHASES.STATS) {
      // Stats phase: send match recap with positions
      let stats = {};
      try {
        stats = JSON.parse(this.state.stats);
      } catch (e) {
        console.error('Failed to parse stats:', e);
      }
      return {
        ...baseState,
        stats: stats,
        myTeam: userTeam === 'A' ? this.getTeamData(this.state.teamA, true) : this.getTeamData(this.state.teamB, true),
        enemyTeam: userTeam === 'A' ? this.getTeamData(this.state.teamB, true) : this.getTeamData(this.state.teamA, true)
      };
    }

    return baseState;
  }

  /**
   * Get team data (sanitized for client)
   * @param {TeamState} teamState - The team state to serialize
   * @param {boolean} includePositions - Whether to include player positions (false during preparation)
   */
  getTeamData(teamState, includePositions = true, viewerTeam = null) {
    const players = {};
    teamState.players.forEach((player, userId) => {
      // Check visibility - hide invisible enemies from enemy team
      if (viewerTeam && player.team !== viewerTeam && player.isInvisible) {
        // Check if player is revealed by status effects
        let isRevealed = false;
        if (player.statusEffects) {
          player.statusEffects.forEach((effect, effectId) => {
            try {
              const effectData = JSON.parse(effect.data || '{}');
              if (effectData.blocksInvisibility) {
                isRevealed = true;
              }
            } catch (error) {
              // Ignore parse errors
            }
          });
        }
        if (!isRevealed) {
          // Hide invisible enemy - don't include in state
          return;
        }
      }
      
      // Ensure characterClass is always included (even if empty, so client can detect and handle)
      const characterClass = player.characterClass || '';
      if (!characterClass) {
        console.warn(`getTeamData: Player ${userId} (${player.username}) has empty characterClass`);
      }
      
      const playerData = {
        userId: player.userId,
        username: player.username,
        team: player.team,
        characterId: player.characterId,
        characterName: player.characterName,
        characterClass: characterClass, // Always include, even if empty
        spellLoadout: player.spellLoadout ? JSON.parse(player.spellLoadout) : [], // Parse JSON string to array
        position: includePositions ? { x: player.position.x, y: player.position.y } : undefined,
        orientation: player.orientation || 0, // Include orientation
        health: player.health,
        maxHealth: player.maxHealth,
        ready: player.ready,
        movementPoints: player.movementPoints || 0,
        maxMovementPoints: player.maxMovementPoints || 0,
        usedMovementPoints: player.usedMovementPoints || 0,
        movementPath: player.movementPath ? JSON.parse(player.movementPath) : null, // Parse JSON string to array
        energy: player.energy || 0,
        maxEnergy: player.maxEnergy || 0,
        statusEffects: player.statusEffects ? (() => {
          // Convert MapSchema to object for client
          const effects = {};
          player.statusEffects.forEach((effect, effectId) => {
            effects[effectId] = {
              effectId: effect.effectId,
              sourceSpellId: effect.sourceSpellId,
              sourceUserId: effect.sourceUserId,
              duration: effect.duration,
              stacks: effect.stacks,
              data: effect.data // Client can parse JSON if needed
            };
          });
          return effects;
        })() : {},
        isInvisible: player.isInvisible || false,
        invisibilitySource: player.invisibilitySource || '',
        invisibilityDuration: player.invisibilityDuration || 0
      };

      // Position is now included in playerData above, orientation is always included

      players[userId] = playerData;
    });

    return {
      teamId: teamState.teamId,
      players,
      startZone: Array.from(teamState.startZone)
    };
  }

  /**
   * Handle movement request
   */
  handleMovementRequest(client, message) {
    const userId = client.userId;
    const team = this.userTeams.get(userId);
    
    // Only allow during game phase and if it's the player's turn
    if (!team || this.state.phase !== GAME_PHASES.GAME) {
      console.log(`Movement denied: not in game phase`);
      return;
    }
    
    if (this.state.currentPlayerId !== userId) {
      console.log(`Movement denied: not ${userId}'s turn`);
      return;
    }
    
    const { x, y, path: clientPath } = message;
    if (x === undefined || y === undefined) {
      console.log(`Movement denied: invalid coordinates`);
      return;
    }
    
    const player = this.getPlayerById(userId);
    if (!player) {
      console.log(`Movement denied: player not found`);
      return;
    }
    
    const currentX = player.position.x;
    const currentY = player.position.y;
    
    // Use the previsualized path from the client, or calculate if not provided
    let path = [];
    if (clientPath && Array.isArray(clientPath) && clientPath.length > 0) {
      // Validate the client-provided path
      const pathStart = clientPath[0];
      const pathEnd = clientPath[clientPath.length - 1];
      
      // Verify path starts at current position and ends at target
      if (pathStart.x === currentX && pathStart.y === currentY && 
          pathEnd.x === x && pathEnd.y === y) {
        path = clientPath;
        console.log(`Using client-provided path, length: ${path.length}`);
      } else {
        console.log(`Movement denied: client path doesn't match start/end positions`);
        return;
      }
    } else {
      // Fallback: calculate path if client didn't provide one
      if (!this.terrain) {
        console.log(`Movement denied: terrain not loaded`);
        return;
      }
      
      // Get occupied tiles (excluding the moving player)
      const occupiedTiles = new Set();
      this.state.teamA.players.forEach((p, id) => {
        if (id !== userId && p.position) {
          occupiedTiles.add(`${p.position.x}_${p.position.y}`);
        }
      });
      this.state.teamB.players.forEach((p, id) => {
        if (p.position) {
          occupiedTiles.add(`${p.position.x}_${p.position.y}`);
        }
      });
      
      // Add spawned entities that block movement
      this.state.spawnedEntities.forEach((entity, entityId) => {
        if (entity.position) {
          try {
            const entityData = JSON.parse(entity.data || '{}');
            if (entityData.blocksMovement) {
              const tileKey = `${entity.position.x}_${entity.position.y}`;
              occupiedTiles.add(tileKey);
              console.log(`Entity ${entityId} at (${entity.position.x}, ${entity.position.y}) blocks movement`);
            }
          } catch (error) {
            console.warn(`Failed to parse entity data for ${entityId}:`, error);
          }
        }
      });
      
      // Calculate path (pass gameRoom to check ground effects and terrain modifications)
      path = findPath(this.terrain, currentX, currentY, x, y, occupiedTiles, this);
      
      if (path.length === 0) {
        console.log(`Movement denied: no valid path found`);
        return;
      }
      console.log(`Calculated path server-side, length: ${path.length}`);
    }
    
    // Validate path is walkable (security check)
    if (this.terrain) {
      for (const step of path) {
        if (step.x < 0 || step.y < 0 || 
            step.y >= this.terrain.length || 
            step.x >= this.terrain[0].length ||
            !isTileWalkable(this.terrain[step.y][step.x])) {
          console.log(`Movement denied: path contains unwalkable tile at (${step.x}, ${step.y})`);
          return;
        }
      }
    }
    
    // Path cost is path length - 1 (excluding start position)
    const pathCost = path.length - 1;
    
    // Check if player has enough movement points
    const availableMP = player.movementPoints - player.usedMovementPoints;
    if (pathCost > availableMP) {
      console.log(`Movement denied: not enough movement points (need ${pathCost}, have ${availableMP})`);
      return;
    }
    
    // Update position and used movement points
    player.position.x = x;
    player.position.y = y;
    player.usedMovementPoints += pathCost;
    
    // Check for ground effect at new position (onEnter)
    const newPosKey = `${x}_${y}`;
    const groundEffect = this.state.groundEffects.get(newPosKey);
    if (groundEffect) {
      try {
        const effectData = JSON.parse(groundEffect.data || '{}');
        if (effectData.onEnter) {
          if (effectData.onEnter.damage) {
            player.health -= effectData.onEnter.damage;
            if (player.health < 0) player.health = 0;
            console.log(`Player ${userId} entered ground effect ${groundEffect.effectId}, took ${effectData.onEnter.damage} damage, health now: ${player.health}`);
          }
          if (effectData.onEnter.heal) {
            player.health += effectData.onEnter.heal;
            if (player.health > player.maxHealth) player.health = player.maxHealth;
            console.log(`Player ${userId} entered ground effect ${groundEffect.effectId}, healed ${effectData.onEnter.heal}, health now: ${player.health}`);
          }
          // Apply status effect if specified
          if (effectData.onEnter.statusEffect) {
            this.applyStatusEffect(player, effectData.onEnter.statusEffect, groundEffect.sourceSpellId, groundEffect.sourceUserId);
          }
        }
      } catch (error) {
        console.error(`Error processing ground effect onEnter for ${userId}:`, error);
      }
    }
    
    // Store the path for clients to use
    player.movementPath = JSON.stringify(path);
    
    // Recalculate orientation to face movement direction (use last step of path)
    if (path.length > 1) {
      const lastStep = path[path.length - 1];
      const secondLastStep = path[path.length - 2];
      player.orientation = Math.atan2(lastStep.y - secondLastStep.y, lastStep.x - secondLastStep.x);
    } else if (x !== currentX || y !== currentY) {
      player.orientation = Math.atan2(y - currentY, x - currentX);
    }
    
    console.log(`Player ${userId} moved to (${x}, ${y}), used ${pathCost} MP (${player.usedMovementPoints}/${player.movementPoints}), path length: ${path.length}`);
    
    this.broadcastFilteredState();
    
    // Clear movement path after a short delay (allows clients to receive it)
    setTimeout(() => {
      const updatedPlayer = this.getPlayerById(userId);
      if (updatedPlayer) {
        updatedPlayer.movementPath = '';
      }
    }, 100);
  }

  /**
   * Handle spell cast request
   */
  /**
   * Handle spell preparation (when player selects a spell)
   */
  handleSpellPrep(client, message) {
    const userId = client.userId;
    
    if (this.state.phase !== GAME_PHASES.GAME) {
      return;
    }
    
    // Verify it's this player's turn
    if (this.state.currentPlayerId !== userId) {
      return;
    }
    
    const { spellId } = message;
    
    // Get spell definition to include prep animation info
    const spell = getSpell(spellId);
    const prepAnimDef = spell?.animations?.prep || null;
    
    // Broadcast spell preparation to all clients with animation definition
    this.broadcast('spellPrep', {
      userId: userId,
      spellId: spellId,
      prepAnimDef: prepAnimDef // Include prep animation definition so clients don't need to look it up
    });
  }

  /**
   * Handle spell preparation cancellation (when player deselects a spell)
   */
  handleSpellPrepCancel(client, message) {
    const userId = client.userId;
    
    if (this.state.phase !== GAME_PHASES.GAME) {
      return;
    }
    
    // Broadcast spell preparation cancellation to all clients
    this.broadcast('spellPrepCancel', {
      userId: userId
    });
  }

  handleSpellCast(client, message) {
    const userId = client.userId;
    const team = this.userTeams.get(userId);
    
    // Only allow during game phase and if it's the player's turn
    if (!team || this.state.phase !== GAME_PHASES.GAME) {
      console.log(`Spell cast denied: not in game phase`);
      return;
    }
    
    if (this.state.currentPlayerId !== userId) {
      console.log(`Spell cast denied: not ${userId}'s turn`);
      return;
    }
    
    const { spellId, targetX, targetY, targets } = message;
    
    // Check if this is a multi-target spell
    const isMultiTarget = Array.isArray(targets) && targets.length > 0;
    
    if (!spellId) {
      console.log(`Spell cast denied: invalid spellId`);
      return;
    }
    
    if (!isMultiTarget && (targetX === undefined || targetY === undefined)) {
      console.log(`Spell cast denied: invalid parameters (single target)`);
      return;
    }
    
    if (isMultiTarget && targets.length === 0) {
      console.log(`Spell cast denied: invalid parameters (multi-target with empty array)`);
      return;
    }
    
    const player = this.getPlayerById(userId);
    if (!player) {
      console.log(`Spell cast denied: player not found`);
      return;
    }
    
    // Get spell definition
    const spell = getSpell(spellId);
    if (!spell) {
      console.log(`Spell cast denied: spell "${spellId}" not found`);
      return;
    }
    
    // Parse spell loadout
    const loadout = player.spellLoadout ? JSON.parse(player.spellLoadout) : [];
    
    // Validate spell can be cast
    const validation = validateSpellForCaster(spellId, {
      userId: player.userId,
      loadout: loadout,
      energyLeft: player.energy,
      position: { x: player.position.x, y: player.position.y }
    });
    
    if (!validation.valid) {
      console.log(`Spell cast denied: ${validation.error}`);
      return;
    }
    
    // Validate targets
    const targeting = spell.targeting || {};
    const range = targeting.range || { min: 0, max: 10 };
    const playerX = player.position.x;
    const playerY = player.position.y;
    
    // Prepare targets array for processing
    const targetsToProcess = isMultiTarget ? targets : [{ x: targetX, y: targetY }];
    
    // Validate all targets are in range and valid
    for (const target of targetsToProcess) {
      const distance = Math.abs(target.x - playerX) + Math.abs(target.y - playerY);
      
      if (distance < range.min || distance > range.max) {
        console.log(`Spell cast denied: target (${target.x}, ${target.y}) out of range (distance: ${distance}, range: ${range.min}-${range.max})`);
        return;
      }
      
      // Validate target tile is valid (if targeting CELL)
      if (targeting.targetType === 'CELL' && this.terrain) {
        if (target.y < 0 || target.y >= this.terrain.length || 
            target.x < 0 || target.x >= this.terrain[0].length) {
          console.log(`Spell cast denied: target (${target.x}, ${target.y}) out of bounds`);
          return;
        }
        
        const targetTileType = this.terrain[target.y][target.x];
        
        // Water tiles cannot be targeted
        if (targetTileType === TILE_TYPES.WATER) {
          console.log(`Spell cast denied: cannot target water tile at (${target.x}, ${target.y})`);
          return;
        }
        
        // Only walkable tiles (TILE) can be targeted
        if (targetTileType !== TILE_TYPES.TILE) {
          console.log(`Spell cast denied: target tile (${target.x}, ${target.y}) is not targetable`);
          return;
        }
      }
      
      // Validate line of sight if required
      if (targeting.requiresLoS && this.terrain) {
        // Collect all occupied tiles (player positions and blocking entities)
        const occupiedTiles = new Set();
        this.state.teamA.players.forEach((p, id) => {
          if (p.position) {
            occupiedTiles.add(`${p.position.x}_${p.position.y}`);
          }
        });
        this.state.teamB.players.forEach((p, id) => {
          if (p.position) {
            occupiedTiles.add(`${p.position.x}_${p.position.y}`);
          }
        });
        
        // Add spawned entities that block vision
        this.state.spawnedEntities.forEach((entity, entityId) => {
          if (entity.position) {
            try {
              const entityData = JSON.parse(entity.data || '{}');
              if (entityData.blocksVision) {
                const tileKey = `${entity.position.x}_${entity.position.y}`;
                occupiedTiles.add(tileKey);
              }
            } catch (error) {
              // Ignore parse errors
            }
          }
        });
        
        // Create blocks function (exclude caster's position so they don't block their own LOS)
        const blocks = createTerrainBlocksFunction(this.terrain, TILE_TYPES, occupiedTiles, { x: playerX, y: playerY }, doesTileBlockLOS);
        const hasLineOfSight = hasLOS(
          { x: playerX, y: playerY },
          { x: target.x, y: target.y },
          blocks
        );
        
        if (!hasLineOfSight) {
          console.log(`Spell cast denied: no line of sight to target (${target.x}, ${target.y})`);
          return;
        }
      }
    }
    
    // Deduct energy cost
    player.energy -= spell.cost.energy;
    if (player.energy < 0) {
      player.energy = 0;
    }
    
    // Track targets that take damage for hit animations
    const damagedTargets = new Set();
    
    // Get pattern for area effects
    const pattern = targeting.pattern || 'SINGLE';
    
    // Process each target (for multi-target spells, process each one)
    targetsToProcess.forEach(target => {
      // Get all affected units based on pattern for this target
      let affectedUnits = [];
      if (targeting.targetType === 'SELF') {
        // Self-targeting: only affect caster
        affectedUnits = [player];
      } else if (targeting.targetType === 'UNIT') {
        // Unit targeting: find unit at target position
        let targetPlayer = null;
        this.state.teamA.players.forEach((p, id) => {
          if (p.position && p.position.x === target.x && p.position.y === target.y) {
            targetPlayer = p;
          }
        });
        if (!targetPlayer) {
          this.state.teamB.players.forEach((p, id) => {
            if (p.position && p.position.x === target.x && p.position.y === target.y) {
              targetPlayer = p;
            }
          });
        }
        if (targetPlayer) {
          // Check invisibility - can't target invisible enemies unless spell ignores invisibility
          if (targetPlayer.team !== team && targetPlayer.isInvisible) {
            // Check if target is revealed
            let isRevealed = false;
            if (targetPlayer.statusEffects) {
              targetPlayer.statusEffects.forEach((effect, effectId) => {
                try {
                  const effectData = JSON.parse(effect.data || '{}');
                  if (effectData.blocksInvisibility) {
                    isRevealed = true;
                  }
                } catch (error) {
                  // Ignore parse errors
                }
              });
            }
            if (!isRevealed && !spell.ignoresInvisibility) {
              console.log(`Spell cast denied: target ${targetPlayer.username} is invisible`);
              return; // Skip this target
            }
          }
          affectedUnits = [targetPlayer];
        }
      } else if (targeting.targetType === 'CELL') {
        // Cell targeting: use pattern to find all units in area
        affectedUnits = getUnitsInPattern(
          this,
          target.x,
          target.y,
          pattern,
          targeting.unitFilter || 'ANY',
          team,
          playerX,
          playerY
        );
      }
      
      // Special handling for teleportation spell - move caster to target cell
      if (spellId === 'teleportation' && targeting.targetType === 'CELL') {
        // Get cast animation definition to determine delay
        const castAnimDef = spell.animations?.cast || null;
        const teleportDelayMs = castAnimDef?.impactDelayMs || 1000; // Default 1 second delay
        
        // Store teleport destination for delayed execution
        const oldX = player.position.x;
        const oldY = player.position.y;
        const newX = target.x;
        const newY = target.y;
        
        console.log(`Player ${userId} casting teleportation, will move from (${oldX}, ${oldY}) to (${newX}, ${newY}) after ${teleportDelayMs}ms delay`);
        
        // Delay the actual position change to allow cast animation to play
        setTimeout(() => {
          // Update position
          player.position.x = newX;
          player.position.y = newY;
          
          // Update orientation to face movement direction
          if (newX !== oldX || newY !== oldY) {
            player.orientation = Math.atan2(newY - oldY, newX - oldX);
          }
          
          console.log(`Player ${userId} teleported from (${oldX}, ${oldY}) to (${newX}, ${newY})`);
          
          // Broadcast updated state with new position
          this.broadcastFilteredState();
          
          // Send teleport confirmation after position update
          setTimeout(() => {
            this.broadcast('teleportConfirm', {
              userId: userId,
              destinationX: newX,
              destinationY: newY
            });
          }, 50);
        }, teleportDelayMs);
        
        // Skip normal effect processing for teleportation
        // (it doesn't have damage/heal effects, just movement)
      } else if (spell.effects && spell.effects.length > 0) {
        // Apply spell effects to all affected units for this target
        spell.effects.forEach(effect => {
          if (effect.kind === 'DAMAGE') {
            // Apply damage to all affected units
            affectedUnits.forEach(targetPlayer => {
              targetPlayer.health -= effect.amount;
              if (targetPlayer.health < 0) {
                targetPlayer.health = 0;
              }
              damagedTargets.add(targetPlayer.userId);
              console.log(`Applied ${effect.amount} ${effect.damageType || 'damage'} to ${targetPlayer.username}, health now: ${targetPlayer.health}`);
            });
          } else if (effect.kind === 'HEAL') {
            // Apply heal to all affected units
            affectedUnits.forEach(targetPlayer => {
              targetPlayer.health += effect.amount;
              if (targetPlayer.health > targetPlayer.maxHealth) {
                targetPlayer.health = targetPlayer.maxHealth;
              }
              console.log(`Healed ${targetPlayer.username} for ${effect.amount}, health now: ${targetPlayer.health}/${targetPlayer.maxHealth}`);
            });
          } else if (effect.kind === 'MOVEMENT') {
            // Apply movement points to all affected units
            affectedUnits.forEach(targetPlayer => {
              // Add movement points (can exceed max, will be capped at end of turn)
              targetPlayer.movementPoints += effect.amount;
              console.log(`Added ${effect.amount} movement points to ${targetPlayer.username}, movement points now: ${targetPlayer.movementPoints} (max: ${targetPlayer.maxMovementPoints})`);
            });
          } else if (effect.kind === 'STATUS_EFFECT') {
            // Apply status effect to all affected units
            if (effect.statusEffect) {
              const statusDef = effect.statusEffect;
              affectedUnits.forEach(targetPlayer => {
                this.applyStatusEffect(targetPlayer, statusDef, spellId, userId);
              });
            }
          } else if (effect.kind === 'GROUND_EFFECT') {
            // Apply ground effect at target location
            if (effect.groundEffect) {
              this.applyGroundEffect(target.x, target.y, effect.groundEffect, spellId, userId);
            }
          } else if (effect.kind === 'TERRAIN_CHANGE') {
            // Apply terrain modification at target location
            if (effect.terrainChange) {
              this.applyTerrainModification(target.x, target.y, effect.terrainChange, spellId, userId);
            }
          } else if (effect.kind === 'SPAWN_ENTITY') {
            // Spawn entity at target location
            if (effect.spawnEntity) {
              this.spawnEntity(target.x, target.y, effect.spawnEntity, spellId, userId, team);
            }
          }
        });
      }
    });
    
    const targetDescription = isMultiTarget 
      ? `${targetsToProcess.length} targets: ${targetsToProcess.map(t => `(${t.x}, ${t.y})`).join(', ')}`
      : `(${targetX}, ${targetY})`;
    console.log(`Player ${userId} cast ${spellId} at ${targetDescription}, energy now: ${player.energy}`);
    
    // Cancel spell preparation (stop stance animation) before casting
    this.broadcast('spellPrepCancel', {
      userId: userId
    });
    
    // Get cast animation definition to include in broadcast
    const castAnimDef = spell.animations?.cast || null;
    
    // Get VFX definitions to include in broadcast
    const presentation = spell.presentation || {};
    
    // Broadcast spell cast event to all clients so they can play animations and VFX
    const broadcastMessage = {
      userId: userId,
      spellId: spellId,
      castAnimDef: castAnimDef, // Include cast animation definition so clients don't need to look it up
      presentation: {
        projectileVfx: presentation.projectileVfx || null,
        impactVfxDef: presentation.impactVfxDef || null,
        groundEffectVfx: presentation.groundEffectVfx || null
      }
    };
    
    // Include targets array for multi-target spells, or single targetX/targetY for backward compatibility
    if (isMultiTarget) {
      broadcastMessage.targets = targetsToProcess;
    } else {
      broadcastMessage.targetX = targetX;
      broadcastMessage.targetY = targetY;
    }
    
    this.broadcast('spellCast', broadcastMessage);
    
    // Get hit delay from cast animation definition (impactDelayMs)
    // This represents when the spell effect should visually occur relative to cast start
    const hitDelayMs = castAnimDef?.impactDelayMs || 0;
    
    // Broadcast hit animations for all damaged targets after the delay
    damagedTargets.forEach(targetUserId => {
      if (hitDelayMs > 0) {
        // Delay the hit animation broadcast for ranged attacks
        setTimeout(() => {
          this.broadcast('spellHit', {
            targetUserId: targetUserId,
            casterUserId: userId,
            spellId: spellId
          });
        }, hitDelayMs);
      } else {
        // Immediate hit for melee attacks
        this.broadcast('spellHit', {
          targetUserId: targetUserId,
          casterUserId: userId,
          spellId: spellId
        });
      }
    });
    
    this.broadcastFilteredState();
    
    // Note: For teleportation spell, position update and teleportConfirm are delayed
    // (handled in the spell effect processing above with setTimeout)
  }

  /**
   * Handle player ready status
   */
  handlePositionChangeRequest(client, message) {
    const userId = client.userId;
    const team = this.userTeams.get(userId);
    
    // Only allow during preparation phase
    if (!team || this.state.phase !== GAME_PHASES.PREPARATION) {
      console.log(`Position change denied: not in preparation phase or invalid team`);
      return;
    }
    
    const { x, y } = message;
    if (x === undefined || y === undefined) {
      console.log(`Position change denied: invalid coordinates`);
      return;
    }
    
    const teamState = team === 'A' ? this.state.teamA : this.state.teamB;
    const player = teamState.players.get(userId);
    
    if (!player) {
      console.log(`Position change denied: player not found`);
      return;
    }
    
    // Check if the requested position is in the team's start zone
    const startZone = teamState.startZone || [];
    const isValidStartPosition = startZone.some(pos => pos.x === x && pos.y === y);
    
    if (!isValidStartPosition) {
      console.log(`Position change denied: (${x}, ${y}) is not a valid starting position for team ${team}`);
      return;
    }
    
    // Check if the position is already occupied by another player
    // teamState.players is a MapSchema, so we need to iterate using forEach
    let isOccupied = false;
    teamState.players.forEach((p, otherUserId) => {
      if (otherUserId !== userId && 
          p.position && 
          p.position.x === x && 
          p.position.y === y) {
        isOccupied = true;
      }
    });
    
    if (isOccupied) {
      console.log(`Position change denied: (${x}, ${y}) is already occupied`);
      return;
    }
    
    // Update player position
    player.position.x = x;
    player.position.y = y;
    
    // Recalculate orientation to face enemy team
    const enemyTeamState = team === 'A' ? this.state.teamB : this.state.teamA;
    const enemyStartZone = enemyTeamState.startZone || [];
    
    if (enemyStartZone.length > 0) {
      // Calculate center of enemy team
      const enemyCenterX = enemyStartZone.reduce((sum, pos) => sum + pos.x, 0) / enemyStartZone.length;
      const enemyCenterY = enemyStartZone.reduce((sum, pos) => sum + pos.y, 0) / enemyStartZone.length;
      
      // Calculate angle to face enemy team
      const angle = Math.atan2(enemyCenterY - y, enemyCenterX - x);
      player.orientation = angle;
    }
    
    console.log(`Player ${userId} moved to position (${x}, ${y})`);
    
    // Broadcast updated state to all clients
    this.broadcastFilteredState();
  }

  handlePlayerReady(client, message) {
    const userId = client.userId;
    const team = this.userTeams.get(userId);
    
    if (!team || this.state.phase !== GAME_PHASES.PREPARATION) {
      return;
    }

    const teamState = team === 'A' ? this.state.teamA : this.state.teamB;
    const player = teamState.players.get(userId);
    
    if (player) {
      // Toggle ready state based on message
      // If message.ready is explicitly false, set to false
      // Otherwise, toggle the current state
      if (message.ready === false) {
        player.ready = false;
      } else if (message.ready === true) {
        player.ready = true;
      } else {
        // If not specified, toggle
        player.ready = !player.ready;
      }
      
      console.log(`Player ${userId} ready status: ${player.ready}`);
      this.broadcastFilteredState();

      // Check if all players are ready and start game
      this.checkAllPlayersReady();
    }
  }

  /**
   * Check if all players are ready and start the game
   */
  checkAllPlayersReady() {
    // Check if all players in both teams are ready
    let allTeamAReady = true;
    let allTeamBReady = true;

    this.state.teamA.players.forEach((player) => {
      if (!player.ready) {
        allTeamAReady = false;
      }
    });

    this.state.teamB.players.forEach((player) => {
      if (!player.ready) {
        allTeamBReady = false;
      }
    });

    if (allTeamAReady && allTeamBReady) {
      console.log(`All players ready, starting game for match ${this.state.matchId}`);
      this.startGamePhase();
    }
  }

  /**
   * Handle player action (move, spell, etc.)
   */
  handlePlayerAction(client, message) {
    const userId = client.userId;
    
    if (this.state.phase !== GAME_PHASES.GAME) {
      return;
    }

    // Process action based on message type
    // This will be expanded based on game mechanics
    console.log(`Player ${userId} action:`, message);
    
    // Broadcast updated state
    this.broadcastFilteredState();
  }

  /**
   * Apply a ground effect at a location
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} groundDef - Ground effect definition
   * @param {string} sourceSpellId - Spell that created this
   * @param {string} sourceUserId - User who cast the spell
   */
  applyGroundEffect(x, y, groundDef, sourceSpellId, sourceUserId) {
    const radius = groundDef.radius || 1;
    const cells = getCellsInRadius(x, y, radius);
    
    cells.forEach(cell => {
      const cellKey = `${cell.x}_${cell.y}`;
      
      // Check if terrain is valid (not a wall unless allowed)
      if (this.terrain) {
        if (cell.y < 0 || cell.y >= this.terrain.length || 
            cell.x < 0 || cell.x >= this.terrain[0].length) {
          return; // Skip out of bounds
        }
        
        // Only apply to walkable tiles (unless ground effect can be on walls)
        if (this.terrain[cell.y][cell.x] !== TILE_TYPES.TILE) {
          return; // Skip non-walkable tiles
        }
      }
      
      // Create or update ground effect
      let groundEffect = this.state.groundEffects.get(cellKey);
      
      if (!groundEffect) {
        groundEffect = new GroundEffectState();
        groundEffect.x = cell.x;
        groundEffect.y = cell.y;
        this.state.groundEffects.set(cellKey, groundEffect);
      }
      
      groundEffect.effectId = groundDef.effectId;
      groundEffect.sourceSpellId = sourceSpellId;
      groundEffect.sourceUserId = sourceUserId;
      groundEffect.radius = 1; // Each cell has radius 1 (the effect covers the cell)
      groundEffect.duration = groundDef.duration || 0;
      
      // Store effect data as JSON
      const effectData = {
        onEnter: groundDef.onEnter || {},
        onTurnStart: groundDef.onTurnStart || {},
        onTurnEnd: groundDef.onTurnEnd || {},
        blocksMovement: groundDef.blocksMovement || false,
        blocksVision: groundDef.blocksVision || false
      };
      groundEffect.data = JSON.stringify(effectData);
      
      console.log(`Applied ground effect ${groundDef.effectId} at (${cell.x}, ${cell.y}) for ${groundEffect.duration} turns`);
    });
  }

  /**
   * Apply terrain modification
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} terrainChangeDef - Terrain change definition
   * @param {string} sourceSpellId - Spell that created this
   * @param {string} sourceUserId - User who cast the spell
   */
  applyTerrainModification(x, y, terrainChangeDef, sourceSpellId, sourceUserId) {
    if (!this.terrain) {
      console.warn('Cannot apply terrain modification: terrain not loaded');
      return;
    }
    
    const radius = terrainChangeDef.radius || 1;
    const cells = getCellsInRadius(x, y, radius);
    
    cells.forEach(cell => {
      if (cell.y < 0 || cell.y >= this.terrain.length || 
          cell.x < 0 || cell.x >= this.terrain[0].length) {
        return; // Skip out of bounds
      }
      
      const originalType = this.terrain[cell.y][cell.x];
      
      // Check if this cell matches the fromType
      if (originalType !== terrainChangeDef.fromType) {
        return; // Can only change from the specified type
      }
      
      const cellKey = `${cell.x}_${cell.y}`;
      
      // Create or update terrain modification
      let terrainMod = this.state.terrainModifications.get(cellKey);
      
      if (!terrainMod) {
        terrainMod = new TerrainModState();
        terrainMod.x = cell.x;
        terrainMod.y = cell.y;
        terrainMod.originalType = originalType;
        this.state.terrainModifications.set(cellKey, terrainMod);
      }
      
      terrainMod.newType = terrainChangeDef.toType;
      terrainMod.duration = terrainChangeDef.duration || 0;
      terrainMod.sourceSpellId = sourceSpellId;
      terrainMod.sourceUserId = sourceUserId;
      
      console.log(`Modified terrain at (${cell.x}, ${cell.y}) from ${originalType} to ${terrainChangeDef.toType} for ${terrainMod.duration} turns`);
    });
  }

  /**
   * Process ground effects for a player at their position
   * @param {PlayerState} player - Player to check
   */
  processGroundEffectsForPlayer(player) {
    if (!player.position) return;
    
    const posKey = `${player.position.x}_${player.position.y}`;
    const groundEffect = this.state.groundEffects.get(posKey);
    
    if (groundEffect) {
      try {
        const effectData = JSON.parse(groundEffect.data || '{}');
        
        // Apply onTurnStart effects
        if (effectData.onTurnStart) {
          if (effectData.onTurnStart.damage) {
            player.health -= effectData.onTurnStart.damage;
            if (player.health < 0) player.health = 0;
            console.log(`Ground effect ${groundEffect.effectId} dealt ${effectData.onTurnStart.damage} damage to ${player.username}, health now: ${player.health}`);
          }
          if (effectData.onTurnStart.heal) {
            player.health += effectData.onTurnStart.heal;
            if (player.health > player.maxHealth) player.health = player.maxHealth;
            console.log(`Ground effect ${groundEffect.effectId} healed ${effectData.onTurnStart.heal} to ${player.username}, health now: ${player.health}`);
          }
        }
      } catch (error) {
        console.error(`Error processing ground effect for ${player.username}:`, error);
      }
    }
  }

  /**
   * Process all ground effects and terrain modifications at end of turn
   */
  processGroundEffectsAndTerrain() {
    // Process ground effects - decrement duration
    const groundEffectsToRemove = [];
    this.state.groundEffects.forEach((effect, key) => {
      if (effect.duration > 0) {
        effect.duration--;
        if (effect.duration <= 0) {
          groundEffectsToRemove.push(key);
        }
      }
    });
    
    groundEffectsToRemove.forEach(key => {
      this.state.groundEffects.delete(key);
      console.log(`Ground effect at ${key} expired`);
    });
    
    // Process terrain modifications - decrement duration
    const terrainModsToRemove = [];
    this.state.terrainModifications.forEach((mod, key) => {
      if (mod.duration > 0) {
        mod.duration--;
        if (mod.duration <= 0) {
          terrainModsToRemove.push(key);
        }
      }
    });
    
    terrainModsToRemove.forEach(key => {
      const mod = this.state.terrainModifications.get(key);
      if (mod && this.terrain) {
        // Revert terrain to original type
        if (mod.y >= 0 && mod.y < this.terrain.length && 
            mod.x >= 0 && mod.x < this.terrain[0].length) {
          // Note: We store originalType but don't actually modify the terrain array
          // The terrainModifications map is the source of truth
          console.log(`Terrain modification at (${mod.x}, ${mod.y}) expired, reverting to original type ${mod.originalType}`);
        }
      }
      this.state.terrainModifications.delete(key);
    });
  }

  /**
   * Apply invisibility to a player
   * @param {PlayerState} player - Player to make invisible
   * @param {number} duration - Turns invisibility lasts
   * @param {string} sourceSpellId - Spell that granted invisibility
   */
  applyInvisibility(player, duration, sourceSpellId) {
    player.isInvisible = true;
    player.invisibilitySource = sourceSpellId;
    player.invisibilityDuration = duration;
    console.log(`Applied invisibility to ${player.username} for ${duration} turns`);
  }

  /**
   * Remove invisibility from a player
   * @param {PlayerState} player - Player to make visible
   */
  removeInvisibility(player) {
    if (player.isInvisible) {
      player.isInvisible = false;
      player.invisibilitySource = '';
      player.invisibilityDuration = 0;
      console.log(`Removed invisibility from ${player.username}`);
    }
  }

  /**
   * Check if a viewer can see a target player
   * @param {PlayerState} viewer - Player trying to see
   * @param {PlayerState} target - Player being viewed
   * @returns {boolean} True if viewer can see target
   */
  canSeePlayer(viewer, target) {
    // Same team can always see each other
    if (viewer.team === target.team) {
      return true;
    }
    
    // Enemy is invisible - check if any status effects reveal them
    if (target.isInvisible) {
      // Check if target has any status effects that block invisibility
      if (target.statusEffects) {
        let isRevealed = false;
        target.statusEffects.forEach((effect, effectId) => {
          try {
            const effectData = JSON.parse(effect.data || '{}');
            if (effectData.blocksInvisibility) {
              isRevealed = true;
            }
          } catch (error) {
            // Ignore parse errors
          }
        });
        return isRevealed;
      }
      return false; // Invisible and not revealed
    }
    
    return true; // Not invisible
  }

  /**
   * Spawn an entity at a location
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} spawnDef - Spawn entity definition
   * @param {string} sourceSpellId - Spell that created this
   * @param {string} sourceUserId - User who cast the spell
   * @param {string} team - Team that owns the entity ('A' or 'B')
   */
  spawnEntity(x, y, spawnDef, sourceSpellId, sourceUserId, team) {
    // Check if terrain is valid
    if (this.terrain) {
      if (y < 0 || y >= this.terrain.length || 
          x < 0 || x >= this.terrain[0].length) {
        console.warn(`Cannot spawn entity: position (${x}, ${y}) out of bounds`);
        return;
      }
      
      // Only spawn on walkable tiles
      const terrainType = getTerrainType(this, x, y);
      if (terrainType !== TILE_TYPES.TILE) {
        console.warn(`Cannot spawn entity: position (${x}, ${y}) is not walkable`);
        return;
      }
    }
    
    // Check if position is occupied by a player
    let isOccupied = false;
    this.state.teamA.players.forEach((p, id) => {
      if (p.position && p.position.x === x && p.position.y === y) {
        isOccupied = true;
      }
    });
    if (!isOccupied) {
      this.state.teamB.players.forEach((p, id) => {
        if (p.position && p.position.x === x && p.position.y === y) {
          isOccupied = true;
        }
      });
    }
    
    // Check if position is occupied by another entity
    if (!isOccupied) {
      this.state.spawnedEntities.forEach((entity, entityId) => {
        if (entity.position && entity.position.x === x && entity.position.y === y) {
          isOccupied = true;
        }
      });
    }
    
    if (isOccupied) {
      console.warn(`Cannot spawn entity: position (${x}, ${y}) is occupied`);
      return;
    }
    
    // For earth_block entities, enforce limit of 2 per user
    // When spawning a third, remove the oldest one
    if (spawnDef.entityType === 'earth_block') {
      const userEarthBlocks = [];
      
      // Collect all earth_blocks for this user
      this.state.spawnedEntities.forEach((entity, entityId) => {
        if (entity.entityType === 'earth_block' && entity.sourceUserId === sourceUserId) {
          // Extract timestamp from entityId (format: entity_timestamp_random)
          const match = entityId.match(/entity_(\d+)_/);
          const timestamp = match ? parseInt(match[1], 10) : 0;
          userEarthBlocks.push({ entityId, timestamp, entity });
        }
      });
      
      // If user already has 2 blocks, remove the oldest one
      if (userEarthBlocks.length >= 2) {
        // Sort by timestamp (oldest first)
        userEarthBlocks.sort((a, b) => a.timestamp - b.timestamp);
        const oldestBlock = userEarthBlocks[0];
        
        console.log(`User ${sourceUserId} has ${userEarthBlocks.length} earth blocks, removing oldest: ${oldestBlock.entityId}`);
        this.state.spawnedEntities.delete(oldestBlock.entityId);
      }
    }
    
    // Generate unique entity ID
    const entityId = `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create entity
    const entity = new SpawnedEntityState();
    entity.entityId = entityId;
    entity.entityType = spawnDef.entityType;
    entity.sourceSpellId = sourceSpellId;
    entity.sourceUserId = sourceUserId;
    entity.team = team;
    entity.position.x = x;
    entity.position.y = y;
    entity.health = spawnDef.health || 0;
    entity.maxHealth = spawnDef.health || 0;
    entity.duration = spawnDef.duration || 0;
    
    // Store entity data as JSON
    // If spawnDef.data is already a JSON string, parse it and merge with defaults
    // Otherwise, build from individual properties
    let entityData = {};
    if (spawnDef.data) {
      try {
        entityData = JSON.parse(spawnDef.data);
        console.log(`Parsed entity data from spawnDef:`, entityData);
      } catch (error) {
        console.warn(`Failed to parse spawnDef.data:`, error, spawnDef.data);
        // If parsing fails, treat as empty object
        entityData = {};
      }
    }
    
    // Merge with default properties (don't overwrite existing ones from parsed data)
    // Use === undefined to preserve false values
    if (entityData.trigger === undefined) entityData.trigger = spawnDef.trigger || null;
    if (entityData.onTrigger === undefined) entityData.onTrigger = spawnDef.onTrigger || {};
    if (entityData.onDeath === undefined) entityData.onDeath = spawnDef.onDeath || {};
    if (entityData.onTurnStart === undefined) entityData.onTurnStart = spawnDef.onTurnStart || {};
    
    // Preserve blocking flags - check both parsed data and spawnDef properties
    // The flags should already be in entityData if they were in spawnDef.data
    if (entityData.blocksMovement === undefined && spawnDef.blocksMovement !== undefined) {
      entityData.blocksMovement = spawnDef.blocksMovement;
    }
    if (entityData.blocksVision === undefined && spawnDef.blocksVision !== undefined) {
      entityData.blocksVision = spawnDef.blocksVision;
    }
    
    entity.data = JSON.stringify(entityData);
    
    // Debug log to verify blocking flags are set
    console.log(`Spawned entity ${entityId} (${spawnDef.entityType}) at (${x}, ${y}) with data:`, JSON.stringify(entityData, null, 2));
    console.log(`Entity blocksMovement: ${entityData.blocksMovement}, blocksVision: ${entityData.blocksVision}`);
    
    this.state.spawnedEntities.set(entityId, entity);
    console.log(`Spawned entity ${spawnDef.entityType} (${entityId}) at (${x}, ${y}) for team ${team} for ${entity.duration} turns`);
  }

  /**
   * Process spawned entities (check triggers, decrement duration)
   */
  processSpawnedEntities() {
    const entitiesToRemove = [];
    
    this.state.spawnedEntities.forEach((entity, entityId) => {
      // Check for triggers
      try {
        const entityData = JSON.parse(entity.data || '{}');
        
        if (entityData.trigger) {
          const trigger = entityData.trigger;
          
          if (trigger.type === 'MOVEMENT') {
            // Check if any enemy player moved onto this entity's position
            const enemyTeam = entity.team === 'A' ? 'B' : 'A';
            const enemyTeamState = enemyTeam === 'A' ? this.state.teamA : this.state.teamB;
            
            enemyTeamState.players.forEach((player, userId) => {
              if (player.position && 
                  player.position.x === entity.position.x && 
                  player.position.y === entity.position.y) {
                // Trigger activated!
                this.triggerEntity(entity, entityData, player);
                entitiesToRemove.push(entityId);
              }
            });
          } else if (trigger.type === 'PROXIMITY') {
            // Check if any enemy player is within radius
            const radius = trigger.radius || 1;
            const enemyTeam = entity.team === 'A' ? 'B' : 'A';
            const enemyTeamState = enemyTeam === 'A' ? this.state.teamA : this.state.teamB;
            
            enemyTeamState.players.forEach((player, userId) => {
              if (player.position) {
                const distance = Math.abs(player.position.x - entity.position.x) + 
                               Math.abs(player.position.y - entity.position.y);
                if (distance <= radius) {
                  // Trigger activated!
                  this.triggerEntity(entity, entityData, player);
                  entitiesToRemove.push(entityId);
                }
              }
            });
          }
        }
      } catch (error) {
        console.error(`Error processing entity ${entityId}:`, error);
      }
      
      // Decrement duration
      if (entity.duration > 0) {
        entity.duration--;
        if (entity.duration <= 0) {
          entitiesToRemove.push(entityId);
        }
      }
    });
    
    // Remove expired/triggered entities
    entitiesToRemove.forEach(entityId => {
      const entity = this.state.spawnedEntities.get(entityId);
      if (entity) {
        try {
          const entityData = JSON.parse(entity.data || '{}');
          // Check for onDeath effects
          if (entityData.onDeath) {
            // Apply onDeath effects (e.g., explosion damage)
            if (entityData.onDeath.damage && entityData.onDeath.radius) {
              const cells = getCellsInRadius(entity.position.x, entity.position.y, entityData.onDeath.radius);
              cells.forEach(cell => {
                // Find players in radius
                const affectedPlayers = getUnitsInPattern(
                  this,
                  cell.x,
                  cell.y,
                  'SINGLE',
                  'ANY',
                  entity.team,
                  entity.position.x,
                  entity.position.y
                );
                affectedPlayers.forEach(player => {
                  // Only damage enemies
                  if (player.team !== entity.team) {
                    player.health -= entityData.onDeath.damage;
                    if (player.health < 0) player.health = 0;
                    console.log(`Entity ${entityId} death dealt ${entityData.onDeath.damage} damage to ${player.username}`);
                  }
                });
              });
            }
          }
        } catch (error) {
          console.error(`Error processing entity death ${entityId}:`, error);
        }
        console.log(`Entity ${entityId} expired/triggered, removing`);
      }
      this.state.spawnedEntities.delete(entityId);
    });
  }

  /**
   * Trigger an entity (trap activated, etc.)
   * @param {SpawnedEntityState} entity - Entity being triggered
   * @param {Object} entityData - Parsed entity data
   * @param {PlayerState} triggerPlayer - Player that triggered the entity
   */
  triggerEntity(entity, entityData, triggerPlayer) {
    if (entityData.onTrigger) {
      if (entityData.onTrigger.damage) {
        triggerPlayer.health -= entityData.onTrigger.damage;
        if (triggerPlayer.health < 0) triggerPlayer.health = 0;
        console.log(`Entity ${entity.entityId} triggered, dealt ${entityData.onTrigger.damage} damage to ${triggerPlayer.username}`);
      }
      if (entityData.onTrigger.heal) {
        triggerPlayer.health += entityData.onTrigger.heal;
        if (triggerPlayer.health > triggerPlayer.maxHealth) triggerPlayer.health = triggerPlayer.maxHealth;
        console.log(`Entity ${entity.entityId} triggered, healed ${entityData.onTrigger.heal} to ${triggerPlayer.username}`);
      }
      if (entityData.onTrigger.statusEffect) {
        this.applyStatusEffect(triggerPlayer, entityData.onTrigger.statusEffect, entity.sourceSpellId, entity.sourceUserId);
      }
    }
  }

  /**
   * Apply a status effect to a player
   * @param {PlayerState} targetPlayer - Player to apply effect to
   * @param {Object} statusDef - Status effect definition
   * @param {string} sourceSpellId - Spell that applied this effect
   * @param {string} sourceUserId - User who cast the spell
   */
  applyStatusEffect(targetPlayer, statusDef, sourceSpellId, sourceUserId) {
    if (!targetPlayer.statusEffects) {
      targetPlayer.statusEffects = new MapSchema();
    }
    
    const effectId = statusDef.effectId;
    const existingEffect = targetPlayer.statusEffects.get(effectId);
    
    // Check if effect is stackable
    if (existingEffect && statusDef.stackable) {
      // Stack the effect
      const maxStacks = statusDef.maxStacks || 999;
      if (existingEffect.stacks < maxStacks) {
        existingEffect.stacks++;
        // Refresh duration when stacking
        existingEffect.duration = Math.max(existingEffect.duration, statusDef.duration);
        console.log(`Stacked ${effectId} on ${targetPlayer.username} (stacks: ${existingEffect.stacks})`);
      } else {
        console.log(`Cannot stack ${effectId} on ${targetPlayer.username} - max stacks reached (${maxStacks})`);
      }
    } else if (!existingEffect) {
      // Create new status effect
      const statusEffect = new StatusEffectState();
      statusEffect.effectId = effectId;
      statusEffect.sourceSpellId = sourceSpellId;
      statusEffect.sourceUserId = sourceUserId;
      statusEffect.duration = statusDef.duration;
      statusEffect.stacks = 1;
      
      // Store effect data as JSON
      const effectData = {
        onApply: statusDef.onApply || {},
        onTurnStart: statusDef.onTurnStart || {},
        onTurnEnd: statusDef.onTurnEnd || {},
        onRemove: statusDef.onRemove || {},
        type: statusDef.type || 'NEUTRAL',
        grantsInvisibility: statusDef.grantsInvisibility || false
      };
      statusEffect.data = JSON.stringify(effectData);
      
      targetPlayer.statusEffects.set(effectId, statusEffect);
      
      // Apply onApply effects
      if (effectData.onApply) {
        if (effectData.onApply.damage) {
          targetPlayer.health -= effectData.onApply.damage;
          if (targetPlayer.health < 0) targetPlayer.health = 0;
        }
        if (effectData.onApply.heal) {
          targetPlayer.health += effectData.onApply.heal;
          if (targetPlayer.health > targetPlayer.maxHealth) targetPlayer.health = targetPlayer.maxHealth;
        }
      }
      
      // Apply invisibility if status effect grants it
      if (effectData.grantsInvisibility) {
        this.applyInvisibility(targetPlayer, statusDef.duration, sourceSpellId);
      }
      
      console.log(`Applied status effect ${effectId} to ${targetPlayer.username} for ${statusDef.duration} turns`);
    } else {
      // Effect already exists and is not stackable - refresh duration
      existingEffect.duration = Math.max(existingEffect.duration, statusDef.duration);
      console.log(`Refreshed ${effectId} duration on ${targetPlayer.username} to ${existingEffect.duration} turns`);
    }
  }

  /**
   * Process status effects for a player at the start of their turn
   * @param {PlayerState} player - Player whose turn is starting
   */
  processTurnStartStatusEffects(player) {
    if (!player.statusEffects || player.statusEffects.size === 0) {
      return;
    }
    
    const effectsToRemove = [];
    
    player.statusEffects.forEach((effect, effectId) => {
      try {
        const effectData = JSON.parse(effect.data || '{}');
        
        // Apply onTurnStart effects
        if (effectData.onTurnStart) {
          if (effectData.onTurnStart.damage) {
            const damage = effectData.onTurnStart.damage * effect.stacks; // Scale by stacks
            player.health -= damage;
            if (player.health < 0) player.health = 0;
            console.log(`Status effect ${effectId} dealt ${damage} damage to ${player.username} (${effect.stacks} stacks), health now: ${player.health}`);
          }
          if (effectData.onTurnStart.heal) {
            const heal = effectData.onTurnStart.heal * effect.stacks; // Scale by stacks
            player.health += heal;
            if (player.health > player.maxHealth) player.health = player.maxHealth;
            console.log(`Status effect ${effectId} healed ${heal} to ${player.username} (${effect.stacks} stacks), health now: ${player.health}`);
          }
        }
        
        // Decrement duration
        effect.duration--;
        
        // Check if effect should be removed
        if (effect.duration <= 0) {
          // Apply onRemove effects
          if (effectData.onRemove) {
            if (effectData.onRemove.damage) {
              player.health -= effectData.onRemove.damage;
              if (player.health < 0) player.health = 0;
            }
            if (effectData.onRemove.heal) {
              player.health += effectData.onRemove.heal;
              if (player.health > player.maxHealth) player.health = player.maxHealth;
            }
          }
          
          // Remove invisibility if this effect granted it
          if (effectData.grantsInvisibility && player.invisibilitySource === effect.sourceSpellId) {
            this.removeInvisibility(player);
          }
          
          effectsToRemove.push(effectId);
          console.log(`Status effect ${effectId} expired on ${player.username}`);
        }
      } catch (error) {
        console.error(`Error processing status effect ${effectId} for ${player.username}:`, error);
        effectsToRemove.push(effectId); // Remove corrupted effects
      }
    });
    
    // Remove expired effects
    effectsToRemove.forEach(effectId => {
      player.statusEffects.delete(effectId);
    });
  }

  /**
   * Handle end turn
   */
  handleEndTurn(client, message) {
    const userId = client.userId;
    
    if (this.state.phase !== GAME_PHASES.GAME) {
      return;
    }
    
    // Verify it's this player's turn
    if (this.state.currentPlayerId !== userId) {
      console.log(`Player ${userId} tried to end turn, but it's not their turn`);
      return;
    }

    // Cancel any active spell preparation for the current player
    // This resets the character state and stops stance animations
    this.broadcast('spellPrepCancel', {
      userId: userId
    });
    console.log(`Cancelled spell preparation for ${userId} (ending turn)`);

    // Advance turn logic
    this.state.turn++;
    
    // Reset movement points for current player (they've used their turn)
    const currentPlayer = this.getPlayerById(userId);
    if (currentPlayer) {
      currentPlayer.usedMovementPoints = 0;
      // Cap movement points to max at end of turn (if they exceeded max from spells)
      if (currentPlayer.movementPoints > currentPlayer.maxMovementPoints) {
        currentPlayer.movementPoints = currentPlayer.maxMovementPoints;
        console.log(`Capped movement points for ${currentPlayer.username} to max: ${currentPlayer.maxMovementPoints}`);
      }
    }
    
    // Find next player and reset their used movement points
    // Also restore energy to max for the next player
    const currentIndex = this.state.turnOrder.indexOf(userId);
    if (currentIndex === -1) {
      console.error(`Current player ${userId} not found in turn order`);
      return;
    }
    
    // Move to next player (wrap around if at end)
    const nextIndex = (currentIndex + 1) % this.state.turnOrder.length;
    const nextPlayerId = this.state.turnOrder[nextIndex];
    this.state.currentPlayerId = nextPlayerId;
    
    // Reset movement points and restore energy for next player
    const nextPlayer = this.getPlayerById(nextPlayerId);
    if (nextPlayer) {
      nextPlayer.usedMovementPoints = 0;
      nextPlayer.energy = nextPlayer.maxEnergy; // Restore energy to max at start of turn
      // Ensure movement points are at max at start of turn (in case they were reduced)
      if (nextPlayer.movementPoints < nextPlayer.maxMovementPoints) {
        nextPlayer.movementPoints = nextPlayer.maxMovementPoints;
      }
      
      // Process status effects at the start of the turn
      this.processTurnStartStatusEffects(nextPlayer);
      
      // Process ground effects at player's position
      this.processGroundEffectsForPlayer(nextPlayer);
      
      // Process invisibility duration
      if (nextPlayer.isInvisible && nextPlayer.invisibilityDuration > 0) {
        nextPlayer.invisibilityDuration--;
        if (nextPlayer.invisibilityDuration <= 0) {
          this.removeInvisibility(nextPlayer);
        }
      }
    }
    
    // Process ground effects and terrain modifications (decrement durations)
    this.processGroundEffectsAndTerrain();
    
    // Process spawned entities (check triggers, decrement duration)
    this.processSpawnedEntities();
    
    console.log(`Turn ${this.state.turn}: Now ${nextPlayerId}'s turn`);
    
    this.broadcastFilteredState();
  }

  /**
   * Handle orientation update from client
   * Updates the player's facing direction for server-authoritative gameplay
   * @param {Client} client - The client sending the update
   * @param {Object} message - The message containing the new orientation
   */
  handleOrientationUpdate(client, message) {
    const userId = client.userId;
    const { orientation } = message;
    
    // Validate orientation is a number
    if (typeof orientation !== 'number' || isNaN(orientation)) {
      return;
    }
    
    // Get the player
    const player = this.getPlayerById(userId);
    if (!player) {
      return;
    }
    
    // Normalize orientation to [-PI, PI] range
    let normalizedOrientation = orientation;
    while (normalizedOrientation > Math.PI) normalizedOrientation -= 2 * Math.PI;
    while (normalizedOrientation < -Math.PI) normalizedOrientation += 2 * Math.PI;
    
    // Update player orientation
    player.orientation = normalizedOrientation;
    
    // Broadcast state update so other clients see the orientation change
    this.broadcastFilteredState();
  }

  /**
   * Get player by userId from either team
   */
  getPlayerById(userId) {
    const teamA = this.state.teamA.players.get(userId);
    if (teamA) return teamA;
    return this.state.teamB.players.get(userId);
  }
}
