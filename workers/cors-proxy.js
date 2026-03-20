/**
 * Cloudflare Worker：轉發 POST 到 Google Apps Script Web App，並加上 CORS。
 *
 * 1. 建立 Worker，貼上此檔內容（或 wrangler 專案）。
 * 2. 設定環境變數 GAS_WEBAPP_URL = 你的 .../macros/s/xxx/exec（勿結尾斜線以外的多餘路徑）
 * 3. PWA 建置時設 VITE_API_PROXY_URL = https://你的子網域.workers.dev
 *
 * 注意：此代理不驗證 API_KEY，密鑰仍由瀏覽器送到 GAS；僅解決 CORS。
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const gasUrl = env.GAS_WEBAPP_URL;
    if (!gasUrl) {
      return new Response(JSON.stringify({ ok: false, error: "GAS_WEBAPP_URL not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await request.text();
    const res = await fetch(gasUrl, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
      },
      body,
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: {
        ...corsHeaders,
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    });
  },
};
