// routes/users.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

// GET /api/users/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await global.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, username: true, displayName: true, avatarUrl: true,
        bio: true, status: true, level: true, xp: true, credits: true,
        streak: true, createdAt: true, equippedTag: true,
        equippedBanner: true, equippedAvatarFx: true, equippedTitle: true,
      }
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// PATCH /api/users/me
router.patch("/me", auth, (req, res, next) => { uploadAvatar.single("avatar")(req, res, (err) => { if (err) console.warn("Avatar upload skipped:", err.message); next(); }); }, async (req, res) => {
  try {
    const { displayName, bio, status } = req.body;
    const data = {};
    if (displayName) data.displayName = displayName;
    if (bio !== undefined) data.bio = bio.slice(0, 200);
    if (status && ['online', 'away', 'dnd', 'invisible'].includes(status)) data.status = status;
    if (req.file?.path) data.avatarUrl = req.file.path;

    const user = await global.prisma.user.update({ where: { id: req.user.id }, data,
      select: {
        id: true, username: true, displayName: true, avatarUrl: true,
        bio: true, status: true, level: true, xp: true, credits: true, streak: true,
        equippedTag: true, equippedBanner: true, equippedAvatarFx: true, equippedTitle: true,
      }
    });

    // Broadcast presence update
    global.io?.emit('presence_update', { userId: user.id, status: user.status, avatarUrl: user.avatarUrl, displayName: user.displayName });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// GET /api/users/search
router.get('/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const users = await global.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q.toLowerCase(), mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
        NOT: { id: req.user.id }
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, status: true },
      take: 20,
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/users/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const user = await global.prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, username: true, displayName: true, avatarUrl: true,
        bio: true, status: true, level: true, xp: true, createdAt: true,
        equippedTag: true, equippedBanner: true, equippedAvatarFx: true, equippedTitle: true,
        serverMemberships: { select: { serverId: true } }
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Mutual servers
    const myMemberships = await global.prisma.serverMember.findMany({
      where: { userId: req.user.id },
      select: { serverId: true }
    });
    const myServerIds = new Set(myMemberships.map(m => m.serverId));
    const mutualServers = user.serverMemberships.filter(m => myServerIds.has(m.serverId)).length;

    // Friendship status
    const friendship = await global.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: req.params.id },
          { requesterId: req.params.id, addresseeId: req.user.id },
        ]
      }
    });

    res.json({ ...user, mutualServers, friendshipStatus: friendship?.status || null, friendshipRequesterId: friendship?.requesterId || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// GET /api/users/me/notifications — handled in notifications.js but alias here
router.get('/me/notifications', auth, async (req, res) => {
  try {
    const notifs = await global.prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

module.exports = router;
