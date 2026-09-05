'use strict';

/* =========================================================================
   G Work — vista in sola lettura su routine fissa + calendario G WORK.
   Nessuna dipendenza. Nessuna scrittura verso Google.
   ========================================================================= */

const CHECKS_KEY  = 'gwork-checks-v1';
const RECORDS_KEY = 'gwork-records-v1';
const DIARIO_KEY  = 'gwork-diario-v1';
const LEGACY_KEY  = 'hs-personal-routine-v1';
/* Il ciclo di pubblicazione dura circa due minuti e mezzo, quindi l'orario che
   si legge sulla barra ha fisiologicamente fra i 2 e i 4 minuti e mezzo. Le
   soglie stanno sopra quella fascia per non dare falsi allarmi: fino a 10
   minuti e' tutto normale; oltre 10 il ponte sta accumulando ritardo; oltre 30
   e' fermo davvero. */
const LATE_MS     = 10 * 60 * 1000;
const DOWN_MS     = 30 * 60 * 1000;

/* Le sei fasce delle G Work Session, in minuti dalla mezzanotte. Coprono le 24 ore. */
const FASCE = [[0, 540], [540, 630], [630, 855], [855, 960], [960, 1140], [1140, 1440]];

/* Le finestre protette. Nessun rapporto con le fasce, nessun nome visibile. */
const PROTETTE = [[0, 450], [750, 855], [1080, 1140], [1260, 1440]];

/* La routine fissa. Il totale del giorno si calcola da qui, non e' una costante. */
const ROUTINE = [
  { id: 'sveglia', t: 'SVEGLIA 6:45', sub: [
    { id: 'sveglia-massaggio',    t: 'MASSAGGIO FACCIA AL SOLE' },
    { id: 'sveglia-morning-call', t: 'ASCOLTO MORNING CALL' },
    { id: 'sveglia-acqua',        t: '1 BICCHIERE DI ACQUA' },
    { id: 'sveglia-main-target',  t: 'WRITE MAIN TARGET OF THE DAY' },
    { id: 'sveglia-frutti',       t: '2/3 FRUTTI' },
    { id: 'sveglia-fascia',       t: 'FASCIA DAILY ROUTINE' }
  ]},
  { id: 'fireblood', t: 'FIREBLOOD' },
  { id: 'caffe-1',   t: 'CAFFÈ' },
  { id: 'gws1', t: '1ST G WORK SESSION', gws: 0 },
  { id: 'spuntino-formaggio', t: 'SPUNTINO FORMAGGIO' },
  { id: 'gws2', t: '2ND G WORK SESSION', gws: 1 },
  { id: 'gws3', t: '3RD G WORK SESSION', gws: 2 },
  { id: 'workout', t: 'WORKOUT',
    choice: [{ id: 'workout-full', t: 'FULL' }, { id: 'workout-med', t: 'MED' }],
    sub: [{ id: 'workout-doccia', t: 'DOCCIA' }] },
  { id: 'pranzo', t: 'PRANZO', sub: [
    { id: 'pranzo-zenzero',    t: 'ZENZERO' },
    { id: 'pranzo-pasta-riso', t: 'PASTA/RISO' },
    { id: 'pranzo-uova-pesce', t: 'UOVA/PESCE' }
  ]},
  { id: 'routine-giorno', t: 'ROUTINE', sub: [
    { id: 'routine-puzzle',    t: 'DAILY PUZZLE' },
    { id: 'routine-lessons',   t: 'DAILY LESSONS' },
    { id: 'routine-movimento', t: '15 MIN MOVIMENTO' }
  ]},
  { id: 'caffe-2',   t: 'CAFFÈ' },
  { id: 'frutti-15', t: '2/3 FRUTTI ALLE 15' },
  { id: 'gws4', t: '4TH G WORK SESSION', gws: 3 },
  { id: 'gws5', t: '5TH G WORK SESSION', gws: 4 },
  { id: 'cena', t: 'CENA', sub: [
    { id: 'cena-aglio', t: 'SPICCHIO DI AGLIO' },
    { id: 'cena-carne', t: 'CARNE' },
    { id: 'cena-uovo',  t: 'EVENTUALE 1 UOVO' }
  ]},
  { id: 'studio', t: 'STUDIO' },
  { id: 'gws6', t: '6TH G WORK SESSION', gws: 5 },
  { id: 'routine-serale', t: 'ROUTINE SERALE 21:00', sub: [
    { id: 'serale-pulizie', t: 'PULIZIE' },
    { id: 'serale-denti',   t: 'DENTI' },
    { id: 'serale-esamina', t: 'ESAMINA LA GIORNATA' },
    { id: 'serale-domani',  t: 'DOMANI ORGANIZZATO' },
    { id: 'serale-gambe',   t: 'GAMBE SUL MURO' }
  ]},
  { id: 'non-masturbarti', t: 'NO 🌽' },
  { id: 'main-target',     t: 'MAIN TARGET OF THE DAY RAGGIUNTO' }
];

