// ====== Cấu hình bộ từ vựng ======
// Danh sách mặc định. Nếu repo có file decks.json thì sẽ ưu tiên dùng file đó
// (để các bộ từ tạo trên web + commit lên git hiển thị cho mọi người).
// Lưu ý: các file dữ liệu từ vựng đặt trong folder data/ cho dễ quản lý.
const DEFAULT_DECKS = [
  { id: "data1", name: "Data 1", file: "data/data1.json", emoji: "🟦" },
  { id: "data2", name: "Data 2", file: "data/data2.json", emoji: "🟩" },
];
let DECKS = DEFAULT_DECKS.slice();

// Đọc manifest decks.json từ git (nếu có) để làm danh sách bộ từ gốc.
async function loadManifest() {
  try {
    const res = await fetch("/decks.json", { cache: "no-store" });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length) {
        DECKS = list
          .filter((d) => d && d.id && d.file)
          .map((d) => ({
            id: d.id,
            name: d.name || d.id,
            file: d.file,
            emoji: d.emoji || "🗂️",
          }));
      }
    }
  } catch {}
}

// ====== State ======
let cards = [];
let index = 0;
let currentDeckName = "";

// ====== DOM ======
const homeView = document.getElementById("homeView");
const studyView = document.getElementById("studyView");
const deckList = document.getElementById("deckList");
const backBtn = document.getElementById("backBtn");
const title = document.getElementById("title");

const card = document.getElementById("card");
const frontText = document.getElementById("frontText");
const backText = document.getElementById("backText");
const counter = document.getElementById("counter");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const speakBtn = document.getElementById("speakBtn");

// Editor DOM
const editView = document.getElementById("editView");
const newDeckBtn = document.getElementById("newDeckBtn");
const deckNameInput = document.getElementById("deckNameInput");
const deckEmojiInput = document.getElementById("deckEmojiInput");
const sepInput = document.getElementById("sepInput");
const cardSepInput = document.getElementById("cardSepInput");
const bulkInput = document.getElementById("bulkInput");
const previewWrap = document.getElementById("previewWrap");
const previewBody = document.getElementById("previewBody");
const previewCount = document.getElementById("previewCount");
const importBtn = document.getElementById("importBtn");
const cardsEditor = document.getElementById("cardsEditor");
const editCount = document.getElementById("editCount");
const addRowBtn = document.getElementById("addRowBtn");
const saveDeckBtn = document.getElementById("saveDeckBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const exportDeckBtn = document.getElementById("exportDeckBtn");
const deleteDeckBtn = document.getElementById("deleteDeckBtn");

// GitHub DOM
const githubBtn = document.getElementById("githubBtn");
const saveGitBtn = document.getElementById("saveGitBtn");
const githubPanel = document.getElementById("githubPanel");
const ghRepoInput = document.getElementById("ghRepoInput");
const ghBranchInput = document.getElementById("ghBranchInput");
const ghTokenInput = document.getElementById("ghTokenInput");
const ghSaveCfgBtn = document.getElementById("ghSaveCfgBtn");
const ghStatus = document.getElementById("ghStatus");

// Editor state
let editingDeck = null; // null = tạo mới
let editCards = [];

// ====== Lưu trữ cục bộ (localStorage) ======
// Web tĩnh (Vercel) không ghi được vào file .json, nên thay đổi được lưu
// trong trình duyệt. Dùng nút "Tải JSON" để xuất và commit lại nếu muốn deploy chung.
const STORE_KEY = "flashcard_store_v1";
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && typeof s === "object")
      return { custom: s.custom || [], overrides: s.overrides || {} };
  } catch {}
  return { custom: [], overrides: {} };
}
function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

