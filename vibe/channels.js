// routes/channels.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /api/servers/:id/channels — via server route, but also direct
router.get('/server/:serverId', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.serverId } }
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const channels = await global.prisma.channel.findMany({
      where: { serverId: req.params.serverId },
      orderBy: { position: 'asc' },
    });
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// POST /api/servers/:serverId/channels
router.post('/server/:serverId', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.serverId } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    const { name, description, type, categoryName, slowMode, isNsfw } = req.body;
    if (!name) return res.status(400).json({ error: 'Channel name required' });

    const maxPos = await global.prisma.channel.aggregate({ where: { serverId: req.params.serverId }, _max: { position: true } });

    const channel = await global.prisma.channel.create({
      data: {
        serverId: req.params.serverId,
        name: name.toLowerCase().replace(/\s+/g, '-').slice(0, 32),
        description: description || '',
        type: type || 'text',
        categoryName: categoryName || 'General',
        slowMode: slowMode ? parseInt(slowMode) : 0,
        isNsfw: isNsfw || false,
        position: (maxPos._max.position || 0) + 1,
      }
    });

    await global.prisma.auditLog.create({
      data: { serverId: req.params.serverId, actorId: req.user.id, action: `Created channel #${channel.name}`, targetId: channel.id }
    });

    global.io?.to(`server:${req.params.serverId}`).emit('channel_created', channel);
    res.status(201).json(channel);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// PATCH /api/channels/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    const { name, description, slowMode, isNsfw, categoryName, position } = req.body;
    const data = {};
    if (name) data.name = name.toLowerCase().replace(/\s+/g, '-').slice(0, 32);
    if (description !== undefined) data.description = description;
    if (slowMode !== undefined) data.slowMode = parseInt(slowMode);
    if (isNsfw !== undefined) data.isNsfw = Boolean(isNsfw);
    if (categoryName) data.categoryName = categoryName;
    if (position !== undefined) data.position = parseInt(position);

    const updated = await global.prisma.channel.update({ where: { id: req.params.id }, data });
    global.io?.to(`server:${channel.serverId}`).emit('channel_updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE /api/channels/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    await global.prisma.channel.delete({ where: { id: req.params.id } });
    global.io?.to(`server:${channel.serverId}`).emit('channel_deleted', { channelId: req.params.id, serverId: channel.serverId });
    res.json({ message: 'Channel deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// GET /api/channels/:id/messages
router.get('/:id/messages', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const { before, limit = 50 } = req.query;
    const where = { channelId: req.params.id };
    if (before) where.createdAt = { lt: new Date(before) };

    const messages = await global.prisma.message.findMany({
      where,
      include: {
        author: { select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, equippedTag: true, equippedAvatarFx: true } },
        reactions: { include: { user: { select: { id: true, displayName: true } } } },
        attachments: true,
        poll: { include: { options: { include: { votes: true } }, votes: true } },
        replyTo: { include: { author: { select: { id: true, displayName: true, avatarUrl: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit), 100),
    });

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/channels/:id/pins
router.get('/:id/pins', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const pins = await global.prisma.message.findMany({
      where: { channelId: req.params.id, isPinned: true },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(pins);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// POST /api/channels/:id/pins/:messageId
router.post('/:id/pins/:messageId', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    await global.prisma.message.update({ where: { id: req.params.messageId }, data: { isPinned: true } });
    global.io?.to(`channel:${req.params.id}`).emit('message_pinned', { messageId: req.params.messageId, channelId: req.params.id });
    res.json({ message: 'Pinned' });
  } catch (err) {
    res.status(500).json({ error: 'Pin failed' });
  }
});

// DELETE /api/channels/:id/pins/:messageId
router.delete('/:id/pins/:messageId', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: channel.serverId } }
    });
    if (!member || !['owner', 'admin', 'moderator'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    await global.prisma.message.update({ where: { id: req.params.messageId }, data: { isPinned: false } });
    global.io?.to(`channel:${req.params.id}`).emit('message_unpinned', { messageId: req.params.messageId, channelId: req.params.id });
    res.json({ message: 'Unpinned' });
  } catch (err) {
    res.status(500).json({ error: 'Unpin failed' });
  }
});

// GET /api/channels/:id/search
router.get('/:id/search', auth, async (req, res) => {
  try {
    const channel = await global.prisma.channel.findUnique({ where: { id: req.params.id } });
    if (!channel) return res.status(404).json({ error: 'Not found' });

    const { q } = req.query;
    if (!q) return res.json([]);

    const messages = await global.prisma.message.findMany({
      where: { channelId: req.params.id, content: { contains: q, mode: 'insensitive' } },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
