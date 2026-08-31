/* Unit type definitions: base stats, costs, upkeep. Variants unlocked via upgrades
   (see upgrades.js) are defined here too but flagged requiresUpgrade so the build
   UI/economy module can gate them. */
(function (global) {
  'use strict';

  const UNIT_TYPES = {
    infantry: {
      id: 'infantry', name: 'Infantry', category: 'ground',
      attack: 3, defense: 4, move: 1, needsFuel: false, fuelUse: 0,
      cost: { manpower: 3, production: 2 }, upkeep: { manpower: 0.15 },
      desc: 'The backbone of any army. Cheap, resilient, no fuel required.'
    },
    armor: {
      id: 'armor', name: 'Armor', category: 'ground',
      attack: 6, defense: 4, move: 2, needsFuel: true, fuelUse: 2,
      cost: { manpower: 2, production: 6 }, upkeep: { manpower: 0.1, fuel: 0.4 },
      desc: 'Fast, hard-hitting tanks. Thirsty for fuel; devastating on open ground.'
    },
    artillery: {
      id: 'artillery', name: 'Artillery', category: 'ground',
      attack: 5, defense: 2, move: 1, needsFuel: false, fuelUse: 0,
      cost: { manpower: 2, production: 4 }, upkeep: { manpower: 0.1 },
      supportBonus: 0.20,
      desc: 'Long-range fire support. Weak alone, boosts the whole stack\'s attack.'
    },
    mech_infantry: {
      id: 'mech_infantry', name: 'Mechanized Infantry', category: 'ground',
      attack: 4, defense: 4, move: 2, needsFuel: true, fuelUse: 1,
      cost: { manpower: 3, production: 5 }, upkeep: { manpower: 0.12, fuel: 0.25 },
      desc: 'Truck/half-track infantry. Keeps pace with armor.'
    },
    airborne: {
      id: 'airborne', name: 'Airborne', category: 'ground',
      attack: 3, defense: 2, move: 1, needsFuel: false, fuelUse: 0,
      canParadrop: true,
      cost: { manpower: 4, production: 5 }, upkeep: { manpower: 0.2 },
      desc: 'Elite paratroopers. Can drop into a non-adjacent region at a fuel cost.'
    },
    fighter: {
      id: 'fighter', name: 'Fighter', category: 'air',
      attack: 2, defense: 5, move: 4, needsFuel: true, fuelUse: 2,
      cost: { manpower: 1, production: 5 }, upkeep: { fuel: 0.4 },
      role: 'air_superiority',
      desc: 'Air superiority. Intercepts enemy air support before it reaches the battle.'
    },
    fighter_bomber: {
      id: 'fighter_bomber', name: 'Fighter-Bomber', category: 'air',
      attack: 4, defense: 3, move: 3, needsFuel: true, fuelUse: 2,
      cost: { manpower: 1, production: 6 }, upkeep: { fuel: 0.5 },
      role: 'cas', supportBonus: 0.25,
      desc: 'Close air support. Strafes and bombs ground targets, boosting attack.'
    },
    bomber: {
      id: 'bomber', name: 'Bomber', category: 'air',
      attack: 6, defense: 1, move: 3, needsFuel: true, fuelUse: 3,
      cost: { manpower: 1, production: 8 }, upkeep: { fuel: 0.7 },
      role: 'strategic', supportBonus: 0.35,
      desc: 'Heavy bombers. Massive support bonus, but vulnerable to interceptors.'
    },
    naval_bombard: {
      id: 'naval_bombard', name: 'Naval Bombardment', category: 'naval',
      attack: 5, defense: 1, move: 3, needsFuel: true, fuelUse: 2,
      coastalOnly: true, supportBonus: 0.30,
      cost: { manpower: 1, production: 6 }, upkeep: { fuel: 0.4 },
      desc: 'Offshore guns. Only effective supporting combat in a coastal region.'
    },
    transport: {
      id: 'transport', name: 'Naval Transport', category: 'naval',
      attack: 0, defense: 1, move: 3, needsFuel: true, fuelUse: 1,
      coastalOnly: true, carriesUnits: 4,
      cost: { manpower: 1, production: 5 }, upkeep: { fuel: 0.25 },
      desc: 'Sealift. Ferries ground units between coastal regions bypassing land routes.'
    },
    /* --- Upgrade-gated variants --- */
    heavy_armor: {
      id: 'heavy_armor', name: 'Heavy Armor', category: 'ground',
      attack: 9, defense: 7, move: 2, needsFuel: true, fuelUse: 3,
      cost: { manpower: 2, production: 9 }, upkeep: { manpower: 0.1, fuel: 0.6 },
      requiresUpgrade: 'heavy_armor',
      desc: 'Late-war heavy tanks (Tiger/Pershing-class). Expensive, thirsty, devastating.'
    },
    jet_fighter: {
      id: 'jet_fighter', name: 'Jet Fighter', category: 'air',
      attack: 5, defense: 8, move: 6, needsFuel: true, fuelUse: 3,
      cost: { manpower: 1, production: 10 }, upkeep: { fuel: 0.8 },
      role: 'air_superiority', requiresUpgrade: 'jet_fighter',
      desc: 'Jet-propelled interceptors (Me-262/late-war jets). Outclasses any prop fighter.'
    }
  };

  global.WWG = global.WWG || {};
  global.WWG.Data = global.WWG.Data || {};
  global.WWG.Data.UNIT_TYPES = UNIT_TYPES;
})(window);