/* La tappa che chiude la giornata: spuntarla chiede il voto e il commento.
   L'id resta quello vecchio, cosi' le spunte gia' date non si perdono. */
const CLOSE_ID = 'non-masturbarti';

/* ---------------------------------------------------------------- date --- */

const pad = n => String(n).padStart(2, '0');
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

function shift(d, n) {
  const c = new Date(d.getTime());
  c.setDate(c.getDate() + n);
  return c;
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const fmtDate = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

/* La finestra dei quattro giorni si calcola in locale, non si legge dal file:
   se il ponte si ferma, oggi resta comunque spuntabile. */
function windowKeys() {
  const t = today();
  return [-1, 0, 1, 2].map(n => dayKey(shift(t, n)));
}

/* Unica regola per le spunte e per il registro: dentro la finestra si scrive,
   fuori si guarda e basta. Cosi' schermo e registro non possono divergere. */
const isEditable = k => windowKeys().indexOf(k) >= 0;

/* ------------------------------------------------------- archiviazione --- */

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  } catch (e) {
    return {};                    /* JSON corrotto = stato vuoto, non app rotta */
  }
}

function writeStore(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    /* quota piena o modalita' privata: le spunte restano solo in memoria */
  }
}

let checks  = readStore(CHECKS_KEY);
let records = readStore(RECORDS_KEY);
let diario  = readStore(DIARIO_KEY);

const dayChecks = k => (checks[k] && typeof checks[k] === 'object') ? checks[k] : {};

/* Un giorno e' chiuso quando la tappa di chiusura e' spuntata e il voto c'e'.
   Togliendo la spunta il giorno si riapre, ma voto e commento restano scritti:
   tornano nel pop-up se la giornata si richiude. */
const isClosed = k => !!(dayChecks(k)[CLOSE_ID] && diario[k]);

function setDiario(k, voto, commento) {
  if (!isEditable(k)) return;
  diario[k] = { voto: voto, commento: commento };
  writeStore(DIARIO_KEY, diario);
}

function setCheck(k, id, on) {
  if (!isEditable(k)) return;
  if (!checks[k] || typeof checks[k] !== 'object') checks[k] = {};
  if (on) checks[k][id] = 1;
  else delete checks[k][id];      /* esistono solo le spunte attive */
  if (Object.keys(checks[k]).length === 0) delete checks[k];
  writeStore(CHECKS_KEY, checks);
}

/* ------------------------------------------------------------ eventi ----- */

let cal = null;                   /* contenuto di calendar.json, oppure null */
let loaded = false;               /* true dopo il primo tentativo di lettura */

const isCovered = k => !!(cal && cal.days && Object.prototype.hasOwnProperty.call(cal.days, k));

const minutesOf = hhmm => (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5));

/* Gli orari nel JSON sono gia' in ora di Roma: si leggono dalla stringa, cosi'
   il risultato non dipende dal fuso orario del telefono. */
