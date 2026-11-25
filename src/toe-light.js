// Variables used by Scriptable.
// These must be at the very top of the script. Do not edit.
// icon-color: deep-blue; icon-glyph: bolt;
//
// TOE Light — віджет графіка погодинних відключень Тернопільобленерго для Scriptable.
// TOE_LIGHT_SCRIPT (маркер для самооновлення — не видаляти)
//
// • Запусти скрипт у Scriptable, щоб вибрати адресу, тему, колір і сповіщення.
// • Адреса й налаштування зберігаються лише на телефоні (Keychain), у коді їх немає.
// • Підтримує малий, середній і великий віджет, а також віджети на екрані блокування.
// • Дані: api-poweron.toe.com.ua (той самий бекенд, що й poweron.toe.com.ua). Неофіційно.
//
// Приклад профілю, який майстер зберігає в Keychain (значення вигадані):
//   { cityId: 1032, cityName: "Тернопіль", streetId: 10001, streetName: "вул. Прикладна",
//     building: "1", group: "1.1", theme: "auto", accent: "blue", notify: 30 }

const VERSION = "__VERSION__";   // підставляється при збірці
const BASE_URL = "__BASE_URL__"; // адреса сайту на GitHub Pages, звідки приходять оновлення

// ---------- загальні налаштування (однакові для всіх) ----------
const APP = {
  api: "https://api-poweron.toe.com.ua/api",
  site: "https://poweron.toe.com.ua",
  refreshMinutes: 15,       // як часто просити iOS оновити віджет
  notifyMinutesBefore: 30,  // за замовчуванням; змінюється в налаштуваннях скрипта
  updateCheckHours: 6,      // як часто перевіряти нову версію скрипта
  storeKey: "toe-light.profile",
};

const THEMES = { auto: "Як у системі", light: "Світла", dark: "Темна" };
const ACCENTS = {
  none:   ["Без кольору", null],
  blue:   ["Синій", "#0A84FF"],
  indigo: ["Індиго", "#5E5CE6"],
  purple: ["Фіолетовий", "#BF5AF2"],
  teal:   ["Бірюзовий", "#40C8E0"],
  green:  ["Зелений", "#30D158"],
  yellow: ["Жовтий", "#FFD60A"],
  orange: ["Помаранчевий", "#FF9F0A"],
  pink:   ["Рожевий", "#FF375F"],
};
const NOTIFY_OPTIONS = [0, 15, 30, 60];

const STATUS = { on: "#30D158", off: "#FF453A", sw: "#FFB340", unknown: "#8E8E93" };

// ---------- профіль ----------
function loadProfile() {
  try {
    if (!Keychain.contains(APP.storeKey)) return null;
    const p = JSON.parse(Keychain.get(APP.storeKey));
    return p && p.cityId && p.streetId && p.building && p.group ? p : null;
  } catch (e) { return null; }
}
function saveProfile(p) { Keychain.set(APP.storeKey, JSON.stringify(p)); }
const notifyOf = p => (typeof p.notify === "number" ? p.notify : APP.notifyMinutesBefore);
const shortCity = p => (p.cityName && p.cityName !== "Тернопіль" ? `${p.cityName}, ` : "");
const labelOf = p => `${shortCity(p)}${p.streetName || "вулиця"}, ${p.building}`;

// ---------- кольори й тема ----------
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, k) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function accentHex(p) {
  if (ACCENTS[p.accent]) return ACCENTS[p.accent][1];
  return hexToRgb(p.accent) ? p.accent : null;
}
function accentName(p) {
  if (ACCENTS[p.accent]) return ACCENTS[p.accent][0];
  return hexToRgb(p.accent) ? p.accent.toUpperCase() : ACCENTS.none[0];
}
// кольори тексту статусу (таймер): на світлому фоні темніші, щоб читалися
const TXT = {
  light: { on: "#1E8E3E", off: "#D1342A" },
  dark:  { on: "#32D74B", off: "#FF6961" },
};
function isDark(theme) {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  try { return Device.isUsingDarkAppearance(); } catch (e) { return false; }
}
function makePalette(p) {
  const a = accentHex(p);
  const L = {
    bg: a ? mixHex("#FFFFFF", a, 0.12) : "#FFFFFF",
    text: "#000000",
    sub: "#6E6E73",
    head: a ? mixHex(a, "#000000", 0.3) : "#6E6E73",
  };
  const D = {
    bg: a ? mixHex("#1C1C1E", a, 0.2) : "#1C1C1E",
    text: "#FFFFFF",
    sub: "#A1A1A6",
    head: a ? mixHex(a, "#FFFFFF", 0.2) : "#A1A1A6",
  };
  const theme = THEMES[p.theme] ? p.theme : "auto";
  const dyn = (l, d) => theme === "light" ? new Color(l)
    : theme === "dark" ? new Color(d)
    : Color.dynamic(new Color(l), new Color(d));
  const mk = k => dyn(L[k], D[k]);
  return {
    bg: mk("bg"), text: mk("text"), sub: mk("sub"), head: mk("head"),
    tOn: dyn(TXT.light.on, TXT.dark.on), tOff: dyn(TXT.light.off, TXT.dark.off),
    // у DrawContext динамічні кольори ненадійні, тому для підписів під смужкою вибираємо колір одразу
    subHex: isDark(theme) ? D.sub : L.sub,
    on: new Color(STATUS.on), off: new Color(STATUS.off), sw: new Color(STATUS.sw), unknown: new Color(STATUS.unknown),
  };
}

