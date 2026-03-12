/* ═══════════════════════════════════════════════
   lasso.js — Outil Lasso (sélection & manipulation)
   ────────────────────────────────────────────────
   Phases :
     1. DRAW    — tracé libre du contour de sélection
     2. SELECT  — traits inclus mis en évidence
     3. MOVE    — drag de la sélection
     4. (futur) RESIZE via poignées

   API publique :
     lassoDown(e)  / lassoMove(e) / lassoUp(e)
     clearLasso()
     lassoDelete()
     lassoCopy()
     lassoCut()
═══════════════════════════════════════════════ */

// ── État interne ──────────────────────────────
const LASSO = {
  phase:          'idle',   // idle | draw | select | move
  path:           [],       // polygon de sélection [{x,y}]
  selectedIdx:    [],       // indices dans pages[currentPageIdx].strokes
  bbox:           null,     // {x,y,w,h} bounding box de la sélection
  moveOrigin:     null,     // point de départ du drag
  moveOffset:     { dx: 0, dy: 0 },  // décalage cumulé
  // copies des strokes originaux (pour annulation)
  _origStrokes:   [],
};

// ── Couleurs UI ───────────────────────────────
const LASSO_STROKE   = 'rgba(59,111,232,0.8)';
const LASSO_FILL     = 'rgba(59,111,232,0.07)';
const LASSO_BBOX     = 'rgba(59,111,232,0.55)';
const LASSO_HANDLE   = '#fff';
const LASSO_SEL_GLOW = 'rgba(59,111,232,0.25)';

// ══════════════════════════════════════════════
// ÉVÉNEMENTS PRINCIPAUX
// ══════════════════════════════════════════════

function lassoDown(p) {
  if (LASSO.phase === 'select' && _inBbox(p, LASSO.bbox)) {
    // Démarrer un déplacement
    LASSO.phase      = 'move';
    LASSO.moveOrigin = { ...p };
    LASSO.moveOffset = { dx: 0, dy: 0 };
    // Sauvegarder les strokes originaux pour annulation
    LASSO._origStrokes = LASSO.selectedIdx.map(i =>
      JSON.parse(JSON.stringify(pages[currentPageIdx].strokes[i]))
    );
    cTemp.style.cursor = 'grabbing';
    return;
  }

  // Nouvelle sélection
  clearLasso();
  LASSO.phase = 'draw';
  LASSO.path  = [{ ...p }];
  cTemp.style.cursor = 'crosshair';
}

function lassoMove(p) {
  if (LASSO.phase === 'draw') {
    LASSO.path.push({ ...p });
    _drawLassoPath();
    return;
  }

  if (LASSO.phase === 'move' && LASSO.moveOrigin) {
    const dx = p.x - LASSO.moveOrigin.x;
    const dy = p.y - LASSO.moveOrigin.y;

    // Déplacer les strokes sélectionnés
    const page = pages[currentPageIdx];
    LASSO.selectedIdx.forEach((idx, i) => {
      const orig = LASSO._origStrokes[i];
      const s    = page.strokes[idx];
      _applyOffset(s, orig, dx, dy);
    });

    LASSO.moveOffset = { dx, dy };

    // Redessiner
    ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
    redrawAllStrokes(ctxStrokes, page.strokes);

    // Mettre à jour la bbox
    _updateBbox();
    _drawSelectionOverlay();
    return;
  }

  // Curseur change si sur la bbox
  if (LASSO.phase === 'select' && LASSO.bbox) {
    cTemp.style.cursor = _inBbox(p, LASSO.bbox) ? 'grab' : 'default';
  }
}

function lassoUp(p) {
  if (LASSO.phase === 'draw') {
    // Fermer le polygone et sélectionner les strokes dedans
    LASSO.path.push({ ...LASSO.path[0] });
    _selectStrokes();
    LASSO.phase = 'select';
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    _drawSelectionOverlay();
    cTemp.style.cursor = LASSO.selectedIdx.length ? 'grab' : 'default';

    // Afficher toolbar si sélection non vide
    if (LASSO.selectedIdx.length > 0) {
      _showLassoToolbar();
    } else {
      _hideLassoToolbar();
      LASSO.phase = 'idle';
    }
    return;
  }

  if (LASSO.phase === 'move') {
    // Committer le déplacement dans l'historique
    _commitLassoMove();
    LASSO.phase      = 'select';
    LASSO.moveOrigin = null;
    cTemp.style.cursor = 'grab';
    _drawSelectionOverlay();
  }
}

