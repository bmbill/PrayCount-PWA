import "./style.css";
import { registerSW } from "virtual:pwa-register";
import {
  callApi,
  getStoredParticipantForSheet,
  getStoredSheet,
  setStoredParticipantForSheet,
  setStoredSheet,
  type ApiResponse,
} from "./api";

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>("#app")!;

type ListData = { sheets: string[] };
/** 與 getTotals 相同欄位，另含名單與可選的今日次數（一次 bootstrap 載入） */
type BootstrapSheetData = {
  names: string[];
  projectTotal: number;
  participantTotal: number;
  goal: number;
  todayCount: number | null;
};
type TotalsData = { projectTotal: number; participantTotal: number; goal: number };
type CountData = { count: number };

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function showError(card: HTMLElement, message: string) {
  const existing = card.querySelector(".msg-error");
  if (existing) existing.remove();
  const m = el(`<div class="msg msg-error" role="alert"></div>`);
  m.textContent = message;
  card.appendChild(m);
}

function clearError(card: HTMLElement) {
  card.querySelectorAll(".msg-error").forEach((n) => n.remove());
}

async function run<T>(
  card: HTMLElement,
  fn: () => Promise<ApiResponse<T>>
): Promise<T | null> {
  clearError(card);
  const r = await fn();
  if (!r.ok) {
    showError(card, r.error);
    return null;
  }
  return (r.data ?? undefined) as T;
}

function formatInt(n: number): string {
  return n.toLocaleString("zh-Hant");
}

function resetGoalProgressUI() {
  const wrap = document.querySelector("#goal-progress-wrap") as HTMLElement | null;
  const fill = document.querySelector("#goal-bar-fill") as HTMLElement | null;
  const fraction = document.querySelector("#goal-fraction");
  const percent = document.querySelector("#goal-percent");
  wrap?.setAttribute("hidden", "");
  if (fill) fill.style.width = "0%";
  if (fraction) fraction.textContent = "— / —";
  if (percent) percent.textContent = "—";
  document.querySelector("#goal-bar-track")?.setAttribute("aria-valuenow", "0");
}

/** 將總計／進度條寫入頁首（不依賴 API） */
function applyTotalsUI(data: TotalsData) {
  const projEl = document.querySelector("#stat-project-total");
  const mineEl = document.querySelector("#stat-my-total");
  if (!projEl || !mineEl) return;
  const p = getParticipant();
  projEl.textContent = formatInt(data.projectTotal);
  mineEl.textContent = p ? formatInt(data.participantTotal) : "—";
  const goal = typeof data.goal === "number" && data.goal > 0 ? data.goal : 2_000_000;
  updateGoalProgressUI(data.projectTotal, goal);
}

/** 更新今日次數顯示（③ 卡片） */
function applyTodayCountUI(count: number) {
  const card = document.querySelector("#card-count") as HTMLElement | null;
  if (!card) return;
  const display = card.querySelector("#count-val");
  const input = card.querySelector<HTMLInputElement>("#count-input");
  if (display) display.textContent = String(count);
  if (input) input.value = String(count);
  clearError(card);
}

function updateGoalProgressUI(current: number, goal: number) {
  const wrap = document.querySelector("#goal-progress-wrap") as HTMLElement | null;
  const fill = document.querySelector("#goal-bar-fill") as HTMLElement | null;
  const fraction = document.querySelector("#goal-fraction");
  const percent = document.querySelector("#goal-percent");
  const track = document.querySelector("#goal-bar-track");
  if (!wrap || !fill || !fraction || !percent || !track) return;
  wrap.removeAttribute("hidden");
  const g = goal > 0 ? goal : 1;
  const pctRaw = (current / g) * 100;
  const pctDisplay = Math.round(pctRaw * 100) / 100;
  const barW = Math.min(100, Math.max(0, pctRaw));
  fill.style.width = `${barW}%`;
  track.setAttribute("aria-valuenow", String(Math.min(100, barW)));
  fraction.textContent = `${formatInt(current)} / ${formatInt(goal)}`;
  percent.textContent =
    pctRaw >= 10 ? `${pctDisplay.toFixed(1)}%` : pctRaw >= 0.01 ? `${pctDisplay.toFixed(2)}%` : current > 0 ? "<0.01%" : "0%";
}