function prepEvent(ev) {
  const start = String(ev.start || '');
  const sTxt = start.slice(11, 16);
  const sMin = minutesOf(sTxt);

  let eMin = sMin, eTxt = sTxt;
  if (ev.end) {
    if (String(ev.end).slice(0, 10) === start.slice(0, 10)) {
      eTxt = String(ev.end).slice(11, 16);
      eMin = minutesOf(eTxt);
    } else {
      eMin = 1440;                /* finisce oltre la mezzanotte, o dura tutto il giorno */
      eTxt = '24:00';
    }
  }

  const span = Math.max(eMin, sMin + 1);
  const fascia = FASCE.findIndex(f => sMin >= f[0] && sMin < f[1]);

  return {
    id:     String(ev.id || (start + '|' + ev.title)),
    title:  String(ev.title || '(senza titolo)'),
    desc:   String(ev.description || '').trim(),
    txt:    sTxt + '–' + eTxt,
    alarm:  PROTETTE.some(w => sMin < w[1] && span > w[0]),
    fascia: fascia < 0 ? 0 : fascia
  };
}

/* Le sei fasce coprono le 24 ore: nessun evento puo' restare fuori. */
function groupEvents(k) {
  const out = [[], [], [], [], [], []];
  if (!isCovered(k)) return out;
  const list = Array.isArray(cal.days[k]) ? cal.days[k] : [];
  for (const raw of list) {
    const e = prepEvent(raw);
    out[e.fascia].push(e);
  }
  return out;
}

/* ---------------------------------------------------------- conteggio --- */

/* Le figlie di una tappa: sottotappe, alternative ed eventi del calendario. */
function childState(t, c, evs) {
  let total = 0, done = 0;
  if (t.sub)    for (const s of t.sub) { total++; if (c[s.id]) done++; }
  if (t.choice) { total++; if (t.choice.some(o => c[o.id])) done++; }
  if (evs)      for (const e of evs) { total++; if (c[e.id]) done++; }
  return { total, done };
}

/* Spuntata la tappa, il blocco vale completo: le figlie rimaste indietro non
   pesano piu' sul totale della giornata. */
function tappaState(t, c, evs) {
  const ch = childState(t, c, evs);
  const total = ch.total + 1;
  return { total, done: c[t.id] ? total : ch.done };
}

function tally(k) {
  const c = dayChecks(k);
  const g = groupEvents(k);
  let total = 0, done = 0;
  for (const t of ROUTINE) {
    const st = tappaState(t, c, t.gws != null ? g[t.gws] : null);
    total += st.total;
    done  += st.done;
  }
  return { total, done };
}

/* Il record si riscrive per i quattro giorni della finestra, gli stessi in cui si
   puo' spuntare. Fuori resta congelato. Se calendar.json non copre un giorno della
   finestra i suoi eventi valgono zero: meglio un totale parziale che un buco nella
   serie quando il ponte si ferma. */
function refreshRecords() {
  if (!loaded) return;            /* prima della lettura non conosco ancora gli eventi */
  for (const k of windowKeys()) {
    const r = tally(k);
    records[k] = {
      fatte:       r.done,
      totale:      r.total,
      percentuale: r.total ? Math.round(r.done / r.total * 100) : 0,
      completo:    r.total > 0 && r.done === r.total
    };
  }
  writeStore(RECORDS_KEY, records);
}

/* La serie come stava quel giorno: zero se il giorno stesso non e' completo. */
function streakAt(k) {
  const complete = x => !!(records[x] && records[x].completo);
  let d = new Date(k + 'T00:00:00'), n = 0;
  while (complete(dayKey(d))) { n++; d = shift(d, -1); }
  return n;
}

function streak() {
  const t = today();
  /* oggi non ancora chiuso non azzera la serie: si guarda a ieri */
  return streakAt(dayKey(t)) || streakAt(dayKey(shift(t, -1)));
}

/* ------------------------------------------------------------ storico --- */

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
              'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const monthKey  = k => k.slice(0, 7);
const monthName = m => MESI[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4);

