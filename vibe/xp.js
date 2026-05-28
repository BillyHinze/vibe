// utils/xp.js
function xpForLevel(level) {
  return level * 500;
}

function totalXpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevel(i);
  return total;
}

async function awardXP(userId, amount) {
  const user = await global.prisma.user.findUnique({ where: { id: userId }, select: { xp: true, level: true, credits: true } });
  if (!user) return { newXp: 0, newLevel: 1, leveledUp: false };

  let newXp = user.xp + amount;
  let newLevel = user.level;
  let leveledUp = false;
  let creditsAwarded = 0;

  while (newXp >= xpForLevel(newLevel)) {
    newXp -= xpForLevel(newLevel);
    newLevel++;
    leveledUp = true;
    creditsAwarded += newLevel * 10;
  }

  if (creditsAwarded > 0) {
    await global.prisma.user.update({ where: { id: userId }, data: { credits: { increment: creditsAwarded } } });
  }

  return { newXp, newLevel, leveledUp, creditsAwarded };
}

module.exports = { awardXP, xpForLevel, totalXpForLevel };
