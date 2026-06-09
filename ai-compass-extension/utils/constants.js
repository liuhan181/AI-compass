(function initConstants(root) {
  "use strict";

  const ITEM_TYPES = [
    {
      value: "goal",
      label: "本轮目标",
      markdownTitle: "1. 本轮目标",
      emptyText: "暂无本轮目标"
    },
    {
      value: "insight",
      label: "关键结论",
      markdownTitle: "2. 关键结论",
      emptyText: "暂无关键结论"
    },
    {
      value: "method",
      label: "可复用方法",
      markdownTitle: "3. 可复用方法",
      emptyText: "暂无可复用方法"
    },
    {
      value: "question",
      label: "待追问",
      markdownTitle: "4. 待追问",
      emptyText: "暂无待追问"
    },
    {
      value: "todo",
      label: "待办事项",
      markdownTitle: "5. 待办事项",
      emptyText: "暂无待办事项"
    },
    {
      value: "quote",
      label: "原文摘录",
      markdownTitle: "6. 原文摘录",
      emptyText: "暂无原文摘录"
    }
  ];

  const ITEM_TYPE_LABELS = ITEM_TYPES.reduce((labels, item) => {
    labels[item.value] = item.label;
    return labels;
  }, {});

  const SUPPORTED_HOSTS = [
    "chatgpt.com",
    "www.doubao.com",
    "doubao.com",
    "claude.ai",
    "gemini.google.com",
    "kimi.moonshot.cn"
  ];

  const DEFAULT_SETTINGS = {
    defaultItemType: "quote",
    autoOpenSidePanel: false,
    showLocateBeta: true,
    keepRichTextByDefault: true,
    onboardingDismissed: false,
    supportedHosts: SUPPORTED_HOSTS.slice()
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "";
    }

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

    return [
      date.getFullYear(),
      "-",
      pad(date.getMonth() + 1),
      "-",
      pad(date.getDate()),
      " ",
      pad(date.getHours()),
      ":",
      pad(date.getMinutes())
    ].join("");
  }

  function formatCompactTimestamp(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);

    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join("");
  }

  function sanitizeFileName(value) {
    return String(value || "AI-Compass")
      .trim()
      .replace(/[\/\\:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "AI-Compass";
  }

  const api = {
    ITEM_TYPES,
    ITEM_TYPE_LABELS,
    SUPPORTED_HOSTS,
    DEFAULT_SETTINGS,
    formatTimestamp,
    formatCompactTimestamp,
    sanitizeFileName
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
