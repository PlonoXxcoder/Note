/* ═══════════════════════════════════════════════
   tools.js — Algorithmes de dessin (Système Vectoriel)

   ARCHITECTURE DU STOCKAGE VECTORIEL
   ────────────────────────────────────
   Chaque trait fini est un objet immuable poussé dans
   pages[currentPageIdx].strokes[]. Le canvas ctxStrokes
   est toujours reconstruit depuis ce tableau via
   redrawAllStrokes(ctx, strokesArray).

   FORMAT D'UN OBJET TRAIT
   ────────────────────────────────────────────────────
   Stylo / Plume / Surligneur (≥ 3 pts) :
     { tool, color, size, opacity, points:[{x,y,pressure}],
       fpIdx? }          ← fpIdx uniquement si tool='fountain'

   Point d'encre (< 3 pts) :
     { tool:'dot', color, size, opacity, points:[{x,y,pressure}] }

   Règle :
     { tool:'ruler', color, size, opacity, from:{x,y}, to:{x,y} }

   Forme :
     { tool:'shape', color, size, opacity, shape, x1,y1,x2,y2 }

   Gomme :
     { tool:'eraser', size, points:[{x,y}] }

   Effacement de page (sentinel annulable) :
     { tool:'__clear__' }
     → redrawAllStrokes saute tout ce qui précède le dernier __clear__,
       ce qui rend clearPage() entièrement annulable par undo().

   PRINCIPE DU RENDU
   ────────────────────────────────────────────────────
   _renderOneStroke(ctx, stroke) swap temporairement les
   globaux (penColor, penSize…) avec les valeurs stockées
   dans l'objet, appelle les primitives existantes (drawSmooth,
   drawLine, drawShape, algos de plume), puis restaure les
   globaux. Tous les algorithmes restent 100% intacts.
═══════════════════════════════════════════════ */

// ══════════════════════════════════════════
// SÉLECTION DE L'OUTIL
// ══════════════════════════════════════════

const TOOL_NAMES = {
  lasso:       'Lasso',
  pen:         'Stylo',
  fountain:    'Plume',
  highlighter: 'Surligneur',
  eraser:      'Gomme',
  ruler:       'Règle',
  shape:       'Forme',
};

function setTool(t) {
  currentTool = t;

  document.querySelectorAll('.tool-btn[id^="btn-"]').forEach(b => b.classList.remove('active'));
  const btn = $('btn-' + t);
  if (btn) btn.classList.add('active');

  const name = t === 'fountain'
    ? `Plume — ${FOUNTAIN_TYPES[selectedFountainTypeIdx]?.name || ''}`
    : (TOOL_NAMES[t] || t);
  $('sb-tool').textContent = name;

  $('ruler-hint').style.display = t === 'ruler' ? 'block' : 'none';
  if (t !== 'lasso') clearLasso?.();
  if (cTemp) cTemp.style.cursor = t === 'eraser' ? 'cell' : t === 'lasso' ? 'crosshair' : 'crosshair';
}

// ══════════════════════════════════════════
// UTILITAIRES DE CAPTURE
// ══════════════════════════════════════════

/** Coordonnées souris/stylet → espace canvas (tient compte du zoom CSS) */
function getPos(e) {
  const r   = cTemp.getBoundingClientRect();
  const sx  = PAGE_W / r.width;
  const sy  = PAGE_H / r.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left) * sx,
    y: (src.clientY - r.top)  * sy,
  };
}

/** Pression stylet (0.5 par défaut pour la souris) */
function getPressure(e) {
  return e.pressure > 0 ? e.pressure : 0.5;
}

// ══════════════════════════════════════════
// ÉVÉNEMENTS CANVAS
// ══════════════════════════════════════════

function onDown(e) {
  e.preventDefault();
  isDrawing = true;
  const p  = getPos(e);
  const pr = getPressure(e);

  if (currentTool === 'lasso') { lassoDown(p); return; }
  if (currentTool === 'ruler') { rulerStart = p; return; }
  if (currentTool === 'shape') { shapeStart = p; return; }

  // Stylos et gomme : initialiser le chemin courant
  currentPath = [currentTool === 'eraser'
    ? { x: p.x, y: p.y }
    : { ...p, pressure: pr }];

  // Gomme : lancer l'aperçu live immédiatement sur le premier point
  if (currentTool === 'eraser') _eraserLivePreview(p);
}

