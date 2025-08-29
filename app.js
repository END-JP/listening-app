// ユーティリティ
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const show = (sel) => $(sel).classList.remove('hidden');
const hide = (sel) => $(sel).classList.add('hidden');

let LESSONS = [];
let currentLesson = null;

window.addEventListener('load', init);

async function init() {
  // lessons.json 読み込み
  const res = await fetch('/lessons.json', { cache: 'no-store' });
  const data = await res.json();
  LESSONS = data.lessons || [];

  // 目次作成
  const list = $('#lesson-list');
  list.innerHTML = '';
  LESSONS.forEach((l) => {
    const div = document.createElement('div');
    div.className = 'lesson';
    div.innerHTML = `<strong>Day ${l.day}</strong> — ${escapeHTML(l.keyword)}`;
    div.addEventListener('click', () => selectLesson(l.id, div));
    list.appendChild(div);
  });

  // プレイヤー操作（原音声）
  const audio = $('#audio');
  const newAudio = $('#new-dialogue-audio');

  $('#speed').addEventListener('change', (e) => {
    const rate = parseFloat(e.target.value);
    audio.playbackRate = rate;
    if (newAudio) newAudio.playbackRate = rate; // 新TTSにも反映
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

  // スクリプト（原文）表示
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

  // 穴埋め問題に挑戦！（押した時点でLLM生成）
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

      const json = await apiRes.json();
      const items = Array.isArray(json.items) ? json.items : [];
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

  // 新しい会話文を生成（LLM→TTS→音声を表示、スクリプトはボタンで展開）
  $('#btn-generate-dialogue').addEventListener('click', async () => {
    if (!currentLesson) return;
    const btn = $('#btn-generate-dialogue');
    btn.disabled = true;
    btn.textContent = '生成中…';

    // 前回の結果をクリア
    hide('#new-dialogue-text'); $('#new-dialogue-text').textContent = '';
    hide('#new-dialogue-translation'); $('#new-dialogue-translation').textContent = '';
    hide('#new-dialogue-audio-box'); $('#new-dialogue-audio').src = '';
    hide('#new-dialogue-controls'); hide('#new-dialogue-translate-controls');

    try {
      const resp = await fetch('/api/generate-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: currentLesson.keyword })
      });
      const data = await resp.json();

      const text = data.text || '';
      const b64 = data.audio_b64 || '';
      const mime = data.mime || 'audio/mpeg';

      if (!b64) {
        // 音声がない場合はテキストだけ表示
        $('#new-dialogue-text').textContent = text || '生成できませんでした。';
        show('#new-dialogue-text');
        // 訳ボタンも使えるようにする
        show('#new-dialogue-translate-controls');
        $('#btn-show-translation').onclick = () => translateAndShow(text);
        return;
      }

      // 音声をセット
      const src = `data:${mime};base64,${b64}`;
      $('#new-dialogue-audio').src = src;

      // 再生速度の同期（初期値）
      const rate = parseFloat($('#speed').value || '1');
      $('#new-dialogue-audio').playbackRate = rate;

      // 音声とボタンを表示
      show('#new-dialogue-audio-box');
      show('#new-dialogue-controls');
      show('#new-dialogue-translate-controls');

      // スクリプト表示ボタン
      $('#btn-show-new-script').onclick = () => {
        $('#new-dialogue-text').textContent = text || '';
        show('#new-dialogue-text');
      };

      // 日本語訳ボタン
      $('#btn-show-translation').onclick = () => translateAndShow(text);

    } catch (e) {
      $('#new-dialogue-text').textContent = 'エラー: ' + e;
      show('#new-dialogue-text');
    } finally {
      btn.disabled = false;
      btn.textContent = '新しい会話文を生成';
    }
  });
}

// Lesson選択
function selectLesson(id, el) {
  currentLesson = LESSONS.find(l => l.id === id);
  $$('.lesson').forEach(x => x.classList.remove('selected'));
  if (el) el.classList.add('selected');

  $('#lesson-title').textContent = `Day ${currentLesson.day} — ${currentLesson.keyword}`;
  $('#audio').src = currentLesson.audio;

  show('#player');
  hide('#cloze-original'); hide('#transcript'); hide('#new-dialogue');
  // 新会話の表示もリセット
  hide('#new-dialogue-text'); $('#new-dialogue-text').textContent = '';
  hide('#new-dialogue-translation'); $('#new-dialogue-translation').textContent = '';
  hide('#new-dialogue-audio-box'); $('#new-dialogue-audio').src = '';
  hide('#new-dialogue-controls'); hide('#new-dialogue-translate-controls');
}

// 原スクリプト（.txt）→行配列
async function loadTranscriptText(file) {
  const res = await fetch(file, { cache: 'no-store' });
  const txt = await res.text();
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

// 原スクリプト表示
async function renderTranscript(file) {
  const container = $('#transcript-container');
  container.innerHTML = '';
  const txt = await (await fetch(file, { cache: 'no-store' })).text();
  txt.split(/\r?\n/).forEach(line => {
    if (!line) return;
    const div = document.createElement('div');
    div.textContent = line;
    container.appendChild(div);
  });
}

// 穴埋めUI生成（autocomplete無効化）
function buildCloze(sel, clozes) {
  const container = $(sel);
  container.innerHTML = '';
  (clozes || []).forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'cloze';

    // 問題文
    const q = document.createElement('div');
    q.innerHTML = escapeHTML(c.text_with_blanks || '');
    div.appendChild(q);

    // 入力欄
    const inputId = `cloze-${i}`;
    const input = document.createElement('input');
    input.id = inputId;
    input.placeholder = '入力...';
    input.autocomplete = 'off';
    input.autocorrect = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.name = `cloze-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
    div.appendChild(input);

    // 判定ボタン
    const btn = document.createElement('button');
    btn.textContent = '判定';
    const fb = document.createElement('span');
    fb.id = `fb-${i}`;
    fb.className = 'feedback';

    btn.addEventListener('click', () => {
      const val = (input.value || '').trim().toLowerCase();
      const ok = (c.answers || []).some(a => a.toLowerCase() === val);
      fb.textContent = ok ? '✔ 正解' : `✖ 正解は ${c.answers?.[0] ?? ''}`;
      fb.className = ok ? 'ok' : 'ng';
    });

    div.appendChild(btn);
    div.appendChild(fb);
    container.appendChild(div);
  });
}

// 日本語訳を生成して表示
async function translateAndShow(text) {
  const btn = $('#btn-show-translation');
  btn.disabled = true;
  btn.textContent = '翻訳中…';
  hide('#new-dialogue-translation');

  try {
    const resp = await fetch('/api/translate-dialogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await resp.json();
    const jp = data.translation || '翻訳できませんでした。';
    $('#new-dialogue-translation').textContent = jp;
    show('#new-dialogue-translation');
  } catch (e) {
    $('#new-dialogue-translation').textContent = 'エラー: ' + e;
    show('#new-dialogue-translation');
  } finally {
    btn.disabled = false;
    btn.textContent = '日本語訳を表示';
  }
}

// HTMLエスケープ
function escapeHTML(s = '') {
  return s.replace(/[&<>"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
  }[c]));
}
