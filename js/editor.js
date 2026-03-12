/* ═══════════════════════════════════════════════
   editor.js — Moteur de l'éditeur (Système Vectoriel)

   CHANGEMENTS PAR RAPPORT À LA VERSION BASE64
   ─────────────────────────────────────────────
   • savePage()  : ne fait plus de toDataURL(). Sauvegarde uniquement
                   le bg courant et met à jour la miniature.
   • switchToPage(): efface ctxStrokes puis appelle redrawAllStrokes().
                   Plus aucun Image().onload pour les traits.
   • undo()      : pop() le dernier trait de pages[].strokes,
                   le pousse dans redoStack, efface + redraw.
   • redo()      : inverse de undo().
   • clearPage() : pousse { tool:'__clear__' } dans strokes[],
                   ce qui est reconnu par redrawAllStrokes() comme
                   un point de remise à zéro — entièrement annulable
                   via undo() sans copie du tableau.
   • saveUndo()  : SUPPRIMÉE. Chaque _commitStroke() est son propre
                   point d'annulation atomique.
   • updateThumbnail() : utilise redrawAllStrokes() à l'échelle de
                   la miniature (200×283px).
═══════════════════════════════════════════════ */

// ══════════════════════════════════════════
// INITIALISATION DES CANVASES
// ══════════════════════════════════════════

function initCanvases() {
  cBg      = $('c-bg');
  cPdf     = $('c-pdf');
  cStrokes = $('c-strokes');
  cTemp    = $('c-temp');
  cUi      = $('c-ui');
  cAi      = $('c-ai');      // Couche suggestions IA (pointer-events: none)

  ctxBg      = cBg.getContext('2d');
  ctxPdf     = cPdf.getContext('2d');
  ctxStrokes = cStrokes.getContext('2d');
  ctxTemp    = cTemp.getContext('2d');
  ctxUi      = cUi.getContext('2d');
  ctxAi      = cAi.getContext('2d');

  [cBg, cPdf, cStrokes, cTemp, cUi, cAi].forEach(c => {
    c.width  = PAGE_W;
    c.height = PAGE_H;
  });

  const w = $('canvas-wrapper');
  w.style.width  = PAGE_W + 'px';
  w.style.height = PAGE_H + 'px';

  bindCanvasEvents(); // défini dans tools.js
}

// ══════════════════════════════════════════
// OUVERTURE / FERMETURE DE L'ÉDITEUR
// ══════════════════════════════════════════

function openEditor(nb) {
  closeFab();
  currentNotebook = nb;

  $('dashboard').classList.add('editor-open');
  $('editor').classList.add('open');
  
  $('zoom-ctrl').style.display = 'flex';

  $('note-title').value = nb ? nb.title : 'Nouvelle note';

  if (!cBg) initCanvases();

  // Initialiser avec le nouveau format vectoriel :
  // chaque page possède strokes[] et bg, pas de strokesData
  pages = [{ bg: 'grid-small', strokes: [] }];
  currentPageIdx = 0;
  redoStack      = [];
  currentBg      = 'grid-small';

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  ctxPdf.clearRect(0, 0, PAGE_W, PAGE_H);
  if (ctxAi) ctxAi.clearRect(0, 0, PAGE_W, PAGE_H);
  aiSuggestions = [];
  aiLastHash    = null;

  drawBackground();
  buildAllPanels();  // défini dans panels.js
  updatePagesList();
  updateStatusBar();
  setTool('pen');
  setColor('#1a1a2e');
}

function closeEditor() {
  $('dashboard').classList.remove('editor-open');
  $('editor').classList.remove('open');
  
  $('zoom-ctrl').style.display = 'none';
  closeAllPanels();

  if (currentNotebook) {
    const nb = notebooks.find(n => n.id === currentNotebook.id);
    if (nb) nb.title = $('note-title').value || nb.title;
    renderNotebooks();
  }
}

// ══════════════════════════════════════════
// FONDS DE PAGE
// ══════════════════════════════════════════

const BG_TYPES = {
  'blank': {
    label: 'Blanc',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    },
  },
  'grid-small': {
    label: 'Petits carreaux',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d4d8f0';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= w; x += 19) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += 19) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    },
  },
  'grid-large': {
    label: 'Grands carreaux',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#b8c0e0';
      ctx.lineWidth = 0.7;
      for (let x = 0; x <= w; x += 38) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y <= h; y += 38) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
    },
  },
  'lines': {
    label: 'Lignes',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c8d0f0';
      ctx.lineWidth = 0.8;
      for (let y = 30; y <= h; y += 28) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      ctx.strokeStyle = '#ffcdd2';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(60, 0); ctx.lineTo(60, h); ctx.stroke();
    },
  },
  'dots': {
    label: 'Pointillés',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b0b8d8';
      for (let x = 20; x <= w; x += 19) {
        for (let y = 20; y <= h; y += 19) {
          ctx.beginPath(); ctx.arc(x, y, 0.8, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
  },
  'isometric': {
    label: 'Isométrique',
    fn: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d0d8f0';
      ctx.lineWidth   = 0.5;
      const dy = 24 * Math.sqrt(3) / 2;
      for (let y = -dy; y < h + 50; y += dy) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let x = -h; x < w + h; x += 24) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - h, h); ctx.stroke();
      }
    },
  },
};

