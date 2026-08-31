/* localStorage persistence. No backend — every save lives entirely in the
   browser via localStorage, keyed by a slot id. */
(function (global) {
  'use strict';

  const PREFIX = 'wwg_save_';
  const AUTOSAVE_SLOT = 'autosave';

  function defaultLabel(state) {
    const State = global.WWG.State;
    return State.factionLabel(state.playerFaction) + ' vs AI(' + state.difficulty + ') — Turn ' + state.turn + ', ' + State.dateLabel(state);
  }

  function save(state, slotId, label) {
    const payload = { savedAt: Date.now(), label: label || defaultLabel(state), state: state };
    try {
      localStorage.setItem(PREFIX + slotId, JSON.stringify(payload));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'Could not save: ' + e.message };
    }
  }

  function load(slotId) {
    const raw = localStorage.getItem(PREFIX + slotId);
    if (!raw) return null;
    try { return JSON.parse(raw).state; } catch (e) { return null; }
  }

  function list() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.indexOf(PREFIX) === 0) {
        try {
          const payload = JSON.parse(localStorage.getItem(key));
          out.push({ slotId: key.slice(PREFIX.length), label: payload.label, savedAt: payload.savedAt, turn: payload.state.turn });
        } catch (e) { /* ignore corrupt entry */ }
      }
    }
    out.sort(function (a, b) { return b.savedAt - a.savedAt; });
    return out;
  }

  function remove(slotId) { localStorage.removeItem(PREFIX + slotId); }

  global.WWG = global.WWG || {};
  global.WWG.Save = { save: save, load: load, list: list, remove: remove, AUTOSAVE_SLOT: AUTOSAVE_SLOT };
})(window);
