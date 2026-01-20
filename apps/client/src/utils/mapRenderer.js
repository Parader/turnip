/**
 * Map Renderer - Renders a checkerboard-style 2D map like Dofus PvP
 */

// Tile types
export const TILE_TYPES = {
  NONE: 0,    // No tile (empty space)
  TILE: 1,    // Walkable tile
  WALL: 2     // Wall/obstacle
};

// Colors for different tile types
const TILE_COLORS = {
  [TILE_TYPES.NONE]: '#1a1a1a',      // Dark background for empty spaces
  [TILE_TYPES.TILE]: {
    light: '#d4a574',  // Light beige for checkerboard pattern
    dark: '#b8956a'    // Dark beige for checkerboard pattern
  },
  [TILE_TYPES.WALL]: '#5a5a5a'       // Gray for walls
};

// Highlight colors for future use (spells, range, vision)
export const HIGHLIGHT_COLORS = {
  spell: 'rgba(255, 100, 100, 0.5)',
  range: 'rgba(100, 150, 255, 0.4)',
  vision: 'rgba(255, 255, 100, 0.3)',
  hover: 'rgba(255, 255, 255, 0.2)'
};

/**
 * Determines if a tile position should be light or dark in checkerboard pattern
 * In Dofus-style, tiles alternate diagonally
 */
function isLightTile(x, y) {
  // Dofus uses a diagonal checkerboard pattern
  return (x + y) % 2 === 0;
}

/**
 * Renders the map on a canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @param {number} tileSize - Size of each tile in pixels
 * @param {Object} highlights - Map of {x_y: color} for highlighted tiles
 */
export function renderMap(ctx, terrain, tileSize, highlights = {}) {
  const rows = terrain.length;
  const cols = terrain[0]?.length || 0;

  // Clear canvas
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Draw each tile
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tileType = terrain[y][x];
      const xPos = x * tileSize;
      const yPos = y * tileSize;

      // Skip rendering empty tiles (but still draw background)
      if (tileType === TILE_TYPES.NONE) {
        ctx.fillStyle = TILE_COLORS[TILE_TYPES.NONE];
        ctx.fillRect(xPos, yPos, tileSize, tileSize);
        continue;
      }

      // Draw tile base
      if (tileType === TILE_TYPES.TILE) {
        const isLight = isLightTile(x, y);
        ctx.fillStyle = isLight ? TILE_COLORS[TILE_TYPES.TILE].light : TILE_COLORS[TILE_TYPES.TILE].dark;
      } else if (tileType === TILE_TYPES.WALL) {
        ctx.fillStyle = TILE_COLORS[TILE_TYPES.WALL];
      }

      ctx.fillRect(xPos, yPos, tileSize, tileSize);

      // Draw border for walkable tiles
      if (tileType === TILE_TYPES.TILE) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 1;
        ctx.strokeRect(xPos, yPos, tileSize, tileSize);
      }

      // Draw highlight if present
      const highlightKey = `${x}_${y}`;
      if (highlights[highlightKey]) {
        ctx.fillStyle = highlights[highlightKey];
        ctx.fillRect(xPos, yPos, tileSize, tileSize);
      }
    }
  }
}

/**
 * Converts screen coordinates to tile coordinates
 * @param {number} screenX - X coordinate on canvas
 * @param {number} screenY - Y coordinate on canvas
 * @param {number} tileSize - Size of each tile
 * @returns {Object} {x, y} tile coordinates
 */
export function screenToTile(screenX, screenY, tileSize) {
  return {
    x: Math.floor(screenX / tileSize),
    y: Math.floor(screenY / tileSize)
  };
}

/**
 * Converts tile coordinates to screen coordinates
 * @param {number} tileX - X tile coordinate
 * @param {number} tileY - Y tile coordinate
 * @param {number} tileSize - Size of each tile
 * @returns {Object} {x, y} screen coordinates (top-left of tile)
 */
export function tileToScreen(tileX, tileY, tileSize) {
  return {
    x: tileX * tileSize,
    y: tileY * tileSize
  };
}

/**
 * Checks if a tile coordinate is valid for the given terrain
 * @param {number} x - X tile coordinate
 * @param {number} y - Y tile coordinate
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @returns {boolean} True if valid
 */
export function isValidTile(x, y, terrain) {
  return y >= 0 && y < terrain.length && x >= 0 && x < (terrain[0]?.length || 0);
}

/**
 * Checks if a tile is walkable
 * @param {number} x - X tile coordinate
 * @param {number} y - Y tile coordinate
 * @param {Array<Array<number>>} terrain - 2D array of tile types
 * @returns {boolean} True if walkable
 */
export function isWalkable(x, y, terrain) {
  if (!isValidTile(x, y, terrain)) return false;
  return terrain[y][x] === TILE_TYPES.TILE;
}
