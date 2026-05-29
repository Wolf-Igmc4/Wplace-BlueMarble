import ConfettiManager from "./confetttiManager";
import Overlay, { minimizeIconExpanded } from "./Overlay";
import { calculateRelativeLuminance, localizeNumber, localizePercent, rgbToHex, tilePixelToLatLng } from "./utils";
import { navigateWplaceToLatLng } from "./infrastructure/wplace/wplaceBridge.js";
import { calculateColorFilterStats } from "./domain/colorFilter/ColorFilterStats.js";
import ColorFilterViewSettings from "./domain/colorFilter/ColorFilterViewSettings.js";
import BoughtColorDetector from "./domain/colorFilter/BoughtColorDetector.js";

const closeIcon = '<svg class="bm-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const fullscreenIcon = '<svg class="bm-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8.5 4.5H4.5v4M15.5 4.5h4v4M19.5 15.5v4h-4M8.5 19.5h-4v-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.8 4.8l5.2 5.2M19.2 4.8L14 10M19.2 19.2L14 14M4.8 19.2L10 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const windowedIcon = '<svg class="bm-button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.8 4.8l5.2 5.2M19.2 4.8L14 10M19.2 19.2L14 14M4.8 19.2L10 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M10 7.5V10H7.5M16.5 10H14V7.5M14 16.5V14h2.5M7.5 14H10v2.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The overlay builder for the color filter Blue Marble window.
 * @description This class handles the overlay UI for the color filter window of the Blue Marble userscript.
 * @class WindowFilter
 * @since 0.88.329
 * @see {@link Overlay} for examples
 */
export default class WindowFilter extends Overlay {

  /** Constructor for the color filter window
   * @param {*} executor - The executing class
   * @since 0.88.329
   * @see {@link Overlay#constructor}
   */
  constructor(executor) {
    super(executor.name, executor.version); // Executes the code in the Overlay constructor
    this.window = null; // Contains the *window* DOM tree
    this.windowID = 'bm-window-filter'; // The ID attribute for this window
    this.colorListID = 'bm-filter-flex'; // The ID attribute for the color list
    this.windowParent = document.body; // The parent of the window DOM tree
    this.settingsManager = executor.settingsManager ?? null; // Settings manager from the executor
    this.windowModeFlag = 'ftr-oWin'; // User setting flag for opening the filter in windowed mode
    this.placementGuardFlag = 'ftr-placeGuard'; // User setting flag for blocking wrong-color clicks when one color is visible
    this.windowStateKey = 'windowFilter'; // User setting key for the persisted window state
    this.windowResizeObserver = null; // Resize observer for the windowed mode
    this.windowViewportResizeHandler = null; // Resize handler for viewport changes
    this.windowSaveTimeout = null; // Debounce timer for resize persistence
    this.colorPickerObserver = null; // Watches Wplace's palette while bought color state is DOM-only
    this.colorPickerRefreshTimeout = null; // Debounce timer for Wplace palette changes
    this.colorRefreshInterval = null; // Auto-refresh timer for live color statistics
    this.colorRefreshIntervalMS = 10000; // Refresh Color Filter statistics every 10 seconds
    this.windowMinWidth = 320; // Minimum width for the windowed filter
    this.windowMinHeight = 220; // Minimum height for the windowed filter
    this.windowMaxWidth = 1000; // Maximum width for the windowed filter
    this.windowMaxHeight = 1400; // Maximum height for the windowed filter
    this.filterViewSettingsVersion = 2; // Version for one-time default sort migrations
    this.filterViewSettings = new ColorFilterViewSettings({
      settingsManager: this.settingsManager,
      version: this.filterViewSettingsVersion
    });

    /** The templateManager instance currently being used. @type {TemplateManager} */
    this.templateManager = executor.apiManager?.templateManager;
    this.apiManager = executor.apiManager ?? null;

    // Eye icons
    this.eyeOpen = '<svg class="bm-filter-eye-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.8 12s3.1-5 8.2-5 8.2 5 8.2 5-3.1 5-8.2 5-8.2-5-8.2-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    this.eyeClosed = '<svg class="bm-filter-eye-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.6 9.8C6.1 8.3 8.6 7 12 7c5.1 0 8.2 5 8.2 5a15.2 15.2 0 0 1-2.2 2.7"/><path d="M14.1 16.7a8.3 8.3 0 0 1-2.1.3c-5.1 0-8.2-5-8.2-5a14.9 14.9 0 0 1 1.8-2.3"/><path d="M5 5l14 14"/><path d="M10.4 10.7a2.5 2.5 0 0 0 2.9 2.9"/></svg>';
    this.locationIcon = '<svg class="bm-filter-locate-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.75"/></svg>';

    // Obtains the color palette Blue Marble currently uses
    const { palette: palette, LUT: _ } = this.templateManager.paletteBM;
    this.palette = palette;
    this.boughtColorDetector = new BoughtColorDetector({
      palette: this.palette,
      apiManager: this.apiManager
    });

    // Tile quantity information
    this.tilesLoadedTotal = 0; // Number of tiles verified now or restored from the progress cache
    this.tilesTotal = 0; // Number of tiles total, across all templates

    // Pixel statistics
    this.allPixelsColor = new Map(); // The amount of pixels total per color as a Map
    this.allPixelsCorrect = new Map(); // The amount of correct pixels per color as a Map
    this.allPixelsCorrectTotal = 0; // Sums the pixels placed as "correct" per everything
    this.allPixelsTotal = 0; // Sums the pixels placed as "total" per everything
    this.timeRemaining = 0; // Calculates the date & time the user will complete the templates
    this.timeRemainingLocalized = ''; // The date & time the user will complete the templates in the date-time format of the user's device, as a string

    // Color list display settings
    this.sortPrimary = 'total'; // The last used primary sort option
    this.sortSecondary = 'descending'; // The last used secondary sort option
    this.sortBought = true; // Were bought colors grouped first the last time the user sorted the color list?
    this.showUnused = false; // Were unused colors shown the last time the user sorted the color list?
    this.showCompleted = true; // Were completed colors shown the last time the user sorted the color list?
    this.showFree = true; // Were free colors shown the last time the user sorted the color list?
    this.showPremium = true; // Were premium colors shown the last time the user sorted the color list?
    this.#loadFilterViewSettings();
    window.blueMarbleDumpBoughtColors = () => this.#dumpBoughtColorDetection();
  }

  /** Builds the preferred filter window mode for the user.
   * @since 0.92.0
   */
  buildPreferredWindow() {
    if (this.#prefersWindowedMode()) {
      this.buildWindowed();
      return;
    }
    this.buildWindow();
  }

