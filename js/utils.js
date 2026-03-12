/* ═══════════════════════════════════════════════
   utils.js — Fonctions utilitaires partagées
   • $ : sélecteur par ID rapide
   • el : création d'élément HTML
   • toast : notification temporaire
═══════════════════════════════════════════════ */

/**
 * Raccourci getElementById
 * @param {string} id
 * @returns {HTMLElement}
 */
const $ = id => document.getElementById(id);

/**
 * Crée un élément HTML avec une classe optionnelle
 * @param {string} tag - balise HTML (ex: 'div', 'button')
 * @param {string} [cls] - classe CSS
 * @returns {HTMLElement}
 */
const el = (tag, cls) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

/**
 * Affiche une notification temporaire (2,5 secondes)
 * @param {string} msg  - texte à afficher
 * @param {string} type - '' | 'ok' | 'err'
 */
function toast(msg, type = '') {
  const t = el('div', 'toast' + (type ? ' ' + type : ''));
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2500);
}