// ====== Cấu hình GitHub (lưu trong trình duyệt, KHÔNG commit vào file) ======
// Lưu ý: token chỉ nằm trong localStorage của máy bạn, không nằm trong mã nguồn
// để tránh bị GitHub secret-scanning thu hồi.
const GH_KEY = "flashcard_github_v1";
function loadGh() {
  try {
    return JSON.parse(localStorage.getItem(GH_KEY)) || {};
  } catch {
    return {};
  }
}
function saveGh(cfg) {
  localStorage.setItem(GH_KEY, JSON.stringify(cfg));
}
function ghConfigured() {
  const c = loadGh();
  return !!(c.repo && c.token);
}
function ghHeaders(cfg) {
  return {
    Authorization: "Bearer " + cfg.token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
// Mã hoá base64 an toàn với UTF-8 (tiếng Việt).
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function ghGetSha(cfg, path) {
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(
    cfg.branch
  )}`;
  const res = await fetch(url, { headers: ghHeaders(cfg), cache: "no-store" });
  if (res.status === 404) return null;
  if (res.status === 401)
    throw new Error("Token không hợp lệ hoặc thiếu quyền (401).");
  if (!res.ok) throw new Error("GitHub GET " + res.status);
  const j = await res.json();
  return j.sha;
}

async function ghPutFile(cfg, path, contentStr, message) {
  const sha = await ghGetSha(cfg, path);
  const body = {
    message,
    content: b64encode(contentStr),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(
    `https://api.github.com/repos/${cfg.repo}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders(cfg),
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    let msg = "GitHub PUT " + res.status;
    try {
      const j = await res.json();
      if (j.message) msg += ": " + j.message;
    } catch {}
    throw new Error(msg);
  }
}

// Gộp bộ từ gốc (từ file) + bộ từ người dùng tự tạo.
function getAllDecks() {
  const store = loadStore();
  const builtin = DECKS.map((d) => {
    const ov = store.overrides[d.id];
    return {
      id: d.id,
      name: ov && ov.name ? ov.name : d.name,
      emoji: ov && ov.emoji ? ov.emoji : d.emoji,
      file: d.file,
      builtin: true,
      count: ov && ov.cards ? ov.cards.length : null,
    };
  });
  const custom = store.custom.map((d) => ({
    id: d.id,
    name: d.name,
    emoji: d.emoji || "🗂️",
    file: d.file || "data/" + d.id + ".json",
    builtin: false,
    count: d.cards.length,
  }));
  // Ẩn bộ tự tạo nếu id đã có trong manifest (tức đã commit lên git).
  const builtinIds = new Set(DECKS.map((d) => d.id));
  return [...builtin, ...custom.filter((d) => !builtinIds.has(d.id))];
}

// Lấy mảng thẻ của 1 bộ (từ override / custom / file gốc).
async function loadDeckCards(deck) {
  const store = loadStore();
  if (deck.builtin) {
    const ov = store.overrides[deck.id];
    if (ov && Array.isArray(ov.cards)) return ov.cards.slice();
    const res = await fetch("/" + deck.file, { cache: "no-store" });
    if (!res.ok) throw new Error("Không tải được " + deck.file);
    return await res.json();
  }
  const c = store.custom.find((d) => d.id === deck.id);
  return c ? c.cards.slice() : [];
}

// ====== Tiện ích ======
function slugify(s) {
  return (
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck"
  );
}
function uniqueId(base) {
  const existing = new Set(getAllDecks().map((d) => d.id));
  let id = base,
    n = 2;
  while (existing.has(id)) id = base + "-" + n++;
  return id;
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])
  );
}

