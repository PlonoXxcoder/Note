/* ═══════════════════════════════════════════════
   dashboard.js — Gestion des fichiers
   • Navigation entre les vues
   • Grille des cahiers (notebooks)
   • Gestion des dossiers (CRUD)
   • Menu de tri
   • Bouton flottant FAB
   • Vue Paramètres
   • Basculement de thème
═══════════════════════════════════════════════ */

// ══════════════════════════════════════════
// THÈME CLAIR / SOMBRE
// ══════════════════════════════════════════

function toggleTheme() {
  isDark = !isDark;
  document.documentElement.className = isDark ? 'dark' : 'light';
  _updateThemeIcon();
}

function _updateThemeIcon() {
  const moonSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  const sunSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const icon = isDark ? moonSvg : sunSvg;

  ['theme-icon','theme-icon2'].forEach(id => {
    const el = $(id);
    if (el) el.outerHTML = icon.replace('<svg ', `<svg id="${id}" `);
  });
}

function setPrimaryColor(color) {
  document.documentElement.style.setProperty('--primary', color);
  // Rafraîchir la vue Paramètres si elle est ouverte
  if (activeView === 'settings') buildSettingsView();
}

// ══════════════════════════════════════════
// NAVIGATION ENTRE VUES
// ══════════════════════════════════════════

