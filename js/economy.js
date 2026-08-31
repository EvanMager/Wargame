/* Resource generation, upkeep, the build queue, and upgrade purchases.
   Three resources: Manpower (recruit), Production (build/upgrade), Fuel
   (move/operate mechanized, air, naval units). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;

  // The Allies draw on a huge off-map industrial base (the US/UK home front,
  // Lend-Lease, shipped across the Channel) that a 2-region Normandy beachhead
  // could never represent on its own. Without this, the beachhead is crushed
  // by Axis's ~19-region head start well before the Allies can ever build up —
  // not a fair fight, just a foregone one. This flat stipend stands in for
  // that overseas support and tapers in relative importance as captured
  // territory grows. The Axis had no such lifeline (blockaded, homeland-only).
  const ALLIED_OVERSEAS_SUPPORT = { manpower: 16, production: 26, fuel: 14 };

  function clamp0(v) { return v < 0 ? 0 : v; }

  function upgradeMult(state, faction, key) {
    const fs = state.factions[faction];
    let mult = 1;
    Data.UPGRADES.forEach(function (u) {
      if (fs.upgrades.indexOf(u.id) !== -1 && u.effect && u.effect[key] != null) mult += u.effect[key];
    });
    return mult;
  }

  function income(state, faction) {
    const out = { manpower: 0, production: 0, fuel: 0 };
    Data.REGIONS.forEach(function (r) {
      const rs = state.regions[r.id];
      if (rs.owner !== faction || !rs.supplied) return;
      out.manpower += r.resources.manpower;
      out.production += r.resources.production;
      out.fuel += r.resources.fuel;
    });
    if (faction === 'allies') {
      out.manpower += ALLIED_OVERSEAS_SUPPORT.manpower;
      out.production += ALLIED_OVERSEAS_SUPPORT.production;
      out.fuel += ALLIED_OVERSEAS_SUPPORT.fuel;
    }
    out.manpower *= upgradeMult(state, faction, 'manpowerMult');
    out.production *= upgradeMult(state, faction, 'productionMult');
    if (faction === state.aiFaction && global.WWG.AI) {
      const mult = global.WWG.AI.difficultyResourceMult(state.difficulty);
      out.manpower *= mult; out.production *= mult; out.fuel *= mult;
    }
    return out;
  }

  function upkeep(state, faction) {
    const out = { manpower: 0, fuel: 0 };
    const fuelUseMult = upgradeMult(state, faction, 'fuelUseMult'); // already includes the 1.0 baseline
    global.WWG.State.allUnitsOf(state, faction).forEach(function (u) {
      const def = Data.UNIT_TYPES[u.type];
      const frac = u.strength / 100;
      if (def.upkeep.manpower) out.manpower += def.upkeep.manpower * frac;
      if (def.upkeep.fuel) out.fuel += def.upkeep.fuel * frac * fuelUseMult;
    });
    return out;
  }

  // Runs once per turn resolution, after supply.computeSupply().
  function collectResources(state) {
    ['allies', 'axis'].forEach(function (faction) {
      const fs = state.factions[faction];
      const inc = income(state, faction);
      const up = upkeep(state, faction);

      fs.manpower = clamp0(fs.manpower + inc.manpower - up.manpower);
      fs.production = clamp0(fs.production + inc.production);
      const fuelBefore = fs.fuel + inc.fuel;
      fs.fuel = clamp0(fuelBefore - up.fuel);

      if (fuelBefore - up.fuel < 0) {
        // fuel crisis: mechanized/air/naval readiness suffers
        global.WWG.State.allUnitsOf(state, faction).forEach(function (u) {
          const def = Data.UNIT_TYPES[u.type];
          if (def.needsFuel) global.WWG.Morale.adjust(state, u, -4);
        });
        global.WWG.State.log(state, global.WWG.State.factionLabel(faction) + ' suffered a fuel shortage — mechanized/air/naval readiness dropped.');
      }

      state._lastIncome = state._lastIncome || {};
      state._lastIncome[faction] = inc;
      state._lastUpkeep = state._lastUpkeep || {};
      state._lastUpkeep[faction] = up;
    });
  }

  function unitBuildable(state, faction, unitType) {
    const def = Data.UNIT_TYPES[unitType];
    if (!def) return false;
    if (def.requiresUpgrade && state.factions[faction].upgrades.indexOf(def.requiresUpgrade) === -1) return false;
    return true;
  }

  function totalCost(def, qty) {
    return {
      manpower: (def.cost.manpower || 0) * qty,
      production: (def.cost.production || 0) * qty
    };
  }

  function canAfford(state, faction, cost) {
    const fs = state.factions[faction];
    return fs.manpower >= (cost.manpower || 0) && fs.production >= (cost.production || 0) &&
      (cost.fuel == null || fs.fuel >= cost.fuel);
  }

  // Validates and immediately deducts resources; queues the unit to arrive next turn.
  function startBuild(state, faction, unitType, regionId, qty) {
    qty = Math.max(1, qty | 0);
    const def = Data.UNIT_TYPES[unitType];
    if (!def) return { ok: false, reason: 'Unknown unit type.' };
    if (!unitBuildable(state, faction, unitType)) return { ok: false, reason: 'Requires an unresearched upgrade.' };
    const rs = state.regions[regionId];
    if (!rs || rs.owner !== faction) return { ok: false, reason: 'You do not control that region.' };
    if (def.coastalOnly && !Data.REGIONS_BY_ID[regionId].coastal) return { ok: false, reason: 'That unit can only be built in a coastal region.' };

    const cost = totalCost(def, qty);
    if (!canAfford(state, faction, cost)) return { ok: false, reason: 'Insufficient resources.' };

    state.factions[faction].manpower -= cost.manpower;
    state.factions[faction].production -= cost.production;
    state.factions[faction].buildQueue.push({
      id: 'b' + Math.random().toString(36).slice(2, 9),
      faction: faction, unitType: unitType, regionId: regionId, qty: qty, turnsLeft: 1
    });
    return { ok: true };
  }

  // Runs once per turn resolution, before income (so freshly-arrived units count toward upkeep next cycle).
  function processBuildQueue(state) {
    ['allies', 'axis'].forEach(function (faction) {
      const fs = state.factions[faction];
      const remaining = [];
      fs.buildQueue.forEach(function (b) {
        b.turnsLeft -= 1;
        if (b.turnsLeft > 0) { remaining.push(b); return; }
        const rs = state.regions[b.regionId];
        if (!rs || rs.owner !== faction) {
          // region lost before completion: refund half the production
          const def = Data.UNIT_TYPES[b.unitType];
          fs.production += (def.cost.production || 0) * b.qty * 0.5;
          global.WWG.State.log(state, global.WWG.State.factionLabel(faction) + ' lost a build order (region no longer held) — partial refund.');
          return;
        }
        for (let i = 0; i < b.qty; i++) global.WWG.State.addUnit(state, faction, b.unitType, b.regionId);
        global.WWG.State.log(state, global.WWG.State.factionLabel(faction) + ' reinforcements arrive: ' + b.qty + 'x ' + Data.UNIT_TYPES[b.unitType].name + ' at ' + Data.REGIONS_BY_ID[b.regionId].name + '.');
      });
      fs.buildQueue = remaining;
    });
  }

  function purchaseUpgrade(state, faction, upgradeId) {
    const up = Data.UPGRADES.find(function (u) { return u.id === upgradeId; });
    if (!up) return { ok: false, reason: 'Unknown upgrade.' };
    const fs = state.factions[faction];
    if (fs.upgrades.indexOf(upgradeId) !== -1) return { ok: false, reason: 'Already researched.' };
    if (up.requires && fs.upgrades.indexOf(up.requires) === -1) return { ok: false, reason: 'Prerequisite not met.' };
    if (fs.production < up.cost.production) return { ok: false, reason: 'Insufficient production.' };
    fs.production -= up.cost.production;
    fs.upgrades.push(upgradeId);
    global.WWG.State.log(state, global.WWG.State.factionLabel(faction) + ' completed research: ' + up.name + '.');
    return { ok: true };
  }

  global.WWG = global.WWG || {};
  global.WWG.Economy = {
    income: income,
    upkeep: upkeep,
    collectResources: collectResources,
    unitBuildable: unitBuildable,
    totalCost: totalCost,
    canAfford: canAfford,
    startBuild: startBuild,
    processBuildQueue: processBuildQueue,
    purchaseUpgrade: purchaseUpgrade
  };
})(window);
