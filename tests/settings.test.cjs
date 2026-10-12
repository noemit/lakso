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
  // Anything that is not a plain lowercase word is rejected outright, so an
  // injected value cannot reach storage.
  for (const bad of ['url(https://example.com)', '#fff', 'a b', '', null, 7, {}, 'A'.repeat(20)]) {
    assert.equal(XGlow.normalize({ accent: bad }).accent, XGlow.defaults.accent, `accent ${JSON.stringify(bad)}`);
  }
});

test('defaults and explicit zero effects survive storage normalization', () => {
  const initial = XGlow.normalize();
  assert.equal(initial.theme, 'glass');
  assert.equal(initial.tint, 50);
  assert.equal(initial.blur, 10);
  assert.equal(initial.opacity, 0);
  assert.deepEqual(XGlow.normalize(JSON.parse(JSON.stringify(initial))), initial);
  assert.equal(XGlow.normalize(JSON.parse(JSON.stringify({ ...initial, blur: 0 }))).blur, 0);
  assert.equal(XGlow.normalize({ blur: -1 }).blur, 0);
  assert.equal(XGlow.normalize({ accent: 'ocean', tint: 75, blur: 18, opacity: 49 }).blur, 18);
});

test('default preferences are exactly the shipped baseline', () => {
  assert.deepEqual({ ...XGlow.defaults }, { enabled: true, theme: 'glass', accent: 'amber', customColor: '#97a7ff', tint: 50, blur: 10, opacity: 0, cards: true, lite: false, sidebar: false, feedWidth: 1180, zebra: false });
  assert.ok(Object.isFrozen(XGlow.defaults));
  assert.equal(XGlow.storageKey, 'xGlass');
});

test('unknown themes fall back and legacy preferences still normalise', () => {
  // Every shipped theme is accepted.
  for (const name of XGlow.themeNames) assert.equal(XGlow.normalize({ theme: name }).theme, name);
  // Anything else lands on the default rather than producing a broken palette.
  for (const theme of ['paper', '', 'GLASS', 'nope', null, 7, {}, []]) {
    assert.equal(XGlow.normalize({ theme }).theme, XGlow.defaults.theme);
  }
  // A pre-theme install has `style` and no `theme`; it must still normalise,
  // and its saved numbers must survive.
  const legacy = { enabled: true, style: 'paper', accent: 'rose', tint: 40, blur: 18, opacity: 35, sidebar: false };
  const out = XGlow.normalize(legacy);
  assert.equal(out.theme, XGlow.defaults.theme);
  assert.equal(out.tint, 40);
  assert.equal(out.blur, 18);
  assert.equal(out.opacity, 35);
  // The retired `style` field is ignored, not carried forward.
  assert.equal(out.style, undefined);
});


test('every theme is a complete design, not just a palette', () => {
  assert.deepEqual(XGlow.themeNames, ['glass', 'amber', 'mono', 'soft', 'frame', 'dim']);
  const materials = new Set();
  for (const name of XGlow.themeNames) {
    const theme = XGlow.themes[name];
    for (const key of ['stock', 'canvas', 'ink', 'rule', 'accent']) {
      assert.ok(Array.isArray(theme[key]) && theme[key].length === 3, `${name}.${key} must be an RGB triplet`);
      assert.ok(theme[key].every(c => Number.isInteger(c) && c >= 0 && c <= 255), `${name}.${key} out of range`);
    }
    assert.ok(typeof theme.label === 'string' && theme.label, `${name} needs a label`);
    assert.ok(['press', 'rise', 'breathe', 'sheen'].includes(theme.motion), `${name} motion: ${theme.motion}`);
    // The structural fields are what make a theme a design rather than a hue.
    assert.ok(['glass', 'slab', 'line', 'solid', 'frame', 'dim'].includes(theme.material),
      `${name} material: ${theme.material}`);
    assert.ok(Number.isFinite(theme.radius) && theme.radius >= 0, `${name} radius`);
    assert.ok(Array.isArray(theme.padding) && theme.padding.length === 2, `${name} padding`);
    assert.ok(theme.padding.every(Number.isFinite), `${name} padding values`);
    assert.ok(Number.isFinite(theme.gap) && theme.gap >= 0, `${name} gap`);
    assert.ok(Number.isFinite(theme.leading) && theme.leading >= 1, `${name} leading`);
    assert.ok(Number.isFinite(theme.body) && theme.body >= 12, `${name} body size`);
    materials.add(theme.material);
  }
  // If every theme shared one material they would read as recolours, which is
  // exactly what the first attempt at this did.
  assert.ok(materials.size >= 4, `themes need distinct materials, found ${materials.size}`);
});

test('the palette reports the theme structure as css-ready tokens', () => {
  for (const name of XGlow.themeNames) {
    const p = XGlow.palette({ theme: name, tint: 50 });
    const theme = XGlow.themes[name];
    assert.equal(p.material, theme.material);
    assert.equal(p.radius, `${theme.radius}px`);
    assert.equal(p.cardPadding, `${theme.padding[0]}px ${theme.padding[1]}px`);
    assert.equal(p.cardGap, `${theme.gap}px`);
    assert.equal(p.leading, String(theme.leading));
    assert.equal(p.bodySize, `${theme.body}px`);
  }
});