function onMove(e) {
  e.preventDefault();
  const p  = getPos(e);
  const pr = getPressure(e);

  // Barre de statut
  $('sb-pos').textContent  = `${Math.round(p.x)},${Math.round(p.y)}`;
  $('sb-pres').textContent = `Pression: ${(pr * 100).toFixed(0)}%`;

  if (!isDrawing) return;
  if (currentTool === 'lasso') { lassoMove(p); return; }

  // ── Règle : aperçu sur calque temporaire ────────────────
  if (currentTool === 'ruler' && rulerStart) {
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    drawLine(ctxTemp, rulerStart, p);
    return;
  }

  // ── Forme : aperçu sur calque temporaire ────────────────
  if (currentTool === 'shape' && shapeStart) {
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    drawShape(ctxTemp, selectedShape, shapeStart.x, shapeStart.y, p.x, p.y);
    return;
  }

  // ── Gomme : accumule les points + aperçu live ────────────
  // ctxStrokes est reconstruit depuis strokes[] + chemin en cours,
  // ce qui garantit la cohérence parfaite avec l'état vectoriel final.
  if (currentTool === 'eraser') {
    currentPath.push({ x: p.x, y: p.y });
    _eraserLivePreview(p);
    return;
  }

  // ── Stylos (pen / fountain / highlighter) ────────────────
  currentPath.push({ ...p, pressure: pr });
  if (currentPath.length >= 3) {
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    drawSmooth(ctxTemp, currentPath);
  }
}

function onUp(e) {
  e.preventDefault();
  if (!isDrawing) return;
  isDrawing = false;
  const p = getPos(e);

  // -- Lasso
  if (currentTool === 'lasso') { lassoUp(p); return; }

  // ── Règle ────────────────────────────────────────────────
  if (currentTool === 'ruler' && rulerStart) {
    _commitStroke({
      tool:    'ruler',
      color:   penColor, size: penSize, opacity: penOpacity,
      from:    { ...rulerStart },
      to:      { ...p },
    });
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    rulerStart = null;
    return;
  }

  // ── Forme ────────────────────────────────────────────────
  if (currentTool === 'shape' && shapeStart) {
    _commitStroke({
      tool:    'shape',
      color:   penColor, size: penSize, opacity: penOpacity,
      shape:   selectedShape,
      x1: shapeStart.x, y1: shapeStart.y,
      x2: p.x,          y2: p.y,
    });
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    shapeStart = null;
    return;
  }

  // ── Gomme ────────────────────────────────────────────────
  // ctxStrokes est déjà à jour grâce au live preview dans onMove.
  // On n'a qu'à finaliser l'objet vectoriel.
  if (currentTool === 'eraser') {
    if (currentPath.length > 0) {
      _commitStroke({
        tool:   'eraser',
        size:   eraserSize,
        points: [...currentPath],
      });
    }
    currentPath = [];
    ctxUi.clearRect(0, 0, PAGE_W, PAGE_H);
    return;
  }

  // ── Stylos (pen / fountain / highlighter) ────────────────
  if (currentPath.length === 0) return;

  if (currentPath.length < 3) {
    // Tap court → point d'encre
    _commitStroke({
      tool:    'dot',
      color:   penColor, size: penSize, opacity: penOpacity,
      points:  [{ ...currentPath[0] }],
    });
  } else {
    const stroke = {
      tool:    currentTool,
      color:   penColor, size: penSize, opacity: penOpacity,
      points:  [...currentPath],
    };
    if (currentTool === 'fountain') stroke.fpIdx = selectedFountainTypeIdx;
    _commitStroke(stroke);
  }

  ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
  currentPath = [];
}

