import ApiManager from '../apiManager.js';
import TemplateManager from '../templateManager.js';
import WindowMain from '../WindowMain.js';
import WindowTelemetry from '../WindowTelemetry.js';
import SettingsManager from '../settingsManager.js';
import { consoleLog, consoleWarn } from '../utils.js';
import { addStyle, getJSON, getResourceText, getScriptInfo, setJSON } from '../infrastructure/userscript/userscriptRuntime.js';
import { installWplaceFetchProxy } from '../infrastructure/wplace/fetchProxy.js';
import { installPaletteMoveButton } from '../infrastructure/wplace/paletteMoveButton.js';

const consoleStyle = 'color: cornflowerblue;';
const currentTelemetryVersion = 1;

export default class BlueMarbleApp {
  constructor() {
    const scriptInfo = getScriptInfo();
    this.name = scriptInfo.name;
    this.version = scriptInfo.version;
    this.userSettings = getJSON('bmUserSettings', {});
    this.isDebugLoggingEnabled = !!(this.userSettings?.debugLogs || this.userSettings?.flags?.includes('bm-debug'));
  }

  async start() {
    installWplaceFetchProxy({
      name: this.name,
      consoleStyle: consoleStyle,
      debugLogs: this.isDebugLoggingEnabled
    });

    this.#installStyles();
    await this.#ensureUserIdentity();

    const windowMain = new WindowMain(this.name, this.version);
    const templateManager = new TemplateManager(this.name, this.version);
    const apiManager = new ApiManager(templateManager);
    const settingsManager = new SettingsManager(this.name, this.version, this.userSettings);

    windowMain.setSettingsManager(settingsManager);
    windowMain.setApiManager(apiManager);
    templateManager.setWindowMain(windowMain);
    templateManager.setSettingsManager(settingsManager);

    apiManager.spontaneousResponseListener(windowMain);
    await this.#loadStoredTemplates(templateManager, windowMain);
    this.#installTelemetryPrompt(apiManager);

    windowMain.buildWindow();
    installPaletteMoveButton();
    setInterval(() => apiManager.sendHeartbeat(this.version), 1000 * 60 * 30);

    consoleLog(`%c${this.name}%c (${this.version}) userscript has loaded!`, consoleStyle, '');
  }

  #installStyles() {
    addStyle(getResourceText('CSS-BM-File'));

    const robotoMonoInjectionPoint = 'robotoMonoInjectionPoint';
    if (!!(robotoMonoInjectionPoint.indexOf('@font-face') + 1)) {
      addStyle(robotoMonoInjectionPoint);
      return;
    }

    const stylesheetLink = document.createElement('link');
    stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
    stylesheetLink.rel = 'preload';
    stylesheetLink.as = 'style';
    stylesheetLink.onload = function () {
      this.onload = null;
      this.rel = 'stylesheet';
    };
    document.head?.appendChild(stylesheetLink);
  }

  async #ensureUserIdentity() {
    if (this.userSettings.uuid) {return;}
    this.userSettings.uuid = crypto.randomUUID();
    await setJSON('bmUserSettings', this.userSettings);
  }

  async #loadStoredTemplates(templateManager, windowMain) {
    const storageTemplates = getJSON('bmTemplates', {});
    try {
      await templateManager.importJSON(storageTemplates);
      windowMain.refreshTemplateControls();
    } catch (error) {
      consoleWarn(`Failed to load saved templates: ${error?.message || error}`);
    }
  }

  #installTelemetryPrompt(apiManager) {
    const previousTelemetryVersion = this.userSettings?.telemetry;
    if ((previousTelemetryVersion == undefined) || (previousTelemetryVersion > currentTelemetryVersion)) {
      const windowTelemetry = new WindowTelemetry(this.name, this.version, currentTelemetryVersion, this.userSettings?.uuid);
      windowTelemetry.setApiManager(apiManager);
      windowTelemetry.buildWindow();
    }
  }
}
