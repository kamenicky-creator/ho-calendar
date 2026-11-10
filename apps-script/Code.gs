/**
 * HO kalendár: server v Google Apps Scripte.
 *
 * Dáta sú v Google tabuľke, ku ktorej je skript pripojený:
 *   hárok „Tím“      stĺpce id | meno | aktivny
 *   hárok „2026-11“  jeden hárok na mesiac: datum | den | poznamka | <id kolegu> | <id kolegu> | …
 *                    v bunkách kolegov: HO, Dov, Chor, Cesta; prázdna bunka = kancelária
 *   hárok „Zmeny“    denník zmien z kalendára: cas | kto | co | datum | koho | predtym | potom
 *
 * Tabuľku môžeš upravovať aj ručne, kalendár zmeny načíta pri ďalšej synchronizácii.
 * Postup nasadenia je v README.md v repozitári.
 */

// Voliteľné nastavenie. SPREADSHEET_ID nechaj prázdne, ak je skript pripojený k tabuľke (Rozšírenia › Apps Script).
const SPREADSHEET_ID = '';   // ID Google tabuľky s dátami; prázdne = tabuľka, ku ktorej je skript pripojený
const DEFAULT_TEAM_KEY = ''; // tímový kľúč, ak ho nevytváraš funkciou vytvorTimovyKluc

const TEAM_SHEET = 'Tím';
const LOG_SHEET = 'Zmeny';
const ADMIN_ID = '_admin';
const LABEL = {o: 'Kancelária', ho: 'Home office', dov: 'Dovolenka / voľno', nem: 'Choroba / lekár', sc: 'Služobná cesta'};
const FIXED_COLS = 3; // datum, den, poznamka
const ID_RE = /^[A-Za-z0-9_\-.~:@+]{1,60}$/;
const STATUS_TO_CELL = {ho: 'HO', dov: 'Dov', nem: 'Chor', sc: 'Cesta'};
const CELL_TO_STATUS = {
  'ho': 'ho', 'home office': 'ho',
  'dov': 'dov', 'dovolenka': 'dov', 'dovolená': 'dov', 'volno': 'dov', 'voľno': 'dov', 'off': 'dov',
  'chor': 'nem', 'choroba': 'nem', 'nemoc': 'nem', 'lekar': 'nem', 'lekár': 'nem', 'lékař': 'nem', 'pn': 'nem',
  'cesta': 'sc', 'sc': 'sc', 'služobka': 'sc', 'sluzobka': 'sc'
};
const WD_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const FIXED_HOLIDAYS = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];

/* ---------- webová aplikácia ---------- */

function doGet() {
  return out_({ok: true, data: {info: 'HO kalendár: server beží.'}});
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return out_({ok: false, error: 'bad_request'});
  }
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY') || DEFAULT_TEAM_KEY;
  if (!key) return out_({ok: false, error: 'not_configured'});
  if (!req || req.key !== key) return out_({ok: false, error: 'unauthorized'});
  try {
    switch (req.action) {
      case 'sync':
        return out_({ok: true, data: {team: readTeam_(), month: monthWithLog_(checkYm_(req.ym))}});
      case 'team':
        return out_({ok: true, data: readTeam_()});
      case 'month':
        return out_({ok: true, data: monthWithLog_(checkYm_(req.ym))});
      case 'setTeam':
        return out_({ok: true, data: withLock_(function () { return writeTeam_(req.members, req.by); })});
      case 'setCells': {
        const ym = checkYm_(req.ym);
        return out_({ok: true, data: withLock_(function () { writeCells_(ym, req.changes, req.by); return monthWithLog_(ym); })});
      }
      case 'setNotes': {
        const ym = checkYm_(req.ym);
        return out_({ok: true, data: withLock_(function () { writeNotes_(ym, req.changes, req.by); return monthWithLog_(ym); })});
      }
      default:
        return out_({ok: false, error: 'bad_request'});
    }
  } catch (err) {
    const code = err && err.code ? err.code : 'server_error';
    if (code === 'server_error') console.error(err);
    return out_({ok: false, error: code, message: String(err && err.message ? err.message : '')});
  }
}