// ====== Render trang chủ ======
function renderHome() {
  deckList.innerHTML = "";
  getAllDecks().forEach((deck) => {
    const wrap = document.createElement("div");
    wrap.className = "relative";

    const btn = document.createElement("button");
    btn.className =
      "w-full text-left p-5 pr-20 rounded-2xl bg-white shadow hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition flex items-center gap-3";
    const subtitle = deck.builtin
      ? deck.file + (deck.count != null ? ` · đã sửa (${deck.count})` : "")
      : `${deck.count} thẻ`;
    btn.innerHTML = `
      <span class="text-3xl">${deck.emoji}</span>
      <span class="min-w-0">
        <span class="block font-semibold text-lg truncate">${escapeHtml(
          deck.name
        )}</span>
        <span class="block text-xs text-slate-400 truncate">${escapeHtml(
          subtitle
        )}</span>
      </span>`;
    btn.addEventListener("click", () => openDeck(deck));

    const edit = document.createElement("button");
    edit.className =
      "absolute top-2 right-2 p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition";
    edit.title = "Sửa";
    edit.setAttribute("aria-label", "Sửa bộ từ");
    edit.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>`;
    edit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditor(deck);
    });

    // Nút chơi game "Ghép từ với nghĩa" cho riêng bộ này
    const play = document.createElement("button");
    play.className =
      "absolute top-2 right-[4.5rem] p-2 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition";
    play.title = "Chơi game ghép từ";
    play.setAttribute("aria-label", "Chơi game ghép từ");
    play.textContent = "🎮";
    play.addEventListener("click", (e) => {
      e.stopPropagation();
      location.href = "/game.html?deck=" + encodeURIComponent(deck.id);
    });

    // Nút chơi game "Nghe và chọn từ" cho riêng bộ này
    const listen = document.createElement("button");
    listen.className =
      "absolute top-2 right-10 p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition";
    listen.title = "Nghe và chọn từ";
    listen.setAttribute("aria-label", "Nghe và chọn từ");
    listen.textContent = "🎧";
    listen.addEventListener("click", (e) => {
      e.stopPropagation();
      location.href = "/listen.html?deck=" + encodeURIComponent(deck.id);
    });

    wrap.appendChild(btn);
    wrap.appendChild(play);
    wrap.appendChild(listen);
    wrap.appendChild(edit);
    deckList.appendChild(wrap);
  });
}

// ====== Mở 1 bộ từ ======
async function openDeck(deck, push = true) {
  try {
    const loaded = await loadDeckCards(deck);
    if (!Array.isArray(loaded) || loaded.length === 0)
      throw new Error("Bộ từ rỗng hoặc sai định dạng");

    cards = loaded;
    currentDeckName = deck.name;
    index = 0;
    showStudyView();
    renderCard();
    if (push) history.pushState({ deckId: deck.id }, "", "/" + deck.id);
  } catch (err) {
    alert("Lỗi: " + err.message);
  }
}

// ====== Định tuyến theo URL ======
// Đọc phần path (vd: /data1) rồi mở đúng bộ từ, tiện để embed vào Notion.
function routeFromPath(push = false) {
  const id = location.pathname.replace(/^\/+|\/+$/g, "");
  const deck = getAllDecks().find((d) => d.id === id);
  if (deck) {
    openDeck(deck, push);
  } else {
    showHomeView(push);
  }
}

// ====== Chuyển view ======
function showStudyView() {
  homeView.classList.add("hidden");
  studyView.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  title.textContent = currentDeckName;
}

function showHomeView(push = true) {
  stopSpeaking();
  studyView.classList.add("hidden");
  editView.classList.add("hidden");
  homeView.classList.remove("hidden");
  backBtn.classList.add("hidden");
  title.textContent = "📚 Flashcard";
  renderHome();
  if (push) history.pushState({}, "", "/");
}

// ====== Editor: hiển thị / mở ======
function showEditView(titleText) {
  homeView.classList.add("hidden");
  studyView.classList.add("hidden");
  editView.classList.remove("hidden");
  backBtn.classList.remove("hidden");
  title.textContent = titleText;
  window.scrollTo(0, 0);
}

async function openEditor(deck) {
  editingDeck = deck || null;
  editCards = [];
  if (deck) {
    try {
      editCards = (await loadDeckCards(deck)).map((c) => ({
        front: c.front,
        back: c.back,
      }));
    } catch (err) {
      alert("Lỗi: " + err.message);
      return;
    }
    deckNameInput.value = deck.name;
    deckEmojiInput.value = deck.emoji;
    deleteDeckBtn.classList.toggle("hidden", deck.builtin);
  } else {
    deckNameInput.value = "";
    deckEmojiInput.value = "";
    deleteDeckBtn.classList.add("hidden");
  }
  bulkInput.value = "";
  updatePreview();
  renderCardsEditor();
  refreshGhUI();
  githubPanel.classList.add("hidden");
  showEditView(deck ? "✏️ Sửa: " + deck.name : "➕ Tạo bộ mới");
}

// ====== GitHub: giao diện cấu hình ======
function refreshGhUI() {
  const cfg = loadGh();
  ghRepoInput.value = cfg.repo || "";
  ghBranchInput.value = cfg.branch || "main";
  ghTokenInput.value = cfg.token || "";
  const ok = ghConfigured();
  saveGitBtn.disabled = !ok;
  saveGitBtn.title = ok
    ? "Lưu và commit lên GitHub"
    : "Cần cấu hình GitHub trước (bấm ⚙️ GitHub)";
  ghStatus.textContent = ok
    ? "Đã cấu hình: " + cfg.repo + " (" + (cfg.branch || "main") + ")"
    : "Chưa cấu hình GitHub.";
  ghStatus.className = ok
    ? "text-xs text-green-600"
    : "text-xs text-slate-400";
}

function saveGhConfig() {
  const repo = ghRepoInput.value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const branch = ghBranchInput.value.trim() || "main";
  const token = ghTokenInput.value.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    alert('Repo phải có dạng "tài-khoản/tên-repo", ví dụ: user/flash-card');
    return;
  }
  saveGh({ repo, branch, token });
  refreshGhUI();
  githubPanel.classList.add("hidden");
}

// ====== Editor: phân tích nhập hàng loạt ======
function parseBulk() {
  const sep = (sepInput.value || ":").trim() || ":";
  const mode = cardSepInput.value;
  const text = bulkInput.value;
  const chunks =
    mode === "blank" ? text.split(/\n\s*\n/) : text.split(/\r?\n/);
  const out = [];
  for (const raw of chunks) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(sep);
    if (at === -1) continue;
    const front = line.slice(0, at).trim();
    const back = line.slice(at + sep.length).trim();
    if (front && back) out.push({ front, back });
  }
  return out;
}

function updatePreview() {
  const parsed = parseBulk();
  previewBody.innerHTML = "";
  if (!parsed.length || !bulkInput.value.trim()) {
    previewWrap.classList.add("hidden");
    importBtn.disabled = true;
    return;
  }
  previewWrap.classList.remove("hidden");
  previewCount.textContent = parsed.length;
  parsed.forEach((c) => {
    const tr = document.createElement("tr");
    tr.className = "border-t border-slate-100 align-top";
    tr.innerHTML = `<td class="px-3 py-2">${escapeHtml(
      c.front
    )}</td><td class="px-3 py-2">${escapeHtml(c.back)}</td>`;
    previewBody.appendChild(tr);
  });
  importBtn.disabled = false;
}

function importBulk() {
  const parsed = parseBulk();
  if (!parsed.length) return;
  editCards.push(...parsed);
  bulkInput.value = "";
  updatePreview();
  renderCardsEditor();
}

// ====== Editor: bảng thẻ có thể sửa ======
function renderCardsEditor() {
  editCount.textContent = editCards.length;
  cardsEditor.innerHTML = "";
  editCards.forEach((c, i) => {
    const row = document.createElement("div");
    row.className =
      "flex gap-2 items-start bg-white rounded-xl shadow-sm p-2";
    row.innerHTML = `
      <span class="w-6 text-center text-xs text-slate-400 pt-3">${i + 1}</span>
      <textarea rows="1" class="edit-front flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y" placeholder="Mặt trước"></textarea>
      <textarea rows="1" class="edit-back flex-1 px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y" placeholder="Mặt sau"></textarea>
      <button class="del-row p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="Xoá" aria-label="Xoá thẻ">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>`;
    const f = row.querySelector(".edit-front");
    const b = row.querySelector(".edit-back");
    f.value = c.front;
    b.value = c.back;
    f.addEventListener("input", () => (editCards[i].front = f.value));
    b.addEventListener("input", () => (editCards[i].back = b.value));
    row.querySelector(".del-row").addEventListener("click", () => {
      editCards.splice(i, 1);
      renderCardsEditor();
    });
    cardsEditor.appendChild(row);
  });
}

