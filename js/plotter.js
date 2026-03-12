/* ═══════════════════════════════════════════════
   plotter.js — Traceur de fonctions mathématiques
   • Affiche f(x) sur un canvas 240×180
   • Grille, axes, étiquette de la fonction
   • Insertion du graphe sur la page courante
═══════════════════════════════════════════════ */

function plotFunction() {
  const fnStr  = $('fn-input').value;
  const xmin   = +$('fn-xmin').value;
  const xmax   = +$('fn-xmax').value;
  const canvas = $('fn-canvas');
  const ctx    = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // Fond blanc
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  // ── Grille ──────────────────────────────
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth   = 0.8;
  for (let i = 0; i <= 10; i++) {
    const x = i * W / 10;
    const y = i * H / 10;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // ── Axes (x=0 et y=0) ───────────────────
  ctx.strokeStyle = '#999';
  ctx.lineWidth   = 1.2;

  const zeroX = (-xmin / (xmax - xmin)) * W; // position x=0
  const zeroY = H / 2;                        // position y=0 (centré)

  ctx.beginPath(); ctx.moveTo(zeroX, 0);  ctx.lineTo(zeroX, H);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, zeroY);  ctx.lineTo(W,     zeroY); ctx.stroke();

  // ── Validation de la fonction ────────────
  let fn;
  try {
    fn = new Function('x', 'return ' + fnStr);
    fn(0); // test rapide
  } catch {
    toast('❌ Formule invalide', 'err');
    return;
  }

  // ── Calcul des valeurs ───────────────────
  const STEPS  = 400;
  const yvals  = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = xmin + (xmax - xmin) * (i / STEPS);
    try    { yvals.push(fn(x)); }
    catch  { yvals.push(NaN); }
  }

  const valid = yvals.filter(y => isFinite(y));
  if (!valid.length) { toast('❌ Aucune valeur calculable', 'err'); return; }

  const ymin  = Math.min(...valid);
  const ymax  = Math.max(...valid);
  const yrng  = ymax - ymin || 1;

  // ── Tracé de la courbe ───────────────────
  ctx.strokeStyle = penColor;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= STEPS; i++) {
    if (!isFinite(yvals[i])) { first = true; continue; }
    const px = (i / STEPS) * W;
    const py = H - ((yvals[i] - ymin) / yrng) * H;
    first ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    first = false;
  }
  ctx.stroke();

  // ── Étiquette ────────────────────────────
  ctx.fillStyle = '#444';
  ctx.font      = '10px DM Mono, monospace';
  ctx.fillText(`f(x) = ${fnStr}`, 6, 13);

  toast('✅ Courbe tracée', 'ok');
}

/**
 * Insère le graphe tracé au centre de la page courante
 */
function insertFunction() {
  const c = $('fn-canvas');
  saveUndo();
  ctxStrokes.drawImage(
    c,
    PAGE_W / 2 - c.width  / 2,
    PAGE_H / 2 - c.height / 2
  );
  savePage();
  toast('✅ Graphe inséré sur la page', 'ok');
}
