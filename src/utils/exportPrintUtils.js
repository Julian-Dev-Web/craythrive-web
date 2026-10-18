import { formatPhilippineDateTime } from './philippineTime.js';
import { PRINT_PAGINATION_SCRIPT } from './printPagination.js';
// CSV keeps complete raw field text; print uses its own readable presentation.
function cleanValue(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}
function escapeCsv(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+@-]/.test(text.trimStart()) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) text = `'${text}`;
  return /[,"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function escapeHtml(value) {
  return cleanValue(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function getHeaders(rows) {
  return [...new Set(rows.flatMap(row => Object.keys(row || {})))];
}
export function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("No records available to export.");
    return;
  }
  const headers = getHeaders(rows);
  const csv = [headers.map(escapeCsv).join(","), ...rows.map(row => headers.map(header => escapeCsv(row?.[header])).join(","))].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Let phone browsers start consuming the Blob before releasing it.
  const revoke = URL.revokeObjectURL.bind(URL);
  const cleanup = setTimeout(() => revoke(url), 60_000);
  cleanup.unref?.();
}
function formatPrintCell(header, value) {
  const levels = { Normal: "normal", Warning: "warning", Critical: "critical", "No Data": "neutral", "No Scan": "neutral", Waiting: "neutral", Unpaired: "neutral" };
  const level = levels[value];
  if ((!header.endsWith("Condition") && header !== "Priority") || !level) return escapeHtml(value);
  const icon = level === "normal" ? "&#10003;" : level === "neutral" ? "&#8212;" : "&#9888;";
  return `<span class="condition ${level}"><span aria-hidden="true">${icon}</span> ${escapeHtml(value)}</span>`;
}
function buildTable(rows, columns) {
  if (!rows.length) return '<p class="empty">No records available.</p>';
  return `<table><thead><tr>${columns.map(({ key, label = key }) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${columns.map(({ key, label = key, condition }) => `<td data-label="${escapeHtml(label)}">${formatPrintCell(key, row[key])}${condition ? `<br>${formatPrintCell(condition, row[condition])}` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function buildRecordCards(rows) {
  return rows.map(row => `<article class="record-card"><dl>${Object.entries(row).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${formatPrintCell(key, value)}</dd></div>`).join("")}</dl></article>`).join("");
}
function buildSnapshotCards(rows) {
  return rows.map(row => `<article class="record-card snapshot-card"><h3>${escapeHtml(row.Tank)}</h3>
    <p>Overall: ${formatPrintCell("Overall Condition", row["Overall Condition"])}</p><div class="snapshot-grid">
    <section><h3>Latest Sensor Reading</h3><p>Recorded: ${escapeHtml(row["Sensor Date"] || "No Data")}</p><dl>
    ${["Temperature", "pH", "Water Clarity", "Water Level"].map(key => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(row[key])}<br>${formatPrintCell(`${key} Condition`, row[`${key} Condition`])}</dd></div>`).join("")}</dl></section>
    <section><h3>Latest Available Ammonia Scan</h3><p>${escapeHtml(row.Ammonia)}</p>
    ${formatPrintCell("Ammonia Condition", row["Ammonia Condition"])}
    <p>Scanned: ${escapeHtml(row["Ammonia Scan Date"] || (row.Ammonia === "No Scan" ? "No Scan" : "Scan time unavailable"))}</p>
    <p class="section-note">Manual scan; may be older than the latest sensor reading.</p></section></div></article>`).join("");
}
function buildSection(section, index) {
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  const water = rows.filter(row => row.Type === "Water Reading");
  const ammonia = rows.filter(row => row.Type === "Ammonia Reading");
  const current = rows.filter(row => row.Type === "Current Tank Status");
  const other = rows.filter(row => !["Water Reading", "Ammonia Reading", "Current Tank Status"].includes(row.Type));
  let content = "";
  if (current.length) content += current.map(row => `<div class="report-group">${buildSnapshotCards([row])}</div>`).join('');
  const history = section?.kind === "monitoring-history" || water.length || ammonia.length;
  if (history) content += `<div class="report-group"><h3>Water Readings</h3>${buildTable(water, [
    { key: "Date" }, { key: "Tank" },
    { key: "Temperature", condition: "Temperature Condition" },
    { key: "pH", condition: "pH Condition" },
    { key: "Water Clarity", condition: "Water Clarity Condition" },
    { key: "Water Level", condition: "Water Level Condition" },
    { key: "Overall Condition", label: "Overall" },
  ])}</div>`;
  if (history) content += `<div class="report-group"><h3>Ammonia Scans</h3><p class="section-note">Manual ammonia readings keep their own scan timestamps; scans are separate from water reading history.</p>${ammonia.length ? buildTable(ammonia, [
    { key: "Date" }, { key: "Tank" }, { key: "Ammonia" }, { key: "Ammonia Condition", label: "Condition" },
  ]) : `<p class="empty">No Scan — ${escapeHtml(section?.ammoniaEmptyMessage || "No ammonia scan recorded during this period.")}</p>`}</div>`;
  if (other.length) {
    // Separate listings and orders to avoid sparse, wide union tables.
    for (const group of [...new Set(other.map(row => row.Type || "Records"))]) {
      const groupRows = other.filter(row => (row.Type || "Records") === group);
      const headers = getHeaders(groupRows);
      content += `<div class="report-group"><h3>${escapeHtml(group)}</h3>`;
      content += headers.length > 7 || groupRows.some(row => "Message" in row)
        ? buildRecordCards(groupRows)
        : buildTable(groupRows, headers.map(key => ({ key })));
      content += '</div>';
    }
  }
  if (!rows.length && !history) content = '<div class="report-group"><p class="empty">No records available for this selection.</p></div>';
  return `<section class="report-section"><div class="section-heading"><h2>${escapeHtml(section?.title || `Report ${index + 1}`)}</h2>${section?.description ? `<p>${escapeHtml(section.description)}</p>` : ""}</div>${content}</section>`;
}
// Browser pagination uses actual rendered row heights, including long names.
// CSV fields and evaluated statuses remain unchanged; only print presentation changes.
export function buildPrintableReport({ title, subtitle, sections, generatedAt: serverTimestamp }) {
  const generatedAt = formatPhilippineDateTime(serverTimestamp, {}, 'Server time unavailable');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subtitle ? `${title} - ${subtitle}` : title)}</title>
    <style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; color: #172c32; font-family: Arial, Helvetica, sans-serif; color-scheme: light; }
      body { font-size: 10pt; line-height: 1.4; }
      .print-report { width: 100%; overflow-wrap: anywhere; }
      .report-page { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: 210mm; height: 297mm; padding: 12mm; background: #fff; break-after: page; page-break-after: always; }
      .report-page:last-child { break-after: auto; page-break-after: auto; }
      .report-page-content { min-height: 0; }
      .report-header { border-bottom: 2px solid #11877e; padding-bottom: 12px; margin-bottom: 18px; }
      .brand { color: #14665f; font-size: 10pt; font-weight: bold; letter-spacing: .1em; }
      h1 { font-size: 20pt; line-height: 1.2; margin: 6px 0 10px; }
      .report-subtitle, .generated { margin-top: 5px; }
      .generated, .section-note, .section-heading p { color: #465b62; }
      h2 { font-size: 14pt; margin: 0 0 6px; }
      h3 { font-size: 11pt; margin: 18px 0 8px; break-after: avoid; page-break-after: avoid; }
      .report-section { margin-bottom: 24px; }
      .section-heading { break-inside: avoid; break-after: avoid; page-break-after: avoid; }
      .section-heading p, .section-note { margin: 0 0 10px; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
      th, td { border: 1px solid #b8c6ca; padding: 7px 5px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #f0f5f5; font-weight: bold; }
      thead { display: table-header-group; }
      tr, .record-card { break-inside: avoid; page-break-inside: avoid; }
      .condition { display: inline-block; margin-top: 3px; font-weight: bold; font-size: 9pt; }
      .normal { color: #176357; } .warning { color: #875100; } .critical { color: #a51d30; } .neutral { color: #52636b; }
      .empty { border: 1px dashed #b8c6ca; padding: 12px; color: #465b62; }
      .record-card { border: 1px solid #b8c6ca; padding: 10px; margin: 8px 0; }
      dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 0; }
      .snapshot-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .snapshot-card h3 { margin-top: 4px; }
      dt { color: #465b62; font-size: 9pt; } dd { margin: 2px 0 0; }
      .report-footer { display: flex; justify-content: space-between; gap: 12px; border-top: 1px solid #b8c6ca; padding-top: 8px; color: #465b62; font-size: 9pt; }
      .print-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 auto 12px; max-width: 186mm; }
      .print-actions button { min-height: 44px; padding: 8px 16px; border: 1px solid #b8c6ca; border-radius: 8px; background: #fff; color: #172c32; font: inherit; cursor: pointer; }
      @media screen {
        body { padding: 16px; background: #edf3f4; }
        .print-report { max-width: 210mm; margin: 0 auto; }
        .report-page { margin: 0 auto 16px; box-shadow: 0 4px 20px #172c321a; }
      }
      @media screen and (max-width: 600px) {
        body { padding: 10px; }
        html:not(.paper-layout) .report-page { width: 100%; height: auto; min-height: 0; padding: 14px; }
        html:not(.paper-layout) table, html:not(.paper-layout) tbody, html:not(.paper-layout) tr, html:not(.paper-layout) td { display: block; }
        html:not(.paper-layout) thead { display: none; }
        html:not(.paper-layout) tr { margin-bottom: 12px; border: 1px solid #b8c6ca; }
        html:not(.paper-layout) td { border: 0; border-bottom: 1px solid #edf3f4; }
        html:not(.paper-layout) td::before { content: attr(data-label); display: block; font-weight: bold; color: #465b62; }
        html:not(.paper-layout) dl, html:not(.paper-layout) .snapshot-grid { grid-template-columns: minmax(0, 1fr); }
      }
      .paper-layout .print-report { width: 210mm; max-width: 210mm; }
      @media print {
        html, body { background: #fff !important; }
        .print-report { max-width: none; margin: 0; padding: 0; box-shadow: none; }
        .print-actions { display: none; }
        .report-page { margin: 0; box-shadow: none; }
        .report-section:last-of-type { margin-bottom: 0; }
      }
    </style></head><body>
    <div class="print-actions"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
    <template id="report-header-source"><header class="report-header"><div class="brand">CRAYTHRIVE</div><h1>${escapeHtml(title)}</h1>
    ${subtitle ? `<div class="report-subtitle">Report For: <strong>${escapeHtml(subtitle)}</strong></div>` : ""}
    <div class="generated">Generated: ${escapeHtml(generatedAt)}</div></header></template>
    <template id="report-sections-source">${sections.map(buildSection).join("")}</template>
    <main class="print-report" id="report-pages"></main>
    <script>${PRINT_PAGINATION_SCRIPT}</script></body></html>`;
}
export function printReport(report) {
  if (!Array.isArray(report.sections) || !report.sections.length) {
    alert("No report sections available to print.");
    return;
  }
  // Open synchronously during the click to retain browser user activation.
  const printableWindow = window.open("", "_blank");
  if (!printableWindow) {
    alert("Popup blocked. Please allow popups to print this report.");
    return;
  }
  printableWindow.document.write(buildPrintableReport(report));
  printableWindow.document.close();
}
