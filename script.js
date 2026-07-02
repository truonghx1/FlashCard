// ====== Cấu hình bộ từ vựng ======
// Thêm file json mới thì chỉ cần thêm 1 dòng vào mảng này.
const DECKS = [
  { id: "data1", name: "Data 1", file: "data1.json", emoji: "🟦" },
  { id: "data2", name: "Data 2", file: "data2.json", emoji: "🟩" },
];

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

// ====== Render trang chủ ======
function renderHome() {
  deckList.innerHTML = "";
  DECKS.forEach((deck) => {
    const btn = document.createElement("button");
    btn.className =
      "text-left p-5 rounded-2xl bg-white shadow hover:shadow-lg hover:-translate-y-0.5 active:scale-95 transition flex items-center gap-3";
    btn.innerHTML = `
      <span class="text-3xl">${deck.emoji}</span>
      <span>
        <span class="block font-semibold text-lg">${deck.name}</span>
        <span class="block text-xs text-slate-400">${deck.file}</span>
      </span>`;
    btn.addEventListener("click", () => openDeck(deck));
    deckList.appendChild(btn);
  });
}

// ====== Mở 1 bộ từ ======
async function openDeck(deck, push = true) {
  try {
    const res = await fetch("/" + deck.file);
    if (!res.ok) throw new Error("Không tải được " + deck.file);
    cards = await res.json();
    if (!Array.isArray(cards) || cards.length === 0)
      throw new Error("File rỗng hoặc sai định dạng");

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
  const deck = DECKS.find((d) => d.id === id);
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
  window.speechSynthesis.cancel();
  studyView.classList.add("hidden");
  homeView.classList.remove("hidden");
  backBtn.classList.add("hidden");
  title.textContent = "📚 Flashcard";
  if (push) history.pushState({}, "", "/");
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
  // vùng nội dung thực (đã trừ padding) để chữ luôn nằm gọn và canh giữa
  const availH =
    face.clientHeight -
    parseFloat(style.paddingTop) -
    parseFloat(style.paddingBottom);
  const availW =
    face.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  const maxFont = 40; // px - cỡ chữ lớn nhất
  const minFont = 12; // px - cỡ chữ nhỏ nhất
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

// ====== Web Speech API ======
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
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
renderHome();
routeFromPath(false);
