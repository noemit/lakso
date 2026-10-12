const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../extension/settings.js');

const extensionFile = name => fs.readFileSync(path.join(__dirname, '..', 'extension', name), 'utf8');
const channels = value => value.split(',').map(Number);
const luminance = rgb => channels(rgb).map(channel => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);

test('corrupted stored preferences cannot produce unsafe or unusable CSS values', () => {
  assert.deepEqual(XGlow.normalize({ accent: 'url(https://example.com)', enabled: 'false', blur: Infinity, opacity: -10, cards: null, lite: true, sidebar: 'true' }), { ...XGlow.defaults, opacity: 0, lite: true });
  assert.equal(XGlow.normalize({ blur: 200, opacity: 200 }).blur, 40);
  assert.equal(XGlow.normalize({ blur: 200, opacity: 200 }).opacity, 90);
  assert.deepEqual(XGlow.normalize(null), XGlow.defaults);
  assert.equal(XGlow.normalize({ accent: 'ocean' }).sidebar, false);
});

test('Amber defaults and explicit zero effects survive storage normalization', () => {
  const initial = XGlow.normalize();
  assert.equal(initial.accent, 'amber');
  assert.equal(initial.tint, 50);
  assert.equal(initial.blur, 10);
  assert.equal(initial.opacity, 0);
  assert.deepEqual(XGlow.normalize(JSON.parse(JSON.stringify(initial))), initial);
  assert.equal(XGlow.normalize(JSON.parse(JSON.stringify({ ...initial, blur: 0 }))).blur, 0);
  assert.equal(XGlow.normalize({ blur: -1 }).blur, 0);
  assert.equal(XGlow.normalize({ accent: 'ocean', tint: 75, blur: 18, opacity: 49 }).blur, 18);
});

test('default preferences are exactly the shipped baseline', () => {
  assert.deepEqual({ ...XGlow.defaults }, { enabled: true, style: 'paper', accent: 'amber', customColor: '#97a7ff', tint: 50, blur: 10, opacity: 0, cards: true, lite: false, sidebar: false });
  assert.ok(Object.isFrozen(XGlow.defaults));
  assert.equal(XGlow.storageKey, 'xGlass');
});

test('unknown or legacy styles fall back to paper and keep their accents', () => {
  // Preferences written before the style existed have no style field at all.
  assert.equal(XGlow.normalize({ accent: 'rose' }).style, 'paper');
  for (const style of ['glass', 'paper']) assert.equal(XGlow.normalize({ style }).style, style);
  for (const style of ['url(https://example.com)', 'GLASS', '', null, 7, {}]) {
    assert.equal(XGlow.normalize({ style }).style, XGlow.defaults.style);
  }
  // Switching style must not discard the accent the user picked.
  assert.equal(XGlow.normalize({ style: 'glass', accent: 'ocean' }).accent, 'ocean');
});

test('the paper style keeps one palette in both tones whatever the accent is', () => {
  const paper = accent => XGlow.palette({ style: 'paper', accent, tint: 50 });
  // Every accent produces identical paper: the style ignores the accent hue.
  const first = paper('ocean');
  for (const accent of [...Object.keys(XGlow.accents), 'custom']) {
    assert.deepEqual(paper(accent), first, `paper must not vary with ${accent}`);
  }
  const channels = value => value.split(',').map(Number);
  // "Neutral" means no hue, not exactly equal channels: the paper palette uses
  // a print black with a faint cool cast, the way ink on stock does.
  // The paper palette is warm by design, so the invariant is not "gray" but
  // "never hue-shifted by the accent, and always red >= blue".
  const isWarm = value => { const [r, , b] = channels(value); return r >= b; };
  for (const tone of ['dark', 'light']) {
    const palette = XGlow.palette({ style: 'paper', tint: 50 }, tone);
    for (const key of ['accent', 'base', 'interfaceAccent', 'controlStart', 'controlEnd', 'glowSecondary']) {
      assert.ok(isWarm(palette[key]), `${key} must stay warm in ${tone}: ${palette[key]}`);
    }
    // No glow: the paper canvas is flat.
    assert.equal(palette.glowOpacity, '0');
    assert.equal(palette.glowSecondaryOpacity, '0');
    assert.equal(palette.glowTertiaryOpacity, '0');
  }
  // The canvas follows X's tone, and tint deepens it to separate it from the
  // white stock; it never picks up a hue from the accent.
  for (const tone of ['dark', 'light']) {
    const flat = XGlow.palette({ style: 'paper', tint: 0 }, tone).background;
    assert.equal(flat, tone === 'light' ? XGlow.paper.canvasLight : XGlow.paper.canvas);
    const tinted = XGlow.palette({ style: 'paper', tint: 100 }, tone).background;
    assert.notEqual(tinted, flat);
    const rgb = tinted.slice(1).match(/../g).map(h => parseInt(h, 16));
    assert.ok(rgb[0] >= rgb[2], `canvas must stay warm: ${tinted}`);
  }
});