const fmtLong = new Intl.DateTimeFormat('it-IT',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* Un giorno entra nello storico se ha lasciato una traccia: almeno una spunta,
   oppure una chiusura. I giorni vuoti non si scrivono. */
const hasTrace = k => !!((records[k] && records[k].fatte > 0) || diario[k]);

function storicoDays(m) {
  const set = {};
  for (const k of Object.keys(records)) if (monthKey(k) === m && hasTrace(k)) set[k] = 1;
  for (const k of Object.keys(diario))  if (monthKey(k) === m) set[k] = 1;
  return Object.keys(set).sort();
}

function storicoMonths() {
  const set = {};
  for (const k of Object.keys(records)) if (hasTrace(k)) set[monthKey(k)] = 1;
  for (const k of Object.keys(diario))  set[monthKey(k)] = 1;
  return Object.keys(set).sort().reverse();   /* il mese in corso per primo */
}

/* Un mese, un file. I giorni uno sotto l'altro invece che in tabella: cosi' si
   legge ordinato sul telefono anche senza niente che interpreti il Markdown. */
function monthMarkdown(m) {
  const days   = storicoDays(m);
  const chiuse = days.filter(isClosed);

  let voti = 0, pct = 0;
  for (const k of chiuse) voti += diario[k].voto;
  for (const k of days)   pct  += (records[k] ? records[k].percentuale : 0);

  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const out = ['# Storico G Work — ' + monthName(m), ''];

  out.push('Giorni con attività: ' + days.length
    + ' · giornate chiuse: ' + chiuse.length
    + (chiuse.length ? ' · voto medio: ' + (voti / chiuse.length).toFixed(1) : '')
    + (days.length   ? ' · completamento medio: ' + Math.round(pct / days.length) + '%' : ''));

  for (const k of days) {
    const r = records[k] || { fatte: 0, totale: 0, percentuale: 0 };
    const d = isClosed(k) ? diario[k] : null;

    out.push('', '---', '');
    out.push('## ' + cap(fmtLong.format(new Date(k + 'T00:00:00'))));
    out.push('');
    out.push((d ? 'Voto ' + d.voto.toFixed(1) : 'Giornata non chiusa')
      + ' · ' + r.percentuale + '% (' + r.fatte + ' su ' + r.totale + ')'
      + ' · serie ' + streakAt(k));

    const c = d && String(d.commento || '').trim();
    if (c) out.push('', c);
  }

  return out.join('\n') + '\n';
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------- pagina --- */

const $ = id => document.getElementById(id);

let view = today();
let viewKey = dayKey(view);
let rows = [];                    /* [{ t, el, evs }] per gli aggiornamenti mirati */

function el(tag, cls, txt) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
}

function checkRow(id, label, cls, on, choiceOf) {
  const l = el('label', 'row' + (cls ? ' ' + cls : '') + (on ? ' on' : ''));
  const i = el('input');
  i.type = 'checkbox';
  i.checked = on;
  i.dataset.key = id;
  if (choiceOf) i.dataset.choice = choiceOf;
  l.appendChild(i);
  l.appendChild(el('span', 'ttl', label));
  return l;
}

function eventNode(e, on) {
  const li = el('li', 'ev' + (e.alarm ? ' alarm' : ''));
  const bar = el('div', 'evrow');

  const l = el('label', 'row' + (on ? ' on' : ''));
  const i = el('input');
  i.type = 'checkbox';
  i.checked = on;
  i.dataset.key = e.id;           /* la chiave e' l'id dell'evento, mai il titolo */
  l.appendChild(i);
  l.appendChild(el('span', 'time', e.txt));
  l.appendChild(el('span', 'ttl', e.title));
  bar.appendChild(l);

  if (e.desc) {
    const b = el('button', 'toggle', '▼');
    b.type = 'button';
    b.dataset.role = 'desc';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'Mostra la descrizione');
    bar.appendChild(b);
  }

  li.appendChild(bar);

  if (e.desc) {
    const p = el('p', 'desc', e.desc);   /* textContent: il testo di Google non e' HTML */
    p.hidden = true;
    li.appendChild(p);
  }
  return li;
}