async function refreshTotals() {
  const sheet = getSelectedSheet();
  const p = getParticipant();
  const projEl = document.querySelector("#stat-project-total");
  const mineEl = document.querySelector("#stat-my-total");
  if (!projEl || !mineEl) return;
  if (!sheet) {
    projEl.textContent = "—";
    mineEl.textContent = "—";
    resetGoalProgressUI();
    return;
  }
  projEl.textContent = "…";
  mineEl.textContent = p ? "…" : "—";
  const r = await callApi<TotalsData>({
    action: "getTotals",
    sheetName: sheet,
    participantName: p || "",
  });
  if (!r.ok || !r.data) {
    projEl.textContent = "?";
    mineEl.textContent = p ? "?" : "—";
    resetGoalProgressUI();
    return;
  }
  applyTotalsUI(r.data);
}

/** 總計與今日次數並行請求（節省等待時間） */
async function refreshTotalsAndToday() {
  await Promise.all([refreshTotals(), loadTodayCount()]);
}

function render() {
  app.innerHTML = "";
  app.appendChild(buildHeader());
  app.appendChild(buildProjectCard());
  app.appendChild(buildParticipantCard());
  app.appendChild(buildCountCard());
  app.appendChild(buildConfigHint());
}

function buildHeader() {
  return el(`
    <header>
      <h1>送祝福</h1>
      <p class="sub">資料存在線上表格，需要連網才能用。</p>
      <div class="stats-banner" id="stats-banner" aria-live="polite">
        <div class="stat-item">
          <span class="stat-label">本專案累積總計</span>
          <span class="stat-value" id="stat-project-total">—</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">我的累積總計</span>
          <span class="stat-value" id="stat-my-total">—</span>
        </div>
      </div>
      <div class="goal-progress" id="goal-progress-wrap" hidden>
        <p class="goal-progress-title">眾願進度（對照目標）</p>
        <div
          class="goal-bar-track"
          id="goal-bar-track"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
          aria-label="專案累積對目標的完成比例"
        >
          <div class="goal-bar-fill" id="goal-bar-fill"></div>
        </div>
        <p class="goal-progress-meta">
          <span id="goal-fraction" class="goal-fraction">— / —</span>
          <span class="goal-sep">·</span>
          <span id="goal-percent" class="goal-percent-value">—</span>
        </p>
      </div>
    </header>
  `);
}

function buildProjectCard() {
  const card = el(`<section class="card" id="card-project"></section>`) as HTMLElement;
  card.innerHTML = `
    <label for="project-select">① 功課／專案</label>
    <div class="row">
      <select id="project-select"></select>
      <button type="button" class="btn btn-ghost" id="refresh-projects">載入專案</button>
    </div>
  `;
  card.querySelector("#refresh-projects")?.addEventListener("click", () => loadProjects(card));
  card.querySelector("#project-select")?.addEventListener("change", () => {
    const sel = card.querySelector<HTMLSelectElement>("#project-select");
    const v = sel?.value?.trim() ?? "";
    if (v) setStoredSheet(v);
    void onProjectChanged(card);
  });
  return card;
}

async function onProjectChanged(_projectCard: HTMLElement) {
  const pcard = document.querySelector("#card-participant") as HTMLElement | null;
  if (pcard) await loadParticipants(pcard);
  else {
    await refreshTotalsAndToday();
  }
}

async function loadProjects(card: HTMLElement) {
  const select = card.querySelector<HTMLSelectElement>("#project-select");
  if (!select) return;
  select.disabled = true;
  const data = await run<ListData>(card, () =>
    callApi<ListData>({ action: "listProjects" })
  );
  select.disabled = false;
  if (!data) return;
  const sessionProject = select.value;
  select.innerHTML = "";
  if (data.sheets.length === 0) {
    select.appendChild(new Option("（尚無分頁，請先到線上表格加一個新分頁）", ""));
    const pcard = document.querySelector("#card-participant") as HTMLElement | null;
    if (pcard) await resetParticipantSelect(pcard);
    await refreshTotalsAndToday();
    return;
  }
  for (const s of data.sheets) {
    select.appendChild(new Option(s, s));
  }
  const remembered = getStoredSheet();
  let picked = "";
  if (remembered && data.sheets.includes(remembered)) picked = remembered;
  else if (sessionProject && data.sheets.includes(sessionProject)) picked = sessionProject;
  else if (data.sheets.length > 0) picked = data.sheets[0];
  if (picked) {
    select.value = picked;
    setStoredSheet(picked);
  }
  const pcard = document.querySelector("#card-participant") as HTMLElement | null;
  if (pcard) await loadParticipants(pcard);
  else {
    await refreshTotalsAndToday();
  }
}

