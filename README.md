# Lakso

A minimalist, clean interface for X.

Lakso is a fork of [XGlow](https://github.com/monteduro/xglow) by
[@monteduro](https://github.com/monteduro), restyled as a monochrome editorial
theme with a wide, centered feed. The upstream glass style and its color
presets remain available as a switch, so nothing upstream is removed.

- **Paper by default.** Opaque white cards on a flat dark canvas, hairline
  rules and square corners. No blur, no glow, no gradients.
- **Wide and centered.** The feed column runs to 1180px instead of X's 600px.
- **Monochrome, deliberately.** The paper style ignores theme color entirely;
  tint moves the canvas behind the cards rather than the cards themselves, so
  ink stays readable at every setting.
- **Glass still there.** Switch to Glass for the original translucent look and
  all seven color presets, plus any custom HEX.
- **Local and private.** No analytics, external services, API keys or account
  actions. Preferences stay on your device.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Reload your X tabs.

Chrome 111 or newer is required. There is no build step, account or API key.

## Development

Development tools require Node.js 20 or newer. There are no npm dependencies.

| Command | Purpose |
| --- | --- |
| `npm run check` | Check syntax, manifest assets and matching versions |
| `npm test` | Run Node tests |
| `npm run build:preview` | Generate the demo and browser suites in `public/` |

`npm test` includes one release-packaging test that shells out to the `zip`
binary; it fails if `zip` is not installed.

## Credit and license

MIT, unchanged from upstream. See [LICENSE](LICENSE).

The original project is [XGlow](https://github.com/monteduro/xglow). Lakso
reuses its architecture, selector plumbing and test harness; the paper style,
the wide layout and the popup's Style picker are additions here.

Internal identifiers (`data-xlg-*` attributes, `--xlg-*` custom properties, the
`XGlow` script global and the `xGlass` storage key) keep their upstream names on
purpose: renaming the storage key would orphan preferences from an existing
install.
