import {
  bytesToDataUrl,
  bytesToText,
  circleUri,
  isDownloadPath,
  joinPath,
  normalizePath,
  splitSrcset,
  textToDataUrl
} from "./octra.js";
import { buildRuntimeScript } from "./runtime.js";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_CSS_BYTES = 2 * 1024 * 1024;
const MODULE_CONTENT_TYPE = "text/javascript;charset=utf-8";

export async function buildDocument(options) {
  const doc = new DOMParser().parseFromString(String(options.html || ""), "text/html");
  const ctx = {
    circleId: options.circleId,
    host: options.host || options.circleId,
    path: normalizePath(options.path || "/index.html"),
    display: options.display || circleUri(options.host || options.circleId, options.path),
    network: options.network,
    info: options.info || {},
    mode: options.mode === "sealed" ? "sealed" : "public",
    settings: options.settings || {},
    remoteAllowed: Boolean(options.remoteAllowed) && options.mode !== "sealed",
    loadAsset: options.loadAsset,
    fetchRemote: options.fetchRemote,
    warnings: []
  };
  ctx.allowCrossCircle = ctx.mode === "public";

  doc.querySelectorAll("meta[http-equiv]").forEach((node) => {
    const directive = String(node.getAttribute("http-equiv") || "").toLowerCase();
    if (directive === "content-security-policy" || directive === "refresh") node.remove();
  });
  doc.querySelectorAll("base").forEach((node) => node.remove());

  const base = doc.createElement("base");
  const directory = ctx.path.replace(/[^/]*$/, "");
  base.href = `oct://${ctx.circleId}${directory}`;
  doc.head.prepend(base);

  const policy = doc.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", contentSecurityPolicy(ctx));
  doc.head.prepend(policy);

  const referrer = doc.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  doc.head.prepend(referrer);

  const bridge = doc.createElement("script");
  bridge.textContent = buildRuntimeScript({
    token: options.token,
    sealed: ctx.mode === "sealed",
    remoteAllowed: false,
    context: {
      circle_id: ctx.circleId,
      path: ctx.path,
      uri: circleUri(ctx.host, ctx.path),
      display: ctx.display,
      network: ctx.network?.id || "",
      network_name: ctx.network?.name || "",
      chain_id: ctx.network?.chainId || "",
      mode: ctx.mode,
      runtime: ctx.info?.runtime || null,
      owner: ctx.info?.owner || null,
      privacy_class: ctx.info?.privacy_class || null,
      resource_mode: ctx.info?.resource_mode || null,
      browser_mode: ctx.info?.browser_mode || null
    },
    storage: options.storage || { local: {}, session: {} }
  });
  doc.head.prepend(bridge);

  await processDocument(doc, ctx);
  rewriteAnchors(doc, ctx);
  escapeRawText(doc);

  return {
    html: `<!doctype html>\n${doc.documentElement.outerHTML}`,
    warnings: ctx.warnings
  };
}

function contentSecurityPolicy(ctx) {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
    "style-src 'unsafe-inline' data: blob:",
    "img-src data: blob:",
    "font-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "worker-src blob: data:",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "manifest-src 'none'"
  ].join("; ") + ";";
}

async function processDocument(doc, ctx) {
  const styleJobs = [];
  doc.querySelectorAll("style").forEach((node) => {
    styleJobs.push((async () => {
      node.textContent = await inlineCss(node.textContent || "", ctx.path, ctx, new Set(), 0);
    })());
  });

  doc.querySelectorAll("[style]").forEach((node) => {
    styleJobs.push((async () => {
      const css = node.getAttribute("style") || "";
      node.setAttribute("style", await inlineCss(css, ctx.path, ctx, new Set(), 0));
    })());
  });
  await Promise.allSettled(styleJobs);

  const jobs = [];

  doc.querySelectorAll("link[href]").forEach((node) => {
    jobs.push(processLink(node, ctx));
  });

  doc.querySelectorAll("script[src]").forEach((node) => {
    jobs.push(processScript(node, ctx));
  });

  doc.querySelectorAll("img[src],input[type='image'][src],source[src],audio[src],video[src],track[src]").forEach((node) => {
    jobs.push(replaceSrcAttribute(node, "src", ctx));
  });

  doc.querySelectorAll("video[poster]").forEach((node) => {
    jobs.push(replaceSrcAttribute(node, "poster", ctx));
  });

  doc.querySelectorAll("img[srcset],source[srcset]").forEach((node) => {
    jobs.push(replaceSrcset(node, ctx));
  });

  doc.querySelectorAll("image[href],image[xlink\\:href]").forEach((node) => {
    const attr = node.hasAttribute("href") ? "href" : "xlink:href";
    jobs.push(replaceSrcAttribute(node, attr, ctx));
  });

  doc.querySelectorAll("iframe").forEach((node) => node.remove());
  doc.querySelectorAll("object,embed,applet").forEach((node) => node.remove());

  await Promise.allSettled(jobs);
}

