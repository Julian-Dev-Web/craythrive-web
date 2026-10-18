// Self-contained popup script: measure A4 content before opening the print dialog.
// Kept as static source so bundling cannot introduce out-of-scope references.
export const PRINT_PAGINATION_SCRIPT = String.raw`
(function () {
  var pages = document.getElementById('report-pages');
  var source = document.getElementById('report-sections-source');
  var header = document.getElementById('report-header-source');
  var ready = false;
  function paginate() {
    if (ready) return;
    document.documentElement.classList.add('paper-layout');
    function createPage(section, group, continued) {
      var page = document.createElement('section');
      page.className = 'report-page';
      page.appendChild(header.content.firstElementChild.cloneNode(true));
      var content = document.createElement('div');
      content.className = 'report-page-content';
      var part = document.createElement('section');
      part.className = 'report-section';
      part.appendChild(section.querySelector('.section-heading').cloneNode(true));
      Array.from(group.children).filter(function (node) { return node.tagName !== 'TABLE' && !node.classList.contains('record-card'); })
        .forEach(function (node) { part.appendChild(node.cloneNode(true)); });
      if (continued) {
        var notice = document.createElement('p'); notice.className = 'section-note'; notice.textContent = 'Continued'; part.appendChild(notice);
      }
      content.appendChild(part); page.appendChild(content);
      var footer = document.createElement('footer'); footer.className = 'report-footer';
      footer.innerHTML = '<span>CrayThrive</span><span class="page-number"></span>';
      page.appendChild(footer); pages.appendChild(page);
      return { page: page, content: content, part: part };
    }
    function fits(state) { return state.content.scrollHeight <= state.content.clientHeight + 1; }
    // Extremely long user-entered fields may exceed one whole sheet. Slice a
    // clone's text across continuation records, preserving all original text.
    function textPart(original, start, end) {
      var copy = original.cloneNode(true), offset = 0;
      var walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT), node;
      while ((node = walker.nextNode())) {
        var text = node.textContent;
        node.textContent = text.slice(Math.max(0, start - offset), Math.max(0, Math.min(text.length, end - offset)));
        offset += text.length;
      }
      return copy;
    }
    Array.from(source.content.children).forEach(function (section) {
      Array.from(section.querySelectorAll(':scope > .report-group')).forEach(function (group) {
        var state = createPage(section, group, false), target, count = 0;
        var table = group.querySelector(':scope > table');
        function container() {
          if (!table) return state.part;
          var copy = table.cloneNode(true); copy.querySelector('tbody').replaceChildren();
          state.part.appendChild(copy); return copy.querySelector('tbody');
        }
        function nextPage() { state = createPage(section, group, true); target = container(); count = 0; }
        target = container();
        var items = table ? Array.from(table.querySelector('tbody').children)
          : Array.from(group.children).filter(function (node) { return node.classList.contains('record-card'); });
        items.forEach(function (original) {
          var item = original.cloneNode(true); target.appendChild(item);
          if (fits(state)) { count++; return; }
          item.remove();
          if (count) nextPage();
          target.appendChild(item);
          if (fits(state)) { count++; return; }
          item.remove();
          var length = original.textContent.length, start = 0;
          while (start < length) {
            var low = 1, high = length - start, best = 0;
            while (low <= high) {
              var middle = Math.floor((low + high) / 2), probe = textPart(original, start, start + middle);
              target.appendChild(probe);
              var fitting = fits(state); probe.remove();
              if (fitting) { best = middle; low = middle + 1; } else high = middle - 1;
            }
            if (!best) throw new Error('A report record cannot fit inside the printable page.');
            target.appendChild(textPart(original, start, start + best)); start += best; count++;
            if (start < length) nextPage();
          }
        });
      });
    });
    var sheets = Array.from(pages.querySelectorAll('.report-page'));
    sheets.forEach(function (page, index) {
      page.setAttribute('aria-label', 'Page ' + (index + 1) + ' of ' + sheets.length);
      page.querySelector('.page-number').textContent = 'Page ' + (index + 1) + ' of ' + sheets.length;
    });
    ready = true; document.documentElement.classList.remove('paper-layout');
    document.documentElement.dataset.paginationReady = 'true';
  }
  function startPrint() {
    Promise.resolve(document.fonts && document.fonts.ready).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        paginate(); setTimeout(function () { window.focus(); window.print(); }, 250);
      }); });
    });
  }
  if (document.readyState === 'complete') startPrint();
  else window.addEventListener('load', startPrint, { once: true });
})();`;
