'use strict';

/* =========================================================================
   G Work — vista in sola lettura su routine fissa + calendario G WORK.
   Nessuna dipendenza. Nessuna scrittura verso Google.
   ========================================================================= */

const CHECKS_KEY  = 'gwork-checks-v1';
const RECORDS_KEY = 'gwork-records-v1';
const DIARIO_KEY  = 'gwork-diario-v1';
const LEGACY_KEY  = 'hs-personal-routine-v1';

/* Il serbatoio delle task. La copia che comanda sta nel telefono; Salva la
   manda su GitHub in un commit solo, sul branch "task", via API con il token
   incollato in Impostazioni. Leggere funziona anche senza token: il repo e'
   pubblico. */
const TASKS_KEY    = 'gwork-tasks-v1';       /* { tasks, sha, dirty, known } */
const TOKEN_KEY    = 'gwork-token-v1';
const ARCHIVIO_KEY = 'gwork-taskfatte-v1';   /* task fatte uscite dalla finestra */
const MANCATE_KEY  = 'gwork-taskmancate-v1'; /* task lasciate indietro, giorno per giorno */
const TASK_BRANCH  = 'task';
const TASK_API     = 'https://api.github.com/repos/hsagency587/Routine/contents/tasks.json';
const RANKS        = ['A', 'B', 'C'];
/* I clienti di partenza. Vivono nel file con le task e si aggiungono e
   tolgono dall'app: questa lista e' solo il seme del primo avvio, per un file
   che ancora non li ha. L'id e' quello che resta scritto dentro le task: non
   si cambia mai. Le agenzie mie portano `agenzia: true`: il loro conteggio
   nel menu' e' in oro invece che in verde. */
const CLIENTI_SEME = [
  { id: 'hs-agency',    nome: 'HS-Agency', agenzia: true },
  { id: 'arbogreen',    nome: 'Arbogreen' },
  { id: 'bergamaschi',  nome: 'Bergamaschi' },
  { id: 'di-nucci',     nome: 'Di-Nucci' },
  { id: 'longkai',      nome: 'Longkai' },
  { id: 'manuela-lovo', nome: 'Manuela-Lovo' },
  { id: 'omnia',        nome: 'Omnia' }
];
/* Il calendario sta sul branch "dati" e non dentro il sito: si aggiorna con un
   commit, non ripubblicando Pages. La cache di raw dura cinque minuti, che e'
   la vera freschezza del file. */
const CAL_URL = 'https://raw.githubusercontent.com/hsagency587/Routine/dati/calendar.json';

/* Il battito non lo scrive nessuno: si chiede a GitHub quando il ponte ha
   girato l'ultima volta. E' una lettura pubblica di metadati — niente commit,
   niente deploy, nessuno dei tetti in cui siamo gia' finiti. Sessanta letture
   l'ora per indirizzo: l'app ne fa una all'apertura e una ogni due minuti
   mentre resta aperta, quindi trenta scarse. */
const RUNS_URL = 'https://api.github.com/repos/hsagency587/Routine/actions/workflows/'
               + 'calendar.yml/runs?per_page=5&exclude_pull_requests=true';
const BEAT_MS  = 2 * 60 * 1000;

/* Un'app rimasta ferma piu' di tanto — in secondo piano, congelata dal
   telefono — non si fida piu' di quello che ha in memoria e riparte da capo. */
const RIAVVIO_MS = 15 * 60 * 1000;

/* Una lettura che non risponde non deve restare appesa per sempre: senza
   risposta la riga in alto continuerebbe a invecchiare un battito vecchio. */
const scade = ms => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;

/* Le soglie del battito: fino a 10 minuti senza un giro riuscito e' normale,
   oltre 10 il ponte accumula ritardo, oltre 30 e' fermo davvero. */
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
  { id: 'gws1', t: '1ST G WORK SESSION', gws: 0 },
  { id: 'caffe-1',   t: 'CAFFÈ' },
  { id: 'gws2', t: '2ND G WORK SESSION', gws: 1 },
  { id: 'spuntino-formaggio', t: 'SPUNTINO FORMAGGIO' },
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

/* La finestra dei giorni si calcola in locale, non si legge dal file:
   se il ponte si ferma, oggi resta comunque spuntabile. */
function windowKeys() {
  const t = today();
  /* ieri, oggi e i sette giorni dopo: deve coincidere con calendar.yml */
  return [-1, 0, 1, 2, 3, 4, 5, 6, 7].map(n => dayKey(shift(t, n)));
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
let calAt  = 0;                   /* quando e' arrivata l'ultima lettura buona (ms) */
let calErr = false;               /* l'ultima lettura e' fallita: si tiene la copia buona */

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

/* Le task schedulate in un giorno, sessione per sessione, in ordine di rank. */
function dayTasks(k) {
  const out = [[], [], [], [], [], []];
  for (const x of tstore.tasks) {
    if (x.giorno !== k) continue;
    for (const s of sessioniDi(x)) if (out[s]) out[s].push(x);
  }
  for (const l of out) l.sort(byRank);
  return out;
}

/* Le figlie di una sessione: gli eventi nell'ordine del calendario, poi le
   task. Una task e' un evento senza orario e senza sirena: ha un id, si spunta,
   conta uno. Tutto il conteggio passa di qui, cosi' non puo' divergere. */
function childrenOf(k) {
  const g = groupEvents(k), t = dayTasks(k);
  const m = mancate[k] || [];
  /* le task lasciate indietro restano figlie del giorno, non fatte, con un id
     che nessuno spuntera' mai: cosi' il conteggio di ieri non cambia */
  return g.map((evs, i) => evs
    .concat(t[i].map(x => ({ id: x.id, task: x })))
    .concat(m.filter(x => x.gws === i).map((x, n) => ({ id: 'mancata:' + k + ':' + i + ':' + n, mancata: x }))));
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

/* La tappa vale uno, ogni figlia vale uno. Spuntare la tappa non salda le
   figlie: quelle rimaste indietro restano non fatte, e il 100% arriva solo
   quando e' fatto tutto. Cosi' la chiusura registra la percentuale vera. */
function tappaState(t, c, evs) {
  const ch = childState(t, c, evs);
  const total = ch.total + 1;
  return { total, done: ch.done + (c[t.id] ? 1 : 0) };
}

function tally(k) {
  const c = dayChecks(k);
  const g = childrenOf(k);
  let total = 0, done = 0;
  for (const t of ROUTINE) {
    const st = tappaState(t, c, t.gws != null ? g[t.gws] : null);
    total += st.total;
    done  += st.done;
  }
  return { total, done };
}

/* Il record si riscrive per i giorni della finestra, gli stessi in cui si
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
const hasTrace = k => !!((records[k] && records[k].fatte > 0) || diario[k]
                         || (archivio[k] && archivio[k].length)
                         || (mancate[k] && mancate[k].length));

function storicoDays(m) {
  const set = {};
  for (const k of Object.keys(records))  if (monthKey(k) === m && hasTrace(k)) set[k] = 1;
  for (const k of Object.keys(diario))   if (monthKey(k) === m) set[k] = 1;
  for (const k of Object.keys(archivio)) if (monthKey(k) === m) set[k] = 1;
  for (const k of Object.keys(mancate))  if (monthKey(k) === m) set[k] = 1;
  return Object.keys(set).sort();
}

function storicoMonths() {
  const set = {};
  for (const k of Object.keys(records))  if (hasTrace(k)) set[monthKey(k)] = 1;
  for (const k of Object.keys(diario))   set[monthKey(k)] = 1;
  for (const k of Object.keys(archivio)) set[monthKey(k)] = 1;
  for (const k of Object.keys(mancate))  set[monthKey(k)] = 1;
  return Object.keys(set).sort().reverse();   /* il mese in corso per primo */
}

/* Le task fatte in un giorno: quelle gia' in archivio piu' quelle ancora nel
   file, se il giorno e' in finestra e la spunta c'e'. */
function doneTasks(k) {
  const c = dayChecks(k);
  const vive = tstore.tasks.filter(x => x.giorno === k && c[x.id])
                           .map(x => ({ nome: x.nome, rank: x.rank, gws: x.gws }));
  return (archivio[k] || []).concat(vive).sort(byRank);
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

    const fatte = doneTasks(k);
    if (fatte.length) {
      out.push('', 'Task fatte: ' + fatte.map(x => '[' + x.rank + '] ' + x.nome).join(' · '));
    }
    const lasciate = (mancate[k] || []).slice().sort(byRank);
    if (lasciate.length) {
      out.push('', 'Task lasciate indietro: ' + lasciate.map(x => '[' + x.rank + '] ' + x.nome).join(' · '));
    }
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

  /* i tre puntini: all'evento si puo' dare un cliente, e basta */
  if (isEditable(viewKey)) {
    const m = el('button', 'more', '⋯');
    m.type = 'button';
    m.dataset.evento = e.id;
    m.setAttribute('aria-label', 'Assegna un cliente');
    bar.appendChild(m);
  }

  li.appendChild(bar);

  if (e.desc) {
    const p = el('p', 'desc', e.desc);   /* textContent: il testo di Google non e' HTML */
    p.hidden = true;
    li.appendChild(p);
  }
  return li;
}

/* Una task dentro la sessione: come un evento, con la lettera del rank al
   posto dell'orario e i tre puntini che aprono l'editor. Tutta la riga spunta. */
function taskNode(x, on) {
  const li = el('li', 'ev task');
  const bar = el('div', 'evrow');

  const l = el('label', 'row' + (on ? ' on' : ''));
  const i = el('input');
  i.type = 'checkbox';
  i.checked = on;
  i.dataset.key = x.id;
  l.appendChild(i);
  l.appendChild(el('span', 'rank r' + x.rank, x.rank));
  l.appendChild(el('span', 'ttl', x.nome));
  bar.appendChild(l);

  if (x.desc) {
    const b = el('button', 'toggle', '▼');
    b.type = 'button';
    b.dataset.role = 'desc';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'Mostra la descrizione');
    bar.appendChild(b);
  }

  const m = el('button', 'more', '⋯');
  m.type = 'button';
  m.dataset.task = x.id;
  m.setAttribute('aria-label', 'Modifica la task');
  bar.appendChild(m);

  li.appendChild(bar);

  if (x.desc) {
    const p = el('p', 'desc', x.desc);
    p.hidden = true;
    li.appendChild(p);
  }
  return li;
}

/* Una task lasciata indietro: a mezzanotte e' tornata nel serbatoio, ma il
   giorno la ricorda com'era, non fatta. Si guarda e basta: la casella e'
   spenta per sempre, e lockRow la lascia stare. */
function ghostNode(x, id) {
  const li = el('li', 'ev task mancata');
  const bar = el('div', 'evrow');
  const l = el('label', 'row');
  const i = el('input');
  i.type = 'checkbox';
  i.disabled = true;
  i.dataset.key = id;
  i.dataset.mancata = '1';
  l.appendChild(i);
  l.appendChild(el('span', 'rank r' + x.rank, x.rank));
  l.appendChild(el('span', 'ttl', x.nome));
  l.appendChild(el('span', 'twhen', 'nel serbatoio'));
  bar.appendChild(l);
  li.appendChild(bar);
  return li;
}

let renderedDay = null;           /* il giorno "oggi" dell'ultimo disegno */

