importScripts(
  "utils/constants.js",
  "utils/siteAdapters.js",
  "utils/session.js",
  "utils/similarity.js",
  "utils/attachments.js",
  "utils/storage.js",
  "utils/markdown.js"
);

const compass = globalThis.AICompass;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getTabContextFromSender(sender) {
  return {
    tabId: sender && sender.tab ? sender.tab.id : undefined,
    windowId: sender && sender.tab ? sender.tab.windowId : undefined
  };
}

async function setSessionFromPage({ url, title }) {
  if (!isNonEmptyString(url)) {
    throw new Error("缺少页面 URL");
  }

  const adapter = compass.getSiteAdapterForUrl(url);

  if (!adapter) {
    throw new Error("当前站点不在 AI Compass 支持列表中");
  }

  return compass.storage.setCurrentSession(
    compass.createSessionDraft({
      url,
      title,
      siteAdapter: adapter,
      now: Date.now()
    })
  );
}

async function setSessionContextFromSender(sender, payload) {
  const session = await setSessionFromPage(payload);
  const tab = sender && sender.tab ? sender.tab : {
    url: payload.url,
    title: payload.title || session.title
  };

  await compass.storage.setCurrentContext(buildContextFromTab(tab, true, session));

  return session;
}

function buildContextFromTab(tab, supported, session) {
  const currentContext = {
    tabId: tab && tab.id,
    windowId: tab && tab.windowId,
    supported: Boolean(supported),
    siteId: session && session.siteId || "",
    siteName: session && session.siteName || "",
    conversationId: session && session.conversationId || "",
    sessionKey: session && session.sessionKey || "",
    url: tab && tab.url || "",
    title: tab && tab.title || "",
    updatedAt: Date.now()
  };

  return currentContext;
}

function isInspectableTabUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

async function syncActiveTabContext(tab) {
  if (!tab || !isInspectableTabUrl(tab.url)) {
    await compass.storage.setCurrentContext(buildContextFromTab(tab, false, null));
    return { supported: false };
  }

  const adapter = compass.getSiteAdapterForUrl(tab.url);

  if (!adapter) {
    await compass.storage.setCurrentContext(buildContextFromTab(tab, false, null));
    return { supported: false };
  }

  const session = await setSessionFromPage({
    url: tab.url,
    title: tab.title || adapter.name
  });
  await compass.storage.setCurrentContext(buildContextFromTab(tab, true, session));

  return {
    supported: true,
    sessionKey: session.sessionKey
  };
}

function syncCurrentWindowActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const error = chrome.runtime.lastError;

      if (error) {
        console.warn("[AI Compass] 无法读取当前标签页", error);
        reject(new Error(error.message));
        return;
      }

      syncActiveTabContext(tabs && tabs[0])
        .then(resolve)
        .catch((syncError) => {
          console.warn("[AI Compass] 无法同步当前会话", syncError);
          reject(syncError);
        });
    });
  });
}

function buildSessionDraftFromPayload(payload, adapter) {
  return compass.createSessionDraft({
    url: payload.url,
    title: payload.title || "",
    siteAdapter: adapter,
    now: Date.now()
  });
}

function buildItemDraft(payload, adapter, sessionDraft, settings, relationUpdates) {
  const turnAnchor = payload.turnAnchor || {};
  const normalizedContent = compass.normalizeForSimilarity(payload.text);
  const nextSettings = Object.assign({}, compass.DEFAULT_SETTINGS || {}, settings || {});
  const item = compass.createCompassItem(Object.assign({
    type: "quote",
    content: payload.text,
    contentHtml: nextSettings.keepRichTextByDefault === false ? "" : payload.html || "",
    sourceText: payload.text,
    selectedText: payload.selectedText || payload.text,
    sourceUrl: payload.url,
    sourceTitle: payload.title || "",
    sourceLocator: payload.locator || null,
    sessionKey: sessionDraft.sessionKey,
    conversationId: sessionDraft.conversationId || "",
    normalizedContent,
    contentHash: compass.getContentHash(payload.text),
    prefixText: payload.prefixText || "",
    suffixText: payload.suffixText || "",
    turnId: turnAnchor.turnId || "",
    turnIndex: turnAnchor.turnIndex,
    turnSummary: turnAnchor.turnSummary || "",
    anchorConfidence: turnAnchor.anchorConfidence || "low",
    anchorVersion: turnAnchor.anchorVersion,
    messageRole: turnAnchor.messageRole || "",
    messageFingerprint: turnAnchor.messageFingerprint || "",
    precedingUserFingerprint: turnAnchor.precedingUserFingerprint || "",
    blockIndex: turnAnchor.blockIndex,
    blockType: turnAnchor.blockType || "",
    blockFingerprint: turnAnchor.blockFingerprint || "",
    siteId: adapter.id,
    siteName: adapter.name,
    relationType: "standalone",
    fromSelection: true
  }, relationUpdates || {}));

  return {
    sessionDraft,
    item
  };
}

async function saveDraft(draft, updates) {
  const item = Object.assign({}, draft.item, updates || {});
  const result = await compass.storage.addItemToSession(draft.sessionDraft, item);

  return {
    status: "saved",
    itemId: result.item.id,
    sessionKey: result.session.sessionKey
  };
}

