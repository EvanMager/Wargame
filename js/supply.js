/* Supply network: BFS/Dijkstra from each faction's supply sources (controlled
   coastal ports + rail hubs) through friendly-controlled territory. Regions
   beyond logistics range are out of supply and suffer penalties elsewhere
   (combat.js, economy.js). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const BASE_LOGISTICS_RANGE = 5;

  function logisticsRange(state, faction) {
    let range = BASE_LOGISTICS_RANGE;
    const fs = state.factions[faction];
    Data.UPGRADES.forEach(function (u) {
      if (fs.upgrades.indexOf(u.id) !== -1 && u.effect && u.effect.logisticsRange) {
        range += u.effect.logisticsRange;
      }
    });
    return range;
  }

  function isSupplySource(state, regionId, faction) {
    const rd = Data.REGIONS_BY_ID[regionId];
    if (!rd) return false;
    if (state.regions[regionId].owner !== faction) return false;
    return !!rd.coastal || !!rd.railHub;
  }

  // Dijkstra over the subgraph of regions owned by `faction`, edge weight = destination terrain moveCost.
  function distancesFor(state, faction) {
    const dist = {};
    Data.REGIONS.forEach(function (r) { dist[r.id] = Infinity; });

    const owned = Data.REGIONS.filter(function (r) { return state.regions[r.id].owner === faction; });
    const sources = owned.filter(function (r) { return isSupplySource(state, r.id, faction); });
    if (sources.length === 0) return dist;

    const visited = {};
    sources.forEach(function (r) { dist[r.id] = 0; });

    // Simple O(n^2) Dijkstra; map is tiny (21 nodes) so this is plenty fast.
    for (let iter = 0; iter < owned.length; iter++) {
      let cur = null, curDist = Infinity;
      owned.forEach(function (r) {
        if (!visited[r.id] && dist[r.id] < curDist) { curDist = dist[r.id]; cur = r.id; }
      });
      if (cur == null) break;
      visited[cur] = true;
      const rd = Data.REGIONS_BY_ID[cur];
      rd.neighbors.forEach(function (nId) {
        if (state.regions[nId].owner !== faction) return;
        const terrain = Data.TERRAIN[Data.REGIONS_BY_ID[nId].terrain];
        const nd = dist[cur] + terrain.moveCost;
        if (nd < dist[nId]) dist[nId] = nd;
      });
    }
    return dist;
  }

  // Recomputes state.regions[*].supplied for the CURRENT owner of every region,
  // and bumps/resets turnsIsolated. Call once per turn resolution.
  function computeSupply(state) {
    const rangeAllies = logisticsRange(state, 'allies');
    const rangeAxis = logisticsRange(state, 'axis');
    const distAllies = distancesFor(state, 'allies');
    const distAxis = distancesFor(state, 'axis');

    Data.REGIONS.forEach(function (r) {
      const rs = state.regions[r.id];
      const range = rs.owner === 'allies' ? rangeAllies : rangeAxis;
      const dist = rs.owner === 'allies' ? distAllies[r.id] : distAxis[r.id];
      const supplied = dist <= range;
      rs.supplied = supplied;
      rs.turnsIsolated = supplied ? 0 : (rs.turnsIsolated || 0) + 1;
    });
  }

  global.WWG = global.WWG || {};
  global.WWG.Supply = {
    BASE_LOGISTICS_RANGE: BASE_LOGISTICS_RANGE,
    logisticsRange: logisticsRange,
    computeSupply: computeSupply,
    isSupplySource: isSupplySource
  };
})(window);
