'use strict';

/*
 * Helper that turns a short themed description (names + colours) into a full
 * 40-space board using the classic layout, prices and rents.
 * A map file may instead export a complete `spaces` array of its own — the
 * engine only ever reads `map.spaces`, `map.groups` and `map.currency`.
 */

// [price, houseCost, rent: [base, 1h, 2h, 3h, 4h, hotel]] per street, per colour group.
const CLASSIC_STREETS = [
  [[60, 50, [2, 10, 30, 90, 160, 250]], [60, 50, [4, 20, 60, 180, 320, 450]]],
  [[100, 50, [6, 30, 90, 270, 400, 550]], [100, 50, [6, 30, 90, 270, 400, 550]], [120, 50, [8, 40, 100, 300, 450, 600]]],
  [[140, 100, [10, 50, 150, 450, 625, 750]], [140, 100, [10, 50, 150, 450, 625, 750]], [160, 100, [12, 60, 180, 500, 700, 900]]],
  [[180, 100, [14, 70, 200, 550, 750, 950]], [180, 100, [14, 70, 200, 550, 750, 950]], [200, 100, [16, 80, 220, 600, 800, 1000]]],
  [[220, 150, [18, 90, 250, 700, 875, 1050]], [220, 150, [18, 90, 250, 700, 875, 1050]], [240, 150, [20, 100, 300, 750, 925, 1100]]],
  [[260, 150, [22, 110, 330, 800, 975, 1150]], [260, 150, [22, 110, 330, 800, 975, 1150]], [280, 150, [24, 120, 360, 850, 1025, 1200]]],
  [[300, 200, [26, 130, 390, 900, 1100, 1275]], [300, 200, [26, 130, 390, 900, 1100, 1275]], [320, 200, [28, 150, 450, 1000, 1200, 1400]]],
  [[350, 200, [35, 175, 500, 1100, 1300, 1500]], [400, 200, [50, 200, 600, 1400, 1700, 2000]]],
];

const DEFAULT_ICONS = {
  go: '🏁',
  jail: '🔒',
  parking: '🅿️',
  gotojail: '👮',
  chance: '❓',
  chest: '💰',
  tax: '💸',
  railroad: '🚂',
  utility: ['💡', '🚰'],
};

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.name
 * @param {string} def.currency
 * @param {Array<{key,name,color,streets:string[]}>} def.groups  8 groups, sizes 2,3,3,3,3,3,3,2
 * @param {string[]} def.railroads 4 names
 * @param {string[]} def.utilities 2 names
 * @param {Array<{name,amount}>} [def.taxes]
 * @param {object} [def.corners]  { go, jail, parking, gotojail }
 * @param {object} [def.icons]
 * @param {object} [def.labels]   { railroad: 'airport', utility: 'power plant' } used in card text
 */
function classicBoard(def) {
  const groups = def.groups;
  if (!Array.isArray(groups) || groups.length !== 8) throw new Error(`${def.id}: classicBoard needs exactly 8 colour groups`);
  groups.forEach((g, gi) => {
    if (g.streets.length !== CLASSIC_STREETS[gi].length) {
      throw new Error(`${def.id}: group "${g.key}" needs ${CLASSIC_STREETS[gi].length} streets`);
    }
  });

  const street = (gi, k) => {
    const [price, houseCost, rent] = CLASSIC_STREETS[gi][k];
    return { type: 'street', name: groups[gi].streets[k], group: groups[gi].key, price, houseCost, rent: rent.slice() };
  };
  const rail = (k) => ({ type: 'railroad', name: def.railroads[k], price: 200, rent: [25, 50, 100, 200] });
  const util = (k) => ({ type: 'utility', name: def.utilities[k], price: 150, multipliers: [4, 10] });
  const taxes = def.taxes || [{ name: 'Income Tax', amount: 200 }, { name: 'Luxury Tax', amount: 100 }];
  const tax = (k) => ({ type: 'tax', name: taxes[k].name, amount: taxes[k].amount });
  const chance = () => ({ type: 'chance', name: def.chanceName || 'Chance' });
  const chest = () => ({ type: 'chest', name: def.chestName || 'Community Chest' });
  const c = { go: 'GO', jail: 'Jail', parking: 'Free Parking', gotojail: 'Go to Jail', ...(def.corners || {}) };

  const spaces = [
    { type: 'go', name: c.go }, street(0, 0), chest(), street(0, 1), tax(0), rail(0), street(1, 0), chance(), street(1, 1), street(1, 2),
    { type: 'jail', name: c.jail }, street(2, 0), util(0), street(2, 1), street(2, 2), rail(1), street(3, 0), chest(), street(3, 1), street(3, 2),
    { type: 'parking', name: c.parking }, street(4, 0), chance(), street(4, 1), street(4, 2), rail(2), street(5, 0), street(5, 1), util(1), street(5, 2),
    { type: 'gotojail', name: c.gotojail }, street(6, 0), street(6, 1), chest(), street(6, 2), rail(3), chance(), street(7, 0), tax(1), street(7, 1),
  ];

  return {
    id: def.id,
    name: def.name,
    description: def.description || '',
    currency: def.currency || '$',
    icons: { ...DEFAULT_ICONS, ...(def.icons || {}) },
    labels: def.labels || {},
    groups: Object.fromEntries(groups.map((g) => [g.key, { name: g.name, color: g.color }])),
    spaces,
    ...(def.cards ? { cards: def.cards } : {}),
  };
}

module.exports = { classicBoard, CLASSIC_STREETS, DEFAULT_ICONS };
