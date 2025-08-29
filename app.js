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
  const newAudio = $('#new-dialogue-audio');

  // 再生速度は原音声/新TTSの両方に反映
  $('#speed').addEventListener('change', (e) => {
    const rate = parseFloat(e.target.value);
    audio.playbackRate = rate;
    if (newAudio) newAudio.playbackRate = rate;
  });

  $('#btn-replay').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
  let looping = false;
  $('#btn-loop').addEventListener('click', (e) => { looping = !looping; audio.loop = looping; e.target.textContent = `Loop: ${looping ? 'On':'Off'}`; });

  // スクリプト（空欄なし）
  $('#btn-show-script-plain').addEventListener('click', async () => {
    if (!currentLesson?.transcript_file) return;
    await renderTranscript(currentLesson.transcript_file);
    show('#transcript');
    hide('#cloze-original');
    window.scrollTo({ top: $('#transcript').offsetTop - 10, behavior: 'smooth' });
  });
  $('#btn-hide-script').addEventListener('click', () => {
    hide('#transcript');
    $('#transcript-container').innerHTML = '';
  });

  // 穴埋め問題に挑戦！（即生成）
  $('#btn-show-script-cloze').addEventListener('click', async () => {
    if (!currentLesson?.transcript_file) return;
    show('#cloze-original');
    hide('#transcript');
    $('#cloze-original-container').textContent = '生成中...';
    try {
      const lines = await loadTranscriptText(currentLesson.transcript_file);
      const text = lines.join('\n');
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
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) {
        $('#cloze-original-container').textContent = '問題を生成できませんでした。';
      } else {
        const clozes = items.map(it => ({
          text_with_blanks: it.text_with_blanks,
          answers: Array.isArray(it.answers) ? it.answers : [String(it.answers || '')]
        }));
        buildCloze('#cloze-original-container', clozes);
      }
    } catch (e) {
      $('#cloze-original-container').textContent = 'エラー: ' + e;
    }
  });

  // 次へ → 新しい会話文セクションを開く
  $('#btn-next').addEventListener('click', () => {
    show('#new-dialogue');
    window.scrollTo({ top: $('#new-dialogue').offsetTop - 10, behavior: 'smooth' });
  });

  // 新しい会話文を生成（LLM→TTS→音声表示、スクリプトはボタンで展開）
  $('#btn-generate-dialogue').addEventListener('click', async () => {
    if (!currentLesson) return;
    $('#btn-generate-dialogue').disabled = true;
    $('#btn-generate-dialogue').textContent = '生成中…';
    hide('#new-dialogue-text');
    hide('#new-dialogue-controls');
    hide('#new-dialogue-audio-box');

    try {
      const resp = await fetch('/api/generate-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: currentLesson.keyword })
      });
      const data = await resp.json();

      const mime = data.mime || 'audio/mpeg';
      const b64 = data.audio_b64 || '';
      const text = data.text || '';

      if (!b64) {
        $('#new-dialogue-text').textContent = text || '生成に失敗しました。';
        show('#new-dialogue-text');
        return;
      }

      const src = `data:${mime};base64,${b64}`;
      $('#new-dialogue-audio').src = src;
      // 再生速度の同期（初期値）
      const rate = parseFloat($('#speed').value || '1');
      $('#new-dialogue-audio').playbackRate = rate;

      show('#new-dialogue-audio-box');
      show('#new-dialogue-controls');

      // 「スクリプトを表示」ボタンでテキスト展開
      const btn = $('#btn-show-new-script');
      btn.onclick = () => {
        $('#new-dialogue-text').textContent = text || '';
        show('#new-dialogue-text');
        // 二度押しで閉じたいならトグルに変更も可
      };
    } catch (e) {
      $('#new-dialogue-text').textContent = 'エラー: ' + e;
      show('#new-dialogue-text');
    } finally {
      $('#btn-generate-dialogue').disabled = false;
      $('#btn-generate-dialogue').textContent = '新しい会話文を生成';
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
  // 新会話のUIもリセット
  hide('#new-dialogue-text'); hide('#new-dialogue-controls'); hide('#new-dialogue-audio-box');
  $('#new-dialogue-text').textContent = '';
  $('#new-dialogue-audio').src = '';
}

async function loadTranscriptText(file) {
  const res = await fetch(file, { cache: 'no-store' });
  const txt = await res.text();
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function renderTranscript(file) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const txt = await (await fetch(file, { cache: 'no-store' })).text();
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
      const ok = (c.answers || []).some(a => a.toLowerCase() === val);
      const fb = $(`#fb-${i}`);
      fb.textContent = ok ? '✔ 正解' : `✖ 正解は ${c.answers?.[0] ?? ''}`;
      fb.className = ok ? 'ok' : 'ng';
    });
  });
}

function escapeHTML(s = '') {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

window.addEventListener('load', init);
