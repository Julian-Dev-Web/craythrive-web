// src/utils/exportPrintUtils.js

/* =========================================================
   GENERAL HELPERS
========================================================= */

function cleanValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeCsv(value) {
  let text =
    cleanValue(value);

  // Spreadsheet applications can interpret untrusted titles/messages as formulas.
  // Preserve ordinary signed numeric readings; make formula-like text a literal.
  if (/^[=+@-]/.test(text) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
    text = `'${text}`;
  }

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n")
  ) {
    return `"${text.replaceAll(
      '"',
      '""'
    )}"`;
  }

  return text;
}

function escapeHtml(value) {
  return cleanValue(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

/* =========================================================
   CSV EXPORT
========================================================= */

export function downloadCsv(
  filename,
  rows
) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    alert(
      "No records available to export."
    );

    return;
  }

  const headers =
    Array.from(
      rows.reduce(
        (set, row) => {
          Object.keys(
            row || {}
          ).forEach(
            (key) =>
              set.add(key)
          );

          return set;
        },
        new Set()
      )
    );

  const csv = [
    headers
      .map(escapeCsv)
      .join(","),

    ...rows.map((row) =>
      headers
        .map((header) =>
          escapeCsv(
            row?.[header]
          )
        )
        .join(",")
    ),
  ].join("\n");

  const blob =
    new Blob(
      [csv],
      {
        type:
          "text/csv;charset=utf-8;",
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href = url;

  link.download =
    filename;

  document.body.appendChild(
    link
  );

  link.click();

  document.body.removeChild(
    link
  );

  URL.revokeObjectURL(
    url
  );
}

/* =========================================================
   TABLE HELPERS
========================================================= */

function getHeaders(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return [];
  }

  return Array.from(
    rows.reduce(
      (set, row) => {
        Object.keys(
          row || {}
        ).forEach(
          (key) =>
            set.add(key)
        );

        return set;
      },
      new Set()
    )
  );
}

function buildTable(
  rows,
  headers
) {
  if (
    !rows ||
    rows.length === 0
  ) {
    return `
      <div class="empty">
        No records available.
      </div>
    `;
  }

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            ${headers
              .map(
                (header) =>
                  `<th>${escapeHtml(
                    header
                  )}</th>`
              )
              .join("")}
          </tr>
        </thead>

        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${headers
                    .map(
                      (header) => `
                        <td>
                          ${formatPrintCell(header, row?.[header])}
                        </td>
                      `
                    )
                    .join("")}
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// Only monitoring condition columns get safety badges; marketplace statuses stay unchanged.
function formatPrintCell(header, value) {
  const levels = { Normal: "normal", Warning: "warning", Critical: "critical", "No Data": "neutral", "No Scan": "neutral" };
  const level = levels[value];
  if (!header.endsWith("Condition") || !level) return escapeHtml(value);
  const icon = { normal: "&#10003;", warning: "&#9888;", critical: "&#9888;", neutral: "&#8212;" }[level];
  return `<span class="condition ${level}"><span aria-hidden="true">${icon}</span> ${escapeHtml(value)}</span>`;
}

/* =========================================================
   PAGINATION HELPERS

   We create actual print pages ourselves instead of relying
   on browser page counters.

   Long rows use more "space units", so pages with long
   messages automatically receive fewer records.
========================================================= */

function getLongestCellLength(
  row
) {
  if (!row) {
    return 0;
  }

  return Math.max(
    0,
    ...Object.values(
      row
    ).map(
      (value) =>
        cleanValue(value)
          .length
    )
  );
}

function estimateRowUnits(
  row
) {
  // Wide monitoring tables wrap more cells even when their text is short.
  const minimumUnits = Object.keys(row || {}).length >= 12 ? 2 : 1;
  const longest =
    getLongestCellLength(
      row
    );

  if (longest > 260) {
    return 4;
  }

  if (longest > 170) {
    return 3;
  }

  if (longest > 90) {
    return 2;
  }

  return minimumUnits;
}

/*
 * A4 landscape has limited vertical space.
 * A page budget of 16 gives us enough room for:
 *
 * - CrayThrive report header
 * - Section title
 * - Table header
 * - Rows
 * - Page number footer
 */
const PAGE_ROW_UNIT_LIMIT =
  16;

function splitRowsIntoPages(
  rows
) {
  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    return [[]];
  }

  const pages = [];

  let currentPage = [];
  let currentUnits = 0;

  rows.forEach((row) => {
    const rowUnits =
      estimateRowUnits(
        row
      );

    if (
      currentPage.length >
        0 &&
      currentUnits +
        rowUnits >
        PAGE_ROW_UNIT_LIMIT
    ) {
      pages.push(
        currentPage
      );

      currentPage = [];
      currentUnits = 0;
    }

    currentPage.push(
      row
    );

    currentUnits +=
      rowUnits;
  });

  if (
    currentPage.length >
    0
  ) {
    pages.push(
      currentPage
    );
  }

  return pages;
}

/* =========================================================
   BUILD PRINT PAGES
========================================================= */

function buildPrintablePages(
  sections
) {
  const pages = [];

  sections.forEach(
    (
      section,
      sectionIndex
    ) => {
      const rows =
        Array.isArray(
          section?.rows
        )
          ? section.rows
          : [];

      const headers =
        getHeaders(rows);

      const rowPages =
        splitRowsIntoPages(
          rows
        );

      rowPages.forEach(
        (
          pageRows,
          sectionPageIndex
        ) => {
          pages.push({
            sectionTitle:
              section?.title ||
              `Report ${
                sectionIndex + 1
              }`,

            description:
              section
                ?.description ||
              "",

            rows:
              pageRows,

            headers,

            sectionPage:
              sectionPageIndex +
              1,

            sectionPageCount:
              rowPages.length,
          });
        }
      );
    }
  );

  return pages;
}

/* =========================================================
   REPORT HEADER
========================================================= */

function buildReportHeader({
  title,
  subtitle,
  generatedAt,
}) {
  return `
    <header class="report-header">

      <div class="brand-row">

        <div>
          <div class="brand">
            CRAYTHRIVE
          </div>

          <h1>
            ${escapeHtml(
              title
            )}
          </h1>
        </div>

        <div class="report-badge">
          REPORT
        </div>
      </div>

      ${
        subtitle
          ? `
            <div class="report-subtitle">
              <span>
                Report For
              </span>

              <strong>
                ${escapeHtml(
                  subtitle
                )}
              </strong>
            </div>
          `
          : ""
      }

      <div class="generated">
        Generated:
        ${escapeHtml(
          generatedAt
        )}
      </div>

    </header>
  `;
}

/* =========================================================
   PRINT REPORT
========================================================= */

export function printReport({
  title,
  subtitle,
  sections,
}) {
  if (
    !Array.isArray(
      sections
    ) ||
    sections.length === 0
  ) {
    alert(
      "No report sections available to print."
    );

    return;
  }

  const printableWindow =
    window.open(
      "",
      "_blank"
    );

  if (!printableWindow) {
    alert(
      "Popup blocked. Please allow popups to print this report."
    );

    return;
  }

  const printablePages =
    buildPrintablePages(
      sections
    );

  const totalPages =
    Math.max(
      printablePages.length,
      1
    );

  const generatedAt =
    new Date().toLocaleString(
      "en-PH",
      {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }
    );

  const documentTitle =
    subtitle
      ? `${title} - ${subtitle}`
      : title;

  const pagesHtml =
    printablePages
      .map(
        (
          page,
          index
        ) => {
          const pageNumber =
            index + 1;

          return `
            <article class="print-page">

              ${buildReportHeader(
                {
                  title,
                  subtitle,
                  generatedAt,
                }
              )}

              <main class="page-content">

                <section class="report-section">

                  <div class="section-heading">

                    <div>
                      <h2>
                        ${escapeHtml(
                          page.sectionTitle
                        )}
                      </h2>

                      ${
                        page.description
                          ? `
                            <p>
                              ${escapeHtml(
                                page.description
                              )}
                            </p>
                          `
                          : ""
                      }
                    </div>

                    ${
                      page.sectionPageCount >
                      1
                        ? `
                          <div class="section-page-label">
                            Part
                            ${page.sectionPage}
                            of
                            ${page.sectionPageCount}
                          </div>
                        `
                        : ""
                    }

                  </div>

                  ${buildTable(
                    page.rows,
                    page.headers
                  )}

                </section>

              </main>

              <footer class="report-footer">

                <span>
                  CrayThrive
                  ${
                    subtitle
                      ? ` • ${escapeHtml(
                          subtitle
                        )}`
                      : ""
                  }
                </span>

                <strong>
                  Page
                  ${pageNumber}
                  of
                  ${totalPages}
                </strong>

              </footer>

            </article>
          `;
        }
      )
      .join("");

  printableWindow.document.write(`
    <!doctype html>

    <html>
      <head>

        <meta charset="UTF-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />

        <title>
          ${escapeHtml(
            documentTitle
          )}
        </title>

        <style>

          /* ===============================================
             PRINT PAGE
          =============================================== */

          @page {
            size: A4 landscape;
            margin: 10mm;
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;

            color: #102a32;

            background: #ffffff;

            font-family:
              Arial,
              Helvetica,
              sans-serif;
          }

          body {
            font-size: 10px;
          }

          .print-page {
            width: 100%;
            min-height: 185mm;

            display: flex;
            flex-direction: column;

            page-break-after: always;
            break-after: page;

            background: #ffffff;
          }

          .print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          /* ===============================================
             HEADER
          =============================================== */

          .report-header {
            flex: 0 0 auto;

            padding-bottom: 12px;

            margin-bottom: 14px;

            border-bottom:
              2px solid
              #0bd1c4;
          }

          .brand-row {
            display: flex;

            align-items:
              flex-start;

            justify-content:
              space-between;

            gap: 20px;
          }

          .brand {
            margin-bottom: 5px;

            color: #0a9f97;

            font-size: 9px;
            font-weight: 800;

            letter-spacing:
              0.14em;
          }

          h1 {
            margin: 0;

            color: #102a32;

            font-size: 22px;
            line-height: 1.15;
          }

          .report-badge {
            display: inline-flex;

            align-items: center;
            justify-content: center;

            min-height: 27px;

            padding:
              0 11px;

            color: #087f78;

            border:
              1px solid
              #a9e9e3;

            border-radius:
              999px;

            background:
              #eefaf8;

            font-size: 8px;
            font-weight: 800;

            letter-spacing:
              0.1em;
          }

          .report-subtitle {
            display: flex;

            align-items: center;

            gap: 7px;

            margin-top: 9px;
          }

          .report-subtitle span {
            color: #65787e;

            font-size: 9px;
          }

          .report-subtitle strong {
            color: #102a32;

            font-size: 10px;
          }

          .generated {
            margin-top: 5px;

            color: #6a7e84;

            font-size: 8px;
          }

          /* ===============================================
             CONTENT
          =============================================== */

          .page-content {
            flex: 1 1 auto;

            min-height: 0;
          }

          .report-section {
            margin: 0;
          }

          .section-heading {
            display: flex;

            align-items:
              flex-start;

            justify-content:
              space-between;

            gap: 16px;

            margin-bottom: 10px;
          }

          h2 {
            margin:
              0 0 4px;

            color: #102a32;

            font-size: 14px;
          }

          .section-heading p {
            max-width: 720px;

            margin: 0;

            color: #5c6f76;

            font-size: 8px;
            line-height: 1.45;
          }

          .section-page-label {
            flex: 0 0 auto;

            padding:
              5px 8px;

            color: #0a817a;

            border:
              1px solid
              #c4ece8;

            border-radius:
              999px;

            background:
              #f2fbfa;

            font-size: 8px;
            font-weight: 700;
          }

          /* ===============================================
             TABLE
          =============================================== */

          .table-wrapper {
            width: 100%;
          }

          table {
            width: 100%;

            border-collapse:
              collapse;

            table-layout:
              fixed;

            font-size: 8px;
          }

          thead {
            display:
              table-header-group;
          }

          th,
          td {
            padding:
              5px 6px;

            border:
              1px solid
              #d7e5e8;

            text-align:
              left;

            vertical-align:
              top;

            overflow-wrap:
              anywhere;

            word-break:
              break-word;

            line-height: 1.35;
          }

          th {
            color: #102a32;

            background:
              #eefaf8;

            font-size: 7.5px;
            font-weight: 800;
          }

          td {
            color: #354b52;

            background:
              #ffffff;
          }

          .condition { display: inline-block; padding: 2px 3px; border: 1px solid; border-radius: 4px; font-weight: 800; }
          .condition.normal { color: #115e59; background: #ccfbf1; border-color: #0d9488; }
          .condition.warning { color: #854d0e; background: #fef3c7; border-color: #d97706; }
          .condition.critical { color: #991b1b; background: #fee2e2; border-color: #dc2626; }
          .condition.neutral { color: #475569; background: #f1f5f9; border-color: #94a3b8; }

          tbody tr:nth-child(even)
            td {
            background:
              #fbfdfd;
          }

          tr {
            break-inside:
              avoid;

            page-break-inside:
              avoid;
          }

          /* ===============================================
             EMPTY
          =============================================== */

          .empty {
            padding: 18px;

            color: #5c6f76;

            border:
              1px dashed
              #b7c8ce;

            border-radius:
              10px;

            background:
              #fbfdfd;

            text-align: center;

            font-size: 9px;
          }

          /* ===============================================
             FOOTER
          =============================================== */

          .report-footer {
            flex: 0 0 auto;

            display: flex;

            align-items: center;

            justify-content:
              space-between;

            gap: 12px;

            margin-top: 14px;

            padding-top: 8px;

            border-top:
              1px solid
              #dbe7e9;

            color: #6a7e84;

            font-size: 8px;
          }

          .report-footer span {
            overflow: hidden;

            text-overflow:
              ellipsis;

            white-space:
              nowrap;
          }

          .report-footer strong {
            flex: 0 0 auto;

            color: #102a32;

            font-size: 8px;
          }

          /* ===============================================
             SCREEN PREVIEW
          =============================================== */

          @media screen {
            body {
              padding: 20px;

              background:
                #edf3f4;
            }

            .print-page {
              max-width:
                1120px;

              min-height:
                760px;

              margin:
                0 auto 20px;

              padding: 28px;

              box-shadow:
                0 12px 40px
                rgba(
                  16,
                  42,
                  50,
                  0.12
                );
            }
          }

          /* ===============================================
             PRINT
          =============================================== */

          @media print {

            html,
            body {
              width: 100%;

              background:
                #ffffff !important;

              -webkit-print-color-adjust:
                exact;

              print-color-adjust:
                exact;
            }

            body {
              margin: 0;

              padding: 0;
            }

            .print-page {
              min-height:
                185mm;

              margin: 0;

              padding: 0;

              box-shadow: none;
            }
          }

        </style>
      </head>

      <body>

        ${pagesHtml}

        <script>
          (function () {
            function startPrint() {
              setTimeout(function () {
                window.focus();
                window.print();
              }, 250);
            }

            if (
              document.readyState ===
              "complete"
            ) {
              startPrint();
            } else {
              window.addEventListener(
                "load",
                startPrint
              );
            }
          })();
        </script>

      </body>
    </html>
  `);

  printableWindow.document.close();
}
