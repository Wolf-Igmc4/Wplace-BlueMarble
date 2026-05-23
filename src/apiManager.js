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
    this.placementGuardEventListenersInstalled = false; // Prevents duplicate placement guard event listeners
    this.placementGuardFlag = 'ftr-placeGuard'; // User setting flag for wrong-color click blocking
    this.placementGuardEvents = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend']; // Human map events that can start a placement
    this.placementGuardLastBlockAt = 0; // Throttles status noise when wrong-color clicks are blocked
    this.placementGuardSpaceHeld = false; // Wplace can place continuously while Space is held
    this.placementGuardSpacePlacementAllowed = false; // Whether the current Space hold is still on a safe path
    this.placementGuardSpaceCancelledUntilKeyup = false; // Requires releasing Space after leaving the safe path
    this.placementGuardSyntheticSpaceReleaseUntil = 0; // Lets synthetic keyup reach Wplace without changing our state
    this.placementGuardDragState = null; // Tracks whether a plain pointer gesture became map panning
    this.placementGuardSuppressClickUntil = 0; // Ignores the synthetic click fired after a map pan
    this.placementGuardLastPointerPoint = null; // Last pointer location for keyboard-triggered placement
    this.placementGuardLastPointerOnMap = false; // Whether the last pointer location was on Wplace's map
    this.placementGuardLastPointerAt = 0; // Timestamp for the last tracked pointer location
    this.placementGuardMinimumZoom = 15; // Avoids blocking low-zoom map POI clicks rendered inside the canvas
    this.debugLogLastAt = new Map(); // Throttles repeated picker/guard debug messages
    this.installTemplateEyedropperTracker();
    this.installPlacementGuard();
  }

  /** Checks whether focused picker/guard debug logs are enabled.
   * @param {'picker'|'guard'|'api'} channel - Debug channel
   * @returns {boolean}
   * @since 0.92.35
   */
  isDebugLoggingEnabled(channel = 'api') {
    const flags = this.templateManager?.settingsManager?.userSettings?.flags ?? [];
    const debugLogs = !!this.templateManager?.settingsManager?.userSettings?.debugLogs;
    const localDebug = localStorage.getItem('bm-debug') == 'true';
    const localChannelDebug = localStorage.getItem(`bm-debug-${channel}`) == 'true';
    const datasetDebug = document.documentElement?.dataset?.bmDebug == 'true';
    const datasetChannelDebug = document.documentElement?.dataset?.[`bmDebug${channel[0].toUpperCase()}${channel.slice(1)}`] == 'true';
    return debugLogs || flags.includes('bm-debug') || localDebug || localChannelDebug || datasetDebug || datasetChannelDebug;
  }

  /** Writes a debug log when the focused debug channel is enabled.
   * @param {'picker'|'guard'|'api'} channel - Debug channel
   * @param {string} eventName - Short event name
   * @param {Object} [details={}] - Structured details
   * @param {number} [throttleMs=0] - Minimum time between identical events
   * @since 0.92.35
   */
  debugLog(channel, eventName, details = {}, throttleMs = 0) {
    if (!this.isDebugLoggingEnabled(channel)) {return;}

    const throttleKey = `${channel}:${eventName}`;
    const now = Date.now();
    if (throttleMs && ((now - (this.debugLogLastAt.get(throttleKey) || 0)) < throttleMs)) {return;}
    this.debugLogLastAt.set(throttleKey, now);

    console.log(`[BM ${channel}] ${eventName}`, details);
  }

  /** Returns a small, readable description of an event target.
   * @param {Element | null} element - DOM element
   * @returns {Object | null}
   * @since 0.92.35
   */
  describeElement(element) {
    if (!element) {return null;}
    return {
      tag: element.tagName?.toLowerCase?.() || '',
      id: element.id || '',
      className: typeof element.className == 'string' ? element.className : '',
      dataTip: element.getAttribute?.('data-tip') || '',
      title: element.getAttribute?.('title') || '',
      ariaLabel: element.getAttribute?.('aria-label') || ''
    };
  }

  /** Tracks map coordinates and blocks wrong-color manual clicks when the placement guard is enabled.
   * @since 0.92.35
   */
  installPlacementGuard() {
    if (this.placementGuardTrackerInstalled) {return;}
    this.placementGuardTrackerInstalled = true;

    window.addEventListener('message', event => this.handleDebugMessage(event), true);
    window.addEventListener('keydown', event => this.handlePlacementGuardKeyEvent(event, true), true);
    window.addEventListener('keyup', event => this.handlePlacementGuardKeyEvent(event, false), true);
    document.addEventListener('keydown', event => this.handlePlacementGuardKeyEvent(event, true), true);
    document.addEventListener('keyup', event => this.handlePlacementGuardKeyEvent(event, false), true);
    window.addEventListener('blur', () => {this.placementGuardSpaceHeld = false;}, true);
    void installWplaceTilePixelTracker(this.templateManager?.tileSize || 1000, 11).then(ok => {
      this.debugLog('guard', 'tile-pixel-tracker-installed', {ok: ok}, 1000);
      this.installPlacementGuardEventListeners();
    });
  }

  /** Installs placement guard event listeners after the coordinate tracker has registered first.
   * @since 0.92.38
   */
  installPlacementGuardEventListeners() {
    if (this.placementGuardEventListenersInstalled) {return;}
    this.placementGuardEventListenersInstalled = true;

    for (const eventName of this.placementGuardEvents) {
      document.addEventListener(eventName, event => this.handlePlacementGuardEvent(event), true);
    }
  }

  /** Handles page-console debug commands for diagnosing guard/picker behavior.
   * @param {MessageEvent} event - Window message event
   * @since 0.92.37
   */
  handleDebugMessage(event) {
    const data = event.data;
    if (!data || data['source'] != 'blue-marble-debug') {return;}

    const channel = ['guard', 'picker', 'api'].includes(data['channel']) ? data['channel'] : 'guard';
    const datasetKey = `bmDebug${channel[0].toUpperCase()}${channel.slice(1)}`;

    if (data['endpoint'] == 'set-debug') {
      document.documentElement.dataset[datasetKey] = data['enabled'] === false ? 'false' : 'true';
      console.log(`[BM ${channel}] debug-${data['enabled'] === false ? 'disabled' : 'enabled'}`, {
        datasetKey: datasetKey,
        localStorageKey: `bm-debug-${channel}`
      });
      return;
    }

    if (data['endpoint'] == 'status') {
      const visibleColorIDs = this.templateManager?.getVisibleTemplateColorIDs?.({paintableOnly: true}) ?? [];
      console.log('[BM guard] status', {
        debugEnabled: this.isDebugLoggingEnabled('guard'),
        guardEnabled: this.isPlacementGuardEnabled(),
        visibleColorIDs: visibleColorIDs,
        selectedColor: localStorage.getItem('selected-color'),
        events: this.placementGuardEvents,
        spaceHeld: this.placementGuardSpaceHeld,
        spacePlacementAllowed: this.placementGuardSpacePlacementAllowed,
        spaceCancelledUntilKeyup: this.placementGuardSpaceCancelledUntilKeyup,
        tracker: document.documentElement?.dataset?.bmTilePixelAtPointer || '',
        flags: this.templateManager?.settingsManager?.userSettings?.flags ?? []
      });
    }
  }

  /** Tracks Space because Wplace may use it for continuous manual placement.
   * @param {KeyboardEvent} event - Keyboard event
   * @param {boolean} isDown - Whether Space is pressed
   * @since 0.92.39
   */
  handlePlacementGuardKeyEvent(event, isDown) {
    if (event.code != 'Space') {return;}
    if (!event.isTrusted && (Date.now() < this.placementGuardSyntheticSpaceReleaseUntil)) {return;}

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {return;}

    if (!isDown) {
      const changed = this.placementGuardSpaceHeld || this.placementGuardSpacePlacementAllowed || this.placementGuardSpaceCancelledUntilKeyup;
      this.placementGuardSpaceHeld = false;
      this.placementGuardSpacePlacementAllowed = false;
      this.placementGuardSpaceCancelledUntilKeyup = false;
      if (changed) {
        this.debugLog('guard', 'space-up', {}, 500);
      }
      return;
    }

    if (this.placementGuardSpaceCancelledUntilKeyup) {
      this.debugLog('guard', 'block', {type: event.type, reason: 'space-session-cancelled-until-keyup'}, 500);
      this.blockPlacementEvent(event);
      return;
    }

    if (isDown && this.shouldBlockPlacementGuardSpaceEvent(event)) {
      this.placementGuardSpaceHeld = false;
      this.placementGuardSpacePlacementAllowed = false;
      this.blockPlacementEvent(event);
      return;
    }

    const changed = this.placementGuardSpaceHeld != isDown;
    this.placementGuardSpaceHeld = true;
    this.placementGuardSpacePlacementAllowed = true;
    if (changed) {
      this.debugLog('guard', 'space-down', {}, 500);
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
    this.updatePlacementGuardPointerState(event);
    const dragState = this.updatePlacementGuardDragState(event);

    if ((event.type == 'click') && (Date.now() < this.placementGuardSuppressClickUntil)) {return false;}
    if (this.isMoveEvent(event) && !this.placementGuardSpaceHeld) {return false;}
    if (this.isMoveEvent(event) && !this.isPrimaryPlacementGesture(event)) {return false;}
    if (this.isPlacementStartEvent(event) && !this.placementGuardSpaceHeld) {return false;}

    const target = event.target instanceof Element ? event.target : null;
    const baseDebug = {
      type: event.type,
      button: event.button,
      buttons: event.buttons,
      spaceHeld: this.placementGuardSpaceHeld,
      spacePlacementAllowed: this.placementGuardSpacePlacementAllowed,
      target: this.describeElement(target),
      selectedColor: localStorage.getItem('selected-color')
    };

    if (!event.isTrusted) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'untrusted-event'}, 1000);
      return false;
    }
    if (!this.isPlacementGuardEnabled()) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'guard-disabled'}, 1000);
      return false;
    }
    if (this.isWplaceColorPickerActive()) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'picker-active'}, 1000);
      return false;
    }
    if (!this.isPrimaryPlacementGesture(event)) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'not-primary-placement-gesture'}, 1000);
      return false;
    }
    if (this.isMoveEvent(event) && this.placementGuardSpaceHeld && !this.placementGuardSpacePlacementAllowed) {
      this.debugLog('guard', 'block', {...baseDebug, reason: 'space-session-cancelled'}, 500);
      this.blockPlacementEvent(event);
      return true;
    }
    if (this.isPlacementEndEvent(event) && dragState?.dragged && !dragState.spaceAtStart && !this.placementGuardSpaceHeld) {
      this.placementGuardSuppressClickUntil = Date.now() + 400;
      this.placementGuardDragState = null;
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'map-pan-drag'}, 1000);
      return false;
    }

    if (!target || !this.isWplaceMapClickTarget(target)) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'not-map-target'}, 1000);
      return false;
    }

    const visibleColorIDs = this.templateManager?.getVisibleTemplateColorIDs?.({paintableOnly: true}) ?? [];
    const activeColorID = (visibleColorIDs.length == 1) ? visibleColorIDs[0] : null;
    if (activeColorID == null) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'not-exactly-one-visible-color', visibleColorIDs: visibleColorIDs}, 1000);
      return false;
    }

    const point = this.getEventClientPoint(event);
    if (!point) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'no-event-point', activeColorID: activeColorID}, 1000);
      return false;
    }

    const coords = getTrackedWplaceTilePixel(point.clientX, point.clientY);
    if (!coords) {
      this.debugLog('guard', 'skip', {
        ...baseDebug,
        reason: 'no-tracked-coords',
        activeColorID: activeColorID,
        point: point,
        rawTracker: document.documentElement?.dataset?.bmTilePixelAtPointer || ''
      }, 1000);
      return false;
    }
    if (this.isPlacementGuardBelowPixelZoom(coords)) {
      this.debugLog('guard', 'skip', {...baseDebug, reason: 'below-pixel-zoom', coords: coords}, 1000);
      return false;
    }

    const templateColor = this.templateManager?.getTemplateColorAtTilePixel?.(
      coords['tile']?.[0],
      coords['tile']?.[1],
      coords['pixel']?.[0],
      coords['pixel']?.[1]
    );

    if (!templateColor || (templateColor.colorID != activeColorID)) {
      this.debugLog('guard', 'block', {
        ...baseDebug,
        reason: 'clicked-non-matching-template-pixel',
        activeColorID: activeColorID,
        coords: coords,
        templateColorID: templateColor?.colorID ?? null
      }, 500);
      if (this.isMoveEvent(event) && this.placementGuardSpaceHeld) {
        this.cancelPlacementGuardSpaceSession('moved-over-non-matching-template-pixel', {
          activeColorID: activeColorID,
          coords: coords,
          templateColorID: templateColor?.colorID ?? null
        });
      }
      this.blockPlacementEvent(event);
      return true;
    }

    const selectedColorID = Number(localStorage.getItem('selected-color'));
    if (Number.isInteger(selectedColorID) && (selectedColorID != activeColorID)) {
      this.selectWplacePaletteColor(activeColorID);
      this.debugLog('guard', 'block', {
        ...baseDebug,
        reason: 'selected-color-mismatch',
        activeColorID: activeColorID,
        selectedColorID: selectedColorID,
        coords: coords,
        templateColorID: templateColor.colorID
      }, 500);
      if (this.isMoveEvent(event) && this.placementGuardSpaceHeld) {
        this.cancelPlacementGuardSpaceSession('moved-with-selected-color-mismatch', {
          activeColorID: activeColorID,
          selectedColorID: selectedColorID,
          coords: coords,
          templateColorID: templateColor.colorID
        });
      }
      this.blockPlacementEvent(event);
      return true;
    }

    this.debugLog('guard', 'allow', {
      ...baseDebug,
      reason: 'matching-template-pixel',
      activeColorID: activeColorID,
      coords: coords,
      templateColorID: templateColor.colorID
    }, 500);
    return false;
  }

  /** Cancels continuous Space placement until the user physically releases Space.
   * @param {string} reason - Cancellation reason
   * @param {Object} [details={}] - Debug details
   * @since 0.92.44
   */
  cancelPlacementGuardSpaceSession(reason, details = {}) {
    if (this.placementGuardSpaceCancelledUntilKeyup) {return;}
    this.placementGuardSpacePlacementAllowed = false;
    this.placementGuardSpaceCancelledUntilKeyup = true;
    this.debugLog('guard', 'space-cancelled', {reason: reason, ...details}, 500);
    this.dispatchPlacementGuardSyntheticSpaceRelease(reason);
  }

  /** Sends a best-effort Space keyup so Wplace leaves continuous placement mode.
   * @param {string} reason - Cancellation reason
   * @since 0.92.44
   */
  dispatchPlacementGuardSyntheticSpaceRelease(reason) {
    this.placementGuardSyntheticSpaceReleaseUntil = Date.now() + 100;
    const targets = [document.activeElement, document, window].filter(Boolean);

    for (const target of targets) {
      try {
        const event = new KeyboardEvent('keyup', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true
        });
        target.dispatchEvent(event);
      } catch (error) {}
    }

    this.debugLog('guard', 'space-release-sent', {reason: reason}, 500);
  }

  /** Blocks Space-triggered placement before Wplace paints a wrong pixel.
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {boolean} Whether Space should be blocked
   * @since 0.92.41
   */
  shouldBlockPlacementGuardSpaceEvent(event) {
    if (!event.isTrusted || !this.isPlacementGuardEnabled() || this.isWplaceColorPickerActive()) {return false;}
    if (!this.placementGuardLastPointerOnMap || ((Date.now() - this.placementGuardLastPointerAt) > 1500)) {return false;}

    const activeColorID = this.getSingleVisibleTemplateColorID();
    if (activeColorID == null) {return false;}

    const selectedColorID = Number(localStorage.getItem('selected-color'));
    const selectedMismatch = Number.isInteger(selectedColorID) && (selectedColorID != activeColorID);
    const point = this.placementGuardLastPointerPoint;
    const coords = point ? getTrackedWplaceTilePixel(point.clientX, point.clientY) : null;
    if (coords && this.isPlacementGuardBelowPixelZoom(coords)) {
      this.debugLog('guard', 'skip', {type: event.type, reason: 'space-below-pixel-zoom', coords: coords}, 1000);
      return false;
    }
    const templateColor = coords ? this.templateManager?.getTemplateColorAtTilePixel?.(
      coords['tile']?.[0],
      coords['tile']?.[1],
      coords['pixel']?.[0],
      coords['pixel']?.[1]
    ) : null;

    if (selectedMismatch) {
      this.selectWplacePaletteColor(activeColorID);
      this.debugLog('guard', 'block', {
        type: event.type,
        reason: 'space-selected-color-mismatch',
        activeColorID: activeColorID,
        selectedColorID: selectedColorID,
        coords: coords,
        templateColorID: templateColor?.colorID ?? null
      }, 500);
      return true;
    }

    if (!coords) {
      this.debugLog('guard', 'skip', {type: event.type, reason: 'space-no-tracked-coords'}, 1000);
      return false;
    }

    if (!templateColor || (templateColor.colorID != activeColorID)) {
      this.debugLog('guard', 'block', {
        type: event.type,
        reason: 'space-non-matching-template-pixel',
        activeColorID: activeColorID,
        coords: coords,
        templateColorID: templateColor?.colorID ?? null
      }, 500);
      return true;
    }

    return false;
  }

  /** Checks whether the map is too far zoomed out for pixel placement guarding.
   * @param {{zoom?: number | null}} coords - Tracked map coordinates
   * @returns {boolean}
   * @since 0.92.43
   */
  isPlacementGuardBelowPixelZoom(coords) {
    const zoom = Number(coords?.['zoom']);
    return Number.isFinite(zoom) && (zoom < this.placementGuardMinimumZoom);
  }

  /** Remembers whether the pointer is currently over the map for keyboard-triggered placement.
   * @param {Event} event - Pointer/mouse/touch event
   * @since 0.92.41
   */
  updatePlacementGuardPointerState(event) {
    const point = this.getEventClientPoint(event);
    if (!point) {return;}

    const target = event.target instanceof Element ? event.target : null;
    this.placementGuardLastPointerPoint = point;
    this.placementGuardLastPointerOnMap = !!target && this.isWplaceMapClickTarget(target);
    this.placementGuardLastPointerAt = Date.now();
  }

  /** Checks whether an event can be part of a human left-click or left-drag placement.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {boolean}
   * @since 0.92.38
   */
  isPrimaryPlacementGesture(event) {
    if (event.type?.startsWith?.('touch')) {return true;}

    if (this.isMoveEvent(event)) {
      return this.placementGuardSpaceHeld || !!(Number(event.buttons) & 1);
    }

    const button = Number(event.button);
    return !Number.isFinite(button) || button == 0;
  }

  /** Tracks pointer movement so map panning is not mistaken for wrong-color placement.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {{clientX: number, clientY: number, dragged: boolean, spaceAtStart: boolean} | null}
   * @since 0.92.40
   */
  updatePlacementGuardDragState(event) {
    const point = this.getEventClientPoint(event);

    if (this.isPlacementStartEvent(event)) {
      if (!point || !this.isPrimaryPlacementGesture(event)) {return this.placementGuardDragState;}
      this.placementGuardDragState = {
        clientX: point.clientX,
        clientY: point.clientY,
        dragged: false,
        spaceAtStart: this.placementGuardSpaceHeld
      };
      return this.placementGuardDragState;
    }

    if (this.isMoveEvent(event) && this.placementGuardDragState && point) {
      const deltaX = point.clientX - this.placementGuardDragState.clientX;
      const deltaY = point.clientY - this.placementGuardDragState.clientY;
      if (((deltaX * deltaX) + (deltaY * deltaY)) > 36) {
        this.placementGuardDragState.dragged = true;
      }
    }

    return this.placementGuardDragState;
  }

  /** Checks whether an event starts a pointer gesture.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {boolean}
   * @since 0.92.40
   */
  isPlacementStartEvent(event) {
    return event.type == 'pointerdown' || event.type == 'mousedown' || event.type == 'touchstart';
  }

  /** Checks whether an event ends a pointer gesture.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {boolean}
   * @since 0.92.40
   */
  isPlacementEndEvent(event) {
    return event.type == 'pointerup' || event.type == 'mouseup' || event.type == 'touchend' || event.type == 'click';
  }

  /** Checks whether an event is a high-frequency pointer movement.
   * @param {Event} event - Pointer/mouse/touch event
   * @returns {boolean}
   * @since 0.92.39
   */
  isMoveEvent(event) {
    return event.type == 'pointermove' || event.type == 'mousemove' || event.type == 'touchmove';
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

    const markPickerActive = (source = 'unknown') => {
      this.templateEyedropperActiveUntil = Date.now() + this.templateEyedropperActivationWindowMs;
      this.debugLog('picker', 'mark-active', {source: source, activeUntil: this.templateEyedropperActiveUntil}, 250);
    };
    const clearPickerActive = (source = 'unknown') => {
      this.templateEyedropperActiveUntil = 0;
      this.debugLog('picker', 'clear-active', {source: source}, 250);
    };

    document.addEventListener('keydown', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {return;}
      if (event.code == 'KeyI') {markPickerActive('keyboard-i');}
      if (event.code == 'KeyE') {clearPickerActive('keyboard-e');}
    }, true);

    document.addEventListener('keypress', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) {return;}
      if (event.code == 'KeyI') {markPickerActive('keypress-i');}
      if (event.code == 'KeyE') {clearPickerActive('keypress-e');}
    }, true);

    for (const eventName of ['pointerdown', 'mousedown', 'touchstart']) {
      document.addEventListener(eventName, event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {return;}
        if (target.closest('[id^="color-"]')) {
          clearPickerActive('palette-color');
          return;
        }
        if (this.isWplaceColorPickerControl(target)) {markPickerActive(`${eventName}-picker-control`);}
      }, true);
    }

    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {return;}
      const selectedColorBeforeClick = localStorage.getItem('selected-color');

      if (target.closest('[id^="color-"]')) {
        clearPickerActive('palette-color-click');
        return;
      }

      if (this.isWplaceColorPickerControl(target)) {markPickerActive('click-picker-control');}

      if (!this.isWplaceMapClickTarget(target)) {
        this.debugLog('picker', 'skip', {reason: 'not-map-target', target: this.describeElement(target)}, 1000);
        return;
      }
      const wasPickerActive = this.isWplaceColorPickerActive();
      if (wasPickerActive) {markPickerActive('map-click-active');}

      this.debugLog('picker', 'map-click', {
        wasPickerActive: wasPickerActive,
        selectedColorBeforeClick: selectedColorBeforeClick,
        point: {clientX: event.clientX, clientY: event.clientY},
        target: this.describeElement(target)
      });

      void screenToWplaceTilePixel(
        event.clientX,
        event.clientY,
        this.templateManager?.tileSize || 1000,
        11
      ).then(coords => {
        if (!coords) {
          this.debugLog('picker', 'screen-to-tile-failed', {point: {clientX: event.clientX, clientY: event.clientY}}, 500);
          return;
        }
        this.debugLog('picker', 'screen-to-tile', {coords: coords});
        if (wasPickerActive || this.isWplaceColorPickerActive()) {
          this.selectTemplateColorAtCoords(coords['tile'], coords['pixel']);
          return;
        }

        this.selectTemplateColorAfterNativePickerChange(coords['tile'], coords['pixel'], selectedColorBeforeClick);
      });
    }, true);
  }

  /** Checks whether an element is part of Wplace's MapLibre map surface.
   * @param {Element} element - Click target
   * @returns {boolean}
   * @since 0.92.35
   */
  isWplaceMapClickTarget(element) {
    if (this.isWplaceInteractiveMapTarget(element)) {return false;}

    return !!(
      element.matches?.('.maplibregl-canvas')
      || element.closest?.('.maplibregl-canvas-container')
    );
  }

  /** Checks whether a map child is an interactive overlay rather than the paintable canvas.
   * @param {Element} element - Click target or candidate element
   * @returns {boolean}
   * @since 0.92.42
   */
  isWplaceInteractiveMapTarget(element) {
    if (element.matches?.('.maplibregl-canvas')) {return false;}

    return !!element.closest?.([
      'button',
      'a',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '.maplibregl-marker',
      '.maplibregl-control-container',
      '.maplibregl-ctrl',
      '.maplibregl-popup',
      '[class*="marker" i]'
    ].join(','));
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
    if (!Number.isInteger(wplaceColorID) || (wplaceColorID < 0) || (wplaceColorID > 63)) {
      this.debugLog('picker', 'palette-select-failed', {reason: 'invalid-color-id', colorID: colorID});
      return false;
    }

    const expectedColorID = wplaceColorID.toString();
    const select = (force = false) => {
      const colorElement = document.getElementById(`color-${expectedColorID}`);
      if (!colorElement) {
        localStorage.setItem('selected-color', expectedColorID);
        this.debugLog('picker', 'palette-select-fallback-localstorage', {expectedColorID: expectedColorID, force: force}, 500);
        return false;
      }

      if (!force && (localStorage.getItem('selected-color') == expectedColorID)) {
        colorElement.focus?.();
        this.debugLog('picker', 'palette-select-already-selected', {expectedColorID: expectedColorID, force: force}, 500);
        return true;
      }

      if (colorElement instanceof HTMLButtonElement && colorElement.disabled) {
        this.debugLog('picker', 'palette-select-failed', {reason: 'button-disabled', expectedColorID: expectedColorID, force: force}, 500);
        return false;
      }

      colorElement.click();
      colorElement.focus?.();
      this.debugLog('picker', 'palette-select-clicked', {expectedColorID: expectedColorID, force: force}, 500);
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
    if (!templateColor || (templateColor.colorID == -2)) {
      this.debugLog('picker', 'native-fallback-not-scheduled', {
        reason: !templateColor ? 'no-template-color' : 'unknown-template-color',
        coordsTile: coordsTile,
        coordsPixel: coordsPixel,
        templateColorID: templateColor?.colorID ?? null
      });
      return false;
    }

    const previousColor = selectedColorBeforeClick == null ? null : String(selectedColorBeforeClick);
    const expectedColor = String((templateColor.colorID == -1) ? 0 : templateColor.colorID);
    this.debugLog('picker', 'native-fallback-scheduled', {
      coordsTile: coordsTile,
      coordsPixel: coordsPixel,
      previousColor: previousColor,
      expectedColor: expectedColor,
      templateColorID: templateColor.colorID
    });

    for (const delay of this.templateEyedropperNativeProbeDelays) {
      setTimeout(() => {
        const currentColor = localStorage.getItem('selected-color');
        if (currentColor == null || currentColor == previousColor || currentColor == expectedColor) {
          this.debugLog('picker', 'native-fallback-probe-skip', {
            delay: delay,
            currentColor: currentColor,
            previousColor: previousColor,
            expectedColor: expectedColor
          }, 250);
          return;
        }
        this.debugLog('picker', 'native-fallback-correcting', {
          delay: delay,
          currentColor: currentColor,
          expectedColor: expectedColor,
          templateColorID: templateColor.colorID
        }, 250);
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

    if (!templateColor || (templateColor.colorID == -2)) {
      this.debugLog('picker', 'direct-select-failed', {
        reason: !templateColor ? 'no-template-color' : 'unknown-template-color',
        coordsTile: coordsTile,
        coordsPixel: coordsPixel,
        templateColorID: templateColor?.colorID ?? null
      });
      return false;
    }

    const selected = this.selectWplacePaletteColor(templateColor.colorID);
    this.debugLog('picker', 'direct-select', {
      coordsTile: coordsTile,
      coordsPixel: coordsPixel,
      templateColorID: templateColor.colorID,
      selected: selected
    });
    return selected;
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