function render() {
  const c = dayChecks(viewKey);
  const g = groupEvents(viewKey);
  const covered = isCovered(viewKey);
  const list = $('list');

  list.textContent = '';
  rows = [];

  for (const t of ROUTINE) {
    const evs = t.gws != null ? g[t.gws] : null;
    const li = el('li', 'tappa');

    li.appendChild(checkRow(t.id, t.t, 'row-t', !!c[t.id]));

    if (t.choice) {
      const box = el('div', 'choice');
      for (const o of t.choice) box.appendChild(checkRow(o.id, o.t, null, !!c[o.id], t.id));
      li.appendChild(box);
    }

    if (t.sub) {
      const ul = el('ul', 'sub');
      for (const s of t.sub) {
        const sli = el('li');
        sli.appendChild(checkRow(s.id, s.t, null, !!c[s.id]));
        ul.appendChild(sli);
      }
      li.appendChild(ul);
    }

    if (t.gws != null) {
      if (!covered) {
        /* prima del primo caricamento non si annuncia ancora niente */
        if (loaded) li.appendChild(el('p', 'nocov', 'Eventi non coperti per questa data'));
      } else if (evs.length) {
        const ul = el('ul', 'evs');
        for (const e of evs) ul.appendChild(eventNode(e, !!c[e.id]));
        li.appendChild(ul);
      }
    }

    list.appendChild(li);
    rows.push({ t: t, el: li, evs: evs });
  }

  /* fuori dalla finestra si consulta soltanto */
  const readOnly = !isEditable(viewKey);
  list.classList.toggle('ro', readOnly);
  if (readOnly) {
    list.querySelectorAll('input[type=checkbox]').forEach(i => { i.disabled = true; });
  }

  paintDate();
  syncDerived();          /* accende o spegne anche la sirena */
}

function paintDate() {
  $('dateMain').textContent = fmtDate.format(view);
  const t0 = today();
  const rel = $('dateRel');
  const readOnly = !isEditable(viewKey);
  rel.classList.toggle('ro', readOnly);
  rel.textContent = readOnly                     ? 'sola lettura'
            : viewKey === dayKey(t0)             ? 'oggi'
            : viewKey === dayKey(shift(t0, -1))  ? 'ieri'
            : viewKey === dayKey(shift(t0,  1))  ? 'domani'
            :                                      'dopodomani';
}

/* La sirena gira finche' resta almeno un evento in finestra protetta da spuntare.
   Spuntati tutti, sparisce. Chiusa la tappa non suona piu': quegli eventi ormai
   sono congelati e non si possono piu' spuntare. Il margine rosso invece resta:
   dice dov'era il conflitto. */
function paintSiren(c) {
  const any = rows.some(r => r.evs && !c[r.t.id] && r.evs.some(e => e.alarm && !c[e.id]));
  $('siren').hidden = !any;
  $('top').classList.toggle('has-siren', any);
}

/* Spuntate tutte le figlie, la tappa che le conteneva si chiude da sola. */
function autoClose() {
  if (!isEditable(viewKey)) return;
  const c = dayChecks(viewKey);
  for (const r of rows) {
    const ch = childState(r.t, c, r.evs);
    if (!ch.total || ch.done !== ch.total || c[r.t.id]) continue;
    setCheck(viewKey, r.t.id, true);
    const box = r.el.querySelector('input[data-key="' + r.t.id + '"]');
    if (box) {
      box.checked = true;
      box.closest('.row').classList.add('on');
    }
  }
}

/* Tappa chiusa: le figlie restano allo stato in cui sono — gli incompleti
   incompleti, i completi completi — e non si toccano piu'. */
function lockRow(r, closed, ro) {
  r.el.classList.toggle('closed', closed);
  r.el.querySelectorAll('input[data-key]').forEach(i => {
    if (i.dataset.key !== r.t.id) i.disabled = closed || ro;
  });
}