// ---------- дата/час ----------
const pad = n => String(n).padStart(2, "0");
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const slotToTime = s => `${pad(Math.floor(s / 2))}:${s % 2 ? "30" : "00"}`;
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function slotDate(base, slot) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  d.setMinutes(slot * 30);
  return d;
}
function humanDur(min) {
  if (min < 1) return "менше хвилини";
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m} хв`;
  if (m === 0) return `${h} год`;
  return `${h} год ${m} хв`;
}
// "о 10:30" / "об 11:00"
const at = s => (Math.floor(s / 2) === 11 ? "об " : "о ") + slotToTime(s);

// ---------- розміри віджета й ширина тексту ----------
// Ширина віджета в pt за розміром екрана (таблиця Apple HIG, iOS dimensions): [малий, середній і великий].
const WIDGET_WIDTHS = {
  "430x932": [170, 364], "428x926": [170, 364], "414x896": [169, 360], "414x736": [159, 348],
  "393x852": [158, 338], "390x844": [158, 338], "375x812": [155, 329], "375x667": [148, 321],
  "360x780": [155, 329], "320x568": [141, 292],
};
function widgetWidth(family) {
  let small = 158, medium = 338; // запасні значення
  try {
    const s = Device.screenSize();
    const w = Math.min(s.width, s.height), h = Math.max(s.width, s.height);
    let t = WIDGET_WIDTHS[`${w}x${h}`];
    if (!t) { // новіші моделі: беремо найближчий менший екран із таблиці (ширина віджета не завищується)
      const k = Object.keys(WIDGET_WIDTHS).map(x => x.split("x").map(Number)).filter(x => x[0] <= w).sort((a, b) => b[0] - a[0])[0];
      if (k) t = WIDGET_WIDTHS[`${k[0]}x${k[1]}`];
    }
    if (t) { small = t[0]; medium = t[1]; }
  } catch (e) { /* лишаємо запасні значення */ }
  return family === "small" ? small : medium;
}

// Scriptable не вміє міряти текст, тому ширину рахуємо за метриками Inter (за формою близький до системного SF)
// із запасом 6%. Це потрібно, щоб вибрати варіант тексту, який точно влізе, і щоб підписи не налізали одне на одне.
const EM = (() => {
  const m = {
    "0": .63, "1": .41, "2": .61, "3": .62, "4": .65, "5": .59, "6": .62, "7": .57, "8": .62, "9": .62,
    " ": .28, ":": .29, ",": .29, ".": .29, "–": .5, "-": .46, "(": .37, ")": .37, "·": .29, "+": .66, "…": .86, "/": .36, "ʼ": .26,
  };
  const lo = "абвгґдеєжзиіїйклмнопрстуфхцчшщьюя";
  const lw = [56, 59, 56, 44, 44, 61, 58, 57, 81, 49, 59, 24, 24, 59, 54, 58, 77, 59, 60, 59, 61, 57, 47, 56, 69, 55, 60, 58, 82, 84, 56, 84, 55];
  const uw = [69, 65, 65, 58, 58, 82, 60, 73, 96, 62, 75, 27, 27, 75, 67, 75, 90, 74, 76, 74, 64, 73, 65, 63, 83, 68, 72, 70, 96, 97, 65, 101, 64];
  [...lo].forEach((c, i) => { m[c] = lw[i] / 100; });
  [...lo.toUpperCase()].forEach((c, i) => { m[c] = uw[i] / 100; });
  return m;
})();
const WEIGHT_K = { regular: 1, medium: 1.015, semibold: 1.03, bold: 1.045 };
function textW(str, size, weight) {
  let em = 0;
  for (const ch of String(str)) em += EM[ch] !== undefined ? EM[ch] : 0.62;
  return em * size * (WEIGHT_K[weight || "regular"] || 1) * 1.06;
}

// ---------- API ----------
async function apiGet(path, extraHeaders) {
  const req = new Request(`${APP.api}${path}`);
  req.timeoutInterval = 20;
  req.headers = Object.assign({
    "Content-Type": "application/json",
    "Accept": "application/ld+json, application/json",
    "Referer": `${APP.site}/`,
    "Origin": APP.site,
  }, extraHeaders || {});
  const json = await req.loadJSON();
  const code = req.response && req.response.statusCode;
  if (code && code >= 400) throw new Error(`HTTP ${code}`);
  return json;
}
const membersOf = j => Array.isArray(j) ? j : (j && Array.isArray(j["hydra:member"]) ? j["hydra:member"] : []);

const searchCities = q => apiGet(`/pw_cities?pagination=false&name=${encodeURIComponent(q)}`).then(membersOf);
const getStreets = cityId => apiGet(`/pw_streets?pagination=false&city.id=${cityId}`).then(membersOf);
const getBuildings = (cityId, streetId) =>
  apiGet(`/pw-accounts/building-names?cityId=${cityId}&streetId=${streetId}`)
    .then(j => (j && Array.isArray(j.buildingNames) ? j.buildingNames : []));
const getBuildingGroups = (cityId, streetId, building) =>
  apiGet(`/pw-accounts/building-groups?cityId=${cityId}&streetId=${streetId}&buildingNames=${encodeURIComponent(building)}`)
    .then(j => (j && Array.isArray(j.buildingGroups) ? j.buildingGroups : []))
    .catch(() => []);

async function fetchSchedule(p) {
  const raw = `${p.cityId}/${p.streetId}/${p.building}`;
  const time = `${p.cityId}${p.streetId}${p.building}`;
  const q = `before=0&after=0&group=${encodeURIComponent(p.group)}&time=${encodeURIComponent(time)}`;
  const json = await apiGet(`/a_gpv_g?${q}`, { "X-debug-key": Data.fromString(raw).toBase64String() });
  return membersOf(json);
}

const NOT_IN_SCHEDULE = v => !v || /не входить/i.test(v);
// черга з building-groups (з підчергою, напр. "4.1"), інакше chergGpv будинку
function resolveGroup(building, groups) {
  if (NOT_IN_SCHEDULE(building.chergGpv)) return null;
  if (groups && groups.length) {
    const m = groups.find(g => g.chergGpv === building.chergGpv || String(g.chergGpv).startsWith(`${building.chergGpv}.`));
    return (m || groups[0]).chergGpv;
  }
  return building.chergGpv;
}

// ---------- кеш ----------
const fm = FileManager.local();
const cachePath = p => fm.joinPath(fm.documentsDirectory(), `toe-light-cache-${p.cityId}-${p.streetId}-${encodeURIComponent(p.building)}-${p.group}.json`);

async function loadData(p) {
  try {
    const members = await fetchSchedule(p);
    const payload = { fetchedAt: Date.now(), members };
    fm.writeString(cachePath(p), JSON.stringify(payload));
    return Object.assign({}, payload, { offline: false });
  } catch (e) {
    const path = cachePath(p);
    if (fm.fileExists(path)) {
      const cached = JSON.parse(fm.readString(path));
      return Object.assign({}, cached, { offline: true, error: String(e) });
    }
    return { fetchedAt: null, members: [], offline: true, error: String(e) };
  }
}

// ---------- розбір графіка ----------
// графік дня -> масив з 48 станів: "on" | "off" | "sw"
function parseDay(member, group) {
  const times = member && member.dataJson && member.dataJson[group] && member.dataJson[group].times;
  if (!times) return null;
  const slots = new Array(48).fill("on");
  for (const [k, v] of Object.entries(times)) {
    const [h, m] = k.split(":").map(Number);
    const i = h * 2 + (m >= 30 ? 1 : 0);
    if (!(i >= 0 && i <= 47)) continue;
    slots[i] = v === "1" ? "off" : v === "10" ? "sw" : "on";
  }
  return slots;
}

// найсвіжіший графік для кожної дати
function pickByDate(members) {
  const byDate = {};
  for (const m of members) {
    const key = String(m.dateGraph || "").slice(0, 10);
    if (!key) continue;
    if (!byDate[key] || new Date(m.dateCreate) > new Date(byDate[key].dateCreate)) byDate[key] = m;
  }
  return byDate;
}

// блоки без світла (off+sw підряд) -> [{start, end, offStart, offEnd}]
function outageBlocks(slots) {
  const blocks = [];
  if (!slots) return blocks;
  let i = 0;
  while (i < 48) {
    if (slots[i] === "on") { i++; continue; }
    const start = i;
    while (i < 48 && slots[i] !== "on") i++;
    const end = i;
    let offStart = -1, offEnd = -1;
    for (let j = start; j < end; j++) {
      if (slots[j] === "off") { if (offStart < 0) offStart = j; offEnd = j + 1; }
    }
    blocks.push({ start, end, offStart: offStart < 0 ? start : offStart, offEnd: offEnd < 0 ? end : offEnd });
  }
  return blocks;
}
const rangeText = b => `${slotToTime(b.offStart)}–${slotToTime(b.offEnd)}`;

// ---------- стан "зараз" ----------
// lead — текст без зворотного відліку, leadShort — те саме без дужок «можливо …», target — момент, до якого
// рахуємо «через …», next — до якого стану йде відлік («off» — до відключення, «on» — до повернення світла).
// Сам відлік малює iOS, тому він іде й тоді, коли віджет давно не оновлювався.
function computeStatus(today, tomorrow, now) {
  const slot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const t = today || new Array(48).fill("on");
  const state = t[slot];
  const nowMs = now.getTime();
  const tomorrowDate = new Date(nowMs + 864e5);
  const minsTo = d => Math.max(0, Math.round((d - nowMs) / 60000));
  const result = (title, lead, target, short, next, leadShort) => ({
    state, title, lead, leadShort: leadShort || lead, target, next: next || null, short, slot,
    sub: target ? `${lead} · через ${humanDur(minsTo(target))}` : lead,
  });

  const todayBlocks = outageBlocks(today);
  const tomorrowBlocks = outageBlocks(tomorrow);

  if (state === "on") {
    let b = todayBlocks.find(x => x.start > slot), base = now, dayWord = "";
    if (!b && tomorrow) { b = tomorrowBlocks[0]; base = tomorrowDate; dayWord = "завтра "; }
    if (b) {
      const warn = b.start < b.offStart ? ` (можливо з ${slotToTime(b.start)})` : "";
      const lead = `вимкнуть ${dayWord}${at(b.offStart)}`;
      return result("Світло є", lead + warn, slotDate(base, b.offStart), `${dayWord}вимк. ${slotToTime(b.offStart)}`, "off", lead);
    }
    if (todayBlocks.length) {
      return result("Світло є", tomorrow ? "сьогодні й завтра відключень більше немає" : "сьогодні відключень більше немає", null, "без відключень");
    }
    return result("Світло є", tomorrow ? "сьогодні й завтра без відключень" : "на сьогодні відключень не заплановано", null, "без відключень");
  }

  // всередині блоку без світла; якщо він упирається в північ — продовження в завтрашньому графіку
  const b = todayBlocks.find(x => x.start <= slot && slot < x.end);
  const cont = b.end === 48 && tomorrow && tomorrow[0] !== "on" && tomorrowBlocks.length ? tomorrowBlocks[0] : null;
  const endSlot = cont ? cont.end : b.end;
  const endBase = cont ? tomorrowDate : now;
  const dayWord = cont ? "завтра " : "";
  const endDate = slotDate(endBase, endSlot);

  if (state === "off") {
    // коли закінчується саме відключення (далі може бути перемикання)
    let retSlot = b.offEnd, retBase = now;
    if (b.offEnd === b.end && cont) {
      retBase = tomorrowDate;
      retSlot = tomorrow[0] === "off" ? cont.offEnd : 0;
    }
    const retTomorrow = retBase !== now;
    const sameAsEnd = retSlot === endSlot && retBase === endBase;
    const tail = sameAsEnd ? "" : ` (можливо до ${cont && !retTomorrow ? "завтра " : ""}${slotToTime(endSlot)})`;
    const lead = `увімкнуть ${retTomorrow ? "завтра " : ""}${at(retSlot)}`;
    return result("Світла немає", lead + tail, slotDate(retBase, retSlot),
      `увімк. ${retTomorrow ? "завтра " : ""}${slotToTime(retSlot)}`, "on", lead);
  }

  if (slot < b.offStart) {
    return result("Перемикання", `вимкнення ${rangeText(b)}`, slotDate(now, b.offStart), `вимк. ${slotToTime(b.offStart)}`, "off");
  }
  return result("Перемикання", `увімкнуть до ${dayWord}${slotToTime(endSlot)}`, endDate, `до ${slotToTime(endSlot)}`, "on");
}


// коли наступного разу зміниться стан (on/off/sw) — щоб попросити iOS оновити віджет саме тоді
function nextChange(today, tomorrow, now) {
  const slot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const all = (today || new Array(48).fill("on")).concat(tomorrow || new Array(48).fill("on"));
  for (let i = slot + 1; i < all.length; i++) {
    if (all[i] !== all[slot]) return slotDate(i < 48 ? now : new Date(now.getTime() + 864e5), i % 48);
  }
  return null;
}

// ---------- сповіщення ----------
async function scheduleNotifications(p, todaySlots, tomorrowSlots, now) {
  try {
    const pending = await Notification.allPending();
    for (const n of pending) if ((n.identifier || "").startsWith("toe-gpv-")) await n.remove();
    const before = notifyOf(p);
    if (!before) return;
    const days = [[todaySlots, now], [tomorrowSlots, new Date(now.getTime() + 864e5)]];
    for (const [slots, base] of days) {
      if (!slots) continue;
      for (const b of outageBlocks(slots)) {
        const start = slotDate(base, b.start);
        const fire = new Date(start.getTime() - before * 60000);
        if (fire <= now) continue;
        const n = new Notification();
        n.identifier = `toe-gpv-${start.getTime()}`;
        n.title = `Світло вимкнуть ${at(b.offStart)}`;
        const swNote = b.start < b.offStart ? ` (перемикання з ${slotToTime(b.start)})` : "";
        n.body = `${labelOf(p)}: відключення ${rangeText(b)}${swNote}. Через ${before} хв.`;
        n.sound = "default";
        n.setTriggerDate(fire);
        await n.schedule();
      }
    }
  } catch (e) { /* без дозволу на сповіщення просто мовчимо */ }
}

// ---------- смужка доби ----------
// Показує добу двома частинами: до 12:00 — 00:00–24:00, після 12:00 — 12:00–24:00.
// Під смужкою — час перемикань; підписи ставляться у два ряди так, щоб не налізати одне на одного.
const LABEL_SIZE = 9;
const BAR_H = 16, BAR_Y = 5;
function barWindow(now) {
  // лише два режими, щоб смужка не «їздила»: до 12:00 — уся доба, після — друга половина (12:00–24:00)
  return now.getHours() < 12 ? 0 : 24;
}
function placeLabels(arr, start, width) {
  const n = 48 - start;
  const xOf = s => ((s - start) / n) * width;
  const items = [];
  for (let s = start + 1; s < 48; s++) {
    if (arr[s] === arr[s - 1]) continue;
    const text = slotToTime(s);
    const important = arr[s] === "off" || arr[s - 1] === "off";
    items.push({ s, text, x: xOf(s), w: textW(text, LABEL_SIZE, "regular"), prio: important ? 0 : 1 });
  }
  const rows = [[], []];
  const placed = [];
  const GAP = 4;
  const order = items.slice().sort((a, b) => a.prio - b.prio || a.s - b.s);
  for (const it of order) {
    const x0 = Math.min(Math.max(it.x - it.w / 2, 0), width - it.w);
    const x1 = x0 + it.w;
    let row = -1;
    for (let r = 0; r < rows.length && row < 0; r++) {
      if (rows[r].every(q => x1 + GAP <= q[0] || x0 >= q[1] + GAP)) row = r;
    }
    if (row < 0) continue; // не влізло — пропускаємо (повний перелік є в рядку нижче)
    rows[row].push([x0, x1]);
    placed.push({ ...it, x0, row });
  }
  return { placed, dropped: items.length - placed.length, rowsUsed: placed.some(p => p.row === 1) ? 2 : placed.length ? 1 : 0, xOf };
}
function drawTimeline(slots, now, width, opts) {
  const o = opts || {};
  const arr = slots || new Array(48).fill("on");
  const start = barWindow(now);
  const n = 48 - start;
  const lay = placeLabels(arr, start, width);
  const H = BAR_Y + BAR_H + 5 + (lay.rowsUsed ? lay.rowsUsed * 11 + 1 : 0) + (lay.rowsUsed ? 0 : 3);
  const ctx = new DrawContext();
  ctx.size = new Size(width, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const r = 5;
  const segs = [];
  let i = start;
  while (i < 48) {
    const st = arr[i]; let j = i;
    while (j < 48 && arr[j] === st) j++;
    segs.push({ st, x0: lay.xOf(i), x1: lay.xOf(j) });
    i = j;
  }
  segs.forEach((s, k) => {
    ctx.setFillColor(new Color(STATUS[s.st] || STATUS.on));
    const w = s.x1 - s.x0;
    const first = k === 0, last = k === segs.length - 1;
    if (first || last) {
      const p = new Path();
      p.addRoundedRect(new Rect(s.x0, BAR_Y, w, BAR_H), r, r);
      ctx.addPath(p); ctx.fillPath();
      if (first && !last) ctx.fillRect(new Rect(s.x0 + Math.min(r, w / 2), BAR_Y, Math.max(0, w - Math.min(r, w / 2)), BAR_H));
      if (last && !first) ctx.fillRect(new Rect(s.x0, BAR_Y, Math.max(0, w - Math.min(r, w / 2)), BAR_H));
    } else {
      ctx.fillRect(new Rect(s.x0, BAR_Y, w, BAR_H));
    }
  });

  // тонкі роздільники між клітинками по 30 хв
  ctx.setFillColor(new Color("#000000", 0.12));
  for (let s = start + 1; s < 48; s++) ctx.fillRect(new Rect(lay.xOf(s) - 0.25, BAR_Y, 0.5, BAR_H));

  // підписи перемикань
  ctx.setFont(Font.systemFont(LABEL_SIZE));
  ctx.setTextColor(new Color(o.labelHex || "#8E8E93"));
  ctx.setFillColor(new Color(o.labelHex || "#8E8E93"));
  ctx.setTextAlignedLeft();
  for (const l of lay.placed) {
    ctx.fillRect(new Rect(Math.min(Math.max(l.x - 0.5, 0), width - 1), BAR_Y + BAR_H + 1, 1, 3));
    ctx.drawTextInRect(l.text, new Rect(l.x0, BAR_Y + BAR_H + 4 + l.row * 11, l.w + 2, 12));
  }

  // маркер «зараз»
  const minutes = now.getHours() * 60 + now.getMinutes();
  const nx = Math.min(Math.max(((minutes - start * 30) / (n * 30)) * width, 2), width - 2);
  const line = () => { const p = new Path(); p.move(new Point(nx, BAR_Y - 3)); p.addLine(new Point(nx, BAR_Y + BAR_H + 3)); ctx.addPath(p); ctx.strokePath(); };
  ctx.setStrokeColor(new Color("#1C1C1E", 0.9)); ctx.setLineWidth(4); line();
  ctx.setStrokeColor(new Color("#FFFFFF")); ctx.setLineWidth(2); line();
  ctx.setFillColor(new Color("#1C1C1E", 0.9)); ctx.fillEllipse(new Rect(nx - 4, BAR_Y - 5, 8, 8));
  ctx.setFillColor(new Color("#FFFFFF")); ctx.fillEllipse(new Rect(nx - 2.5, BAR_Y - 3.5, 5, 5));
  return { image: ctx.getImage(), height: H, layout: lay };
}

function addTimeline(w, P, slots, now, width) {
  const t = drawTimeline(slots, now, width, { labelHex: P.subHex });
  const img = w.addImage(t.image);
  img.imageSize = new Size(width, t.height);
  img.resizable = true;
  img.centerAlignImage();
  return t;
}

// ---------- рядки з графіком дня ----------
const compactTime = s => { const h = Math.floor(s / 2); return s % 2 ? `${h}:30` : `${h}`; };
const compactRange = b => `${compactTime(b.offStart)}–${compactTime(b.offEnd)}`;
// Підбирає найповніший запис, що влізає в ширину: усі проміжки → лише майбутні → стислі → «+N».
function dayLine(word, slots, nowSlot, maxW, size, weight) {
  if (!slots) return null;
  const fits = s => textW(s, size, weight) <= maxW;
  const all = outageBlocks(slots);
  if (!all.length) return `${word}: без відключень`;
  const left = nowSlot == null ? all : all.filter(b => b.offEnd > nowSlot);
  const sets = nowSlot == null ? [all] : [all, left.length ? left : all];
  for (const bl of sets) { const s = `${word}: ${bl.map(rangeText).join(", ")}`; if (fits(s)) return s; }
  const bl = left.length ? left : all;
  const s2 = `${word}: ${bl.map(compactRange).join(", ")}`;
  if (fits(s2)) return s2;
  for (let k = bl.length - 1; k >= 1; k--) {
    const s3 = `${word}: ${bl.slice(0, k).map(compactRange).join(", ")} +${bl.length - k}`;
    if (fits(s3)) return s3;
  }
  return `${word}: ${bl.length} відкл.`;
}

// ---------- віджет ----------
async function buildModel(p) {
  const now = new Date();
  const data = await loadData(p);
  const byDate = pickByDate(data.members);
  const todayM = byDate[dayKey(now)] || null;
  const tomorrowM = byDate[dayKey(new Date(now.getTime() + 864e5))] || null;
  const todaySlots = todayM ? parseDay(todayM, p.group) : null;
  const tomorrowSlots = tomorrowM ? parseDay(tomorrowM, p.group) : null;
  // немає ні звʼязку, ні кешу — не вдаємо, що світло є
  const unknown = data.offline && !data.fetchedAt;
  const st = unknown
    ? { state: "unknown", title: "Немає даних", lead: "немає звʼязку з сервером TOE", leadShort: "немає звʼязку з TOE", target: null, next: null,
        sub: "немає звʼязку з сервером TOE", short: "немає даних", slot: 0 }
    : computeStatus(todaySlots, tomorrowSlots, now);
  if (!data.offline) await scheduleNotifications(p, todaySlots, tomorrowSlots, now);

  // показуємо час останньої синхронізації, а не час публікації графіка
  const syncedAt = data.fetchedAt ? new Date(data.fetchedAt) : null;
  const syncText = syncedAt ? hhmm(syncedAt) : "—";

  // просимо iOS оновити віджет через 15 хв або одразу після зміни стану, якщо вона раніше
  const change = unknown ? null : nextChange(todaySlots, tomorrowSlots, now);
  let refreshMs = now.getTime() + APP.refreshMinutes * 60000;
  if (change) refreshMs = Math.min(refreshMs, change.getTime() + 30000);
  const barSlots = unknown ? new Array(48).fill("unknown") : todaySlots;
  return {
    now, data, todaySlots, tomorrowSlots, barSlots, unknown, st, syncText,
    graphAt: todayM ? new Date(todayM.dateCreate) : null,
    refreshAt: new Date(refreshMs),
  };
}

// ширину тексту рахуємо самі, тому мінімального масштабу не ставимо: шрифт однаковий у всьому рядку
function addText(stack, text, font, color, lines) {
  const t = stack.addText(text);
  t.font = font; t.textColor = color; t.lineLimit = lines || 1;
  return t;
}

const BULB = { on: "lightbulb.fill", off: "lightbulb.slash.fill", sw: "lightbulb.fill", unknown: "questionmark.circle.fill" };
function addBulb(stack, P, state, size) {
  const sym = SFSymbol.named(BULB[state] || "lightbulb.fill") || SFSymbol.named("lightbulb.fill");
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = P[state] || P.on;
  return img;
}
function addSymbol(stack, name, size, color) {
  const sym = SFSymbol.named(name) || SFSymbol.named("arrow.triangle.2.circlepath");
  const img = stack.addImage(sym.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color;
  return img;
}

// «⟳ 14:32 (черга 4.1)»; якщо не влізає — «(4.1)»
const SYNC_SIZE = 10, SYNC_ICON = 11;
function syncParts(m, p, room) {
  const timeW = SYNC_ICON + 3 + textW(m.syncText, SYNC_SIZE, "regular");
  let q = `(черга ${p.group})`;
  if (timeW + 4 + textW(q, SYNC_SIZE, "medium") > room) q = `(${p.group})`;
  return { q, w: timeW + 4 + textW(q, SYNC_SIZE, "medium") };
}
function addSync(stack, P, m, p, room) {
  const parts = syncParts(m, p, room);
  const row = stack.addStack();
  row.centerAlignContent();
  const color = m.data.offline ? P.sw : P.sub;
  addSymbol(row, m.data.offline ? "wifi.slash" : "arrow.triangle.2.circlepath", SYNC_ICON, color);
  row.addSpacer(3);
  addText(row, m.syncText, Font.systemFont(SYNC_SIZE), color);
  row.addSpacer(4);
  addText(row, parts.q, Font.mediumSystemFont(SYNC_SIZE), P.sub);
  return parts.w;
}

// рядок 1: лампочка + «Світло є» ліворуч, синхронізація й черга праворуч (без адреси)
function addHeader(w, P, m, p, titleSize, cw) {
  const row = w.addStack();
  row.centerAlignContent();
  addBulb(row, P, m.st.state, titleSize);
  row.addSpacer(6);
  addText(row, m.st.title, Font.boldSystemFont(titleSize), P.text);
  row.addSpacer();
  const left = titleSize + 6 + textW(m.st.title, titleSize, "bold");
  addSync(row, P, m, p, cw - left - 8);
}

// рядок 2: «вимкнуть о 19:30 · 44:59». Текст і таймер одного розміру, таймер жирний і кольоровий.
// Таймер малює iOS, тож він іде й без оновлення віджета.
function addLead(w, P, st, size, cw, lines) {
  if (!st.target) { addText(w, st.lead, Font.systemFont(size), P.sub, lines || 1); return; }
  const timerColor = st.next === "off" ? P.tOff : P.tOn;
  const timerW = textW("00:00:00", size, "bold");
  const sep = " · ";
  const variants = st.leadShort && st.leadShort !== st.lead ? [st.lead, st.leadShort] : [st.lead];
  const fit = variants.find(v => textW(v + sep, size, "regular") + timerW <= cw);
  const addTimer = row => {
    const d = row.addDate(st.target);
    d.applyTimerStyle();
    d.font = Font.boldSystemFont(size);
    d.textColor = timerColor;
    d.lineLimit = 1;
    d.leftAlignText();
  };
  if (fit) {
    const row = w.addStack();
    row.centerAlignContent();
    addText(row, fit + sep, Font.systemFont(size), P.sub);
    addTimer(row);
    row.addSpacer();
  } else {
    // вузький віджет: текст зверху, відлік окремим рядком тим самим розміром
    addText(w, st.leadShort || st.lead, Font.systemFont(size), P.sub, lines || 2);
    const row = w.addStack();
    row.centerAlignContent();
    addText(row, "через ", Font.systemFont(size), P.sub);
    addTimer(row);
    row.addSpacer();
  }
}

// графік дня -> відрізки [{st, from, to}] (слоти по 30 хв)
function segments(slots) {
  const arr = slots || new Array(48).fill("on");
  const out = [];
  let i = 0;
  while (i < 48) {
    const st = arr[i]; let j = i;
    while (j < 48 && arr[j] === st) j++;
    out.push({ st, from: i, to: j });
    i = j;
  }
  return out;
}
const STATE_WORDS = { on: "світло є", off: "немає", sw: "перемик.", unknown: "невідомо" };

// колонка «Сьогодні» / «Завтра» для великого віджета: графік словами
function addDayColumn(parent, P, title, slots, nowSlot, maxRows, missingText, colW) {
  const col = parent.addStack();
  col.layoutVertically();
  col.size = new Size(colW, 0);
  const fs = colW < 140 ? 10 : 11;
  addText(col, title, Font.semiboldSystemFont(13), P.text);
  col.addSpacer(5);
  // для сьогодні відсутній графік = без відключень; для завтра — графік ще не опублікували
  if (!slots && missingText) { addText(col, missingText, Font.systemFont(12), P.sub); return; }
  let segs = segments(slots);
  // для сьогодні не показуємо те, що вже минуло
  if (nowSlot != null) segs = segs.filter(s => s.to > nowSlot);
  const shown = segs.slice(0, maxRows);
  for (const s of shown) {
    const current = nowSlot != null && s.from <= nowSlot && nowSlot < s.to;
    const row = col.addStack();
    row.centerAlignContent();
    const dot = row.addStack();
    dot.size = new Size(8, 8); dot.cornerRadius = 4; dot.backgroundColor = P[s.st];
    row.addSpacer(4);
    addText(row, `${slotToTime(s.from)}–${slotToTime(s.to)}`, current ? Font.semiboldSystemFont(fs) : Font.systemFont(fs), current ? P.text : P.sub);
    row.addSpacer(4);
    addText(row, STATE_WORDS[s.st], current ? Font.semiboldSystemFont(fs) : Font.systemFont(fs), current ? P.text : P.sub);
    col.addSpacer(2);
  }
  if (segs.length > shown.length) addText(col, `і ще ${segs.length - shown.length}…`, Font.systemFont(11), P.sub);
}

async function renderWidget(p, family) {
  const fam = family || "medium";
  const m = await buildModel(p);
  const P = makePalette(p);
  const { now, st } = m;

  const w = new ListWidget();
  w.refreshAfterDate = m.refreshAt;
  w.url = `${APP.site}/`;

  // екран блокування
  if (fam.startsWith("accessory")) {
    const icon = { on: "💡", off: "🌑", sw: "⚡️", unknown: "❔" }[st.state];
    if (fam === "accessoryInline") {
      w.addText(`${icon} ${st.title} · ${st.short}`);
    } else if (fam === "accessoryCircular") {
      w.addAccessoryWidgetBackground = true;
      const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
      const row1 = s.addStack(); row1.addSpacer();
      const img = row1.addImage(SFSymbol.named(BULB[st.state] || "lightbulb.fill").image);
      img.imageSize = new Size(16, 16); row1.addSpacer();
      const row2 = s.addStack(); row2.addSpacer();
      const tm = st.short.match(/\d\d:\d\d/);
      const t = row2.addText(tm ? tm[0] : "—"); t.font = Font.semiboldSystemFont(11); t.minimumScaleFactor = 0.6; row2.addSpacer();
    } else {
      const t1 = w.addText(`${icon} ${st.title}`); t1.font = Font.boldSystemFont(14); t1.lineLimit = 1;
      const t2 = w.addText(st.lead); t2.font = Font.systemFont(12); t2.lineLimit = 1; t2.minimumScaleFactor = 0.8;
      if (st.target) {
        const r = w.addStack();
        const t3 = r.addText("через "); t3.font = Font.systemFont(12);
        const d = r.addDate(st.target); d.applyTimerStyle(); d.font = Font.boldSystemFont(12); d.lineLimit = 1; d.leftAlignText();
      }
    }
    return w;
  }

  w.backgroundColor = P.bg;
  const W = widgetWidth(fam === "small" ? "small" : "medium");

  if (fam === "small") {
    const pl = 12, pr = 12;
    const cw = W - pl - pr;
    w.setPadding(12, pl, 10, pr);
    // заголовок: найбільший шрифт, що влізає
    const ts = [16, 15, 14, 13].find(s => s + 6 + textW(st.title, s, "bold") <= cw) || 13;
    const hr = w.addStack(); hr.centerAlignContent();
    addBulb(hr, P, st.state, ts); hr.addSpacer(6);
    addText(hr, st.title, Font.boldSystemFont(ts), P.text); hr.addSpacer();
    w.addSpacer(4);
    addLead(w, P, st, 12, cw, 2);
    w.addSpacer();
    addTimeline(w, P, m.barSlots, now, cw);
    w.addSpacer(4);
    const foot = w.addStack(); foot.centerAlignContent();
    addSync(foot, P, m, p, cw);
    foot.addSpacer();
    return w;
  }

  if (fam === "medium") {
    const pl = 14, pr = 14;
    const cw = W - pl - pr;
    w.setPadding(12, pl, 11, pr);
    addHeader(w, P, m, p, 20, cw);
    w.addSpacer(4);
    addLead(w, P, st, 13, cw);
    w.addSpacer(7);
    addTimeline(w, P, m.barSlots, now, cw);
    w.addSpacer(3);
    const today = m.unknown ? null : dayLine("Сьогодні", m.todaySlots || new Array(48).fill("on"), st.slot, cw, 11, "medium");
    const tomorrow = m.unknown ? null : dayLine("Завтра", m.tomorrowSlots, null, cw, 11, "medium");
    if (today) addText(w, today, Font.mediumSystemFont(11), P.sub);
    if (tomorrow) { w.addSpacer(2); addText(w, tomorrow, Font.mediumSystemFont(11), P.sub); }
    return w;
  }

  // великий (і extraLarge на iPad): графік на сьогодні й завтра словами
  const pl = 16, pr = 16;
  const cw = W - pl - pr;
  w.setPadding(14, pl, 12, pr);
  addHeader(w, P, m, p, 22, cw);
  w.addSpacer(4);
  addLead(w, P, st, 14, cw, 2);
  w.addSpacer(8);
  addTimeline(w, P, m.barSlots, now, cw);
  w.addSpacer(10);
  const cols = w.addStack();
  cols.layoutHorizontally();
  cols.topAlignContent();
  const colW = Math.floor((cw - 8) / 2);
  addDayColumn(cols, P, "Сьогодні", m.todaySlots, st.slot, 8, m.unknown ? "немає даних" : null, colW);
  cols.addSpacer(8);
  addDayColumn(cols, P, "Завтра", m.tomorrowSlots, null, 8, m.unknown ? "немає даних" : "графіка ще немає", colW);
  w.addSpacer();
  if (m.graphAt) {
    const foot = w.addStack();
    foot.addSpacer();
    addText(foot, `графік TOE від ${hhmm(m.graphAt)}`, Font.systemFont(10), P.sub);
  }
  return w;
}

function notConfiguredWidget(family) {
  const w = new ListWidget();
  w.url = `scriptable:///run/${encodeURIComponent(Script.name())}`;
  if ((family || "").startsWith("accessory")) {
    w.addText("⚡️ Налаштуй TOE Light");
    return w;
  }
  const P = makePalette({ theme: "auto", accent: "none" });
  w.backgroundColor = P.bg;
  w.setPadding(14, 14, 14, 14);
  addText(w, "⚡️ TOE Light", Font.boldSystemFont(16), P.text);
  w.addSpacer(6);
  addText(w, "Натисни, щоб вибрати адресу. Відкриється Scriptable з налаштуванням.", Font.systemFont(12), P.sub, 4);
  return w;
}

