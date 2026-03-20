/**
 * Google Apps Script — 複製到與試算表綁定的專案中，部署為「網路應用程式」。
 *
 * Script 屬性（專案設定 → 指令碼屬性）：
 *   SPREADSHEET_ID — 母試算表 ID
 *   API_KEY        — 與 PWA 建置變數 VITE_API_KEY 相同
 *   DEFAULT_DATE_ROWS — 選填，預設 365；新建分頁時 A 欄預填天數
 *
 * 部署：執行身分「我」、存取「任何人」（匿名仍須正確 API_KEY）。
 */

var TZ = "Asia/Taipei";
var MERGE_LAST_COL = 26; // Z
var HEADER_ROW = 2;
var DATA_START_ROW = 3;

function doGet(e) {
  if (e && e.parameter && e.parameter.ping === "1") {
    return jsonOut_({ ok: true, data: { pong: true, time: new Date().toISOString() } });
  }
  return ContentService.createTextOutput("Mantra count API — POST JSON { apiKey, action, ... }")
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonOut_({ ok: false, error: "empty body" });
    }
    var body = JSON.parse(e.postData.contents);
    if (!verifyApiKey_(body)) {
      return jsonOut_({ ok: false, error: "unauthorized" });
    }
    var action = body.action;
    if (!action) {
      return jsonOut_({ ok: false, error: "missing action" });
    }

    switch (action) {
      case "listProjects":
        return jsonOut_({ ok: true, data: { sheets: listProjects_() } });
      case "listParticipants":
        return jsonOut_({ ok: true, data: { names: listParticipantNames_(body.sheetName) } });
      case "getTotals":
        return jsonOut_(getTotals_(body.sheetName, body.participantName));
      case "createProject":
        return jsonOut_(createProject_(body.sheetName, body.title));
      case "getTodayCount":
        return jsonOut_(getTodayCount_(body.sheetName, body.participantName));
      case "setCount":
        return jsonOut_(setCount_(body.sheetName, body.participantName, body.value));
      case "adjustCount":
        return jsonOut_(adjustCount_(body.sheetName, body.participantName, body.delta));
      case "ensureParticipantColumn":
        return jsonOut_(ensureParticipantColumn_(body.sheetName, body.participantName));
      default:
        return jsonOut_({ ok: false, error: "unknown action: " + action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function verifyApiKey_(body) {
  var key = PropertiesService.getScriptProperties().getProperty("API_KEY");
  if (!key) return false;
  return body.apiKey === key;
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID not set");
  return SpreadsheetApp.openById(id);
}

function getDefaultDateRows_() {
  var raw = PropertiesService.getScriptProperties().getProperty("DEFAULT_DATE_ROWS");
  var n = raw ? parseInt(raw, 10) : 365;
  if (isNaN(n) || n < 30) n = 365;
  if (n > 2000) n = 2000;
  return n;
}

function listProjects_() {
  var ss = getSpreadsheet_();
  var out = [];
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name.indexOf("_") === 0) return;
    out.push(name);
  });
  return out;
}

function sanitizeSheetName_(name) {
  if (!name || typeof name !== "string") throw new Error("invalid sheetName");
  var s = name.trim();
  if (!s) throw new Error("empty sheetName");
  if (/[:\\/?*[\]]/.test(s)) throw new Error("sheetName contains illegal characters");
  if (s.length > 100) throw new Error("sheetName too long");
  return s;
}

/** 建立 A 欄日期二維陣列（每列一個 [字串]），用日曆加天數避免毫秒累加／DST 問題 */
function buildDateColumnValues_(numRows) {
  var values = [];
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  for (var i = 0; i < numRows; i++) {
    var cellDate = new Date(start.getTime());
    cellDate.setDate(start.getDate() + i);
    values.push([Utilities.formatDate(cellDate, TZ, "yyyy/MM/dd")]);
  }
  return values;
}

/**
 * 分批寫入 A 欄：單次 setValues 列數過大時，部分環境會出現「資料列數與範圍列數不符」。
 * 每批最多 WRITE_CHUNK 列，且範圍一律依該批實際列數計算。
 */