function render() {
  /* La mezzanotte si scopre qui, da chiunque ridisegni: se si stava guardando
     oggi si passa al nuovo oggi. E' sicuro anche sotto un dialogo aperto: il
     pop-up di chiusura ricorda il suo giorno, l'editor e la pesca guardano
     l'oggi vero al momento della conferma. */
  const t = dayKey(today());
  if (renderedDay && t !== renderedDay && viewKey === renderedDay) {
    view = today();
    viewKey = t;
    riaperta = null;
  }
  renderedDay = t;
  tidyTasks();                    /* mezzanotte: chi torna nel serbatoio, chi va in archivio */
  const c = dayChecks(viewKey);
  const g = childrenOf(viewKey);
  const covered = isCovered(viewKey);
  const list = $('list');

  list.textContent = '';
  rows = [];

  for (const t of ROUTINE) {
    const evs = t.gws != null ? g[t.gws] : null;
    const li = el('li', 'tappa');

    if (t.gws != null) {
      /* il + sta fuori dalla label: toccarlo non deve spuntare la sessione */
      const head = el('div', 'head');
      head.appendChild(checkRow(t.id, t.t, 'row-t', !!c[t.id]));
      if (canSchedule(viewKey)) {
        const b = el('button', 'plus', '+');
        b.type = 'button';
        b.dataset.gws = t.gws;
        b.setAttribute('aria-label', 'Aggiungi una task alla sessione');
        head.appendChild(b);
      }
      li.appendChild(head);
    } else {
      li.appendChild(checkRow(t.id, t.t, 'row-t', !!c[t.id]));
    }

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
      /* prima del primo caricamento non si annuncia ancora niente; le task
         invece si vedono comunque, il calendario non c'entra */
      if (!covered && loaded) li.appendChild(el('p', 'nocov', 'Eventi non coperti per questa data'));
      if (evs.length) {
        const ul = el('ul', 'evs');
        for (const e of evs) {
          ul.appendChild(e.mancata ? ghostNode(e.mancata, e.id)
                       : e.task    ? taskNode(e.task, !!c[e.id])
                       :             eventNode(e, !!c[e.id]));
        }
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
  const fra = Math.round((view.getTime() - t0.getTime()) / 86400000);
  rel.textContent = readOnly                     ? 'sola lettura'
            : viewKey === dayKey(t0)             ? 'oggi'
            : viewKey === dayKey(shift(t0, -1))  ? 'ieri'
            : viewKey === dayKey(shift(t0,  1))  ? 'domani'
            : viewKey === dayKey(shift(t0,  2))  ? 'dopodomani'
            :                                      'fra ' + fra + ' giorni';
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

/* La tappa che l'utente ha appena riaperto a mano: non si richiude nello
   stesso tocco, altrimenti una figlia spuntata per sbaglio non si potrebbe
   piu' correggere. Al tocco successivo su qualunque casella torna tutto
   normale. */
let riaperta = null;

/* Spuntate tutte le figlie, la tappa che le conteneva si chiude da sola. */
function autoClose() {
  if (!isEditable(viewKey)) return;
  /* con il calendario non ancora arrivato le sessioni hanno solo le task:
     chiuderle adesso congelerebbe gli eventi in arrivo come gia' fatti */
  const senzaCal = !isCovered(viewKey);
  const c = dayChecks(viewKey);
  for (const r of rows) {
    if (r.t.gws != null && senzaCal) continue;
    if (r.t.id === riaperta) continue;
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
    if (i.dataset.key !== r.t.id && !i.dataset.mancata) i.disabled = closed || ro;
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

/* Solo la durata, senza "fa": la frase intorno cambia da un caso all'altro. */
function durata(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h';
  return Math.floor(h / 24) + ' g';
}

/* Il battito: l'ultimo giro riuscito, l'esito dell'ultimo giro finito e l'ora
   dell'ultimo giro partito, qualunque fine abbia fatto. Bastano questi tre per
   distinguere "il ponte e' vivo" da "gira ma fallisce" da "non parte piu'". */
let beat   = null;
let beatOk = false;               /* l'ultima interrogazione e' riuscita */
let beatAuth  = true;             /* col token si usa la quota personale (5000/ora) */
let beatQuota = 0;                /* quota anonima esaurita: fino a quando (ms) */
let beatSkew  = 0;                /* ora di GitHub meno ora del telefono (ms): il giudice e' GitHub */

/* L'ora vera la dice il server del sito: un telefono con l'orologio sbagliato
   non deve vedere in ritardo un ponte sano. L'API di GitHub non espone la sua
   Date al browser, la stessa origine si': un file piccolo, senza cache. */
async function leggiOra() {
  try {
    const r = await fetch('manifest.webmanifest', { cache: 'no-store', signal: scade(15000) });
    const d = new Date(r.headers.get('date') || '');
    if (!isNaN(d.getTime())) beatSkew = d.getTime() - Date.now();
  } catch (e) { /* si resta con l'ora del telefono */ }
}

async function loadBeat() {
  await leggiOra();
  if (beatQuota && Date.now() < beatQuota) { paintFresh(); return; }
  beatQuota = 0;
  try {
    let r = await fetch(RUNS_URL, { cache: 'no-store', headers: beatAuth && token ? ghHeaders() : {}, signal: scade(15000) });
    /* un fine-grained token senza il permesso Actions puo' rispondere 403
       anche su un repo pubblico: si riprova anonimi e si resta anonimi */
    if ((r.status === 401 || r.status === 403) && beatAuth && token) {
      beatAuth = false;
      r = await fetch(RUNS_URL, { cache: 'no-store', signal: scade(15000) });
    }
    /* la quota anonima e' per indirizzo, e sul 5G l'indirizzo e' condiviso:
       finita, si aspetta l'ora del reset invece di gridare al lupo */
    if ((r.status === 403 || r.status === 429) && r.headers.get('x-ratelimit-remaining') === '0') {
      const reset = (+r.headers.get('x-ratelimit-reset') || 0) * 1000;
      beatQuota = reset > Date.now() ? reset : Date.now() + 5 * 60000;
      throw new Error('quota');
    }
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const runs = Array.isArray(j.workflow_runs) ? j.workflow_runs : [];
    const ms = s => { const d = new Date(s); return isNaN(d.getTime()) ? null : d.getTime(); };

    const finiti = runs.filter(x => x.status === 'completed');
    const buono  = finiti.find(x => x.conclusion === 'success');

    beat = {
      ok:      buono       ? ms(buono.updated_at)   : null,
      partito: runs.length ? ms(runs[0].created_at) : null
    };
    beatOk = true;
  } catch (e) {
    beatOk = false;               /* non lo so: e' diverso da "e' rotto" */
  }
  paintFresh();
}

function paintFresh() {
  const f = $('fresh');
  f.classList.remove('stale', 'down', 'muto');
  const now = Date.now() + beatSkew;
  const eta = cal && calAt ? ' · eventi di ' + durata(Math.max(0, Date.now() - calAt)) + ' fa' : '';

  /* Senza rete non e' rotto niente: si aspetta, e si dice quanto sono vecchi
     gli eventi che si stanno guardando. */
  if (navigator.onLine === false) {
    f.classList.add('muto');
    f.textContent = 'Sei offline' + eta;
    return;
  }

  /* Prima i dati: se il calendario non e' mai arrivato, il resto e' accademia. */
  if (loaded && !cal) {
    f.classList.add('down');
    f.textContent = 'Calendario non raggiungibile';
    return;
  }

  /* la rete c'e' ma GitHub non risponde: si tiene l'ultima copia buona */
  if (loaded && calErr) {
    f.classList.add('stale');
    f.textContent = 'GitHub non risponde' + eta;
    return;
  }

  if (beatQuota && Date.now() < beatQuota) {
    f.classList.add('muto');
    f.textContent = 'Quota API esaurita fino alle ' + fmtTime.format(new Date(beatQuota));
    return;
  }

  if (!beatOk || !beat) {
    f.classList.add('muto');
    f.textContent = 'Battito non verificabile';
    return;
  }

  const ok  = beat.ok;

  if (ok && now - ok <= LATE_MS) {
    f.textContent = 'Aggiornato alle ' + fmtTime.format(new Date(ok));
    return;
  }

  /* Da qui in giu' qualcosa non va, e la differenza dice cosa: se i giri
     partono ancora il guasto e' dentro — iCal irraggiungibile, secret
     revocato; se non parte piu' niente, e' la sveglia esterna che si e'
     fermata. */
  const sveglia = beat.partito && now - beat.partito <= LATE_MS;
  f.classList.add(!ok || now - ok > DOWN_MS ? 'down' : 'stale');

  if (!ok) {
    f.textContent = 'Nessun giro riuscito fra gli ultimi controllati';
  } else if (sveglia) {
    f.textContent = 'I giri falliscono — ultimo riuscito alle '
      + fmtTime.format(new Date(ok)) + ' (' + durata(now - ok) + ' fa)';
  } else {
    f.textContent = 'FERMO — nessun giro da ' + durata(now - (beat.partito || ok));
  }
}

/* ---------------------------------------------------------- interazioni --- */

$('list').addEventListener('change', ev => {
  const i = ev.target;
  if (!i.dataset || !i.dataset.key) return;
  const key = i.dataset.key;

  /* la giornata finisce qui: la spunta si scrive solo dopo voto e commento,
     cosi' se l'app muore col pop-up aperto non resta una chiusura senza voto */
  if (key === CLOSE_ID && i.checked) {
    i.closest('.row').classList.add('on');
    openChiusura();
    return;
  }

  setCheck(viewKey, key, i.checked);

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

  /* la stessa task in piu' sessioni: e' una spunta sola, le altre righe seguono */
  $('list').querySelectorAll('input[data-key="' + key + '"]').forEach(o => {
    if (o === i) return;
    o.checked = i.checked;
    o.closest('.row').classList.toggle('on', i.checked);
  });

  /* una tappa riaperta a mano non si richiude nello stesso tocco */
  riaperta = (!i.checked && ROUTINE.some(t => t.id === key)) ? key : null;

  syncDerived();
});

$('list').addEventListener('click', ev => {
  const more = ev.target.closest('button.more[data-task]');
  if (more) { openEditor(more.dataset.task); return; }

  const evm = ev.target.closest('button.more[data-evento]');
  if (evm) { openEvento(evm.dataset.evento); return; }

  const plus = ev.target.closest('button.plus[data-gws]');
  if (plus) { openPesca(+plus.dataset.gws); return; }

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
  riaperta = null;
  render();
}

/* E' scattata la mezzanotte con l'app aperta, o ripresa dallo sfondo? Basta
   ridisegnare: e' render() a spostare la vista sul nuovo oggi e ad applicare
   la regola di mezzanotte. Un confronto di stringhe, nessuna rete. */
function checkDay() {
  if (dayKey(today()) !== renderedDay) render();
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

let chiusuraKey = null;           /* il giorno per cui il pop-up e' aperto */

function openChiusura() {
  chiusuraKey = viewKey;
  const d = diario[viewKey] || {};
  const v = typeof d.voto === 'number' ? d.voto : 5.5;   /* il centro esatto della scala */
  $('voto').value = v;
  paintVoto(v);
  $('commento').value = d.commento || '';
  $('tuttoFatto').checked = false;   /* si sceglie ogni volta, non si ricorda */
  $('chiusuraDay').textContent = fmtLong.format(view);
  dlg.returnValue = '';
  dlg.showModal();
}

/* Segna fatto tutto quello che c'e' nel giorno: tappe, sottotappe, la prima
   delle alternative, eventi, task e anche le task lasciate indietro. Il
   registro scrive 100%. Si fa solo su richiesta, dal pop-up di chiusura. */
function completaGiornata(k) {
  const g = childrenOf(k);
  const c = dayChecks(k);
  for (const t of ROUTINE) {
    setCheck(k, t.id, true);
    if (t.sub) for (const s of t.sub) setCheck(k, s.id, true);
    if (t.choice && !t.choice.some(o => c[o.id])) setCheck(k, t.choice[0].id, true);
    if (t.gws != null) for (const e of g[t.gws]) setCheck(k, e.id, true);
  }
}

$('voto').addEventListener('input', e => paintVoto(+e.target.value));

/* Annullare — bottone o tasto Esc — vuol dire che la giornata non e' chiusa:
   la spunta torna indietro. Voto e commento gia' scritti restano dov'erano. */
/* La casella sullo schermo segue lo stato scritto, ma solo se la lista mostra
   ancora il giorno del pop-up: un ridisegno nel frattempo l'ha ricreata dallo
   storage, spenta, e va riaccesa. */
function paintClose(on) {
  if (viewKey !== chiusuraKey) return;
  const box = $('list').querySelector('input[data-key="' + CLOSE_ID + '"]');
  if (!box) return;
  box.checked = on;
  box.closest('.row').classList.toggle('on', on);
}

function annullaChiusura() {
  setCheck(chiusuraKey || viewKey, CLOSE_ID, false);
  paintClose(false);
  syncDerived();
}

/* Confermare scrive la spunta di chiusura insieme a voto e commento, sul
   giorno per cui il pop-up era stato aperto: a cavallo della mezzanotte non
   e' detto che sia ancora quello mostrato. */
function confermaChiusura() {
  const k = chiusuraKey || viewKey;
  const tutto = $('tuttoFatto').checked;
  if (tutto) completaGiornata(k);
  setCheck(k, CLOSE_ID, true);
  setDiario(k, +$('voto').value, $('commento').value);
  paintClose(true);
  riaperta = null;
  /* con tutto segnato cambiano molte righe: si ridisegna, se e' il giorno mostrato */
  if (tutto && k === viewKey) render(); else syncDerived();
}

$('chiusuraForm').addEventListener('submit', confermaChiusura);

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
  if (dlg.returnValue === 'ok') confermaChiusura();
  else annullaChiusura();
});

/* ---------------------------------------------------------------- task --- */

/* Il serbatoio. La copia che comanda e' quella nel telefono: ogni tocco e'
   istantaneo e resta qui anche se non salvi. Le spunte sulle task stanno con
   le altre spunte, in locale: nel file una task e' solo cosa, quanto conta e
   quando. */
let tstore = readStore(TASKS_KEY);
if (!Array.isArray(tstore.tasks)) tstore = { tasks: [], sha: null, dirty: false, known: [] };
if (!Array.isArray(tstore.known)) tstore.known = [];
/* i clienti stanno nel file con le task: senza, si parte dal seme */
if (!Array.isArray(tstore.clienti)) tstore.clienti = validClienti(CLIENTI_SEME);
if (!Array.isArray(tstore.workouts)) tstore.workouts = [];
if (!tstore.cancellate || typeof tstore.cancellate !== 'object' || Array.isArray(tstore.cancellate)) tstore.cancellate = {};

let archivio = readStore(ARCHIVIO_KEY);
let mancate  = readStore(MANCATE_KEY);

let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* niente token */ }

const newId    = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* Ogni voce che si tocca prende l'ora: e' quello che decide chi vince quando
   due copie si uniscono. Ogni voce che si toglie lascia la data. */
const segna    = x => { x.mod = new Date().toISOString(); return x; };
const cancella = id => { tstore.cancellate[id] = new Date().toISOString(); };
const findTask = id => tstore.tasks.find(x => x.id === id) || null;
/* L'ordine dei clienti dovunque si elenchino: le agenzie prima, poi i
   clienti, per nome; quelli nascosti con l'occhio in fondo. */
const byCliente = (a, b) => (a.nascosto ? 1 : 0) - (b.nascosto ? 1 : 0)
  || (b.agenzia ? 1 : 0) - (a.agenzia ? 1 : 0)
  || a.nome.localeCompare(b.nome);
const clientiOrdinati = () => tstore.clienti.slice().sort(byCliente);
const findCliente = id => tstore.clienti.find(c => c.id === id) || null;
/* Le sessioni in cui sta una task: la prima e' `gws`, le altre stanno in
   `altre`. Una task puo' stare in piu' sessioni dello stesso giorno: e' una
   sola, si spunta una volta sola, ma compare e conta in ognuna. */
const sessioniDi = x => x.gws == null ? [] : [x.gws].concat(Array.isArray(x.altre) ? x.altre : []);
const byRank   = (a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.nome.localeCompare(b.nome);
/* Nel menu' gli eventi del calendario vengono prima di tutto, in ordine di
   giorno e ora; poi le task per rank. */
const byMenu   = (a, b) => (a.evento ? 0 : 1) - (b.evento ? 0 : 1)
  || (a.evento && b.evento ? (a.giorno + a.ora).localeCompare(b.giorno + b.ora) : 0)
  || byRank(a, b);

/* Si schedula su oggi, domani e dopodomani. Ieri no. */
const canSchedule = k => isEditable(k) && k >= dayKey(today());

/* Un file arrivato da fuori si prende con le pinze: solo campi noti, nella
   forma attesa. Quello che non torna si ripulisce, non si scarta. */
function validTask(x, lista) {
  lista = lista || tstore.clienti;
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || typeof x.nome !== 'string') return null;
  /* Un evento del calendario a cui si e' dato un cliente: sta nel file come
     una task di rank A, col giorno e l'orario di Google. Senza cliente o senza
     giorno non ha senso, e non c'e'. */
  const evento = typeof x.evento === 'string' && x.evento ? x.evento : null;
  const cliente = lista.some(c => c.id === x.cliente) ? x.cliente : null;
  const gws = Number.isInteger(x.gws) && x.gws >= 0 && x.gws <= 5 ? x.gws : null;
  const giorno = typeof x.giorno === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.giorno)
                 && (gws != null || evento) ? x.giorno : null;
  if (evento && (!giorno || !cliente)) return null;
  const out = {
    id:     x.id,
    nome:   x.nome,
    desc:   typeof x.desc === 'string' ? x.desc : '',
    rank:   evento ? 'A' : RANKS.indexOf(x.rank) >= 0 ? x.rank : 'B',
    cliente: cliente,
    giorno: giorno,
    gws:    giorno && !evento ? gws : null,
    creata: typeof x.creata === 'string' ? x.creata : ''
  };
  if (typeof x.mod === 'string') out.mod = x.mod;
  if (evento) { out.evento = evento; out.ora = typeof x.ora === 'string' ? x.ora : ''; }
  /* le sessioni in piu': numeri validi, senza doppioni, senza la prima */
  if (out.gws != null && Array.isArray(x.altre)) {
    const altre = [...new Set(x.altre.filter(n => Number.isInteger(n) && n >= 0 && n <= 5 && n !== out.gws))]
      .sort((a, b) => a - b);
    if (altre.length) out.altre = altre;
  }
  return out;
}

/* Un cliente arrivato da fuori: id e nome, e i due segni agenzia e nascosto. */
function validCliente(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id
      || typeof c.nome !== 'string' || !c.nome.trim()) return null;
  const out = { id: c.id, nome: c.nome.trim() };
  if (c.agenzia)  out.agenzia  = true;
  if (c.nascosto) out.nascosto = true;
  if (typeof c.mod === 'string') out.mod = c.mod;
  return out;
}

/* Senza doppioni di id: il primo vince. */
function validClienti(list) {
  const seen = {}, out = [];
  for (const c of (Array.isArray(list) ? list : []).map(validCliente)) {
    if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); }
  }
  return out;
}

