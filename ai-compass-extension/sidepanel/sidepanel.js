(function initSidePanel() {
  "use strict";

  const compass = globalThis.AICompass;
  const state = {
    session: null,
    editingItemId: "",
    expandedItemIds: new Set(),
    plainTextItemIds: new Set(),
    preserveNextStorageRender: false,
    sessionDetailsOpen: false,
    settingsOpen: false,
    forceShowOnboarding: false,
    activeFilter: "all",
    openMenuItemId: "",
    addAttachments: [],
    imageViewerUrl: "",
    settings: Object.assign({}, compass.DEFAULT_SETTINGS),
    storageStats: { sessionCount: 0, itemCount: 0 },
    meta: { schemaVersion: 6, appVersion: "0.6.2" }
  };

  const elements = {
    settingsButton: document.getElementById("settings-button"),
    settingsView: document.getElementById("settings-view"),
    backToMainButton: document.getElementById("back-to-main-button"),
    sessionDetails: document.getElementById("session-details"),
    sessionSummaryTitle: document.getElementById("session-summary-title"),
    toggleSessionDetails: document.getElementById("toggle-session-details"),
    sessionTitleInput: document.getElementById("session-title-input"),
    saveTitleButton: document.getElementById("save-title-button"),
    siteName: document.getElementById("site-name"),
    sourceTitle: document.getElementById("source-title"),
    copyMarkdownButton: document.getElementById("copy-markdown-button"),
    exportMarkdownButton: document.getElementById("export-markdown-button"),
    defaultTypeSetting: document.getElementById("default-type-setting"),
    showLocateSetting: document.getElementById("show-locate-setting"),
    keepRichTextSetting: document.getElementById("keep-rich-text-setting"),
    showOnboardingButton: document.getElementById("show-onboarding-button"),
    exportBackupButton: document.getElementById("export-backup-button"),
    settingsClearAllButton: document.getElementById("settings-clear-all-button"),
    settingsSessionCount: document.getElementById("settings-session-count"),
    settingsItemCount: document.getElementById("settings-item-count"),
    settingsSchemaVersion: document.getElementById("settings-schema-version"),
    settingsAppVersion: document.getElementById("settings-app-version"),
    imageViewer: document.getElementById("image-viewer"),
    imageViewerTitle: document.getElementById("image-viewer-title"),
    imageViewerImage: document.getElementById("image-viewer-image"),
    imageViewerClose: document.getElementById("image-viewer-close"),
    onboardingPanel: document.getElementById("onboarding-panel"),
    dismissOnboardingButton: document.getElementById("dismiss-onboarding-button"),
    focusRoot: document.getElementById("focus-root"),
    categoryNav: document.getElementById("category-nav"),
    addItemForm: document.getElementById("add-item-form"),
    addType: document.getElementById("add-type"),
    addContent: document.getElementById("add-content"),
    addAttachmentList: document.getElementById("add-attachment-list"),
    addNote: document.getElementById("add-note"),
    addItemButton: document.getElementById("add-item-button"),
    statusMessage: document.getElementById("status-message"),
    emptyState: document.getElementById("empty-state"),
    sectionsRoot: document.getElementById("sections-root")
  };
  const FILTER_TYPES = [
    { value: "all", label: "全部" },
    { value: "goal", label: "本轮目标" },
    { value: "insight", label: "关键结论" },
    { value: "question", label: "待追问" },
    { value: "todo", label: "待办事项" },
    { value: "quote", label: "原文摘录" }
  ];
  const EDITABLE_TYPES = FILTER_TYPES.filter((type) => type.value !== "all");

  function setStatus(message, tone) {
    elements.statusMessage.textContent = message || "";
    elements.statusMessage.dataset.tone = tone || "";

    if (message) {
      window.setTimeout(() => {
        if (elements.statusMessage.textContent === message) {
          elements.statusMessage.textContent = "";
          elements.statusMessage.dataset.tone = "";
        }
      }, 2200);
    }
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

  function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function populateTypeSelect(select, selectedValue) {
    select.replaceChildren();

    EDITABLE_TYPES.forEach((type) => {
      select.appendChild(createOption(type.value, type.label));
    });

    select.value = EDITABLE_TYPES.some((type) => type.value === selectedValue) ? selectedValue : "quote";
  }

  function setControlsEnabled(enabled) {
    [
      elements.toggleSessionDetails,
      elements.sessionTitleInput,
      elements.saveTitleButton,
      elements.copyMarkdownButton,
      elements.exportMarkdownButton,
      elements.addType,
      elements.addContent,
      elements.addNote,
      elements.addItemButton
    ].forEach((element) => {
      element.disabled = !enabled;
    });
  }

  function getSessionItems() {
    if (!state.session || !Array.isArray(state.session.items)) {
      return [];
    }

    return state.session.items;
  }

  function getFocusItem() {
    const focusItemId = state.session && state.session.focusItemId;

    if (!focusItemId) {
      return null;
    }

    return getSessionItems().find((item) => item.id === focusItemId) || null;
  }

  function getVisibleItems() {
    const focusItem = getFocusItem();
    return getSessionItems().filter((item) => {
      if (focusItem && item.id === focusItem.id) {
        return false;
      }

      return state.activeFilter === "all" || item.type === state.activeFilter;
    });
  }

  function getFilterCount(type) {
    const items = getSessionItems();

    if (type === "all") {
      return items.length;
    }

    return items.filter((item) => item.type === type).length;
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className || "mini-button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function createTextarea(value, rows) {
    const textarea = document.createElement("textarea");
    textarea.className = "textarea-input";
    textarea.rows = rows || 4;
    textarea.value = value || "";
    return textarea;
  }

  function getItemAttachments(item) {
    return Array.isArray(item.attachments) ? item.attachments : [];
  }

  function cleanupAddAttachments() {
    state.addAttachments.forEach((attachment) => {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    });
    state.addAttachments = [];
    renderAddAttachments();
  }

  function renderAddAttachments() {
    elements.addAttachmentList.textContent = "";
    elements.addAttachmentList.hidden = state.addAttachments.length === 0;

    state.addAttachments.forEach((attachment) => {
      const tile = document.createElement("div");
      tile.className = "attachment-tile";
      const image = document.createElement("img");
      image.alt = "";
      image.src = attachment.previewUrl;
      const info = document.createElement("div");
      const name = document.createElement("span");
      const size = document.createElement("small");
      const remove = createButton("移除", "mini-button attachment-remove", () => {
        URL.revokeObjectURL(attachment.previewUrl);
        state.addAttachments = state.addAttachments.filter((item) => item.id !== attachment.id);
        renderAddAttachments();
      });

      name.textContent = attachment.name;
      size.textContent = compass.attachments.formatBytes(attachment.size);
      info.append(name, size);
      tile.append(image, info, remove);
      elements.addAttachmentList.appendChild(tile);
    });
  }

  function getClipboardImageFiles(event) {
    const items = event.clipboardData && event.clipboardData.items
      ? Array.from(event.clipboardData.items)
      : [];
    const files = event.clipboardData && event.clipboardData.files
      ? Array.from(event.clipboardData.files)
      : [];
    const itemFiles = items
      .filter((item) => item.kind === "file" && compass.attachments.isImageMimeType(item.type))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    const directFiles = files.filter((file) => compass.attachments.isImageMimeType(file.type));
    const seen = new Set();

    return itemFiles.concat(directFiles).filter((file) => {
      const key = `${file.name || ""}:${file.type}:${file.size}`;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function handleAddContentPaste(event) {
    const files = getClipboardImageFiles(event);

    if (!files.length) {
      const hasImageLikeItem = event.clipboardData && event.clipboardData.items
        ? Array.from(event.clipboardData.items).some((item) => String(item.type || "").startsWith("image/"))
        : false;

      if (hasImageLikeItem) {
        setStatus("没有读取到可保存的图片，请尝试复制 PNG/JPEG 截图后再粘贴", "error");
      }
      return;
    }

    event.preventDefault();

    files.forEach((file) => {
      if (file.size > compass.attachments.MAX_IMAGE_BYTES) {
        setStatus(`图片过大：${file.name || "剪贴板图片"}，请控制在 ${compass.attachments.formatBytes(compass.attachments.MAX_IMAGE_BYTES)} 以内`, "error");
        return;
      }

      state.addAttachments.push({
        id: compass.createId("draft-img"),
        file,
        name: file.name || `clipboard-${state.addAttachments.length + 1}.png`,
        size: file.size,
        mimeType: file.type,
        previewUrl: URL.createObjectURL(file)
      });
    });

    renderAddAttachments();

    if (files.length) {
      setStatus("图片已添加为附件", "success");
    }
  }

  function closeImageViewer() {
    elements.imageViewer.hidden = true;
    elements.imageViewerImage.removeAttribute("src");
    elements.imageViewerImage.alt = "";
    elements.imageViewerTitle.textContent = "图片附件";

    if (state.imageViewerUrl) {
      URL.revokeObjectURL(state.imageViewerUrl);
      state.imageViewerUrl = "";
    }
  }

  async function openImageViewer(attachment) {
    if (!attachment.storageKey || !compass.attachments.getImageObjectUrl) {
      setStatus("图片附件不可打开", "error");
      return;
    }

    try {
      const url = await compass.attachments.getImageObjectUrl(attachment.storageKey);

      if (!url) {
        setStatus("图片附件不存在或已被清理", "error");
        return;
      }

      if (state.imageViewerUrl) {
        URL.revokeObjectURL(state.imageViewerUrl);
      }

      state.imageViewerUrl = url;
      elements.imageViewerTitle.textContent = attachment.name || "图片附件";
      elements.imageViewerImage.alt = attachment.name || "图片附件";
      elements.imageViewerImage.src = url;
      elements.imageViewer.hidden = false;
      elements.imageViewerClose.focus();
    } catch (error) {
      setStatus(error.message || "打开图片失败", "error");
    }
  }

  function renderItemAttachments(card, item) {
    const attachments = getItemAttachments(item);

    if (!attachments.length) {
      return;
    }

    const list = document.createElement("div");
    list.className = "item-attachments";

    attachments.forEach((attachment) => {
      const figure = document.createElement("button");
      figure.type = "button";
      figure.className = "item-attachment";
      figure.title = "打开图片附件";
      figure.addEventListener("click", () => {
        openImageViewer(attachment);
      });
      const placeholder = document.createElement("div");
      placeholder.className = "attachment-placeholder";
      placeholder.textContent = "图片附件";
      const caption = document.createElement("figcaption");

      caption.textContent = `${attachment.name || "图片"} · ${compass.attachments.formatBytes(attachment.size)}`;
      figure.append(placeholder, caption);
      list.appendChild(figure);

      if (!attachment.storageKey || !compass.attachments.getImageObjectUrl) {
        return;
      }

      compass.attachments.getImageObjectUrl(attachment.storageKey).then((url) => {
        if (!url) {
          return;
        }

        const image = document.createElement("img");
        image.alt = attachment.name || "图片附件";
        image.src = url;
        image.addEventListener("load", () => {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, { once: true });
        placeholder.replaceWith(image);
      }).catch(() => undefined);
    });

    card.appendChild(list);
  }

  async function locateSourceItem(item) {
    if (!state.session || !item.fromSelection) {
      return;
    }

    try {
      await sendMessage("LOCATE_SOURCE_ITEM", {
        sessionKey: state.session.sessionKey,
        itemId: item.id
      });
      setStatus("已定位到原文位置", "success");
    } catch (error) {
      setStatus(error.message || "定位失败，请确认已打开原会话页面", "error");
    }
  }

  function getScrollElement() {
    return document.scrollingElement || document.documentElement || document.body;
  }

  function captureScrollPosition() {
    const scrollElement = getScrollElement();

    return {
      left: scrollElement.scrollLeft,
      top: scrollElement.scrollTop
    };
  }

  function restoreScrollPosition(position) {
    if (!position) {
      return;
    }

    const scrollElement = getScrollElement();
    scrollElement.scrollLeft = position.left;
    scrollElement.scrollTop = position.top;
  }

  function getItemCardById(itemId) {
    return Array.from(elements.sectionsRoot.querySelectorAll("[data-item-id]")).find((node) => {
      return node.dataset.itemId === itemId;
    });
  }

  function focusItemAfterRender(itemId) {
    if (!itemId) {
      return;
    }

    window.requestAnimationFrame(() => {
      const card = getItemCardById(itemId);

      if (!card) {
        return;
      }

      const scrollElement = getScrollElement();
      const top = card.getBoundingClientRect().top + scrollElement.scrollTop - 16;
      scrollElement.scrollTop = Math.max(0, top);
      card.classList.add("is-focused");

      window.setTimeout(() => {
        card.classList.remove("is-focused");
      }, 1800);
    });
  }

  function getNewSelectionItemId(changes) {
    if (!changes.sessions || !changes.sessions.newValue) {
      return "";
    }

    const sessionKey = changes.currentSessionKey && changes.currentSessionKey.newValue
      ? changes.currentSessionKey.newValue
      : state.session && state.session.sessionKey;

    if (!sessionKey) {
      return "";
    }

    const previousSession = changes.sessions.oldValue && changes.sessions.oldValue[sessionKey];
    const nextSession = changes.sessions.newValue && changes.sessions.newValue[sessionKey];

    if (!nextSession || !Array.isArray(nextSession.items)) {
      return "";
    }

    const previousIds = new Set(((previousSession && previousSession.items) || []).map((item) => item.id));
    const addedItems = nextSession.items.filter((item) => item.fromSelection && !previousIds.has(item.id));

    if (!addedItems.length) {
      return "";
    }

    return addedItems[addedItems.length - 1].id;
  }

  function renderItemContent(card, item) {
    if (state.editingItemId === item.id) {
      const contentInput = createTextarea(item.content, 5);
      const noteInput = createTextarea(item.note || "", 2);
      const noteLabel = document.createElement("label");
      noteLabel.className = "field-label";
      noteLabel.textContent = "备注";
      const actions = document.createElement("div");
      actions.className = "edit-actions";

      actions.append(
        createButton("保存", "mini-button", async () => {
          const content = contentInput.value.trim();

          if (!content) {
            setStatus("内容不能为空", "error");
            return;
          }

          try {
            state.preserveNextStorageRender = true;
            await compass.storage.updateItem(state.session.sessionKey, item.id, {
              content,
              contentHtml: "",
              note: noteInput.value.trim()
            });
            state.editingItemId = "";
            await loadSession({ preserveScroll: true });
            setStatus("记录已保存", "success");
          } catch (error) {
            state.preserveNextStorageRender = false;
            setStatus(error.message || "保存失败，请重试", "error");
          }
        }),
        createButton("取消", "mini-button", () => {
          state.editingItemId = "";
          render({ preserveScroll: true });
        })
      );

      card.append(contentInput, noteLabel, noteInput, actions);
      return;
    }

    const content = document.createElement("div");
    const itemContent = String(item.content || "");
    const shouldCollapse = itemContent.length > 260 && !state.expandedItemIds.has(item.id);
    const isPlainTextMode = state.plainTextItemIds.has(item.id);
    const hasRichPreview = Boolean(item.contentHtml) || compass.looksLikeMarkdown(item.content);
    content.className = isPlainTextMode || !hasRichPreview ? "item-content" : "item-preview";

    if (item.relationType && item.relationType !== "standalone") {
      const relation = document.createElement("span");
      relation.className = "relation-chip";
      relation.textContent = "相关内容";
      card.appendChild(relation);
    }

    if (isPlainTextMode || !hasRichPreview) {
      content.textContent = shouldCollapse ? `${itemContent.slice(0, 260)}...` : itemContent;
    } else {
      const previewHtml = item.contentHtml || compass.markdownToSafeHtml(item.content);
      compass.appendSafeHtml(content, previewHtml);
    }

    card.appendChild(content);
    renderItemAttachments(card, item);

    if (item.note) {
      const note = document.createElement("div");
      note.className = "item-note";
      note.textContent = item.note;
      card.appendChild(note);
    }

    if (itemContent.length > 260) {
      const expanded = state.expandedItemIds.has(item.id);
      const toggle = createButton(expanded ? "折叠" : "展开", "mini-button", () => {
        if (expanded) {
          state.expandedItemIds.delete(item.id);
        } else {
          state.expandedItemIds.add(item.id);
        }
        render({ preserveScroll: true });
      });
      toggle.style.marginTop = "8px";
      card.appendChild(toggle);
    }
  }

  async function setFocusItem(itemId) {
    if (!state.session) {
      return;
    }

    try {
      state.openMenuItemId = "";
      await compass.storage.setSessionFocusItem(state.session.sessionKey, itemId || "");
      await loadSession({ preserveScroll: true });
      setStatus(itemId ? "已设为当前重点" : "已取消当前重点", "success");
    } catch (error) {
      setStatus(error.message || "当前重点更新失败", "error");
    }
  }

  async function deleteItem(item) {
    const confirmed = window.confirm("确认删除这条指南针记录吗？此操作不可撤销。");

    if (!confirmed) {
      return;
    }

    try {
      state.openMenuItemId = "";
      await compass.storage.deleteItem(state.session.sessionKey, item.id);
      await loadSession();
      setStatus("记录已删除", "success");
    } catch (error) {
      setStatus(error.message || "删除失败，请重试", "error");
    }
  }

  function togglePlainTextMode(item) {
    if (state.plainTextItemIds.has(item.id)) {
      state.plainTextItemIds.delete(item.id);
    } else {
      state.plainTextItemIds.add(item.id);
    }
    state.openMenuItemId = "";
    render({ preserveScroll: true });
  }

  function createMenuButton(label, onClick, danger) {
    return createButton(label, danger ? "menu-item danger" : "menu-item", onClick);
  }

  function renderItemMenu(card, item, isFocusItem) {
    if (state.openMenuItemId !== item.id || state.editingItemId === item.id) {
      return;
    }

    const menu = document.createElement("div");
    menu.className = "item-menu";

    const typeSelect = document.createElement("select");
    typeSelect.className = "select-input menu-select";
    populateTypeSelect(typeSelect, item.type);
    typeSelect.addEventListener("change", async () => {
      try {
        await compass.storage.updateItem(state.session.sessionKey, item.id, {
          type: typeSelect.value
        });
        state.openMenuItemId = "";
        await loadSession({ preserveScroll: true });
        setStatus("分类已更新", "success");
      } catch (error) {
        setStatus(error.message || "分类更新失败", "error");
      }
    });

    menu.append(
      createMenuButton(isFocusItem ? "取消当前重点" : "设为当前重点", () => {
        setFocusItem(isFocusItem ? "" : item.id);
      }),
      createMenuButton("编辑内容", () => {
        state.editingItemId = item.id;
        state.openMenuItemId = "";
        render({ preserveScroll: true });
      })
    );

    menu.appendChild(typeSelect);

    if (Boolean(item.contentHtml) || compass.looksLikeMarkdown(item.content)) {
      menu.appendChild(createMenuButton(state.plainTextItemIds.has(item.id) ? "切换预览" : "查看纯文本", () => {
        togglePlainTextMode(item);
      }));
    }

    if (item.fromSelection && state.settings.showLocateBeta !== false) {
      menu.appendChild(createMenuButton("定位 Beta", () => {
        state.openMenuItemId = "";
        render({ preserveScroll: true });
        locateSourceItem(item);
      }));
    }

    menu.appendChild(createMenuButton("删除", () => {
      deleteItem(item);
    }, true));

    card.appendChild(menu);
  }

  function renderItemCard(item, options) {
    const cardOptions = options || {};
    const isFocusItem = Boolean(cardOptions.isFocusItem);
    const card = document.createElement("article");
    card.className = isFocusItem ? "item-card focus-card" : "item-card";
    card.dataset.itemId = item.id;

    const meta = document.createElement("div");
    meta.className = "item-meta";

    const label = document.createElement("span");
    label.textContent = compass.ITEM_TYPE_LABELS[item.type] || "原文摘录";

    const time = document.createElement("time");
    time.dateTime = new Date(item.createdAt).toISOString();
    time.textContent = compass.formatTimestamp(item.createdAt);

    const menuButton = createButton(state.openMenuItemId === item.id ? "收起" : "编辑", "mini-button edit-menu-button", () => {
      state.openMenuItemId = state.openMenuItemId === item.id ? "" : item.id;
      render({ preserveScroll: true });
    });

    const timeWrap = document.createElement("span");
    timeWrap.append(time);
    meta.append(label, timeWrap, menuButton);
    card.appendChild(meta);
    renderItemContent(card, item);
    renderItemMenu(card, item, isFocusItem);

    return card;
  }

  function renderSettings() {
    populateTypeSelect(elements.defaultTypeSetting, state.settings.defaultItemType || "quote");
    elements.showLocateSetting.checked = state.settings.showLocateBeta !== false;
    elements.keepRichTextSetting.checked = state.settings.keepRichTextByDefault !== false;
    elements.settingsSessionCount.textContent = String(state.storageStats.sessionCount || 0);
    elements.settingsItemCount.textContent = String(state.storageStats.itemCount || 0);
    elements.settingsSchemaVersion.textContent = String(state.meta.schemaVersion || 6);
    elements.settingsAppVersion.textContent = state.meta.appVersion || "0.6.2";
  }

  function renderCategoryNav() {
    elements.categoryNav.replaceChildren();

    FILTER_TYPES.forEach((type) => {
      const button = document.createElement("button");
      const label = document.createElement("span");
      const count = document.createElement("span");

      button.type = "button";
      button.className = state.activeFilter === type.value ? "category-pill is-active" : "category-pill";
      label.textContent = type.label;
      count.className = "category-count";
      count.textContent = String(getFilterCount(type.value));
      button.append(label, count);
      button.addEventListener("click", () => {
        state.activeFilter = type.value;
        state.openMenuItemId = "";
        render({ preserveScroll: true });
      });
      elements.categoryNav.appendChild(button);
    });
  }

  function renderFocusRoot() {
    elements.focusRoot.replaceChildren();
    const focusItem = getFocusItem();

    if (!focusItem || state.settingsOpen) {
      elements.focusRoot.hidden = true;
      return;
    }

    const eyebrow = document.createElement("div");
    const label = document.createElement("span");
    const type = document.createElement("span");

    eyebrow.className = "focus-eyebrow";
    label.textContent = "当前重点";
    type.textContent = compass.ITEM_TYPE_LABELS[focusItem.type] || "原文摘录";
    eyebrow.append(label, type);

    const card = renderItemCard(focusItem, { isFocusItem: true });
    card.prepend(eyebrow);
    elements.focusRoot.appendChild(card);
    elements.focusRoot.hidden = false;
  }

  function renderItemsList(items) {
    elements.sectionsRoot.replaceChildren();

    if (!items.length) {
      const empty = document.createElement("section");
      const title = document.createElement("h2");
      const text = document.createElement("p");

      empty.className = "empty-state inline-empty";
      title.textContent = state.activeFilter === "all" ? "当前会话还没有可展示内容。" : "当前分类还没有内容。";
      text.textContent = state.activeFilter === "all"
        ? "你可以在 AI Chat 页面中选中文本收集，或手动新增一条上下文记录。"
        : "切换到其他分类，或把已有记录改到这个分类。";
      empty.append(title, text);
      elements.sectionsRoot.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      elements.sectionsRoot.appendChild(renderItemCard(item));
    });
  }

  function render(options) {
    const renderOptions = options || {};
    const scrollPosition = renderOptions.preserveScroll ? captureScrollPosition() : null;
    const focusItemId = renderOptions.focusItemId || "";
    const hasSession = Boolean(state.session);
    const items = hasSession && Array.isArray(state.session.items) ? state.session.items : [];
    const showOnboarding = hasSession
      && !state.settingsOpen
      && (state.forceShowOnboarding || (items.length === 0 && !state.settings.onboardingDismissed));

    setControlsEnabled(hasSession);
    elements.settingsView.hidden = !state.settingsOpen;
    document.querySelector(".session-strip").hidden = state.settingsOpen;
    elements.addItemForm.closest(".add-panel").hidden = state.settingsOpen;
    elements.sessionTitleInput.value = hasSession ? state.session.title || "" : "";
    elements.siteName.textContent = hasSession ? state.session.siteName || "-" : "-";
    elements.sessionSummaryTitle.textContent = hasSession ? state.session.title || "AI Chat 记录" : "等待支持站点";
    elements.sourceTitle.textContent = hasSession ? state.session.sourceTitle || "-" : "-";
    elements.sessionDetails.hidden = !state.sessionDetailsOpen || !hasSession;
    elements.toggleSessionDetails.textContent = state.sessionDetailsOpen ? "收起" : "编辑";
    elements.toggleSessionDetails.setAttribute("aria-expanded", state.sessionDetailsOpen && hasSession ? "true" : "false");
    if (!elements.addContent.value.trim() && !elements.addNote.value.trim() && !state.addAttachments.length) {
      elements.addType.value = state.settings.defaultItemType || "quote";
    }
    elements.onboardingPanel.hidden = !showOnboarding;
    elements.emptyState.hidden = showOnboarding || (hasSession && items.length > 0);
    renderSettings();
    elements.categoryNav.hidden = state.settingsOpen || !hasSession || showOnboarding;
    renderFocusRoot();
    elements.emptyState.hidden = state.settingsOpen || elements.emptyState.hidden;
    elements.sectionsRoot.hidden = state.settingsOpen;
    elements.onboardingPanel.hidden = state.settingsOpen || elements.onboardingPanel.hidden;

    if (!hasSession) {
      state.sessionDetailsOpen = false;
      elements.sessionDetails.hidden = true;
      elements.toggleSessionDetails.textContent = "编辑";
      elements.toggleSessionDetails.setAttribute("aria-expanded", "false");
      elements.emptyState.hidden = state.settingsOpen;
      elements.emptyState.querySelector("h2").textContent = "当前页面暂不支持 AI Compass。";
      elements.emptyState.querySelector("p").textContent = "请切换到 ChatGPT、豆包、Claude、Gemini 或 Kimi 页面使用。";
      elements.focusRoot.hidden = true;
      elements.categoryNav.hidden = true;
      elements.sectionsRoot.replaceChildren();
      return;
    }

    elements.emptyState.querySelector("h2").textContent = "当前页面还没有收集内容。";
    elements.emptyState.querySelector("p").textContent =
      "你可以在 AI Chat 页面中选中文本，点击“收集到指南针”，或手动新增一条上下文记录。";

    renderCategoryNav();
    renderItemsList(getVisibleItems());

    if (focusItemId) {
      focusItemAfterRender(focusItemId);
    } else {
      restoreScrollPosition(scrollPosition);
    }
  }

  async function loadSession(options) {
    const data = await compass.storage.getAllData();
    state.settings = data.settings || Object.assign({}, compass.DEFAULT_SETTINGS);
    state.meta = data.meta || state.meta;
    state.storageStats = compass.storage.getStorageStats ? compass.storage.getStorageStats(data) : state.storageStats;
    state.session = data.currentSessionKey ? data.sessions[data.currentSessionKey] || null : null;
    render(options);
  }

  async function handleAddItem(event) {
    event.preventDefault();

    if (!state.session) {
      setStatus("当前没有可写入的会话", "error");
      return;
    }

    const content = elements.addContent.value.trim();
    if (!content && !state.addAttachments.length) {
      setStatus("内容或图片不能为空", "error");
      return;
    }

    const savedAttachments = [];


    try {
      for (const attachment of state.addAttachments) {
        savedAttachments.push(await compass.attachments.saveImageBlob(attachment.file, attachment.name));
      }

      const item = compass.createCompassItem({
        type: elements.addType.value,
        content,
        note: elements.addNote.value.trim(),
        sourceUrl: state.session.sourceUrl,
        sourceTitle: state.session.sourceTitle,
        siteId: state.session.siteId,
        siteName: state.session.siteName,
        fromSelection: false,
        attachments: savedAttachments
      });

      await compass.storage.addItemToSession(state.session, item);
      elements.addContent.value = "";
      elements.addNote.value = "";
      cleanupAddAttachments();
      await loadSession();
      setStatus("记录已新增", "success");
    } catch (error) {
      await Promise.all(savedAttachments.map((attachment) => {
        return attachment.storageKey ? compass.attachments.deleteImage(attachment.storageKey) : Promise.resolve();
      })).catch(() => undefined);
      setStatus(error.message || "新增失败，请重试", "error");
    }
  }

  async function copyMarkdown() {
    if (!state.session) {
      setStatus("当前没有可复制的会话", "error");
      return;
    }

    try {
      const markdown = compass.buildMarkdown(state.session, Date.now());
      await navigator.clipboard.writeText(markdown);
      const hasAttachments = getSessionItems().some((item) => getItemAttachments(item).length);
      setStatus(hasAttachments ? "Markdown 已复制，图片以 assets 路径引用" : "Markdown 已复制", "success");
    } catch (error) {
      setStatus(error.message || "复制失败，请重试", "error");
    }
  }

  async function exportMarkdown() {
    if (!state.session) {
      setStatus("当前没有可导出的会话", "error");
      return;
    }

    try {
      const result = await sendMessage("DOWNLOAD_MARKDOWN", {
        sessionKey: state.session.sessionKey
      });
      const assetCount = Array.isArray(result.assetDownloads) ? result.assetDownloads.length : 0;
      setStatus(assetCount ? `已创建下载：${result.filename}，并导出 ${assetCount} 张图片` : `已创建下载：${result.filename}`, "success");
    } catch (error) {
      setStatus(error.message || "导出失败，请重试", "error");
    }
  }

  async function clearAll() {
    const confirmed = window.confirm([
      "确认清空全部本地数据吗？",
      "",
      "这将删除 AI Compass 在本地保存的所有会话、收藏内容和后台元数据。",
      "该操作不可恢复。"
    ].join("\n"));

    if (!confirmed) {
      return;
    }

    const verification = window.prompt("请输入“清空全部”确认删除所有本地数据。");

    if (verification !== "清空全部") {
      setStatus("已取消清空全部", "success");
      return;
    }

    try {
      await compass.storage.clearAllData();
      state.expandedItemIds.clear();
      state.plainTextItemIds.clear();
      await loadSession();
      setStatus("全部本地记录已清空", "success");
    } catch (error) {
      setStatus(error.message || "清空全部失败，请重试", "error");
    }
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function exportBackup() {
    try {
      const backup = await sendMessage("EXPORT_BACKUP_JSON");
      downloadJson(`AI-Compass-backup-${compass.formatCompactTimestamp(Date.now())}.json`, backup);
      await loadSession();
      setStatus("全部备份已导出", "success");
    } catch (error) {
      setStatus(error.message || "备份导出失败", "error");
    }
  }

  async function updateSetting(updates) {
    try {
      state.settings = await compass.storage.updateSettings(updates);
      await loadSession({ preserveScroll: true });
      setStatus("设置已保存", "success");
    } catch (error) {
      setStatus(error.message || "设置保存失败", "error");
    }
  }

  async function dismissOnboarding() {
    state.forceShowOnboarding = false;
    await updateSetting({ onboardingDismissed: true });
  }

  async function showOnboardingAgain() {
    state.forceShowOnboarding = true;
    state.settingsOpen = false;
    await updateSetting({ onboardingDismissed: false });
  }

  async function saveTitle() {
    if (!state.session) {
      setStatus("当前没有可编辑的会话", "error");
      return;
    }

    try {
      await compass.storage.updateSessionTitle(state.session.sessionKey, elements.sessionTitleInput.value);
      await loadSession();
      setStatus("会话标题已保存", "success");
    } catch (error) {
      setStatus(error.message || "标题保存失败", "error");
    }
  }

  function bindEvents() {
    populateTypeSelect(elements.addType, state.settings.defaultItemType || "quote");
    elements.addItemForm.addEventListener("submit", handleAddItem);
    elements.addItemForm.addEventListener("paste", handleAddContentPaste);
    elements.imageViewerClose.addEventListener("click", closeImageViewer);
    elements.imageViewer.addEventListener("click", (event) => {
      if (event.target === elements.imageViewer) {
        closeImageViewer();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.imageViewer.hidden) {
        closeImageViewer();
      }
    });
    elements.copyMarkdownButton.addEventListener("click", copyMarkdown);
    elements.exportMarkdownButton.addEventListener("click", exportMarkdown);
    elements.settingsClearAllButton.addEventListener("click", clearAll);
    elements.exportBackupButton.addEventListener("click", exportBackup);
    elements.dismissOnboardingButton.addEventListener("click", dismissOnboarding);
    elements.showOnboardingButton.addEventListener("click", showOnboardingAgain);
    elements.settingsButton.addEventListener("click", () => {
      state.settingsOpen = true;
      render({ preserveScroll: true });
    });
    elements.backToMainButton.addEventListener("click", () => {
      state.settingsOpen = false;
      render({ preserveScroll: true });
    });
    elements.defaultTypeSetting.addEventListener("change", () => updateSetting({
      defaultItemType: elements.defaultTypeSetting.value
    }));
    elements.showLocateSetting.addEventListener("change", () => updateSetting({
      showLocateBeta: elements.showLocateSetting.checked
    }));
    elements.keepRichTextSetting.addEventListener("change", () => updateSetting({
      keepRichTextByDefault: elements.keepRichTextSetting.checked
    }));
    elements.saveTitleButton.addEventListener("click", saveTitle);
    elements.toggleSessionDetails.addEventListener("click", () => {
      state.sessionDetailsOpen = !state.sessionDetailsOpen;
      render();
    });
    elements.sessionTitleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveTitle();
      }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.sessions || changes.currentSessionKey || changes.currentContext) {
        const preserveScroll = state.preserveNextStorageRender;
        const focusItemId = preserveScroll ? "" : getNewSelectionItemId(changes);
        const pendingEditItemId = changes.currentContext && changes.currentContext.newValue
          ? changes.currentContext.newValue.pendingEditItemId || ""
          : "";
        state.preserveNextStorageRender = false;

        if (pendingEditItemId) {
          state.editingItemId = pendingEditItemId;
        }

        loadSession({ preserveScroll, focusItemId: pendingEditItemId || focusItemId }).catch((error) => {
          setStatus(error.message || "刷新会话失败", "error");
        });
      }
    });
  }

  bindEvents();
  compass.storage.migrateStorageToV6()
    .catch((error) => {
      setStatus(error.message || "数据兼容检查失败，已尝试继续读取旧数据", "error");
    })
    .then(() => sendMessage("SYNC_ACTIVE_CONTEXT").catch(() => {}))
    .then(() => loadSession())
    .catch((error) => {
      setStatus(error.message || "加载失败，请重试", "error");
    });
})();