function drawBackground() {
  const bgDef = BG_TYPES[currentBg] || BG_TYPES['grid-small'];
  bgDef.fn(ctxBg, PAGE_W, PAGE_H);
}

// ══════════════════════════════════════════
// GESTION DES PAGES
// ══════════════════════════════════════════

function addPage() {
  savePage();
  pages.push({ bg: currentBg, strokes: [] });
  switchToPage(pages.length - 1);
  toast('✅ Nouvelle page ajoutée', 'ok');
}

/**
 * Change de page active.
 * Efface ctxStrokes et reconstruit depuis strokes[] vectoriels.
 * Plus aucun Image().onload pour les traits.
 */
function switchToPage(idx) {
  savePage();
  currentPageIdx = idx;
  const p = pages[idx];
  currentBg = p.bg;

  // ── Fond ──────────────────────────────────────────────────
  drawBackground();

  // ── Traits : reconstruction vectorielle ──────────────────
  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, p.strokes); // défini dans tools.js

  // ── IA : effacer les suggestions de la page précédente ───
  if (typeof clearAISuggestions === 'function') clearAISuggestions();
  if (typeof scheduleAIAnalysis === 'function') scheduleAIAnalysis();

  // ── PDF : toujours via Image (non vectoriel, inchangé) ────
  ctxPdf.clearRect(0, 0, PAGE_W, PAGE_H);
  if (p.pdfData) {
    const img = new Image();
    img.onload = () => ctxPdf.drawImage(img, 0, 0);
    img.src = p.pdfData;
  }

  redoStack = [];
  updatePagesList();
  updateStatusBar();
}

/**
 * Sauvegarde l'état courant de la page.
 * Dans le système vectoriel, les strokes[] sont déjà à jour en temps
 * réel via _commitStroke(). On se contente de sauvegarder le bg.
 */
function savePage() {
  if (!pages[currentPageIdx]) return;
  pages[currentPageIdx].bg = currentBg;
  updateThumbnail(currentPageIdx);
}

function deletePage(idx) {
  if (pages.length <= 1) { toast('❌ Au moins une page requise', 'err'); return; }
  pages.splice(idx, 1);
  if (currentPageIdx >= pages.length) currentPageIdx = pages.length - 1;
  switchToPage(currentPageIdx);
  updatePagesList();
}

// ── Liste des miniatures ────────────────────────────────────

function updatePagesList() {
  const list = $('pages-list');
  list.innerHTML = '';

  pages.forEach((p, i) => {
    const div = el('div', 'page-thumb' + (i === currentPageIdx ? ' active' : ''));
    div.onclick = e => { if (!e.target.classList.contains('pg-del')) switchToPage(i); };

    const c  = el('canvas');
    c.width  = 200;
    c.height = 283;
    _renderThumbnailCanvas(c, p);

    const num = el('div', 'pg-num');
    num.textContent = i + 1;

    const del = el('button', 'pg-del');
    del.textContent = '×';
    del.onclick = e => { e.stopPropagation(); deletePage(i); };

    div.appendChild(c); div.appendChild(num); div.appendChild(del);
    list.appendChild(div);
  });
}

/**
 * Met à jour la miniature d'une page dans la sidebar.
 * Redessine le fond + les traits vectoriels à l'échelle 200×283.
 */
function updateThumbnail(idx) {
  const thumbs = document.querySelectorAll('.page-thumb');
  if (!thumbs[idx]) return;
  const c = thumbs[idx].querySelector('canvas');
  if (!c) return;
  _renderThumbnailCanvas(c, pages[idx]);
}

/**
 * Dessine une page complète sur un canvas miniature (200×283).
 * Scale automatique depuis l'espace PAGE_W × PAGE_H.
 *
 * @param {HTMLCanvasElement} c  - canvas cible (200×283)
 * @param {Object}            p  - objet page { bg, strokes, pdfData? }
 */
function _renderThumbnailCanvas(c, p) {
  const tc  = c.getContext('2d');
  const scX = c.width  / PAGE_W;  // 200 / 794  ≈ 0.252
  const scY = c.height / PAGE_H;  // 283 / 1123 ≈ 0.252

  // 1. Fond
  (BG_TYPES[p.bg] || BG_TYPES['grid-small']).fn(tc, c.width, c.height);

  // 2. Traits vectoriels : on scale le contexte avant de redraw
  tc.save();
  tc.scale(scX, scY);
  redrawAllStrokes(tc, p.strokes); // défini dans tools.js
  tc.restore();

  // 3. PDF (optionnel)
  if (p.pdfData) {
    const img = new Image();
    img.onload = () => tc.drawImage(img, 0, 0, c.width, c.height);
    img.src = p.pdfData;
  }
}

