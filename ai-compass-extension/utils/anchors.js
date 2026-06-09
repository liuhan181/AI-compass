(function initAnchors(root) {
  "use strict";

  const compass = root.AICompass || {};

  function getUrl(urlInput) {
    try {
      return new URL(urlInput || root.location.href);
    } catch (error) {
      return new URL("https://example.invalid/");
    }
  }

  function getElementFromSelection(selection) {
    if (!selection || !selection.rangeCount) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;

    return node && node.nodeType === 1 ? node : node && node.parentElement ? node.parentElement : null;
  }

  function getMessageContainer(element) {
    if (!element || !element.closest) {
      return null;
    }

    return element.closest([
      "[data-message-id]",
      "[data-testid*='conversation-turn']",
      "[data-testid*='message']",
      "[data-message-author-role]",
      "[data-turn-id]",
      "article",
      "section",
      "li"
    ].join(", "));
  }

  function getStableTurnId(element) {
    if (!element) {
      return "";
    }

    const attrs = [
      "data-message-id",
      "data-turn-id",
      "data-testid",
      "data-id"
    ];

    for (const attr of attrs) {
      const value = element.getAttribute && element.getAttribute(attr);
      if (value) {
        return value;
      }
    }

    return element.id || "";
  }

  function getTurnIndex(container) {
    if (!container || !container.ownerDocument) {
      return undefined;
    }

    const selector = [
      "[data-message-id]",
      "[data-testid*='conversation-turn']",
      "[data-testid*='message']",
      "[data-message-author-role]",
      "[data-turn-id]",
      "article"
    ].join(", ");
    const nodes = Array.from(container.ownerDocument.body.querySelectorAll(selector));
    const index = nodes.indexOf(container);

    return index >= 0 ? index : undefined;
  }

  function getConversationId(adapter, url) {
    if (adapter && typeof adapter.getConversationId === "function") {
      return adapter.getConversationId(url);
    }

    return compass.getConversationIdFromUrl ? compass.getConversationIdFromUrl(url) : "";
  }

  function buildTurnAnchor(selection, adapter, page) {
    const pageInfo = page || {};
    const url = pageInfo.url || (root.location && root.location.href) || "";
    const urlParts = getUrl(url);
    const element = getElementFromSelection(selection);
    const index = pageInfo.conversationIndex || null;
    const indexedMessage = compass.findIndexedMessageForSelection && index
      ? compass.findIndexedMessageForSelection(selection, index)
      : null;
    const indexedBlock = compass.findIndexedBlockForSelection && indexedMessage
      ? compass.findIndexedBlockForSelection(selection, indexedMessage)
      : null;
    const container = getMessageContainer(element);
    const sessionKey = compass.getSessionKeyFromUrl
      ? compass.getSessionKeyFromUrl(url)
      : `${urlParts.origin}${urlParts.pathname}`;
    const anchorContainer = indexedMessage ? indexedMessage.element : container;
    const turnId = indexedMessage ? indexedMessage.messageId : getStableTurnId(container);
    const turnIndex = indexedMessage ? indexedMessage.turnIndex : getTurnIndex(container);
    const rect = anchorContainer && anchorContainer.getBoundingClientRect ? anchorContainer.getBoundingClientRect() : null;
    const hasV2Anchor = Boolean(indexedMessage);

    return {
      anchorVersion: hasV2Anchor ? 2 : undefined,
      siteId: adapter && adapter.id ? adapter.id : "",
      conversationId: getConversationId(adapter, url),
      sessionKey,
      turnId,
      turnIndex,
      turnSummary: anchorContainer ? String(anchorContainer.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) : "",
      offsetTop: rect ? rect.top + (root.scrollY || 0) : undefined,
      offsetBottom: rect ? rect.bottom + (root.scrollY || 0) : undefined,
      anchorConfidence: turnId ? "high" : typeof turnIndex === "number" ? "medium" : "low",
      messageRole: indexedMessage ? indexedMessage.role : "",
      messageFingerprint: indexedMessage ? indexedMessage.messageFingerprint : "",
      precedingUserFingerprint: indexedMessage ? indexedMessage.precedingUserFingerprint : "",
      blockIndex: indexedBlock ? indexedBlock.blockIndex : undefined,
      blockType: indexedBlock ? indexedBlock.blockType : "",
      blockFingerprint: indexedBlock ? indexedBlock.blockFingerprint : ""
    };
  }

  function getRangeTextContext(range) {
    if (!range) {
      return { prefixText: "", suffixText: "" };
    }

    const containerText = String(range.commonAncestorContainer && range.commonAncestorContainer.textContent || "");
    const selectedText = String(range.toString ? range.toString() : "");
    const index = selectedText ? containerText.indexOf(selectedText) : -1;

    if (index < 0) {
      return {
        prefixText: containerText.slice(0, 120),
        suffixText: containerText.slice(-120)
      };
    }

    return {
      prefixText: containerText.slice(Math.max(0, index - 120), index).trim(),
      suffixText: containerText.slice(index + selectedText.length, index + selectedText.length + 120).trim()
    };
  }

  function buildSelectionContext(selection) {
    if (!selection || !selection.rangeCount) {
      return {
        selectedText: "",
        prefixText: "",
        suffixText: ""
      };
    }

    const range = selection.getRangeAt(0);
    const context = getRangeTextContext(range);

    return {
      selectedText: String(selection.toString ? selection.toString() : "").trim(),
      prefixText: context.prefixText,
      suffixText: context.suffixText
    };
  }

  const api = {
    buildSelectionContext,
    buildTurnAnchor
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