function bindCanvasEvents() {
  cTemp.addEventListener('pointerdown',  onDown);
  cTemp.addEventListener('pointermove',  onMove);
  cTemp.addEventListener('pointerup',    onUp);

  cTemp.addEventListener('pointercancel', () => {
    // Si gomme partielle : rétablir l'état vectoriel propre
    if (currentTool === 'eraser' && currentPath.length > 0) {
      ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
      redrawAllStrokes(ctxStrokes, pages[currentPageIdx].strokes);
    }
    isDrawing = false; currentPath = [];
    shapeStart = null; rulerStart = null;
    ctxTemp.clearRect(0, 0, PAGE_W, PAGE_H);
    ctxUi.clearRect(0, 0, PAGE_W, PAGE_H);
  });

  cTemp.addEventListener('pointerleave', () => {
    ctxUi.clearRect(0, 0, PAGE_W, PAGE_H);
  });

  $('canvas-container').addEventListener('wheel', e => {
    if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 0.1 : -0.1); }
  }, { passive: false });
}

// ══════════════════════════════════════════
// MOTEUR VECTORIEL
// ══════════════════════════════════════════

/**
 * Valide un objet trait dans pages[currentPageIdx].strokes[].
 *
 * Pour les outils de tracé (pen, fountain…) on ajoute le rendu de
 * ce seul trait sur ctxStrokes (incrémental, pas de full-redraw).
 * Pour la gomme, ctxStrokes est déjà à jour via le live preview ;
 * on reconstruit quand même pour garantir l'exactitude pixel-perfect.
 *
 * @param {Object} stroke
 */
function _commitStroke(stroke) {
  const page = pages[currentPageIdx];
  if (!page) return;

  page.strokes.push(stroke);
  redoStack = []; // invalider le redo après un nouveau trait

  // Rendu incrémental : on re-rend uniquement le nouveau trait
  // sauf pour la gomme qui nécessite un full-redraw (destination-out
  // sur des traits déjà composités ne peut pas être annulé autrement).
  if (stroke.tool === 'eraser') {
    ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
    redrawAllStrokes(ctxStrokes, page.strokes);
  } else {
    _renderOneStroke(ctxStrokes, stroke);
  }

  if (typeof updateThumbnail === 'function') updateThumbnail(currentPageIdx);

  // Déclencher l'analyse IA mathématique (debounce 2,5 s)
  if (typeof scheduleAIAnalysis === 'function') scheduleAIAnalysis();
}

/**
 * Redessine l'intégralité des traits vectoriels d'une page.
 *
 * Gestion du sentinel __clear__ :
 *   Le tableau strokes[] peut contenir des entrées { tool:'__clear__' }
 *   insérées par clearPage(). On repère le DERNIER __clear__ et on
 *   n'effectue le rendu qu'à partir des traits qui le suivent.
 *
 *   Exemple : [A, B, __clear__, C, D]  →  seul C et D sont rendus.
 *   Si on undo le __clear__ : [A, B]  →  A et B sont rendus.
 *   Cela rend clearPage() entièrement annulable sans copie du tableau.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} strokesArray
 */
function redrawAllStrokes(ctx, strokesArray) {
  // Trouver le dernier __clear__ (point de remise à zéro)
  let startIdx = 0;
  for (let i = strokesArray.length - 1; i >= 0; i--) {
    if (strokesArray[i].tool === '__clear__') { startIdx = i + 1; break; }
  }
  for (let i = startIdx; i < strokesArray.length; i++) {
    _renderOneStroke(ctx, strokesArray[i]);
  }
}

/**
 * Rendu d'un trait unique à partir de son objet vectoriel.
 *
 * Stratégie : swap temporaire des globaux stylo (penColor, penSize,
 * penOpacity, currentTool, selectedFountainTypeIdx) avec les valeurs
 * stockées dans le trait, appel des primitives existantes, restauration.
 * → Tous les algorithmes restent 100% intacts.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} stroke
 */