// ══════════════════════════════════════════
// ANNULATION / RÉTABLISSEMENT (Système Vectoriel)
// ══════════════════════════════════════════

/**
 * Annule le dernier trait de la page courante.
 *
 * On pop() le dernier élément de pages[].strokes (qu'il s'agisse d'un
 * trait ordinaire ou d'un sentinel __clear__) et on le conserve dans
 * redoStack pour permettre le rétablissement.
 * Ensuite on efface ctxStrokes et on reconstruit depuis les strokes
 * restants via redrawAllStrokes().
 *
 * Note : saveUndo() n'est plus nécessaire — chaque _commitStroke()
 * est son propre point d'annulation atomique.
 */
function undo() {
  const page = pages[currentPageIdx];
  if (!page || page.strokes.length === 0) {
    toast('Rien à annuler', '');
    return;
  }

  const stroke = page.strokes.pop();
  redoStack.push(stroke);

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, page.strokes);

  updateThumbnail(currentPageIdx);

  // IA : invalider les suggestions et ré-analyser l'état courant
  if (typeof clearAISuggestions === 'function') clearAISuggestions();
  if (typeof scheduleAIAnalysis === 'function') scheduleAIAnalysis();
}

/**
 * Rétablit le dernier trait annulé.
 */
function redo() {
  if (redoStack.length === 0) { toast('Rien à refaire', ''); return; }

  const stroke = redoStack.pop();
  pages[currentPageIdx].strokes.push(stroke);

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  redrawAllStrokes(ctxStrokes, pages[currentPageIdx].strokes);

  updateThumbnail(currentPageIdx);

  // IA : invalider les suggestions et ré-analyser l'état courant
  if (typeof clearAISuggestions === 'function') clearAISuggestions();
  if (typeof scheduleAIAnalysis === 'function') scheduleAIAnalysis();
}

// ══════════════════════════════════════════
// ZOOM
// ══════════════════════════════════════════

function zoom(delta) {
  zoomLevel = Math.max(0.25, Math.min(4, zoomLevel + delta));
  _applyZoom();
}

function resetZoom() {
  zoomLevel = 1;
  _applyZoom();
}

function _applyZoom() {
  const w = $('canvas-wrapper');
  w.style.transform       = `scale(${zoomLevel})`;
  w.style.transformOrigin = 'top center';
  const pct = Math.round(zoomLevel * 100) + '%';
  $('zoom-lbl').textContent = pct;
  $('sb-zoom').textContent  = pct;
}

// ══════════════════════════════════════════
// EFFACER LA PAGE / EXPORT
// ══════════════════════════════════════════

/**
 * Efface visuellement la page en poussant un sentinel { tool:'__clear__' }
 * dans strokes[]. Ce sentinel est reconnu par redrawAllStrokes() qui ne
 * rend alors que les traits qui le suivent (aucun au moment du clear).
 *
 * L'action est entièrement annulable via undo() : un simple pop() du
 * sentinel restaure tous les traits précédents sans aucune copie.
 */
function clearPage() {
  if (!confirm('Effacer toute cette page ?')) return;

  const page = pages[currentPageIdx];
  if (!page) return;

  // Pousser le sentinel via le système de commit (met à jour miniature
  // et invalide redoStack comme n'importe quel autre trait)
  page.strokes.push({ tool: '__clear__' });
  redoStack = [];

  ctxStrokes.clearRect(0, 0, PAGE_W, PAGE_H);
  // Pas besoin de redraw : tout est effacé après le __clear__

  ctxPdf.clearRect(0, 0, PAGE_W, PAGE_H);
  page.pdfData = null;

  // IA : effacer les suggestions (la page est vide)
  if (typeof clearAISuggestions === 'function') clearAISuggestions();

  updateThumbnail(currentPageIdx);
  toast('✅ Page effacée (annulable avec Ctrl+Z)', 'ok');
}

function exportPNG() {
  const oc  = el('canvas');
  oc.width  = PAGE_W;
  oc.height = PAGE_H;
  const ctx = oc.getContext('2d');
  ctx.drawImage(cBg,      0, 0);
  ctx.drawImage(cPdf,     0, 0);
  ctx.drawImage(cStrokes, 0, 0);
  const a  = el('a');
  a.download = `neo-note-${Date.now()}.png`;
  a.href     = oc.toDataURL();
  a.click();
  toast('✅ Page exportée', 'ok');
}

// ══════════════════════════════════════════
// BARRE DE STATUT
// ══════════════════════════════════════════

function updateStatusBar() {
  $('sb-page').textContent = `${currentPageIdx + 1}/${pages.length}`;
}