var WRITE_CHUNK = 200;

function writeDateColumnInChunks_(sheet, startRow, values) {
  var total = values.length;
  if (total === 0) return;
  var row = startRow;
  for (var offset = 0; offset < total; offset += WRITE_CHUNK) {
    var chunk = values.slice(offset, offset + WRITE_CHUNK);
    var h = chunk.length;
    if (h === 0) continue;
    sheet.getRange(row, 1, row + h - 1, 1).setValues(chunk);
    sheet.getRange(row, 1, row + h - 1, 1).setNumberFormat("@");
    row += h;
  }
}

function createProject_(sheetName, title) {
  var name = sanitizeSheetName_(sheetName);
  var t = (title && String(title).trim()) || name;
  var ss = getSpreadsheet_();
  var existing = ss.getSheetByName(name);
  if (existing) throw new Error("分頁已存在，請換名稱或到線上表格刪掉同名分頁：" + name);

  var sheet = ss.insertSheet(name);
  try {
    sheet.getRange(1, 1, 1, MERGE_LAST_COL).merge();
    sheet.getRange(1, 1).setValue(t).setFontWeight("bold").setHorizontalAlignment("center");
    sheet.getRange(HEADER_ROW, 1).setValue("日期");

    var rows = getDefaultDateRows_();
    var values = buildDateColumnValues_(rows);
    if (values.length !== rows) {
      throw new Error("internal: date row count mismatch " + values.length + " vs " + rows);
    }
    writeDateColumnInChunks_(sheet, DATA_START_ROW, values);

    SpreadsheetApp.flush();
  } catch (err) {
    try {
      var sh = ss.getSheetByName(name);
      if (sh) ss.deleteSheet(sh);
    } catch (ignore) {}
    throw err;
  }
  return { ok: true, data: { sheetName: name } };
}

function todayString_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy/MM/dd");
}

function getSheetByNameOrThrow_(sheetName) {
  if (!sheetName || typeof sheetName !== "string") throw new Error("invalid sheetName");
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(sheetName.trim());
  if (!sh) throw new Error("sheet not found: " + sheetName);
  return sh;
}

/** 第 2 列由 B 欄起，非空白儲存格視為使用者姓名（依欄位順序） */
function listParticipantNames_(sheetName) {
  var sheet = getSheetByNameOrThrow_(sheetName);
  var lastCol = Math.max(sheet.getLastColumn(), 2);
  var names = [];
  for (var c = 2; c <= lastCol; c++) {
    var v = sheet.getRange(HEADER_ROW, c).getDisplayValue();
    var s = String(v).trim();
    if (s) names.push(s);
  }
  return names;
}

