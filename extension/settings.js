/* Preferences and palette, shared by the content script and the popup.
   The XGlow global name and the xGlass storage key are deliberately kept:
   renaming them would orphan preferences saved by an existing install. */
globalThis.XGlow = (() => {
  const storageKey = 'xGlass';

  const defaults = Object.freeze({
    enabled: true,
    style: 'paper',
    // Which colour theme; see `themes`. Independent of the glass/paper style.
    theme: 'paper',
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

  /* ------------------------------------------------------------- Themes */

  /* Each theme is data, not code: a stock (card), a canvas (page behind the
     cards), an ink, and an accent. palette() derives every other colour from
     these, so a theme is one entry here plus a label in popup.html.

     `motion` selects the animation character (see glass.css): 'rise' lifts
     cards on hover, 'breathe' pulses the theme glow, 'sheen' sweeps a
     highlight, 'press' is the quiet default. All of them respect
     prefers-reduced-motion. */
  const themes = Object.freeze({
    paper: Object.freeze({
      label: 'Paper',
      stock: [249, 244, 225], canvas: [176, 168, 150], ink: [42, 32, 27],
      rule: [222, 207, 176], accent: [176, 106, 62], motion: 'press'
    }),
    cream: Object.freeze({
      label: 'Cream',
      stock: [253, 251, 246], canvas: [203, 199, 189], ink: [38, 35, 30],
      rule: [226, 220, 207], accent: [196, 138, 74], motion: 'rise'
    }),
    blush: Object.freeze({
      label: 'Blush',
      stock: [255, 249, 244], canvas: [215, 196, 194], ink: [58, 38, 40],
      rule: [238, 219, 213], accent: [214, 118, 106], motion: 'breathe'
    }),
    sage: Object.freeze({
      label: 'Sage',
      stock: [250, 250, 243], canvas: [196, 201, 182], ink: [44, 52, 38],
      rule: [216, 222, 200], accent: [124, 148, 92], motion: 'rise'
    }),
    dusk: Object.freeze({
      label: 'Dusk',
      stock: [32, 33, 38], canvas: [67, 67, 69], ink: [232, 230, 236],
      rule: [58, 59, 66], accent: [168, 152, 240], motion: 'breathe'
    }),
    amber: Object.freeze({
      label: 'Amber',
      stock: [43, 36, 28], canvas: [72, 69, 66], ink: [247, 236, 218],
      rule: [72, 59, 45], accent: [254, 175, 72], motion: 'sheen'
    })
  });

  const themeNames = Object.freeze(Object.keys(themes));

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
      theme: Object.hasOwn(themes, value.theme) ? value.theme : defaults.theme,
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

  /* Fades `rgb` towards `target` until `isReadable` holds. `isReadable`
     receives the candidate triplet, so callers can test real contrast rather
     than an absolute luminance: an absolute threshold exits immediately when
     the colour is already close to it, which is how a 3.0:1 accent got through.
     `legacyLuminance` predicates (which expect a number) are still accepted so
     the glass style keeps its original behaviour. */
  /* Fades `rgb` towards `target` until `isReadable(candidate)` holds, where
     `candidate` is an RGB triplet. Callers test real contrast rather than an
     absolute luminance: an absolute threshold exits at the first step whenever
     the colour already sits near it, which is how a 3.0:1 accent once got
     through. */
  function readableVariant(rgb, target, isReadable) {
    let color = rgb, weight = 1;
    while (!isReadable(color) && weight > 0) {
      weight -= .05;
      color = mix(target, rgb, Math.max(0, weight));
    }
    return color;
  }

  /* WCAG contrast between two channel triplets, used to keep an accent
     legible against its own stock. */
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + .05) / (lo + .05);
  }

  /* Themes are opaque by design: each one declares a stock (card), a canvas
     (the page behind the cards), an ink and an accent, and everything else is
     derived. `isDark` is read from the theme's own stock so a dark theme works
     whether X is in light or dark mode; the theme decides, not X. */
  const isDarkTheme = theme => luminance(theme.stock) < .4;

  /* Whether the active settings resolve to a dark stock, so callers can pick a
     shadow that reads against it without re-deriving the palette. */
  const settingsAreDark = value => {
    const settings = normalize(value);
    if (settings.style !== 'paper') return true;
    return isDarkTheme(themes[settings.theme]);
  };

  /* Ink stays legible on stock at every tint: past ~35% the tint has moved the
     stock far enough that a soft gray would fall below 4.5:1. */
  const inkFor = (theme, tint) => {
    const light = !isDarkTheme(theme);
    return mix(theme.ink, light ? WHITE : BLACK, Math.max(0, tint - .35) * .35);
  };

  /* The primary button is filled with the ink and labelled in the stock, so it
     reads as a solid pill in the theme's own colours. X hardcodes a dark
     label (#111b33) for its light glass gradient, which glass.css overrides. */
  const controlFor = (theme, ink) => {
    const light = !isDarkTheme(theme);
    return { end: ink, start: mix(ink, light ? BLACK : WHITE, .35) };
  };

  function themePalette(settings, theme) {
    const tint = settings.tint / 100;
    const dark = isDarkTheme(theme);
    /* Tint never moves the stock, because ink and stock converging would
       destroy the contrast the whole theme depends on. It moves the canvas
       behind the cards, so the cards keep their edge, and slightly deepens
       the rules and the ink. */
    const base = theme.stock;
    /* The alternating stripe is a fixed small step off the stock rather than
       an absolute colour, so it stays a matched pair at every tint. 4% keeps
       the two shades reading as one palette; a larger step starts looking
       like two different card styles instead of a rhythm. */
    const alt = mix(base, dark ? WHITE : BLACK, .04);
    const canvas = mix(theme.canvas, dark ? WHITE : BLACK, tint * (dark ? .18 : .3));
    const rule = mix(theme.rule, dark ? WHITE : BLACK, tint * .18);
    const text = inkFor(theme, tint);
    const control = controlFor(theme, text);
    /* The accent is used for links, the active tab and the new-posts pill, so
       it has to clear 4.5:1 against the stock. The test is real contrast, not
       an absolute luminance, so it holds for every theme. */
    const accent = readableVariant(
      theme.accent,
      dark ? WHITE : BLACK,
      candidate => contrast(candidate, base) >= 4.5
    );
    const fade = channels => channels.join(', ').replace(/\s+/g, '');
    return {
      accent: fade(accent),
      hex: toHex(accent),
      interfaceAccent: fade(text),
      interfaceHex: toHex(text),
      controlEnd: fade(control.end),
      controlStart: fade(control.start),
      base: fade(base),
      altStock: fade(alt),
      background: toHex(canvas),
      /* A soft glow built from the accent. Dusk and Amber use it for their
         ambient breathing motion; the quiet themes set it to zero. */
      glowSecondary: fade(mix(base, accent, dark ? .18 : .12)),
      glowTertiary: fade(mix(base, accent, dark ? .1 : .06)),
      glowOpacity: String(tint * (dark ? .5 : .32)),
      glowSecondaryOpacity: String(tint * (dark ? .34 : .22)),
      glowTertiaryOpacity: String(tint * (dark ? .3 : .2)),
      border: `rgba(${fade(rule)}, ${dark ? .55 : .8})`
    };
  }

  /* Derives every themed color. The paper style is theme-driven: the chosen
     theme supplies stock, canvas, ink and accent. The glass style keeps its
     original behaviour, deriving from the accent and X's own tone, so the two
     styles stay independent and a glass user's saved accent keeps working. */
  function palette(value, tone = 'dark') {
    const settings = normalize(value);
    const light = tone === 'light';
    if (settings.style === 'paper') return themePalette(settings, themes[settings.theme]);
    const rgb = accentChannels(settings);
    const strength = settings.tint / 100;
    const base = mix(light ? WHITE : [18, 20, 24], rgb, strength * (light ? .08 : .24));
    const background = mix(light ? [238, 242, 246] : [8, 10, 14], rgb, strength * (light ? .16 : .09));
    // Primary buttons render dark text on the accent gradient.
    const controlEnd = readableVariant(rgb, WHITE, candidate => luminance(candidate) >= .25);
    // Accents used as text or outlines must contrast with the page.
    const interfaceAccent = light ? readableVariant(rgb, BLACK, candidate => luminance(candidate) <= .3) : controlEnd;
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

  return { storageKey, defaults, accents, styles, themes, themeNames, normalize, colorHex, palette, contrast, settingsAreDark };
})();
