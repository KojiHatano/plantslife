'use strict';
/* PlantsLife - 植物管理PWA。データは端末内(IndexedDB)のみに保存し、外部へ送信しない。 */

/* ---------- ユーティリティ ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const dayDiff = (a, b) => Math.round((fromYmd(a) - fromYmd(b)) / 864e5); // a - b (日)
const addDays = (s, n) => { const d = fromYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const fmtMD = s => { const d = fromYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const SEASONS = [['spring', '春'], ['summer', '夏'], ['autumn', '秋'], ['winter', '冬']];
const seasonOf = s => { const m = fromYmd(s).getMonth() + 1; return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'; };
const DEFAULT_IV = { spring: 5, summer: 3, autumn: 5, winter: 14 };
const LABEL = { water: '水やり', fert: '肥料', note: '育成記録' };
const ICON = { water: '💧', fert: '🌱', note: '📝' };

/* ---------- 状態 ---------- */
const S = {
  plants: [], logs: [],
  set: { layout: 'g3', sort: 'order', rev: false },
  tab: 'home', mode: { w: false, f: false }, q: '',
  detail: null, month: todayStr().slice(0, 7), sel: todayStr(), hist: 'cal',
};
let IDX = new Map();

function reindex() {
  IDX = new Map();
  for (const l of S.logs) {
    let e = IDX.get(l.plantId);
    if (!e) IDX.set(l.plantId, e = { w: [], f: [], n: [] });
    e[l.type === 'water' ? 'w' : l.type === 'fert' ? 'f' : 'n'].push(l);
  }
  for (const e of IDX.values()) for (const k in e) e[k].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);
}
const plantOf = id => S.plants.find(p => p.id === id);

function info(p) {
  const e = IDX.get(p.id) || { w: [], f: [], n: [] };
  const t = todayStr();
  const lw = e.w[0]?.date || null;
  const lf = e.f[0]?.date || null;
  const base = lw || p.acquired || t;
  const iv = Number(p.iv?.[seasonOf(t)]) || 0;
  const due = iv > 0 ? addDays(base, iv) : null;
  const until = due ? dayDiff(due, t) : null;
  const since = lw ? dayDiff(t, lw) : null;
  let avg = null;
  if (e.w.length > 1) {
    let sum = 0;
    for (let i = 0; i < e.w.length - 1; i++) sum += dayDiff(e.w[i].date, e.w[i + 1].date);
    avg = sum / (e.w.length - 1);
  }
  return { e, lw, lf, until, since, avg, due, iv, wToday: e.w.some(x => x.date === t), fToday: e.f.some(x => x.date === t) };
}

/* ---------- 写真 ---------- */
const urls = new Map();
function urlOf(key, blob) {
  if (!blob) return '';
  const c = urls.get(key);
  if (c && c.b === blob) return c.u;
  if (c) URL.revokeObjectURL(c.u);
  const u = URL.createObjectURL(blob);
  urls.set(key, { b: blob, u });
  return u;
}
const pUrl = p => urlOf('p' + p.id, p.photo);
const lUrl = l => urlOf('l' + l.id, l.photo);
const grad = id => { const h = (id * 47) % 360; return `linear-gradient(135deg,hsl(${h},28%,42%),hsl(${(h + 30) % 360},30%,70%))`; };
function bgOf(p) { return p.photo ? `background-image:url('${pUrl(p)}')` : `background-image:${grad(p.id)}`; }
const bgInner = p => p.photo ? '' : '🪴';

// 画像を縮小してJPEG Blobにする(端末容量節約)
async function shrink(file, max = 1280) {
  const u = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = u;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
  } finally { URL.revokeObjectURL(u); }
}
function pickFile(cb) {
  const f = $('#file');
  f.value = '';
  f.onchange = async () => {
    const file = f.files[0];
    if (!file) return;
    try { cb(await shrink(file)); } catch { toast('画像を読み込めませんでした'); }
  };
  f.click();
}

