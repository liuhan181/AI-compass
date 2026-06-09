const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ITEM_TYPES,
  DEFAULT_SETTINGS,
  sanitizeFileName,
  formatTimestamp
} = require("../utils/constants.js");
const {
  SITE_ADAPTERS,
  getSiteAdapterForUrl,
  getSessionKeyFromUrl
} = require("../utils/siteAdapters.js");
const {
  createId,
  createSessionDraft,
  normalizeSessionTitle
} = require("../utils/session.js");
const {
  buildMarkdown,
  buildMarkdownFileName,
  getAttachmentFileName,
  getAttachmentMarkdownPath,
  renderItemForMarkdown
} = require("../utils/markdown.js");
const attachmentUtils = require("../utils/attachments.js");
const {
  buildTurnAnchor,
  buildSelectionContext
} = require("../utils/anchors.js");
const {
  buildBlocksForMessage,
  buildConversationIndex,
  buildTurnMap,
  findBlockByAnchor,
  findIndexedBlockForSelection,
  findIndexedMessageForSelection,
  findMessageByAnchor
} = require("../utils/conversationIndex.js");
const {
  detectRelatedContent,
  getContentHash,
  normalizeForSimilarity
} = require("../utils/similarity.js");
const {
  escapeHtml,
  extractLocatorSnippets,
  richHtmlToMarkdownText,
  looksLikeMarkdown,
  markdownToSafeHtml,
  normalizeRichHtml
} = require("../utils/preview.js");
const storageUtils = require("../utils/storage.js");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

class FakeTextNode {
  constructor(text, parentElement) {
    this.nodeType = 3;
    this.textContent = text;
    this.parentElement = parentElement || null;
  }
}

class FakeElement {
  constructor(tagName, attrs, children) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = attrs || {};
    this.children = children || [];
    this.parentElement = null;
    this.id = this.attributes.id || "";
    this.children.forEach((child) => {
      child.parentElement = this;
    });
  }

  get textContent() {
    return this.children.map((child) => child.textContent || "").join("");
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  matches(selector) {
    return selector.split(",").some((part) => this.matchesOne(part.trim()));
  }

  matchesOne(selector) {
    if (!selector) {
      return false;
    }

    if (/^[a-z0-9]+$/i.test(selector)) {
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    const dataAttr = selector.match(/^\[([^\]=]+)\]$/);
    if (dataAttr) {
      return Boolean(this.getAttribute(dataAttr[1]));
    }

    const containsAttr = selector.match(/^\[([^\]=]+)\*='([^']+)'\]$/);
    if (containsAttr) {
      return this.getAttribute(containsAttr[1]).includes(containsAttr[2]);
    }

    const equalsAttr = selector.match(/^\[([^\]=]+)='([^']+)'\]$/);
    if (equalsAttr) {
      return this.getAttribute(equalsAttr[1]) === equalsAttr[2];
    }

    return false;
  }

  closest(selector) {
    let node = this;

    while (node) {
      if (node.matches && node.matches(selector)) {
        return node;
      }
      node = node.parentElement;
    }

    return null;
  }

  querySelectorAll(selector) {
    const results = [];

    function walk(node) {
      if (!node || node.nodeType !== 1) {
        return;
      }

      if (node.matches(selector)) {
        results.push(node);
      }

      node.children.forEach(walk);
    }

    this.children.forEach(walk);
    return results;
  }
}

function fakeElement(tagName, attrs, children) {
  return new FakeElement(tagName, attrs || {}, children || []);
}

function fakeText(text) {
  return new FakeTextNode(text);
}

test("constants expose the six PRD item categories", () => {
  assert.deepEqual(
    ITEM_TYPES.map((item) => item.value),
    ["goal", "insight", "method", "question", "todo", "quote"]
  );
  assert.equal(DEFAULT_SETTINGS.defaultItemType, "quote");
  assert.equal(DEFAULT_SETTINGS.autoOpenSidePanel, false);
  assert.equal(DEFAULT_SETTINGS.showLocateBeta, true);
  assert.equal(DEFAULT_SETTINGS.keepRichTextByDefault, true);
  assert.equal(DEFAULT_SETTINGS.onboardingDismissed, false);
});

test("site adapter recognizes supported AI chat hosts", () => {
  assert.equal(getSiteAdapterForUrl("https://chatgpt.com/c/abc").id, "chatgpt");
  assert.equal(getSiteAdapterForUrl("https://www.doubao.com/chat/123").id, "doubao");
  assert.equal(getSiteAdapterForUrl("https://claude.ai/chat/123").id, "claude");
  assert.equal(getSiteAdapterForUrl("https://gemini.google.com/app/123").id, "gemini");
  assert.equal(getSiteAdapterForUrl("https://kimi.moonshot.cn/chat/123").id, "kimi");
  assert.equal(getSiteAdapterForUrl("https://example.com/page"), null);
});

