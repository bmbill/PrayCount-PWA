const LS_NAME = "mantra_count_participant_name";
const LS_SHEET = "mantra_count_sheet_name";
/** 各分頁上次選的使用者：{ [sheetName]: participantName } */
const LS_PARTICIPANT_BY_SHEET = "mantra_count_participant_by_sheet";

/**
 * 介面偏好（上次選的專案／使用者）只存在瀏覽器，**不會**寫入 Google 試算表。
 * 使用 sessionStorage：同一分頁開著時會記住；**關閉分頁後通常會清除**（與 localStorage 不同）。
 */
function prefStorage(): Storage {
  try {
    return sessionStorage;
  } catch {
    return localStorage;
  }
}

export type ApiAction =
  | "listProjects"
  | "listParticipants"
  | "getTotals"
  | "getTodayCount"
  | "setCount"
  | "adjustCount"
  | "ensureParticipantColumn";

export type ApiRequest = {
  action: ApiAction;
  [key: string]: unknown;
};

export type ApiResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** 本機 dev 時由 Vite 轉發，與網頁同源，不受 GAS CORS 限制（見 vite.config.ts） */
const DEV_GAS_PROXY_PATH = "/__gas_proxy";

function getBaseUrl(): string {
  const cfProxy = import.meta.env.VITE_API_PROXY_URL?.trim();
  if (cfProxy) return cfProxy.replace(/\/$/, "");

  const gas = import.meta.env.VITE_GAS_WEBAPP_URL?.trim();
  if (!gas) throw new Error("未設定 VITE_GAS_WEBAPP_URL（或 VITE_API_PROXY_URL）");

  // 開發模式：優先走 Vite proxy（需 .env.local 仍有 VITE_GAS_WEBAPP_URL 供 vite 讀取路徑）
  if (import.meta.env.DEV) {
    return DEV_GAS_PROXY_PATH;
  }

  return gas.replace(/\/$/, "");
}

function getApiKey(): string {
  const k = import.meta.env.VITE_API_KEY?.trim();
  if (!k) throw new Error("未設定 VITE_API_KEY");
  return k;
}

/**
 * 呼叫 GAS Web App。
 * - 本機：走 Vite `/__gas_proxy` 同源代理，避開 CORS。
 * - 線上：使用 `text/plain` 送 JSON，通常不觸發預檢；若仍被擋，請設 VITE_API_PROXY_URL（Cloudflare Worker）。
 */
export async function callApi<T = unknown>(body: Omit<ApiRequest, never>): Promise<ApiResponse<T>> {
  const url = getBaseUrl();
  const apiKey = getApiKey();
  const payload = { apiKey, ...body };

  const res = await fetch(url, {
    method: "POST",
    mode: "cors",
    // application/json 會觸發 OPTIONS 預檢，GAS 未回 CORS → 失敗；text/plain 為「簡單請求」較易通過
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: `無法解析回應（HTTP ${res.status}）：${text.slice(0, 200)}`,
    };
  }

  if (typeof json !== "object" || json === null) {
    return { ok: false, error: "回應格式錯誤" };
  }

  const o = json as Record<string, unknown>;
  if (o.ok === true) return { ok: true, data: o.data as T };
  if (o.ok === false && typeof o.error === "string") return { ok: false, error: o.error };
  return { ok: false, error: "未知回應格式" };
}

export function getStoredName(): string {
  return prefStorage().getItem(LS_NAME) ?? "";
}

export function setStoredName(name: string): void {
  prefStorage().setItem(LS_NAME, name.trim());
}

function readParticipantBySheet_(): Record<string, string> {
  try {
    const raw = prefStorage().getItem(LS_PARTICIPANT_BY_SHEET);
    if (!raw) return {};
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
    return o as Record<string, string>;
  } catch {
    return {};
  }
}

/** 讀取「在該分頁」上次選的使用者；若無則退回全域上次姓名 */
export function getStoredParticipantForSheet(sheetName: string): string {
  const sh = sheetName.trim();
  if (!sh) return getStoredName();
  const map = readParticipantBySheet_();
  const v = map[sh]?.trim();
  if (v) return v;
  return getStoredName();
}

/** 寫入該分頁的上次使用者，並同步更新全域姓名 */
export function setStoredParticipantForSheet(sheetName: string, participantName: string): void {
  const sh = sheetName.trim();
  const n = participantName.trim();
  if (!sh || !n) return;
  const map = readParticipantBySheet_();
  map[sh] = n;
  prefStorage().setItem(LS_PARTICIPANT_BY_SHEET, JSON.stringify(map));
  setStoredName(n);
}

/** 上次選擇的專案（試算表分頁名稱） */
export function getStoredSheet(): string {
  return prefStorage().getItem(LS_SHEET) ?? "";
}

export function setStoredSheet(sheetName: string): void {
  prefStorage().setItem(LS_SHEET, sheetName.trim());
}
