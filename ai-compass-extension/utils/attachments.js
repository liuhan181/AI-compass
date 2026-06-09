(function initAttachments(root) {
  "use strict";

  const DB_NAME = "ai-compass-attachments";
  const DB_VERSION = 1;
  const STORE_NAME = "images";
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  function isImageMimeType(mimeType) {
    const type = String(mimeType || "").toLowerCase();

    return type.startsWith("image/") && type !== "image/svg+xml";
  }

  function createId(prefix) {
    const compass = root.AICompass || {};

    if (compass.createId) {
      return compass.createId(prefix);
    }

    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function hasIndexedDb() {
    return typeof root.indexedDB !== "undefined";
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!hasIndexedDb()) {
        reject(new Error("当前环境不支持图片附件存储"));
        return;
      }

      const request = root.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("打开图片附件存储失败"));
    });
  }

  function runStore(mode, executor) {
    return openDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        let settled = false;

        function settle(fn, value) {
          if (settled) {
            return;
          }
          settled = true;
          db.close();
          fn(value);
        }

        tx.oncomplete = () => settle(resolve);
        tx.onerror = () => settle(reject, tx.error || new Error("图片附件存储操作失败"));
        tx.onabort = () => settle(reject, tx.error || new Error("图片附件存储操作已取消"));

        try {
          executor(store);
        } catch (error) {
          tx.abort();
          settle(reject, error);
        }
      });
    });
  }

  function putRecord(record) {
    return runStore("readwrite", (store) => {
      store.put(record);
    });
  }

  function getRecord(id) {
    return openDb().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(id);

        request.onsuccess = () => {
          db.close();
          resolve(request.result || null);
        };
        request.onerror = () => {
          db.close();
          reject(request.error || new Error("读取图片附件失败"));
        };
      });
    });
  }

  function deleteRecord(id) {
    return runStore("readwrite", (store) => {
      store.delete(id);
    });
  }

  function clearAllAttachments() {
    return runStore("readwrite", (store) => {
      store.clear();
    }).catch(() => undefined);
  }

  function getFileExtension(mimeType, fileName) {
    const nameMatch = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);

    if (nameMatch) {
      return nameMatch[1];
    }

    if (mimeType === "image/jpeg") {
      return "jpg";
    }
    if (mimeType === "image/webp") {
      return "webp";
    }
    if (mimeType === "image/gif") {
      return "gif";
    }
    if (mimeType === "image/bmp") {
      return "bmp";
    }
    if (mimeType === "image/tiff") {
      return "tif";
    }

    return "png";
  }

  function formatBytes(size) {
    const bytes = Number(size || 0);

    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 102.4) / 10} KB`;
    }

    return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
  }

  function normalizeAttachmentMeta(meta, index) {
    const source = meta && typeof meta === "object" ? meta : {};
    const mimeType = String(source.mimeType || "image/png");
    const extension = source.extension || getFileExtension(mimeType, source.name);

    return {
      id: source.id || createId("att"),
      type: "image",
      mimeType,
      name: source.name || `image-${index + 1}.${extension}`,
      size: Number(source.size || 0),
      width: Number(source.width || 0),
      height: Number(source.height || 0),
      storageKey: source.storageKey || source.id || "",
      extension,
      createdAt: source.createdAt || Date.now()
    };
  }

  function normalizeAttachments(attachments) {
    return Array.isArray(attachments)
      ? attachments
        .filter((attachment) => attachment && attachment.type === "image")
        .map(normalizeAttachmentMeta)
      : [];
  }

  function blobToDataUrl(blob) {
    if (typeof root.FileReader !== "undefined") {
      return new Promise((resolve, reject) => {
        const reader = new root.FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(blob);
      });
    }

    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";

      for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }

      return `data:${blob.type || "image/png"};base64,${root.btoa(binary)}`;
    });
  }

  function readImageSize(blob) {
    if (typeof root.createImageBitmap === "function") {
      return root.createImageBitmap(blob).then((bitmap) => {
        const size = {
          width: bitmap.width,
          height: bitmap.height
        };

        bitmap.close();
        return size;
      }).catch(() => ({ width: 0, height: 0 }));
    }

    return Promise.resolve({ width: 0, height: 0 });
  }

  async function saveImageBlob(blob, fileName) {
    if (!blob || !isImageMimeType(blob.type)) {
      throw new Error("只支持图片附件");
    }

    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error(`图片过大，请控制在 ${formatBytes(MAX_IMAGE_BYTES)} 以内`);
    }

    const id = createId("img");
    const size = await readImageSize(blob);
    const extension = getFileExtension(blob.type, fileName);
    const name = fileName || `${id}.${extension}`;
    const meta = normalizeAttachmentMeta({
      id,
      mimeType: blob.type,
      name,
      size: blob.size,
      width: size.width,
      height: size.height,
      storageKey: id,
      extension
    }, 0);

    await putRecord({
      id,
      blob,
      mimeType: blob.type,
      name,
      createdAt: Date.now()
    });

    return meta;
  }

  async function getImageBlob(storageKey) {
    const record = await getRecord(storageKey);
    return record ? record.blob : null;
  }

  async function getImageObjectUrl(storageKey) {
    const blob = await getImageBlob(storageKey);

    if (!blob) {
      return "";
    }

    return root.URL.createObjectURL(blob);
  }

  async function getImageDataUrl(storageKey) {
    const blob = await getImageBlob(storageKey);

    if (!blob) {
      return "";
    }

    return blobToDataUrl(blob);
  }

  const api = {
    MAX_IMAGE_BYTES,
    IMAGE_MIME_TYPES,
    isImageMimeType,
    normalizeAttachments,
    saveImageBlob,
    getImageBlob,
    getImageObjectUrl,
    getImageDataUrl,
    deleteImage: deleteRecord,
    clearAllAttachments,
    formatBytes
  };

  root.AICompass = Object.assign(root.AICompass || {}, {
    attachments: api
  });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
