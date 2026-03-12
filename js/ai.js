/* ═══════════════════════════════════════════════
   ai.js — IA Mathématique via Texify
   ────────────────────────────────────────────────

   MODÈLE : Xenova/texify
   ─────────────────────────
   Entraîné sur des formules mathématiques manuscrites.
   Retourne du LaTeX : "3 + 7 =", "\frac{1}{2}", "x^{2}"
   Reconnaît +, −, ×, ÷, =, √, fractions, exposants.

   PIPELINE
   ─────────────────────────────────────────────────
   _commitStroke()
     └→ scheduleAIAnalysis()          [debounce 2 s]
           └→ runAIAnalysis()
                 ├→ _snapshotWrittenArea()
                 ├→ texify pipeline → LaTeX string
                 ├→ parseLatexMath()   → {expr, result}
                 └→ _drawOneSuggestion() sur cAi
═══════════════════════════════════════════════ */

const AI_DEBOUNCE_MS  = 2000;
const AI_SNAP_SCALE   = 0.75;      // plus haute résolution pour texify
const AI_COLOR_TEXT   = '#5060a0';
const AI_COLOR_BADGE  = 'rgba(235,240,255,0.92)';
const AI_COLOR_BORDER = '#b8c8f0';

let _pipeline    = null;
let _modelStatus = 'not_loaded';

// ==============================================
// CHARGEMENT - delegue au Worker
// ==============================================

function loadAIModel() {
  if (_modelStatus === 'ready' || _modelStatus === 'downloading') return;

  _modelStatus = 'downloading';
  _setStatus('downloading');
  _showLoadingBar(0, 'Demarrage du Worker...');
  _dbg('Chargement Texify dans Worker');

  const transformersUrl = window.transformersReady
    ? new URL('./lib/transformers.min.js', location.href).href
    : 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

  const modelPath = new URL('./models/', location.href).href;

  try {
    _worker = new Worker(new URL('./js/ai-worker.js', location.href), { type: 'module' });
  } catch (e) {
    _dbg('Worker non supporte : ' + e.message);
    _modelStatus = 'error'; _setStatus('error');
    _showOverlayError('Web Worker non supporte', e.message);
    return;
  }

  _worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      _showLoadingBar(msg.pct ?? 0, msg.file || '');
      _dbg('[' + msg.status + '] ' + msg.file);
      return;
    }
    if (msg.type === 'ready') {
      _modelStatus = 'ready'; aiReady = true;
      _setStatus('idle'); _hideLoadingBar();
      _dbg('Texify pret (Worker)');
      toast('IA Maths prete ! Ecrivez une equation...', 'ok');
      scheduleAIAnalysis();
      return;
    }
    if (msg.type === 'result') {
      if (msg.id !== _analyzeId) return;
      _onWorkerResult(msg.latex);
      return;
    }
    if (msg.type === 'error') {
      _dbg('Worker error: ' + msg.message);
      if (_modelStatus !== 'ready') {
        _modelStatus = 'error'; aiReady = false; _setStatus('error');
        _showOverlayError('Erreur Worker', msg.message);
      } else { _setStatus('idle'); }
      return;
    }
  };

  _worker.onerror = (e) => {
    _dbg('Worker crash : ' + e.message);
    _modelStatus = 'error'; aiReady = false; _setStatus('error');
  };

  _worker.postMessage({ type: 'load', modelPath, transformersUrl });
}

// ==============================================
// DECLENCHEMENT (non bloquant - main thread rend la main)
// ==============================================

function scheduleAIAnalysis() {
  if (!aiEnabled) return;
  clearTimeout(aiDebounceTimer);
  aiDebounceTimer = setTimeout(_sendToWorker, AI_DEBOUNCE_MS);
}

