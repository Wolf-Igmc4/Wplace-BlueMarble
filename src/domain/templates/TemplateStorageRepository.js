import { getJSON, setJSON } from "../../infrastructure/userscript/userscriptRuntime.js";

/** Storage rules for Blue Marble template JSON. */
export default class TemplateStorageRepository {
  constructor({storageKey = 'bmTemplates', schemaVersion, scriptVersion}) {
    this.storageKey = storageKey;
    this.schemaVersion = schemaVersion;
    this.scriptVersion = scriptVersion;
  }

  createEmpty() {
    return {
      "whoami": "BlueMarble",
      "scriptVersion": this.scriptVersion,
      "schemaVersion": this.schemaVersion,
      "templates": {}
    };
  }

  load() {
    return getJSON(this.storageKey, {});
  }

  async save(templatesJSON) {
    await setJSON(this.storageKey, templatesJSON);
  }

  getNextSortID(templates, authorID) {
    const sortIDs = Object.keys(templates || {})
      .map(templateKey => Number.parseInt(templateKey.split(' ')?.[0], 10))
      .filter(Number.isFinite);

    let sortID = sortIDs.length ? Math.max(...sortIDs) + 1 : 0;
    while (templates?.[`${sortID} ${authorID}`]) {
      sortID++;
    }

    return sortID;
  }

  getActiveTemplateKey(templates) {
    const entries = Object.entries(templates || {});
    if (!entries.length) {return null;}

    entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB, undefined, {numeric: true}));

    const explicitlyEnabled = entries.find(([, template]) => template?.enabled === true);
    if (explicitlyEnabled) {return explicitlyEnabled[0];}

    const implicitlyEnabled = entries.find(([, template]) => template?.enabled !== false);
    if (implicitlyEnabled) {return implicitlyEnabled[0];}

    return entries[0][0];
  }

  normalizeActiveTemplate(templates) {
    const activeTemplateKey = this.getActiveTemplateKey(templates);
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
}