/**
 * Vytvorí nový tímový kľúč a vypíše ho do protokolu (Zobraziť › Protokoly).
 * Spusti raz pri nasadení. Opätovným spustením starý kľúč zneplatníš.
 */
function vytvorTimovyKluc() {
  const k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', k);
  Logger.log('Tímový kľúč: ' + k);
  Logger.log('Vlož ho vo Verceli do premennej GAS_KEY.');
  return k;
}

/* ---------- tím ---------- */

function teamSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(TEAM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TEAM_SHEET, 0);
    sh.getRange(1, 1, 1, 3).setValues([['id', 'meno', 'aktivny']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTeam_() {
  const sh = teamSheet_();
  const last = sh.getLastRow();
  if (last < 2) return {members: []};
  const vals = sh.getRange(2, 1, last - 1, 3).getValues();
  const seen = {};
  const members = [];
  vals.forEach(function (r) {
    const id = String(r[0]).trim();
    if (!ID_RE.test(id) || seen[id]) return;
    seen[id] = true;
    const a = String(r[2]).trim().toLowerCase();
    members.push({id: id, name: String(r[1]).trim().slice(0, 40) || id, active: !(r[2] === false || a === 'false' || a === 'nie' || a === '0')});
  });
  return {members: members};
}

function writeTeam_(members, by, noLog) {
  if (!Array.isArray(members) || members.length > 300) throw {code: 'bad_request'};
  const seen = {};
  const rows = [];
  members.forEach(function (m) {
    if (!m || !ID_RE.test(String(m.id)) || seen[m.id]) return;
    seen[m.id] = true;
    rows.push([String(m.id), String(m.name || '').trim().slice(0, 40) || String(m.id), m.active !== false]);
  });
  const before = readTeam_().members;
  const sh = teamSheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  const after = readTeam_();
  if (!noLog) {
    const old = {};
    before.forEach(function (m) { old[m.id] = m; });
    const who = whoName_(by, after.members);
    const now = new Date();
    const log = [];
    after.members.forEach(function (m) {
      const o = old[m.id];
      if (!o) { log.push([now, who, 'Tím', '', m.name, '', 'pridaný']); return; }
      if (o.name !== m.name) log.push([now, who, 'Tím', '', m.name, o.name, m.name]);
      if (o.active !== m.active) log.push([now, who, 'Tím', '', m.name, o.active ? 'aktívny' : 'skrytý', m.active ? 'aktívny' : 'skrytý']);
    });
    appendLog_(log);
  }
  return after;
}

/* ---------- mesiace ---------- */

function checkYm_(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m || +m[1] < 2020 || +m[1] > 2100 || +m[2] < 1 || +m[2] > 12) throw {code: 'bad_request'};
  return String(ym);
}

function pad_(n) {
  return (n < 10 ? '0' : '') + n;
}

function holidays_(y) {
  const set = {};
  FIXED_HOLIDAYS.forEach(function (k) { set[k] = true; });
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const easter = new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
  [-2, 1].forEach(function (off) {
    const x = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + off);
    set[pad_(x.getMonth() + 1) + '-' + pad_(x.getDate())] = true;
  });
  return set;
}

function monthSheet_(ym, create) {
  const ss = ss_();
  let sh = ss.getSheetByName(ym);
  if (sh || !create) return sh;
  sh = ss.insertSheet(ym);
  const ids = readTeam_().members.filter(function (m) { return m.active; }).map(function (m) { return m.id; });
  const header = ['datum', 'den', 'poznamka'].concat(ids);
  const parts = ym.split('-').map(Number);
  const hol = holidays_(parts[0]);
  const rows = [];
  for (let d = new Date(parts[0], parts[1] - 1, 1); d.getMonth() === parts[1] - 1; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    const isHol = hol[pad_(parts[1]) + '-' + pad_(d.getDate())];
    const row = [ym + '-' + pad_(d.getDate()), WD_SHORT[wd] + (isHol ? ' (sviatok)' : ''), ''];
    ids.forEach(function () { row.push(''); });
    rows.push(row);
  }
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(FIXED_COLS);
  return sh;
}

