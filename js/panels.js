/* ═══════════════════════════════════════════════
   panels.js — Construction des panneaux d'outils
   • Grille de couleurs
   • Préréglages de stylo
   • Sélecteur de plumes
   • Fonds de page
   • Grille de formes
   • Composants circuits & chimie
   • Mode page (livre / scroll)
   • Gestion ouverture / fermeture des panneaux
═══════════════════════════════════════════════ */

// ══════════════════════════════════════════
// OUVERTURE / FERMETURE
// ══════════════════════════════════════════

function openPanel(id) {
  const wasVisible = $(id).classList.contains('visible');
  closeAllPanels();
  if (!wasVisible) $(id).classList.add('visible');
}

function closeAllPanels() {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('visible'));
}

// Fermer avec Échap
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeAllPanels();
});

// ══════════════════════════════════════════
// PANNEAU : PRÉRÉGLAGES DE STYLO
// ══════════════════════════════════════════

let userPresets = [
  { name:'Stylo fin',       tool:'pen',        color:'#1a1a2e', size:2,  opacity:1    },
  { name:'Marqueur',        tool:'pen',        color:'#000000', size:6,  opacity:1    },
  { name:'Plume Classique', tool:'fountain',   fpIdx:0, color:'#1a1a2e', size:3, opacity:0.95 },
  { name:'Plume Italique',  tool:'fountain',   fpIdx:1, color:'#1a2a5c', size:4, opacity:1    },
  { name:'Plume Flex',      tool:'fountain',   fpIdx:2, color:'#2c1a0e', size:3, opacity:1    },
  { name:'Pinceau',         tool:'fountain',   fpIdx:4, color:'#1a1a1a', size:5, opacity:0.9  },
  { name:'Surligneur',      tool:'highlighter',color:'#ffff00', size:16, opacity:1    },
  { name:'Crayon',          tool:'pen',        color:'#555',    size:2,  opacity:0.7  },
];

function buildPresets() {
  const g = $('presets-grid');
  g.innerHTML = '';
  userPresets.forEach(p => {
    const b = el('button', 'preset-btn');
    b.innerHTML = `<span class="pdot" style="background:${p.color}"></span>${p.name}`;
    b.title     = `${p.tool} — ép.${p.size}`;
    b.onclick   = () => applyPreset(p);
    g.appendChild(b);
  });
}

function applyPreset(p) {
  setTool(p.tool);
  if (p.tool === 'fountain' && p.fpIdx !== undefined) {
    selectedFountainTypeIdx = p.fpIdx;
    buildFountainGrid();
  }
  setColor(p.color);
  penSize    = p.size;
  penOpacity = p.opacity;

  $('sl-size').value    = p.size;
  $('v-size').textContent = p.size;
  $('sl-opacity').value = Math.round(p.opacity * 100);
  $('v-opacity').textContent = Math.round(p.opacity * 100) + '%';

  toast(`✅ ${p.name}`, 'ok');
}

function savePreset() {
  const name = prompt('Nom du préréglage :', `${currentTool} ${penSize}px`);
  if (!name) return;
  const p = { name, tool: currentTool, color: penColor, size: +penSize, opacity: penOpacity };
  if (currentTool === 'fountain') p.fpIdx = selectedFountainTypeIdx;
  userPresets.push(p);
  buildPresets();
  toast(`✅ Préréglage "${name}" sauvegardé`, 'ok');
}

// ══════════════════════════════════════════
// PANNEAU : STYLOS PLUME
// ══════════════════════════════════════════

function buildFountainGrid() {
  const g = $('fountain-grid');
  g.innerHTML = '';

  FOUNTAIN_TYPES.forEach((type, idx) => {
    const div  = el('div', 'fp-opt' + (idx === selectedFountainTypeIdx ? ' active' : ''));
    const prev = el('div', 'fp-preview');
    const c    = el('canvas');
    c.width  = 64;
    c.height = 32;
    prev.appendChild(c);
    _drawFountainPreview(c, type);

    const info = el('div', 'fp-info');
    info.innerHTML = `<div class="fp-name">${type.name}</div><div class="fp-desc">${type.desc}</div>`;

    div.appendChild(prev);
    div.appendChild(info);
    div.onclick = () => {
      selectedFountainTypeIdx = idx;
      setTool('fountain');
      document.querySelectorAll('.fp-opt').forEach(x => x.classList.remove('active'));
      div.classList.add('active');
      toast(`🖋️ ${type.name} sélectionné`, 'ok');
    };
    g.appendChild(div);
  });
}

