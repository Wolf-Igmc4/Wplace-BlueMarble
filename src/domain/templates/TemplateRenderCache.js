/** LRU cache and encoding helpers for rendered Wplace tile blobs. */
export default class TemplateRenderCache {
  constructor({
    maxEntries = 48,
    outputType = 'image/webp',
    outputQuality = 0.98,
    getTransparentHighlightKey = () => 'trans'
  } = {}) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.outputType = outputType;
    this.outputQuality = outputQuality;
    this.getTransparentHighlightKey = getTransparentHighlightKey;
  }

  clear() {
    this.cache.clear();
  }

  set(cacheKey, blob) {
    if (!cacheKey || !blob) {return;}

    this.cache.set(cacheKey, blob);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  get(cacheKey) {
    const cachedBlob = this.cache.get(cacheKey);
    if (!cachedBlob) {return undefined;}

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, cachedBlob);
    return cachedBlob;
  }

  async encodeCanvas(canvas) {
    if (this.outputType) {
      const preferredBlob = await canvas.convertToBlob({
        type: this.outputType,
        quality: this.outputQuality
      });

      if (preferredBlob?.type == this.outputType) {return preferredBlob;}
    }

    return await canvas.convertToBlob({ type: 'image/png' });
  }

  async createKey(tileBlob, tileCoords, highlightDisabled, highlightPattern, renderStateVersion, filterKey) {
    const hashStart = performance.now();
    const tileBuffer = await tileBlob.arrayBuffer();
    const tileHashBuffer = await crypto.subtle.digest('SHA-1', tileBuffer);
    const tileHash = Array.from(new Uint8Array(tileHashBuffer), byte => byte.toString(16).padStart(2, '0')).join('');
    const highlightKey = highlightDisabled ? 'none' : JSON.stringify(highlightPattern);

    const cacheKey = JSON.stringify({
      tileCoords: tileCoords,
      tileHash: tileHash,
      renderStateVersion: renderStateVersion,
      highlight: highlightKey,
      transparentHighlight: this.getTransparentHighlightKey(),
      filter: filterKey
    });

    return {
      cacheKey: cacheKey,
      hashMs: Number((performance.now() - hashStart).toFixed(2))
    };
  }
}
