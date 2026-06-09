(function initPreview(root) {
  "use strict";

  const RAW_TEXT_TAGS = new Set(["code", "pre"]);
  const BLOCK_TAGS = new Set([
    "p",
    "pre",
    "code",
    "blockquote",
    "ul",
    "ol",
    "li",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "br",
    "a"
  ]);
  const VOID_TAGS = new Set(["br"]);
  const ALLOWED_ATTRS = {
    a: ["href", "title"],
    code: ["class"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"]
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/'/g, "&#39;");
  }

  function decodeHtmlEntities(value) {
    const named = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
      nbsp: " "
    };

    return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      const key = entity.toLowerCase();

      if (key[0] === "#") {
        const isHex = key[1] === "x";
        const code = parseInt(isHex ? key.slice(2) : key.slice(1), isHex ? 16 : 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }

      return Object.prototype.hasOwnProperty.call(named, key) ? named[key] : match;
    });
  }

  function stripTags(value) {
    return decodeHtmlEntities(String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTableHtmlBlocks(html) {
    return String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
  }

  function extractTableRows(tableHtml) {
    const rowMatches = String(tableHtml || "").match(/<tr[\s\S]*?<\/tr>/gi) || [];

    return rowMatches
      .map((row) => {
        const cells = [];
        const cellPattern = /<(t[dh])\b[\s\S]*?>([\s\S]*?)<\/\1>/gi;
        let match = cellPattern.exec(row);

        while (match) {
          cells.push(stripTags(match[2]));
          match = cellPattern.exec(row);
        }

        return cells.filter((cell) => cell.length > 0);
      })
      .filter((row) => row.length > 0);
  }

  function escapeMarkdownTableCell(value) {
    return String(value || "").replace(/\|/g, "\\|").trim();
  }

  function tableRowsToMarkdown(rows) {
    if (!rows.length) {
      return "";
    }

    const width = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => {
      const next = row.slice();
      while (next.length < width) {
        next.push("");
      }
      return next;
    });
    const header = normalizedRows[0];
    const body = normalizedRows.slice(1);
    const divider = new Array(width).fill("---");

    return [
      `| ${header.map(escapeMarkdownTableCell).join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...body.map((row) => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`)
    ].join("\n");
  }

  function richHtmlToMarkdownText(fallbackText, html) {
    const tables = getTableHtmlBlocks(html);

    if (!tables.length) {
      return String(fallbackText || "").trim();
    }

    const tableMarkdown = tables
      .map((table) => tableRowsToMarkdown(extractTableRows(table)))
      .filter(Boolean)
      .join("\n\n");

    return tableMarkdown || String(fallbackText || "").trim();
  }

  function uniquePush(values, value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();

    if (normalized.length >= 2 && !values.includes(normalized)) {
      values.push(normalized);
    }
  }

  function normalizeLocatorSnippet(value) {
    return String(value || "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}[-*+]\s+/gm, "")
      .replace(/^\s{0,3}\d+\.\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/\*\*/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^\s*\|/gm, "")
      .replace(/\|\s*$/gm, "")
      .replace(/\s*\|\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractLocatorSnippets(text, html) {
    const snippets = [];
    const normalizedText = normalizeLocatorSnippet(text);

    uniquePush(snippets, normalizedText.slice(0, 160));

    String(text || "")
      .split(/[\n。；;.!?？|]/)
      .map(normalizeLocatorSnippet)
      .map((part) => part.trim())
      .filter((part) => part.length >= 6)
      .slice(0, 8)
      .forEach((part) => {
        uniquePush(snippets, part.slice(0, 120));
        uniquePush(snippets, part.replace(/[：:，,。；;.!?？]+$/, "").slice(0, 120));
      });

    getTableHtmlBlocks(html).forEach((table) => {
      extractTableRows(table).forEach((row) => {
        row.forEach((cell) => uniquePush(snippets, cell.slice(0, 120)));
      });
    });

    return snippets.slice(0, 24);
  }

  function isSafeHref(value) {
    return /^(https?:|mailto:|#)/i.test(String(value || "").trim());
  }

  function sanitizeAttribute(tagName, name, value) {
    const allowed = ALLOWED_ATTRS[tagName] || [];

    if (!allowed.includes(name)) {
      return "";
    }

    if (name === "href" && !isSafeHref(value)) {
      return "";
    }

    if ((name === "colspan" || name === "rowspan") && !/^[1-9][0-9]?$/.test(String(value))) {
      return "";
    }

    if (name === "class" && tagName === "code") {
      const safeClass = String(value)
        .split(/\s+/)
        .filter((part) => /^language-[a-z0-9_-]+$/i.test(part))
        .join(" ");

      return safeClass ? ` class="${escapeAttribute(safeClass)}"` : "";
    }

    return ` ${name}="${escapeAttribute(value)}"`;
  }

  function looksLikeMarkdown(text) {
    const value = String(text || "");

    return /(^|\n)```/.test(value)
      || /(^|\n)\s{0,3}#{1,6}\s+\S/.test(value)
      || /(^|\n)\s*[-*+]\s+\S/.test(value)
      || /(^|\n)\s*\d+\.\s+\S/.test(value)
      || /(^|\n)\s*>\s+\S/.test(value)
      || /\|.+\|\n\|[\s:-]+\|/.test(value)
      || /`[^`]+`/.test(value)
      || /\*\*[^*]+\*\*/.test(value);
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

    return html;
  }

  function parseTable(lines, startIndex) {
    const header = lines[startIndex];
    const divider = lines[startIndex + 1];

    if (!header || !divider || !/^\s*\|?.+\|.+\|?\s*$/.test(header) || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider)) {
      return null;
    }

    const rows = [];
    let index = startIndex + 2;

    while (index < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[index])) {
      rows.push(lines[index]);
      index += 1;
    }

    function cells(line) {
      return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    }

    const headerCells = cells(header);
    const body = rows.map(cells);

    return {
      html: [
        "<table>",
        "<thead><tr>",
        headerCells.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join(""),
        "</tr></thead>",
        "<tbody>",
        body.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join(""),
        "</tbody>",
        "</table>"
      ].join(""),
      nextIndex: index
    };
  }

  function markdownToSafeHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const fence = line.match(/^\s*```([a-z0-9_-]+)?\s*$/i);
      if (fence) {
        const codeLines = [];
        index += 1;

        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          codeLines.push(lines[index]);
          index += 1;
        }

        if (index < lines.length) {
          index += 1;
        }

        const languageClass = fence[1] ? ` class="language-${escapeAttribute(fence[1].toLowerCase())}"` : "";
        html.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        continue;
      }

      const table = parseTable(lines, index);
      if (table) {
        html.push(table.html);
        index = table.nextIndex;
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];

        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
          index += 1;
        }

        html.push(`<blockquote>${quoteLines.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered) {
        const items = [];

        while (index < lines.length) {
          const match = lines[index].match(/^\s*[-*+]\s+(.+)$/);
          if (!match) {
            break;
          }
          items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
          index += 1;
        }

        html.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ordered) {
        const items = [];

        while (index < lines.length) {
          const match = lines[index].match(/^\s*\d+\.\s+(.+)$/);
          if (!match) {
            break;
          }
          items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
          index += 1;
        }

        html.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      const paragraph = [];
      while (index < lines.length && lines[index].trim()) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return html.join("");
  }

  function sanitizeHtmlNodeLike(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === 3) {
      return escapeHtml(node.nodeValue || "");
    }

    if (node.nodeType === 11 || node.nodeType === 9) {
      return Array.from(node.childNodes || []).map(sanitizeHtmlNodeLike).join("");
    }

    if (node.nodeType !== 1) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();

    if (tagName === "script" || tagName === "style" || tagName === "iframe" || tagName === "object") {
      return "";
    }

    const children = Array.from(node.childNodes || []).map(sanitizeHtmlNodeLike).join("");

    if (!BLOCK_TAGS.has(tagName)) {
      return children;
    }

    const attrs = Array.from(node.attributes || [])
      .map((attr) => sanitizeAttribute(tagName, attr.name.toLowerCase(), attr.value))
      .join("");

    if (VOID_TAGS.has(tagName)) {
      return `<${tagName}${attrs}>`;
    }

    return `<${tagName}${attrs}>${RAW_TEXT_TAGS.has(tagName) ? children : children}</${tagName}>`;
  }

  function normalizeRichHtml(html) {
    if (!String(html || "").trim()) {
      return "";
    }

    if (typeof root.DOMParser !== "undefined") {
      const doc = new root.DOMParser().parseFromString(String(html), "text/html");
      return Array.from(doc.body.childNodes).map(sanitizeHtmlNodeLike).join("");
    }

    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+="[^"]*"/gi, "")
      .replace(/\son[a-z]+='[^']*'/gi, "");
  }

  function appendSafeHtml(container, html) {
    const normalized = normalizeRichHtml(html);

    if (!normalized || typeof root.DOMParser === "undefined") {
      container.textContent = normalized || "";
      return;
    }

    const doc = new root.DOMParser().parseFromString(normalized, "text/html");
    container.replaceChildren();
    Array.from(doc.body.childNodes).forEach((node) => {
      container.appendChild(document.importNode(node, true));
    });
  }

  const api = {
    escapeHtml,
    extractLocatorSnippets,
    richHtmlToMarkdownText,
    looksLikeMarkdown,
    markdownToSafeHtml,
    normalizeRichHtml,
    appendSafeHtml
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