function _renderOneStroke(ctx, stroke) {
  if (!stroke || stroke.tool === '__clear__') return;

  // ── Sauvegarde des globaux ────────────────────────────────
  const _color   = penColor;
  const _size    = penSize;
  const _opacity = penOpacity;
  const _tool    = currentTool;
  const _fpIdx   = selectedFountainTypeIdx;

  // ── Injection des propriétés du trait ────────────────────
  if (stroke.color   !== undefined) penColor   = stroke.color;
  if (stroke.size    !== undefined) penSize    = stroke.size;
  if (stroke.opacity !== undefined) penOpacity = stroke.opacity;
  currentTool = stroke.tool;
  if (stroke.fpIdx !== undefined) selectedFountainTypeIdx = stroke.fpIdx;

  // ── Dispatch ─────────────────────────────────────────────
  switch (stroke.tool) {

    case 'pen':
    case 'highlighter':
      // drawSmooth lit currentTool pour choisir l'algo
      drawSmooth(ctx, stroke.points);
      break;

    case 'fountain':
      // drawSmooth lit currentTool === 'fountain'
      // et selectedFountainTypeIdx pour le type de plume
      drawSmooth(ctx, stroke.points);
      break;

    case 'dot':
      drawDot(ctx, stroke.points[0]);
      break;

    case 'ruler':
      drawLine(ctx, stroke.from, stroke.to);
      break;

    case 'shape':
      drawShape(ctx, stroke.shape, stroke.x1, stroke.y1, stroke.x2, stroke.y2);
      break;

    case 'eraser':
      // destination-out : chaque point du chemin "perce" les traits dessous
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      for (const pt of stroke.points) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, stroke.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
  }

  // ── Restauration des globaux ──────────────────────────────
  penColor               = _color;
  penSize                = _size;
  penOpacity             = _opacity;
  currentTool            = _tool;
  selectedFountainTypeIdx = _fpIdx;
}

/**
 * Aperçu live de la gomme pendant le tracé (onMove).
 *
 * On refait un full-redraw des traits validés puis on superpose
 * le chemin de gomme courant (non encore validé).
 * Cohérence garantie : le résultat sera identique à l'état après
 * _commitStroke() au moment du pointerUp.
 *
 * @param {{x:number, y:number}} p - position courante du curseur
 */
function _eraserLivePreview(p) {
  // 1. Reconstruire l'état vectoriel validé
  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, pages[currentPageIdx].strokes);

  // 2. Superposer le chemin de gomme en cours
  if (currentPath.length > 0) {
    ctxStrokes.save();
    ctxStrokes.globalCompositeOperation = 'destination-out';
    ctxStrokes.fillStyle = 'rgba(0,0,0,1)';
    for (const pt of currentPath) {
      ctxStrokes.beginPath();
      ctxStrokes.arc(pt.x, pt.y, eraserSize, 0, Math.PI * 2);
      ctxStrokes.fill();
    }
    ctxStrokes.restore();
  }

  // 3. Anneau curseur sur le calque UI
  ctxUi.clearRect(0, 0, PAGE_W, PAGE_H);
  ctxUi.save();
  ctxUi.strokeStyle = '#007AFF';
  ctxUi.lineWidth   = 1.5;
  ctxUi.setLineDash([3, 3]);
  ctxUi.beginPath();
  ctxUi.arc(p.x, p.y, eraserSize, 0, Math.PI * 2);
  ctxUi.stroke();
  ctxUi.restore();
}

// ══════════════════════════════════════════
// PRIMITIVES DE TRACÉ
// (lisent les globaux penColor / penSize / penOpacity / currentTool
//  au moment de l'appel — swappés par _renderOneStroke en mode replay)
// ══════════════════════════════════════════

/**
 * Trace un chemin lissé via courbes de Bézier quadratiques.
 * Dispatch automatique : surligneur → multiply, plume → algo dédié,
 * stylo bille → largeur variable selon pression.
 */
function drawSmooth(ctx, pts) {
  if (pts.length < 2) return;
  ctx.save();

  if (currentTool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = penColor;
    ctx.lineWidth   = Math.max(penSize, 12) * 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2;
      const my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    ctx.stroke();

  } else if (currentTool === 'fountain') {
    FOUNTAIN_TYPES[selectedFountainTypeIdx]?.draw(ctx, pts);

  } else {
    ctx.globalAlpha = penOpacity;
    ctx.strokeStyle = penColor;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2;
      const my = (pts[i].y + pts[i+1].y) / 2;
      ctx.lineWidth = penSize * (0.5 + pts[i].pressure);
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    ctx.lineWidth = penSize;
    ctx.stroke();
  }
  ctx.restore();
}