  /** Spawns a Color Filter window.
   * If another color filter window already exists, we DON'T spawn another!
   * Parent/child relationships in the DOM structure below are indicated by indentation.
   * @since 0.88.149
   */
  buildWindow() {

    // If a color filter wizard window already exists, close it
    if (document.querySelector(`#${this.windowID}`)) {
      this.#closeWindow();
      return;
    }
    
    // Creates a new color filter window
    this.window = this.addDiv({'id': this.windowID, 'class': 'bm-window'}, (instance, div) => {
      // div.onclick = (event) => {
      //   if (event.target.closest('button, a, input, select')) {return;} // Exit-early if interactive child was clicked
      //   div.parentElement.appendChild(div); // When the window is clicked on, bring to top
      // }
    }).addDragbar()
        .addButton({'class': 'bm-button-circle', 'innerHTML': minimizeIconExpanded, 'aria-label': 'Minimize window "Color Filter"', 'data-button-status': 'expanded'}, (instance, button) => {
          button.onclick = () => instance.handleMinimization(button);
          button.ontouchend = () => {button.click()}; // Needed only to negate weird interaction with dragbar
        }).buildElement()
        .addDiv().buildElement() // Contains the minimized h1 element
        .addDiv({'class': 'bm-flex-center'})
          .addButton({'class': 'bm-button-circle', 'innerHTML': windowedIcon, 'aria-label': 'Switch to windowed mode for "Color Filter"'}, (instance, button) => {
            button.onclick = () => {
              this.#setWindowModePreference(true);
              this.#closeWindow();
              this.buildWindowed({forceDefaultPosition: true});
            };
            button.ontouchend = () => {button.click();}; // Needed only to negate weird interaction with dragbar
          }).buildElement()
          .addButton({'class': 'bm-button-circle', 'innerHTML': closeIcon, 'aria-label': 'Close window "Color Filter"'}, (instance, button) => {
            button.onclick = () => this.#closeWindow();
            button.ontouchend = () => {button.click();}; // Needed only to negate weird interaction with dragbar
          }).buildElement()
        .buildElement()
      .buildElement()
      .addDiv({'class': 'bm-window-content'})
        .addDiv({'class': 'bm-container bm-center-vertically bm-filter-header'})
          .addHeader(1, {'textContent': 'Color Filter'}).buildElement()
        .buildElement()
        .addHr().buildElement()
        .addDiv({'class': 'bm-container bm-flex-between bm-center-vertically bm-filter-toolbar', 'style': 'gap: 1.5ch;'})
          .addButton({'class': 'bm-button-secondary', 'textContent': 'Hide All Colors'}, (instance, button) => {
            button.onclick = () => this.#selectColorList(false);
          }).buildElement()
          .addButton({'class': 'bm-button-secondary', 'textContent': 'Show All Colors'}, (instance, button) => {
            button.onclick = () => this.#selectColorList(true);
          }).buildElement()
          .addButton({'class': 'bm-button-secondary', 'textContent': 'Show Filtered Colors Only'}, (instance, button) => {
            button.onclick = () => this.#selectFilteredColorList();
          }).buildElement()
          .addCheckbox({'class': 'bm-filter-placement-guard', 'textContent': 'Guard clicks'}, (instance, label, checkbox) => {
            this.#initializePlacementGuardToggle(label, checkbox);
          }).buildElement()
        .buildElement()
        .addHr().buildElement()
        .addDiv({'class': 'bm-container bm-scrollable bm-filter-scrollable'})
          .addDiv({'class': 'bm-container bm-filter-insights'})
            .addDiv({'class': 'bm-filter-stat-grid'})
              .addDiv({'class': 'bm-filter-stat-card'})
                .addSpan({'class': 'bm-filter-stat-label', 'textContent': 'Chunks'}).buildElement()
                .addSpan({'id': 'bm-filter-tile-load', 'class': 'bm-filter-stat-value', 'textContent': '0 / ???'}).buildElement()
              .buildElement()
              .addDiv({'class': 'bm-filter-stat-card'})
                .addSpan({'class': 'bm-filter-stat-label', 'textContent': 'Total'}).buildElement()
                .addSpan({'id': 'bm-filter-tot-total', 'class': 'bm-filter-stat-value', 'textContent': '???'}).buildElement()
              .buildElement()
              .addDiv({'class': 'bm-filter-stat-card'})
                .addSpan({'class': 'bm-filter-stat-label', 'textContent': 'Correct'}).buildElement()
                .addSpan({'id': 'bm-filter-tot-correct', 'class': 'bm-filter-stat-value', 'textContent': '???'}).buildElement()
              .buildElement()
              .addDiv({'class': 'bm-filter-stat-card'})
                .addSpan({'class': 'bm-filter-stat-label', 'textContent': 'Remaining'}).buildElement()
                .addSpan({'id': 'bm-filter-tot-remaining', 'class': 'bm-filter-stat-value', 'textContent': '???'}).buildElement()
              .buildElement()
              .addDiv({'class': 'bm-filter-stat-card bm-filter-stat-card-wide'})
                .addSpan({'class': 'bm-filter-stat-label', 'textContent': 'Finished At'}).buildElement()
                .addSpan({'id': 'bm-filter-tot-completed', 'class': 'bm-filter-stat-value', 'textContent': '???'}).buildElement()
              .buildElement()
            .buildElement()
            .addHr().buildElement()
            .addForm({'class': 'bm-container bm-filter-sort-panel'})
              .addFieldset()
                .addLegend({'textContent': 'Sort Options:', 'style': 'font-weight: 700;'}).buildElement()
                .addDiv({'class': 'bm-container bm-filter-sort-row'})
                  .addSelect({'id': 'bm-filter-sort-primary', 'name': 'sortPrimary', 'textContent': 'I want to view '})
                    .addOption({'value': 'id', 'textContent': 'color IDs'}).buildElement()
                    .addOption({'value': 'name', 'textContent': 'color names'}).buildElement()
                    .addOption({'value': 'premium', 'textContent': 'premium colors'}).buildElement()
                    .addOption({'value': 'percent', 'textContent': 'percentage'}).buildElement()
                    .addOption({'value': 'correct', 'textContent': 'correct pixels'}).buildElement()
                    .addOption({'value': 'incorrect', 'textContent': 'incorrect pixels'}).buildElement()
                    .addOption({'value': 'total', 'textContent': 'total pixels'}).buildElement()
                  .buildElement()
                  .addSelect({'id': 'bm-filter-sort-secondary', 'name': 'sortSecondary', 'textContent': ' in '})
                    .addOption({'value': 'ascending', 'textContent': 'ascending'}).buildElement()
                    .addOption({'value': 'descending', 'textContent': 'descending'}).buildElement()
                  .buildElement()
                  .addSpan({'textContent': ' order.'}).buildElement()
                .buildElement()
                .addDiv({'class': 'bm-container bm-filter-show-row'})
                  .addSpan({'class': 'bm-filter-show-label', 'textContent': 'Show:'}).buildElement()
                  .addCheckbox({'id': 'bm-filter-show-unused', 'name': 'showUnused', 'textContent': 'Unused'}).buildElement()
                  .addCheckbox({'id': 'bm-filter-show-completed', 'name': 'showCompleted', 'textContent': 'Completed'}).buildElement()
                  .addCheckbox({'id': 'bm-filter-show-free', 'name': 'showFree', 'textContent': 'Free'}).buildElement()
                  .addCheckbox({'id': 'bm-filter-show-premium', 'name': 'showPremium', 'textContent': 'Premium'}).buildElement()
                  .addCheckbox({'id': 'bm-filter-sort-bought', 'name': 'sortBought', 'textContent': 'Only bought colors'}).buildElement()
                .buildElement()
              .buildElement()
            .buildElement()
          .buildElement()
          // Color list will appear here in the DOM tree
        .buildElement()
      .buildElement()
      .addDiv({
        'class': 'bm-resize-corner',
        'title': 'Resize Color Filter window',
        'aria-label': 'Resize Color Filter window',
        'role': 'presentation',
        'textContent': '◢'
      }).buildElement()
    .buildElement().buildOverlay(this.windowParent);

    void this.#refreshBoughtColorData();

    // Creates dragging capability on the drag bar for dragging the window
    this.handleDrag(`#${this.windowID}.bm-window`, `#${this.windowID} .bm-dragbar`);
    this.handleResize(`#${this.windowID}.bm-window`, `#${this.windowID} .bm-resize-corner`, {
      minWidth: Math.min(this.windowMinWidth, window.innerWidth - 16),
      minHeight: this.windowMinHeight,
      maxWidth: window.innerWidth - 16,
      maxHeight: window.innerHeight - 16
    });

    // Obtains the scrollable container to put the color filter in
    const scrollableContainer = document.querySelector(`#${this.windowID} .bm-container.bm-scrollable`);
    
    // These run when the user opens the Color Filter window
    this.#buildColorList(scrollableContainer);
    this.#syncSortFormControls();
    this.#bindSortFormControls();
    this.#sortColorList(this.sortPrimary, this.sortSecondary, this.showUnused, this.showCompleted, this.showFree, this.showPremium, this.sortBought);

    // Displays some template statistics to the user
    this.updateInnerHTML('#bm-filter-tile-load', `${localizeNumber(this.tilesLoadedTotal)} / ${localizeNumber(this.tilesTotal)}`);
    this.updateInnerHTML('#bm-filter-tot-total', localizeNumber(this.allPixelsTotal));
    this.updateInnerHTML('#bm-filter-tot-correct', `${localizeNumber(this.allPixelsCorrectTotal)} (${localizePercent(this.allPixelsCorrectTotal / (this.allPixelsTotal || 1))})`);
    this.updateInnerHTML('#bm-filter-tot-remaining', `${localizeNumber((this.allPixelsTotal || 0) - (this.allPixelsCorrectTotal || 0))} (${localizePercent(((this.allPixelsTotal || 0) - (this.allPixelsCorrectTotal || 0)) / (this.allPixelsTotal || 1))})`);
    this.updateInnerHTML('#bm-filter-tot-completed', `<time datetime="${this.timeRemaining.toISOString().replace(/\.\d{3}Z$/, 'Z')}">${this.timeRemainingLocalized}</time>`);
    this.#startColorPickerObserver();
    this.#startAutoRefresh();
  }

