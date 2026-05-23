/** ApiManager class for handling API requests, responses, and interactions.
 * Note: Fetch spying is done in main.js, not here.
 * @class ApiManager
 * @since 0.11.1
 */

import TemplateManager from "./templateManager.js";
import { consoleError, escapeHTML, getTrackedWplaceTilePixel, installWplaceTilePixelTracker, localizeNumber, screenToWplaceTilePixel, serverTPtoDisplayTP } from "./utils.js";

export default class ApiManager {

  /** Constructor for ApiManager class
   * @param {TemplateManager} templateManager 
   * @since 0.11.34
   */
  constructor(templateManager) {
    this.templateManager = templateManager;
    this.disableAll = false; // Should the entire userscript be disabled?
    this.chargeRefillTimerID = ''; // Contains the Charge refill timer element ID attribute so we can update the timer.
    this.coordsTilePixel = []; // Contains the last detected tile/pixel coordinate pair requested
    this.templateCoordsTilePixel = []; // Contains the last "enabled" template coords
    this.userData = null; // Last received Wplace user data payload
    this.userDataPromise = null; // In-flight Wplace user data request
    this.boughtColorStorageKey = 'bmBoughtColorIDs'; // Persistent bought premium color cache
    this.boughtColorIDsCache = this.loadBoughtColorIDs(); // Last known bought premium color IDs
    this.jsonResponses = new Map(); // Recent JSON responses indexed by endpoint name
    this.templateEyedropperActiveUntil = 0; // Allows Blue Marble to override Wplace's next eyedropper result
    this.templateEyedropperActivationWindowMs = 15000; // Time after pressing/clicking Wplace's picker that a pixel response can be overridden
    this.templateEyedropperRetryDelays = [80, 180, 350]; // Re-applies selection if Wplace's async picker resolves after Blue Marble
    this.templateEyedropperNativeProbeDelays = [60, 160, 320, 600]; // Detects native picker results even when Wplace's picker button was not recognized
    this.templateEyedropperTrackerInstalled = false; // Prevents duplicate global listeners
    this.placementGuardTrackerInstalled = false; // Prevents duplicate placement guard listeners
    this.placementGuardFlag = 'ftr-placeGuard'; // User setting flag for wrong-color click blocking
    this.placementGuardEvents = ['pointerdown', 'mousedown', 'click', 'touchstart', 'touchend']; // Human map events that can start a placement
    this.placementGuardLastBlockAt = 0; // Throttles status noise when wrong-color clicks are blocked
    this.installTemplateEyedropperTracker();
    this.installPlacementGuard();
  }

  /** Tracks map coordinates and blocks wrong-color manual clicks when the placement guard is enabled.
   * @since 0.92.35
   */
  installPlacementGuard() {
    if (this.placementGuardTrackerInstalled) {return;}
    this.placementGuardTrackerInstalled = true;

    void installWplaceTilePixelTracker(this.templateManager?.tileSize || 1000, 11);
    for (const eventName of this.placementGuardEvents) {
      document.addEventListener(eventName, event => this.handlePlacementGuardEvent(event), true);
    }
  }

  /** Checks whether the wrong-color placement guard is enabled.
   * @returns {boolean}
   * @since 0.92.35
   */
  isPlacementGuardEnabled() {
    return !!this.templateManager?.settingsManager?.userSettings?.flags?.includes(this.placementGuardFlag);
  }

  /** Returns the single visible paintable color, or null when the filter state is not narrow enough.
   * @returns {number | null}
   * @since 0.92.35
   */
  getSingleVisibleTemplateColorID() {
    const visibleColorIDs = this.templateManager?.getVisibleTemplateColorIDs?.({paintableOnly: true}) ?? [];
    return (visibleColorIDs.length == 1) ? visibleColorIDs[0] : null;
  }

  /** Stops Wplace from receiving a wrong-color placement event.
   * @param {Event} event - Pointer/mouse/touch event
   * @since 0.92.35
   */
  blockPlacementEvent(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();

    if ((Date.now() - this.placementGuardLastBlockAt) > 1800) {
      this.placementGuardLastBlockAt = Date.now();
      console.log('Blue Marble: blocked a wrong-color manual placement while placement guard is enabled.');
    }
  }

