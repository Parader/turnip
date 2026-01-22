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
    this.health = 100;
    this.maxHealth = 100;
    this.ready = false; // For preparation phase
    this.movementPoints = 0; // Total movement points available (can exceed max during turn)
    this.maxMovementPoints = 0; // Maximum movement points (base value from character class)
    this.usedMovementPoints = 0; // Movement points used this turn
    this.movementPath = ''; // JSON string array of path coordinates [{x, y}, ...]
    this.energy = 0; // Current energy
    this.maxEnergy = 0; // Maximum energy
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
  maxEnergy: 'number'
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
  stats: 'string' // Will be serialized as JSON string
});

// TILE_TYPES constants (matching client)
const TILE_TYPES = {
  NONE: 0,
  TILE: 1,
  WALL: 2
};

/**
 * A* pathfinding algorithm for grid movement (server-side)
 * Simplified version without preferred path support
 */
function findPath(terrain, startX, startY, endX, endY, occupiedTiles = new Set()) {
  const mapHeight = terrain.length;
  const mapWidth = terrain[0]?.length || 0;
  
  // Check if coordinates are valid
  if (startX < 0 || startX >= mapWidth || startY < 0 || startY >= mapHeight) {
    return [];
  }
  if (endX < 0 || endX >= mapWidth || endY < 0 || endY >= mapHeight) {
    return [];
  }
  
  // Check if start and end are walkable
  if (terrain[startY][startX] !== TILE_TYPES.TILE) {
    return [];
  }
  if (terrain[endY][endX] !== TILE_TYPES.TILE) {
    return [];
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
      
      // Skip if not walkable
      if (terrain[neighbor.y][neighbor.x] !== TILE_TYPES.TILE) {
        continue;
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
    const baseState = {
      matchId: this.state.matchId,
      mapId: this.state.mapId,
      queueType: this.state.queueType,
      phase: this.state.phase,
      turn: this.state.turn,
      currentPlayerId: this.state.currentPlayerId,
      turnOrder: Array.from(this.state.turnOrder) // Convert ArraySchema to regular array
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
      // Game phase: send all players' data with positions
      return {
        ...baseState,
        myTeam: userTeam === 'A' ? this.getTeamData(this.state.teamA, true) : this.getTeamData(this.state.teamB, true),
        enemyTeam: userTeam === 'A' ? this.getTeamData(this.state.teamB, true) : this.getTeamData(this.state.teamA, true)
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
  getTeamData(teamState, includePositions = true) {
    const players = {};
    teamState.players.forEach((player, userId) => {
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
        maxEnergy: player.maxEnergy || 0
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
      
      // Calculate path
      path = findPath(this.terrain, currentX, currentY, x, y, occupiedTiles);
      
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
            this.terrain[step.y][step.x] !== TILE_TYPES.TILE) {
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
    
    const { spellId, targetX, targetY } = message;
    if (!spellId || targetX === undefined || targetY === undefined) {
      console.log(`Spell cast denied: invalid parameters`);
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
    
    // Validate target is in range
    const targeting = spell.targeting || {};
    const range = targeting.range || { min: 0, max: 10 };
    const playerX = player.position.x;
    const playerY = player.position.y;
    const distance = Math.abs(targetX - playerX) + Math.abs(targetY - playerY);
    
    if (distance < range.min || distance > range.max) {
      console.log(`Spell cast denied: target out of range (distance: ${distance}, range: ${range.min}-${range.max})`);
      return;
    }
    
    // Validate target tile is walkable (if targeting CELL)
    if (targeting.targetType === 'CELL' && this.terrain) {
      if (targetY < 0 || targetY >= this.terrain.length || 
          targetX < 0 || targetX >= this.terrain[0].length) {
        console.log(`Spell cast denied: target out of bounds`);
        return;
      }
      
      if (this.terrain[targetY][targetX] !== TILE_TYPES.TILE) {
        console.log(`Spell cast denied: target tile is not walkable`);
        return;
      }
    }
    
    // Deduct energy cost
    player.energy -= spell.cost.energy;
    if (player.energy < 0) {
      player.energy = 0;
    }
    
    // Track targets that take damage for hit animations
    const damagedTargets = new Set();
    
    // Apply spell effects
    if (spell.effects && spell.effects.length > 0) {
      spell.effects.forEach(effect => {
        if (effect.kind === 'DAMAGE') {
          // Find target unit at the target position (if targeting UNIT)
          if (targeting.targetType === 'UNIT') {
            // Find unit at target position
            let targetPlayer = null;
            this.state.teamA.players.forEach((p, id) => {
              if (p.position && p.position.x === targetX && p.position.y === targetY) {
                targetPlayer = p;
              }
            });
            if (!targetPlayer) {
              this.state.teamB.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            }
            
            if (targetPlayer) {
              // Apply damage
              targetPlayer.health -= effect.amount;
              if (targetPlayer.health < 0) {
                targetPlayer.health = 0;
              }
              damagedTargets.add(targetPlayer.userId);
              console.log(`Applied ${effect.amount} ${effect.damageType || 'damage'} to ${targetPlayer.username}, health now: ${targetPlayer.health}`);
            }
          } else if (targeting.targetType === 'CELL') {
            // Area damage - find all units at target cell (for now, just single target)
            // TODO: Implement area effects based on pattern
            let targetPlayer = null;
            this.state.teamA.players.forEach((p, id) => {
              if (p.position && p.position.x === targetX && p.position.y === targetY) {
                targetPlayer = p;
              }
            });
            if (!targetPlayer) {
              this.state.teamB.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            }
            
            if (targetPlayer) {
              targetPlayer.health -= effect.amount;
              if (targetPlayer.health < 0) {
                targetPlayer.health = 0;
              }
              damagedTargets.add(targetPlayer.userId);
              console.log(`Applied ${effect.amount} ${effect.damageType || 'damage'} to ${targetPlayer.username} at (${targetX}, ${targetY}), health now: ${targetPlayer.health}`);
            }
          }
        } else if (effect.kind === 'HEAL') {
          // Find target unit based on targeting type
          let targetPlayer = null;
          
          if (targeting.targetType === 'SELF') {
            // Heal the caster
            targetPlayer = player;
          } else if (targeting.targetType === 'UNIT') {
            // Find unit at target position
            if (targeting.unitFilter === 'ALLY') {
              const playerTeam = this.userTeams.get(userId);
              const teamState = playerTeam === 'A' ? this.state.teamA : this.state.teamB;
              
              teamState.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            } else if (targeting.unitFilter === 'ANY') {
              // Can target any unit (ally or enemy)
              this.state.teamA.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
              if (!targetPlayer) {
                this.state.teamB.players.forEach((p, id) => {
                  if (p.position && p.position.x === targetX && p.position.y === targetY) {
                    targetPlayer = p;
                  }
                });
              }
            }
          } else if (targeting.targetType === 'CELL') {
            // Find unit at target cell (for area heals, currently just single target)
            this.state.teamA.players.forEach((p, id) => {
              if (p.position && p.position.x === targetX && p.position.y === targetY) {
                targetPlayer = p;
              }
            });
            if (!targetPlayer) {
              this.state.teamB.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            }
          }
          
          if (targetPlayer) {
            targetPlayer.health += effect.amount;
            if (targetPlayer.health > targetPlayer.maxHealth) {
              targetPlayer.health = targetPlayer.maxHealth;
            }
            console.log(`Healed ${targetPlayer.username} for ${effect.amount}, health now: ${targetPlayer.health}/${targetPlayer.maxHealth}`);
          }
        } else if (effect.kind === 'MOVEMENT') {
          // Find target unit based on targeting type
          let targetPlayer = null;
          
          if (targeting.targetType === 'SELF') {
            // Add movement points to the caster
            targetPlayer = player;
          } else if (targeting.targetType === 'UNIT') {
            // Find unit at target position
            if (targeting.unitFilter === 'ALLY') {
              const playerTeam = this.userTeams.get(userId);
              const teamState = playerTeam === 'A' ? this.state.teamA : this.state.teamB;
              
              teamState.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            } else if (targeting.unitFilter === 'ANY') {
              // Can target any unit (ally or enemy)
              this.state.teamA.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
              if (!targetPlayer) {
                this.state.teamB.players.forEach((p, id) => {
                  if (p.position && p.position.x === targetX && p.position.y === targetY) {
                    targetPlayer = p;
                  }
                });
              }
            }
          } else if (targeting.targetType === 'CELL') {
            // Find unit at target cell
            this.state.teamA.players.forEach((p, id) => {
              if (p.position && p.position.x === targetX && p.position.y === targetY) {
                targetPlayer = p;
              }
            });
            if (!targetPlayer) {
              this.state.teamB.players.forEach((p, id) => {
                if (p.position && p.position.x === targetX && p.position.y === targetY) {
                  targetPlayer = p;
                }
              });
            }
          }
          
          if (targetPlayer) {
            // Add movement points (can exceed max, will be capped at end of turn)
            targetPlayer.movementPoints += effect.amount;
            console.log(`Added ${effect.amount} movement points to ${targetPlayer.username}, movement points now: ${targetPlayer.movementPoints} (max: ${targetPlayer.maxMovementPoints})`);
          }
        }
      });
    }
    
    console.log(`Player ${userId} cast ${spellId} at (${targetX}, ${targetY}), energy now: ${player.energy}`);
    
    // Cancel spell preparation (stop stance animation) before casting
    this.broadcast('spellPrepCancel', {
      userId: userId
    });
    
    // Get cast animation definition to include in broadcast
    const castAnimDef = spell.animations?.cast || null;
    
    // Get VFX definitions to include in broadcast
    const presentation = spell.presentation || {};
    
    // Broadcast spell cast event to all clients so they can play animations and VFX
    this.broadcast('spellCast', {
      userId: userId,
      spellId: spellId,
      targetX: targetX,
      targetY: targetY,
      castAnimDef: castAnimDef, // Include cast animation definition so clients don't need to look it up
      presentation: {
        projectileVfx: presentation.projectileVfx || null,
        impactVfxDef: presentation.impactVfxDef || null,
        groundEffectVfx: presentation.groundEffectVfx || null
      }
    });
    
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
    }
    
    console.log(`Turn ${this.state.turn}: Now ${nextPlayerId}'s turn`);
    
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