/* Un esercizio arrivato da fuori. Senza id ne prende uno dal posto che
   occupa, sempre lo stesso: cosi' il confronto fra file resta fermo. */
function validEsercizio(e, i) {
  if (!e || typeof e !== 'object' || typeof e.nome !== 'string' || !e.nome.trim()) return null;
  return {
    id:     typeof e.id === 'string' && e.id ? e.id : 'e' + i,
    nome:   e.nome.trim(),
    setrep: typeof e.setrep === 'string' ? e.setrep : '',
    rec:    typeof e.rec === 'string' ? e.rec : '',
    desc:   typeof e.desc === 'string' ? e.desc : ''
  };
}

/* Un workout: nome, i giorni della settimana (0 = lunedi'), gli esercizi
   nell'ordine in cui si fanno. Senza giorni sta nella programmazione e
   basta. */
function validWorkout(w) {
  if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id
      || typeof w.nome !== 'string' || !w.nome.trim()) return null;
  const giorni = [...new Set((Array.isArray(w.giorni) ? w.giorni : [])
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  const esercizi = (Array.isArray(w.esercizi) ? w.esercizi : []).map(validEsercizio).filter(Boolean);
  const out = { id: w.id, nome: w.nome.trim(), giorni: giorni, esercizi: esercizi };
  if (typeof w.mod === 'string') out.mod = w.mod;
  return out;
}

/* Il file com'e' scritto: task, clienti e workout. Un file arrivato da fuori
   si normalizza qui, e quello locale pure, cosi' il confronto e' alla pari.
   Un file senza clienti e' di prima che ci fossero: vale il seme. */
/* Le cancellazioni: id -> quando. Servono a unire due copie senza far
   risorgere quello che una delle due ha tolto. Dopo sessanta giorni non
   servono piu' e cadono. */
function validCancellate(c) {
  const out = {};
  const limite = new Date(Date.now() - 60 * 86400000).toISOString();
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    for (const id in c) if (typeof c[id] === 'string' && c[id] > limite) out[id] = c[id];
  }
  return out;
}

function normFile(data) {
  const clienti = data && Array.isArray(data.clienti) ? validClienti(data.clienti) : validClienti(CLIENTI_SEME);
  const tasks = data && Array.isArray(data.tasks) ? data.tasks.map(x => validTask(x, clienti)).filter(Boolean) : [];
  const workouts = data && Array.isArray(data.workouts) ? data.workouts.map(validWorkout).filter(Boolean) : [];
  return { tasks: tasks, clienti: clienti, workouts: workouts, cancellate: validCancellate(data && data.cancellate) };
}
const localFile = () => ({ tasks: tstore.tasks, clienti: tstore.clienti, workouts: tstore.workouts, cancellate: tstore.cancellate });
const sameFile  = (a, b) => JSON.stringify(normFile(a)) === JSON.stringify(normFile(b));

/* Un file letto da fuori prende il posto di quello locale. */
function applicaFile(f) {
  tstore.tasks      = f.tasks;
  tstore.clienti    = f.clienti;
  tstore.workouts   = f.workouts;
  tstore.cancellate = f.cancellate;
}

/* Due copie che non si conoscono — il telefono e l'online — si uniscono
   senza perdere niente: voce per voce vince la piu' recente per `mod`, una
   voce che sta da una parte sola resta, a meno che l'altra parte non l'abbia
   cancellata dopo. E' la regola che impedisce a una copia rimasta indietro
   di cancellare il lavoro fatto altrove. */
function mergeFile(a, b) {
  const canc = Object.assign({}, b.cancellate);
  for (const id in a.cancellate) if (!canc[id] || a.cancellate[id] > canc[id]) canc[id] = a.cancellate[id];
  const mod = x => x.mod || '';
  const viva = x => !(canc[x.id] && canc[x.id] > mod(x));
  const unisci = (la, lb) => {
    const out = [], visti = {}, mb = {};
    for (const y of lb) mb[y.id] = y;
    for (const x of la) {
      const y = mb[x.id];
      const v = y && mod(y) > mod(x) ? y : x;
      visti[x.id] = 1;
      if (viva(v)) out.push(v);
    }
    for (const y of lb) if (!visti[y.id] && viva(y)) out.push(y);
    return out;
  };
  return { tasks: unisci(a.tasks, b.tasks), clienti: unisci(a.clienti, b.clienti),
           workouts: unisci(a.workouts, b.workouts), cancellate: canc };
}

function saveLocal() { writeStore(TASKS_KEY, tstore); }

/* Ogni modifica passa di qui: si segna, e compare Salva. */
function touch() {
  tstore.dirty = true;
  saveLocal();
  paintSalva();
  paintSync();
}

/* A mezzanotte le task lasciate indietro tornano nel serbatoio: il giorno
   passato resta contato com'era, non fatta. Quelle fatte restano nel loro
   giorno finche' e' in finestra, poi passano in archivio, da dove le legge lo
   storico del mese. */