function _sendToWorker() {
  if (!aiEnabled || !ctxAi || !_worker || _modelStatus !== 'ready') return;

  const strokes  = _getActiveStrokes(pages[currentPageIdx]?.strokes ?? []);
  const drawable = strokes.filter(s => s.points?.length > 1);
  if (!drawable.length) {
    ctxAi.clearRect(0, 0, PAGE_W, PAGE_H);
    aiSuggestions = []; _setStatus('idle'); return;
  }

  const hash = strokes.length + '|' + (strokes[strokes.length-1]?.points?.length ?? 0);
  if (hash === aiLastHash) return;

  // Snapshot instantane sur le main thread (lecture canvas = rapide)
  const snap = _snapshotWrittenArea();
  if (!snap) { _setStatus('idle'); return; }

  _analyzeId++;
  _setStatus('analyzing');
  _dbg('runAIAnalysis - ' + drawable.length + ' strokes -> Worker#' + _analyzeId);

  // === ENVOYER AU WORKER ET RENDRE LA MAIN IMMEDIATEMENT ===
  // Le dessin reste fluide pendant l'inference ONNX (thread separe)
  _worker.postMessage({ type: 'analyze', id: _analyzeId, dataUrl: snap.dataUrl });
  _pendingSnap = snap;
}

let _pendingSnap = null;

function _onWorkerResult(rawLatex) {
  const snap = _pendingSnap;
  if (!snap) { _setStatus('idle'); return; }

  _dbg('Texify : "' + rawLatex + '"');
  console.group('[Texify] Resultat Worker');
  console.log('LaTeX brut :', JSON.stringify(rawLatex));

  const exprs = parseLatexMath(rawLatex, snap);
  if (exprs.length) {
    exprs.forEach(e => console.log('"' + e.expr + '" = ' + e.result));
  } else {
    console.warn('Aucune expression - LaTeX:', JSON.stringify(rawLatex));
  }
  console.groupEnd();

  ctxAi.clearRect(0, 0, PAGE_W, PAGE_H);
  aiSuggestions = exprs;
  exprs.forEach(e => _drawOneSuggestion(e));

  _setStatus(exprs.length > 0 ? 'found' : 'idle');
  aiLastHash = null;
}


// ══════════════════════════════════════════════
// SNAPSHOT
// ══════════════════════════════════════════════

function _snapshotWrittenArea() {
  const strokes  = _getActiveStrokes(pages[currentPageIdx]?.strokes ?? []);
  const drawable = strokes.filter(s => s.points?.length > 1
    && s.tool !== 'eraser' && s.tool !== '__clear__');
  if (!drawable.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  drawable.forEach(s => s.points.forEach(p => {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }));

  const mg   = 28;
  const srcX = Math.max(0, minX - mg);
  const srcY = Math.max(0, minY - mg);
  const srcW = Math.min(PAGE_W - srcX, maxX - minX + mg * 2);
  const srcH = Math.min(PAGE_H - srcY, maxY - minY + mg * 2);
  if (srcW < 10 || srcH < 10) return null;

  const tW   = Math.max(64,  Math.round(srcW * AI_SNAP_SCALE));
  const tH   = Math.max(32,  Math.round(srcH * AI_SNAP_SCALE));
  const snap = document.createElement('canvas');
  snap.width = tW; snap.height = tH;
  const ctx  = snap.getContext('2d');

  // Fond blanc — texify attend fond clair / encre sombre
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tW, tH);

  // Redessiner les traits en noir pour maximiser le contraste OCR
  ctx.save();
  ctx.scale(AI_SNAP_SCALE, AI_SNAP_SCALE);
  ctx.translate(-srcX, -srcY);
  drawable.forEach(s => {
    _renderOneStroke(ctx, { ...s, color: '#111111', opacity: 1, size: Math.max(2.5, s.size ?? 2.5) });
  });
  ctx.restore();

  return {
    dataUrl: snap.toDataURL('image/png'),
    originX: srcX, originY: srcY,
    width: srcW, height: srcH,
    scaleX: AI_SNAP_SCALE, scaleY: AI_SNAP_SCALE,
  };
}

// ══════════════════════════════════════════════
// PARSING LATEX → MATH ÉVALUABLE
// ══════════════════════════════════════════════

/**
 * Convertit une sortie Texify en expression évaluable.
 * 
 * Deux modes :
 *   1. NUMÉRIQUE  — "3 + 7 ="      → 10
 *   2. ALGÉBRIQUE — "2x + 1 = 5"  → x = 2
 *                   "x² - 4 = 0"  → x = ±2
 */