function setView(view, btn) {
  activeView = view;

  // Mettre à jour la sidebar
  document.querySelectorAll('.sb-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Afficher / masquer les sections
  const isSettings = view === 'settings';
  $('view-notes').style.display    = isSettings ? 'none' : 'flex';
  $('view-settings').style.display = isSettings ? 'flex' : 'none';
  $('fab').style.display           = isSettings ? 'none' : 'block';

  if (isSettings) {
    buildSettingsView();
  } else {
    const titles = { all:'Toutes les notes', favorites:'Favoris', shared:'Partagés' };
    const folder = folders.find(f => f.id === view);
    $('view-title').textContent = folder ? folder.label : (titles[view] || 'Notes');
    renderNotebooks();
  }
}

// ══════════════════════════════════════════
// SIDEBAR : DOSSIERS
// ══════════════════════════════════════════

function renderFolders() {
  const list = $('folders-list');
  list.innerHTML = '';

  folders.forEach(f => {
    const btn = el('button', 'sb-btn' + (activeView === f.id ? ' active' : ''));
    btn.onclick = () => setView(f.id, btn);

    const editBtn = `<button
      onclick="event.stopPropagation();openEditFolder('${f.id}')"
      class="folder-edit-btn"
      style="margin-left:auto;width:22px;height:22px;border-radius:6px;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
    </button>`;

    btn.innerHTML = `<span class="sb-folder-dot" style="background:${f.color}"></span>${f.label}${editBtn}`;

    btn.addEventListener('mouseenter', () => btn.querySelector('.folder-edit-btn').style.opacity = '1');
    btn.addEventListener('mouseleave', () => btn.querySelector('.folder-edit-btn').style.opacity = '0');

    // Drag-drop target: drop notebook onto folder to move it
    btn.addEventListener('dragover', e => {
      e.preventDefault();
      btn.classList.add('folder-drag-over');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('folder-drag-over'));
    btn.addEventListener('drop', e => {
      e.preventDefault();
      btn.classList.remove('folder-drag-over');
      const nbId = parseInt(e.dataTransfer.getData('nbId'));
      const nb = notebooks.find(n => n.id === nbId);
      if (nb) {
        nb.folder = f.id;
        renderNotebooks();
        toast('Deplacement vers "' + f.label + '"', 'ok');
      }
    });

    list.appendChild(btn);
  });
}

// ══════════════════════════════════════════
// GRILLE DES CAHIERS
// ══════════════════════════════════════════

function getFilteredNotebooks() {
  const query = ($('search-input') || { value: '' }).value.toLowerCase();
  let list = [...notebooks];

  // Filtrer par vue
  if (activeView === 'favorites') {
    list = list.filter(n => n.fav);
  } else if (folders.find(f => f.id === activeView)) {
    list = list.filter(n => n.folder === activeView);
  }

  // Filtrer par recherche
  if (query) {
    list = list.filter(n => n.title.toLowerCase().includes(query));
  }

  // Trier
  switch (currentSort) {
    case 'modified':
    case 'opened':
      list.sort((a, b) => b.lastOpened - a.lastOpened); break;
    case 'created':
      list.sort((a, b) => a.created - b.created); break;
    case 'name':
      list.sort((a, b) => a.title.localeCompare(b.title)); break;
  }
  return list;
}

function renderNotebooks() {
  const grid = $('notebook-grid');
  const list = getFilteredNotebooks();
  grid.innerHTML = '';
  $('view-count').textContent = `${list.length} cahier${list.length > 1 ? 's' : ''}`;

  // Carte "Nouvelle note"
  const newCard = el('div', 'nb-card nb-card-new');
  newCard.onclick = () => openEditor(null);
  newCard.innerHTML = `
    <div class="nb-card-new-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </div>
    <span>Nouvelle note</span>`;
  grid.appendChild(newCard);

  // Cartes existantes
  list.forEach(nb => {
    const card = el('div', 'nb-card');
    // Folder badge
    const folder = folders.find(f => f.id === nb.folder);
    const folderBadge = folder
      ? `<span class="nb-folder-badge" style="background:${folder.color}20;color:${folder.color};border-color:${folder.color}40">${folder.label}</span>`
      : '';

    card.innerHTML = `
      <div class="nb-card-preview">
        <img src="${nb.img}" alt="${nb.title}" loading="lazy">
        <div class="nb-card-preview-overlay"></div>
        <div class="nb-card-actions">
          <button class="nb-card-action ${nb.fav ? 'nb-card-fav' : ''}"
            onclick="event.stopPropagation(); toggleFav(${nb.id})" title="Favori">
            <svg viewBox="0 0 24 24"
              fill="${nb.fav ? '#f5a623' : 'none'}"
              stroke="${nb.fav ? '#f5a623' : 'currentColor'}"
              stroke-width="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
          <button class="nb-card-action" onclick="event.stopPropagation(); openCardMenu(event, ${nb.id})" title="Options">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="1"/>
              <circle cx="12" cy="12" r="1"/>
              <circle cx="12" cy="19" r="1"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="nb-card-info">
        <h3>${nb.title}</h3>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <p style="margin:0">${nb.modified}</p>
          ${folderBadge}
        </div>
      </div>
      <div class="nb-card-bar"></div>`;

    // Drag-and-drop to move to folder
    card.draggable = true;
    card.dataset.nbId = nb.id;
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('nbId', nb.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openEditor(nb));
    grid.appendChild(card);
  });
}

function toggleFav(id) {
  const nb = notebooks.find(n => n.id === id);
  if (nb) { nb.fav = !nb.fav; renderNotebooks(); }
}

function filterNotes() {
  renderNotebooks();
}

// ══════════════════════════════════════════
// MENU DE TRI
// ══════════════════════════════════════════

function toggleSortMenu() {
  const menu = $('sort-menu');
  if (menu.style.display === 'block') { menu.style.display = 'none'; return; }

  menu.innerHTML = '';
  SORT_OPTIONS.forEach(opt => {
    const b = el('button', 'sort-option');
    b.innerHTML = `
      <span style="font-size:15px">${opt.icon}</span>
      <span>${opt.label}</span>
      ${currentSort === opt.id ? '<span class="tick">✓</span>' : ''}`;
    b.onclick = () => {
      currentSort = opt.id;
      $('sort-label').textContent = opt.label;
      menu.style.display = 'none';
      renderNotebooks();
    };
    menu.appendChild(b);
  });
  menu.style.display = 'block';
}

// Fermer le menu de tri au clic extérieur
document.addEventListener('click', e => {
  if (!e.target.closest('#sort-btn') && !e.target.closest('#sort-menu')) {
    const m = $('sort-menu');
    if (m) m.style.display = 'none';
  }
});

// ══════════════════════════════════════════
// FAB (bouton flottant d'action)
// ══════════════════════════════════════════

function toggleFab() {
  fabOpen = !fabOpen;
  $('fab-btn').classList.toggle('open', fabOpen);
  $('fab-menu').classList.toggle('open', fabOpen);
}

function closeFab() {
  fabOpen = false;
  $('fab-btn').classList.remove('open');
  $('fab-menu').classList.remove('open');
}

// Fermer le FAB au clic extérieur
document.addEventListener('click', e => {
  if (!e.target.closest('#fab')) closeFab();
});

// ══════════════════════════════════════════
// DIALOG : GESTION DES DOSSIERS
// ══════════════════════════════════════════

function _buildFolderColorOptions() {
  const cont = $('dialog-colors');
  cont.innerHTML = '';
  FOLDER_COLORS.forEach(c => {
    const d = el('div', 'dialog-color-opt' + (c === selectedFolderColor ? ' selected' : ''));
    d.style.background = c;
    d.onclick = () => {
      selectedFolderColor = c;
      cont.querySelectorAll('.dialog-color-opt').forEach(x => x.classList.remove('selected'));
      d.classList.add('selected');
    };
    cont.appendChild(d);
  });
}

function openNewFolder() {
  editingFolderId = null;
  selectedFolderColor = '#007AFF';
  $('folder-name-input').value = '';
  $('folder-dialog-title').textContent = 'Nouveau dossier';
  _buildFolderColorOptions();
  $('folder-dialog').classList.add('open');
}

function openEditFolder(id) {
  const f = folders.find(x => x.id === id);
  if (!f) return;
  editingFolderId = id;
  selectedFolderColor = f.color;
  $('folder-name-input').value = f.label;
  $('folder-dialog-title').textContent = 'Modifier le dossier';
  _buildFolderColorOptions();
  $('folder-dialog').classList.add('open');
}

function closeFolderDialog() {
  $('folder-dialog').classList.remove('open');
}

function saveFolderDialog() {
  const name = $('folder-name-input').value.trim();
  if (!name) return;

  if (editingFolderId) {
    const f = folders.find(x => x.id === editingFolderId);
    if (f) { f.label = name; f.color = selectedFolderColor; }
  } else {
    folders.push({ id: 'f-' + Date.now(), label: name, color: selectedFolderColor });
  }

  closeFolderDialog();
  renderFolders();
  renderNotebooks();
}

// Fermer le dialog en cliquant le backdrop
document.addEventListener('DOMContentLoaded', () => {
  $('folder-dialog').addEventListener('click', e => {
    if (e.target === $('folder-dialog')) closeFolderDialog();
  });
});

// ══════════════════════════════════════════
// VUE PARAMÈTRES
// ══════════════════════════════════════════

function buildSettingsView() {
  const v = $('settings-view');
  const currentPrimary = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary').trim();

  v.innerHTML = `
  <div style="max-width:720px; margin:0 auto; padding:24px 32px 60px">

    <!-- Compte -->
    <div class="settings-section">
      <div class="settings-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
        <span>Compte</span>
      </div>
      ${_settingsItem('Profil',          'John Doe',           'Gérer vos informations')}
      ${_settingsItem('Email',           'john.doe@email.com', 'Mettre à jour votre email')}
      ${_settingsItem('Mot de passe',    '••••••••',           'Changer votre mot de passe')}
    </div>

    <!-- Apparence -->
    <div class="settings-section" style="margin-top:16px">
      <div class="settings-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
        <span>Apparence</span>
      </div>
      ${_settingsToggle('Thème sombre', 'Basculer entre clair et sombre', isDark, 'toggleTheme()')}
      <div class="settings-item">
        <div class="settings-item-info">
          <div class="name">Couleur d'accentuation</div>
          <div class="desc">Personnaliser la couleur principale</div>
        </div>
        <div style="display:flex; gap:6px">
          ${['#007AFF','#5856D6','#34C759','#FF9500','#FF3B30','#AF52DE'].map(c =>
            `<div onclick="setPrimaryColor('${c}')"
              style="width:22px; height:22px; border-radius:50%; background:${c}; cursor:pointer;
              border:2px solid ${c === currentPrimary ? 'var(--fg)' : 'transparent'};
              transition:transform .15s"
              onmouseover="this.style.transform='scale(1.1)'"
              onmouseout="this.style.transform=''"></div>`
          ).join('')}
        </div>
      </div>
    </div>

    <!-- Éditeur -->
    <div class="settings-section" style="margin-top:16px">
      <div class="settings-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span>Éditeur Neo-Note</span>
      </div>
      ${_settingsToggle('Enregistrement auto',   'Sauvegarder automatiquement les modifications', true, '')}
      ${_settingsToggle('Synchronisation cloud', 'Synchroniser sur tous les appareils', true, '')}
      ${_settingsItem(  'Espace utilisé',        '2.4 Go / 15 Go', 'Gérer votre stockage')}
    </div>

    <!-- Sécurité -->
    <div class="settings-section" style="margin-top:16px">
      <div class="settings-section-header">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span>Sécurité</span>
      </div>
      ${_settingsToggle('Verrouillage biométrique', 'Face ID ou empreinte digitale', true, '')}
      ${_settingsToggle('Chiffrement des données',  'Chiffrer les notes de bout en bout', true, '')}
    </div>

    <div style="text-align:center; padding:32px 0 8px; color:var(--fg2); font-size:13px">
      Neo-Note Pro v0.9 — © 2026 Neo-Note
    </div>
  </div>`;
}

function _settingsItem(name, val, desc) {
  return `
  <div class="settings-item">
    <div class="settings-item-info">
      <div class="name">${name}</div>
      <div class="desc">${desc}</div>
    </div>
    <div class="settings-item-value">${val}</div>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--fg2);flex-shrink:0">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </div>`;
}

function _settingsToggle(name, desc, on, action) {
  const id = 'tog-' + Math.random().toString(36).slice(2, 6);
  return `
  <div class="settings-item">
    <div class="settings-item-info">
      <div class="name">${name}</div>
      <div class="desc">${desc}</div>
    </div>
    <div class="toggle ${on ? 'on' : 'off'}" id="${id}"
      onclick="this.classList.toggle('on'); this.classList.toggle('off'); ${action}">
      <div class="toggle-thumb"></div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════
// MENU CONTEXTUEL CARTE NOTEBOOK
// ══════════════════════════════════════════

function openCardMenu(e, nbId) {
  e.stopPropagation();
  // Remove any existing menu
  document.querySelectorAll('.card-ctx-menu').forEach(m => m.remove());

  const nb = notebooks.find(n => n.id === nbId);
  if (!nb) return;

  const menu = document.createElement('div');
  menu.className = 'card-ctx-menu';
  menu.style.cssText = `
    position: fixed;
    background: var(--surface, #fff);
    border: 1px solid var(--border, rgba(0,0,0,.08));
    border-radius: 12px;
    padding: 5px;
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,.14);
    min-width: 200px;
    font-family: var(--font, sans-serif);
  `;

  const folderItems = folders.map(f => `
    <button class="ctx-item" onclick="moveToFolder(${nbId},'${f.id}'); this.closest('.card-ctx-menu').remove()">
      <span class="ctx-dot" style="background:${f.color}"></span>
      Déplacer vers ${f.label}
    </button>`).join('');

  menu.innerHTML = `
    <button class="ctx-item" onclick="renameNotebook(${nbId}); this.closest('.card-ctx-menu').remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      Renommer
    </button>
    <button class="ctx-item" onclick="duplicateNotebook(${nbId}); this.closest('.card-ctx-menu').remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Dupliquer
    </button>
    <div class="ctx-sep"></div>
    ${folderItems}
    <div class="ctx-sep"></div>
    <button class="ctx-item ctx-item-danger" onclick="deleteNotebook(${nbId}); this.closest('.card-ctx-menu').remove()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      Supprimer
    </button>
  `;

  // Inject styles once
  if (!document.getElementById('ctx-menu-style')) {
    const style = document.createElement('style');
    style.id = 'ctx-menu-style';
    style.textContent = `
      .ctx-item {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 7px 10px; border: none;
        border-radius: 8px; background: transparent;
        color: var(--ink, #111); font-size: 12.5px;
        font-weight: 500; cursor: pointer; font-family: inherit;
        text-align: left; transition: background .1s;
        white-space: nowrap;
      }
      .ctx-item:hover { background: var(--paper2, #eee); }
      .ctx-item-danger { color: #E5534B !important; }
      .ctx-item-danger:hover { background: rgba(229,83,75,.08) !important; }
      .ctx-sep { height: 1px; background: var(--border, rgba(0,0,0,.07)); margin: 4px 0; }
      .ctx-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
      .nb-folder-badge {
        display: inline-flex; align-items: center;
        padding: 1px 7px; border-radius: 99px;
        font-size: 10px; font-weight: 600;
        border: 1px solid transparent;
        white-space: nowrap;
      }
      .nb-card.dragging { opacity: .5; transform: scale(.97); }
      .folder-drag-over { background: var(--accent-dim, rgba(59,111,232,.1)) !important; }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(menu);

  // Position near click
  const x = Math.min(e.clientX, window.innerWidth  - 220);
  const y = Math.min(e.clientY, window.innerHeight - 300);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function close() {
      menu.remove();
      document.removeEventListener('click', close);
    });
  }, 0);
}

function moveToFolder(nbId, folderId) {
  const nb = notebooks.find(n => n.id === nbId);
  if (!nb) return;
  nb.folder = folderId;
  renderNotebooks();
  const f = folders.find(f => f.id === folderId);
  toast('Déplacé vers "' + (f?.label || folderId) + '"', 'ok');
}

function renameNotebook(nbId) {
  const nb = notebooks.find(n => n.id === nbId);
  if (!nb) return;
  const name = prompt('Renommer :', nb.title);
  if (name?.trim()) {
    nb.title = name.trim();
    renderNotebooks();
  }
}

function duplicateNotebook(nbId) {
  const nb = notebooks.find(n => n.id === nbId);
  if (!nb) return;
  const copy = { ...nb, id: Date.now(), title: nb.title + ' (copie)', fav: false };
  notebooks.push(copy);
  renderNotebooks();
  toast('Cahier dupliqué', 'ok');
}

function deleteNotebook(nbId) {
  if (!confirm('Supprimer ce cahier ?')) return;
  const idx = notebooks.findIndex(n => n.id === nbId);
  if (idx !== -1) { notebooks.splice(idx, 1); renderNotebooks(); }
}