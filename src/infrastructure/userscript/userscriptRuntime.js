/** Adapter around userscript host APIs.
 * Keeps GM_* details out of app, domain, and UI modules.
 */

export function getScriptInfo() {
  return {
    name: GM_info.script.name.toString(),
    version: GM_info.script.version.toString()
  };
}

export function getValue(key, fallback = '') {
  return GM_getValue(key, fallback);
}

export async function setValue(key, value) {
  return await GM.setValue(key, value);
}

export function getJSON(key, fallback = null) {
  try {
    return JSON.parse(getValue(key, JSON.stringify(fallback)));
  } catch {
    return fallback;
  }
}

export async function setJSON(key, value) {
  return await setValue(key, JSON.stringify(value));
}

export function deleteValue(key) {
  if (typeof GM_deleteValue != 'function') {return false;}
  GM_deleteValue(key);
  return true;
}

export function getResourceText(resourceName) {
  return GM_getResourceText(resourceName);
}

export function addStyle(cssText) {
  GM_addStyle(cssText);
}

export function canRequest() {
  return typeof GM_xmlhttpRequest == 'function';
}

export function request(options) {
  if (!canRequest()) {return false;}
  GM_xmlhttpRequest(options);
  return true;
}

export async function download(options) {
  return await GM.download(options);
}
