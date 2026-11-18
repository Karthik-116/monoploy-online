'use strict';

/** Returns a list of problems with a map definition (empty = valid). */
function validateMap(map) {
  const errors = [];
  const add = (m) => errors.push(`${map && map.id ? map.id : '(map)'}: ${m}`);
  if (!map || typeof map !== 'object') return ['map is not an object'];
  if (!map.id || !map.name) add('id and name are required');
  if (typeof map.currency !== 'string') add('currency must be a string');
  if (!map.groups || typeof map.groups !== 'object') add('groups object is required');
  const spaces = map.spaces;
  if (!Array.isArray(spaces)) {
    add('spaces must be an array');
    return errors;
  }
  if (spaces.length < 16 || spaces.length % 4 !== 0) add('board needs a multiple of 4 spaces (min 16)');
  if (spaces[0]?.type !== 'go') add('space 0 must be GO');
  if (spaces.filter((s) => s.type === 'jail').length !== 1) add('board needs exactly one jail');

  const used = new Set();
  spaces.forEach((s, i) => {
    const at = `space ${i} (${s.name || '?'})`;
    if (!s.name) add(`${at}: missing name`);
    switch (s.type) {
      case 'street':
        if (!map.groups?.[s.group]) add(`${at}: unknown group "${s.group}"`);
        used.add(s.group);
        if (!(s.price > 0) || !(s.houseCost > 0)) add(`${at}: price and houseCost required`);
        if (!Array.isArray(s.rent) || s.rent.length !== 6) add(`${at}: rent needs 6 values`);
        break;
      case 'railroad':
        if (!(s.price > 0) || !Array.isArray(s.rent) || !s.rent.length) add(`${at}: price and rent[] required`);
        break;
      case 'utility':
        if (!(s.price > 0) || !Array.isArray(s.multipliers) || !s.multipliers.length) add(`${at}: price and multipliers[] required`);
        break;
      case 'tax':
        if (!(s.amount > 0)) add(`${at}: amount required`);
        break;
      case 'go':
      case 'jail':
      case 'parking':
      case 'gotojail':
      case 'chance':
      case 'chest':
        break;
      default:
        add(`${at}: unknown type "${s.type}"`);
    }
  });
  for (const key of Object.keys(map.groups || {})) {
    if (!used.has(key)) add(`group "${key}" has no streets`);
    if (!map.groups[key].color) add(`group "${key}" needs a color`);
  }
  return errors;
}

module.exports = { validateMap };
