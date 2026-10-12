/* Preferences and palette, shared by the content script and the popup.
   The XGlow global name and the xGlass storage key are deliberately kept:
   renaming them would orphan preferences saved by an existing install. */
globalThis.XGlow = (() => {
  const storageKey = 'xGlass';

  const defaults = Object.freeze({
    enabled: true,
    // The theme is the design: material, spacing, type, motion and palette.
    theme: 'glass',
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

  /* A theme is a complete design, not a recolour. Each one declares:

       surface   how a card is built: its material, radius and shadow model
       spacing   the rhythm of the feed (card padding and the gap between them)
       type      the typographic scale for post bodies
       motion    the animation character, consumed by glass.css
       palette   stock (card), canvas (page behind), ink, rule and accent

     glass.css keys every structural rule off data-xlg-theme, so a theme can
     restyle the feed without touching the others. Anything a theme does not
     override falls back to the glass baseline, which stays as upstream wrote
     it. Colours are derived by palette(), so a theme states intent rather than
     a list of hex values.

     `material` selects the surface treatment in glass.css:
       glass  translucent, blurred, rounded, lit by an inner highlight
       slab   opaque panels, tight radius, defined by elevation
       line   flat, no radius, defined by hairlines
       solid  opaque, generous radius, defined by a soft shadow
       frame  opaque with a heavy border and a hard offset shadow
       dim    dark translucent, low contrast, minimal chrome
  */
  const themes = Object.freeze({
    glass: Object.freeze({
      label: 'Glass',
      material: 'glass',
      motion: 'rise',
      radius: 22,
      padding: [18, 16],
      gap: 10,
      leading: 1.5,
      body: 15,
      stock: [45, 40, 31], canvas: [19, 18, 17], ink: [233, 235, 238],
      rule: [236, 228, 212], accent: [244, 185, 82]
    }),
    amber: Object.freeze({
      label: 'Amber',
      material: 'glass',
      motion: 'sheen',
      radius: 20,
      padding: [18, 16],
      gap: 10,
      leading: 1.5,
      body: 15,
      stock: [52, 40, 24], canvas: [22, 17, 12], ink: [247, 236, 218],
      rule: [120, 92, 56], accent: [254, 175, 72]
    }),
    mono: Object.freeze({
      label: 'Mono',
      material: 'line',
      motion: 'press',
      radius: 0,
      padding: [16, 18],
      gap: 0,
      leading: 1.45,
      body: 14,
      stock: [24, 25, 27], canvas: [43, 45, 49], ink: [226, 229, 233],
      rule: [58, 61, 66], accent: [150, 200, 255]
    }),
    soft: Object.freeze({
      label: 'Soft',
      material: 'solid',
      motion: 'rise',
      radius: 26,
      padding: [22, 22],
      gap: 14,
      leading: 1.62,
      body: 16,
      stock: [255, 253, 250], canvas: [219, 208, 197], ink: [56, 46, 42],
      rule: [231, 220, 209], accent: [206, 128, 104]
    }),
    frame: Object.freeze({
      label: 'Frame',
      material: 'frame',
      motion: 'press',
      radius: 12,
      padding: [20, 18],
      gap: 16,
      leading: 1.55,
      body: 15,
      stock: [255, 251, 240], canvas: [226, 214, 188], ink: [26, 24, 22],
      rule: [26, 24, 22], accent: [222, 88, 60]
    }),
    dim: Object.freeze({
      label: 'Dim',
      material: 'dim',
      motion: 'breathe',
      radius: 16,
      padding: [20, 18],
      gap: 8,
      leading: 1.58,
      body: 15,
      stock: [30, 33, 39], canvas: [18, 20, 24], ink: [205, 212, 222],
      rule: [60, 67, 78], accent: [122, 162, 247]
    })
  });

  const themeNames = Object.freeze(Object.keys(themes));


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
      theme: Object.hasOwn(themes, value.theme) ? value.theme : defaults.theme,
      /* Retired: the theme system derives its own accent, so this is kept only
         so an existing install's saved preferences normalise cleanly and the
         key is not rewritten. It is still validated, because an unvalidated
         string sitting in storage is one careless future `style.` assignment
         away from being injectable CSS.

         The typeof check is load-bearing: RegExp.test coerces its argument, so
         `.test(undefined)` tests the string "undefined" -- nine lowercase
         letters that match this pattern perfectly. Without it every missing
         value validated as well-formed and came back out as undefined. */
      accent: typeof value.accent === 'string' && /^[a-z]{3,12}$/.test(value.accent)
        ? value.accent
        : defaults.accent,
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
      border: `rgba(${fade(rule)}, ${dark ? .55 : .8})`,
      /* Structural tokens: a theme restyles the feed's geometry, not just its
         colour. glass.css reads these, so spacing and type belong to the theme
         rather than being hardcoded per rule. */
      material: theme.material,
      radius: `${theme.radius}px`,
      cardPadding: `${theme.padding[0]}px ${theme.padding[1]}px`,
      cardGap: `${theme.gap}px`,
      leading: String(theme.leading),
      bodySize: `${theme.body}px`
    };
  }

  /* Derives every themed value for the active theme. There is a single axis
     now: `theme` is the design, so there is no separate style branch. The
     glass baseline is simply the `glass` theme, and its palette is derived the
     same way as the others so nothing can drift. */
  function palette(value, tone = 'dark') {
    const settings = normalize(value);
    void tone;
    return themePalette(settings, themes[settings.theme]);
  }

  return { storageKey, defaults, themes, themeNames, normalize, colorHex, palette, contrast, settingsAreDark };
})();
