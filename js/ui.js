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

  const ui = { state: null, activeTab: 'region', armedUnit: null };

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

  function armUnit(unitId, mode) {
    ui.armedUnit = { unitId: unitId, mode: mode };
    renderAll();
  }

  function reachableForArmed() {
    if (!ui.armedUnit) return null;
    const u = ui.state.units[ui.armedUnit.unitId];
    if (!u) return null;
    if (ui.armedUnit.mode === 'support') return global.WWG.Movement.supportOptions(ui.state, u);
    const opts = global.WWG.Movement.moveOptions(ui.state, u);
    if (ui.armedUnit.mode === 'paradrop') return opts.paradrop;
    if (ui.armedUnit.mode === 'transport') return opts.transport;
    return opts.adjacent;
  }

  function handleRegionClick(regionId) {
    if (ui.armedUnit) {
      const faction = ui.state.playerFaction;
      const res = ui.armedUnit.mode === 'support'
        ? global.WWG.TurnEngine.addSupportOrder(ui.state, faction, ui.armedUnit.unitId, regionId)
        : global.WWG.TurnEngine.addMoveOrder(ui.state, faction, ui.armedUnit.unitId, regionId, ui.armedUnit.mode);
      ui.armedUnit = null;
      if (!res.ok) showToast(res.reason);
      renderAll();
      return;
    }
    ui.state.selectedRegion = regionId;
    ui.activeTab = 'region';
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
    $('turn-info').innerHTML = 'Turn <b>' + state.turn + '</b> — ' + global.WWG.State.dateLabel(state) +
      ' &nbsp;|&nbsp; You: <b class="pill ' + state.playerFaction + '">' + global.WWG.State.factionLabel(state.playerFaction) + '</b>' +
      ' vs AI (<b>' + diff.label + '</b>)';

    $('end-turn-btn').disabled = !!state.gameOver;
  }

  function renderTabs() {
    ['region', 'orders', 'commanders', 'upgrades', 'log'].forEach(function (t) {
      $('tab-' + t).classList.toggle('hidden', ui.activeTab !== t);
    });
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === ui.activeTab);
    });
    if (ui.activeTab === 'region') renderRegionTab();
    else if (ui.activeTab === 'orders') renderOrdersTab();
    else if (ui.activeTab === 'commanders') renderCommandersTab();
    else if (ui.activeTab === 'upgrades') renderUpgradesTab();
    else if (ui.activeTab === 'log') renderLogTab();
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
    const def = Data.UNIT_TYPES[u.type];
    const opts = global.WWG.Movement.moveOptions(state, u);
    let html = '';
    const armed = ui.armedUnit && ui.armedUnit.unitId === u.id;
    if (opts.adjacent.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="adjacent" class="' + (armed && ui.armedUnit.mode === 'adjacent' ? 'active' : '') + '">Move</button>';
    if (opts.paradrop.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="paradrop" class="' + (armed && ui.armedUnit.mode === 'paradrop' ? 'active' : '') + '">Drop</button>';
    if (opts.transport.length > 0) html += '<button data-action="arm-move" data-unit="' + u.id + '" data-mode="transport" class="' + (armed && ui.armedUnit.mode === 'transport' ? 'active' : '') + '">Ship</button>';
    if (def.supportBonus || def.role === 'air_superiority') html += '<button data-action="arm-support" data-unit="' + u.id + '" class="' + (armed && ui.armedUnit.mode === 'support' ? 'active' : '') + '">Support</button>';
    return html;
  }

  function unitRowHtml(state, u) {
    const def = Data.UNIT_TYPES[u.type];
    return '<div class="unit-row"><span class="u-icon">' + (UNIT_ICON[u.type] || '?') + '</span>' +
      '<span class="u-name">' + def.name + '</span>' +
      '<span class="u-str">' + Math.round(u.strength) + '%</span>' +
      '<div class="strength-bar"><div style="width:' + Math.max(0, Math.round(u.strength)) + '%"></div></div>' +
      unitActionButtons(state, u) + '</div>';
  }

  function renderRegionTab() {
    const state = ui.state;
    const rid = state.selectedRegion;
    const container = $('tab-region');

    if (ui.armedUnit) {
      const u = state.units[ui.armedUnit.unitId];
      container.innerHTML = '<div class="card"><h4>Choose a Destination</h4>' +
        '<p class="small">' + (u ? Data.UNIT_TYPES[u.type].name : 'Unit') + ' — click a highlighted region on the map (' + ui.armedUnit.mode + ').</p>' +
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

    const units = global.WWG.State.unitsInRegion(state, rid);
    html += '<div class="card"><h4>Units (' + units.length + ')</h4>';
    if (units.length === 0) html += '<p class="small">No units present — an undefended region.</p>';
    else units.forEach(function (u) { html += unitRowHtml(state, u); });
    html += '</div>';

    if (isMine) {
      html += renderBuildSection(state, rid);
      html += renderQueueSection(state, rid);
    }

    container.innerHTML = html;
    wireDelegation();
  }

  function renderBuildSection(state, rid) {
    const faction = state.playerFaction;
    const fs = state.factions[faction];
    const rd = global.WWG.State.getRegion(rid);
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
    html += '<p class="small">New units arrive at the start of next turn.</p></div>';
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

      if (action === 'arm-move') armUnit(t.dataset.unit, t.dataset.mode);
      else if (action === 'arm-support') armUnit(t.dataset.unit, 'support');
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

  function summarizeResults(results) {
    if (!results) return '';
    const captured = results.captures.length;
    const battles = results.battles.length;
    let msg = 'Turn ' + results.turn + ' resolved: ' + battles + ' battle' + (battles === 1 ? '' : 's') +
      ', ' + captured + ' region' + (captured === 1 ? '' : 's') + ' changed hands.';
    return msg;
  }

  function endTurn() {
    if (!ui.state || ui.state.gameOver) return;
    ui.armedUnit = null;
    const results = global.WWG.TurnEngine.resolveTurn(ui.state);
    ui.state.selectedRegion = null;
    showToast(summarizeResults(results), 6000);
    global.WWG.Save.save(ui.state, global.WWG.Save.AUTOSAVE_SLOT, 'Autosave');
    renderAll();
    if (ui.state.gameOver) showVictoryBanner(ui.state.gameOver);
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

  function startNewGame(faction, difficulty) {
    ui.state = global.WWG.State.create(faction, difficulty);
    ui.armedUnit = null;
    ui.activeTab = 'region';
    if (!global.WWG._mapInitialized) {
      global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick });
      global.WWG._mapInitialized = true;
    }
    $('victory-banner').classList.add('hidden');
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
          ui.state = st; ui.armedUnit = null; ui.activeTab = 'region';
          if (!global.WWG._mapInitialized) { global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick }); global.WWG._mapInitialized = true; }
          $('saveload-modal').classList.add('hidden');
          $('victory-banner').classList.add('hidden');
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

    $('start-game-btn').addEventListener('click', function () {
      const faction = document.querySelector('#faction-choice .choice-card.selected').dataset.faction;
      const difficulty = document.querySelector('#diff-choice .diff-item.selected').dataset.difficulty;
      startNewGame(faction, difficulty);
      $('newgame-modal').classList.add('hidden');
    });

    $('continue-btn').addEventListener('click', function () {
      const st = global.WWG.Save.load(global.WWG.Save.AUTOSAVE_SLOT);
      if (st) {
        ui.state = st; ui.armedUnit = null; ui.activeTab = 'region';
        if (!global.WWG._mapInitialized) { global.WWG.MapRender.init('map-viewport', { onRegionClick: handleRegionClick }); global.WWG._mapInitialized = true; }
        $('newgame-modal').classList.add('hidden');
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
    $('zoom-in').addEventListener('click', function () { global.WWG.MapRender.zoomIn(); });
    $('zoom-out').addEventListener('click', function () { global.WWG.MapRender.zoomOut(); });
    $('zoom-reset').addEventListener('click', function () { global.WWG.MapRender.resetView(); });

    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.addEventListener('click', function () { ui.activeTab = b.dataset.tab; renderTabs(); });
    });

    $('map-legend').innerHTML =
      '<span><span class="legend-swatch" style="background:' + global.WWG.MapRender.FACTION_COLOR.allies + '"></span>Allies</span>' +
      '<span><span class="legend-swatch" style="background:' + global.WWG.MapRender.FACTION_COLOR.axis + '"></span>Axis</span>' +
      '<span>⚠ = cut off from supply</span><span>⚓ = coastal/port</span><span>🚉 = rail hub</span><span>★ = capital</span>' +
      '<span style="color:#e0703d;">┅┅</span><span>front line</span>';
  }

  global.WWG = global.WWG || {};
  global.WWG.UI = { initChrome: initChrome, openNewGameModal: openNewGameModal, showToast: showToast };
})(window);
