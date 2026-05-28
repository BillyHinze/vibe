// routes/servers.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadServerIcon } = require('../middleware/upload');
const { v4: uuidv4 } = require('uuid');

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// GET /api/servers — get user's servers
router.get('/', auth, async (req, res) => {
  try {
    const memberships = await global.prisma.serverMember.findMany({
      where: { userId: req.user.id },
      include: {
        server: {
          include: {
            _count: { select: { members: true } },
            channels: { take: 1, orderBy: { position: 'asc' }, where: { type: 'text' } },
          }
        }
      }
    });
    res.json(memberships.map(m => ({ ...m.server, role: m.role, memberCount: m.server._count.members })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// GET /api/servers/explore — public servers
router.get('/explore', auth, async (req, res) => {
  try {
    const servers = await global.prisma.server.findMany({
      where: { isPublic: true },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const joined = await global.prisma.serverMember.findMany({ where: { userId: req.user.id }, select: { serverId: true } });
    const joinedIds = new Set(joined.map(j => j.serverId));
    res.json(servers.map(s => ({ ...s, memberCount: s._count.members, joined: joinedIds.has(s.id) })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

// POST /api/servers — create server
router.post('/', auth, (req, res, next) => { uploadServerIcon.single('icon')(req, res, (err) => { if (err) console.warn('Upload skipped:', err.message); next(); }); }, async (req, res) => {
  try {
    const { name, description, isPublic } = req.body;
    if (!name || name.length < 2) return res.status(400).json({ error: 'Name required (min 2 chars)' });

    const server = await global.prisma.server.create({
      data: {
        name: name.slice(0, 64),
        description: description?.slice(0, 256) || '',
        iconUrl: req.file?.path || null,
        ownerId: req.user.id,
        inviteCode: generateInviteCode(),
        isPublic: isPublic !== 'false',
      }
    });

    // Add owner as member with owner role
    await global.prisma.serverMember.create({ data: { userId: req.user.id, serverId: server.id, role: 'owner' } });

    // Create default channels
    await global.prisma.channel.createMany({
      data: [
        { serverId: server.id, name: 'general', description: 'General chat', type: 'text', categoryName: 'Text Channels', position: 0 },
        { serverId: server.id, name: 'announcements', description: 'Server announcements', type: 'text', categoryName: 'Text Channels', position: 1 },
        { serverId: server.id, name: 'general-voice', description: 'Voice chat', type: 'voice', categoryName: 'Voice Channels', position: 2 },
      ]
    });

    res.status(201).json(server);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create server' });
  }
});

// GET /api/servers/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const server = await global.prisma.server.findUnique({
      where: { id: req.params.id },
      include: {
        channels: { orderBy: { position: 'asc' } },
        _count: { select: { members: true } },
      }
    });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    res.json({ ...server, memberCount: server._count.members, myRole: member.role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// PATCH /api/servers/:id
router.patch('/:id', auth, (req, res, next) => { uploadServerIcon.single('icon')(req, res, (err) => { if (err) console.warn('Upload skipped:', err.message); next(); }); }, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Insufficient permissions' });

    const { name, description, isPublic } = req.body;
    const data = {};
    if (name) data.name = name.slice(0, 64);
    if (description !== undefined) data.description = description.slice(0, 256);
    if (isPublic !== undefined) data.isPublic = isPublic !== 'false';
    if (req.file?.path) data.iconUrl = req.file.path;

    const server = await global.prisma.server.update({ where: { id: req.params.id }, data });
    global.io?.to(`server:${req.params.id}`).emit('server_updated', server);
    res.json(server);
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// DELETE /api/servers/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const server = await global.prisma.server.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ error: 'Server not found' });
    if (server.ownerId !== req.user.id) return res.status(403).json({ error: 'Only owner can delete' });

    await global.prisma.server.delete({ where: { id: req.params.id } });
    global.io?.to(`server:${req.params.id}`).emit('server_deleted', { serverId: req.params.id });
    res.json({ message: 'Server deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// POST /api/servers/join/:inviteCode
router.post('/join/:inviteCode', auth, async (req, res) => {
  try {
    const server = await global.prisma.server.findUnique({ where: { inviteCode: req.params.inviteCode } });
    if (!server) return res.status(404).json({ error: 'Invalid invite code' });

    const existing = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: server.id } }
    });
    if (existing) return res.status(409).json({ error: 'Already a member' });

    const banned = await global.prisma.serverBan.findUnique({
      where: { serverId_userId: { serverId: server.id, userId: req.user.id } }
    });
    if (banned) return res.status(403).json({ error: 'You are banned from this server' });

    await global.prisma.serverMember.create({ data: { userId: req.user.id, serverId: server.id, role: 'member' } });

    // System message
    const general = await global.prisma.channel.findFirst({ where: { serverId: server.id, type: 'text' }, orderBy: { position: 'asc' } });
    if (general) {
      const sysMsg = await global.prisma.message.create({
        data: { channelId: general.id, authorId: req.user.id, content: `**${req.user.displayName}** joined the server! 🎉`, type: 'system' }
      });
      global.io?.to(`channel:${general.id}`).emit('new_message', { ...sysMsg, author: req.user });
    }

    global.io?.to(`server:${server.id}`).emit('member_joined', { serverId: server.id, user: req.user });
    res.json(server);
  } catch (err) {
    res.status(500).json({ error: 'Failed to join server' });
  }
});

// POST /api/servers/:id/leave
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const server = await global.prisma.server.findUnique({ where: { id: req.params.id } });
    if (server?.ownerId === req.user.id) return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete server.' });

    await global.prisma.serverMember.delete({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    global.io?.to(`server:${req.params.id}`).emit('member_left', { serverId: req.params.id, userId: req.user.id });
    res.json({ message: 'Left server' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to leave server' });
  }
});

// GET /api/servers/:id/members
router.get('/:id/members', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!member) return res.status(403).json({ error: 'Not a member' });

    const members = await global.prisma.serverMember.findMany({
      where: { serverId: req.params.id },
      include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true, level: true, equippedAvatarFx: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// PATCH /api/servers/:id/members/:userId — change role
router.patch('/:id/members/:userId', auth, async (req, res) => {
  try {
    const myMembership = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!myMembership || !['owner', 'admin'].includes(myMembership.role)) return res.status(403).json({ error: 'Insufficient permissions' });

    const { role } = req.body;
    if (!['admin', 'moderator', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const updated = await global.prisma.serverMember.update({
      where: { userId_serverId: { userId: req.params.userId, serverId: req.params.id } },
      data: { role }
    });

    await global.prisma.auditLog.create({
      data: { serverId: req.params.id, actorId: req.user.id, action: `Changed role of ${req.params.userId} to ${role}`, targetId: req.params.userId }
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Role update failed' });
  }
});

// POST /api/servers/:id/ban/:userId
router.post('/:id/ban/:userId', auth, async (req, res) => {
  try {
    const myMembership = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!myMembership || !['owner', 'admin', 'moderator'].includes(myMembership.role)) return res.status(403).json({ error: 'No permission' });

    const { reason } = req.body;
    await global.prisma.serverBan.upsert({
      where: { serverId_userId: { serverId: req.params.id, userId: req.params.userId } },
      create: { serverId: req.params.id, userId: req.params.userId, reason },
      update: { reason },
    });

    // Remove from server
    await global.prisma.serverMember.deleteMany({ where: { userId: req.params.userId, serverId: req.params.id } });

    await global.prisma.auditLog.create({
      data: { serverId: req.params.id, actorId: req.user.id, action: `Banned user`, targetId: req.params.userId, details: reason }
    });

    global.io?.to(`server:${req.params.id}`).emit('member_left', { serverId: req.params.id, userId: req.params.userId, reason: 'banned' });
    res.json({ message: 'Banned' });
  } catch (err) {
    res.status(500).json({ error: 'Ban failed' });
  }
});

// DELETE /api/servers/:id/ban/:userId
router.delete('/:id/ban/:userId', auth, async (req, res) => {
  try {
    await global.prisma.serverBan.delete({ where: { serverId_userId: { serverId: req.params.id, userId: req.params.userId } } });
    res.json({ message: 'Unbanned' });
  } catch (err) {
    res.status(500).json({ error: 'Unban failed' });
  }
});

// GET /api/servers/:id/audit-log
router.get('/:id/audit-log', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    const logs = await global.prisma.auditLog.findMany({
      where: { serverId: req.params.id },
      include: { actor: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// POST /api/servers/:id/regenerate-invite
router.post('/:id/regenerate-invite', auth, async (req, res) => {
  try {
    const member = await global.prisma.serverMember.findUnique({
      where: { userId_serverId: { userId: req.user.id, serverId: req.params.id } }
    });
    if (!member || !['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'No permission' });

    const server = await global.prisma.server.update({
      where: { id: req.params.id },
      data: { inviteCode: generateInviteCode() }
    });
    res.json({ inviteCode: server.inviteCode });
  } catch (err) {
    res.status(500).json({ error: 'Failed to regenerate invite' });
  }
});

module.exports = router;