// ---------- діалоги ----------
async function info(title, message) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addAction("OK");
  await a.present();
}
async function confirm(title, message, okText) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addAction(okText || "Так");
  a.addCancelAction("Скасувати");
  return (await a.present()) === 0;
}
// повертає введений текст або null, якщо скасовано
async function ask(title, message, value, placeholder) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addTextField(placeholder || "", value || "");
  a.addAction("Далі");
  a.addCancelAction("Назад");
  const i = await a.present();
  return i === -1 ? null : a.textFieldValue(0);
}
// список на весь екран; повертає вибраний елемент або null
async function pick(title, hint, items, render) {
  const LIMIT = 300;
  let chosen = null;
  const t = new UITable();
  t.showSeparators = true;
  const h = new UITableRow();
  h.isHeader = true;
  h.height = 64;
  const hc = h.addText(title, hint || "");
  hc.titleFont = Font.boldSystemFont(18);
  hc.subtitleFont = Font.systemFont(13);
  hc.subtitleColor = Color.gray();
  t.addRow(h);
  for (const it of items.slice(0, LIMIT)) {
    const [a, b] = render(it);
    const r = new UITableRow();
    r.height = b ? 54 : 44;
    r.dismissOnSelect = true;
    r.onSelect = () => { chosen = it; };
    const c = b ? r.addText(a, b) : r.addText(a);
    c.titleFont = Font.systemFont(16);
    if (b) { c.subtitleFont = Font.systemFont(12); c.subtitleColor = Color.gray(); }
    t.addRow(r);
  }
  if (items.length > LIMIT) {
    const r = new UITableRow();
    r.addText(`Показано ${LIMIT} з ${items.length}. Уточни пошук.`).subtitleColor = Color.gray();
    t.addRow(r);
  }
  await t.present(false);
  return chosen;
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), "uk");
const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
// точний збіг → починається з запиту → решта, далі за абеткою
const byRelevance = q => (a, b) => {
  const rank = x => { const n = String(x.name).toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : 2; };
  return rank(a) - rank(b) || byName(a, b);
};
const naturally = (a, b) => String(a.buildingName).localeCompare(String(b.buildingName), "uk", { numeric: true });

