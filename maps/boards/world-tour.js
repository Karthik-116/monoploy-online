'use strict';
const { classicBoard } = require('../layout');

module.exports = classicBoard({
  id: 'world-tour',
  name: 'World Tour',
  description: 'Buy up the great cities of the world, country by country.',
  currency: '$',
  groups: [
    { key: 'egypt', name: 'Egypt', color: '#C2853D', streets: ['Luxor', 'Cairo'] },
    { key: 'brazil', name: 'Brazil', color: '#2BB673', streets: ['Salvador', 'Rio de Janeiro', 'São Paulo'] },
    { key: 'india', name: 'India', color: '#FF8A3D', streets: ['Jaipur', 'Bengaluru', 'Mumbai'] },
    { key: 'italy', name: 'Italy', color: '#4CAF50', streets: ['Florence', 'Milan', 'Rome'] },
    { key: 'spain', name: 'Spain', color: '#E53935', streets: ['Seville', 'Barcelona', 'Madrid'] },
    { key: 'japan', name: 'Japan', color: '#F06292', streets: ['Osaka', 'Kyoto', 'Tokyo'] },
    { key: 'france', name: 'France', color: '#3F51B5', streets: ['Lyon', 'Nice', 'Paris'] },
    { key: 'usa', name: 'USA', color: '#7E57C2', streets: ['San Francisco', 'New York'] },
  ],
  railroads: ['Heathrow Airport', 'Changi Airport', 'Dubai Airport', 'JFK Airport'],
  utilities: ['Solar Farm', 'Wind Farm'],
  taxes: [{ name: 'Visa Fees', amount: 200 }, { name: 'Tourist Tax', amount: 100 }],
  corners: { go: 'Start', jail: 'Customs Hold', parking: 'Vacation', gotojail: 'Detained!' },
  chanceName: 'Surprise',
  chestName: 'Treasure',
  icons: { go: '🛫', jail: '🛂', parking: '🏖️', gotojail: '🚨', railroad: '✈️', utility: ['☀️', '🌬️'], chance: '🎲', chest: '🎁', tax: '🧾' },
  labels: { railroad: 'airport', utility: 'power plant' },
});