// ══════════════════════════════════════════════
// SÉLECTION DES STROKES
// ══════════════════════════════════════════════

function _selectStrokes() {
  const strokes = pages[currentPageIdx].strokes;
  LASSO.selectedIdx = [];

  strokes.forEach((s, i) => {
    if (s.tool === '__clear__') return;
    if (_strokeIntersectsPolygon(s, LASSO.path)) {
      LASSO.selectedIdx.push(i);
    }
  });

  _updateBbox();
}

/** Vérifie si au moins un point du stroke est dans le polygone */
function _strokeIntersectsPolygon(s, poly) {
  if (s.points) {
    return s.points.some(pt => _pointInPolygon(pt.x, pt.y, poly));
  }
  if (s.from && s.to) {
    return _pointInPolygon(s.from.x, s.from.y, poly) ||
           _pointInPolygon(s.to.x,   s.to.y,   poly);
  }
  if (s.x1 !== undefined) {
    return _pointInPolygon(s.x1, s.y1, poly) ||
           _pointInPolygon(s.x2, s.y2, poly);
  }
  return false;
}

/** Ray casting algorithm */
function _pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > py) !== (yj > py) &&
        px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function _updateBbox() {
  const idxs = LASSO.selectedIdx;
  if (!idxs.length) { LASSO.bbox = null; return; }

  const strokes = pages[currentPageIdx].strokes;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  idxs.forEach(i => {
    const s = strokes[i];
    const pts = s.points
      ? s.points
      : s.from
        ? [s.from, s.to]
        : [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
    pts.forEach(pt => {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    });
  });

  const mg = 14;
  LASSO.bbox = {
    x: minX - mg, y: minY - mg,
    w: (maxX - minX) + mg * 2,
    h: (maxY - minY) + mg * 2,
  };
}

// ══════════════════════════════════════════════
// DÉPLACEMENT
// ══════════════════════════════════════════════

function _applyOffset(stroke, orig, dx, dy) {
  if (orig.points) {
    stroke.points = orig.points.map(pt => ({
      ...pt, x: pt.x + dx, y: pt.y + dy,
    }));
  } else if (orig.from) {
    stroke.from = { x: orig.from.x + dx, y: orig.from.y + dy };
    stroke.to   = { x: orig.to.x   + dx, y: orig.to.y   + dy };
  } else if (orig.x1 !== undefined) {
    stroke.x1 = orig.x1 + dx; stroke.y1 = orig.y1 + dy;
    stroke.x2 = orig.x2 + dx; stroke.y2 = orig.y2 + dy;
  }
}

function _commitLassoMove() {
  if (!LASSO.moveOffset.dx && !LASSO.moveOffset.dy) return;
  // Enregistrer dans l'historique undo
  const page = pages[currentPageIdx];
  undoStack.push({
    type: 'lasso_move',
    pageIdx: currentPageIdx,
    selectedIdx: [...LASSO.selectedIdx],
    origStrokes: LASSO._origStrokes,
    dx: LASSO.moveOffset.dx,
    dy: LASSO.moveOffset.dy,
  });
  redoStack = [];
  scheduleAIAnalysis?.();
}

// ══════════════════════════════════════════════
// ACTIONS SUR LA SÉLECTION
// ══════════════════════════════════════════════

/** Supprime les strokes sélectionnés */
function lassoDelete() {
  if (!LASSO.selectedIdx.length) return;
  const page = pages[currentPageIdx];

  // Sauvegarder pour undo
  const removed = LASSO.selectedIdx.map(i => ({
    idx: i, stroke: JSON.parse(JSON.stringify(page.strokes[i])),
  }));
  undoStack.push({ type: 'lasso_delete', pageIdx: currentPageIdx, removed });
  redoStack = [];

  // Supprimer (par indices décroissants)
  [...LASSO.selectedIdx].sort((a, b) => b - a).forEach(i => {
    page.strokes.splice(i, 1);
  });

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, page.strokes);
  clearLasso();
  scheduleAIAnalysis?.();
}

