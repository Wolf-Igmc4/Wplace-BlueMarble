# Architecture

Blue Marble is bundled as a single userscript, but the source is organized into explicit layers so browser/userscript APIs do not leak through the application.

## Layers

- `src/main.js` is only the userscript entrypoint. It starts the application and should stay thin.
- `src/app/` wires the application together. `BlueMarbleApp` owns startup order, manager construction, telemetry prompt setup, CSS/font installation, and saved template loading.
- `src/infrastructure/userscript/` contains adapters for Tampermonkey/Greasemonkey APIs such as storage, downloads, resources, styles, and cross-origin requests.
- `src/infrastructure/wplace/` contains integration boundaries for Wplace-specific behavior. Fetch spying, the palette move button, and the map/page bridge facade live here.
- `src/domain/` contains browser-light business rules that were split out of the largest coordinators:
  - `src/domain/templates/` owns template storage rules, progress-cache persistence, and rendered tile cache/encoding.
  - `src/domain/colorFilter/` owns Color Filter view preference normalization, aggregate progress statistics, and premium-color purchase detection.
- `src/Window*.js` and `src/Overlay.js` are UI modules. They should build and update interface state, delegating storage, network, and Wplace integration through managers or infrastructure facades.
- `src/templateManager.js`, `src/Template.js`, `src/apiManager.js`, and `src/settingsManager.js` remain the main application managers. They should coordinate domain services rather than owning storage/cache/statistics rules directly.
- `src/utils.js` still contains shared utilities and some legacy Wplace bridge implementation. New application code should import Wplace integration through `src/infrastructure/wplace/wplaceBridge.js` while the remaining legacy helpers are gradually moved behind that boundary.

## Dependency Direction

Dependencies should flow inward like this:

`main.js` -> `app` -> `UI/application managers` -> `domain utilities`

Infrastructure is called through facades:

- Userscript APIs: `src/infrastructure/userscript/userscriptRuntime.js`
- Wplace page/map APIs: `src/infrastructure/wplace/*`

Avoid adding new direct calls to `GM_getValue`, `GM.setValue`, `GM_xmlhttpRequest`, `GM_addStyle`, `GM_getResourceText`, `GM.download`, or Wplace page bridge helpers outside the infrastructure layer.

## Performance Notes

- The fetch proxy now times out stuck image-blob processing and returns the original image instead of leaving Wplace tile requests pending indefinitely.
- The palette move-button observer is throttled through `requestAnimationFrame`, so heavy DOM mutation bursts do not repeatedly query and modify the palette in the same frame.
- Pixel coordinate display updates reuse the existing Blue Marble coordinate DOM when available. The expensive fallback scan across Wplace `span` elements only runs until the coordinate display is created.

## Build

Run the normal build after architecture changes:

```sh
npm run build
```

The build regenerates files in `dist/`; do not stage changes automatically.
