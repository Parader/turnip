import { TILE_TYPES, isTileWalkable } from './mapRenderer';

/**
 * A* pathfinding algorithm for Dofus-style grid movement
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} endX - Target X coordinate
 * @param {number} endY - Target Y coordinate
 * @param {Set<string>} occupiedTiles - Set of occupied tile keys (e.g., "x_y")
 * @param {Array<{x: number, y: number}>} preferredPath - Previous path to prefer when there are ties
 * @returns {Array<{x: number, y: number}>} - Path from start to end, or empty array if no path
 */
export function findPath(terrain, startX, startY, endX, endY, occupiedTiles = new Set(), preferredPath = []) {
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
  if (!isTileWalkable(terrain[startY][startX])) {
    return [];
  }
  if (!isTileWalkable(terrain[endY][endX])) {
    return [];
  }
  
  // Check if end tile is occupied (can't move to occupied tile)
  const endKey = `${endX}_${endY}`;
  if (occupiedTiles.has(endKey)) {
    return [];
  }
  
  // Helper function to check if a position matches preferred path at a given step
  const isInPreferredPath = (x, y, stepIndex) => {
    if (!preferredPath || preferredPath.length === 0) return false;
    if (stepIndex < 0 || stepIndex >= preferredPath.length) return false;
    return preferredPath[stepIndex].x === x && preferredPath[stepIndex].y === y;
  };
  
  // Helper function to calculate how well a path matches the preferred path
  // This reconstructs the path from start to current node and counts matching steps
  const getPathMatchScore = (cameFrom, currentKey, stepIndex) => {
    if (!preferredPath || preferredPath.length === 0) return 0;
    
    // Reconstruct path from start to current node
    const pathToCurrent = [];
    let nodeKey = currentKey;
    let steps = stepIndex;
    
    // Add current node
    const currentKeyParts = currentKey.split('_');
    pathToCurrent.push({ x: parseInt(currentKeyParts[0]), y: parseInt(currentKeyParts[1]) });
    
    // Trace back through cameFrom
    while (steps > 0 && cameFrom.has(nodeKey)) {
      const node = cameFrom.get(nodeKey);
      pathToCurrent.unshift({ x: node.x, y: node.y });
      nodeKey = `${node.x}_${node.y}`;
      steps--;
    }
    
    // Check how many steps match the preferred path
    let matchCount = 0;
    for (let i = 0; i < Math.min(pathToCurrent.length, preferredPath.length); i++) {
      if (pathToCurrent[i].x === preferredPath[i].x && pathToCurrent[i].y === preferredPath[i].y) {
        matchCount++;
      } else {
        break;
      }
    }
    
    return matchCount;
  };
  
  // A* algorithm
  const openSet = [{ x: startX, y: startY, g: 0, h: heuristic(startX, startY, endX, endY), f: 0, stepIndex: 0 }];
  const closedSet = new Set();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();
  const stepIndexMap = new Map(); // Track step index for each node
  
  const startKey = `${startX}_${startY}`;
  gScore.set(startKey, 0);
  fScore.set(startKey, heuristic(startX, startY, endX, endY));
  stepIndexMap.set(startKey, 0);
  
  while (openSet.length > 0) {
    // Find node with lowest f score, then by path match score
    openSet.sort((a, b) => {
      if (a.f !== b.f) return a.f - b.f;
      // If f scores are equal, prefer paths that match the preferred path better
      const aMatch = getPathMatchScore(cameFrom, `${a.x}_${a.y}`, a.stepIndex);
      const bMatch = getPathMatchScore(cameFrom, `${b.x}_${b.y}`, b.stepIndex);
      return bMatch - aMatch; // Higher match score first
    });
    const current = openSet.shift();
    const currentKey = `${current.x}_${current.y}`;
    
    if (current.x === endX && current.y === endY) {
      // Reconstruct path
      const path = [];
      let node = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        const nodeKey = `${node.x}_${node.y}`;
        node = cameFrom.get(nodeKey);
      }
      return path;
    }
    
    closedSet.add(currentKey);
    const currentStepIndex = stepIndexMap.get(currentKey) || 0;
    
    // Check neighbors (4-directional movement)
    const neighbors = [
      { x: current.x + 1, y: current.y }, // Right
      { x: current.x - 1, y: current.y }, // Left
      { x: current.x, y: current.y + 1 }, // Down
      { x: current.x, y: current.y - 1 }  // Up
    ];
    
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x}_${neighbor.y}`;
      
      // Skip if out of bounds
      if (neighbor.x < 0 || neighbor.x >= mapWidth || neighbor.y < 0 || neighbor.y >= mapHeight) {
        continue;
      }
      
      // Skip if not walkable
      if (!isTileWalkable(terrain[neighbor.y][neighbor.x])) {
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
      const tentativeG = gScore.get(currentKey) + 1; // Each step costs 1 movement point
      const nextStepIndex = currentStepIndex + 1;
      
      // Check if this path is better
      const neighborG = gScore.get(neighborKey);
      if (!neighborG || tentativeG < neighborG) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeG);
        stepIndexMap.set(neighborKey, nextStepIndex);
        const h = heuristic(neighbor.x, neighbor.y, endX, endY);
        fScore.set(neighborKey, tentativeG + h);
        
        // Add to open set if not already there
        const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
        if (!existing) {
          openSet.push({ 
            x: neighbor.x, 
            y: neighbor.y, 
            g: tentativeG, 
            h: h, 
            f: tentativeG + h,
            stepIndex: nextStepIndex
          });
        } else {
          // Update existing node if this path is better
          if (tentativeG < existing.g) {
            existing.g = tentativeG;
            existing.h = h;
            existing.f = tentativeG + h;
            existing.stepIndex = nextStepIndex;
          }
        }
      } else if (neighborG === tentativeG) {
        // Same cost - prefer the one that follows preferred path better
        const existingStepIndex = stepIndexMap.get(neighborKey) || 0;
        const existingMatch = getPathMatchScore(cameFrom, neighborKey, existingStepIndex);
        
        // Calculate match score for new path
        const tempCameFrom = new Map(cameFrom);
        tempCameFrom.set(neighborKey, current);
        const newMatch = getPathMatchScore(tempCameFrom, neighborKey, nextStepIndex);
        
        if (newMatch > existingMatch) {
          // This path follows preferred path better, update
          cameFrom.set(neighborKey, current);
          stepIndexMap.set(neighborKey, nextStepIndex);
          const existing = openSet.find(n => n.x === neighbor.x && n.y === neighbor.y);
          if (existing) {
            existing.stepIndex = nextStepIndex;
          }
        }
      }
    }
  }
  
  // No path found
  return [];
}

/**
 * Calculate heuristic (Manhattan distance)
 */
function heuristic(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * Get all tiles within movement range using BFS
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} startX - Starting X coordinate
 * @param {number} startY - Starting Y coordinate
 * @param {number} maxDistance - Maximum movement points
 * @param {Set<string>} occupiedTiles - Set of occupied tile keys
 * @returns {Set<string>} - Set of reachable tile keys
 */
export function getMovementRange(terrain, startX, startY, maxDistance, occupiedTiles = new Set()) {
  const mapHeight = terrain.length;
  const mapWidth = terrain[0]?.length || 0;
  const reachable = new Set();
  const queue = [{ x: startX, y: startY, distance: 0 }];
  const visited = new Set();
  
  const startKey = `${startX}_${startY}`;
  visited.add(startKey);
  
  while (queue.length > 0) {
    const current = queue.shift();
    const currentKey = `${current.x}_${current.y}`;
    
    // Add to reachable if within range
    if (current.distance <= maxDistance) {
      reachable.add(currentKey);
    }
    
    // Don't explore further if at max distance
    if (current.distance >= maxDistance) {
      continue;
    }
    
    // Check neighbors
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 }
    ];
    
    for (const neighbor of neighbors) {
      const neighborKey = `${neighbor.x}_${neighbor.y}`;
      
      // Skip if out of bounds
      if (neighbor.x < 0 || neighbor.x >= mapWidth || neighbor.y < 0 || neighbor.y >= mapHeight) {
        continue;
      }
      
      // Skip if not walkable
      if (!isTileWalkable(terrain[neighbor.y][neighbor.x])) {
        continue;
      }
      
      // Skip if already visited
      if (visited.has(neighborKey)) {
        continue;
      }
      
      // Skip if occupied (but allow starting position)
      if (neighborKey !== startKey && occupiedTiles.has(neighborKey)) {
        continue;
      }
      
      visited.add(neighborKey);
      queue.push({ x: neighbor.x, y: neighbor.y, distance: current.distance + 1 });
    }
  }
  
  return reachable;
}
