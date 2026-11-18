'use strict';

/** Tokens players can pick in the lobby. */
const TOKENS = ['🎩', '🚗', '🐕', '🚢', '🦖', '🐈', '🚀', '🦄'];

const DEFAULT_SETTINGS = Object.freeze({
  maxPlayers: 6,
  startingCash: 1500,
  goSalary: 200,
  jailFine: 50,
  auctionSeconds: 10,
  unmortgageInterest: 0.1,
});

/** Space types that can be bought and owned. */
const OWNABLE = new Set(['street', 'railroad', 'utility']);

module.exports = { TOKENS, DEFAULT_SETTINGS, OWNABLE };