/** Copie les strokes sélectionnés dans le presse-papiers interne */
let _lassoClipboard = [];

function lassoCopy() {
  if (!LASSO.selectedIdx.length) return;
  const page = pages[currentPageIdx];
  _lassoClipboard = LASSO.selectedIdx.map(i =>
    JSON.parse(JSON.stringify(page.strokes[i]))
  );
  toast('📋 ' + _lassoClipboard.length + ' élément(s) copié(s)', 'ok');
}

function lassoCut() {
  lassoCopy();
  lassoDelete();
}

/** Colle les strokes avec un décalage de 20px */
function lassoPaste() {
  if (!_lassoClipboard.length) return;
  const page = pages[currentPageIdx];
  const offset = 20;

  _lassoClipboard.forEach(s => {
    const copy = JSON.parse(JSON.stringify(s));
    // Décaler de 20px
    _applyOffset(copy, copy, offset, offset);
    page.strokes.push(copy);
  });

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, page.strokes);
  scheduleAIAnalysis?.();
  toast('📌 Collé', 'ok');
}

// ══════════════════════════════════════════════
// RENDU
// ══════════════════════════════════════════════

function _drawLassoPath() {
  ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
  if (LASSO.path.length < 2) return;

  ctxTemp.save();
  ctxTemp.beginPath();
  ctxTemp.moveTo(LASSO.path[0].x, LASSO.path[0].y);
  LASSO.path.forEach(p => ctxTemp.lineTo(p.x, p.y));
  ctxTemp.closePath();

  ctxTemp.fillStyle = LASSO_FILL;
  ctxTemp.fill();
  ctxTemp.strokeStyle = LASSO_STROKE;
  ctxTemp.lineWidth   = 1.5;
  ctxTemp.setLineDash([5, 4]);
  ctxTemp.stroke();
  ctxTemp.restore();
}

function _drawSelectionOverlay() {
  ctxUi.clearRect(0, 0, PAGE_W, PAGE_H);

  const bbox = LASSO.bbox;
  if (!bbox || !LASSO.selectedIdx.length) return;

  ctxUi.save();

  // Ombre de sélection sur les strokes
  ctxUi.fillStyle = LASSO_SEL_GLOW;
  ctxUi.fillRect(bbox.x, bbox.y, bbox.w, bbox.h);

  // Cadre de sélection pointillé
  ctxUi.strokeStyle = LASSO_BBOX;
  ctxUi.lineWidth   = 1.5;
  ctxUi.setLineDash([6, 3]);
  ctxUi.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);

  // Poignées aux 4 coins
  const handles = [
    { x: bbox.x,           y: bbox.y           },
    { x: bbox.x + bbox.w,  y: bbox.y           },
    { x: bbox.x,           y: bbox.y + bbox.h  },
    { x: bbox.x + bbox.w,  y: bbox.y + bbox.h  },
    { x: bbox.x + bbox.w/2, y: bbox.y          },
    { x: bbox.x + bbox.w/2, y: bbox.y + bbox.h },
    { x: bbox.x,            y: bbox.y + bbox.h/2 },
    { x: bbox.x + bbox.w,   y: bbox.y + bbox.h/2 },
  ];
  handles.forEach(h => {
    ctxUi.beginPath();
    ctxUi.arc(h.x, h.y, 5, 0, Math.PI * 2);
    ctxUi.fillStyle   = LASSO_HANDLE;
    ctxUi.fill();
    ctxUi.strokeStyle = LASSO_BBOX;
    ctxUi.lineWidth   = 1.5;
    ctxUi.setLineDash([]);
    ctxUi.stroke();
  });

  // Label : nombre d'éléments
  const label = LASSO.selectedIdx.length + ' sélectionné' +
                (LASSO.selectedIdx.length > 1 ? 's' : '');
  ctxUi.font      = '500 11px "Outfit", sans-serif';
  ctxUi.fillStyle = LASSO_BBOX;
  ctxUi.fillText(label, bbox.x + 2, bbox.y - 5);

  ctxUi.restore();
}

