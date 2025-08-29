const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');

let LESSONS = [];
let currentLesson = null;

async function init() {
  const res = await fetch('/lessons.json', { cache: 'no-store' });
  const data = await res.json();
  LESSONS = data.lessons || [];

  const list = $('#lesson-list');
  list.innerHTML = '';
  LESSONS.forEach((l) => {
    const div = document.createElement('div');
    div.className = 'lesson';
    div.innerHTML = `<strong>Day ${l.day}</strong> — ${escapeHTML(l.keyword)}`;
    div.addEventListener('click', () => selectLesson(l.id, div));
    list.appendChild(div);
  });

  const audio = $('#audio');
  $('#speed').addEventListener('change', (e) => { audio.playbackRate = parseFloat(e.target.value); });
  $('#btn-replay').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  let looping = false;
  $('#btn-loop').addEventListener('click', (e) => { looping = !looping; audio.loop = looping; e.target.textContent = `Loop: ${looping ? 'On':'Off'}`; });

  $('#btn-show-script-plain').addEventListener('click', async () => {
    if (!currentLesson?.transcript_file) return;
    await renderTranscript(currentLesson.transcript_file);
    show('#transcript');
    window.scrollTo({ top: $('#transcript').offsetTop - 10, behavior: 'smooth' });
  });
  $('#btn-hide-script').addEventListener('click', () => hide('#transcript'));

  // 「穴埋め問題に挑戦！」 → 即AI生成
  $('#btn-show-script-cloze').addEventListener('click', async () => {
    if (!currentLesson?.transcript_file) return;
    show('#cloze-original');
    const lines = await loadTranscriptText(currentLesson.transcript_file);
    const text = lines.join('\n');
    $('#cloze-original-container').innerHTML = '生成中...';
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
      const data = await apiRes.json();
      const items = data.items || [];
      if (items.length === 0) {
        $('#cloze-original-container').innerHTML = '問題を生成できませんでした。';
      } else {
        const clozes = items.map(it => ({
          text_with_blanks: it.text_with_blanks,
          answers: it.answers
        }));
        buildCloze('#cloze-original-container', clozes);
      }
    } catch (e) {
      $('#cloze-original-container').innerHTML = 'エラー: ' + e;
    }
  });

  // 「次へ」→ 新しい会話文セクション
  $('#btn-next').addEventListener('click', () => {
    show('#new-dialogue');
    window.scrollTo({ top: $('#new-dialogue').offsetTop - 10, behavior: 'smooth' });
  });

  // 新しい会話文を生成
  $('#btn-generate-dialogue').addEventListener('click', async () => {
    if (!currentLesson) return;
    $('#new-dialogue-text').textContent = '生成中...';
    try {
      const resp = await fetch('/api/generate-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: currentLesson.keyword })
      });
      const data = await resp.json();
      $('#new-dialogue-text').textContent = data.text || '生成できませんでした。';
    } catch (e) {
      $('#new-dialogue-text').textContent = 'エラー: ' + e;
    }
  });
}

function selectLesson(id, el) {
  currentLesson = LESSONS.find(l => l.id === id);
  $$('.lesson').forEach(x => x.classList.remove('selected'));
  if (el) el.classList.add('selected');
  $('#lesson-title').textContent = `Day ${currentLesson.day} — ${currentLesson.keyword}`;
  $('#audio').src = currentLesson.audio;
  show('#player');
  hide('#cloze-original'); hide('#transcript'); hide('#new-dialogue');
}

async function loadTranscriptText(file) {
  const res = await fetch(file, { cache: 'no-store' });
  const txt = await res.text();
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function renderTranscript(file) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const txt = await (await fetch(file)).text();
  txt.split(/\r?\n/).forEach(line => {
    if (line) {
      const div = document.createElement('div');
      div.textContent = line;
      container.appendChild(div);
    }
  });
}

function buildCloze(sel, clozes) {
  const container = $(sel);
  container.innerHTML = '';
  clozes.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'cloze';
    const inputId = `cloze-${i}`;
    div.innerHTML = `
      <div>${escapeHTML(c.text_with_blanks)}</div>
      <input id="${inputId}" placeholder="入力..." />
      <button data-idx="${i}">判定</button>
      <span id="fb-${i}" class="feedback"></span>
    `;
    container.appendChild(div);
    div.querySelector('button').addEventListener('click', () => {
      const val = $(`#${inputId}`).value.trim().toLowerCase();
      const ok = c.answers.some(a => a.toLowerCase() === val);
      const fb = $(`#fb-${i}`);
      fb.textContent = ok ? '✔ 正解' : `✖ 正解は ${c.answers[0]}`;
      fb.className = ok ? 'ok' : 'ng';
    });
  });
}

function escapeHTML(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

window.addEventListener('load', init);