  /** Blocks manual map clicks that do not match the one visible template color.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {boolean} Whether the event was blocked
   * @since 0.92.35
   */
  handlePlacementGuardEvent(event) {
    if (!event.isTrusted || !this.isPlacementGuardEnabled()) {return false;}
    if (this.isWplaceColorPickerActive()) {return false;}
    if (event.button && event.button != 0) {return false;}

    const target = event.target instanceof Element ? event.target : null;
    if (!target || !this.isWplaceMapClickTarget(target)) {return false;}

    const activeColorID = this.getSingleVisibleTemplateColorID();
    if (activeColorID == null) {return false;}

    const selectedColorID = Number(localStorage.getItem('selected-color'));
    if (Number.isInteger(selectedColorID) && (selectedColorID != activeColorID)) {
      this.blockPlacementEvent(event);
      return true;
    }

    const point = this.getEventClientPoint(event);
    if (!point) {return false;}

    const coords = getTrackedWplaceTilePixel(point.clientX, point.clientY);
    if (!coords) {return false;}

    const templateColor = this.templateManager?.getTemplateColorAtTilePixel?.(
      coords.tile?.[0],
      coords.tile?.[1],
      coords.pixel?.[0],
      coords.pixel?.[1]
    );

    if (!templateColor || (templateColor.colorID != activeColorID)) {
      this.blockPlacementEvent(event);
      return true;
    }

    return false;
  }

  /** Gets the viewport coordinate for pointer/mouse/touch events.
   * @param {Event} event - DOM event
   * @returns {{clientX: number, clientY: number} | null}
   * @since 0.92.35
   */
  getEventClientPoint(event) {
    const touch = event.changedTouches?.[0] || event.touches?.[0];
    const clientX = Number(touch?.clientX ?? event.clientX);
    const clientY = Number(touch?.clientY ?? event.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {return null;}
    return {clientX, clientY};
  }

  /** Tracks likely Wplace eyedropper activation without depending on internal Svelte state.
   * @since 0.92.35
   */
  installTemplateEyedropperTracker() {
    if (this.templateEyedropperTrackerInstalled) {return;}
    this.templateEyedropperTrackerInstalled = true;

    const markPickerActive = () => {
      this.templateEyedropperActiveUntil = Date.now() + this.templateEyedropperActivationWindowMs;
    };
    const clearPickerActive = () => {
      this.templateEyedropperActiveUntil = 0;
    };

    document.addEventListener('keydown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {return;}
      if (event.code == 'KeyI') {markPickerActive();}
      if (event.code == 'KeyE') {clearPickerActive();}
    }, true);

    document.addEventListener('keypress', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {return;}
      if (event.code == 'KeyI') {markPickerActive();}
      if (event.code == 'KeyE') {clearPickerActive();}
    }, true);