function parseLatexMath(latex, snap) {
  if (!latex?.trim()) return [];

  console.log('  [parseLatex] brut :', JSON.stringify(latex));

  // ── Étape 1 : retirer les délimiteurs $$ ─────────────────
  let s = latex
    .replace(/\$\$/g, '')
    .replace(/\$/g,   '')
    .replace(/\s+/g,  ' ')
    .trim();

  // ── Étape 2 : lettres grecques → chiffres/variables ──────
  s = s
    .replace(/\\gamma/g,   '3')
    .replace(/\\Gamma/g,   'r')
    .replace(/\\eta/g,     '7')
    .replace(/\\tau/g,     '7')
    .replace(/\\zeta/g,    '2')
    .replace(/\\xi/g,      '3')
    .replace(/\\nu/g,      'v')
    .replace(/\\mu/g,      'u')
    .replace(/\\alpha/g,   'a')
    .replace(/\\beta/g,    'b')
    .replace(/\\delta/g,   'd')
    .replace(/\\epsilon/g, 'e')
    .replace(/\\lambda/g,  'x')
    .replace(/\\pi/g,      'n')
    .replace(/\\rho/g,     'p')
    .replace(/\\sigma/g,   'o')
    .replace(/\\omega/g,   'w')
    .replace(/\\theta/g,   '0');

  // ── Étape 3 : opérateurs LaTeX → ASCII ───────────────────
  s = s
    .replace(/\\times/g,  '*')
    .replace(/\\cdot/g,   '*')
    .replace(/\\div/g,    '/')
    .replace(/\\pm/g,     '±')

    // Fractions \frac{a}{b} → (a)/(b)
    .replace(/\\frac\s*\{([^}]+)\}\s*\{([^}]+)\}/g, (_, n, d) => `(${n})/(${d})`)

    // Exposants ^{n} ou ^2
    .replace(/\^\s*\{([^}]+)\}/g, '^($1)')
    .replace(/\^(\d+)/g,          '^$1')

    // Racine carrée \sqrt{x}
    .replace(/\\sqrt\s*\{([^}]+)\}/g, 'sqrt($1)')

    // Supprimer accolades et commandes LaTeX restantes
    .replace(/[{}]/g,          ' ')
    .replace(/\\[a-zA-Z]+/g,   ' ')

    .replace(/,/g, '.')
    .replace(/\s+/g, ' ').trim();

  console.log('  [parseLatex] après normalisation :', JSON.stringify(s));

  // ── Étape 4 : corrections OCR ────────────────────────────
  s = s
    .replace(/\bl\b/g, '1')
    .replace(/\bI\b/g, '1')
    .replace(/\bO\b/g, '0')
    .replace(/\bS\b/g, '5')
    .replace(/\bt\b/g, '+')
    .replace(/\bz\b/g, '2');

  console.log('  [parseLatex] après OCR :', JSON.stringify(s));

  // ── Étape 5 : détecter "=" ───────────────────────────────
  const hasEq = s.includes('=');
  if (!hasEq) {
    console.warn('  [parseLatex] ⚠️ pas de "=" — ignorer');
    return [];
  }

  // ── Étape 6 : détecter si expression algébrique ──────────
  // Une variable = toute lettre isolée (x, y, n, a, b, k…) entourée de non-lettres
  const varMatch = s.match(/(?<![a-zA-Z])([a-df-wyzA-DF-WYZ])(?![a-zA-Z])/);
  const variable = varMatch ? varMatch[1] : null;

  const fontSize = Math.max(28, Math.min(58, snap.height * 0.6));
  const x = snap.originX + snap.width + 28;
  const y = snap.originY + snap.height * 0.68;

  if (variable) {
    // ══ MODE ALGÉBRIQUE — nerdamer.solve ════════════════════
    return _solveAlgebraic(s, variable, { x, y, fontSize });
  } else {
    // ══ MODE NUMÉRIQUE ══════════════════════════════════════
    return _solveNumeric(s, { x, y, fontSize });
  }
}

// ══════════════════════════════════════════════
// RÉSOLUTION ALGÉBRIQUE (nerdamer)
// ══════════════════════════════════════════════