async function handleCollectSelection(payload) {
  if (!payload || !isNonEmptyString(payload.text) || !isNonEmptyString(payload.url)) {
    throw new Error("收集内容不完整");
  }

  const adapter = compass.getSiteAdapterForUrl(payload.url);

  if (!adapter) {
    throw new Error("当前站点不在 AI Compass 支持列表中");
  }

  const sessionDraft = buildSessionDraftFromPayload(payload, adapter);
  const settings = await compass.storage.getSettings();
  const draft = buildItemDraft(payload, adapter, sessionDraft, settings);
  const existingSession = await compass.storage.getSession(sessionDraft.sessionKey);
  const relation = compass.detectRelatedContent(draft.item, existingSession && existingSession.items || []);

  if (relation.relationType !== "standalone") {
    return {
      status: "SIMILAR_CONTENT_FOUND",
      draft,
      relation
    };
  }

  return saveDraft(draft, {
    relationType: "standalone"
  });
}

async function resolveSimilarSelection(sender, payload) {
  const action = payload && payload.action;
  const draft = payload && payload.draft;
  const relation = payload && payload.relation || {};

  if (!draft || !draft.sessionDraft || !draft.item) {
    throw new Error("缺少待处理内容");
  }

  if (action === "cancel") {
    return { status: "cancelled" };
  }

  if (action === "highlight") {
    return saveDraft(draft, {
      relationType: "highlight",
      parentItemId: relation.existingItemId || "",
      relatedItemIds: relation.relatedItemIds || []
    });
  }

  if (action === "fullVersion") {
    return saveDraft(draft, {
      relationType: "fullVersion",
      relatedItemIds: relation.relatedItemIds || []
    });
  }

  if (action === "standalone") {
    return saveDraft(draft, {
      relationType: "standalone",
      parentItemId: "",
      relatedItemIds: []
    });
  }

  if (action === "replace") {
    const existingItemId = relation.existingItemId;

    if (!existingItemId) {
      throw new Error("没有可替换的已有内容");
    }

    const updatedItem = await compass.storage.updateItem(draft.sessionDraft.sessionKey, existingItemId, Object.assign({}, draft.item, {
      id: existingItemId,
      relationType: "fullVersion",
      relatedItemIds: relation.relatedItemIds || []
    }));

    return {
      status: "replaced",
      itemId: updatedItem.id,
      sessionKey: draft.sessionDraft.sessionKey
    };
  }

  if (action === "merge") {
    const existingItemId = relation.existingItemId;
    const session = await compass.storage.getSession(draft.sessionDraft.sessionKey);
    const existingItem = session && (session.items || []).find((item) => item.id === existingItemId);

    if (!existingItem) {
      throw new Error("没有可合并的已有内容");
    }

    const mergedContent = [existingItem.content, draft.item.content].filter(Boolean).join("\n\n");
    const normalizedContent = compass.normalizeForSimilarity(mergedContent);
    const updatedItem = await compass.storage.updateItem(draft.sessionDraft.sessionKey, existingItemId, Object.assign({}, existingItem, {
      content: mergedContent,
      contentHtml: "",
      normalizedContent,
      contentHash: compass.getContentHash(mergedContent),
      relationType: "overlap",
      relatedItemIds: Array.from(new Set([...(existingItem.relatedItemIds || []), draft.item.id].filter(Boolean)))
    }));
    await compass.storage.setPendingEditItem(draft.sessionDraft.sessionKey, updatedItem.id);

    if (chrome.sidePanel && chrome.sidePanel.open) {
      const context = getTabContextFromSender(sender);
      if (context.tabId) {
        await chrome.sidePanel.open({ tabId: context.tabId }).catch(() => {});
      }
    }

    return {
      status: "EDIT_ITEM_WITH_DRAFT",
      itemId: updatedItem.id,
      sessionKey: draft.sessionDraft.sessionKey
    };
  }

  throw new Error("未知处理方式");
}

async function openSidePanel(sender, payload) {
  const context = getTabContextFromSender(sender);

  if (chrome.sidePanel && chrome.sidePanel.open) {
    if (context.tabId) {
      await chrome.sidePanel.open({ tabId: context.tabId });
    } else if (context.windowId) {
      await chrome.sidePanel.open({ windowId: context.windowId });
    }
  }

  if (payload && payload.url) {
    await setSessionContextFromSender(sender, payload);
  }

  return { opened: true };
}

async function downloadMarkdown(payload) {
  const sessionKey = payload && payload.sessionKey;
  const session = sessionKey
    ? await compass.storage.getSession(sessionKey)
    : await compass.storage.getCurrentSession();

  if (!session) {
    throw new Error("当前会话不存在");
  }

  const exportedAt = new Date();
  const filename = compass.buildMarkdownFileName({
    siteName: session.siteName,
    title: session.title,
    exportedAt
  });
  const assetBase = filename.replace(/\.md$/i, "-assets");
  const markdown = compass.buildMarkdown(session, exportedAt.getTime(), {
    assetDir: assetBase
  });
  const url = `data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`;
  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });
  const assetDownloads = await downloadAttachmentAssets(session, assetBase);

  return { downloadId, filename, assetDownloads };
}

