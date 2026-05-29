/** Installs the page-context fetch proxy used to observe Wplace responses. */

function injectPageScript(callback, attributes) {
  const script = document.createElement('script');
  for (const [name, value] of Object.entries(attributes)) {
    script.setAttribute(name, value);
  }
  script.textContent = `(${callback})();`;
  document.documentElement?.appendChild(script);
  script.remove();
}

export function installWplaceFetchProxy({name, consoleStyle, debugLogs, blobTimeoutMS = 12000}) {
  injectPageScript(() => {
    const script = document.currentScript;
    const name = script?.getAttribute('bm-name') || 'Blue Marble';
    const consoleStyle = script?.getAttribute('bm-cStyle') || '';
    const debugLogs = script?.getAttribute('bm-debug') == 'true';
    const blobTimeoutMS = Number(script?.getAttribute('bm-blob-timeout')) || 12000;
    const fetchedBlobQueue = new Map();
    const debugLog = (...args) => {if (debugLogs) {console.log(...args);}};

    const removeQueuedBlob = (blobID) => {
      const queued = fetchedBlobQueue.get(blobID);
      if (queued?.timeoutID) {
        clearTimeout(queued.timeoutID);
      }
      fetchedBlobQueue.delete(blobID);
    };

    window.addEventListener('message', (event) => {
      const { source, endpoint, blobID, blobData, blink } = event.data;
      const elapsed = Date.now() - blink;

      if (debugLogs) {
        console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
        console.log(`Blob fetch took %c${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')}%c MM:SS.mmm`, consoleStyle, '');
        console.log(fetchedBlobQueue);
        console.groupEnd();
      }

      if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {
        const queued = fetchedBlobQueue.get(blobID);
        const callback = queued?.callback;

        if (typeof callback === 'function') {
          callback(blobData);
        } else {
          console.warn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
        }

        removeQueuedBlob(blobID);
      }
    });

    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const cloned = response.clone();
      const endpointName = String(((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore');
      const contentType = cloned.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        debugLog(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');
        cloned.json()
          .then(jsonData => {
            window.postMessage({
              source: 'blue-marble',
              endpoint: endpointName,
              jsonData: jsonData
            }, '*');
          })
          .catch(err => {
            console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
          });
      } else if (contentType.includes('image/') && !endpointName.startsWith('data:') && !endpointName.startsWith('blob:') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
        const blink = Date.now();
        const blob = await cloned.blob();

        debugLog(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

        return new Promise((resolve) => {
          const blobUUID = crypto.randomUUID();
          const timeoutID = setTimeout(() => {
            removeQueuedBlob(blobUUID);
            console.warn(`%c${name}%c: Timed out processing blob "%s"; returning original image.`, consoleStyle, '', blobUUID);
            resolve(response);
          }, blobTimeoutMS);

          fetchedBlobQueue.set(blobUUID, {
            timeoutID: timeoutID,
            callback: (blobProcessed) => {
              const responseHeaders = new Headers(cloned.headers);
              if (blobProcessed?.type) {
                responseHeaders.set('content-type', blobProcessed.type);
                responseHeaders.delete('content-length');
              }

              resolve(new Response(blobProcessed, {
                headers: responseHeaders,
                status: cloned.status,
                statusText: cloned.statusText
              }));

              debugLog(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
            }
          });

          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            blobID: blobUUID,
            blobData: blob,
            blink: blink
          });
        }).catch(exception => {
          const elapsed = Date.now();
          console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
          console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
          console.error(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed/60000)).padStart(2,'0')}:${String(Math.floor(elapsed/1000) % 60).padStart(2,'0')}.${String(elapsed % 1000).padStart(3,'0')} MM:SS.mmm`);
          console.error(`Exception stack:`, exception);
          console.groupEnd();
        });
      }

      return response;
    };
  }, {
    'bm-name': name,
    'bm-cStyle': consoleStyle,
    'bm-debug': String(debugLogs),
    'bm-blob-timeout': String(blobTimeoutMS)
  });
}
