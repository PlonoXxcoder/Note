/* ═══════════════════════════════════════════════
   audio.js — Dictaphone / enregistrement audio
   • Démarre / arrête l'enregistrement micro
   • Affiche le timer en temps réel
   • Sauvegarde les clips avec lecteur audio
   • Téléchargement des enregistrements (.webm)
═══════════════════════════════════════════════ */

/**
 * Démarre l'enregistrement microphone
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioChunks = [];
    recSeconds  = 0;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop          = _saveAudioClip;
    mediaRecorder.start();

    // Mise à jour du timer toutes les secondes
    recInterval = setInterval(() => {
      recSeconds++;
      const m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
      const s = String(recSeconds % 60).padStart(2, '0');
      $('rec-timer').textContent = `${m}:${s}`;
    }, 1000);

    $('rec-dot').classList.add('rec');
    $('rec-status').textContent = 'Enregistrement...';
    toast('⏺ Enregistrement démarré', '');

  } catch {
    toast('❌ Microphone non accessible', 'err');
  }
}

/**
 * Arrête l'enregistrement en cours
 */
function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(recInterval);
  $('rec-dot').classList.remove('rec');
  $('rec-status').textContent = 'Prêt';
}

/**
 * Crée un clip audio et l'ajoute à la liste (appelé en interne)
 */
function _saveAudioClip() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const url  = URL.createObjectURL(blob);

  const m   = String(Math.floor(recSeconds / 60)).padStart(2, '0');
  const s   = String(recSeconds % 60).padStart(2, '0');
  const dur = `${m}:${s}`;

  // Conteneur du clip
  const div   = el('div', 'audio-clip');

  const ts    = el('span', 'clip-ts');
  ts.textContent = dur;

  const audio = document.createElement('audio');
  audio.src      = url;
  audio.controls = true;

  const dl  = document.createElement('a');
  dl.href      = url;
  dl.download  = `neo-note-${Date.now()}.webm`;
  dl.style.cssText = 'text-decoration:none; font-size:13px';
  dl.textContent   = '⬇️';

  div.appendChild(ts);
  div.appendChild(audio);
  div.appendChild(dl);

  // Insérer en tête de liste (plus récent en haut)
  $('audio-clips').insertBefore(div, $('audio-clips').firstChild);

  toast('✅ Enregistrement sauvegardé', 'ok');
}