/* ---------- データ操作 ---------- */
async function savePlant(p) { p.id = await DB.put('plants', p); if (!S.plants.includes(p)) S.plants.push(p); return p; }
async function addLog(pid, type, o = {}) {
  const l = { plantId: pid, type, date: o.date || todayStr(), text: o.text || '', photo: o.photo || null, ts: Date.now() };
  l.id = await DB.put('logs', l);
  S.logs.push(l); reindex();
  return l;
}
async function delLog(id) { await DB.del('logs', id); S.logs = S.logs.filter(l => l.id !== id); reindex(); }
async function saveSet(k, v) { S.set[k] = v; await DB.put('settings', { key: k, value: v }); }

// 今日の記録を付ける/取り消す。指定タイプがすべて記録済みなら取り消し、そうでなければ未記録分を記録
async function toggleToday(pid, types) {
  const t = todayStr();
  const e = IDX.get(pid) || { w: [], f: [] };
  const has = ty => (ty === 'water' ? e.w : e.f).filter(x => x.date === t);
  const allDone = types.every(ty => has(ty).length);
  if (allDone) { for (const ty of types) for (const l of has(ty)) await delLog(l.id); }
  else { for (const ty of types) if (!has(ty).length) await addLog(pid, ty); }
  return allDone;
}

