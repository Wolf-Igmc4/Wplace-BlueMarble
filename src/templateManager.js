import SettingsManager from "./settingsManager";
import Template from "./Template";
import { base64ToUint8, colorpaletteForBlueMarble, consoleError, consoleLog, consoleWarn, localizeNumber, numberToEncoded, refreshWplaceTiles, sleep, viewCanvasInNewTab } from "./utils";
import WindowMain from "./WindowMain";
import WindowWizard from "./WindowWizard";

/** Manages the template system.
 * This class handles all external requests for template modification, creation, and analysis.
 * It serves as the central coordinator between template instances and the user interface.
 * @class TemplateManager
 * @since 0.55.8
 * @example
 * // JSON structure for a template made in schema version 2.0.0.
 * // Note: The pixel "colors" Object contains more than 2 keys.
 * // Note: The template tiles are stored as base64 PNG images.
 * {
 *   "whoami": "BlueMarble",
 *   "scriptVersion": "1.13.0",
 *   "schemaVersion": "2.0.0",
 *   "templates": {
 *     "0 $Z": {
 *       "name": "My Template",
 *       "enabled": true,
 *       "pixels": {
 *         "total": 40399,
 *         "colors": {
 *           "-2": 40000,
 *           "0": 399
 *         }
 *       }
 *       "tiles": {
 *         "1231,0047,183,593": "iVBORw0KGgoAAAANSUhEUgAA",
 *         "1231,0048,183,000": "AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     },
 *     "1 $Z": {
 *       "name": "My Template",
 *       "URL": "https://github.com/SwingTheVine/Wplace-BlueMarble/blob/main/dist/assets/Favicon.png",
 *       "URLType": "template",
 *       "enabled": false,
 *       "pixels": {
 *         "total": 40399,
 *         "colors": {
 *           "-2": 40000,
 *           "0": 399
 *         }
 *       }
 *       "tiles": {
 *         "375,1846,276,188": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA",
 *         "376,1846,000,188": "data:image/png;AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     }
 *   }
 * }
 * @example
 * // JSON structure for a template made in schema version 1.0.0.
 * // Note: The template tiles are stored as base64 PNG images.
 * {
 *   "whoami": "BlueMarble",
 *   "scriptVersion": "1.13.0",
 *   "schemaVersion": "1.0.0",
 *   "templates": {
 *     "0 $Z": {
 *       "name": "My Template",
 *       "enabled": true,
 *       "coords": "2000, 230, 45, 201"
 *       "palette": {
 *         "0,0,0": {
 *            "count": 123,
 *            "enabled": true
 *         },
 *         "255,255,255": {
 *            "count": 1315,
 *            "enabled": false
 *         }
 *       }
 *       "tiles": {
 *         "1231,0047,183,593": "iVBORw0KGgoAAAANSUhEUgAA",
 *         "1231,0048,183,000": "AAAFCAYAAACNbyblAAAAHElEQVQI12P4"
 *       }
 *     }
 *   }
 * }
 */
export default class TemplateManager {

  /** The constructor for the {@link TemplateManager} class.
   * @param {string} name - The name of the userscript
   * @param {string} version - The version of the userscript (SemVer as string)
   * @since 0.55.8
   */
  constructor(name, version) {

    // Meta
    this.name = name; // Name of userscript
    this.version = version; // Version of userscript
    this.windowMain = null; // The main instance of the Overlay class
    this.settingsManager = null; // The main instance of the SettingsManager class
    this.schemaVersion = '2.0.0'; // Version of JSON schema
    this.userID = null; // The ID of the current user
    this.encodingBase = '!#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]^_`abcdefghijklmnopqrstuvwxyz{|}~'; // Characters to use for encoding/decoding
    this.tileSize = 1000; // The number of pixels in a tile. Assumes the tile is square
    this.drawMult = 3; // The enlarged size for each pixel. E.g. when "3", a 1x1 pixel becomes a 1x1 pixel inside a 3x3 area. MUST BE ODD
    this.paletteTolerance = 3; // Tolerance for how close an RGB value has to be in order to be considered a color. A tolerance of "3" means the sum of the RGB can be up to 3 away from the actual value.
    this.paletteBM = colorpaletteForBlueMarble(this.paletteTolerance); // Retrieves the color palette BM will use as an Object containing multiple Uint32Arrays
    
    // Template
    this.template = null; // The template image.
    this.templateState = ''; // The state of the template ('blob', 'proccessing', 'template', etc.)
    /** An Array of Template classes @type {Array<Template>} */
    this.templatesArray = []; // All Template instnaces currently loaded (Template)
    this.templatesJSON = null; // All templates currently loaded (JSON)
    this.templatesShouldBeDrawn = true; // Should ALL templates be drawn to the canvas?
    this.templatePixelsCorrect = null; // An object where the keys are the tile coords, and the values are Maps (BM palette color IDs) containing the amount of correctly placed pixels for that tile in this template
    /** Will contain all color ID's to filter @type {Map<number, boolean>} */
    this.shouldFilterColor = new Map();
    this.templatesLoadingPromise = null; // Promise used to keep tile rendering from racing saved template loading
    this.loadedTemplateKeys = new Set(); // Storage keys that were actually hydrated into Template instances
    this.sortedTemplatesArray = null; // Cached draw-order template list
    this.templateTileIndex = null; // Cached lookup from tile coords to template chunks
    this.renderStateVersion = 0; // Increments whenever render-relevant template state changes
    this.renderPerfDebug = true; // Temporary render performance logs while optimizing large blueprints
    this.tileRenderCache = new Map(); // Reuses processed tile blobs while tile image + render state are unchanged
    this.tileRenderCacheMaxEntries = 48; // Small LRU cache for visible map churn
    this.tileRenderOutputType = 'image/webp'; // WebP encodes large transparent overlay tiles much faster than PNG
    this.tileRenderOutputQuality = 0.98; // High visual quality for pixel-art overlays
  }

  /** Updates the stored instance of the main window.
   * @param {WindowMain} windowMain - The main window instance
   * @since 0.91.54
   */
  setWindowMain(windowMain) {
    this.windowMain = windowMain;
  }

  /** Updates the stored instance of the SettingsManager.
   * @param {SettingsManager} settingsManager - The settings manager instance
   * @since 0.91.54
   */
  setSettingsManager(settingsManager) {
    this.settingsManager = settingsManager;
    this.#loadColorFilterSettings();
  }

  /** Sets whether a palette color should be hidden from rendered template overlays.
   * @param {number} colorID - Blue Marble palette color ID
   * @param {boolean} shouldBeFiltered - Whether the color should be hidden
   * @since 0.92.1
   */
  setColorFiltered(colorID, shouldBeFiltered) {
    if (shouldBeFiltered) {
      this.shouldFilterColor.set(colorID, true);
      this.renderStateVersion++;
      this.#clearTileRenderCache();
      this.#persistColorFilterSettings();
      return;
    }

    this.shouldFilterColor.delete(colorID);
    this.renderStateVersion++;
    this.#clearTileRenderCache();
    this.#persistColorFilterSettings();
  }

  /** Sets several hidden color filters in one persistence pass.
   * @param {number[]} colorIDs - Blue Marble palette color IDs
   * @param {boolean} shouldBeFiltered - Whether the colors should be hidden
   * @since 0.92.27
   */
  setColorFilters(colorIDs, shouldBeFiltered) {
    let didChange = false;
    for (const colorID of colorIDs) {
      const numericColorID = Number(colorID);
      if (!Number.isFinite(numericColorID)) {continue;}

      if (shouldBeFiltered) {
        if (this.shouldFilterColor.get(numericColorID)) {continue;}
        this.shouldFilterColor.set(numericColorID, true);
        didChange = true;
        continue;
      }

      if (!this.shouldFilterColor.delete(numericColorID)) {continue;}
      didChange = true;
    }

    if (!didChange) {return;}
    this.renderStateVersion++;
    this.#clearTileRenderCache();
    this.#persistColorFilterSettings();
  }

  /** Loads persisted hidden color IDs into the template renderer.
   * @since 0.92.11
   */
  #loadColorFilterSettings() {
    const hiddenColors = this.settingsManager?.userSettings?.filter;
    if (!Array.isArray(hiddenColors)) {return;}