  /** Spawns a windowed Color Filter window.
   * If another color filter window already exists, we DON'T spawn another!
   * Parent/child relationships in the DOM structure below are indicated by indentation.
   * @since 0.90.35
   */
  buildWindowed(options = {}) {

    // If a color filter wizard window already exists, close it
    if (document.querySelector(`#${this.windowID}`)) {
      this.#closeWindow();
      return;
    }

    // Creates a new windowed color filter window
    this.window = this.addDiv({
      'id': this.windowID,
      'class': 'bm-window bm-windowed',
      'style': `width: min(360px, calc(100vw - 16px)); height: min(70vh, 32rem); min-width: min(${this.windowMinWidth}px, calc(100vw - 16px)); min-height: ${this.windowMinHeight}px; max-width: min(${this.windowMaxWidth}px, calc(100vw - 16px)); max-height: min(${this.windowMaxHeight}px, calc(100vh - 16px));`
    })
      .addDragbar()
        .addButton({'class': 'bm-button-circle', 'innerHTML': minimizeIconExpanded, 'aria-label': 'Minimize window "Color Filter"', 'data-button-status': 'expanded'}, (instance, button) => {
          button.onclick = () => {
            const willExpand = button.dataset['buttonStatus'] == 'collapsed';
            const windowedColorTotals = document.querySelector('#bm-filter-windowed-color-totals');
            if (windowedColorTotals) {
              windowedColorTotals.style.display = (button.dataset['buttonStatus'] == 'expanded') ? 'none' : '';
            }
            instance.handleMinimization(button);
            if (willExpand) {
              const windowElement = document.querySelector(`#${this.windowID}.bm-windowed`);
              this.#snapWindowedFilterToDefaultPosition(windowElement);
            }
          };
          button.ontouchend = () => {button.click()}; // Needed only to negate weird interaction with dragbar
        }).buildElement()
        .addDiv()
          .addSpan({'id': 'bm-filter-windowed-color-totals', 'class': 'bm-dragbar-text', 'style': 'font-weight: 700;'}).buildElement() // Contains correct / total pixel values
          // Minimized h1 element will appear here
        .buildElement() 
        .addDiv({'class': 'bm-flex-center'})
          .addButton({'class': 'bm-button-circle', 'innerHTML': fullscreenIcon, 'aria-label': 'Switch to fullscreen mode for "Color Filter"'}, (instance, button) => {
            button.onclick = () => {
              this.#setWindowModePreference(false);
              this.#closeWindow();
              this.buildWindow();
            };
            button.ontouchend = () => {button.click();}; // Needed only to negate weird interaction with dragbar
          }).buildElement()
          .addButton({'class': 'bm-button-circle', 'innerHTML': closeIcon, 'aria-label': 'Close window "Color Filter"'}, (instance, button) => {
            button.onclick = () => this.#closeWindow();
            button.ontouchend = () => {button.click();}; // Needed only to negate weird interaction with dragbar
          }).buildElement()
        .buildElement()
      .buildElement()
      .addDiv({'class': 'bm-window-content'})
        .addDiv({'class': 'bm-container bm-center-vertically bm-filter-header'})
          .addHeader(1, {'textContent': 'Color Filter'}).buildElement()
        .buildElement()
        .addHr().buildElement()
        .addDiv({'class': 'bm-container bm-flex-between bm-center-vertically bm-filter-toolbar', 'style': 'gap: 1.5ch;'})
          .addButton({'class': 'bm-button-secondary', 'textContent': 'Hide All'}, (instance, button) => {
            button.onclick = () => this.#selectColorList(false);
          }).buildElement()
          .addButton({'class': 'bm-button-secondary', 'textContent': 'Show All'}, (instance, button) => {
            button.onclick = () => this.#selectColorList(true);
          }).buildElement()
          .addCheckbox({'class': 'bm-filter-placement-guard', 'textContent': 'Guard'}, (instance, label, checkbox) => {
            this.#initializePlacementGuardToggle(label, checkbox);
          }).buildElement()
        .buildElement()
        .addHr().buildElement()
        .addDiv({'class': 'bm-container bm-scrollable bm-filter-scrollable'})
          // Color list will appear here
        .buildElement()
      .buildElement()
      .addDiv({
        'class': 'bm-resize-corner',
        'title': 'Resize Color Filter window',
        'aria-label': 'Resize Color Filter window',
        'role': 'presentation',
        'textContent': '◢'
      }).buildElement()
    .buildElement().buildOverlay(this.windowParent);

    this.#initializeWindowedPersistence(options);
    void this.#refreshBoughtColorData();

    // Obtains the scrollable container to put the color filter in
    const scrollableContainer = document.querySelector(`#${this.windowID} .bm-container.bm-scrollable`);
    
    // These run when the user opens the Color Filter window
    this.#buildColorList(scrollableContainer);
    this.#syncSortFormControls();
    this.#sortColorList(this.sortPrimary, this.sortSecondary, this.showUnused, this.showCompleted, this.showFree, this.showPremium, this.sortBought);
    this.#startColorPickerObserver();
    this.#startAutoRefresh();
  }