function syncDerived() {
  autoClose();
  const c = dayChecks(viewKey);
  const ro = !isEditable(viewKey);
  let total = 0, done = 0, active = null;

  for (const r of rows) {
    const st = tappaState(r.t, c, r.evs);
    total += st.total;
    done  += st.done;
    const full = !!c[r.t.id];        /* la tappa spuntata e' chiusa, comunque stiano le figlie */
    lockRow(r, full, ro);
    r.el.classList.toggle('done', full);
    r.el.classList.remove('active');
    if (!active && !full) active = r;
  }
  if (active) active.el.classList.add('active');

  paintSiren(c);

  const pct = total ? Math.round(done / total * 100) : 0;
  $('pct').textContent = pct + '%';
  $('progFill').style.width = pct + '%';
  $('act').textContent = active ? active.t.t : 'giornata completa';

  refreshRecords();
  paintMesi();

  const n = streak();
  const s = $('streak');
  s.textContent = 'serie ' + n;
  s.classList.toggle('hot', n > 0);
}

/* firma dell'elenco: non si ridisegna a ogni spunta. Parte da null perche' la
   firma dell'elenco vuoto e' la stringa vuota, e il primo giro deve passare. */
let mesiSig = null;

function paintMesi() {
  const ms  = storicoMonths();
  const sig = ms.join(',');
  if (sig === mesiSig) return;
  mesiSig = sig;

  const sel = $('mese');
  const cur = sel.value;
  sel.textContent = '';
  for (const m of ms) {
    const o = el('option', null, monthName(m));
    o.value = m;
    sel.appendChild(o);
  }
  if (!ms.length) sel.appendChild(el('option', null, 'nessuno storico'));
  if (ms.indexOf(cur) >= 0) sel.value = cur;   /* il mese scelto non salta via */

  sel.disabled = !ms.length;
  $('scarica').disabled = !ms.length;
}

function ageText(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + ' min fa';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h fa';
  return Math.floor(h / 24) + ' g fa';
}

function paintFresh() {
  const f = $('fresh');
  f.classList.remove('stale', 'down');

  if (!cal || !cal.generatedAt) {
    f.classList.add('down');
    f.textContent = 'calendar.json non disponibile';
    return;
  }
  const t = new Date(cal.generatedAt);
  if (isNaN(t.getTime())) {
    f.classList.add('down');
    f.textContent = 'calendar.json illeggibile';
    return;
  }
  const age = Date.now() - t.getTime();
  const hhmm = fmtTime.format(t);
  if (age > DOWN_MS) {                 /* prima il rosso: e' la soglia piu' alta */
    f.classList.add('down');
    f.textContent = 'FERMO — ultimo aggiornamento alle ' + hhmm + ' (' + ageText(age) + ')';
  } else if (age > LATE_MS) {
    f.classList.add('stale');
    f.textContent = 'In ritardo — ultimo aggiornamento alle ' + hhmm + ' (' + ageText(age) + ')';
  } else {
    f.textContent = 'Aggiornato alle ' + hhmm;
  }
}

/* ---------------------------------------------------------- interazioni --- */

$('list').addEventListener('change', ev => {
  const i = ev.target;
  if (!i.dataset || !i.dataset.key) return;

  setCheck(viewKey, i.dataset.key, i.checked);

  /* FULL e MED sono alternative: spuntarne una esclude l'altra */
  if (i.checked && i.dataset.choice) {
    const sel = 'input[data-choice="' + i.dataset.choice + '"]';
    $('list').querySelectorAll(sel).forEach(o => {
      if (o !== i && o.checked) {
        o.checked = false;
        o.closest('.row').classList.remove('on');
        setCheck(viewKey, o.dataset.key, false);
      }
    });
  }

  i.closest('.row').classList.toggle('on', i.checked);

  /* la giornata finisce qui: prima il voto e il commento, poi e' chiusa */
  if (i.dataset.key === CLOSE_ID && i.checked) openChiusura();

  syncDerived();
});

$('list').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-role="desc"]');
  if (!b) return;
  const open = b.getAttribute('aria-expanded') === 'true';
  b.setAttribute('aria-expanded', open ? 'false' : 'true');
  b.setAttribute('aria-label', open ? 'Mostra la descrizione' : 'Nascondi la descrizione');
  b.closest('.ev').querySelector('.desc').hidden = open;
});

