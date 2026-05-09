document.addEventListener('DOMContentLoaded', () => {
  const hoverToggle = document.getElementById('hover-preview');
  const delayField = document.getElementById('delay-field');
  const delayInput = document.getElementById('hover-delay');
  const dirPath = document.getElementById('dir-path');
  const resetDirBtn = document.getElementById('btn-reset-dir');
  const templateInput = document.getElementById('filename-template');
  const filenamePreview = document.getElementById('filename-preview');
  const status = document.getElementById('status');

  // Load settings
  chrome.runtime.sendMessage({ type: 'getSettings' }, (settings) => {
    hoverToggle.checked = settings.hoverPreview !== false;
    delayInput.value = settings.hoverDelay || 400;
    templateInput.value = settings.filenameTemplate || '{artist}-{title}-{id}';
    updateDelayVisibility();
    updatePreview();
  });

  // Query directory info from content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || !tabs[0].url?.includes('pixiv.net')) {
      dirPath.textContent = 'Open pixiv.net first';
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'getDirInfo' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        dirPath.textContent = 'Not set — will prompt on first download';
        return;
      }
      dirPath.textContent = resp.name ? `📁 ${resp.name}` : 'Not set — will prompt on first download';
    });
  });

  hoverToggle.addEventListener('change', () => {
    updateDelayVisibility();
    saveSettings();
  });

  delayInput.addEventListener('change', saveSettings);

  templateInput.addEventListener('input', () => {
    updatePreview();
  });
  templateInput.addEventListener('change', saveSettings);

  resetDirBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'resetDir' }, () => {
        dirPath.textContent = 'Not set — will prompt on first download';
        showStatus('Directory reset', 'success');
      });
    });
  });

  function saveSettings() {
    chrome.runtime.sendMessage({
      type: 'saveSettings',
      hoverPreview: hoverToggle.checked,
      hoverDelay: parseInt(delayInput.value) || 400,
      filenameTemplate: templateInput.value.trim() || '{artist}-{title}-{id}'
    });
    showStatus('Saved!', 'success');
  }

  function updateDelayVisibility() {
    delayField.style.display = hoverToggle.checked ? '' : 'none';
  }

  function updatePreview() {
    const tpl = templateInput.value || '{artist}-{title}-{id}';
    const preview = tpl
      .replace('{artist}', 'Artist')
      .replace('{title}', 'Title')
      .replace('{id}', '12345678')
      .replace('{page}', '_p0');
    filenamePreview.textContent = `${preview}.png`;
  }

  function showStatus(msg, type) {
    status.textContent = msg;
    status.className = `status ${type}`;
    setTimeout(() => { status.textContent = ''; status.className = 'status'; }, 2000);
  }
});