// ====== Editor: lưu / xoá / xuất ======
function cleanedCards() {
  return editCards
    .map((c) => ({
      front: (c.front || "").trim(),
      back: (c.back || "").trim(),
    }))
    .filter((c) => c.front && c.back);
}

// Lưu vào localStorage và trả về mô tả bộ từ (để dùng chung cho cả commit git).
function persistLocal() {
  const name = deckNameInput.value.trim();
  if (!name) {
    alert("Vui lòng nhập tên bộ từ.");
    deckNameInput.focus();
    return null;
  }
  const cleaned = cleanedCards();
  if (!cleaned.length) {
    alert("Bộ từ cần ít nhất 1 thẻ hợp lệ (có cả mặt trước & sau).");
    return null;
  }
  const emoji = deckEmojiInput.value.trim() || "🗂️";
  const store = loadStore();
  let deck;

  if (editingDeck && editingDeck.builtin) {
    store.overrides[editingDeck.id] = { name, emoji, cards: cleaned };
    deck = {
      id: editingDeck.id,
      name,
      emoji,
      file: editingDeck.file,
      cards: cleaned,
    };
  } else if (editingDeck) {
    const d = store.custom.find((x) => x.id === editingDeck.id);
    const file =
      (d && d.file) || editingDeck.file || "data/" + editingDeck.id + ".json";
    if (d) {
      d.name = name;
      d.emoji = emoji;
      d.cards = cleaned;
      d.file = file;
    }
    deck = { id: editingDeck.id, name, emoji, file, cards: cleaned };
  } else {
    const id = uniqueId(slugify(name));
    const file = "data/" + id + ".json"; // bộ tự tạo cũng lưu vào folder data/
    store.custom.push({ id, name, emoji, file, cards: cleaned });
    deck = { id, name, emoji, file, cards: cleaned };
  }
  saveStore(store);
  return deck;
}

