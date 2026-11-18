'use strict';
const { classicBoard } = require('../layout');

module.exports = classicBoard({
  id: 'classic-london',
  name: 'Classic London',
  description: 'The traditional board — from Old Kent Road to Mayfair.',
  currency: '£',
  groups: [
    { key: 'brown', name: 'Brown', color: '#8B4A2B', streets: ['Old Kent Road', 'Whitechapel Road'] },
    { key: 'lightblue', name: 'Light Blue', color: '#9ED8F5', streets: ['The Angel Islington', 'Euston Road', 'Pentonville Road'] },
    { key: 'pink', name: 'Pink', color: '#D93A96', streets: ['Pall Mall', 'Whitehall', 'Northumberland Avenue'] },
    { key: 'orange', name: 'Orange', color: '#F7941D', streets: ['Bow Street', 'Marlborough Street', 'Vine Street'] },
    { key: 'red', name: 'Red', color: '#E3262E', streets: ['Strand', 'Fleet Street', 'Trafalgar Square'] },
    { key: 'yellow', name: 'Yellow', color: '#F5D90A', streets: ['Leicester Square', 'Coventry Street', 'Piccadilly'] },
    { key: 'green', name: 'Green', color: '#1FB25A', streets: ['Regent Street', 'Oxford Street', 'Bond Street'] },
    { key: 'darkblue', name: 'Dark Blue', color: '#0B5CAD', streets: ['Park Lane', 'Mayfair'] },
  ],
  railroads: ['Kings Cross Station', 'Marylebone Station', 'Fenchurch St Station', 'Liverpool St Station'],
  utilities: ['Electric Company', 'Water Works'],
  taxes: [{ name: 'Income Tax', amount: 200 }, { name: 'Super Tax', amount: 100 }],
  labels: { railroad: 'station', utility: 'utility' },
});
