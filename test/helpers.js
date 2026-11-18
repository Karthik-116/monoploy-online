'use strict';

const { Game } = require('../engine/game');
const { getMap } = require('../maps');

/**
 * Builds a started game with scripted dice and an unshuffled card deck.
 * Push more rolls onto `dice` at any time: dice.push([3, 4]).
 */
function setup({ players = 2, mapId = 'classic-london', settings = {} } = {}) {
  const dice = [];
  const clock = { t: 1_000_000 };
  const game = new Game({
    id: 'TEST',
    map: getMap(mapId),
    settings,
    shuffleCards: false,
    now: () => clock.t,
    dice: () => {
      if (!dice.length) throw new Error('No scripted dice left');
      return dice.shift();
    },
  });
  for (let i = 0; i < players; i++) game.addPlayer({ id: `p${i}`, name: `P${i}` });
  game.start('p0');
  const p = (id) => game.players.find((x) => x.id === id);
  const own = (id, ...spaces) => spaces.forEach((s) => (game.properties[s].owner = id));
  return { game, dice, clock, p, own };
}

module.exports = { setup };
