'use strict';

/* =========================================================================
   G Work — vista in sola lettura su routine fissa + calendario G WORK.
   Nessuna dipendenza. Nessuna scrittura verso Google.
   ========================================================================= */

const CHECKS_KEY  = 'gwork-checks-v1';
const RECORDS_KEY = 'gwork-records-v1';
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
  { id: 'non-masturbarti', t: 'NON MASTURBARTI' },
  { id: 'main-target',     t: 'MAIN TARGET OF THE DAY RAGGIUNTO' }
];

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

const dayChecks = k => (checks[k] && typeof checks[k] === 'object') ? checks[k] : {};

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

function tappaState(t, c, evs) {
  let total = 1, done = c[t.id] ? 1 : 0;
  if (t.sub)    for (const s of t.sub) { total++; if (c[s.id]) done++; }
  if (t.choice) { total++; if (t.choice.some(o => c[o.id])) done++; }
  if (evs)      for (const e of evs) { total++; if (c[e.id]) done++; }
  return { total, done };
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

function streak() {
  const complete = k => !!(records[k] && records[k].completo);
  let d = today(), n = 0;
  if (!complete(dayKey(d))) d = shift(d, -1);  /* oggi non ancora chiuso non azzera la serie */
  while (complete(dayKey(d))) { n++; d = shift(d, -1); }
  return n;
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
   Spuntati tutti, sparisce. Il margine rosso invece resta: dice dov'era il conflitto. */
function paintSiren(c) {
  const any = rows.some(r => r.evs && r.evs.some(e => e.alarm && !c[e.id]));
  $('siren').hidden = !any;
  $('top').classList.toggle('has-siren', any);
}

function syncDerived() {
  const c = dayChecks(viewKey);
  let total = 0, done = 0, active = null;

  for (const r of rows) {
    const st = tappaState(r.t, c, r.evs);
    total += st.total;
    done  += st.done;
    const full = st.done === st.total;
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

  const n = streak();
  const s = $('streak');
  s.textContent = 'serie ' + n;
  s.classList.toggle('hot', n > 0);
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

$('csv').addEventListener('click', () => {
  const lines = ['data,fatte,totale,percentuale'];
  for (const k of Object.keys(records).sort()) {
    const r = records[k] || {};
    lines.push([k, r.fatte | 0, r.totale | 0, r.percentuale | 0].join(','));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gwork-storico.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