function _solveAlgebraic(eq, variable, pos) {
  if (typeof nerdamer === 'undefined') {
    console.warn('  [algèbre] ❌ nerdamer non chargé');
    return [];
  }

  try {
    console.log(`  [algèbre] Résoudre "${eq}" pour ${variable}`);

    // nerdamer.solve attend "expr = 0" OU "lhs = rhs"
    // On lui passe la chaîne directement
    const solutions = nerdamer.solve(eq, variable);
    const solArr = solutions.toString()
      .replace(/^\[/, '').replace(/\]$/, '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (!solArr.length) {
      console.warn('  [algèbre] ⚠️ aucune solution');
      return [];
    }

    console.log(`  [algèbre] ✅ solutions :`, solArr);

    // Formater la réponse : "x = 2" ou "x = ±2"
    let resultText;
    if (solArr.length === 1) {
      resultText = `${variable} = ${_niceNum(solArr[0])}`;
    } else if (solArr.length === 2 && solArr[0] === '-' + solArr[1]) {
      resultText = `${variable} = ±${_niceNum(solArr[1])}`;
    } else {
      resultText = solArr.map(s => `${variable}=${_niceNum(s)}`).join('  ');
    }

    return [{ expr: eq, result: resultText, ...pos, isAlgebra: true }];
  } catch(err) {
    console.error('  [algèbre] ❌', err.message);
    return [];
  }
}

function _niceNum(s) {
  // Convertir les fractions nerdamer "1/2" → "0.5", entiers "2" → "2"
  try {
    if (s.includes('/')) {
      const [n, d] = s.split('/').map(Number);
      if (!isNaN(n) && !isNaN(d) && d !== 0) {
        const v = n / d;
        return Number.isInteger(v) ? String(v) : parseFloat(v.toPrecision(4)).toString();
      }
    }
    const n = parseFloat(s);
    if (!isNaN(n)) return Number.isInteger(n) ? String(n) : parseFloat(n.toPrecision(4)).toString();
  } catch {}
  return s;
}

// ══════════════════════════════════════════════
// ÉVALUATION NUMÉRIQUE
// ══════════════════════════════════════════════

function _solveNumeric(s, pos) {
  // Gérer ± (±)
  let expr = s
    .replace(/=.*$/, '')           // tout avant le =
    .replace(/±/g, '+')           // ± → + pour l'éval
    .replace(/[^0-9+\-*/.()^ ]/g, '') // garder chars math
    .replace(/\^/g, '**')          // ^ → ** pour JS
    .replace(/\s+/g, ' ')
    .trim();

  console.log('  [numérique] expression :', JSON.stringify(expr));

  if (!expr || !/\d/.test(expr)) return [];
  if (!/[+\-*/]/.test(expr) && !expr.includes('**')) return [];

  const result = _safeEval(expr);
  if (result === null) return [];

  return [{ expr, result: _formatResult(result), ...pos }];
}

function _safeEval(expr) {
  try {
    const safe = expr
      .replace(/[×xX·]/g, '*').replace(/÷/g, '/')
      .replace(/[−–]/g, '-')
      .replace(/\^/g, '**')
      .replace(/sqrt\(([^)]+)\)/g, (_, v) => String(Math.sqrt(parseFloat(v))))
      .replace(/[^0-9+\-*/.() *]/g, '').trim();
    if (!safe || !/\d/.test(safe)) return null;
    // eslint-disable-next-line no-new-func
    const r = new Function('return +(' + safe + ')')();
    return typeof r === 'number' && isFinite(r) ? r : null;
  } catch { return null; }
}

function _formatResult(n) {
  if (Number.isInteger(n)) return String(n);
  return parseFloat(n.toPrecision(5)).toString();
}
// ══════════════════════════════════════════════
// RENDU SUR cAi
// ══════════════════════════════════════════════

function _drawOneSuggestion(e) {
  if (!ctxAi) return;
  const fs   = e.fontSize || 36;
  const font = `italic bold ${fs}px "DM Mono", monospace`;

  // Algebra = green badge, numeric = blue badge
  const badgeColor  = e.isAlgebra ? 'rgba(45,199,160,0.12)' : AI_COLOR_BADGE;
  const borderColor = e.isAlgebra ? 'rgba(45,199,160,0.55)' : AI_COLOR_BORDER;
  const textColor   = e.isAlgebra ? '#1a7a62'               : AI_COLOR_TEXT;
  const label       = e.isAlgebra ? '🔣 Algèbre'            : '✨ Texify';

  ctxAi.save();
  ctxAi.font = font;
  const tw = ctxAi.measureText(e.result).width;
  const pH = fs * 0.32, pV = fs * 0.20;
  const bx = e.x - pH, by = e.y - fs - pV;
  const bw = tw + pH * 2, bh = fs + pV * 2;

  ctxAi.fillStyle = badgeColor;
  _rrect(ctxAi, bx, by, bw, bh, 10); ctxAi.fill();
  ctxAi.strokeStyle = borderColor; ctxAi.lineWidth = 1.5;
  _rrect(ctxAi, bx, by, bw, bh, 10); ctxAi.stroke();

  ctxAi.fillStyle = textColor;
  ctxAi.font = font;
  ctxAi.fillText(e.result, e.x, e.y);

  ctxAi.font = '600 9px "Outfit",sans-serif';
  ctxAi.fillStyle = e.isAlgebra ? 'rgba(45,199,160,0.6)' : 'rgba(80,100,180,0.5)';
  ctxAi.fillText(label, bx + 5, by - 3);

  ctxAi.restore();
}