async function resetParticipantSelect(card: HTMLElement) {
  const select = card.querySelector<HTMLSelectElement>("#participant-select");
  if (!select) return;
  select.innerHTML = "";
  select.appendChild(new Option("（請先選擇專案）", ""));
  select.disabled = true;
}

function buildParticipantCard() {
  const card = el(`<section class="card" id="card-participant"></section>`) as HTMLElement;
  card.innerHTML = `
    <label for="participant-select">② 使用者</label>
    <div class="row">
      <select id="participant-select" disabled>
        <option value="">（請先載入專案）</option>
      </select>
      <button type="button" class="btn btn-ghost" id="add-participant">新增使用者</button>
    </div>
    <p class="participant-hint">選擇使用者後會載入今日次數；新成員請按「新增使用者」。</p>
  `;
  card.querySelector("#participant-select")?.addEventListener("change", () => {
    const sel = card.querySelector<HTMLSelectElement>("#participant-select");
    const v = sel?.value?.trim() ?? "";
    const sh = getSelectedSheet();
    if (v && sh) setStoredParticipantForSheet(sh, v);
    void refreshTotalsAndToday();
  });
  card.querySelector("#add-participant")?.addEventListener("click", () => {
    void addParticipantFlow(card);
  });
  return card;
}

async function loadParticipants(card: HTMLElement) {
  const select = card.querySelector<HTMLSelectElement>("#participant-select");
  if (!select) return;
  const sheet = getSelectedSheet();
  if (!sheet) {
    await resetParticipantSelect(card);
    await refreshTotalsAndToday();
    return;
  }
  const countCard = document.querySelector("#card-count") as HTMLElement | null;
  const countDisplay = countCard?.querySelector("#count-val");
  if (countDisplay) countDisplay.textContent = "…";

  select.disabled = true;
  const stored = getStoredParticipantForSheet(sheet);
  const data = await run<BootstrapSheetData>(card, () =>
    callApi<BootstrapSheetData>({
      action: "bootstrapSheet",
      sheetName: sheet,
      participantName: stored || "",
    })
  );
  select.disabled = false;
  if (!data) {
    if (countDisplay) countDisplay.textContent = "—";
    return;
  }

  const names = data.names;
  select.innerHTML = "";
  select.appendChild(new Option("（請選擇使用者）", ""));
  for (const n of names) {
    select.appendChild(new Option(n, n));
  }

  if (stored && names.includes(stored)) {
    select.value = stored;
  } else if (names.length === 1) {
    select.value = names[0];
    setStoredParticipantForSheet(sheet, names[0]);
  } else {
    select.value = "";
  }

  applyTotalsUI({
    projectTotal: data.projectTotal,
    participantTotal: data.participantTotal,
    goal: data.goal,
  });

  if (typeof data.todayCount === "number") {
    applyTodayCountUI(data.todayCount);
  } else {
    await loadTodayCount();
  }
}

async function addParticipantFlow(card: HTMLElement) {
  const sheet = getSelectedSheet();
  if (!sheet) {
    showError(card, "請先選擇並載入專案。");
    return;
  }
  const raw = window.prompt("請輸入新使用者的名字，會自動加到名單裡：");
  if (raw === null) return;
  const name = raw.trim();
  if (!name) {
    showError(card, "姓名不可為空白。");
    return;
  }
  const ok = await run<{ column: number }>(card, () =>
    callApi<{ column: number }>({
      action: "ensureParticipantColumn",
      sheetName: sheet,
      participantName: name,
    })
  );
  if (!ok) return;
  setStoredParticipantForSheet(sheet, name);
  await loadParticipants(card);
  clearError(card);
  const tip = el(`<div class="msg msg-ok"></div>`);
  tip.textContent = `已新增「${name}」並選取。`;
  card.querySelector(".msg-ok")?.remove();
  card.appendChild(tip);
  setTimeout(() => tip.remove(), 3000);
}

function getSelectedSheet(): string {
  const select = document.querySelector<HTMLSelectElement>("#project-select");
  return select?.value ?? "";
}

function getParticipant(): string {
  const select = document.querySelector<HTMLSelectElement>("#participant-select");
  return select?.value?.trim() ?? "";
}