function tidyTasks() {
  const t0 = dayKey(today());
  const win = windowKeys();
  let changed = false;

  tstore.tasks = tstore.tasks.filter(x => {
    /* un evento del calendario vive quanto la finestra dei giorni */
    if (x.evento) {
      if (win.indexOf(x.giorno) >= 0) return true;
      cancella(x.id); changed = true;
      return false;
    }
    if (!x.giorno) return true;
    if (dayChecks(x.giorno)[x.id]) {
      if (win.indexOf(x.giorno) >= 0) return true;
      if (!archivio[x.giorno]) archivio[x.giorno] = [];
      archivio[x.giorno].push({ nome: x.nome, rank: x.rank, gws: x.gws });
      cancella(x.id); changed = true;
      return false;
    }
    if (x.giorno < t0) {
      /* il giorno la ricorda com'era, non fatta: il conteggio di ieri non cambia */
      if (!mancate[x.giorno]) mancate[x.giorno] = [];
      mancate[x.giorno].push({ nome: x.nome, rank: x.rank, gws: x.gws });
      x.giorno = null; x.gws = null; delete x.altre; segna(x); changed = true;
    }
    return true;
  });

  if (changed) {
    writeStore(ARCHIVIO_KEY, archivio);
    writeStore(MANCATE_KEY, mancate);
    touch();
  }
}

/* Una sessione gia' chiusa che riceve una task non e' piu' finita: si riapre,
   cosi' la task si puo' spuntare e non nasce gia' contata come fatta. */
function riapriSessione(x) {
  if (!x.giorno || x.gws == null) return;
  for (const s of sessioniDi(x)) {
    const t = ROUTINE.find(r => r.gws === s);
    if (t && dayChecks(x.giorno)[t.id]) setCheck(x.giorno, t.id, false);
  }
}

/* ------------------------------------------------------------- menu' ---- */

let tutte = false;               /* l'interruttore "mostra anche le schedulate" */

/* Il filtro "per cliente". Di base spento: il menu' e' A, B, C e basta.
   Acceso, le task dei clienti scendono nei gruppi per cliente e sopra restano
   solo quelle senza cliente, sempre per rank. Si ricorda. */
const PERCLIENTE_KEY = 'gwork-percliente-v1';
let perCliente = (() => {
  try { return localStorage.getItem(PERCLIENTE_KEY) === '1'; } catch (e) { return false; }
})();

/* Il filtro "Calendar": acceso, gli eventi del calendario a cui si e' dato un
   cliente entrano nel menu', con giorno e ora, primi fra i rank A. Spento,
   nel menu' non esistono: stanno gia' nella giornata. Si ricorda. */
const CALENDAR_KEY = 'gwork-calendar-v1';
let calendar = (() => {
  try { return localStorage.getItem(CALENDAR_KEY) === '1'; } catch (e) { return false; }
})();

