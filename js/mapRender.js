/* SVG region-graph map: pannable/zoomable, regions colored by controller,
   front line highlighted, supply/morale indicators. Pure rendering + input
   capture — decisions about what a click *means* are delegated to a
   callback the UI module installs (onRegionClick). */
(function (global) {
  'use strict';

  const Data = global.WWG.Data;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NODE_R = 46;

  let svg, world, edgesLayer, regionsLayer, viewport;
  let view = { x: 0, y: 0, scale: 1 };
  let dragging = false, dragStart = null, viewStart = null, dragMoved = false;

  const FACTION_COLOR = { allies: '#3d74b0', axis: '#8c3232' };
  const FACTION_COLOR_DIM = { allies: '#274a70', axis: '#5c2020' };

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
    svg = el('svg', { id: 'map-svg', viewBox: '0 0 950 870', preserveAspectRatio: 'xMidYMid meet' }, viewport);
    world = el('g', { id: 'map-world' }, svg);
    edgesLayer = el('g', { 'class': 'edges-layer' }, world);
    regionsLayer = el('g', { 'class': 'regions-layer' }, world);

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
          stroke: isFront ? '#e0703d' : '#5a5a66',
          'stroke-width': isFront ? 4 : 2,
          'stroke-dasharray': isFront ? '8,5' : 'none'
        }, edgesLayer);
      });
    });

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

      if (r.capital) el('text', { x: NODE_R - 14, y: -NODE_R + 16, 'class': 'capital-star', 'text-anchor': 'middle' }, g).textContent = '★';
      if (r.coastal) el('text', { x: -NODE_R + 12, y: -NODE_R + 16, 'class': 'coastal-mark', 'text-anchor': 'middle' }, g).textContent = '⚓';

      const label = el('text', { y: 4, 'text-anchor': 'middle', 'class': 'region-label' }, g);
      label.textContent = r.name;

      const units = global.WWG.State.unitsInRegion(state, r.id, rs.owner);
      if (units.length > 0) {
        const morale = global.WWG.Morale.regionMorale(state, r.id, rs.owner);
        el('circle', { cy: NODE_R - 10, r: 13, fill: '#1b1b22', stroke: moraleColor(morale), 'stroke-width': 3 }, g);
        el('text', { y: NODE_R - 5, 'text-anchor': 'middle', 'class': 'unit-count' }, g).textContent = units.length;
      }

      g.addEventListener('click', function () {
        if (dragMoved) return; // was a pan, not a click
        if (global.WWG._mapCallbacks && global.WWG._mapCallbacks.onRegionClick) {
          global.WWG._mapCallbacks.onRegionClick(r.id);
        }
      });
    });

    ensureDefs();
  }

  function ensureDefs() {
    if (svg.querySelector('#hatchPattern')) return;
    const defs = el('defs', {}, svg);
    const pattern = el('pattern', { id: 'hatchPattern', width: 8, height: 8, patternTransform: 'rotate(45)', patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: 8, height: 8, fill: 'rgba(0,0,0,0.0)' }, pattern);
    el('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: 'rgba(255,255,255,0.35)', 'stroke-width': 3 }, pattern);
    svg.insertBefore(defs, svg.firstChild);
  }

  global.WWG = global.WWG || {};
  global.WWG.MapRender = {
    init: init, render: render,
    zoomIn: zoomIn, zoomOut: zoomOut, resetView: resetView,
    FACTION_COLOR: FACTION_COLOR
  };
})(window);
