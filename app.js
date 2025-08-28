// --- Utility ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');

let LESSONS = [];
let currentLesson = null;
let generatedDialogue = null; // {lines: string[], keyword}

// --- App init ---
async function init() {
  try {
    // Load data
    const res = await fetch('./lessons.json', { cache: 'no-store' });
    const data = await res.json();
    LESSONS = data.lessons || [];

    // Render TOC
    const list = $('#lesson-list');
    list.innerHTML = '';
    LESSONS.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'lesson';
      div.innerHTML = `<strong>Day ${l.day}</strong><br/><span>${escapeHTML(l.keyword)}</span>`;
      div.addEventListener('click', () => selectLesson(l.id));
      list.appendChild(div);
    });

    // Wire player controls
    const audio = $('#audio');
    $('#speed').addEventListener('change', (e) => {
      audio.playbackRate = parseFloat(e.target.value);
    });
    $('#btn-replay').addEventListener('click', () => {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
    });
    let looping = false;
    $('#btn-loop').addEventListener('click', (e) => {
      looping = !looping;
      audio.loop = looping;
      e.target.textContent = `Loop: ${looping ? 'On' : 'Off'}`;
    });
    $('#to-cloze-original').addEventListener('click', () => {
      if (!currentLesson) return;
      buildCloze('#cloze-original-container', currentLesson.clozes_original || []);
      hide('#player'); show('#cloze-original');
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

    // TTS buttons
    $('#btn-tts-play').addEventListener('click', playGenerated);
    $('#btn-tts-stop').addEventListener('click', () => window.speechSynthesis.cancel());

  } catch (err) {
    console.error('Init error:', err);
    alert('初期化でエラーが起きました。ページを再読み込みしてみてください。');
  }
}

window.addEventListener('load', init);

// --- Lesson selection ---
function selectLesson(id) {
  currentLesson = LESSONS.find((l) => l.id === id);
  if (!currentLesson) return;
  $('#lesson-title').textContent = `Day ${currentLesson.day} — ${currentLesson.keyword}`;
  const audio = $('#audio');
  audio.src = currentLesson.audio;
  audio.playbackRate = parseFloat($('#speed').value);
  show('#player'); hide('#cloze-original'); hide('#tts'); hide('#cloze-generated');
  window.scrollTo({ top: $('#player').offsetTop - 10, behavior: 'smooth' });
}

// --- Cloze builder ---
function buildCloze(containerSel, clozes) {
  const container = $(containerSel);
  container.innerHTML = '';
  clozes.forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'cloze';
    const inputId = `cloze-${containerSel}-${idx}`.replace(/[^a-z0-9-]/gi, '');
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
      fb.className = `feedback ${ok ? 'ok' : 'ng'}`;
    });
  });
}

function judgeAnswer(value, answers) {
  const v = normalize(value);
  return (answers || []).some(a => distance(v, normalize(a)) <= 1); // 1文字以内のtypoを許容
}

function hintFor(answer) {
  if (!answer) return '';
  return `${answer[0]}... (${answer.length}文字)`;
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9']/g, ' ').replace(/\s+/g, ' ').trim();
}

// Damerau–Levenshtein 近似（簡易版）
function distance(a, b) {
  const dp = Array(a.length + 1).fill().map(() => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}

// 安全なHTMLエスケープ（修正版）
function escapeHTML(s = '') {
  return s.replace(/[&<>"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[ch]));
}

// --- Generated dialogue (no text shown) ---
function makeGeneratedDialogue(keyword) {
  // 超シンプルなテンプレ生成（API不要）
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

function makeClozesFromGenerated(gen) {
  const out = [];
  const k = gen.keyword;
  let used = false;
  gen.lines.forEach(line => {
    if (!used && line.includes(k)) {
      out.push({
        text_with_blanks: line.replace(k, '_____'),
        answers: [k]
      });
      used = true;
    }
  });
  if (!used) {
    out.push({ text_with_blanks: `${k} の綴り: _____`, answers: [k] });
  }
  return out;
}

// --- Web Speech API (TTS) ---
let voices = [];
function setupVoices() {
  voices = speechSynthesis.getVoices();
  const sel = $('#voice-select');
  sel.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(opt);
  });
}
window.speechSynthesis.onvoiceschanged = setupVoices;

function playGenerated() {
  if (!generatedDialogue) return;
  const rate = parseFloat($('#tts-rate').value || '1');
  const idx = parseInt($('#voice-select').value || '0', 10);
  const voice = voices[idx];
  window.speechSynthesis.cancel();
  const queue = generatedDialogue.lines.map(line => {
    const u = new SpeechSynthesisUtterance(line);
    if (voice) u.voice = voice;
    u.rate = rate;
    return u;
  });
  queue.forEach(u => speechSynthesis.speak(u));
}