test("session key ignores query and hash", () => {
  assert.equal(
    getSessionKeyFromUrl("https://chatgpt.com/c/abc?model=o3#frag"),
    "https://chatgpt.com/c/abc"
  );
});

test("site adapter extracts conversation id when possible", () => {
  assert.equal(SITE_ADAPTERS.chatgpt.getConversationId("https://chatgpt.com/c/abc-123?model=o3"), "abc-123");
  assert.equal(SITE_ADAPTERS.doubao.getConversationId("https://www.doubao.com/chat/987"), "987");
  assert.equal(SITE_ADAPTERS.claude.getConversationId("https://claude.ai/chat/claude-id"), "claude-id");
  assert.equal(SITE_ADAPTERS.gemini.getConversationId("https://gemini.google.com/app/gemini-id"), "gemini-id");
  assert.equal(SITE_ADAPTERS.kimi.getConversationId("https://kimi.moonshot.cn/chat/kimi-id"), "kimi-id");
});

test("session draft keeps URL metadata and normalizes title", () => {
  const session = createSessionDraft({
    url: "https://chatgpt.com/c/abc?model=o3",
    title: "ChatGPT - useful thread",
    siteAdapter: SITE_ADAPTERS.chatgpt,
    now: 1710000000000
  });

  assert.equal(session.sessionKey, "https://chatgpt.com/c/abc");
  assert.equal(session.conversationId, "abc");
  assert.equal(session.siteName, "ChatGPT");
  assert.equal(session.title, "ChatGPT - useful thread");
  assert.equal(session.sourceUrl, "https://chatgpt.com/c/abc?model=o3");
  assert.equal(session.items.length, 0);
  assert.equal(normalizeSessionTitle(""), "AI Chat 记录");
  assert.match(createId("item"), /^item-[a-z0-9]+-[a-z0-9]+$/);
});

test("session items include v0.3 background metadata", () => {
  const item = createId("item");
  const created = require("../utils/session.js").createCompassItem({
    id: item,
    type: "quote",
    content: "AI Compass 是第二大脑",
    sourceUrl: "https://chatgpt.com/c/abc",
    sourceTitle: "ChatGPT",
    sessionKey: "https://chatgpt.com/c/abc",
    conversationId: "abc",
    selectedText: "AI Compass 是第二大脑",
    normalizedContent: "ai compass 是第二大脑",
    contentHash: "hash",
    prefixText: "前文",
    suffixText: "后文",
    turnId: "turn-1",
    turnIndex: 1,
    anchorConfidence: "medium",
    relationType: "standalone",
    relatedItemIds: ["item-a"],
    fromSelection: true
  });

  assert.equal(created.sessionKey, "https://chatgpt.com/c/abc");
  assert.equal(created.conversationId, "abc");
  assert.equal(created.selectedText, "AI Compass 是第二大脑");
  assert.equal(created.normalizedContent, "ai compass 是第二大脑");
  assert.equal(created.contentHash, "hash");
  assert.equal(created.prefixText, "前文");
  assert.equal(created.suffixText, "后文");
  assert.equal(created.turnId, "turn-1");
  assert.equal(created.turnIndex, 1);
  assert.equal(created.anchorConfidence, "medium");
  assert.equal(created.relationType, "standalone");
  assert.deepEqual(created.relatedItemIds, ["item-a"]);
});

test("session items keep optional timeline anchor metadata", () => {
  const created = require("../utils/session.js").createCompassItem({
    type: "quote",
    content: "第 7 节表格结论",
    anchorVersion: 2,
    messageRole: "assistant",
    messageFingerprint: "msg-fp",
    precedingUserFingerprint: "user-fp",
    blockIndex: 3,
    blockType: "table",
    blockFingerprint: "block-fp",
    fromSelection: true
  });

  assert.equal(created.anchorVersion, 2);
  assert.equal(created.messageRole, "assistant");
  assert.equal(created.messageFingerprint, "msg-fp");
  assert.equal(created.precedingUserFingerprint, "user-fp");
  assert.equal(created.blockIndex, 3);
  assert.equal(created.blockType, "table");
  assert.equal(created.blockFingerprint, "block-fp");
});

test("anchors degrade gracefully without DOM selection details", () => {
  const anchor = buildTurnAnchor(null, SITE_ADAPTERS.chatgpt, {
    url: "https://chatgpt.com/c/abc",
    title: "ChatGPT"
  });
  const selectionContext = buildSelectionContext(null);

  assert.equal(anchor.siteId, "chatgpt");
  assert.equal(anchor.conversationId, "abc");
  assert.equal(anchor.sessionKey, "https://chatgpt.com/c/abc");
  assert.equal(anchor.anchorConfidence, "low");
  assert.equal(selectionContext.prefixText, "");
  assert.equal(selectionContext.suffixText, "");
});

