function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildRuntimeScript(config) {
  return `(() => {
  'use strict';
  const CONFIG = ${safeJson(config)};
  const TOKEN = CONFIG.token;
  const parentWindow = window.parent;
  const context = Object.freeze(CONFIG.context || {});
  const remoteAllowed = CONFIG.remoteAllowed !== false;
  const sealed = Boolean(CONFIG.sealed);
  const pendingRequests = new Map();
  let requestCounter = 0;

  function nextId(prefix) {
    requestCounter += 1;
    return prefix + '_' + requestCounter + '_' + Math.random().toString(36).slice(2);
  }

  function post(type, data) {
    try {
      parentWindow.postMessage(Object.assign({ source: 'circlet-' + type, token: TOKEN, type: type }, data || {}), '*');
    } catch (_) {}
  }

  function request(kind, payload) {
    return new Promise((resolve, reject) => {
      const id = nextId('req');
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Circle request timed out: ' + kind));
      }, 95000);
      pendingRequests.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        parentWindow.postMessage({
          source: 'circlet-request',
          token: TOKEN,
          id: id,
          kind: kind,
          payload: payload || {}
        }, '*');
      } catch (error) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parentWindow) return;
    const message = event.data;
    if (!message || message.token !== TOKEN) return;
    if (message.source === 'circlet-download-progress' && message.id) {
      const entry = pendingDownloads.get(message.id);
      if (!entry) return;
      entry.link.textContent = 'Preparing ' + (message.completed || 0) + '/' + (message.total || 0);
      return;
    }
    if (message.source !== 'circlet-response' || !message.id) return;
    const entry = pendingRequests.get(message.id);
    if (!entry) return;
    pendingRequests.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else {
      const error = new Error(message.error || 'Circle request failed.');
      error.code = message.code;
      entry.reject(error);
    }
  });

  function logError(message) {
    try { console.error('[circlet] ' + message); } catch (_) {}
    post('log', { level: 'error', message: String(message || '').slice(0, 2000) });
  }
  window.addEventListener('error', (event) => {
    logError(event.message || 'Script error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    logError(reason && reason.message ? reason.message : String(reason || 'Unhandled rejection'));
  });

  /* ---------- storage ---------- */
  const storageSnapshot = CONFIG.storage || { local: {}, session: {} };
  function createStorage(area, initial) {
    const values = new Map(Object.entries(initial || {}).map(([key, value]) => [String(key), String(value)]));
    function persist() {
      post('storage', { area: area, snapshot: Object.fromEntries(values) });
    }
    return {
      get length() { return values.size; },
      key(index) {
        const keys = Array.from(values.keys());
        return index >= 0 && index < keys.length ? keys[index] : null;
      },
      getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
      setItem(key, value) { values.set(String(key), String(value)); persist(); },
      removeItem(key) { values.delete(String(key)); persist(); },
      clear() { values.clear(); persist(); }
    };
  }
  function installStorage(name, area, initial) {
    try {
      Object.defineProperty(window, name, {
        value: createStorage(area, initial),
        configurable: true,
        enumerable: true
      });
    } catch (_) {}
  }
  installStorage('localStorage', 'local', storageSnapshot.local);
  installStorage('sessionStorage', 'session', storageSnapshot.session);

  /* ---------- clipboard (write only) ---------- */
  const clipboard = Object.freeze({
    writeText(value) {
      return request('clipboard', { text: String(value == null ? '' : value) }).then(() => undefined);
    }
  });
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, enumerable: true, value: clipboard });
  } catch (_) {}

  /* ---------- path resolution ---------- */
  function normalizeRuntimePath(rawPath) {
    const value = String(rawPath || '');
    const parts = [];
    value.split('/').forEach((segment) => {
      if (!segment || segment === '.') return;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    });
    const out = '/' + parts.join('/');
    return out === '/' ? '/index.html' : out;
  }

  function decodeSegment(segment) {
    try { return decodeURIComponent(segment); } catch (_) { return segment; }
  }

  function requestTarget(url) {
    if (url == null) return null;
    const raw = String(url);
    if (!raw || raw === window.location.href) return null;
    let parsed;
    try {
      parsed = new URL(raw, document.baseURI || window.location.href);
    } catch (_) {
      return null;
    }
    if (parsed.protocol === 'oct:') {
      return { circleId: parsed.hostname, path: normalizeRuntimePath(parsed.pathname), api: false };
    }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'chrome-extension:' || parsed.protocol === 'file:') {
      return null;
    }
    const pathname = parsed.pathname.replace(/\\\\+/g, '/');
    if (pathname === '/api/circle/asset') {
      return {
        circleId: parsed.searchParams.get('circle_id') || context.circle_id,
        path: normalizeRuntimePath(parsed.searchParams.get('path') || '/index.html'),
        api: true
      };
    }
    const segments = pathname.split('/').filter(Boolean).map(decodeSegment);
    if ((segments[0] === 'oct' || segments[0] === '__circle__') && segments.length >= 2) {
      return {
        circleId: segments[1],
        path: normalizeRuntimePath('/' + segments.slice(2).join('/')) || '/index.html',
        api: false
      };
    }
    return { circleId: context.circle_id, path: normalizeRuntimePath(pathname), api: false };
  }

  function requestPath(url) {
    const target = requestTarget(url);
    return target ? target.path : '';
  }

  function isRpcRequest(url, method) {
    if (String(method || '').toUpperCase() !== 'POST') return false;
    const raw = String(url || '');
    if (raw === '/' || raw === 'rpc' || raw === '/rpc' || raw === 'octra-rpc:') return true;
    const path = requestPath(raw).replace(/\\\\+/g, '/');
    return path === '/rpc' || path.endsWith('/rpc');
  }

  function isCircleAssetRequest(url, method) {
    const verb = String(method || 'GET').toUpperCase();
    if (verb !== 'GET' && verb !== 'HEAD') return false;
    const raw = String(url || '');
    if (!raw || /^https?:/i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return false;
    return Boolean(requestTarget(raw));
  }

  /* ---------- asset transport ---------- */
  function bytesFromBase64(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
  }

  function bytesToDataUrl(bytes, contentType) {
    return 'data:' + (contentType || 'application/octet-stream') + ';base64,' + bytesToBase64(bytes);
  }

  function readAsset(target) {
    return request('asset', { circleId: target.circleId, path: target.path }).then((result) => {
      const bytes = result && result.body instanceof ArrayBuffer
        ? new Uint8Array(result.body)
        : bytesFromBase64(result && result.body_b64);
      return {
        bytes: bytes,
        contentType: (result && result.contentType) || 'application/octet-stream',
        circleId: (result && result.circleId) || target.circleId,
        path: (result && result.path) || target.path
      };
    });
  }

  function assetDataUrl(target) {
    return readAsset(target).then((asset) => bytesToDataUrl(asset.bytes, asset.contentType));
  }

  /* ---------- fetch ---------- */
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function fetch(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (isCircleAssetRequest(url, method)) {
      const target = requestTarget(url);
      return readAsset(target).then((asset) => {
        if (target.api) {
          const payload = {
            circle_id: asset.circleId,
            canonical_path: asset.path,
            content_type: asset.contentType,
            encoding: 'identity',
            size_bytes: String(asset.bytes.byteLength),
            body_b64: bytesToBase64(asset.bytes)
          };
          return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          });
        }
        return new Response(method === 'HEAD' ? null : asset.bytes, {
          status: 200,
          headers: { 'content-type': asset.contentType }
        });
      });
    }
    if (isRpcRequest(url, method)) {
      const bodyPromise = init && init.body !== undefined
        ? Promise.resolve(String(init.body == null ? '' : init.body))
        : (input && typeof input.clone === 'function'
          ? input.clone().text().catch(() => '')
          : Promise.resolve(''));
      return bodyPromise.then((body) => request('rpc', { body: body })).then((result) => new Response(
        typeof result === 'string' ? result : JSON.stringify(result),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ));
    }
    if (/^https?:/i.test(String(url || ''))) {
      if (!remoteAllowed) {
        return Promise.reject(new TypeError('Remote network access is disabled for this Circle.'));
      }
    }
    return nativeFetch(input, init);
  };

  /* ---------- XMLHttpRequest ---------- */
  const NativeXHR = window.XMLHttpRequest;
  function CircleXHR() {
    this._native = null;
    this._method = 'GET';
    this._url = '';
    this._headers = {};
    this._responseHeaders = {};
    this._listeners = {};
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseType = '';
    this.response = null;
    this.responseText = '';
    this.responseURL = '';
    this.timeout = 0;
    this.withCredentials = false;
  }
  CircleXHR.UNSENT = 0;
  CircleXHR.OPENED = 1;
  CircleXHR.HEADERS_RECEIVED = 2;
  CircleXHR.LOADING = 3;
  CircleXHR.DONE = 4;
  CircleXHR.prototype.addEventListener = function (name, listener) {
    if (typeof listener !== 'function') return;
    (this._listeners[name] || (this._listeners[name] = [])).push(listener);
  };
  CircleXHR.prototype.removeEventListener = function (name, listener) {
    this._listeners[name] = (this._listeners[name] || []).filter((entry) => entry !== listener);
  };
  CircleXHR.prototype._emit = function (name) {
    const event = new Event(name);
    const self = this;
    const handler = this['on' + name];
    if (typeof handler === 'function') {
      try { handler.call(this, event); } catch (error) { logError(error && error.message); }
    }
    (this._listeners[name] || []).slice().forEach((listener) => {
      try { listener.call(self, event); } catch (error) { logError(error && error.message); }
    });
  };
  CircleXHR.prototype._syncNative = function () {
    const native = this._native;
    if (!native) return;
    this.readyState = native.readyState;
    this.status = native.status;
    this.statusText = native.statusText;
    this.response = native.response;
    this.responseText = native.responseType && native.responseType !== 'text' ? '' : native.responseText;
    this.responseURL = native.responseURL;
  };
  CircleXHR.prototype.open = function (method, url, async, user, password) {
    this._method = String(method || 'GET').toUpperCase();
    this._url = String(url || '');
    if (!isCircleAssetRequest(this._url, this._method) && !isRpcRequest(this._url, this._method)) {
      const native = new NativeXHR();
      this._native = native;
      const self = this;
      ['readystatechange', 'load', 'error', 'abort', 'timeout', 'loadend', 'progress'].forEach((name) => {
        native.addEventListener(name, () => { self._syncNative(); self._emit(name); });
      });
      native.open(method, url, async !== false, user, password);
      this.readyState = native.readyState;
    } else {
      this.readyState = 1;
      this._emit('readystatechange');
    }
  };
  CircleXHR.prototype.setRequestHeader = function (name, value) {
    if (this._native) this._native.setRequestHeader(name, value);
    else this._headers[String(name)] = String(value);
  };
  CircleXHR.prototype.getResponseHeader = function (name) {
    if (this._native) return this._native.getResponseHeader(name);
    return this._responseHeaders[String(name).toLowerCase()] || null;
  };
  CircleXHR.prototype.getAllResponseHeaders = function () {
    if (this._native) return this._native.getAllResponseHeaders();
    return Object.keys(this._responseHeaders).map((key) => key + ': ' + this._responseHeaders[key]).join('\\r\\n');
  };
  CircleXHR.prototype.overrideMimeType = function (value) {
    if (this._native) this._native.overrideMimeType(value);
  };
  CircleXHR.prototype.abort = function () {
    if (this._native) this._native.abort();
    this.readyState = 0;
    this._emit('abort');
    this._emit('loadend');
  };
  CircleXHR.prototype.send = function (body) {
    if (this._native) {
      this._native.responseType = this.responseType;
      this._native.timeout = this.timeout;
      this._native.withCredentials = this.withCredentials;
      this._native.send(body);
      return;
    }
    const self = this;
    window.fetch(this._url, { method: this._method, headers: this._headers, body: body }).then((response) => {
      self.status = response.status;
      self.statusText = response.statusText;
      self.responseURL = self._url;
      self._responseHeaders = { 'content-type': response.headers.get('content-type') || '' };
      self.readyState = 2;
      self._emit('readystatechange');
      if (self.responseType === 'arraybuffer') return response.arrayBuffer();
      if (self.responseType === 'blob') return response.blob();
      return response.text();
    }).then((value) => {
      self.readyState = 4;
      if (self.responseType === 'json') {
        self.responseText = String(value || '');
        try { self.response = JSON.parse(self.responseText); } catch (_) { self.response = null; }
      } else if (self.responseType === 'arraybuffer' || self.responseType === 'blob') {
        self.response = value;
        self.responseText = '';
      } else {
        self.responseText = String(value || '');
        self.response = self.responseText;
      }
      self._emit('readystatechange');
      self._emit('load');
      self._emit('loadend');
    }).catch(() => {
      self.readyState = 4;
      self.status = 0;
      self._emit('readystatechange');
      self._emit('error');
      self._emit('loadend');
    });
  };
  window.XMLHttpRequest = CircleXHR;

  /* ---------- OctraCircle bridge ---------- */
  const bridge = Object.freeze({
    context: context,
    request(method, payload) {
      return request('bridge', { method: String(method || ''), payload: payload || {} });
    },
    navigate(uri) {
      const href = String(uri || '');
      if (!href.startsWith('oct://')) return;
      post('navigate', { href: href });
    }
  });
  try {
    Object.defineProperty(window, 'OctraCircle', { configurable: true, value: bridge });
  } catch (_) {
    window.OctraCircle = bridge;
  }

  /* ---------- dynamic asset hydration ---------- */
  const nativeSetAttribute = Element.prototype.setAttribute;
  const nativeGetAttribute = Element.prototype.getAttribute;
  const nativeRemoveAttribute = Element.prototype.removeAttribute;
  const nativeInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const nativeInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  const assetHydrations = new WeakMap();
  const styleHydrations = new WeakMap();
  const styleTextHydrations = new WeakMap();

  function assetAttributes(node) {
    if (!node || node.nodeType !== 1) return [];
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') return ['src', 'srcset'];
    if (tag === 'script') return ['src'];
    if (tag === 'input' && String(nativeGetAttribute.call(node, 'type') || '').toLowerCase() === 'image') return ['src'];
    if (tag === 'source') return ['src', 'srcset'];
    if (tag === 'video') return ['src', 'poster'];
    if (tag === 'audio' || tag === 'track') return ['src'];
    if (tag === 'link' && /(?:icon|stylesheet)/.test(String(nativeGetAttribute.call(node, 'rel') || '').toLowerCase())) return ['href'];
    if (tag === 'image') return ['href', 'xlink:href'];
    return [];
  }
  function marker(attribute) { return 'data-circlet-' + attribute; }
  function originalUrl(node, attribute) {
    return nativeGetAttribute.call(node, marker(attribute)) || nativeGetAttribute.call(node, attribute) || '';
  }
  function needsAsset(url) {
    const raw = String(url || '');
    if (!raw || /^https?:/i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('#')) return false;
    return Boolean(requestTarget(raw));
  }
  function markAsset(node, attribute, url) {
    nativeSetAttribute.call(node, marker(attribute), String(url));
    nativeRemoveAttribute.call(node, attribute);
  }
  function hydrationMap(node) {
    let map = assetHydrations.get(node);
    if (!map) {
      map = new Map();
      assetHydrations.set(node, map);
    }
    return map;
  }
  function splitSrcset(value) {
    return String(value || '').split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const pieces = part.split(/\\s+/);
      return { url: pieces.shift(), descriptor: pieces.join(' ') };
    });
  }
  function hydrateSrcset(node, rawValue) {
    const entries = splitSrcset(rawValue).filter((entry) => needsAsset(entry.url));
    if (!entries.length) return Promise.resolve(null);
    return Promise.all(entries.map((entry) => {
      const target = requestTarget(entry.url);
      return assetDataUrl(target).then((dataUrl) => dataUrl + (entry.descriptor ? ' ' + entry.descriptor : ''));
    })).then((parts) => parts.join(', '));
  }
  function hydrateAssetAttribute(node, attribute) {
    const raw = originalUrl(node, attribute);
    if (!needsAsset(raw)) return;
    const map = hydrationMap(node);
    if (map.get(attribute) === raw) return;
    map.set(attribute, raw);
    const pending = attribute === 'srcset'
      ? hydrateSrcset(node, raw)
      : assetDataUrl(requestTarget(raw));
    pending.then((value) => {
      if (!value) return;
      if (nativeGetAttribute.call(node, marker(attribute)) !== raw) return;
      nativeSetAttribute.call(node, attribute, value);
      nativeRemoveAttribute.call(node, marker(attribute));
    }).catch((error) => {
      logError('Asset failed: ' + (attribute === 'srcset' ? raw : requestPath(raw)) + ' ' + (error && error.message ? error.message : ''));
    }).finally(() => {
      if (map.get(attribute) === raw) map.delete(attribute);
    });
  }
  function hydrateStyleValue(raw) {
    const matches = [...String(raw || '').matchAll(/url\\(\\s*(['"]?)(.*?)\\1\\s*\\)/gi)];
    const jobs = [];
    for (const match of matches) {
      const value = String(match[2] || '').trim();
      if (!value || !needsAsset(value)) continue;
      jobs.push(assetDataUrl(requestTarget(value)).then((dataUrl) => ({ original: match[0], dataUrl: dataUrl })).catch(() => null));
    }
    if (!jobs.length) return Promise.resolve(raw);
    return Promise.all(jobs).then((results) => {
      let output = String(raw || '');
      for (const result of results) {
        if (result && result.dataUrl) output = output.replace(result.original, 'url("' + result.dataUrl + '")');
      }
      return output;
    });
  }
  function hydrateStyleAttribute(node) {
    const raw = nativeGetAttribute.call(node, 'style') || '';
    if (!raw || styleHydrations.get(node) === raw) return;
    styleHydrations.set(node, raw);
    hydrateStyleValue(raw).then((next) => {
      if (next && next !== raw && nativeGetAttribute.call(node, 'style') === raw) {
        styleHydrations.set(node, next);
        nativeSetAttribute.call(node, 'style', next);
      }
    }).catch(() => {});
  }
  function hydrateStyleElement(node) {
    const raw = node.textContent || '';
    if (!raw || styleTextHydrations.get(node) === raw) return;
    styleTextHydrations.set(node, raw);
    hydrateStyleValue(raw).then((next) => {
      if (next && next !== raw && (node.textContent || '') === raw) {
        styleTextHydrations.set(node, next);
        node.textContent = next;
      }
    }).catch(() => {});
  }
  function hydrateElement(node) {
    if (!node || node.nodeType !== 1) return;
    assetAttributes(node).forEach((attribute) => hydrateAssetAttribute(node, attribute));
    if (node.hasAttribute('style')) hydrateStyleAttribute(node);
    if (node.tagName && node.tagName.toLowerCase() === 'style') hydrateStyleElement(node);
  }
  function hydrateTree(root) {
    hydrateElement(root);
    if (root && root.querySelectorAll) {
      root.querySelectorAll('img,script,input,source,video,audio,track,link,image,style').forEach(hydrateElement);
    }
  }
  function prepareMarkup(value) {
    if (!nativeInnerHTML || !nativeInnerHTML.set || !nativeInnerHTML.get) return String(value == null ? '' : value);
    const template = document.createElement('template');
    nativeInnerHTML.set.call(template, String(value == null ? '' : value));
    template.content.querySelectorAll('img,script,input,source,video,audio,track,link,image').forEach((node) => {
      assetAttributes(node).forEach((attribute) => {
        const url = nativeGetAttribute.call(node, attribute) || '';
        if (needsAsset(url)) markAsset(node, attribute, url);
      });
    });
    return nativeInnerHTML.get.call(template);
  }
  if (nativeInnerHTML && nativeInnerHTML.set && nativeInnerHTML.get && nativeInnerHTML.configurable) {
    try {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        configurable: true,
        enumerable: nativeInnerHTML.enumerable,
        get: nativeInnerHTML.get,
        set(value) {
          nativeInnerHTML.set.call(this, prepareMarkup(value));
          queueMicrotask(() => hydrateTree(this));
        }
      });
    } catch (_) {}
  }
  if (typeof nativeInsertAdjacentHTML === 'function') {
    Element.prototype.insertAdjacentHTML = function (position, value) {
      nativeInsertAdjacentHTML.call(this, position, prepareMarkup(value));
      queueMicrotask(() => hydrateTree(this));
    };
  }
  Element.prototype.setAttribute = function (name, value) {
    const attribute = String(name || '').toLowerCase();
    if (assetAttributes(this).includes(attribute) && needsAsset(String(value || '').trim().split(/\\s+/)[0])) {
      markAsset(this, attribute, value);
      if (this.isConnected) queueMicrotask(() => hydrateAssetAttribute(this, attribute));
      return;
    }
    nativeSetAttribute.call(this, name, value);
  };
  function installAssetProperty(proto, property, attribute) {
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor || !descriptor.get || !descriptor.set || !descriptor.configurable) return;
    try {
      Object.defineProperty(proto, property, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          return nativeGetAttribute.call(this, marker(attribute || property)) || descriptor.get.call(this);
        },
        set(value) {
          const attr = attribute || property;
          if (attr === 'srcset') {
            if (needsAsset(String(value || '').trim().split(/\\s+/)[0])) {
              markAsset(this, attr, value);
              if (this.isConnected) queueMicrotask(() => hydrateAssetAttribute(this, attr));
              return;
            }
          } else if (assetAttributes(this).includes(attr) && needsAsset(String(value || ''))) {
            markAsset(this, attr, value);
            if (this.isConnected) queueMicrotask(() => hydrateAssetAttribute(this, attr));
            return;
          }
          descriptor.set.call(this, value);
        }
      });
    } catch (_) {}
  }
  installAssetProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'src');
  installAssetProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, 'srcset');
  installAssetProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'src');
  installAssetProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, 'srcset');
  installAssetProperty(window.HTMLMediaElement && window.HTMLMediaElement.prototype, 'src');
  installAssetProperty(window.HTMLVideoElement && window.HTMLVideoElement.prototype, 'poster', 'poster');
  installAssetProperty(window.HTMLScriptElement && window.HTMLScriptElement.prototype, 'src');
  installAssetProperty(window.HTMLLinkElement && window.HTMLLinkElement.prototype, 'href');
  installAssetProperty(window.HTMLInputElement && window.HTMLInputElement.prototype, 'src');
  installAssetProperty(window.HTMLTrackElement && window.HTMLTrackElement.prototype, 'src');

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        hydrateElement(record.target);
      } else {
        record.addedNodes.forEach((node) => {
          if (node && node.nodeType === 1) hydrateTree(node);
        });
      }
    }
  });
  function startHydration() {
    hydrateTree(document.documentElement);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'poster', 'style']
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startHydration, { once: true });
  else startHydration();

  /* ---------- downloads ---------- */
  const pendingDownloads = new Map();
  function downloadMime(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.zip')) return 'application/zip';
    return 'application/octet-stream';
  }
  function downloadSpec(link) {
    const declared = link.getAttribute('data-circle-download-parts') || '';
    const href = link.getAttribute('href') || '';
    let resources = declared.split(/[\\n,]+/).map((item) => requestTarget(item.trim())).filter(Boolean);
    if (!resources.length) {
      const target = requestTarget(href);
      if (!target) return null;
      const explicit = link.hasAttribute('download');
      const byExtension = /\\.(apk|exe|msi|pdf|zip|7z|rar|dmg|deb|rpm|tar|gz|csv|docx?|xlsx?|pptx?)(?:$|[?#])/i.test(href);
      if (!explicit && !byExtension) return null;
      resources = [target];
    }
    const last = resources[resources.length - 1];
    const fallback = String(last.path || '').split('/').pop().replace(/\\.part\\d+$/i, '');
    const fileName = link.getAttribute('data-circle-download-name') || link.getAttribute('download') || fallback || 'circle-download';
    return {
      resources: resources.map((resource) => ({ circleId: resource.circleId, path: resource.path })),
      fileName: fileName,
      mimeType: link.getAttribute('data-circle-download-type') || link.getAttribute('type') || downloadMime(fileName),
      sha256: link.getAttribute('data-circle-download-sha256') || ''
    };
  }
  document.addEventListener('click', (event) => {
    const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    const download = downloadSpec(link);
    if (download) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = nextId('download');
      pendingDownloads.set(id, { link: link, html: link.innerHTML });
      link.setAttribute('aria-disabled', 'true');
      link.textContent = 'Preparing 0/' + download.resources.length;
      request('download', download).then(() => {
        pendingDownloads.delete(id);
        link.removeAttribute('aria-disabled');
        link.innerHTML = link.dataset.circletOriginal || link.innerHTML;
        link.textContent = 'Downloaded';
      }).catch((error) => {
        pendingDownloads.delete(id);
        link.removeAttribute('aria-disabled');
        link.textContent = 'Retry download';
        logError(error && error.message ? error.message : 'Download failed');
      });
      return;
    }
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) return;
    if (href.startsWith('oct://')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post('navigate', { href: href });
      return;
    }
    if (/^https?:/i.test(href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post('open', { href: href });
      return;
    }
    const target = requestTarget(href);
    if (target) {
      event.preventDefault();
      event.stopImmediatePropagation();
      post('navigate', { href: 'oct://' + target.circleId + target.path });
    }
  }, true);

  const nativeOpen = window.open.bind(window);
  window.open = function (url, target, features) {
    const href = String(url || '');
    const parsed = requestTarget(href);
    if (href.startsWith('oct://') || parsed) {
      const next = href.startsWith('oct://') ? href : 'oct://' + parsed.circleId + parsed.path;
      post('navigate', { href: next });
      return null;
    }
    if (/^https?:/i.test(href)) {
      post('open', { href: href });
      return null;
    }
    return nativeOpen(url, target, features);
  };

  window.addEventListener('submit', (event) => {
    const form = event.target && event.target.closest ? event.target.closest('form') : null;
    if (!form) return;
    const action = form.getAttribute('action') || window.location.href;
    if (/^https?:/i.test(action)) {
      event.preventDefault();
      post('open', { href: action });
      return;
    }
    const target = requestTarget(action);
    if (target) {
      event.preventDefault();
      post('navigate', { href: 'oct://' + target.circleId + target.path });
    }
  }, true);

  post('ready', { sealed: sealed });
})();`;
}
