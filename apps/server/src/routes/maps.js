import express from 'express';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get map by ID
router.get('/:mapId', async (req, res) => {
  try {
    const { mapId } = req.params;
    const mapPath = join(__dirname, '..', 'maps', `${mapId}.json`);
    
    const mapData = await readFile(mapPath, 'utf-8');
    const map = JSON.parse(mapData);
    
    res.json(map);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'Map not found' });
    }
    console.error('Error loading map:', error);
    res.status(500).json({ error: 'Failed to load map' });
  }
});

// List all available maps
router.get('/', async (req, res) => {
  try {
    // For now, return available map IDs
    // In the future, you could scan the maps directory
    res.json({ maps: ['map_001'] });
  } catch (error) {
    console.error('Error listing maps:', error);
    res.status(500).json({ error: 'Failed to list maps' });
  }
});

export default router;