function dayKey_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'dd');
  const m = /^\d{4}-\d{2}-(\d{2})$/.exec(String(v).trim());
  return m ? m[1] : '';
}

function readMonth_(ym) {
  const res = {people: {}, notes: {}};
  const sh = monthSheet_(ym, false);
  if (!sh) return res;
  const vals = sh.getDataRange().getValues();
  if (!vals.length) return res;
  const header = vals[0].map(function (h) { return String(h).trim(); });
  for (let c = FIXED_COLS; c < header.length; c++) if (ID_RE.test(header[c])) res.people[header[c]] = {};
  const tz = Session.getScriptTimeZone();
  for (let r = 1; r < vals.length; r++) {
    const dd = dayKey_(vals[r][0], tz);
    if (!dd) continue;
    const note = String(vals[r][2] === undefined ? '' : vals[r][2]).trim();
    if (note) res.notes[dd] = note.slice(0, 200);
    for (let c = FIXED_COLS; c < header.length; c++) {
      if (!res.people[header[c]]) continue;
      const s = CELL_TO_STATUS[String(vals[r][c]).trim().toLowerCase()];
      if (s) res.people[header[c]][dd] = s;
    }
  }
  return res;
}

function monthGrid_(sh) {
  const tz = Session.getScriptTimeZone();
  const vals = sh.getDataRange().getValues();
  const header = vals[0].map(function (h) { return String(h).trim(); });
  const rows = {};
  for (let r = 1; r < vals.length; r++) {
    const dd = dayKey_(vals[r][0], tz);
    if (dd) rows[dd] = r + 1;
  }
  return {vals: vals, header: header, rows: rows};
}

function writeCells_(ym, changes, by) {
  if (!Array.isArray(changes) || changes.length > 500) throw {code: 'bad_request'};
  const sh = monthSheet_(ym, true);
  const g = monthGrid_(sh);
  const team = readTeam_().members;
  const names = namesById_(team);
  const who = whoName_(by, team);
  const now = new Date();
  const log = [];
  changes.forEach(function (ch) {
    if (!ch || !ID_RE.test(String(ch.id)) || !/^\d\d$/.test(String(ch.dd))) return;
    const id = String(ch.id);
    const row = g.rows[ch.dd];
    if (!row) return;
    let col = g.header.indexOf(id) + 1;
    let old = '';
    if (col < 1) {
      g.header.push(id);
      col = g.header.length;
      sh.getRange(1, col).setValue(id).setFontWeight('bold');
    } else {
      old = g.vals[row - 1][col - 1];
    }
    const oldS = CELL_TO_STATUS[String(old === undefined ? '' : old).trim().toLowerCase()] || 'o';
    const newS = STATUS_TO_CELL[ch.s] ? ch.s : 'o';
    if (oldS === newS) return;
    const val = STATUS_TO_CELL[newS] || '';
    sh.getRange(row, col).setValue(val);
    g.vals[row - 1][col - 1] = val;
    log.push([now, who, 'Stav', ym + '-' + ch.dd, names[id] || id, LABEL[oldS], LABEL[newS]]);
  });
  appendLog_(log);
}

function writeNotes_(ym, changes, by) {
  if (!Array.isArray(changes) || changes.length > 100) throw {code: 'bad_request'};
  const sh = monthSheet_(ym, true);
  const g = monthGrid_(sh);
  const who = whoName_(by, readTeam_().members);
  const now = new Date();
  const log = [];
  changes.forEach(function (ch) {
    if (!ch || !/^\d\d$/.test(String(ch.dd))) return;
    const row = g.rows[ch.dd];
    if (!row) return;
    const text = String(ch.text || '').slice(0, 200);
    const old = String(g.vals[row - 1][2] === undefined ? '' : g.vals[row - 1][2]);
    if (old.trim() === text.trim()) return;
    sh.getRange(row, 3).setValue(text);
    g.vals[row - 1][2] = text;
    log.push([now, who, 'Poznámka', ym + '-' + ch.dd, '', old, text]);
  });
  appendLog_(log);
}

