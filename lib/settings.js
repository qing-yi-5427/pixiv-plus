// Shared settings contract for the editor and background worker.
(() => {
  'use strict';
  const defaults = Object.freeze({
    workbenchEnabled: true, workbenchPreloadOriginals: false,
    workbenchDensity: 'balanced', workbenchLeftWidth: 340,
    hoverPreview: true, hoverDelay: 400, previewBehavior: 'peek',
    embedTags: true, downloadConcurrency: 3, duplicatePolicy: 'skip',
    multiDownloadDefault: 'ask', filenameTemplate: '{artist}-{title}-{id}'
  });
  const choices = {
    workbenchDensity: ['balanced', 'compact', 'filmstrip'],
    previewBehavior: ['peek', 'immersive'], duplicatePolicy: ['skip', 'rename', 'overwrite'],
    multiDownloadDefault: ['ask', 'all']
  };
  const ranges = { hoverDelay: [0, 3000], downloadConcurrency: [1, 6], workbenchLeftWidth: [240, 520] };
  function templateError(value) {
    if (typeof value !== 'string' || !value.trim()) return 'empty';
    if (value.length > 160) return 'length';
    if (/[{}]/.test(value.replace(/\{(?:artist|title|id|page)\}/g, ''))) return 'token';
    if (/[\u0000-\u001f\u007f\\/:*?"<>|]/.test(value) || /^[. ]+$/.test(value)) return 'characters';
    return null;
  }
  function validatePatch(input) {
    const result = {};
    for (const key of Object.keys(defaults)) {
      if (!Object.hasOwn(input, key)) continue;
      const value = input[key];
      if (typeof defaults[key] === 'boolean' && typeof value !== 'boolean') throw new Error(key);
      if (choices[key] && !choices[key].includes(value)) throw new Error(key);
      if (ranges[key] && (!Number.isInteger(value) || value < ranges[key][0] || value > ranges[key][1])) throw new Error(key);
      if (key === 'filenameTemplate' && templateError(value)) throw new Error(key);
      result[key] = key === 'filenameTemplate' ? value.trim() : value;
    }
    return result;
  }
  function normalize(input = {}) {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      try { Object.assign(result, validatePatch({ [key]: input[key] })); } catch { /* Keep the safe default. */ }
    }
    return result;
  }
  const api = { defaults, validatePatch, normalize, templateError };
  globalThis.PixivPlusSettings = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
