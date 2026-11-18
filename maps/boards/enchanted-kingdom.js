'use strict';
const { classicBoard } = require('../layout');

module.exports = classicBoard({
  id: 'enchanted-kingdom',
  name: 'Enchanted Kingdom',
  description: 'Villages, forests and castles in a realm of dragons and magic.',
  currency: '₲',
  groups: [
    { key: 'swamp', name: 'Mire', color: '#6D7F3A', streets: ['Bogwater Hut', 'Toadstool Hollow'] },
    { key: 'village', name: 'Village', color: '#A1887F', streets: ['Millers Lane', 'Bakers Row', 'Smithy Square'] },
    { key: 'forest', name: 'Elderwood', color: '#2E7D32', streets: ['Fernglade', 'Mossy Glen', 'Whispering Oaks'] },
    { key: 'coast', name: 'Sirens Coast', color: '#00897B', streets: ['Shell Cove', 'Mermaid Lagoon', 'Kraken Point'] },
    { key: 'fire', name: 'Ember Peaks', color: '#D84315', streets: ['Cinder Pass', 'Ashfall Ridge', 'Dragonspire'] },
    { key: 'sky', name: 'Sky Isles', color: '#FBC02D', streets: ['Cloudhaven', 'Sunspire', 'Griffin Roost'] },
    { key: 'arcane', name: 'Arcane Quarter', color: '#8E24AA', streets: ['Wizards Tower', 'Runestone Hall', 'Astral Library'] },
    { key: 'royal', name: 'Royal Court', color: '#1A237E', streets: ['Crystal Palace', 'The Throne Room'] },
  ],
  railroads: ['North Gate Portal', 'East Gate Portal', 'South Gate Portal', 'West Gate Portal'],
  utilities: ['Mana Well', 'Alchemy Lab'],
  taxes: [{ name: 'Royal Tithe', amount: 200 }, { name: 'Dragon Tribute', amount: 100 }],
  corners: { go: 'Town Gate', jail: 'Dungeon', parking: 'Tavern', gotojail: 'Arrested!' },
  chanceName: 'Fate',
  chestName: 'Treasure Chest',
  icons: { go: '🏰', jail: '⛓️', parking: '🍺', gotojail: '⚔️', railroad: '🌀', utility: ['🔮', '⚗️'], chance: '🃏', chest: '🪙', tax: '👑' },
  labels: { railroad: 'portal', utility: 'arcane works' },
});