function openMenu(on) {
  $('drawer').classList.toggle('open', on);
  $('velo').hidden = !on;
  document.body.classList.toggle('menu-open', on);
  $('menuBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  if (on) paintDrawer();
}

/* Sul telefono le tendine si aprono e si chiudono con uno swipe, da qualunque
   punto della pagina: verso sinistra apre il Menu' Task (a destra) o chiude
   il Workout (a sinistra), verso destra il contrario. Il gesto deve essere
   deciso: almeno 60px in orizzontale e piu' orizzontale che verticale, cosi'
   lo scorrimento delle liste non lo scatena. Con un dialogo aperto niente:
   il dito sta lavorando li' dentro. */
let swipe = null;
document.addEventListener('touchstart', e => {
  swipe = e.touches.length === 1 && !document.querySelector('dialog[open]')
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const menu = $('drawer').classList.contains('open');
  const wk   = $('wdrawer').classList.contains('open');
  if (dx < 0) { if (wk) openWorkout(false); else if (!menu) openMenu(true); }
  else        { if (menu) openMenu(false); else if (!wk) openWorkout(true); }
}, { passive: true });

function whenText(x) {
  const t0 = today();
  const lab = x.giorno === dayKey(t0)            ? 'oggi'
            : x.giorno === dayKey(shift(t0, 1))  ? 'domani'
            : x.giorno === dayKey(shift(t0, 2))  ? 'dopodomani'
            : x.giorno === dayKey(shift(t0, -1)) ? 'ieri'
            : fmtDate.format(new Date(x.giorno + 'T00:00:00'));
  return lab + ' · ' + (x.evento ? x.ora : 'GWS ' + sessioniDi(x).map(n => n + 1).join('+'));
}

/* Una riga del menu' (o dell'elenco da cui pescare, senza i tre puntini). */
function trowNode(x, pick) {
  const li = el('li', 'trow' + (x.evento ? ' evento' : x.giorno ? ' sched' : ''));
  li.dataset.task = x.id;
  li.appendChild(el('span', 'rank r' + x.rank, x.rank));
  li.appendChild(el('span', 'tname', x.nome));
  if (x.giorno) li.appendChild(el('span', 'twhen', whenText(x)));
  if (!pick) {
    const b = el('button', 'more', '⋯');
    b.type = 'button';
    b.dataset.task = x.id;
    b.setAttribute('aria-label', 'Modifica la task');
    li.appendChild(b);
  }
  return li;
}

/* I clienti con qualcosa dentro, nell'ordine di sempre: uno vuoto non compare,
   uno nascosto con l'occhio nemmeno. La mappa di chi si segue sta nell'editor
   dei clienti. Le task senza cliente non stanno qui: restano sopra, per rank. */
function gruppiCliente(list) {
  return clientiOrdinati().filter(c => !c.nascosto)
    .map(c => ({ g: c, tasks: list.filter(x => x.cliente === c.id).sort(byMenu) }))
    .filter(o => o.tasks.length);
}

/* I clienti chiusi nel menu': un tocco sul nome nasconde le sue task, un
   altro le rimostra. Si ricorda. */
const CHIUSI_KEY = 'gwork-clientichiusi-v1';
let chiusi = readStore(CHIUSI_KEY);

/* Il menu': tutte le task davanti, e i due filtri le sfoltiscono. Di base A,
   B, C: le task del serbatoio, per rank. Con "per cliente" le task dei clienti
   scendono in un elenco piatto, un gruppo per cliente col suo conteggio, e
   sopra restano per rank solo quelle senza cliente. Con "schedulate" entrano
   pure quelle sui giorni, col bordino giallo. Il rank resta la pastiglia sulla
   riga e l'ordine dentro il gruppo. */
function paintDrawer() {
  const box = $('drawerList');
  box.textContent = '';
  /* le task del serbatoio, o anche le schedulate; gli eventi del calendario
     con un cliente entrano solo col filtro Calendar, e hanno sempre un cliente,
     quindi nella vista per cliente stanno sotto il loro */
  const list = tstore.tasks.filter(x => !x.evento && (tutte || !x.giorno));
  const evs  = calendar ? tstore.tasks.filter(x => x.evento) : [];
  const sopra = perCliente ? list.filter(x => !x.cliente) : list.concat(evs);

  for (const r of RANKS) {
    const blocco = sopra.filter(x => x.rank === r).sort(byMenu);
    if (!blocco.length) continue;
    box.appendChild(el('p', 'grp', 'RANK ' + r));
    const ul = el('ul', 'trows');
    for (const x of blocco) ul.appendChild(trowNode(x, false));
    box.appendChild(ul);
  }

  const gruppi = perCliente ? gruppiCliente(list.concat(evs)) : [];
  if (!sopra.length && !gruppi.length) {
    box.appendChild(el('p', 'vuoto', tutte ? 'Nessuna task' : 'Serbatoio vuoto'));
  }

  for (const o of gruppi) {
    /* la testata e' un bottone: chiude e riapre le task del cliente */
    const chiuso = !!chiusi[o.g.id];
    const h = el('button', 'grp grpcli');
    h.type = 'button';
    h.dataset.cliente = o.g.id;
    h.setAttribute('aria-expanded', chiuso ? 'false' : 'true');
    h.appendChild(el('span', 'grpnome', o.g.nome));
    h.appendChild(el('span', 'grpnum' + (o.g.agenzia ? ' oro' : ''), String(o.tasks.length)));
    h.appendChild(el('span', 'chip-frec'));
    box.appendChild(h);
    const ul = el('ul', 'trows');
    ul.hidden = chiuso;
    for (const x of o.tasks) ul.appendChild(trowNode(x, false));
    box.appendChild(ul);
  }
  paintSync();
}

$('menuBtn').addEventListener('click', () => openMenu(true));
$('chiudiMenu').addEventListener('click', () => openMenu(false));
$('velo').addEventListener('click', () => { openMenu(false); openWorkout(false); });
/* i due box dei filtri: un tocco accende, un altro spegne */
$('tutte').addEventListener('click', () => {
  tutte = !tutte;
  $('tutte').setAttribute('aria-pressed', tutte ? 'true' : 'false');
  paintDrawer();
});
$('perCliente').setAttribute('aria-pressed', perCliente ? 'true' : 'false');
$('perCliente').addEventListener('click', () => {
  perCliente = !perCliente;
  $('perCliente').setAttribute('aria-pressed', perCliente ? 'true' : 'false');
  try { localStorage.setItem(PERCLIENTE_KEY, perCliente ? '1' : '0'); } catch (e) {}
  paintDrawer();
});
$('calendar').setAttribute('aria-pressed', calendar ? 'true' : 'false');
$('calendar').addEventListener('click', () => {
  calendar = !calendar;
  $('calendar').setAttribute('aria-pressed', calendar ? 'true' : 'false');
  try { localStorage.setItem(CALENDAR_KEY, calendar ? '1' : '0'); } catch (e) {}
  paintDrawer();
});
$('nuova').addEventListener('click', () => openEditor(null));
$('impostazioniBtn').addEventListener('click', openImpostazioni);

/* tutta la riga apre l'editor: i tre puntini sono il segnale, non l'unico posto */
$('drawerList').addEventListener('click', ev => {
  const h = ev.target.closest('.grpcli[data-cliente]');
  if (h) {
    const id = h.dataset.cliente;
    if (chiusi[id]) delete chiusi[id]; else chiusi[id] = 1;
    writeStore(CHIUSI_KEY, chiusi);
    paintDrawer();
    return;
  }
  const li = ev.target.closest('.trow[data-task]');
  if (li) openEditor(li.dataset.task);
});

/* ------------------------------------------------------------ editor ---- */

const dlgEd = $('editor');
let ed = null;                   /* { id, rank, cliente, giorno, gws }: lo stato dell'editor */

/* I giorni su cui si puo' mettere una task. Se la task sta gia' su un giorno
   che non e' piu' fra questi, quel giorno si mostra com'e': si puo' lasciare
   o togliere, non rimettere. */
function dayChoices(current) {
  const t0 = today();
  const out = [{ k: '', lab: 'Non schedulata' }];
  [['Oggi', 0], ['Domani', 1], ['Dopodomani', 2]].forEach(p => out.push({ k: dayKey(shift(t0, p[1])), lab: p[0] }));
  /* un giorno lontano lo mostra il chip "Altro"; qui entra solo un giorno che
     non sta in nessuna delle due liste, per esempio uno gia' passato */
  if (current && !out.some(o => o.k === current) && giorniLontani().indexOf(current) < 0) {
    out.push({ k: current, lab: fmtDate.format(new Date(current + 'T00:00:00')) });
  }
  return out;
}

/* I giorni da "fra 3" a "fra 7": gli ultimi cinque della finestra. */
const giorniLontani = () => { const t0 = today(); return [3, 4, 5, 6, 7].map(n => dayKey(shift(t0, n))); };

/* Il quarto chip del giorno: "Altro" apre il pannello coi giorni lontani;
   scelto uno, il chip mostra la data e resta acceso. */
function chipAltro() {
  const lontano = giorniLontani().indexOf(ed.giorno) >= 0;
  const b = el('button', 'chip chip-altro' + (lontano ? ' sel' : ''));
  b.type = 'button';
  b.dataset.v = 'altro';
  b.setAttribute('aria-haspopup', 'listbox');
  b.setAttribute('aria-expanded', 'false');
  b.appendChild(el('span', null, lontano ? fmtDate.format(new Date(ed.giorno + 'T00:00:00')) : 'Altro'));
  b.appendChild(el('span', 'chip-frec'));
  $('tGiorno').appendChild(b);
}

function listaGiorni() {
  const ul = $('tGiornoLista');
  ul.hidden = true;
  ul.textContent = '';
  giorniLontani().forEach((k, i) => {
    const b = el('button', 'tvoce' + (k === ed.giorno ? ' sel' : ''));
    b.type = 'button';
    b.dataset.v = k;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', k === ed.giorno ? 'true' : 'false');
    b.appendChild(el('span', null, 'fra ' + (i + 3) + ' giorni'));
    b.appendChild(el('span', 'tdata', fmtDate.format(new Date(k + 'T00:00:00'))));
    const li = el('li', '');
    li.appendChild(b);
    ul.appendChild(li);
  });
}

/* Le tendine: stessa forma di chips(), ma un bottone che mostra la scelta e
   apre un pannello con le voci. Occupano una riga sola anche quando le voci
   sono tante. Ogni ridisegno le lascia chiuse. */
function tendina(box, items, sel) {
  const btn = box.querySelector('.tendina-btn');
  const ul  = box.querySelector('.tendina-lista');
  const cur = items.find(it => it.k === sel) || items[0];
  btn.textContent = cur.lab;
  btn.setAttribute('aria-expanded', 'false');
  ul.hidden = true;
  ul.textContent = '';
  for (const it of items) {
    const b = el('button', 'tvoce' + (it.k === sel ? ' sel' : ''), it.lab);
    b.type = 'button';
    b.dataset.v = it.k;
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', it.k === sel ? 'true' : 'false');
    const li = el('li', '');
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function chips(box, items, sel) {
  box.textContent = '';
  for (const it of items) {
    const on = Array.isArray(sel) ? sel.indexOf(it.k) >= 0 : it.k === sel;   /* piu' chip accesi insieme */
    const b = el('button', 'chip' + (on ? ' sel' : ''), it.lab);
    b.type = 'button';
    b.dataset.v = it.k;
    box.appendChild(b);
  }
}

function paintEditor() {
  chips($('tRank'), RANKS.map(r => ({ k: r, lab: r })), ed.rank);
  tendina($('tCliente'), [{ k: '', lab: 'Nessuno' }]
          .concat(clientiOrdinati().map(c => ({ k: c.id, lab: c.nome }))), ed.cliente || '');
  chips($('tGiorno'), dayChoices(ed.giorno), ed.giorno || '');
  chipAltro();
  listaGiorni();
  const sched = !!ed.giorno;
  $('tGwsLab').hidden = !sched;
  $('tGws').hidden = !sched;
  if (sched) chips($('tGws'), [0, 1, 2, 3, 4, 5].map(i => ({ k: String(i), lab: String(i + 1) })), sessioniDi(ed).map(String));
}

function openEditor(id, preset) {
  const x = id ? findTask(id) : null;
  if (x && x.evento) {
    ed = { id: x.id, evento: x.evento, giorno: x.giorno, nome: x.nome, ora: x.ora, cliente: x.cliente };
    apriEditor(false);
    return;
  }
  ed = x ? { id: x.id, rank: x.rank, cliente: x.cliente, giorno: x.giorno, gws: x.gws,
             altre: (x.altre || []).slice() }
         : { id: null, rank: 'B', cliente: null,
             giorno: (preset && preset.giorno) || null,
             gws: preset && preset.gws != null ? preset.gws : null, altre: [] };
  if (ed.giorno && ed.gws == null) ed.gws = 0;

  $('tNome').value = x ? x.nome : '';
  $('tDesc').value = x ? x.desc : '';
  apriEditor(!x);
}

/* Un evento del calendario dalla giornata: si puo' solo dargli un cliente.
   Titolo, giorno e orario sono di Google e restano in sola lettura. */
function openEvento(eid) {
  const k = viewKey;
  const raw = cal && cal.days && Array.isArray(cal.days[k]) ? cal.days[k] : [];
  const e = raw.map(prepEvent).find(v => v.id === eid);
  if (!e) return;
  const rec = findTask('ev:' + eid);
  ed = { id: 'ev:' + eid, evento: eid, giorno: k, nome: e.title, ora: e.txt,
         cliente: rec ? rec.cliente : null };
  apriEditor(false);
}

/* La finestra, per una task o per un evento: per l'evento restano solo il
   titolo, la riga con giorno e ora, e la tendina del cliente. */
function apriEditor(nuova) {
  const ev = !!ed.evento;
  $('editorTit').textContent = ev ? ed.nome : nuova ? 'Nuova task' : 'Modifica task';
  $('tEvento').hidden = !ev;
  $('tEvento').textContent = ev ? whenText(ed) : '';
  $('tCampiTask').hidden = ev;
  $('tCampiGiorno').hidden = ev;
  $('tNome').disabled = ev;       /* e' required: nascosto, non deve bloccare il form */
  $('tElimina').hidden = ev || nuova;
  $('tElimina').textContent = 'Elimina';
  paintEditor();
  dlgEd.showModal();
  /* niente fuoco sul campo Nome: la tastiera si apre solo se si tocca un
     campo. Il titolo ha tabindex e autofocus, e prende lui il fuoco. */
  $('editorTit').focus({ preventScroll: true });
}

$('editorForm').addEventListener('click', ev => {
  if (!ed) return;
  /* la tendina del cliente: una voce sceglie, il bottone apre e chiude il
     pannello, un tocco in qualunque altro punto lo chiude */
  const voce = ev.target.closest('button.tvoce');
  if (voce) {
    if (voce.closest('#tGiornoLista')) {
      ed.giorno = voce.dataset.v;
      if (ed.gws == null) ed.gws = 0;
    } else {
      ed.cliente = voce.dataset.v || null;
    }
    paintEditor();
    return;
  }
  /* due pannelli, stessa regola: il suo bottone apre e chiude, un tocco
     altrove chiude. Aprirne uno chiude l'altro. */
  const pannelli = [['tClienteLista', '.tendina-btn', $('tClienteBtn')],
                    ['tGiornoLista', '.chip-altro', $('tGiorno').querySelector('.chip-altro')]];
  for (const p of pannelli) {
    const l = $(p[0]);
    const apri = !!ev.target.closest(p[1]) && l.hidden;
    l.hidden = !apri;
    if (p[2]) p[2].setAttribute('aria-expanded', apri ? 'true' : 'false');
  }
  const b = ev.target.closest('button.chip');
  if (!b || b.classList.contains('chip-altro')) return;
  const v = b.dataset.v;
  const box = b.parentNode.id;
  if (box === 'tRank') ed.rank = v;
  else if (box === 'tGws') {
    /* un tocco accende, un altro spegne; l'ultima accesa non si spegne */
    const n = +v;
    let s = sessioniDi(ed);
    if (s.indexOf(n) >= 0) { if (s.length > 1) s = s.filter(i => i !== n); }
    else s.push(n);
    s.sort((a, b) => a - b);
    ed.gws = s[0]; ed.altre = s.slice(1);
  }
  else if (box === 'tGiorno') {
    ed.giorno = v || null;
    ed.gws = ed.giorno ? (ed.gws == null ? 0 : ed.gws) : null;
    if (!ed.giorno) ed.altre = [];
  }
  paintEditor();
});

$('editorForm').addEventListener('submit', ev => {
  if (ed && ed.evento) {
    /* un evento: si scrive o si toglie solo il cliente. Con "Nessuno" la
       riga sparisce dal file, l'evento resta nella giornata com'era. */
    let x = findTask(ed.id);
    const prima = x ? x.cliente : null;
    if (ed.cliente) {
      if (!x) { x = { id: ed.id, creata: new Date().toISOString() }; tstore.tasks.push(x); }
      x.evento = ed.evento; x.nome = ed.nome; x.ora = ed.ora; x.desc = '';
      x.rank = 'A'; x.cliente = ed.cliente; x.giorno = ed.giorno; x.gws = null;
      segna(x);
    } else if (x) {
      tstore.tasks = tstore.tasks.filter(t => t.id !== ed.id);
      cancella(ed.id);
    }
    const cambiato = prima !== ed.cliente;
    ed = null;
    if (cambiato) { touch(); render(); paintDrawer(); }
    return;
  }
  const nome = $('tNome').value.trim();
  if (!nome) {
    /* soli spazi: required passa, ma il dialogo resta aperto e niente si perde */
    ev.preventDefault();
    $('tNome').focus();
    return;
  }
  if (!ed) return;
  let x = ed.id ? findTask(ed.id) : null;
  if (!x) {
    x = { id: newId(), creata: new Date().toISOString() };
    tstore.tasks.push(x);
  }
  /* l'editor puo' restare aperto oltre la mezzanotte: un giorno scelto come
     "oggi" che nel frattempo e' diventato ieri si sposta sull'oggi vero. Una
     task che stava gia' su quel giorno invece puo' restarci. */
  const t0 = dayKey(today());
  if (ed.giorno && ed.giorno < t0 && ed.giorno !== x.giorno) ed.giorno = t0;
  const mossa = !ed.id || x.giorno !== ed.giorno || x.gws !== ed.gws
             || JSON.stringify(x.altre || []) !== JSON.stringify(ed.giorno ? ed.altre : []);
  /* cambiando giorno, o tornando nel serbatoio, la vecchia spunta non segue */
  if (x.giorno && x.giorno !== ed.giorno) setCheck(x.giorno, x.id, false);
  x.nome = nome;
  x.desc = $('tDesc').value;
  x.rank = ed.rank;
  x.cliente = ed.cliente;
  x.giorno = ed.giorno;
  x.gws = ed.giorno ? ed.gws : null;
  if (ed.giorno && ed.altre.length) x.altre = ed.altre.slice(); else delete x.altre;
  segna(x);
  /* solo una task nuova o spostata riapre la sessione: un ritocco al nome no */
  if (mossa) riapriSessione(x);
  ed = null;
  touch(); render(); paintDrawer();
});

$('tAnnulla').addEventListener('click', () => { ed = null; dlgEd.close(); });
dlgEd.addEventListener('cancel', () => { ed = null; });

/* due tocchi per eliminare: il primo chiede, il secondo fa */
$('tElimina').addEventListener('click', () => {
  const b = $('tElimina');
  if (b.textContent !== 'Sicuro?') { b.textContent = 'Sicuro?'; return; }
  if (ed && ed.id) {
    const old = findTask(ed.id);
    if (old && old.giorno) setCheck(old.giorno, old.id, false);   /* niente spunte orfane */
    tstore.tasks = tstore.tasks.filter(x => x.id !== ed.id);
    cancella(ed.id);
  }
  ed = null;
  dlgEd.close();
  touch(); render(); paintDrawer();
});

/* ----------------------------------------------------------- clienti ---- */

/* L'editor dei clienti: una voce nuova sopra, l'elenco sotto. Ogni voce ha
   l'occhio, che la nasconde dal menu' e la manda in fondo, e la croce, che
   la toglie. Togliere un cliente con delle task chiede se togliere anche
   quelle. */
const dlgCli = $('clienti');
let cTipo = 'cliente';
const TIPI = [{ k: 'cliente', lab: 'Cliente' }, { k: 'agenzia', lab: 'Agenzia' }];

const OCCHIO = '<svg class="occhio-ico" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/>'
  + '<circle cx="12" cy="12" r="3"/><path class="occhio-barra" d="M4 4l16 16"/></svg>';

/* L'id nasce dal nome, minuscolo e senza accenti; se c'e' gia' si numera. */
function idCliente(nome) {
  const base = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cliente';
  let id = base, n = 2;
  while (tstore.clienti.some(c => c.id === id)) id = base + '-' + n++;
  return id;
}

function paintClienti() {
  chips($('cTipo'), TIPI, cTipo);
  const ul = $('clientiLista');
  ul.textContent = '';
  for (const c of clientiOrdinati()) {
    const li = el('li', 'crow' + (c.nascosto ? ' nascosto' : ''));
    li.appendChild(el('span', 'cnome', c.nome));
    if (c.agenzia) li.appendChild(el('span', 'ctipo', 'agenzia'));
    const o = el('button', 'occhio');
    o.type = 'button';
    o.dataset.cliente = c.id;
    o.setAttribute('aria-pressed', c.nascosto ? 'true' : 'false');
    o.setAttribute('aria-label', c.nascosto ? 'Mostra nel menu' : 'Nascondi dal menu');
    o.innerHTML = OCCHIO;
    li.appendChild(o);
    const d = el('button', 'cdel', '×');
    d.type = 'button';
    d.dataset.cliente = c.id;
    d.setAttribute('aria-label', 'Elimina ' + c.nome);
    li.appendChild(d);
    ul.appendChild(li);
  }
  if (!tstore.clienti.length) ul.appendChild(el('li', 'vuoto', 'Nessun cliente'));
}

function openClienti() {
  $('cNome').value = '';
  $('cNota').hidden = true;
  paintClienti();
  dlgCli.showModal();
  $('clientiTit').focus({ preventScroll: true });
}

$('clientiBtn').addEventListener('click', openClienti);
$('clientiChiudi').addEventListener('click', () => dlgCli.close());

$('cTipo').addEventListener('click', ev => {
  const b = ev.target.closest('button.chip');
  if (!b) return;
  cTipo = b.dataset.v;
  chips($('cTipo'), TIPI, cTipo);
});

$('clientiForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const nome = $('cNome').value.trim();
  const nota = $('cNota');
  nota.hidden = true;
  if (!nome) return;
  if (tstore.clienti.some(c => c.nome.toLowerCase() === nome.toLowerCase())) {
    nota.textContent = 'C\'e` gia`.';
    nota.hidden = false;
    return;
  }
  const c = { id: idCliente(nome), nome: nome };
  if (cTipo === 'agenzia') c.agenzia = true;
  tstore.clienti.push(segna(c));
  $('cNome').value = '';
  touch(); paintClienti(); paintDrawer();
});

/* Il cliente che si sta per togliere, mentre il pop-up chiede delle task. */
let delCliente = null;

function rimuoviCliente(c, conTask) {
  const via = x => x.cliente === c.id && (conTask || x.evento);
  for (const x of tstore.tasks) {
    if (via(x)) { if (x.giorno) setCheck(x.giorno, x.id, false); cancella(x.id); }
    else if (x.cliente === c.id) { x.cliente = null; segna(x); }   /* la task resta, senza cliente */
  }
  /* un evento del calendario senza cliente non ha piu' motivo di stare nel
     file: nella giornata resta comunque */
  tstore.tasks = tstore.tasks.filter(x => !via(x));
  tstore.clienti = tstore.clienti.filter(k => k.id !== c.id);
  cancella(c.id);
  delete chiusi[c.id];
  touch(); paintClienti(); render(); paintDrawer();
}

$('clientiLista').addEventListener('click', ev => {
  const o = ev.target.closest('button.occhio[data-cliente]');
  if (o) {
    const c = findCliente(o.dataset.cliente);
    if (!c) return;
    if (c.nascosto) delete c.nascosto; else c.nascosto = true;
    segna(c);
    touch(); paintClienti(); paintDrawer();
    return;
  }
  const d = ev.target.closest('button.cdel[data-cliente]');
  if (!d) return;
  const c = findCliente(d.dataset.cliente);
  if (!c) return;
  if (tstore.tasks.some(x => x.cliente === c.id)) {
    delCliente = c;
    $('clienteDelTit').textContent = 'Eliminare anche le task di ' + c.nome + '?';
    $('clienteDel').showModal();
  } else {
    rimuoviCliente(c, false);
  }
});

$('cdSi').addEventListener('click', () => {
  $('clienteDel').close();
  if (delCliente) rimuoviCliente(delCliente, true);
  delCliente = null;
});
$('cdNo').addEventListener('click', () => {
  $('clienteDel').close();
  if (delCliente) rimuoviCliente(delCliente, false);
  delCliente = null;
});
$('clienteDel').addEventListener('cancel', () => { delCliente = null; });

/* ------------------------------------------------------------- pesca ---- */

const dlgPesca = $('pesca');
let pescaGws = null;

/* Il + della sessione: una task nuova gia' li' dentro, oppure una pescata dal
   serbatoio con un tocco. */
function openPesca(g) {
  pescaGws = g;
  $('pescaDay').textContent = 'GWS ' + (g + 1) + ' · ' + fmtLong.format(view);
  const box = $('pescaList');
  box.textContent = '';
  const list = tstore.tasks.filter(x => !x.giorno).sort(byRank);
  if (!list.length) {
    box.appendChild(el('p', 'vuoto', 'Serbatoio vuoto'));
  } else {
    const ul = el('ul', 'trows');
    for (const x of list) ul.appendChild(trowNode(x, true));
    box.appendChild(ul);
  }
  dlgPesca.showModal();
}

$('pescaList').addEventListener('click', ev => {
  const li = ev.target.closest('.trow[data-task]');
  const x = li && findTask(li.dataset.task);
  if (!x) return;
  /* se nel frattempo il giorno mostrato e' diventato ieri, la task va su oggi */
  x.giorno = canSchedule(viewKey) ? viewKey : dayKey(today());
  x.gws = pescaGws;
  delete x.altre;
  segna(x);
  riapriSessione(x);
  dlgPesca.close();
  touch(); render(); paintDrawer();
});
$('pescaNuova').addEventListener('click', () => {
  dlgPesca.close();
  openEditor(null, { giorno: viewKey, gws: pescaGws });
});
$('pescaAnnulla').addEventListener('click', () => dlgPesca.close());

/* ------------------------------------------------------------ workout ---- */

/* La tendina di sinistra: la settimana dei workout. Niente di quello che sta
   qui entra nella giornata o nel Menu' Task: e' un programma a parte, che
   vive nello stesso file e viaggia con lo stesso Salva. */

const GIORNI_WK = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];   /* 0 = lunedi' */
const oggiWk = () => (today().getDay() + 6) % 7;
const byNome = (a, b) => a.nome.localeCompare(b.nome);
const findWorkout = id => tstore.workouts.find(w => w.id === id) || null;
const giorniTxt = w => w.giorni.map(g => GIORNI_WK[g]).join(' ');

/* Le tre sezioni della tendina — OGGI, PROGRAMMAZIONE, OGNI GIORNO — si
   aprono e si chiudono toccando la scritta. Si ricorda. Di base OGGI e OGNI
   GIORNO stanno aperte, PROGRAMMAZIONE chiusa. */
const WKAPERTE_KEY = 'gwork-wkaperte-v1';
const wkAperte = Object.assign({ oggi: true, progr: false, ogni: true }, readStore(WKAPERTE_KEY));

/* La scritta di una sezione: un bottone con la freccetta che dice se e'
   aperta. Il pannello che segue si mostra o si nasconde con lei. */
function sezioneWk(box, k, label) {
  const b = el('button', 'grp progr');
  b.type = 'button';
  b.dataset.sez = k;
  b.setAttribute('aria-expanded', wkAperte[k] ? 'true' : 'false');
  b.appendChild(el('span', null, label));
  b.appendChild(el('span', 'chip-frec'));
  box.appendChild(b);
  const pan = el('div', 'progr-pan');
  pan.hidden = !wkAperte[k];
  box.appendChild(pan);
  return pan;
}

function openWorkout(on) {
  $('wdrawer').classList.toggle('open', on);
  $('velo').hidden = !on;
  document.body.classList.toggle('menu-open', on);
  $('wkBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  if (on) paintWorkout();
}

/* I tre puntini accanto al nome di un workout: aprono il suo editor. */
function moreWk(id) {
  const b = el('button', 'more', '⋯');
  b.type = 'button';
  b.dataset.workout = id;
  b.setAttribute('aria-label', 'Modifica il workout');
  return b;
}

/* La tabella di un workout: il titolo in verde sulla prima riga, poi un
   esercizio per riga in tre colonne. Un tocco proprio sul nome apre la
   descrizione, un tocco su qualsiasi altro punto della riga apre l'esercizio. */
function workoutTable(w) {
  const t = el('table', 'wk');
  const cg = el('colgroup');
  for (const c of ['wc-nome', 'wc-set', 'wc-rec']) cg.appendChild(el('col', c));
  t.appendChild(cg);

  const hr = el('tr', 'wk-testa');
  const th = el('td');
  th.colSpan = 3;
  const row = el('div', 'wvoce');
  row.dataset.workout = w.id;
  row.appendChild(el('span', 'wk-tit', w.nome));
  if (w.giorni.length) row.appendChild(el('span', 'wk-gg', giorniTxt(w)));
  row.appendChild(moreWk(w.id));
  th.appendChild(row);
  hr.appendChild(th);
  t.appendChild(hr);

  if (!w.esercizi.length) {
    const tr = el('tr', 'wvuoto');
    tr.dataset.workout = w.id;
    const td = el('td', 'vuoto', 'Nessun esercizio: i tre puntini ne aggiungono');
    td.colSpan = 3;
    tr.appendChild(td);
    t.appendChild(tr);
  }

  w.esercizi.forEach((e, i) => {
    const tr = el('tr', 'wes');
    tr.dataset.workout = w.id;
    tr.dataset.es = i;
    const nc = el('td', 'wnome');
    nc.appendChild(el('span', 'wtxt', e.nome));
    tr.appendChild(nc);
    tr.appendChild(el('td', 'wset', e.setrep));
    tr.appendChild(el('td', 'wrec', e.rec));
    t.appendChild(tr);

    /* la descrizione sta sotto, chiusa */
    const dr = el('tr', 'wdesc');
    dr.hidden = true;
    const dd = el('td');
    dd.colSpan = 3;
    dd.appendChild(el('p', 'desc', e.desc || 'Nessuna descrizione'));
    dr.appendChild(dd);
    t.appendChild(dr);
  });
  return t;
}

/* La tendina: la settimana, il workout di oggi, e sotto PROGRAMMAZIONE che
   apre tutti gli altri da lunedi' a domenica, poi quelli senza giorno. */
function paintWorkout() {
  const box = $('wkList');
  box.textContent = '';
  const oggi = oggiWk();
  const ws = tstore.workouts;
  /* in un giorno, prima i workout di quel giorno, poi quelli di tutti e sette */
  const tutti = w => w.giorni.length === 7;
  const delGiorno = g => ws.filter(w => w.giorni.indexOf(g) >= 0)
                           .sort((x, y) => tutti(x) - tutti(y) || byNome(x, y));

  /* la settimana: un giorno per riga, oggi in verde */
  const tab = el('table', 'settimana');
  for (let g = 0; g < 7; g++) {
    const tr = el('tr', g === oggi ? 'oggi' : null);
    tr.dataset.giorno = g;
    tr.appendChild(el('td', 'gg', GIORNI_WK[g]));
    const td = el('td', 'wcell');
    for (const w of delGiorno(g)) {
      const r = el('div', 'wvoce');
      r.dataset.workout = w.id;
      r.appendChild(el('span', 'wnome', w.nome));
      r.appendChild(moreWk(w.id));
      td.appendChild(r);
    }
    tr.appendChild(td);
    tab.appendChild(tr);
  }
  box.appendChild(tab);

  /* il workout di oggi */
  const panOggi = sezioneWk(box, 'oggi', 'OGGI');
  const oggiL = delGiorno(oggi);
  if (!oggiL.length) panOggi.appendChild(el('p', 'vuoto', 'Nessun workout oggi'));
  for (const w of oggiL) panOggi.appendChild(workoutTable(w));

  /* la programmazione: da lunedi' a domenica, e in fondo quelli senza un
     giorno fisso, che valgono ogni giorno */
  const pan = sezioneWk(box, 'progr', 'PROGRAMMAZIONE');
  const sched  = ws.filter(w => w.giorni.length).sort((x, y) => x.giorni[0] - y.giorni[0] || byNome(x, y));
  const liberi = ws.filter(w => !w.giorni.length).sort(byNome);
  for (const w of sched) pan.appendChild(workoutTable(w));
  if (liberi.length) {
    const panOgni = sezioneWk(pan, 'ogni', 'OGNI GIORNO');
    for (const w of liberi) panOgni.appendChild(workoutTable(w));
  }
  if (!ws.length) pan.appendChild(el('p', 'vuoto', 'Nessun workout: il + ne crea uno'));
}

$('wkBtn').addEventListener('click', () => openWorkout(true));
$('chiudiWk').addEventListener('click', () => openWorkout(false));
$('nuovoWk').addEventListener('click', () => openWkEd(null, null));

$('wkList').addEventListener('click', ev => {
  const m = ev.target.closest('button.more[data-workout]');
  if (m) { openWkEd(m.dataset.workout, null); return; }

  /* un esercizio: proprio il nome apre la descrizione, il resto della riga l'editor */
  const es = ev.target.closest('tr.wes');
  if (es) {
    if (ev.target.closest('.wtxt')) es.nextElementSibling.hidden = !es.nextElementSibling.hidden;
    else openExEd(es.dataset.workout, +es.dataset.es);
    return;
  }

  /* il titolo, la riga vuota, una voce della settimana: tutto apre il workout */
  const voce = ev.target.closest('[data-workout]');
  if (voce) { openWkEd(voce.dataset.workout, null); return; }

  /* un giorno vuoto della settimana: un workout nuovo, gia' su quel giorno */
  const riga = ev.target.closest('tr[data-giorno]');
  if (riga) { openWkEd(null, +riga.dataset.giorno); return; }

  const p = ev.target.closest('button[data-sez]');
  if (p) {
    const k = p.dataset.sez;
    wkAperte[k] = !wkAperte[k];
    writeStore(WKAPERTE_KEY, wkAperte);
    p.setAttribute('aria-expanded', wkAperte[k] ? 'true' : 'false');
    p.nextElementSibling.hidden = !wkAperte[k];
  }
});

/* L'editor del workout: nome, giorni a chip, gli esercizi con le frecce per
   l'ordine. Lavora su una copia: si scrive con Conferma. */
const dlgWk = $('wkEd');
let wed = null;                   /* { id, giorni, esercizi } */

function openWkEd(id, giorno) {
  const w = id ? findWorkout(id) : null;
  if (id && !w) return;
  wed = w ? { id: w.id, giorni: w.giorni.slice(), esercizi: w.esercizi.map(e => Object.assign({}, e)) }
          : { id: null, giorni: giorno != null ? [giorno] : [], esercizi: [] };
  $('wNome').value = w ? w.nome : '';
  $('wkEdTit').textContent = w ? 'Modifica workout' : 'Nuovo workout';
  $('wElimina').hidden = !w;
  $('wElimina').textContent = 'Elimina';
  paintWkEd();
  dlgWk.showModal();
  $('wkEdTit').focus({ preventScroll: true });
}

function paintWkEd() {
  chips($('wGiorni'), GIORNI_WK.map((g, i) => ({ k: String(i), lab: g })), wed.giorni.map(String));
  const ul = $('wEsercizi');
  ul.textContent = '';
  wed.esercizi.forEach((e, i) => {
    const li = el('li', 'esrow');
    const n = el('button', 'esnome', e.nome);
    n.type = 'button';
    n.dataset.es = i;
    li.appendChild(n);
    for (const d of [-1, 1]) {
      const b = el('button', 'esmv', d < 0 ? '▲' : '▼');
      b.type = 'button';
      b.dataset.es = i;
      b.dataset.d = d;
      b.disabled = i + d < 0 || i + d >= wed.esercizi.length;
      b.setAttribute('aria-label', d < 0 ? 'Sposta su' : 'Sposta giu`');
      li.appendChild(b);
    }
    ul.appendChild(li);
  });
  if (!wed.esercizi.length) ul.appendChild(el('li', 'vuoto', 'Nessun esercizio'));
}

$('wkEdForm').addEventListener('click', ev => {
  if (!wed) return;
  const chip = ev.target.closest('#wGiorni button.chip');
  if (chip) {
    const g = +chip.dataset.v;
    wed.giorni = wed.giorni.indexOf(g) >= 0 ? wed.giorni.filter(x => x !== g)
                                            : wed.giorni.concat(g).sort((a, b) => a - b);
    paintWkEd();
    return;
  }
  const mv = ev.target.closest('button.esmv');
  if (mv) {
    const i = +mv.dataset.es, j = i + (+mv.dataset.d), l = wed.esercizi;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]];
    paintWkEd();
    return;
  }
  const es = ev.target.closest('button.esnome');
  if (es) openExEd(null, +es.dataset.es);
});

