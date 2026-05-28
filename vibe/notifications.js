// routes/notifications.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /api/notifications
router.get('/', auth, async (req, res) => {
  try {
    const notifs = await global.prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// PATCH /api/notifications/read
router.patch('/read', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (ids && ids.length) {
      await global.prisma.notification.updateMany({ where: { id: { in: ids }, userId: req.user.id }, data: { read: true } });
    } else {
      await global.prisma.notification.updateMany({ where: { userId: req.user.id }, data: { read: true } });
    }
    res.json({ message: 'Marked read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
