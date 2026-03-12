/* ═══════════════════════════════════════════════
   ai-worker.js — Worker dédié Texify
   ─────────────────────────────────────────────
   Tourne dans un thread séparé du thread principal.
   Reçoit des DataURL, retourne du LaTeX.
   Le dessin et l'UI restent 100 % fluides.

   Messages reçus (main → worker) :
     { type: 'load',    modelPath, transformersUrl }
     { type: 'analyze', id, dataUrl }
     { type: 'cancel' }

   Messages envoyés (worker → main) :
     { type: 'progress', status, file, pct }
     { type: 'ready' }
     { type: 'error',  message }
     { type: 'result', id, latex }
═══════════════════════════════════════════════ */

let pipeline = null;
let busy     = false;
let currentId = null;

// ── Charger Transformers.js ──────────────────────────
self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'load') {
    await _loadModel(msg.modelPath, msg.transformersUrl);
    return;
  }

  if (msg.type === 'analyze') {
    if (busy) {
      // Abandonner l'analyse précédente si une nouvelle arrive
      currentId = msg.id;
    }
    await _analyze(msg.id, msg.dataUrl);
    return;
  }

  if (msg.type === 'cancel') {
    currentId = null;
    return;
  }
};

async function _loadModel(modelPath, transformersUrl) {
  try {
    _post({ type: 'progress', status: 'init', file: 'transformers.min.js', pct: 0 });

    // Importer Transformers.js (ES module dans le worker)
    const T = await import(transformersUrl);
    const { pipeline: createPipeline, env } = T;

    _post({ type: 'progress', status: 'init', file: 'transformers.min.js', pct: 10 });

    // Configurer l'env pour les fichiers locaux
    env.allowRemoteModels = false;
    env.localModelPath    = modelPath;
    env.useBrowserCache   = false;
    if (env.backends?.onnx?.wasm) {
      // Utiliser 2 threads WASM dans le worker (optimal sans bloquer le main)
      env.backends.onnx.wasm.numThreads = 2;
    }

    _post({ type: 'progress', status: 'loading', file: 'texify', pct: 15 });

    pipeline = await createPipeline(
      'image-to-text',
      'texify',
      {
        quantized: true,
        progress_callback: (info) => {
          const file = (info.file ?? info.name ?? '').split('/').pop();
          let pct = 15;

          if (info.status === 'initiate')
            pct = 20;
          else if ((info.status === 'download' || info.status === 'downloading') && info.total > 0)
            pct = Math.round(15 + (info.loaded / info.total) * 80);
          else if (info.status === 'loading')
            pct = 95;
          else if (info.status === 'ready')
            pct = 100;

          _post({ type: 'progress', status: info.status, file, pct });
        },
      }
    );

    _post({ type: 'ready' });

  } catch (err) {
    _post({ type: 'error', message: err.message ?? String(err) });
  }
}

async function _analyze(id, dataUrl) {
  if (!pipeline) {
    _post({ type: 'error', message: 'Modèle non chargé' });
    return;
  }

  currentId = id;
  busy = true;

  try {
    const out = await pipeline(dataUrl, { max_new_tokens: 128 });
    const latex = out?.[0]?.generated_text ?? '';

    // Vérifier que l'analyse n'a pas été annulée
    if (currentId === id) {
      _post({ type: 'result', id, latex });
    }
  } catch (err) {
    if (currentId === id) {
      _post({ type: 'error', message: err.message ?? String(err) });
    }
  } finally {
    busy = false;
  }
}

function _post(msg) {
  self.postMessage(msg);
}