const LS_NAME = "mantra_count_participant_name";

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
  return localStorage.getItem(LS_NAME) ?? "";
}

export function setStoredName(name: string): void {
  localStorage.setItem(LS_NAME, name.trim());
}