function saveDeck() {
  const deck = persistLocal();
  if (!deck) return;
  showHomeView();
}

// Dựng lại danh sách decks.json (manifest) có chứa bộ vừa lưu.
function buildManifest(deck) {
  const store = loadStore();
  const map = new Map();
  DECKS.forEach((d) => {
    const ov = store.overrides[d.id];
    map.set(d.id, {
      id: d.id,
      name: ov && ov.name ? ov.name : d.name,
      emoji: ov && ov.emoji ? ov.emoji : d.emoji,
      file: d.file,
    });
  });
  map.set(deck.id, {
    id: deck.id,
    name: deck.name,
    emoji: deck.emoji,
    file: deck.file,
  });
  return Array.from(map.values());
}

async function saveDeckToGithub() {
  const cfg = loadGh();
  if (!cfg.repo || !cfg.token) {
    alert('Chưa cấu hình GitHub. Bấm "⚙️ GitHub" để nhập repo và token.');
    githubPanel.classList.remove("hidden");
    return;
  }
  const deck = persistLocal();
  if (!deck) return;

  saveGitBtn.disabled = true;
  const oldLabel = saveGitBtn.textContent;
  saveGitBtn.textContent = "Đang commit…";
  try {
    await ghPutFile(
      cfg,
      deck.file,
      JSON.stringify(deck.cards, null, 2),
      `Update ${deck.file} from Flashcard web`
    );
    await ghPutFile(
      cfg,
      "decks.json",
      JSON.stringify(buildManifest(deck), null, 2),
      "Update decks.json from Flashcard web"
    );
    alert(
      "Đã commit lên GitHub ✅\nVercel sẽ tự deploy lại sau vài phút, khi đó mọi người đều thấy bản mới."
    );
    showHomeView();
  } catch (err) {
    alert("Lỗi commit GitHub: " + err.message);
  } finally {
    saveGitBtn.disabled = false;
    saveGitBtn.textContent = oldLabel;
  }
}

