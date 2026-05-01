const userscriptGlobals = {
  GM: 'readonly',
  GM_addStyle: 'readonly',
  GM_deleteValue: 'readonly',
  GM_download: 'readonly',
  GM_getResourceText: 'readonly',
  GM_getValue: 'readonly',
  GM_info: 'readonly',
  GM_setValue: 'readonly',
  GM_xmlhttpRequest: 'readonly'
};

const browserGlobals = {
  Blob: 'readonly',
  CompressionStream: 'readonly',
  CSSStyleSheet: 'readonly',
  CustomEvent: 'readonly',
  DOMMatrix: 'readonly',
  Event: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLSelectElement: 'readonly',
  Image: 'readonly',
  ImageData: 'readonly',
  MessageEvent: 'readonly',
  MutationObserver: 'readonly',
  OffscreenCanvas: 'readonly',
  ResizeObserver: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  createImageBitmap: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  requestAnimationFrame: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  structuredClone: 'readonly',
  window: 'readonly'
};

const nodeGlobals = {
  Buffer: 'readonly',
  process: 'readonly'
};

export default [
  {
    ignores: [
      'dist/**',
      'docs/**',
      'node_modules/**'
    ]
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...userscriptGlobals
      }
    },
    rules: {}
  },
  {
    files: ['build/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...nodeGlobals,
        console: 'readonly'
      }
    },
    rules: {}
  }
];
