'use strict';

/** Player appearances (avatar colours). Each theme defines the actual shade for each id. */
const TOKENS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

const DEFAULT_SETTINGS = Object.freeze({
  maxPlayers: 6,
  startingCash: 1500,
  goSalary: 200,
  jailFine: 50,
  auctionSeconds: 10,
  unmortgageInterest: 0.1,
  // Gameplay rules the host can switch on/off in the lobby.
  doubleRentOnSet: true, // unimproved full colour set pays double rent
  vacationCash: false, // taxes & bank payments go to a pot collected on Free Parking
  auction: true, // declined properties are auctioned
  noRentInJail: false, // owners in jail don't collect rent
  mortgage: true, // mortgaging allowed
  evenBuild: true, // houses built/sold evenly across a set
  randomizeOrder: false, // shuffle turn order at the start
});

/** Settings that are simple on/off switches. */
const BOOL_SETTINGS = ['doubleRentOnSet', 'vacationCash', 'auction', 'noRentInJail', 'mortgage', 'evenBuild', 'randomizeOrder'];

/** Space types that can be bought and owned. */
const OWNABLE = new Set(['street', 'railroad', 'utility']);

module.exports = { TOKENS, DEFAULT_SETTINGS, BOOL_SETTINGS, OWNABLE };
