// --- Utility ---
for(let j=1;j<=b.length;j++){
const cost = a[i-1]===b[j-1]?0:1;
dp[i][j] = Math.min(
dp[i-1][j]+1,
dp[i][j-1]+1,
dp[i-1][j-1]+cost
);
if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]){
dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2]+1);
}
}
}
return dp[a.length][b.length];
}


function escapeHTML(s){
return s.replace(/[&<>"]g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}


// --- Generated dialogue (no text shown) ---
function makeGeneratedDialogue(keyword){
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


function makeClozesFromGenerated(gen){
// 生成文から keyword を空欄にする問題を最低1つ
const out = [];
const k = gen.keyword;
let used = false;
gen.lines.forEach(line => {
if(!used && line.includes(k)){
out.push({
text_with_blanks: line.replace(k, '_____'),
answers: [k]
});
used = true;
}
});
if(!used){ // 安全策
out.push({ text_with_blanks: `${k} の綴り: _____`, answers:[k] });
}
return out;
}


// --- Web Speech API (TTS) ---
let voices = [];
function setupVoices(){
voices = speechSynthesis.getVoices();
const sel = $('#voice-select');
sel.innerHTML = '';
voices.forEach((v,i)=>{
const opt = document.createElement('option');
opt.value = String(i);
opt.textContent = `${v.name} (${v.lang})`;
sel.appendChild(opt);
});
}


window.speechSynthesis.onvoiceschanged = setupVoices;


function playGenerated(){
if(!generatedDialogue) return;
const rate = parseFloat($('#tts-rate').value || '1');
const idx = parseInt($('#voice-select').value || '0', 10);
const voice = voices[idx];
window.speechSynthesis.cancel();
const queue = generatedDialogue.lines.map(line => {
const u = new SpeechSynthesisUtterance(line);
if(voice) u.voice = voice;
u.rate = rate;
return u;
});
queue.forEach(u => speechSynthesis.speak(u));
}
