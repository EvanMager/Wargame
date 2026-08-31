/* Ground combat math. Pure functions over the game state: given an attacking
   force and the defending region, computes power, casualties, and outcome.
   Orchestration (who's attacking what, ownership flips, retreats routing)
   lives in turnEngine.js which calls into this module per contested region. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function otherFaction(f) { return f === 'allies' ? 'axis' : 'allies'; }

  function unitSupplyMultiplier(state, faction, regionId) {
    const rs = state.regions[regionId];
    if (!rs) return 1;
    if (rs.owner !== faction) return 1; // shouldn't happen, but don't punish for bad data
    return rs.supplied ? 1 : 0.55;
  }

  // Support (artillery-in-stack is handled by the base power loop; this covers
  // air/naval units on a "support" order targeting this battle) contributions,
  // reduced by enemy air-superiority fighters intercepting (1 fighter cancels
  // the single strongest interceptable contribution).
  function supportContributions(state, regionId, faction, supportOrdersByFaction) {
    const orders = (supportOrdersByFaction[faction] || []).filter(function (o) { return o.targetRegionId === regionId; });
    const contribs = [];
    orders.forEach(function (o) {
      const u = state.units[o.unitId];
      if (!u || u.faction !== faction) return;
      const def = Data.UNIT_TYPES[u.type];
      if (!def.supportBonus || def.category === 'ground') return;
      contribs.push({ unit: u, bonus: def.supportBonus * (u.strength / 100) });
    });

    const enemyFaction = otherFaction(faction);
    const enemyOrders = (supportOrdersByFaction[enemyFaction] || []).filter(function (o) { return o.targetRegionId === regionId; });
    let fighterCount = 0;
    enemyOrders.forEach(function (o) {
      const u = state.units[o.unitId];
      if (u && u.faction === enemyFaction && Data.UNIT_TYPES[u.type].role === 'air_superiority') fighterCount++;
    });
    const interceptable = contribs.filter(function (c) { return c.unit.type !== 'artillery'; })
      .sort(function (a, b) { return b.bonus - a.bonus; });
    for (let i = 0; i < fighterCount && i < interceptable.length; i++) {
      const idx = contribs.indexOf(interceptable[i]);
      if (idx !== -1) contribs.splice(idx, 1);
    }
    return contribs;
  }

  function artillerySupportBonusBoost(state, faction) {
    const fs = state.factions[faction];
    let boost = 0;
    Data.UPGRADES.forEach(function (u) {
      if (fs.upgrades.indexOf(u.id) !== -1 && u.effect && u.effect.artillerySupportBonus) boost += u.effect.artillerySupportBonus;
    });
    return boost;
  }

  // entries: [{unit, originRegionId}] — originRegionId defaults to unit.regionId (defenders).
  function computeSidePower(state, entries, faction, regionId, isDefender, supportOrdersByFaction) {
    const Morale = global.WWG.Morale;
    let base = 0;
    entries.forEach(function (e) {
      const def = Data.UNIT_TYPES[e.unit.type];
      if (def.category !== 'ground') return;
      const raw = isDefender ? def.defense : def.attack;
      const strengthFrac = e.unit.strength / 100;
      const moraleMult = Morale.moraleMultiplier(e.unit.morale);
      const supplyMult = unitSupplyMultiplier(state, faction, e.originRegionId || e.unit.regionId);
      base += raw * strengthFrac * moraleMult * supplyMult;
    });

    let supportMult = 1;
    const artBoost = artillerySupportBonusBoost(state, faction);
    supportContributions(state, regionId, faction, supportOrdersByFaction).forEach(function (c) {
      supportMult += c.bonus + (c.unit.type === 'artillery' ? artBoost : 0);
    });
    return { power: base * supportMult, support: supportMult };
  }

  function applyLossPoints(state, units, pts) {
    units.forEach(function (u) {
      if (!state.units[u.id]) return;
      u.strength = clamp(u.strength - pts, 0, 100);
      if (u.strength <= 0) delete state.units[u.id];
    });
  }

  // attackerEntries: [{unit, originRegionId}]. defenderUnits: [unit,...] (already in regionId).
  // Returns outcome details; does NOT mutate ownership or move units — caller (turnEngine) does that.
  function resolveBattle(state, regionId, attackerFaction, attackerEntries, defenderUnits, supportOrdersByFaction) {
    const defenderFaction = otherFaction(attackerFaction);
    const terrain = Data.TERRAIN[global.WWG.State.getRegion(regionId).terrain];

    const atk = computeSidePower(state, attackerEntries, attackerFaction, regionId, false, supportOrdersByFaction);
    const defRaw = computeSidePower(state, defenderUnits.map(function (u) { return { unit: u }; }), defenderFaction, regionId, true, supportOrdersByFaction);
    const defensePower = defRaw.power * (1 + terrain.defenseBonus);
    const attackPower = atk.power;

    if (attackPower <= 0.001) return { outcome: 'no_attack', attackPower: 0, defensePower: defensePower };

    const ratio = attackPower / Math.max(0.01, defensePower);
    const varA = 0.85 + Math.random() * 0.3;
    const varD = 0.85 + Math.random() * 0.3;

    const defenderLossPts = clamp(22 * ratio * varD, 4, 85);
    const attackerLossPts = clamp(22 / ratio * varA, 4, 85);

    applyLossPoints(state, defenderUnits, defenderLossPts);
    applyLossPoints(state, attackerEntries.map(function (e) { return e.unit; }), attackerLossPts);

    const decisiveRatio = ratio * ((varA + varD) / 2);
    let outcome;
    if (decisiveRatio >= 1.3) outcome = 'attacker_win';
    else if (decisiveRatio >= 0.8) outcome = 'stalemate';
    else outcome = 'attacker_repulsed';

    return {
      outcome: outcome, attackPower: attackPower, defensePower: defensePower, ratio: ratio,
      defenderLossPts: defenderLossPts, attackerLossPts: attackerLossPts,
      terrainBonus: terrain.defenseBonus
    };
  }

  global.WWG = global.WWG || {};
  global.WWG.Combat = {
    computeSidePower: computeSidePower,
    resolveBattle: resolveBattle,
    applyLossPoints: applyLossPoints,
    unitSupplyMultiplier: unitSupplyMultiplier
  };
})(window);
