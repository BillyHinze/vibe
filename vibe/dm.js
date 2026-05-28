// routes/dm.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /api/dm — all DM conversations
router.get('/', auth, async (req, res) => {
  try {
    const dms = await global.prisma.directMessage.findMany({
      where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true } },
        receiver: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['senderId', 'receiverId'],
    });

    // Group by conversation partner
    const convMap = new Map();
    for (const dm of dms) {
      const partnerId = dm.senderId === req.user.id ? dm.receiverId : dm.senderId;
      if (!convMap.has(partnerId)) {
        const partner = dm.senderId === req.user.id ? dm.receiver : dm.sender;
        const unread = await global.prisma.directMessage.count({
          where: { senderId: partnerId, receiverId: req.user.id, read: false }
        });
        convMap.set(partnerId, { partner, lastMessage: dm, unread });
      }
    }

    res.json([...convMap.values()]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch DMs' });
  }
});

// GET /api/dm/:userId — DM history with user
router.get('/:userId', auth, async (req, res) => {
  try {
    const { before, limit = 50 } = req.query;
    const where = {
      OR: [
        { senderId: req.user.id, receiverId: req.params.userId },
        { senderId: req.params.userId, receiverId: req.user.id },
      ]
    };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await global.prisma.directMessage.findMany({
      where,
      include: {
        sender: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
    });

    // Mark as read
    await global.prisma.directMessage.updateMany({
      where: { senderId: req.params.userId, receiverId: req.user.id, read: false },
      data: { read: true }
    });

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch DM history' });
  }
});

// POST /api/dm/:userId — send DM
router.post('/:userId', auth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });

    const dm = await global.prisma.directMessage.create({
      data: { senderId: req.user.id, receiverId: req.params.userId, content: content.slice(0, 2000) },
      include: { sender: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } } }
    });

    // Notification if recipient is not in DM view
    const notif = await global.prisma.notification.create({
      data: { userId: req.params.userId, type: 'dm', content: `**${req.user.displayName}**: ${content.slice(0, 50)}...`, relatedId: req.user.id }
    });

    global.io?.to(`user:${req.params.userId}`).emit('new_dm', { dm, notification: notif });
    global.io?.to(`user:${req.user.id}`).emit('dm_sent', { dm });
    res.status(201).json(dm);
  } catch (err) {
    res.status(500).json({ error: 'Send DM failed' });
  }
});

module.exports = router;
