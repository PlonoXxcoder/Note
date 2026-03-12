/* ═══════════════════════════════════════════════
   state.js — État global partagé de l'application
   Toutes les variables accessibles par les modules
═══════════════════════════════════════════════ */

// ── Dimensions de la page (format A4) ──
const PAGE_W = 794;
const PAGE_H = 1123;

// ══════════════════════════════════════════
// ÉTAT : DASHBOARD (gestion des fichiers)
// ══════════════════════════════════════════

let isDark      = false;       // Thème clair / sombre
let activeView  = 'all';       // Vue active dans la sidebar
let currentSort = 'modified';  // Critère de tri des cahiers
let fabOpen     = false;       // Ouverture du FAB

// Couleur sélectionnée dans le dialog dossier
let editingFolderId    = null;
let selectedFolderColor = '#007AFF';

// Options de couleurs disponibles pour les dossiers
const FOLDER_COLORS = [
  '#007AFF','#5856D6','#34C759','#FF9500',
  '#FF3B30','#FF2D55','#AF52DE','#5AC8FA',
  '#FFCC00','#FF6B35',
];

// Dossiers créés par l'utilisateur
let folders = [
  { id:'maths',    label:'Maths',    color:'#007AFF' },
  { id:'physique', label:'Physique', color:'#5856D6' },
  { id:'biologie', label:'Biologie', color:'#34C759' },
  { id:'chimie',   label:'Chimie',   color:'#FF9500' },
];

// Cahiers / notebooks
let notebooks = [
  {
    id:1, title:'Analyse & Calcul',
    modified:'Modifié il y a 2h',
    lastOpened: new Date('2026-02-26T14:00'),
    created:    new Date('2026-01-15'),
    fav: true,
    img: 'https://images.unsplash.com/photo-1560785472-2f186f554644?w=400&q=80',
    folder:'maths',
  },
  {
    id:2, title:'Mécanique Quantique',
    modified:'Modifié hier',
    lastOpened: new Date('2026-02-25'),
    created:    new Date('2026-01-20'),
    fav: false,
    img: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=400&q=80',
    folder:'physique',
  },
  {
    id:3, title:'Biologie Cellulaire',
    modified:'Modifié il y a 3j',
    lastOpened: new Date('2026-02-23'),
    created:    new Date('2026-01-10'),
    fav: true,
    img: 'https://images.unsplash.com/photo-1634888879297-a5c3c251f30c?w=400&q=80',
    folder:'biologie',
  },
  {
    id:4, title:'Algèbre Linéaire',
    modified:'Modifié la sem. passée',
    lastOpened: new Date('2026-02-19'),
    created:    new Date('2026-02-01'),
    fav: false,
    img: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?w=400&q=80',
    folder:'maths',
  },
  {
    id:5, title:'Chimie Organique',
    modified:'Modifié il y a 5j',
    lastOpened: new Date('2026-02-21'),
    created:    new Date('2026-01-25'),
    fav: true,
    img: 'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?w=400&q=80',
    folder:'chimie',
  },
  {
    id:6, title:'Thermodynamique',
    modified:'Modifié il y a 1 sem.',
    lastOpened: new Date('2026-02-18'),
    created:    new Date('2026-01-05'),
    fav: true,
    img: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=400&q=80',
    folder:'physique',
  },
];

// Options de tri
const SORT_OPTIONS = [
  { id:'modified', label:'Modifié',          icon:'📝' },
  { id:'opened',   label:'Ouvert récemment', icon:'👁️' },
  { id:'created',  label:'Créé en premier',  icon:'🆕' },
  { id:'name',     label:'Nom (A-Z)',         icon:'🔤' },
];

// ══════════════════════════════════════════
// ÉTAT : ÉDITEUR (outil de dessin)
// ══════════════════════════════════════════

// Références aux 6 canvases (initialisées dans editor.js)
// cAi = couche suggestions IA (pointer-events: none, non exportée)
let cBg, cPdf, cStrokes, cTemp, cUi, cAi;
let ctxBg, ctxPdf, ctxStrokes, ctxTemp, ctxUi, ctxAi;

// Outil actif et propriétés du stylo
let currentTool  = 'pen';
let penColor     = '#1a1a2e';
let penSize      = 3;
let penOpacity   = 1;
let eraserSize   = 20;

// Zoom
let zoomLevel = 1;

// Dessin en cours
let isDrawing    = false;
let currentPath  = [];

// Fond de page actif
let currentBg = 'grid-small';

// Forme géométrique sélectionnée
let selectedShape = 'rect';

// Stylo plume sélectionné (index dans FOUNTAIN_TYPES)
let selectedFountainTypeIdx = 0;

// Gestion des pages (tableau d'objets {bg, strokesData, pdfData, undoStack})
let pages          = [];
let currentPageIdx = 0;

// Historique annulation/rétablissement
let undoStack = [];
let redoStack = [];

// Règle virtuelle
let rulerStart = null;

// Dessin de forme
let shapeStart = null;

// Note couramment ouverte dans l'éditeur
let currentNotebook = null;

// ══════════════════════════════════════════
// ÉTAT : AUDIO
// ══════════════════════════════════════════

let mediaRecorder = null;
let audioChunks   = [];
let recInterval   = null;
let recSeconds    = 0;

// ══════════════════════════════════════════
// ÉTAT : IA — Reconnaissance mathématique
// ══════════════════════════════════════════

let aiEnabled       = true;   // IA active par défaut
let aiWorker        = null;   // Instance Tesseract.js (lazy init)
let aiReady         = false;  // Worker initialisé et prêt
let aiDebounceTimer = null;   // Timer debounce des analyses
let aiSuggestions   = [];     // Suggestions visibles [{expr,result,x,y}]
let aiLastHash      = null;   // Hash du dernier état analysé (cache)
