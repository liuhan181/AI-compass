(function initSession(root) {
  "use strict";

  const compass = root.AICompass || {};

  function createId(prefix) {
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  function normalizeSessionTitle(title) {
    const normalized = String(title || "").trim();
    return normalized || "AI Chat 记录";
  }

  function createSessionDraft({ url, title, siteAdapter, now }) {
    const adapter = siteAdapter || (compass.getSiteAdapterForUrl && compass.getSiteAdapterForUrl(url));
    const currentTime = now || Date.now();
    const sessionKey = compass.getSessionKeyFromUrl
      ? compass.getSessionKeyFromUrl(url)
      : `${new URL(url).origin}${new URL(url).pathname}`;
    const conversationId = compass.getConversationIdFromUrl
      ? compass.getConversationIdFromUrl(url)
      : sessionKey;

    return {
      id: createId("session"),
      sessionKey,
      conversationId,
      siteId: adapter ? adapter.id : "generic",
      siteName: adapter ? adapter.name : "AI Chat",
      title: normalizeSessionTitle(title),
      titleEditedByUser: false,
      sourceUrl: url,
      sourceTitle: normalizeSessionTitle(title),
      createdAt: currentTime,
      updatedAt: currentTime,
      items: []
    };
  }

  function buildSessionContext({ url, title }) {
    const adapter = compass.getSiteAdapterForUrl ? compass.getSiteAdapterForUrl(url) : null;
    return createSessionDraft({
      url,
      title,
      siteAdapter: adapter,
      now: Date.now()
    });
  }

  function createCompassItem({
    type,
    content,
    contentHtml,
    note,
    sourceText,
    sourceUrl,
    sourceTitle,
    sourceLocator,
    sessionKey,
    conversationId,
    selectedText,
    normalizedContent,
    contentHash,
    prefixText,
    suffixText,
    turnId,
    turnIndex,
    turnSummary,
    anchorConfidence,
    anchorVersion,
    messageRole,
    messageFingerprint,
    precedingUserFingerprint,
    blockIndex,
    blockType,
    blockFingerprint,
    relationType,
    parentItemId,
    relatedItemIds,
    attachments,
    siteId,
    siteName,
    fromSelection
  }) {
    const now = Date.now();

    return {
      id: createId("item"),
      type: type || "quote",
      content: String(content || "").trim(),
      contentHtml: String(contentHtml || "").trim(),
      note: String(note || "").trim(),
      sourceText: sourceText || String(content || "").trim(),
      sourceUrl: sourceUrl || "",
      sourceTitle: sourceTitle || "",
      sourceLocator: sourceLocator || null,
      sessionKey: sessionKey || "",
      conversationId: conversationId || "",
      selectedText: selectedText || sourceText || String(content || "").trim(),
      normalizedContent: normalizedContent || "",
      contentHash: contentHash || "",
      prefixText: prefixText || "",
      suffixText: suffixText || "",
      turnId: turnId || "",
      turnIndex: typeof turnIndex === "number" ? turnIndex : undefined,
      turnSummary: turnSummary || "",
      anchorConfidence: anchorConfidence || "low",
      anchorVersion: anchorVersion || undefined,
      messageRole: messageRole || "",
      messageFingerprint: messageFingerprint || "",
      precedingUserFingerprint: precedingUserFingerprint || "",
      blockIndex: typeof blockIndex === "number" ? blockIndex : undefined,
      blockType: blockType || "",
      blockFingerprint: blockFingerprint || "",
      relationType: relationType || "standalone",
      parentItemId: parentItemId || "",
      relatedItemIds: Array.isArray(relatedItemIds) ? relatedItemIds.slice() : [],
      attachments: root.AICompass && root.AICompass.attachments
        ? root.AICompass.attachments.normalizeAttachments(attachments)
        : (Array.isArray(attachments) ? attachments.slice() : []),
      siteId: siteId || "",
      siteName: siteName || "",
      fromSelection: Boolean(fromSelection),
      createdAt: now,
      updatedAt: now
    };
  }

  const api = {
    createId,
    normalizeSessionTitle,
    createSessionDraft,
    buildSessionContext,
    createCompassItem
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
