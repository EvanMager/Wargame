/* The Western Front map: 21 named historical regions from Normandy to Berlin.
   Adjacency is an explicit graph (Risk-style), not derived from the x/y layout.
   x/y are node centers for the SVG graph-map (see mapRender.js). */
(function (global) {
  'use strict';

  const REGIONS = [
    { id: 'cotentin', name: 'Cotentin (Cherbourg)', terrain: 'bocage', coastal: true, railHub: false,
      resources: { manpower: 2, production: 2, fuel: 1 },
      neighbors: ['caen_sector', 'normandy_interior'],
      x: 140, y: 382, startOwner: 'allies' },

    { id: 'brittany', name: 'Brittany', terrain: 'plains', coastal: true, railHub: false,
      resources: { manpower: 4, production: 1, fuel: 1 },
      neighbors: ['normandy_interior', 'loire_valley'],
      x: 140, y: 625, startOwner: 'axis' },

    { id: 'caen_sector', name: 'Caen Sector', terrain: 'plains', coastal: true, railHub: false,
      resources: { manpower: 2, production: 2, fuel: 1 },
      neighbors: ['cotentin', 'normandy_interior', 'pas_de_calais'],
      x: 245, y: 322, startOwner: 'allies' },

    { id: 'normandy_interior', name: 'Normandy (Bocage)', terrain: 'bocage', coastal: false, railHub: false,
      resources: { manpower: 4, production: 2, fuel: 0 },
      neighbors: ['cotentin', 'brittany', 'caen_sector', 'loire_valley', 'paris_region'],
      x: 245, y: 564, startOwner: 'axis' },

    { id: 'loire_valley', name: 'Loire Valley', terrain: 'plains', coastal: false, railHub: false,
      resources: { manpower: 5, production: 2, fuel: 0 },
      neighbors: ['brittany', 'normandy_interior', 'paris_region', 'lorraine'],
      x: 245, y: 806, startOwner: 'axis' },

    { id: 'pas_de_calais', name: 'Pas-de-Calais', terrain: 'plains', coastal: true, railHub: false,
      resources: { manpower: 2, production: 3, fuel: 2 },
      neighbors: ['caen_sector', 'paris_region', 'belgium'],
      x: 350, y: 140, startOwner: 'axis' },

    { id: 'paris_region', name: 'Paris Region', terrain: 'urban', coastal: false, railHub: true,
      resources: { manpower: 4, production: 7, fuel: 1 },
      neighbors: ['normandy_interior', 'loire_valley', 'pas_de_calais', 'ardennes', 'lorraine'],
      x: 350, y: 503, startOwner: 'axis' },

    { id: 'belgium', name: 'Belgium (Antwerp)', terrain: 'plains', coastal: true, railHub: false,
      resources: { manpower: 3, production: 5, fuel: 2 },
      neighbors: ['pas_de_calais', 'ardennes', 'netherlands', 'aachen'],
      x: 455, y: 200, startOwner: 'axis' },

    { id: 'ardennes', name: 'Ardennes', terrain: 'forest', coastal: false, railHub: false,
      resources: { manpower: 2, production: 1, fuel: 0 },
      neighbors: ['paris_region', 'belgium', 'lorraine', 'aachen', 'saar'],
      x: 455, y: 443, startOwner: 'axis' },

    { id: 'lorraine', name: 'Lorraine', terrain: 'plains', coastal: false, railHub: false,
      resources: { manpower: 3, production: 4, fuel: 1 },
      neighbors: ['loire_valley', 'paris_region', 'ardennes', 'saar', 'alsace'],
      x: 455, y: 685, startOwner: 'axis' },

    { id: 'netherlands', name: 'Netherlands', terrain: 'river', coastal: true, railHub: false,
      resources: { manpower: 3, production: 3, fuel: 2 },
      neighbors: ['belgium', 'aachen', 'rhineland'],
      x: 560, y: 140, startOwner: 'axis' },

    { id: 'aachen', name: 'Aachen', terrain: 'fortified', coastal: false, railHub: false,
      resources: { manpower: 2, production: 3, fuel: 1 },
      neighbors: ['belgium', 'ardennes', 'netherlands', 'cologne', 'ruhr'],
      x: 560, y: 261, startOwner: 'axis' },

    { id: 'saar', name: 'Saar', terrain: 'forest', coastal: false, railHub: false,
      resources: { manpower: 2, production: 5, fuel: 1 },
      neighbors: ['ardennes', 'lorraine', 'alsace', 'rhineland', 'frankfurt_hesse'],
      x: 560, y: 503, startOwner: 'axis' },

    { id: 'alsace', name: 'Alsace', terrain: 'plains', coastal: false, railHub: false,
      resources: { manpower: 2, production: 3, fuel: 1 },
      neighbors: ['lorraine', 'saar', 'frankfurt_hesse'],
      x: 560, y: 746, startOwner: 'axis' },

    { id: 'ruhr', name: 'Ruhr', terrain: 'urban', coastal: false, railHub: true,
      resources: { manpower: 4, production: 9, fuel: 2 },
      neighbors: ['aachen', 'cologne', 'rhineland', 'central_germany'],
      x: 665, y: 321, startOwner: 'axis' },

    { id: 'cologne', name: 'Cologne', terrain: 'river', coastal: false, railHub: true,
      resources: { manpower: 3, production: 5, fuel: 1 },
      neighbors: ['aachen', 'ruhr', 'rhineland', 'central_germany'],
      x: 665, y: 443, startOwner: 'axis' },

    { id: 'rhineland', name: 'Rhineland', terrain: 'river', coastal: false, railHub: false,
      resources: { manpower: 3, production: 4, fuel: 2 },
      neighbors: ['netherlands', 'ruhr', 'cologne', 'saar', 'frankfurt_hesse'],
      x: 665, y: 564, startOwner: 'axis' },

    { id: 'frankfurt_hesse', name: 'Frankfurt-Hesse', terrain: 'plains', coastal: false, railHub: false,
      resources: { manpower: 3, production: 4, fuel: 2 },
      neighbors: ['saar', 'alsace', 'rhineland', 'central_germany', 'bavaria'],
      x: 665, y: 685, startOwner: 'axis' },

    { id: 'central_germany', name: 'Central Germany', terrain: 'plains', coastal: false, railHub: true,
      resources: { manpower: 5, production: 5, fuel: 1 },
      neighbors: ['ruhr', 'cologne', 'frankfurt_hesse', 'bavaria', 'berlin'],
      x: 770, y: 382, startOwner: 'axis' },

    { id: 'bavaria', name: 'Bavaria', terrain: 'mountain', coastal: false, railHub: false,
      resources: { manpower: 4, production: 3, fuel: 1 },
      neighbors: ['frankfurt_hesse', 'central_germany'],
      x: 770, y: 625, startOwner: 'axis' },

    { id: 'berlin', name: 'Berlin', terrain: 'fortified', coastal: false, railHub: true,
      resources: { manpower: 4, production: 6, fuel: 2 },
      neighbors: ['central_germany'],
      x: 875, y: 443, startOwner: 'axis', capital: 'axis' }
  ];

  // sanity: build lookup + validate symmetric adjacency at load time (helps catch data typos)
  const byId = {};
  REGIONS.forEach(function (r) { byId[r.id] = r; });
  REGIONS.forEach(function (r) {
    r.neighbors.forEach(function (nId) {
      const n = byId[nId];
      if (!n) { console.error('Region data error: ' + r.id + ' lists unknown neighbor ' + nId); return; }
      if (n.neighbors.indexOf(r.id) === -1) {
        console.error('Region data error: adjacency not symmetric between ' + r.id + ' and ' + nId);
      }
    });
  });

  global.WWG = global.WWG || {};
  global.WWG.Data = global.WWG.Data || {};
  global.WWG.Data.REGIONS = REGIONS;
  global.WWG.Data.REGIONS_BY_ID = byId;
})(window);