// ---------- майстер вибору адреси ----------
async function stepCity(prev) {
  let q = prev && prev.cityName ? prev.cityName : "";
  while (true) {
    q = await ask("Населений пункт", "Введи назву (хоча б 2 літери), наприклад «Тернопіль» або «Бучач».", q, "Назва");
    if (q === null) return null;
    q = q.trim();
    if (q.length < 2) { await info("Закоротко", "Введи хоча б 2 літери."); continue; }
    let list;
    try { list = await searchCities(q); }
    catch (e) { await info("Немає звʼязку з сервером TOE", String(e)); continue; }
    if (!list.length) { await info("Нічого не знайдено", "Перевір назву або спробуй коротший запит."); continue; }
    list.sort(byRelevance(q.toLowerCase()));
    if (list.length === 1) return list[0];
    const c = await pick("Населений пункт", `Знайдено ${list.length}`, list,
      x => [x.name, x.otg && x.otg.name ? `${x.otg.name} громада` : ""]);
    if (c) return c;
  }
}

async function stepStreet(city) {
  let streets;
  try { streets = (await getStreets(city.id)).sort(byName); }
  catch (e) { await info("Немає звʼязку з сервером TOE", String(e)); return null; }
  if (!streets.length) { await info("Вулиць не знайдено", `Для «${city.name}» у базі TOE немає вулиць.`); return null; }
  let q = "";
  while (true) {
    q = await ask("Вулиця", `${city.name}: ${streets.length} ${plural(streets.length, "вулиця", "вулиці", "вулиць")}. Введи частину назви або залиш порожнім, щоб побачити всі.`, q, "Назва вулиці");
    if (q === null) return null;
    const s = q.trim().toLowerCase();
    const list = s ? streets.filter(x => String(x.name).toLowerCase().includes(s)) : streets;
    if (!list.length) { await info("Нічого не знайдено", "Спробуй іншу частину назви."); continue; }
    const st = await pick("Вулиця", `${city.name} · ${list.length}`, list, x => [x.name, ""]);
    if (st) return st;
  }
}