function _drawFountainPreview(canvas, type) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 64, 32);

  // Sauvegarder les valeurs actuelles
  const savedColor   = penColor;
  const savedSize    = penSize;
  const savedOpacity = penOpacity;

  penColor   = '#1a1a2e';
  penSize    = 3;
  penOpacity = 1;

  // Générer une courbe de démonstration
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    pts.push({
      x:        4 + t * 56,
      y:        16 + Math.sin(t * Math.PI * 1.5) * 9,
      pressure: 0.2 + Math.sin(t * Math.PI) * 0.7,
    });
  }
  type.draw(ctx, pts);

  penColor   = savedColor;
  penSize    = savedSize;
  penOpacity = savedOpacity;
}

/** Rafraîchir les aperçus quand la taille change */
function refreshFountainPreviews() {
  document.querySelectorAll('.fp-opt').forEach((d, i) => {
    const c = d.querySelector('canvas');
    if (c) _drawFountainPreview(c, FOUNTAIN_TYPES[i]);
  });
}

// ══════════════════════════════════════════
// PANNEAU : FOND DE PAGE
// ══════════════════════════════════════════

function buildBgOptions() {
  const cont = $('bg-options');
  cont.innerHTML = '';

  Object.entries(BG_TYPES).forEach(([key, val]) => {
    const div = el('div', 'bg-opt' + (key === currentBg ? ' active' : ''));

    const c = el('canvas');
    c.width  = 60;
    c.height = 85;
    val.fn(c.getContext('2d'), 60, 85);

    const p = el('p');
    p.textContent = val.label;

    div.appendChild(c);
    div.appendChild(p);
    div.onclick = () => {
      currentBg = key;
      document.querySelectorAll('.bg-opt').forEach(x => x.classList.remove('active'));
      div.classList.add('active');
      drawBackground();
      savePage();
    };
    cont.appendChild(div);
  });
}

function setPageMode(m) {
  $('pill-book').classList.toggle('active',   m === 'book');
  $('pill-scroll').classList.toggle('active', m === 'scroll');
  toast(`✅ Mode ${m === 'book' ? 'Livre' : 'Scroll'}`, 'ok');
}

// ══════════════════════════════════════════
// PANNEAU : FORMES GÉOMÉTRIQUES
// ══════════════════════════════════════════

function buildShapeGrid() {
  const g = $('shape-grid');
  g.innerHTML = '';

  SHAPES.forEach(s => {
    const d = el('div', 'shape-opt' + (s.id === selectedShape ? ' active' : ''));
    d.innerHTML = s.emoji;
    d.title     = s.label;
    d.onclick   = () => {
      selectedShape = s.id;
      document.querySelectorAll('.shape-opt').forEach(x => x.classList.remove('active'));
      d.classList.add('active');
      setTool('shape');
      closeAllPanels();
    };
    g.appendChild(d);
  });
}

// ══════════════════════════════════════════
// PANNEAU : CIRCUITS ÉLECTRONIQUES
// ══════════════════════════════════════════

function buildCircuitGrid() {
  const g = $('circuit-grid');
  g.innerHTML = '';

  CIRCUIT_COMPS.forEach(comp => {
    const d = el('div', 'circ-comp');
    d.innerHTML = `<div class="sym">${comp.sym}</div><div class="nm">${comp.name}</div>`;
    d.onclick   = () => {
      saveUndo();
      comp.draw(ctxStrokes, PAGE_W / 2 - 40, PAGE_H / 2 - 20);
      savePage();
      toast(`✅ ${comp.name} inséré`, 'ok');
    };
    g.appendChild(d);
  });
}

// ══════════════════════════════════════════
// PANNEAU : CHIMIE
// ══════════════════════════════════════════

function buildChemGrid() {
  const g = $('chem-grid');
  g.innerHTML = '';

  CHEM_COMPS.forEach(comp => {
    const d = el('div', 'circ-comp');
    d.innerHTML = `<div class="sym">${comp.sym}</div><div class="nm">${comp.name}</div>`;
    d.onclick   = () => {
      saveUndo();
      comp.draw(ctxStrokes, PAGE_W / 2 - 40, PAGE_H / 2 - 20);
      savePage();
      toast(`✅ ${comp.name} inséré`, 'ok');
    };
    g.appendChild(d);
  });
}

// ══════════════════════════════════════════
// CONSTRUCTION GLOBALE DE TOUS LES PANNEAUX
// ══════════════════════════════════════════

function buildAllPanels() {
  buildColorGrid();     // tools.js
  buildPresets();
  buildFountainGrid();
  buildBgOptions();
  buildShapeGrid();
  buildCircuitGrid();
  buildChemGrid();
  plotFunction();       // plotter.js
}