    for (const eventName of ['pointerdown', 'mousedown', 'touchstart']) {
      document.addEventListener(eventName, event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {return;}
        if (target.closest('[id^="color-"]')) {
          clearPickerActive();
          return;
        }
        if (this.isWplaceColorPickerControl(target)) {markPickerActive();}
      }, true);
    }

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {return;}
      const selectedColorBeforeClick = localStorage.getItem('selected-color');

      if (target.closest('[id^="color-"]')) {
        clearPickerActive();
        return;
      }

      if (this.isWplaceColorPickerControl(target)) {markPickerActive();}

      if (!this.isWplaceMapClickTarget(target)) {return;}
      const wasPickerActive = this.isWplaceColorPickerActive();
      if (wasPickerActive) {markPickerActive();}

      void screenToWplaceTilePixel(
        event.clientX,
        event.clientY,
        this.templateManager?.tileSize || 1000,
        11
      ).then(coords => {
        if (!coords) {return;}
        if (wasPickerActive || this.isWplaceColorPickerActive()) {
          this.selectTemplateColorAtCoords(coords.tile, coords.pixel);
          return;
        }

        this.selectTemplateColorAfterNativePickerChange(coords.tile, coords.pixel, selectedColorBeforeClick);
      });
    }, true);
  }

  /** Checks whether an element is part of Wplace's MapLibre map surface.
   * @param {Element} element - Click target
   * @returns {boolean}
   * @since 0.92.35
   */
  isWplaceMapClickTarget(element) {
    return !!(
      element.matches?.('.maplibregl-canvas')
      || element.closest?.('.maplibregl-canvas-container')
      || element.closest?.('.maplibregl-map')
    );
  }

  /** Checks whether an element looks like Wplace's color picker control.
   * @param {Element} element - Click target or candidate element
   * @returns {boolean}
   * @since 0.92.35
   */
  isWplaceColorPickerControl(element) {
    const labels = [
      'color picker',
      'colorpicker',
      'eyedropper',
      'pick color',
      'pick colour',
      'sample color',
      'conta gotas',
      'cuentagotas',
      'gotero',
      '取色器',
      'farbpipette',
      'selector de color',
      'seleccionar color',
      'pipette',
      'contagocce',
      'カラーピッカー',
      'próbnik kolorów',
      'пипетка',
      'bảng chọn màu'
    ];
    const candidates = [
      element,
      element.closest?.('.tooltip'),
      element.closest?.('button')
    ].filter(Boolean);

    return candidates.some(candidate => {
      const text = [
        candidate.getAttribute?.('data-tip'),
        candidate.getAttribute?.('title'),
        candidate.getAttribute?.('aria-label'),
        candidate.textContent
      ].filter(Boolean).join(' ').toLowerCase();

      return labels.some(label => text.includes(label));
    });
  }

  /** Checks whether Wplace's eyedropper appears to be the active tool.
   * @returns {boolean}
   * @since 0.92.35
   */
  isWplaceColorPickerActive() {
    if (Date.now() <= this.templateEyedropperActiveUntil) {return true;}

    for (const tooltip of document.querySelectorAll('.tooltip[data-tip], [title], [aria-label]')) {
      if (!this.isWplaceColorPickerControl(tooltip)) {continue;}
      const control = tooltip.closest?.('button, [role="button"]') || tooltip;
      if (
        control.matches?.('.btn-primary, .btn-active, .active, .selected, [aria-pressed="true"], [data-active="true"], [data-selected="true"]')
        || control.querySelector?.('.btn-primary, .btn-active, .active, .selected, [aria-pressed="true"], [data-active="true"], [data-selected="true"]')
      ) {return true;}
    }

    return false;
  }

  /** Selects a Wplace palette color by clicking its live palette button.
   * @param {number} colorID - Blue Marble/Wplace palette color ID
   * @returns {boolean} Whether the color can be selected from the current DOM
   * @since 0.92.35
   */
  selectWplacePaletteColor(colorID) {
    const wplaceColorID = (colorID == -1) ? 0 : Number(colorID);
    if (!Number.isInteger(wplaceColorID) || (wplaceColorID < 0) || (wplaceColorID > 63)) {return false;}

    const expectedColorID = wplaceColorID.toString();
    const select = (force = false) => {
      const colorElement = document.getElementById(`color-${expectedColorID}`);
      if (!colorElement) {
        localStorage.setItem('selected-color', expectedColorID);
        return false;
      }

      if (!force && (localStorage.getItem('selected-color') == expectedColorID)) {
        colorElement.focus?.();
        return true;
      }

      if (colorElement instanceof HTMLButtonElement && colorElement.disabled) {return false;}

      colorElement.click();
      colorElement.focus?.();
      return true;
    };

    const selected = select(true);
    for (const delay of this.templateEyedropperRetryDelays) {
      setTimeout(() => select(false), delay);
    }

    return selected;
  }

  /** Corrects Wplace's native picker result when the click changed the selected palette color.
   * This fallback avoids depending entirely on Wplace's picker button markup.
   * @param {Array<string|number>} coordsTile - Wplace tile coordinates
   * @param {Array<string|number>} coordsPixel - Wplace pixel coordinates
   * @param {string | null} selectedColorBeforeClick - Palette color selected before the map click
   * @returns {boolean} Whether a correction was scheduled
   * @since 0.92.35
   */
  selectTemplateColorAfterNativePickerChange(coordsTile, coordsPixel, selectedColorBeforeClick) {
    const templateColor = this.templateManager?.getTemplateColorAtTilePixel?.(
      coordsTile?.[0],
      coordsTile?.[1],
      coordsPixel?.[0],
      coordsPixel?.[1]
    );
    if (!templateColor || (templateColor.colorID == -2)) {return false;}

    const previousColor = selectedColorBeforeClick == null ? null : String(selectedColorBeforeClick);
    const expectedColor = String((templateColor.colorID == -1) ? 0 : templateColor.colorID);

    for (const delay of this.templateEyedropperNativeProbeDelays) {
      setTimeout(() => {
        const currentColor = localStorage.getItem('selected-color');
        if (currentColor == null || currentColor == previousColor || currentColor == expectedColor) {return;}
        this.selectWplacePaletteColor(templateColor.colorID);
      }, delay);
    }

    return true;
  }

  /** Selects the visible template color at a tile/pixel coordinate.
   * @param {Array<string|number>} coordsTile - Wplace tile coordinates
   * @param {Array<string|number>} coordsPixel - Wplace pixel coordinates
   * @returns {boolean} Whether Blue Marble selected a template color
   * @since 0.92.35
   */
  selectTemplateColorAtCoords(coordsTile, coordsPixel) {
    const templateColor = this.templateManager?.getTemplateColorAtTilePixel?.(
      coordsTile?.[0],
      coordsTile?.[1],
      coordsPixel?.[0],
      coordsPixel?.[1]
    );
    this.templateEyedropperActiveUntil = 0;

    if (!templateColor || (templateColor.colorID == -2)) {return false;}

    return this.selectWplacePaletteColor(templateColor.colorID);
  }

  /** Overrides Wplace's eyedropper result with the visible template pixel color when possible.
   * @param {Array<string|number>} coordsTile - Wplace tile coordinates
   * @param {Array<string|number>} coordsPixel - Wplace pixel coordinates
   * @returns {boolean} Whether Blue Marble selected a template color
   * @since 0.92.35
   */
  selectTemplateColorForEyedropper(coordsTile, coordsPixel) {
    if (!this.isWplaceColorPickerActive()) {return false;}
    return this.selectTemplateColorAtCoords(coordsTile, coordsPixel);
  }

  /** Loads bought premium color IDs from userscript storage.
   * @returns {Set<number> | null}
   * @since 0.92.23
   */
  loadBoughtColorIDs() {
    try {
      const payload = JSON.parse(GM_getValue(this.boughtColorStorageKey, 'null'));
      if (!payload || !Array.isArray(payload.ids)) {return null;}
      return new Set(payload.ids.map(Number).filter(id => Number.isInteger(id) && id >= 32 && id <= 63));
    } catch (error) {
      console.warn(`Blue Marble: Could not load bought color cache: ${error?.message || error}`);
      return null;
    }
  }

  /** Saves bought premium color IDs to userscript storage.
   * @param {Set<number>|number[]} ids - Bought premium color IDs
   * @param {string} source - Where the color list came from
   * @since 0.92.23
   */
  saveBoughtColorIDs(ids, source = 'unknown') {
    const cleanIDs = Array.from(ids || [])
      .map(Number)
      .filter(id => Number.isInteger(id) && id >= 32 && id <= 63)
      .sort((left, right) => left - right);
    this.boughtColorIDsCache = new Set(cleanIDs);
    void GM.setValue(this.boughtColorStorageKey, JSON.stringify({
      ids: cleanIDs,
      source: source,
      updatedAt: Date.now()
    }));
  }

  /** Fetches Wplace user data when the page has not already requested it.
   * @returns {Promise<Object | null>}
   * @since 0.92.19
   */
  async ensureUserData() {
    if (this.userData) {return this.userData;}
    if (this.userDataPromise) {return await this.userDataPromise;}

    if (typeof GM_xmlhttpRequest != 'function') {return null;}

    this.userDataPromise = new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://backend.wplace.live/me',
        withCredentials: true,
        responseType: 'json',
        onload: (response) => {
          try {
            const dataJSON = response.response || JSON.parse(response.responseText || '{}');
            if (dataJSON?.status && dataJSON.status?.toString()[0] != '2') {return resolve(null);}
            this.userData = dataJSON;
            this.jsonResponses.set('me', dataJSON);
            if (Array.isArray(dataJSON.unlocked_colors)) {this.saveBoughtColorIDs(dataJSON.unlocked_colors, 'me');}
            return resolve(this.userData);
          } catch (error) {
            console.warn(`Blue Marble: Could not parse user data for bought colors: ${error?.message || error}`);
            return resolve(null);
          }
        },
        onerror: () => resolve(null),
        ontimeout: () => resolve(null)
      });
    });

    const userData = await this.userDataPromise;
    this.userDataPromise = null;
    return userData;
  }

  /** Determines if the spontaneously received response is something we want.
   * Otherwise, we can ignore it.
   * Note: Due to aggressive compression, make your calls like `data['jsonData']['name']` instead of `data.jsonData.name`
   * 
   * @param {Overlay} overlay - The Overlay class instance
   * @since 0.11.1
  */
  spontaneousResponseListener(overlay) {

    // Triggers whenever a message is sent
    window.addEventListener('message', async (event) => {

      const data = event.data; // The data of the message
      const dataJSON = data['jsonData']; // The JSON response, if any

      // Kills itself if the message was not intended for Blue Marble
      if (!(data && data['source'] === 'blue-marble')) {return;}

      // Kills itself if the message has no endpoint (intended for Blue Marble, but not this function)
      if (!data['endpoint']) {return;}

      // Trims endpoint to the second to last non-number, non-null directoy.
      // E.g. "wplace.live/api/pixel/0/0?payload" -> "pixel"
      // E.g. "wplace.live/api/files/s0/tiles/0/0/0.png" -> "tiles"
      const endpointText = data['endpoint']?.split('?')[0].split('/').filter(s => s && isNaN(Number(s))).filter(s => s && !s.includes('.')).pop();
      if (dataJSON && typeof dataJSON == 'object') {
        this.jsonResponses.set(endpointText, dataJSON);
      }

      if (this.templateManager.renderPerfDebug) {
        console.log(`%cBlue Marble%c: Recieved message about "%s"`, 'color: cornflowerblue;', '', endpointText);
      }

      // Each case is something that Blue Marble can use from the fetch.
      // For instance, if the fetch was for "me", we can update the overlay stats
      switch (endpointText) {

        case 'me': // Request to retrieve user data

          // If the game can not retrieve the userdata...
          if (dataJSON['status'] && dataJSON['status']?.toString()[0] != '2') {
            // The server is probably down (NOT a 2xx status)
            
            overlay.handleDisplayError(`You are not logged in or Wplace is offline!\nCould not fetch userdata.`);
            return; // Kills itself before attempting to display null userdata
          }

          this.userData = dataJSON;
          if (Array.isArray(dataJSON.unlocked_colors)) {this.saveBoughtColorIDs(dataJSON.unlocked_colors, 'me');}

          const nextLevelPixels = Math.ceil(Math.pow(Math.floor(dataJSON['level']) * Math.pow(30, 0.65), (1/0.65)) - dataJSON['pixelsPainted']); // Calculates pixels to the next level

          this.templateManager.userID = dataJSON['id'];

          // Obtains the refill timer for charges
          if (this.chargeRefillTimerID.length != 0) {
            const chargeRefillTimer = document.querySelector('#' + this.chargeRefillTimerID);
            
            // If the refill timer exists...
            if (chargeRefillTimer) {
              
              /** Obtains the information about the user's charges @type {{cooldownMs: number, count: number, max: number}} */
              const chargeData = dataJSON['charges'];
  
              // Date that the user's charges will be refilled
              chargeRefillTimer.dataset['endDate'] = Date.now() + ((chargeData['max'] - chargeData['count']) * chargeData['cooldownMs']);
            }
          }

          // Updates displayed droplet information
          overlay.updateInnerHTML('bm-user-droplets', `Droplets: <b>${localizeNumber(dataJSON['droplets'])}</b>`); // Updates the text content of the droplets field
          overlay.updateInnerHTML('bm-user-nextlevel', `Next level in <b>${localizeNumber(nextLevelPixels)}</b> pixel${nextLevelPixels == 1 ? '' : 's'}`); // Updates the text content of the next level field
          break;

        case 'pixel': // Request to retrieve pixel data
          const coordsTile = data['endpoint'].split('?')[0].split('/').filter(s => s && !isNaN(Number(s))); // Retrieves the tile coords as [x, y]
          const payloadExtractor = new URLSearchParams(data['endpoint'].split('?')[1]); // Declares a new payload deconstructor and passes in the fetch request payload
          const coordsPixel = [payloadExtractor.get('x'), payloadExtractor.get('y')]; // Retrieves the deconstructed pixel coords from the payload
          
          // Don't save the coords if there are previous coords that could be used
          if (this.coordsTilePixel.length && (!coordsTile.length || !coordsPixel.length)) {
            overlay.handleDisplayError(`Coordinates are malformed!\nDid you try clicking the canvas first?`);
            return; // Kills itself
          }
          
          this.coordsTilePixel = [...coordsTile, ...coordsPixel]; // Combines the two arrays such that [x, y, x, y]
          this.selectTemplateColorForEyedropper(coordsTile, coordsPixel); // If Wplace's eyedropper was active, prefer the visible template color

          const displayTP = serverTPtoDisplayTP(coordsTile, coordsPixel); // Retrieves the coordinates that Wplace displays for this region

          const spanElements = document.querySelectorAll('span'); // Retrieves all span elements

          // For every span element, find the one we want (pixel numbers when canvas clicked)
          for (const element of spanElements) {
            // We use the pixel numbers to find this element because it is the only identifiable piece of information, assuming the website can load in non-Engligh languages.

            const elementTextTrimmed = element.textContent.trim(); // Stores the text of the span element, without leading or trailing spaces

            // If the text content of the element includes both coordinates seperatly (avoids failure when the comma seperator changes due to localization)
            if (elementTextTrimmed.includes(displayTP[0]) && elementTextTrimmed.includes(displayTP[1])) {

              let displayCoords = document.querySelector('#bm-display-coords'); // Find the additional pixel coords span

              const text = `(Tl X: ${coordsTile[0]}, Tl Y: ${coordsTile[1]}, Px X: ${coordsPixel[0]}, Px Y: ${coordsPixel[1]})`;
              
              // All 4 coordinate labels, IDs, and values
              const coordsLabel = ['Tl X:', 'Tl Y:', 'Px X:', 'Px Y:'];
              const coordsID = ['bm-tile-x', 'bm-tile-y', 'bm-pixel-x', 'bm-pixel-y'];
              const coordsCombined = [...coordsTile, ...coordsPixel];

              // If we could not find the addition coord span, we make it then update the textContent with the new coords
              if (!displayCoords) {
                displayCoords = document.createElement('span');
                displayCoords.id = 'bm-display-coords';
                displayCoords.style = 'display: flex; flex-wrap: wrap; gap: 0 1ch; font-size: small;';

                // For each of the 4 coordinates...
                for (const [coordIndex, coordValue] of coordsCombined.entries()) {

                  const coordElement = document.createElement('span'); // Creates a `<span>` element

                  coordElement.id = coordsID[coordsCombined.indexOf(coordValue) ?? '']; // Applys the ID to the coord element

                  // Outputs something like "Tl X: 483"
                  coordElement.textContent = `${coordsLabel[coordIndex] ?? '??:'} ${coordValue}`;
                  // Or if the amount of labels is less than the provided values, it outputs something like "??: 483" instead of failing

                  displayCoords.appendChild(coordElement); // Adds the span coordinate as a child for the flexbox container
                }

                // Adds the display coordinate flexbox container to the pixel info menu
                element.parentNode.parentNode.parentNode.insertAdjacentElement('afterend', displayCoords);
              } else {
                
                // For each of the 4 coordinates...
                for (const [coordIndex, coordID] of coordsID.entries()) {

                  const coordElement = document.getElementById(coordID); // Obtains the coordinate element

                  // Outputs something like "Tl X: 483"
                  coordElement.textContent = `${coordsLabel[coordIndex] ?? '??:'} ${coordsCombined[coordIndex]}`;
                  // Or if the amount of labels is less than the provided values, it outputs something like "??: 483" instead of failing
                }
              }
            }
          }
          break;
        
        case 'tile':
        case 'tiles':

          let tileCoordsTile = data['endpoint'].split('/');
          tileCoordsTile = [parseInt(tileCoordsTile[tileCoordsTile.length - 2]), parseInt(tileCoordsTile[tileCoordsTile.length - 1].replace('.png', ''))];
          
          const blobUUID = data['blobID'];
          const blobData = data['blobData'];
          
          const templateBlob = await this.templateManager.drawTemplateOnTile(blobData, tileCoordsTile);

          window.postMessage({
            source: 'blue-marble',
            blobID: blobUUID,
            blobData: templateBlob,
            blink: data['blink']
          });
          break;

        case 'robots': // Request to retrieve what script types are allowed
          this.disableAll = dataJSON['userscript']?.toString().toLowerCase() == 'false'; // Disables Blue Marble if site owner wants userscripts disabled
          break;
      }
    });
  }

  // Sends a heartbeat to the telemetry server
  async sendHeartbeat(version) {

    let userSettings = GM_getValue('bmUserSettings', '{}')
    userSettings = JSON.parse(userSettings);

    if (!userSettings || !userSettings.telemetry || !userSettings.uuid) {
      return; // If telemetry is disabled, do not send heartbeat
    }

    const ua = navigator.userAgent;
    let browser = await this.getBrowserFromUA(ua);
    let os = this.getOS(ua);

    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://telemetry.thebluecorner.net/heartbeat',
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        uuid: userSettings.uuid,
        version: version,
        browser: browser,
        os: os,
      }),
      onload: (response) => {
        if (response.status !== 200) {
          consoleError('Failed to send heartbeat:', response.statusText);
        }
      },
      onerror: (error) => {
        consoleError('Error sending heartbeat:', error);
      }
    });
  }

  async getBrowserFromUA(ua = navigator.userAgent) {
    ua = ua || "";

    // Opera
    if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";

    // Edge (Chromium-based uses "Edg/")
    if (ua.includes("Edg/")) return "Edge";

    // Vivaldi
    if (ua.includes("Vivaldi")) return "Vivaldi";

    // Yandex
    if (ua.includes("YaBrowser")) return "Yandex";

    // Kiwi (not guaranteed, but typically shows "Kiwi")
    if (ua.includes("Kiwi")) return "Kiwi";

    // Brave (doesn't expose in UA by default; heuristic via Brave/ token in some versions)
    if (ua.includes("Brave")) return "Brave";

    // Firefox
    if (ua.includes("Firefox/")) return "Firefox";

    // Chrome (catch-all for Chromium browsers)
    if (ua.includes("Chrome/")) return "Chrome";

    // Safari (must be after Chrome check)
    if (ua.includes("Safari/")) return "Safari";

    // Brave special check
    if (navigator.brave && typeof navigator.brave.isBrave === "function") {
      if (await navigator.brave.isBrave()) return "Brave";
    }

    // Fallback
    return 'Unknown';
  }

  getOS(ua = navigator.userAgent) {
    ua = ua || "";

    if (/Windows NT 11/i.test(ua)) return "Windows 11";
    if (/Windows NT 10/i.test(ua)) return "Windows 10";
    if (/Windows NT 6\.3/i.test(ua)) return "Windows 8.1";
    if (/Windows NT 6\.2/i.test(ua)) return "Windows 8";
    if (/Windows NT 6\.1/i.test(ua)) return "Windows 7";
    if (/Windows NT 6\.0/i.test(ua)) return "Windows Vista";
    if (/Windows NT 5\.1|Windows XP/i.test(ua)) return "Windows XP";

    if (/Mac OS X 10[_\.]15/i.test(ua)) return "macOS Catalina";
    if (/Mac OS X 10[_\.]14/i.test(ua)) return "macOS Mojave";
    if (/Mac OS X 10[_\.]13/i.test(ua)) return "macOS High Sierra";
    if (/Mac OS X 10[_\.]12/i.test(ua)) return "macOS Sierra";
    if (/Mac OS X 10[_\.]11/i.test(ua)) return "OS X El Capitan";
    if (/Mac OS X 10[_\.]10/i.test(ua)) return "OS X Yosemite";
    if (/Mac OS X 10[_\.]/i.test(ua)) return "macOS"; // Generic fallback

    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";

    if (/Linux/i.test(ua)) return "Linux";

    return "Unknown";
  }
}