async function stepBuilding(city, street) {
  let list;
  try { list = (await getBuildings(city.id, street.id)).sort(naturally); }
  catch (e) { await info("Немає звʼязку з сервером TOE", String(e)); return null; }
  if (!list.length) { await info("Будинків не знайдено", `Для «${street.name}» немає будинків у базі TOE.`); return null; }
  while (true) {
    const b = await pick("Будинок", `${street.name} · ${list.length}`, list,
      x => [`буд. ${x.buildingName}`, NOT_IN_SCHEDULE(x.chergGpv) ? "не входить у графік" : `черга ${x.chergGpv}`]);
    if (!b) return null;
    if (NOT_IN_SCHEDULE(b.chergGpv)) {
      await info("Будинок не входить у графік", "Для нього немає погодинних відключень. Вибери інший будинок або повернись назад.");
      continue;
    }
    return b;
  }
}

async function setupWizard(prev) {
  let step = 0, city = null, street = null, bld = null;
  while (step < 3) {
    if (step === 0) { city = await stepCity(prev); if (!city) return null; step = 1; }
    else if (step === 1) { street = await stepStreet(city); step = street ? 2 : 0; }
    else { bld = await stepBuilding(city, street); step = bld ? 3 : 1; }
  }
  const groups = await getBuildingGroups(city.id, street.id, bld.buildingName);
  const group = resolveGroup(bld, groups);
  const p = Object.assign({ theme: "auto", accent: "none", notify: APP.notifyMinutesBefore }, prev || {}, {
    cityId: city.id, cityName: city.name,
    streetId: street.id, streetName: street.name,
    building: bld.buildingName, group,
  });
  saveProfile(p);
  return p;
}

