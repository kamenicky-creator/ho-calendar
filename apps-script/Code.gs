/**
 * HO kalendár: server v Google Apps Scripte.
 *
 * Dáta sú v Google tabuľke, ku ktorej je skript pripojený:
 *   hárok „Tím“      stĺpce id | meno | aktivny
 *   hárok „2026-11“  jeden hárok na mesiac: datum | den | poznamka | <id kolegu> | <id kolegu> | …
 *                    v bunkách kolegov: HO, Dov, Chor, Cesta; prázdna bunka = kancelária
 *
 * Tabuľku môžeš upravovať aj ručne, kalendár zmeny načíta pri ďalšej synchronizácii.
 * Postup nasadenia je v README.md v repozitári.
 */

const TEAM_SHEET = 'Tím';
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
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  if (!key) return out_({ok: false, error: 'not_configured'});
  if (!req || req.key !== key) return out_({ok: false, error: 'unauthorized'});
  try {
    switch (req.action) {
      case 'sync':
        return out_({ok: true, data: {team: readTeam_(), month: readMonth_(checkYm_(req.ym))}});
      case 'team':
        return out_({ok: true, data: readTeam_()});
      case 'month':
        return out_({ok: true, data: readMonth_(checkYm_(req.ym))});
      case 'setTeam':
        return out_({ok: true, data: withLock_(function () { return writeTeam_(req.members); })});
      case 'setCells': {
        const ym = checkYm_(req.ym);
        return out_({ok: true, data: withLock_(function () { writeCells_(ym, req.changes); return readMonth_(ym); })});
      }
      case 'setNotes': {
        const ym = checkYm_(req.ym);
        return out_({ok: true, data: withLock_(function () { writeNotes_(ym, req.changes); return readMonth_(ym); })});
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
  Logger.log('Odkaz pre tím: https://kamenicky-creator.github.io/ho-calendar/?kluc=' + k);
  return k;
}

/* ---------- tím ---------- */

function teamSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

function writeTeam_(members) {
  if (!Array.isArray(members) || members.length > 300) throw {code: 'bad_request'};
  const seen = {};
  const rows = [];
  members.forEach(function (m) {
    if (!m || !ID_RE.test(String(m.id)) || seen[m.id]) return;
    seen[m.id] = true;
    rows.push([String(m.id), String(m.name || '').trim().slice(0, 40) || String(m.id), m.active !== false]);
  });
  const sh = teamSheet_();
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
  return readTeam_();
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

function rowIndex_(sh) {
  const tz = Session.getScriptTimeZone();
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) {
    const dd = dayKey_(r[0], tz);
    if (dd) map[dd] = i + 2;
  });
  return map;
}

function writeCells_(ym, changes) {
  if (!Array.isArray(changes) || changes.length > 500) throw {code: 'bad_request'};
  const sh = monthSheet_(ym, true);
  const rows = rowIndex_(sh);
  const lastCol = Math.max(sh.getLastColumn(), FIXED_COLS);
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  changes.forEach(function (ch) {
    if (!ch || !ID_RE.test(String(ch.id)) || !/^\d\d$/.test(String(ch.dd))) return;
    const row = rows[ch.dd];
    if (!row) return;
    let col = header.indexOf(String(ch.id)) + 1;
    if (col < 1) {
      header.push(String(ch.id));
      col = header.length;
      sh.getRange(1, col).setValue(String(ch.id)).setFontWeight('bold');
    }
    sh.getRange(row, col).setValue(STATUS_TO_CELL[ch.s] || '');
  });
}

function writeNotes_(ym, changes) {
  if (!Array.isArray(changes) || changes.length > 100) throw {code: 'bad_request'};
  const sh = monthSheet_(ym, true);
  const rows = rowIndex_(sh);
  changes.forEach(function (ch) {
    if (!ch || !/^\d\d$/.test(String(ch.dd))) return;
    const row = rows[ch.dd];
    if (row) sh.getRange(row, 3).setValue(String(ch.text || '').slice(0, 200));
  });
}

/* ---------- jednorazový import (volá ho Seed.gs) ---------- */

function importSeed_(seed) {
  if (!seed || !Array.isArray(seed.team) || !seed.months) throw new Error('Súbor Seed.gs neobsahuje platné dáta.');
  withLock_(function () {
    if (readTeam_().members.length) {
      throw new Error('Hárok „Tím“ už obsahuje kolegov. Import sa spúšťa len raz, do prázdnej tabuľky.');
    }
    writeTeam_(seed.team);
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