function goTo(d) {
  view = d;
  viewKey = dayKey(view);
  render();
}

$('prev').addEventListener('click', () => goTo(shift(view, -1)));
$('next').addEventListener('click', () => goTo(shift(view, 1)));
$('dateBtn').addEventListener('click', () => goTo(today()));

$('scarica').addEventListener('click', () => {
  const m = $('mese').value;
  if (!m) return;
  download('storico-' + m + '.md', monthMarkdown(m), 'text/markdown;charset=utf-8');
});

/* ------------------------------------------------------------ chiusura --- */

const dlg = $('chiusura');

/* Dal rosso dell'1 al verde del 10: il numero e il cursore prendono lo stesso
   colore, cosi' il voto si legge anche senza guardare la cifra. */
function paintVoto(v) {
  $('votoNum').textContent = v.toFixed(1);
  document.documentElement.style.setProperty('--voto-col',
    'hsl(' + Math.round((v - 1) / 9 * 120) + ' 80% 52%)');
}

function openChiusura() {
  const d = diario[viewKey] || {};
  const v = typeof d.voto === 'number' ? d.voto : 5.5;   /* il centro esatto della scala */
  $('voto').value = v;
  paintVoto(v);
  $('commento').value = d.commento || '';
  $('chiusuraDay').textContent = fmtLong.format(view);
  dlg.returnValue = '';
  dlg.showModal();
}

$('voto').addEventListener('input', e => paintVoto(+e.target.value));

/* Annullare — bottone o tasto Esc — vuol dire che la giornata non e' chiusa:
   la spunta torna indietro. Voto e commento gia' scritti restano dov'erano. */
function annullaChiusura() {
  setCheck(viewKey, CLOSE_ID, false);
  const box = $('list').querySelector('input[data-key="' + CLOSE_ID + '"]');
  if (box) {
    box.checked = false;
    box.closest('.row').classList.remove('on');
  }
  syncDerived();
}

/* Confermare scrive voto e commento. */
$('chiusuraForm').addEventListener('submit', () => {
  setDiario(viewKey, +$('voto').value, $('commento').value);
  syncDerived();
});

$('chiusuraAnnulla').addEventListener('click', () => {
  annullaChiusura();
  dlg.close();
});

/* Esc, e sul telefono il tasto indietro: il dialogo si chiude comunque, ma la
   chiusura esplicita vale anche dove il browser non la fa da solo. */
dlg.addEventListener('cancel', () => {
  annullaChiusura();
  dlg.close();
});

/* Rete di sicurezza: se il dialogo si chiude per una via che non ho previsto,
   quello che conta e' se la conferma e' passata o no. Le due strade qui sopra
   sono ripetibili senza danno, quindi ripassarci non cambia niente. */
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'ok') setDiario(viewKey, +$('voto').value, $('commento').value);
  else annullaChiusura();
  syncDerived();
});

/* ---------------------------------------------------------- avviamento --- */

try {
  localStorage.removeItem(LEGACY_KEY);   /* lo storico precedente va eliminato, non migrato */
} catch (e) {
  /* niente da rimuovere */
}

async function loadCalendar() {
  const before = cal ? cal.generatedAt : null;
  try {
    const r = await fetch('calendar.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    cal = (j && typeof j === 'object' && j.days && typeof j.days === 'object') ? j : null;
  } catch (e) {
    cal = null;
  }
  const first = !loaded;
  loaded = true;
  refreshRecords();
  paintFresh();
  /* stesso file: non si ridisegna, cosi' le descrizioni aperte restano aperte */
  if (first || !cal || cal.generatedAt !== before) render();
}

render();
loadCalendar();

setInterval(paintFresh, 30000);   /* invecchia la riga fra una lettura e l'altra */
setInterval(loadCalendar, 30000); /* rilegge il file: senza, generatedAt resta fermo */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadCalendar();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
