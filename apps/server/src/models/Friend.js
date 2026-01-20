import { getDatabase } from '../config/database.js';
import { ObjectId } from 'mongodb';
import { User } from './User.js';

const COLLECTION_NAME = 'friendships';

export class Friend {
  static async sendFriendRequest(userId, friendUsername) {
    const db = getDatabase();
    
    // Get current user
    const currentUser = await db.collection('accounts').findOne({ _id: new ObjectId(userId) });
    if (!currentUser) {
      throw new Error('Current user not found');
    }

    // Find friend by username (case insensitive)
    const friend = await User.findByUsername(friendUsername);
    if (!friend) {
      throw new Error('User not found');
    }

    const friendId = friend._id.toString();
    
    if (userId === friendId) {
      throw new Error('Cannot send friend request to yourself');
    }

    // Check if friendship or request already exists
    const existing = await db.collection(COLLECTION_NAME).findOne({
      $or: [
        { userId: new ObjectId(userId), friendId: new ObjectId(friendId) },
        { userId: new ObjectId(friendId), friendId: new ObjectId(userId) }
      ]
    });

    if (existing) {
      if (existing.status === 'accepted') {
        throw new Error('You are already friends');
      } else if (existing.status === 'pending') {
        if (existing.userId.toString() === userId) {
          throw new Error('Friend request already sent');
        } else {
          throw new Error('You have a pending friend request from this user');
        }
      }
    }

    // Create friend request (pending)
    const friendship = {
      userId: new ObjectId(userId),
      friendId: new ObjectId(friendId),
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection(COLLECTION_NAME).insertOne(friendship);
    return friendship;
  }

  static async acceptFriendRequest(userId, friendUsername) {
    const db = getDatabase();
    
    // Find friend by username (case insensitive)
    const friend = await User.findByUsername(friendUsername);
    if (!friend) {
      throw new Error('User not found');
    }

    const friendId = friend._id.toString();
    
    // Find pending request where friend sent request to current user
    const request = await db.collection(COLLECTION_NAME).findOne({
      userId: new ObjectId(friendId),
      friendId: new ObjectId(userId),
      status: 'pending'
    });

    if (!request) {
      throw new Error('Friend request not found');
    }

    // Update status to accepted
    await db.collection(COLLECTION_NAME).updateOne(
      { _id: request._id },
      { 
        $set: { 
          status: 'accepted',
          updatedAt: new Date()
        }
      }
    );

    return { success: true };
  }

  static async declineFriendRequest(userId, friendUsername) {
    const db = getDatabase();
    
    // Find friend by username (case insensitive)
    const friend = await User.findByUsername(friendUsername);
    if (!friend) {
      throw new Error('User not found');
    }

    const friendId = friend._id.toString();
    
    // Find and delete pending request
    const result = await db.collection(COLLECTION_NAME).deleteOne({
      userId: new ObjectId(friendId),
      friendId: new ObjectId(userId),
      status: 'pending'
    });

    if (result.deletedCount === 0) {
      throw new Error('Friend request not found');
    }

    return { success: true };
  }

  static async removeFriend(userId, friendUsername) {
    const db = getDatabase();
    
    // Find friend by username (case insensitive)
    const friend = await User.findByUsername(friendUsername);
    if (!friend) {
      throw new Error('User not found');
    }

    const friendId = friend._id.toString();
    
    const result = await db.collection(COLLECTION_NAME).deleteOne({
      $or: [
        { userId: new ObjectId(userId), friendId: new ObjectId(friendId) },
        { userId: new ObjectId(friendId), friendId: new ObjectId(userId) }
      ]
    });

    if (result.deletedCount === 0) {
      throw new Error('Friendship not found');
    }

    return { success: true };
  }

  static async getFriends(userId) {
    const db = getDatabase();
    
    // Only get accepted friendships
    const friendships = await db.collection(COLLECTION_NAME).find({
      $or: [
        { userId: new ObjectId(userId), status: 'accepted' },
        { friendId: new ObjectId(userId), status: 'accepted' }
      ]
    }).toArray();

    const friendIds = friendships.map(f => 
      f.userId.toString() === userId ? f.friendId.toString() : f.userId.toString()
    );

    if (friendIds.length === 0) {
      return [];
    }

    const friends = await db.collection('accounts').find({
      _id: { $in: friendIds.map(id => new ObjectId(id)) }
    }).toArray();

    return friends.map(friend => ({
      id: friend._id.toString(),
      username: friend.username,
      email: friend.email,
    }));
  }

  static async getPendingRequests(userId) {
    const db = getDatabase();
    
    // Get requests sent TO current user (incoming)
    const incomingRequests = await db.collection(COLLECTION_NAME).find({
      friendId: new ObjectId(userId),
      status: 'pending'
    }).toArray();

    // Get requests sent BY current user (outgoing)
    const outgoingRequests = await db.collection(COLLECTION_NAME).find({
      userId: new ObjectId(userId),
      status: 'pending'
    }).toArray();

    const incomingUserIds = incomingRequests.map(r => r.userId.toString());
    const outgoingUserIds = outgoingRequests.map(r => r.friendId.toString());

    const allUserIds = [...incomingUserIds, ...outgoingUserIds];
    
    if (allUserIds.length === 0) {
      return { incoming: [], outgoing: [] };
    }

    const users = await db.collection('accounts').find({
      _id: { $in: allUserIds.map(id => new ObjectId(id)) }
    }).toArray();

    const userMap = {};
    users.forEach(user => {
      userMap[user._id.toString()] = {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
      };
    });

    return {
      incoming: incomingUserIds.map(id => userMap[id]).filter(Boolean),
      outgoing: outgoingUserIds.map(id => userMap[id]).filter(Boolean),
    };
  }

  static async getFriendStatus(userId, friendUsername) {
    const db = getDatabase();
    
    // Find friend by username (case insensitive)
    const friend = await User.findByUsername(friendUsername);
    if (!friend) {
      return null;
    }

    const friendId = friend._id.toString();
    
    const friendship = await db.collection(COLLECTION_NAME).findOne({
      $or: [
        { userId: new ObjectId(userId), friendId: new ObjectId(friendId) },
        { userId: new ObjectId(friendId), friendId: new ObjectId(userId) }
      ]
    });

    if (!friendship) {
      return null;
    }

    return {
      isFriend: true,
      status: friendship.status,
    };
  }
}

