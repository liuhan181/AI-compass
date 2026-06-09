(function initConversationIndex(root) {
  "use strict";

  const MESSAGE_SELECTOR = [
    "[data-message-id]",
    "[data-message-author-role]",
    "[data-testid*='conversation-turn']",
    "[data-testid*='message']",
    "[data-turn-id]",
    "article"
  ].join(", ");
  const BLOCK_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "ul",
    "ol",
    "li",
    "table",
    "pre",
    "blockquote"
  ].join(", ");

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function fingerprintText(value) {
    const text = normalizeText(value).toLowerCase();
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `fp-${(hash >>> 0).toString(36).padStart(8, "0")}-${text.length}`;
  }

  function getSelectionElement(selection) {
    if (!selection || !selection.rangeCount || typeof selection.getRangeAt !== "function") {
      return null;
    }

    const range = selection.getRangeAt(0);
    const node = range && range.commonAncestorContainer;

    if (!node) {
      return null;
    }

    return node.nodeType === 1 ? node : node.parentElement || null;
  }

  function elementContains(parent, child) {
    let node = child;

    while (node) {
      if (node === parent) {
        return true;
      }
      node = node.parentElement;
    }

    return false;
  }

  function getAttribute(element, name) {
    return element && typeof element.getAttribute === "function" ? element.getAttribute(name) || "" : "";
  }

  function closest(element, selector) {
    return element && typeof element.closest === "function" ? element.closest(selector) : null;
  }

  function getStableMessageId(element) {
    if (!element) {
      return "";
    }

    return getAttribute(element, "data-message-id")
      || getAttribute(element, "data-turn-id")
      || getAttribute(element, "data-id")
      || element.id
      || "";
  }

  function normalizeMessageElement(element) {
    if (!element) {
      return null;
    }

    return closest(element, "article")
      || closest(element, "[data-testid*='conversation-turn']")
      || closest(element, "[data-message-id]")
      || closest(element, "[data-message-author-role]")
      || element;
  }

  function inferRole(element) {
    const directRole = getAttribute(element, "data-message-author-role").toLowerCase();
    const testId = getAttribute(element, "data-testid").toLowerCase();
    const className = String(element && element.className || "").toLowerCase();

    if (directRole === "user" || directRole === "assistant") {
      return directRole;
    }

    if (testId.includes("user") || className.includes("user")) {
      return "user";
    }

    if (testId.includes("assistant") || className.includes("assistant") || className.includes("markdown")) {
      return "assistant";
    }

    const roleNode = element && typeof element.querySelectorAll === "function"
      ? Array.from(element.querySelectorAll("[data-message-author-role]"))[0]
      : null;
    const nestedRole = getAttribute(roleNode, "data-message-author-role").toLowerCase();

    return nestedRole === "user" || nestedRole === "assistant" ? nestedRole : "unknown";
  }

  function getBlockType(element) {
    const tagName = element && element.tagName ? element.tagName.toLowerCase() : "";

    if (/^h[1-6]$/.test(tagName)) {
      return "heading";
    }

    if (tagName === "ul" || tagName === "ol" || tagName === "li") {
      return "list";
    }

    if (tagName === "table") {
      return "table";
    }

    if (tagName === "pre") {
      return "code";
    }

    if (tagName === "blockquote") {
      return "blockquote";
    }

    return tagName === "p" ? "paragraph" : "unknown";
  }

  function getElements(rootElement, selector) {
    if (!rootElement || typeof rootElement.querySelectorAll !== "function") {
      return [];
    }

    return Array.from(rootElement.querySelectorAll(selector));
  }

  function getMessageElements(documentLike) {
    const body = documentLike && documentLike.body ? documentLike.body : null;
    const seen = new Set();
    const messages = [];

    getElements(body, MESSAGE_SELECTOR).forEach((candidate) => {
      const message = normalizeMessageElement(candidate);
      const text = normalizeText(message && message.textContent);

      if (!message || seen.has(message) || text.length < 2) {
        return;
      }

      seen.add(message);
      messages.push(message);
    });

    return messages;
  }

  function getBlockElements(messageElement) {
    const rawBlocks = getElements(messageElement, BLOCK_SELECTOR);
    const blocks = rawBlocks.filter((block) => {
      const text = normalizeText(block.textContent);

      if (text.length < 2) {
        return false;
      }

      return !rawBlocks.some((other) => {
        if (other === block || !elementContains(block, other)) {
          return false;
        }

        const blockType = getBlockType(block);
        const otherType = getBlockType(other);

        return blockType === otherType && normalizeText(other.textContent).length >= Math.min(80, text.length * 0.7);
      });
    });

    return blocks.length ? blocks : [messageElement];
  }

  function buildBlocksForMessage(messageElement) {
    return getBlockElements(messageElement).map((element, blockIndex) => {
      const text = normalizeText(element.textContent);

      return {
        element,
        blockIndex,
        blockType: getBlockType(element),
        blockFingerprint: fingerprintText(text),
        textPreview: text.slice(0, 120)
      };
    });
  }

  function buildTurnMap(documentLike, adapter) {
    const messages = [];
    let precedingUserFingerprint = "";

    getMessageElements(documentLike).forEach((element, turnIndex) => {
      const text = normalizeText(element.textContent);
      const role = inferRole(element);
      const messageFingerprint = fingerprintText(text);
      const message = {
        element,
        role,
        turnIndex,
        messageId: getStableMessageId(element),
        messageFingerprint,
        precedingUserFingerprint: role === "assistant" ? precedingUserFingerprint : "",
        textPreview: text.slice(0, 120),
        siteId: adapter && adapter.id ? adapter.id : ""
      };

      messages.push(message);

      if (role === "user") {
        precedingUserFingerprint = messageFingerprint;
      }
    });

    return {
      builtAt: Date.now(),
      messages
    };
  }

  function buildConversationIndex(documentLike, adapter) {
    const index = buildTurnMap(documentLike, adapter);

    index.messages.forEach((message) => {
      message.blocks = buildBlocksForMessage(message.element);
    });

    return index;
  }

  function findIndexedMessageForSelection(selection, index) {
    const element = getSelectionElement(selection);

    if (!element || !index || !Array.isArray(index.messages)) {
      return null;
    }

    return index.messages.find((message) => elementContains(message.element, element)) || null;
  }

  function findIndexedBlockForSelection(selection, message) {
    const element = getSelectionElement(selection);

    if (!element || !message || !Array.isArray(message.blocks)) {
      return null;
    }

    return message.blocks.find((block) => elementContains(block.element, element)) || null;
  }

  function findMessageByAnchor(anchor, index) {
    const messages = index && Array.isArray(index.messages) ? index.messages : [];
    const stableId = anchor && (anchor.turnId || anchor.messageId);

    if (stableId) {
      const byId = messages.find((message) => message.messageId && message.messageId === stableId);
      if (byId) {
        return byId;
      }
    }

    if (anchor && anchor.precedingUserFingerprint && anchor.messageFingerprint) {
      return messages.find((message) => {
        return message.precedingUserFingerprint === anchor.precedingUserFingerprint
          && message.messageFingerprint === anchor.messageFingerprint;
      }) || null;
    }

    if (anchor && anchor.messageFingerprint) {
      return messages.find((message) => message.messageFingerprint === anchor.messageFingerprint) || null;
    }

    if (anchor && typeof anchor.turnIndex === "number") {
      const byTurn = messages.find((message) => {
        return message.turnIndex === anchor.turnIndex
          && (!anchor.messageRole || message.role === anchor.messageRole);
      });
      if (byTurn) {
        return byTurn;
      }
    }

    return null;
  }

  function findBlockByAnchor(anchor, message) {
    const blocks = message && Array.isArray(message.blocks)
      ? message.blocks
      : message && message.element ? buildBlocksForMessage(message.element) : [];

    if (anchor && anchor.blockFingerprint) {
      const byFingerprint = blocks.find((block) => block.blockFingerprint === anchor.blockFingerprint);
      if (byFingerprint) {
        return byFingerprint;
      }
    }

    if (anchor && typeof anchor.blockIndex === "number") {
      const byIndex = blocks.find((block) => {
        return block.blockIndex === anchor.blockIndex
          && (!anchor.blockType || block.blockType === anchor.blockType);
      });
      if (byIndex) {
        return byIndex;
      }
    }

    return null;
  }

  const api = {
    buildBlocksForMessage,
    buildConversationIndex,
    buildTurnMap,
    elementContains,
    findBlockByAnchor,
    findIndexedBlockForSelection,
    findIndexedMessageForSelection,
    findMessageByAnchor,
    fingerprintText,
    normalizeTextForIndex: normalizeText
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
