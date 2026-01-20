import express from 'express';
import { Friend } from '../models/Friend.js';
import { User } from '../models/User.js';
import { getFriendRoomInstance } from '../index.js';

const router = express.Router();

// Middleware to extract username from request
// In a real app, you'd verify JWT token here
const getUsername = (req) => {
  // For now, we'll get it from query/body
  // TODO: Implement proper JWT authentication
  return req.body.username || req.query.username;
};

// Get all friends
router.get('/', async (req, res) => {
  try {
    const username = getUsername(req);
    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    // Find user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const friends = await Friend.getFriends(user._id.toString());
    res.json({ friends });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

// Send friend request
router.post('/request', async (req, res) => {
  try {
    const username = getUsername(req);
    const { friendUsername } = req.body;

    if (!username || !friendUsername) {
      return res.status(400).json({ error: 'Username and friend username are required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find friend user to get their ID for notification
    const friendUser = await User.findByUsername(friendUsername);
    if (!friendUser) {
      return res.status(404).json({ error: 'Friend user not found' });
    }

    await Friend.sendFriendRequest(user._id.toString(), friendUsername);
    
    // Notify the recipient in real-time if they're online
    const friendRoom = getFriendRoomInstance();
    if (friendRoom) {
      friendRoom.notifyFriendRequest(friendUser._id.toString(), user);
    }
    
    res.json({ message: 'Friend request sent successfully' });
  } catch (error) {
    if (error.message === 'Cannot send friend request to yourself' || 
        error.message === 'You are already friends' ||
        error.message === 'Friend request already sent' ||
        error.message === 'You have a pending friend request from this user' ||
        error.message === 'User not found' ||
        error.message === 'Current user not found') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// Accept friend request
router.post('/accept', async (req, res) => {
  try {
    const username = getUsername(req);
    const { friendUsername } = req.body;

    if (!username || !friendUsername) {
      return res.status(400).json({ error: 'Username and friend username are required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find friend user
    const friendUser = await User.findByUsername(friendUsername);
    if (!friendUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await Friend.acceptFriendRequest(user._id.toString(), friendUsername);
    
    // Notify both users in real-time about request update and friend list change
    const friendRoom = getFriendRoomInstance();
    if (friendRoom) {
      // Notify about request acceptance
      friendRoom.notifyRequestUpdate(friendUser._id.toString(), 'accepted', user);
      friendRoom.notifyRequestUpdate(user._id.toString(), 'accepted', friendUser);
      
      // Notify about friend list update (friend added)
      friendRoom.notifyFriendListUpdate(friendUser._id.toString(), 'added', user);
      friendRoom.notifyFriendListUpdate(user._id.toString(), 'added', friendUser);
    }
    
    res.json({ message: 'Friend request accepted' });
  } catch (error) {
    if (error.message === 'Friend request not found' || error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Decline friend request
router.post('/decline', async (req, res) => {
  try {
    const username = getUsername(req);
    const { friendUsername } = req.body;

    if (!username || !friendUsername) {
      return res.status(400).json({ error: 'Username and friend username are required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find friend user
    const friendUser = await User.findByUsername(friendUsername);
    if (!friendUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    await Friend.declineFriendRequest(user._id.toString(), friendUsername);
    
    // Notify the requester in real-time
    const friendRoom = getFriendRoomInstance();
    if (friendRoom) {
      friendRoom.notifyRequestUpdate(friendUser._id.toString(), 'declined', user);
    }
    
    res.json({ message: 'Friend request declined' });
  } catch (error) {
    if (error.message === 'Friend request not found' || error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

// Get pending friend requests
router.get('/requests', async (req, res) => {
  try {
    const username = getUsername(req);
    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const requests = await Friend.getPendingRequests(user._id.toString());
    res.json(requests);
  } catch (error) {
    console.error('Get friend requests error:', error);
    res.status(500).json({ error: 'Failed to get friend requests' });
  }
});

// Remove a friend
router.delete('/remove', async (req, res) => {
  try {
    const username = getUsername(req);
    const { friendUsername } = req.body;

    if (!username || !friendUsername) {
      return res.status(400).json({ error: 'Username and friend username are required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Find friend user
    const friendUser = await User.findByUsername(friendUsername);
    if (!friendUser) {
      return res.status(404).json({ error: 'Friend user not found' });
    }

    await Friend.removeFriend(user._id.toString(), friendUsername);
    
    // Notify both users in real-time about friend removal
    const friendRoom = getFriendRoomInstance();
    if (friendRoom) {
      friendRoom.notifyFriendListUpdate(friendUser._id.toString(), 'removed', user);
      friendRoom.notifyFriendListUpdate(user._id.toString(), 'removed', friendUser);
    }
    
    res.json({ message: 'Friend removed successfully' });
  } catch (error) {
    if (error.message === 'Friendship not found' || error.message === 'User not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// Get friend status
router.get('/status/:friendUsername', async (req, res) => {
  try {
    const username = getUsername(req);
    const { friendUsername } = req.params;

    if (!username) {
      return res.status(401).json({ error: 'Username required' });
    }

    // Find current user by username (case insensitive)
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const status = await Friend.getFriendStatus(user._id.toString(), friendUsername);
    res.json({ isFriend: !!status, status: status?.status || null });
  } catch (error) {
    console.error('Get friend status error:', error);
    res.status(500).json({ error: 'Failed to get friend status' });
  }
});

export default router;