/* ---------- UI部品 ---------- */
function toast(m) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = m;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}
function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="grab"></div>${html}`;
  s.scrollTop = 0;
  s.classList.add('on'); $('#mask').classList.add('on');
}
function closeSheet() { $('#sheet').classList.remove('on'); $('#mask').classList.remove('on'); }

/* ---------- ホーム ---------- */
function homeView() {
  const t = new Date();
  const list = S.plants.filter(p => !p.paused).map(p => ({ p, i: info(p) }))
    .filter(x => (x.i.until !== null && x.i.until <= 0) || x.i.wToday || x.i.fToday)
    .sort((a, b) => (a.i.until ?? 9e9) - (b.i.until ?? 9e9));
  const todo = list.filter(x => x.i.until !== null && x.i.until <= 0 && !x.i.wToday).length;
  let h = `<h2 class="pg">${t.getMonth() + 1}月${t.getDate()}日 ${WD[t.getDay()]}曜日 ・ 全${S.plants.length}株</h2>
    <div class="sec">💧 今日の水やり <span>・残り${todo}株</span></div>`;
  if (!S.plants.length) h += `<div class="empty">まだ植物がありません。<br>右下の ＋ から登録しましょう。</div>`;
  else if (!list.length) h += `<div class="empty">今日水やりが必要な植物はありません 🌿</div>`;
  for (const { p, i } of list) {
    const sub = i.until < 0 ? `<small class="late">${-i.until}日超過</small>` : i.until === 0 ? '<small>今日</small>' : '<small>水やり済み</small>';
    h += `<div class="item"><div class="thumb" style="${bgOf(p)}" data-act="open" data-id="${p.id}">${bgInner(p)}</div>
      <div class="n" data-act="open" data-id="${p.id}">${esc(p.name)}${sub}</div>
      <button class="btn rec ${i.wToday ? 'done' : ''}" data-act="rec" data-t="water" data-id="${p.id}">💧 ${i.wToday ? '済' : '水やり'}</button>
      <button class="btn f rec ${i.fToday ? 'done' : ''}" data-act="rec" data-t="fert" data-id="${p.id}">🌱 ${i.fToday ? '済' : '肥料'}</button></div>`;
  }
  return h;
}

/* ---------- 植物一覧 ---------- */
function sortedPlants() {
  let a = S.plants.map(p => ({ p, i: info(p) }));
  const q = S.q.trim().toLowerCase();
  if (q) a = a.filter(x => x.p.name.toLowerCase().includes(q));
  const f = S.set.sort;
  if (f === 'name') a.sort((x, y) => x.p.name.localeCompare(y.p.name, 'ja'));
  else if (f === 'due') a.sort((x, y) => (!!x.p.paused - !!y.p.paused) || ((x.i.until ?? 9e9) - (y.i.until ?? 9e9)));
  else a.sort((x, y) => x.p.id - y.p.id);
  if (S.set.rev) a.reverse();
  return a;
}
function cardHtml({ p, i }) {
  const status = i.since === null ? '水やり 未記録' : `水やり ${i.since === 0 ? '今日' : i.since + '日前'}`;
  const late = !p.paused && i.until !== null && i.until < 0;
  const ic = (i.wToday ? '<i>💧</i>' : '') + (i.fToday ? '<i class="f">🌱</i>' : '');
  return `<div class="card${p.paused ? ' paused' : ''}" data-act="card" data-id="${p.id}">
    <div class="ph" style="${bgOf(p)}">${bgInner(p)}${p.paused ? '<div class="zz"><div>Zzz…<small>管理休止中</small></div></div>' : `<span class="tag${late ? ' late' : ''}">${status}</span>`}${ic ? `<div class="rec-ic">${ic}</div>` : ''}</div>
    <div class="nm">${esc(p.name)}<small class="${late ? 'late' : ''}">${p.paused ? '💤 管理休止中' : status}</small></div>
    <div class="rl">${ic}</div></div>`;
}
function renderGrid() {
  const a = sortedPlants();
  const g = $('#grid');
  if (!g) return;
  g.className = 'grid ' + (S.set.layout === 'g2' ? 'g2' : S.set.layout === 'list' ? 'lst' : '');
  g.innerHTML = a.length ? a.map(cardHtml).join('') : '';
  $('#cnt').textContent = `${a.length}件`;
  $('#gempty').innerHTML = a.length ? '' : `<div class="empty">${S.plants.length ? '該当する植物がありません' : 'まだ植物がありません。<br>右下の ＋ から登録しましょう。'}</div>`;
}
function modeHint() {
  const a = [S.mode.w && '水やり', S.mode.f && '肥料'].filter(Boolean);
  return a.length ? `${a.join('と')}を記録：植物をタップ（もう一度タップで取り消し）` : 'どちらもOFFのときは、タップで詳細を開きます';
}
function listView() {
  return `<div class="search">🔍<input id="q" type="search" placeholder="植物名で検索" value="${esc(S.q)}"></div>
    <div class="mode"><button data-act="mode" data-m="w" class="${S.mode.w ? 'on' : ''}">💧 水やり</button><button data-act="mode" data-m="f" class="${S.mode.f ? 'on' : ''}">🌱 肥料</button></div>
    <div class="modehint" id="modehint">${modeHint()}</div>
    <div class="bar"><span id="cnt"></span><button class="chip" data-act="list-opts">☰ 表示・並び替え</button></div>
    <div class="grid" id="grid"></div><div id="gempty"></div>`;
}
function listOptsSheet() {
  const L = [['list', 'リスト'], ['g2', 'グリッド 2列'], ['g3', 'グリッド 3列']];
  const O = [['order', '登録順'], ['due', '水やりが近い順'], ['name', '名前順']];
  openSheet(`<h2>表示・並び替え</h2>
    <div class="grp"><h4>レイアウト</h4><div class="opts">${L.map(([k, n]) => `<div class="opt ${S.set.layout === k ? 'on' : ''}" data-act="set-layout" data-v="${k}">${n}</div>`).join('')}</div></div>
    <div class="grp"><h4>並び替え</h4><div class="opts">${O.map(([k, n]) => `<span class="pill ${S.set.sort === k ? 'on' : ''}" data-act="set-sort" data-v="${k}">${n}</span>`).join('')}<span class="pill ${S.set.rev ? 'on' : ''}" data-act="set-rev">逆順</span></div></div>
    <button class="close" data-act="close-sheet">閉じる</button>`);
}

/* ---------- 履歴 ---------- */
function histView() {
  let h = `<div class="seg"><button class="${S.hist === 'cal' ? 'on' : ''}" data-act="hist-view" data-v="cal">▦ カレンダー</button><button class="${S.hist === 'list' ? 'on' : ''}" data-act="hist-view" data-v="list">☰ リスト</button></div>`;
  const byDate = new Map();
  for (const l of S.logs) { if (!byDate.has(l.date)) byDate.set(l.date, []); byDate.get(l.date).push(l); }
  const row = l => {
    const p = plantOf(l.plantId); if (!p) return '';
    return `<div class="row" data-act="open" data-id="${p.id}" style="cursor:pointer">${l.photo ? `<span class="pic" style="background-image:url('${lUrl(l)}')"></span>` : ICON[l.type]}<span class="tx">${esc(p.name)}${l.text ? `<em>${esc(l.text)}</em>` : ''}</span><small>${LABEL[l.type]}</small></div>`;
  };
  if (S.hist === 'cal') {
    const [y, m] = S.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getDay();
    const days = new Date(y, m, 0).getDate();
    h += `<div class="mon"><button data-act="month" data-v="-1" aria-label="前の月">‹</button><span>${y}年${m}月</span><button data-act="month" data-v="1" aria-label="次の月">›</button></div><div class="cal">`;
    h += WD.map(w => `<div class="w">${w}</div>`).join('') + '<div></div>'.repeat(first);
    const t = todayStr();
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(m)}-${pad(d)}`;
      const ls = byDate.get(ds) || [];
      const ty = new Set(ls.map(l => l.type));
      const dots = (ty.has('water') ? '<i></i>' : '') + (ty.has('fert') ? '<i class="f"></i>' : '') + (ty.has('note') ? '<i class="l"></i>' : '');
      h += `<button class="d ${ds === t ? 'today' : ''} ${ds === S.sel ? 'sel' : ''}" data-act="sel-day" data-v="${ds}"><span>${d}</span><div class="dots">${dots}</div></button>`;
    }
    h += '</div>';
    const ls = byDate.get(S.sel) || [];
    const sd = fromYmd(S.sel);
    h += `<div class="day"><h3>${sd.getMonth() + 1}月${sd.getDate()}日（${WD[sd.getDay()]}）の履歴</h3>${ls.length ? ls.sort((a, b) => b.ts - a.ts).map(row).join('') : '<div class="empty" style="padding:14px">記録はありません</div>'}</div>`;
  } else {
    const dates = [...byDate.keys()].sort().reverse();
    if (!dates.length) h += '<div class="empty">まだ記録がありません</div>';
    for (const d of dates.slice(0, 60)) h += `<div class="day"><h3>${fmtMD(d)}（${WD[fromYmd(d).getDay()]}）</h3>${byDate.get(d).sort((a, b) => b.ts - a.ts).map(row).join('')}</div>`;
  }
  return h;
}

