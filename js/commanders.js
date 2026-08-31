/* Player-side automation. Front Commander auto-moves/attacks with any units
   the player hasn't manually ordered this turn, per a stance. Economic
   Commander auto-spends whatever manpower/production the player hasn't
   already manually spent, per a priority. Both can be toggled on/off (or
   overridden per-unit by simply giving that unit a manual order first —
   automation always skips units/resources already committed). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const State = global.WWG.State;
  const Economy = global.WWG.Economy;

  // Note: reinforceChance is high for BOTH aggressive and defensive — aggressive
  // masses units forward to attack, defensive masses them forward to hold the
  // line. A "defensive" stance that just left units idle in the rear would be
  // weaker than balanced, not safer, so only balanced dials reinforcement back.
  const STANCES = {
    aggressive: { label: 'Aggressive', attackRatioThreshold: 1.20, reinforceChance: 0.90, supportUsage: 0.80, garrisonKeep: 0.10 },
    balanced: { label: 'Balanced', attackRatioThreshold: 1.60, reinforceChance: 0.70, supportUsage: 0.50, garrisonKeep: 0.25 },
    defensive: { label: 'Defensive', attackRatioThreshold: 2.50, reinforceChance: 0.90, supportUsage: 0.40, garrisonKeep: 0.60 }
  };

  const PRIORITIES = ['balanced', 'armor', 'infantry', 'air', 'navy', 'tech'];

  function priorityWeights(priority) {
    const base = { infantry: 25, armor: 15, artillery: 10, mech_infantry: 10, airborne: 5, fighter: 8, fighter_bomber: 8, bomber: 5, naval_bombard: 5, transport: 4, heavy_armor: 0, jet_fighter: 0 };
    if (priority === 'armor') { base.armor += 25; base.mech_infantry += 10; }
    else if (priority === 'infantry') { base.infantry += 25; base.artillery += 10; }
    else if (priority === 'air') { base.fighter += 15; base.fighter_bomber += 15; base.bomber += 10; }
    else if (priority === 'navy') { base.naval_bombard += 15; base.transport += 15; }
    return base;
  }

  function applyFrontCommander(state, faction) {
    const fc = state.factions[faction].commanders.front;
    if (!fc.enabled) return;
    const params = STANCES[fc.stance] || STANCES.balanced;

    const usedUnitIds = {};
    state.orders[faction].moves.forEach(function (o) { usedUnitIds[o.unitId] = true; });
    state.orders[faction].support.forEach(function (o) { usedUnitIds[o.unitId] = true; });

    const result = global.WWG.AI.autoTactics(state, faction, params, usedUnitIds);
    state.orders[faction].moves = state.orders[faction].moves.concat(result.moves);
    state.orders[faction].support = state.orders[faction].support.concat(result.support);
  }

  function applyEconomicCommander(state, faction) {
    const ec = state.factions[faction].commanders.economic;
    if (!ec.enabled) return;
    const fs = state.factions[faction];

    if (ec.priority === 'tech') {
      let guard = 0;
      while (guard++ < 6) {
        const options = Data.UPGRADES.filter(function (u) {
          return fs.upgrades.indexOf(u.id) === -1 &&
            (!u.requires || fs.upgrades.indexOf(u.requires) !== -1) &&
            fs.production >= u.cost.production;
        });
        if (options.length === 0) break;
        const res = Economy.purchaseUpgrade(state, faction, options[0].id);
        if (!res.ok) break;
      }
    }

    const ownedRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    if (ownedRegions.length === 0) return;
    const enemyFaction = State.otherFaction(faction);
    const frontLineIds = ownedRegions.filter(function (r) {
      return r.neighbors.some(function (n) { return state.regions[n].owner === enemyFaction; });
    }).map(function (r) { return r.id; });

    const weights = priorityWeights(ec.priority);
    let guard = 0;
    while (guard++ < 16) {
      const type = global.WWG.AI.weightedPick(state, faction, weights);
      if (!type) break;
      const def = Data.UNIT_TYPES[type];
      const regionId = global.WWG.AI.pickBuildRegion(state, faction, def, ownedRegions, frontLineIds);
      if (!regionId) break;
      const res = Economy.startBuild(state, faction, type, regionId, 1);
      if (!res.ok) break;
      if (fs.manpower < 1 && fs.production < 1) break;
    }
  }

  // Called once for the human player's faction at the start of turn resolution,
  // after their manual orders/builds are already staged/spent.
  function applyAutomation(state, faction) {
    applyEconomicCommander(state, faction); // spend leftover resources first...
    applyFrontCommander(state, faction);    // ...then move whatever's left idle
  }

  global.WWG = global.WWG || {};
  global.WWG.Commanders = {
    STANCES: STANCES,
    PRIORITIES: PRIORITIES,
    applyAutomation: applyAutomation
  };
})(window);