/** Point d'encre (tap court ou chemin < 3 points) */
function drawDot(ctx, p) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  ctx.fillStyle   = penColor;
  ctx.beginPath();
  ctx.arc(p.x, p.y, (penSize / 2) * (0.5 + (p.pressure ?? 0.5)), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Ligne droite (outil règle) */
function drawLine(ctx, from, to) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  ctx.strokeStyle = penColor;
  ctx.lineWidth   = penSize;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x,   to.y);
  ctx.stroke();
  ctx.restore();
}

// ══════════════════════════════════════════
// STYLOS PLUME — 6 ALGORITHMES
// (lisent les globaux penColor / penSize / penOpacity —
//  swappés avant appel depuis _renderOneStroke)
// ══════════════════════════════════════════

const FOUNTAIN_TYPES = [
  { id:'classique', name:'Classique',         desc:'Largeur variable selon pression + vitesse', draw:fp_classique },
  { id:'italique',  name:'Italique',           desc:'Plume oblique 45° — calligraphie',          draw:fp_italique  },
  { id:'flex',      name:'Flex / Copperplate', desc:'Montées fines, descentes très larges',      draw:fp_flex      },
  { id:'stub',      name:'Stub (Broad)',        desc:'Plume plate, extrémités angulées',          draw:fp_stub      },
  { id:'pinceau',   name:'Pinceau japonais',   desc:'Effilochage aux bords, effet encre',        draw:fp_pinceau   },
  { id:'sketch',    name:'Sketch expressif',   desc:'Trait tremblé, style croquis',              draw:fp_sketch    },
];

function fp_classique(ctx, pts) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const pr = pts[i-1], cu = pts[i];
    const dx = cu.x - pr.x, dy = cu.y - pr.y;
    const spd = Math.sqrt(dx*dx + dy*dy) + 0.1;
    const w   = penSize * (0.4 + cu.pressure * 1.2) * Math.max(0.35, 1 - spd * 0.018);
    ctx.beginPath();
    ctx.strokeStyle = penColor;
    ctx.lineWidth   = Math.max(0.4, w);
    ctx.moveTo(pr.x, pr.y);
    ctx.lineTo(cu.x, cu.y);
    ctx.stroke();
  }
  ctx.restore();
}

