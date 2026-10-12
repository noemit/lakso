/* Extension popup. Preferences are stored in chrome.storage.local; open X
   tabs pick up every change live through storage.onChanged. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const FIELDS = ['enabled', 'tint', 'blur', 'opacity', 'cards', 'lite', 'sidebar', 'feedWidth', 'zebra'];
  const UNITS = { tint: '%', blur: ' px', opacity: '%' };
  const MESSAGES = {
    saving: 'Saving…',
    saved: 'Saved on this device',
    saveFailed: 'Could not save. Please try again.',
    loadFailed: 'Could not load your preferences.',
  };

  const status = $('status');
  const themeButtons = [...document.querySelectorAll('[data-theme]')];
  const themeFieldset = $('themeFieldset');
  const controls = [...document.querySelectorAll('input, button')];
  let settings = XGlow.normalize();
  let queue = Promise.resolve();

  const setDisabled = disabled => controls.forEach(control => { control.disabled = disabled; });

  function renderField(id) {
    const input = $(id);
    if (input.type === 'checkbox') input.checked = settings[id];
    else input.value = settings[id];
    if (input.type === 'range') {
      const min = Number(input.min), max = Number(input.max);
      input.style.setProperty('--progress', `${(settings[id] - min) / (max - min) * 100}%`);
    }
  }

  function render() {
    FIELDS.forEach(renderField);
    for (const [id, unit] of Object.entries(UNITS)) $(`${id}Value`).value = `${settings[id]}${unit}`;
    $('feedWidthValue').value = `${settings.feedWidth}px`;
    // Width has no meaning while the sidebar is shown, so the slider follows
    // the sidebar toggle rather than sitting there doing nothing.
    $('feedWidth').disabled = settings.sidebar;
    // Stripes need opaque stock to alternate between, so they are unavailable
    // on the translucent materials.
    const material = XGlow.themes[settings.theme]?.material;
    $('zebra').disabled = material === 'glass' || material === 'dim';
    for (const button of themeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.theme === settings.theme));
      // Show each theme's real stock and accent rather than a fixed swatch, so
      // the choice reads before it is applied.
      const p = XGlow.palette({ theme: button.dataset.theme, tint: settings.tint });
      button.style.setProperty('--swatch', `rgb(${p.base})`);
      button.style.setProperty('--theme-accent', `rgb(${p.accent})`);
    }
  }

  // Writes are chained so a slower earlier write cannot overwrite a newer one.
  function save(patch) {
    settings = XGlow.normalize({ ...settings, ...patch });
    render();
    const snapshot = { ...settings };
    status.textContent = MESSAGES.saving;
    queue = queue.catch(() => {})
      .then(() => chrome.storage.local.set({ [XGlow.storageKey]: snapshot }))
      .then(() => { status.textContent = MESSAGES.saved; })
      .catch(() => { status.textContent = MESSAGES.saveFailed; });
  }


  setDisabled(true);

  for (const id of FIELDS) {
    $(id).addEventListener('input', event => {
      const { type, checked, value } = event.target;
      save({ [id]: type === 'checkbox' ? checked : Number(value) });
    });
  }
  for (const button of themeButtons) button.addEventListener('click', () => save({ theme: button.dataset.theme }));
  $('reset').addEventListener('click', () => save(XGlow.defaults));

  const version = globalThis.chrome?.runtime?.getManifest?.().version;
  if (version) $('version').textContent = version;

  chrome.storage.local.get(XGlow.storageKey).then(stored => {
    settings = XGlow.normalize(stored[XGlow.storageKey]);
    render();
    setDisabled(false);
  }).catch(() => {
    render();
    status.textContent = MESSAGES.loadFailed;
  });
})();
