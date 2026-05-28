// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authLimiter } = require('../middleware/rateLimit');
const { uploadAvatar } = require('../middleware/upload');
const { awardXP } = require('../utils/xp');

const JWT_SECRET         = process.env.JWT_SECRET         || 'vibe_dev_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'vibe_dev_refresh';

function generateTokens(userId) {
  const access  = jwt.sign({ id: userId }, JWT_SECRET,         { expiresIn: '15m' });
  const refresh = jwt.sign({ id: userId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: '30d' });
  return { access, refresh };
}

// POST /api/auth/register
router.post('/register', authLimiter, (req, res, next) => {
  // Run avatar upload but don't fail the whole request if it errors
  uploadAvatar.single('avatar')(req, res, (uploadErr) => {
    if (uploadErr) {
      console.warn('Avatar upload skipped (non-fatal):', uploadErr.message);
      // req.file will be undefined — route uses DiceBear fallback
    }
    next();
  });
}, async (req, res) => {
  try {
    const { username, displayName, password, email } = req.body;

    // Validation
    if (!username || !displayName || !password)
      return res.status(400).json({ error: 'Username, display name and password are required' });
    if (username.length < 3 || username.length > 32)
      return res.status(400).json({ error: 'Username must be 3–32 characters' });
    if (!/^[a-zA-Z0-9_.-]+$/.test(username))
      return res.status(400).json({ error: 'Username can only contain letters, numbers, _ . -' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (displayName.length > 40)
      return res.status(400).json({ error: 'Display name too long (max 40 chars)' });

    const existing = await global.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (existing) return res.status(409).json({ error: 'Username is already taken' });

    const passwordHash = await bcrypt.hash(password, 12);
    const avatarUrl = req.file?.path
      || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}&backgroundColor=b6e3f4`;

    const user = await global.prisma.user.create({
      data: {
        username:     username.toLowerCase(),
        displayName:  displayName.trim(),
        passwordHash,
        email:        email?.trim() || null,
        avatarUrl,
        credits:      100,
        streak:       1,
        lastLogin:    new Date(),
      },
    });

    // Early adopter title for first 1000 users
    try {
      const userCount = await global.prisma.user.count();
      if (userCount <= 1000) {
        const earlyTitle = await global.prisma.shopItem.findFirst({ where: { assetData: '⚡ Early Adopter' } });
        if (earlyTitle) {
          await global.prisma.userItem.create({ data: { userId: user.id, itemId: earlyTitle.id, isEquipped: true } });
          await global.prisma.user.update({ where: { id: user.id }, data: { equippedTitle: '⚡ Early Adopter' } });
        }
      }
    } catch (e) {
      console.warn('Early adopter title skipped:', e.message);
    }

    const { access, refresh } = generateTokens(user.id);
    await global.prisma.user.update({ where: { id: user.id }, data: { refreshToken: refresh } });

    return res.status(201).json({
      token:        access,
      refreshToken: refresh,
      user: {
        id:          user.id,
        username:    user.username,
        displayName: user.displayName,
        avatarUrl:   user.avatarUrl,
        level:       user.level,
        xp:          user.xp,
        credits:     user.credits,
        streak:      user.streak,
        status:      user.status,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    // Surface Prisma-specific errors nicely
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username is already taken' });
    return res.status(500).json({ error: 'Registration failed — check server logs' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await global.prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    // Daily streak
    const now      = new Date();
    const dayDiff  = Math.floor((now - new Date(user.lastLogin)) / 86400000);
    let newStreak  = user.streak;
    let bonusXP    = 50;

    if      (dayDiff === 1)       { newStreak += 1; if (newStreak >= 30) bonusXP = 200; else if (newStreak >= 7) bonusXP = 100; }
    else if (dayDiff > 1)         { newStreak = 1; }

    const xpResult = await awardXP(user.id, bonusXP);

    await global.prisma.user.update({
      where: { id: user.id },
      data:  { streak: newStreak, lastLogin: now, status: 'online', xp: xpResult.newXp, level: xpResult.newLevel },
    });

    if (newStreak % 7 === 0 && dayDiff === 1) {
      await global.prisma.user.update({ where: { id: user.id }, data: { credits: { increment: 50 } } });
    }

    const { access, refresh } = generateTokens(user.id);
    await global.prisma.user.update({ where: { id: user.id }, data: { refreshToken: refresh } });

    const freshUser = await global.prisma.user.findUnique({
      where:  { id: user.id },
      select: {
        id: true, username: true, displayName: true, avatarUrl: true,
        level: true, xp: true, credits: true, streak: true, status: true,
        bio: true, equippedTag: true, equippedBanner: true, equippedAvatarFx: true, equippedTitle: true,
      },
    });

    return res.json({ token: access, refreshToken: refresh, user: freshUser });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed — check server logs' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const user    = await global.prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || user.refreshToken !== refreshToken) return res.status(403).json({ error: 'Invalid refresh token' });

    const { access, refresh } = generateTokens(user.id);
    await global.prisma.user.update({ where: { id: user.id }, data: { refreshToken: refresh } });
    return res.json({ token: access, refreshToken: refresh });
  } catch {
    return res.status(403).json({ error: 'Token rotation failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const decoded = jwt.decode(refreshToken);
      if (decoded?.id) {
        await global.prisma.user.update({
          where: { id: decoded.id },
          data:  { refreshToken: null, status: 'invisible' },
        });
      }
    }
    return res.json({ message: 'Logged out' });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/check-username
router.get('/check-username', async (req, res) => {
  const { username } = req.query;
  if (!username || username.length < 3) return res.json({ available: false });
  const user = await global.prisma.user.findUnique({ where: { username: username.toLowerCase() } }).catch(() => null);
  return res.json({ available: !user });
});

module.exports = router;