test("conversation index recognizes turns blocks and preceding user fingerprints", () => {
  const firstUser = fakeElement("article", { "data-message-author-role": "user", "data-message-id": "u1" }, [
    fakeElement("p", {}, [fakeText("请解释 ReAct 方法")])
  ]);
  const firstAssistant = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a1" }, [
    fakeElement("h2", {}, [fakeText("1. 一句话读懂这篇论文")]),
    fakeElement("p", {}, [fakeText("ReAct 把 Reasoning 和 Acting 交替组织起来。")])
  ]);
  const secondUser = fakeElement("article", { "data-message-author-role": "user", "data-message-id": "u2" }, [
    fakeElement("p", {}, [fakeText("继续解释第 7 节")])
  ]);
  const tableCell = fakeElement("td", {}, [fakeText("Ablation Study（消融实验）")]);
  const table = fakeElement("table", {}, [
    fakeElement("tr", {}, [
      fakeElement("th", {}, [fakeText("研究")]),
      fakeElement("th", {}, [fakeText("说明")])
    ]),
    fakeElement("tr", {}, [
      tableCell,
      fakeElement("td", {}, [fakeText("评估去掉组件后的影响")])
    ])
  ]);
  const secondAssistant = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a2" }, [
    fakeElement("h2", {}, [fakeText("7. 值得关注的实验")]),
    table
  ]);
  const body = fakeElement("main", {}, [firstUser, firstAssistant, secondUser, secondAssistant]);
  const doc = { body };
  const index = buildConversationIndex(doc, SITE_ADAPTERS.chatgpt);
  const selection = {
    rangeCount: 1,
    getRangeAt() {
      return { commonAncestorContainer: tableCell.children[0] };
    }
  };
  const selectedMessage = findIndexedMessageForSelection(selection, index);
  const selectedBlock = findIndexedBlockForSelection(selection, selectedMessage);

  assert.equal(index.messages.length, 4);
  assert.equal(index.messages[3].role, "assistant");
  assert.equal(index.messages[3].turnIndex, 3);
  assert.equal(index.messages[3].messageId, "a2");
  assert.equal(index.messages[3].precedingUserFingerprint, index.messages[2].messageFingerprint);
  assert.equal(selectedMessage.messageId, "a2");
  assert.equal(selectedBlock.blockType, "table");
  assert.equal(selectedBlock.blockIndex, 1);
  assert.equal(findMessageByAnchor({
    messageRole: "assistant",
    turnIndex: 3,
    messageFingerprint: index.messages[3].messageFingerprint
  }, index).messageId, "a2");
  assert.equal(findBlockByAnchor({
    blockType: "table",
    blockIndex: 1,
    blockFingerprint: selectedBlock.blockFingerprint
  }, selectedMessage).element, table);
});

test("turn map is lightweight and block index is built on demand", () => {
  const table = fakeElement("table", {}, [
    fakeElement("tr", {}, [
      fakeElement("td", {}, [fakeText("能力")]),
      fakeElement("td", {}, [fakeText("是否做")])
    ])
  ]);
  const assistant = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a-map" }, [
    fakeElement("h2", {}, [fakeText("7. MVP 功能")]),
    table
  ]);
  const turnMap = buildTurnMap({ body: fakeElement("main", {}, [assistant]) }, SITE_ADAPTERS.chatgpt);

  assert.equal(turnMap.messages.length, 1);
  assert.equal(turnMap.messages[0].messageId, "a-map");
  assert.equal(turnMap.messages[0].blocks, undefined);

  const blocks = buildBlocksForMessage(turnMap.messages[0].element);

  assert.equal(blocks[1].blockType, "table");
  assert.equal(blocks[1].element, table);
});

test("message matching prefers fingerprints before turn index fallback", () => {
  const originalTarget = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "target-old-id" }, [
    fakeElement("p", {}, [fakeText("目标回答：Turn Anchor 应该作为 MVP 增强项。")])
  ]);
  const originalMap = buildTurnMap({ body: fakeElement("main", {}, [originalTarget]) }, SITE_ADAPTERS.chatgpt);
  const anchor = {
    messageRole: "assistant",
    turnIndex: 0,
    messageFingerprint: originalMap.messages[0].messageFingerprint
  };
  const inserted = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "inserted" }, [
    fakeElement("p", {}, [fakeText("插入的新回答让 turnIndex 发生偏移。")])
  ]);
  const shiftedTarget = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "target-new-id" }, [
    fakeElement("p", {}, [fakeText("目标回答：Turn Anchor 应该作为 MVP 增强项。")])
  ]);
  const shiftedMap = buildTurnMap({ body: fakeElement("main", {}, [inserted, shiftedTarget]) }, SITE_ADAPTERS.chatgpt);

  assert.equal(findMessageByAnchor(anchor, shiftedMap).messageId, "target-new-id");
});