async function processLink(node, ctx) {
  const rel = String(node.getAttribute("rel") || "").toLowerCase();
  const href = String(node.getAttribute("href") || "").trim();
  if (!href) return;
  if (rel.includes("preconnect") || rel.includes("dns-prefetch") || rel.includes("preload") || rel.includes("prefetch") || rel.includes("manifest")) {
    node.remove();
    return;
  }
  if (rel.includes("stylesheet")) {
    try {
      const css = await readCss(href, ctx.path, ctx);
      const style = node.ownerDocument.createElement("style");
      style.textContent = css;
      node.replaceWith(style);
    } catch (error) {
      ctx.warnings.push(`stylesheet ${href}: ${error.message}`);
      node.remove();
    }
    return;
  }
  if (rel.includes("icon") || rel.includes("apple-touch-icon") || rel.includes("mask-icon")) {
    try {
      const dataUrl = await readDataUrl(href, ctx.path, ctx);
      if (dataUrl) node.setAttribute("href", dataUrl);
      else node.remove();
    } catch {
      node.remove();
    }
    return;
  }
  const resource = resolveResource(href, ctx.path, ctx);
  if (!resource) {
    if (resource === null && /^https?:/i.test(href)) node.remove();
  }
}

async function processScript(node, ctx) {
  const src = String(node.getAttribute("src") || "").trim();
  if (!src) return;
  const type = String(node.getAttribute("type") || "").toLowerCase();
  try {
    let source;
    let basePath = ctx.path;
    let remoteBase = null;
    if (/^https?:/i.test(src) || src.startsWith("//")) {
      if (!ctx.remoteAllowed) throw new Error("remote scripts are disabled");
      const url = src.startsWith("//") ? `https:${src}` : src;
      source = await ctx.fetchRemote(url, MAX_TEXT_BYTES, "text");
      remoteBase = url;
    } else {
      const resource = resolveResource(src, ctx.path, ctx);
      if (!resource) throw new Error("script URL is not a Circle resource");
      const asset = await ctx.loadAsset(resource.circleId, resource.path);
      source = bytesToText(asset.body);
      basePath = resource.path;
    }
    const inline = node.ownerDocument.createElement("script");
    for (const attribute of node.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "src" || name === "integrity" || name === "crossorigin") continue;
      inline.setAttribute(attribute.name, attribute.value);
    }
    if (type === "module") {
      inline.textContent = remoteBase
        ? await materializeWorkerLiterals(source, remoteBase, ctx)
        : await materializeModule(source, basePath, ctx, new Set());
    } else {
      inline.textContent = remoteBase
        ? await materializeWorkerLiterals(source, remoteBase, ctx)
        : await materializeWorkerLiterals(source, basePath, ctx);
    }
    node.replaceWith(inline);
  } catch (error) {
    ctx.warnings.push(`script ${src}: ${error.message}`);
    node.remove();
  }
}

async function replaceSrcAttribute(node, attribute, ctx) {
  const raw = String(node.getAttribute(attribute) || "").trim();
  if (!raw) return;
  try {
    const dataUrl = await readDataUrl(raw, ctx.path, ctx);
    if (dataUrl) node.setAttribute(attribute, dataUrl);
    else node.removeAttribute(attribute);
  } catch (error) {
    ctx.warnings.push(`asset ${raw}: ${error.message}`);
    node.removeAttribute(attribute);
  }
}

