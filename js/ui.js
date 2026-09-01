/* DOM wiring: renders the top bar, map, and side-panel tabs from game state,
   and turns clicks into calls into turnEngine/economy/commanders. This is
   the only module that touches the DOM. */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;

  const UNIT_ICON = {
    infantry: 'INF', armor: 'ARM', artillery: 'ART', mech_infantry: 'MEC', airborne: 'ABN',
    fighter: 'FTR', fighter_bomber: 'F-B', bomber: 'BMR', naval_bombard: 'NAV', transport: 'TRP',
    heavy_armor: 'HVY', jet_fighter: 'JET'
  };

  const ui = { state: null, activeTab: 'region', armedUnit: null, selectedUnits: {} };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  function showToast(msg, ms) {
    const stack = $('toast-stack');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    stack.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 4500);
  }

  /* ---------------- Map interaction ---------------- */

  // Arms one or many units at once for a move/support order — the quick-select
  // toolbar in the Region tab lets the player check off a whole stack and move
  // it in a single click-sequence instead of repeating per unit.
  function armUnits(unitIds, mode) {
    ui.armedUnit = { unitIds: unitIds.slice(), mode: mode };
    renderAll();
  }
  function armUnit(unitId, mode) { armUnits([unitId], mode); }

  function intersect(a, b) { return a.filter(function (x) { return b.indexOf(x) !== -1; }); }

  // Ground units (incl. artillery) apply their support bonus automatically when
  // present in a battle at their own location — only air/naval units target a
  // *different* region with a Support order. Mirrors turnEngine.addSupportOrder.
  function hasSupportRole(u) {
    const def = Data.UNIT_TYPES[u.type];
    return def.category !== 'ground' && (def.supportBonus || def.role === 'air_superiority');
  }

  // Every unit type in the same region shares the same adjacent/transport
  // reachability (it only depends on the region, not the unit), but support
  // range depends on each unit's own move stat and paradrop is airborne-only —
  // so a multi-unit selection only offers destinations every selected unit can
  // actually reach.
  function computeIntersectedOptions(state, unitIds) {
    let adjacent = null, paradrop = null, transport = null, support = null;
    unitIds.forEach(function (id) {
      const u = state.units[id];
      if (!u) return;
      const opts = global.WWG.Movement.moveOptions(state, u);
      const sup = hasSupportRole(u) ? global.WWG.Movement.supportOptions(state, u) : [];
      adjacent = adjacent === null ? opts.adjacent : intersect(adjacent, opts.adjacent);
      paradrop = paradrop === null ? opts.paradrop : intersect(paradrop, opts.paradrop);
      transport = transport === null ? opts.transport : intersect(transport, opts.transport);
      support = support === null ? sup : intersect(support, sup);
    });
    return { adjacent: adjacent || [], paradrop: paradrop || [], transport: transport || [], support: support || [] };
  }

  function selectedUnitIdsInCurrentRegion() {
    const rid = ui.state.selectedRegion;
    return Object.keys(ui.selectedUnits).filter(function (id) {
      return ui.selectedUnits[id] && ui.state.units[id] && ui.state.units[id].regionId === rid;
    });
  }

  function reachableForArmed() {
    if (!ui.armedUnit) return null;
    const ids = ui.armedUnit.unitIds.filter(function (id) { return ui.state.units[id]; });
    if (ids.length === 0) return null;
    if (ui.armedUnit.mode === 'attack') {
      let result = null;
      ids.forEach(function (id) {
        const targets = global.WWG.LiveEngine.attackableTargets(ui.state, ui.state.units[id]);
        result = result === null ? targets : intersect(result, targets);
      });
      return result || [];
    }
    if (ui.armedUnit.mode === 'support') {
      let result = null;
      ids.forEach(function (id) {
        const opts = global.WWG.Movement.supportOptions(ui.state, ui.state.units[id]);
        result = result === null ? opts : intersect(result, opts);
      });
      return result || [];
    }
    let result = null;
    ids.forEach(function (id) {
      const opts = global.WWG.Movement.moveOptions(ui.state, ui.state.units[id]);
      const pool = ui.armedUnit.mode === 'paradrop' ? opts.paradrop : (ui.armedUnit.mode === 'transport' ? opts.transport : opts.adjacent);
      result = result === null ? pool : intersect(result, pool);
    });
    return result || [];
  }

  function handleRegionClick(regionId) {
    if (ui.armedUnit) {
      const faction = ui.state.playerFaction;
      const ids = ui.armedUnit.unitIds.filter(function (id) { return ui.state.units[id]; });
      let okCount = 0, failReason = null;
      if (ui.state.mode === 'live' && ui.armedUnit.mode === 'attack') {
        global.WWG.LiveEngine.setStance(ui.state, faction, ids, 'attacking', regionId).forEach(function (r) {
          if (r.ok) okCount++; else failReason = r.reason;
        });
      } else {
        ids.forEach(function (id) {
          const res = ui.armedUnit.mode === 'support'
            ? global.WWG.TurnEngine.addSupportOrder(ui.state, faction, id, regionId)
            : global.WWG.TurnEngine.addMoveOrder(ui.state, faction, id, regionId, ui.armedUnit.mode);
          if (res.ok) okCount++; else failReason = res.reason;
        });
      }
      ui.armedUnit = null;
      ui.selectedUnits = {};
      if (okCount === 0 && failReason) showToast(failReason);
      else if (ids.length > 1) showToast(okCount + ' of ' + ids.length + ' orders placed.', 2500);
      renderAll();
      return;
    }
    ui.state.selectedRegion = regionId;
    ui.activeTab = 'region';
    ui.selectedUnits = {};
    renderAll();
  }

  /* ---------------- Rendering ---------------- */

  function renderAll() {
    if (!ui.state) return;
    renderTopbar();
    global.WWG.MapRender.render(ui.state, reachableForArmed());
    renderTabs();
  }

  function renderTopbar() {
    const state = ui.state;
    const fs = state.factions[state.playerFaction];
    const inc = (state._lastIncome && state._lastIncome[state.playerFaction]) || { manpower: 0, production: 0, fuel: 0 };
    const up = (state._lastUpkeep && state._lastUpkeep[state.playerFaction]) || { manpower: 0, fuel: 0 };

    function pill(icon, label, val, delta) {
      return '<div class="resource-pill" title="' + label + '"><span class="icon">' + icon + '</span>' +
        '<span class="val">' + Math.floor(val) + '</span>' +
        (delta != null ? '<span class="delta">' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + '</span>' : '') + '</div>';
    }
    $('resource-bar').innerHTML =
      pill('👥', 'Manpower', fs.manpower, inc.manpower - up.manpower) +
      pill('🏭', 'Production', fs.production, inc.production) +
      pill('⛽', 'Fuel', fs.fuel, inc.fuel - up.fuel);

    const diff = global.WWG.AI.difficultyParams(state.difficulty);
    const isLive = state.mode === 'live';

    if (isLive) {
      $('turn-info').innerHTML = '<b>LIVE</b> — Vturn <b>' + state.vturn + '</b>/' + global.WWG.LiveEngine.CAMPAIGN_VTURN_LIMIT + ' — ' + global.WWG.State.dateLabel(state) +
        ' &nbsp;|&nbsp; You: <b class="pill ' + state.playerFaction + '">' + global.WWG.State.factionLabel(state.playerFaction) + '</b>' +
        ' vs AI (<b>' + diff.label + '</b>)';
      $('end-turn-btn').classList.add('hidden');
      $('live-controls').classList.remove('hidden');
      $('live-pause-btn').textContent = state.paused ? '▶' : '⏸';
      document.querySelectorAll('#live-controls [data-speed]').forEach(function (b) {
        b.classList.toggle('active', Number(b.dataset.speed) === state.speed);
      });
    } else {
      $('turn-info').innerHTML = 'Turn <b>' + state.turn + '</b> — ' + global.WWG.State.dateLabel(state) +
        ' &nbsp;|&nbsp; You: <b class="pill ' + state.playerFaction + '">' + global.WWG.State.factionLabel(state.playerFaction) + '</b>' +
        ' vs AI (<b>' + diff.label + '</b>)';
      $('end-turn-btn').classList.remove('hidden');
      $('live-controls').classList.add('hidden');
      $('end-turn-btn').disabled = !!state.gameOver;
    }
    $('orders-tab-btn').textContent = isLive ? 'Status' : 'Orders';
  }

  function renderTabs() {
    ['region', 'orders', 'commanders', 'upgrades', 'log', 'rules'].forEach(function (t) {
      $('tab-' + t).classList.toggle('hidden', ui.activeTab !== t);
    });
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === ui.activeTab);
    });
    const isLive = ui.state.mode === 'live';
    if (ui.activeTab === 'region') renderRegionTab();
    else if (ui.activeTab === 'orders') { if (isLive) renderLiveStatusTab(); else renderOrdersTab(); }
    else if (ui.activeTab === 'commanders') { if (isLive) renderLiveCommandersTab(); else renderCommandersTab(); }
    else if (ui.activeTab === 'upgrades') renderUpgradesTab();
    else if (ui.activeTab === 'log') renderLogTab();
    else if (ui.activeTab === 'rules') { if (isLive) renderLiveRulesTab(); else renderRulesTab(); }
  }

  function unitActionButtons(state, u) {
    const faction = state.playerFaction;
    if (u.faction !== faction) return '';
    const moveOrder = global.WWG.TurnEngine.findMoveOrder(state, faction, u.id);
    const supportOrder = global.WWG.TurnEngine.findSupportOrder(state, faction, u.id);
    if (moveOrder) {
      return '<span class="order-tag">→ ' + esc(global.WWG.State.getRegion(moveOrder.toRegionId).name) + ' (' + moveOrder.mode + ')</span>' +
        '<button data-action="cancel-order" data-unit="' + u.id + '">✕</button>';
    }
    if (supportOrder) {
      return '<span class="order-tag">⚡ support ' + esc(global.WWG.State.getRegion(supportOrder.targetRegionId).name) + '</span>' +
        '<button data-action="cancel-order" data-unit="' + u.id + '">✕</button>';
    }
    const opts = global.WWG.Movement.moveOptions(state, u);
    let html = '';
    const armed = ui.armedUnit && ui.armedUnit.unitIds.indexOf(u.id) !== -1;
    if (opts.adjacent.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="adjacent" class="' + (armed && ui.armedUnit.mode === 'adjacent' ? 'active' : '') + '">Move</button>';
    if (opts.paradrop.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="paradrop" class="' + (armed && ui.armedUnit.mode === 'paradrop' ? 'active' : '') + '">Drop</button>';
    if (opts.transport.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="transport" class="' + (armed && ui.armedUnit.mode === 'transport' ? 'active' : '') + '">Ship</button>';
    if (hasSupportRole(u)) {
      html += '<button data-action="arm-support" data-unit="' + u.id + '" class="' + (armed && ui.armedUnit.mode === 'support' ? 'active' : '') + '">Support</button>';
    }
    return html;
  }

  // Live mode: units don't get one-shot orders, they get a stance that holds
  // until changed — so all three buttons are always shown, with the active
  // one highlighted, instead of disappearing once "used" like classic mode.
  function liveUnitActionButtons(state, u) {
    const faction = state.playerFaction;
    if (u.faction !== faction) return '';
    if (Data.UNIT_TYPES[u.type].category !== 'ground') {
      return '<span class="small" style="color:var(--text-dim);">passive in Live v1</span>';
    }
    const LiveEngine = global.WWG.LiveEngine;
    const armed = ui.armedUnit && ui.armedUnit.mode === 'attack' && ui.armedUnit.unitIds.indexOf(u.id) !== -1;
    let tag = '';
    if (u.stance === 'attacking' && u.attackTargetRegionId) {
      tag = '<span class="order-tag">⚔ attacking ' + esc(global.WWG.State.getRegion(u.attackTargetRegionId).name) + '</span>';
    }
    const targets = LiveEngine.attackableTargets(state, u);
    let html = tag;
    if (targets.length > 0) {
      html += '<button class="stance-btn ' + (armed ? 'active' : '') + '" data-action="arm-attack" data-unit="' + u.id + '">Attack</button>';
    }
    html += '<button class="stance-btn ' + (u.stance === 'defending' ? 'active' : '') + '" data-action="set-live-stance" data-unit="' + u.id + '" data-stance="defending">Defend</button>';
    html += '<button class="stance-btn ' + (u.stance === 'idle' ? 'active' : '') + '" data-action="set-live-stance" data-unit="' + u.id + '" data-stance="idle">Hold</button>';
    return html;
  }

  function unitRowHtml(state, u) {
    const def = Data.UNIT_TYPES[u.type];
    const faction = state.playerFaction;
    const isLive = state.mode === 'live';
    const selectable = u.faction === faction && (isLive
      ? Data.UNIT_TYPES[u.type].category === 'ground'
      : (!global.WWG.TurnEngine.findMoveOrder(state, faction, u.id) && !global.WWG.TurnEngine.findSupportOrder(state, faction, u.id)));
    const checked = !!ui.selectedUnits[u.id];
    const checkbox = selectable
      ? '<input type="checkbox" class="unit-check" data-action="toggle-unit" data-unit="' + u.id + '" ' + (checked ? 'checked' : '') + '>'
      : '<span class="unit-check-spacer"></span>';
    return '<div class="unit-row' + (checked ? ' selected' : '') + '">' + checkbox + '<span class="u-icon">' + (UNIT_ICON[u.type] || '?') + '</span>' +
      '<span class="u-name">' + def.name + '</span>' +
      '<span class="u-str">' + Math.round(u.strength) + '%</span>' +
      '<div class="strength-bar"><div style="width:' + Math.max(0, Math.round(u.strength)) + '%"></div></div>' +
      (isLive ? liveUnitActionButtons(state, u) : unitActionButtons(state, u)) + '</div>';
  }

  function renderRegionTab() {
    const state = ui.state;
    const rid = state.selectedRegion;
    const container = $('tab-region');

    if (ui.armedUnit) {
      const ids = ui.armedUnit.unitIds.filter(function (id) { return state.units[id]; });
      let label;
      if (ids.length === 1) {
        label = Data.UNIT_TYPES[state.units[ids[0]].type].name;
      } else {
        const counts = {};
        ids.forEach(function (id) { const n = Data.UNIT_TYPES[state.units[id].type].name; counts[n] = (counts[n] || 0) + 1; });
        label = ids.length + ' units (' + Object.keys(counts).map(function (n) { return counts[n] + 'x ' + n; }).join(', ') + ')';
      }
      container.innerHTML = '<div class="card"><h4>Choose a Destination</h4>' +
        '<p class="small">' + esc(label) + ' — click a highlighted region on the map (' + ui.armedUnit.mode + ').</p>' +
        '<button data-action="cancel-armed" style="width:100%;">Cancel</button></div>';
      wireDelegation();
      return;
    }

    if (!rid) { container.innerHTML = '<p class="small">Click a region on the map to inspect it, build units, or issue orders.</p>'; return; }

    const rd = global.WWG.State.getRegion(rid);
    const rs = state.regions[rid];
    const terrain = Data.TERRAIN[rd.terrain];
    const isMine = rs.owner === state.playerFaction;

    let html = '<div class="card"><h4>' + esc(rd.name) + '</h4>';
    html += '<div class="row"><span class="lbl">Controlled by</span><span class="pill ' + rs.owner + '">' + global.WWG.State.factionLabel(rs.owner) + '</span></div>';
    html += '<div class="row"><span class="lbl">Terrain</span><span>' + terrain.name + ' (+' + Math.round(terrain.defenseBonus * 100) + '% def, move cost ' + terrain.moveCost + ')</span></div>';
    html += '<div class="row"><span class="lbl">Supply</span><span class="pill ' + (rs.supplied ? '' : 'bad') + '">' + (rs.supplied ? 'Supplied' : 'CUT OFF (' + rs.turnsIsolated + ' turn' + (rs.turnsIsolated === 1 ? '' : 's') + ')') + '</span></div>';
    html += '<div class="row"><span class="lbl">Garrison Morale</span><span>' + Math.round(global.WWG.Morale.regionMorale(state, rid, rs.owner)) + ' / 100</span></div>';
    html += '<div class="row"><span class="lbl">Resources/turn</span><span>👥' + rd.resources.manpower + ' &nbsp;🏭' + rd.resources.production + ' &nbsp;⛽' + rd.resources.fuel + '</span></div>';
    if (rd.coastal) html += '<div class="small">⚓ Coastal — naval ops possible; acts as a supply port when held.</div>';
    if (rd.railHub) html += '<div class="small">🚉 Rail hub — always a supply source when held.</div>';
    html += '</div>';

    const isLive = state.mode === 'live';
    if (isLive) html += renderSiegeCard(state, rid);

    const units = global.WWG.State.unitsInRegion(state, rid);
    html += '<div class="card"><h4>Units (' + units.length + ')</h4>';
    if (units.length === 0) {
      html += '<p class="small">No units present — an undefended region.</p>';
    } else {
      const selectableCount = units.filter(function (u) {
        if (u.faction !== state.playerFaction) return false;
        if (isLive) return Data.UNIT_TYPES[u.type].category === 'ground';
        return !global.WWG.TurnEngine.findMoveOrder(state, state.playerFaction, u.id) && !global.WWG.TurnEngine.findSupportOrder(state, state.playerFaction, u.id);
      }).length;
      if (selectableCount > 1) {
        html += '<div class="quick-select-bar"><span class="small">Quick select:</span>' +
          '<button data-action="select-all-units">All</button>' +
          '<button data-action="select-none-units">None</button></div>';
      }
      units.forEach(function (u) { html += unitRowHtml(state, u); });

      const selectedIds = selectedUnitIdsInCurrentRegion();
      if (selectedIds.length > 1) {
        html += '<div class="quick-move-bar">';
        if (isLive) {
          const targets = computeLiveIntersectedTargets(state, selectedIds);
          if (targets.length) html += '<button class="primary" data-action="arm-attack-multi">Attack Selected (' + selectedIds.length + ')</button>';
          html += '<button data-action="set-live-stance-multi" data-stance="defending">Defend Selected</button>';
          html += '<button data-action="set-live-stance-multi" data-stance="idle">Hold Selected</button>';
        } else {
          const opts = computeIntersectedOptions(state, selectedIds);
          if (opts.adjacent.length) html += '<button class="primary" data-action="arm-move-multi" data-mode="adjacent">Move Selected (' + selectedIds.length + ')</button>';
          if (opts.paradrop.length) html += '<button data-action="arm-move-multi" data-mode="paradrop">Drop Selected</button>';
          if (opts.transport.length) html += '<button data-action="arm-move-multi" data-mode="transport">Ship Selected</button>';
          if (opts.support.length) html += '<button data-action="arm-support-multi">Support Selected</button>';
        }
        html += '</div>';
      }
    }
    html += '</div>';

    if (isMine) {
      html += renderBuildSection(state, rid);
      html += renderQueueSection(state, rid);
    }

    container.innerHTML = html;
    wireDelegation();
  }

  function computeLiveIntersectedTargets(state, unitIds) {
    let result = null;
    unitIds.forEach(function (id) {
      const u = state.units[id];
      if (!u) return;
      const targets = global.WWG.LiveEngine.attackableTargets(state, u);
      result = result === null ? targets : intersect(result, targets);
    });
    return result || [];
  }

  // Shows the live-mode tug-of-war at this region, if anyone is currently attacking it.
  function renderSiegeCard(state, rid) {
    const attackers = global.WWG.LiveEngine.attackersFor(state, rid);
    if (attackers.length === 0) return '';
    const attackerFaction = attackers[0].faction;
    const atkPower = global.WWG.LiveEngine.attackPower(state, attackers);
    const defPower = global.WWG.LiveEngine.regionDefensePower(state, rid);
    const pct = Math.max(4, Math.min(96, (atkPower / (atkPower + defPower)) * 100));
    return '<div class="card"><h4>⚔ Under Attack</h4>' +
      '<div class="row"><span class="lbl">Attacker</span><span class="pill ' + attackerFaction + '">' + global.WWG.State.factionLabel(attackerFaction) + ' — ' + attackers.length + ' unit(s)</span></div>' +
      '<div class="siege-bar"><div class="siege-fill" style="width:' + pct.toFixed(0) + '%;"></div></div>' +
      '<div class="small">Attack ' + atkPower.toFixed(1) + ' vs Defense ' + defPower.toFixed(1) + '</div></div>';
  }

  function renderBuildSection(state, rid) {
    const faction = state.playerFaction;
    const fs = state.factions[faction];
    const rd = global.WWG.State.getRegion(rid);
    const isLive = state.mode === 'live';
    let html = '<div class="card"><h4>Build</h4>';
    Object.keys(Data.UNIT_TYPES).forEach(function (type) {
      const def = Data.UNIT_TYPES[type];
      if (def.requiresUpgrade && fs.upgrades.indexOf(def.requiresUpgrade) === -1) return;
      if (def.coastalOnly && !rd.coastal) return;
      const afford = global.WWG.Economy.canAfford(state, faction, global.WWG.Economy.totalCost(def, 1));
      html += '<div class="build-row"><span class="name">' + def.name + '</span>' +
        '<span class="cost">👥' + def.cost.manpower + ' 🏭' + def.cost.production + '</span>' +
        '<button data-action="build" data-unit-type="' + type + '" data-region="' + rid + '" ' + (afford ? '' : 'disabled') + '>Build</button></div>';
    });
    html += '<p class="small">' + (isLive
      ? 'New units arrive after 1 virtual turn (~' + global.WWG.LiveEngine.VIRTUAL_TURN_SECONDS + 's at 1x speed).'
      : 'New units arrive at the start of next turn.') + '</p></div>';
    return html;
  }

  function renderQueueSection(state, rid) {
    const faction = state.playerFaction;
    const queue = state.factions[faction].buildQueue.filter(function (b) { return b.regionId === rid; });
    if (queue.length === 0) return '';
    let html = '<div class="card"><h4>Incoming</h4>';
    queue.forEach(function (b) {
      html += '<div class="row"><span>' + b.qty + 'x ' + Data.UNIT_TYPES[b.unitType].name + '</span><span class="small">' + b.turnsLeft + ' turn(s)</span></div>';
    });
    html += '</div>';
    return html;
  }

  function renderOrdersTab() {
    const state = ui.state;
    const faction = state.playerFaction;
    const moves = state.orders[faction].moves;
    const support = state.orders[faction].support;
    let html = '<div class="card"><h4>Queued Orders</h4>';
    if (moves.length === 0 && support.length === 0) {
      html += '<p class="small">No manual orders yet. Click a region on the map, pick a unit\'s Move/Support button, then click a highlighted destination region.</p>';
    }
    moves.forEach(function (o) {
      const u = state.units[o.unitId]; if (!u) return;
      html += '<div class="row"><span>' + Data.UNIT_TYPES[u.type].name + ': ' + esc(global.WWG.State.getRegion(o.fromRegionId).name) + ' → ' + esc(global.WWG.State.getRegion(o.toRegionId).name) +
        ' <span class="small">(' + o.mode + ')</span></span><button data-action="cancel-order" data-unit="' + u.id + '">✕</button></div>';
    });
    support.forEach(function (o) {
      const u = state.units[o.unitId]; if (!u) return;
      html += '<div class="row"><span>' + Data.UNIT_TYPES[u.type].name + ' support → ' + esc(global.WWG.State.getRegion(o.targetRegionId).name) +
        '</span><button data-action="cancel-order" data-unit="' + u.id + '">✕</button></div>';
    });
    if (moves.length || support.length) html += '<button data-action="clear-orders" class="danger" style="margin-top:6px;width:100%;">Clear All Orders</button>';
    html += '</div>';

    const all = global.WWG.State.allUnitsOf(state, faction);
    const ordered = {};
    moves.concat(support).forEach(function (o) { ordered[o.unitId] = true; });
    const idle = all.filter(function (u) { return !ordered[u.id]; });
    html += '<div class="card"><h4>Unassigned Units</h4>' +
      '<p class="small">Units without a manual order this turn are handled by your Front Commander if enabled — otherwise they simply hold their region.</p>' +
      '<div class="small"><b>' + idle.length + '</b> of <b>' + all.length + '</b> units idle.</div></div>';

    $('tab-orders').innerHTML = html;
    wireDelegation();
  }

  function renderLiveStatusTab() {
    const state = ui.state;
    const faction = state.playerFaction;
    const LiveEngine = global.WWG.LiveEngine;

    let html = '<div class="card"><h4>Active Engagements</h4>';
    const contested = Data.REGIONS.filter(function (r) { return LiveEngine.attackersFor(state, r.id).length > 0; });
    if (contested.length === 0) {
      html += '<p class="small">No engagements in progress.</p>';
    } else {
      contested.forEach(function (r) {
        const attackers = LiveEngine.attackersFor(state, r.id);
        const attackerFaction = attackers[0].faction;
        const atkPower = LiveEngine.attackPower(state, attackers);
        const defPower = LiveEngine.regionDefensePower(state, r.id);
        const pct = Math.max(4, Math.min(96, (atkPower / (atkPower + defPower)) * 100));
        html += '<div class="siege-row"><div class="row"><b>' + esc(r.name) + '</b><span class="pill ' + attackerFaction + '">' + global.WWG.State.factionLabel(attackerFaction) + ' attacking</span></div>' +
          '<div class="siege-bar"><div class="siege-fill" style="width:' + pct.toFixed(0) + '%;"></div></div>' +
          '<div class="small">' + attackers.length + ' unit(s) — attack ' + atkPower.toFixed(1) + ' vs defense ' + defPower.toFixed(1) + '</div></div>';
      });
    }
    html += '</div>';

    html += '<div class="card"><h4>Your Units Attacking</h4>';
    const mine = global.WWG.State.allUnitsOf(state, faction).filter(function (u) { return u.stance === 'attacking'; });
    if (mine.length === 0) {
      html += '<p class="small">None right now — arm a unit with Attack in the Region tab.</p>';
    } else {
      mine.forEach(function (u) {
        html += '<div class="row"><span>' + (UNIT_ICON[u.type] || '?') + ' ' + Data.UNIT_TYPES[u.type].name + ' → ' + esc(global.WWG.State.getRegion(u.attackTargetRegionId).name) + '</span>' +
          '<button data-action="set-live-stance" data-unit="' + u.id + '" data-stance="idle">Recall</button></div>';
      });
    }
    html += '</div>';

    $('tab-orders').innerHTML = html;
    wireDelegation();
  }

  function renderLiveCommandersTab() {
    const state = ui.state;
    const fs = state.factions[state.playerFaction];
    let html = '<div class="card"><h4>Garrison Commander</h4>';
    html += '<div class="row"><span class="lbl">Auto-defend idle units</span><button data-action="toggle-live-autodefend" class="' + (fs.liveAutoDefend ? 'active primary' : '') + '">' + (fs.liveAutoDefend ? 'ENABLED' : 'DISABLED') + '</button></div>';
    html += '<p class="small">When enabled, any unit just sitting idle (not attacking or already dug in) is switched to Defend automatically each virtual turn, so reinforcements never sit at baseline readiness.</p></div>';
    html += '<div class="card small">Full Front/Economic Commander automation is Classic-mode only for now — in Live mode you direct every attack yourself.</div>';
    $('tab-commanders').innerHTML = html;
    wireDelegation();
  }

  function renderCommandersTab() {
    const state = ui.state;
    const fs = state.factions[state.playerFaction];
    let html = '<div class="card"><h4>Front Commander</h4>';
    html += '<div class="row"><span class="lbl">Status</span><button data-action="toggle-front" class="' + (fs.commanders.front.enabled ? 'active primary' : '') + '">' + (fs.commanders.front.enabled ? 'ENABLED' : 'DISABLED') + '</button></div>';
    html += '<p class="small">Auto-moves and auto-attacks with any unit you have not personally given an order this turn.</p>';
    html += '<div class="stance-group">';
    Object.keys(global.WWG.Commanders.STANCES).forEach(function (s) {
      html += '<button data-action="set-stance" data-stance="' + s + '" class="' + (fs.commanders.front.stance === s ? 'active' : '') + '">' + global.WWG.Commanders.STANCES[s].label + '</button>';
    });
    html += '</div></div>';

    html += '<div class="card"><h4>Economic Commander</h4>';
    html += '<div class="row"><span class="lbl">Status</span><button data-action="toggle-economic" class="' + (fs.commanders.economic.enabled ? 'active primary' : '') + '">' + (fs.commanders.economic.enabled ? 'ENABLED' : 'DISABLED') + '</button></div>';
    html += '<p class="small">Auto-spends any Manpower/Production you have not personally spent this turn, toward a priority.</p>';
    html += '<div class="priority-group">';
    global.WWG.Commanders.PRIORITIES.forEach(function (p) {
      html += '<button data-action="set-priority" data-priority="' + p + '" class="' + (fs.commanders.economic.priority === p ? 'active' : '') + '">' + p.charAt(0).toUpperCase() + p.slice(1) + '</button>';
    });
    html += '</div></div>';

    html += '<div class="card small">Tip: give a unit a manual order (or spend resources manually) to override the commanders for just that unit/resource — everything else still gets automated.</div>';

    $('tab-commanders').innerHTML = html;
    wireDelegation();
  }

  function renderUpgradesTab() {
    const state = ui.state;
    const fs = state.factions[state.playerFaction];
    let html = '';
    Data.UPGRADES.forEach(function (u) {
      const owned = fs.upgrades.indexOf(u.id) !== -1;
      const prereqOk = !u.requires || fs.upgrades.indexOf(u.requires) !== -1;
      const afford = fs.production >= u.cost.production;
      html += '<div class="upg-item ' + (owned ? 'owned' : '') + '">';
      html += '<div class="top"><b>' + u.name + '</b>' + (owned ? '<span class="pill">RESEARCHED</span>' : '<span class="small">🏭 ' + u.cost.production + '</span>') + '</div>';
      html += '<div class="desc">' + u.desc + (u.requires ? '<br>Requires: ' + esc(Data.UPGRADES.find(function (x) { return x.id === u.requires; }).name) : '') + '</div>';
      if (!owned) html += '<button style="margin-top:6px;width:100%;" data-action="purchase-upgrade" data-upgrade="' + u.id + '" ' + ((!prereqOk || !afford) ? 'disabled' : '') + '>' + (prereqOk ? 'Research' : 'Locked') + '</button>';
      html += '</div>';
    });
    $('tab-upgrades').innerHTML = html;
    wireDelegation();
  }

  function renderLogTab() {
    const entries = ui.state.log.slice().reverse().slice(0, 200);
    let html = entries.map(function (e) { return '<div class="log-entry"><span class="t">T' + e.turn + '</span>' + esc(e.text) + '</div>'; }).join('');
    $('tab-log').innerHTML = html || '<p class="small">No events yet.</p>';
  }

  function unitStatsRows() {
    const groups = { ground: [], air: [], naval: [] };
    Object.keys(Data.UNIT_TYPES).forEach(function (id) {
      const d = Data.UNIT_TYPES[id];
      if (d.requiresUpgrade) return; // covered separately under Upgrades
      groups[d.category].push(d);
    });
    function rows(list) {
      return list.map(function (d) {
        return '<tr><td>' + d.name + '</td><td class="num">' + d.attack + '</td><td class="num">' + d.defense + '</td><td class="num">' + d.move + '</td>' +
          '<td class="num">' + (d.needsFuel ? d.fuelUse : '—') + '</td><td class="num">' + d.cost.manpower + '/' + d.cost.production + '</td></tr>';
      }).join('');
    }
    return '<table class="rules-table"><thead><tr><th>Unit</th><th>Atk</th><th>Def</th><th>Move</th><th>Fuel</th><th>Cost M/P</th></tr></thead><tbody>' +
      rows(groups.ground) + '</tbody></table>' +
      '<table class="rules-table"><thead><tr><th>Air</th><th>Atk</th><th>Def</th><th>Move</th><th>Fuel</th><th>Cost M/P</th></tr></thead><tbody>' +
      rows(groups.air) + '</tbody></table>' +
      '<table class="rules-table"><thead><tr><th>Naval</th><th>Atk</th><th>Def</th><th>Move</th><th>Fuel</th><th>Cost M/P</th></tr></thead><tbody>' +
      rows(groups.naval) + '</tbody></table>';
  }

  function renderRulesTab() {
    const html =
      '<div class="rules-section"><h4>Objective</h4><p>' +
      'Play the <b>Allies</b> and break out of the Normandy beachhead, drive east, and capture <b>Berlin</b> to win outright. ' +
      'Play the <b>Axis</b> and hold — either push every Allied unit back into the sea, or simply survive with Berlin still in ' +
      'German hands when the campaign clock runs out at turn 26 (roughly May 1945).</p></div>' +

      '<div class="rules-section"><h4>Turns: Simultaneous Blind Orders</h4><p>' +
      'Each turn is half a month. You queue up moves, support orders, builds and research, then press <b>End Turn</b>. ' +
      'The AI is doing the exact same thing in secret — it only ever reacts to the state of the map as of your last End Turn, never to ' +
      'what you are about to do. When you press End Turn, both sides\' orders resolve together: movement, combat, supply, and the economy ' +
      'all happen in one pass, and the results are revealed at once in the Battle Report.</p></div>' +

      '<div class="rules-section"><h4>The Map</h4><ul>' +
      '<li>21 regions from Normandy to Berlin, each with a <b>terrain</b> type that gives the defender a combat bonus and costs movement points.</li>' +
      '<li>Regions are fluid, contiguous areas colored by controller (<span class="pill allies">Allies</span> / <span class="pill axis">Axis</span>); wherever two areas held by different sides actually border each other, that border glows orange — that\'s the <b>front line</b>, and it shifts as territory changes hands.</li>' +
      '<li><span class="rules-kbd">⚓</span> coastal/port &nbsp; <span class="rules-kbd">🚉</span> rail hub &nbsp; <span class="rules-kbd">★</span> capital (Berlin) &nbsp; <span class="rules-kbd">⚠</span> cut off from supply &nbsp; <span class="rules-kbd">⚔</span> a battle happened here last turn.</li>' +
      '<li>Drag to pan, scroll or use the +/− buttons to zoom, click a region to inspect it.</li>' +
      '</ul></div>' +

      '<div class="rules-section"><h4>Supply</h4><p>' +
      'Each side\'s supply network radiates out from the regions it controls that are coastal ports or rail hubs, through its own territory, ' +
      'up to a limited logistics range (upgradeable). A region beyond that range is <b>cut off</b>: its garrison fights at reduced strength, ' +
      'its morale decays every turn, and it stops contributing to the national economy. The Allies start with only two small ports, so holding ' +
      '(and eventually capturing more of) the coast matters as much as winning battles.</p></div>' +

      '<div class="rules-section"><h4>Economy</h4><p>Three resources, generated every turn by your <b>supplied</b> regions:</p><ul>' +
      '<li><b>Manpower</b> — recruits units.</li>' +
      '<li><b>Production</b> — builds units and funds research.</li>' +
      '<li><b>Fuel</b> — required to move or support with armor, mechanized infantry, aircraft, and ships. Running short degrades those units\' readiness that turn.</li>' +
      '</ul><p class="small">The Allies also draw a flat off-map stipend every turn, representing the US/UK home front shipping men and material across the Channel — without it a 2-region beachhead could never keep pace with occupied France and Germany\'s ~19 regions.</p></div>' +

      '<div class="rules-section"><h4>Units</h4><p>Move and Fuel are per-turn figures; Cost is Manpower/Production. Ground units move one adjacent region per turn (Airborne can paradrop up to 2 regions, and a Transport in a coastal region can sealift ground units to any other coastal region). Air and naval units don\'t occupy ground — they\'re assigned a <b>Support</b> order to a nearby battle, adding to whichever side they belong to; enemy fighters on air-superiority duty intercept and cancel enemy bomber/CAS/naval support.</p>' +
      unitStatsRows() + '</div>' +

      '<div class="rules-section"><h4>Combat</h4><p>' +
      'When your units move into a region an enemy still holds, a battle is fought. Each side\'s power is the sum of its ground units\' ' +
      'attack (attacker) or defense (defender), scaled by unit strength and morale, plus any artillery/air/naval support — the defender\'s ' +
      'total also gets the terrain\'s defense bonus. The ratio of attack to defense decides the outcome: a big enough edge (≈1.3×) captures ' +
      'the region, a narrow edge or less is a stalemate, and a bad ratio gets the attacker bloodily repulsed. Losers take strength losses and, ' +
      'if beaten decisively, must retreat to a friendly adjacent region or risk being destroyed outright.</p></div>' +

      '<div class="rules-section"><h4>Morale</h4><p>' +
      'Every unit has morale (0–100) that rises when it wins or rests in supply, and falls when it loses or is cut off. Morale scales combat ' +
      'strength (roughly 0.55×–1.15×) and, when a losing unit needs to retreat, low morale raises the odds it is overrun and destroyed instead.</p></div>' +

      '<div class="rules-section"><h4>Upgrades</h4><p>' +
      'Spend Production in the <b>Upgrades</b> tab to research global bonuses (logistics range, production/manpower/fuel efficiency, artillery ' +
      'support, morale recovery) and to unlock stronger unit variants — Heavy Armor and Jet Fighters — once their prerequisites are met.</p></div>' +

      '<div class="rules-section"><h4>Commanders</h4><p>' +
      'In the <b>Commanders</b> tab you can delegate. The <b>Front Commander</b> auto-moves and auto-attacks with any unit you have not personally ' +
      'given an order this turn, according to a stance (Aggressive / Balanced / Defensive). The <b>Economic Commander</b> auto-spends any Manpower/' +
      'Production you have not personally spent, toward a priority (Armor / Infantry / Air / Navy / Tech / Balanced). Give a unit a manual order, ' +
      'or spend resources yourself, and that overrides the automation for just that unit or resource — everything else still gets handled.</p></div>' +

      '<div class="rules-section"><h4>AI Difficulty</h4><p>Four tiers, chosen at the start of the campaign. Higher tiers attack with a lower ' +
      'required advantage, reinforce and use air/naval support more reliably, research more readily, <em>and</em> get a straight income bonus:</p>' +
      '<table class="rules-table"><thead><tr><th>Tier</th><th>Style</th><th class="num">Resource bonus</th></tr></thead><tbody>' +
      Object.keys(global.WWG.AI.DIFFICULTY_INFO).map(function (k) {
        const d = global.WWG.AI.DIFFICULTY_INFO[k];
        return '<tr><td>' + d.label + '</td><td>' + d.desc + '</td><td class="num">' + (d.resourceMult >= 1 ? '+' : '') + Math.round((d.resourceMult - 1) * 100) + '%</td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="rules-section"><h4>Controls</h4><ul>' +
      '<li>Click a region to open it in the <b>Region</b> tab.</li>' +
      '<li>Click a unit\'s <b>Move</b>/<b>Drop</b>/<b>Ship</b>/<b>Support</b> button, then click a highlighted destination on the map.</li>' +
      '<li><b>Quick select</b>: when a region has more than one movable unit, check the boxes next to the ones you want (or hit <b>All</b>) and a "Move Selected" button appears — arm the whole stack and send it to one destination in a single click, instead of repeating per unit.</li>' +
      '<li>Review or cancel everything queued in the <b>Orders</b> tab before you commit.</li>' +
      '<li><b>Save</b>/<b>Load</b> in the top bar manage named save slots in your browser; the game also autosaves after every turn.</li>' +
      '</ul></div>';

    $('tab-rules').innerHTML = html;
  }

  function renderLiveRulesTab() {
    const LiveEngine = global.WWG.LiveEngine;
    const html =
      '<div class="rules-section"><h4>Objective</h4><p>Same campaign as Classic mode — Allies win by capturing <b>Berlin</b>, Axis wins by holding it (or eliminating the Allied lodgement) until the campaign clock runs out. The difference here is the clock: it never stops for orders.</p></div>' +

      '<div class="rules-section"><h4>The Clock</h4><p>' +
      'There is no End Turn button. Time runs continuously — combat, economy, and reinforcements all happen while you watch. A ' +
      '<b>virtual turn</b> (' + LiveEngine.VIRTUAL_TURN_SECONDS + ' seconds at 1x speed) is the pacing unit behind the scenes: supply, morale, ' +
      'the AI\'s next move, and build-queue completions are all re-evaluated on that cadence, the same way they work in Classic mode — just automatically, ' +
      'over and over, instead of once per click. Use <b>Pause</b> or the <b>1x/2x/4x</b> speed buttons in the top bar to control the pace.</p></div>' +

      '<div class="rules-section"><h4>Stances, not Orders</h4><p>Every ground unit you control always has exactly one stance, changeable any time:</p><ul>' +
      '<li><b>Attack</b> — pick an adjacent enemy region and the unit pushes into it continuously, wearing the defender down (and taking losses itself) every tick until it either captures the region, is ground down and repulsed, or you recall it.</li>' +
      '<li><b>Defend</b> — dug in at home: a real defense bonus, but it isn\'t contributing anywhere else.</li>' +
      '<li><b>Hold</b> — garrisoned at baseline readiness; can react instantly to Attack or Defend.</li>' +
      '</ul><p class="small">A unit committed to an attack only defends its own region at a steep penalty while it\'s away — you can\'t push and hold everywhere at full strength at once. That trade-off is the whole game.</p></div>' +

      '<div class="rules-section"><h4>Combat</h4><p>' +
      'Instead of one big per-turn battle roll, an active attack is continuous attrition: both sides\' power (same attack/defense/morale/terrain/supply ' +
      'math as Classic mode) is compared every tick and a small amount of strength is worn off both the attacker and defender, scaled to how lopsided the ' +
      'fight is. A capture happens the moment the defending garrison\'s strength hits zero while attackers remain; an attack fails once the attackers ' +
      'are ground down to nothing first. Reinforce a push or pull it back at any time — nothing is locked in until it resolves.</p></div>' +

      '<div class="rules-section"><h4>Economy</h4><p>Manpower, Production, and Fuel accrue continuously (you\'ll see the resource bar tick up in real time) ' +
      'using the exact same per-region income and upkeep numbers as Classic mode, just spread out per second instead of banked once a turn. Builds and ' +
      'research work exactly as in Classic mode — spend from the Region tab\'s Build section or the Upgrades tab whenever you like.</p></div>' +

      '<div class="rules-section"><h4>The AI</h4><p>The AI re-evaluates the whole map roughly once a virtual turn: it spends its economy, commits attacks ' +
      'where it judges the odds favorable for its difficulty tier, and defends where it feels threatened — the same difficulty scaling (tactics and a ' +
      'resource bonus at higher tiers) as Classic mode applies here too.</p></div>' +

      '<div class="rules-section"><h4>Current limitations</h4><p class="small">This is the first pass at Live mode: air and naval units can be built and ' +
      'garrisoned but don\'t yet have an active role (no Support stance in Live mode yet), and there\'s no Front/Economic Commander automation — only the ' +
      'simple Garrison Commander auto-defend toggle. Everything else — the map, economy, supply, morale, upgrades, and AI difficulty — is the same system ' +
      'as Classic mode underneath.</p></div>' +

      '<div class="rules-section"><h4>Controls</h4><ul>' +
      '<li>Click a region, then a unit\'s <b>Attack</b> button, then click a highlighted adjacent enemy region on the map.</li>' +
      '<li><b>Defend</b>/<b>Hold</b> apply immediately — no target needed.</li>' +
      '<li><b>Quick select</b> works the same as Classic mode: check off units (or hit <b>All</b>) for "Attack Selected" / "Defend Selected" / "Hold Selected".</li>' +
      '<li>The <b>Status</b> tab (where Orders lives in Classic mode) lists every active engagement and lets you recall your attacks.</li>' +
      '<li><b>Save</b>/<b>Load</b> work the same; the game autosaves periodically while live.</li>' +
      '</ul></div>';
    $('tab-rules').innerHTML = html;
  }

  /* ---------------- Event delegation ---------------- */

  let delegated = false;
  function wireDelegation() {
    if (delegated) return;
    delegated = true;
    $('side-panel').addEventListener('click', function (e) {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const action = t.getAttribute('data-action');
      const faction = ui.state.playerFaction;

      const isLive = ui.state.mode === 'live';

      if (action === 'arm-move') armUnit(t.dataset.unit, t.dataset.mode);
      else if (action === 'arm-support') armUnit(t.dataset.unit, 'support');
      else if (action === 'arm-move-multi') armUnits(selectedUnitIdsInCurrentRegion(), t.dataset.mode);
      else if (action === 'arm-support-multi') armUnits(selectedUnitIdsInCurrentRegion(), 'support');
      else if (action === 'arm-attack') armUnit(t.dataset.unit, 'attack');
      else if (action === 'arm-attack-multi') armUnits(selectedUnitIdsInCurrentRegion(), 'attack');
      else if (action === 'set-live-stance') {
        global.WWG.LiveEngine.setStance(ui.state, faction, [t.dataset.unit], t.dataset.stance, null);
        renderAll();
      } else if (action === 'set-live-stance-multi') {
        global.WWG.LiveEngine.setStance(ui.state, faction, selectedUnitIdsInCurrentRegion(), t.dataset.stance, null);
        ui.selectedUnits = {};
        renderAll();
      } else if (action === 'toggle-live-autodefend') {
        const lfs = ui.state.factions[faction]; lfs.liveAutoDefend = !lfs.liveAutoDefend; renderAll();
      } else if (action === 'toggle-unit') {
        if (ui.selectedUnits[t.dataset.unit]) delete ui.selectedUnits[t.dataset.unit];
        else ui.selectedUnits[t.dataset.unit] = true;
        renderAll();
      } else if (action === 'select-all-units') {
        global.WWG.State.unitsInRegion(ui.state, ui.state.selectedRegion, faction).forEach(function (u) {
          const eligible = isLive
            ? Data.UNIT_TYPES[u.type].category === 'ground'
            : (!global.WWG.TurnEngine.findMoveOrder(ui.state, faction, u.id) && !global.WWG.TurnEngine.findSupportOrder(ui.state, faction, u.id));
          if (eligible) ui.selectedUnits[u.id] = true;
        });
        renderAll();
      } else if (action === 'select-none-units') { ui.selectedUnits = {}; renderAll(); }
      else if (action === 'cancel-armed') { ui.armedUnit = null; renderAll(); }
      else if (action === 'cancel-order') { global.WWG.TurnEngine.removeOrder(ui.state, faction, t.dataset.unit); renderAll(); }
      else if (action === 'clear-orders') { global.WWG.TurnEngine.clearOrders(ui.state, faction); renderAll(); }
      else if (action === 'build') {
        const res = global.WWG.Economy.startBuild(ui.state, faction, t.dataset.unitType, t.dataset.region, 1);
        if (!res.ok) showToast(res.reason); else showToast('Build order placed.', 2000);
        renderAll();
      } else if (action === 'purchase-upgrade') {
        const res = global.WWG.Economy.purchaseUpgrade(ui.state, faction, t.dataset.upgrade);
        if (!res.ok) showToast(res.reason);
        renderAll();
      } else if (action === 'toggle-front') {
        const c = ui.state.factions[faction].commanders.front; c.enabled = !c.enabled; renderAll();
      } else if (action === 'toggle-economic') {
        const c = ui.state.factions[faction].commanders.economic; c.enabled = !c.enabled; renderAll();
      } else if (action === 'set-stance') {
        ui.state.factions[faction].commanders.front.stance = t.dataset.stance; renderAll();
      } else if (action === 'set-priority') {
        ui.state.factions[faction].commanders.economic.priority = t.dataset.priority; renderAll();
      }
    });
  }

  /* ---------------- Turn resolution / results ---------------- */

  function outcomeClass(o) { return o === 'attacker_win' ? 'win' : (o === 'attacker_repulsed' ? 'repulsed' : 'stalemate'); }
  function outcomeLabel(o) { return o === 'attacker_win' ? 'Captured' : (o === 'attacker_repulsed' ? 'Repulsed' : 'Stalemate'); }

  function showBattleReport(results) {
    $('battle-report-title').textContent = 'Turn ' + results.turn + ' Report — ' + results.dateLabel;
    let html = '';
    (results.battles || []).forEach(function (b) {
      const cls = outcomeClass(b.outcome);
      html += '<div class="battle-card ' + cls + '"><div class="bc-top">' +
        '<span>⚔ ' + global.WWG.State.factionLabel(b.attacker) + ' attack ' + esc(b.regionName) + ' (' + global.WWG.State.factionLabel(b.defender) + ')</span>' +
        '<span class="bc-outcome">' + outcomeLabel(b.outcome) + '</span></div>' +
        '<div class="bc-stats">Attack ' + b.attackPower.toFixed(1) + ' vs Defense ' + b.defensePower.toFixed(1) + ' (ratio ' + b.ratio.toFixed(2) + ') — ' +
        'losses: attacker −' + b.attackerLossPts.toFixed(0) + ' pts, defender −' + b.defenderLossPts.toFixed(0) + ' pts</div></div>';
    });
    (results.captures || []).filter(function (c) { return !c.contested; }).forEach(function (c) {
      html += '<div class="capture-card"><span>🏳 ' + global.WWG.State.factionLabel(c.to) + ' advance into undefended ' + esc(global.WWG.State.getRegion(c.regionId).name) + '</span></div>';
    });
    $('battle-report-body').innerHTML = html || '<p class="small">No engagements this turn.</p>';
    $('battle-report-modal').classList.remove('hidden');
  }

  function endTurn() {
    if (!ui.state || ui.state.gameOver) return;
    ui.armedUnit = null;
    ui.selectedUnits = {};
    const results = global.WWG.TurnEngine.resolveTurn(ui.state);
    ui.state.selectedRegion = null;
    ui.state.lastBattleRegions = (results.battles || []).map(function (b) {
      return { regionId: b.regionId, outcome: b.outcome, attacker: b.attacker, defender: b.defender };
    });
    global.WWG.Save.save(ui.state, global.WWG.Save.AUTOSAVE_SLOT, 'Autosave');
    renderAll();
    if ((results.battles && results.battles.length) || (results.captures && results.captures.length)) {
      showBattleReport(results);
    } else {
      showToast('Turn ' + results.turn + ' resolved: no engagements.', 3500);
      if (ui.state.gameOver) showVictoryBanner(ui.state.gameOver);
    }
  }

  function showVictoryBanner(go) {
    $('victory-title').textContent = (go.winner === ui.state.playerFaction ? 'VICTORY' : 'DEFEAT');
    $('victory-reason').textContent = go.reason;
    $('victory-banner').classList.remove('hidden');
  }

  /* ---------------- New game / save-load modals ---------------- */

  function buildDifficultyChoiceList() {
    const box = $('diff-choice');
    box.innerHTML = '';
    Object.keys(global.WWG.AI.DIFFICULTY_INFO).forEach(function (key, idx) {
      const info = global.WWG.AI.DIFFICULTY_INFO[key];
      const div = document.createElement('div');
      div.className = 'diff-item' + (idx === 1 ? ' selected' : '');
      div.dataset.difficulty = key;
      div.innerHTML = '<div class="name">' + info.label + '</div><div class="d">' + info.desc + '</div>';
      div.addEventListener('click', function () {
        box.querySelectorAll('.diff-item').forEach(function (x) { x.classList.remove('selected'); });
        div.classList.add('selected');
      });
      box.appendChild(div);
    });
  }

  /* ---------------- Live mode clock ---------------- */

  const LIVE_TICK_MS = 400;
  const LIVE_AUTOSAVE_EVERY_MS = 10000;

  function stopLiveLoop() {
    if (ui.liveIntervalId) { clearInterval(ui.liveIntervalId); ui.liveIntervalId = null; }
  }

  function startLiveLoop() {
    stopLiveLoop();
    let last = Date.now();
    let sinceSave = 0;
    ui.liveIntervalId = setInterval(function () {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      if (!ui.state || ui.state.mode !== 'live') { stopLiveLoop(); return; }
      global.WWG.LiveEngine.tick(ui.state, dt);
      renderAll();
      sinceSave += LIVE_TICK_MS;
      if (ui.state.gameOver) {
        stopLiveLoop();
        global.WWG.Save.save(ui.state, global.WWG.Save.AUTOSAVE_SLOT, 'Autosave');
        showVictoryBanner(ui.state.gameOver);
      } else if (sinceSave >= LIVE_AUTOSAVE_EVERY_MS) {
        sinceSave = 0;
        global.WWG.Save.save(ui.state, global.WWG.Save.AUTOSAVE_SLOT, 'Autosave');
      }
    }, LIVE_TICK_MS);
  }

  function startNewGame(faction, difficulty, mode) {
    stopLiveLoop();
    ui.state = mode === 'live' ? global.WWG.LiveEngine.createLiveState(faction, difficulty) : global.WWG.State.create(faction, difficulty);
    ui.armedUnit = null;
    ui.selectedUnits = {};
    ui.activeTab = 'region';
    if (!global.WWG._mapInitialized) {
      global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick });
      global.WWG._mapInitialized = true;
    }
    $('victory-banner').classList.add('hidden');
    if (mode === 'live') startLiveLoop();
    renderAll();
  }

  function openNewGameModal() {
    const auto = global.WWG.Save.load(global.WWG.Save.AUTOSAVE_SLOT);
    $('continue-row').classList.toggle('hidden', !auto);
    $('newgame-modal').classList.remove('hidden');
  }

  function renderSaveList() {
    const list = global.WWG.Save.list();
    const box = $('saveload-list');
    if (list.length === 0) { box.innerHTML = '<p class="small">No saved games yet.</p>'; return; }
    box.innerHTML = list.map(function (s) {
      return '<div class="save-item"><span>' + esc(s.label) + '</span>' +
        '<span><button data-save-load="' + s.slotId + '">Load</button> <button data-save-del="' + s.slotId + '" class="danger">✕</button></span></div>';
    }).join('');
    box.querySelectorAll('[data-save-load]').forEach(function (b) {
      b.addEventListener('click', function () {
        const st = global.WWG.Save.load(b.getAttribute('data-save-load'));
        if (st) {
          stopLiveLoop();
          ui.state = st; ui.armedUnit = null; ui.selectedUnits = {}; ui.activeTab = 'region';
          if (!global.WWG._mapInitialized) { global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick }); global.WWG._mapInitialized = true; }
          $('saveload-modal').classList.add('hidden');
          $('victory-banner').classList.add('hidden');
          if (st.mode === 'live') startLiveLoop();
          renderAll();
        }
      });
    });
    box.querySelectorAll('[data-save-del]').forEach(function (b) {
      b.addEventListener('click', function () { global.WWG.Save.remove(b.getAttribute('data-save-del')); renderSaveList(); });
    });
  }

  function initChrome() {
    buildDifficultyChoiceList();

    document.querySelectorAll('#faction-choice .choice-card').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('#faction-choice .choice-card').forEach(function (x) { x.classList.remove('selected'); });
        c.classList.add('selected');
      });
    });
    document.querySelectorAll('#mode-choice .choice-card').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('#mode-choice .choice-card').forEach(function (x) { x.classList.remove('selected'); });
        c.classList.add('selected');
      });
    });

    $('start-game-btn').addEventListener('click', function () {
      const faction = document.querySelector('#faction-choice .choice-card.selected').dataset.faction;
      const difficulty = document.querySelector('#diff-choice .diff-item.selected').dataset.difficulty;
      const mode = document.querySelector('#mode-choice .choice-card.selected').dataset.mode;
      startNewGame(faction, difficulty, mode);
      $('newgame-modal').classList.add('hidden');
    });

    $('continue-btn').addEventListener('click', function () {
      const st = global.WWG.Save.load(global.WWG.Save.AUTOSAVE_SLOT);
      if (st) {
        stopLiveLoop();
        ui.state = st; ui.armedUnit = null; ui.selectedUnits = {}; ui.activeTab = 'region';
        if (!global.WWG._mapInitialized) { global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick }); global.WWG._mapInitialized = true; }
        $('newgame-modal').classList.add('hidden');
        if (st.mode === 'live') startLiveLoop();
        renderAll();
      }
    });

    $('newgame-btn').addEventListener('click', function () {
      if (ui.state && !confirm('Start a new campaign? Your current game is auto-saved, but any unsaved manual save slot will remain untouched.')) return;
      openNewGameModal();
    });
    $('victory-newgame-btn').addEventListener('click', function () { $('victory-banner').classList.add('hidden'); openNewGameModal(); });

    $('save-btn').addEventListener('click', function () {
      if (!ui.state) return;
      const res = global.WWG.Save.save(ui.state, 'slot_' + Date.now());
      showToast(res.ok ? 'Game saved.' : res.reason, 2500);
    });
    $('load-btn').addEventListener('click', function () { renderSaveList(); $('saveload-modal').classList.remove('hidden'); });
    $('close-saveload-btn').addEventListener('click', function () { $('saveload-modal').classList.add('hidden'); });
    $('save-now-btn').addEventListener('click', function () {
      if (!ui.state) return;
      global.WWG.Save.save(ui.state, 'slot_' + Date.now());
      renderSaveList();
    });

    $('end-turn-btn').addEventListener('click', endTurn);
    $('live-pause-btn').addEventListener('click', function () {
      if (!ui.state) return;
      ui.state.paused = !ui.state.paused;
      renderAll();
    });
    document.querySelectorAll('#live-controls [data-speed]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!ui.state) return;
        ui.state.speed = Number(b.dataset.speed);
        renderAll();
      });
    });
    $('battle-report-close-btn').addEventListener('click', function () {
      $('battle-report-modal').classList.add('hidden');
      if (ui.state.gameOver) showVictoryBanner(ui.state.gameOver);
    });
    $('zoom-in').addEventListener('click', function () { global.WWG.MapRender.zoomIn(); });
    $('zoom-out').addEventListener('click', function () { global.WWG.MapRender.zoomOut(); });
    $('zoom-reset').addEventListener('click', function () { global.WWG.MapRender.resetView(); });

    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { ui.activeTab = b.dataset.tab; renderTabs(); });
    });

    $('map-legend').innerHTML =
      '<span><span class="legend-swatch" style="background:' + global.WWG.MapRender.FACTION_COLOR.allies + '"></span>Allies</span>' +
      '<span><span class="legend-swatch" style="background:' + global.WWG.MapRender.FACTION_COLOR.axis + '"></span>Axis</span>' +
      '<span class="legend-frontline"><span class="legend-front-swatch"></span>front line (glowing border)</span>' +
      '<span>⚠ = cut off from supply</span><span>⚓ = coastal/port</span><span>🚉 = rail hub</span><span>★ = capital</span>' +
      '<span>⚔ = battle last turn</span><span>🪖 ground · ✈️ air · 🚢 naval</span>';
  }

  global.WWG = global.WWG || {};
  global.WWG.UI = { initChrome: initChrome, openNewGameModal: openNewGameModal, showToast: showToast };
})(window);