    this.shouldFilterColor = new Map(
      hiddenColors
        .map(colorID => Number(colorID))
        .filter(colorID => Number.isFinite(colorID))
        .map(colorID => [colorID, true])
    );
  }

  /** Persists hidden color IDs in user settings.
   * @since 0.92.11
   */
  #persistColorFilterSettings() {
    if (!this.settingsManager?.userSettings) {return;}

    this.settingsManager.userSettings.filter = Array.from(this.shouldFilterColor.keys())
      .map(colorID => Number(colorID))
      .filter(colorID => Number.isFinite(colorID))
      .sort((a, b) => a - b);
  }

  /** Checks whether any template is currently loaded.
   * @returns {boolean} Whether there are templates available for template-only tools
   * @since 0.92.9
   */
  hasTemplates() {
    return this.templatesArray.length > 0;
  }

  /** Checks whether a storage template is loaded into the active renderer.
   * @param {string} templateKey - Storage key for the template
   * @returns {boolean}
   * @since 0.92.11
   */
  hasLoadedTemplate(templateKey) {
    return this.loadedTemplateKeys.has(templateKey);
  }

  /** Creates the JSON object to store templates in
   * @returns {{ whoami: string, scriptVersion: string, schemaVersion: string, templates: Object }} The JSON object
   * @since 0.65.4
   */
  async createJSON() {
    return {
      "whoami": "BlueMarble", // Canonical storage identifier shared by Blue Marble forks
      "scriptVersion": this.version, // Version of userscript
      "schemaVersion": this.schemaVersion, // Version of JSON schema
      "templates": {} // The templates
    };
  }

  /** Creates the template from the inputed file blob
   * @param {File} blob - The file blob to create a template from
   * @param {string} name - The display name of the template
   * @param {Array<number, number, number, number>} coords - The coordinates of the top left corner of the template
   * @since 0.65.77
   */
  async createTemplate(blob, name, coords) {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}

    this.windowMain.handleDisplayStatus(`Creating template at ${coords.join(', ')}...`);

    // Creates a new template instance
    const template = new Template({
      displayName: name,
      sortID: 0, // Object.keys(this.templatesJSON.templates).length || 0, // Uncomment this to enable multiple templates (1/2)
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      file: blob,
      coords: coords
    });

    // Does the user want to skip transparent tiles while creating templates?
    const shouldSkipTransTiles = !this.settingsManager?.userSettings?.flags?.includes('hl-noSkip');

    // Does the user want to aggressively skip transparent tiles while creating templates?
    const shouldAggSkipTransTiles = this.settingsManager?.userSettings?.flags?.includes('hl-agSkip');

    console.log(`Should Skip: ${shouldSkipTransTiles}; Should Agg Skip: ${shouldAggSkipTransTiles}`);
    
    const { templateTiles, templateTilesBuffers } = await template.createTemplateTiles(this.tileSize, this.paletteBM, shouldSkipTransTiles, shouldAggSkipTransTiles); // Chunks the tiles
    
    template.chunked = templateTiles; // Stores the chunked tile bitmaps

    // Converts total pixel Object/Map variables into JSON-ready format
    const _pixels = { "total": template.pixelCount.total, "colors": Object.fromEntries(template.pixelCount.colors) }

    // Appends a child into the templates object
    // The child's name is the number of templates already in the list (sort order) plus the encoded player ID
    this.templatesJSON.templates[`${template.sortID} ${template.authorID}`] = {
      "name": template.displayName, // Display name of template
      "coords": coords.join(', '), // The coords of the template
      "enabled": true,
      "pixels": _pixels, // The total pixels in the template
      "tiles": templateTilesBuffers // Stores the chunked tile buffers
    };

    this.templatesArray = []; // Remove this to enable multiple templates (2/2)
    this.templatesArray.push(template); // Pushes the Template object instance to the Template Array
    this.#invalidateTemplateRenderCaches();

    this.windowMain.handleDisplayStatus(`Template created at ${coords.join(', ')}!`);
    this.windowMain.refreshTemplateControls();

    console.log(Object.keys(this.templatesJSON.templates).length);
    console.log(this.templatesJSON);
    console.log(this.templatesArray);
    console.log(JSON.stringify(this.templatesJSON));

    await this.#storeTemplates();
  }

  /** Generates a {@link Template} class instance from the JSON object template.
   * {@link createTemplate()} will create a class instance and save to template storage.
   * `#loadTemplate()` will create a class instance without saving to the template storage.
   * @param {Object} template - The template to load
   * @since 0.88.504
   */
  #loadTemplate(templateObject) {

    // Calculates the pixel count
    const pixelCount = {
      total: templateObject.pixels?.total,
      colors: new Map(Object.entries(templateObject.pixels?.colors || {}).map(([key, value]) => [Number(key), value]))
    };

    // Creates the template
    const template = new Template({
      displayName: templateObject.displayName,
      sortID: Object.keys(this.templatesJSON.templates).length || 0,
      authorID: numberToEncoded(this.userID || 0, this.encodingBase),
      pixelCount: pixelCount,
      chunked: templateObject.tiles
    });

    template.calculateCoordsFromChunked(); // Updates `Template.coords`

    this.templatesArray.push(template);
    this.#invalidateTemplateRenderCaches();
  }

  /** Stores the JSON object of the loaded templates into TamperMonkey (GreaseMonkey) storage.
   * @since 0.72.7
   */
  async #storeTemplates() {
    await GM.setValue('bmTemplates', JSON.stringify(this.templatesJSON));
  }

  /** Returns the storage key that should be considered the single active template.
   * @param {Object} templates - Template storage object
   * @returns {string | null}
   * @since 0.92.11
   */
  #getActiveTemplateKey(templates) {
    const entries = Object.entries(templates || {});
    if (!entries.length) {return null;}

    entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB, undefined, {numeric: true}));

    const explicitlyEnabled = entries.find(([, template]) => template?.enabled === true);
    if (explicitlyEnabled) {return explicitlyEnabled[0];}

    const implicitlyEnabled = entries.find(([, template]) => template?.enabled !== false);
    if (implicitlyEnabled) {return implicitlyEnabled[0];}

    return entries[0][0];
  }

  /** Normalizes template storage so exactly one template is active.
   * @param {Object} templates - Template storage object
   * @returns {boolean} Whether storage was changed
   * @since 0.92.11
   */
  #normalizeActiveTemplate(templates) {
    const activeTemplateKey = this.#getActiveTemplateKey(templates);
    if (!activeTemplateKey) {return false;}

    let changed = false;
    for (const [key, template] of Object.entries(templates)) {
      if (!template || typeof template != 'object') {continue;}

      const shouldBeEnabled = key == activeTemplateKey;
      if (template.enabled !== shouldBeEnabled) {
        template.enabled = shouldBeEnabled;
        changed = true;
      }
    }

    return changed;
  }

  /** Requests current map tiles again so newly loaded templates appear without manual reloads.
   * @since 0.92.11
   */
  async #refreshVisibleTiles() {
    if (!this.templatesArray.length) {return;}

    const refreshed = await refreshWplaceTiles();
    if (!refreshed) {
      consoleWarn('Could not ask Wplace to refresh visible tiles after loading templates.');
    }
  }

  /** Makes one stored template active and reloads active template instances.
   * @param {string} templateKey - Storage key for the template to activate
   * @returns {Promise<boolean>} Whether the template was found
   * @since 0.92.11
   */
  async setActiveTemplate(templateKey) {
    if (!this.templatesJSON) {
      this.templatesJSON = JSON.parse(GM_getValue('bmTemplates', '{}'));
    }

    const templates = this.templatesJSON?.templates || {};
    if (!templates[templateKey]) {return false;}

    for (const [key, template] of Object.entries(templates)) {
      if (!template || typeof template != 'object') {continue;}
      template.enabled = key == templateKey;
    }

    await this.#storeTemplates();
    await this.importJSON(this.templatesJSON);
    this.windowMain?.refreshTemplateControls?.();
    this.windowMain?.handleDisplayStatus?.(`Activated template "${templates[templateKey].name || templateKey}".`);
    return true;
  }

  /** Deletes a template from the JSON object.
   * Also delete's the corrosponding {@link Template} class instance
   */
  deleteTemplate() {

  }

  /** Disables the template from view
   */
  async disableTemplate() {

    // Creates the JSON object if it does not already exist
    if (!this.templatesJSON) {this.templatesJSON = await this.createJSON(); console.log(`Creating JSON...`);}


  }

  /** Downloads all templates loaded.
   * @since 0.88.499
   */
  async downloadAllTemplates() {

    consoleLog(`Downloading all templates...`);

    console.log(this.templatesArray);

    // For each template loaded...
    for (const template of this.templatesArray) {

      await this.downloadTemplate(template); // Downloads the template

      await sleep(500); // Avoids download throttling from the browser
    }
  }

  /** Downloads all templates from Blue Marble's template storage.
   * @since 0.88.474
   */
  async downloadAllTemplatesFromStorage() {

    // Templates in user storage
    const templates = JSON.parse(GM_getValue('bmTemplates', '{}'))?.templates;

    console.log(templates);

    // If there is at least one template loaded...
    if (Object.keys(templates).length > 0) {

      // For each template loaded...
      for (const [key, template] of Object.entries(templates)) {

        // If the template is a direct child of the templates Object...
        if (templates.hasOwnProperty(key)) {
          
          // Downloads the template using a dummy Template instance
          await this.downloadTemplate(new Template({
            displayName: template.name,
            sortID: key.split(' ')?.[0],
            authorID: key.split(' ')?.[1],
            chunked: template.tiles
          }));

          await sleep(500); // Avoids download throttling from the browser
        }
      }
    }
  }

  /** Downloads the template passed-in.
   * @param {Template} template - The template class instance to download
   * @since 0.88.499
   */
  async downloadTemplate(template) {

    template.calculateCoordsFromChunked(); // Updates `Template.coords`

    // Constructs the file name to download as
    const templateFileName = `${template.coords.join('-')}_${template.displayName.replaceAll(' ', '-')}`;

    // Converts `Template.chunked` to a blob
    const blob = await this.convertTemplateToBlob(template);

    // Downloads the template
    await GM.download({
      url: URL.createObjectURL(blob),
      name: templateFileName + '.png',
      conflictAction: 'uniquify',
      onload: () => {consoleLog(`Download of template '${templateFileName}' complete!`);},
      onerror: (error, details) => {consoleError(`Download of template '${templateFileName}' failed because ${error}! Details: ${details}`);},
      ontimeout: () => {consoleWarn(`Download of template '${templateFileName}' has timed out!`);}
    });
  }

  /** Converts a Template class instance into a Blob. 
   * Specifically, this takes `Template.chunked` and converts it to a Blob.
   * @since 0.88.504
   * @returns {Promise<Blob>} A Promise of a Blob PNG image of the template
   */
  async convertTemplateToBlob(template) {

    console.log(template);

    const templateTiles64 = template.chunked; // Tiles of template image as base 64

    // Sorts the keys of the tiles (Object -> Array)
    const templateTileKeysSorted = Object.keys(templateTiles64).sort();

    // Turns the base64 tiles into Images
    const templateTilesImageSorted = await Promise.all(templateTileKeysSorted.map(tileKey => convertBase64ToImage(templateTiles64[tileKey])));

    // Absolute pixel coordinates for smallest (top left) and largest (bottom right) pixel coordinates
    let absoluteSmallestX = Infinity;
    let absoluteSmallestY = Infinity;
    let absoluteLargestX = 0;
    let absoluteLargestY = 0;

    // Calculates the minimum and maximum (X, Y) absolute coordinates
    templateTileKeysSorted.forEach((key, index) => {

      // Deconstructs the tile coordinates
      const [tileX, tileY, pixelX, pixelY] = key.split(',').map(Number);

      const tileImage = templateTilesImageSorted[index]; // Obtains the image for this tile

      // Calculates the absolute pixel coordinates for this tile
      const absoluteX = (tileX * this.tileSize) + pixelX;
      const absoluteY = (tileY * this.tileSize) + pixelY;

      // Record the smallest/largest absolute coordinates if and only if this tile is the smallest/largest. Otherwise, use previous best
      absoluteSmallestX = Math.min(absoluteSmallestX, absoluteX);
      absoluteSmallestY = Math.min(absoluteSmallestY, absoluteY);
      absoluteLargestX = Math.max(absoluteLargestX, absoluteX + (tileImage.width / this.drawMult));
      absoluteLargestY = Math.max(absoluteLargestY, absoluteY + (tileImage.height / this.drawMult));
    })

    console.log(`Absolute coordinates: (${absoluteSmallestX}, ${absoluteSmallestY}) and (${absoluteLargestX}, ${absoluteLargestY})`);

    // Calculates the template/canvas width and height
    const templateWidth = absoluteLargestX - absoluteSmallestX;
    const templateHeight = absoluteLargestY - absoluteSmallestY;
    const canvasWidth = templateWidth * this.drawMult;
    const canvasHeight = templateHeight * this.drawMult;

    console.log(`Template Width: ${templateWidth}\nTemplate Height: ${templateHeight}\nCanvas Width: ${canvasWidth}\nCanvas Height: ${canvasHeight}`);

    // Creates a new canvas the size of the template
    const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
    const context = canvas.getContext('2d');

    // For each tile...
    templateTileKeysSorted.forEach((key, index) => {

      // Deconstructs the tile coordinates
      const [tileX, tileY, pixelX, pixelY] = key.split(',').map(Number);

      const tileImage = templateTilesImageSorted[index]; // Obtains the image for this tile

      // Calculates the absolute pixel coordinates for this tile
      const absoluteX = (tileX * this.tileSize) + pixelX;
      const absoluteY = (tileY * this.tileSize) + pixelY;

      console.log(`Drawing tile (${tileX}, ${tileY}, ${pixelX}, ${pixelY}) (${absoluteX}, ${absoluteY}) at (${absoluteX - absoluteSmallestX}, ${absoluteY - absoluteSmallestY}) on the canvas...`);

      // Draws the tile to the canvas
      context.drawImage(tileImage, (absoluteX - absoluteSmallestX) * this.drawMult, (absoluteY - absoluteSmallestY) * this.drawMult, tileImage.width, tileImage.height);
    })

    // The expanded template is now on the canvas

    context.globalCompositeOperation = "destination-over"; // Draw under the canvas (new draws only show in place of transparent pixels)

    // Extends the template vertically to create columns
    context.drawImage(canvas, 0, -1);
    context.drawImage(canvas, 0, 1);

    // Extends the columns horizontally to become a solid template
    context.drawImage(canvas, -1, 0);
    context.drawImage(canvas, 1, 0);

    const smallCanvas = new OffscreenCanvas(templateWidth, templateHeight);
    const smallContext = smallCanvas.getContext("2d");

    smallContext.imageSmoothingEnabled = false; // Forces nearest neighbor scaling algorithm

    // Downscale the template
    smallContext.drawImage(
      canvas,
      0, 0, templateWidth * this.drawMult, templateHeight * this.drawMult, // Source image size
      0, 0, templateWidth, templateHeight // Small canvas size
    );

    // Returns a blob
    return smallCanvas.convertToBlob({ type: 'image/png' });

    /** Turns a chunked base 64 string template tile into an Image template tile
     * @param {string} base64 - Base64 string of image data (without URI header)
     * @since 0.88.474
     * @returns {Promise} Promise to load a new Image()
     */
    function convertBase64ToImage(base64) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = "data:image/png;base64," + base64;
      });
    }
  }

  /** Invalidates cached render lookups after template data changes.
   * @since 0.92.27
   */
  #invalidateTemplateRenderCaches() {
    this.sortedTemplatesArray = null;
    this.templateTileIndex = null;
    this.renderStateVersion++;
    this.#clearTileRenderCache();
  }

  /** Emits temporary render timing logs.
   * @param {string} eventName - Short event name
   * @param {Object} details - Event details
   * @since 0.92.27
   */
  #debugRenderPerf(eventName, details = {}) {
    if (!this.renderPerfDebug) {return;}
    console.log(`[BM PERF] ${eventName} ${JSON.stringify(details)}`);
  }

  /** Converts a rendered tile canvas to an image blob.
   * @param {OffscreenCanvas} canvas - Rendered tile canvas
   * @returns {Promise<Blob>} Encoded image blob
   * @since 0.92.29
   */
  async #convertCanvasToTileBlob(canvas) {
    if (this.tileRenderOutputType) {
      const preferredBlob = await canvas.convertToBlob({
        type: this.tileRenderOutputType,
        quality: this.tileRenderOutputQuality
      });

      if (preferredBlob?.type == this.tileRenderOutputType) {return preferredBlob;}
    }

    return await canvas.convertToBlob({ type: 'image/png' });
  }

  /** Clears cached rendered tile blobs.
   * @since 0.92.27
   */
  #clearTileRenderCache() {
    this.tileRenderCache?.clear();
  }

  /** Records a rendered tile blob in the small LRU cache.
   * @param {string} cacheKey - Render cache key
   * @param {Blob} blob - Rendered tile blob
   * @since 0.92.27
   */
  #setTileRenderCache(cacheKey, blob) {
    if (!cacheKey || !blob) {return;}

    this.tileRenderCache.set(cacheKey, blob);
    while (this.tileRenderCache.size > this.tileRenderCacheMaxEntries) {
      const oldestKey = this.tileRenderCache.keys().next().value;
      this.tileRenderCache.delete(oldestKey);
    }
  }

  /** Gets a rendered tile blob from the LRU cache.
   * @param {string} cacheKey - Render cache key
   * @returns {Blob | undefined}
   * @since 0.92.27
   */
  #getTileRenderCache(cacheKey) {
    const cachedBlob = this.tileRenderCache.get(cacheKey);
    if (!cachedBlob) {return undefined;}

    this.tileRenderCache.delete(cacheKey);
    this.tileRenderCache.set(cacheKey, cachedBlob);
    return cachedBlob;
  }

  /** Creates a stable string for the current hidden-color set.
   * @returns {string} Sorted hidden color IDs
   * @since 0.92.27
   */
  #getColorFilterKey() {
    return Array.from(this.shouldFilterColor.keys()).sort((a, b) => a - b).join(',');
  }

  /** Builds a content-sensitive cache key for tile rendering.
   * @param {Blob} tileBlob - Original tile image
   * @param {string} tileCoords - Padded tile coords
   * @param {boolean} highlightDisabled - Whether highlight rendering is disabled
   * @param {Array<number[]>} highlightPattern - Highlight pattern
   * @param {number} renderStateVersion - Render state version at request start
   * @param {string} filterKey - Hidden color key at request start
   * @returns {Promise<{cacheKey: string, hashMs: number}>} Cache key and timing
   * @since 0.92.27
   */
  async #createTileRenderCacheKey(tileBlob, tileCoords, highlightDisabled, highlightPattern, renderStateVersion, filterKey) {
    const hashStart = performance.now();
    const tileBuffer = await tileBlob.arrayBuffer();
    const tileHashBuffer = await crypto.subtle.digest('SHA-1', tileBuffer);
    const tileHash = Array.from(new Uint8Array(tileHashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
    const highlightKey = highlightDisabled ? 'none' : JSON.stringify(highlightPattern);
    const transparentHighlightKey = this.settingsManager?.userSettings?.flags?.includes('hl-noTrans') ? 'no-trans' : 'trans';

    const cacheKey = JSON.stringify({
      tileCoords: tileCoords,
      tileHash: tileHash,
      renderStateVersion: renderStateVersion,
      highlight: highlightKey,
      transparentHighlight: transparentHighlightKey,
      filter: filterKey
    });

    return {
      cacheKey: cacheKey,
      hashMs: Number((performance.now() - hashStart).toFixed(2))
    };
  }

  /** Returns templates in draw order without re-sorting on every tile.
   * @returns {Template[]} Sorted templates
   * @since 0.92.27
   */
  #getSortedTemplates() {
    if (!this.sortedTemplatesArray || (this.sortedTemplatesArray.length != this.templatesArray.length)) {
      this.sortedTemplatesArray = [...this.templatesArray].sort((a, b) => a.sortID - b.sortID);
    }

    return this.sortedTemplatesArray;
  }

  /** Extracts the visible palette IDs used by one rendered template chunk.
   * @param {Uint32Array | undefined} template32 - Template pixels
   * @param {number} width - Chunk width
   * @param {number} height - Chunk height
   * @returns {Set<number> | null} Color IDs, or null when unavailable
   * @since 0.92.27
   */
  #getTemplateChunkColorIDs(template32, width, height) {
    if (!template32 || !width || !height) {return null;}

    const colorIDs = new Set();
    const { LUT: lookupTable } = this.paletteBM;
    const pixelSize = this.drawMult;
    const tolerance = this.paletteTolerance;

    for (let templateRow = 1; templateRow < height; templateRow += pixelSize) {
      const rowOffset = templateRow * width;
      for (let templateColumn = 1; templateColumn < width; templateColumn += pixelSize) {
        const templatePixel = template32[rowOffset + templateColumn];
        const templatePixelAlpha = (templatePixel >>> 24) & 0xFF;
        if (templatePixelAlpha <= tolerance) {continue;}

        const colorID = lookupTable.get(templatePixel) ?? -2;
        if (colorID == 0) {continue;}
        colorIDs.add(colorID);
      }
    }

    return colorIDs;
  }

  /** Builds an index from Wplace tile coords to the template chunks on that tile.
   * @returns {Map<string, Object[]>} Template chunk index
   * @since 0.92.27
   */
  #getTemplateTileIndex() {
    if (this.templateTileIndex) {return this.templateTileIndex;}

    const index = new Map();
    let chunkCount = 0;

    for (const template of this.#getSortedTemplates()) {
      for (const tileKey of Object.keys(template.chunked || {})) {
        const coords = tileKey.split(',');
        const tileCoords = `${coords[0]},${coords[1]}`;
        const bitmap = template.chunked[tileKey];
        const chunked32 = template.chunked32?.[tileKey];
        const entry = {
          instance: template,
          key: tileKey,
          bitmap: bitmap,
          chunked32: chunked32,
          tileCoords: [coords[0], coords[1]],
          pixelCoords: [coords[2], coords[3]],
          colorIDs: null,
          colorIDsScanned: false,
          hasErased: !!template.pixelCount?.colors?.get(-1)
        };

        if (!index.has(tileCoords)) {index.set(tileCoords, []);}
        index.get(tileCoords).push(entry);
        chunkCount++;
      }
    }

    this.templateTileIndex = index;
    this.#debugRenderPerf('index-built', {
      'templates': this.templatesArray.length,
      'indexedTiles': index.size,
      'chunks': chunkCount
    });

    return this.templateTileIndex;
  }

  /** Ensures the chunk's palette ID cache has been built.
   * @param {Object} templateChunk - Indexed template chunk
   * @returns {Set<number> | null} Color IDs, or null when unavailable
   * @since 0.92.27
   */
  #ensureTemplateChunkColorIDs(templateChunk) {
    if (templateChunk.colorIDsScanned) {return templateChunk.colorIDs;}

    templateChunk.colorIDs = this.#getTemplateChunkColorIDs(
      templateChunk.chunked32,
      templateChunk.bitmap?.width,
      templateChunk.bitmap?.height
    );
    templateChunk.colorIDsScanned = true;
    templateChunk.hasErased = templateChunk.colorIDs
      ? templateChunk.colorIDs.has(-1)
      : !!templateChunk.instance.pixelCount?.colors?.get(-1);

    return templateChunk.colorIDs;
  }

  /** Checks whether a chunk has any colors that are currently visible.
   * @param {Object} templateChunk - Indexed template chunk
   * @returns {boolean} Whether any color should be visible
   * @since 0.92.27
   */
  #templateChunkHasVisibleColor(templateChunk) {
    const colorIDs = this.#ensureTemplateChunkColorIDs(templateChunk);
    if (!colorIDs) {return true;}

    for (const colorID of colorIDs) {
      if (!this.shouldFilterColor.get(colorID)) {return true;}
    }

    return false;
  }

  /** Checks whether a chunk needs a cloned/mutated ImageData pass before drawing.
   * @param {Object} templateChunk - Indexed template chunk
   * @param {boolean} highlightDisabled - Whether highlight rendering is disabled
   * @returns {boolean} Whether a mutation pass is required
   * @since 0.92.27
   */
  #templateChunkNeedsMutation(templateChunk, highlightDisabled) {
    const colorIDs = this.#ensureTemplateChunkColorIDs(templateChunk);

    if (!highlightDisabled) {return true;}
    if (templateChunk.hasErased && !this.shouldFilterColor.get(-1)) {return true;}
    if (!colorIDs) {return this.shouldFilterColor.size != 0 || templateChunk.hasErased;}

    for (const colorID of colorIDs) {
      if (this.shouldFilterColor.get(colorID)) {return true;}
    }

    return false;
  }

  /** Draws all templates on the specified tile.
   * This method handles the rendering of template overlays on individual tiles.
   * @param {File} tileBlob - The pixels that are placed on a tile
   * @param {Array<number>} tileCoords - The tile coordinates [x, y]
   * @since 0.65.77
   */
  async drawTemplateOnTile(tileBlob, tileCoords) {

    // Returns early if no templates should be drawn
    if (!this.templatesShouldBeDrawn) {return tileBlob;}

    if (this.templatesLoadingPromise) {
      try {
        await this.templatesLoadingPromise;
      } catch (error) {
        consoleWarn(`Could not finish loading saved templates before drawing tile: ${error?.message || error}`);
        return tileBlob;
      }
    }

    const renderStart = performance.now();
    const renderStateAtStart = this.renderStateVersion;
    const filterKeyAtStart = this.#getColorFilterKey();
    const timings = {};
    const drawSize = this.tileSize * this.drawMult; // Calculate draw multiplier for scaling

    // Format tile coordinates with proper padding for consistent lookup
    tileCoords = tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0');

    const indexStart = performance.now();
    const templatesForTile = this.#getTemplateTileIndex().get(tileCoords) ?? [];
    timings['indexMs'] = Number((performance.now() - indexStart).toFixed(2));

    const visibleFilterStart = performance.now();
    const templatesToDraw = templatesForTile.filter(templateChunk => this.#templateChunkHasVisibleColor(templateChunk));
    timings['visibleFilterMs'] = Number((performance.now() - visibleFilterStart).toFixed(2));
    const templateCount = templatesToDraw.length; // Number of templates to draw on this tile

    if (templateCount > 0) {
      
      // Calculate total pixel count for templates actively being displayed in this tile
      const templatesDisplayed = new Set(templatesToDraw.map(template => template.instance));
      const totalPixels = Array.from(templatesDisplayed)
        .reduce((sum, template) => sum + (template.pixelCount.total || 0), 0);
      
      // Format pixel count with locale-appropriate thousands separators for better readability
      // Examples: "1,234,567" (US), "1.234.567" (DE), "1 234 567" (FR)
      const pixelCountFormatted = localizeNumber(totalPixels);
      
      // Display status information about the templates being rendered
      this.windowMain.handleDisplayStatus(
        `Displaying ${templateCount} template${templateCount == 1 ? '' : 's'}.\nTotal pixels: ${pixelCountFormatted}`
      );
    } else {
      //this.overlay.handleDisplayStatus(`Displaying ${templateCount} templates.`);
      this.windowMain.handleDisplayStatus(`Sleeping\nVersion: ${this.version}`);
      this.#debugRenderPerf('tile-skip', {
        'tileCoords': tileCoords,
        'reason': templatesForTile.length ? 'all-colors-hidden' : 'no-template-chunks',
        'chunksOnTile': templatesForTile.length,
        'filterCount': this.shouldFilterColor.size,
        'renderStateVersion': this.renderStateVersion,
        'totalMs': Number((performance.now() - renderStart).toFixed(2)),
        'timings': timings
      });
      return tileBlob; // No templates are on this tile. Return the original tile early
    }

    // Obtains the highlight pattern
    const highlightPattern = this.settingsManager?.userSettings?.highlight || [[2, 0, 0]];
    // The code demands that a highlight pattern always exists.
    // Therefore, to disable highlighting, the highlight pattern is `[[2, 0, 0]]`.
    // `[[2, 0, 0]]` is special, and will skip the highlighting code altogether.
    // As a side-effect, the template will always display while enabled.
    // You can't disable all sub-pixels in order to hide the template.

    // Contains the first index of the highlight pattern.
    const highlightPatternIndexZero = highlightPattern?.[0];
    // This is so we can later determine if the pattern is the preset "None"

    // Should highlighting be disabled?
    const highlightDisabled = (
      (highlightPattern?.length == 1)
      && (highlightPatternIndexZero?.[0] == 2)
      && (highlightPatternIndexZero?.[1] == 0)
      && (highlightPatternIndexZero?.[2] == 0)
    )

    const {cacheKey, hashMs} = await this.#createTileRenderCacheKey(
      tileBlob,
      tileCoords,
      highlightDisabled,
      highlightPattern,
      renderStateAtStart,
      filterKeyAtStart
    );
    timings['tileHashMs'] = hashMs;

    const cachedBlob = this.#getTileRenderCache(cacheKey);
    if (cachedBlob) {
      this.#debugRenderPerf('tile-cache-hit', {
        'tileCoords': tileCoords,
        'chunksOnTile': templatesForTile.length,
        'chunksDrawn': templateCount,
        'filterCount': this.shouldFilterColor.size,
        'renderStateVersion': this.renderStateVersion,
        'blobType': cachedBlob?.type || 'unknown',
        'blobSize': cachedBlob?.size || 0,
        'totalMs': Number((performance.now() - renderStart).toFixed(2)),
        'timings': timings
      });
      return cachedBlob;
    }

    const bitmapStart = performance.now();
    const tileBitmap = await createImageBitmap(tileBlob);
    timings['tileBitmapMs'] = Number((performance.now() - bitmapStart).toFixed(2));

    const canvasStart = performance.now();
    const canvas = new OffscreenCanvas(drawSize, drawSize);
    const context = canvas.getContext('2d');

    context.imageSmoothingEnabled = false; // Nearest neighbor

    // Tells the canvas to ignore anything outside of this area
    context.beginPath();
    context.rect(0, 0, drawSize, drawSize);
    context.clip();

    context.clearRect(0, 0, drawSize, drawSize); // Draws transparent background
    context.drawImage(tileBitmap, 0, 0, drawSize, drawSize); // Draw tile to canvas

    const tileBeforeTemplates = context.getImageData(0, 0, drawSize, drawSize);
    const tileBeforeTemplates32 = new Uint32Array(tileBeforeTemplates.data.buffer);
    timings['canvasSetupMs'] = Number((performance.now() - canvasStart).toFixed(2));
    
    let mutationCount = 0;
    let directDrawCount = 0;
    let scanMs = 0;
    let mutationDrawMs = 0;

    // For each template in this tile, draw them.
    for (const template of templatesToDraw) {
      const templateNeedsMutation = this.#templateChunkNeedsMutation(template, highlightDisabled);
      if (templateNeedsMutation) {mutationCount++;}
      else {directDrawCount++;}

      // Obtains the template (for only this tile) as a Uint32Array
      let templateBeforeFilter32 = templateNeedsMutation ? template.chunked32?.slice() : template.chunked32;
      // Remove the `.slice()` and colors, once disabled, can never be re-enabled

      const coordXtoDrawAt = Number(template.pixelCoords[0]) * this.drawMult;
      const coordYtoDrawAt = Number(template.pixelCoords[1]) * this.drawMult;

      // Draws the original template if this chunk does not need filter/erased/highlight mutation.
      if (!templateNeedsMutation) {
        context.drawImage(template.bitmap, coordXtoDrawAt, coordYtoDrawAt);
      }

      // If we failed to get the template for this tile, we use a shoddy, buggy, failsafe
      if (!templateBeforeFilter32) {
        const templateBeforeFilter = context.getImageData(coordXtoDrawAt, coordYtoDrawAt, template.bitmap.width, template.bitmap.height);
        templateBeforeFilter32 = new Uint32Array(templateBeforeFilter.data.buffer);
      }

      const scanStart = performance.now();

      // Take the pre-filter template ImageData + the pre-filter tile ImageData, and use that to calculate the correct pixels
      const {
        correctPixels: pixelsCorrect,
        filteredTemplate: templateAfterFilter,
        pendingPixels: pixelsPending
      } = this.#calculateCorrectPixelsOnTile_And_FilterTile({
        tile: tileBeforeTemplates32,
        template: templateBeforeFilter32,
        templateInfo: [coordXtoDrawAt, coordYtoDrawAt, template.bitmap.width, template.bitmap.height],
        highlightPattern: highlightPattern,
        highlightDisabled: highlightDisabled
      });
      scanMs += performance.now() - scanStart;

      // If the chunk needs filtering, Erased styling, or highlighting, draw the modified template.
      if (templateNeedsMutation) {
        const mutationDrawStart = performance.now();
        //context.putImageData(new ImageData(new Uint8ClampedArray(templateAfterFilter.buffer), template.bitmap.width, template.bitmap.height), coordXtoDrawAt, coordYtoDrawAt);
        context.drawImage(await createImageBitmap(new ImageData(new Uint8ClampedArray(templateAfterFilter.buffer), template.bitmap.width, template.bitmap.height)), coordXtoDrawAt, coordYtoDrawAt);
        mutationDrawMs += performance.now() - mutationDrawStart;
      }

      // If "correct" does not exist as a key of the object "pixelCount", we create it
      if (typeof template.instance.pixelCount['correct'] == 'undefined') {
        template.instance.pixelCount['correct'] = {};
      }

      // Adds the correct pixel Map to the template instance
      template.instance.pixelCount['correct'][tileCoords] = pixelsCorrect;

      // If "pending" does not exist as a key of the object "pixelCount", we create it
      if (typeof template.instance.pixelCount['pending'] == 'undefined') {
        template.instance.pixelCount['pending'] = {};
      }

      const [pendingTileX, pendingTileY] = tileCoords.split(',').map(Number);

      // Adds compact pending pixel samples to the template instance.
      // Each entry represents many pending pixels of the same color in this tile.
      template.instance.pixelCount['pending'][tileCoords] = Array.from(pixelsPending.values()).map(pixel => ({
        tileX: pendingTileX,
        tileY: pendingTileY,
        pixelX: pixel.pixelX,
        pixelY: pixel.pixelY,
        colorID: pixel.colorID,
        count: pixel.count,
        samples: pixel.samples
      }));
    }

    timings['scanMs'] = Number(scanMs.toFixed(2));
    timings['mutationDrawMs'] = Number(mutationDrawMs.toFixed(2));

    const blobStart = performance.now();
    const outputBlob = await this.#convertCanvasToTileBlob(canvas);
    timings['blobMs'] = Number((performance.now() - blobStart).toFixed(2));

    if (this.renderStateVersion != renderStateAtStart) {
      this.#debugRenderPerf('tile-stale-discard', {
        'tileCoords': tileCoords,
        'startedRenderStateVersion': renderStateAtStart,
        'currentRenderStateVersion': this.renderStateVersion,
        'filterCount': this.shouldFilterColor.size,
        'blobType': outputBlob?.type || 'unknown',
        'blobSize': outputBlob?.size || 0,
        'totalMs': Number((performance.now() - renderStart).toFixed(2)),
        'timings': timings
      });
      return tileBlob;
    }

    this.#setTileRenderCache(cacheKey, outputBlob);

    this.#debugRenderPerf('tile-render', {
      'tileCoords': tileCoords,
      'chunksOnTile': templatesForTile.length,
      'chunksDrawn': templateCount,
      'chunksHidden': templatesForTile.length - templateCount,
      'directDrawCount': directDrawCount,
      'mutationCount': mutationCount,
      'filterCount': this.shouldFilterColor.size,
      'renderStateVersion': this.renderStateVersion,
      'blobType': outputBlob?.type || 'unknown',
      'blobSize': outputBlob?.size || 0,
      'totalMs': Number((performance.now() - renderStart).toFixed(2)),
      'timings': timings
    });

    return outputBlob;
  }

  /** Returns a random pending pixel from currently loaded template tiles.
   * @param {number | undefined} colorID - If set, only pending pixels for this color are considered.
   * @returns {{tileX: number, tileY: number, pixelX: number, pixelY: number, colorID: number} | null} A pending pixel, or null if none are known
   * @since 0.92.1
   */
  getRandomPendingPixel(colorID = undefined) {

    let selectedPixel = null;
    let pendingPixelTotal = 0;

    for (const template of this.templatesArray) {
      const pendingObject = template.pixelCount?.pending ?? {};

      for (const pixels of Object.values(pendingObject)) {
        for (const pixel of pixels) {
          if ((typeof colorID == 'undefined') && this.shouldFilterColor.get(pixel.colorID)) {continue;}
          if ((typeof colorID != 'undefined') && (pixel.colorID != colorID)) {continue;}

          const pendingPixelsInSample = Number(pixel.count) || 1;
          pendingPixelTotal += pendingPixelsInSample;

          if (Math.random() * pendingPixelTotal < pendingPixelsInSample) {
            selectedPixel = pixel;
          }
        }
      }
    }

    if (!selectedPixel) {return null;}

    const samples = Array.isArray(selectedPixel.samples) && selectedPixel.samples.length
      ? selectedPixel.samples
      : [selectedPixel];
    const sample = samples[Math.floor(Math.random() * samples.length)];

    return {
      ...selectedPixel,
      pixelX: sample.pixelX,
      pixelY: sample.pixelY
    };
  }

  /** Imports the JSON object, and appends it to any JSON object already loaded
   * @param {string} json - The JSON string to parse
   */
  async importJSON(json) {

    console.log(`Importing JSON...`);
    console.log(json);

    // If the passed in JSON is a Blue Marble template object...
    if (this.#isBlueMarbleTemplateJSON(json)) {
      this.templatesLoadingPromise = this.#parseBlueMarble(json)
        .finally(() => {
          this.templatesLoadingPromise = null;
        });
      return await this.templatesLoadingPromise; // ...parse the template object as Blue Marble
    }
  }

  /** Checks whether a saved template payload belongs to Blue Marble.
   * Forked builds used names such as "BlueMarble X", so normalize the marker
   * instead of requiring one exact string.
   * @param {Object} json - Template storage payload
   * @returns {boolean}
   * @since 0.92.12
   */
  #isBlueMarbleTemplateJSON(json) {
    const whoami = json?.whoami;
    if (typeof whoami != 'string') {return false;}

    const normalizedWhoami = whoami.replace(/\s+/g, '');
    return ['BlueMarble', 'BlueMarbleX'].includes(normalizedWhoami);
  }

  /** Parses the Blue Marble JSON object
   * @param {string} json - The JSON string to parse
   * @since 0.72.13
   */
  async #parseBlueMarble(json) {

    console.log(`Parsing BlueMarble...`);

    const templates = json.templates || {};
    json.templates = templates;
    json.whoami = "BlueMarble";
    this.templatesJSON = json;

    console.log(`BlueMarble length: ${Object.keys(templates).length}`);

    const schemaVersion = json?.schemaVersion;
    const schemaVersionArray = schemaVersion.split(/[-\.\+]/); // SemVer -> string[]
    const schemaVersionBleedingEdge = this.schemaVersion.split(/[-\.\+]/); // SemVer -> string[]
    const scriptVersion = json?.scriptVersion;

    console.log(`BlueMarble Template Schema: ${schemaVersion}; Script Version: ${scriptVersion}`);

    // If MAJOR version is up-to-date...
    if (schemaVersionArray[0] == schemaVersionBleedingEdge[0]) {

      // If MINOR version is NOT up-to-date...
      if (schemaVersionArray[1] != schemaVersionBleedingEdge[1]) {

        // Spawns a new Template Wizard
        const windowWizard = new WindowWizard(this.name, this.version, this.schemaVersion, this);
        windowWizard.buildWindow();
      }

      const normalizedActiveTemplate = this.#normalizeActiveTemplate(templates);

      // Load using the latest schema loader. It will be fine, probably...
      this.templatesArray = [];
      this.loadedTemplateKeys = new Set();
      this.templatesArray = await loadSchema({
        tileSize: this.tileSize,
        drawMult: this.drawMult,
        templatesArray: this.templatesArray,
        loadedTemplateKeys: this.loadedTemplateKeys
      });
      this.#invalidateTemplateRenderCaches();
      if (normalizedActiveTemplate) {
        await this.#storeTemplates();
      }
      this.windowMain?.refreshTemplateControls?.();
      await this.#refreshVisibleTiles();

    } else if (schemaVersionArray[0] < schemaVersionBleedingEdge[0]) {
      // Else if the MAJOR verison is out-of-date

      // Spawns a new Template Wizard
      const windowWizard = new WindowWizard(this.name, this.version, this.schemaVersion, this);
      windowWizard.buildWindow();
    
    } else {
      // We don't know what the schema is. Unsupported?

      this.windowMain.handleDisplayError(`Template version ${schemaVersion} is unsupported.\nUse Blue Marble version ${scriptVersion} or load a new template.`);
    }

    /** Loads schema of Blue Marble template storage
     * @param {Object} params - Object containing parameters
     * @param {number} params.tileSize - Size of tile
     * @param {number} params.drawMult - Tile scale multiplier
     * @param {Array<Template>} params.templatesArray - Array of Template instances
     * @param {Set<string>} params.loadedTemplateKeys - Storage keys that load successfully
     * @since 0.88.434
     */
    async function loadSchema({
      tileSize: tileSize,
      drawMult: drawMult,
      templatesArray: templatesArray,
      loadedTemplateKeys: loadedTemplateKeys
    }) {

      // Run only if there are templates saved
      if (Object.keys(templates).length > 0) {
  
        // For each template...
        for (const template in templates) {
  
          const templateKey = template; // The identification key for the template. E.g., "0 $Z"
          const templateValue = templates[template]; // The actual content of the template
          console.log(`Template Key: ${templateKey}`);
  
          if (templates.hasOwnProperty(template)) {
            if (templateValue.enabled === false) {continue;}
  
            const templateKeyArray = templateKey.split(' '); // E.g., "0 $Z" -> ["0", "$Z"]
            const sortID = Number.parseInt(templateKeyArray?.[0], 10); // Sort ID of the template
            const authorID = templateKeyArray?.[1] || '0'; // User ID of the person who exported the template
            const displayName = templateValue.name || `Template ${sortID || ''}`; // Display name of the template
            //const coords = templateValue?.coords?.split(',').map(Number); // "1,2,3,4" -> [1, 2, 3, 4]
  
            const pixelCount = {
              total: templateValue.pixels?.total,
              colors: new Map(Object.entries(templateValue.pixels?.colors || {}).map(([key, value]) => [Number(key), value]))
            };
  
            const tilesbase64 = templateValue.tiles;
            const templateTiles = {}; // Stores the template bitmap tiles for each tile.
            const templateTiles32 = {}; // Stores the template Uint32Array tiles for each tile.
  
            const actualTileSize = tileSize * drawMult;
  
            for (const tile in tilesbase64) {
              console.log(tile);
              if (tilesbase64.hasOwnProperty(tile)) {
                const encodedTemplateBase64 = tilesbase64[tile];
                const templateUint8Array = base64ToUint8(encodedTemplateBase64); // Base 64 -> Uint8Array
  
                const templateBlob = new Blob([templateUint8Array], { type: "image/png" }); // Uint8Array -> Blob
                const templateBitmap = await createImageBitmap(templateBlob) // Blob -> Bitmap
                templateTiles[tile] = templateBitmap;
  
                // Converts to Uint32Array
                const canvas = new OffscreenCanvas(actualTileSize, actualTileSize);
                const context = canvas.getContext('2d');
                context.drawImage(templateBitmap, 0, 0);
                const imageData = context.getImageData(0, 0, templateBitmap.width, templateBitmap.height);
                templateTiles32[tile] = new Uint32Array(imageData.data.buffer);
              }
            }
  
            // Creates a new Template class instance
            const template = new Template({
              displayName: displayName,
              sortID: Number.isFinite(sortID) ? sortID : templatesArray.length,
              authorID: authorID || '',
              //coords: coords,
            });
            template.pixelCount = pixelCount;
            template.chunked = templateTiles;
            template.chunked32 = templateTiles32;
            
            templatesArray.push(template);
            loadedTemplateKeys.add(templateKey);
            console.log(templatesArray);
            console.log(`^^^ This ^^^`);
          }
        }
      }

      return templatesArray
    }
  }

  /** Parses the OSU! Place JSON object
   */
  #parseOSU() {

  }

  /** Sets the `templatesShouldBeDrawn` boolean to a value.
   * @param {boolean} value - The value to set the boolean to
   * @since 0.73.7
   */
  setTemplatesShouldBeDrawn(value) {
    this.templatesShouldBeDrawn = value;
  }

  /** Calculates the correct pixels on this tile.
   * In addition, this function filters colors based on user input.
   * In addition, this function modifies colors to properly display (#deface).
   * In addition, this function modifies incorrect pixels to display highlighting.
   * This function has multiple purposes only to reduce iterations of scans over every pixel on the template.
   * @param {Object} params - Object containing all parameters
   * @param {Uint32Array} params.tile - The tile without templates as a Uint32Array
   * @param {Uint32Array} params.template - The template without filtering as a Uint32Array
   * @param {Array<Number, Number, Number, Number>} params.templateInfo - Information about template location and size
   * @param {Array<number[]>} params.highlightPattern - The highlight pattern selected by the user
   * @param {boolean} params.highlightDisabled - Should highlighting be disabled?
   * @returns {{correctPixels: Map<number, number>, filteredTemplate: Uint32Array, pendingPixels: Map<number, {pixelX: number, pixelY: number, colorID: number, count: number, samples: Array<{pixelX: number, pixelY: number}>}>}} A Map containing correct pixel totals and compact pending pixel samples
   */
  #calculateCorrectPixelsOnTile_And_FilterTile({
    tile: tile32, 
    template: template32, 
    templateInfo: templateInformation,
    highlightPattern: highlightPattern,
    highlightDisabled: highlightDisabled
  }) {

    // Size of a pixel in actuality
    const pixelSize = this.drawMult;

    // Tile information
    const tileWidth = this.tileSize * pixelSize;
    const tileHeight = tileWidth;
    const tilePixelOffsetY = -1; // Shift off of target template pixel to target on tile. E.g. "-1" would be the pixel above the template pixel on the tile
    const tilePixelOffsetX = 0; // Shift off of target template pixel to target on tile. E.g. "-1" would be the pixel to the left of the template pixel on the tile

    // Template information
    const templateCoordX = templateInformation[0];
    const templateCoordY = templateInformation[1];
    const templateWidth = templateInformation[2];
    const templateHeight = templateInformation[3];
    const tolerance = this.paletteTolerance;

    //console.log(`TemplateX: ${templateCoordX}\nTemplateY: ${templateCoordY}\nStarting Row:${templateCoordY+tilePixelOffsetY}\nStarting Column:${templateCoordX+tilePixelOffsetX}`);

    // Obtains if the user wants to highlight tile pixels that are transparent, but the template pixel is not
    const shouldTransparentTilePixelsBeHighlighted = !this.settingsManager?.userSettings?.flags?.includes('hl-noTrans');
    // The actual logic of this boolean is "should all pixels be highlighted"

    const { palette: _, LUT: lookupTable } = this.paletteBM; // Obtains the palette and LUT

    // Makes a copy of the color palette Blue Marble uses, turns it into a Map, and adds data to count the amount of each color
    const _colorpalette = new Map(); // Temp color palette
    const pendingPixels = new Map();
    const maxPendingSamplesPerColor = 32;
    const trackPendingPixel = (colorID, tileColumn, tileRow) => {
      const pendingSample = {
        pixelX: (tileColumn / pixelSize) | 0,
        pixelY: (tileRow / pixelSize) | 0
      };
      const colorPendingPixels = pendingPixels.get(colorID);

      if (!colorPendingPixels) {
        pendingPixels.set(colorID, {
          pixelX: pendingSample.pixelX,
          pixelY: pendingSample.pixelY,
          colorID: colorID,
          count: 1,
          samples: [pendingSample]
        });
        return;
      }

      const sampleIndex = colorPendingPixels.count % maxPendingSamplesPerColor;
      colorPendingPixels.count += 1;

      if (colorPendingPixels.samples.length < maxPendingSamplesPerColor) {
        colorPendingPixels.samples.push(pendingSample);
      } else {
        colorPendingPixels.samples[sampleIndex] = pendingSample;
      }
    };

    // For each center pixel...
    for (let templateRow = 1; templateRow < templateHeight; templateRow += pixelSize) {
      for (let templateColumn = 1; templateColumn < templateWidth; templateColumn += pixelSize) {
        // ROWS ARE VERTICAL. "ROWS" AS IN, LIKE ON A SPREADSHEET
        // COLUMNS ARE HORIZONTAL. "COLUMNS" AS IN, LIKE ON A SPREADSHEET
        // THE FIFTH ROW IS FIVE DOWN FROM THE ZEROTH ROW
        // THE THIRD COLUMN IS TO THE RIGHT OF THE FIRST COLUMN

        // The pixel on the tile to target (1 pixel above the template)
        const tileRow = (templateCoordY + templateRow) + tilePixelOffsetY; // (Template offset + current row) - 1
        const tileColumn = (templateCoordX + templateColumn) + tilePixelOffsetX; // Template offset + current column
        
        // Retrieves the targeted pixels
        const tilePixelAbove = tile32[(tileRow * tileWidth) + tileColumn];
        const templatePixel = template32[(templateRow * templateWidth) + templateColumn];

        // Transparent template pixels are ignored by all downstream stats/render paths.
        const templatePixelAlpha = (templatePixel >>> 24) & 0xFF;
        if (templatePixelAlpha <= tolerance) {continue;}

        // Obtains the alpha channel of the targeted tile pixel
        const tilePixelAlpha = (tilePixelAbove >>> 24) & 0xFF;

        // Finds the best matching color ID for the template pixel. If none is found, default to "-2"
        const bestTemplateColorID = lookupTable.get(templatePixel) ?? -2;

        // Finds the best matching color ID for the tile pixel. If none is found, default to "-2"
        const bestTileColorID = lookupTable.get(tilePixelAbove) ?? -2;

        // -----     COLOR FILTER      -----
        // If this pixel on the template is a color the user wants to hide on the canvas...
        if (this.shouldFilterColor.get(bestTemplateColorID)) {

          // Sets template pixel to match tile background (which removes the template pixel from the user's view)
          template32[(templateRow * templateWidth) + templateColumn] = tilePixelAbove;
        }
        // -----  END OF COLOR FILTER  -----

        // -----        ERASED         -----
        // If this pixel on the template is the Erased (#deface) color...
        if (bestTemplateColorID == -1) {

          const blackTrans = 0x20000000; // Black translucent color for Erased pixels

          // If Erased color should be filtered
          if (this.shouldFilterColor.get(bestTemplateColorID)) {
            template32[(templateRow * templateWidth) + templateColumn] = 0x00000000; // Center (black, 0% opacity)
          } else {
            // Don't filter Erased color

            // If the tile row and tile column are even,
            // Or the tile row and tile column are odd...
            if (((tileRow / pixelSize) & 1) == ((tileColumn / pixelSize) & 1)) {

              // Sets the template pixels to be a semi-transparent, black grid
              template32[(templateRow * templateWidth) + templateColumn] = blackTrans; // Center
              template32[((templateRow - 1) * templateWidth) + (templateColumn - 1)] = blackTrans; // Top Left
              template32[((templateRow - 1) * templateWidth) + (templateColumn + 1)] = blackTrans; // Top Right
              template32[((templateRow + 1) * templateWidth) + (templateColumn - 1)] = blackTrans; // Bottom Left
              template32[((templateRow + 1) * templateWidth) + (templateColumn + 1)] = blackTrans; // Bottom Right
            } else {
              // Else, either the row or column is odd, and the other is even.

              // Sets the template pixels to the the inverse of a semi-transparent, black grid
              template32[(templateRow * templateWidth) + templateColumn] = 0x00000000; // Center (black, 0% opacity)
              template32[((templateRow - 1) * templateWidth) + (templateColumn)] = blackTrans; // Top Center
              template32[((templateRow + 1) * templateWidth) + (templateColumn)] = blackTrans; // Bottom Center
              template32[((templateRow) * templateWidth) + (templateColumn - 1)] = blackTrans; // Middle Left
              template32[((templateRow) * templateWidth) + (templateColumn + 1)] = blackTrans; // Middle Right
            }
          }
        }
        // -----     END OF ERASED     -----

        // -----     HIGHLIGHTING      -----

        // If highlighting is enabled, AND the template pixel is NOT transparent AND the template pixel does NOT match the tile pixel
        if (!highlightDisabled && (templatePixelAlpha > tolerance) && (bestTileColorID != bestTemplateColorID)) {

          // If the tile pixel is NOT transparent, OR the user wants to highlight transparent pixels
          if (shouldTransparentTilePixelsBeHighlighted || (tilePixelAlpha > tolerance)) {

            // Obtains the template color of this pixel
            const templatePixelColor = template32[(templateRow * templateWidth) + templateColumn];
            // This will retrieve the tile background instead if the color is filtered!

            // For each of the 9 subpixels inside the pixel...
            for (const subpixelPattern of highlightPattern) {

              // Deconstructs the sub pixel
              const [subpixelState, subpixelColumnDelta, subpixelRowDelta] = subpixelPattern;
              // "Delta" because the coordinate of the sub-pixel is relative to the center of the pixel

              // Obtains the subpixel color to use
              const subpixelColor = (subpixelState != 0) ? ((subpixelState != 1) ? templatePixelColor : 0xFF0000FF) : 0x00000000;
              // 0 = Transparent (black)
              // 1 = Red (#FF0000)
              // 2 = Template (matches template or hides if filtered)

              // Sets the subpixel to match the color on the highlight pattern
              template32[((templateRow + subpixelRowDelta) * templateWidth) + (templateColumn + subpixelColumnDelta)] = subpixelColor;
            }
          }
        }

        // -----  END OF HIGHLIGHTING  -----

        // If the template pixel is Erased, and the tile pixel is transparent...
        if ((bestTemplateColorID == -1) && (tilePixelAbove <= tolerance)) {

          // Increments the count by 1 for the Erased (#deface) color.
          // If the color ID has not been counted yet, default to 1
          const colorIDcount = _colorpalette.get(bestTemplateColorID);
          _colorpalette.set(bestTemplateColorID, colorIDcount ? colorIDcount + 1 : 1);
          continue;
        }
        // If the code passes this point, the pixel is not a correct Erased color.

        // If the template pixel is Erased, and the tile pixel is not transparent...
        if (bestTemplateColorID == -1) {
          trackPendingPixel(bestTemplateColorID, tileColumn, tileRow);
          continue;
        }

        // If either pixel is transparent...
        if ((templatePixelAlpha <= tolerance) || (tilePixelAlpha <= tolerance)) {
          if (templatePixelAlpha > tolerance) {trackPendingPixel(bestTemplateColorID, tileColumn, tileRow);}
          continue; // ...we skip it. We can't match the RGB color of transparent pixels.
        }
        // If the code passes this point, both pixels are opaque & not Erased.

        // If the template pixel does not match the tile pixel, then the pixel is skipped after highlighting.
        if (bestTileColorID != bestTemplateColorID) {
          trackPendingPixel(bestTemplateColorID, tileColumn, tileRow);
          continue;
        }
        // If the code passes this point, the template pixel matches the tile pixel.

        // Increments the count by 1 for the best matching color ID (which can be negative).
        // If the color ID has not been counted yet, default to 1
        const colorIDcount = _colorpalette.get(bestTemplateColorID);
        _colorpalette.set(bestTemplateColorID, colorIDcount ? colorIDcount + 1 : 1);
      }
    }

    return { correctPixels: _colorpalette, filteredTemplate: template32, pendingPixels: pendingPixels };
  }
}
