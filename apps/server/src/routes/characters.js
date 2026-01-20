import express from 'express';
import { Character } from '../models/Character.js';
import { User } from '../models/User.js';
import { gameData } from '../config/classes.js';
import SpellDefs from '../config/spelldefs.js';
import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

// Middleware to extract username from request
const getUsername = (req) => {
  return req.body.username || req.query.username;
};

// Get all characters for a user
router.get('/', async (req, res) => {
  try {
    const username = getUsername(req);
    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const characters = await Character.findByOwner(user._id.toString());
    res.json({ characters });
  } catch (error) {
    console.error('Get characters error:', error);
    res.status(500).json({ error: 'Failed to get characters' });
  }
});

// Get a specific character
router.get('/:characterId', async (req, res) => {
  try {
    const username = getUsername(req);
    const { characterId } = req.params;

    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const character = await Character.findById(characterId, user._id.toString());
    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    res.json({ character });
  } catch (error) {
    console.error('Get character error:', error);
    res.status(500).json({ error: 'Failed to get character' });
  }
});

// Create a new character
router.post('/', async (req, res) => {
  try {
    const username = getUsername(req);
    const { name, classId } = req.body;

    if (!username || !name || !classId) {
      return res.status(400).json({ error: 'Username, name, and class ID are required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate class exists
    const classData = gameData.classes[classId.toLowerCase()];
    if (!classData) {
      return res.status(400).json({ error: 'Invalid class ID' });
    }

    // Always use starter spells for new characters
    const finalSpellLoadout = classData.starterSpells.slice(0, 5);

    // Validate all starter spells exist in SpellDefs
    for (const spellId of finalSpellLoadout) {
      if (!SpellDefs[spellId]) {
        return res.status(400).json({ error: `Invalid spell ID in starter spells: ${spellId}` });
      }
    }

    const character = await Character.create({
      ownerId: user._id.toString(),
      name,
      classId: classId.toLowerCase(),
      spellLoadout: finalSpellLoadout
    });

    // Remove nameLower from response
    delete character.nameLower;

    res.status(201).json({
      message: 'Character created successfully',
      character
    });
  } catch (error) {
    // Check for MongoDB duplicate key error (unique index violation)
    if (error.code === 11000 || error.code === 11001) {
      return res.status(400).json({ error: 'Character name already exists' });
    }
    
    if (error.message === 'Character name already exists' ||
        error.message === 'Character name already exists for this account' ||
        error.message === 'Invalid class ID' ||
        error.message.includes('Invalid spell ID') ||
        error.message.includes('Character name must be') ||
        error.message.includes('Spell loadout must contain')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create character error:', error);
    res.status(500).json({ error: 'Failed to create character' });
  }
});

// Update a character
router.put('/:characterId', async (req, res) => {
  try {
    const username = getUsername(req);
    const { characterId } = req.params;
    const updates = req.body;

    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validate spell loadout if provided
    if (updates.spellLoadout) {
      if (!Array.isArray(updates.spellLoadout) || updates.spellLoadout.length !== 5) {
        return res.status(400).json({ error: 'Spell loadout must contain exactly 5 spells' });
      }

      // Validate all spells exist
      for (const spellId of updates.spellLoadout) {
        if (!SpellDefs[spellId]) {
          return res.status(400).json({ error: `Invalid spell ID: ${spellId}` });
        }
      }
    }

    await Character.update(characterId, user._id.toString(), updates);
    res.json({ message: 'Character updated successfully' });
  } catch (error) {
    if (error.message === 'Character not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update character error:', error);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

// Delete a character
router.delete('/:characterId', async (req, res) => {
  try {
    const username = getUsername(req);
    const { characterId } = req.params;

    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if this character is the selected character
    const db = getDatabase();
    const userDoc = await db.collection('accounts').findOne({ _id: user._id });
    
    if (userDoc && userDoc.selectedCharacterId && 
        userDoc.selectedCharacterId.toString() === characterId) {
      // Clear selected character if it's being deleted
      await db.collection('accounts').updateOne(
        { _id: user._id },
        { $unset: { selectedCharacterId: '' }, $set: { updatedAt: new Date() } }
      );
    }

    await Character.delete(characterId, user._id.toString());
    res.json({ message: 'Character deleted successfully' });
  } catch (error) {
    if (error.message === 'Character not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Delete character error:', error);
    res.status(500).json({ error: 'Failed to delete character' });
  }
});

// Get available classes
router.get('/info/classes', (req, res) => {
  try {
    const classes = Object.keys(gameData.classes).map(classId => {
      const classData = gameData.classes[classId];
      return {
        id: classId,
        name: classId.charAt(0).toUpperCase() + classId.slice(1),
        starterSpells: classData.starterSpells,
        baseStats: classData.baseStats,
        unlocks: classData.unlocks
      };
    });
    res.json({ classes });
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to get classes' });
  }
});

// Get available spells for a class
router.get('/info/spells/:classId', (req, res) => {
  try {
    const { classId } = req.params;
    const { level } = req.query; // Optional level parameter
    const classData = gameData.classes[classId.toLowerCase()];
    
    if (!classData) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Get all spells for this class (starter + all unlocks)
    const allSpellIds = [...classData.starterSpells];
    classData.unlocks.forEach(unlock => {
      if (!allSpellIds.includes(unlock.spellId)) {
        allSpellIds.push(unlock.spellId);
      }
    });

    const characterLevel = level ? parseInt(level) : null;
    const availableSpellIds = [...classData.starterSpells];
    
    // Add unlocked spells if level is provided
    if (characterLevel !== null) {
      classData.unlocks.forEach(unlock => {
        if (characterLevel >= unlock.level && !availableSpellIds.includes(unlock.spellId)) {
          availableSpellIds.push(unlock.spellId);
        }
      });
    } else {
      // If no level provided, include all unlocks (for class preview)
      classData.unlocks.forEach(unlock => {
        if (!availableSpellIds.includes(unlock.spellId)) {
          availableSpellIds.push(unlock.spellId);
        }
      });
    }

    // Get spell details from SpellDefs and mark availability
    const spells = allSpellIds
      .filter(spellId => SpellDefs[spellId])
      .map(spellId => {
        const isAvailable = availableSpellIds.includes(spellId);
        const unlockInfo = classData.unlocks.find(u => u.spellId === spellId);
        
        return {
          id: spellId,
          ...SpellDefs[spellId],
          available: isAvailable,
          unlockLevel: unlockInfo ? unlockInfo.level : null
        };
      });

    res.json({ spells });
  } catch (error) {
    console.error('Get spells error:', error);
    res.status(500).json({ error: 'Failed to get spells' });
  }
});

// Get selected character for a user
router.get('/selected/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findByUsername(username);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.selectedCharacterId) {
      return res.json({ character: null });
    }

    const character = await Character.findById(user.selectedCharacterId.toString(), user._id.toString());
    res.json({ character });
  } catch (error) {
    console.error('Get selected character error:', error);
    res.status(500).json({ error: 'Failed to get selected character' });
  }
});

// Set selected character for a user
router.post('/selected/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { characterId } = req.body;

    if (!characterId) {
      return res.status(400).json({ error: 'Character ID is required' });
    }

    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify character belongs to user
    const character = await Character.findById(characterId, user._id.toString());
    if (!character) {
      return res.status(404).json({ error: 'Character not found or does not belong to user' });
    }

    // Update user's selected character
    const db = getDatabase();
    await db.collection('accounts').updateOne(
      { _id: user._id },
      { $set: { selectedCharacterId: new ObjectId(characterId), updatedAt: new Date() } }
    );

    res.json({ 
      message: 'Selected character updated successfully',
      character 
    });
  } catch (error) {
    console.error('Set selected character error:', error);
    res.status(500).json({ error: 'Failed to set selected character' });
  }
});

export default router;

