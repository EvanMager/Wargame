/* AI opponent. Four difficulty tiers (Rookie -> Elite): higher tiers play
   tactically better (lower attack-ratio threshold, more reliable reinforcement
   and air/naval support usage, smarter tech choices) AND get a resource
   income bonus applied in economy.js's income(). The AI only ever reads
   committed game state (state.regions/state.units/state.factions) — never
   the human player's in-progress order queue — so it stays genuinely blind
   to what the player is about to do this turn. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const State = global.WWG.State;

  const DIFFICULTY_INFO = {
    rookie: {
      id: 'rookie', label: 'Rookie', tier: 1,
      desc: 'Cautious and inefficient, with a resource penalty. Good for learning the ropes.',
      resourceMult: 0.85, attackRatioThreshold: 2.2, reinforceChance: 0.40, upgradeChance: 0.15, supportUsage: 0.30, garrisonKeep: 0.35
    },
    regular: {
      id: 'regular', label: 'Regular', tier: 2,
      desc: 'A competent, balanced opponent at even resources.',
      resourceMult: 1.00, attackRatioThreshold: 1.60, reinforceChance: 0.60, upgradeChance: 0.35, supportUsage: 0.50, garrisonKeep: 0.25
    },
    veteran: {
      id: 'veteran', label: 'Veteran', tier: 3,
      desc: 'Aggressive and efficient, with a production edge.',
      resourceMult: 1.15, attackRatioThreshold: 1.25, reinforceChance: 0.80, upgradeChance: 0.55, supportUsage: 0.75, garrisonKeep: 0.15
    },
    elite: {
      id: 'elite', label: 'Elite', tier: 4,
      desc: 'Ruthless and near-optimal, with a major resource bonus. A genuine challenge.',
      resourceMult: 1.35, attackRatioThreshold: 1.05, reinforceChance: 0.95, upgradeChance: 0.75, supportUsage: 1.00, garrisonKeep: 0.08
    }
  };

  function difficultyParams(difficulty) { return DIFFICULTY_INFO[difficulty] || DIFFICULTY_INFO.regular; }
  function difficultyResourceMult(difficulty) { return difficultyParams(difficulty).resourceMult; }

  function estimatePower(units, statKey) {
    const Morale = global.WWG.Morale;
    let sum = 0;
    units.forEach(function (u) {
      const def = Data.UNIT_TYPES[u.type];
      if (def.category !== 'ground') return;
      sum += def[statKey] * (u.strength / 100) * Morale.moraleMultiplier(u.morale);
    });
    return sum;
  }

  function buildWeights(state, faction, params) {
    const w = {
      infantry: 30, armor: 14, artillery: 10, mech_infantry: 8, airborne: 3,
      fighter: 7, fighter_bomber: 7, bomber: 4, naval_bombard: 3, transport: 2,
      heavy_armor: 0, jet_fighter: 0
    };
    if (params.tier >= 2) { w.armor += 6; w.artillery += 4; w.fighter_bomber += 4; }
    if (params.tier >= 3) { w.mech_infantry += 6; w.bomber += 4; w.fighter += 3; }
    if (params.tier >= 4) { w.armor += 6; w.mech_infantry += 4; }
    const fs = state.factions[faction];
    if (fs.upgrades.indexOf('heavy_armor') !== -1) w.heavy_armor = 9;
    if (fs.upgrades.indexOf('jet_fighter') !== -1) w.jet_fighter = 5;
    return w;
  }

  function weightedPick(state, faction, weights) {
    const entries = Object.keys(weights)
      .filter(function (t) { return weights[t] > 0 && global.WWG.Economy.unitBuildable(state, faction, t); })
      .filter(function (t) { return global.WWG.Economy.canAfford(state, faction, global.WWG.Economy.totalCost(Data.UNIT_TYPES[t], 1)); });
    if (entries.length === 0) return null;
    const total = entries.reduce(function (s, t) { return s + weights[t]; }, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < entries.length; i++) {
      roll -= weights[entries[i]];
      if (roll <= 0) return entries[i];
    }
    return entries[entries.length - 1];
  }

  function pickBuildRegion(state, faction, def, ownedRegions, frontLineIds) {
    let pool = ownedRegions.filter(function (r) { return state.regions[r.id].supplied; });
    if (def.coastalOnly) pool = pool.filter(function (r) { return r.coastal; });
    if (pool.length === 0) pool = ownedRegions.slice();
    if (pool.length === 0) return null;
    if (def.category === 'ground' && Math.random() < 0.6) {
      const front = pool.filter(function (r) { return frontLineIds.indexOf(r.id) !== -1; });
      if (front.length > 0) return front[Math.floor(Math.random() * front.length)].id;
    }
    pool.sort(function (a, b) { return b.resources.production - a.resources.production; });
    return pool[Math.floor(Math.random() * Math.min(3, pool.length))].id;
  }

  function aiEconomy(state, faction, params, frontLineIds) {
    const fs = state.factions[faction];

    if (Math.random() < params.upgradeChance) {
      const options = Data.UPGRADES.filter(function (u) {
        return fs.upgrades.indexOf(u.id) === -1 &&
          (!u.requires || fs.upgrades.indexOf(u.requires) !== -1) &&
          fs.production >= u.cost.production;
      });
      if (options.length > 0) {
        const pick = options[Math.floor(Math.random() * options.length)];
        global.WWG.Economy.purchaseUpgrade(state, faction, pick.id);
      }
    }

    const ownedRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    if (ownedRegions.length === 0) return;
    const weights = buildWeights(state, faction, params);

    let guard = 0;
    while (guard++ < 14) {
      const type = weightedPick(state, faction, weights);
      if (!type) break;
      const def = Data.UNIT_TYPES[type];
      const regionId = pickBuildRegion(state, faction, def, ownedRegions, frontLineIds);
      if (!regionId) break;
      const res = global.WWG.Economy.startBuild(state, faction, type, regionId, 1);
      if (!res.ok) break;
      if (fs.manpower < 1 && fs.production < 1) break;
    }
  }

  function findSupportUnits(state, faction, targetRegionId, usedUnitIds, wantRole) {
    return State.allUnitsOf(state, faction).filter(function (u) {
      if (usedUnitIds[u.id]) return false;
      const def = Data.UNIT_TYPES[u.type];
      if (def.category === 'ground') return false;
      if (wantRole === 'offense' && def.role === 'air_superiority') return false;
      if (wantRole === 'defense' && def.role !== 'air_superiority') return false;
      const options = global.WWG.Movement.supportOptions(state, u);
      return options.indexOf(targetRegionId) !== -1;
    });
  }

  // Shared tactical AI used both by the AI opponent (tier-based params) and by the
  // player's Front Commander automation (stance-based params). Only touches units
  // not already present in usedUnitIds, so a Front Commander never overrides moves
  // the human already queued manually.
  function autoTactics(state, faction, params, usedUnitIds) {
    const enemyFaction = State.otherFaction(faction);
    const moves = [];
    const support = [];

    const myRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    const frontLine = myRegions.filter(function (r) {
      return r.neighbors.some(function (n) { return state.regions[n].owner === enemyFaction; });
    });
    const frontLineIds = frontLine.map(function (r) { return r.id; });

    // --- Attacks ---
    frontLine.forEach(function (r) {
      const enemyNeighbors = r.neighbors.filter(function (n) { return state.regions[n].owner === enemyFaction; });
      if (enemyNeighbors.length === 0) return;

      enemyNeighbors.forEach(function (targetId) {
        const myGround = State.unitsInRegion(state, r.id, faction)
          .filter(function (u) { return !usedUnitIds[u.id] && Data.UNIT_TYPES[u.type].category === 'ground'; });
        if (myGround.length === 0) return;

        const defUnits = State.unitsInRegion(state, targetId, enemyFaction);
        const terrain = Data.TERRAIN[Data.REGIONS_BY_ID[targetId].terrain];
        const estDefense = estimatePower(defUnits, 'defense') * (1 + terrain.defenseBonus);
        const estAttack = estimatePower(myGround, 'attack');
        const ratio = estAttack / Math.max(0.01, estDefense);

        const shouldAttack = defUnits.length === 0 ? true : ratio >= params.attackRatioThreshold;
        if (!shouldAttack) return;

        const keepGarrison = Math.random() < params.garrisonKeep && myGround.length > 1;
        const committed = keepGarrison ? myGround.slice(1) : myGround;
        if (committed.length === 0) return;

        committed.forEach(function (u) {
          moves.push({ unitId: u.id, fromRegionId: r.id, toRegionId: targetId, mode: 'adjacent' });
          usedUnitIds[u.id] = true;
        });

        if (Math.random() < params.supportUsage) {
          findSupportUnits(state, faction, targetId, usedUnitIds, 'offense').slice(0, 2).forEach(function (u) {
            support.push({ unitId: u.id, targetRegionId: targetId });
            usedUnitIds[u.id] = true;
          });
        }
      });
    });

    // --- Defensive air-superiority support over threatened front-line regions ---
    frontLine.forEach(function (r) {
      if (Math.random() >= params.supportUsage) return;
      findSupportUnits(state, faction, r.id, usedUnitIds, 'defense').slice(0, 1).forEach(function (u) {
        support.push({ unitId: u.id, targetRegionId: r.id });
        usedUnitIds[u.id] = true;
      });
    });

    // --- Reinforce weak front-line regions from quiet rear regions ---
    if (Math.random() < params.reinforceChance) {
      const rear = myRegions.filter(function (r) { return frontLineIds.indexOf(r.id) === -1; });
      const weighted = frontLine.map(function (r) {
        const power = estimatePower(State.unitsInRegion(state, r.id, faction), 'defense');
        return { r: r, power: power };
      }).sort(function (a, b) { return a.power - b.power; });

      rear.forEach(function (r) {
        const idle = State.unitsInRegion(state, r.id, faction)
          .filter(function (u) { return !usedUnitIds[u.id] && Data.UNIT_TYPES[u.type].category === 'ground'; });
        if (idle.length < 2) return; // leave at least a token garrison
        const mover = idle[0];
        const target = r.neighbors.find(function (n) { return state.regions[n].owner === faction; });
        if (!target) return;
        moves.push({ unitId: mover.id, fromRegionId: r.id, toRegionId: target, mode: 'adjacent' });
        usedUnitIds[mover.id] = true;
      });
    }

    return { moves: moves, support: support };
  }

  function generateOrders(state, faction, difficulty) {
    const params = difficultyParams(difficulty);
    const enemyFaction = State.otherFaction(faction);
    const myRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    const frontLineIds = myRegions.filter(function (r) {
      return r.neighbors.some(function (n) { return state.regions[n].owner === enemyFaction; });
    }).map(function (r) { return r.id; });

    aiEconomy(state, faction, params, frontLineIds);
    return autoTactics(state, faction, params, {});
  }

  global.WWG = global.WWG || {};
  global.WWG.AI = {
    DIFFICULTY_INFO: DIFFICULTY_INFO,
    difficultyParams: difficultyParams,
    difficultyResourceMult: difficultyResourceMult,
    generateOrders: generateOrders,
    autoTactics: autoTactics,
    weightedPick: weightedPick,
    pickBuildRegion: pickBuildRegion,
    buildWeights: buildWeights
  };
})(window);