async function downloadAttachmentAssets(session, assetBase) {
  const items = Array.isArray(session.items) ? session.items : [];
  const downloads = [];

  if (!compass.attachments || !compass.attachments.getImageDataUrl) {
    return downloads;
  }

  for (const item of items) {
    const attachments = Array.isArray(item.attachments) ? item.attachments : [];

    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];

      if (!attachment.storageKey) {
        continue;
      }

      const dataUrl = await compass.attachments.getImageDataUrl(attachment.storageKey);

      if (!dataUrl) {
        continue;
      }

      const assetFilename = compass.getAttachmentFileName(item, attachment, index);
      const filename = `${assetBase}/${assetFilename}`;
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false
      });

      downloads.push({ downloadId, filename });
    }
  }

  return downloads;
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(tabs || []);
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : "定位失败"));
        return;
      }

      resolve(response.data);
    });
  });
}

async function locateSourceItem(payload) {
  const sessionKey = payload && payload.sessionKey;
  const itemId = payload && payload.itemId;

  if (!sessionKey || !itemId) {
    throw new Error("定位信息不完整");
  }

  const session = await compass.storage.getSession(sessionKey);

  if (!session) {
    throw new Error("当前会话不存在");
  }

  const item = (session.items || []).find((entry) => entry.id === itemId);

  if (!item || !item.fromSelection) {
    throw new Error("只有通过指南针选区收藏的内容才能定位");
  }

  if (!item.sourceUrl) {
    throw new Error("这条记录没有来源页面");
  }

  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const activeTab = tabs[0];

  if (!activeTab || !activeTab.id || !activeTab.url) {
    throw new Error("没有找到当前活动页面");
  }

  if (compass.getSessionKeyFromUrl(activeTab.url) !== compass.getSessionKeyFromUrl(item.sourceUrl)) {
    throw new Error("请先切回这条记录的原会话页面，再点击定位");
  }

  const anchorVersion = item.anchorVersion
    || (item.turnId || typeof item.turnIndex === "number" || item.messageFingerprint ? 1 : undefined);

  return tabsSendMessage(activeTab.id, {
    type: "LOCATE_SOURCE_TEXT",
    payload: {
      text: item.sourceText || item.content,
      locator: item.sourceLocator || {
        text: item.sourceText || item.content
      },
      anchor: {
        anchorVersion,
        turnId: item.turnId,
        turnIndex: item.turnIndex,
        messageRole: item.messageRole,
        messageFingerprint: item.messageFingerprint,
        precedingUserFingerprint: item.precedingUserFingerprint,
        blockIndex: item.blockIndex,
        blockType: item.blockType,
        blockFingerprint: item.blockFingerprint
      }
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  compass.storage.migrateStorageToV6().catch((error) => {
    console.warn("[AI Compass] v0.6 数据迁移失败", error);
  });

  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  compass.storage.migrateStorageToV6().catch((error) => {
    console.warn("[AI Compass] v0.6 启动迁移检查失败", error);
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }

    await syncActiveTabContext(tab);
  } catch (error) {
    console.warn("[AI Compass] 无法打开侧边栏", error);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    const error = chrome.runtime.lastError;

    if (error) {
      console.warn("[AI Compass] 无法读取激活标签页", error);
      return;
    }

    syncActiveTabContext(tab).catch((syncError) => {
      console.warn("[AI Compass] 无法同步激活标签页", syncError);
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) {
    return;
  }

  if (!changeInfo.url && !changeInfo.title && changeInfo.status !== "complete") {
    return;
  }

  syncActiveTabContext(tab).catch((error) => {
    console.warn("[AI Compass] 无法同步更新后的标签页", error);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  syncCurrentWindowActiveTab();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "无效消息" });
    return false;
  }

  const work = async () => {
    switch (message.type) {
      case "OPEN_SIDE_PANEL":
        return openSidePanel(sender, message.payload || {});
      case "COLLECT_SELECTION":
        return handleCollectSelection(message.payload || {});
      case "RESOLVE_SIMILAR_SELECTION":
        return resolveSimilarSelection(sender, message.payload || {});
      case "SYNC_ACTIVE_CONTEXT":
        return syncCurrentWindowActiveTab();
      case "EDIT_ITEM_WITH_DRAFT":
        return { status: "EDIT_ITEM_WITH_DRAFT" };
      case "SESSION_CHANGED":
        return setSessionContextFromSender(sender, message.payload || {});
      case "DOWNLOAD_MARKDOWN":
        return downloadMarkdown(message.payload || {});
      case "EXPORT_BACKUP_JSON":
        return compass.storage.exportBackupJson();
      case "GET_SETTINGS":
        return compass.storage.getSettings();
      case "UPDATE_SETTINGS":
        return compass.storage.updateSettings(message.payload || {});
      case "LOCATE_SOURCE_ITEM":
        return locateSourceItem(message.payload || {});
      default:
        throw new Error("未知消息类型");
    }
  };

  work()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || "操作失败" }));

  return true;
});
