const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  // Neutralize spreadsheet formula injection from shopper-entered text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsvGeneric(header, rows) {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n") + "\r\n";
}