function fp_italique(ctx, pts) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  for (let i = 1; i < pts.length; i++) {
    const pr = pts[i-1], cu = pts[i];
    const dx = cu.x - pr.x, dy = cu.y - pr.y;
    const ang = Math.atan2(dy, dx);
    const nib = Math.PI / 4;
    const w   = penSize * (0.15 + Math.abs(Math.cos(ang - nib)) * 1.8) * (0.5 + cu.pressure * 0.8);
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx  = -dy / len, ny = dx / len;
    const hw  = Math.max(0.3, w / 2);
    ctx.beginPath();
    ctx.fillStyle = penColor;
    ctx.moveTo(pr.x + nx*hw, pr.y + ny*hw);
    ctx.lineTo(pr.x - nx*hw, pr.y - ny*hw);
    ctx.lineTo(cu.x - nx*hw, cu.y - ny*hw);
    ctx.lineTo(cu.x + nx*hw, cu.y + ny*hw);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function fp_flex(ctx, pts) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  for (let i = 1; i < pts.length; i++) {
    const pr  = pts[i-1], cu = pts[i];
    const dx  = cu.x - pr.x, dy = cu.y - pr.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const d   = dy > 0
      ? 1 + (dy / len) * 2.5
      : 0.15 + (1 - Math.abs(dy / len)) * 0.2;
    const w  = penSize * d * (0.5 + cu.pressure * 1.5);
    const nx = -dy / len, ny = dx / len;
    const hw = Math.max(0.2, w / 2);
    ctx.beginPath();
    ctx.fillStyle = penColor;
    ctx.moveTo(pr.x + nx*hw, pr.y + ny*hw);
    ctx.lineTo(pr.x - nx*hw, pr.y - ny*hw);
    ctx.lineTo(cu.x - nx*hw, cu.y - ny*hw);
    ctx.lineTo(cu.x + nx*hw, cu.y + ny*hw);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function fp_stub(ctx, pts) {
  ctx.save();
  ctx.globalAlpha = penOpacity;
  const nib = Math.PI / 6;
  for (let i = 1; i < pts.length; i++) {
    const pr  = pts[i-1], cu = pts[i];
    const dx  = cu.x - pr.x, dy = cu.y - pr.y;
    const ang = Math.atan2(dy, dx);
    const d   = ang - nib;
    const ww  = Math.abs(penSize * 1.6 * Math.cos(d)) + Math.abs(penSize * 0.4 * Math.sin(d));
    const hw  = Math.max(0.3, ww / 2) * (0.6 + cu.pressure * 0.8);
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx  = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.fillStyle = penColor;
    ctx.moveTo(pr.x + nx*hw, pr.y + ny*hw);
    ctx.lineTo(pr.x - nx*hw, pr.y - ny*hw);
    ctx.lineTo(cu.x - nx*hw, cu.y - ny*hw);
    ctx.lineTo(cu.x + nx*hw, cu.y + ny*hw);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function fp_pinceau(ctx, pts) {
  ctx.save();
  for (let i = 1; i < pts.length; i++) {
    const pr  = pts[i-1], cu = pts[i];
    const dx  = cu.x - pr.x, dy = cu.y - pr.y;
    const spd = Math.sqrt(dx*dx + dy*dy) + 0.1;
    const bw  = penSize * (0.5 + cu.pressure * 1.8) * Math.max(0.2, 1 - spd * 0.01);
    const len = Math.max(spd, 0.01);
    const nx  = -dy / len, ny = dx / len;
    const hw  = Math.max(0.5, bw / 2);

    ctx.globalAlpha = penOpacity * 0.9;
    ctx.fillStyle   = penColor;
    ctx.beginPath();
    ctx.moveTo(pr.x + nx*hw, pr.y + ny*hw);
    ctx.lineTo(pr.x - nx*hw, pr.y - ny*hw);
    ctx.lineTo(cu.x - nx*hw, cu.y - ny*hw);
    ctx.lineTo(cu.x + nx*hw, cu.y + ny*hw);
    ctx.closePath();
    ctx.fill();

    if (i % 3 === 0) {
      ctx.globalAlpha = penOpacity * 0.2;
      for (let b = 0; b < 3; b++) {
        const off = hw * (0.8 + Math.random() * 0.5) * (Math.random() > 0.5 ? 1 : -1);
        const j   = (Math.random() - 0.5) * 4;
        ctx.beginPath();
        ctx.strokeStyle = penColor;
        ctx.lineWidth   = 0.4;
        ctx.lineCap     = 'round';
        ctx.moveTo(pr.x + nx*off + j, pr.y + ny*off + j);
        ctx.lineTo(cu.x + nx*off + j, cu.y + ny*off + j);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function fp_sketch(ctx, pts) {
  ctx.save();
  ctx.lineCap     = 'round';
  ctx.strokeStyle = penColor;

  ctx.globalAlpha = penOpacity * 0.85;
  ctx.lineWidth   = penSize * 0.6;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const wx = pts[i].x + (Math.random() - 0.5) * 0.8;
    const wy = pts[i].y + (Math.random() - 0.5) * 0.8;
    i === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
  }
  ctx.stroke();

  if (pts.length > 3) {
    ctx.globalAlpha = penOpacity * 0.3;
    ctx.lineWidth   = penSize * 0.25;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const nx = pts[i].x + 1.2 + (Math.random() - 0.5) * 1.5;
      const ny = pts[i].y + 0.6 + (Math.random() - 0.5) * 1.5;
      i === 0 ? ctx.moveTo(nx, ny) : ctx.lineTo(nx, ny);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ══════════════════════════════════════════
// FORMES GÉOMÉTRIQUES
// ══════════════════════════════════════════

const SHAPES = [
  { id:'rect',     emoji:'⬛', label:'Rectangle' },
  { id:'circle',   emoji:'⭕', label:'Cercle'    },
  { id:'triangle', emoji:'🔺', label:'Triangle'  },
  { id:'arrow',    emoji:'➡️', label:'Flèche'    },
  { id:'line',     emoji:'➖', label:'Ligne'      },
  { id:'star',     emoji:'⭐', label:'Étoile'    },
  { id:'diamond',  emoji:'🔷', label:'Losange'   },
  { id:'hex',      emoji:'⬡', label:'Hexagone'  },
];

function drawShape(ctx, shape, x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const w  = Math.abs(x2 - x1);
  const h  = Math.abs(y2 - y1);

  ctx.save();
  ctx.strokeStyle = penColor;
  ctx.lineWidth   = penSize;
  ctx.globalAlpha = penOpacity;
  ctx.beginPath();

  switch (shape) {
    case 'rect':
      ctx.rect(Math.min(x1,x2), Math.min(y1,y2), w, h);
      break;
    case 'circle':
      ctx.ellipse(cx, cy, w/2, h/2, 0, 0, Math.PI*2);
      break;
    case 'triangle':
      ctx.moveTo(cx, Math.min(y1,y2));
      ctx.lineTo(Math.max(x1,x2), Math.max(y1,y2));
      ctx.lineTo(Math.min(x1,x2), Math.max(y1,y2));
      ctx.closePath();
      break;
    case 'arrow':
      ctx.moveTo(x1, cy); ctx.lineTo(x2, cy);
      ctx.moveTo(x2-14, cy-9); ctx.lineTo(x2, cy); ctx.lineTo(x2-14, cy+9);
      break;
    case 'line':
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      break;
    case 'star':
      _drawStar(ctx, cx, cy, 5, w/2, w/4);
      break;
    case 'diamond':
      ctx.moveTo(cx, Math.min(y1,y2));
      ctx.lineTo(Math.max(x1,x2), cy);
      ctx.lineTo(cx, Math.max(y1,y2));
      ctx.lineTo(Math.min(x1,x2), cy);
      ctx.closePath();
      break;
    case 'hex':
      _drawHex(ctx, cx, cy, Math.min(w,h)/2);
      break;
  }
  ctx.stroke();
  ctx.restore();
}

function _drawStar(ctx, cx, cy, n, R, r) {
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a   = (i * Math.PI / n) - Math.PI / 2;
    i === 0
      ? ctx.moveTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a))
      : ctx.lineTo(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
  }
  ctx.closePath();
}

function _drawHex(ctx, cx, cy, r) {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0
      ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
      : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

// ══════════════════════════════════════════
// COMPOSANTS ÉLECTRONIQUES
// ══════════════════════════════════════════

const CIRCUIT_COMPS = [
  {
    sym: '⚡', name: 'Résistance',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y+20); ctx.lineTo(x+10, y+20);
      ctx.rect(x+10, y+12, 60, 16);
      ctx.moveTo(x+70, y+20); ctx.lineTo(x+80, y+20);
      ctx.stroke(); ctx.restore();
    },
  },
  {
    sym: '⊡', name: 'Condensateur',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y+20); ctx.lineTo(x+30, y+20);
      ctx.moveTo(x+30, y+8); ctx.lineTo(x+30, y+32);
      ctx.moveTo(x+36, y+8); ctx.lineTo(x+36, y+32);
      ctx.moveTo(x+36, y+20); ctx.lineTo(x+66, y+20);
      ctx.stroke(); ctx.restore();
    },
  },
  {
    sym: '∿', name: 'Bobine',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y+20);
      for (let i = 0; i < 4; i++) ctx.arc(x+15+i*15, y+20, 8, -Math.PI, 0, true);
      ctx.lineTo(x+80, y+20);
      ctx.stroke(); ctx.restore();
    },
  },
  {
    sym: '⊕', name: 'Source tension',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y+20); ctx.lineTo(x+20, y+20);
      ctx.arc(x+40, y+20, 20, Math.PI, 0, false);
      ctx.moveTo(x+60, y+20); ctx.lineTo(x+80, y+20);
      ctx.stroke();
      ctx.fillStyle = penColor; ctx.font = '12px serif';
      ctx.fillText('+', x+35, y+16); ctx.fillText('−', x+44, y+28);
      ctx.restore();
    },
  },
  {
    sym: '▷|', name: 'Diode',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.fillStyle = penColor;
      ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x, y+20); ctx.lineTo(x+20, y+20);
      ctx.moveTo(x+20, y+8); ctx.lineTo(x+50, y+20); ctx.lineTo(x+20, y+32);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x+50, y+8); ctx.lineTo(x+50, y+32);
      ctx.moveTo(x+50, y+20); ctx.lineTo(x+80, y+20);
      ctx.stroke(); ctx.restore();
    },
  },
  {
    sym: '⏚', name: 'Masse',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x+40, y); ctx.lineTo(x+40, y+20);
      ctx.moveTo(x+20, y+20); ctx.lineTo(x+60, y+20);
      ctx.moveTo(x+28, y+28); ctx.lineTo(x+52, y+28);
      ctx.moveTo(x+35, y+36); ctx.lineTo(x+45, y+36);
      ctx.stroke(); ctx.restore();
    },
  },
];