function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// ══════════════════════════════════════════════
// OVERLAY DE CHARGEMENT
// ══════════════════════════════════════════════

function _updateOverlayStep(icon, title, file) {
  if (!$('ai-dl-overlay')) _showLoadingBar(0, '');
  const iconEl = $('ai-dl-icon');
  const fileEl = $('ai-dl-file');
  if (iconEl && icon) iconEl.textContent = icon;
  if (fileEl && file !== undefined) fileEl.textContent = file;
  console.log('[AI]', icon, title, file ?? '');
}

function _showOverlayError(title, detail) {
  let card = $('ai-dl-card');
  if (!card) { _showLoadingBar(0); card = $('ai-dl-card'); }
  if (!card) return;
  card.innerHTML = `
    <div id="ai-dl-icon" style="font-size:52px">❌</div>
    <div id="ai-dl-title" style="color:#ff6b6b">${title}</div>
    <div id="ai-dl-subtitle" style="white-space:pre-line;font-size:12px;opacity:.75">${detail}</div>
    <button onclick="document.getElementById('ai-dl-overlay').remove();_modelStatus='not_loaded';_setStatus('not_loaded');"
      style="margin-top:8px;padding:10px 24px;background:#555;color:#fff;border:none;border-radius:12px;font-size:13px;cursor:pointer">Fermer</button>
    <button onclick="document.getElementById('ai-dl-overlay').remove();_modelStatus='not_loaded';loadAIModel();"
      style="padding:10px 24px;background:var(--primary,#4a90e2);color:#fff;border:none;border-radius:12px;font-size:13px;cursor:pointer">🔄 Réessayer</button>
  `;
}

