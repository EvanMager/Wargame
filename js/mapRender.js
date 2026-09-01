/* SVG map: regions are fluid, contiguous areas (a Voronoi tessellation
   built from each region's center point and clipped to the coastline),
   colored by controller — so the front line is a real shared border
   between two areas, not just a connecting line. On top of a stylized
   physical map (coastline, sea, rivers, grid reference, compass). Pure
   rendering + input capture — decisions about what a click *means* are
   delegated to a callback the UI module installs (onRegionClick). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VB_W = 950, VB_H = 870;
  const ICON_R = 34; // decoration offset from each area's centroid

  let svg, world, bgLayer, connectorLayer, regionsLayer, frontLayer, viewport;
  let view = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = null, viewStart = null, dragMoved = false;

  const FACTION_COLOR = { allies: '#3d74b0', axis: '#8c3232' };

  const TERRAIN_GLYPH = {
    plains: '', bocage: '🌿', forest: '🌲', urban: '🏙', river: '〰️', mountain: '⛰️', fortified: '🏰'
  };
  const CATEGORY_ICON = { ground: '🪖', air: '✈️', naval: '🚢' };

  // West/north coastline of the theatre, hand-fit around the region layout —
  // sea to the west/north, land (France/Benelux/Germany) filling the rest of
  // the viewBox to the east/south. Doubles as the bounding shape every
  // region's tessellated area is clipped to, so coastal areas hug the coast.
  const COASTLINE_POINTS = [
    { x: 70, y: 875 }, { x: 65, y: 700 }, { x: 15, y: 630 }, { x: 85, y: 560 }, { x: 100, y: 470 },
    { x: 25, y: 400 }, { x: 95, y: 330 }, { x: 170, y: 290 }, { x: 230, y: 190 }, { x: 290, y: 110 },
    { x: 345, y: 35 }, { x: 410, y: 85 }, { x: 445, y: 60 }, { x: 480, y: 130 }, { x: 530, y: 55 },
    { x: 610, y: 95 }, { x: 650, y: 40 }, { x: 950, y: 10 }, { x: 950, y: 875 }
  ];
  const COASTLINE = 'M' + COASTLINE_POINTS.map(function (p) { return p.x + ',' + p.y; }).join(' L') + ' Z';

  const RHINE_PATH = 'M585,780 Q610,700 630,560 Q660,480 650,400 Q600,300 560,180 Q535,120 520,90';
  const SEINE_PATH = 'M370,540 Q340,500 320,470 Q280,430 270,400 Q230,360 220,330 Q195,300 170,270';

  // Computed once in init() and reused by every render(): each region's
  // clipped polygon, its centroid (decoration anchor), and — for every pair
  // of data-adjacent regions — either the exact shared border segment (if
  // their areas touch) or null (falls back to a thin connector line).
  let regionPolygons = {}, regionCentroids = {}, sharedEdges = {};

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  /* ---------------- Geometry: Voronoi-by-half-plane-clipping ---------------- */

  // Sutherland-Hodgman clip of `poly` to the half-plane {P : P·d <= c}.
  function clipHalfPlane(poly, d, c) {
    const out = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const cur = poly[i], prev = poly[(i - 1 + n) % n];
      const curVal = cur.x * d.x + cur.y * d.y, prevVal = prev.x * d.x + prev.y * d.y;
      const curIn = curVal <= c, prevIn = prevVal <= c;
      if (curIn !== prevIn) {
        const t = (c - prevVal) / (curVal - prevVal);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      if (curIn) out.push(cur);
    }
    return out;
  }

  function bisector(a, b) {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const c = (b.x * b.x + b.y * b.y - (a.x * a.x + a.y * a.y)) / 2;
    return { d: d, c: c };
  }

  function computeVoronoiCell(site, allSites) {
    let poly = COASTLINE_POINTS;
    allSites.forEach(function (other) {
      if (other === site) return;
      const bi = bisector(site, other);
      poly = clipHalfPlane(poly, bi.d, bi.c);
    });
    return poly;
  }

  function polygonCentroid(poly) {
    let x = 0, y = 0, a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
      const cross = p0.x * p1.y - p1.x * p0.y;
      a += cross; x += (p0.x + p1.x) * cross; y += (p0.y + p1.y) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) {
      let sx = 0, sy = 0;
      poly.forEach(function (p) { sx += p.x; sy += p.y; });
      return { x: sx / poly.length, y: sy / poly.length };
    }
    return { x: x / (6 * a), y: y / (6 * a) };
  }

  // Finds the polygon edge of region `r`'s cell that lies exactly on its
  // bisector with neighbor `n` — that edge IS the shared border. Returns
  // null if the two areas don't geometrically touch (rare, given the layout).
  function findSharedEdge(poly, siteA, siteB) {
    const bi = bisector(siteA, siteB);
    const eps = 0.75;
    const onLine = function (p) { return Math.abs(p.x * bi.d.x + p.y * bi.d.y - bi.c) < eps; };
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
      if (onLine(p0) && onLine(p1) && (Math.abs(p0.x - p1.x) > 0.5 || Math.abs(p0.y - p1.y) > 0.5)) {
        return { a: p0, b: p1 };
      }
    }
    return null;
  }

  function buildGeometry() {
    const sites = Data.REGIONS;
    regionPolygons = {}; regionCentroids = {}; sharedEdges = {};
    sites.forEach(function (r) {
      const poly = computeVoronoiCell(r, sites);
      regionPolygons[r.id] = poly;
      regionCentroids[r.id] = poly.length >= 3 ? polygonCentroid(poly) : { x: r.x, y: r.y };
    });
    const doneKey = {};
    sites.forEach(function (r) {
      r.neighbors.forEach(function (nId) {
        const key = edgeKey(r.id, nId);
        if (doneKey[key]) return;
        doneKey[key] = true;
        const n = Data.REGIONS_BY_ID[nId];
        const edge = findSharedEdge(regionPolygons[r.id], r, n);
        sharedEdges[key] = edge; // may be null -> fallback connector
      });
    });
  }

  function init(containerId, callbacks) {
    viewport = document.getElementById(containerId);
    viewport.innerHTML = '';
    svg = el('svg', { id: 'map-svg', viewBox: '0 0 ' + VB_W + ' ' + VB_H, preserveAspectRatio: 'xMidYMid meet' }, viewport);
    buildDefs();
    world = el('g', { id: 'map-world' }, svg);
    bgLayer = el('g', { 'class': 'bg-layer' }, world);
    connectorLayer = el('g', { 'class': 'connector-layer' }, world);
    regionsLayer = el('g', { 'class': 'regions-layer' }, world);
    frontLayer = el('g', { 'class': 'front-layer' }, world);

    buildGeometry();
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

  function pts(poly) { return poly.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '); }

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

  /* ---------------- Region areas + front line (redrawn on every render) ---------------- */

  function categoryOf(unitType) {
    return Data.UNIT_TYPES[unitType].category;
  }

  function render(state, reachableIds) {
    connectorLayer.innerHTML = '';
    regionsLayer.innerHTML = '';
    frontLayer.innerHTML = '';

    const battleMap = {};
    (state.lastBattleRegions || []).forEach(function (b) { battleMap[b.regionId] = b; });

    // Pass 1: fallback connectors for any data-adjacent pair whose areas
    // don't happen to geometrically touch (kept subtle; bright if contested).
    const doneKey = {};
    Data.REGIONS.forEach(function (r) {
      r.neighbors.forEach(function (nId) {
        const key = edgeKey(r.id, nId);
        if (doneKey[key]) return;
        doneKey[key] = true;
        if (sharedEdges[key]) return; // real border exists, drawn in pass 3
        const n = Data.REGIONS_BY_ID[nId];
        const isFront = state.regions[r.id].owner !== state.regions[nId].owner;
        el('line', {
          x1: r.x, y1: r.y, x2: n.x, y2: n.y,
          stroke: isFront ? '#e0703d' : 'rgba(180,190,205,0.18)',
          'stroke-width': isFront ? 3 : 1.5,
          'stroke-dasharray': isFront ? '7,4' : '3,4'
        }, connectorLayer);
      });
    });

    // Pass 2: the areas themselves.
    Data.REGIONS.forEach(function (r) {
      const rs = state.regions[r.id];
      const poly = regionPolygons[r.id];
      if (!poly || poly.length < 3) return;
      const centroid = regionCentroids[r.id];
      const terrain = Data.TERRAIN[r.terrain];
      const baseColor = FACTION_COLOR[rs.owner];

      const g = el('g', { 'class': 'region-node', 'data-region': r.id }, regionsLayer);
      if (rs.owner === state.playerFaction) g.classList.add('mine');

      const area = el('polygon', {
        points: pts(poly), fill: baseColor, stroke: terrain.color, 'stroke-width': 2,
        'class': 'region-area'
      }, g);

      if (reachableIds) {
        if (reachableIds.indexOf(r.id) !== -1) {
          el('polygon', { points: pts(poly), fill: 'none', stroke: '#4caf50', 'stroke-width': 4, 'stroke-dasharray': '9,5', 'class': 'reachable-ring' }, g);
        } else {
          g.setAttribute('opacity', '0.4');
        }
      }
      if (state.selectedRegion === r.id) {
        el('polygon', { points: pts(poly), fill: 'none', stroke: '#ffd54a', 'stroke-width': 3.5, 'class': 'selected-ring' }, g);
      }
      if (!rs.supplied) {
        el('polygon', { points: pts(poly), 'class': 'unsupplied-overlay', fill: 'url(#hatchPattern)' }, g);
      }

      // Decorations anchored at the area's centroid so they stay put regardless of the cell's shape.
      const decor = el('g', { transform: 'translate(' + centroid.x.toFixed(1) + ',' + centroid.y.toFixed(1) + ')', 'pointer-events': 'none' }, g);

      if (!rs.supplied) el('text', { y: -ICON_R - 12, 'text-anchor': 'middle', 'class': 'supply-flag' }, decor).textContent = '⚠ CUT OFF';
      if (r.capital) el('text', { x: ICON_R - 8, y: -ICON_R + 2, 'class': 'capital-star', 'text-anchor': 'middle' }, decor).textContent = '★';
      if (r.coastal) el('text', { x: -ICON_R + 6, y: -ICON_R + 2, 'class': 'coastal-mark', 'text-anchor': 'middle' }, decor).textContent = '⚓';
      if (r.railHub) el('text', { x: ICON_R - 6, y: ICON_R - 6, 'class': 'railhub-mark', 'text-anchor': 'middle' }, decor).textContent = '🚉';

      el('text', { y: -2, 'text-anchor': 'middle', 'class': 'region-label' }, decor).textContent = r.name;

      const glyph = TERRAIN_GLYPH[r.terrain];
      if (glyph) el('text', { y: 14, 'text-anchor': 'middle', 'class': 'terrain-glyph' }, decor).textContent = glyph + ' ' + terrain.name;

      const units = global.WWG.State.unitsInRegion(state, r.id, rs.owner);
      if (units.length > 0) {
        const morale = global.WWG.Morale.regionMorale(state, r.id, rs.owner);
        el('circle', { cy: 34, r: 13, fill: '#1b1b22', stroke: moraleColor(morale), 'stroke-width': 3 }, decor);
        el('text', { y: 39, 'text-anchor': 'middle', 'class': 'unit-count' }, decor).textContent = units.length;

        const counts = { ground: 0, air: 0, naval: 0 };
        units.forEach(function (u) { counts[categoryOf(u.type)]++; });
        const parts = ['ground', 'air', 'naval'].filter(function (c) { return counts[c] > 0; })
          .map(function (c) { return CATEGORY_ICON[c] + counts[c]; });
        if (parts.length) el('text', { y: 56, 'text-anchor': 'middle', 'class': 'unit-composition' }, decor).textContent = parts.join('  ');
      }

      const battle = battleMap[r.id];
      if (battle) {
        const ringColor = battle.outcome === 'attacker_win' ? '#4caf50' : (battle.outcome === 'attacker_repulsed' ? '#c94f4f' : '#e0b13d');
        const bmark = el('g', { transform: 'translate(' + (-ICON_R + 2) + ',' + (-ICON_R - 14) + ')', 'class': 'battle-marker' }, decor);
        el('circle', { r: 15, fill: '#1b1b22', stroke: ringColor, 'stroke-width': 3 }, bmark);
        el('text', { y: 6, 'text-anchor': 'middle', 'class': 'battle-glyph' }, bmark).textContent = '⚔';
      }

      area.addEventListener('click', function () {
        if (dragMoved) return; // was a pan, not a click
        if (global.WWG._mapCallbacks && global.WWG._mapCallbacks.onRegionClick) {
          global.WWG._mapCallbacks.onRegionClick(r.id);
        }
      });
    });

    // Pass 3: the front line itself — the real shared border between two areas
    // held by different factions, drawn bold with a soft glow so it reads at a glance.
    Object.keys(sharedEdges).forEach(function (key) {
      const edge = sharedEdges[key];
      if (!edge) return;
      const ids = key.split('|');
      if (state.regions[ids[0]].owner === state.regions[ids[1]].owner) return;
      el('line', { x1: edge.a.x, y1: edge.a.y, x2: edge.b.x, y2: edge.b.y, 'class': 'front-line-glow' }, frontLayer);
      el('line', { x1: edge.a.x, y1: edge.a.y, x2: edge.b.x, y2: edge.b.y, 'class': 'front-line-edge' }, frontLayer);
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