// налаштування з посилання: scriptable:///run/TOE%20Light?city=..&street=..&building=..
async function applyFromLink(q, prev) {
  const cityId = Number(q.city), streetId = Number(q.street), building = q.building;
  if (!cityId || !streetId || !building) return null;
  let blds;
  try { blds = await getBuildings(cityId, streetId); }
  catch (e) { await info("Немає звʼязку з сервером TOE", String(e)); return null; }
  const b = blds.find(x => String(x.buildingName) === String(building));
  if (!b) { await info("Адресу не знайдено", "Посилання застаріле або містить помилку. Вибери адресу вручну."); return null; }
  const group = resolveGroup(b, await getBuildingGroups(cityId, streetId, building));
  if (!group) { await info("Будинок не входить у графік", "Для цієї адреси немає погодинних відключень."); return null; }
  const p = Object.assign({ theme: "auto", accent: "none", notify: APP.notifyMinutesBefore }, prev || {}, {
    cityId, cityName: q.cityName || "", streetId, streetName: q.streetName || "", building, group,
  });
  if (!(await confirm("Встановити адресу?", `${labelOf(p)}\nчерга ${group}`, "Встановити"))) return null;
  saveProfile(p);
  return p;
}

function shareLink(p) {
  const qs = [
    ["city", p.cityId], ["street", p.streetId], ["building", p.building],
    ["cityName", p.cityName], ["streetName", p.streetName],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `scriptable:///run/${encodeURIComponent(Script.name())}?${qs}`;
}

// ---------- самооновлення ----------
async function checkUpdate(force, interactive) {
  if (BASE_URL.startsWith("__")) {
    if (interactive) await info("Самооновлення вимкнене", "Цю копію скрипта зібрано без адреси сайту.");
    return false;
  }
  const stamp = fm.joinPath(fm.documentsDirectory(), "toe-light-update.json");
  try {
    if (!force && fm.fileExists(stamp)) {
      const s = JSON.parse(fm.readString(stamp));
      if (Date.now() - s.t < APP.updateCheckHours * 3600e3) return false;
    }
    const metaReq = new Request(`${BASE_URL}version.json?t=${Date.now()}`);
    metaReq.timeoutInterval = 10;
    const meta = await metaReq.loadJSON();
    fm.writeString(stamp, JSON.stringify({ t: Date.now() }));
    if (!meta || !meta.version || meta.version === VERSION) {
      if (interactive) await info("У тебе остання версія", VERSION);
      return false;
    }
    const codeReq = new Request(`${BASE_URL}toe-light.js?v=${encodeURIComponent(meta.version)}`);
    codeReq.timeoutInterval = 15;
    const code = await codeReq.loadString();
    if (!code.includes("TOE_LIGHT_SCRIPT") || code.length < 5000) throw new Error("пошкоджений файл оновлення");
    const target = module.filename.includes("/Mobile Documents/") ? FileManager.iCloud() : FileManager.local();
    target.writeString(module.filename, code);
    if (interactive) await info("Скрипт оновлено", `Версія ${meta.version}. Запусти скрипт ще раз.`);
    return true;
  } catch (e) {
    if (interactive) await info("Не вдалося перевірити оновлення", String(e));
    return false;
  }
}

// ---------- меню налаштувань ----------
async function chooseTheme(p) {
  const keys = Object.keys(THEMES);
  const a = new Alert();
  a.title = "Тема віджета";
  keys.forEach(k => a.addAction(`${k === p.theme ? "✓ " : ""}${THEMES[k]}`));
  a.addCancelAction("Скасувати");
  const i = await a.presentSheet();
  if (i >= 0) p.theme = keys[i];
}

async function chooseAccent(p) {
  const keys = Object.keys(ACCENTS);
  const a = new Alert();
  a.title = "Головний колір";
  a.message = "Підфарбовує фон і рядок з адресою. Кольори статусу (зелений, червоний, жовтий) не змінюються.";
  keys.forEach(k => a.addAction(`${k === p.accent ? "✓ " : ""}${ACCENTS[k][0]}`));
  a.addAction("Свій колір (HEX)…");
  a.addCancelAction("Скасувати");
  const i = await a.presentSheet();
  if (i < 0) return;
  if (i < keys.length) { p.accent = keys[i]; return; }
  const v = await ask("Свій колір", "Формат #RRGGBB, наприклад #FF6B00", hexToRgb(p.accent) ? p.accent : "#", "#RRGGBB");
  if (v === null) return;
  const hex = v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`;
  if (hexToRgb(hex)) p.accent = hex.toUpperCase();
  else await info("Невірний колір", "Потрібно 6 шістнадцяткових символів, наприклад #FF6B00.");
}

async function chooseNotify(p) {
  const a = new Alert();
  a.title = "Сповіщення перед відключенням";
  NOTIFY_OPTIONS.forEach(m => a.addAction(`${m === notifyOf(p) ? "✓ " : ""}${m ? `За ${m} хв` : "Вимкнено"}`));
  a.addCancelAction("Скасувати");
  const i = await a.presentSheet();
  if (i >= 0) p.notify = NOTIFY_OPTIONS[i];
}

async function preview(p) {
  const a = new Alert();
  a.title = "Розмір для перегляду";
  ["Малий", "Середній", "Великий"].forEach(x => a.addAction(x));
  a.addCancelAction("Скасувати");
  const i = await a.presentSheet();
  if (i < 0) return;
  const fam = ["small", "medium", "large"][i];
  const w = await renderWidget(p, fam);
  if (fam === "small") await w.presentSmall();
  else if (fam === "large") await w.presentLarge();
  else await w.presentMedium();
}

const HOW_TO_ADD =
  "1. Утримуй палець на порожньому місці головного екрана.\n" +
  "2. Натисни «Редагувати» → «Додати віджет» (або «+»).\n" +
  "3. Знайди Scriptable, вибери розмір і додай.\n" +
  "4. Натисни на доданий віджет і в полі Script вибери «" + Script.name() + "».";

async function settingsMenu(p) {
  while (true) {
    const items = [
      ["👀 Переглянути віджет", () => preview(p)],
      ["📍 Змінити адресу", async () => { const n = await setupWizard(p); if (n) Object.assign(p, n); }],
      [`🎨 Тема: ${THEMES[p.theme] || THEMES.auto}`, async () => { await chooseTheme(p); saveProfile(p); }],
      [`🖌 Колір: ${accentName(p)}`, async () => { await chooseAccent(p); saveProfile(p); }],
      [`🔔 Сповіщення: ${notifyOf(p) ? `за ${notifyOf(p)} хв` : "вимкнено"}`, async () => { await chooseNotify(p); saveProfile(p); }],
      ["➕ Як додати віджет", () => info("Як додати віджет", HOW_TO_ADD)],
      ["🔗 Поділитися адресою", async () => {
        const link = shareLink(p);
        Pasteboard.copy(link);
        await info("Посилання скопійовано", "Хто вже встановив TOE Light, відкриє його на iPhone і отримає цю адресу без пошуку.\n\n" + link);
      }],
      ["⬇️ Перевірити оновлення", () => checkUpdate(true, true)],
    ];
    const a = new Alert();
    a.title = "TOE Light";
    a.message = `${labelOf(p)}\nчерга ${p.group} · версія ${VERSION}`;
    items.forEach(([t]) => a.addAction(t));
    a.addCancelAction("Готово");
    const i = await a.presentSheet();
    if (i < 0) return;
    await items[i][1]();
  }
}

// ---------- старт ----------
async function main() {
  let p = loadProfile();

  if (config.runsInWidget) {
    const w = p ? await renderWidget(p, config.widgetFamily) : notConfiguredWidget(config.widgetFamily);
    Script.setWidget(w);
    await checkUpdate(false, false);
    return;
  }

  const q = args.queryParameters || {};
  if (q.city) {
    const n = await applyFromLink(q, p);
    if (n) { p = n; await info("Готово", `Адресу збережено.\n\n${HOW_TO_ADD}`); }
  }

  await checkUpdate(false, false);

  if (!p) {
    await info("Вітаю в TOE Light ⚡️",
      "Зараз вибереш населений пункт, вулицю і будинок. Черга визначиться автоматично.");
    p = await setupWizard(null);
    if (!p) return;
    await info("Готово ✅", `${labelOf(p)}\nчерга ${p.group}\n\nТепер додай віджет:\n${HOW_TO_ADD}`);
    const w = await renderWidget(p, "medium");
    await w.presentMedium();
  }

  await settingsMenu(p);
}

await main();
Script.complete();
