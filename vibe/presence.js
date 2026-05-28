// socket/presence.js
module.exports = function(io, prisma, redis) {
  const onlineUsers = new Map(); // userId -> socketId

  io.on('connection', async (socket) => {
    // Auth via token in handshake
    const token = socket.handshake.auth?.token;
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'vibe_secret_key');
        socket.userId = decoded.id;

        const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: { id: true, displayName: true, status: true, avatarUrl: true } });
        if (user) {
          socket.displayName = user.displayName;
          onlineUsers.set(decoded.id, socket.id);

          // Join personal room
          socket.join(`user:${decoded.id}`);

          // Join all server rooms
          const memberships = await prisma.serverMember.findMany({ where: { userId: decoded.id }, select: { serverId: true } });
          for (const m of memberships) socket.join(`server:${m.serverId}`);

          // Update status to online if not invisible/dnd
          if (user.status !== 'invisible' && user.status !== 'dnd') {
            await prisma.user.update({ where: { id: decoded.id }, data: { status: 'online' } });
            io.emit('presence_update', { userId: decoded.id, status: 'online' });
          }
        }
      } catch (err) {
        // Invalid token, proceed without auth
      }
    }

    // Status update
    socket.on('update_status', async ({ status }) => {
      if (!socket.userId) return;
      if (!['online', 'away', 'dnd', 'invisible'].includes(status)) return;
      await prisma.user.update({ where: { id: socket.userId }, data: { status } });
      io.emit('presence_update', { userId: socket.userId, status });
    });

    // Update presence (generic)
    socket.on('update_presence', async ({ status }) => {
      if (!socket.userId || !status) return;
      await prisma.user.update({ where: { id: socket.userId }, data: { status } });
      io.emit('presence_update', { userId: socket.userId, status });
    });

    // Disconnect
    socket.on('disconnect', async () => {
      if (!socket.userId) return;
      onlineUsers.delete(socket.userId);

      // Only mark offline if no other sockets for this user
      const userSockets = [];
      for (const [, sId] of io.sockets.sockets) {
        // Actually check by userId
      }
      const remainingSockets = [...io.sockets.sockets.values()].filter(s => s.userId === socket.userId);
      if (remainingSockets.length === 0) {
        try {
          const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { status: true } });
          if (user && user.status !== 'invisible') {
            await prisma.user.update({ where: { id: socket.userId }, data: { status: 'offline' } });
            io.emit('presence_update', { userId: socket.userId, status: 'offline' });
          }
        } catch (e) {}
      }
    });
  });
};
