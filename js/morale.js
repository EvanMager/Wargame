/* Morale: per-unit stat (0-100) that rolls up into a per-region average.
   Falls with losses/isolation, rises with wins/rest. Feeds combat.js as a
   strength multiplier and a retreat/surrender-failure chance. */
(function (global) {
  'use strict';

  const BASELINE = 65;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function moraleMultiplier(morale) {
    // 0 morale -> 0.55x combat strength, 100 morale -> 1.15x
    return 0.55 + clamp(morale, 0, 100) / (100 / 0.6);
  }

  // Chance a losing/retreating unit is destroyed outright instead of falling back.
  function collapseChance(morale) {
    return clamp(0.32 - morale * 0.0026, 0.03, 0.32);
  }

  function moraleGainMult(state, faction) {
    const Data = global.WWG.Data;
    const fs = state.factions[faction];
    let mult = 1;
    Data.UPGRADES.forEach(function (u) {
      if (fs.upgrades.indexOf(u.id) !== -1 && u.effect && u.effect.moraleGainMult) mult += u.effect.moraleGainMult;
    });
    return mult;
  }

  function moraleFloor(state, faction) {
    const Data = global.WWG.Data;
    const fs = state.factions[faction];
    let floor = 0;
    Data.UPGRADES.forEach(function (u) {
      if (fs.upgrades.indexOf(u.id) !== -1 && u.effect && u.effect.moraleFloor) floor = Math.max(floor, u.effect.moraleFloor);
    });
    return floor;
  }

  function adjust(state, unit, delta) {
    const gainMult = delta > 0 ? moraleGainMult(state, unit.faction) : 1;
    unit.morale = clamp(unit.morale + delta * gainMult, moraleFloor(state, unit.faction), 100);
  }

  // Called once per turn resolution, after combat & supply are settled.
  function tick(state) {
    const Data = global.WWG.Data;
    for (const id in state.units) {
      const u = state.units[id];
      const rs = state.regions[u.regionId];
      if (!rs) continue;
      if (!rs.supplied) {
        adjust(state, u, -6); // isolated troops crumble
      } else {
        // drift toward baseline when not otherwise adjusted by combat this turn
        if (u.morale < BASELINE) adjust(state, u, 3);
        else if (u.morale > BASELINE) adjust(state, u, -1);
      }
    }
  }

  function regionMorale(state, regionId, faction) {
    const units = global.WWG.State.unitsInRegion(state, regionId, faction);
    if (units.length === 0) return BASELINE;
    let sum = 0;
    units.forEach(function (u) { sum += u.morale; });
    return sum / units.length;
  }

  global.WWG = global.WWG || {};
  global.WWG.Morale = {
    BASELINE: BASELINE,
    moraleMultiplier: moraleMultiplier,
    collapseChance: collapseChance,
    adjust: adjust,
    tick: tick,
    regionMorale: regionMorale
  };
})(window);