test('paper ink stays readable against paper stock at every tint', () => {
  const channels = value => value.split(',').map(Number);
  // "Neutral" means no hue, not exactly equal channels: the paper palette uses
  // a print black with a faint cool cast, the way ink on stock does.
  // The paper palette is warm by design, so the invariant is not "gray" but
  // "never hue-shifted by the accent, and always red >= blue".
  const isWarm = value => { const [r, , b] = channels(value); return r >= b; };
  const luminance = rgb => channels(rgb).map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + .05) / (lo + .05);
  };
  for (const tone of ['dark', 'light']) {
    for (let tint = 0; tint <= 100; tint += 5) {
      const palette = XGlow.palette({ style: 'paper', tint }, tone);
      const stock = contrast(palette.interfaceAccent, palette.base);
      assert.ok(stock >= 4.5, `ink on stock at tint ${tint} (${tone}): ${stock.toFixed(2)}`);
      // The primary button is a print-black pill: its own paper-white label is
      // what has to stay readable (paper overrides the glass label color in
      // glass.css).
      const buttonLabel = contrast(palette.controlEnd, '252,252,251');
      assert.ok(buttonLabel >= 4.5, `label on button at tint ${tint} (${tone}): ${buttonLabel.toFixed(2)}`);
      assert.ok(isWarm(palette.controlStart) && isWarm(palette.controlEnd));
    }
  }
});

test('disabling and valid customizations survive normalization', () => {
  const value = { enabled: false, accent: 'ocean', blur: 12, opacity: 75, cards: false, lite: true, sidebar: true };
  assert.deepEqual(XGlow.normalize(value), { ...XGlow.defaults, ...value });
});

test('preferences saved by earlier versions keep their values', () => {
  // Before custom colors and tint, and before the sidebar toggle.
  const legacy = { enabled: true, accent: 'rose', blur: 18, opacity: 49, cards: false, lite: false };
  assert.deepEqual(XGlow.normalize(legacy), { ...XGlow.defaults, ...legacy });
  assert.equal(XGlow.normalize({ accent: 'aurora', blur: 27 }).sidebar, false);
});

test('custom colors are strict hexadecimal and retain saved preferences', () => {
  assert.equal(XGlow.normalize({ accent: 'custom', customColor: '#0F8', tint: 150 }).customColor, '#00ff88');
  assert.equal(XGlow.normalize({ accent: 'custom', customColor: '#0F8', tint: 150 }).tint, 100);
  for (const customColor of ['red', 'url(https://example.com)', '#123456; color:red', '#12345678', null]) {
    assert.equal(XGlow.normalize({ customColor }).customColor, XGlow.defaults.customColor);
  }
  assert.equal(XGlow.normalize({ tint: NaN }).tint, XGlow.defaults.tint);
  const old = XGlow.normalize({ accent: 'ocean', blur: 28, opacity: 35, sidebar: false });
  assert.equal(old.accent, 'ocean'); assert.equal(old.blur, 28); assert.equal(old.opacity, 35);
});

