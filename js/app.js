/* ═══════════════════════════════════════════════
   app.js — Point d'entrée & initialisation
   • Lance le dashboard au chargement
   • Raccourcis clavier de l'éditeur
═══════════════════════════════════════════════ */

// ══════════════════════════════════════════
// INITIALISATION
// ══════════════════════════════════════════

function init() {
  renderFolders();
  renderNotebooks();
}

document.addEventListener('DOMContentLoaded', init);

// ══════════════════════════════════════════
// RACCOURCIS CLAVIER (éditeur uniquement)
// ══════════════════════════════════════════

document.addEventListener('keydown', e => {
  // Ne s'applique que quand l'éditeur est ouvert
  if (!$('editor').classList.contains('open')) return;

  // Ctrl / Cmd : undo / redo
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    return;
  }

  // Ignorer si l'utilisateur tape dans un champ texte
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'p': case 'P': setTool('pen');         break;
    case 'f': case 'F': setTool('fountain');     break;
    case 'h': case 'H': setTool('highlighter');  break;
    case 'e': case 'E': setTool('eraser');       break;
    case 'r': case 'R': setTool('ruler');        break;
    case 'Escape':       closeAllPanels();       break;
  }
});
