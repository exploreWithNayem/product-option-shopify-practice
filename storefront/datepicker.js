// @ts-check
/**
 * Accessible calendar for date fields (PRD F10, screen B3).
 * Keyboard: arrows move by day/week, Home/End to week edges, PageUp/PageDown by month,
 * Enter/Space picks, Escape closes. Unavailable days stay focusable but can't be picked.
 */
import { dateIssue, dayNumber, earliestDate, isoFromDay } from "../shared/options-core.js";
import { fill } from "./format.js";

/**
 * @param {HTMLElement} el  the field element
 * @param {any} field
 * @param {{ today: string, locale: string, strings: Record<string,string>, onChange: () => void }} opts
 */
export function createDatePicker(el, field, opts) {
  const toggle = /** @type {HTMLButtonElement} */ (el.querySelector("[data-shine-date-toggle]"));
  const out = el.querySelector("[data-shine-date-value]");
  const note = el.querySelector("[data-shine-date-note]");
  const cal = /** @type {HTMLElement} */ (el.querySelector("[data-shine-calendar]"));
  const { today, locale, strings } = opts;
  const UTC = { timeZone: "UTC" };
  const fmt = (/** @type {Intl.DateTimeFormatOptions} */ o) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...o, ...UTC });
    } catch {
      return new Intl.DateTimeFormat(undefined, { ...o, ...UTC });
    }
  };
  const longFmt = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortFmt = fmt({ day: "numeric", month: "long", year: "numeric" });
  const monthFmt = fmt({ month: "long", year: "numeric" });
  const dayNameFmt = fmt({ weekday: "short" });
  const toDate = (/** @type {number} */ d) => new Date(d * 86400000);

  let value = "";
  const first = earliestDate(field, today);
  let focusDay = dayNumber(first || today);
  if (Number.isNaN(focusDay)) focusDay = Math.floor(Date.now() / 86400000);

  if (note) note.textContent = first ? fill(strings.date_note, { date: shortFmt.format(toDate(dayNumber(first))) }) : "";

  const disabled = (/** @type {number} */ d) => !!dateIssue(field, isoFromDay(d), today);

  function render() {
    const f = toDate(focusDay);
    const y = f.getUTCFullYear();
    const m = f.getUTCMonth();
    const firstOfMonth = Math.floor(Date.UTC(y, m, 1) / 86400000);
    const startDow = toDate(firstOfMonth).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    cal.textContent = "";

    const head = document.createElement("div");
    head.className = "shine-cal__head";
    const prev = button("shine-cal__nav", "‹", strings.date_prev, () => move(-monthLen(-1)));
    const next = button("shine-cal__nav", "›", strings.date_next, () => move(monthLen(1)));
    const caption = document.createElement("p");
    caption.className = "shine-cal__caption";
    caption.setAttribute("aria-live", "polite");
    caption.id = `${cal.id}-caption`;
    caption.textContent = monthFmt.format(f);
    head.append(prev, caption, next);

    const table = document.createElement("table");
    table.className = "shine-cal__grid";
    table.setAttribute("role", "grid");
    table.setAttribute("aria-labelledby", caption.id);
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (let i = 0; i < 7; i++) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = dayNameFmt.format(toDate(3 + i)); // 1970-01-04 is a Sunday
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    const tbody = document.createElement("tbody");
    let row = document.createElement("tr");
    for (let i = 0; i < startDow; i++) row.appendChild(document.createElement("td"));
    for (let n = 1; n <= daysInMonth; n++) {
      const d = firstOfMonth + n - 1;
      const td = document.createElement("td");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shine-cal__day";
      b.textContent = String(n);
      b.dataset.day = String(d);
      b.setAttribute("aria-label", longFmt.format(toDate(d)));
      b.tabIndex = d === focusDay ? 0 : -1;
      if (disabled(d)) b.setAttribute("aria-disabled", "true");
      if (isoFromDay(d) === value) b.setAttribute("aria-pressed", "true");
      if (isoFromDay(d) === today) b.setAttribute("aria-current", "date");
      td.appendChild(b);
      row.appendChild(td);
      if ((startDow + n) % 7 === 0) {
        tbody.appendChild(row);
        row = document.createElement("tr");
      }
    }
    if (row.children.length) tbody.appendChild(row);
    table.append(thead, tbody);
    cal.append(head, table);
  }

  /** @param {number} delta */
  function monthLen(delta) {
    const f = toDate(focusDay);
    const target = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + delta, 1));
    const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(f.getUTCDate(), dim);
    return Math.floor(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), day) / 86400000) - focusDay;
  }

  /** @param {string} cls @param {string} text @param {string} label @param {() => void} onClick */
  function button(cls, text, label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  /** @param {number} delta */
  function move(delta, focus = true) {
    focusDay += delta;
    render();
    if (focus) focusCurrent();
  }

  function focusCurrent() {
    const b = /** @type {HTMLElement|null} */ (cal.querySelector(`[data-day="${focusDay}"]`));
    if (b) b.focus();
  }

  function open() {
    const v = dayNumber(value);
    if (!Number.isNaN(v)) focusDay = v;
    render();
    cal.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    focusCurrent();
  }

  function close(returnFocus = true) {
    cal.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  }

  /** @param {string} iso */
  function set(iso) {
    value = iso || "";
    const d = dayNumber(value);
    if (out) out.textContent = value && !Number.isNaN(d) ? longFmt.format(toDate(d)) : strings.date_choose;
    el.dataset.value = value;
  }

  toggle.addEventListener("click", () => (cal.hidden ? open() : close()));

  cal.addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest?.("[data-day]");
    if (!b) return;
    const d = Number(/** @type {HTMLElement} */ (b).dataset.day);
    focusDay = d;
    if (b.getAttribute("aria-disabled") === "true") {
      render();
      focusCurrent();
      return;
    }
    set(isoFromDay(d));
    close();
    opts.onChange();
  });

  cal.addEventListener("keydown", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (!target.dataset || !target.dataset.day) return;
    const dow = toDate(focusDay).getUTCDay();
    /** @type {Record<string, number>} */
    const moves = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -dow,
      End: 6 - dow,
      PageUp: monthLen(-1),
      PageDown: monthLen(1),
    };
    if (e.key in moves) {
      e.preventDefault();
      move(moves[e.key]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      target.click();
    }
  });

  document.addEventListener("click", (e) => {
    if (cal.hidden) return;
    // composedPath is fixed at dispatch, so days re-rendered by this click still count as inside.
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(el) || el.contains(/** @type {Node} */ (e.target))) return;
    close(false);
  });

  set("");
  return {
    get value() {
      return value;
    },
    set,
    reset() {
      set("");
    },
  };
}