async function replaceSrcset(node, ctx) {
  const raw = node.getAttribute("srcset") || "";
  const parts = [];
  for (const entry of splitSrcset(raw)) {
    try {
      const dataUrl = await readDataUrl(entry.url, ctx.path, ctx);
      if (dataUrl) parts.push(dataUrl + (entry.descriptor ? ` ${entry.descriptor}` : ""));
    } catch {
      // Drop candidates that cannot be materialized.
    }
  }
  if (parts.length) node.setAttribute("srcset", parts.join(", "));
  else node.removeAttribute("srcset");
}

function resolveResource(rawInput, basePath, ctx) {
  const spec = String(rawInput || "").trim();
  if (!spec) return null;
  if (spec.startsWith("#") || /^(?:data|blob|mailto|tel|javascript|about|file|chrome-extension):/i.test(spec)) return null;
  if (spec.startsWith("//")) return { remote: true, url: `https:${spec}` };
  if (/^https?:/i.test(spec)) return { remote: true, url: spec };

  if (/^oct:/i.test(spec)) {
    const match = /^oct:\/\/([^/?#]+)(.*)$/i.exec(spec);
    if (!match) return null;
    const circleId = match[1];
    if (!ctx.allowCrossCircle && circleId !== ctx.circleId) return null;
    return { circleId, path: normalizePath(match[2] || "/") };
  }

  let pathname = spec.split("#")[0].split("?")[0];
  let search = "";
  const queryIndex = spec.indexOf("?");
  if (queryIndex >= 0) search = spec.slice(queryIndex).split("#")[0];

  if (pathname === "/api/circle/asset") {
    const params = new URLSearchParams(search);
    const circleId = params.get("circle_id") || ctx.circleId;
    if (!ctx.allowCrossCircle && circleId !== ctx.circleId) return null;
    return { circleId, path: normalizePath(params.get("path") || "/index.html") };
  }

  const segments = pathname.split("/").filter(Boolean);
  if ((segments[0] === "oct" || segments[0] === "__circle__") && segments.length >= 2) {
    const circleId = decodeSegment(segments[1]);
    if (!ctx.allowCrossCircle && circleId !== ctx.circleId) return null;
    return { circleId, path: normalizePath(`/${segments.slice(2).join("/")}`) };
  }

  if (pathname.startsWith("/")) return { circleId: ctx.circleId, path: normalizePath(pathname) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathname)) return null;
  return { circleId: ctx.circleId, path: joinPath(basePath, pathname) };
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function readAssetBytes(raw, basePath, ctx) {
  const resource = resolveResource(raw, basePath, ctx);
  if (!resource) throw new Error("not a Circle resource");
  if (resource.remote) {
    if (!ctx.remoteAllowed) throw new Error("remote assets are disabled");
    return {
      bytes: await ctx.fetchRemote(resource.url, MAX_ASSET_BYTES, "bytes"),
      contentType: guessContentType(resource.url),
      remote: true,
      path: resource.url
    };
  }
  const asset = await ctx.loadAsset(resource.circleId, resource.path);
  if (asset.body.byteLength > MAX_ASSET_BYTES) throw new Error("asset exceeds 32 MiB");
  return { ...asset, remote: false };
}

async function readDataUrl(raw, basePath, ctx) {
  if (/^(?:data|blob):/i.test(String(raw || "").trim())) return String(raw).trim();
  const asset = await readAssetBytes(raw, basePath, ctx);
  return bytesToDataUrl(asset.contentType, asset.body);
}

async function readCss(raw, basePath, ctx) {
  if (/^https?:/i.test(raw) || raw.startsWith("//")) {
    if (!ctx.remoteAllowed) throw new Error("remote stylesheets are disabled");
    const url = raw.startsWith("//") ? `https:${raw}` : raw;
    const text = await ctx.fetchRemote(url, MAX_CSS_BYTES, "text");
    return inlineCss(text, url, ctx, new Set([url]), 0);
  }
  const asset = await readAssetBytes(raw, basePath, ctx);
  if (asset.body.byteLength > MAX_CSS_BYTES) throw new Error("stylesheet exceeds 2 MiB");
  return inlineCss(bytesToText(asset.body), asset.path, ctx, new Set(), 0);
}

async function inlineCss(css, cssPath, ctx, seen, depth) {
  let output = String(css || "");
  if (depth < 4) {
    const imports = [...output.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s]+)\1\s*\)?\s*([^;]*);/gi)];
    for (const match of imports) {
      const spec = match[2];
      if (!spec || seen.has(spec)) {
        output = output.replace(match[0], "");
        continue;
      }
      seen.add(spec);
      try {
        let importCss;
        let importBase = cssPath;
        if (/^https?:/i.test(spec) || spec.startsWith("//")) {
          if (!ctx.remoteAllowed) throw new Error("remote import disabled");
          const url = spec.startsWith("//") ? `https:${spec}` : spec;
          importCss = await ctx.fetchRemote(url, MAX_CSS_BYTES, "text");
          importBase = url;
        } else {
          const asset = await readAssetBytes(spec, cssPath, ctx);
          importCss = bytesToText(asset.body);
          importBase = asset.path;
        }
        const media = String(match[3] || "").trim();
        const nested = await inlineCss(importCss, importBase, ctx, seen, depth + 1);
        output = output.replace(match[0], () => media ? `@media ${media} {\n${nested}\n}` : nested);
      } catch {
        output = output.replace(match[0], "");
      }
    }
  } else {
    output = output.replace(/@import\s+[^;]+;/gi, "");
  }

  const urls = [...output.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
  for (const match of urls) {
    const original = match[0];
    const value = String(match[2] || "").trim();
    if (!value || /^(?:data|blob|#)/i.test(value)) continue;
    try {
      let dataUrl = null;
      if (/^https?:/i.test(value) || value.startsWith("//")) {
        if (!ctx.remoteAllowed) throw new Error("remote asset disabled");
        const url = value.startsWith("//") ? `https:${value}` : value;
        const bytes = await ctx.fetchRemote(url, MAX_ASSET_BYTES, "bytes");
        dataUrl = bytesToDataUrl(guessContentType(url), bytes);
      } else if (/^https?:/i.test(cssPath) || cssPath.startsWith("//")) {
        if (!ctx.remoteAllowed) throw new Error("remote asset disabled");
        const url = new URL(value, cssPath.startsWith("//") ? `https:${cssPath}` : cssPath).href;
        const bytes = await ctx.fetchRemote(url, MAX_ASSET_BYTES, "bytes");
        dataUrl = bytesToDataUrl(guessContentType(url), bytes);
      } else {
        const asset = await readAssetBytes(value, cssPath, ctx);
        dataUrl = bytesToDataUrl(asset.contentType, asset.body);
      }
      if (dataUrl) output = output.replace(original, () => `url("${dataUrl}")`);
    } catch {
      if (ctx.mode === "sealed") output = output.replace(original, () => 'url("data:,")');
    }
  }
  return output;
}

async function materializeModule(source, modulePath, ctx, stack) {
  const cleanPath = normalizePath(modulePath);
  if (stack.has(cleanPath)) return source;
  const nextStack = new Set(stack);
  nextStack.add(cleanPath);
  let output = await materializeWorkerLiterals(source, cleanPath, ctx);
  const patterns = [
    /(\b(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?)(['"])(\.{0,2}\/[^'"]+|\/[^'"]+)\2/g,
    /(\bimport\s*\(\s*)(['"])(\.{0,2}\/[^'"]+|\/[^'"]+)\2(\s*\))/g
  ];
  for (const pattern of patterns) {
    const matches = [...output.matchAll(pattern)];
    for (const match of matches) {
      const specifier = match[3];
      const resource = resolveResource(specifier, cleanPath, ctx);
      if (!resource || resource.remote || nextStack.has(resource.path)) continue;
      try {
        const dataUrl = await moduleDataUrl(resource, ctx, nextStack);
        output = output.replace(match[0], match[0].replace(specifier, dataUrl));
      } catch (error) {
        ctx.warnings.push(`module ${specifier}: ${error.message}`);
      }
    }
  }
  return output;
}

async function moduleDataUrl(resource, ctx, stack) {
  const cache = (ctx.moduleCache || (ctx.moduleCache = new Map()));
  const key = `${resource.circleId}:${resource.path}`;
  if (cache.has(key)) return cache.get(key);
  const asset = await ctx.loadAsset(resource.circleId, resource.path);
  const source = await materializeModule(bytesToText(asset.body), resource.path, ctx, stack);
  const dataUrl = textToDataUrl(MODULE_CONTENT_TYPE, source);
  cache.set(key, dataUrl);
  return dataUrl;
}

async function materializeWorkerLiterals(source, scriptPath, ctx) {
  let output = String(source || "");
  const patterns = [
    /(new\s+(?:Shared)?Worker\s*\(\s*)(['"])([^'"]+)\2/g,
    /(new\s+URL\s*\(\s*)(['"])([^'"]+)\2(\s*,\s*import\.meta\.url\s*\))/g
  ];
  for (const pattern of patterns) {
    const matches = [...output.matchAll(pattern)];
    for (const match of matches) {
      const specifier = match[3];
      const resource = resolveResource(specifier, scriptPath, ctx);
      if (!resource) continue;
      try {
        const dataUrl = resource.remote
          ? bytesToDataUrl("text/javascript;charset=utf-8", new TextEncoder().encode(await ctx.fetchRemote(resource.url, MAX_TEXT_BYTES, "text")))
          : await moduleDataUrl(resource, ctx, new Set([normalizePath(scriptPath)]));
        output = output.replace(match[0], match[0].replace(specifier, dataUrl));
      } catch {
        // Leave the original specifier when the worker cannot be materialized.
      }
    }
  }
  return output;
}

function rewriteAnchors(doc, ctx) {
  doc.querySelectorAll("a[href]").forEach((link) => {
    const raw = String(link.getAttribute("href") || "").trim();
    const declared = String(link.getAttribute("data-circle-download-parts") || "")
      .split(/[\n,]+/)
      .map((item) => resolveResource(item.trim(), ctx.path, ctx))
      .filter(Boolean);
    if (declared.length) {
      link.setAttribute("data-circle-download-parts", declared.map((item) => circleUri(item.circleId, item.path)).join(","));
      link.setAttribute("href", "#");
      link.removeAttribute("target");
      return;
    }
    if (!raw || raw.startsWith("#")) return;
    if (/^(?:mailto|tel):/i.test(raw)) return;
    if (/^javascript:/i.test(raw)) {
      link.removeAttribute("href");
      return;
    }
    if (/^https?:/i.test(raw)) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      return;
    }
    if (/^oct:\/\//i.test(raw)) {
      link.removeAttribute("target");
      return;
    }
    const resource = resolveResource(raw, ctx.path, ctx);
    if (!resource) {
      link.setAttribute("href", "#");
      return;
    }
    if (link.hasAttribute("download") || isDownloadPath(resource.path)) {
      link.setAttribute("data-circle-download-parts", circleUri(resource.circleId, resource.path));
      if (!link.getAttribute("data-circle-download-name")) {
        link.setAttribute("data-circle-download-name", link.getAttribute("download") || resource.path.split("/").pop() || "circle-download");
      }
      link.setAttribute("href", "#");
      link.removeAttribute("target");
      return;
    }
    link.setAttribute("href", circleUri(resource.circleId, resource.path));
    link.removeAttribute("target");
  });
}

function escapeRawText(doc) {
  doc.querySelectorAll("script").forEach((node) => {
    if (node.textContent) node.textContent = escapeClosing(node.textContent, "script");
  });
  doc.querySelectorAll("style").forEach((node) => {
    if (node.textContent) node.textContent = escapeClosing(node.textContent, "style");
  });
}

function escapeClosing(source, tag) {
  return String(source || "").replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

function guessContentType(url) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".avif")) return "image/avif";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".ttf")) return "font/ttf";
  if (path.endsWith(".otf")) return "font/otf";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
  if (path.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
