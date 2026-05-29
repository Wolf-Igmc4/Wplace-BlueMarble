import { getJSON, setJSON } from "../../infrastructure/userscript/userscriptRuntime.js";

/** Persists and restores correct-pixel progress independently from template storage. */
export default class TemplateProgressCache {
  constructor({storageKey, version, warn = () => {}}) {
    this.storageKey = storageKey;
    this.version = version;
    this.warn = warn;
    this.cache = this.#load();
    this.dirtyTemplates = new Set();
    this.saveTimeout = null;
  }

  #load() {
    const emptyCache = {version: this.version, templates: {}};

    try {
      const storedCache = getJSON(this.storageKey, {});
      if (storedCache?.version !== this.version || !storedCache?.templates || typeof storedCache.templates != 'object') {
        return emptyCache;
      }
      return storedCache;
    } catch (error) {
      this.warn(`Could not load cached template progress: ${error?.message || error}`);
      return emptyCache;
    }
  }

  createFingerprint(storedTemplate) {
    let hash = 2166136261;
    const feedHash = value => {
      const stringValue = String(value ?? '');
      for (let index = 0; index < stringValue.length; index++) {
        hash ^= stringValue.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    };

    feedHash(JSON.stringify(storedTemplate?.pixels || {}));
    for (const [tileKey, encodedTile] of Object.entries(storedTemplate?.tiles || {}).sort(([left], [right]) => left.localeCompare(right))) {
      feedHash(tileKey);
      feedHash(encodedTile);
    }

    return `${Number(storedTemplate?.pixels?.total) || 0}:${Object.keys(storedTemplate?.tiles || {}).length}:${(hash >>> 0).toString(16)}`;
  }

  restore(template, templatesJSON) {
    const storageKey = template?.storageKey;
    const storedTemplate = templatesJSON?.templates?.[storageKey];
    if (!storageKey || !storedTemplate) {return;}

    const fingerprint = this.createFingerprint(storedTemplate);
    template.progressCacheFingerprint = fingerprint;
    const cachedTemplate = this.cache.templates?.[storageKey];
    if (!cachedTemplate || cachedTemplate.fingerprint != fingerprint || !cachedTemplate.correct) {return;}

    const validTileCoords = new Set(
      Object.keys(template.chunked || {}).map(tileKey => tileKey.split(',').slice(0, 2).join(','))
    );
    const correct = {};
    for (const [tileCoords, colorCounts] of Object.entries(cachedTemplate.correct)) {
      if (!validTileCoords.has(tileCoords) || !colorCounts || typeof colorCounts != 'object') {continue;}
      correct[tileCoords] = new Map(
        Object.entries(colorCounts)
          .map(([colorID, count]) => [Number(colorID), Number(count)])
          .filter(([colorID, count]) => Number.isFinite(colorID) && Number.isFinite(count) && count >= 0)
      );
    }

    if (Object.keys(correct).length) {
      template.pixelCount.correct = correct;
    }
  }

  queueSave(templates, templatesJSON) {
    for (const template of templates) {
      if (template?.storageKey) {this.dirtyTemplates.add(template);}
    }
    if (!this.dirtyTemplates.size || this.saveTimeout) {return;}

    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      const changedTemplates = Array.from(this.dirtyTemplates);
      this.dirtyTemplates.clear();

      for (const template of changedTemplates) {
        const storageKey = template.storageKey;
        const storedTemplate = templatesJSON?.templates?.[storageKey];
        if (!storedTemplate) {continue;}

        const correct = {};
        for (const [tileCoords, colorCounts] of Object.entries(template.pixelCount?.correct || {})) {
          if (!(colorCounts instanceof Map)) {continue;}
          correct[tileCoords] = Object.fromEntries(colorCounts);
        }

        this.cache.templates[storageKey] = {
          fingerprint: template.progressCacheFingerprint || this.createFingerprint(storedTemplate),
          updatedAt: Date.now(),
          correct: correct
        };
      }

      void setJSON(this.storageKey, this.cache);
    }, 500);
  }

  remove(templateKey) {
    if (!this.cache.templates?.[templateKey]) {return;}
    delete this.cache.templates[templateKey];
    void setJSON(this.storageKey, this.cache);
  }
}