test("data-testid is not treated as a stable message id", () => {
  const message = fakeElement("article", { "data-testid": "conversation-turn-7" }, [
    fakeElement("p", {}, [fakeText("没有稳定消息 id 的回答")])
  ]);
  const turnMap = buildTurnMap({ body: fakeElement("main", {}, [message]) }, SITE_ADAPTERS.chatgpt);

  assert.equal(turnMap.messages[0].messageId, "");
});

test("conversation index can resolve legacy turn anchors without v2 metadata", () => {
  const first = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a1" }, [
    fakeElement("p", {}, [fakeText("第一节内容")])
  ]);
  const second = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a2" }, [
    fakeElement("p", {}, [fakeText("第七节内容")])
  ]);
  const index = buildConversationIndex({ body: fakeElement("main", {}, [first, second]) }, SITE_ADAPTERS.chatgpt);

  assert.equal(findMessageByAnchor({ turnId: "a2" }, index).messageId, "a2");
  assert.equal(findMessageByAnchor({ turnIndex: 1, messageRole: "assistant" }, index).messageId, "a2");
});

test("turn anchor uses conversation index when available", () => {
  const selectedText = fakeText("第七节的重要结论");
  const paragraph = fakeElement("p", {}, [selectedText]);
  const assistant = fakeElement("article", { "data-message-author-role": "assistant", "data-message-id": "a7" }, [
    fakeElement("h2", {}, [fakeText("7. 关键结论")]),
    paragraph
  ]);
  const body = fakeElement("main", {}, [assistant]);
  const index = buildConversationIndex({ body }, SITE_ADAPTERS.chatgpt);
  const selection = {
    rangeCount: 1,
    getRangeAt() {
      return {
        commonAncestorContainer: selectedText
      };
    }
  };

  const anchor = buildTurnAnchor(selection, SITE_ADAPTERS.chatgpt, {
    url: "https://chatgpt.com/c/abc",
    title: "ChatGPT",
    conversationIndex: index
  });

  assert.equal(anchor.anchorVersion, 2);
  assert.equal(anchor.turnId, "a7");
  assert.equal(anchor.messageRole, "assistant");
  assert.equal(anchor.blockType, "paragraph");
  assert.equal(anchor.blockIndex, 1);
  assert.ok(anchor.messageFingerprint.length >= 12);
  assert.ok(anchor.blockFingerprint.length >= 12);
});

test("similarity detects duplicate containment overlap similar and standalone", () => {
  const existing = [
    { id: "a", content: "AI Compass 是辅助人管理 AI 上下文的第二大脑。", turnId: "t1" },
    { id: "b", content: "第一段内容很长很长，用来测试局部高重合，并且这段公共内容需要超过四十个字符才能触发重合判断。第二段内容继续补充上下文管理能力。", turnId: "t1" },
    { id: "c", content: "复盘用户目标，整理关键结论，并沉淀下一步行动。", turnId: "t2" }
  ].map((item) => Object.assign({}, item, {
    normalizedContent: normalizeForSimilarity(item.content),
    contentHash: getContentHash(item.content)
  }));

  assert.equal(detectRelatedContent({ content: existing[0].content, turnId: "t1" }, existing).relationType, "duplicate");
  assert.equal(detectRelatedContent({ content: "管理 AI 上下文", turnId: "t1" }, existing).relationType, "highlight");
  assert.equal(detectRelatedContent({ content: `${existing[0].content} 这是更完整版本。`, turnId: "t1" }, existing).relationType, "fullVersion");
  assert.equal(detectRelatedContent({ content: "第一段内容很长很长，用来测试局部高重合，并且这段公共内容需要超过四十个字符才能触发重合判断。第二段内容另有不同。", turnId: "t1" }, existing).relationType, "overlap");
  assert.equal(detectRelatedContent({ content: "整理关键结论，复盘用户目标，沉淀下一步行动。", turnId: "t2" }, existing).relationType, "similar");
  assert.equal(detectRelatedContent({ content: "完全无关的新内容", turnId: "t1" }, existing).relationType, "standalone");
});

