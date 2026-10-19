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
  const mk = k => theme === "light" ? new Color(L[k])
    : theme === "dark" ? new Color(D[k])
    : Color.dynamic(new Color(L[k]), new Color(D[k]));
  return {
    bg: mk("bg"), text: mk("text"), sub: mk("sub"), head: mk("head"),
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
function computeStatus(today, tomorrow, now) {
  const slot = now.getHours() * 2 + (now.getMinutes() >= 30 ? 1 : 0);
  const t = today || new Array(48).fill("on");
  const state = t[slot];
  const nowMs = now.getTime();
  const tomorrowDate = new Date(nowMs + 864e5);
  const minsTo = d => Math.max(0, Math.round((d - nowMs) / 60000));

  const todayBlocks = outageBlocks(today);
  const tomorrowBlocks = outageBlocks(tomorrow);

  if (state === "on") {
    let b = todayBlocks.find(x => x.start > slot), base = now, dayWord = "";
    if (!b && tomorrow) { b = tomorrowBlocks[0]; base = tomorrowDate; dayWord = "завтра "; }
    let sub, short;
    if (b) {
      const start = slotDate(base, b.start);
      const warn = b.start < b.offStart ? ` (можливо з ${slotToTime(b.start)})` : "";
      sub = `вимкнуть ${dayWord}${at(b.offStart)}${warn} · через ${humanDur(minsTo(start))}`;
      short = `${dayWord ? "завтра " : ""}вимк. ${slotToTime(b.offStart)}`;
    } else if (todayBlocks.length) {
      sub = tomorrow ? "сьогодні й завтра відключень більше немає" : "сьогодні відключень більше немає";
      short = "без відключень";
    } else {
      sub = tomorrow ? "сьогодні й завтра без відключень" : "на сьогодні відключень не заплановано";
      short = "без відключень";
    }
    return { state, title: "Світло є", sub, short, slot };
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
    const sub = `увімкнуть ${retTomorrow ? "завтра " : ""}${at(retSlot)}${tail} · через ${humanDur(minsTo(slotDate(retBase, retSlot)))}`;
    return { state, title: "Світла немає", sub, short: `увімк. ${retTomorrow ? "завтра " : ""}${slotToTime(retSlot)}`, slot };
  }

  let sub, short;
  if (slot < b.offStart) {
    sub = `вимкнення ${rangeText(b)} · через ${humanDur(minsTo(slotDate(now, b.offStart)))}`;
    short = `вимк. ${slotToTime(b.offStart)}`;
  } else {
    sub = `увімкнуть до ${dayWord}${slotToTime(endSlot)} · через ${humanDur(minsTo(endDate))}`;
    short = `до ${slotToTime(endSlot)}`;
  }
  return { state, title: "Перемикання", sub, short, slot };
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
function drawTimeline(slots, now, width, opts) {
  const o = opts || {};
  const showNow = o.showNow !== false;
  const H = 42, barY = 4, barH = 18, r = 5;
  const ctx = new DrawContext();
  ctx.size = new Size(width, H);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  // у DrawContext лише статичні кольори (динамічні там ненадійні)
  const tick = new Color("#8E8E93");
  const segColor = st => new Color(STATUS[st] || STATUS.on);

  const arr = slots || new Array(48).fill("on");
  const segs = [];
  let i = 0;
  while (i < 48) {
    const st = arr[i]; let j = i;
    while (j < 48 && arr[j] === st) j++;
    segs.push({ st, x0: (i / 48) * width, x1: (j / 48) * width });
    i = j;
  }
  segs.forEach((s, k) => {
    ctx.setFillColor(segColor(s.st));
    const w = s.x1 - s.x0;
    const first = k === 0, last = k === segs.length - 1;
    if (first || last) {
      const p = new Path();
      p.addRoundedRect(new Rect(s.x0, barY, w, barH), r, r);
      ctx.addPath(p); ctx.fillPath();
      if (first && !last) ctx.fillRect(new Rect(s.x0 + Math.min(r, w / 2), barY, Math.max(0, w - Math.min(r, w / 2)), barH));
      if (last && !first) ctx.fillRect(new Rect(s.x0, barY, Math.max(0, w - Math.min(r, w / 2)), barH));
    } else {
      ctx.fillRect(new Rect(s.x0, barY, w, barH));
    }
  });

  // роздільники між годинами
  ctx.setFillColor(new Color("#000000", 0.12));
  for (let h = 1; h < 24; h++) ctx.fillRect(new Rect((h / 24) * width - 0.25, barY, 0.5, barH));

  // поділки й підписи годин
  const step = width < 200 ? 12 : 6;
  ctx.setFont(Font.systemFont(9));
  ctx.setTextColor(tick);
  ctx.setFillColor(tick);
  for (let h = 0; h <= 24; h += step) {
    const x = (h / 24) * width;
    ctx.fillRect(new Rect(Math.min(Math.max(x - 0.5, 0), width - 1), barY + barH + 2, 1, 3));
    const label = pad(h);
    if (h === 0) { ctx.setTextAlignedLeft(); ctx.drawTextInRect(label, new Rect(0, barY + barH + 6, 24, 12)); }
    else if (h === 24) { ctx.setTextAlignedRight(); ctx.drawTextInRect(label, new Rect(width - 24, barY + barH + 6, 24, 12)); }
    else { ctx.setTextAlignedCenter(); ctx.drawTextInRect(label, new Rect(x - 12, barY + barH + 6, 24, 12)); }
  }

  // маркер "зараз"
  if (showNow) {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const nx = Math.min(Math.max((minutes / 1440) * width, 2), width - 2);
    const line = () => { const p = new Path(); p.move(new Point(nx, barY - 3)); p.addLine(new Point(nx, barY + barH + 3)); ctx.addPath(p); ctx.strokePath(); };
    ctx.setStrokeColor(new Color("#1C1C1E", 0.9)); ctx.setLineWidth(4); line();
    ctx.setStrokeColor(new Color("#FFFFFF")); ctx.setLineWidth(2); line();
    ctx.setFillColor(new Color("#1C1C1E", 0.9)); ctx.fillEllipse(new Rect(nx - 4, barY - 5, 8, 8));
    ctx.setFillColor(new Color("#FFFFFF")); ctx.fillEllipse(new Rect(nx - 2.5, barY - 3.5, 5, 5));
  }
  return ctx.getImage();
}

function addTimeline(w, slots, now, width, opts) {
  const img = w.addImage(drawTimeline(slots, now, width, opts));
  img.imageSize = new Size(width, 42);
  img.resizable = true;
  img.centerAlignImage();
}

// ---------- віджет ----------
function dayText(word, slots) {
  if (!slots) return `${word}: графіка ще немає`;
  const bl = outageBlocks(slots);
  return bl.length ? `${word}: ${bl.map(rangeText).join(", ")}` : `${word}: без відключень`;
}

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
    ? { state: "unknown", title: "Немає даних", sub: "немає звʼязку з сервером TOE, спробую пізніше", short: "немає даних", slot: 0 }
    : computeStatus(todaySlots, tomorrowSlots, now);
  if (!data.offline) await scheduleNotifications(p, todaySlots, tomorrowSlots, now);
  let updText;
  if (data.offline) updText = data.fetchedAt ? `офлайн · ${hhmm(new Date(data.fetchedAt))}` : "немає звʼязку";
  else if (todayM) updText = `графік від ${hhmm(new Date(todayM.dateCreate))}`;
  else updText = `перевірено ${hhmm(now)}`;
  const barSlots = unknown ? new Array(48).fill("unknown") : todaySlots;
  return { now, data, todaySlots, tomorrowSlots, barSlots, unknown, st, updText };
}

function addStatusRow(w, P, st, titleSize) {
  const row = w.addStack();
  row.centerAlignContent();
  const dot = row.addStack();
  dot.size = new Size(12, 12);
  dot.cornerRadius = 6;
  dot.backgroundColor = P[st.state];
  row.addSpacer(8);
  const title = row.addText(st.title);
  title.font = Font.boldSystemFont(titleSize);
  title.textColor = P.text; title.lineLimit = 1; title.minimumScaleFactor = 0.7;
}

function addText(stack, text, font, color, lines) {
  const t = stack.addText(text);
  t.font = font; t.textColor = color; t.lineLimit = lines || 1; t.minimumScaleFactor = 0.75;
  return t;
}

async function renderWidget(p, family) {
  const fam = family || "medium";
  const m = await buildModel(p);
  const P = makePalette(p);
  const { now, st } = m;

  const w = new ListWidget();
  w.refreshAfterDate = new Date(now.getTime() + APP.refreshMinutes * 60000);
  w.url = `${APP.site}/`;

  // екран блокування
  if (fam.startsWith("accessory")) {
    const icon = { on: "💡", off: "🌑", sw: "⚡️", unknown: "❔" }[st.state];
    if (fam === "accessoryInline") {
      w.addText(`${icon} ${st.title} · ${st.short}`);
    } else if (fam === "accessoryCircular") {
      w.addAccessoryWidgetBackground = true;
      const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
      const sym = SFSymbol.named({ on: "bolt.fill", off: "bolt.slash.fill", sw: "bolt.badge.clock", unknown: "questionmark" }[st.state]);
      const row1 = s.addStack(); row1.addSpacer();
      const img = row1.addImage(sym.image); img.imageSize = new Size(16, 16); row1.addSpacer();
      const row2 = s.addStack(); row2.addSpacer();
      const tm = st.short.match(/\d\d:\d\d/);
      const t = row2.addText(tm ? tm[0] : "—"); t.font = Font.semiboldSystemFont(11); t.minimumScaleFactor = 0.6; row2.addSpacer();
    } else {
      const t1 = w.addText(`${icon} ${st.title}`); t1.font = Font.boldSystemFont(14); t1.lineLimit = 1;
      const t2 = w.addText(st.sub); t2.font = Font.systemFont(12); t2.lineLimit = 2; t2.minimumScaleFactor = 0.8;
    }
    return w;
  }

  w.backgroundColor = P.bg;

  if (fam === "small") {
    w.setPadding(12, 12, 10, 12);
    addText(w, `черга ${p.group}`, Font.semiboldSystemFont(11), m.data.offline ? P.sw : P.head);
    w.addSpacer(4);
    addStatusRow(w, P, st, 18);
    w.addSpacer(3);
    addText(w, st.sub, Font.systemFont(11), P.sub, 3);
    w.addSpacer();
    addTimeline(w, m.barSlots, now, 130);
    return w;
  }

  // середній і великий
  w.setPadding(13, 14, 11, 14);
  const top = w.addStack();
  top.centerAlignContent();
  addText(top, `${labelOf(p)}  ·  черга ${p.group}`, Font.semiboldSystemFont(11), P.head);
  top.addSpacer();
  addText(top, m.updText, Font.systemFont(10), m.data.offline ? P.sw : P.sub);

  w.addSpacer(6);
  addStatusRow(w, P, st, 21);
  w.addSpacer(2);
  addText(w, st.sub, Font.systemFont(12), P.sub, fam === "medium" ? 1 : 2);
  w.addSpacer(7);
  addTimeline(w, m.barSlots, now, 300);
  w.addSpacer(4);

  if (fam === "medium") {
    const bottom = w.addStack();
    bottom.centerAlignContent();
    addText(bottom, dayText("Сьогодні", m.todaySlots), Font.mediumSystemFont(11), P.sub);
    bottom.addSpacer();
    addText(bottom, dayText("Завтра", m.tomorrowSlots), Font.mediumSystemFont(11), P.sub);
    return w;
  }

  addText(w, dayText("Сьогодні", m.todaySlots), Font.mediumSystemFont(12), P.sub, 2);
  w.addSpacer(14);
  addText(w, "Завтра", Font.semiboldSystemFont(14), P.text);
  w.addSpacer(6);
  if (m.tomorrowSlots) {
    addTimeline(w, m.tomorrowSlots, now, 300, { showNow: false });
    w.addSpacer(4);
  }
  addText(w, dayText("Завтра", m.tomorrowSlots), Font.mediumSystemFont(12), P.sub, 2);
  w.addSpacer();
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