function parseCellNumber_(v) {
  if (v === "" || v === null) return 0;
  if (typeof v === "number" && !isNaN(v)) return v;
  if (v instanceof Date) return 0;
  var n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/**
 * projectTotal：第 3 列起，B 欄至最後有資料欄，所有數字加總。
 * participantTotal：指定姓名欄（第 2 列標題相符）同區間加總；未指定姓名則為 0。
 */
function getTotals_(sheetName, participantName) {
  var sheet = getSheetByNameOrThrow_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var projectTotal = 0;
  if (lastRow >= DATA_START_ROW && lastCol >= 2) {
    var values = sheet.getRange(DATA_START_ROW, 2, lastRow, lastCol).getValues();
    for (var i = 0; i < values.length; i++) {
      for (var j = 0; j < values[i].length; j++) {
        projectTotal += parseCellNumber_(values[i][j]);
      }
    }
  }
  var participantTotal = 0;
  var pname =
    participantName && typeof participantName === "string" ? String(participantName).trim() : "";
  if (pname) {
    var col = findParticipantCol_(sheet, pname);
    if (col && lastRow >= DATA_START_ROW) {
      var colVals = sheet.getRange(DATA_START_ROW, col, lastRow, col).getValues();
      for (var k = 0; k < colVals.length; k++) {
        participantTotal += parseCellNumber_(colVals[k][0]);
      }
    }
  }
  return {
    ok: true,
    data: {
      projectTotal: Math.floor(projectTotal),
      participantTotal: Math.floor(participantTotal),
    },
  };
}

function findParticipantCol_(sheet, participantName) {
  if (!participantName || typeof participantName !== "string") return 0;
  var name = participantName.trim();
  if (!name) return 0;
  var lastCol = Math.max(sheet.getLastColumn(), MERGE_LAST_COL);
  for (var c = 2; c <= lastCol; c++) {
    var v = sheet.getRange(HEADER_ROW, c).getDisplayValue();
    if (String(v).trim() === name) return c;
  }
  return 0;
}

function ensureParticipantColumn_(sheetName, participantName) {
  var sheet = getSheetByNameOrThrow_(sheetName);
  if (!participantName || !String(participantName).trim()) throw new Error("invalid participantName");
  var name = String(participantName).trim();
  var col = findParticipantCol_(sheet, name);
  if (col) return { ok: true, data: { column: col } };

  var lastCol = sheet.getLastColumn();
  if (lastCol < 2) lastCol = 1;
  for (var c = 2; c <= Math.max(lastCol, MERGE_LAST_COL); c++) {
    var cell = sheet.getRange(HEADER_ROW, c);
    var v = cell.getValue();
    if (v === "" || v === null) {
      cell.setValue(name);
      SpreadsheetApp.flush();
      return { ok: true, data: { column: c } };
    }
  }
  var newCol = lastCol + 1;
  sheet.getRange(HEADER_ROW, newCol).setValue(name);
  SpreadsheetApp.flush();
  return { ok: true, data: { column: newCol } };
}

function findDateRow_(sheet, dateStr) {
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return 0;
  var range = sheet.getRange(DATA_START_ROW, 1, lastRow, 1).getDisplayValues();
  for (var i = 0; i < range.length; i++) {
    if (String(range[i][0]).trim() === dateStr) return DATA_START_ROW + i;
  }
  return 0;
}

function getOrCreateTodayRow_(sheet, dateStr) {
  var row = findDateRow_(sheet, dateStr);
  if (row) return row;
  var lastRow = sheet.getLastRow();
  var insertAt = lastRow < DATA_START_ROW ? DATA_START_ROW : lastRow + 1;
  sheet.getRange(insertAt, 1).setValue(dateStr).setNumberFormat("@");
  return insertAt;
}

function getTodayCount_(sheetName, participantName) {
  var sheet = getSheetByNameOrThrow_(sheetName);
  var res = ensureParticipantColumn_(sheetName, participantName);
  if (!res.ok) return res;
  var col = res.data.column;
  var today = todayString_();
  var row = getOrCreateTodayRow_(sheet, today);
  var raw = sheet.getRange(row, col).getValue();
  var n = parseInt(raw, 10);
  if (isNaN(n) || raw === "") n = 0;
  return { ok: true, data: { count: n } };
}

function setCount_(sheetName, participantName, value) {
  var v = parseInt(value, 10);
  if (isNaN(v) || v < 0) throw new Error("invalid value");
  var sheet = getSheetByNameOrThrow_(sheetName);
  var res = ensureParticipantColumn_(sheetName, participantName);
  if (!res.ok) return res;
  var col = res.data.column;
  var today = todayString_();
  var row = getOrCreateTodayRow_(sheet, today);
  sheet.getRange(row, col).setValue(v);
  SpreadsheetApp.flush();
  return { ok: true, data: { count: v } };
}

function adjustCount_(sheetName, participantName, delta) {
  var d = parseInt(delta, 10);
  if (isNaN(d) || d === 0) throw new Error("invalid delta");
  var sheet = getSheetByNameOrThrow_(sheetName);
  var res = ensureParticipantColumn_(sheetName, participantName);
  if (!res.ok) return res;
  var col = res.data.column;
  var today = todayString_();
  var row = getOrCreateTodayRow_(sheet, today);
  var raw = sheet.getRange(row, col).getValue();
  var n = parseInt(raw, 10);
  if (isNaN(n) || raw === "") n = 0;
  n += d;
  if (n < 0) n = 0;
  sheet.getRange(row, col).setValue(n);
  SpreadsheetApp.flush();
  return { ok: true, data: { count: n } };
}
