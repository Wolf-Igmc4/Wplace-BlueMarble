/** Detects which Wplace premium palette colors the user can use. */
export default class BoughtColorDetector {
  constructor({palette, apiManager}) {
    this.palette = palette;
    this.apiManager = apiManager;
  }

  isColorBought(color, boughtColorIDs = this.getBoughtColorIDs()) {
    if (!color?.premium) {return false;}
    if (boughtColorIDs) {return boughtColorIDs.has(Number(color.id));}

    const colorElement = document.querySelector(`#color-${color.id}`);
    if (!colorElement) {return false;}

    const isBought = !colorElement.querySelector('svg');
    if (window?.blueMarbleDebugBoughtColors) {
      console.log('[Blue Marble] bought color state', {
        id: color.id,
        name: color.name,
        bought: isBought,
        source: 'dom-lock-icon',
        outerHTML: colorElement.outerHTML.slice(0, 1000)
      });
    }

    return isBought;
  }

  getBoughtColorIDsFromDOM() {
    const ids = new Set();
    let foundPremiumButton = false;

    for (const color of this.palette.filter(color => color?.premium)) {
      const colorElement = document.querySelector(`#color-${color.id}`);
      if (!colorElement) {continue;}
      foundPremiumButton = true;
      if (!colorElement.querySelector('svg')) {ids.add(Number(color.id));}
    }

    if (!foundPremiumButton) {return null;}
    this.apiManager?.saveBoughtColorIDs?.(ids, 'color-picker');
    return ids;
  }

  getBoughtColorIDs() {
    const userDataIDs = this.getBoughtColorIDsFromUserData();
    if (userDataIDs) {return userDataIDs;}

    const domIDs = this.getBoughtColorIDsFromDOM();
    if (domIDs) {return domIDs;}

    return this.apiManager?.boughtColorIDsCache ?? null;
  }

  getBoughtColorIDsFromUserData() {
    const payloads = [
      {payload: this.apiManager?.userData, isUserData: true},
      ...Array.from(this.apiManager?.jsonResponses?.values?.() || []).map(payload => ({payload: payload, isUserData: false}))
    ]
      .filter(({payload}) => payload && typeof payload == 'object');
    if (!payloads.length) {return null;}

    const ids = new Set();
    for (const {payload, isUserData} of payloads) {
      if (isUserData && Array.isArray(payload?.unlocked_colors)) {
        this.collectBoughtColorIDs(payload, ids, isUserData);
        return ids;
      }
    }

    for (const {payload, isUserData} of payloads) {
      this.collectBoughtColorIDs(payload, ids, isUserData);
    }
    return ids.size ? ids : null;
  }

  collectBoughtColorIDs(payload, ids, isUserData) {
    if (Array.isArray(payload?.unlocked_colors)) {
      for (const id of payload.unlocked_colors) {
        const colorID = Number(id);
        if (Number.isInteger(colorID) && colorID >= 32 && colorID <= 63) {ids.add(colorID);}
      }
    }

    const visited = new WeakSet();
    const visit = (value, path = '', depth = 0) => {
      if (depth > 5 || value == null) {return;}
      if (typeof value != 'object') {return;}
      if (visited.has(value)) {return;}
      visited.add(value);

      if (Array.isArray(value)) {
        const pathLooksPurchased = /\b(color|colour|palette|premium).*(own|purchase|unlock|bought|available)|\b(own|purchase|unlock|bought|available).*(color|colour|palette|premium)|unlocked[_-]?colors/i.test(path);
        const pathLooksLikeUserColors = isUserData && /(^|\.)((colors?|colours?|palette|premiumColors?|unlocked_colors))$/i.test(path);
        if (pathLooksPurchased || pathLooksLikeUserColors) {
          for (const entry of value) {
            const id = typeof entry == 'object'
              ? Number(entry?.id ?? entry?.color ?? entry?.colorId ?? entry?.colourId)
              : Number(entry);
            if (Number.isInteger(id) && id >= 32 && id <= 63) {ids.add(id);}
          }
        }
      }

      for (const [key, child] of Object.entries(value)) {
        const id = Number(child);
        const keyLooksLikeColorID = isUserData && /\b(color|colour|palette|premium).*(id)?$/i.test(key);
        if (keyLooksLikeColorID && Number.isInteger(id) && id >= 32 && id <= 63) {
          ids.add(id);
        }
        visit(child, path ? `${path}.${key}` : key, depth + 1);
      }
    };

    visit(payload);
  }

  findBoughtColorPayloadCandidates() {
    const payloads = [
      {name: 'me', payload: this.apiManager?.userData, isUserData: true},
      ...Array.from(this.apiManager?.jsonResponses?.entries?.() || []).map(([name, payload]) => ({name: name, payload: payload, isUserData: false}))
    ]
      .filter(({payload}) => payload && typeof payload == 'object');
    const candidates = [];
    const visited = new WeakSet();

    const visit = (sourceName, value, path = '', depth = 0) => {
      if (depth > 5 || value == null) {return;}
      if (typeof value != 'object') {return;}
      if (visited.has(value)) {return;}
      visited.add(value);

      if (Array.isArray(value)) {
        const ids = value.map(entry => typeof entry == 'object'
          ? Number(entry?.id ?? entry?.color ?? entry?.colorId ?? entry?.colourId)
          : Number(entry)
        ).filter(id => Number.isInteger(id) && id >= 32 && id <= 63);
        if (ids.length) {
          candidates.push({source: sourceName, path: path, ids: ids.join(', ')});
        }
      }

      for (const [key, child] of Object.entries(value)) {
        visit(sourceName, child, path ? `${path}.${key}` : key, depth + 1);
      }
    };

    for (const {name, payload} of payloads) {
      visit(name, payload);
    }
    return candidates;
  }

  dumpDetection() {
    const rows = this.palette
      .filter(color => color?.premium)
      .map(color => {
        const colorElement = document.querySelector(`#color-${color.id}`);
        return {
          id: color.id,
          name: color.name,
          bought: this.isColorBought(color),
          exists: !!colorElement,
          text: colorElement?.textContent?.trim()?.replace(/\s+/g, ' ').slice(0, 120) || '',
          className: colorElement?.className || '',
          ariaLabel: colorElement?.getAttribute?.('aria-label') || '',
          title: colorElement?.getAttribute?.('title') || '',
          disabled: colorElement?.matches?.(':disabled, [disabled]') || false
        };
    });
    const candidates = this.findBoughtColorPayloadCandidates();
    console.table(rows);
    console.table(candidates);
    return rows;
  }
}