// ══════════════════════════════════════════
// COMPOSANTS CHIMIQUES
// ══════════════════════════════════════════

const CHEM_COMPS = [
  {
    sym: '⬡', name: 'Benzène',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      const r = 24;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        i === 0
          ? ctx.moveTo(x+40 + r*Math.cos(a), y+30 + r*Math.sin(a))
          : ctx.lineTo(x+40 + r*Math.cos(a), y+30 + r*Math.sin(a));
      }
      ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x+40, y+30, 14, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    },
  },
  {
    sym: '⊸', name: 'Liaison simple',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath(); ctx.moveTo(x+5, y+20); ctx.lineTo(x+75, y+20); ctx.stroke();
      ctx.restore();
    },
  },
  {
    sym: '⟿', name: 'Liaison double',
    draw: (ctx, x, y) => {
      ctx.save(); ctx.strokeStyle = penColor; ctx.lineWidth = Math.max(1.5, penSize * 0.6);
      ctx.beginPath();
      ctx.moveTo(x+5, y+16); ctx.lineTo(x+75, y+16);
      ctx.moveTo(x+5, y+24); ctx.lineTo(x+75, y+24);
      ctx.stroke(); ctx.restore();
    },
  },
];

// ══════════════════════════════════════════
// PALETTE DE COULEURS
// ══════════════════════════════════════════