function deleteDeck() {
  if (!editingDeck || editingDeck.builtin) return;
  if (!confirm(`Xoá bộ "${editingDeck.name}"?`)) return;
  const store = loadStore();
  store.custom = store.custom.filter((d) => d.id !== editingDeck.id);
  saveStore(store);
  showHomeView();
}

function exportDeck() {
  const cleaned = cleanedCards();
  if (!cleaned.length) {
    alert("Chưa có thẻ hợp lệ để xuất.");
    return;
  }
  const blob = new Blob([JSON.stringify(cleaned, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = slugify(deckNameInput.value.trim() || "deck") + ".json";
  a.click();
  URL.revokeObjectURL(url);
}

// ====== Hiển thị thẻ hiện tại ======
function renderCard() {
  const item = cards[index];
  frontText.textContent = item.front;
  backText.textContent = item.back;
  card.classList.remove("flipped"); // luôn về mặt trước
  counter.textContent = `${index + 1} / ${cards.length}`;
  fitText(frontText);
  fitText(backText);
  // đọc text của mặt đang hiển thị (mặt trước)
  speakCurrentFace();
}

// ====== Tự thu nhỏ chữ cho vừa khung (shrink-to-fit) ======
function fitText(el) {
  const face = el.parentElement;
  const style = getComputedStyle(face);
  // vùng nội dung thực (đã trừ padding) để chữ luôn nằm gọn và canh giữa.
  // Trừ thêm một chút (SAFE) để dòng cuối không bị viền/bo góc che khuất.
  const SAFE = 4;
  const availH =
    face.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom) -
    SAFE;
  const availW =
    face.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    SAFE;
  // Cỡ chữ khởi điểm theo độ dài chữ (giống Quizlet):
  // chữ ngắn -> to, câu dài -> vừa phải, sau đó thu nhỏ thêm nếu vẫn tràn.
  const len = (el.textContent || "").length;
  let maxFont;
  if (len <= 15) maxFont = 48;      // 1-2 từ ngắn
  else if (len <= 40) maxFont = 36; // cụm từ
  else if (len <= 90) maxFont = 28; // câu ngắn
  else maxFont = 22;                // đoạn dài
  const minFont = 12; // px - cỡ chữ nhỏ nhất, vẫn đọc được
  let size = maxFont;
  el.style.fontSize = size + "px";
  // giảm dần đến khi chữ nằm gọn trong vùng nội dung
  while (
    size > minFont &&
    (el.scrollHeight > availH || el.scrollWidth > availW)
  ) {
    size -= 1;
    el.style.fontSize = size + "px";
  }
}

// ====== Phát hiện tiếng Anh ======
// Nếu chuỗi KHÔNG chứa ký tự tiếng Việt -> coi là tiếng Anh.
function isEnglish(text) {
  if (!text) return false;
  const vietnamese =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  return !vietnamese.test(text);
}

// ====== Phát âm ======
// QUAN TRỌNG: trong app Notion, trang chạy trong iframe khác origin bên trong
// WebView (Android) / WKWebView (iOS). Ở môi trường này, media CHỈ được phát khi
// lệnh play() chạy NGAY trong cử chỉ chạm của người dùng. Vì thế ta phát file âm
// thanh thật (thẻ <audio>) ngay lập tức khi người dùng chạm, thử lần lượt nhiều
// nguồn TTS, và chỉ dùng Web Speech API làm phương án cuối. Cách này phát được
// trên cả Android lẫn iOS, kể cả khi WebView không có bộ đọc TTS của hệ thống.
let ttsAudio = null;

// Các nguồn phát âm (trả về file mp3), thử theo thứ tự nếu nguồn trước lỗi.
// Ưu tiên proxy CÙNG TÊN MIỀN (/api/tts) vì WebView của app Notion chặn audio
// từ tên miền khác (ORB). Các nguồn ngoài chỉ dùng dự phòng khi mở ngoài trình
// duyệt/PWA (nơi không bị chặn cross-origin).
const TTS_SOURCES = [
  (t) => "/api/tts?tl=en&text=" + encodeURIComponent(t),
  (t) =>
    "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=" +
    encodeURIComponent(t),
];

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
  if (ttsAudio) {
    try {
      ttsAudio.onerror = null;
      ttsAudio.pause();
      ttsAudio.currentTime = 0;
    } catch (e) {}
  }
}

function speakWithSynthesis(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

function playTts(text, i) {
  i = i || 0;
  if (i >= TTS_SOURCES.length) {
    // Hết nguồn audio -> thử Web Speech API (nếu WebView có hỗ trợ).
    speakWithSynthesis(text);
    return;
  }
  try {
    if (!ttsAudio) {
      ttsAudio = new Audio();
      ttsAudio.preload = "auto";
    }
    let advanced = false;
    const next = () => {
      if (advanced) return;
      advanced = true;
      playTts(text, i + 1);
    };
    ttsAudio.onerror = next;
    ttsAudio.src = TTS_SOURCES[i](text);
    const p = ttsAudio.play();
    if (p && typeof p.catch === "function") p.catch(next);
  } catch (e) {
    playTts(text, i + 1);
  }
}

function speak(text) {
  if (!text) return;
  stopSpeaking();
  // Phát NGAY trong cử chỉ chạm của người dùng (không dùng setTimeout) để không
  // bị chính sách autoplay của WebView chặn.
  playTts(text, 0);
}

// Đọc mặt đang hiển thị nếu đó là tiếng Anh
function speakCurrentFace() {
  const item = cards[index];
  const showingBack = card.classList.contains("flipped");
  const text = showingBack ? item.back : item.front;
  if (isEnglish(text)) speak(text);
}

// ====== Events ======
card.addEventListener("click", () => {
  card.classList.toggle("flipped");
  speakCurrentFace();
});

card.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    card.click();
  }
});

