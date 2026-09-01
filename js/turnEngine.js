/* Turn engine: order collection + simultaneous resolution. Both sides'
   orders (player's staged manual/commander orders, AI's freshly generated
   orders) are resolved together in one pass — movement, combat, supply,
   morale, economy — then results are revealed at once. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const State = global.WWG.State;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function emptyOrders() { return { moves: [], builds: [], upgrades: [], support: [] }; }

  function findMoveOrder(state, faction, unitId) {
    return state.orders[faction].moves.find(function (o) { return o.unitId === unitId; });
  }
  function findSupportOrder(state, faction, unitId) {
    return state.orders[faction].support.find(function (o) { return o.unitId === unitId; });
  }

  function removeOrder(state, faction, unitId) {
    state.orders[faction].moves = state.orders[faction].moves.filter(function (o) { return o.unitId !== unitId; });
    state.orders[faction].support = state.orders[faction].support.filter(function (o) { return o.unitId !== unitId; });
  }

  function addMoveOrder(state, faction, unitId, toRegionId, mode) {
    const u = state.units[unitId];
    if (!u || u.faction !== faction) return { ok: false, reason: 'Invalid unit.' };
    mode = mode || 'adjacent';
    const opts = global.WWG.Movement.moveOptions(state, u);
    const pool = mode === 'adjacent' ? opts.adjacent : (mode === 'paradrop' ? opts.paradrop : opts.transport);
    if (pool.indexOf(toRegionId) === -1) return { ok: false, reason: 'That region is out of reach this turn.' };
    removeOrder(state, faction, unitId);
    state.orders[faction].moves.push({ unitId: unitId, fromRegionId: u.regionId, toRegionId: toRegionId, mode: mode });
    return { ok: true };
  }

  function addSupportOrder(state, faction, unitId, targetRegionId) {
    const u = state.units[unitId];
    if (!u || u.faction !== faction) return { ok: false, reason: 'Invalid unit.' };
    const def = Data.UNIT_TYPES[u.type];
    // Ground units (incl. artillery) apply their support bonus automatically when
    // present in a battle at their own location (see combat.js) — only air/naval
    // units target a *different* region via a Support order.
    if (def.category === 'ground' || (!def.supportBonus && def.role !== 'air_superiority')) {
      return { ok: false, reason: 'That unit type has no support role.' };
    }
    const options = global.WWG.Movement.supportOptions(state, u);
    if (options.indexOf(targetRegionId) === -1) return { ok: false, reason: 'Target is out of range.' };
    removeOrder(state, faction, unitId);
    state.orders[faction].support.push({ unitId: unitId, targetRegionId: targetRegionId });
    return { ok: true };
  }

  function clearOrders(state, faction) { state.orders[faction] = emptyOrders(); }

  function sanitizeOrders(state, faction) {
    state.orders[faction].moves = state.orders[faction].moves.filter(function (o) {
      const u = state.units[o.unitId];
      return u && u.faction === faction && u.regionId === o.fromRegionId;
    });
    state.orders[faction].support = state.orders[faction].support.filter(function (o) {
      const u = state.units[o.unitId];
      return u && u.faction === faction;
    });
  }

  function applyFuelReadiness(state, faction) {
    const fs = state.factions[faction];
    let demand = 0;
    const involved = [];
    state.orders[faction].moves.forEach(function (o) {
      const u = state.units[o.unitId];
      const def = u && Data.UNIT_TYPES[u.type];
      if (def && def.needsFuel) { demand += def.fuelUse; involved.push(u); }
    });
    state.orders[faction].support.forEach(function (o) {
      const u = state.units[o.unitId];
      const def = u && Data.UNIT_TYPES[u.type];
      if (def && def.needsFuel) { demand += def.fuelUse; involved.push(u); }
    });
    if (demand <= 0) return;
    const readiness = Math.min(1, fs.fuel / demand);
    if (readiness < 1) {
      const penalty = (1 - readiness) * 20;
      involved.forEach(function (u) { global.WWG.Morale.adjust(state, u, -penalty); });
      State.log(state, State.factionLabel(faction) + ' fuel reserves are strained — mechanized/air/naval readiness down ' + Math.round((1 - readiness) * 100) + '%.');
    }
  }

  function handleBattleAftermath(state, regionData, battle, attackerFaction, defenderFaction, attackerEntries, defenderUnits, snapshotOwner, results) {
    const Morale = global.WWG.Morale;
    const regionId = regionData.id;

    function retreatDestination(faction) {
      for (let i = 0; i < regionData.neighbors.length; i++) {
        if (snapshotOwner[regionData.neighbors[i]] === faction) return regionData.neighbors[i];
      }
      return null;
    }

    if (battle.outcome === 'attacker_win') {
      defenderUnits.forEach(function (u) {
        if (!state.units[u.id]) return;
        const dest = retreatDestination(defenderFaction);
        const collapsed = !dest || Math.random() < Morale.collapseChance(u.morale);
        if (collapsed) { delete state.units[u.id]; return; }
        u.regionId = dest;
        Morale.adjust(state, u, -10);
      });
      let survivors = 0;
      attackerEntries.forEach(function (e) {
        if (!state.units[e.unit.id]) return;
        e.unit.regionId = regionId;
        e.unit.justMoved = true;
        Morale.adjust(state, e.unit, 8);
        survivors++;
      });
      if (survivors > 0) {
        state.regions[regionId].owner = attackerFaction;
        results.captures.push({ regionId: regionId, from: defenderFaction, to: attackerFaction, contested: true });
        State.log(state, State.factionLabel(attackerFaction) + ' capture ' + regionData.name + ' from ' + State.factionLabel(defenderFaction) + '!');
      } else {
        State.log(state, 'The ' + regionData.name + ' garrison is wiped out, but the attacking force could not hold the ground either. No change of control.');
      }
    } else {
      const repulsed = battle.outcome === 'attacker_repulsed';
      attackerEntries.forEach(function (e) {
        if (!state.units[e.unit.id]) return;
        e.unit.regionId = e.originRegionId;
        Morale.adjust(state, e.unit, repulsed ? -12 : -4);
      });
      defenderUnits.forEach(function (u) {
        if (!state.units[u.id]) return;
        Morale.adjust(state, u, repulsed ? 8 : -4);
      });
      State.log(state, State.factionLabel(attackerFaction) + ' attack on ' + regionData.name + ' (' + State.factionLabel(defenderFaction) + ') ends in ' +
        (repulsed ? 'a bloody repulse.' : 'a stalemate.'));
    }
  }

  function checkVictory(state) {
    if (state.gameOver) return;
    if (state.regions.berlin.owner === 'allies') {
      state.gameOver = { winner: 'allies', reason: 'Berlin has fallen. The war in Europe is over.' };
      return;
    }
    const alliesRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === 'allies'; }).length;
    if (alliesRegions === 0) {
      state.gameOver = { winner: 'axis', reason: 'The Allied lodgement on the continent has been eliminated.' };
      return;
    }
    if (state.turn >= 26) {
      state.gameOver = { winner: 'axis', reason: 'The campaign clock has run out with Berlin still in German hands.' };
    }
  }

  function resolveTurn(state) {
    if (state.gameOver) return null;

    const playerFaction = state.playerFaction;
    const aiFaction = state.aiFaction;

    // AI always fully auto-generates its own turn (moves/support/builds/upgrades — builds & upgrades
    // are applied to state immediately as a side effect; moves/support are returned as orders).
    const aiOrders = global.WWG.AI.generateOrders(state, aiFaction, state.difficulty);
    state.orders[aiFaction].moves = aiOrders.moves;
    state.orders[aiFaction].support = aiOrders.support;

    // Player: commander automation fills in anything the human didn't manually order.
    global.WWG.Commanders.applyAutomation(state, playerFaction);

    ['allies', 'axis'].forEach(function (f) { sanitizeOrders(state, f); });
    applyFuelReadiness(state, 'allies');
    applyFuelReadiness(state, 'axis');

    const snapshotOwner = {};
    Data.REGIONS.forEach(function (r) { snapshotOwner[r.id] = state.regions[r.id].owner; });

    const results = { turn: state.turn, battles: [], captures: [], paradrops: [] };

    const arrivals = {};
    Data.REGIONS.forEach(function (r) { arrivals[r.id] = { allies: [], axis: [] }; });
    const movedUnitIds = {};

    ['allies', 'axis'].forEach(function (faction) {
      state.orders[faction].moves.forEach(function (order) {
        const u = state.units[order.unitId];
        if (!u || u.faction !== faction || u.regionId !== order.fromRegionId) return;
        if (order.mode === 'paradrop') {
          const loss = Math.random() * 15;
          u.strength = clamp(u.strength - loss, 5, 100);
          results.paradrops.push({ unitId: u.id, toRegionId: order.toRegionId, loss: loss });
        }
        if (order.mode === 'transport') {
          const fs = state.factions[faction];
          if (fs.fuel < 1) return; // not enough fuel to embark, order fizzles
        }
        arrivals[order.toRegionId][faction].push({ unit: u, originRegionId: order.fromRegionId });
        movedUnitIds[u.id] = true;
      });
    });

    const supportOrdersByFaction = { allies: state.orders.allies.support, axis: state.orders.axis.support };

    Data.REGIONS.forEach(function (r) {
      const regionId = r.id;
      const owner = snapshotOwner[regionId];
      const enemyFaction = State.otherFaction(owner);
      const enemyArrivals = arrivals[regionId][enemyFaction];
      const ownArrivals = arrivals[regionId][owner];

      const holdouts = State.unitsInRegion(state, regionId, owner).filter(function (u) { return !movedUnitIds[u.id]; });
      ownArrivals.forEach(function (e) { e.unit.regionId = regionId; e.unit.justMoved = true; });

      if (enemyArrivals.length === 0) return;

      const defenderUnits = holdouts.concat(ownArrivals.map(function (e) { return e.unit; }));

      if (defenderUnits.length === 0) {
        enemyArrivals.forEach(function (e) {
          e.unit.regionId = regionId;
          e.unit.justMoved = true;
          global.WWG.Morale.adjust(state, e.unit, 5);
        });
        state.regions[regionId].owner = enemyFaction;
        results.captures.push({ regionId: regionId, from: owner, to: enemyFaction, contested: false });
        State.log(state, State.factionLabel(enemyFaction) + ' advance into undefended ' + r.name + '.');
        return;
      }

      const battle = global.WWG.Combat.resolveBattle(state, regionId, enemyFaction, enemyArrivals, defenderUnits, supportOrdersByFaction);
      battle.regionId = regionId;
      battle.attacker = enemyFaction;
      battle.defender = owner;
      battle.regionName = r.name;
      results.battles.push(battle);

      handleBattleAftermath(state, r, battle, enemyFaction, owner, enemyArrivals, defenderUnits, snapshotOwner, results);
    });

    global.WWG.Supply.computeSupply(state);
    global.WWG.Morale.tick(state);
    global.WWG.Economy.processBuildQueue(state);
    global.WWG.Economy.collectResources(state);

    for (const id in state.units) state.units[id].justMoved = false;
    state.orders = { allies: emptyOrders(), axis: emptyOrders() };

    checkVictory(state);

    results.gameOver = state.gameOver;
    results.dateLabel = State.dateLabel(state);

    if (!state.gameOver) {
      state.turn++;
      State.advanceDate(state);
    }

    return results;
  }

  global.WWG = global.WWG || {};
  global.WWG.TurnEngine = {
    addMoveOrder: addMoveOrder,
    addSupportOrder: addSupportOrder,
    removeOrder: removeOrder,
    clearOrders: clearOrders,
    findMoveOrder: findMoveOrder,
    findSupportOrder: findSupportOrder,
    resolveTurn: resolveTurn,
    checkVictory: checkVictory
  };
})(window);
