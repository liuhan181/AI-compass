(function initSimilarity(root) {
  "use strict";

  const RELATION_LABELS = {
    standalone: "无明显关系",
    duplicate: "完全重复",
    highlight: "当前是已有内容的一部分",
    fullVersion: "当前包含已有内容",
    overlap: "局部高重合",
    similar: "高相似表达"
  };

  function normalizeForSimilarity(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[`*_>#|[\]()]/g, " ")
      .replace(/[，。！？、；：“”‘’"'.,!?;:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getContentHash(value) {
    const text = normalizeForSimilarity(value);
    let hash = 2166136261;

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `h${(hash >>> 0).toString(36)}`;
  }

  function tokenize(value) {
    const normalized = normalizeForSimilarity(value);
    const asciiTokens = normalized.match(/[a-z0-9_-]{2,}/gi) || [];
    const cjkText = normalized.replace(/[^\u4e00-\u9fa5]/g, "");
    const cjkTokens = [];

    for (let index = 0; index < cjkText.length - 1; index += 1) {
      cjkTokens.push(cjkText.slice(index, index + 2));
    }

    const phraseTokens = normalized
      .split(/\s+/)
      .filter((part) => part.length >= 2);

    return Array.from(new Set([...asciiTokens, ...cjkTokens, ...phraseTokens]));
  }

  function jaccardSimilarity(left, right) {
    const leftTokens = new Set(tokenize(left));
    const rightTokens = new Set(tokenize(right));

    if (!leftTokens.size || !rightTokens.size) {
      return 0;
    }

    let intersection = 0;
    leftTokens.forEach((token) => {
      if (rightTokens.has(token)) {
        intersection += 1;
      }
    });

    return intersection / (leftTokens.size + rightTokens.size - intersection);
  }

  function getLongestCommonSubstringLength(leftValue, rightValue) {
    const left = normalizeForSimilarity(leftValue);
    const right = normalizeForSimilarity(rightValue);

    if (!left || !right) {
      return 0;
    }

    const previous = new Array(right.length + 1).fill(0);
    let best = 0;

    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      let lastDiagonal = 0;

      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const current = previous[rightIndex];

        if (left[leftIndex - 1] === right[rightIndex - 1]) {
          previous[rightIndex] = lastDiagonal + 1;
          best = Math.max(best, previous[rightIndex]);
        } else {
          previous[rightIndex] = 0;
        }

        lastDiagonal = current;
      }
    }

    return best;
  }

  function prepareItem(item) {
    const content = String(item && item.content ? item.content : "");
    const normalizedContent = item && item.normalizedContent
      ? item.normalizedContent
      : normalizeForSimilarity(content);

    return Object.assign({}, item || {}, {
      content,
      normalizedContent,
      contentHash: item && item.contentHash ? item.contentHash : getContentHash(content)
    });
  }

  function makeRelation(type, current, existing, extra) {
    return Object.assign({
      relationType: type,
      relationLabel: RELATION_LABELS[type] || RELATION_LABELS.standalone,
      existingItemId: existing && existing.id ? existing.id : "",
      existingText: existing && existing.content ? existing.content : "",
      currentText: current && current.content ? current.content : "",
      relatedItemIds: existing && existing.id ? [existing.id] : [],
      score: 0
    }, extra || {});
  }

  function getCandidateItems(current, items) {
    const prepared = prepareItem(current);
    const existingItems = Array.isArray(items) ? items.map(prepareItem) : [];
    const sameTurn = prepared.turnId
      ? existingItems.filter((item) => item.turnId && item.turnId === prepared.turnId)
      : [];
    const pool = sameTurn.length ? sameTurn : existingItems;

    return {
      current: prepared,
      items: pool.length ? pool : existingItems
    };
  }

  function detectRelatedContent(currentInput, itemsInput) {
    const { current, items } = getCandidateItems(currentInput, itemsInput);

    if (!current.normalizedContent || !items.length) {
      return makeRelation("standalone", current, null);
    }

    for (const existing of items) {
      if (existing.id && current.id && existing.id === current.id) {
        continue;
      }

      if (existing.contentHash === current.contentHash || existing.normalizedContent === current.normalizedContent) {
        return makeRelation("duplicate", current, existing, { score: 1 });
      }
    }

    for (const existing of items) {
      if (!existing.normalizedContent) {
        continue;
      }

      if (existing.normalizedContent.includes(current.normalizedContent) && current.normalizedContent.length >= 4) {
        return makeRelation("highlight", current, existing, { score: current.normalizedContent.length / existing.normalizedContent.length });
      }

      if (current.normalizedContent.includes(existing.normalizedContent) && existing.normalizedContent.length >= 4) {
        return makeRelation("fullVersion", current, existing, { score: existing.normalizedContent.length / current.normalizedContent.length });
      }
    }

    for (const existing of items) {
      const longest = getLongestCommonSubstringLength(current.content, existing.content);
      const shorterLength = Math.min(current.normalizedContent.length, existing.normalizedContent.length);

      if (longest >= 40 && shorterLength > 0 && longest / shorterLength >= 0.45) {
        return makeRelation("overlap", current, existing, { score: longest / shorterLength });
      }
    }

    for (const existing of items) {
      const score = jaccardSimilarity(current.content, existing.content);

      if (score >= 0.72) {
        return makeRelation("similar", current, existing, { score });
      }
    }

    return makeRelation("standalone", current, null);
  }

  const api = {
    RELATION_LABELS,
    detectRelatedContent,
    getContentHash,
    getLongestCommonSubstringLength,
    jaccardSimilarity,
    normalizeForSimilarity
  };

  root.AICompass = Object.assign(root.AICompass || {}, api);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
