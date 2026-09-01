/* SVG region-graph map: pannable/zoomable, regions colored by controller,
   front line highlighted, supply/morale indicators, on top of a stylized
   physical map (coastline, sea, rivers, grid reference, compass). Pure
   rendering + input capture — decisions about what a click *means* are
   delegated to a callback the UI module installs (onRegionClick). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NODE_R = 46;
  const VB_W = 950, VB_H = 870;

  let svg, world, bgLayer, edgesLayer, regionsLayer, viewport;
  let view = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = null, viewStart = null, dragMoved = false;

  const FACTION_COLOR = { allies: '#3d74b0', axis: '#8c3232' };

  const TERRAIN_GLYPH = {
    plains: '', bocage: '🌿', forest: '🌲', urban: '🏙', river: '〰️', mountain: '⛰️', fortified: '🏰'
  };
  const CATEGORY_ICON = { ground: '🪖', air: '✈️', naval: '🚢' };

  // West/north coastline of the theatre, hand-fit around the region layout —
  // sea to the west/north, land (France/Benelux/Germany) filling the rest of
  // the viewBox to the east/south.
  const COASTLINE = 'M70,875 L65,700 L15,630 L85,560 L100,470 L25,400 L95,330 L170,290 ' +
    'L230,190 L290,110 L345,35 L410,85 L445,60 L480,130 L530,55 L610,95 L650,40 ' +
    'L950,10 L950,875 Z';

  const RHINE_PATH = 'M585,780 Q610,700 630,560 Q660,480 650,400 Q600,300 560,180 Q535,120 520,90';
  const SEINE_PATH = 'M370,540 Q340,500 320,470 Q280,430 270,400 Q230,360 220,330 Q195,300 170,270';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function hexPoints(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i);
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  function init(containerId, callbacks) {
    viewport = document.getElementById(containerId);
    viewport.innerHTML = '';
    svg = el('svg', { id: 'map-svg', viewBox: '0 0 ' + VB_W + ' ' + VB_H, preserveAspectRatio: 'xMidYMid meet' }, viewport);
    buildDefs();
    world = el('g', { id: 'map-world' }, svg);
    bgLayer = el('g', { 'class': 'bg-layer' }, world);
    edgesLayer = el('g', { 'class': 'edges-layer' }, world);
    regionsLayer = el('g', { 'class': 'regions-layer' }, world);

    renderBackground();

    callbacks = callbacks || {};
    svg.addEventListener('mousedown', function (e) {
      dragging = true; dragMoved = false;
      dragStart = { x: e.clientX, y: e.clientY };
      viewStart = { x: view.x, y: view.y };
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
      view.x = viewStart.x + dx / view.scale;
      view.y = viewStart.y + dy / view.scale;
      applyTransform();
    });
    window.addEventListener('mouseup', function () { dragging = false; });

    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(view.scale + delta);
    }, { passive: false });

    // touch support (basic single-finger pan + pinch)
    let touchStart = null, pinchStart = null;
    svg.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        viewStart = { x: view.x, y: view.y };
      } else if (e.touches.length === 2) {
        pinchStart = dist(e.touches[0], e.touches[1]);
      }
    }, { passive: true });
    svg.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1 && touchStart) {
        const dx = e.touches[0].clientX - touchStart.x, dy = e.touches[0].clientY - touchStart.y;
        view.x = viewStart.x + dx / view.scale;
        view.y = viewStart.y + dy / view.scale;
        applyTransform();
      } else if (e.touches.length === 2 && pinchStart) {
        const d = dist(e.touches[0], e.touches[1]);
        setZoom(view.scale * (d / pinchStart));
        pinchStart = d;
      }
    }, { passive: true });
    function dist(a, b) { return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }

    global.WWG._mapCallbacks = callbacks;
    resetView();
  }

  function applyTransform() {
    world.setAttribute('transform', 'translate(' + (view.x * view.scale) + ',' + (view.y * view.scale) + ') scale(' + view.scale + ')');
  }

  function setZoom(s) {
    view.scale = Math.max(0.5, Math.min(2.5, s));
    applyTransform();
  }

  function zoomIn() { setZoom(view.scale + 0.15); }
  function zoomOut() { setZoom(view.scale - 0.15); }
  function resetView() { view = { x: 0, y: 0, scale: 0.92 }; applyTransform(); }

  function moraleColor(m) {
    if (m >= 60) return '#4caf50';
    if (m >= 30) return '#e0b13d';
    return '#c94f4f';
  }

  /* ---------------- Static physical-map background (drawn once) ---------------- */

  function renderBackground() {
    // Open sea fill across the whole canvas, then the landmass on top.
    el('rect', { x: 0, y: 0, width: VB_W, height: VB_H, fill: 'url(#seaGrad)' }, bgLayer);

    // A little land hinted off in the sea to orient the invasion staging ground.
    const england = el('g', { opacity: 0.55 }, bgLayer);
    el('path', {
      d: 'M-40,40 L20,20 L60,55 L45,120 L-10,150 L-40,120 Z',
      fill: 'url(#landGrad)', stroke: '#2f4a3f', 'stroke-width': 2, opacity: 0.7
    }, england);
    el('text', {
      x: 10, y: 90, 'text-anchor': 'middle', 'class': 'map-caption', transform: 'rotate(-8 10 90)'
    }, england).textContent = 'ENGLAND';

    // Grid reference frame (thin lines + letter/number labels), like an ops-room map board.
    const grid = el('g', { 'class': 'grid-layer' }, bgLayer);
    const cols = 8, rows = 8, cw = VB_W / cols, rh = VB_H / rows;
    for (let i = 1; i < cols; i++) {
      el('line', { x1: i * cw, y1: 0, x2: i * cw, y2: VB_H, stroke: 'rgba(230,235,245,0.05)', 'stroke-width': 1 }, grid);
    }
    for (let i = 1; i < rows; i++) {
      el('line', { x1: 0, y1: i * rh, x2: VB_W, y2: i * rh, stroke: 'rgba(230,235,245,0.05)', 'stroke-width': 1 }, grid);
    }
    for (let i = 0; i < cols; i++) {
      el('text', { x: i * cw + cw / 2, y: 16, 'text-anchor': 'middle', 'class': 'grid-label' }, grid).textContent = String.fromCharCode(65 + i);
      el('text', { x: i * cw + cw / 2, y: VB_H - 6, 'text-anchor': 'middle', 'class': 'grid-label' }, grid).textContent = String.fromCharCode(65 + i);
    }
    for (let i = 0; i < rows; i++) {
      el('text', { x: 10, y: i * rh + rh / 2 + 4, 'text-anchor': 'middle', 'class': 'grid-label' }, grid).textContent = String(i + 1);
      el('text', { x: VB_W - 10, y: i * rh + rh / 2 + 4, 'text-anchor': 'middle', 'class': 'grid-label' }, grid).textContent = String(i + 1);
    }

    // Landmass with a soft coastline glow, then the two rivers over it.
    el('path', { d: COASTLINE, fill: 'url(#landGrad)' }, bgLayer);
    el('path', { d: COASTLINE, fill: 'none', stroke: '#8fd0c9', 'stroke-width': 3, opacity: 0.45 }, bgLayer);
    el('path', { d: COASTLINE, fill: 'none', stroke: '#3a5a52', 'stroke-width': 1.5, opacity: 0.8 }, bgLayer);

    const rivers = el('g', { 'class': 'rivers-layer' }, bgLayer);
    [RHINE_PATH, SEINE_PATH].forEach(function (d) {
      el('path', { d: d, fill: 'none', stroke: '#3f6f8f', 'stroke-width': 6, opacity: 0.35, 'stroke-linecap': 'round' }, rivers);
      el('path', { d: d, fill: 'none', stroke: '#7fb8d6', 'stroke-width': 2, opacity: 0.55, 'stroke-linecap': 'round' }, rivers);
    });
    el('text', { x: 555, y: 500, 'class': 'map-caption', 'text-anchor': 'middle', transform: 'rotate(78 555 500)' }, rivers).textContent = 'RHINE';
    el('text', { x: 265, y: 430, 'class': 'map-caption', 'text-anchor': 'middle', transform: 'rotate(55 265 430)' }, rivers).textContent = 'SEINE';

    // Compass rose, top-right free corner.
    const compass = el('g', { transform: 'translate(898,52)' }, bgLayer);
    el('circle', { r: 26, fill: 'rgba(20,22,28,0.55)', stroke: 'rgba(217,178,95,0.6)', 'stroke-width': 1.5 }, compass);
    el('path', { d: 'M0,-20 L6,0 L0,20 L-6,0 Z', fill: '#d9b25f' }, compass);
    el('path', { d: 'M-20,0 L0,-4 L20,0 L0,4 Z', fill: 'rgba(217,178,95,0.5)' }, compass);
    el('text', { y: -30, 'text-anchor': 'middle', 'class': 'compass-n' }, compass).textContent = 'N';

    // Scale bar, bottom-right.
    const scale = el('g', { transform: 'translate(790,845)' }, bgLayer);
    el('line', { x1: 0, y1: 0, x2: 100, y2: 0, stroke: '#c9c4b8', 'stroke-width': 2 }, scale);
    [0, 50, 100].forEach(function (x) { el('line', { x1: x, y1: -4, x2: x, y2: 4, stroke: '#c9c4b8', 'stroke-width': 2 }, scale); });
    el('text', { x: 50, y: -8, 'text-anchor': 'middle', 'class': 'map-caption' }, scale).textContent = '≈ 120 MI';
  }

  /* ---------------- Region nodes (redrawn on every render) ---------------- */

  function categoryOf(unitType) {
    return Data.UNIT_TYPES[unitType].category;
  }

  function render(state, reachableIds) {
    edgesLayer.innerHTML = '';
    regionsLayer.innerHTML = '';

    const drawn = {};
    Data.REGIONS.forEach(function (r) {
      r.neighbors.forEach(function (nId) {
        const key = edgeKey(r.id, nId);
        if (drawn[key]) return;
        drawn[key] = true;
        const n = Data.REGIONS_BY_ID[nId];
        const ownerA = state.regions[r.id].owner, ownerB = state.regions[nId].owner;
        const isFront = ownerA !== ownerB;
        el('line', {
          x1: r.x, y1: r.y, x2: n.x, y2: n.y,
          'class': isFront ? 'edge front-line' : 'edge',
          stroke: isFront ? '#e0703d' : 'rgba(20,22,28,0.55)',
          'stroke-width': isFront ? 4 : 2,
          'stroke-dasharray': isFront ? '8,5' : 'none'
        }, edgesLayer);
      });
    });

    const battleMap = {};
    (state.lastBattleRegions || []).forEach(function (b) { battleMap[b.regionId] = b; });

    Data.REGIONS.forEach(function (r) {
      const rs = state.regions[r.id];
      const g = el('g', { 'class': 'region-node', 'data-region': r.id, transform: 'translate(' + r.x + ',' + r.y + ')' }, regionsLayer);
      const terrain = Data.TERRAIN[r.terrain];
      const baseColor = FACTION_COLOR[rs.owner];

      if (rs.owner === state.playerFaction) g.classList.add('mine');

      if (reachableIds) {
        const isReachable = reachableIds.indexOf(r.id) !== -1;
        if (isReachable) {
          el('circle', { r: NODE_R + 7, fill: 'none', stroke: '#4caf50', 'stroke-width': 4, 'stroke-dasharray': '7,4', 'class': 'reachable-ring' }, g);
        } else {
          g.setAttribute('opacity', '0.45');
        }
      }

      el('polygon', { points: hexPoints(0, 0, NODE_R + 5), fill: 'rgba(6,7,10,0.35)' }, g);

      const hex = el('polygon', {
        points: hexPoints(0, 0, NODE_R),
        fill: baseColor, stroke: terrain.color, 'stroke-width': 4,
        'class': 'region-hex'
      }, g);

      if (state.selectedRegion === r.id) hex.setAttribute('stroke', '#ffd54a');
      if (!rs.supplied) {
        el('polygon', { points: hexPoints(0, 0, NODE_R), 'class': 'unsupplied-overlay', fill: 'url(#hatchPattern)' }, g);
        el('text', { y: -NODE_R - 10, 'text-anchor': 'middle', 'class': 'supply-flag' }, g).textContent = '⚠ CUT OFF';
      }

      if (r.capital) el('text', { x: NODE_R - 15, y: -NODE_R + 17, 'class': 'capital-star', 'text-anchor': 'middle' }, g).textContent = '★';
      if (r.coastal) el('text', { x: -NODE_R + 13, y: -NODE_R + 17, 'class': 'coastal-mark', 'text-anchor': 'middle' }, g).textContent = '⚓';
      if (r.railHub) el('text', { x: NODE_R - 15, y: NODE_R - 10, 'class': 'railhub-mark', 'text-anchor': 'middle' }, g).textContent = '🚉';

      const label = el('text', { y: -2, 'text-anchor': 'middle', 'class': 'region-label' }, g);
      label.textContent = r.name;

      const glyph = TERRAIN_GLYPH[r.terrain];
      if (glyph) {
        el('text', { y: 16, 'text-anchor': 'middle', 'class': 'terrain-glyph' }, g).textContent = glyph + ' ' + terrain.name;
      }

      // Unit presence: total badge (ringed by morale) just below the hex, plus a
      // ground/air/naval composition line beneath that.
      const units = global.WWG.State.unitsInRegion(state, r.id, rs.owner);
      if (units.length > 0) {
        const morale = global.WWG.Morale.regionMorale(state, r.id, rs.owner);
        el('circle', { cy: NODE_R + 16, r: 13, fill: '#1b1b22', stroke: moraleColor(morale), 'stroke-width': 3 }, g);
        el('text', { y: NODE_R + 21, 'text-anchor': 'middle', 'class': 'unit-count' }, g).textContent = units.length;

        const counts = { ground: 0, air: 0, naval: 0 };
        units.forEach(function (u) { counts[categoryOf(u.type)]++; });
        const parts = ['ground', 'air', 'naval'].filter(function (c) { return counts[c] > 0; })
          .map(function (c) { return CATEGORY_ICON[c] + counts[c]; });
        if (parts.length) {
          el('text', { y: NODE_R + 40, 'text-anchor': 'middle', 'class': 'unit-composition' }, g).textContent = parts.join('  ');
        }
      }

      // Battle marker from the most recently resolved turn.
      const battle = battleMap[r.id];
      if (battle) {
        const bx = -NODE_R + 2, by = -NODE_R - 2;
        const ringColor = battle.outcome === 'attacker_win' ? '#4caf50' : (battle.outcome === 'attacker_repulsed' ? '#c94f4f' : '#e0b13d');
        const bg2 = el('g', { transform: 'translate(' + bx + ',' + by + ')', 'class': 'battle-marker' }, g);
        el('circle', { r: 15, fill: '#1b1b22', stroke: ringColor, 'stroke-width': 3 }, bg2);
        el('text', { y: 6, 'text-anchor': 'middle', 'class': 'battle-glyph' }, bg2).textContent = '⚔';
      }

      g.addEventListener('click', function () {
        if (dragMoved) return; // was a pan, not a click
        if (global.WWG._mapCallbacks && global.WWG._mapCallbacks.onRegionClick) {
          global.WWG._mapCallbacks.onRegionClick(r.id);
        }
      });
    });
  }

  function buildDefs() {
    const defs = el('defs', {}, svg);

    const seaGrad = el('radialGradient', { id: 'seaGrad', cx: '30%', cy: '15%', r: '95%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#1c3a4d' }, seaGrad);
    el('stop', { offset: '55%', 'stop-color': '#132a3a' }, seaGrad);
    el('stop', { offset: '100%', 'stop-color': '#0d1f2c' }, seaGrad);

    const landGrad = el('linearGradient', { id: 'landGrad', x1: '0%', y1: '0%', x2: '100%', y2: '100%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#2f3b2c' }, landGrad);
    el('stop', { offset: '55%', 'stop-color': '#333d2e' }, landGrad);
    el('stop', { offset: '100%', 'stop-color': '#2a3527' }, landGrad);

    const pattern = el('pattern', { id: 'hatchPattern', width: 8, height: 8, patternTransform: 'rotate(45)', patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: 8, height: 8, fill: 'rgba(0,0,0,0.0)' }, pattern);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 3 }, pattern);
  }

  global.WWG = global.WWG || {};
  global.WWG.MapRender = {
    init: init, render: render,
    zoomIn: zoomIn, zoomOut: zoomOut, resetView: resetView,
    FACTION_COLOR: FACTION_COLOR
  };
})(window);