nextBtn.addEventListener("click", () => {
  index = (index + 1) % cards.length;
  renderCard();
});

prevBtn.addEventListener("click", () => {
  index = (index - 1 + cards.length) % cards.length;
  renderCard();
});

speakBtn.addEventListener("click", speakCurrentFace);
backBtn.addEventListener("click", () => showHomeView());

// Editor events
newDeckBtn.addEventListener("click", () => openEditor(null));
bulkInput.addEventListener("input", updatePreview);
sepInput.addEventListener("input", updatePreview);
cardSepInput.addEventListener("change", updatePreview);
importBtn.addEventListener("click", importBulk);
addRowBtn.addEventListener("click", () => {
  editCards.push({ front: "", back: "" });
  renderCardsEditor();
});
saveDeckBtn.addEventListener("click", saveDeck);
cancelEditBtn.addEventListener("click", () => showHomeView());
exportDeckBtn.addEventListener("click", exportDeck);
deleteDeckBtn.addEventListener("click", deleteDeck);

// GitHub events
githubBtn.addEventListener("click", () =>
  githubPanel.classList.toggle("hidden")
);
ghSaveCfgBtn.addEventListener("click", saveGhConfig);
saveGitBtn.addEventListener("click", saveDeckToGithub);

// Nút back/forward của trình duyệt
window.addEventListener("popstate", () => routeFromPath(false));

// Tính lại cỡ chữ khi đổi kích thước cửa sổ (vd: iframe Notion co giãn)
window.addEventListener("resize", () => {
  if (studyView.classList.contains("hidden")) return;
  fitText(frontText);
  fitText(backText);
});

// Điều hướng bằng phím (tiện khi không nhúng iframe)
// ArrowLeft: thẻ trái | ArrowRight: thẻ phải | Space: lật thẻ | Ctrl: đọc văn bản
document.addEventListener("keydown", (e) => {
  if (studyView.classList.contains("hidden")) return;

  if (e.key === "ArrowRight") {
    e.preventDefault();
    nextBtn.click();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    prevBtn.click();
  } else if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    card.classList.toggle("flipped");
    speakCurrentFace();
  } else if (e.key === "Control") {
    e.preventDefault();
    speakCurrentFace();
  }
});

// ====== Init ======
(async function init() {
  await loadManifest();
  renderHome();
  routeFromPath(false);
})();