$('wAggiungi').addEventListener('click', () => openExEd(null, -1));

$('wkEdForm').addEventListener('submit', ev => {
  const nome = $('wNome').value.trim();
  if (!nome) { ev.preventDefault(); $('wNome').focus(); return; }
  if (!wed) return;
  let w = wed.id ? findWorkout(wed.id) : null;
  if (!w) { w = { id: newId() }; tstore.workouts.push(w); }
  w.nome = nome;
  w.giorni = wed.giorni.slice();
  w.esercizi = wed.esercizi;
  segna(w);
  wed = null;
  touch(); paintWorkout();
});

$('wAnnulla').addEventListener('click', () => { wed = null; dlgWk.close(); });
dlgWk.addEventListener('cancel', () => { wed = null; });

/* due tocchi per eliminare: il primo chiede, il secondo fa */
$('wElimina').addEventListener('click', () => {
  const b = $('wElimina');
  if (b.textContent !== 'Sicuro?') { b.textContent = 'Sicuro?'; return; }
  if (wed && wed.id) {
    tstore.workouts = tstore.workouts.filter(w => w.id !== wed.id);
    cancella(wed.id);
  }
  wed = null;
  dlgWk.close();
  touch(); paintWorkout();
});

/* L'editor dell'esercizio. Dall'editor del workout (wid nullo) scrive nella
   sua copia, che si salva con Conferma; da una tabella scrive dritto nel
   workout, e si salva subito. */
