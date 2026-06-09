(function initSiteAdapters(root) {
  "use strict";

  function getUrlParts(urlLike) {
    try {
      return new URL(urlLike || root.location.href);
    } catch (error) {
      return new URL("https://example.invalid/");
    }
  }

  function getSessionKeyFromUrl(urlLike) {
    const url = getUrlParts(urlLike);
    return `${url.origin}${url.pathname}`;
  }

  function getPathSegment(urlLike, marker) {
    const url = getUrlParts(urlLike);
    const parts = url.pathname.split("/").filter(Boolean);
    const index = parts.indexOf(marker);

    return index >= 0 && parts[index + 1] ? parts[index + 1] : "";
  }

  function getConversationIdFromUrl(urlLike) {
    const adapter = getSiteAdapterForUrl(urlLike);

    if (adapter && typeof adapter.getConversationId === "function") {
      return adapter.getConversationId(urlLike);
    }

    return getSessionKeyFromUrl(urlLike);
  }

  function getTitle(fallback) {
    const title = root.document && root.document.title ? root.document.title.trim() : "";
    return title || fallback;
  }

  const SITE_ADAPTERS = {
    chatgpt: {
      id: "chatgpt",
      name: "ChatGPT",
      matches: ["chatgpt.com"],
      getConversationId: (url) => getPathSegment(url, "c") || getSessionKeyFromUrl(url),
      getSessionKey: () => getSessionKeyFromUrl(root.location.href),
      getSessionTitle: () => getTitle("ChatGPT 对话"),
      floatingButtonPosition: {
        bottom: "96px",
        right: "24px"
      }
    },
    doubao: {
      id: "doubao",
      name: "豆包",
      matches: ["www.doubao.com", "doubao.com"],
      getConversationId: (url) => getPathSegment(url, "chat") || getSessionKeyFromUrl(url),
      getSessionKey: () => getSessionKeyFromUrl(root.location.href),
      getSessionTitle: () => getTitle("豆包对话"),
      floatingButtonPosition: {
        bottom: "96px",
        right: "24px"
      }
    },
    claude: {
      id: "claude",
      name: "Claude",
      matches: ["claude.ai"],
      getConversationId: (url) => getPathSegment(url, "chat") || getSessionKeyFromUrl(url),
      getSessionKey: () => getSessionKeyFromUrl(root.location.href),
      getSessionTitle: () => getTitle("Claude 对话"),
      floatingButtonPosition: {
        bottom: "96px",
        right: "24px"
      }
    },
    gemini: {
      id: "gemini",
      name: "Gemini",
      matches: ["gemini.google.com"],
      getConversationId: (url) => getPathSegment(url, "app") || getSessionKeyFromUrl(url),
      getSessionKey: () => getSessionKeyFromUrl(root.location.href),
      getSessionTitle: () => getTitle("Gemini 对话"),
      floatingButtonPosition: {
        bottom: "96px",
        right: "24px"
      }
    },
    kimi: {
      id: "kimi",
      name: "Kimi",
      matches: ["kimi.moonshot.cn"],
      getConversationId: (url) => getPathSegment(url, "chat") || getSessionKeyFromUrl(url),
      getSessionKey: () => getSessionKeyFromUrl(root.location.href),
      getSessionTitle: () => getTitle("Kimi 对话"),
      floatingButtonPosition: {
        bottom: "96px",
        right: "24px"
      }
    }
  };

  function matchesAdapter(adapter, hostname) {
    return adapter.matches.some((match) => hostname === match || hostname.endsWith(`.${match}`));
  }

  function getSiteAdapterForUrl(urlLike) {
    const url = getUrlParts(urlLike);
    return Object.values(SITE_ADAPTERS).find((adapter) => matchesAdapter(adapter, url.hostname)) || null;
  }

  function getCurrentSiteAdapter() {
    return getSiteAdapterForUrl(root.location && root.location.href);
  }

  const api = {
    SITE_ADAPTERS,
    getConversationIdFromUrl,
    getSessionKeyFromUrl,
    getSiteAdapterForUrl,
    getCurrentSiteAdapter
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
