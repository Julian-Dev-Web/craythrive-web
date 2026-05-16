// src/utils/exportPrintUtils.js

function cleanValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function escapeCsv(value) {
  const text = cleanValue(value);

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function escapeHtml(value) {
  return cleanValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("No records available to export.");
    return;
  }

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row?.[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function buildTable(rows) {
  if (!rows || rows.length === 0) {
    return `<p class="empty">No records available.</p>`;
  }

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  return `
    <table>
      <thead>
        <tr>
          ${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                ${headers
                  .map((header) => `<td>${escapeHtml(row?.[header])}</td>`)
                  .join("")}
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

export function printReport({ title, subtitle, sections }) {
  const printableWindow = window.open("", "_blank");

  if (!printableWindow) {
    alert("Popup blocked. Please allow popups to print this report.");
    return;
  }

  const sectionHtml = sections
    .map(
      (section) => `
        <section>
          <h2>${escapeHtml(section.title)}</h2>
          ${section.description ? `<p>${escapeHtml(section.description)}</p>` : ""}
          ${buildTable(section.rows)}
        </section>
      `
    )
    .join("");

  printableWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 32px;
            color: #102a32;
            font-family: Arial, sans-serif;
            background: #ffffff;
          }

          header {
            padding-bottom: 18px;
            margin-bottom: 20px;
            border-bottom: 2px solid #0bd1c4;
          }

          h1 {
            margin: 0;
            font-size: 28px;
          }

          header p {
            margin: 8px 0 0;
            color: #5c6f76;
          }

          section {
            margin-top: 26px;
            page-break-inside: avoid;
          }

          h2 {
            margin: 0 0 10px;
            font-size: 18px;
          }

          section > p {
            margin: 0 0 12px;
            color: #5c6f76;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }

          th,
          td {
            padding: 8px;
            border: 1px solid #d9e5e8;
            text-align: left;
            vertical-align: top;
          }

          th {
            color: #102a32;
            background: #eefaf8;
            font-weight: 700;
          }

          .empty {
            padding: 14px;
            border: 1px dashed #b7c8ce;
            border-radius: 10px;
            color: #5c6f76;
          }

          @media print {
            body {
              padding: 18px;
            }

            button {
              display: none;
            }
          }
        </style>
      </head>

      <body>
        <header>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(subtitle || "")}</p>
          <p>Generated: ${new Date().toLocaleString()}</p>
        </header>

        ${sectionHtml}

        <script>
          window.onload = function () {
            window.print();
          };
        </script>
      </body>
    </html>
  `);

  printableWindow.document.close();
}