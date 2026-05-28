// socket/chat.js
const { awardXP } = require('../utils/xp');

module.exports = function(io, prisma, redis) {
  // Track typing users per channel
  const typingUsers = new Map(); // channelId -> Map(userId -> timeout)
  // Track slow mode cooldowns
  const slowModeCooldowns = new Map(); // `${userId}:${channelId}` -> timestamp

  io.on('connection', (socket) => {

    // Join server room
    socket.on('join_server', ({ serverId }) => {
      if (serverId) socket.join(`server:${serverId}`);
    });

    // Leave server room
    socket.on('leave_server', ({ serverId }) => {
      if (serverId) socket.leave(`server:${serverId}`);
    });

    // Join channel room
    socket.on('join_channel', ({ channelId }) => {
      if (channelId) {
        // Leave all other channels first
        for (const room of socket.rooms) {
          if (room.startsWith('channel:')) socket.leave(room);
        }
        socket.join(`channel:${channelId}`);
        socket.currentChannel = channelId;
      }
    });

    // Send message
    socket.on('send_message', async (data) => {
      try {
        const { channelId, content, replyToId, attachments, pollData, token } = data;
        if (!socket.userId || !channelId || (!content && !attachments?.length && !pollData)) return;

        // Get channel for slow mode check
        const channel = await prisma.channel.findUnique({ where: { id: channelId } });
        if (!channel) return;

        // Slow mode check
        if (channel.slowMode > 0) {
          const key = `${socket.userId}:${channelId}`;
          const lastSent = slowModeCooldowns.get(key) || 0;
          const elapsed = (Date.now() - lastSent) / 1000;
          if (elapsed < channel.slowMode) {
            const remaining = Math.ceil(channel.slowMode - elapsed);
            socket.emit('slow_mode_cooldown', { channelId, remaining });
            return;
          }
          slowModeCooldowns.set(key, Date.now());
        }

        // Verify membership
        const member = await prisma.serverMember.findUnique({
          where: { userId_serverId: { userId: socket.userId, serverId: channel.serverId } }
        });
        if (!member) return;

        // Check for slash commands
        if (content?.startsWith('/')) {
          await handleSlashCommand(socket, io, prisma, content, channel, member, socket.userId);
          return;
        }

        // Create message
        const msgData = {
          channelId,
          authorId: socket.userId,
          content: (content || '').slice(0, 2000),
          replyToId: replyToId || null,
        };

        const msg = await prisma.message.create({
          data: msgData,
          include: {
            author: { select: { id: true, username: true, displayName: true, avatarUrl: true, level: true, equippedTag: true, equippedAvatarFx: true } },
            replyTo: { include: { author: { select: { id: true, displayName: true, avatarUrl: true } } } },
            attachments: true,
          }
        });

        // Handle attachments
        if (attachments?.length) {
          await prisma.attachment.createMany({
            data: attachments.map(a => ({ messageId: msg.id, url: a.url, filename: a.filename, size: a.size, mimeType: a.mimeType }))
          });
        }

        // Handle poll
        let pollPayload = null;
        if (pollData) {
          const poll = await prisma.poll.create({
            data: {
              messageId: msg.id,
              question: pollData.question,
              allowMultiple: pollData.allowMultiple || false,
              options: { create: pollData.options.map(opt => ({ text: opt })) }
            },
            include: { options: true }
          });
          pollPayload = poll;
          await prisma.message.update({ where: { id: msg.id }, data: { type: 'poll' } });
        }

        // Award XP
        const xpResult = await awardXP(socket.userId, 2);
        await prisma.user.update({ where: { id: socket.userId }, data: { xp: xpResult.newXp, level: xpResult.newLevel } });

        // Update member message count
        await prisma.serverMember.update({
          where: { userId_serverId: { userId: socket.userId, serverId: channel.serverId } },
          data: { messageCount: { increment: 1 } }
        });

        // Handle @mentions — create notifications
        const mentionRegex = /@(\w+)/g;
        const mentions = [...(content || '').matchAll(mentionRegex)];
        for (const match of mentions) {
          const mentioned = await prisma.user.findFirst({ where: { username: match[1].toLowerCase() } });
          if (mentioned && mentioned.id !== socket.userId) {
            const notif = await prisma.notification.create({
              data: { userId: mentioned.id, type: 'mention', content: `**${msg.author.displayName}** mentioned you in #${channel.name}`, relatedId: msg.id }
            });
            io.to(`user:${mentioned.id}`).emit('notification', notif);
          }
        }

        const fullMsg = { ...msg, poll: pollPayload, reactions: [], attachments: attachments || [] };
        io.to(`channel:${channelId}`).emit('new_message', fullMsg);

        if (xpResult.leveledUp) {
          socket.emit('level_up', { newLevel: xpResult.newLevel, creditsAwarded: xpResult.creditsAwarded });
        }

        // Clear typing
        clearTyping(socket.userId, channelId, io);

      } catch (err) {
        console.error('send_message error:', err);
        socket.emit('message_error', { error: 'Failed to send message' });
      }
    });

    // Edit message
    socket.on('edit_message', async ({ messageId, content }) => {
      try {
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg || msg.authorId !== socket.userId) return;
        const updated = await prisma.message.update({
          where: { id: messageId },
          data: { content: content.slice(0, 2000), editedAt: new Date() },
          include: { author: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } } }
        });
        io.to(`channel:${msg.channelId}`).emit('message_edited', updated);
      } catch (err) {
        console.error('edit_message error:', err);
      }
    });

    // Delete message
    socket.on('delete_message', async ({ messageId }) => {
      try {
        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          include: { channel: { include: { server: { include: { members: { where: { userId: socket.userId } } } } } } }
        });
        if (!msg) return;
        const myMember = msg.channel.server.members[0];
        const canDelete = msg.authorId === socket.userId || (myMember && ['owner', 'admin', 'moderator'].includes(myMember.role));
        if (!canDelete) return;
        await prisma.message.delete({ where: { id: messageId } });
        io.to(`channel:${msg.channelId}`).emit('message_deleted', { messageId, channelId: msg.channelId });
      } catch (err) {
        console.error('delete_message error:', err);
      }
    });

    // Typing indicators
    socket.on('start_typing', ({ channelId }) => {
      if (!socket.userId || !channelId) return;
      if (!typingUsers.has(channelId)) typingUsers.set(channelId, new Map());
      const channelTypers = typingUsers.get(channelId);

      if (channelTypers.has(socket.userId)) clearTimeout(channelTypers.get(socket.userId));

      const timeout = setTimeout(() => {
        clearTyping(socket.userId, channelId, io);
      }, 3000);

      channelTypers.set(socket.userId, timeout);
      socket.to(`channel:${channelId}`).emit('user_typing', { userId: socket.userId, displayName: socket.displayName, channelId });
    });

    socket.on('stop_typing', ({ channelId }) => {
      clearTyping(socket.userId, channelId, io);
    });

    // Poll vote
    socket.on('poll_vote', async ({ pollId, optionId }) => {
      try {
        if (!socket.userId) return;
        const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: { message: true } });
        if (!poll) return;

        const existingVote = await prisma.pollVote.findUnique({ where: { pollId_userId: { pollId, userId: socket.userId } } });

        if (existingVote) {
          // Change vote
          await prisma.pollOption.update({ where: { id: existingVote.optionId }, data: { voteCount: { decrement: 1 } } });
          await prisma.pollVote.update({ where: { id: existingVote.id }, data: { optionId } });
        } else {
          await prisma.pollVote.create({ data: { pollId, optionId, userId: socket.userId } });
        }
        await prisma.pollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });

        const updatedPoll = await prisma.poll.findUnique({
          where: { id: pollId },
          include: { options: true, votes: true }
        });

        io.to(`channel:${poll.message.channelId}`).emit('poll_updated', { messageId: poll.messageId, poll: updatedPoll });
      } catch (err) {
        console.error('poll_vote error:', err);
      }
    });

    // Reaction
    socket.on('add_reaction', async ({ messageId, emoji }) => {
      try {
        if (!socket.userId || !messageId || !emoji) return;
        const msg = await prisma.message.findUnique({ where: { id: messageId } });
        if (!msg) return;

        const existing = await prisma.reaction.findUnique({
          where: { messageId_userId_emoji: { messageId, userId: socket.userId, emoji } }
        });

        if (existing) {
          await prisma.reaction.delete({ where: { id: existing.id } });
        } else {
          await prisma.reaction.create({ data: { messageId, userId: socket.userId, emoji } });
          if (msg.authorId !== socket.userId) {
            const xpResult = await awardXP(msg.authorId, 1);
            await prisma.user.update({ where: { id: msg.authorId }, data: { xp: xpResult.newXp, level: xpResult.newLevel } });
          }
        }

        const reactions = await prisma.reaction.findMany({
          where: { messageId },
          include: { user: { select: { id: true, displayName: true } } }
        });

        io.to(`channel:${msg.channelId}`).emit('reaction_updated', { messageId, channelId: msg.channelId, reactions });
      } catch (err) {
        console.error('add_reaction error:', err);
      }
    });

    socket.on('disconnect', () => {
      // Clean up typing
      typingUsers.forEach((channelTypers, channelId) => {
        if (channelTypers.has(socket.userId)) {
          clearTimeout(channelTypers.get(socket.userId));
          channelTypers.delete(socket.userId);
          io.to(`channel:${channelId}`).emit('user_stop_typing', { userId: socket.userId, channelId });
        }
      });
    });
  });

  function clearTyping(userId, channelId, io) {
    if (!userId || !channelId) return;
    const channelTypers = typingUsers.get(channelId);
    if (channelTypers) {
      if (channelTypers.has(userId)) {
        clearTimeout(channelTypers.get(userId));
        channelTypers.delete(userId);
      }
    }
    io.to(`channel:${channelId}`).emit('user_stop_typing', { userId, channelId });
  }

  async function handleSlashCommand(socket, io, prisma, content, channel, member, userId) {
    const parts = content.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '/announce' && ['owner', 'admin'].includes(member.role)) {
      const text = parts.slice(1).join(' ');
      if (!text) return;
      const msg = await prisma.message.create({
        data: { channelId: channel.id, authorId: userId, content: `📢 **ANNOUNCEMENT:** ${text}`, type: 'announcement' },
        include: { author: { select: { id: true, displayName: true, avatarUrl: true, equippedTag: true } } }
      });
      io.to(`channel:${channel.id}`).emit('new_message', { ...msg, reactions: [], attachments: [] });
    }

    if (cmd === '/poll') {
      socket.emit('open_poll_modal', {});
    }
  }
};
