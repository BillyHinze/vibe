// routes/messages.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadAttachment } = require('../middleware/upload');
const { awardXP } = require('../utils/xp');

// PATCH /api/messages/:id — edit
router.patch('/:id', auth, async (req, res) => {
  try {
    const msg = await global.prisma.message.findUnique({ where: { id: req.params.id }, include: { channel: true } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.authorId !== req.user.id) return res.status(403).json({ error: 'Not your message' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });

    const updated = await global.prisma.message.update({
      where: { id: req.params.id },
      data: { content: content.slice(0, 2000), editedAt: new Date() },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } } }
    });

    global.io?.to(`channel:${msg.channelId}`).emit('message_edited', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Edit failed' });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const msg = await global.prisma.message.findUnique({
      where: { id: req.params.id },
      include: { channel: { include: { server: { include: { members: { where: { userId: req.user.id } } } } } } }
    });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const myMembership = msg.channel.server.members[0];
    const isAdmin = myMembership && ['owner', 'admin', 'moderator'].includes(myMembership.role);

    if (msg.authorId !== req.user.id && !isAdmin) return res.status(403).json({ error: 'No permission' });

    await global.prisma.message.delete({ where: { id: req.params.id } });
    global.io?.to(`channel:${msg.channelId}`).emit('message_deleted', { messageId: req.params.id, channelId: msg.channelId });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

// POST /api/messages/:id/react
router.post('/:id/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'Emoji required' });

    const msg = await global.prisma.message.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    // Toggle reaction
    const existing = await global.prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId: req.params.id, userId: req.user.id, emoji } }
    });

    if (existing) {
      await global.prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await global.prisma.reaction.create({ data: { messageId: req.params.id, userId: req.user.id, emoji } });

      // XP for message author
      if (msg.authorId !== req.user.id) {
        const xpResult = await awardXP(msg.authorId, 1);
        await global.prisma.user.update({ where: { id: msg.authorId }, data: { xp: xpResult.newXp, level: xpResult.newLevel } });
      }
    }

    const reactions = await global.prisma.reaction.findMany({
      where: { messageId: req.params.id },
      include: { user: { select: { id: true, displayName: true } } },
    });

    global.io?.to(`channel:${msg.channelId}`).emit('reaction_updated', { messageId: req.params.id, channelId: msg.channelId, reactions });
    res.json({ reactions });
  } catch (err) {
    res.status(500).json({ error: 'React failed' });
  }
});

// DELETE /api/messages/:id/react
router.delete('/:id/react', auth, async (req, res) => {
  try {
    const { emoji } = req.body;
    await global.prisma.reaction.deleteMany({ where: { messageId: req.params.id, userId: req.user.id, emoji } });
    const msg = await global.prisma.message.findUnique({ where: { id: req.params.id } });
    const reactions = await global.prisma.reaction.findMany({
      where: { messageId: req.params.id },
      include: { user: { select: { id: true, displayName: true } } },
    });
    if (msg) global.io?.to(`channel:${msg.channelId}`).emit('reaction_updated', { messageId: req.params.id, reactions });
    res.json({ reactions });
  } catch (err) {
    res.status(500).json({ error: 'Remove react failed' });
  }
});

// POST /api/messages/upload — file upload for attachments
router.post('/upload', auth, (req, res, next) => { uploadAttachment.single('file')(req, res, (err) => { if (err) { console.warn('Upload failed:', err.message); return res.status(400).json({error: 'Upload failed: ' + err.message}); } next(); }); }, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({
      url: req.file.path,
      filename: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