test('theme hues affect every surface in the glass style while zero tint stays neutral', () => {
  const glass = (value, tone) => XGlow.palette({ style: 'glass', ...value }, tone);
  const green = glass({ accent: 'forest', tint: 100 }), red = glass({ accent: 'ruby', tint: 100 });
  assert.ok(channels(green.base)[1] > channels(green.base)[0]);
  assert.ok(channels(red.base)[0] > channels(red.base)[1]);
  assert.notEqual(green.background, red.background);
  assert.equal(glass({ accent: 'forest', tint: 0 }).base, glass({ accent: 'ruby', tint: 0 }).base);
  assert.equal(glass({ tint: 0 }).glowOpacity, '0');
  const light = glass({ accent: 'custom', customColor: '#22c55e', tint: 100 }, 'light');
  assert.equal(light.hex, '#22c55e');
  // Light stock stays light. A saturated accent deepens one channel more than
  // the others, so check luminance rather than every channel.
  assert.ok(luminance(light.base) > .8, `light stock luminance: ${luminance(light.base)} on ${light.base}`);
});

test('black and white custom themes retain readable controls in the glass style', () => {
  const text = luminance('17,27,51');
  for (const customColor of ['#000000', '#ffffff', '#0000ff', '#ff0000']) {
    const dark = XGlow.palette({ style: 'glass', accent: 'custom', customColor });
    assert.ok((luminance(dark.controlEnd) + .05) / (text + .05) >= 4.5);
    assert.ok((luminance(dark.controlStart) + .05) / (text + .05) >= 4.5);
    assert.ok(luminance(dark.interfaceAccent) >= .25);
    assert.ok(luminance(XGlow.palette({ style: 'glass', accent: 'custom', customColor }, 'light').interfaceAccent) <= .3);
  }
});
test('stylesheet fallbacks and popup accent match the default palette', () => {
  const css = extensionFile('glass.css');
  const token = name => css.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();
  // The CSS fallbacks describe the glass style, which is what shows before
  // content.js applies the saved palette.
  const palette = XGlow.palette({ ...XGlow.defaults, style: 'glass' });
  const normalizeNumbers = value => value.replace(/\s+/g, '').replace(/(^|,)\./g, '$10.');
  assert.equal(normalizeNumbers(token('--xlg-accent-rgb')), normalizeNumbers(palette.accent));
  assert.equal(normalizeNumbers(token('--xlg-control-start-rgb')), normalizeNumbers(palette.controlStart));
  assert.equal(normalizeNumbers(token('--xlg-base')), normalizeNumbers(palette.base));
  assert.equal(normalizeNumbers(token('--xlg-glow-secondary-rgb')), normalizeNumbers(palette.glowSecondary));
  assert.equal(normalizeNumbers(token('--xlg-glow-tertiary-rgb')), normalizeNumbers(palette.glowTertiary));
  assert.equal(Number(token('--xlg-glow-opacity')), Number(palette.glowOpacity));
  assert.equal(token('--xlg-bg'), palette.background.replace(/rgb\((\d+), (\d+), (\d+)\)/, (_, ...rgb) => '#' + rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')));
  assert.equal(normalizeNumbers(token('--xlg-border')), normalizeNumbers(palette.border));
  assert.equal(token('--xlg-blur'), `${XGlow.defaults.blur}px`);
  assert.equal(Number(token('--xlg-opacity')), XGlow.defaults.opacity / 100);
  assert.match(extensionFile('popup.css'), new RegExp(`--accent:\\s*${palette.interfaceHex};`));
});

test('popup offers every accent and every stored preference', () => {
  const html = extensionFile('popup.html');
  for (const accent of [...Object.keys(XGlow.accents), 'custom']) assert.match(html, new RegExp(`data-accent="${accent}"`));
  for (const id of ['enabled', 'tint', 'blur', 'opacity', 'cards', 'lite', 'sidebar', 'customColor', 'customHex']) assert.match(html, new RegExp(`id="${id}"`));
  for (const [id, max] of [['tint', 100], ['blur', 40], ['opacity', 90]]) assert.match(html, new RegExp(`id="${id}" type="range" min="0" max="${max}"`));
});

test('manifest loads only local files and limits injection to X/Twitter', () => {
  const manifest = JSON.parse(extensionFile('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.ok(manifest.content_scripts[0].matches.every(pattern => /^https:\/\/(www\.)?(x|twitter)\.com\/\*$/.test(pattern)));
  for (const file of [...manifest.content_scripts[0].css, ...manifest.content_scripts[0].js, manifest.action.default_popup]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'extension', file)));
  }
  assert.match(extensionFile('popup.html'), new RegExp(`id="version">${manifest.version.replaceAll('.', '\\.')}<`));
});
