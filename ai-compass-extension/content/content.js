(function initContentScript() {
  "use strict";

  const compass = globalThis.AICompass;
  const siteAdapter = compass.getCurrentSiteAdapter();

  if (!siteAdapter) {
    return;
  }

  const FLOATING_BUTTON_ID = "ai-compass-floating-button";
  const COLLECT_BUTTON_ID = "ai-compass-collect-button";
  const SIMILAR_CARD_ID = "ai-compass-similar-card";
  const TOAST_ID = "ai-compass-toast";
  let lastUrl = location.href;
  let selectedText = "";
  let turnMap = null;
  let turnMapDirty = true;
  let turnMapRefreshTimer = null;

  function markTurnMapDirty() {
    turnMapDirty = true;
  }

  function ensureTurnMap(force) {
    if (!turnMap || turnMapDirty || force) {
      turnMap = compass.buildTurnMap
        ? compass.buildTurnMap(document, siteAdapter)
        : { messages: [] };
      turnMapDirty = false;
    }

    return turnMap;
  }

  function scheduleTurnMapRefresh() {
    markTurnMapDirty();

    if (turnMapRefreshTimer) {
      window.clearTimeout(turnMapRefreshTimer);
    }

    turnMapRefreshTimer = window.setTimeout(() => {
      ensureTurnMap(true);
      turnMapRefreshTimer = null;
    }, 250);
  }

  function sendMessage(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : "操作失败"));
          return;
        }

        resolve(response.data);
      });
    });
  }

  function getPagePayload() {
    return {
      url: location.href,
      title: document.title || siteAdapter.name
    };
  }

  function notifySessionChanged() {
    sendMessage("SESSION_CHANGED", getPagePayload()).catch(() => {});
  }

  function showToast(message, tone) {
    let toast = document.getElementById(TOAST_ID);

    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.className = "ai-compass-toast";
      document.documentElement.appendChild(toast);
    }

    toast.textContent = message;
    toast.dataset.tone = tone || "info";
    toast.classList.add("is-visible");

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 1800);
  }

  function injectFloatingButton() {
    if (document.getElementById(FLOATING_BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = FLOATING_BUTTON_ID;
    button.className = "ai-compass-floating-button";
    button.type = "button";
    button.title = "打开 AI 对话指南针";
    button.textContent = "指南针";
    button.style.bottom = siteAdapter.floatingButtonPosition.bottom;
    button.style.right = siteAdapter.floatingButtonPosition.right;
    button.addEventListener("click", () => {
      sendMessage("OPEN_SIDE_PANEL", getPagePayload()).catch((error) => {
        showToast(error.message || "打开失败，请重试", "error");
      });
    });

    document.documentElement.appendChild(button);
  }

  function getSelectionText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return "";
    }

    return selection.toString().trim();
  }

  function getSelectionHtml() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return "";
    }

    const tableHtml = getSelectionTableHtml(selection);

    if (tableHtml) {
      return tableHtml;
    }

    const fragmentParts = [];

    for (let index = 0; index < selection.rangeCount; index += 1) {
      fragmentParts.push(compass.normalizeRichHtml(compass.serializeNodeToSafeHtml
        ? compass.serializeNodeToSafeHtml(selection.getRangeAt(index).cloneContents())
        : serializeNodeToSafeHtml(selection.getRangeAt(index).cloneContents())));
    }

    const html = compass.normalizeRichHtml(fragmentParts.join(""));

    return /<[a-z][\s>]/i.test(html) ? html : "";
  }

  function getSelectionTableHtml(selection) {
    const tables = [];

    for (let rangeIndex = 0; rangeIndex < selection.rangeCount; rangeIndex += 1) {
      const range = selection.getRangeAt(rangeIndex);
      const commonAncestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const ancestorTables = [];

      if (commonAncestor) {
        const closestTable = commonAncestor.closest ? commonAncestor.closest("table") : null;
        if (closestTable) {
          ancestorTables.push(closestTable);
        }

        if (commonAncestor.querySelectorAll) {
          ancestorTables.push(...Array.from(commonAncestor.querySelectorAll("table")));
        }
      }

      ancestorTables.forEach((table) => {
        try {
          if (range.intersectsNode(table) && !tables.includes(table)) {
            tables.push(table);
          }
        } catch (error) {
          if (!tables.includes(table)) {
            tables.push(table);
          }
        }
      });
    }

    if (!tables.length) {
      return "";
    }

    return compass.normalizeRichHtml(tables.map(serializeNodeToSafeHtml).join(""));
  }

  function serializeNodeToSafeHtml(node) {
    const allowedTags = new Set([
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

    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return compass.escapeHtml(node.nodeValue || "");
    }

    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      return Array.from(node.childNodes).map(serializeNodeToSafeHtml).join("");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tagName = node.tagName.toLowerCase();

    if (tagName === "script" || tagName === "style" || tagName === "iframe") {
      return "";
    }

    const children = Array.from(node.childNodes).map(serializeNodeToSafeHtml).join("");

    if (!allowedTags.has(tagName)) {
      return children;
    }

    if (tagName === "br") {
      return "<br>";
    }

    const attrs = [];

    if (tagName === "a") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:|mailto:|#)/i.test(href)) {
        attrs.push(`href="${compass.escapeHtml(href)}"`);
      }
    }

    if (tagName === "code") {
      const safeClass = String(node.className || "")
        .split(/\s+/)
        .filter((part) => /^language-[a-z0-9_-]+$/i.test(part))
        .join(" ");
      if (safeClass) {
        attrs.push(`class="${compass.escapeHtml(safeClass)}"`);
      }
    }

    if (tagName === "td" || tagName === "th") {
      ["colspan", "rowspan"].forEach((name) => {
        const value = node.getAttribute(name);
        if (/^[1-9][0-9]?$/.test(value || "")) {
          attrs.push(`${name}="${value}"`);
        }
      });
    }

    return `<${tagName}${attrs.length ? ` ${attrs.join(" ")}` : ""}>${children}</${tagName}>`;
  }

  function getSelectionRect() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      return null;
    }

    return rect;
  }

  function getSourceLocator(text, html) {
    const rect = getSelectionRect();

    return {
      text: String(text || "").trim(),
      snippets: compass.extractLocatorSnippets(text, html),
      scrollY: window.scrollY,
      scrollX: window.scrollX,
      viewportTop: rect ? rect.top : null,
      viewportLeft: rect ? rect.left : null
    };
  }

  function getSelectionMetadata(text) {
    const selection = window.getSelection();
    const selectionContext = compass.buildSelectionContext(selection);

    return Object.assign({}, selectionContext, {
      selectedText: selectionContext.selectedText || text,
      turnAnchor: compass.buildTurnAnchor(selection, siteAdapter, Object.assign({}, getPagePayload(), {
        conversationIndex: ensureTurnMap(false)
      }))
    });
  }

  function normalizeLocatorText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function getLocatorCandidates(scope) {
    const selectors = [
      "table",
      "article",
      "section",
      "ol",
      "ul",
      "li",
      "p",
      "pre",
      "blockquote",
      "td",
      "th",
      "[data-message-author-role]",
      "[data-testid*='message']",
      "[class*='markdown']",
      "[class*='prose']",
      "[class*='message']"
    ].join(", ");
    const root = scope || document.body;

    const candidates = Array.from(root.querySelectorAll(selectors)).filter((element) => {
      if (element.closest("#ai-compass-floating-button, #ai-compass-collect-button, #ai-compass-toast")) {
        return false;
      }

      const text = normalizeLocatorText(element.textContent || "");
      return text.length >= 2;
    });

    return candidates.filter((element) => {
      const text = normalizeLocatorText(element.textContent || "");
      return !candidates.some((child) => {
        if (child === element || !element.contains(child)) {
          return false;
        }

        const childText = normalizeLocatorText(child.textContent || "");
        return childText.length >= 2 && text.includes(childText) && childText.length >= Math.min(80, text.length * 0.35);
      });
    });
  }

  function scoreLocatorCandidate(element, snippets, locator) {
    const text = normalizeLocatorText(element.textContent || "");

    if (!text) {
      return 0;
    }

    let score = 0;
    let matched = 0;

    snippets.forEach((snippet, index) => {
      const normalizedSnippet = normalizeLocatorText(snippet);

      if (!normalizedSnippet) {
        return;
      }

      if (text.includes(normalizedSnippet)) {
        matched += 1;
        score += index === 0 ? 16 : 10;
        return;
      }

      const head = normalizedSnippet.slice(0, Math.min(48, normalizedSnippet.length));
      if (head.length >= 8 && text.includes(head)) {
        matched += 1;
        score += index === 0 ? 8 : 5;
      }
    });

    if (!matched) {
      return 0;
    }

    score += Math.min(16, matched * 4);

    if (element.matches("table, ol, ul, li, p, pre, blockquote, td, th")) {
      score += 2;
    }

    if (typeof locator.scrollY === "number") {
      const distance = Math.abs(element.getBoundingClientRect().top + window.scrollY - locator.scrollY);
      score += Math.max(0, 12 - Math.floor(distance / 320));
    }

    score -= Math.min(18, Math.floor(text.length / 420));

    return score;
  }

  function findLocatorTarget(payload, scope) {
    const locator = payload && payload.locator ? payload.locator : {};
    const snippets = Array.isArray(locator.snippets) && locator.snippets.length
      ? locator.snippets
      : compass.extractLocatorSnippets(payload.text || locator.text || "", "");

    if (!snippets.length) {
      return null;
    }

    let best = null;
    let bestScore = 0;

    getLocatorCandidates(scope).forEach((element) => {
      const score = scoreLocatorCandidate(element, snippets, locator);

      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    });

    return bestScore > 0 ? best : null;
  }

  function findTargetNearLocatorScroll(locator) {
    if (!locator || typeof locator.scrollY !== "number") {
      return null;
    }

    const expectedTop = locator.scrollY + (typeof locator.viewportTop === "number" ? locator.viewportTop : window.innerHeight * 0.35);
    let best = null;
    let bestDistance = Infinity;

    getLocatorCandidates(document.body).forEach((element) => {
      const rect = element.getBoundingClientRect();

      if (!rect || rect.height <= 0 || rect.width <= 0) {
        return;
      }

      const top = rect.top + window.scrollY;
      const distance = Math.abs(top - expectedTop);

      if (distance < bestDistance) {
        best = element;
        bestDistance = distance;
      }
    });

    return bestDistance < Math.max(420, window.innerHeight * 0.8) ? best : null;
  }

  function findLocatorTargetInMessage(payload, indexedMessage) {
    const anchor = payload && payload.anchor ? payload.anchor : {};
    const block = compass.findBlockByAnchor && indexedMessage
      ? compass.findBlockByAnchor(anchor, indexedMessage)
      : null;

    if (block && block.element) {
      return block.element;
    }

    return indexedMessage && indexedMessage.element ? findLocatorTarget(payload, indexedMessage.element) : null;
  }

  function hasUsableAnchor(anchor) {
    return Boolean(anchor && (
      anchor.anchorVersion
      || anchor.turnId
      || typeof anchor.turnIndex === "number"
      || anchor.messageFingerprint
      || anchor.blockFingerprint
    ));
  }

  function canUseFullPageFallback(anchor, indexedMessage) {
    if (!hasUsableAnchor(anchor)) {
      return true;
    }

    if (indexedMessage) {
      return false;
    }

    return true;
  }

  function highlightSourceElement(element) {
    if (!element) {
      return;
    }

    document.querySelectorAll(".ai-compass-source-highlight").forEach((node) => {
      node.classList.remove("ai-compass-source-highlight");
    });

    // Restart the CSS animation even when the same source block is located repeatedly.
    void element.offsetWidth;
    element.classList.add("ai-compass-source-highlight");
    element.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "smooth"
    });

    window.setTimeout(() => {
      element.classList.remove("ai-compass-source-highlight");
    }, 3200);
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function locateSourceText(payload) {
    const locator = payload && payload.locator ? payload.locator : {};
    const anchor = payload && payload.anchor ? payload.anchor : {};
    let index = ensureTurnMap(false);
    let indexedMessage = hasUsableAnchor(anchor) && compass.findMessageByAnchor
      ? compass.findMessageByAnchor(anchor, index)
      : null;
    let target = findLocatorTargetInMessage(payload, indexedMessage);

    if (!target && hasUsableAnchor(anchor) && typeof locator.scrollY === "number") {
      window.scrollTo({
        top: locator.scrollY,
        left: typeof locator.scrollX === "number" ? locator.scrollX : window.scrollX,
        behavior: "smooth"
      });

      for (let attempt = 0; attempt < 3 && !target; attempt += 1) {
        await delay(180);
        index = ensureTurnMap(true);
        indexedMessage = compass.findMessageByAnchor ? compass.findMessageByAnchor(anchor, index) : null;
        target = findLocatorTargetInMessage(payload, indexedMessage);
      }
    }

    if (!target && canUseFullPageFallback(anchor, indexedMessage)) {
      target = findLocatorTarget(payload);
    }

    if (target) {
      highlightSourceElement(target);
      return { located: true, method: indexedMessage ? "turn-anchor" : "text" };
    }

    if (typeof locator.scrollY === "number") {
      window.scrollTo({
        top: locator.scrollY,
        left: typeof locator.scrollX === "number" ? locator.scrollX : window.scrollX,
        behavior: "smooth"
      });
      await delay(260);
      const scrollTarget = findTargetNearLocatorScroll(locator);
      if (scrollTarget) {
        highlightSourceElement(scrollTarget);
        return { located: true, method: "scroll-highlight" };
      }
      return { located: true, method: "scroll" };
    }

    throw new Error("没有找到原文位置");
  }

  function hideCollectButton() {
    const button = document.getElementById(COLLECT_BUTTON_ID);
    if (button) {
      button.remove();
    }
  }

  function hideSimilarCard() {
    const card = document.getElementById(SIMILAR_CARD_ID);
    if (card) {
      card.remove();
    }
  }

  function appendTextBlock(parent, label, value) {
    const wrapper = document.createElement("div");
    const title = document.createElement("strong");
    const text = document.createElement("p");

    wrapper.className = "ai-compass-similar-block";
    title.textContent = label;
    text.textContent = value || "（暂无内容）";
    wrapper.append(title, text);
    parent.appendChild(wrapper);
  }

  function createSimilarAction(label, action, draft, relation) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        const result = await sendMessage("RESOLVE_SIMILAR_SELECTION", {
          action,
          draft,
          relation
        });
        hideSimilarCard();
        hideCollectButton();
        window.getSelection().removeAllRanges();
        showToast(result && result.status === "EDIT_ITEM_WITH_DRAFT" ? "已合并到已有内容，可在侧栏继续编辑" : "已保存到指南针", "success");
      } catch (error) {
        button.disabled = false;
        showToast(error.message || "处理失败，请重试", "error");
      }
    });

    return button;
  }

  function showSimilarCard(draft, relation) {
    hideSimilarCard();

    const card = document.createElement("section");
    const title = document.createElement("h2");
    const desc = document.createElement("p");
    const actions = document.createElement("div");
    const cancel = document.createElement("button");

    card.id = SIMILAR_CARD_ID;
    card.className = "ai-compass-similar-card";
    title.textContent = "发现可能相关的内容";
    desc.textContent = relation.relationLabel || "当前内容可能与已有记录相关，请选择处理方式。";
    actions.className = "ai-compass-similar-actions";

    appendTextBlock(card, "当前内容", relation.currentText || draft.item.content);
    appendTextBlock(card, "已有内容", relation.existingText || "");

    actions.append(
      createSimilarAction("作为重点摘录保存", "highlight", draft, relation),
      createSimilarAction("保存为完整版本", "fullVersion", draft, relation),
      createSimilarAction("合并到已有内容", "merge", draft, relation),
      createSimilarAction("替换已有内容", "replace", draft, relation),
      createSimilarAction("仍然单独保存", "standalone", draft, relation)
    );

    cancel.type = "button";
    cancel.className = "ai-compass-similar-cancel";
    cancel.textContent = "取消";
    cancel.addEventListener("click", hideSimilarCard);
    actions.appendChild(cancel);

    card.prepend(title, desc);
    card.appendChild(actions);
    document.documentElement.appendChild(card);
  }

  function positionCollectButton(button, rect) {
    const top = rect.top > 52 ? rect.top - 44 : rect.bottom + 10;
    const left = Math.min(
      Math.max(12, rect.left + rect.width / 2 - 68),
      window.innerWidth - 152
    );

    button.style.top = `${Math.max(12, top)}px`;
    button.style.left = `${left}px`;
  }

  function showCollectButton(rect) {
    hideCollectButton();

    const button = document.createElement("button");
    button.id = COLLECT_BUTTON_ID;
    button.className = "ai-compass-collect-button";
    button.type = "button";
    button.textContent = "收集到指南针";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const selectionText = selectedText || getSelectionText();
      const html = getSelectionHtml();
      const text = compass.richHtmlToMarkdownText(selectionText, html);

      if (text.length <= 1) {
        hideCollectButton();
        return;
      }

      button.disabled = true;
      button.textContent = "收集中...";

      try {
        const metadata = getSelectionMetadata(text);
        const result = await sendMessage("COLLECT_SELECTION", Object.assign({
          text,
          html,
          locator: getSourceLocator(text, html),
          selectedText: metadata.selectedText,
          prefixText: metadata.prefixText,
          suffixText: metadata.suffixText,
          turnAnchor: metadata.turnAnchor
        }, getPagePayload()));

        if (result && result.status === "SIMILAR_CONTENT_FOUND") {
          button.disabled = false;
          button.textContent = "收集到指南针";
          hideCollectButton();
          showSimilarCard(result.draft, result.relation);
          return;
        }

        hideCollectButton();
        window.getSelection().removeAllRanges();
        showToast("已收集到指南针", "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = "收集到指南针";
        showToast(error.message || "保存失败，请重试", "error");
      }
    });

    positionCollectButton(button, rect);
    document.documentElement.appendChild(button);
  }

  function handleMouseUp(event) {
    if (event.target && event.target.closest && event.target.closest(`#${FLOATING_BUTTON_ID}, #${COLLECT_BUTTON_ID}`)) {
      return;
    }

    window.setTimeout(() => {
      const text = getSelectionText();
      const rect = getSelectionRect();

      if (text.length <= 1 || !rect) {
        hideCollectButton();
        return;
      }

      selectedText = text;
      showCollectButton(rect);
    }, 20);
  }

  function watchUrlChange() {
    const check = () => {
      if (location.href === lastUrl) {
        return;
      }

      lastUrl = location.href;
      markTurnMapDirty();
      hideCollectButton();
      notifySessionChanged();
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushStatePatched() {
      const result = originalPushState.apply(this, arguments);
      window.setTimeout(check, 0);
      return result;
    };

    history.replaceState = function replaceStatePatched() {
      const result = originalReplaceState.apply(this, arguments);
      window.setTimeout(check, 0);
      return result;
    };

    window.addEventListener("popstate", check);

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function watchConversationIndex() {
    const observer = new MutationObserver(scheduleTurnMapRefresh);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  injectFloatingButton();
  ensureTurnMap(true);
  notifySessionChanged();
  watchUrlChange();
  watchConversationIndex();
  document.addEventListener("mouseup", handleMouseUp, true);
  window.addEventListener("scroll", hideCollectButton, true);
  window.addEventListener("scroll", hideSimilarCard, true);
  window.addEventListener("resize", hideCollectButton);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    switch (message.type) {
      case "LOCATE_SOURCE_TEXT":
        locateSourceText(message.payload || {}).then((data) => {
          sendResponse({
            ok: true,
            data
          });
        }).catch((error) => {
          sendResponse({
            ok: false,
            error: error.message || "定位失败"
          });
        });
        return true;
      default:
        return false;
    }
  });
})();
