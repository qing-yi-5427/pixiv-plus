document.addEventListener('DOMContentLoaded', () => {
  localize();
  const fields = {
    workbenchEnabled: document.getElementById('workbench-enabled'),
    hoverPreview: document.getElementById('hover-preview'),
    hoverDelay: document.getElementById('hover-delay'),
    previewBehavior: document.getElementById('preview-behavior'),
    embedTags: document.getElementById('embed-tags'),
    downloadConcurrency: document.getElementById('download-concurrency'),
    duplicatePolicy: document.getElementById('duplicate-policy'),
    multiDownloadDefault: document.getElementById('multi-download-default'),
    filenameTemplate: document.getElementById('filename-template')
  };
  const delayField = document.getElementById('delay-field');
  const dirPath = document.getElementById('dir-path');
  const filenamePreview = document.getElementById('filename-preview');
  const status = document.getElementById('status');

  chrome.runtime.sendMessage({ type: 'getSettings' }, settings => {
    fields.workbenchEnabled.checked = settings.workbenchEnabled !== false;
    fields.hoverPreview.checked = settings.hoverPreview !== false;
    fields.hoverDelay.value = settings.hoverDelay ?? 400;
    fields.previewBehavior.value = settings.previewBehavior || 'peek';
    fields.embedTags.checked = settings.embedTags !== false;
    fields.downloadConcurrency.value = String(settings.downloadConcurrency || 3);
    fields.duplicatePolicy.value = settings.duplicatePolicy || 'skip';
    fields.multiDownloadDefault.value = settings.multiDownloadDefault || 'ask';
    fields.filenameTemplate.value = settings.filenameTemplate || '{artist}-{title}-{id}';
    updateDelayVisibility();
    updatePreview();
  });

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0] || !tabs[0].url?.includes('pixiv.net')) {
      dirPath.textContent = message('openPixivFirst', 'Open pixiv.net first');
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'getDirInfo' }, resp => {
      if (chrome.runtime.lastError || !resp) {
        dirPath.textContent = message('directoryNotSet', 'Not set');
        return;
      }
      dirPath.textContent = resp.name || message('directoryNotSet', 'Not set');
    });
  });

  Object.values(fields).filter(field => field !== fields.filenameTemplate).forEach(field => {
    field.addEventListener('change', () => {
      updateDelayVisibility();
      updatePreview();
      saveSettings();
    });
  });
  fields.filenameTemplate.addEventListener('input', () => {
    updatePreview();
    clearTimeout(fields.filenameTemplate.saveTimer);
    fields.filenameTemplate.saveTimer = setTimeout(saveSettings, 300);
  });

  document.getElementById('btn-reset-dir').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'resetDir' }, () => {
        dirPath.textContent = message('directoryNotSet', 'Not set');
        showStatus(message('directoryReset', 'Folder reset'));
      });
    });
  });

  function saveSettings() {
    chrome.runtime.sendMessage({
      type: 'saveSettings',
      workbenchEnabled: fields.workbenchEnabled.checked,
      hoverPreview: fields.hoverPreview.checked,
      hoverDelay: Number.parseInt(fields.hoverDelay.value, 10) || 400,
      previewBehavior: fields.previewBehavior.value,
      embedTags: fields.embedTags.checked,
      downloadConcurrency: Number.parseInt(fields.downloadConcurrency.value, 10) || 3,
      duplicatePolicy: fields.duplicatePolicy.value,
      multiDownloadDefault: fields.multiDownloadDefault.value,
      filenameTemplate: fields.filenameTemplate.value.trim() || '{artist}-{title}-{id}'
    });
    showStatus(message('saved', 'Saved'));
  }

  function updateDelayVisibility() {
    delayField.hidden = !fields.hoverPreview.checked;
  }

  function updatePreview() {
    const preview = (fields.filenameTemplate.value || '{artist}-{title}-{id}')
      .replaceAll('{artist}', 'Artist').replaceAll('{title}', 'Title')
      .replaceAll('{id}', '12345678').replaceAll('{page}', '_p0');
    filenamePreview.textContent = `${preview}.png`;
  }

  function showStatus(text) {
    status.textContent = text;
    status.className = 'status success';
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => { status.textContent = ''; }, 1500);
  }
});

function message(key, fallback) {
  return chrome.i18n.getMessage(key) || fallback;
}

function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('zh') ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = message(element.dataset.i18n, element.textContent);
  });
}
