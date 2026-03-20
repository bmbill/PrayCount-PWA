# 送祝福 PWA（線上表格 + Apps Script）

漸進式網頁應用：資料寫在**同一份 Google 線上表格**裡，每個「專案」對應一個**分頁**。可部署於 **GitHub Pages**，後端為 **Google Apps Script Web App**。

## 功能

- **先載入專案**（分頁），再從標題列讀出姓名清單供**下拉選擇**
- **新增使用者**：在空白欄寫入姓名並選取
- 顯示**本專案累積總計**與**我的累積總計**
- 顯示**今日**次數；`+`／`−` 調整後按「**紀錄**」存到線上
- 新分頁請在 **Google 試算表**（Sheets）手動新增，並維持第 1～2 列標題與 A 欄日期格式

## 表格版面（對齊 Google Sheets）

| 列   | 說明 |
|------|------|
| 第 1 列 | 合併 A1:Z1，專案標題／回向說明 |
| 第 2 列 | A2 為「日期」，B2 起為參與者姓名 |
| 第 3 列起 | A 欄 `yyyy/MM/dd`，B 欄起為當日次數 |

指令碼時區固定為 **`Asia/Taipei`**（與「今日」列對應）。

## 1. 建立 Google 試算表

1. 在 Google 雲端硬碟新增一個試算表（作為**母試算表**）。
2. 複製網址中的 **Spreadsheet ID**（`/d/` 與 `/edit` 之間的字串）。

## 2. 建立 Apps Script 專案

1. 前往 [script.google.com](https://script.google.com) 新增專案。
2. 將本 repo 內 [`gas/Code.gs`](gas/Code.gs) 的內容貼到編輯器（可刪除預設 `Code.gs` 範例後貼上）。
3. **專案設定 → 指令碼屬性** 新增：

   | 屬性 | 說明 |
   |------|------|
   | `SPREADSHEET_ID` | 母試算表 ID |
   | `API_KEY` | 自訂密鑰（夠長的隨機字串） |
   | `DEFAULT_DATE_ROWS` | （選填）新建分頁時 A 欄預填天數，預設 `365` |

4. **授權**：在編輯器執行任一函式（例如暫時加一個測試）並完成 OAuth，確保能存取該試算表。

## 3. 部署為網路應用程式

1. 右上角「部署」→「新增部署作業」。
2. 類型選 **網路應用程式**。
3. 建議設定：
   - **執行身分**：我
   - **具有存取權的使用者**：**任何人**（匿名呼叫時仍須帶正確 `API_KEY`）
4. 複製 **網址**（結尾為 `/exec`）。

之後若修改程式，需再「部署」→「管理部署作業」→「編輯」→**新版本**，否則線上仍為舊版。

## 4. 本機開發

```bash
cd count   # 或本專案根目錄
npm install
cp .env.example .env.local
# 編輯 .env.local：填入 VITE_GAS_WEBAPP_URL、VITE_API_KEY
npm run dev
```

## 5. GitHub Pages + Actions

1. 在 GitHub 儲存庫 **Settings → Pages**：**Build and deployment** 來源選 **GitHub Actions**。
2. 在 **Settings → Secrets and variables → Actions** 新增 **Repository secrets**：
   - `VITE_GAS_WEBAPP_URL`：Apps Script Web App 網址
   - `VITE_API_KEY`：與 Script 屬性 `API_KEY` **完全相同**
   - （選用）`VITE_API_PROXY_URL`：若使用下方 CORS 代理，填 Worker 網址
3. **Project Pages**（`https://使用者.github.io/儲存庫名/`）：GitHub Actions 已依**儲存庫名稱**自動設定 `VITE_BASE`（例如 `/PrayCount-PWA/`），無需手動變數。若曾出現**整頁空白**、主控台 404（去 `github.io/assets/` 找 JS），代表過去建置少了正確 base，推送最新 workflow 後重新部署即可。  
   - 若為 **User site**（`https://使用者.github.io/` 根目錄），請在 **Variables** 設定 `VITE_BASE` = `/`。

推送至 `main` 或 `master` 會觸發 [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) 建置並發佈。

### 若儲存庫在 monorepo 子目錄

若實際程式在子資料夾（例如 `pwa/count/`），請自行修改 workflow：加上 `defaults.run.working-directory` 或 `working-directory: pwa/count`，且 `upload-pages-artifact` 的 `path` 改為 `pwa/count/dist`。

## CORS 與 Cloudflare Worker（選用）

### 本機 `npm run dev`

專案已內建 **Vite 代理**：瀏覽器改打同源路徑 `/__gas_proxy`，再由開發伺服器轉到 `VITE_GAS_WEBAPP_URL`，因此 **localhost 不應再出現 CORS**。請確認 `.env.local` 內仍有正確的 `VITE_GAS_WEBAPP_URL`，並在修改後**重啟** `npm run dev`。

### 線上（GitHub Pages 等）

從 `github.io` 以 `fetch` 直接呼叫 `script.google.com` 時，部分環境可能出現 **CORS**。專案已將請求改為 `Content-Type: text/plain` 傳 JSON，以降低預檢失敗機率。若仍失敗，可：

1. 部署 [`workers/cors-proxy.js`](workers/cors-proxy.js) 為 **Cloudflare Worker**。
2. 在 Worker 設定環境變數 **`GAS_WEBAPP_URL`** = 你的 GAS Web App 完整網址。
3. PWA 建置時設定 **`VITE_API_PROXY_URL`** = Worker 公開網址（本機則寫入 `.env.local`）。

代理僅轉發請求並加上 CORS 標頭；**API 密鑰仍由前端送到 GAS**，請勿將密鑰寫進公開 repo，僅用 **GitHub Secrets**／本機 `.env.local`。

## 安全提醒

- `API_KEY` 用於防止陌生人任意改寫線上表格；密鑰會出現在**建置後的 JS** 中（可被進階使用者查看）。若資料極敏感，請改採 Google 登入／更嚴格權限模型。
- 線上表格仍應限制「誰能開啟檔案」；Script 以你的帳號執行，需有該檔案編輯權限。

## 專案結構

```
├── gas/Code.gs           # Apps Script（手動貼上部署）
├── workers/cors-proxy.js # 選用 CORS 代理
├── src/                  # PWA 原始碼
├── public/
├── vite.config.ts
└── .github/workflows/deploy-pages.yml
```

## 授權

MIT（可依需求自行調整）