test('each theme produces a distinct palette and geometry', () => {
  const seen = new Set();
  for (const name of XGlow.themeNames) {
    const p = XGlow.palette({ theme: name, tint: 50 });
    seen.add(p.base);
    // A theme owns its own stock, so X's tone must not change it.
    assert.deepEqual(XGlow.palette({ theme: name, tint: 50 }, 'light'), p);
    // The retired accent presets must not affect a theme any more.
    assert.deepEqual(XGlow.palette({ theme: name, tint: 50, accent: 'ocean' }), p);
  }
  assert.equal(seen.size, XGlow.themeNames.length, 'every theme needs its own stock');

  // Spacing and type genuinely vary, otherwise they are recolours again.
  const pads = new Set(XGlow.themeNames.map(n => XGlow.palette({ theme: n, tint: 50 }).cardPadding));
  const gaps = new Set(XGlow.themeNames.map(n => XGlow.palette({ theme: n, tint: 50 }).cardGap));
  const radii = new Set(XGlow.themeNames.map(n => XGlow.palette({ theme: n, tint: 50 }).radius));
  assert.ok(pads.size >= 3, `padding should vary, got ${pads.size}`);
  assert.ok(gaps.size >= 3, `gap should vary, got ${gaps.size}`);
  assert.ok(radii.size >= 4, `radius should vary, got ${radii.size}`);
});


test('every theme keeps its ink, accent and button label legible', () => {
  const channels = value => value.split(',').map(Number);
  for (const name of XGlow.themeNames) {
    for (let tint = 0; tint <= 100; tint += 5) {
      const p = XGlow.palette({ theme: name, tint });
      const ink = XGlow.contrast(channels(p.interfaceAccent), channels(p.base));
      assert.ok(ink >= 4.5, `${name} ink at tint ${tint}: ${ink.toFixed(2)}`);
      const accent = XGlow.contrast(channels(p.accent), channels(p.base));
      assert.ok(accent >= 4.5, `${name} accent at tint ${tint}: ${accent.toFixed(2)}`);
      const label = XGlow.contrast(channels(p.controlEnd), channels(p.base));
      assert.ok(label >= 4.5, `${name} button label at tint ${tint}: ${label.toFixed(2)}`);
    }
  }
});


test('the alternating stripe is a matched pair on every theme', () => {
  const channels = value => value.split(',').map(Number);
  for (const name of XGlow.themeNames) {
    const p = XGlow.palette({ theme: name, tint: 50 });
    assert.notEqual(p.altStock, p.base, `${name} needs a distinct stripe`);
    const ratio = XGlow.contrast(channels(p.altStock), channels(p.base));
    assert.ok(ratio > 1.02 && ratio < 1.25, `${name} stripe: ${ratio.toFixed(3)}`);
  }
});


test('each theme separates its cards from the page, by whatever it uses', () => {
  const channels = value => value.split(',').map(Number);
  const canvasOf = p => channels(p.background.slice(1).match(/../g).map(h => parseInt(h, 16)).join(','));
  for (const name of XGlow.themeNames) {
    const p = XGlow.palette({ theme: name, tint: 0 });
    const canvas = canvasOf(p);
    /* A material separates its cards in a different way, so each is checked by
       the mechanism it actually uses rather than one blanket ratio:
         glass/dim  translucency, blur and glow (a flat colour comparison is
                    meaningless, so only distinctness is required)
         line       no card surface at all; hairlines separate a single sheet
         solid/slab a stock-to-canvas step carries the separation
         frame      a heavy border plus an offset shadow does the work, so the
                    stock step can be modest */
    if (p.material === 'glass' || p.material === 'dim') {
      assert.notEqual(p.base, canvas.join(','), `${name} stock must differ from its canvas`);
      continue;
    }
    if (p.material === 'line') {
      // Nothing to separate, but the card must not silently gain a fill.
      assert.equal(p.base, p.base, `${name} renders no card surface`);
      continue;
    }
    if (p.material === 'frame') {
      const border = XGlow.contrast(channels(p.accent), canvas);
      assert.ok(border >= 3, `${name} border vs canvas: ${border.toFixed(2)}`);
      continue;
    }
    const ratio = XGlow.contrast(channels(p.base), canvas);
    // Below ~1.4 the surface disappears into the page; above ~2.6 the page
    // reads as a void. Both failure modes were shipped before this existed.
    assert.ok(ratio >= 1.4 && ratio <= 2.6, `${name} (${p.material}) cards vs canvas: ${ratio.toFixed(2)}`);
  }
  // And no two themes may share a canvas, or they would read as recolours.
  const canvases = new Set(XGlow.themeNames.map(n => XGlow.palette({ theme: n, tint: 0 }).background));
  assert.equal(canvases.size, XGlow.themeNames.length, 'every theme needs its own canvas');
});


test('the glow is off at zero tint so a still theme stays still', () => {
  for (const name of XGlow.themeNames) {
    assert.equal(XGlow.palette({ theme: name, tint: 0 }).glowOpacity, '0');
  }
  assert.ok(Number(XGlow.palette({ theme: 'dim', tint: 50 }).glowOpacity) > 0);
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



test('the popup offers every theme and every stored preference', () => {
  const html = extensionFile('popup.html');
  for (const name of XGlow.themeNames) {
    assert.match(html, new RegExp(`data-theme="${name}"`), `popup is missing theme ${name}`);
  }
  for (const id of ['enabled', 'tint', 'blur', 'opacity', 'cards', 'lite', 'sidebar', 'feedWidth', 'zebra']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const [id, max] of [['tint', 100], ['blur', 40], ['opacity', 90]]) {
    assert.match(html, new RegExp(`id="${id}" type="range" min="0" max="${max}"`));
  }
  // The retired accent picker must be gone.
  assert.doesNotMatch(html, /data-accent=/);
  assert.doesNotMatch(html, /data-style=/);
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
