/**
 * Line of Sight (LOS) utility using Supercover DDA algorithm
 * Based on Amanatides–Woo algorithm with corner-tie handling
 * 
 * Ray is cast center → center
 * If ray hits a corner exactly, it counts both adjacent tiles (prevents corner cutting)
 * Target tile is considered aimable even if it's the blocker (common tactics rule)
 */

/**
 * Check if there is line of sight from one tile to another
 * @param {Object} from - Starting position {x, y}
 * @param {Object} to - Target position {x, y}
 * @param {Function} blocks - Function that returns true if a tile at (x, y) blocks LOS
 * @returns {boolean} - True if there is line of sight
 */
export function hasLOS(from, to, blocks) {
  const x0 = from.x + 0.5, y0 = from.y + 0.5;
  const x1 = to.x + 0.5,   y1 = to.y + 0.5;

  let cx = from.x, cy = from.y;
  const tx = to.x, ty = to.y;

  const dx = x1 - x0;
  const dy = y1 - y0;

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const invDy = dy !== 0 ? 1 / Math.abs(dy) : Infinity;

  const nextVert  = stepX > 0 ? (cx + 1) : cx;
  const nextHoriz = stepY > 0 ? (cy + 1) : cy;

  let tMaxX = stepX !== 0 ? Math.abs(nextVert  - x0) * invDx : Infinity;
  let tMaxY = stepY !== 0 ? Math.abs(nextHoriz - y0) * invDy : Infinity;

  const tDeltaX = stepX !== 0 ? 1 * invDx : Infinity;
  const tDeltaY = stepY !== 0 ? 1 * invDy : Infinity;

  while (!(cx === tx && cy === ty)) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      cy += stepY;
      tMaxY += tDeltaY;
    } else {
      // PERMISSIVE CORNER:
      // ray hits a corner exactly; it "touches" (cx+stepX,cy) and (cx,cy+stepY)
      const side1x = cx + stepX, side1y = cy;
      const side2x = cx,         side2y = cy + stepY;

      // only block if BOTH sides are blocking (thick corner)
      // (also allow aiming at target tile)
      const side1Blocks = !(side1x === tx && side1y === ty) && blocks(side1x, side1y);
      const side2Blocks = !(side2x === tx && side2y === ty) && blocks(side2x, side2y);

      if (side1Blocks && side2Blocks) return false;

      // advance diagonally
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }

    // entered tile check (target tile is allowed)
    if (!(cx === tx && cy === ty) && blocks(cx, cy)) return false;
  }

  return true;
}

/**
 * Create a blocks function for terrain-based LOS checking
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {Object} TILE_TYPES - Object with tile type constants (NONE, TILE, WALL)
 * @param {Set<string>} [occupiedTiles] - Optional set of occupied tile keys "x_y" (players block LOS)
 * @param {Object} [excludePosition] - Optional position {x, y} to exclude from blocking (e.g., caster's position)
 * @returns {Function} - Blocks function (x, y) => boolean
 */
export function createTerrainBlocksFunction(terrain, TILE_TYPES, occupiedTiles = null, excludePosition = null) {
  return (x, y) => {
    // Check bounds
    if (y < 0 || y >= terrain.length || x < 0 || x >= terrain[0].length) {
      return true; // Out of bounds blocks LOS
    }
    
    // Walls block LOS
    if (terrain[y][x] === TILE_TYPES.WALL) {
      return true;
    }
    
    // Occupied tiles (players) block LOS
    // Exclude the caster's position so they don't block their own LOS
    if (occupiedTiles && occupiedTiles.has(`${x}_${y}`)) {
      // Don't block if this is the excluded position (caster's position)
      if (excludePosition && excludePosition.x === x && excludePosition.y === y) {
        return false;
      }
      return true; // Players block LOS
    }
    
    return false;
  };
}