  /** Ensures bought premium color data is available and refreshes the open filter list.
   * @since 0.92.19
   */
  async #refreshBoughtColorData() {
    const before = this.#getBoughtColorIDsFromUserData();
    await this.apiManager?.ensureUserData?.();
    const after = this.#getBoughtColorIDsFromUserData();
    if (!after || before?.size == after.size) {return;}
    this.#sortColorList(this.sortPrimary, this.sortSecondary, this.showUnused, this.showCompleted, this.showFree, this.showPremium, this.sortBought);
  }

  /** Retrieves the persisted window state object.
   * @returns {Object | null}
   * @since 0.92.0
   */
  #getWindowState() {
    if (!this.settingsManager) {return null;}
    this.settingsManager.userSettings[this.windowStateKey] ??= {};
    return this.settingsManager.userSettings[this.windowStateKey];
  }

  /** Initializes the wrong-color placement guard toggle.
   * @param {HTMLLabelElement} label - Toggle label
   * @param {HTMLInputElement} checkbox - Toggle input
   * @since 0.92.35
   */
  #initializePlacementGuardToggle(label, checkbox) {
    checkbox.checked = !!this.settingsManager?.userSettings?.flags?.includes(this.placementGuardFlag);
    checkbox.title = 'Blocks manual map clicks unless they match the only visible template color.';
    checkbox.ariaLabel = 'Block wrong-color clicks when only one template color is visible';
    label.title = checkbox.title;
    label.classList.add('bm-filter-placement-guard-label');

    checkbox.onchange = async event => {
      this.settingsManager?.toggleFlag?.(this.placementGuardFlag, event.target.checked);
      await this.settingsManager?.saveUserStorageNow?.();
    };
  }

  /** Loads persisted sort and show/hide controls for the Color Filter.
   * @since 0.92.11
   */
  #loadFilterViewSettings() {
    Object.assign(this, this.filterViewSettings.load({
      sortPrimary: this.sortPrimary,
      sortSecondary: this.sortSecondary,
      sortBought: this.sortBought,
      showUnused: this.showUnused,
      showCompleted: this.showCompleted,
      showFree: this.showFree,
      showPremium: this.showPremium
    }));
  }

  /** Saves current sort and show/hide controls in user settings.
   * @param {boolean} [shouldSaveNow=false] - Whether to flush userscript storage immediately
   * @since 0.92.11
   */
  #persistFilterViewSettings(shouldSaveNow = false) {
    this.filterViewSettings.persist({
      sortPrimary: this.sortPrimary,
      sortSecondary: this.sortSecondary,
      sortBought: this.sortBought,
      showUnused: this.showUnused,
      showCompleted: this.showCompleted,
      showFree: this.showFree,
      showPremium: this.showPremium
    }, shouldSaveNow);
  }

  /** Returns whether the filter should open in windowed mode.
   * Defaults to the original fullscreen view unless the user chose windowed mode.
   * @returns {boolean}
   * @since 0.92.1
   */
  #prefersWindowedMode() {
    if (!this.#shouldDefaultToWindowedMode()) {return false;}

    const windowState = this.#getWindowState();
    if (windowState?.mode == 'windowed') {return true;}
    if (windowState?.mode == 'fullscreen') {return false;}
    return !!this.settingsManager?.userSettings?.flags?.includes(this.windowModeFlag);
  }

  /** Returns whether this device should default to the compact filter window.
   * @returns {boolean}
   * @since 0.92.25
   */
  #shouldDefaultToWindowedMode() {
    return window.matchMedia?.('(max-width: 768px), (pointer: coarse)')?.matches ?? window.innerWidth <= 768;
  }

  /** Updates the preferred window mode setting.
   * @param {boolean} shouldBeWindowed
   * @since 0.92.0
   */
  #setWindowModePreference(shouldBeWindowed) {
    const windowState = this.#getWindowState();
    if (windowState) {
      windowState.mode = shouldBeWindowed ? 'windowed' : 'fullscreen';
    }
    if (!this.settingsManager) {return;}
    this.settingsManager.toggleFlag(this.windowModeFlag, shouldBeWindowed);
    void this.settingsManager.saveUserStorageNow();
  }

  /** Updates the visible sort controls to reflect the active sort state.
   * @since 0.92.1
   */
  #syncSortFormControls() {
    const sortPrimaryInput = document.querySelector(`#${this.windowID} #bm-filter-sort-primary`);
    const sortSecondaryInput = document.querySelector(`#${this.windowID} #bm-filter-sort-secondary`);
    const sortBoughtInput = document.querySelector(`#${this.windowID} #bm-filter-sort-bought`);
    const showUnusedInput = document.querySelector(`#${this.windowID} #bm-filter-show-unused`);
    const showCompletedInput = document.querySelector(`#${this.windowID} #bm-filter-show-completed`);
    const showFreeInput = document.querySelector(`#${this.windowID} #bm-filter-show-free`);
    const showPremiumInput = document.querySelector(`#${this.windowID} #bm-filter-show-premium`);

    if (sortPrimaryInput instanceof HTMLSelectElement) {
      sortPrimaryInput.value = this.sortPrimary;
    }
    if (sortSecondaryInput instanceof HTMLSelectElement) {
      sortSecondaryInput.value = this.sortSecondary;
    }
    if (sortBoughtInput instanceof HTMLInputElement) {
      sortBoughtInput.checked = this.sortBought;
      sortBoughtInput.disabled = !this.showPremium;
      sortBoughtInput.parentElement?.classList.toggle('bm-filter-control-disabled', !this.showPremium);
    }
    if (showUnusedInput instanceof HTMLInputElement) {
      showUnusedInput.checked = this.showUnused;
    }
    if (showCompletedInput instanceof HTMLInputElement) {
      showCompletedInput.checked = this.showCompleted;
    }
    if (showFreeInput instanceof HTMLInputElement) {
      showFreeInput.checked = this.showFree;
    }
    if (showPremiumInput instanceof HTMLInputElement) {
      showPremiumInput.checked = this.showPremium;
    }
  }

  /** Reads the sort form and applies the selected color list filters immediately.
   * @since 0.92.7
   */
  #applySortFormControls() {
    const form = document.querySelector(`#${this.windowID} form`);
    if (!(form instanceof HTMLFormElement)) {return;}

    const formData = new FormData(form);
    const formValues = {};
    for (const [input, value] of formData) {
      formValues[input] = value;
    }

    const showPremium = formValues['showPremium'] == 'on';
    this.#sortColorList(
      String(formValues['sortPrimary'] || this.sortPrimary),
      String(formValues['sortSecondary'] || this.sortSecondary),
      formValues['showUnused'] == 'on',
      formValues['showCompleted'] == 'on',
      formValues['showFree'] == 'on',
      showPremium,
      showPremium ? formValues['sortBought'] == 'on' : this.sortBought
    );
    this.#syncSortFormControls();
    this.#persistFilterViewSettings(true);
  }

  /** Makes the sort form reactive, so the list updates as soon as a control changes.
   * @since 0.92.7
   */
  #bindSortFormControls() {
    const form = document.querySelector(`#${this.windowID} form`);
    if (!(form instanceof HTMLFormElement)) {return;}

    form.onchange = () => this.#applySortFormControls();
    form.onsubmit = event => {
      event.preventDefault();
      this.#applySortFormControls();
    };
  }

  /** Immediately closes the filter window and cleans up persistence observers.
   * @since 0.92.0
   */
  #closeWindow() {
    const windowElement = document.querySelector(`#${this.windowID}`);
    this.#persistFilterViewSettings(true);
    if (windowElement?.classList.contains('bm-windowed')) {
      this.#saveWindowState(windowElement);
    }
    this.#stopAutoRefresh();
    this.#cleanupWindowPersistence();
    this.#stopColorPickerObserver();
    windowElement?.remove();
  }

  /** Starts the automatic Color Filter statistics refresh loop.
   * @since 0.92.1
   */
  #startAutoRefresh() {
    this.#stopAutoRefresh();
    this.colorRefreshInterval = setInterval(() => {
      if (!document.querySelector(`#${this.windowID}`)) {
        this.#stopAutoRefresh();
        return;
      }
      this.updateColorList();
    }, this.colorRefreshIntervalMS);
  }

  /** Stops the automatic Color Filter statistics refresh loop.
   * @since 0.92.1
   */
  #stopAutoRefresh() {
    if (!this.colorRefreshInterval) {return;}
    clearInterval(this.colorRefreshInterval);
    this.colorRefreshInterval = null;
  }

  /** Starts watching Wplace's color picker for bought color lock changes.
   * @since 0.92.21
   */
  #startColorPickerObserver() {
    this.#stopColorPickerObserver();
    const nodeTouchesColorPicker = node => {
      if (!(node instanceof Element)) {return false;}
      if (node.id?.startsWith?.('color-')) {return true;}
      if (node.closest?.('[id^="color-"]')) {return true;}
      return !!node.querySelector?.('[id^="color-"]');
    };
    this.colorPickerObserver = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some(mutation => nodeTouchesColorPicker(mutation.target)
        || Array.from(mutation.addedNodes).some(nodeTouchesColorPicker)
        || Array.from(mutation.removedNodes).some(nodeTouchesColorPicker));
      if (!shouldRefresh) {return;}
      if (this.colorPickerRefreshTimeout) {clearTimeout(this.colorPickerRefreshTimeout);}
      this.colorPickerRefreshTimeout = setTimeout(() => {
        this.colorPickerRefreshTimeout = null;
        this.#sortColorList(this.sortPrimary, this.sortSecondary, this.showUnused, this.showCompleted, this.showFree, this.showPremium, this.sortBought);
      }, 100);
    });
    this.colorPickerObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /** Stops watching Wplace's color picker.
   * @since 0.92.21
   */
  #stopColorPickerObserver() {
    if (!this.colorPickerObserver) {return;}
    this.colorPickerObserver.disconnect();
    this.colorPickerObserver = null;
    if (this.colorPickerRefreshTimeout) {
      clearTimeout(this.colorPickerRefreshTimeout);
      this.colorPickerRefreshTimeout = null;
    }
  }

  /** Disconnects live observers used for window persistence.
   * @since 0.92.0
   */
  #cleanupWindowPersistence() {
    if (this.windowResizeObserver) {
      this.windowResizeObserver.disconnect();
      this.windowResizeObserver = null;
    }
    if (this.windowViewportResizeHandler) {
      window.removeEventListener('resize', this.windowViewportResizeHandler);
      this.windowViewportResizeHandler = null;
    }
    if (this.windowSaveTimeout) {
      clearTimeout(this.windowSaveTimeout);
      this.windowSaveTimeout = null;
    }
  }

  /** Returns a clamped dimension value for the window.
   * @param {number} size - The size in pixels
   * @param {number} minimum - Minimum allowed size
   * @param {number} maximum - Maximum allowed size
   * @returns {number}
   * @since 0.92.0
   */
  #clampWindowDimension(size, minimum, maximum) {
    const resolvedMaximum = Math.max(1, maximum);
    const resolvedMinimum = Math.min(minimum, resolvedMaximum);
    return Math.min(Math.max(Math.round(Number(size) || resolvedMinimum), resolvedMinimum), resolvedMaximum);
  }

  /** Returns a viewport-safe position for the window.
   * @param {HTMLElement} windowElement
   * @param {number} x
   * @param {number} y
   * @returns {{x: number, y: number}}
   * @since 0.92.0
   */
  #clampWindowPosition(windowElement, x, y) {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - windowElement.offsetWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - windowElement.offsetHeight - margin);
    return {
      x: Math.min(Math.max(Math.round(Number(x) || margin), margin), maxX),
      y: Math.min(Math.max(Math.round(Number(y) || margin), margin), maxY)
    };
  }

  /** Applies the windowed filter transform from the persisted state immediately.
   * @param {HTMLElement} windowElement
   * @param {Object} windowState
   * @since 0.92.26
   */
  #applyWindowStatePosition(windowElement, windowState) {
    const x = Number(windowState.x);
    const y = Number(windowState.y);
    if (!windowElement?.isConnected || !Number.isFinite(x) || !Number.isFinite(y)) {return;}

    const clampedPosition = this.#clampWindowPosition(windowElement, x, y);
    windowElement.style.left = '0px';
    windowElement.style.top = '0px';
    windowElement.style.right = '';
    windowElement.style.transform = `translate(${clampedPosition.x}px, ${clampedPosition.y}px)`;

    if ((clampedPosition.x != x) || (clampedPosition.y != y)) {
      windowState.x = clampedPosition.x;
      windowState.y = clampedPosition.y;
      void this.settingsManager?.saveUserStorageNow();
    }
  }

  /** Applies the persisted size and position to the windowed filter.
   * @param {HTMLElement} windowElement
   * @since 0.92.0
   */
  #restoreWindowState(windowElement, options = {}) {
    const windowState = this.#getWindowState();
    if (!windowState || !windowElement) {return;}

    this.#applyDefaultWindowPosition(windowElement, windowState, options);

    const width = Number(windowState.width);
    const height = Number(windowState.height);
    const hasWidth = Number.isFinite(width);
    const hasHeight = Number.isFinite(height);

    if (hasWidth) {
      windowState.width = this.#clampWindowDimension(width, this.windowMinWidth, Math.min(this.windowMaxWidth, window.innerWidth - 16));
      windowElement.style.width = `${windowState.width}px`;
    }
    if (hasHeight) {
      windowState.height = this.#clampWindowDimension(height, this.windowMinHeight, Math.min(this.windowMaxHeight, window.innerHeight - 16));
      windowElement.style.height = `${windowState.height}px`;
    }

    this.#applyWindowStatePosition(windowElement, windowState);
  }

  /** Saves the current size and position of the windowed filter.
   * @param {HTMLElement} windowElement
   * @since 0.92.0
   */
  #saveWindowState(windowElement) {
    const windowState = this.#getWindowState();
    if (!windowState || !windowElement?.isConnected || !windowElement.classList.contains('bm-windowed')) {return;}
    if (windowElement.querySelector('.bm-dragbar button[data-button-status="collapsed"]')) {return;}

    const rect = windowElement.getBoundingClientRect();
    const width = this.#clampWindowDimension(rect.width, this.windowMinWidth, Math.min(this.windowMaxWidth, window.innerWidth - 16));
    const height = this.#clampWindowDimension(rect.height, this.windowMinHeight, Math.min(this.windowMaxHeight, window.innerHeight - 16));

    if (Math.round(rect.width) != width) {
      windowElement.style.width = `${width}px`;
    }
    if (Math.round(rect.height) != height) {
      windowElement.style.height = `${height}px`;
    }

    const clampedPosition = this.#clampWindowPosition(windowElement, rect.left, rect.top);
    windowElement.style.left = '0px';
    windowElement.style.top = '0px';
    windowElement.style.right = '';
    windowElement.style.transform = `translate(${clampedPosition.x}px, ${clampedPosition.y}px)`;

    windowState.x = clampedPosition.x;
    windowState.y = clampedPosition.y;
    windowState.width = width;
    windowState.height = height;

    void this.settingsManager?.saveUserStorageNow();
  }

  /** Debounces persisting the current window size and position.
   * @param {HTMLElement} windowElement
   * @param {number} [delay=150]
   * @since 0.92.0
   */
  #scheduleWindowStateSave(windowElement, delay = 150) {
    if (this.windowSaveTimeout) {
      clearTimeout(this.windowSaveTimeout);
    }
    this.windowSaveTimeout = setTimeout(() => {
      this.windowSaveTimeout = null;
      this.#saveWindowState(windowElement);
    }, delay);
  }

  /** Enables persistence and resize handling for the windowed filter.
   * @since 0.92.0
   */
  #initializeWindowedPersistence(options = {}) {
    const windowElement = document.querySelector(`#${this.windowID}.bm-window`);
    if (!windowElement) {return;}

    this.#cleanupWindowPersistence();
    this.#restoreWindowState(windowElement, options);

    this.handleDrag(`#${this.windowID}.bm-window`, `#${this.windowID} .bm-dragbar`, {
      onEnd: ({element}) => this.#saveWindowState(element)
    });
    this.handleResize(`#${this.windowID}.bm-window`, `#${this.windowID} .bm-resize-corner`, {
      minWidth: Math.min(this.windowMinWidth, window.innerWidth - 16),
      minHeight: this.windowMinHeight,
      maxWidth: Math.min(this.windowMaxWidth, window.innerWidth - 16),
      maxHeight: Math.min(this.windowMaxHeight, window.innerHeight - 16),
      onEnd: ({element}) => this.#saveWindowState(element)
    });

    if (typeof ResizeObserver == 'function') {
      this.windowResizeObserver = new ResizeObserver(() => this.#scheduleWindowStateSave(windowElement));
      this.windowResizeObserver.observe(windowElement);
    }

    this.windowViewportResizeHandler = () => this.#scheduleWindowStateSave(windowElement, 0);
    window.addEventListener('resize', this.windowViewportResizeHandler);
  }

  /** Applies the first-spawn windowed filter position beside the main Blue Marble window.
   * @param {HTMLElement} windowElement
   * @param {Object} windowState
   * @since 0.92.19
   */
  #applyDefaultWindowPosition(windowElement, windowState, options = {}) {
    const hasSavedPosition = Number.isFinite(Number(windowState.x)) && Number.isFinite(Number(windowState.y));
    const hasLegacyDefaultPosition = hasSavedPosition && Number(windowState.x) <= 8 && Number(windowState.y) <= 8;
    if (hasSavedPosition && !hasLegacyDefaultPosition && !options.forceDefaultPosition) {return;}

    const mainWindow = document.querySelector('#bm-window-main.bm-window');
    if (!mainWindow) {
      windowState.x = 8;
      windowState.y = 10;
      windowState.windowedPositionVersion = 1;
      return;
    }

    const mainRect = mainWindow.getBoundingClientRect();
    const gap = 10;
    const preferredX = mainRect.left - windowElement.offsetWidth - gap;
    const preferredY = mainRect.top;
    const fallbackX = mainRect.left + mainRect.width + gap;
    const clampedPreferred = this.#clampWindowPosition(windowElement, preferredX, preferredY);

    if (Math.abs(clampedPreferred.x - preferredX) <= 2) {
      windowState.x = clampedPreferred.x;
      windowState.y = clampedPreferred.y;
      windowState.windowedPositionVersion = 1;
      return;
    }

    const clampedFallback = this.#clampWindowPosition(windowElement, fallbackX, preferredY);
    windowState.x = clampedFallback.x;
    windowState.y = clampedFallback.y;
    windowState.windowedPositionVersion = 1;
  }

  /** Snaps the windowed filter beside the main Blue Marble window.
   * @param {HTMLElement | null} windowElement
   * @since 0.92.26
   */
  #snapWindowedFilterToDefaultPosition(windowElement) {
    const windowState = this.#getWindowState();
    if (!windowState || !windowElement) {return;}
    this.#applyDefaultWindowPosition(windowElement, windowState, {forceDefaultPosition: true});
    this.#applyWindowStatePosition(windowElement, windowState);
    void this.settingsManager?.saveUserStorageNow();
  }

  /** Checks whether a premium color appears usable in Wplace's own palette.
   * @param {{id: number, premium: boolean}} color - Palette color metadata
   * @returns {boolean}
   * @since 0.92.15
   */
  #isColorBought(color, boughtColorIDs = this.#getBoughtColorIDs()) {
    return this.boughtColorDetector.isColorBought(color, boughtColorIDs);
  }

  /** Finds bought premium color IDs from the best available source.
   * @returns {Set<number> | null}
   * @since 0.92.22
   */
  #getBoughtColorIDs() {
    return this.boughtColorDetector.getBoughtColorIDs();
  }

  /** Finds purchased premium color IDs from Wplace user data, when the payload exposes them.
   * @returns {Set<number> | null}
   * @since 0.92.16
   */
  #getBoughtColorIDsFromUserData() {
    return this.boughtColorDetector.getBoughtColorIDsFromUserData();
  }

  /** Dumps premium color purchase detection details to the console.
   * @since 0.92.16
   */
  #dumpBoughtColorDetection() {
    return this.boughtColorDetector.dumpDetection();
  }

  /** Creates the color list container.
   * @param {HTMLElement} parentElement - Parent element to add the color list to as a child
   * @since 0.88.222
   */
  #buildColorList(parentElement) {

    // Figures out if this window is fullscreen or windowed mode
    const isWindowedMode = parentElement.closest(`#${this.windowID}`)?.classList.contains('bm-windowed');
    // Note: `undefined` is expected to behave as if `false`

    const colorList = new Overlay(this.name, this.version);
    colorList.addDiv({'id': this.colorListID})
    // We leave it open so we can add children to the grid

    // Generated by #updateColorList()
    const colorStatistics = this.updateColorList();
    const boughtColorIDs = this.#getBoughtColorIDs();

    // For each color in the palette...
    for (const color of this.palette) {

      // Converts the RGB color to hexdecimal
      const colorValueHex = '#' + rgbToHex(color.rgb).toUpperCase();

      // Relative Luminance
      const lumin = calculateRelativeLuminance(color.rgb);

      // Calculates if white or black text would contrast better with the palette color
      let textColorForPaletteColorBackground = 
      (((1.05) / (lumin + 0.05)) > ((lumin + 0.05) / 0.05)) 
      ? 'white' : 'black';

      // However, if the color is "Transparent" (or there is no color ID), then we make the text color transparent
      if (!color.id) {
        textColorForPaletteColorBackground = 'transparent';
      }

      // Changes the luminance of the hover/focus button effect
      const bgEffectForButtons = (textColorForPaletteColorBackground == 'white') ? 'bm-button-hover-white' : 'bm-button-hover-black';
      const colorRGB = color.rgb?.map(channel => Number(channel) || 0).join(',');
      const colorCardText = ((color.id == -2) || (color.id == -1) || (color.id == 0))
        ? 'white'
        : textColorForPaletteColorBackground;
      const colorCardStyle = `--bm-filter-card-bg: rgb(${colorRGB}); --bm-filter-card-fg: ${colorCardText};`;

      // Generated by #updateColorList()
      const {
        colorCorrect: colorCorrect,
        colorCorrectLocalized: colorCorrectLocalized,
        colorPercent: colorPercent,
        colorTotal: colorTotal,
        colorTotalLocalized: colorTotalLocalized,
        colorIncorrect: colorIncorrect,
        colorCompleted: colorCompleted
      } = colorStatistics[color.id];

      const isColorHidden = !!(this.templateManager.shouldFilterColor.get(color.id) || false);
      const colorBought = this.#isColorBought(color, boughtColorIDs);

      // Add the color to the color list DOM
      if (isWindowedMode) {

        // The star pattern for premium colors
        const styleBackgroundStar = `background-size: auto 100%; background-repeat: repeat-x; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M50,5L79,91L2,39L98,39L21,91' fill='${textColorForPaletteColorBackground}' fill-opacity='.1'/></svg>");`;

        // Add windowed mode color DOM to color list
        colorList.addDiv({'class': 'bm-container bm-filter-color bm-flex-between',
          // Dataset
          'data-id': color.id,
          'data-name': color.name,
          'data-bought': +colorBought,
          'data-premium': +color.premium,
          'data-state': isColorHidden ? 'hidden' : 'shown',
          'data-correct': !Number.isNaN(parseInt(colorCorrect)) ? colorCorrect : '0',
          'data-total': colorTotal,
          'data-percent': (colorPercent.slice(-1) == '%') ? colorPercent.slice(0, -1) : '0',
          'data-incorrect': colorIncorrect || 0,
          'data-completed': +colorCompleted
        }, (instance, div) => this.#initializeColorBlockToggle(div, color))
          .addDiv({'class': 'bm-filter-container-rgb', 'style': `background-color: rgb(${color.rgb?.map(channel => Number(channel) || 0).join(',')});${color.premium ? styleBackgroundStar : ''}`})
            .addButton({
              'class': 'bm-button-trans bm-filter-color-visibility ' + bgEffectForButtons,
              'data-state': isColorHidden ? 'hidden' : 'shown',
              'aria-label': isColorHidden ? `Show the color ${color.name || ''} on templates.` : `Hide the color ${color.name || ''} on templates.`,
              'innerHTML': isColorHidden ? this.eyeClosed : this.eyeOpen,
              'style': `color: ${textColorForPaletteColorBackground};`},
              (instance, button) => {

                // When the button is clicked
                button.onclick = event => {
                  event.stopPropagation();
                  this.#toggleColorVisibility(button, color);
                }

                // Disables the "hide color" button if the color is "Transparent" (or no ID exists)
                if (!color.id) {button.disabled = true;}
                this.#syncColorToggleLabel(button, color);
              }
            ).buildElement()
            .addSmall({'textContent': `#${color.id.toString().padStart(2, 0)}`, 'style': `color: ${((color.id == -1) || (color.id == 0)) ? 'white' : textColorForPaletteColorBackground}`}).buildElement()
            .addHeader(2, {'textContent': color.name, 'style': `color: ${((color.id == -1) || (color.id == 0)) ? 'white' : textColorForPaletteColorBackground}`}).buildElement()
            .addSmall({'class': 'bm-filter-color-pxl-cnt', 'textContent': `${colorCorrectLocalized} / ${colorTotalLocalized}`, 'style': `color: ${((color.id == -1) || (color.id == 0)) ? 'white' : textColorForPaletteColorBackground}; flex: 1 1 auto; text-align: right;`}).buildElement()
          .buildElement()
        .buildElement();
      } else {
        // Else we are in fullscreen mode.

        // Add fullscreen mode color DOM to color list
        colorList.addDiv({'class': 'bm-container bm-filter-color bm-flex-between',
          'style': colorCardStyle,
          'data-id': color.id,
          'data-name': color.name,
          'data-bought': +colorBought,
          'data-premium': +color.premium,
          'data-state': isColorHidden ? 'hidden' : 'shown',
          'data-correct': !Number.isNaN(parseInt(colorCorrect)) ? colorCorrect : '0',
          'data-total': colorTotal,
          'data-percent': (colorPercent.slice(-1) == '%') ? colorPercent.slice(0, -1) : '0',
          'data-incorrect': colorIncorrect || 0,
          'data-completed': +colorCompleted
        }, (instance, div) => this.#initializeColorBlockToggle(div, color))
          .addDiv({'class': 'bm-filter-premium-star', 'aria-hidden': 'true'}).buildElement()
          .addDiv({'class': 'bm-filter-color-main'})
            .addDiv({'class': 'bm-filter-container-rgb'})
              .addButton({
                'class': 'bm-button-trans bm-filter-color-visibility ' + bgEffectForButtons,
                'data-state': isColorHidden ? 'hidden' : 'shown',
                'aria-label': isColorHidden ? `Show the color ${color.name || ''} on templates.` : `Hide the color ${color.name || ''} on templates.`,
                'innerHTML': isColorHidden ? this.eyeClosed : this.eyeOpen,
                'style': `color: ${colorCardText};`},
                (instance, button) => {

                  // When the button is clicked
                  button.onclick = event => {
                    event.stopPropagation();
                    this.#toggleColorVisibility(button, color);
                  }

                  // Disables the "hide color" button if the color is "Transparent" (or no ID exists)
                  if (!color.id) {button.disabled = true;}
                  this.#syncColorToggleLabel(button, color);
                }
              ).buildElement()
            .buildElement()
            .addDiv({'class': 'bm-filter-color-title'})
              .addSmall({'textContent': `#${color.id.toString().padStart(2, 0)} / ${(color.id == -2) ? 'mixed' : colorValueHex}`}).buildElement()
              .addHeader(2, {'textContent': color.name}).buildElement()
            .buildElement()
          .buildElement()
          .addDiv({'class': 'bm-filter-color-meta'})
            .addButton({'class': 'bm-button-circle bm-filter-locate bm-filter-color-locate', 'title': `Go to a remaining ${color.name || 'color'} pixel`, 'aria-label': `Go to a remaining ${color.name || 'color'} pixel`, 'innerHTML': this.locationIcon}, (instance, button) => {
              button.onclick = event => {
                event.stopPropagation();
                this.#goToRandomPendingPixel(color.id, color.name);
              };
              button.disabled = !Number(colorTotal);
            }).buildElement()
            .addDiv({'class': 'bm-filter-color-progress'})
              .addSpan({'class': 'bm-filter-color-pxl-cnt', 'textContent': `${colorCorrectLocalized} / ${colorTotalLocalized}`}).buildElement()
              .addSmall({'class': 'bm-filter-color-pxl-desc', 'textContent': `${colorPercent} done - ${((typeof colorIncorrect == 'number') && !isNaN(colorIncorrect)) ? colorIncorrect : '???'} off`}).buildElement()
            .buildElement()
          .buildElement()
        .buildElement();
      }
    }

    // Adds the colors to the color container in the filter window
    colorList.buildOverlay(parentElement);
  }

  /** Sorts the color list & hides colors excluded by the current filters.
   * @param {string} sortPrimary - The name of the dataset attribute to sort by.
   * @param {string} sortSecondary - Secondary sort. It can be either 'ascending' or 'descending'.
   * @param {boolean} showUnused - Should unused colors be displayed in the list to the user?
   * @param {boolean} showCompleted - Should completed colors be displayed in the list to the user?
   * @param {boolean} showFree - Should free colors be displayed in the list to the user?
   * @param {boolean} showPremium - Should premium colors be displayed in the list to the user?
   * @param {boolean} sortBought - Should premium colors be limited to bought colors?
   * @since 0.88.222
   */
  #sortColorList(sortPrimary, sortSecondary, showUnused, showCompleted = this.showCompleted, showFree = this.showFree, showPremium = this.showPremium, sortBought = this.sortBought) {

    const allowedPrimarySorts = new Set(['id', 'name', 'premium', 'percent', 'correct', 'incorrect', 'total']);
    const allowedSecondarySorts = new Set(['ascending', 'descending']);
    if (sortPrimary == 'bought') {
      sortPrimary = 'total';
      sortBought = true;
    }
    if (!allowedPrimarySorts.has(sortPrimary)) {sortPrimary = this.sortPrimary;}
    if (!allowedSecondarySorts.has(sortSecondary)) {sortSecondary = this.sortSecondary;}
    sortBought = !!sortBought;
    const boughtColorIDs = this.#getBoughtColorIDs();
    const boughtColorStateKnown = !!boughtColorIDs;
    const shouldOnlyShowBoughtColors = sortBought && showPremium && boughtColorStateKnown;

    // Update memorised sort settings
    this.sortPrimary = sortPrimary;
    this.sortSecondary = sortSecondary;
    this.sortBought = sortBought;
    this.showUnused = showUnused;
    this.showCompleted = showCompleted;
    this.showFree = showFree;
    this.showPremium = showPremium;
    this.#persistFilterViewSettings();

    const colorList = document.querySelector(`#${this.colorListID}`);
    if (!colorList) {return;}

    const colors = Array.from(colorList.children);

    for (const color of colors) {
      const paletteColor = this.palette.find(paletteColor => paletteColor.id == color.dataset['id']);
      color.dataset['bought'] = +this.#isColorBought(paletteColor, boughtColorIDs);

      const isUnused = !Number(color.getAttribute('data-total'));
      const isCompleted = color.getAttribute('data-completed') == '1';
      const isPremium = color.getAttribute('data-premium') == '1';
      const isBought = color.getAttribute('data-bought') == '1';
      const shouldHideColor = (!showUnused && isUnused)
        || (!showCompleted && isCompleted)
        || (!showFree && !isPremium)
        || (!showPremium && isPremium)
        || (shouldOnlyShowBoughtColors && isPremium && !isBought);

      color.classList.toggle('bm-color-hide', shouldHideColor);
    }

    colors.sort((index, nextIndex) => {
      const dataKey = sortPrimary;
      if (shouldOnlyShowBoughtColors) {
        const boughtCompare = this.#compareColorDataset(index, nextIndex, 'bought', 'descending');
        if (boughtCompare) {return boughtCompare;}
      }

      const indexValue = index.getAttribute('data-' + dataKey);
      const nextIndexValue = nextIndex.getAttribute('data-' + dataKey);

      const indexValueNumber = parseFloat(indexValue);
      const nextIndexValueNumber = parseFloat(nextIndexValue);

      const indexValueNumberIsNumber = !isNaN(indexValueNumber);
      const nextIndexValueNumberIsNumber = !isNaN(nextIndexValueNumber);

      // If both index values are numbers...
      if (indexValueNumberIsNumber && nextIndexValueNumberIsNumber) {
        // Perform numeric comparison
        return sortSecondary === 'ascending' ? indexValueNumber - nextIndexValueNumber : nextIndexValueNumber - indexValueNumber;
      } else {
        // Otherwise, perform string comparison
        const indexValueString = indexValue.toLowerCase();
        const nextIndexValueString = nextIndexValue.toLowerCase();
        if (indexValueString < nextIndexValueString) return sortSecondary === 'ascending' ? -1 : 1;
        if (indexValueString > nextIndexValueString) return sortSecondary === 'ascending' ? 1 : -1;
        return 0;
      }
    });

    colors.forEach(color => colorList.appendChild(color));
  }

  /** Compares two color cards by a dataset key.
   * @param {HTMLElement} index - Current color card
   * @param {HTMLElement} nextIndex - Next color card
   * @param {string} dataKey - Dataset key to compare
   * @param {'ascending' | 'descending'} sortDirection - Sort direction
   * @returns {number}
   * @since 0.92.15
   */
  #compareColorDataset(index, nextIndex, dataKey, sortDirection) {
    const indexValue = index.getAttribute('data-' + dataKey) ?? '';
    const nextIndexValue = nextIndex.getAttribute('data-' + dataKey) ?? '';

    const indexValueNumber = parseFloat(indexValue);
    const nextIndexValueNumber = parseFloat(nextIndexValue);
    const indexValueNumberIsNumber = !isNaN(indexValueNumber);
    const nextIndexValueNumberIsNumber = !isNaN(nextIndexValueNumber);

    if (indexValueNumberIsNumber && nextIndexValueNumberIsNumber) {
      return sortDirection === 'ascending'
        ? indexValueNumber - nextIndexValueNumber
        : nextIndexValueNumber - indexValueNumber;
    }

    const indexValueString = indexValue.toLowerCase();
    const nextIndexValueString = nextIndexValue.toLowerCase();
    if (indexValueString < nextIndexValueString) return sortDirection === 'ascending' ? -1 : 1;
    if (indexValueString > nextIndexValueString) return sortDirection === 'ascending' ? 1 : -1;
    return 0;
  }

  /** (Un)selects all colors in the color list.
   * @param {boolean} userWantsUnselect - Does the user want to unselect colors?
   * @since 0.88.222
   */
  #selectColorList(userWantsUnselect) {

    // Gets the colors
    const colorList = document.querySelector(`#${this.colorListID}`);
    const colors = Array.from(colorList.children);
    const targetState = userWantsUnselect ? 'shown' : 'hidden';
    const targetIsHidden = targetState == 'hidden';
    const renderedColors = new Map(colors.map(color => [Number(color.dataset.id), color]));
    const changedColorIDs = [];

    // Apply the bulk action to the full palette, not just the currently visible cards.
    for (const paletteColor of this.palette) {
      if (!paletteColor?.id) {continue;}

      const colorIsHidden = !!this.templateManager.shouldFilterColor.get(paletteColor.id);
      if (colorIsHidden != targetIsHidden) {changedColorIDs.push(paletteColor.id);}

      const colorElement = renderedColors.get(paletteColor.id);
      const button = colorElement?.querySelector('.bm-filter-color-visibility');
      if (!button || button.disabled) {continue;}

      button.dataset['state'] = targetState;
      button.innerHTML = targetIsHidden ? this.eyeClosed : this.eyeOpen;
      this.#syncColorToggleLabel(button, paletteColor);
    }

    this.templateManager.setColorFilters(changedColorIDs, targetIsHidden);
    if (this.templateManager.renderPerfDebug) {
      console.log(`[BM PERF] bulk-filter ${JSON.stringify({
        'hidden': targetIsHidden,
        'colorsChanged': changedColorIDs.length,
        'visibleCards': colors.length,
        'paletteColors': this.palette.length
      })}`);
    }
  }

  /** Shows only the colors currently visible in the sorted and filtered color list.
   * @since 0.92.33
   */
  #selectFilteredColorList() {

    const colorList = document.querySelector(`#${this.colorListID}`);
    if (!colorList) {return;}

    const colors = Array.from(colorList.children);
    const visibleColorIDs = new Set(colors
      .filter(color => !color.classList.contains('bm-color-hide'))
      .map(color => Number(color.dataset.id))
      .filter(colorID => Number.isFinite(colorID)));

    const renderedColors = new Map(colors.map(color => [Number(color.dataset.id), color]));
    const hiddenColorIDs = [];
    let hiddenColorsChanged = 0;
    let shownColorsChanged = 0;

    for (const paletteColor of this.palette) {
      if (!paletteColor?.id) {continue;}

      const shouldBeHidden = !visibleColorIDs.has(paletteColor.id);
      const colorIsHidden = !!this.templateManager.shouldFilterColor.get(paletteColor.id);
      if (shouldBeHidden) {
        hiddenColorIDs.push(paletteColor.id);
      }
      if (colorIsHidden != shouldBeHidden) {
        shouldBeHidden ? hiddenColorsChanged++ : shownColorsChanged++;
      }

      const colorElement = renderedColors.get(paletteColor.id);
      const button = colorElement?.querySelector('.bm-filter-color-visibility');
      if (!button || button.disabled) {continue;}

      button.dataset['state'] = shouldBeHidden ? 'hidden' : 'shown';
      button.innerHTML = shouldBeHidden ? this.eyeClosed : this.eyeOpen;
      this.#syncColorToggleLabel(button, paletteColor);
    }

    this.templateManager.replaceColorFilters(hiddenColorIDs);

    if (this.templateManager.renderPerfDebug) {
      console.log(`[BM PERF] filtered-only ${JSON.stringify({
        'visibleCards': visibleColorIDs.size,
        'hiddenColorsChanged': hiddenColorsChanged,
        'shownColorsChanged': shownColorsChanged,
        'paletteColors': this.palette.length
      })}`);
    }
  }

  /** Updates the color toggle labels on the icon and the clickable color block.
   * @param {HTMLButtonElement} button - The color visibility button
   * @param {Object} color - Palette color metadata
   * @since 0.95.0
   */
  #syncColorToggleLabel(button, color) {
    const ariaLabel = (button.dataset['state'] == 'hidden')
      ? `Show the color ${color.name || ''} on templates.`
      : `Hide the color ${color.name || ''} on templates.`;

    button.ariaLabel = ariaLabel;

    const colorElement = button.closest('.bm-filter-color');
    colorElement?.setAttribute('aria-label', ariaLabel);
    colorElement?.setAttribute('data-state', button.dataset['state']);

  }

  /** Toggles a color from the clickable color block or its icon.
   * @param {HTMLButtonElement} button - The color visibility button
   * @param {Object} color - Palette color metadata
   * @since 0.95.0
   */
  #toggleColorVisibility(button, color) {
    if (!button || button.disabled || !color.id) {return;}

    button.style.textDecoration = 'none';
    button.disabled = true;

    if (button.dataset['state'] == 'shown') {
      button.innerHTML = this.eyeClosed;
      button.dataset['state'] = 'hidden';
      this.templateManager.setColorFiltered(color.id, true);
      this.#animateColorToggleIcon(button, 'hide');
    } else {
      button.innerHTML = this.eyeOpen;
      button.dataset['state'] = 'shown';
      this.templateManager.setColorFiltered(color.id, false);
      this.#animateColorToggleIcon(button, 'show');
    }

    this.#syncColorToggleLabel(button, color);
    button.disabled = false;
    button.style.textDecoration = '';
  }

  /** Animates the eye slash only for direct visibility toggles.
   * @param {HTMLButtonElement} button - The color visibility button
   * @param {'hide' | 'show'} direction - Which slash animation to play
   * @since 0.95.0
   */
  #animateColorToggleIcon(button, direction) {
    if (!button) {return;}

    const animateClass = direction == 'hide' ? 'bm-filter-eye-animate-hide' : 'bm-filter-eye-animate-show';
    button.classList.remove('bm-filter-eye-animate-hide', 'bm-filter-eye-animate-show');

    // Restart the class-driven SVG stroke animation when the same color is toggled repeatedly.
    void button.offsetWidth;

    button.classList.add(animateClass);

    let timeoutID = null;
    const finishAnimation = () => {
      window.clearTimeout(timeoutID);
      button.classList.remove(animateClass);

      if ((direction == 'show') && (button.dataset['state'] == 'shown')) {
        button.innerHTML = this.eyeOpen;
      }
    };

    button.addEventListener('animationend', finishAnimation, {once: true});
    timeoutID = window.setTimeout(finishAnimation, 280);
  }

  /** Makes a color block toggleable by pointer or keyboard.
   * @param {HTMLElement} colorElement - The color block element
   * @param {Object} color - Palette color metadata
   * @since 0.95.0
   */
  #initializeColorBlockToggle(colorElement, color) {
    if (!colorElement || !color.id) {return;}

    colorElement.classList.add('bm-filter-color-toggle');
    colorElement.tabIndex = 0;
    colorElement.setAttribute('role', 'button');

    colorElement.onclick = event => {
      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) {return;}

      const button = colorElement.querySelector('.bm-filter-color-visibility');
      this.#toggleColorVisibility(button, color);
    };

    colorElement.onkeydown = event => {
      if ((event.key != 'Enter') && (event.key != ' ')) {return;}

      event.preventDefault();
      colorElement.click();
    };
  }

  /** Navigates Wplace to a random pending pixel from currently loaded tiles.
   * @param {number | undefined} colorID - If set, only pending pixels for this color are considered.
   * @param {string | undefined} colorName - Display name for errors and status messages.
   * @since 0.92.1
   */
  async #goToRandomPendingPixel(colorID = undefined, colorName = undefined) {

    const pixel = this.templateManager.getRandomPendingPixel(colorID);

    if (!pixel) {
      const suffix = colorName ? ` for ${colorName}` : '';
      this.handleDisplayError(`No remaining pixels${suffix} found in loaded tiles. Move around the template or refresh loaded tiles first.`);
      return;
    }

    const coords = [pixel.tileX, pixel.tileY, pixel.pixelX, pixel.pixelY];
    this.updateInnerHTML('bm-input-tx', coords[0] ?? '');
    this.updateInnerHTML('bm-input-ty', coords[1] ?? '');
    this.updateInnerHTML('bm-input-px', coords[2] ?? '');
    this.updateInnerHTML('bm-input-py', coords[3] ?? '');

    const { lat, lng } = tilePixelToLatLng(...coords, this.templateManager.tileSize, 11);
    const url = new URL(window.location.href);
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lng', lng.toString());
    url.searchParams.set('zoom', '17.5');

    const suffix = colorName ? ` (${colorName})` : '';
    this.handleDisplayStatus(`Going to remaining pixel ${coords.join(', ')}${suffix}...`);

    const movedWithoutReload = await navigateWplaceToLatLng(lat, lng, 17.5);
    if (!movedWithoutReload) {
      window.location.assign(url.toString());
    }
  }

  /** The information about a specific color on the palette.
   * @typedef {Object} ColorData
   * @property {number | string} colorTotal
   * @property {string} colorTotalLocalized
   * @property {number | string} colorCorrect
   * @property {string} colorCorrectLocalized
   * @property {string} colorPercent
   * @property {number} colorIncorrect
   * @property {boolean} colorCompleted
   */

  /** Updates the information inside the colors in the color list.
   * If the color list does not exist yet, it returns the color information instead.
   * This assumes the information inside each element is the same between fullscreen and windowed mode.
   * @since 0.90.60
   * @returns {Object.<number, ColorData>}
   */
  updateColorList() {

    this.#calculatePixelStatistics(); // Updates the pixel statistics in the class instance variables

    const colorList = document.querySelector(`#${this.colorListID}`);

    const colorStatistics = {};

    // For each color...
    for (const color of this.palette) {

      // Turns "total" color into a string of a number; "0" if unknown
      const colorTotal = this.allPixelsColor.get(color.id) ?? 0
      const colorTotalLocalized = localizeNumber(colorTotal);
      
      // This will be displayed if the total pixels for this color is zero
      let colorCorrect = 0;
      let colorCorrectLocalized = '0';
      let colorPercent = localizePercent(1);

      // This will be displayed if the total pixels for this color is non-zero
      if (colorTotal != 0) {

        // Determines the correct pixels, or the proper fallback
        colorCorrect = this.allPixelsCorrect.get(color.id) ?? '???';
        if ((typeof colorCorrect != 'number') && (this.tilesLoadedTotal == this.tilesTotal) && !!color.id) {
          colorCorrect = 0;
        }

        colorCorrectLocalized = (typeof colorCorrect == 'string') ? colorCorrect : localizeNumber(colorCorrect);
        colorPercent = isNaN(colorCorrect / colorTotal) ? '???' : localizePercent(colorCorrect / colorTotal);
      }
      // There are four outcomes:
      // 1. The correct pixel count is displayed, because there are correct pixels.
      // 2. There are NO correct pixels, and the color is not transparent, but since all tiles are loaded, we know that the correct pixel count is actually 0.
      // 3. There are NO correct pixels, and the color is not transparent, and not all tiles are loaded. We don't know if there are correct pixels or not, so we display "???" instead.
      // 4. There are NO correct pixels, and the color is transparent, so we display '???' because tracking the "Transparent" color is currently disabled.

      // Incorrect pixels for this color
      const colorIncorrect = parseInt(colorTotal) - parseInt(colorCorrect);
      const colorCompleted = (colorTotal > 0) && (typeof colorCorrect == 'number') && (colorIncorrect <= 0);

      colorStatistics[color.id] = {
        colorTotal: colorTotal,
        colorTotalLocalized: colorTotalLocalized,
        colorCorrect: colorCorrect,
        colorCorrectLocalized: colorCorrectLocalized,
        colorPercent: colorPercent,
        colorIncorrect: colorIncorrect,
        colorCompleted: colorCompleted
      }
    }

    // Obtains the correct / total pixels display element, or `undefined` if in fullscreen mode
    const windowedColorTotals = document.querySelector('#bm-filter-windowed-color-totals');

    // If the element exists...
    if (windowedColorTotals) {

      // Returns the number, unlocalized (no space to localize)
      // OR returns the three characters on either end of the string, with the middle replaced with an ellipse.
      // E.g. '1234567' or '123…678'
      const allCorrect = (this.allPixelsCorrectTotal.toString().length > 7) ? this.allPixelsCorrectTotal.toString().slice(0, 2) + '…' + this.allPixelsCorrectTotal.toString().slice(-3) : this.allPixelsCorrectTotal.toString();
      const allTotal = (this.allPixelsTotal.toString().length > 7) ? this.allPixelsTotal.toString().slice(0, 2) + '…' + this.allPixelsTotal.toString().slice(-3) : this.allPixelsTotal.toString();

      // Updates the display with XSS protection enabled (because why not)
      this.updateInnerHTML('#bm-filter-windowed-color-totals', `${allCorrect}/${allTotal}`, true);
    }

    this.updateInnerHTML('#bm-filter-tile-load', `${localizeNumber(this.tilesLoadedTotal)} / ${localizeNumber(this.tilesTotal)}`);
    this.updateInnerHTML('#bm-filter-tot-total', localizeNumber(this.allPixelsTotal));
    this.updateInnerHTML('#bm-filter-tot-correct', `${localizeNumber(this.allPixelsCorrectTotal)} (${localizePercent(this.allPixelsCorrectTotal / (this.allPixelsTotal || 1))})`);
    this.updateInnerHTML('#bm-filter-tot-remaining', `${localizeNumber((this.allPixelsTotal || 0) - (this.allPixelsCorrectTotal || 0))} (${localizePercent(((this.allPixelsTotal || 0) - (this.allPixelsCorrectTotal || 0)) / (this.allPixelsTotal || 1))})`);
    this.updateInnerHTML('#bm-filter-tot-completed', `<time datetime="${this.timeRemaining.toISOString().replace(/\.\d{3}Z$/, 'Z')}">${this.timeRemainingLocalized}</time>`);

    // Return early if the color list does not exist.
    // We can't update DOM elements that don't exist, so we exit now.
    if (!colorList) {return colorStatistics;}

    const colors = Array.from(colorList.children);

    // For each color...
    for (const color of colors) {

      const colorID = parseInt(color.dataset['id']);

      // Obtains the data to update then
      const {
        colorCorrect: colorCorrect,
        colorCorrectLocalized: colorCorrectLocalized,
        colorPercent: colorPercent,
        colorTotal: colorTotal,
        colorTotalLocalized: colorTotalLocalized,
        colorIncorrect: colorIncorrect,
        colorCompleted: colorCompleted
      } = colorStatistics[colorID];

      // Update the dataset
      color.dataset['correct'] = !Number.isNaN(parseInt(colorCorrect)) ? colorCorrect : '0';
      color.dataset['total'] = colorTotal;
      color.dataset['percent'] = (colorPercent.slice(-1) == '%') ? colorPercent.slice(0, -1) : '0';
      color.dataset['incorrect'] = colorIncorrect || 0;
      color.dataset['completed'] = +colorCompleted;

      // Updates the pixel count if it exists
      const pixelCount = document.querySelector(`#${this.windowID} .bm-filter-color[data-id="${colorID}"] .bm-filter-color-pxl-cnt`);
      if (pixelCount) {
        const isWindowedPixelCount = !!pixelCount.closest(`#${this.windowID}.bm-windowed`);
        if (isWindowedPixelCount) {
          pixelCount.textContent = `${colorCorrectLocalized} / ${colorTotalLocalized}`;
        } else {
          pixelCount.textContent = `${colorCorrectLocalized} / ${colorTotalLocalized}`;
        }
      }

      // Updates the pixel description if it exists
      const pixelDesc = document.querySelector(`#${this.windowID} .bm-filter-color[data-id="${colorID}"] .bm-filter-color-pxl-desc`);
      if (pixelDesc) {pixelDesc.textContent = `${colorPercent} done - ${((typeof colorIncorrect == 'number') && !isNaN(colorIncorrect)) ? colorIncorrect : '???'} off`;}

      // Updates the locate button if it exists. This only renders in fullscreen mode.
      const locateButton = document.querySelector(`#${this.windowID} .bm-filter-color[data-id="${colorID}"] .bm-filter-color-locate`);
      if (locateButton) {locateButton.disabled = !Number(colorTotal);}
    }

    // Since the dataset has changed, we need to sort again
    // Because if the user wants to sort by pixel count, the order should change
    this.#sortColorList(this.sortPrimary, this.sortSecondary, this.showUnused, this.showCompleted, this.showFree, this.showPremium, this.sortBought);
  }

  /** Calculates all pixel statistics used in the color filter.
   * @since 0.90.34
   */
  #calculatePixelStatistics() {
    const stats = calculateColorFilterStats({
      templatesArray: this.templateManager.templatesArray,
      palette: this.palette
    });

    this.tilesLoadedTotal = stats.tilesLoadedTotal;
    this.tilesTotal = stats.tilesTotal;
    this.allPixelsTotal = stats.allPixelsTotal;
    this.allPixelsCorrectTotal = stats.allPixelsCorrectTotal;
    this.allPixelsCorrect = stats.allPixelsCorrect;
    this.allPixelsColor = stats.allPixelsColor;
    this.timeRemaining = stats.timeRemaining;
    this.timeRemainingLocalized = stats.timeRemainingLocalized;

    // If the template is complete, non-empty, and every tile has a verified or cached count...
    if ((this.allPixelsCorrectTotal >= this.allPixelsTotal) && !!this.allPixelsTotal && (this.tilesLoadedTotal == this.tilesTotal)) {
      // Basically, only run if Blue Marble can confirm with 100% certanty that all (>0) templates are complete.
      
      // Create confetti in the color filter window
      const confettiManager = new ConfettiManager();
      confettiManager.createConfetti(document.querySelector(`#${this.windowID}`));
    }

  }
}
