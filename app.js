// --- Utility ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');
const pad = (n) => String(n).padStart(2, '0');

let LESSONS = [];
let currentLesson = null;
let generatedDialogue = null;

// --- App init ---
async function init() {
  try {
    const res = await fetch('./lessons.json', { cache: 'no-store' });
    const data = await res.json();
    LESSONS = data.lessons || [];

    // TOC
    const list = $('#lesson-list');
    list.innerHTML = '';
    LESSONS.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'lesson';
      div.innerHTML = `<strong>Day ${l.day}</strong><span>${l.keyword}</span>`;
      div.addEventListener('click', () => selectLesson(l.id, div));
      list.appendChild(div);
    });

    // Player controls
    const audio = $('#audio');
    $('#speed').addEventListener('change', (e) => { audio.playbackRate = parseFloat(e.target.value); });
    $('#btn-replay').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    let looping = false;
    $('#btn-loop').addEventListener('click', (e) => { looping = !looping; audio.loop = looping; e.target.textContent = `Loop: ${looping ? 'On':'Off'}`; });

    // Transcript buttons
    $('#btn-show-script').addEventListener('click', async () => {
      if (!currentLesson || !currentLesson.transcript_file) return;
      await renderTranscript(currentLesson.transcript_file);
      show('#transcript');
    });
    $('#btn-hide-script').addEventListener('click', () => {
      hide('#transcript');
      $('#transcript-container').innerHTML = '';
    });

    // Cloze / TTS flow
    $('#to-cloze-original').addEventListener('click', () => {
      if (!currentLesson) return;
      buildCloze('#cloze-original-container', currentLesson.clozes_original || []);
      hide('#player'); hide('#transcript'); show('#cloze-original');
    });

    $('#to-tts').addEventListener('click', () => {
      if (!currentLesson) return;
      setupVoices();
      generatedDialogue = makeGeneratedDialogue(currentLesson.keyword);
      hide('#cloze-original'); show('#tts');
    });

    $('#to-cloze-generated').addEventListener('click', () => {
      if (!generatedDialogue) return;
      const clozes = makeClozesFromGenerated(generatedDialogue);
      buildCloze('#cloze-generated-container', clozes);
      $('#generated-reveal').textContent = generatedDialogue.lines.join('\n');
      hide('#tts'); show('#cloze-generated');
    });

    $('#btn-tts-play').addEventListener('click', playGenerated);
    $('#btn-tts-stop').addEventListener('click', () => window.speechSynthesis.cancel());
  } catch (err) {
    console.error('Init error:', err);
    alert('初期化エラー。強制リロード（⌘+Shift+R / Ctrl+F5）を試してください。');
  }
}
window.addEventListener('load', init);

// --- Lesson selection ---
function selectLesson(id, el) {
  currentLesson = LESSONS.find((l) => l.id === id);
  if (!currentLesson) return;

  $$('.lesson').forEach(x => x.classList.remove('selected'));
  if (el) el.classList.add('selected');

  $('#lesson-title').textContent = `Day ${currentLesson.day} — ${currentLesson.keyword}`;
  const audio = $('#audio');
  audio.src = currentLesson.audio;
  audio.playbackRate = parseFloat($('#speed').value);

  show('#player'); hide('#cloze-original'); hide('#tts'); hide('#cloze-generated'); hide('#transcript');
  $('#transcript-container').innerHTML = '';
}

// --- Transcript (from .txt only) ---
async function renderTranscript(file) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const audio = $('#audio');

  try {
    const res = await fetch(file, { cache: 'no-store' });
    const txt = await res.text();

    txt.split(/\r?\n/).forEach(line => {
      if (!line.trim()) return;

      const div = document.createElement('div');
      div.className = 'tr-line';

      // [mm:ss] optional timestamp
      const tsMatch = line.match(/^\[(\d{1,2}):(\d{2})\]\s*(.*)$/);
      if (tsMatch) {
        const m = parseInt(tsMatch[1],10), s = parseInt(tsMatch[2],10);
        const t = m*60+s;
        const btn = document.createElement('button');
        btn.className = 'ts';
        btn.textContent = `[${tsMatch[1]}:${tsMatch[2]}]`;
        btn.addEventListener('click', () => { audio.currentTime=t; audio.play(); });
        div.appendChild(btn);
        line = tsMatch[3];
      }

      div.appendChild(document.createTextNode(line));
      container.appendChild(div);
    });
  } catch (e) {
    console.error('Transcript load failed:', e);
  }
}

// --- Cloze builder ---
function buildCloze(containerSel, clozes) {
  const container = $(containerSel);
  container.innerHTML = '';
  (clozes || []).forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'cloze';
    const inputId = `cloze-${containerSel}-${idx}`.replace(/[^a-z0-9-]/gi,'');
    div.innerHTML = `
      <div>${c.text_with_blanks}</div>
      <input id="${inputId}" placeholder="入力..." />
      <button data-idx="${idx}">判定</button>
      <span class="feedback" id="fb-${inputId}"></span>
    `;
    container.appendChild(div);

    div.querySelector('button').addEventListener('click', () => {
      const val = (document.getElementById(inputId).value || '').trim().toLowerCase();
      const ok = (c.answers || []).some(a => a.toLowerCase()===val);
      const fb = document.getElementById(`fb-${inputId}`);
      fb.textContent = ok ? '✔ 正解' : `✖ 正解は ${c.answers[0]}`;
      fb.className = `feedback ${ok ? 'ok':'ng'}`;
    });
  });
}

// --- Generated dialogue ---
function makeGeneratedDialogue(keyword){
  return { lines: [`A: Let's practice ${keyword}`, `B: Sure, ${keyword} is useful.`], keyword };
}
function makeClozesFromGenerated(gen){
  return [{ text_with_blanks: gen.lines[0].replace(gen.keyword,'_____'), answers:[gen.keyword]}];
}

// --- TTS ---
let voices=[];
function setupVoices(){
  voices = speechSynthesis.getVoices();
  const sel = $('#voice-select'); sel.innerHTML='';
  voices.forEach((v,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o); });
}
window.speechSynthesis.onvoiceschanged = setupVoices;

function playGenerated(){
  if(!generatedDialogue) return;
  const rate = parseFloat($('#tts-rate').value || '1');
  const idx = parseInt($('#voice-select').value || '0', 10);
  const voice = voices[idx];
  speechSynthesis.cancel();
  generatedDialogue.lines.forEach(line=>{
    const u=new SpeechSynthesisUtterance(line);
    if(voice) u.voice=voice; u.rate=rate; speechSynthesis.speak(u);
  });
}
