import express from 'express';
import { createServer } from 'http';
import pkg from 'colyseus';
const { Server } = pkg;
import monitorPkg from '@colyseus/monitor';
const { monitor } = monitorPkg;
import { connectToDatabase, closeDatabase } from './config/database.js';
import { User } from './models/User.js';
import authRoutes from './routes/auth.js';
import friendRoutes from './routes/friends.js';
import characterRoutes from './routes/characters.js';
import mapRoutes from './routes/maps.js';
import { FriendRoom } from './rooms/FriendRoom.js';
import { GameRoom } from './rooms/GameRoom.js';
import { Character } from './models/Character.js';

// Store FriendRoom instance for routes to use
let friendRoomInstance = null;

// Function to get the FriendRoom instance
export function getFriendRoomInstance() {
  return friendRoomInstance;
}

// Function to set the FriendRoom instance
export function setFriendRoomInstance(instance) {
  friendRoomInstance = instance;
}

const app = express();
const server = createServer(app);
const gameServer = new Server({
  server,
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware (for development)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// API routes
app.get('/api/status', (req, res) => {
  res.json({ message: 'Game server is ready!' });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Friend routes
app.use('/api/friends', friendRoutes);

// Character routes
app.use('/api/characters', characterRoutes);

// Map routes
app.use('/api/maps', mapRoutes);

// Colyseus monitor (for debugging)
app.use('/colyseus', monitor());

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  gameServer.gracefullyShutdown();
  await closeDatabase();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Define Colyseus rooms
const friendRoomDefinition = gameServer.define('friendRoom', FriendRoom);
const gameRoomDefinition = gameServer.define('gameRoom', GameRoom);

// Listen for room creation to store instance
friendRoomDefinition.on('create', (room) => {
  setFriendRoomInstance(room);
  console.log('FriendRoom instance stored for real-time notifications');
});

// Initialize server (async)
async function startServer() {
  try {
    // Connect to database first
    await connectToDatabase();
    
    // Create indexes for unique username and email
    await User.createIndexes();
    
    // Create indexes for characters
    await Character.createIndexes();
    
    // Start server only after database is connected
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📡 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
      console.log(`👥 Friend endpoints: http://localhost:${PORT}/api/friends`);
      console.log(`⚔️  Character endpoints: http://localhost:${PORT}/api/characters`);
      console.log(`🎮 Colyseus monitor: http://localhost:${PORT}/colyseus`);
      console.log(`🔌 Colyseus WebSocket: ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

