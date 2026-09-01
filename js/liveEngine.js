/* Live (real-time) simulation core — a second engine that sits alongside
   turnEngine.js/combat.js, reusing the same map/unit/economy/morale/supply
   data and modules but replacing the blind-simultaneous-turn resolution
   with a continuous clock. Units don't get "move orders"; instead each
   ground unit has a stance:
     - 'idle'      — garrisoned, baseline defense.
     - 'defending' — dug in: defense bonus, but can't contribute elsewhere.
     - 'attacking' — pushing into one adjacent enemy region: contributes
                     attack power there every tick, but only defends its
                     own home region at a steep penalty while committed.
   Combat is continuous attrition (reusing the same attack/defense/morale/
   terrain/supply numbers as classic mode, just applied in small increments
   over time instead of one big per-turn resolution) rather than a single
   ratio->outcome roll. Economy accrues every tick; morale/supply/build
   queue/AI/victory are re-evaluated on a "virtual turn" cadence so those
   already-tuned classic-mode systems can be reused almost verbatim. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const State = global.WWG.State;

  const VIRTUAL_TURN_SECONDS = 60; // simulated seconds per "virtual turn" (economy/morale/supply/AI pacing)
  const CAMPAIGN_VTURN_LIMIT = 26; // same campaign length as classic mode
  const DAMAGE_PER_VTURN = 46; // strength points dealt at power ratio 1.0, per virtual turn — tuned via simulation
  const MARKER_LIFETIME = 20; // seconds a "battle happened here" map marker stays lit
  const STANCE_DEF_MULT = { idle: 1.0, defending: 1.25, attacking: 0.35 };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function unitDef(u) { return Data.UNIT_TYPES[u.type]; }

  function createLiveState(playerFaction, difficulty) {
    const state = State.create(playerFaction, difficulty);
    state.mode = 'live';
    state.liveClock = 0;
    state.vturn = 0;
    state.speed = 1;
    state.paused = false;
    state._periodicAccum = 0;
    State.log(state, 'Live operation begins. Set units to Attack, Defend, or Hold at any time — the clock never stops.');
    return state;
  }

  /* ---------------- Stances ---------------- */

  function setStance(state, faction, unitIds, stance, targetRegionId) {
    const out = [];
    unitIds.forEach(function (id) {
      const u = state.units[id];
      if (!u || u.faction !== faction) { out.push({ id: id, ok: false, reason: 'Invalid unit.' }); return; }
      if (unitDef(u).category !== 'ground') { out.push({ id: id, ok: false, reason: 'Only ground units have a stance in Live mode.' }); return; }
      if (stance === 'attacking') {
        const neighbors = Data.REGIONS_BY_ID[u.regionId].neighbors;
        if (!targetRegionId || neighbors.indexOf(targetRegionId) === -1) { out.push({ id: id, ok: false, reason: 'Target must be an adjacent region.' }); return; }
        if (state.regions[targetRegionId].owner === faction) { out.push({ id: id, ok: false, reason: 'That region is already yours.' }); return; }
        u.stance = 'attacking';
        u.attackTargetRegionId = targetRegionId;
      } else {
        u.stance = stance;
        u.attackTargetRegionId = null;
      }
      out.push({ id: id, ok: true });
    });
    return out;
  }

  function attackableTargets(state, unit) {
    if (unitDef(unit).category !== 'ground') return [];
    return Data.REGIONS_BY_ID[unit.regionId].neighbors.filter(function (nId) {
      return state.regions[nId].owner !== unit.faction;
    });
  }

  function attackersFor(state, regionId) {
    const out = [];
    for (const id in state.units) {
      const u = state.units[id];
      if (u.stance === 'attacking' && u.attackTargetRegionId === regionId) out.push(u);
    }
    return out;
  }

  /* ---------------- Power (mirrors combat.js's formula, plus stance) ---------------- */

  function regionDefensePower(state, regionId) {
    const Morale = global.WWG.Morale;
    const rs = state.regions[regionId];
    const units = State.unitsInRegion(state, regionId, rs.owner).filter(function (u) { return unitDef(u).category === 'ground'; });
    const suppliedMult = rs.supplied ? 1 : 0.55;
    let power = 0;
    units.forEach(function (u) {
      power += unitDef(u).defense * (u.strength / 100) * Morale.moraleMultiplier(u.morale) * suppliedMult * STANCE_DEF_MULT[u.stance || 'idle'];
    });
    const terrain = Data.TERRAIN[Data.REGIONS_BY_ID[regionId].terrain];
    return power * (1 + terrain.defenseBonus);
  }

  function attackPower(state, attackers) {
    const Morale = global.WWG.Morale;
    let power = 0;
    attackers.forEach(function (u) {
      const originSupplied = state.regions[u.regionId].owner === u.faction && state.regions[u.regionId].supplied;
      power += unitDef(u).attack * (u.strength / 100) * Morale.moraleMultiplier(u.morale) * (originSupplied ? 1 : 0.55);
    });
    return power;
  }

  /* ---------------- Continuous combat ---------------- */

  function applySplitDamage(state, units, totalDmg) {
    if (units.length === 0 || totalDmg <= 0) return;
    const per = totalDmg / units.length;
    units.forEach(function (u) {
      if (!state.units[u.id]) return;
      u.strength = clamp(u.strength - per, 0, 100);
      if (u.strength <= 0) delete state.units[u.id];
    });
  }

  function addMarker(state, regionId, outcome) {
    state.lastBattleRegions = (state.lastBattleRegions || []).filter(function (b) { return b.regionId !== regionId; });
    state.lastBattleRegions.push({ regionId: regionId, outcome: outcome, at: state.liveClock });
  }

  function combatTick(state, dtSeconds) {
    const byTarget = {};
    for (const id in state.units) {
      const u = state.units[id];
      if (u.stance === 'attacking' && u.attackTargetRegionId) {
        (byTarget[u.attackTargetRegionId] = byTarget[u.attackTargetRegionId] || []).push(u);
      }
    }
    const vturnFrac = dtSeconds / VIRTUAL_TURN_SECONDS;

    Object.keys(byTarget).forEach(function (targetId) {
      const attackers = byTarget[targetId].filter(function (u) { return state.units[u.id]; });
      if (attackers.length === 0) return;
      const attackerFaction = attackers[0].faction;
      const rs = state.regions[targetId];
      if (rs.owner === attackerFaction) { // shouldn't happen, but stay defensive
        attackers.forEach(function (u) { u.stance = 'idle'; u.attackTargetRegionId = null; });
        return;
      }
      const defenderFaction = rs.owner;

      const defPower = regionDefensePower(state, targetId);
      const atkPower = attackPower(state, attackers);
      if (atkPower <= 0.001) return;
      const ratio = atkPower / Math.max(0.01, defPower);

      const dmgToDefenders = DAMAGE_PER_VTURN * ratio * vturnFrac;
      const dmgToAttackers = DAMAGE_PER_VTURN * (1 / ratio) * vturnFrac * 0.6; // pushing troops are a little more durable than a static defender's return fire

      applySplitDamage(state, State.unitsInRegion(state, targetId, defenderFaction).filter(function (u) { return unitDef(u).category === 'ground'; }), dmgToDefenders);
      applySplitDamage(state, attackers, dmgToAttackers);

      const stillDefending = State.unitsInRegion(state, targetId, defenderFaction).filter(function (u) { return unitDef(u).category === 'ground'; });
      const stillAttacking = attackers.filter(function (u) { return state.units[u.id]; });

      if (stillDefending.length === 0) {
        if (stillAttacking.length > 0) {
          stillAttacking.forEach(function (u) {
            u.regionId = targetId; u.stance = 'idle'; u.attackTargetRegionId = null;
            global.WWG.Morale.adjust(state, u, 10);
          });
          rs.owner = attackerFaction;
          addMarker(state, targetId, 'attacker_win');
          State.log(state, State.factionLabel(attackerFaction) + ' capture ' + Data.REGIONS_BY_ID[targetId].name + ' from ' + State.factionLabel(defenderFaction) + '!');
        }
      } else if (stillAttacking.length === 0) {
        addMarker(state, targetId, 'attacker_repulsed');
        State.log(state, State.factionLabel(attackerFaction) + '\'s attack on ' + Data.REGIONS_BY_ID[targetId].name + ' has been ground down and repulsed.');
      } else {
        addMarker(state, targetId, 'stalemate');
      }
    });

    const cutoff = state.liveClock - MARKER_LIFETIME;
    state.lastBattleRegions = (state.lastBattleRegions || []).filter(function (b) { return b.at == null || b.at > cutoff; });
  }

  /* ---------------- Continuous economy ---------------- */

  function accrueEconomy(state, dtSeconds) {
    const frac = dtSeconds / VIRTUAL_TURN_SECONDS;
    const Economy = global.WWG.Economy;
    ['allies', 'axis'].forEach(function (faction) {
      const fs = state.factions[faction];
      const inc = Economy.income(state, faction);
      const up = Economy.upkeep(state, faction);
      fs.manpower = Math.max(0, fs.manpower + (inc.manpower - up.manpower) * frac);
      fs.production = Math.max(0, fs.production + inc.production * frac);
      fs.fuel = Math.max(0, fs.fuel + (inc.fuel - up.fuel) * frac);
      state._lastIncome = state._lastIncome || {}; state._lastIncome[faction] = inc;
      state._lastUpkeep = state._lastUpkeep || {}; state._lastUpkeep[faction] = up;
    });
  }

  /* ---------------- Periodic (once per virtual turn): reuses classic-mode systems ---------------- */

  function applyAutoDefend(state) {
    ['allies', 'axis'].forEach(function (faction) {
      if (!state.factions[faction].liveAutoDefend) return;
      State.allUnitsOf(state, faction).forEach(function (u) {
        if (u.stance === 'idle' && unitDef(u).category === 'ground') u.stance = 'defending';
      });
    });
  }

  function runPeriodic(state) {
    state.vturn++;
    global.WWG.Supply.computeSupply(state);
    global.WWG.Morale.tick(state);
    global.WWG.Economy.processBuildQueue(state);
    applyAutoDefend(state);
    if (state.aiFaction) liveAiTick(state, state.aiFaction, state.difficulty);
    State.advanceDate(state);
    checkVictory(state);
  }

  /* ---------------- Live AI: periodic stance + economy decisions ---------------- */

  function liveAiTick(state, faction, difficulty) {
    const AI = global.WWG.AI;
    const Economy = global.WWG.Economy;
    const params = AI.difficultyParams(difficulty);
    const enemyFaction = State.otherFaction(faction);

    if (Math.random() < params.upgradeChance) {
      const fs = state.factions[faction];
      const options = Data.UPGRADES.filter(function (u) {
        return fs.upgrades.indexOf(u.id) === -1 && (!u.requires || fs.upgrades.indexOf(u.requires) !== -1) && fs.production >= u.cost.production;
      });
      if (options.length > 0) Economy.purchaseUpgrade(state, faction, options[Math.floor(Math.random() * options.length)].id);
    }

    const myRegions = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    const frontLineIds = myRegions.filter(function (r) { return r.neighbors.some(function (n) { return state.regions[n].owner === enemyFaction; }); }).map(function (r) { return r.id; });

    const weights = AI.buildWeights(state, faction, params);
    let guard = 0;
    while (guard++ < 10) {
      const type = AI.weightedPick(state, faction, weights);
      if (!type) break;
      const def = Data.UNIT_TYPES[type];
      const regionId = AI.pickBuildRegion(state, faction, def, myRegions, frontLineIds);
      if (!regionId) break;
      const res = Economy.startBuild(state, faction, type, regionId, 1);
      if (!res.ok) break;
    }

    myRegions.forEach(function (r) {
      const idle = State.unitsInRegion(state, r.id, faction).filter(function (u) { return u.stance === 'idle' && unitDef(u).category === 'ground'; });
      if (idle.length === 0) return;
      const enemyNeighbors = r.neighbors.filter(function (n) { return state.regions[n].owner === enemyFaction; });
      let attacked = false;
      enemyNeighbors.forEach(function (targetId) {
        if (attacked) return;
        const defPower = regionDefensePower(state, targetId);
        const hypotheticalAtk = attackPower(state, idle);
        const already = attackersFor(state, targetId).filter(function (u) { return u.faction === faction; });
        const ratio = (hypotheticalAtk + attackPower(state, already)) / Math.max(0.01, defPower);
        if (ratio >= params.attackRatioThreshold) {
          const keepGarrison = Math.random() < params.garrisonKeep && idle.length > 1;
          const committed = keepGarrison ? idle.slice(1) : idle;
          setStance(state, faction, committed.map(function (u) { return u.id; }), 'attacking', targetId);
          attacked = true;
        }
      });
      if (!attacked && enemyNeighbors.length > 0) {
        setStance(state, faction, idle.map(function (u) { return u.id; }), 'defending', null);
      }
    });
  }

  /* ---------------- Victory ---------------- */

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
    if (state.vturn >= CAMPAIGN_VTURN_LIMIT) {
      state.gameOver = { winner: 'axis', reason: 'The campaign clock has run out with Berlin still in German hands.' };
    }
  }

  /* ---------------- Main tick ---------------- */

  function tick(state, dtRealSeconds) {
    if (!state || state.gameOver || state.paused) return;
    const dt = dtRealSeconds * state.speed;
    state.liveClock += dt;
    combatTick(state, dt);
    accrueEconomy(state, dt);
    state._periodicAccum += dt;
    let guard = 0;
    while (state._periodicAccum >= VIRTUAL_TURN_SECONDS && guard++ < 50) {
      state._periodicAccum -= VIRTUAL_TURN_SECONDS;
      runPeriodic(state);
      if (state.gameOver) break;
    }
  }

  global.WWG = global.WWG || {};
  global.WWG.LiveEngine = {
    VIRTUAL_TURN_SECONDS: VIRTUAL_TURN_SECONDS,
    CAMPAIGN_VTURN_LIMIT: CAMPAIGN_VTURN_LIMIT,
    createLiveState: createLiveState,
    setStance: setStance,
    attackableTargets: attackableTargets,
    attackersFor: attackersFor,
    regionDefensePower: regionDefensePower,
    attackPower: attackPower,
    tick: tick,
    checkVictory: checkVictory
  };
})(window);
