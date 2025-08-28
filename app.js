// --- Utility ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');
const pad = (n) => String(n).padStart(2, '0');

let LESSONS = [];
let currentLesson = null;
let generatedDialogue = null; // {lines: string[], keyword}

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

    // NEW: transcript buttons
    $('#btn-show-script').addEventListener('click', () => {
      if (!currentLesson) return;
      renderTranscript(currentLesson);
      show('#transcript');
      // スクロールして見やすく
      window.scrollTo({ top: $('#transcript').offsetTop - 10, behavior: 'smooth' });
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

  // highlight
  $$('.lesson').forEach(x => x.classList.remove('selected'));
  if (el) el.classList.add('selected');

  // player
  $('#lesson-title').textContent = `Day ${currentLesson.day} — ${currentLesson.keyword}`;
  const audio = $('#audio');
  audio.src = currentLesson.audio;
  audio.playbackRate = parseFloat($('#speed').value);

  show('#player'); hide('#cloze-original'); hide('#tts'); hide('#cloze-generated'); hide('#transcript');
  $('#transcript-container').innerHTML = '';
  window.scrollTo({ top: $('#player').offsetTop - 10, behavior: 'smooth' });
}

// --- Transcript rendering ---
function renderTranscript(lesson) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const audio = $('#audio');

  (lesson.segments || []).forEach((seg, idx) => {
    const line = document.createElement('div');
    line.className = 'tr-line';

    const t = Math.max(0, Number(seg.t_start || 0));
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
    const btn = document.createElement('button');
    btn.className = 'ts';
    btn.dataset.t = String(t);
    btn.textContent = `[${pad(mm)}:${pad(ss)}]`;

    const spk = document.createElement('span');
    spk.className = 'spk';
    spk.textContent = (seg.speaker || '').toString().trim() ? `${seg.speaker}:` : '';

    const text = document.createElement('span');
    text.className = 'line';
    text.textContent = seg.text || '';

    line.appendChild(btn);
    line.appendChild(spk);
    line.appendChild(text);
    container.appendChild(line);
  });

  // seek handler（委譲）
  container.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.classList.contains('ts')) {
      const t = parseFloat(target.dataset.t || '0');
      audio.currentTime = isFinite(t) ? t : 0;
      audio.play().catch(()=>{});
    }
  }, { once: true });
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
      const val = (document.getElementById(inputId).value || '').trim();
      const ok = judgeAnswer(val, c.answers || []);
      const fb = document.getElementById(`fb-${inputId}`);
      fb.textContent = ok ? '✔ 正解' : `✖ ヒント: ${hintFor((c.answers || [])[0])}`;
      fb.className = `feedback ${ok ? 'ok':'ng'}`;
    });
  });
}

function judgeAnswer(value, answers){
  const v = normalize(value);
  return (answers || []).some(a => distance(v, normalize(a)) <= 1);
}
function hintFor(answer){ if(!answer) return ''; return `${answer[0]}... (${answer.length}文字)`; }
function normalize(s){ return (s||'').toLowerCase().replace(/[^a-z0-9']/g,' ').replace(/\s+/g,' ').trim(); }

// Damerau–Levenshtein（簡易）
function distance(a,b){
  const dp = Array(a.length+1).fill().map(()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1]?0:1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2]+1);
    }
  }
  return dp[a.length][b.length];
}

// HTMLエスケープ
function escapeHTML(s=''){
  return s.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

// --- 生成会話（テキストは隠す） ---
function makeGeneratedDialogue(keyword){
  const tpl = [
    `A: Hey, got a minute?`,
    `B: Sure.`,
    `A: ${keyword} came up earlier, can we talk?`,
    `B: ${keyword}? Go ahead.`,
    `A: I think it fits our plan.`,
    `B: Sounds good.`
  ];
  return { lines: tpl, keyword };
}
function makeClozesFromGenerated(gen){
  const out = []; const k = gen.keyword; let used=false;
  gen.lines.forEach(line=>{
    if(!used && line.includes(k)){
      out.push({ text_with_blanks: line.replace(k,'_____'), answers:[k] }); used=true;
    }
  });
  if(!used) out.push({ text_with_blanks: `${k} の綴り: _____`, answers:[k] });
  return out;
}

// --- Web Speech API (TTS) ---
let voices=[];
function setupVoices(){
  voices = speechSynthesis.getVoices();
  const sel = $('#voice-select'); sel.innerHTML='';
  voices.forEach((v,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o); });
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