const dlgEx = $('exEd');
let exd = null;                   /* { lista, i, wid }: dove, a che posto (-1 = nuovo) */

function openExEd(wid, i) {
  const w = wid ? findWorkout(wid) : null;
  if (wid ? !w : !wed) return;
  const lista = w ? w.esercizi : wed.esercizi;
  const e = i >= 0 ? lista[i] : null;
  if (i >= 0 && !e) return;
  exd = { lista: lista, i: i, wid: wid };
  $('exEdTit').textContent = e ? 'Modifica esercizio' : 'Nuovo esercizio';
  $('eNome').value = e ? e.nome : '';
  $('eSet').value  = e ? e.setrep : '';
  $('eRec').value  = e ? e.rec : '';
  $('eDesc').value = e ? e.desc : '';
  $('eElimina').hidden = !e;
  $('eElimina').textContent = 'Elimina';
  dlgEx.showModal();
  $('exEdTit').focus({ preventScroll: true });
}

function fineEx() {
  const w = exd.wid ? findWorkout(exd.wid) : null;
  exd = null;
  if (w) { segna(w); touch(); paintWorkout(); } else paintWkEd();
}

$('exEdForm').addEventListener('submit', ev => {
  const nome = $('eNome').value.trim();
  if (!nome) { ev.preventDefault(); $('eNome').focus(); return; }
  if (!exd) return;
  const e = exd.i >= 0 ? exd.lista[exd.i] : { id: newId() };
  e.nome   = nome;
  e.setrep = $('eSet').value.trim();
  e.rec    = $('eRec').value.trim();
  e.desc   = $('eDesc').value.trim();
  if (exd.i < 0) exd.lista.push(e);
  fineEx();
});

$('eAnnulla').addEventListener('click', () => { exd = null; dlgEx.close(); });
dlgEx.addEventListener('cancel', () => { exd = null; });

$('eElimina').addEventListener('click', () => {
  const b = $('eElimina');
  if (b.textContent !== 'Sicuro?') { b.textContent = 'Sicuro?'; return; }
  if (!exd) { dlgEx.close(); return; }
  if (exd.i >= 0) exd.lista.splice(exd.i, 1);
  dlgEx.close();
  fineEx();
});

/* ------------------------------------------------------ impostazioni ---- */

const dlgImp = $('impostazioni');

function openImpostazioni() {
  $('tokenInput').value = token;
  const s = $('tokenStato');
  s.className = 'nota';
  s.textContent = token ? 'Token presente.' : 'Nessun token: le task si leggono ma non si salvano.';
  dlgImp.showModal();
}

$('impostazioniForm').addEventListener('submit', () => {
  token = $('tokenInput').value.trim();
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) { /* resta solo in memoria */ }
  salvaErr = '';
  beatAuth = true;                /* col token nuovo il battito riprova la quota personale */
  beatQuota = 0;
  loadBeat();                     /* subito, senza aspettare il tick */
  paintSalva();
  if (token) provaToken();
  else paintSync('nessun token');
});
$('tokenAnnulla').addEventListener('click', () => dlgImp.close());

/* Una lettura autenticata: se passa, il token e' buono. Scrivere lo si
   scopre al primo Salva, e se manca il permesso lo dice lui. */
async function provaToken() {
  try {
    const r = await fetch(TASK_API + '?ref=' + TASK_BRANCH, { headers: ghHeaders(), cache: 'no-store' });
    if (r.status === 401) paintSync('token rifiutato', true);
    else if (r.ok || r.status === 404) paintSync('token accettato');
    else paintSync('token: errore ' + r.status, true);
  } catch (e) {
    paintSync('rete assente', true);
  }
}

/* -------------------------------------------------------------- sync ----- */

let salvando = false, salvaErr = '';
let syncMsg = '', syncErr = false;