test("markdown rendering groups items by category", () => {
  const session = {
    title: "测试会话",
    siteName: "ChatGPT",
    sourceUrl: "https://chatgpt.com/c/abc",
    sourceTitle: "ChatGPT",
    createdAt: 1710000000000,
    items: [
      { type: "goal", content: "确定产品方向" },
      { type: "question", content: "下一步问什么？" },
      { type: "todo", content: "整理需求" },
      {
        id: "quote-1",
        type: "quote",
        content: "原文第一行\n原文第二行",
        attachments: [
          {
            id: "att-1",
            type: "image",
            name: "截图.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "img-1",
            extension: "png"
          }
        ]
      }
    ]
  };

  const markdown = buildMarkdown(session, 1710000300000);

  assert.match(markdown, /^# AI Compass 记录：测试会话/);
  assert.match(markdown, /## 1\. 本轮目标\n\n- 确定产品方向/);
  assert.match(markdown, /## 4\. 待追问\n\n- \[ \] 下一步问什么？/);
  assert.match(markdown, /## 5\. 待办事项\n\n- \[ \] 整理需求/);
  assert.match(markdown, /## 6\. 原文摘录\n\n> 原文第一行\n> 原文第二行/);
  assert.match(markdown, /!\[截图\.png\]\(assets\/quote-1-image-1\.png\)/);
  assert.match(markdown, /## 7\. 相关内容关系/);
  assert.match(markdown, /## 8\. 我的补充判断/);
  assert.doesNotMatch(markdown, /sessionKey|turnId|contentHash|normalizedContent|prefixText|suffixText/);
});

test("markdown helpers sanitize file names and empty content", () => {
  assert.equal(renderItemForMarkdown("insight", ""), "- （暂无内容）");
  assert.equal(sanitizeFileName("AI/Compass:*?\"<>| test"), "AI-Compass------- test");
  assert.equal(formatTimestamp(new Date(2024, 2, 9, 16, 0).getTime()), "2024-03-09 16:00");
  assert.equal(
    buildMarkdownFileName({
      siteName: "ChatGPT",
      title: "bad/name",
      exportedAt: new Date("2024-03-09T16:05:00")
    }),
    "AI-Compass-bad-name-20240309-1605.md"
  );
  assert.equal(getAttachmentFileName({ id: "item/1" }, { extension: "jpg" }, 0), "item-1-image-1.jpg");
  assert.equal(getAttachmentMarkdownPath({ id: "item/1" }, { extension: "jpg" }, 0, "deck-assets"), "deck-assets/item-1-image-1.jpg");
  assert.equal(attachmentUtils.formatBytes(1024), "1 KB");
});

test("background opens side panel before async session writes", () => {
  const backgroundPath = path.join(__dirname, "..", "background.js");
  const source = fs.readFileSync(backgroundPath, "utf8");
  const functionBody = source.match(/async function openSidePanel[\s\S]*?\n}\n\nasync function downloadMarkdown/)[0];

  assert.ok(
    functionBody.indexOf("chrome.sidePanel.open") < functionBody.indexOf("setSessionContextFromSender"),
    "chrome.sidePanel.open must happen before setSessionFromPage so Chrome keeps the user gesture"
  );
});

test("background keeps side panel context in sync with active tab changes", () => {
  const backgroundPath = path.join(__dirname, "..", "background.js");
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const source = fs.readFileSync(backgroundPath, "utf8");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  assert.ok(manifest.permissions.includes("tabs"));
  assert.equal(manifest.version, "0.6.2");
  assert.match(source, /async function syncActiveTabContext/);
  assert.match(source, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(source, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(source, /chrome\.windows\.onFocusChanged\.addListener/);
  assert.match(source, /setCurrentContext/);
  assert.match(source, /currentContext/);
});

test("storage updates source title without overwriting manually edited session titles", () => {
  const storagePath = path.join(__dirname, "..", "utils", "storage.js");
  const source = fs.readFileSync(storagePath, "utf8");

  assert.match(source, /titleEditedByUser/);
  assert.match(source, /clearCurrentSession/);
  assert.match(source, /clearAllData/);
  assert.match(source, /currentContext/);
  assert.match(source, /if \(!existing\.titleEditedByUser\)/);
});

test("storage migration to v0.6 preserves legacy sessions and fills safe defaults", () => {
  const legacy = {
    sessions: {
      legacy: {
        title: "旧会话",
        sourceUrl: "https://chatgpt.com/c/legacy",
        items: [
          {
            text: "旧文本",
            selectedText: "旧文本",
            createdAt: 1710000000000,
            attachments: [
              {
                id: "old-image",
                type: "image",
                name: "old.png",
                mimeType: "image/png",
                size: 1200,
                storageKey: "old-image",
                extension: "png"
              }
            ]
          }
        ]
      }
    },
    currentSessionKey: "legacy",
    settings: {
      defaultItemType: "goal"
    }
  };
  const migrated = storageUtils.migrateRawDataToV6(legacy, 1710001000000);

  assert.equal(migrated.meta.schemaVersion, 6);
  assert.equal(migrated.meta.appVersion, "0.6.2");
  assert.equal(migrated.currentSessionKey, "legacy");
  assert.equal(Object.keys(migrated.sessions).length, 1);
  assert.equal(migrated.sessions.legacy.sessionKey, "legacy");
  assert.equal(migrated.sessions.legacy.focusItemId, "");
  assert.equal(migrated.sessions.legacy.items.length, 1);
  assert.equal(migrated.sessions.legacy.items[0].content, "旧文本");
  assert.equal(migrated.sessions.legacy.items[0].type, "quote");
  assert.equal(migrated.sessions.legacy.items[0].attachments.length, 1);
  assert.equal(migrated.sessions.legacy.items[0].relationType, "standalone");
  assert.equal(migrated.settings.defaultItemType, "goal");
  assert.equal(migrated.settings.showLocateBeta, true);
  assert.ok(migrated.migrationBackup_v0_6);
  assert.equal(storageUtils.getStorageStats(migrated).sessionCount, 1);
  assert.equal(storageUtils.getStorageStats(migrated).itemCount, 1);
});

test("storage migration refuses destructive session or item count reductions", () => {
  const before = {
    sessions: {
      a: { items: [{ content: "A" }] }
    }
  };
  const after = {
    sessions: {}
  };

  assert.throws(() => {
    storageUtils.assertNonDestructiveMigration(before, after);
  }, /session count/);
});

test("backup export includes user data and omits migration backup internals", () => {
  const backup = storageUtils.buildBackupExport({
    sessions: { a: { items: [{ content: "A" }] } },
    settings: { defaultItemType: "quote" },
    meta: { schemaVersion: 6, appVersion: "0.6.2" },
    migrationBackup_v0_6: { data: "internal" }
  }, 1710001000000);

  assert.ok(backup.exportedAt);
  assert.ok(backup.sessions.a);
  assert.equal(backup.meta.schemaVersion, 6);
  assert.equal(backup.migrationBackup_v0_6, undefined);
});

test("background supports v0.3 similarity resolution messages", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(background, /SIMILAR_CONTENT_FOUND/);
  assert.match(background, /RESOLVE_SIMILAR_SELECTION/);
  assert.match(background, /SYNC_ACTIVE_CONTEXT/);
  assert.match(background, /EDIT_ITEM_WITH_DRAFT/);
  assert.match(background, /detectRelatedContent/);
});

test("side panel keeps session metadata compact by default", () => {
  const htmlPath = path.join(__dirname, "..", "sidepanel", "sidepanel.html");
  const cssPath = path.join(__dirname, "..", "sidepanel", "sidepanel.css");
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");

  assert.match(html, /class="session-strip"/);
  assert.match(html, /class="brand-lockup"/);
  assert.match(html, /AI-compass-logo-2\.png/);
  assert.match(html, /id="category-nav"/);
  assert.match(html, /id="focus-root"/);
  assert.match(html, /id="add-attachment-list"/);
  assert.match(html, /id="image-viewer"/);
  assert.match(html, /id="image-viewer-image"/);
  assert.match(html, /可在新增记录区域粘贴图片/);
  assert.doesNotMatch(html, /id="add-content"[^>]*required/);
  assert.match(html, /utils\/attachments\.js/);
  assert.match(html, /id="settings-button"/);
  assert.match(html, /id="settings-view"/);
  assert.match(html, /id="onboarding-panel"/);
  assert.doesNotMatch(html, /class="toolbar"/);
  assert.doesNotMatch(html, /id="clear-session-button"/);
  assert.doesNotMatch(html, /id="clear-all-button"/);
  assert.match(html, /id="session-details"[^>]*hidden/);
  assert.doesNotMatch(html, /class="session-panel"/);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /\.session-strip/);
  assert.match(css, /\.category-pill/);
  assert.match(css, /\.category-nav\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.category-pill\s*\{[^}]*flex:\s*1 1 calc\(33\.333% - 8px\)/);
  assert.doesNotMatch(css, /\.category-nav\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.item-card\.focus-card\s*\{[^}]*background:\s*#101b13/);
  assert.match(css, /\.item-card\.focus-card \.item-menu\s*\{[^}]*background:\s*var\(--surface-strong\)/);
  assert.match(css, /\.item-card\.focus-card \.item-menu \.menu-item\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.item-menu\s*\{[^}]*width:\s*min\(168px,\s*68%\)/);
  assert.match(css, /\.attachment-list/);
  assert.match(css, /\.item-attachments/);
  assert.match(css, /\.image-viewer/);
  assert.match(css, /\.item-attachment:hover/);
});

test("focus digest UI uses manual current focus and reduced card actions", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "sidepanel", "sidepanel.html"), "utf8");
  const sidepanel = fs.readFileSync(path.join(__dirname, "..", "sidepanel", "sidepanel.js"), "utf8");
  const storage = fs.readFileSync(path.join(__dirname, "..", "utils", "storage.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.match(sidepanel, /const FILTER_TYPES = \[/);
  assert.match(sidepanel, /value: "all", label: "全部"/);
  assert.match(sidepanel, /value: "goal", label: "本轮目标"/);
  assert.match(sidepanel, /value: "insight", label: "关键结论"/);
  assert.match(sidepanel, /value: "question", label: "待追问"/);
  assert.match(sidepanel, /value: "todo", label: "待办事项"/);
  assert.match(sidepanel, /value: "quote", label: "原文摘录"/);
  assert.doesNotMatch(sidepanel, /value: "method", label: "可复用方法"/);
  assert.match(sidepanel, /function renderFocusRoot/);
  assert.match(sidepanel, /setSessionFocusItem/);
  assert.match(sidepanel, /"设为当前重点"/);
  assert.match(sidepanel, /"取消当前重点"/);
  assert.match(sidepanel, /className = "item-menu"/);
  assert.match(sidepanel, /addItemForm\.addEventListener\("paste", handleAddContentPaste\)/);
  assert.match(sidepanel, /clipboardData\.files/);
  assert.match(sidepanel, /isImageMimeType/);
  assert.match(sidepanel, /saveImageBlob/);
  assert.match(sidepanel, /renderItemAttachments/);
  assert.match(sidepanel, /function openImageViewer/);
  assert.match(sidepanel, /function closeImageViewer/);
  assert.match(sidepanel, /imageViewerClose\.addEventListener\("click", closeImageViewer\)/);
  assert.match(sidepanel, /event\.key === "Escape"/);
  assert.match(storage, /focusItemId/);
  assert.match(storage, /async function setSessionFocusItem/);
  assert.match(storage, /session\.focusItemId === itemId/);
  assert.match(background, /type: "quote"/);
  assert.doesNotMatch(background, /type: nextSettings\.defaultItemType/);
  assert.match(html, /复制当前会话 Markdown/);
  assert.match(html, /导出当前会话 Markdown/);
});

test("v0.6 manifest and side panel expose settings privacy and onboarding controls", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const html = fs.readFileSync(path.join(__dirname, "..", "sidepanel", "sidepanel.html"), "utf8");
  const sidepanel = fs.readFileSync(path.join(__dirname, "..", "sidepanel", "sidepanel.js"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

  assert.equal(manifest.version, "0.6.2");
  assert.match(manifest.description, /local|本地|context/i);
  assert.match(html, /数据与隐私/);
  assert.match(html, /导出全部备份/);
  assert.match(html, /清空全部本地数据/);
  assert.match(html, /定位 Beta/);
  assert.match(sidepanel, /showLocateBeta/);
  assert.match(sidepanel, /onboardingDismissed/);
  assert.match(sidepanel, /EXPORT_BACKUP_JSON/);
  assert.match(background, /case "EXPORT_BACKUP_JSON"/);
  assert.match(background, /migrateStorageToV6/);
  assert.match(background, /utils\/attachments\.js/);
  assert.match(background, /downloadAttachmentAssets/);
  assert.match(background, /assetDownloads/);
});

test("preview helpers render markdown code blocks and tables safely", () => {
  const markdown = [
    "## API 示例",
    "",
    "```js",
    "const answer = '<ok>';",
    "```",
    "",
    "| 字段 | 说明 |",
    "| --- | --- |",
    "| name | 名称 |"
  ].join("\n");
  const html = markdownToSafeHtml(markdown);

  assert.equal(escapeHtml("<script>bad</script>"), "&lt;script&gt;bad&lt;/script&gt;");
  assert.equal(looksLikeMarkdown(markdown), true);
  assert.match(html, /<h2>API 示例<\/h2>/);
  assert.match(html, /<pre><code class="language-js">const answer = '&lt;ok&gt;';<\/code><\/pre>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script>/);
});

test("rich HTML normalization keeps useful AI answer structure and drops unsafe parts", () => {
  const html = normalizeRichHtml(
    '<div><pre><code>npm test</code></pre><table onclick="bad()"><tr><td>A</td></tr></table><script>alert(1)</script></div>'
  );

  assert.match(html, /<pre><code>npm test<\/code><\/pre>/);
  assert.match(html, /<table><tr><td>A<\/td><\/tr><\/table>/);
  assert.doesNotMatch(html, /onclick/);
  assert.doesNotMatch(html, /script/);
});

test("rich HTML table converts to complete markdown text for selection capture", () => {
  const html = [
    "<table>",
    "<tr><th>研究</th><th>方法</th></tr>",
    "<tr><td>Ablation Study（消融实验）</td><td>去掉组件并比较影响</td></tr>",
    "<tr><td>Baseline</td><td>原始模型表现</td></tr>",
    "</table>"
  ].join("");
  const text = richHtmlToMarkdownText("Ablation Study（消融实验）", html);

  assert.match(text, /\| 研究 \| 方法 \|/);
  assert.match(text, /\| --- \| --- \|/);
  assert.match(text, /\| Ablation Study（消融实验） \| 去掉组件并比较影响 \|/);
  assert.match(text, /\| Baseline \| 原始模型表现 \|/);
});

test("locator snippets include table cells for more accurate source matching", () => {
  const html = "<table><tr><td>Ablation Study（消融实验）</td><td>去掉组件并比较影响</td></tr></table>";
  const snippets = extractLocatorSnippets("Ablation Study（消融实验）", html);

  assert.ok(snippets.includes("Ablation Study（消融实验）"));
  assert.ok(snippets.includes("去掉组件并比较影响"));
});

test("locator snippets strip markdown list markers before matching page text", () => {
  const snippets = extractLocatorSnippets([
    "* **Reasoning 和 Acting 不应该割裂。**",
    "  复杂任务中，模型需要一边推理一边行动。",
    "* **Observation 是智能体闭环的关键。**"
  ].join("\n"), "");

  assert.ok(snippets.includes("Reasoning 和 Acting 不应该割裂"));
  assert.ok(snippets.includes("Observation 是智能体闭环的关键"));
  assert.ok(!snippets.some((snippet) => snippet.startsWith("* ")));
});

test("side panel preserves scroll position while editing in place", () => {
  const sidepanelPath = path.join(__dirname, "..", "sidepanel", "sidepanel.js");
  const source = fs.readFileSync(sidepanelPath, "utf8");

  assert.match(source, /function captureScrollPosition/);
  assert.match(source, /function restoreScrollPosition/);
  assert.match(source, /render\(\{\s*preserveScroll: true\s*\}\)/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /pendingScrollItemId/);
});

test("selection records expose locate beta action while manual records do not", () => {
  const sidepanelPath = path.join(__dirname, "..", "sidepanel", "sidepanel.js");
  const source = fs.readFileSync(sidepanelPath, "utf8");

  assert.match(source, /item\.fromSelection/);
  assert.match(source, /LOCATE_SOURCE_ITEM/);
  assert.match(source, /"定位 Beta"/);
});

test("side panel focuses newly collected selection items after storage refresh", () => {
  const sidepanelPath = path.join(__dirname, "..", "sidepanel", "sidepanel.js");
  const source = fs.readFileSync(sidepanelPath, "utf8");

  assert.match(source, /function getNewSelectionItemId/);
  assert.match(source, /focusItemId/);
  assert.match(source, /data-item-id/);
  assert.match(source, /focusItemAfterRender/);
  assert.doesNotMatch(source, /scrollIntoView/);
});

test("background and content support locating collected source text", () => {
  const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  const content = fs.readFileSync(path.join(__dirname, "..", "content", "content.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  const contentScripts = manifest.content_scripts[0].js;

  assert.match(background, /async function locateSourceItem/);
  assert.match(background, /case "LOCATE_SOURCE_ITEM"/);
  assert.match(background, /anchorVersion/);
  assert.match(background, /typeof item\.turnIndex === "number"/);
  assert.match(content, /case "LOCATE_SOURCE_TEXT"/);
  assert.match(content, /function locateSourceText/);
  assert.match(content, /function ensureTurnMap/);
  assert.match(content, /function scheduleTurnMapRefresh/);
  assert.match(content, /buildTurnMap/);
  assert.doesNotMatch(content, /ensureConversationIndex\(true\)/);
  assert.match(content, /function hasUsableAnchor/);
  assert.match(content, /function findLocatorTargetInMessage/);
  assert.match(content, /findMessageByAnchor/);
  assert.match(content, /function canUseFullPageFallback/);
  assert.match(content, /ai-compass-source-highlight/);
  assert.match(content, /richHtmlToMarkdownText/);
  assert.match(content, /extractLocatorSnippets/);
  assert.match(content, /function findLocatorTarget/);
  assert.match(content, /function findTargetNearLocatorScroll/);
  assert.match(content, /method: "scroll-highlight"/);
  assert.match(content, /void element\.offsetWidth/);
  assert.doesNotMatch(content, /"div"\s*\n\s*\]/);
  assert.ok(contentScripts.includes("utils/conversationIndex.js"));
  assert.ok(
    contentScripts.indexOf("utils/anchors.js") < contentScripts.indexOf("utils/conversationIndex.js"),
    "conversationIndex must load after anchors"
  );
  assert.ok(
    contentScripts.indexOf("utils/conversationIndex.js") < contentScripts.indexOf("content/content.js"),
    "conversationIndex must load before content"
  );
});
