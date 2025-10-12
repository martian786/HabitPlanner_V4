// Main application logic
import {
  slugify,
  isValidDate,
  setToday,
  estimateReadMinutesFromMarkdown,
  makeId,
  setButtonState,
} from "./utils.js";
import { readTextFile, writeTextFile, writeBlobFile } from "./fileSystem.js";
import { postHtml } from "./template.js";
import { loadCategories, setupCategoryValidation } from "./categories.js";

(function () {
  const md = window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
  });

  // UI refs
  const pickBtn = document.getElementById("pick");
  const pubBtn = document.getElementById("publish");
  const dlBtn = document.getElementById("download");
  const editBtn = document.getElementById("editExisting");
  const newBtn = document.getElementById("newPost");
  const status = document.getElementById("status");

  const titleEl = document.getElementById("title");
  const dateEl = document.getElementById("date");
  const categoryEl = document.getElementById("category");
  const tagsEl = document.getElementById("tags");
  const excerptEl = document.getElementById("excerpt");
  const contentEl = document.getElementById("content");

  const imageEl = document.getElementById("image");
  const imagePreview = document.getElementById("imagePreview");

  const preview = document.getElementById("preview");
  const postPathEl = document.getElementById("postPath");
  const jsonUrlEl = document.getElementById("jsonUrl");
  const imgPathEl = document.getElementById("imgPath");

  const excerptCounter = document.getElementById("excerptCounter");
  const EXCERPT_MAX = 200;

  // edit-state fields
  const originalUrlEl = document.getElementById("originalUrl");
  const originalImageEl = document.getElementById("originalImage");
  const originalIdEl = document.getElementById("originalId");

  // picker + unsaved
  const pickerDialog = document.getElementById("pickerDialog");
  const pickerSearch = document.getElementById("pickerSearch");
  const pickerList = document.getElementById("pickerList");
  const unsavedDialog = document.getElementById("unsavedDialog");
  const unsavedSaveBtn = document.getElementById("unsavedSave");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscard");

  // FS handles
  let blogDir = null,
    postsDir = null,
    coversDir = null;

  // state
  let hasNewUpload = false;
  let dirty = false;
  let isConnected = false;
  let isBusy = false;

  // Initialize
  loadCategories();
  setupCategoryValidation(categoryEl, status);
  if (!dateEl.value) setToday(dateEl);

  // Excerpt counter logic
  function updateExcerptCounter() {
    const len = (excerptEl.value || "").length;
    if (len > EXCERPT_MAX) {
      excerptEl.value = excerptEl.value.slice(0, EXCERPT_MAX);
    }
    const remaining = EXCERPT_MAX - (excerptEl.value || "").length;
    if (excerptCounter) {
      excerptCounter.textContent =
        remaining +
        " " +
        (remaining === 1 ? "character" : "characters") +
        " left";
    }
  }
  excerptEl.addEventListener("input", updateExcerptCounter);
  excerptEl.addEventListener("change", updateExcerptCounter);

  // Mark dirty on changes
  const markDirty = () => {
    dirty = true;
  };

  function hasTitleAndContent() {
    return !!(titleEl.value.trim() && (contentEl.value || "").trim());
  }

  function enforceDownloadEnabled() {
    const shouldDisable = !isConnected || isBusy || !hasTitleAndContent();
    setButtonState(dlBtn, shouldDisable);
    dlBtn.title = shouldDisable
      ? "Connect, and add a title + content to enable download"
      : "Download files if you can't grant folder access";
  }

  function enforcePublishEnabled() {
    const shouldDisable = !isConnected || isBusy || !hasTitleAndContent();
    setButtonState(pubBtn, shouldDisable);
    pubBtn.title = shouldDisable
      ? "Connect, and add a title + content to enable publish"
      : "Publish to /blog";
  }

  [titleEl, dateEl, categoryEl, tagsEl, excerptEl, contentEl].forEach((el) => {
    el.addEventListener("input", () => {
      markDirty();
      updatePreview();
      enforceDownloadEnabled();
      enforcePublishEnabled();
    });
    el.addEventListener("change", () => {
      markDirty();
      updatePreview();
      enforceDownloadEnabled();
      enforcePublishEnabled();
    });
  });

  // Reset so same-file selection triggers 'change'
  imageEl.addEventListener("click", () => {
    imageEl.value = "";
  });

  imageEl.addEventListener("change", () => {
    const f = imageEl.files && imageEl.files[0];
    hasNewUpload = !!f;
    markDirty();
    if (!f) {
      imagePreview.removeAttribute("src");
      updatePreview();
      enforceDownloadEnabled();
      enforcePublishEnabled();
      return;
    }
    const r = new FileReader();
    r.onload = (e) => {
      imagePreview.src = e.target.result;
      updatePreview();
      enforceDownloadEnabled();
      enforcePublishEnabled();
    };
    r.readAsDataURL(f);
  });

  // Native unsaved prompt on refresh/close
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Toggle UI + pick button color
  function setUIState({ connected, busy, message }) {
    isConnected = !!connected;
    isBusy = !!busy;

    setButtonState(pickBtn, !!busy);
    setButtonState(newBtn, !isConnected || !!busy);
    setButtonState(editBtn, !isConnected || !!busy);

    pickBtn.textContent = busy
      ? "Working…"
      : isConnected
      ? "Change /blog folder"
      : "1) Choose /blog folder";
    pubBtn.textContent = busy ? "Publishing…" : "2) Publish";
    dlBtn.textContent = busy ? "Preparing…" : "Download files instead";

    pickBtn.classList.toggle("success", isConnected && !busy);
    pickBtn.classList.toggle("accent", !isConnected || !!busy);

    if (message !== undefined) status.innerHTML = message;

    enforceDownloadEnabled();
    enforcePublishEnabled();
  }

  setUIState({
    connected: false,
    busy: false,
    message:
      '<span class="muted">Pick your /blog folder to enable actions.</span>',
  });

  // Live preview + paths
  function updatePreview() {
    const title = titleEl.value.trim();
    const dateStr = (dateEl.value || "").trim();
    const pretty = isValidDate(dateStr)
      ? new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Invalid date";

    let previewCover = "";
    if (hasNewUpload && imagePreview.src) {
      previewCover = imagePreview.src;
    } else if (originalImageEl.value) {
      previewCover = originalImageEl.value;
    }

    const readMins = estimateReadMinutesFromMarkdown(contentEl.value || "");

    const html = postHtml({
      title,
      kicker: (
        categoryEl.value ||
        tagsEl.value.split(",")[0] ||
        "" ||
        "Article"
      ).trim(),
      datePretty: pretty,
      bodyHtml: md.render(contentEl.value || ""),
      coverUrl: previewCover,
      readMins,
    });
    preview.innerHTML = html;

    const slug = title ? slugify(title) : "untitled";
    const ext =
      imageEl.files && imageEl.files[0]
        ? (imageEl.files[0].name.split(".").pop() || "png").toLowerCase()
        : "png";
    postPathEl.textContent = `/blog/posts/${
      dateStr || "YYYY-MM-DD"
    }-${slug}.html`;
    jsonUrlEl.textContent = `posts/${dateStr || "YYYY-MM-DD"}-${slug}.html`;
    imgPathEl.textContent = `assets/covers/${
      dateStr || "YYYY-MM-DD"
    }-${slug}.${ext}`;

    enforceDownloadEnabled();
    enforcePublishEnabled();
  }

  ["input", "change"].forEach((ev) => {
    titleEl.addEventListener(ev, updatePreview);
    dateEl.addEventListener(ev, updatePreview);
    categoryEl.addEventListener(ev, updatePreview);
    tagsEl.addEventListener(ev, updatePreview);
    excerptEl.addEventListener(ev, updatePreview);
    contentEl.addEventListener(ev, updatePreview);
  });

  // Pick /blog
  pickBtn.addEventListener("click", async () => {
    try {
      if (!window.showDirectoryPicker) {
        setUIState({
          connected: false,
          busy: false,
          message: '<span class="err">Needs Chrome/Edge and http(s).</span>',
        });
        return;
      }
      if (!/^https?:\/\//.test(location.href)) {
        setUIState({
          connected: false,
          busy: false,
          message:
            '<span class="err">Open via http://localhost (not file://). Try: python -m http.server</span>',
        });
        return;
      }
      setUIState({
        connected: false,
        busy: true,
        message: '<span class="muted">Requesting folder access…</span>',
      });
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      const idx = await dir.getFileHandle("resources.html").catch(() => null);
      const pj = await dir.getFileHandle("posts.json").catch(() => null);
      if (!idx || !pj) {
        setUIState({
          connected: false,
          busy: false,
          message:
            '<span class="err">Pick your /blog folder (must contain resources.html and posts.json).</span>',
        });
        return;
      }
      blogDir = dir;
      postsDir = await blogDir.getDirectoryHandle("posts", { create: true });
      const assets = await blogDir.getDirectoryHandle("assets", {
        create: true,
      });
      coversDir = await assets.getDirectoryHandle("covers", { create: true });
      setUIState({
        connected: true,
        busy: false,
        message:
          '<span class="ok">Connected to /blog ✔ You can publish now.</span>',
      });
    } catch (e) {
      setUIState({
        connected: false,
        busy: false,
        message: '<span class="err">' + (e.message || e) + "</span>",
      });
      console.error(e);
    }
  });

  // Publish
  async function publishNow() {
    if (isBusy) return false;
    if (!blogDir) {
      setUIState({
        connected: false,
        busy: false,
        message: '<span class="err">Pick your /blog folder first.</span>',
      });
      return false;
    }
    const title = titleEl.value.trim();
    if (!title) {
      status.innerHTML = '<span class="err">Title is required.</span>';
      titleEl.focus();
      return false;
    }
    const dateStr = (dateEl.value || "").trim();
    if (!isValidDate(dateStr)) {
      status.innerHTML =
        '<span class="err">Pick a valid date (YYYY-MM-DD).</span>';
      dateEl.focus();
      if (dateEl.reportValidity) dateEl.reportValidity();
      return false;
    }
    if (!(contentEl.value || "").trim()) {
      status.innerHTML =
        '<span class="err">Content is required to publish.</span>';
      contentEl.focus();
      return false;
    }

    setUIState({
      connected: true,
      busy: true,
      message: '<span class="muted">Publishing…</span>',
    });

    const slug = slugify(title) || "untitled";
    const url = `posts/${dateStr}-${slug}.html`;

    // Image handling
    let imagePath = "";
    const file = imageEl.files && imageEl.files[0];
    if (hasNewUpload && file) {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const safe = ["png", "jpg", "jpeg", "webp", "svg"].includes(ext)
        ? ext
        : "png";
      const outName = `${dateStr}-${slug}.${safe}`;
      await writeBlobFile(coversDir, outName, file);
      imagePath = `assets/covers/${outName}`;
    } else {
      imagePath = (originalImageEl.value || "").trim();
    }
    const pageCover = imagePath ? "../" + imagePath : "";

    const rawMd = contentEl.value || "";
    const readMins = estimateReadMinutesFromMarkdown(rawMd);
    const bodyHtml = md.render(rawMd);
    const pretty = new Date(dateStr + "T12:00:00Z").toLocaleDateString(
      "en-GB",
      { year: "numeric", month: "short", day: "numeric" }
    );
    const html = postHtml({
      title,
      kicker: (
        categoryEl.value ||
        tagsEl.value.split(",")[0] ||
        "" ||
        "Article"
      ).trim(),
      datePretty: pretty,
      bodyHtml,
      coverUrl: pageCover,
      readMins,
    });

    // Write HTML file
    const postHandle = await postsDir.getFileHandle(
      `${dateStr}-${slug}.html`,
      { create: true }
    );
    await writeTextFile(postHandle, html);

    // Load/update posts.json
    const pjHandle = await blogDir.getFileHandle("posts.json", {
      create: true,
    });
    let arr = [];
    try {
      arr = JSON.parse((await readTextFile(pjHandle)) || "[]");
    } catch {
      arr = [];
    }

    const id = originalIdEl.value || makeId();

    const entry = {
      id,
      title,
      url,
      date: dateStr,
      category: (categoryEl.value || "").trim(),
      tags: tagsEl.value
        ? tagsEl.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      excerpt: excerptEl.value || "",
      content: rawMd || "",
      readMins,
    };
    if (imagePath) entry.image = imagePath;

    const originalUrl = (originalUrlEl.value || "").trim();
    let replaced = false;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (
        (p && p.id && p.id === id) ||
        (!p.id && originalUrl && p.url === originalUrl)
      ) {
        arr[i] = entry;
        replaced = true;
        break;
      }
    }
    if (!replaced) arr.push(entry);

    arr.forEach(
      (p) =>
        (p._ts = Number.isFinite(Date.parse(p.date)) ? Date.parse(p.date) : 0)
    );
    arr.sort((a, b) => b._ts - a._ts);
    arr.forEach((p) => delete p._ts);

    await writeTextFile(pjHandle, JSON.stringify(arr, null, 2));

    // Remove old HTML if URL changed
    if (originalUrl && originalUrl !== url) {
      try {
        const oldName = originalUrl.split("/").pop();
        await postsDir.removeEntry(oldName);
      } catch (e) {
        console.warn("Could not remove old HTML", e);
      }
    }

    originalUrlEl.value = url;
    originalIdEl.value = id;
    originalImageEl.value = imagePath || "";
    hasNewUpload = false;
    imageEl.value = "";
    if (imagePath) imagePreview.src = imagePath;

    dirty = false;
    setUIState({
      connected: true,
      busy: false,
      message: '<span class="ok">Published ✔</span>',
    });
    return true;
  }

  pubBtn.addEventListener("click", async () => {
    try {
      if (isBusy) return;
      await publishNow();
    } catch (e) {
      setUIState({
        connected: isConnected,
        busy: false,
        message:
          '<span class="err">Publish failed: ' + (e.message || e) + "</span>",
      });
    }
  });

  // Download fallback
  dlBtn.addEventListener("click", async () => {
    try {
      if (isBusy) return;
      if (!isConnected) {
        setUIState({
          connected: false,
          busy: false,
          message: '<span class="err">Pick your /blog folder first.</span>',
        });
        return;
      }
      if (!hasTitleAndContent()) {
        status.innerHTML =
          '<span class="err">Enter a title and content to download.</span>';
        return;
      }

      const title = titleEl.value.trim() || "untitled";
      const dateStr = (dateEl.value || "").trim();
      if (!isValidDate(dateStr)) {
        status.innerHTML =
          '<span class="err">Pick a valid date (YYYY-MM-DD) before downloading.</span>';
        dateEl.focus();
        if (dateEl.reportValidity) dateEl.reportValidity();
        return;
      }

      setUIState({
        connected: true,
        busy: true,
        message: '<span class="muted">Preparing downloads…</span>',
      });

      const slug = slugify(title) || "untitled";
      const url = `posts/${dateStr}-${slug}.html`;
      const id = originalIdEl.value || makeId();

      const rawMd = contentEl.value || "";
      const readMins = estimateReadMinutesFromMarkdown(rawMd);

      const entry = {
        id,
        title,
        url,
        date: dateStr,
        category: (categoryEl.value || "").trim(),
        tags: tagsEl.value
          ? tagsEl.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        excerpt: excerptEl.value || "",
        content: rawMd,
        readMins,
      };

      let pageCover = "";
      const file = imageEl.files && imageEl.files[0];
      if (hasNewUpload && file) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const safe = ["png", "jpg", "jpeg", "webp", "svg"].includes(ext)
          ? ext
          : "png";
        const outName = `${dateStr}-${slug}.${safe}`;
        entry.image = `assets/covers/${outName}`;
        pageCover = `../assets/covers/${outName}`;
        const aImg = document.createElement("a");
        aImg.href = URL.createObjectURL(file);
        aImg.download = outName;
        aImg.click();
      } else if (originalImageEl.value) {
        entry.image = originalImageEl.value;
        pageCover = `../${originalImageEl.value}`;
      }

      const pretty = new Date(dateStr + "T12:00:00Z").toLocaleDateString(
        "en-GB",
        { year: "numeric", month: "short", day: "numeric" }
      );
      const bodyHtml = md.render(rawMd);
      const html = postHtml({
        title,
        kicker: (
          categoryEl.value ||
          tagsEl.value.split(",")[0] ||
          "" ||
          "Article"
        ).trim(),
        datePretty: pretty,
        bodyHtml,
        coverUrl: pageCover,
        readMins,
      });

      const a1 = document.createElement("a");
      a1.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      a1.download = `${dateStr}-${slug}.html`;
      a1.click();

      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(
        new Blob([JSON.stringify(entry, null, 2)], {
          type: "application/json",
        })
      );
      a2.download = `${dateStr}-${slug}.json`;
      a2.click();

      setUIState({
        connected: true,
        busy: false,
        message:
          '<span class="ok">Downloaded post HTML + image reference.</span>',
      });
    } catch (e) {
      setUIState({
        connected: isConnected,
        busy: false,
        message:
          '<span class="err">Download failed: ' + (e.message || e) + "</span>",
      });
      console.error(e);
    }
  });

  // Unsaved changes helper
  async function confirmUnsavedThen(doNext) {
    if (!dirty) {
      await doNext();
      return;
    }
    return new Promise((resolve) => {
      const onDiscard = async () => {
        unsavedDialog.close();
        dirty = false;
        await doNext();
        resolve();
      };
      const onSave = async () => {
        const ok = await publishNow();
        unsavedDialog.close();
        if (ok) await doNext();
        resolve();
      };
      unsavedDiscardBtn.onclick = onDiscard;
      unsavedSaveBtn.onclick = onSave;
      unsavedDialog.showModal();
    });
  }

  // New post
  async function startNewDraft() {
    const hadContent =
      titleEl.value ||
      contentEl.value ||
      categoryEl.value ||
      tagsEl.value ||
      excerptEl.value ||
      (imageEl.files && imageEl.files.length);
    titleEl.value = "";
    setToday(dateEl);
    categoryEl.value = "";
    tagsEl.value = "";
    excerptEl.value = "";
    contentEl.value = "";
    imageEl.value = "";
    imagePreview.removeAttribute("src");
    originalUrlEl.value = "";
    originalImageEl.value = "";
    originalIdEl.value = "";
    hasNewUpload = false;
    dirty = false;
    updatePreview();
    status.innerHTML = hadContent
      ? '<span class="muted">Started a new draft.</span>'
      : status.innerHTML;
    titleEl.focus();
  }

  newBtn.addEventListener("click", async () => {
    await confirmUnsavedThen(startNewDraft);
  });

  // Edit existing
  async function listPosts() {
    if (!blogDir) throw new Error("Pick /blog first");
    const pjHandle = await blogDir.getFileHandle("posts.json");
    const text = await (await pjHandle.getFile()).text();
    const arr = JSON.parse(text || "[]");
    arr.forEach(
      (p) =>
        (p._ts = Number.isFinite(Date.parse(p.date)) ? Date.parse(p.date) : 0)
    );
    arr.sort((a, b) => b._ts - a._ts);
    return arr;
  }

  function renderPicker(items, q = "") {
    const term = q.trim().toLowerCase();
    const subset = term
      ? items.filter((p) => (p.title || "").toLowerCase().includes(term))
      : items;
    pickerList.innerHTML =
      subset
        .map(
          (p) => `
        <button type="button" data-url="${
          p.url
        }" style="display:block;width:100%;text-align:left;padding:10px 12px;border:0;border-bottom:1px solid #eee;background:#fff;cursor:pointer;">
          <div style="font-weight:700">${p.title || "(untitled)"}</div>
          <div style="font-size:12px;color:#666">${p.date} • ${p.url}</div>
        </button>`
        )
        .join("") ||
      `<div style="padding:10px 12px;color:#666">No matches.</div>`;
  }

  async function openPicker() {
    try {
      const arr = await listPosts();
      renderPicker(arr);
      pickerSearch.value = "";
      pickerSearch.oninput = () => renderPicker(arr, pickerSearch.value);
      pickerList.onclick = async (e) => {
        const btn = e.target.closest("button[data-url]");
        if (!btn) return;
        const url = btn.dataset.url;
        const picked = arr.find((p) => p.url === url);
        if (!picked) return;

        titleEl.value = picked.title || "";
        dateEl.value = (picked.date || "").trim();
        categoryEl.value = picked.category || "";
        tagsEl.value = (Array.isArray(picked.tags) ? picked.tags : []).join(
          ", "
        );
        excerptEl.value = picked.excerpt || "";
        contentEl.value = picked.content || "";

        originalUrlEl.value = picked.url || "";
        originalImageEl.value = picked.image || "";
        originalIdEl.value = picked.id || picked.url || "";

        imageEl.value = "";
        hasNewUpload = false;

        if (picked.image) imagePreview.src = picked.image;
        else imagePreview.removeAttribute("src");

        dirty = false;
        updatePreview();
        pickerDialog.close();
        status.innerHTML =
          '<span class="ok">Loaded post. Edit and hit Publish.</span>';
      };
      pickerDialog.showModal();
    } catch (e) {
      status.innerHTML =
        '<span class="err">Could not open picker: ' +
        (e.message || e) +
        "</span>";
    }
  }

  editBtn.addEventListener("click", async () => {
    await confirmUnsavedThen(openPicker);
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const key = e.key?.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "s") {
      e.preventDefault();
      if (!pubBtn.disabled) pubBtn.click();
    }
    if ((e.metaKey || e.ctrlKey) && key === "d") {
      e.preventDefault();
      if (!dlBtn.disabled) dlBtn.click();
    }
  });

  // Initial render
  updatePreview();
  enforceDownloadEnabled();
  enforcePublishEnabled();
  updateExcerptCounter();
})();
