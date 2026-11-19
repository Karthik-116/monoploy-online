'use strict';

/*
 * Card decks. Text placeholders:
 *   {cur}    -> the map's currency symbol
 *   {target} -> the name of the space the card points at
 *
 * Targets are layout-agnostic: { type, nth } picks the nth space of that type
 * (nth = -1 means the last one), so the same deck works on every map.
 * A map may ship its own decks via `map.cards = { chance: [...], chest: [...] }`.
 */

const CHANCE = [
  { text: 'Advance to {target} and collect your salary.', action: 'advance', target: { type: 'go', nth: 0 } },
  { text: 'Advance to {target}. If you pass GO, collect {cur}200.', action: 'advance', target: { type: 'street', nth: 13 } },
  { text: 'Advance to {target}.', action: 'advance', target: { type: 'street', nth: -1 } },
  { text: 'Advance to {target}. If you pass GO, collect {cur}200.', action: 'advance', target: { type: 'street', nth: 5 } },
  { text: 'Advance to the nearest {type}. If owned, pay the owner twice the rent.', action: 'nearest', type: 'railroad', rentMultiplier: 2 },
  { text: 'Advance to the nearest {type}. If owned, pay the owner twice the rent.', action: 'nearest', type: 'railroad', rentMultiplier: 2 },
  { text: 'Advance to the nearest {type}. If owned, pay the owner 10× the dice roll.', action: 'nearest', type: 'utility', utilityMultiplier: 10 },
  { text: 'The bank pays you a dividend of {cur}50.', action: 'collect', amount: 50 },
  { text: 'Get Out of Jail Free. Keep this card until needed.', action: 'jailCard' },
  { text: 'Go back 3 spaces.', action: 'back', amount: 3 },
  { text: 'Go directly to Jail. Do not pass GO, do not collect {cur}200.', action: 'jail' },
  { text: 'General repairs: pay {cur}25 per house and {cur}100 per hotel.', action: 'repairs', house: 25, hotel: 100 },
  { text: 'Speeding fine: pay {cur}15.', action: 'pay', amount: 15 },
  { text: 'Take a trip to {target}. If you pass GO, collect {cur}200.', action: 'advance', target: { type: 'railroad', nth: 0 } },
  { text: 'You have been elected chairperson of the board. Pay each player {cur}50.', action: 'payEach', amount: 50 },
  { text: 'Your building loan matures. Collect {cur}150.', action: 'collect', amount: 150 },
];

const CHEST = [
  { text: 'Advance to {target} and collect your salary.', action: 'advance', target: { type: 'go', nth: 0 } },
  { text: 'Bank error in your favour. Collect {cur}200.', action: 'collect', amount: 200 },
  { text: "Doctor's fees: pay {cur}50.", action: 'pay', amount: 50 },
  { text: 'From sale of stock you get {cur}50.', action: 'collect', amount: 50 },
  { text: 'Get Out of Jail Free. Keep this card until needed.', action: 'jailCard' },
  { text: 'Go directly to Jail. Do not pass GO, do not collect {cur}200.', action: 'jail' },
  { text: 'Holiday fund matures. Collect {cur}100.', action: 'collect', amount: 100 },
  { text: 'Income tax refund. Collect {cur}20.', action: 'collect', amount: 20 },
  { text: "It's your birthday! Collect {cur}10 from every player.", action: 'collectEach', amount: 10 },
  { text: 'Life insurance matures. Collect {cur}100.', action: 'collect', amount: 100 },
  { text: 'Hospital fees: pay {cur}100.', action: 'pay', amount: 100 },
  { text: 'School fees: pay {cur}50.', action: 'pay', amount: 50 },
  { text: 'Receive a {cur}25 consultancy fee.', action: 'collect', amount: 25 },
  { text: 'Street repairs: pay {cur}40 per house and {cur}115 per hotel.', action: 'repairs', house: 40, hotel: 115 },
  { text: 'You won second prize in a beauty contest. Collect {cur}10.', action: 'collect', amount: 10 },
  { text: 'You inherit {cur}100.', action: 'collect', amount: 100 },
];

/** Fisher–Yates shuffle using an injectable RNG (returns a new array). */
function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { CHANCE, CHEST, shuffle };
