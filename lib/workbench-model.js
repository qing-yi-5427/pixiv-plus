// PixivPlus - Workbench data model

(() => {
  'use strict';

  function extractWorkId(href) {
    if (typeof href !== 'string') return null;
    return href.match(/\/artworks\/(\d+)/)?.[1] || null;
  }

  function normalizeRecord(record) {
    const id = String(record?.id || '');
    if (!/^\d+$/.test(id)) return null;
    return {
      id,
      title: String(record.title || ''),
      artist: String(record.artist || ''),
      thumbUrl: String(record.thumbUrl || ''),
      pageCount: Math.max(1, Number.parseInt(record.pageCount, 10) || 1),
      isUgoira: Boolean(record.isUgoira),
      loaded: Boolean(record.loaded)
    };
  }

  function createStore() {
    const records = new Map();
    const order = [];

    function merge(discovered) {
      const added = [];
      const updated = [];
      for (const candidate of discovered || []) {
        const next = normalizeRecord(candidate);
        if (!next) continue;
        const current = records.get(next.id);
        if (!current) {
          records.set(next.id, next);
          order.push(next.id);
          added.push(next);
          continue;
        }
        const merged = {
          ...current,
          title: next.title || current.title,
          artist: next.artist || current.artist,
          thumbUrl: next.thumbUrl || current.thumbUrl,
          pageCount: next.loaded ? next.pageCount : current.pageCount,
          isUgoira: next.loaded ? next.isUgoira : current.isUgoira,
          loaded: current.loaded || next.loaded
        };
        records.set(next.id, merged);
        updated.push(merged);
      }
      return { added, updated };
    }

    function update(id, patch) {
      const current = records.get(String(id));
      if (!current) return null;
      const merged = normalizeRecord({ ...current, ...patch, id: current.id });
      records.set(current.id, merged);
      return merged;
    }

    function get(id) {
      return records.get(String(id)) || null;
    }

    function all() {
      return order.map(id => records.get(id)).filter(Boolean);
    }

    function indexOf(id) {
      return order.indexOf(String(id));
    }

    return { merge, update, get, all, indexOf, get size() { return order.length; } };
  }

  window.PixivPlusWorkbenchModel = { extractWorkId, createStore };
})();