function _showLoadingBar(pct, fileName) {
  let overlay = $('ai-dl-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'ai-dl-overlay';
    overlay.innerHTML = `
      <div id="ai-dl-backdrop"></div>
      <div id="ai-dl-card">
        <div id="ai-dl-icon" style="font-size:52px;animation:ai-dl-bounce 1.4s ease-in-out infinite">🔢</div>
        <div id="ai-dl-title" style="font-size:20px;font-weight:700;color:#fff">Chargement Texify</div>
        <div id="ai-dl-subtitle" style="font-size:13px;color:rgba(255,255,255,.65);text-align:center;line-height:1.6">
          Modèle IA pour les maths manuscrits<br>
          <span id="ai-dl-file" style="opacity:.6;font-size:11px"></span>
        </div>
        <div style="width:100%">
          <div id="ai-dl-bar-track" style="width:100%;height:12px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden">
            <div id="ai-dl-bar-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#7c3aed,#50e3c2);border-radius:99px;transition:width .4s"></div>
          </div>
          <div id="ai-dl-pct" style="font-family:monospace;font-size:28px;font-weight:700;color:#a78bfa;text-align:center;margin-top:8px">0 %</div>
        </div>
        <div style="font-size:12px;color:rgba(255,255,255,.4);text-align:center;line-height:1.7;padding:10px 14px;background:rgba(255,255,255,.04);border-radius:10px;width:100%">
          ✅ Fonctionne hors ligne après le premier chargement
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  const fill  = $('ai-dl-bar-fill');
  const pctEl = $('ai-dl-pct');
  const fileEl = $('ai-dl-file');
  if (fill)   fill.style.width    = pct + '%';
  if (pctEl)  pctEl.textContent   = pct + ' %';
  if (fileEl && fileName) fileEl.textContent = fileName;
}

function _hideLoadingBar() {
  const o = $('ai-dl-overlay');
  if (!o) return;
  o.style.transition = 'opacity .5s';
  o.style.opacity = '0';
  setTimeout(() => o.remove(), 520);
}

// ══════════════════════════════════════════════
// TOGGLE & STATUT
// ══════════════════════════════════════════════

function toggleAI() {
  aiEnabled = !aiEnabled;
  const btn = $('btn-ai');
  if (btn) btn.classList.toggle('active', aiEnabled);

  if (!aiEnabled) {
    clearTimeout(aiDebounceTimer);
    if (ctxAi) ctxAi.clearRect(0, 0, PAGE_W, PAGE_H);
    aiSuggestions = []; aiLastHash = null;
    _setStatus('off'); toast('IA désactivée', ''); return;
  }

  _setStatus('idle'); toast('✨ IA activée', 'ok');

  if (_modelStatus === 'not_loaded') {
    _showLoadModelPrompt();
  } else {
    scheduleAIAnalysis();
  }
}

function _showLoadModelPrompt() {
  const t = document.createElement('div');
  t.className = 'toast toast-ai-prompt';
  t.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">🔢 Modèle Texify non chargé</div>
    <div style="font-size:12px;opacity:.8;margin-bottom:10px">
      ~200 Mo · reconnaît les maths manuscrits<br>
      Hors ligne après le premier chargement
    </div>
    <div style="display:flex;gap:8px">
      <button onclick="loadAIModel();this.closest('.toast').remove()"
        style="flex:1;padding:6px 10px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600">
        ⬇️ Charger
      </button>
      <button onclick="this.closest('.toast').remove()"
        style="padding:6px 10px;background:var(--muted);border:none;border-radius:8px;font-size:12px;cursor:pointer">
        Plus tard
      </button>
    </div>
  `;
  $('toasts').appendChild(t);
}

function clearAISuggestions() {
  clearTimeout(aiDebounceTimer);
  if (ctxAi) ctxAi.clearRect(0, 0, PAGE_W, PAGE_H);
  aiSuggestions = []; aiLastHash = null;
  if (aiEnabled) _setStatus('idle');
}

function _setStatus(status) {
  const dot = $('ai-status-dot'), sb = $('sb-ai');
  const MAP = {
    not_loaded:  { cls:'ai-dot-off',       txt:'📥 Non chargé'     },
    off:         { cls:'ai-dot-off',       txt:'⏸ Désactivée'     },
    downloading: { cls:'ai-dot-loading',   txt:'⬇️ Chargement…'   },
    idle:        { cls:'ai-dot-idle',      txt:'✨ En attente'      },
    analyzing:   { cls:'ai-dot-analyzing', txt:'🔢 Analyse…'       },
    found:       { cls:'ai-dot-found',     txt:`✅ ${aiSuggestions.length} résultat(s)` },
    error:       { cls:'ai-dot-error',     txt:'❌ Erreur'          },
  };
  const info = MAP[status] || MAP.idle;
  if (dot) { dot.className = 'ai-dot'; dot.classList.add(info.cls); }
  if (sb)  sb.textContent = 'IA : ' + info.txt;
}

function _getActiveStrokes(strokes) {
  let start = 0;
  for (let i = strokes.length-1; i >= 0; i--) {
    if (strokes[i].tool === '__clear__') { start = i+1; break; }
  }
  return strokes.slice(start);
}

// ══════════════════════════════════════════════
// PANNEAU DEBUG  (Ctrl+Shift+D)
// ══════════════════════════════════════════════

const _dbgLogs = [];

function _dbg(msg) {
  const time = new Date().toLocaleTimeString('fr', { hour12:false });
  const line = `[${time}] ${msg}`;
  console.log('[AI DBG]', msg);
  _dbgLogs.push(line);
  if (_dbgLogs.length > 150) _dbgLogs.shift();
  const el = document.getElementById('ai-debug-log');
  if (el) el.textContent = _dbgLogs.slice().reverse().join('\n');
}

function toggleAIDebug() {
  let panel = document.getElementById('ai-debug-panel');
  if (panel) { panel.remove(); return; }

  panel = document.createElement('div');
  panel.id = 'ai-debug-panel';
  panel.innerHTML = `
    <div id="ai-debug-header">
      <span>🔬 Debug IA — Neo-Note</span>
      <div style="display:flex;gap:8px">
        <button onclick="_dbgRefreshStatus()" style="${_BTN}background:#4a90e2">🔄 Status</button>
        <button onclick="document.getElementById('ai-debug-panel').remove()" style="${_BTN}background:#555">✕</button>
      </div>
    </div>
    <div id="ai-debug-status"></div>
    <pre id="ai-debug-log" style="flex:1;overflow-y:auto;margin:0;font-size:11px;line-height:1.6;color:#8b949e;white-space:pre-wrap;word-break:break-all;padding:8px 14px"></pre>
  `;
  document.body.appendChild(panel);
  _dbgRefreshStatus();
  const el = document.getElementById('ai-debug-log');
  if (el) el.textContent = _dbgLogs.slice().reverse().join('\n');
}

const _BTN = 'border:none;border-radius:6px;color:#fff;padding:4px 10px;font-size:11px;cursor:pointer;';

function _dbgRefreshStatus() {
  const el = document.getElementById('ai-debug-status');
  if (!el) return;
  const checks = [
    ['window.aiPipeline',  !!window.aiPipeline,   'Transformers.js chargé'],
    ['window.aiEnv',       !!window.aiEnv,         'Env disponible'],
    ['_modelStatus',       _modelStatus,            'Statut modèle'],
    ['aiReady',            aiReady,                 'IA prête'],
    ['aiEnabled',          aiEnabled,               'IA activée'],
    ['_pipeline',          !!_pipeline,             'Pipeline initialisé'],
    ['transformersError',  window.transformersError ?? '—', 'Erreur Transformers'],
    ['ctxAi',              !!ctxAi,                 'Canvas IA'],
    ['Strokes page',       pages?.[currentPageIdx]?.strokes?.length ?? 0, 'Strokes sur page'],
  ];
  el.innerHTML = checks.map(([k, v, lbl]) => {
    const bad   = v === false || v === 'error' || (typeof v === 'string' && (v.includes('❌') || v.includes('error')));
    const good  = v === true || (typeof v === 'number' && v >= 0 && v !== false);
    const color = bad ? '#f85149' : good ? '#3fb950' : '#e3b341';
    const icon  = bad ? '❌' : good ? '✅' : '⚠️';
    return `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #21262d">
      <span style="color:#8b949e;font-size:11px">${icon} ${lbl}</span>
      <code style="color:${color};font-size:11px">${v}</code>
    </div>`;
  }).join('');
  if (_modelStatus !== 'ready') {
    el.innerHTML += `<button onclick="loadAIModel()" style="${_BTN}background:#3fb950;width:100%;margin-top:8px">⬇️ Charger le modèle</button>`;
  }
}

(function _injectDebugStyles() {
  const s = document.createElement('style');
  s.textContent = `
    #ai-debug-panel{position:fixed;bottom:0;right:0;width:min(480px,100vw);height:min(420px,60vh);
      background:#161b22;border:1px solid #30363d;border-bottom:none;border-right:none;
      border-radius:16px 0 0 0;display:flex;flex-direction:column;z-index:999999;
      font-family:monospace;box-shadow:-4px -4px 24px rgba(0,0,0,.5)}
    #ai-debug-header{display:flex;align-items:center;justify-content:space-between;
      padding:10px 14px;background:#21262d;border-radius:16px 0 0 0;
      border-bottom:1px solid #30363d;font-size:12px;font-weight:600;color:#e6edf3}
    #ai-debug-status{padding:8px 14px;border-bottom:1px solid #21262d;max-height:200px;overflow-y:auto}
    #ai-dl-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center}
    #ai-dl-backdrop{position:absolute;inset:0;background:rgba(10,12,30,.72);backdrop-filter:blur(8px)}
    #ai-dl-card{position:relative;background:#1a1f35;border:1px solid rgba(255,255,255,.12);
      border-radius:24px;padding:36px 40px;width:min(420px,90vw);display:flex;
      flex-direction:column;align-items:center;gap:14px;box-shadow:0 24px 80px rgba(0,0,0,.55);text-align:center}
    @keyframes ai-dl-bounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.08)}}
  `;
  document.head.appendChild(s);
})();

document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key === 'D') { e.preventDefault(); toggleAIDebug(); }
});

_dbg('ai.js chargé (Texify) — statut : ' + _modelStatus);