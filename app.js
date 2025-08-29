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
    const res = await fetch('/lessons.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`lessons.json ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log('LESSONS.json loaded:', data);
    LESSONS = Array.isArray(data.lessons) ? data.lessons : [];
    console.log('LESSONS array length:', LESSONS.length);

    // TOC
    const list = $('#lesson-list');
    list.innerHTML = '';
    if (LESSONS.length === 0) {
      list.innerHTML = '<div style="opacity:.8">lessons.json に lessons が見つかりませんでした。</div>';
      return;
    }
    LESSONS.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'lesson';
      div.innerHTML = `<strong>Day ${l.day}</strong><span>${escapeHTML(' — ' + l.keyword)}</span>`;
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
      window.scrollTo({ top: $('#transcript').offsetTop - 10, behavior: 'smooth' });
    });
    $('#btn-hide-script').addEventListener('click', () => {
      hide('#transcript');
      $('#transcript-container').innerHTML = '';
    });

    // Cloze / TTS flow
    $('#to-cloze-original').addEventListener('click', () => {
      if (!currentLesson) return;
      // 画面遷移のみ
      $('#cloze-original-container').innerHTML = '';
      hide('#player'); hide('#transcript'); show('#cloze-original');
    });

    // --- LLMでクローズ自動生成 ---
    const btnAI = document.getElementById('btn-autocloze-ai');
    if (btnAI) {
      btnAI.addEventListener('click', async () => {
        if (!currentLesson || !currentLesson.transcript_file) return;
        const lines = await loadTranscriptText(currentLesson.transcript_file);
        const text = lines.join('\n');
        btnAI.disabled = true; btnAI.textContent = '生成中…';
        try {
          const apiRes = await fetch('/api/generate-cloze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              keyword: currentLesson.keyword || '',
              num: 4,
              locale: 'en',
              level: 'B1'
            })
          });

          // ステータス別ハンドリング
          if (!apiRes.ok) {
            const errText = await apiRes.text().catch(()=>'');
            console.error('API error:', apiRes.status, errText);
            $('#cloze-original-container').innerHTML =
              `<div style="color:#f88">APIエラー (${apiRes.status}): ${escapeHTML(errText.slice(0,300))}</div>`;
            alert('クイズ生成APIでエラーが発生しました。Consoleのエラー詳細をご確認ください。');
            return;
          }

          const data = await apiRes.json().catch(e => ({ items: [], _parseError: String(e) }));
          console.log('API response parsed:', data);

          const items = Array.isArray(data.items) ? data.items : [];
          if (items.length === 0) {
            $('#cloze-original-container').innerHTML =
              '<div style="opacity:.8">問題が生成されませんでした。スクリプト量を増やすか、再度お試しください。</div>';
            return;
          }

          const clozes = items.map(it => ({
            text_with_blanks: it.text_with_blanks,
            answers: Array.isArray(it.answers) ? it.answers : [String(it.answers || '')]
          }));
          buildCloze('#cloze-original-container', clozes);
        } catch (e) {
          console.error('Fetch failed:', e);
          $('#cloze-original-container').innerHTML =
            `<div style="color:#f88">通信エラー: ${escapeHTML(String(e))}</div>`;
          alert('生成に失敗しました（通信エラー）。時間をおいて再実行してください。');
        } finally {
          btnAI.disabled = false; btnAI.textContent = 'AIで自動生成（LLM）';
        }
      });
    }

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
    const box = document.getElementById('lesson-list');
    if (box) box.innerHTML = `<div style="color:#f88">初期化エラー: ${escapeHTML(String(err.message || err))}</div>`;
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
  window.scrollTo({ top: $('#player').offsetTop - 10, behavior: 'smooth' });
}

// --- Transcript: file → lines ---
async function loadTranscriptText(file) {
  const res = await fetch(file, { cache: 'no-store' });
  const txt = await res.text();
  return txt.split(/\r?\n/).map(line => {
    let s = line.trim();
    if (!s) return '';
    s = s.replace(/^\[(\d{1,2}:)?\d{1,2}:\d{2}\]\s*/, ''); // [mm:ss] or [hh:mm:ss]
    s = s.replace(/^[A-Za-z]+:\s*/, '');                   // Speaker label (A:)
    return s;
  }).filter(Boolean);
}

// --- Transcript rendering (for viewing) ---
async function renderTranscript(file) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const audio = $('#audio');
  const txt = await (await fetch(file, { cache: 'no-store' })).text();

  txt.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const div = document.createElement('div');
    div.className = 'tr-line';

    const m = line.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
    if (m) {
      const h = m[3] ? parseInt(m[1],10) : 0;
      const mm = m[3] ? parseInt(m[2],10) : parseInt(m[1],10);
      const ss = m[3] ? parseInt(m[3],10) : parseInt(m[2],10);
      const t = h*3600 + mm*60 + ss;
      const btn = document.createElement('button');
      btn.className = 'ts';
      btn.textContent = `[${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}]`;
      btn.addEventListener('click', () => { audio.currentTime = t; audio.play().catch(()=>{}); });
      div.appendChild(btn);
      div.appendChild(document.createTextNode(' ' + (m[4] || '')));
    } else {
      div.appendChild(document.createTextNode(line));
    }
    container.appendChild(div);
  });
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
      <div>${escapeHTML(c.text_with_blanks || '')}</div>
      <input id="${inputId}" placeholder="入力..." />
      <button data-idx="${idx}">判定</button>
      <span class="feedback" id="fb-${inputId}"></span>
    `;
    container.appendChild(div);

    div.querySelector('button').addEventListener('click', () => {
      const val = (document.getElementById(inputId).value || '').trim().toLowerCase();
      const ok = (c.answers || []).some(a => a.toLowerCase()===val);
      const fb = document.getElementById(`fb-${inputId}`);
      fb.textContent = ok ? '✔ 正解' : `✖ 正解は ${c.answers?.[0] ?? ''}`;
      fb.className = `feedback ${ok ? 'ok':'ng'}`;
    });
  });
}

// --- HTML escape ---
function escapeHTML(s=''){
  return s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

// --- Generated dialogue (placeholder) ---
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
