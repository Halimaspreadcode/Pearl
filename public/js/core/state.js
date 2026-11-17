// ── STATE ────────────────────────────────────────────────────
const API = '';
let state = { sites: [], tickets: {}, observations: [], config: {}, dashboard: {}, boList: [], shiftsPlan: [], foTasks: [], rotaConfig: { sites: [] }, holidays: [], shiftRequests: [], weeklyProgress: [] };
// Clé du tracker affiché : code du site en minuscules (« lyo »).
let currentTracker = '';
let editingId = null;
let countdownInterval = null;
// Synchronisation périodique avec le serveur, distincte du rafraîchissement
// de l'affichage : voir startCountdowns().
let resyncInterval = null;
// Instant de la dernière synchronisation réussie. Les comptes à rebours s'en
// déduisent, sans requête. Déclaré ici parce que `loadAll()` le met à jour et
// s'exécute au démarrage, avant les scripts chargés plus loin.
let _dernierSync = Date.now();


// ── I18N ─────────────────────────────────────────────────────
// All user-facing labels in one place. Add new keys here only.
const I18N = {
  fr: {
    // Column headers
    'Ticket #':         'Ticket #',
    'External ref.':    'External ref.',
    'Titre':            'Titre',
    'Type':             'Type',
    'Domaine':          'Domaine',
    'Priority':         'Priority',
    'Severity':         'Severity',
    'Statut':           'Statut',
    'FO Owner':         'FO Owner',
    'Assigned To':      'Assigned to',
    'BO Handling':      'BO en charge',
    'Occur Time':       'Heure d\'occurrence',
    'Detection Time':   'Detection time',
    'Open Date':        'Date ouverture',
    'Close Date':       'Close date',
    'SLA Ref':          'SLA ref',
    'Time Left':        'Temps restant',
    'SLA Status':       'SLA Status',
    'Root Cause':       'Cause racine',
    'RC Category':      'RC category',
    'RC Description':   'Description RC',
    'Corrective Actions': 'Actions correctives',
    'Observations':     'Observations',
    'Lien RCA':         'Lien RCA',
    'Lien Alarme':      'Lien Alarme',
    'Comments':         'Commentaires',
    'Update Action':    'Last action',
    'Modified By':      'Modified by',
    'Modified At':      'Modified on',
    'Shift':            'Shift',
    // Dashboard / report labels
    'Total':            'Total',
    'Open':             'Open',
    'Breach':           'Breach',
    'Resolved':         'Resolved',
    'Today':            'Aujourd\'hui',
    'SLA Compliance':   'SLA compliance',
    'TT#':              'TT#',
    'Src':              'Src',
    'Dom.':             'Dom.',
    'Severity':         'Severity',
    'SLA Target':       'Cible SLA',
    'Status':           'Statut',
    // Misc UI
    'New ticket':       'New ticket',
    'Rechercher...':    'Rechercher...',
    'All statuses': 'All statuses',
    'All priorities': 'All priorities',
    'All FOs':     'All FOs',
    'All domains':'All domains',
    // Report headers
    'Weekly Report':    'Weekly Report',
    'Daily Report':     'Daily Report',
    'Monthly Report':   'Monthly Report',
    'Weekly trend': 'Weekly trend',
    'Semaine':          'Semaine',
    'Open':          'Open',
    'Resolved':          'Resolved',
    'By Domain':        'By Domain',
    'By priority':     'By priority',
    'By Type':          'By Type',
    'By Status':        'By Status',
    'Performance by FO': 'Performance by FO',
  },
  en: {
    'Ticket #':         'Ticket #',
    'External ref.':    'External ref.',
    'Titre':            'Title',
    'Type':             'Type',
    'Domaine':          'Domain',
    'Priority':         'Priority',
    'Severity':         'Severity',
    'Statut':           'Status',
    'FO Owner':         'FO Owner',
    'Assigned To':      'Assigned To',
    'BO Handling':      'BO Handling',
    'Occur Time':       'Occur Time',
    'Detection Time':   'Detection Time',
    'Open Date':        'Open Date',
    'Close Date':       'Close Date',
    'SLA Ref':          'SLA Ref',
    'Time Left':        'Time Left',
    'SLA Status':       'SLA Status',
    'Root Cause':       'Root Cause',
    'RC Category':      'RC Category',
    'RC Description':   'RC Description',
    'Corrective Actions': 'Corrective Actions',
    'Observations':     'Observations',
    'Lien RCA':         'RCA Link',
    'Lien Alarme':      'Alarm Link',
    'Comments':         'Comments',
    'Update Action':    'Latest Action',
    'Modified By':      'Modified By',
    'Modified At':      'Modified At',
    'Shift':            'Shift',
    'Total':            'Total',
    'Open':             'Open',
    'Breach':           'Breach',
    'Resolved':         'Resolved',
    'Today':            'Today',
    'SLA Compliance':   'SLA Compliance',
    'TT#':              'TT#',
    'Src':              'Src',
    'Dom.':             'Dom.',
    'Severity':         'Severity',
    'SLA Target':       'SLA Target',
    'Status':           'Status',
    'New ticket':       'New ticket',
    'Rechercher...':    'Search...',
    'All statuses': 'All statuses',
    'All priorities': 'All priorities',
    'All FOs':     'All FOs',
    'All domains':'All domains',
    'Weekly Report':    'Weekly Report',
    'Daily Report':     'Daily Report',
    'Monthly Report':   'Monthly Report',
    'Weekly trend': 'Weekly breakdown',
    'Semaine':          'Week',
    'Open':          'Opened',
    'Resolved':          'Resolved',
    'By Domain':        'By Domain',
    'By priority':     'By Priority',
    'By Type':          'By Type',
    'By Status':        'By Status',
    'Performance by FO': 'FO Performance',
  }
};

function t(key) {
  const lang = (typeof currentLang !== 'undefined' ? currentLang : null) || 'fr';
  return I18N[lang]?.[key] ?? I18N['fr'][key] ?? key;
}

// Report column headers are always in English, regardless of the active UI language.
function te(key) {
  return I18N.en[key] ?? key;
}

// ── WRITE QUEUE INDICATOR ─────────────────────────────────────
let _saveInProgress = false;
function setSaveInProgress(v) {
  _saveInProgress = v;
  const el = document.getElementById('save-spinner');
  if (el) el.style.display = v ? 'flex' : 'none';
}

// Debounce: prevent double-click saves
function withSaveGuard(fn) {
  return async function(...args) {
    if (_saveInProgress) {
      toast('Save in progress, please wait…', 'error');
      return;
    }
    setSaveInProgress(true);
    try { await fn(...args); }
    finally { setSaveInProgress(false); }
  };
}

