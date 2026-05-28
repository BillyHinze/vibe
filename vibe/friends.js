// routes/friends.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /api/friends
router.get('/', auth, async (req, res) => {
  try {
    const friendships = await global.prisma.friendship.findMany({
      where: { OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
      include: {
        requester: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, level: true } },
        addressee: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, level: true } },
      }
    });
    res.json(friendships);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// POST /api/friends/request/:userId
router.post('/request/:userId', auth, async (req, res) => {
  try {
    if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });

    const existing = await global.prisma.friendship.findFirst({
      where: { OR: [{ requesterId: req.user.id, addresseeId: req.params.userId }, { requesterId: req.params.userId, addresseeId: req.user.id }] }
    });
    if (existing) return res.status(409).json({ error: 'Request already exists' });

    const friendship = await global.prisma.friendship.create({
      data: { requesterId: req.user.id, addresseeId: req.params.userId, status: 'pending' }
    });

    // Notification
    const notif = await global.prisma.notification.create({
      data: { userId: req.params.userId, type: 'friend_request', content: `**${req.user.displayName}** sent you a friend request`, relatedId: req.user.id }
    });

    global.io?.to(`user:${req.params.userId}`).emit('friend_request_received', { friendship, from: req.user, notification: notif });
    res.status(201).json(friendship);
  } catch (err) {
    res.status(500).json({ error: 'Request failed' });
  }
});

// POST /api/friends/accept/:userId
router.post('/accept/:userId', auth, async (req, res) => {
  try {
    const friendship = await global.prisma.friendship.findFirst({
      where: { requesterId: req.params.userId, addresseeId: req.user.id, status: 'pending' }
    });
    if (!friendship) return res.status(404).json({ error: 'No pending request' });

    const updated = await global.prisma.friendship.update({ where: { id: friendship.id }, data: { status: 'accepted' } });

    const notif = await global.prisma.notification.create({
      data: { userId: req.params.userId, type: 'friend_accepted', content: `**${req.user.displayName}** accepted your friend request`, relatedId: req.user.id }
    });

    global.io?.to(`user:${req.params.userId}`).emit('friend_accepted', { friendship: updated, user: req.user, notification: notif });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Accept failed' });
  }
});

// POST /api/friends/decline/:userId
router.post('/decline/:userId', auth, async (req, res) => {
  try {
    await global.prisma.friendship.deleteMany({
      where: { requesterId: req.params.userId, addresseeId: req.user.id }
    });
    res.json({ message: 'Declined' });
  } catch (err) {
    res.status(500).json({ error: 'Decline failed' });
  }
});

// DELETE /api/friends/:userId
router.delete('/:userId', auth, async (req, res) => {
  try {
    await global.prisma.friendship.deleteMany({
      where: { OR: [{ requesterId: req.user.id, addresseeId: req.params.userId }, { requesterId: req.params.userId, addresseeId: req.user.id }] }
    });
    res.json({ message: 'Unfriended' });
  } catch (err) {
    res.status(500).json({ error: 'Unfriend failed' });
  }
});

module.exports = router;
