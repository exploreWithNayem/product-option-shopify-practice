// @ts-check
/** Design layer widget, loaded only when the option set has a design layer (see snippets/shine-scripts.liquid). */
import { createLayer } from "./layer.js";

const w = /** @type {any} */ (window);
(w.__shineWidgets = w.__shineWidgets || {}).layer = createLayer;