/* ---------- denník zmien ---------- */

function namesById_(team) {
  const map = {};
  team.forEach(function (m) { map[m.id] = m.name; });
  return map;
}

function whoName_(by, team) {
  if (!by) return 'neznámy';
  if (by === ADMIN_ID) return 'Správca';
  return namesById_(team)[by] || String(by).slice(0, 40);
}

function logSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, 7).setValues([['cas', 'kto', 'co', 'datum', 'koho', 'predtym', 'potom']]).setFontWeight('bold');
    sh.getRange(2, 1, sh.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    sh.getRange(2, 4, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appendLog_(rows) {
  if (!rows.length) return;
  const sh = logSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
}

// Posledné zmeny dní daného mesiaca a zmeny tímu urobené v tom mesiaci, od najnovšej.
function readLog_(ym, limit) {
  const sh = ss_().getSheetByName(LOG_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - 1999);
  const vals = sh.getRange(start, 1, last - start + 1, 7).getValues();
  const tz = Session.getScriptTimeZone();
  const out = [];
  for (let i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    const r = vals[i];
    const t = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd HH:mm') : String(r[0]);
    const date = r[3] instanceof Date ? Utilities.formatDate(r[3], tz, 'yyyy-MM-dd') : String(r[3]);
    const inMonth = date ? date.slice(0, 7) === ym : (r[2] === 'Tím' && t.slice(0, 7) === ym);
    if (!inMonth) continue;
    out.push({t: t, by: String(r[1]), what: String(r[2]), date: date, whom: String(r[4]), from: String(r[5]).slice(0, 200), to: String(r[6]).slice(0, 200)});
  }
  return out;
}

function monthWithLog_(ym) {
  const m = readMonth_(ym);
  m.log = readLog_(ym, 30);
  return m;
}

/* ---------- jednorazový import (volá ho Seed.gs) ---------- */

function importSeed_(seed) {
  if (!seed || !Array.isArray(seed.team) || !seed.months) throw new Error('Súbor Seed.gs neobsahuje platné dáta.');
  withLock_(function () {
    if (readTeam_().members.length) {
      throw new Error('Hárok „Tím“ už obsahuje kolegov. Import sa spúšťa len raz, do prázdnej tabuľky.');
    }
    writeTeam_(seed.team, null, true);
    const tz = Session.getScriptTimeZone();
    Object.keys(seed.months).sort().forEach(function (ym) {
      checkYm_(ym);
      const m = seed.months[ym];
      const people = m.people || {};
      const notes = m.notes || {};
      const sh = monthSheet_(ym, true);
      const vals = sh.getDataRange().getValues();
      const header = vals[0].map(function (h) { return String(h).trim(); });
      Object.keys(people).forEach(function (id) { if (ID_RE.test(id) && header.indexOf(id) < 0) header.push(id); });
      const width = header.length;
      const grid = vals.map(function (row, i) {
        if (i === 0) return header.slice();
        const r = row.slice();
        while (r.length < width) r.push('');
        return r;
      });
      for (let r = 1; r < grid.length; r++) {
        const dd = dayKey_(grid[r][0], tz);
        if (!dd) continue;
        if (notes[dd]) grid[r][2] = String(notes[dd]).slice(0, 200);
        Object.keys(people).forEach(function (id) {
          const s = people[id] && people[id][dd];
          const c = header.indexOf(id);
          if (c >= FIXED_COLS && STATUS_TO_CELL[s]) grid[r][c] = STATUS_TO_CELL[s];
        });
      }
      sh.getRange(2, 1, grid.length - 1, 1).setNumberFormat('@');
      sh.getRange(1, 1, grid.length, width).setValues(grid);
      sh.getRange(1, 1, 1, width).setFontWeight('bold');
    });
  });
  Logger.log('Import je hotový.');
}

/* ---------- pomocné ---------- */

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw {code: 'busy'};
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