// ══════════════════════════════════════════════
// TOOLBAR CONTEXTUELLE
// ══════════════════════════════════════════════

function _showLassoToolbar() {
  let tb = $('lasso-toolbar');
  if (!tb) {
    tb = document.createElement('div');
    tb.id = 'lasso-toolbar';
    tb.style.cssText = `
      position: fixed;
      background: var(--surface, #fff);
      border: 1px solid var(--border, rgba(0,0,0,.08));
      border-radius: 12px;
      padding: 5px 7px;
      display: flex; gap: 3px; align-items: center;
      box-shadow: 0 4px 20px rgba(0,0,0,.12);
      z-index: 500;
      font-family: var(--font, sans-serif);
      transform: translateX(-50%);
    `;
    document.body.appendChild(tb);
  }

  tb.innerHTML = `
    <button class="lt-btn" onclick="lassoCut()"   title="Couper">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
        <line x1="20" y1="4" x2="8.12" y2="15.88"/>
        <line x1="14.47" y1="14.48" x2="20" y2="20"/>
        <line x1="8.12" y1="8.12" x2="12" y2="12"/>
      </svg>
      Couper
    </button>
    <button class="lt-btn" onclick="lassoCopy()"  title="Copier">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      Copier
    </button>
    <button class="lt-btn lt-btn-danger" onclick="lassoDelete()" title="Supprimer">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
      Supprimer
    </button>
    <div style="width:1px;height:22px;background:var(--border-s,rgba(0,0,0,.1));margin:0 2px"></div>
    <button class="lt-btn lt-btn-close" onclick="clearLasso()" title="Désélectionner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;

  // CSS de la toolbar
  if (!document.getElementById('lasso-toolbar-style')) {
    const style = document.createElement('style');
    style.id = 'lasso-toolbar-style';
    style.textContent = `
      .lt-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 5px 9px; border: none; border-radius: 8px;
        background: transparent; color: var(--ink2, #666);
        font-size: 12px; font-weight: 500; cursor: pointer;
        font-family: inherit; transition: background .1s, color .1s;
        white-space: nowrap;
      }
      .lt-btn:hover { background: var(--paper2, #eee); color: var(--ink, #111); }
      .lt-btn-danger:hover { background: rgba(229,83,75,.1); color: #E5534B; }
      .lt-btn-close { padding: 5px 6px; }
      .lt-btn-close:hover { background: var(--paper2, #eee); }
    `;
    document.head.appendChild(style);
  }

  // Positionner la toolbar au-dessus de la bbox
  _positionLassoToolbar(tb);
  tb.style.display = 'flex';
}

function _positionLassoToolbar(tb) {
  if (!LASSO.bbox) return;
  const wrapper = document.getElementById('canvas-wrapper');
  if (!wrapper) return;
  const wr = wrapper.getBoundingClientRect();
  const scale = wr.width / PAGE_W;

  const bx = wr.left + LASSO.bbox.x * scale;
  const by = wr.top  + LASSO.bbox.y * scale;
  const bw = LASSO.bbox.w * scale;

  tb.style.left = (bx + bw / 2) + 'px';
  tb.style.top  = Math.max(60, by - 52) + 'px';
}

function _hideLassoToolbar() {
  const tb = $('lasso-toolbar');
  if (tb) tb.style.display = 'none';
}

// ══════════════════════════════════════════════
// UTILITAIRES
// ══════════════════════════════════════════════

function _inBbox(p, bbox) {
  if (!bbox) return false;
  return p.x >= bbox.x && p.x <= bbox.x + bbox.w &&
         p.y >= bbox.y && p.y <= bbox.y + bbox.h;
}

function clearLasso() {
  LASSO.phase       = 'idle';
  LASSO.path        = [];
  LASSO.selectedIdx = [];
  LASSO.bbox        = null;
  LASSO.moveOrigin  = null;
  ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
  ctxUi.clearRect(0,   0, PAGE_W, PAGE_H);
  _hideLassoToolbar();
  if (cTemp) cTemp.style.cursor = 'crosshair';
}