/* Movement/reachability helpers shared by the order-builder UI, the turn
   engine's order validation, and the AI. Ground movement is single-hop per
   turn (an adjacent region) except for two special cases: Airborne paradrop
   (up to 2 hops, ignores ownership of the path) and sea transport (ground
   units can leapfrog directly between two coastal regions carried by a
   friendly Transport unit in the origin region). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;

  function groundNeighbors(regionId) {
    return Data.REGIONS_BY_ID[regionId].neighbors.slice();
  }

  // Regions an Airborne unit could paradrop into: any region within `hops`
  // graph-hops of its current region (flies over intervening territory).
  function withinHops(regionId, hops) {
    const seen = { };
    seen[regionId] = 0;
    let frontier = [regionId];
    for (let h = 1; h <= hops; h++) {
      const next = [];
      frontier.forEach(function (rid) {
        Data.REGIONS_BY_ID[rid].neighbors.forEach(function (nId) {
          if (!(nId in seen)) { seen[nId] = h; next.push(nId); }
        });
      });
      frontier = next;
    }
    delete seen[regionId];
    return Object.keys(seen);
  }

  function coastalRegionIds() {
    return Data.REGIONS.filter(function (r) { return r.coastal; }).map(function (r) { return r.id; });
  }

  // What can this unit legally target with a move order this turn?
  // Returns { adjacent: [ids], paradrop: [ids] (airborne only), transport: [ids] (needs a transport unit present) }
  function moveOptions(state, unit) {
    const type = Data.UNIT_TYPES[unit.type];
    const out = { adjacent: groundNeighbors(unit.regionId), paradrop: [], transport: [] };
    if (type.canParadrop) {
      out.paradrop = withinHops(unit.regionId, 2);
    }
    if (type.category === 'ground') {
      const here = Data.REGIONS_BY_ID[unit.regionId];
      if (here.coastal) {
        const myTransports = global.WWG.State.unitsInRegion(state, unit.regionId, unit.faction)
          .filter(function (u) { return u.type === 'transport'; });
        if (myTransports.length > 0) {
          out.transport = coastalRegionIds().filter(function (id) { return id !== unit.regionId; });
        }
      }
    }
    return out;
  }

  // Support-order reachability for air/naval units (a target region within `move` hops).
  function supportOptions(state, unit) {
    const type = Data.UNIT_TYPES[unit.type];
    let targets = withinHops(unit.regionId, Math.max(1, type.move - 1)).concat([unit.regionId]);
    if (type.coastalOnly) {
      const coastal = coastalRegionIds();
      targets = targets.filter(function (id) { return coastal.indexOf(id) !== -1; });
    }
    return targets;
  }

  global.WWG = global.WWG || {};
  global.WWG.Movement = {
    groundNeighbors: groundNeighbors,
    withinHops: withinHops,
    coastalRegionIds: coastalRegionIds,
    moveOptions: moveOptions,
    supportOptions: supportOptions
  };
})(window);
