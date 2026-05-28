// routes/shop.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

// GET /api/shop/items
router.get('/items', auth, async (req, res) => {
  try {
    const items = await global.prisma.shopItem.findMany({ orderBy: [{ type: 'asc' }, { price: 'asc' }] });
    const owned = await global.prisma.userItem.findMany({ where: { userId: req.user.id }, select: { itemId: true, isEquipped: true } });
    const ownedMap = {};
    owned.forEach(o => { ownedMap[o.itemId] = { owned: true, isEquipped: o.isEquipped }; });
    res.json(items.map(item => ({ ...item, owned: !!ownedMap[item.id], isEquipped: ownedMap[item.id]?.isEquipped || false })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch shop' });
  }
});

// POST /api/shop/buy/:itemId
router.post('/buy/:itemId', auth, async (req, res) => {
  try {
    const item = await global.prisma.shopItem.findUnique({ where: { id: req.params.itemId } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const user = await global.prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.credits < item.price) return res.status(400).json({ error: 'Insufficient credits' });

    const alreadyOwned = await global.prisma.userItem.findUnique({ where: { userId_itemId: { userId: req.user.id, itemId: item.id } } });
    if (alreadyOwned) return res.status(409).json({ error: 'Already owned' });

    await global.prisma.$transaction([
      global.prisma.user.update({ where: { id: req.user.id }, data: { credits: { decrement: item.price } } }),
      global.prisma.userItem.create({ data: { userId: req.user.id, itemId: item.id } }),
    ]);

    const updatedUser = await global.prisma.user.findUnique({ where: { id: req.user.id }, select: { credits: true } });
    res.json({ message: 'Purchased!', newBalance: updatedUser.credits, item });
  } catch (err) {
    res.status(500).json({ error: 'Purchase failed' });
  }
});

// POST /api/shop/equip/:itemId
router.post('/equip/:itemId', auth, async (req, res) => {
  try {
    const userItem = await global.prisma.userItem.findUnique({ where: { userId_itemId: { userId: req.user.id, itemId: req.params.itemId } } });
    if (!userItem) return res.status(403).json({ error: 'Item not owned' });

    const item = await global.prisma.shopItem.findUnique({ where: { id: req.params.itemId } });

    // Unequip all items of same type
    const sameTypeItems = await global.prisma.shopItem.findMany({ where: { type: item.type } });
    const sameTypeIds = sameTypeItems.map(i => i.id);
    await global.prisma.userItem.updateMany({ where: { userId: req.user.id, itemId: { in: sameTypeIds } }, data: { isEquipped: false } });

    const typeToField = { tag: 'equippedTag', banner: 'equippedBanner', avatarFx: 'equippedAvatarFx', title: 'equippedTitle' };
    const fieldName = typeToField[item.type];

    await global.prisma.userItem.update({ where: { userId_itemId: { userId: req.user.id, itemId: item.id } }, data: { isEquipped: true } });
    const updatedUser = await global.prisma.user.update({ where: { id: req.user.id }, data: { [fieldName]: item.assetData } });

    global.io?.emit('presence_update', {
      userId: req.user.id,
      equippedTag: updatedUser.equippedTag,
      equippedBanner: updatedUser.equippedBanner,
      equippedAvatarFx: updatedUser.equippedAvatarFx,
      equippedTitle: updatedUser.equippedTitle,
    });

    res.json({ message: 'Equipped!', item });
  } catch (err) {
    res.status(500).json({ error: 'Equip failed' });
  }
});

module.exports = router;
