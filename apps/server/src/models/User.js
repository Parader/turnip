import { getDatabase } from '../config/database.js';
import bcrypt from 'bcrypt';

const COLLECTION_NAME = 'accounts';

export class User {
  static async create(userData) {
    const db = getDatabase();
    const { username, email, password } = userData;

    // Validate required fields
    if (!username || !email || !password) {
      throw new Error('Username, email, and password are required');
    }

    // Check if username already exists (case insensitive)
    const existingUsername = await db.collection(COLLECTION_NAME).findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });
    if (existingUsername) {
      throw new Error('Username already exists');
    }

    // Check if email already exists
    const existingEmail = await db.collection(COLLECTION_NAME).findOne({ email });
    if (existingEmail) {
      throw new Error('Email already exists');
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user document
    const user = {
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection(COLLECTION_NAME).insertOne(user);
    
    // Return user without password
    const createdUser = await db.collection(COLLECTION_NAME).findOne({ _id: result.insertedId });
    delete createdUser.password;
    
    return createdUser;
  }

  static async findByUsernameOrEmail(identifier) {
    const db = getDatabase();
    const user = await db.collection(COLLECTION_NAME).findOne({
      $or: [
        { username: { $regex: new RegExp(`^${identifier}$`, 'i') } },
        { email: identifier.toLowerCase() }
      ]
    });
    return user;
  }

  static async findByUsername(username) {
    const db = getDatabase();
    const user = await db.collection(COLLECTION_NAME).findOne({
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    });
    return user;
  }

  static async findById(id) {
    const db = getDatabase();
    const user = await db.collection(COLLECTION_NAME).findOne({ _id: id });
    if (user) {
      delete user.password;
    }
    return user;
  }

  static async verifyPassword(user, password) {
    return await bcrypt.compare(password, user.password);
  }

  static async createIndexes() {
    const db = getDatabase();
    const collection = db.collection(COLLECTION_NAME);
    
    // Create unique indexes for username and email
    await collection.createIndex({ username: 1 }, { unique: true });
    await collection.createIndex({ email: 1 }, { unique: true });
    
    console.log('✅ Created unique indexes for username and email');
  }
}

