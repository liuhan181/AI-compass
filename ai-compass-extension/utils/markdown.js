(function initMarkdown(root) {
  "use strict";

  const compass = root.AICompass || {};
  const ITEM_TYPES = compass.ITEM_TYPES || require("./constants.js").ITEM_TYPES;
  const formatTimestamp = compass.formatTimestamp || require("./constants.js").formatTimestamp;
  const formatCompactTimestamp = compass.formatCompactTimestamp || require("./constants.js").formatCompactTimestamp;
  const sanitizeFileName = compass.sanitizeFileName || require("./constants.js").sanitizeFileName;

  function normalizeContent(content) {
    return String(content || "").trim();
  }

  function getAttachmentFileName(item, attachment, index) {
    const safeItemId = sanitizeFileName(item.id || `item-${index + 1}`).slice(0, 48) || `item-${index + 1}`;
    const extension = attachment.extension || String(attachment.name || "").split(".").pop() || "png";

    return `${safeItemId}-image-${index + 1}.${extension}`;
  }

  function getAttachmentMarkdownPath(item, attachment, index, assetDir) {
    return `${assetDir || "assets"}/${getAttachmentFileName(item, attachment, index)}`;
  }

  function renderAttachmentReferences(item, assetDir) {
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];

    if (!attachments.length) {
      return "";
    }

    return attachments.map((attachment, index) => {
      const alt = sanitizeFileName(attachment.name || `图片 ${index + 1}`) || `图片 ${index + 1}`;
      return `![${alt}](${getAttachmentMarkdownPath(item, attachment, index, assetDir)})`;
    }).join("\n");
  }

  function renderItemForMarkdown(type, content) {
    const text = normalizeContent(content);

    if (!text) {
      return type === "quote" ? "> （暂无内容）" : "- （暂无内容）";
    }

    if (type === "question" || type === "todo") {
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- [ ] ${line}`)
        .join("\n");
    }

    if (type === "quote") {
      return text
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }

    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
  }

  function renderItemWithAttachments(type, item, assetDir) {
    const body = renderItemForMarkdown(type, item.content);
    const attachments = renderAttachmentReferences(item, assetDir);

    return attachments ? `${body}\n\n${attachments}` : body;
  }

  function renderSection(type, items, assetDir) {
    const sectionItems = items.filter((item) => item.type === type.value);
    const body = sectionItems.length
      ? sectionItems.map((item) => renderItemWithAttachments(type.value, item, assetDir)).join("\n\n")
      : renderItemForMarkdown(type.value, "");

    return `## ${type.markdownTitle}\n\n${body}`;
  }

  function renderRelatedItemsSummary(items) {
    const relatedItems = items.filter((item) => item.relationType && item.relationType !== "standalone");

    if (!relatedItems.length) {
      return "- 暂无相关内容关系";
    }

    return relatedItems.map((item) => {
      const label = compass.RELATION_LABELS && compass.RELATION_LABELS[item.relationType]
        ? compass.RELATION_LABELS[item.relationType]
        : "相关内容";
      const preview = normalizeContent(item.content).split("\n").join(" ").slice(0, 80);

      return `- ${label}：${preview || "（暂无内容）"}`;
    }).join("\n");
  }

  function buildMarkdown(session, exportedAtInput, options) {
    const exportedAt = exportedAtInput || Date.now();
    const assetDir = options && options.assetDir ? options.assetDir : "assets";
    const items = Array.isArray(session.items) ? session.items : [];
    const header = [
      `# AI Compass 记录：${session.title || "AI Chat 记录"}`,
      "",
      `来源站点：${session.siteName || "AI Chat"}  `,
      `导出时间：${formatTimestamp(exportedAt)}`,
      "",
      "---",
      ""
    ].join("\n");

    const sections = ITEM_TYPES.map((type) => renderSection(type, items, assetDir)).join("\n\n");

    return [
      header,
      sections,
      "",
      "## 7. 相关内容关系",
      "",
      renderRelatedItemsSummary(items),
      "",
      "---",
      "",
      "## 8. 我的补充判断",
      "",
      "> 可在这里继续补充自己的理解、判断和后续动作。",
      ""
    ].join("\n");
  }

  function buildMarkdownFileName({ siteName, title, exportedAt }) {
    const date = exportedAt instanceof Date ? exportedAt : new Date(exportedAt || Date.now());
    const parts = [
      "AI-Compass",
      sanitizeFileName(title || "AI-Chat-记录"),
      formatCompactTimestamp(date)
    ];

    return `${parts.join("-")}.md`;
  }

  const api = {
    buildMarkdown,
    buildMarkdownFileName,
    getAttachmentFileName,
    getAttachmentMarkdownPath,
    renderItemForMarkdown
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