const PALETTE = [
  '#1a1a2e','#16213e','#0f3460','#533483',
  '#e94560','#f5a623','#f8e71c','#7ed321',
  '#4a90e2','#50e3c2','#bd10e0','#9013fe',
  '#ff6b6b','#ffa07a','#20b2aa','#87ceeb',
  '#ffffff','#d0d0d0','#a0a0a0','#606060',
  '#000000','#1a1a1a','#333333','#4a4a4a',
];

function buildColorGrid() {
  const g = $('color-grid');
  g.innerHTML = '';
  PALETTE.forEach(c => {
    const sw = el('div', 'c-swatch' + (c === penColor ? ' sel' : ''));
    sw.style.background = c;
    sw.setAttribute('data-c', c);
    sw.onclick = () => {
      document.querySelectorAll('.c-swatch').forEach(x => x.classList.remove('sel'));
      sw.classList.add('sel');
      setColor(c);
    };
    g.appendChild(sw);
  });
}

function setColor(c) {
  penColor = c;
  if ($('color-dot'))    $('color-dot').style.background = c;
  if ($('color-picker') && c.length === 7) $('color-picker').value = c;
  if ($('hex-input'))    $('hex-input').value = c;
}

function setColorFromHex(v) {
  v = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) setColor(v);
}

// ══════════════════════════════════════════
// RACCOURCIS CLAVIER LASSO + PÂTE
// ══════════════════════════════════════════

document.addEventListener('keydown', e => {
  // Only active in editor
  if (!document.getElementById('editor')?.classList.contains('open')) return;
  // Ignore if typing in a text input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (currentTool !== 'lasso') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    lassoDelete?.();
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'c') { e.preventDefault(); lassoCopy?.(); }
    if (e.key === 'x') { e.preventDefault(); lassoCut?.(); }
    if (e.key === 'v') { e.preventDefault(); lassoPaste?.(); }
    if (e.key === 'a') {
      // Sélectionner tous les strokes
      e.preventDefault();
      setTool('lasso');
      const strokes = pages[currentPageIdx]?.strokes ?? [];
      LASSO.selectedIdx = strokes.map((_, i) => i).filter(i => strokes[i].tool !== '__clear__');
      LASSO.phase = 'select';
      if (typeof _updateBbox === 'function') { _updateBbox(); _drawSelectionOverlay(); _showLassoToolbar(); }
    }
  }
  if (e.key === 'Escape') {
    clearLasso?.();
  }
});