/* ═══════════════════════════════════════════════
   pdf-import.js — Import et rendu de fichiers PDF
   • Ouvre le sélecteur de fichier natif
   • Lit le PDF via pdf.js (CDN)
   • Rend chaque page (max 10) dans un canvas
   • Enregistre le rendu dans la page correspondante
═══════════════════════════════════════════════ */

/**
 * Déclenche le sélecteur de fichier PDF
 */
function importPDF() {
  $('pdf-import-input').click();
}

/**
 * Gère le fichier sélectionné et l'importe page par page
 * @param {Event} e - événement input[type=file]
 */
async function handlePDFImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  toast('⏳ Chargement du PDF…', '');

  try {
    // Configurer pdf.js (worker CDN)
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const objectURL = URL.createObjectURL(file);
    const pdf       = await pdfjsLib.getDocument(objectURL).promise;
    const pageLimit = Math.min(pdf.numPages, 10); // max 10 pages

    for (let i = 1; i <= pageLimit; i++) {
      // Ajouter une page dans l'éditeur à partir de la 2e
      if (i > 1) {
        pages.push({ bg: currentBg, strokesData: null, undoStack: [] });
      }

      // Rendre la page PDF dans un canvas off-screen
      const pdfPage  = await pdf.getPage(i);
      const baseVP   = pdfPage.getViewport({ scale: 1 });
      const scale    = PAGE_W / baseVP.width;
      const viewport = pdfPage.getViewport({ scale });

      const offCanvas    = el('canvas');
      offCanvas.width    = PAGE_W;
      offCanvas.height   = Math.min(PAGE_H, viewport.height);

      await pdfPage.render({
        canvasContext: offCanvas.getContext('2d'),
        viewport,
      }).promise;

      // Stocker le rendu dans la page
      const pageIdx = (i === 1) ? currentPageIdx : pages.length - 1;
      pages[pageIdx].pdfData = offCanvas.toDataURL();
    }

    // Rafraîchir la vue
    switchToPage(currentPageIdx);
    updatePagesList();

    // Si l'éditeur n'est pas encore ouvert, l'ouvrir
    if (!$('editor').classList.contains('open')) {
      openEditor(null);
    }

    toast(`✅ PDF importé — ${pageLimit} page${pageLimit > 1 ? 's' : ''}`, 'ok');
    URL.revokeObjectURL(objectURL);

  } catch (err) {
    console.error('[PDF Import]', err);
    toast('❌ Erreur lors de l\'import PDF', 'err');
  }

  // Réinitialiser l'input pour permettre un ré-import du même fichier
  e.target.value = '';
}