/* ---------- データ(バックアップ) ---------- */
function dataView() {
  return `<div class="day"><h3>データのバックアップ</h3>
    <p style="font-size:13px;color:var(--sub);margin-bottom:10px">植物・記録・写真はこの端末内にだけ保存されています。機種変更や削除に備えて、定期的に書き出してください。</p>
    <button class="primary" data-act="export">バックアップを書き出す（JSON）</button>
    <button class="ghost" data-act="import">バックアップから復元</button>
    <p style="font-size:12px;color:var(--sub);margin-top:10px">復元すると現在のデータは置き換えられます。</p></div>
    <div class="day"><h3>保存状況</h3><div class="row">植物<small>${S.plants.length}株</small></div><div class="row">記録<small>${S.logs.length}件</small></div></div>`;
}
const b2d = b => new Promise(r => { if (!b) return r(null); const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
async function exportAll() {
  const plants = await Promise.all(S.plants.map(async p => ({ ...p, photo: await b2d(p.photo) })));
  const logs = await Promise.all(S.logs.map(async l => ({ ...l, photo: await b2d(l.photo) })));
  const data = { app: 'plantslife', version: 1, exportedAt: new Date().toISOString(), plants, logs, settings: S.set };
  const name = `plantslife-${todayStr()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importAll(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('ファイルを読み込めませんでした'); }
  if (data?.app !== 'plantslife' || !Array.isArray(data.plants) || !Array.isArray(data.logs)) return toast('PlantsLifeのバックアップではありません');
  if (!confirm(`現在のデータを置き換えて復元します。\n植物${data.plants.length}株・記録${data.logs.length}件\nよろしいですか？`)) return;
  const d2b = async d => d ? await (await fetch(d)).blob() : null;
  await DB.clear('plants'); await DB.clear('logs');
  for (const p of data.plants) await DB.put('plants', { ...p, photo: await d2b(p.photo) });
  for (const l of data.logs) await DB.put('logs', { ...l, photo: await d2b(l.photo) });
  S.plants = await DB.all('plants'); S.logs = await DB.all('logs'); reindex();
  S.detail = null; render(); toast('復元しました');
}

/* ---------- 詳細 ---------- */
function detailView(p) {
  const i = info(p), t = todayStr();
  const until = p.paused ? '休止中' : i.until === null ? '未設定' : i.until < 0 ? `${-i.until}日超過` : i.until === 0 ? '今日' : `${i.until}日後`;
  const rel = d => { const n = dayDiff(t, d); return n === 0 ? '今日' : n + '日前'; };
  const recRows = (arr, ty) => arr.length ? arr.slice(0, 6).map(l => `<div class="row">${ICON[ty]} ${fmtMD(l.date)}<small>${rel(l.date)}</small><button class="x" data-act="del-log" data-lid="${l.id}" aria-label="削除">✕</button></div>`).join('') : `<div class="nil">まだ記録がありません</div>`;
  const notes = i.e.n;
  const photos = notes.filter(l => l.photo);
  return `<div class="dwrap">
    <div class="hero" style="${p.photo ? `background-image:url('${pUrl(p)}')` : `background-image:${grad(p.id)}`}">
      <button class="back" data-act="back" aria-label="戻る">‹</button>
      <div class="side"><button data-act="edit-plant" data-id="${p.id}" aria-label="編集">✎</button></div>
      <h2>${esc(p.name)}</h2><button class="chg" data-act="change-photo" data-id="${p.id}">📷 写真を変更</button></div>
    <div class="stats"><div><small>次回水やり</small><b>${until}</b></div>
      <div><small>平均水やり間隔</small><b>${i.avg === null ? '-' : (Math.round(i.avg * 10) / 10) + '日'}</b><small>基準：${i.iv ? i.iv + '日' : '未設定'}</small></div>
      <div><small>入手から</small><b>${Math.max(0, dayDiff(t, p.acquired || t))}日</b></div></div>
    <div class="dcard"><div class="tg">💤 管理休止（一覧でZzz表示）<button class="sw ${p.paused ? 'on' : ''}" data-act="pause" data-id="${p.id}" aria-label="管理休止"></button></div></div>
    <div class="dcard"><div class="hd">⏱ 水やり頻度（日おき）</div>
      <div class="ivs">${SEASONS.map(([k, n]) => `<label>${n}<input type="number" inputmode="numeric" min="0" max="365" data-iv="${k}" data-id="${p.id}" value="${p.iv?.[k] ?? 0}"></label>`).join('')}</div>
      <div class="nil" style="margin-top:8px">今の季節：${SEASONS.find(s => s[0] === seasonOf(t))[1]}（0で予定なし）</div></div>
    <div class="dcard"><div class="hd">💧 水やり記録 <button class="addb" data-act="add-log" data-t="water" data-id="${p.id}">＋ 日付を指定</button></div>${recRows(i.e.w, 'water')}</div>
    <div class="dcard"><div class="hd">🌱 肥料記録 <button class="addb y" data-act="add-log" data-t="fert" data-id="${p.id}">＋ 日付を指定</button></div>${recRows(i.e.f, 'fert')}</div>
    <div class="dcard"><div class="hd">📝 育成記録 <button class="addb g" data-act="add-log" data-t="note" data-id="${p.id}">＋ 記録を追加</button></div>
      ${notes.length ? notes.slice(0, 10).map(l => `<div class="row">${l.photo ? `<span class="pic" style="background-image:url('${lUrl(l)}')"></span>` : '📝'}<span class="tx">${esc(l.text) || '(写真のみ)'}<em>${fmtMD(l.date)}</em></span><button class="x" data-act="del-log" data-lid="${l.id}" aria-label="削除">✕</button></div>`).join('') : '<div class="nil">まだ育成記録がありません</div>'}</div>
    <div class="dcard"><div class="hd">🖼 写真記録 <button class="addb g" data-act="quick-photo" data-id="${p.id}">＋ 写真を追加</button></div>
      ${photos.length ? `<div class="gal">${photos.map(l => `<div style="background-image:url('${lUrl(l)}')" data-act="view-photo" data-lid="${l.id}"><small>${fmtMD(l.date)}</small></div>`).join('')}</div>` : '<div class="nil">まだ写真がありません</div>'}</div>
    <div class="dcard"><button class="ghost danger" style="margin:0" data-act="del-plant" data-id="${p.id}">この植物を削除</button></div>
    <div class="dact"><button class="${i.wToday ? 'done' : ''}" data-act="rec" data-t="water" data-id="${p.id}">💧 ${i.wToday ? '済' : '水やり'}</button><button class="${i.fToday ? 'done' : ''}" data-act="rec" data-t="fert" data-id="${p.id}">🌱 ${i.fToday ? '済' : '肥料'}</button><button data-act="add-log" data-t="note" data-id="${p.id}">📝 記録</button><button data-act="quick-photo" data-id="${p.id}">📷 写真</button></div></div>`;
}
function renderDetail() {
  const d = $('#detail');
  const p = S.detail != null ? plantOf(S.detail) : null;
  if (!p) { d.classList.remove('on'); d.innerHTML = ''; return; }
  const top = d.scrollTop;
  d.innerHTML = detailView(p);
  d.classList.add('on');
  d.scrollTop = top;
}

/* ---------- フォーム(シート) ---------- */
let formPhoto; // undefined=変更なし, Blob=新規, null=削除
function plantForm(p) {
  formPhoto = undefined;
  const iv = p?.iv || DEFAULT_IV;
  openSheet(`<h2>${p ? '植物を編集' : '植物を登録'}</h2>
    <div class="pickphoto"><div class="pv" id="pv" style="${p?.photo ? `background-image:url('${pUrl(p)}')` : ''}">${p?.photo ? '' : '🪴'}</div><button class="ghost" style="margin:0;width:auto;padding:0 16px" data-act="pick-plant-photo">写真を選ぶ</button></div>
    <label class="fld">名称<input id="f-name" type="text" maxlength="60" placeholder="例：パキポディウム グラキリス" value="${esc(p?.name || '')}"></label>
    <div class="grp"><h4>水やり頻度（日おき・0で予定なし）</h4><div class="ivs">${SEASONS.map(([k, n]) => `<label>${n}<input id="f-iv-${k}" type="number" inputmode="numeric" min="0" max="365" value="${iv[k]}"></label>`).join('')}</div></div>
    <label class="fld">入手日<input id="f-acq" type="date" value="${p?.acquired || todayStr()}"></label>
    <button class="primary" data-act="save-plant" data-id="${p?.id ?? ''}">保存</button>
    <button class="ghost" data-act="close-sheet">キャンセル</button>`);
}
async function submitPlant(id) {
  const name = $('#f-name').value.trim();
  if (!name) return toast('名称を入力してください');
  const iv = {}; for (const [k] of SEASONS) iv[k] = Math.max(0, Math.min(365, parseInt($('#f-iv-' + k).value, 10) || 0));
  const acquired = $('#f-acq').value || todayStr();
  let p = id ? plantOf(+id) : null;
  if (p) Object.assign(p, { name, iv, acquired });
  else p = { name, iv, acquired, paused: false, photo: null, createdAt: Date.now() };
  if (formPhoto !== undefined) p.photo = formPhoto;
  await savePlant(p);
  closeSheet(); render(); toast(id ? '保存しました' : '登録しました');
}
let logPhoto = null;
function logForm(pid, type) {
  logPhoto = null;
  const p = plantOf(pid);
  openSheet(`<h2>${ICON[type]} ${esc(p.name)} の${LABEL[type]}</h2>
    <label class="fld">日付<input id="l-date" type="date" value="${todayStr()}" max="${todayStr()}"></label>
    ${type === 'note' ? `<label class="fld">内容<textarea id="l-text" maxlength="1000" placeholder="新芽が出た、植え替えをした など"></textarea></label>
    <div class="pickphoto"><div class="pv" id="pv">🖼</div><button class="ghost" style="margin:0;width:auto;padding:0 16px" data-act="pick-log-photo">写真を添付</button></div>` : ''}
    <button class="primary" data-act="save-log" data-t="${type}" data-id="${pid}">保存</button>
    <button class="ghost" data-act="close-sheet">キャンセル</button>`);
}
async function submitLog(pid, type) {
  const date = $('#l-date').value || todayStr();
  const text = type === 'note' ? $('#l-text').value.trim() : '';
  if (type === 'note' && !text && !logPhoto) return toast('内容か写真を入れてください');
  await addLog(pid, type, { date, text, photo: logPhoto });
  closeSheet(); render(); toast('記録しました');
}

/* ---------- 描画 ---------- */
function render() {
  const v = $('#view');
  v.innerHTML = { home: homeView, list: listView, hist: histView, data: dataView }[S.tab]();
  if (S.tab === 'list') renderGrid();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  $('#fab').classList.toggle('hide', !(S.tab === 'home' || S.tab === 'list'));
  renderDetail();
}

/* ---------- イベント ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id ? +el.dataset.id : null;
  try {
    switch (act) {
      case 'tab': S.tab = el.dataset.t; S.detail = null; render(); scrollTo(0, 0); break;
      case 'add-plant': plantForm(null); break;
      case 'edit-plant': plantForm(plantOf(id)); break;
      case 'pick-plant-photo': pickFile(b => { formPhoto = b; const pv = $('#pv'); pv.style.backgroundImage = `url('${URL.createObjectURL(b)}')`; pv.textContent = ''; }); break;
      case 'save-plant': await submitPlant(el.dataset.id); break;
      case 'close-sheet': closeSheet(); break;
      case 'open': S.detail = id; renderDetail(); break;
      case 'back': S.detail = null; render(); break;
      case 'mode': { S.mode[el.dataset.m] = !S.mode[el.dataset.m]; el.classList.toggle('on', S.mode[el.dataset.m]); $('#modehint').textContent = modeHint(); break; }
      case 'card': {
        if (!S.mode.w && !S.mode.f) { S.detail = id; renderDetail(); break; }
        const p = plantOf(id);
        if (p.paused) { toast('管理休止中の植物です'); break; }
        const types = [S.mode.w && 'water', S.mode.f && 'fert'].filter(Boolean);
        const cancelled = await toggleToday(id, types);
        renderGrid();
        $(`.card[data-id="${id}"]`)?.classList.add('flash');
        toast(`${p.name}：${types.map(t => LABEL[t]).join('・')}${cancelled ? 'の記録を取り消しました' : 'を記録しました'}`);
        break;
      }
      case 'rec': {
        const cancelled = await toggleToday(id, [el.dataset.t]);
        render(); toast(`${LABEL[el.dataset.t]}${cancelled ? 'の記録を取り消しました' : 'を記録しました'}`); break;
      }
      case 'list-opts': listOptsSheet(); break;
      case 'set-layout': await saveSet('layout', el.dataset.v); listOptsSheet(); renderGrid(); break;
      case 'set-sort': await saveSet('sort', el.dataset.v); listOptsSheet(); renderGrid(); break;
      case 'set-rev': await saveSet('rev', !S.set.rev); listOptsSheet(); renderGrid(); break;
      case 'hist-view': S.hist = el.dataset.v; render(); break;
      case 'month': { const [y, m] = S.month.split('-').map(Number); const d = new Date(y, m - 1 + Number(el.dataset.v), 1); S.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); break; }
      case 'sel-day': S.sel = el.dataset.v; render(); break;
      case 'pause': { const p = plantOf(id); p.paused = !p.paused; await savePlant(p); renderDetail(); toast(p.paused ? '管理休止にしました' : '管理を再開しました'); break; }
      case 'add-log': logForm(id, el.dataset.t); break;
      case 'pick-log-photo': pickFile(b => { logPhoto = b; const pv = $('#pv'); pv.style.backgroundImage = `url('${URL.createObjectURL(b)}')`; pv.textContent = ''; }); break;
      case 'save-log': await submitLog(id, el.dataset.t); break;
      case 'quick-photo': pickFile(async b => { await addLog(id, 'note', { photo: b }); render(); toast('写真を追加しました'); }); break;
      case 'change-photo': pickFile(async b => { const p = plantOf(id); p.photo = b; await savePlant(p); render(); }); break;
      case 'del-log': if (confirm('この記録を削除しますか？')) { await delLog(+el.dataset.lid); render(); } break;
      case 'view-photo': {
        const l = S.logs.find(x => x.id === +el.dataset.lid);
        openSheet(`<img src="${lUrl(l)}" alt="" style="width:100%;border-radius:14px"><p style="margin:10px 2px;font-size:13px;color:var(--sub)">${fmtMD(l.date)} ${esc(l.text)}</p><button class="ghost" data-act="close-sheet">閉じる</button>`);
        break;
      }
      case 'del-plant': {
        const p = plantOf(id);
        if (confirm(`「${p.name}」と、その記録・写真をすべて削除します。元に戻せません。よろしいですか？`)) {
          await DB.del('plants', id); await DB.delLogsOf(id);
          S.plants = S.plants.filter(x => x.id !== id); S.logs = S.logs.filter(l => l.plantId !== id); reindex();
          S.detail = null; render(); toast('削除しました');
        }
        break;
      }
      case 'export': await exportAll(); break;
      case 'import': { const f = $('#import'); f.value = ''; f.onchange = () => f.files[0] && importAll(f.files[0]); f.click(); break; }
    }
  } catch (err) { console.error(err); toast('エラーが発生しました'); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.q = e.target.value; renderGrid(); }
});
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset?.iv) {
    const p = plantOf(+el.dataset.id);
    p.iv = { ...p.iv, [el.dataset.iv]: Math.max(0, Math.min(365, parseInt(el.value, 10) || 0)) };
    await savePlant(p); renderDetail();
  }
});

/* ---------- 起動 ---------- */
(async function init() {
  await DB.open();
  try { navigator.storage?.persist?.(); } catch { /* 無視 */ }
  S.plants = await DB.all('plants'); S.logs = await DB.all('logs');
  for (const r of await DB.all('settings')) S.set[r.key] = r.value;
  reindex(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
