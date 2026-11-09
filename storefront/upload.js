// @ts-check
/**
 * Upload widget (PRD F9, screen B2): drag or tap, type/size checks, direct-to-storage
 * PUT with progress, one automatic retry, thumbnail, remove, manual retry.
 * Protocol: docs/ARCHITECTURE.md "Uploads".
 */
import { fileKind, fill, typesText } from "./format.js";

/**
 * @typedef {{ key: number, file?: File, name: string, kind: string|null, status: "uploading"|"done"|"error",
 *   progress: number, url?: string, error?: string, preview?: string }} Item
 */

/**
 * @param {HTMLElement} el
 * @param {any} field
 * @param {{ uploadUrl: string, maxMb: number, maxFiles: number, productId: any, strings: Record<string,string>, onChange: () => void }} opts
 */
export function createUploader(el, field, opts) {
  const input = /** @type {HTMLInputElement} */ (el.querySelector("input[type=file]"));
  const drop = /** @type {HTMLElement} */ (el.querySelector("[data-shine-drop]"));
  const list = /** @type {HTMLElement} */ (el.querySelector("[data-shine-files]"));
  const status = /** @type {HTMLElement} */ (el.querySelector("[data-shine-upload-status]"));
  const { strings } = opts;
  const allowed = (field.settings && field.settings.fileTypes) || ["jpg", "png", "pdf"];
  const maxBytes = Math.max(0.1, Number(opts.maxMb) || 5) * 1024 * 1024;
  const sizeText = `${Number(opts.maxMb) || 5} MB`;
  /** @type {Item[]} */
  let items = [];
  let seq = 0;

  /** @param {string} msg */
  const say = (msg) => {
    if (status) status.textContent = msg;
  };

  /** @param {FileList | File[] | null} files */
  function add(files) {
    if (!files) return;
    say("");
    for (const file of Array.from(files)) {
      if (items.filter((i) => i.status !== "error").length >= opts.maxFiles) {
        say(fill(strings.max_files, { max: opts.maxFiles }));
        break;
      }
      const kind = fileKind(file, allowed);
      if (!kind) {
        say(fill(strings.upload_wrong_type, { types: typesText(allowed, strings.or) }));
        continue;
      }
      if (file.size > maxBytes) {
        say(fill(strings.upload_too_large, { size: sizeText }));
        continue;
      }
      /** @type {Item} */
      const item = { key: ++seq, file, name: file.name, kind, status: "uploading", progress: 0 };
      if (kind !== "pdf" && typeof URL !== "undefined" && URL.createObjectURL) item.preview = URL.createObjectURL(file);
      items.push(item);
      start(item);
    }
    render();
    opts.onChange();
  }

  /** @param {string} url @param {any} body */
  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    if (!res.ok && !(/** @type {any} */ (json).error)) throw new Error(`http_${res.status}`);
    return /** @type {any} */ (json);
  }

  /** @param {string} url @param {Record<string,string>} headers @param {File} file @param {(p:number)=>void} onProgress */
  function put(url, headers, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      for (const k in headers || {}) xhr.setRequestHeader(k, headers[k]);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(undefined) : reject(new Error(`put_${xhr.status}`)));
      xhr.onerror = () => reject(new Error("network"));
      xhr.ontimeout = () => reject(new Error("timeout"));
      xhr.send(file);
    });
  }

  /** @param {Item} item */
  async function start(item) {
    if (!item.file) return;
    item.status = "uploading";
    item.progress = 0;
    item.error = undefined;
    render();
    const base = String(opts.uploadUrl || "/apps/shine-options/uploads").replace(/\/$/, "");
    try {
      const init = await postJSON(base, {
        fileName: item.file.name,
        contentType: item.file.type || (item.kind === "pdf" ? "application/pdf" : `image/${item.kind === "jpg" ? "jpeg" : item.kind}`),
        size: item.file.size,
        productId: opts.productId,
        fieldId: field.id,
      });
      if (init.error) throw Object.assign(new Error(init.error), { code: init.error });
      let lastPct = -1;
      const onProgress = (/** @type {number} */ p) => {
        item.progress = p;
        updateProgress(item);
        if (p - lastPct >= 25 || p === 100) {
          lastPct = p;
          say(fill(strings.upload_progress, { name: item.name, percent: p }));
        }
      };
      try {
        await put(init.uploadUrl, init.headers || {}, item.file, onProgress);
      } catch {
        await put(init.uploadUrl, init.headers || {}, item.file, onProgress); // one automatic retry
      }
      const done = await postJSON(`${base}/${encodeURIComponent(init.id)}/complete`, {});
      if (!done.ok) throw Object.assign(new Error(done.error || "failed"), { code: done.error });
      item.url = done.fileUrl || init.fileUrl;
      item.status = "done";
      item.progress = 100;
      say(fill(strings.upload_done, { name: item.name }));
    } catch (err) {
      const code = /** @type {any} */ (err).code;
      item.status = "error";
      item.error =
        code === "too_large"
          ? fill(strings.upload_too_large, { size: sizeText })
          : code === "wrong_type"
            ? fill(strings.upload_wrong_type, { types: typesText(allowed, strings.or) })
            : code === "limit"
              ? fill(strings.max_files, { max: opts.maxFiles })
              : strings.upload_failed;
      say(item.error);
    }
    render();
    opts.onChange();
  }

  /** @param {Item} item */
  function updateProgress(item) {
    const bar = /** @type {HTMLProgressElement|null} */ (list.querySelector(`[data-key="${item.key}"] progress`));
    if (bar) bar.value = item.progress;
  }

  /** @param {Item} item */
  function remove(item) {
    if (item.preview && URL.revokeObjectURL) URL.revokeObjectURL(item.preview);
    items = items.filter((i) => i !== item);
    render();
    opts.onChange();
    input.focus();
  }

  function render() {
    list.textContent = "";
    for (const item of items) {
      const li = document.createElement("li");
      li.className = `shine-file shine-file--${item.status}`;
      li.dataset.key = String(item.key);
      if (item.preview) {
        const img = document.createElement("img");
        img.src = item.preview;
        img.alt = "";
        img.width = 48;
        img.height = 48;
        img.className = "shine-file__thumb";
        li.appendChild(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "shine-file__thumb shine-file__thumb--doc";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = (item.kind || "file").toUpperCase();
        li.appendChild(icon);
      }
      const body = document.createElement("div");
      body.className = "shine-file__body";
      const name = document.createElement("span");
      name.className = "shine-file__name";
      name.textContent = item.name;
      body.appendChild(name);
      if (item.status === "uploading") {
        const bar = document.createElement("progress");
        bar.max = 100;
        bar.value = item.progress;
        bar.setAttribute("aria-label", item.name);
        body.appendChild(bar);
      }
      if (item.status === "error" && item.error) {
        const err = document.createElement("span");
        err.className = "shine-file__error";
        err.textContent = item.error;
        body.appendChild(err);
      }
      li.appendChild(body);
      const actions = document.createElement("div");
      actions.className = "shine-file__actions";
      if (item.status === "error" && item.file) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "shine-file__btn";
        retry.textContent = strings.upload_retry;
        retry.addEventListener("click", () => start(item));
        actions.appendChild(retry);
      }
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "shine-file__btn";
      rm.textContent = strings.upload_remove;
      rm.setAttribute("aria-label", `${strings.upload_remove} ${item.name}`);
      rm.addEventListener("click", () => remove(item));
      actions.appendChild(rm);
      li.appendChild(actions);
      list.appendChild(li);
    }
    const full = items.filter((i) => i.status !== "error").length >= opts.maxFiles;
    input.disabled = full;
    el.classList.toggle("shine-upload--full", full);
  }

  input.addEventListener("change", () => {
    add(input.files);
    input.value = "";
  });
  if (drop) {
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-dragover");
      add(e.dataTransfer ? e.dataTransfer.files : null);
    });
  }

  return {
    /** Links of finished uploads: the field's answer. */
    urls() {
      return items.filter((i) => i.status === "done" && i.url).map((i) => /** @type {string} */ (i.url));
    },
    pending() {
      return items.some((i) => i.status === "uploading");
    },
    reset() {
      for (const i of items) if (i.preview && URL.revokeObjectURL) URL.revokeObjectURL(i.preview);
      items = [];
      say("");
      render();
    },
    /** Restore finished uploads after the theme re-renders the product form. @param {string[]} urls */
    setUrls(urls) {
      items = (urls || []).map((url) => ({
        key: ++seq,
        name: decodeURIComponent(String(url).split("?")[0].split("/").pop() || "file"),
        kind: null,
        status: /** @type {"done"} */ ("done"),
        progress: 100,
        url,
      }));
      render();
    },
  };
}
