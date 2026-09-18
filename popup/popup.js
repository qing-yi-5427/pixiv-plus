/* Validate patches, wait for persistence, and sync other settings views. */
(() => {
  'use strict';
  const S = globalThis.PixivPlusSettings;
  const zh = chrome.i18n.getUILanguage().startsWith('zh');
  const t = (cn, en) => zh ? cn : en;
  const fullPage = location.pathname.endsWith('/settings.html') || new URLSearchParams(location.search).get('view') === 'page';
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  document.title = t('PixivPlus · 设置', 'PixivPlus · Settings');
  document.body.classList.toggle('full-page', fullPage);
  const app = document.getElementById('settings-app');
  const controls = new Map(), panels = new Map(), tabs = [], pending = new Map();
  let settings, sequence = 0;
  let status, content, folderName, folderHint, resetFolder, filenameInput, filenameError, singleSample, multiSample, returnButton;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    node.append(...children.filter(child => child !== null));
    return node;
  }
  function button(text, action, kind = '') {
    return el('button', { type: 'button', class: `button ${kind}`, onclick: action }, text);
  }
  function hint(text) { return el('p', { class: 'hint' }, text); }
  function setStatus(text, state = 'saved') {
    if (state === 'saved' && filenameInput?.getAttribute('aria-invalid') === 'true') return;
    status.textContent = text;
    status.dataset.state = state;
  }
  function request(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      if (error || response?.error || !response) reject(new Error(error?.message || response?.error || 'No response'));
      else resolve(response);
    }));
  }
  function save(patch) {
    try { patch = S.validatePatch(patch); } catch { return; }
    const revision = ++sequence;
    for (const key of Object.keys(patch)) pending.set(key, revision);
    setStatus(t('正在保存…', 'Saving…'), 'pending');
    // Send immediately so closing the popup cannot discard a queued write.
    // The worker serializes writes and keeps each message alive until persisted.
    return (async () => {
      try {
        await request({ type: 'saveSettings', ...patch });
        Object.assign(settings, patch);
        if (revision === sequence) setStatus(t('已保存 · 即时生效', 'Saved · applied immediately'));
      } catch {
        setStatus(t('保存失败，请重试刚才的修改', 'Could not save. Please retry your change.'), 'error');
        for (const key of Object.keys(patch)) if (pending.get(key) === revision) renderControl(key, settings[key]);
        if (patch.filenameTemplate !== undefined) updateSamples();
      } finally {
        for (const key of Object.keys(patch)) if (pending.get(key) === revision) pending.delete(key);
        dependencies();
      }
    })();
  }
  function register(key, inputs, read) {
    controls.set(key, { inputs, read });
    inputs.forEach(input => input.addEventListener('change', () => {
      dependencies();
      save({ [key]: read() });
    }));
  }
  function renderControl(key, value) {
    const field = controls.get(key);
    if (!field) return;
    for (const input of field.inputs) {
      if (input.type === 'checkbox') input.checked = value;
      else if (input.type === 'radio') input.checked = input.value === value;
      else input.value = value;
      if (input.type === 'range') input.dispatchEvent(new Event('input'));
    }
  }
  function row(key, title, description, control, stacked = false) {
    return el('div', { class: `row${stacked ? ' stack' : ''}` }, el('div', { class: 'row-copy' },
      el('label', { class: 'row-title', id: `${key}-title`, for: key }, title),
      el('p', { class: 'hint', id: `${key}-hint` }, description)), control);
  }
  function toggle(key, title, description) {
    const input = el('input', { id: key, type: 'checkbox', class: 'switch', role: 'switch', 'aria-describedby': `${key}-hint` });
    register(key, [input], () => input.checked);
    return row(key, title, description, input);
  }
  function select(key, title, description, options) {
    const input = el('select', { id: key, 'aria-describedby': `${key}-hint` }, ...options.map(([value, label]) => el('option', { value }, label)));
    register(key, [input], () => key === 'downloadConcurrency' ? Number(input.value) : input.value);
    return row(key, title, description, input);
  }
  function range(key, title, description, min, max, step, unit) {
    const input = el('input', { id: key, type: 'range', min, max, step, 'aria-describedby': `${key}-hint` });
    const output = el('output', { for: key, class: 'value' });
    input.addEventListener('input', () => { output.textContent = `${input.value} ${unit}`; });
    register(key, [input], () => Number(input.value));
    return row(key, title, description, el('div', { class: 'control range-control' }, input, output), true);
  }
  function group(title, ...rows) { return el('section', { class: 'group' }, el('h2', {}, title), ...rows); }
  function dependencies() {
    const warning = document.getElementById('overwrite-warning');
    if (warning) warning.hidden = controls.get('duplicatePolicy').read() !== 'overwrite';
  }
  function panel(key, title, description, ...children) {
    const section = el('section', { id: `panel-${key}`, role: 'tabpanel', 'aria-labelledby': `tab-${key}`, tabindex: '0' },
      el('div', { class: 'intro' }, el('h1', {}, title), hint(description)), ...children);
    section.hidden = true;
    panels.set(key, section);
    return section;
  }
  function switchPanel(key) {
    for (const [name, section] of panels) section.hidden = name !== key;
    for (const tab of tabs) {
      const selected = tab.dataset.panel === key;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    content.scrollTop = 0;
    history.replaceState(null, '', `${location.pathname}${location.search}#${key}`);
  }
  async function pixivTab() {
    const candidates = await chrome.tabs.query({ url: 'https://www.pixiv.net/*' });
    return candidates.find(tab => tab.active) || candidates.find(tab => tab.url?.includes('/bookmark_new_illust.php')) || candidates[0];
  }
  async function openWorkbench() {
    try {
      const candidates = await chrome.tabs.query({ url: 'https://www.pixiv.net/bookmark_new_illust.php*' });
      if (candidates[0]) {
        await chrome.tabs.update(candidates[0].id, { active: true });
        await chrome.windows.update(candidates[0].windowId, { focused: true });
        await chrome.tabs.sendMessage(candidates[0].id, { type: 'showWorkbench' }).catch(() => {});
      } else await chrome.tabs.create({ url: 'https://www.pixiv.net/bookmark_new_illust.php' });
      if (!fullPage) window.close();
    } catch { setStatus(t('无法打开 Pixiv，请稍后重试', 'Could not open Pixiv. Try again.'), 'error'); }
  }
  async function directoryMessage(type) {
    const target = await pixivTab();
    if (!target) throw new Error('no-tab');
    return new Promise((resolve, reject) => chrome.tabs.sendMessage(target.id, { type }, response => {
      if (chrome.runtime.lastError || !response || response.error) reject(new Error('unavailable'));
      else resolve(response);
    }));
  }
  async function refreshDirectory() {
    resetFolder.disabled = true;
    try {
      const response = await directoryMessage('getDirInfo');
      folderName.textContent = response.name || t('尚未选择下载目录', 'No download folder selected');
      folderHint.textContent = response.name && response.permission !== 'granted'
        ? t('目录已记住，下次下载时需要重新授权。也可以在工作台右上角更换目录。', 'Folder remembered. Access is needed on the next download. Change it from the workbench toolbar.')
        : t('点击工作台右上角的文件夹按钮选择或更换下载目录。', 'Choose or change your download folder using the folder button in the workbench toolbar.');
      resetFolder.disabled = !response.name;
    } catch {
      folderName.textContent = t('需要连接 Pixiv 页面', 'Connect a Pixiv page');
      folderHint.textContent = t('打开 Pixiv 后重试；扩展更新后可能需要刷新该页面。', 'Open Pixiv and retry. After an extension update, refresh the Pixiv page.');
    }
  }
  function updateSamples() {
    const error = S.templateError(filenameInput.value);
    const errors = {
      empty: t('请输入文件名模板。', 'Enter a filename template.'),
      length: t('模板最多 160 个字符。', 'Use at most 160 characters.'),
      token: t('请使用下方四种变量，检查花括号是否完整。', 'Use the four supported tokens with matching braces.'),
      characters: t('不能包含路径分隔符或文件名非法字符。', 'Remove path separators or unsupported filename characters.')
    };
    filenameError.textContent = errors[error] || '';
    filenameError.hidden = !error;
    filenameInput.setAttribute('aria-invalid', String(Boolean(error)));
    if (error) { setStatus(t('模板未保存，请修正提示的问题', 'Template not saved. Correct the highlighted issue.'), 'error'); return false; }
    const work = { artist: t('青山', 'Aoyama'), title: t('夏日来信', 'Summer letter'), id: '12345678', pageUrls: [{ original: 'https://i.pximg.net/sample.jpg' }, { original: 'https://i.pximg.net/sample.jpg' }] };
    singleSample.textContent = PixivPlusAPI.generateFilename({ ...work, pageCount: 1 }, 0, filenameInput.value.trim());
    multiSample.textContent = PixivPlusAPI.generateFilename({ ...work, pageCount: 2 }, 1, filenameInput.value.trim());
    return true;
  }
  async function init() {
    settings = S.normalize(await request({ type: 'getSettings' }));
    const expand = button(t('展开 ↗', 'Expand ↗'), () => chrome.runtime.openOptionsPage());
    expand.hidden = fullPage;
    returnButton = button(t('打开工作台 ↗', 'Open workbench ↗'), openWorkbench);
    app.append(el('header', { class: 'header' }, el('span', { class: 'brand-icon', 'aria-hidden': 'true' }, '✦'),
      el('div', { class: 'brand' }, el('strong', {}, 'PixivPlus'), el('small', {}, t('工作台设置', 'Workbench settings'))),
      el('div', { class: 'header-actions' }, expand, returnButton)));
    const nav = el('nav', { class: 'tabs', role: 'tablist', 'aria-label': t('设置分类', 'Settings categories'), 'aria-orientation': fullPage && innerWidth > 620 ? 'vertical' : 'horizontal' });
    for (const [key, label] of [['browse', t('浏览', 'Browsing')], ['downloads', t('下载', 'Downloads')], ['files', t('文件命名', 'Filenames')]]) {
      const tab = el('button', { type: 'button', class: 'tab', id: `tab-${key}`, role: 'tab', 'aria-controls': `panel-${key}`, 'aria-selected': 'false', 'data-panel': key, onclick: () => switchPanel(key) }, label);
      tab.addEventListener('keydown', event => {
        const index = tabs.indexOf(tab);
        let next;
        if (['ArrowRight', 'ArrowDown'].includes(event.key)) next = (index + 1) % tabs.length;
        if (['ArrowLeft', 'ArrowUp'].includes(event.key)) next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
      });
      tabs.push(tab); nav.append(tab);
    }
    app.append(nav);
    content = el('div', { class: 'content' });
    const densityInputs = [];
    const density = el('div', { class: 'control choice-grid', role: 'radiogroup', 'aria-labelledby': 'workbenchDensity-title' });
    for (const [value, label] of [['filmstrip', t('一列 · 大图', '1 column')], ['balanced', t('两列 · 均衡', '2 columns')], ['compact', t('三列 · 紧凑', '3 columns')]]) {
      const input = el('input', { type: 'radio', name: 'workbenchDensity', value });
      densityInputs.push(input); density.append(el('label', { class: 'choice' }, input, label));
    }
    register('workbenchDensity', densityInputs, () => densityInputs.find(input => input.checked)?.value);
    content.append(panel('browse', t('让浏览顺手一些', 'Make room for the artwork'), t('调整工作台作品流与原图加载。', 'Tune the workbench feed and original-image loading.'),
      group(t('关注动态工作台', 'FOLLOWING FEED'),
        row('workbenchDensity', t('作品流密度', 'Thumbnail density'), t('与工作台里的密度按钮同步。', 'Synced with the density control in the workbench.'), density, true),
        range('workbenchLeftWidth', t('作品流宽度', 'Feed width'), t('也可以直接拖动工作台的分隔线。', 'You can also drag the divider in the workbench.'), 240, 520, 1, 'px'),
        toggle('workbenchPreloadOriginals', t('自动加载本页原图', 'Preload page originals'), t('每件作品预加载首张原图；多图作品不会加载所有页。会增加流量。', 'Preload the first original of each work, not every manga page. Uses more data.'))),
      el('div', { class: 'shortcut-list' }, ...[['J / K', t('切换作品', 'Switch works')], ['← / →', t('作品翻页', 'Change page')], ['Space', t('专注模式', 'Focus mode')]].map(([key, label]) => el('span', {}, el('kbd', {}, key), ` ${label}`)))));
    folderName = el('div', { class: 'folder-name' }, t('正在读取目录…', 'Checking folder…'));
    folderHint = hint('');
    resetFolder = button(t('忘记目录', 'Forget folder'), async () => {
      resetFolder.disabled = true;
      try {
        const response = await directoryMessage('resetDir');
        if (!response.ok) throw new Error('reset');
        setStatus(t('目录已忘记，已下载文件保留', 'Folder forgotten. Downloaded files are kept.'));
        await refreshDirectory();
      } catch { setStatus(t('未能重置目录，请刷新 Pixiv 后重试', 'Could not reset folder. Refresh Pixiv and retry.'), 'error'); resetFolder.disabled = false; }
    });
    resetFolder.disabled = true;
    const overwriteWarning = el('p', { class: 'notice', id: 'overwrite-warning', hidden: '' }, t('覆盖会替换下载目录中的同名文件。建议使用「跳过」或「自动重命名」。', 'Overwrite replaces files with the same name. Skip or auto rename preserves existing files.'));
    content.append(panel('downloads', t('下载，有迹可循', 'Keep downloads in order'), t('进度会显示在工作台底栏，设置会同步到已打开的页面。', 'Progress lives in the workbench footer. Settings sync across open pages.'),
      group(t('保存位置', 'SAVE LOCATION'), el('div', { class: 'row stack' }, folderName, folderHint,
        el('div', { class: 'folder-actions' }, button(t('前往 Pixiv 选择', 'Choose on Pixiv ↗'), openWorkbench, 'primary'), button(t('刷新状态', 'Refresh'), refreshDirectory), resetFolder))),
      group(t('下载行为', 'DOWNLOAD BEHAVIOR'),
        select('downloadConcurrency', t('同时下载', 'Concurrent downloads'), t('较低并发更适合不稳定的网络。', 'Lower concurrency works better on unstable connections.'), [1,2,3,4,5,6].map(n => [String(n), t(`${n} 个任务`, `${n} tasks`)])),
        select('duplicatePolicy', t('遇到同名文件', 'Existing filenames'), t('按下载目录中的实际文件处理。', 'Checks the actual files in your download folder.'), [['skip', t('跳过', 'Skip')], ['rename', t('自动重命名', 'Auto rename')], ['overwrite', t('覆盖', 'Overwrite')]]),
        select('multiDownloadDefault', t('下载多图作品', 'Multi-page works'), t('作品级下载按钮的默认行为。', 'Default behavior of the artwork download button.'), [['ask', t('先选择页码', 'Choose pages')], ['all', t('下载全部', 'Download all')]])), overwriteWarning,
      el('p', { class: 'notice' }, t('首次下载时会请求目录访问权限。取消选择不会启动下载，也不会退回浏览器下载器。', 'The first download asks for folder access. Cancelling leaves the download unstarted; it does not fall back to browser downloads.'))));
    filenameInput = el('input', { class: 'text-input', type: 'text', id: 'filenameTemplate', maxlength: '160', spellcheck: 'false', autocomplete: 'off', 'aria-describedby': 'filenameTemplate-hint filename-error' });
    controls.set('filenameTemplate', { inputs: [filenameInput], read: () => filenameInput.value });
    filenameError = el('p', { class: 'error', id: 'filename-error', role: 'alert', hidden: '' });
    singleSample = el('div', { class: 'sample-name' }); multiSample = el('div', { class: 'sample-name' });
    filenameInput.addEventListener('input', () => {
      if (updateSamples()) save({ filenameTemplate: filenameInput.value });
      else pending.delete('filenameTemplate'); // Protect the newer draft from an earlier write's rollback.
    });
    const tokens = el('div', { class: 'tokens' });
    for (const [token, label] of [['artist', t('作者', 'Artist')], ['title', t('标题', 'Title')], ['id', t('作品 ID', 'Artwork ID')], ['page', t('页码', 'Page suffix')]]) {
      tokens.append(el('button', { type: 'button', class: 'token', title: label, 'aria-label': `${label} {${token}}`, onclick: () => {
        const start = filenameInput.selectionStart ?? filenameInput.value.length;
        const end = filenameInput.selectionEnd ?? start;
        filenameInput.setRangeText(`{${token}}`, start, end, 'end');
        filenameInput.focus(); filenameInput.dispatchEvent(new Event('input'));
      } }, `{${token}}`));
    }
    content.append(panel('files', t('保存时就整理好', 'Name it once. Find it later.'), t('用作品信息命名，预览与实际下载使用同一套规则。', 'Build filenames from artwork details. These examples use the download naming rules.'),
      group(t('文件命名', 'FILENAMES'), row('filenameTemplate', t('命名模板', 'Filename template'), t('点击变量插入。多图会自动补充页码，无需填写扩展名。', 'Click a token to insert. Multi-page works get a page suffix automatically. Omit the file extension.'),
        el('div', { class: 'control' }, filenameInput, filenameError, tokens,
          el('div', { class: 'samples', 'aria-live': 'polite' }, el('div', { class: 'sample-label' }, t('单图作品', 'Single image')), singleSample,
            el('div', { class: 'sample-label' }, t('多图作品 · 第 2 页', 'Multi-page work · page 2')), multiSample)), true)),
      group(t('图片元数据', 'IMAGE METADATA'), toggle('embedTags', t('写入 Pixiv 标签', 'Embed Pixiv tags'), t('将标签写入 PNG / JPEG 元数据，不改变画面。其他格式保持原样。', 'Write tags into PNG / JPEG metadata without altering the image. Other formats stay unchanged.'))),
      el('div', { class: 'reset-row' }, hint(t('仅恢复命名模板，保留其他偏好。', 'Only resets the filename template.')), button(t('恢复默认命名', 'Reset filename'), () => {
        filenameInput.value = S.defaults.filenameTemplate;
        updateSamples(); save({ filenameTemplate: S.defaults.filenameTemplate });
      }, 'quiet'))));
    app.append(content);
    status = el('span', { class: 'status', role: 'status', 'aria-live': 'polite' }, t('设置已同步', 'Settings synced'));
    app.append(el('footer', { class: 'footer' }, status, el('span', {}, `PixivPlus ${chrome.runtime.getManifest().version}`)));
    for (const [key, value] of Object.entries(settings)) renderControl(key, value);
    dependencies(); updateSamples();
    switchPanel(panels.has(location.hash.slice(1)) ? location.hash.slice(1) : 'browse');
    app.setAttribute('aria-busy', 'false');
    refreshDirectory();
    window.addEventListener('focus', refreshDirectory);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of Object.keys(changes)) {
        if (!controls.has(key) || pending.has(key)) continue;
        const value = S.normalize({ [key]: changes[key].newValue })[key];
        settings[key] = value;
        if (key === 'filenameTemplate' && document.activeElement === filenameInput) continue;
        renderControl(key, value);
      }
      dependencies();
      if (document.activeElement !== filenameInput) updateSamples();
    });
  }
  init().catch(() => {
    app.replaceChildren(el('div', { class: 'load-error', role: 'alert' }, el('h1', {}, t('设置暂时无法加载', 'Settings could not load')),
      hint(t('请确认扩展已启用，然后重试。', 'Check that the extension is enabled, then try again.')),
      button(t('重新加载', 'Try again'), () => location.reload())));
    app.setAttribute('aria-busy', 'false');
  });
})();
