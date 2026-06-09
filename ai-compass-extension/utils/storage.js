(function initStorage(root) {
  "use strict";

  const compass = root.AICompass || {};
  const DEFAULT_SETTINGS = compass.DEFAULT_SETTINGS || {
    defaultItemType: "quote",
    autoOpenSidePanel: false,
    showLocateBeta: true,
    keepRichTextByDefault: true,
    onboardingDismissed: false,
    supportedHosts: []
  };
  const SCHEMA_VERSION = 6;
  const APP_VERSION = "0.6.2";

  function getRuntimeError() {
    return root.chrome && root.chrome.runtime && root.chrome.runtime.lastError
      ? root.chrome.runtime.lastError
      : null;
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      root.chrome.storage.local.get(keys, (result) => {
        const error = getRuntimeError();
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(result || {});
      });
    });
  }

  function storageSet(data) {
    return new Promise((resolve, reject) => {
      root.chrome.storage.local.set(data, () => {
        const error = getRuntimeError();
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      root.chrome.storage.local.remove(keys, () => {
        const error = getRuntimeError();
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve();
      });
    });
  }

  function normalizeSettings(settings) {
    return Object.assign({}, DEFAULT_SETTINGS, settings || {});
  }

  function getStorageStats(data) {
    const sessions = data && data.sessions && typeof data.sessions === "object" ? data.sessions : {};
    const sessionValues = Object.values(sessions);

    return {
      sessionCount: sessionValues.length,
      itemCount: sessionValues.reduce((count, session) => {
        return count + (Array.isArray(session && session.items) ? session.items.length : 0);
      }, 0)
    };
  }

  function createSafeId(prefix, index) {
    if (compass.createId) {
      return compass.createId(prefix);
    }

    return `${prefix}-${Date.now().toString(36)}-${index}`;
  }

  function inferSite(url) {
    const adapter = compass.getSiteAdapterForUrl ? compass.getSiteAdapterForUrl(url || "") : null;

    return {
      siteId: adapter ? adapter.id : "unknown",
      siteName: adapter ? adapter.name : "AI Chat"
    };
  }

  function normalizeLegacyItem(item, session, index, now) {
    const source = item && typeof item === "object" ? item : {};
    const content = String(source.content || source.text || source.selectedText || source.plainText || "").trim();
    const createdAt = source.createdAt || session.createdAt || now;

    return Object.assign({}, source, {
      id: source.id || createSafeId("item", index),
      type: source.type || "quote",
      content,
      contentHtml: source.contentHtml || source.richHtml || "",
      note: source.note || "",
      sourceText: source.sourceText || source.selectedText || content,
      selectedText: source.selectedText || source.sourceText || content,
      sourceUrl: source.sourceUrl || session.sourceUrl || "",
      sourceTitle: source.sourceTitle || session.sourceTitle || session.title || "",
      sourceLocator: source.sourceLocator || source.locator || null,
      sessionKey: source.sessionKey || session.sessionKey || "",
      conversationId: source.conversationId || session.conversationId || "",
      relationType: source.relationType || "standalone",
      relatedItemIds: Array.isArray(source.relatedItemIds) ? source.relatedItemIds : [],
      attachments: compass.attachments
        ? compass.attachments.normalizeAttachments(source.attachments)
        : (Array.isArray(source.attachments) ? source.attachments : []),
      fromSelection: typeof source.fromSelection === "boolean" ? source.fromSelection : true,
      createdAt,
      updatedAt: source.updatedAt || createdAt
    });
  }

  function normalizeLegacySession(session, key, now) {
    const source = session && typeof session === "object" ? session : {};
    const items = Array.isArray(source.items) ? source.items : [];
    const sourceUrl = source.sourceUrl || source.url || "";
    const site = inferSite(sourceUrl);
    const createdAt = source.createdAt || now;
    const normalizedSession = Object.assign({}, source, {
      id: source.id || createSafeId("session", key),
      sessionKey: source.sessionKey || key,
      conversationId: source.conversationId || "",
      siteId: source.siteId || site.siteId,
      siteName: source.siteName || site.siteName,
      title: source.title || source.sourceTitle || source.documentTitle || "未命名会话",
      titleEditedByUser: Boolean(source.titleEditedByUser),
      sourceUrl,
      sourceTitle: source.sourceTitle || source.documentTitle || source.title || "",
      createdAt,
      updatedAt: source.updatedAt || createdAt,
      focusItemId: source.focusItemId || "",
      items: []
    });

    normalizedSession.items = items.map((item, index) => normalizeLegacyItem(item, normalizedSession, index, now));
    normalizedSession.updatedAt = normalizedSession.items.reduce((latest, item) => {
      return Math.max(latest, item.updatedAt || latest);
    }, normalizedSession.updatedAt || createdAt);

    return normalizedSession;
  }

  function normalizeSessions(sessions, now) {
    const source = sessions && typeof sessions === "object" ? sessions : {};

    return Object.keys(source).reduce((next, key) => {
      next[key] = normalizeLegacySession(source[key], key, now);
      return next;
    }, {});
  }

  function assertNonDestructiveMigration(before, after) {
    const beforeStats = getStorageStats(before);
    const afterStats = getStorageStats(after);

    if (afterStats.sessionCount < beforeStats.sessionCount) {
      throw new Error("Migration would reduce session count");
    }

    if (afterStats.itemCount < beforeStats.itemCount) {
      throw new Error("Migration would reduce item count");
    }
  }

  function migrateRawDataToV6(rawData, nowInput) {
    const now = nowInput || Date.now();
    const oldData = rawData && typeof rawData === "object" ? rawData : {};
    const migrated = Object.assign({}, oldData, {
      sessions: normalizeSessions(oldData.sessions || {}, now),
      currentSessionKey: oldData.currentSessionKey || "",
      currentContext: oldData.currentContext || null,
      settings: normalizeSettings(oldData.settings),
      meta: Object.assign({}, oldData.meta || {}, {
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
        lastMigratedAt: now,
        migrationError: ""
      }),
      migrationBackup_v0_6: oldData.migrationBackup_v0_6 || {
        backupVersion: "before-v0.6",
        createdAt: now,
        data: oldData
      }
    });

    assertNonDestructiveMigration(oldData, migrated);

    return migrated;
  }

  function buildBackupExport(data, nowInput) {
    const source = data || {};

    return {
      exportedAt: new Date(nowInput || Date.now()).toISOString(),
      appVersion: APP_VERSION,
      schemaVersion: source.meta && source.meta.schemaVersion || SCHEMA_VERSION,
      sessions: source.sessions || {},
      settings: normalizeSettings(source.settings),
      meta: Object.assign({}, source.meta || {}, {
        schemaVersion: source.meta && source.meta.schemaVersion || SCHEMA_VERSION,
        appVersion: source.meta && source.meta.appVersion || APP_VERSION
      })
    };
  }

  async function migrateStorageToV6() {
    const oldData = await storageGet(null);
    const migrationBackup = oldData.migrationBackup_v0_6 || {
      backupVersion: "before-v0.6",
      createdAt: Date.now(),
      data: oldData
    };

    if (oldData.meta && oldData.meta.schemaVersion === SCHEMA_VERSION && oldData.meta.appVersion === APP_VERSION) {
      return oldData;
    }

    try {
      const migrated = migrateRawDataToV6(Object.assign({}, oldData, {
        migrationBackup_v0_6: migrationBackup
      }));
      await storageSet(migrated);
      return migrated;
    } catch (error) {
      const safeData = Object.assign({}, oldData, {
        migrationBackup_v0_6: migrationBackup,
        meta: Object.assign({}, oldData.meta || {}, {
          schemaVersion: oldData.meta && oldData.meta.schemaVersion || 0,
          appVersion: oldData.meta && oldData.meta.appVersion || APP_VERSION,
          migrationError: error.message || "Migration failed"
        })
      });
      await storageSet(safeData);
      return safeData;
    }
  }

  async function getAllData() {
    const data = await storageGet(["sessions", "currentSessionKey", "currentContext", "settings", "meta"]);

    return {
      sessions: normalizeSessions(data.sessions || {}, Date.now()),
      currentSessionKey: data.currentSessionKey || "",
      currentContext: data.currentContext || null,
      settings: normalizeSettings(data.settings),
      meta: Object.assign({}, data.meta || {}, {
        schemaVersion: data.meta && data.meta.schemaVersion || SCHEMA_VERSION,
        appVersion: data.meta && data.meta.appVersion || APP_VERSION
      })
    };
  }

  async function saveAllData(data) {
    await storageSet({
      sessions: data.sessions || {},
      currentSessionKey: data.currentSessionKey || "",
      currentContext: data.currentContext || null,
      settings: normalizeSettings(data.settings),
      meta: Object.assign({}, data.meta || {}, {
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION
      })
    });
  }

  async function getSettings() {
    const data = await getAllData();
    return data.settings;
  }

  async function updateSettings(updates) {
    const data = await getAllData();
    data.settings = normalizeSettings(Object.assign({}, data.settings, updates || {}));
    await saveAllData(data);
    return data.settings;
  }

  async function exportBackupJson() {
    const data = await storageGet(["sessions", "settings", "meta"]);
    const backupAt = Date.now();

    data.meta = Object.assign({}, data.meta || {}, {
      schemaVersion: data.meta && data.meta.schemaVersion || SCHEMA_VERSION,
      appVersion: data.meta && data.meta.appVersion || APP_VERSION,
      lastBackupAt: backupAt
    });
    const backup = buildBackupExport(data, backupAt);
    await storageSet({ meta: data.meta });

    return backup;
  }

  async function ensureSession(sessionDraft) {
    const data = await getAllData();
    const existing = data.sessions[sessionDraft.sessionKey];
    let session;

    if (existing) {
      session = Object.assign({}, existing, {
        siteId: sessionDraft.siteId,
        siteName: sessionDraft.siteName,
        conversationId: sessionDraft.conversationId || existing.conversationId || "",
        sourceUrl: sessionDraft.sourceUrl,
        sourceTitle: sessionDraft.sourceTitle,
        titleEditedByUser: Boolean(existing.titleEditedByUser),
        updatedAt: Date.now(),
        focusItemId: existing.focusItemId || "",
        items: Array.isArray(existing.items) ? existing.items : []
      });

      if (!existing.titleEditedByUser) {
        session.title = sessionDraft.title;
      }
    } else {
      session = Object.assign({}, sessionDraft, {
        titleEditedByUser: Boolean(sessionDraft.titleEditedByUser)
      });
    }

    data.sessions[session.sessionKey] = session;
    data.currentSessionKey = session.sessionKey;
    data.currentContext = {
      supported: true,
      siteId: session.siteId,
      siteName: session.siteName,
      conversationId: session.conversationId || "",
      sessionKey: session.sessionKey,
      url: session.sourceUrl,
      title: session.sourceTitle || session.title,
      updatedAt: Date.now()
    };
    await saveAllData(data);

    return session;
  }

  async function setCurrentSession(sessionDraft) {
    return ensureSession(sessionDraft);
  }

  async function clearCurrentSession() {
    const data = await getAllData();

    data.currentSessionKey = "";
    data.currentContext = {
      supported: false,
      updatedAt: Date.now()
    };
    await saveAllData(data);

    return null;
  }

  async function setCurrentContext(context) {
    const data = await getAllData();
    const nextContext = Object.assign({
      supported: false,
      updatedAt: Date.now()
    }, context || {});

    data.currentContext = nextContext;
    data.currentSessionKey = nextContext.supported && nextContext.sessionKey ? nextContext.sessionKey : "";
    await saveAllData(data);

    return nextContext;
  }

  async function setPendingEditItem(sessionKey, itemId) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    data.currentContext = Object.assign({}, data.currentContext || {}, {
      supported: Boolean(session),
      siteId: session ? session.siteId : "",
      siteName: session ? session.siteName : "",
      conversationId: session ? session.conversationId || "" : "",
      sessionKey: sessionKey || "",
      pendingEditItemId: itemId || "",
      updatedAt: Date.now()
    });
    data.currentSessionKey = sessionKey || "";
    await saveAllData(data);

    return data.currentContext;
  }

  async function getSession(sessionKey) {
    const data = await getAllData();
    return data.sessions[sessionKey] || null;
  }

  async function getCurrentSession() {
    const data = await getAllData();
    return data.currentSessionKey ? data.sessions[data.currentSessionKey] || null : null;
  }

  async function addItemToSession(sessionDraft, item) {
    const data = await getAllData();
    const existing = data.sessions[sessionDraft.sessionKey];
    const session = existing
      ? Object.assign({}, existing, {
          siteId: sessionDraft.siteId,
          siteName: sessionDraft.siteName,
          conversationId: sessionDraft.conversationId || existing.conversationId || "",
          sourceUrl: sessionDraft.sourceUrl,
          sourceTitle: sessionDraft.sourceTitle,
          titleEditedByUser: Boolean(existing.titleEditedByUser),
          focusItemId: existing.focusItemId || "",
          items: Array.isArray(existing.items) ? existing.items.slice() : []
        })
      : Object.assign({}, sessionDraft, {
          titleEditedByUser: Boolean(sessionDraft.titleEditedByUser),
          focusItemId: sessionDraft.focusItemId || "",
          items: []
        });

    if (existing && !existing.titleEditedByUser) {
      session.title = sessionDraft.title;
    }

    session.items.push(item);
    session.updatedAt = Date.now();
    data.sessions[session.sessionKey] = session;
    data.currentSessionKey = session.sessionKey;
    data.currentContext = {
      supported: true,
      siteId: session.siteId,
      siteName: session.siteName,
      conversationId: session.conversationId || "",
      sessionKey: session.sessionKey,
      url: session.sourceUrl,
      title: session.sourceTitle || session.title,
      updatedAt: Date.now()
    };
    await saveAllData(data);

    return { session, item };
  }

  async function updateSessionTitle(sessionKey, title) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    if (!session) {
      throw new Error("当前会话不存在");
    }

    session.title = compass.normalizeSessionTitle ? compass.normalizeSessionTitle(title) : String(title || "").trim();
    session.titleEditedByUser = true;
    session.updatedAt = Date.now();
    data.sessions[sessionKey] = session;
    await saveAllData(data);

    return session;
  }

  async function updateItem(sessionKey, itemId, updates) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    if (!session) {
      throw new Error("当前会话不存在");
    }

    const items = Array.isArray(session.items) ? session.items : [];
    const index = items.findIndex((item) => item.id === itemId);

    if (index < 0) {
      throw new Error("记录不存在");
    }

    const nextItem = Object.assign({}, items[index], updates, {
      updatedAt: Date.now()
    });

    if (!String(nextItem.content || "").trim() && !(Array.isArray(nextItem.attachments) && nextItem.attachments.length)) {
      throw new Error("内容不能为空");
    }

    items[index] = nextItem;
    session.items = items;
    session.updatedAt = Date.now();
    data.sessions[sessionKey] = session;
    await saveAllData(data);

    return nextItem;
  }

  async function setSessionFocusItem(sessionKey, itemId) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    if (!session) {
      throw new Error("当前会话不存在");
    }

    if (itemId && !(session.items || []).some((item) => item.id === itemId)) {
      throw new Error("记录不存在");
    }

    session.focusItemId = itemId || "";
    session.updatedAt = Date.now();
    data.sessions[sessionKey] = session;
    await saveAllData(data);

    return session;
  }

  async function clearAllData() {
    if (compass.attachments && compass.attachments.clearAllAttachments) {
      await compass.attachments.clearAllAttachments();
    }

    const emptySessions = {};
    const data = {
      sessions: emptySessions,
      currentSessionKey: "",
      currentContext: {
        supported: false,
        updatedAt: Date.now()
      },
      settings: normalizeSettings({}),
      meta: {
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
        lastMigratedAt: Date.now(),
        migrationError: ""
      }
    };

    await storageRemove(["migrationBackup_v0_6"]);
    await saveAllData(data);

    return data;
  }

  async function deleteItem(sessionKey, itemId) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    if (!session) {
      throw new Error("当前会话不存在");
    }

    const items = Array.isArray(session.items) ? session.items : [];
    const deletedItem = items.find((item) => item.id === itemId);
    const deletedAttachments = deletedItem && Array.isArray(deletedItem.attachments)
      ? deletedItem.attachments
      : [];

    if (compass.attachments && compass.attachments.deleteImage) {
      await Promise.all(deletedAttachments.map((attachment) => {
        return attachment.storageKey ? compass.attachments.deleteImage(attachment.storageKey) : Promise.resolve();
      })).catch(() => undefined);
    }

    session.items = items.filter((item) => item.id !== itemId);
    if (session.focusItemId === itemId) {
      session.focusItemId = "";
    }
    session.updatedAt = Date.now();
    data.sessions[sessionKey] = session;
    await saveAllData(data);

    return session;
  }

  async function clearSessionItems(sessionKey) {
    const data = await getAllData();
    const session = data.sessions[sessionKey];

    if (!session) {
      throw new Error("当前会话不存在");
    }

    const deletedAttachments = (Array.isArray(session.items) ? session.items : []).flatMap((item) => {
      return Array.isArray(item.attachments) ? item.attachments : [];
    });

    if (compass.attachments && compass.attachments.deleteImage) {
      await Promise.all(deletedAttachments.map((attachment) => {
        return attachment.storageKey ? compass.attachments.deleteImage(attachment.storageKey) : Promise.resolve();
      })).catch(() => undefined);
    }

    session.items = [];
    session.focusItemId = "";
    session.updatedAt = Date.now();
    data.sessions[sessionKey] = session;
    await saveAllData(data);

    return session;
  }

  const api = {
    getAllData,
    saveAllData,
    getStorageStats,
    assertNonDestructiveMigration,
    migrateRawDataToV6,
    migrateStorageToV6,
    buildBackupExport,
    exportBackupJson,
    getSettings,
    updateSettings,
    ensureSession,
    setCurrentSession,
    clearCurrentSession,
    setCurrentContext,
    setPendingEditItem,
    getSession,
    getCurrentSession,
    addItemToSession,
    updateSessionTitle,
    updateItem,
    setSessionFocusItem,
    deleteItem,
    clearSessionItems,
    clearAllData
  };

  root.AICompass = Object.assign(root.AICompass || {}, {
    storage: api
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
