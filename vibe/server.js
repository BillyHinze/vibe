// server.js — VIBE main server
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const app = express();
const server = http.createServer(app);
const prisma = new PrismaClient();

// ── Redis (optional) ─────────────────────────────────────────────
const memStore = new Map();
const fallbackRedis = {
  get:     async (k)        => memStore.get(k) ?? null,
  set:     async (k, v)     => { memStore.set(k, v); return 'OK'; },
  setex:   async (k, t, v)  => { memStore.set(k, v); return 'OK'; },
  del:     async (k)        => { memStore.delete(k); return 1; },
  incr:    async (k)        => { const v = (parseInt(memStore.get(k)) || 0) + 1; memStore.set(k, String(v)); return v; },
  expire:  async ()         => 1,
  ttl:     async ()         => -1,
  publish: async ()         => 0,
  subscribe: async ()       => {},
  on:      ()               => {},
};

let redis = fallbackRedis;

if (process.env.REDIS_URL) {
  try {
    const Redis = require('ioredis');
    const client = new Redis(process.env.REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
    client.on('error', (err) => console.warn('Redis error (non-fatal):', err.message));
    client.connect().then(() => {
      redis = client;
      global.redis = redis;
      console.log('✅ Redis connected');
    }).catch((e) => console.warn('Redis connect failed, using in-memory fallback:', e.message));
  } catch (e) {
    console.warn('ioredis not available, using in-memory fallback');
  }
}

global.redis = redis;
global.prisma = prisma;

// ── Middleware ────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime().toFixed(1) + 's', timestamp: new Date() }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/servers',       require('./routes/servers'));
app.use('/api/channels',      require('./routes/channels'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/friends',       require('./routes/friends'));
app.use('/api/shop',          require('./routes/shop'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dm',            require('./routes/dm'));

// ── Socket.IO ─────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 60000,
});

global.io = io;

require('./socket/chat')(io, prisma, redis);
require('./socket/presence')(io, prisma, redis);
require('./socket/notifications')(io, prisma, redis);

// ── Error handler (must be after routes) ─────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Shop seed ─────────────────────────────────────────────────────
async function seedShopItems() {
  const count = await prisma.shopItem.count();
  if (count > 0) return;
  const items = [
    { name: '🔥 FIRE',        type: 'tag',      description: 'Blazing chat tag',            price: 50,  assetData: 'tag-fire',        rarity: 'common' },
    { name: '💀 LEGEND',      type: 'tag',      description: 'Legendary chat tag',           price: 100, assetData: 'tag-legend',      rarity: 'rare' },
    { name: '✨ VIBE',         type: 'tag',      description: 'The VIBE tag',                price: 75,  assetData: 'tag-vibe',        rarity: 'common' },
    { name: '👑 ROYALTY',     type: 'tag',      description: 'Royal chat tag',               price: 200, assetData: 'tag-royalty',     rarity: 'epic' },
    { name: '🌌 GALAXY',      type: 'tag',      description: 'Cosmic chat tag',             price: 150, assetData: 'tag-galaxy',      rarity: 'rare' },
    { name: 'Neon City',       type: 'banner',   description: 'Neon cityscape banner',       price: 200, assetData: 'banner-neoncity', rarity: 'rare' },
    { name: 'Deep Space',      type: 'banner',   description: 'Deep space banner',           price: 300, assetData: 'banner-space',    rarity: 'epic' },
    { name: 'Cyber Grid',      type: 'banner',   description: 'Cyberpunk grid banner',       price: 250, assetData: 'banner-cyber',    rarity: 'rare' },
    { name: 'Aurora',          type: 'banner',   description: 'Northern lights banner',      price: 500, assetData: 'banner-aurora',   rarity: 'legendary' },
    { name: 'Pulse Glow',      type: 'avatarFx', description: 'Pulsing purple glow ring',    price: 150, assetData: 'fx-pulse',        rarity: 'common' },
    { name: 'Rainbow Spin',    type: 'avatarFx', description: 'Rainbow spinning ring',       price: 300, assetData: 'fx-rainbow',      rarity: 'rare' },
    { name: 'Fire Ring',       type: 'avatarFx', description: 'Fiery animated ring',         price: 400, assetData: 'fx-fire',         rarity: 'epic' },
    { name: 'Hologram',        type: 'avatarFx', description: 'Holographic shimmer effect',  price: 500, assetData: 'fx-holo',         rarity: 'legendary' },
    { name: '⚡ Early Adopter', type: 'title',   description: 'First to join VIBE',          price: 0,   assetData: '⚡ Early Adopter', rarity: 'legendary' },
    { name: '🏆 Top Chatter',  type: 'title',   description: 'Most active chatter',         price: 100, assetData: '🏆 Top Chatter',  rarity: 'rare' },
    { name: '👑 VIBE King',    type: 'title',   description: 'King of VIBE',               price: 300, assetData: '👑 VIBE King',    rarity: 'epic' },
    { name: '💎 Diamond',      type: 'title',   description: 'Diamond tier member',         price: 200, assetData: '💎 Diamond',      rarity: 'rare' },
  ];
  await prisma.shopItem.createMany({ data: items });
  console.log('✅ Shop items seeded');
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n🔮 VIBE running on http://localhost:${PORT}`);
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
    await seedShopItems();
  } catch (e) {
    console.error('❌ DB connection error:', e.message);
    console.error('Make sure DATABASE_URL is set and you ran: npx prisma migrate dev');
  }
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
