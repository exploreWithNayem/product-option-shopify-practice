// @ts-check
/** Date picker widget, loaded only when the option set has a date field (see snippets/shine-scripts.liquid). */
import { createDatePicker } from "./datepicker.js";

const w = /** @type {any} */ (window);
(w.__shineWidgets = w.__shineWidgets || {}).date = createDatePicker;
