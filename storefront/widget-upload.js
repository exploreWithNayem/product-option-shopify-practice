// @ts-check
/** Upload widget, loaded only when the option set has a file field (see snippets/shine-scripts.liquid). */
import { createUploader } from "./upload.js";

const w = /** @type {any} */ (window);
(w.__shineWidgets = w.__shineWidgets || {}).upload = createUploader;
