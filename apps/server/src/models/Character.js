import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';

const COLLECTION_NAME = 'characters';

export class Character {
  static async create(characterData) {
    const db = getDatabase();
    const { ownerId, name, classId, spellLoadout } = characterData;

    // Validate required fields
    if (!ownerId || !name || !classId || !spellLoadout) {
      throw new Error('Owner ID, name, class ID, and spell loadout are required');
    }

    // Validate name length
    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 30) {
      throw new Error('Character name must be between 1 and 30 characters');
    }

    // Validate class
    const validClasses = ['assassin', 'warrior', 'archer', 'mage'];
    if (!validClasses.includes(classId.toLowerCase())) {
      throw new Error('Invalid class ID');
    }

    // Validate spell loadout
    if (!Array.isArray(spellLoadout) || spellLoadout.length !== 5) {
      throw new Error('Spell loadout must contain exactly 5 spells');
    }

    // Create character document
    // Note: We rely on the unique index on nameLower to prevent duplicates
    // This avoids race conditions that can occur with a pre-check
    const nameLower = trimmedName.toLowerCase();
    const character = {
      ownerId: new ObjectId(ownerId),
      name: trimmedName,
      nameLower: nameLower,
      classId: classId.toLowerCase(),
      level: 1,
      exp: 0,
      spellLoadout: spellLoadout,
      statsBonus: {
        movement: 0,
        energy: 0,
        offense: 0,
        meleeDefense: 0,
        magicDefense: 0,
        hp: 0
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    try {
      const result = await db.collection(COLLECTION_NAME).insertOne(character);
      
      // Return character without nameLower
      const createdCharacter = await db.collection(COLLECTION_NAME).findOne({ _id: result.insertedId });
      delete createdCharacter.nameLower;
      
      return createdCharacter;
    } catch (insertError) {
      // Handle MongoDB duplicate key error (race condition)
      if (insertError.code === 11000 || insertError.code === 11001) {
        throw new Error('Character name already exists');
      }
      throw insertError;
    }
  }

  static async findByOwner(ownerId) {
    const db = getDatabase();
    const characters = await db.collection(COLLECTION_NAME).find({
      ownerId: new ObjectId(ownerId)
    }).toArray();

    // Remove nameLower from all characters
    return characters.map(char => {
      const { nameLower, ...rest } = char;
      return rest;
    });
  }

  static async findById(characterId, ownerId) {
    const db = getDatabase();
    const character = await db.collection(COLLECTION_NAME).findOne({
      _id: new ObjectId(characterId),
      ownerId: new ObjectId(ownerId)
    });

    if (character) {
      delete character.nameLower;
    }

    return character;
  }

  static async update(characterId, ownerId, updates) {
    const db = getDatabase();
    
    // If name is being updated, check global uniqueness
    if (updates.name) {
      const trimmedName = updates.name.trim();
      if (trimmedName.length < 1 || trimmedName.length > 30) {
        throw new Error('Character name must be between 1 and 30 characters');
      }

      const nameLower = trimmedName.toLowerCase();
      
      // Check if another character (not this one) already has this name
      const existing = await db.collection(COLLECTION_NAME).findOne({
        nameLower: nameLower,
        _id: { $ne: new ObjectId(characterId) }
      });

      if (existing) {
        throw new Error('Character name already exists');
      }

      updates.name = trimmedName;
      updates.nameLower = nameLower;
    }

    updates.updatedAt = new Date();

    const result = await db.collection(COLLECTION_NAME).updateOne(
      {
        _id: new ObjectId(characterId),
        ownerId: new ObjectId(ownerId)
      },
      {
        $set: updates
      }
    );

    if (result.matchedCount === 0) {
      throw new Error('Character not found');
    }

    return result;
  }

  static async delete(characterId, ownerId) {
    const db = getDatabase();
    const result = await db.collection(COLLECTION_NAME).deleteOne({
      _id: new ObjectId(characterId),
      ownerId: new ObjectId(ownerId)
    });

    if (result.deletedCount === 0) {
      throw new Error('Character not found');
    }

    return { success: true };
  }

  static async createIndexes() {
    const db = getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    // Create indexes
    await collection.createIndex({ ownerId: 1 });
    // Character names must be unique globally (across all accounts)
    await collection.createIndex({ nameLower: 1 }, { unique: true });
    
    console.log('✅ Created indexes for characters');
  }
}

