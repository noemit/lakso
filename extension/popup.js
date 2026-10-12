/* Extension popup. Preferences are stored in chrome.storage.local; open X
   tabs pick up every change live through storage.onChanged. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const FIELDS = ['enabled', 'tint', 'blur', 'opacity', 'cards', 'lite', 'sidebar', 'feedWidth'];
  const UNITS = { tint: '%', blur: ' px', opacity: '%' };
  const MESSAGES = {
    saving: 'Saving…',
    saved: 'Saved on this device',
    saveFailed: 'Could not save. Please try again.',
    loadFailed: 'Could not load your preferences.',
    invalidHex: 'Enter a HEX color, e.g. #22c55e.'
  };

  const status = $('status');
  const hexInput = $('customHex');
  const swatches = [...document.querySelectorAll('[data-accent]')];
  const styleButtons = [...document.querySelectorAll('[data-style]')];
  const accentFieldset = $('accentFieldset');
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
    $('customControls').hidden = settings.accent !== 'custom';
    // The paper style is monochrome: the accent controls would do nothing,
    // so they are hidden rather than left there lying to the user.
    accentFieldset.hidden = settings.style === 'paper';
    for (const button of styleButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.style === settings.style));
    }
    $('customColor').value = settings.customColor;
    hexInput.value = settings.customColor;
    hexInput.removeAttribute('aria-invalid');
    document.documentElement.style.setProperty('--accent', XGlow.palette(settings).interfaceHex);
    for (const button of swatches) {
      button.setAttribute('aria-pressed', String(button.dataset.accent === settings.accent));
      button.style.setProperty('--swatch', XGlow.palette({ ...settings, accent: button.dataset.accent }).hex);
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

  function saveHex() {
    const color = XGlow.colorHex(hexInput.value);
    if (color) {
      save({ accent: 'custom', customColor: color });
      return;
    }
    hexInput.setAttribute('aria-invalid', 'true');
    status.textContent = MESSAGES.invalidHex;
  }

  setDisabled(true);

  for (const id of FIELDS) {
    $(id).addEventListener('input', event => {
      const { type, checked, value } = event.target;
      save({ [id]: type === 'checkbox' ? checked : Number(value) });
    });
  }
  for (const button of swatches) button.addEventListener('click', () => save({ accent: button.dataset.accent }));
  for (const button of styleButtons) button.addEventListener('click', () => save({ style: button.dataset.style }));
  $('customColor').addEventListener('input', event => save({ accent: 'custom', customColor: event.target.value }));
  hexInput.addEventListener('change', saveHex);
  hexInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveHex();
  });
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
