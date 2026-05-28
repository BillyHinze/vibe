// middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'vibe_secret_key');
    req.user = decoded;

    // Attach fresh user from DB
    const user = await global.prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true, username: true, displayName: true,
        avatarUrl: true, level: true, xp: true, credits: true,
        streak: true, status: true, bio: true,
        equippedTag: true, equippedBanner: true,
        equippedAvatarFx: true, equippedTitle: true,
      }
    });
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { ...decoded, ...user };
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};
