import React, { useRef, useEffect, useState, useCallback } from 'react';
import { renderMap, screenToTile, isValidTile, HIGHLIGHT_COLORS } from '../utils/mapRenderer';
import '../styles/mapCanvas.scss';

const DEFAULT_TILE_SIZE = 40; // pixels per tile

const MapCanvas = ({ mapData, onTileClick, onTileHover, highlights = {} }) => {
  const canvasRef = useRef(null);
  const [tileSize, setTileSize] = useState(DEFAULT_TILE_SIZE);
  const [hoveredTile, setHoveredTile] = useState(null);

  // Calculate canvas size based on map dimensions
  const mapWidth = mapData?.terrain[0]?.length || 0;
  const mapHeight = mapData?.terrain?.length || 0;

  // Resize canvas to fit map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const container = canvas.parentElement;
    if (!container) return;

    // Calculate optimal tile size to fit container
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const maxTileSizeX = Math.floor(containerWidth / mapWidth);
    const maxTileSizeY = Math.floor(containerHeight / mapHeight);
    const optimalTileSize = Math.min(maxTileSizeX, maxTileSizeY, DEFAULT_TILE_SIZE);
    
    setTileSize(optimalTileSize);

    // Set canvas size
    const canvasWidth = mapWidth * optimalTileSize;
    const canvasHeight = mapHeight * optimalTileSize;
    
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
  }, [mapData, mapWidth, mapHeight]);

  // Render map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Combine highlights with hover highlight
    const allHighlights = { ...highlights };
    if (hoveredTile) {
      const hoverKey = `${hoveredTile.x}_${hoveredTile.y}`;
      if (!allHighlights[hoverKey]) {
        allHighlights[hoverKey] = HIGHLIGHT_COLORS.hover;
      }
    }

    renderMap(ctx, mapData.terrain, tileSize, allHighlights);
  }, [mapData, tileSize, highlights, hoveredTile]);

  // Handle mouse move for hover
  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const tile = screenToTile(x, y, tileSize);
    
    if (isValidTile(tile.x, tile.y, mapData.terrain)) {
      setHoveredTile(tile);
      
      if (onTileHover) {
        onTileHover(tile.x, tile.y);
      }
    } else {
      setHoveredTile(null);
    }
  }, [mapData, tileSize, onTileHover]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setHoveredTile(null);
  }, []);

  // Handle click
  const handleClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !mapData || !onTileClick) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const tile = screenToTile(x, y, tileSize);
    
    if (isValidTile(tile.x, tile.y, mapData.terrain)) {
      onTileClick(tile.x, tile.y);
    }
  }, [mapData, tileSize, onTileClick]);

  if (!mapData) {
    return (
      <div className="map-canvas-container">
        <div className="map-loading">Loading map...</div>
      </div>
    );
  }

  return (
    <div className="map-canvas-container">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
      {hoveredTile && (
        <div className="tile-info">
          Tile: ({hoveredTile.x}, {hoveredTile.y})
        </div>
      )}
    </div>
  );
};

export default MapCanvas;
