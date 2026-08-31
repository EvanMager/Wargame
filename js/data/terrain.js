/* Terrain type definitions. Affects combat defense bonus and movement cost. */
(function (global) {
  'use strict';

  const TERRAIN = {
    plains: {
      id: 'plains', name: 'Plains', defenseBonus: 0.00, moveCost: 1,
      color: '#c9c17a', desc: 'Open farmland. No combat modifiers, easy movement.'
    },
    bocage: {
      id: 'bocage', name: 'Bocage', defenseBonus: 0.20, moveCost: 2,
      color: '#6f8f4e', desc: 'Dense hedgerow country. Favors the defender, slows attackers.'
    },
    forest: {
      id: 'forest', name: 'Forest', defenseBonus: 0.25, moveCost: 2,
      color: '#355e2c', desc: 'Heavy woodland. Strong defensive bonus, slow going.'
    },
    urban: {
      id: 'urban', name: 'Urban/Industrial', defenseBonus: 0.35, moveCost: 1,
      color: '#867f86', desc: 'Dense city and industrial sprawl. Excellent defense, high production.'
    },
    river: {
      id: 'river', name: 'River Line', defenseBonus: 0.30, moveCost: 2,
      color: '#4f80a8', desc: 'Major river crossing. Attackers face a steep defensive penalty.'
    },
    mountain: {
      id: 'mountain', name: 'Mountain', defenseBonus: 0.40, moveCost: 3,
      color: '#8a7863', desc: 'Alpine terrain. Very defensible, very slow to cross.'
    },
    fortified: {
      id: 'fortified', name: 'Fortified Line', defenseBonus: 0.50, moveCost: 1,
      color: '#5c5c63', desc: 'Prepared defenses (Westwall/Berlin defense belt). Maximum defense bonus.'
    }
  };

  global.WWG = global.WWG || {};
  global.WWG.Data = global.WWG.Data || {};
  global.WWG.Data.TERRAIN = TERRAIN;
})(window);
