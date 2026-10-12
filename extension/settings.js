/* Preferences and palette, shared by the content script and the popup.
   The XGlow global name and the xGlass storage key are deliberately kept:
   renaming them would orphan preferences saved by an existing install. */
globalThis.XGlow = (() => {
  const storageKey = 'xGlass';

  const defaults = Object.freeze({
    enabled: true,
    style: 'paper',
    accent: 'amber',
    customColor: '#97a7ff',
    tint: 50,
    blur: 10,
    opacity: 0,
    cards: true,
    lite: false,
    sidebar: false,
    // Width of the feed column once the right sidebar is hidden. Exposed as a
    // slider because the width is otherwise impossible to discover: it used to
    // ride on the sidebar toggle, which reads only as "hide Trends".
    feedWidth: 1180,
    // Alternating post backgrounds. Only meaningful in the paper style, which
    // has opaque stock to alternate between.
    zebra: false
  });

  const styles = Object.freeze(['paper', 'glass']);

  const accents = Object.freeze({
    aurora: '151, 167, 255',
    ocean: '91, 204, 232',
    forest: '72, 211, 151',
    ruby: '244, 92, 108',
    rose: '239, 157, 198',
    amber: '244, 185, 82',
    silver: '176, 193, 213'
  });

  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  /* Returns a lowercase #rrggbb color, or null for anything else. */
  function colorHex(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim().toLowerCase();
    if (/^#[\da-f]{6}$/.test(hex)) return hex;
    if (/^#[\da-f]{3}$/.test(hex)) return '#' + [...hex.slice(1)].map(char => char + char).join('');
    return null;
  }

  const clamp = (number, min, max, fallback) =>
    Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;

  const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;

  /* Stored values may come from older versions or be corrupted: every field
     is validated independently, and missing fields take their default. */
  function normalize(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    return {
      enabled: boolean(value.enabled, defaults.enabled),
      style: styles.includes(value.style) ? value.style : defaults.style,
      accent: value.accent === 'custom' || Object.hasOwn(accents, value.accent) ? value.accent : defaults.accent,
      customColor: colorHex(value.customColor) || defaults.customColor,
      tint: clamp(value.tint, 0, 100, defaults.tint),
      blur: clamp(value.blur, 0, 40, defaults.blur),
      opacity: clamp(value.opacity, 0, 90, defaults.opacity),
      cards: boolean(value.cards, defaults.cards),
      lite: boolean(value.lite, defaults.lite),
      sidebar: boolean(value.sidebar, defaults.sidebar),
      feedWidth: clamp(value.feedWidth, 600, 1600, defaults.feedWidth),
      zebra: boolean(value.zebra, defaults.zebra)
    };
  }

  /* Linear blend from `from` towards `to`; amount 1 returns `to`. */
  const mix = (from, to, amount) => from.map((channel, i) => Math.round(channel * (1 - amount) + to[i] * amount));

  /* WCAG relative luminance of an sRGB triplet. */
  const luminance = channels => channels.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((total, channel, i) => total + channel * [.2126, .7152, .0722][i], 0);

  const toHex = channels => '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');

  const hexToRgb = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));

  const accentChannels = settings => settings.accent === 'custom'
    ? settings.customColor.slice(1).match(/../g).map(channel => parseInt(channel, 16))
    : accents[settings.accent].split(',').map(Number);

  /* Fades the accent towards `target` until `isReadable` holds, so very dark
     or very light custom colors still produce legible controls. */
  function readableVariant(rgb, target, isReadable) {
    let color = rgb, weight = 1;
    while (!isReadable(luminance(color)) && weight > 0) {
      weight -= .05;
      color = mix(target, rgb, Math.max(0, weight));
    }
    return color;
  }

  /* The paper style ignores the accent: it is a monochrome, print-inspired
     surface where a hue would break the editorial tone. Every card is opaque
     stock and the canvas behind it is X's own dark tone, so tint only ever
     lightens or darkens the paper, never colors it. */
  const paper = Object.freeze({
    // Warm, earthy paper: cream stock on a deep brown ground, sampled from the
    // reference. Deliberately not neutral: every value has red above blue.
    ink: [42, 32, 27],
    canvas: '#2c2421',
    canvasLight: '#d9cdb8',
    stock: [249, 244, 225],
    stockLight: [247, 245, 224],
    rule: [222, 207, 176],
    ruleLight: [205, 189, 158]
  });

  /* Ink stays legible on paper at every tint: past ~35% the tint has darkened
     the stock enough that a soft gray would fall below 4.5:1. */
  const ink = tint => mix(paper.ink, WHITE, Math.max(0, tint - .35) * .35);

  /* X draws the primary button's label in a fixed dark blue (#111b33), so the
     button itself must stay dark whatever the tint does to the stock. Paper's
     button is therefore a deep brown pill, not the tinted ink used for text:
     at tint 0 a tinted pill would leave that label at 1.1:1. */
  const control = Object.freeze({ end: [42, 32, 27], start: [74, 58, 49] });

  function paperPalette(settings, light) {
    const tint = settings.tint / 100;
    /* Paper must stay paper at every tint, because ink and stock converging
       would destroy the contrast the whole style depends on. Tint therefore
       never moves the stock; it moves how far the canvas behind the cards
       separates from it, and slightly deepens the rules and the ink. */
    const base = light ? paper.stockLight : paper.stock;
    /* The alternating stripe is a fixed small step off the stock rather than
       an absolute colour, so it stays a matched pair at every tint. 4% keeps
       the two shades reading as one palette; a larger step starts looking
       like two different card styles instead of a rhythm. */
    const alt = mix(base, BLACK, .04);
    /* Tint moves the canvas behind the cards, never the stock: white paper
       stays white while the surrounding page deepens. That keeps ink-on-stock
       contrast intact and gives the cards their edge. */
    const canvas = mix(
      hexToRgb(light ? paper.canvasLight : paper.canvas),
      light ? BLACK : WHITE,
      tint * (light ? .45 : .18)
    );
    const rule = mix(light ? paper.ruleLight : paper.rule, BLACK, tint * .3);
    const text = ink(tint);
    const fade = channels => channels.join(', ').replace(/\s+/g, '');
    return {
      accent: fade(text),
      hex: toHex(text),
      // Text and outline accent is the ink; the primary button is print black
      // with paper-white type, exactly like the reference's headline block.
      interfaceAccent: fade(text),
      interfaceHex: toHex(text),
      controlEnd: fade(control.end),
      controlStart: fade(control.start),
      base: fade(base),
      altStock: fade(alt),
      background: toHex(canvas),
      glowSecondary: fade(base),
      glowTertiary: fade(base),
      glowOpacity: '0',
      glowSecondaryOpacity: '0',
      glowTertiaryOpacity: '0',
      border: `rgba(${fade(rule)}, ${light ? .85 : .9})`
    };
  }

  /* Derives every themed color from the style, and for the glass style from
     the accent, tint and X's own tone. */
  function palette(value, tone = 'dark') {
    const settings = normalize(value);
    const light = tone === 'light';
    if (settings.style === 'paper') return paperPalette(settings, light);
    const rgb = accentChannels(settings);
    const strength = settings.tint / 100;
    const base = mix(light ? WHITE : [18, 20, 24], rgb, strength * (light ? .08 : .24));
    const background = mix(light ? [238, 242, 246] : [8, 10, 14], rgb, strength * (light ? .16 : .09));
    // Primary buttons render dark text on the accent gradient.
    const controlEnd = readableVariant(rgb, WHITE, value => value >= .25);
    // Accents used as text or outlines must contrast with the page.
    const interfaceAccent = light ? readableVariant(rgb, BLACK, value => value <= .3) : controlEnd;
    return {
      accent: rgb.join(', '),
      hex: toHex(rgb),
      interfaceAccent: interfaceAccent.join(', '),
      interfaceHex: toHex(interfaceAccent),
      controlEnd: controlEnd.join(', '),
      controlStart: controlEnd.map(channel => Math.round(channel * .55 + 255 * .45)).join(', '),
      base: base.join(', '),
      background: `rgb(${background.join(', ')})`,
      glowSecondary: mix(WHITE, rgb, .88).join(', '),
      glowTertiary: mix(WHITE, rgb, .96).join(', '),
      glowOpacity: String(strength * .4),
      glowSecondaryOpacity: String(strength * .27),
      glowTertiaryOpacity: String(strength * .24),
      border: `rgba(${mix([235, 235, 235], rgb, .15).join(', ')}, ${light ? .72 : .16})`
    };
  }

  return { storageKey, defaults, accents, styles, paper, normalize, colorHex, palette };
})();
