/* Central mutable game state: creation, starting order-of-battle, and small
   read/write helpers used by every other module. No module here talks to the
   DOM directly. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;

  function otherFaction(f) { return f === 'allies' ? 'axis' : 'allies'; }

  function freshFactionState(isPlayer) {
    return {
      manpower: 0, production: 0, fuel: 0,
      upgrades: [],
      buildQueue: [], // {id, unitType, regionId, turnsLeft}
      commanders: {
        front: { enabled: false, stance: 'balanced' },       // aggressive | balanced | defensive
        economic: { enabled: false, priority: 'balanced' }   // balanced | armor | infantry | air | navy | tech
      },
      isPlayer: !!isPlayer
    };
  }

  const STARTING_UNITS = {
    allies: [
      { type: 'infantry', region: 'cotentin', n: 3 },
      { type: 'armor', region: 'cotentin', n: 1 },
      { type: 'artillery', region: 'cotentin', n: 1 },
      { type: 'infantry', region: 'caen_sector', n: 3 },
      { type: 'armor', region: 'caen_sector', n: 2 },
      { type: 'artillery', region: 'caen_sector', n: 1 }
    ],
    axis: [
      { type: 'infantry', region: 'normandy_interior', n: 3 },
      { type: 'armor', region: 'normandy_interior', n: 1 },
      { type: 'infantry', region: 'brittany', n: 1 },
      { type: 'infantry', region: 'pas_de_calais', n: 2 },
      { type: 'infantry', region: 'paris_region', n: 2 },
      { type: 'artillery', region: 'paris_region', n: 1 },
      { type: 'infantry', region: 'belgium', n: 1 },
      { type: 'infantry', region: 'ardennes', n: 1 },
      { type: 'infantry', region: 'aachen', n: 2 },
      { type: 'infantry', region: 'ruhr', n: 1 },
      { type: 'armor', region: 'ruhr', n: 1 },
      { type: 'infantry', region: 'berlin', n: 1 }
    ]
  };

  const STARTING_RESOURCES = {
    allies: { manpower: 16, production: 12, fuel: 10 },
    axis: { manpower: 18, production: 15, fuel: 12 }
  };

  function create(playerFaction, difficulty) {
    playerFaction = playerFaction === 'axis' ? 'axis' : 'allies';
    const aiFaction = otherFaction(playerFaction);

    const state = {
      version: 1,
      turn: 1,
      date: { year: 1944, monthIndex: 5, half: 1 }, // June, first half -> D-Day start
      playerFaction: playerFaction,
      aiFaction: aiFaction,
      difficulty: difficulty || 'regular',
      phase: 'orders',
      regions: {},
      units: {},
      factions: {
        allies: freshFactionState(playerFaction === 'allies'),
        axis: freshFactionState(playerFaction === 'axis')
      },
      orders: {
        allies: { moves: [], builds: [], upgrades: [], support: [] },
        axis: { moves: [], builds: [], upgrades: [], support: [] }
      },
      log: [],
      gameOver: null,
      nextUnitId: 1,
      selectedRegion: null
    };

    Object.assign(state.factions.allies, STARTING_RESOURCES.allies);
    Object.assign(state.factions.axis, STARTING_RESOURCES.axis);

    Data.REGIONS.forEach(function (r) {
      state.regions[r.id] = {
        id: r.id,
        owner: r.startOwner,
        morale: 65,
        supplied: true,
        turnsIsolated: 0
      };
    });

    Object.keys(STARTING_UNITS).forEach(function (faction) {
      STARTING_UNITS[faction].forEach(function (entry) {
        for (let i = 0; i < entry.n; i++) addUnit(state, faction, entry.type, entry.region);
      });
    });

    log(state, 'Operation begins. ' + factionLabel(playerFaction) + ' (you) vs ' +
      factionLabel(aiFaction) + ' (AI, ' + difficulty + ').');

    return state;
  }

  function factionLabel(f) { return f === 'allies' ? 'Allies' : 'Axis'; }

  function addUnit(state, faction, type, regionId, strength) {
    const id = 'u' + (state.nextUnitId++);
    state.units[id] = {
      id: id, type: type, faction: faction, regionId: regionId,
      strength: strength == null ? 100 : strength,
      morale: 65,
      experience: 0,
      justMoved: false
    };
    return state.units[id];
  }

  function removeUnit(state, unitId) { delete state.units[unitId]; }

  function unitsInRegion(state, regionId, faction) {
    const out = [];
    for (const id in state.units) {
      const u = state.units[id];
      if (u.regionId === regionId && (!faction || u.faction === faction)) out.push(u);
    }
    return out;
  }

  function allUnitsOf(state, faction) {
    const out = [];
    for (const id in state.units) if (state.units[id].faction === faction) out.push(state.units[id]);
    return out;
  }

  function getRegion(regionId) { return Data.REGIONS_BY_ID[regionId]; }

  function log(state, text) {
    state.log.push({ turn: state.turn, text: text });
    if (state.log.length > 500) state.log.shift();
  }

  function dateLabel(state) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    return months[state.date.monthIndex] + ' (' + (state.date.half === 1 ? 'early' : 'late') + ') ' + state.date.year;
  }

  function advanceDate(state) {
    if (state.date.half === 1) { state.date.half = 2; }
    else { state.date.half = 1; state.date.monthIndex++; if (state.date.monthIndex > 11) { state.date.monthIndex = 0; state.date.year++; } }
  }

  global.WWG = global.WWG || {};
  global.WWG.State = {
    create: create,
    addUnit: addUnit,
    removeUnit: removeUnit,
    unitsInRegion: unitsInRegion,
    allUnitsOf: allUnitsOf,
    getRegion: getRegion,
    otherFaction: otherFaction,
    factionLabel: factionLabel,
    log: log,
    dateLabel: dateLabel,
    advanceDate: advanceDate
  };
})(window);