function buildCountCard() {
  const card = el(`<section class="card" id="card-count"></section>`) as HTMLElement;
  card.innerHTML = `
    <p class="step-label">③ 今日次數（以台北時間為準）</p>
    <div class="stepper">
      <button type="button" class="btn" id="minus" aria-label="減一">−</button>
      <span class="count-display" id="count-val">—</span>
      <button type="button" class="btn" id="plus" aria-label="加一">+</button>
    </div>
    <label for="count-input">直接修改數字</label>
    <div class="row">
      <input type="number" id="count-input" min="0" step="1" inputmode="numeric" />
      <button type="button" class="btn" id="save-count">紀錄</button>
    </div>
    <p class="count-hint">加、減或改數字後，按「紀錄」才會存到線上。</p>
  `;

  card.querySelector("#plus")?.addEventListener("click", () => adjustLocal(card, 1));
  card.querySelector("#minus")?.addEventListener("click", () => adjustLocal(card, -1));
  card.querySelector("#save-count")?.addEventListener("click", () => commitCountToSheet(card));

  return card;
}

async function loadTodayCount() {
  const card = document.querySelector("#card-count") as HTMLElement | null;
  if (!card) return;
  const sheet = getSelectedSheet();
  const participant = getParticipant();
  const display = card.querySelector("#count-val");
  const input = card.querySelector<HTMLInputElement>("#count-input");
  if (!sheet || !participant) {
    if (display) display.textContent = "—";
    if (input) input.value = "";
    clearError(card);
    return;
  }

  if (display) display.textContent = "…";
  const data = await run<CountData>(card, () =>
    callApi<CountData>({
      action: "getTodayCount",
      sheetName: sheet,
      participantName: participant,
    })
  );
  if (!data) {
    if (display) display.textContent = "—";
    return;
  }
  if (display) display.textContent = String(data.count);
  if (input) input.value = String(data.count);
}

function parseLocalCount(card: HTMLElement): number | null {
  const input = card.querySelector<HTMLInputElement>("#count-input");
  const display = card.querySelector("#count-val");
  const d = display?.textContent?.trim() ?? "";
  if (d === "—" || d === "…" || d === "") return null;
  const fromInput = input?.value.trim() ?? "";
  if (fromInput !== "") {
    const v = Math.floor(Number(fromInput));
    return Number.isNaN(v) ? null : v;
  }
  const v = Math.floor(Number(d));
  return Number.isNaN(v) ? null : v;
}

function setLocalCountDisplay(card: HTMLElement, value: number) {
  const display = card.querySelector("#count-val");
  const input = card.querySelector<HTMLInputElement>("#count-input");
  if (display) display.textContent = String(value);
  if (input) input.value = String(value);
}

function adjustLocal(card: HTMLElement, delta: number) {
  const sheet = getSelectedSheet();
  const participant = getParticipant();
  if (!sheet || !participant) {
    showError(card, "請先選擇專案與使用者。");
    return;
  }
  const current = parseLocalCount(card);
  if (current === null) {
    showError(card, "請先等待次數載入完成。");
    return;
  }
  const next = Math.max(0, current + delta);
  setLocalCountDisplay(card, next);
  clearError(card);
}

async function commitCountToSheet(card: HTMLElement) {
  const sheet = getSelectedSheet();
  const participant = getParticipant();
  if (!sheet || !participant) {
    showError(card, "請先選擇專案與使用者。");
    return;
  }
  const value = parseLocalCount(card);
  if (value === null) {
    showError(card, "請輸入有效數字，或等待載入完成。");
    return;
  }
  const data = await run<CountData>(card, () =>
    callApi<CountData>({
      action: "setCount",
      sheetName: sheet,
      participantName: participant,
      value,
    })
  );
  if (!data) return;
  setLocalCountDisplay(card, data.count);
  const ok = el(`<div class="msg msg-ok">已幫你存好了。</div>`);
  card.querySelector(".msg-ok")?.remove();
  card.appendChild(ok);
  setTimeout(() => ok.remove(), 2500);
  await refreshTotals();
}

function buildConfigHint() {
  return el(`
    <section class="card">
      <p style="margin:0;font-size:0.8rem;color:var(--muted)">
        若無法連線，請聯絡夏安。
      </p>
    </section>
  `);
}

render();

void (async () => {
  const projectCard = document.querySelector("#card-project") as HTMLElement;
  await loadProjects(projectCard);
})();