function ghHeaders() {
  const h = { Accept: 'application/vnd.github+json' };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

/* base64 di testo UTF-8, in entrambe le direzioni: btoa da solo si rompe
   sugli accenti. */
function b64enc(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64dec(b) {
  const bin = atob(String(b).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* Le ultime sha viste: una risposta dell'API rimasta in cache non deve
   sovrascrivere il telefono con una versione vecchia. */
function rememberSha(sha) {
  tstore.sha = sha;
  tstore.known = [sha].concat(tstore.known.filter(x => x !== sha)).slice(0, 4);
}

/* Tre bottoni, uno stato: in alto nella pagina e in testa alle due tendine. */
function paintSalva() {
  for (const b of [$('salva'), $('salvaMenu'), $('salvaWk')]) {
    b.hidden = !tstore.dirty;
    b.disabled = salvando;
    b.classList.toggle('err', !!salvaErr);
    b.textContent = salvando ? 'Salvo…' : salvaErr ? 'Salva — ' + salvaErr : 'Salva';
  }
}

function paintSync(msg, err) {
  if (msg !== undefined) { syncMsg = msg; syncErr = !!err; }
  const s = $('sync');
  s.textContent = syncErr ? syncMsg : tstore.dirty ? 'modifiche non salvate' : syncMsg;
  s.classList.toggle('err', syncErr);
}

/* Il file dal branch task. Senza token si legge lo stesso. Se il telefono ha
   modifiche non salvate, vince il telefono: online si guarda soltanto. */
async function pullTasks() {
  let r;
  try {
    r = await fetch(TASK_API + '?ref=' + TASK_BRANCH, { headers: ghHeaders(), cache: 'no-store' });
  } catch (e) {
    return;                       /* offline: si va avanti con la copia locale */
  }
  /* token scaduto o revocato: lo si dice, ma leggere si puo' lo stesso, anonimi.
     L'avviso resta anche dopo la rilettura, altrimenti "allineato" lo coprirebbe. */
  let tokenKo = false;
  if (r.status === 401 && token) {
    tokenKo = true;
    paintSync('token rifiutato', true);
    try {
      r = await fetch(TASK_API + '?ref=' + TASK_BRANCH, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    } catch (e) { return; }
  }
  const fine = msg => paintSync(tokenKo ? 'token rifiutato' : msg, tokenKo);
  if (r.status === 404) { if (!tstore.sha) fine('nessun file online ancora'); return; }
  if (!r.ok) return;

  let j;
  try { j = await r.json(); } catch (e) { return; }
  if (!j || !j.sha) return;
  /* una sha gia' vista non si riapplica: potrebbe essere una risposta rimasta
     in cache. Ma se e' proprio quella corrente e il telefono non ha piu'
     quello che sta online, il telefono si e' svuotato: online e' la verita' */
  if (tstore.known.indexOf(j.sha) >= 0 && j.sha !== tstore.sha) return;

  let data;
  try { data = JSON.parse(b64dec(j.content)); } catch (e) { paintSync('file online illeggibile', true); return; }
  const remote = normFile(data);
  if (j.sha === tstore.sha && sameFile(remote, localFile())) return;   /* niente di nuovo */

  if (tstore.dirty) {
    /* e' la nostra stessa versione, salvata dal salvagente senza risposta? */
    if (sameFile(remote, localFile())) {
      rememberSha(j.sha); tstore.dirty = false; saveLocal(); paintSalva();
      fine('allineato');
      return;
    }
    /* due copie che non si conoscono: si uniscono, senza perdere niente,
       e Salva manda su il risultato. Se l'unione e' proprio l'online, il
       telefono non aveva niente di suo: e' gia' allineato */
    applicaFile(mergeFile(localFile(), remote));
    rememberSha(j.sha);
    tstore.dirty = !sameFile(localFile(), remote);
    saveLocal();
    tidyTasks(); render(); paintDrawer(); paintWorkout(); paintSalva();
    fine(tstore.dirty ? 'unito con l\'online: Salva per allineare' : 'allineato');
    return;
  }

  applicaFile(remote);
  rememberSha(j.sha);
  tstore.dirty = false;
  saveLocal();
  tidyTasks(); render(); paintDrawer(); paintWorkout(); paintSalva();
  fine('allineato alle ' + fmtTime.format(new Date()));
}

/* Un commit solo, con tutto dentro. */
async function pushTasks(opts) {
  opts = opts || {};
  if (!tstore.dirty || salvando) return;
  if (!token) { salvaErr = 'manca il token'; paintSalva(); paintSync('manca il token', true); return; }

  salvando = true; salvaErr = ''; salvaRetry = false;
  paintSalva();

  /* Prima di scrivere si rilegge l'online e ci si unisce: cosi' nessuna
     copia — nemmeno una rimasta indietro o svuotata — puo' cancellare
     quello che sta online. Se l'online non si legge, non si scrive: la
     copia locale resta e si riprova. */
  if (!opts.retry) {
    let cur;
    try {
      cur = await fetch(TASK_API + '?ref=' + TASK_BRANCH, { headers: ghHeaders(), cache: 'no-store' });
    } catch (e) {
      salvando = false; salvaErr = 'rete assente'; salvaRetry = true; paintSalva(); return;
    }
    if (cur.ok) {
      let data = null;
      try {
        const j = await cur.json();
        rememberSha(j.sha);
        data = JSON.parse(b64dec(j.content));
      } catch (e) { /* illeggibile: si scrive sopra */ }
      if (data) {
        const remote = normFile(data);
        if (!sameFile(remote, localFile())) {
          applicaFile(mergeFile(localFile(), remote));
          saveLocal();
          tidyTasks(); render(); paintDrawer(); paintWorkout();
        }
        if (sameFile(remote, localFile())) {
          /* l'unione e' proprio l'online: non c'e' niente da scrivere */
          salvando = false; tstore.dirty = false; saveLocal(); paintSalva();
          paintSync('allineato alle ' + fmtTime.format(new Date()));
          return;
        }
      }
    } else if (cur.status !== 404) {
      salvando = false;
      salvaErr = cur.status === 401 ? 'token rifiutato'
               : cur.status === 403 ? 'token senza permesso'
               :                      'errore ' + cur.status;
      salvaRetry = cur.status >= 500;
      paintSalva(); paintSync(salvaErr, true); return;
    }
  }

  /* la fotografia di cio' che parte: se nel frattempo si tocca qualcosa,
     dirty deve restare acceso anche a salvataggio riuscito */
  const sent = JSON.stringify(localFile());
  const n = tstore.tasks.filter(x => !x.giorno).length;
  const payload = {
    message: 'task: ' + n + ' in serbatoio, ' + (tstore.tasks.length - n) + ' schedulate',
    content: b64enc(JSON.stringify(localFile(), null, 2) + '\n'),
    branch:  TASK_BRANCH
  };
  if (tstore.sha) payload.sha = tstore.sha;
  const body = JSON.stringify(payload);

  const salvato = () => {
    if (JSON.stringify(localFile()) === sent) tstore.dirty = false;
    saveLocal(); paintSalva();
    paintSync('salvato alle ' + fmtTime.format(new Date()));
  };

  let r;
  try {
    r = await fetch(TASK_API, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()),
      body: body,
      /* keepalive rifiuta corpi oltre 64 KiB: sopra soglia meglio un tentativo
         normale che un rifiuto certo spacciato per rete assente */
      keepalive: !!opts.keepalive && body.length < 60000
    });
  } catch (e) {
    salvando = false; salvaErr = 'rete assente'; salvaRetry = true; paintSalva(); return;
  }
  salvando = false;

  /* sha vecchia: online e' cambiato qualcosa nel frattempo — di solito e' il
     salvagente di una chiusura precedente, arrivato senza che lo sapessimo.
     Si rilegge, e se e' la nostra stessa versione si e' gia' a posto;
     altrimenti si unisce l'online con il telefono, senza perdere niente, e
     si riprova una volta con la sha giusta. Mai piu' "vince il telefono". */
  if ((r.status === 409 || r.status === 422) && !opts.retry) {
    try {
      const cur = await fetch(TASK_API + '?ref=' + TASK_BRANCH, { headers: ghHeaders(), cache: 'no-store' });
      if (cur.status === 404) {
        /* non e' un conflitto: manca il branch, o il file */
        salvaErr = 'branch task assente'; paintSalva(); paintSync(salvaErr, true);
        return;
      }
      if (cur.ok) {
        const j = await cur.json();
        rememberSha(j.sha);
        let data = null;
        try { data = JSON.parse(b64dec(j.content)); } catch (e) { /* illeggibile: si scrive sopra */ }
        if (data) {
          const remote = normFile(data);
          if (sameFile(remote, localFile())) { salvato(); return; }
          applicaFile(mergeFile(localFile(), remote));
          saveLocal();
          tidyTasks(); render(); paintDrawer(); paintWorkout();
        }
        return pushTasks(Object.assign({}, opts, { retry: true }));
      }
    } catch (e) { /* si cade nell'errore qui sotto */ }
  }
  if (r.status === 409 || r.status === 422) {
    /* e' cambiato di nuovo nel frattempo: si riprova al prossimo giro */
    salvaErr = 'conflitto online'; salvaRetry = true; paintSalva(); paintSync(salvaErr, true);
    return;
  }

  if (!r.ok) {
    salvaErr = r.status === 401 ? 'token rifiutato'
             : r.status === 403 ? 'token senza permesso'
             : r.status === 404 ? 'branch task assente'
             :                    'errore ' + r.status;
    salvaRetry = r.status >= 500;   /* un guasto di GitHub passa; un token no */
    paintSalva(); paintSync(salvaErr, true);
    return;
  }

  let j = null;
  try { j = await r.json(); } catch (e) { /* salvato comunque */ }
  if (j && j.content && j.content.sha) rememberSha(j.content.sha);
  salvato();
}

/* Il salvagente: si chiama chiudendo l'app. keepalive chiede al browser di
   finire la richiesta anche se la pagina muore. Di solito basta, non sempre:
   per questo la copia locale resta comunque, e Salva ricompare alla riapertura. */
function salvagente() {
  if (riavvio || !tstore.dirty || !token || salvando) return;
  pushTasks({ keepalive: true });
}

/* Un salvataggio caduto per la rete, o per un 5xx di GitHub, si riprova da
   solo: quando la rete torna, a ogni riapertura, e al passo del battito
   mentre l'app resta aperta. Token rifiutato o senza permesso no: quelli li
   sistema la persona, riprovare sarebbe solo rumore. */
let salvaRetry = false;
function riprovaSalva() {
  if (tstore.dirty && salvaRetry && !salvando && token) pushTasks();
}

$('salva').addEventListener('click', () => pushTasks());
$('salvaMenu').addEventListener('click', () => pushTasks());
$('salvaWk').addEventListener('click', () => pushTasks());

/* ---------------------------------------------------------- avviamento --- */

try {
  localStorage.removeItem(LEGACY_KEY);   /* lo storico precedente va eliminato, non migrato */
} catch (e) {
  /* niente da rimuovere */
}

/* Una lettura fallita non cancella il calendario: si tiene l'ultima copia
   buona e la riga in alto dice da quanto e' vecchia. Un 5xx di GitHub o una
   risposta troncata non devono svuotare la giornata per trenta secondi. */
async function loadCalendar() {
  const before = cal ? cal.generatedAt : null;
  try {
    const r = await fetch(CAL_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    if (!(j && typeof j === 'object' && j.days && typeof j.days === 'object')) throw new Error('forma');
    cal = j; calAt = Date.now(); calErr = false;
  } catch (e) {
    calErr = true;
  }
  const first = !loaded;
  loaded = true;
  refreshRecords();
  paintFresh();
  /* stesso file: non si ridisegna, cosi' le descrizioni aperte restano aperte */
  if (first || !cal || cal.generatedAt !== before) render();
}

render();
paintDrawer();
paintSalva();
loadCalendar();
loadBeat();                       /* subito, all'apertura */
pullTasks();                      /* il serbatoio, subito */

/* Un'app rimasta ferma a lungo riparte da capo invece di fidarsi di quello
   che ha in memoria: le task, le spunte e il battito sono di quando si e'
   fermata, e una copia rimasta indietro ha gia' cancellato lavoro fatto
   altrove e gridato "FERMO" a un ponte sano. Ricaricare rilegge il telefono
   e l'online, e prende anche l'app nuova se nel frattempo e' uscita. Le
   modifiche non salvate stanno gia' nel telefono: Salva ricompare da solo. */
let vivo = Date.now();            /* l'ultima volta che l'app ha girato davvero */
let nascostoDa = 0;               /* da quando sta in secondo piano */
let riavvio = false;
function ripartenza() {
  const now = Date.now();
  if (document.hidden) { vivo = now; return false; }
  const ferma = now - (nascostoDa || vivo);
  vivo = now; nascostoDa = 0;
  if (ferma < RIAVVIO_MS || riavvio) return false;
  riavvio = true;
  location.reload();
  return true;
}

/* invecchia la riga, vede la mezzanotte, e si accorge di essere rimasta ferma */
setInterval(() => { if (ripartenza()) return; checkDay(); paintFresh(); }, 30000);
setInterval(loadCalendar, 30000);
setInterval(() => { loadBeat(); riprovaSalva(); }, BEAT_MS);   /* solo mentre l'app resta aperta */

/* Riaprendola si ricontrolla tutto: e' il momento in cui la barra serve.
   Finche' il battito nuovo non arriva, quello vecchio non si mostra: un
   ritardo di dieci minuti sarebbe solo il tempo passato in tasca.
   Chiudendola parte il salvagente: un tentativo di salvare quello che e'
   rimasto in sospeso, nei pochi istanti che il browser concede. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { nascostoDa = Date.now(); salvagente(); return; }
  if (ripartenza()) return;
  beatOk = false;
  checkDay(); loadCalendar(); loadBeat(); pullTasks(); riprovaSalva();
});
window.addEventListener('pagehide', salvagente);

/* La rete che va e viene: appena torna si rilegge tutto e si riprova il
   salvataggio rimasto in sospeso; appena manca la riga in alto lo dice. */
window.addEventListener('online', () => { loadCalendar(); loadBeat(); pullTasks(); riprovaSalva(); });
window.addEventListener('offline', paintFresh);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
