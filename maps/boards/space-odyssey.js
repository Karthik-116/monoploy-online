'use strict';
const { classicBoard } = require('../layout');

module.exports = classicBoard({
  id: 'space-odyssey',
  name: 'Space Odyssey',
  description: 'Stake your claim across the solar system and beyond.',
  currency: '₡',
  groups: [
    { key: 'moon', name: 'Lunar Bases', color: '#9E9E9E', streets: ['Tranquility Base', 'Shackleton Crater'] },
    { key: 'mars', name: 'Mars', color: '#E0603A', streets: ['Olympus Mons', 'Valles Marineris', 'Jezero Colony'] },
    { key: 'belt', name: 'Asteroid Belt', color: '#B08D57', streets: ['Ceres Station', 'Vesta Mine', 'Pallas Outpost'] },
    { key: 'jupiter', name: 'Jupiter Moons', color: '#F2A65A', streets: ['Io', 'Ganymede', 'Europa'] },
    { key: 'saturn', name: 'Saturn Moons', color: '#E9C46A', streets: ['Enceladus', 'Rhea', 'Titan'] },
    { key: 'ice', name: 'Ice Giants', color: '#4DD0E1', streets: ['Miranda', 'Triton', 'Oberon'] },
    { key: 'outer', name: 'Outer Reach', color: '#7C4DFF', streets: ['Pluto', 'Eris', 'Sedna'] },
    { key: 'stars', name: 'Interstellar', color: '#FF4081', streets: ['Proxima b', 'TRAPPIST-1e'] },
  ],
  railroads: ['Earth Warp Gate', 'Mars Warp Gate', 'Jupiter Warp Gate', 'Neptune Warp Gate'],
  utilities: ['Fusion Reactor', 'Ice Harvester'],
  taxes: [{ name: 'Oxygen Tax', amount: 200 }, { name: 'Docking Fee', amount: 100 }],
  corners: { go: 'Launch', jail: 'Quarantine', parking: 'Zero-G Lounge', gotojail: 'Black Hole' },
  chanceName: 'Anomaly',
  chestName: 'Supply Drop',
  icons: { go: '🚀', jail: '🧪', parking: '🛸', gotojail: '🕳️', railroad: '🌀', utility: ['⚛️', '🧊'], chance: '☄️', chest: '📦', tax: '🫧' },
  labels: { railroad: 'warp gate', utility: 'reactor' },
});
