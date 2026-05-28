// socket/notifications.js
module.exports = function(io, prisma, redis) {
  io.on('connection', (socket) => {
    socket.on('mark_read', async ({ notificationIds }) => {
      if (!socket.userId) return;
      if (notificationIds?.length) {
        await prisma.notification.updateMany({ where: { id: { in: notificationIds }, userId: socket.userId }, data: { read: true } });
      } else {
        await prisma.notification.updateMany({ where: { userId: socket.userId }, data: { read: true } });
      }
      socket.emit('notifications_read', { notificationIds });
    });

    socket.on('friend_request', async ({ toUserId }) => {
      if (!socket.userId || !toUserId) return;
      try {
        const existing = await prisma.friendship.findFirst({
          where: { OR: [{ requesterId: socket.userId, addresseeId: toUserId }, { requesterId: toUserId, addresseeId: socket.userId }] }
        });
        if (existing) return;

        const friendship = await prisma.friendship.create({ data: { requesterId: socket.userId, addresseeId: toUserId, status: 'pending' } });
        const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { displayName: true, avatarUrl: true } });

        const notif = await prisma.notification.create({
          data: { userId: toUserId, type: 'friend_request', content: `**${user.displayName}** sent you a friend request`, relatedId: socket.userId }
        });

        io.to(`user:${toUserId}`).emit('friend_request_received', { friendship, from: { id: socket.userId, ...user }, notification: notif });
      } catch (e) {}
    });

    socket.on('friend_accept', async ({ requesterId }) => {
      if (!socket.userId) return;
      try {
        const friendship = await prisma.friendship.findFirst({
          where: { requesterId, addresseeId: socket.userId, status: 'pending' }
        });
        if (!friendship) return;
        const updated = await prisma.friendship.update({ where: { id: friendship.id }, data: { status: 'accepted' } });
        const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { displayName: true, avatarUrl: true } });

        const notif = await prisma.notification.create({
          data: { userId: requesterId, type: 'friend_accepted', content: `**${user.displayName}** accepted your friend request`, relatedId: socket.userId }
        });

        io.to(`user:${requesterId}`).emit('friend_accepted', { friendship: updated, user: { id: socket.userId, ...user }, notification: notif });
      } catch (e) {}
    });

    socket.on('friend_decline', async ({ requesterId }) => {
      if (!socket.userId) return;
      await prisma.friendship.deleteMany({ where: { requesterId, addresseeId: socket.userId } });
    });

    socket.on('send_dm', async ({ toUserId, content }) => {
      if (!socket.userId || !toUserId || !content) return;
      try {
        const dm = await prisma.directMessage.create({
          data: { senderId: socket.userId, receiverId: toUserId, content: content.slice(0, 2000) },
          include: { sender: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } } }
        });

        const notif = await prisma.notification.create({
          data: { userId: toUserId, type: 'dm', content: `**${dm.sender.displayName}**: ${content.slice(0, 50)}`, relatedId: socket.userId }
        });

        io.to(`user:${toUserId}`).emit('new_dm', { dm, notification: notif });
        socket.emit('dm_sent', { dm });
      } catch (e) {
        console.error('send_dm socket error:', e);
      }
    });
  });
};
