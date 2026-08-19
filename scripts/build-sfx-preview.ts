/**
 * Build a self-contained "listen-through" sheet for the SFX stock. Reads the
 * generated wavs + manifest.json, embeds each as a base64 data URI, and emits one
 * HTML file that decodes every sound in the browser to (a) DRAW its real waveform
 * — what it looks like — and (b) PLAY it on click — what it feels like. No external
 * assets, so it works as an Artifact.
 *
 *   pnpm exec tsx scripts/gen-sfx.ts        # make the wavs first
 *   pnpm exec tsx scripts/build-sfx-preview.ts <out.html>
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "public", "audio", "sfx");

type Meta = {
  id: string;
  tier: 1 | 2;
  trigger: string;
  character: string;
  gain: number;
};

function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: build-sfx-preview.ts <out.html>");

  const manifest: Meta[] = JSON.parse(
    fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"),
  );
  const sounds = manifest.map((m) => {
    const b64 = fs.readFileSync(path.join(DIR, `${m.id}.wav`)).toString("base64");
    return { ...m, uri: `data:audio/wav;base64,${b64}` };
  });

  fs.writeFileSync(out, page(sounds));
  console.log(`preview    -> ${out} (${sounds.length} sounds embedded)`);
}

function page(sounds: (Meta & { uri: string })[]): string {
  const data = JSON.stringify(sounds);
  return `<title>Reel Sound Palette</title>
<style>
:root{
  --ground:#0d0e12; --panel:#15171e; --panel-2:#1b1e27; --line:#262a36;
  --ink:#e9eaf0; --muted:#8a8fa0; --faint:#5a5f70;
  --accent:#f0a830; --accent-dim:#7a5a1e; --wave:#4a5570; --tier2:#6ee7b7;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:56px 28px 96px}
header{border-bottom:1px solid var(--line);padding-bottom:28px;margin-bottom:8px}
.kicker{font-family:var(--mono);font-size:12px;letter-spacing:.18em;text-transform:uppercase;
  color:var(--accent);margin:0 0 14px}
h1{font-size:clamp(30px,5vw,46px);line-height:1.05;margin:0 0 16px;letter-spacing:-.02em;
  text-wrap:balance;font-weight:650}
.lede{color:var(--muted);max-width:60ch;margin:0;font-size:15px}
.note{margin-top:18px;padding:12px 15px;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;font-size:13.5px;color:var(--muted);max-width:66ch}
.note b{color:var(--ink);font-weight:600}
.tier-h{font-family:var(--mono);font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--faint);margin:52px 0 18px;display:flex;align-items:center;gap:12px}
.tier-h::after{content:"";flex:1;height:1px;background:var(--line)}
.tier-h .t2{color:var(--tier2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:0;
  overflow:hidden;cursor:pointer;transition:border-color .15s,transform .05s;
  display:flex;flex-direction:column}
.card:hover{border-color:#39405280}
.card:active{transform:translateY(1px)}
.card.playing{border-color:var(--accent)}
.wave-wrap{position:relative;background:var(--panel-2);border-bottom:1px solid var(--line)}
canvas{display:block;width:100%;height:96px}
.dur{position:absolute;top:9px;right:11px;font-family:var(--mono);font-size:11px;
  color:var(--faint);letter-spacing:.03em}
.play{position:absolute;left:11px;top:9px;width:26px;height:26px;border-radius:50%;
  background:#00000055;border:1px solid var(--line);display:grid;place-items:center;color:var(--muted)}
.card.playing .play{color:var(--accent);border-color:var(--accent-dim)}
.play svg{width:11px;height:11px;display:block}
.body{padding:14px 16px 16px}
.id{font-family:var(--mono);font-size:14px;color:var(--ink);margin:0 0 3px;letter-spacing:-.01em}
.trigger{font-size:12.5px;color:var(--accent);margin:0 0 9px;opacity:.9}
.char{font-size:13.5px;color:var(--muted);margin:0 0 13px;min-height:38px}
.chips{display:flex;gap:7px;flex-wrap:wrap}
.chip{font-family:var(--mono);font-size:11px;color:var(--muted);background:var(--panel-2);
  border:1px solid var(--line);border-radius:6px;padding:3px 8px;letter-spacing:.02em}
.chip b{color:var(--ink);font-weight:600}
footer{margin-top:56px;padding-top:22px;border-top:1px solid var(--line);
  font-size:13px;color:var(--faint);max-width:66ch}
footer code{font-family:var(--mono);color:var(--muted);font-size:12px}
</style>
<div class="wrap">
  <header>
    <p class="kicker">Reel · interaction SFX</p>
    <h1>Sound palette</h1>
    <p class="lede">The stock set of interaction sounds for demo reels — each one synthesized,
      so a parameter tweak re-renders it. Click any card to hear it; the waveform is the real
      decoded signal.</p>
    <div class="note">These are <b>drafts for your ear to judge</b>. I spec them by trigger and
      synthesis parameters — frequency, envelope, duration — but I can't audition them. Tell me
      which land and which to reshape (“click's too sharp”, “whoosh too long”) and I'll re-tune.</div>
  </header>
  <div id="t1"></div>
  <div id="t2"></div>
  <footer>
    Regenerate with <code>pnpm exec tsx scripts/gen-sfx.ts</code>. The through-line: a click and
    the thing it opens are two sounds — <code>click-primary</code> then <code>pop-open</code> ~120ms
    later — which is what makes an interaction read as real instead of a flat tick.
  </footer>
</div>
<script>
const SOUNDS = ${data};
const AC = new (window.AudioContext||window.webkitAudioContext)();
const buffers = {};

function fmtDur(s){return (s*1000).toFixed(0)+" ms";}

function icon(){return '<svg viewBox="0 0 12 12"><path d="M2 1l8 5-8 5z" fill="currentColor"/></svg>';}

function drawWave(canvas, buf, progress){
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length/w));
  const mid = h/2;
  // baseline
  ctx.strokeStyle = "#262a36"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(w,mid); ctx.stroke();
  const playX = progress!=null ? progress*w : -1;
  for(let x=0;x<w;x++){
    let min=1,max=-1;
    for(let i=0;i<step;i++){const v=data[x*step+i]||0; if(v<min)min=v; if(v>max)max=v;}
    const y1 = mid + min*mid*0.92, y2 = mid + max*mid*0.92;
    ctx.strokeStyle = x<=playX ? "#f0a830" : "#4a5570";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x+0.5,y1); ctx.lineTo(x+0.5,Math.max(y2,y1+1)); ctx.stroke();
  }
}

function b64ToBuf(b64){
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function load(s){
  // Decode the embedded base64 directly — no fetch(), so the artifact CSP can't
  // block a data: request.
  const ab = b64ToBuf(s.uri.split(",")[1]);
  buffers[s.id] = await AC.decodeAudioData(ab);
  return buffers[s.id];
}

function makeCard(s){
  const card = document.createElement("div"); card.className="card";
  card.innerHTML =
    '<div class="wave-wrap"><div class="play">'+icon()+'</div>'+
    '<span class="dur"></span><canvas></canvas></div>'+
    '<div class="body"><p class="id">'+s.id+'</p>'+
    '<p class="trigger">'+s.trigger+'</p>'+
    '<p class="char">'+s.character+'</p>'+
    '<div class="chips"><span class="chip">gain <b>'+s.gain+'</b></span>'+
    '<span class="chip dur-chip">—</span></div></div>';
  const canvas = card.querySelector("canvas");
  const durEl = card.querySelector(".dur");
  const durChip = card.querySelector(".dur-chip");
  load(s).then(buf=>{
    drawWave(canvas, buf);
    durEl.textContent = fmtDur(buf.duration);
    durChip.innerHTML = '<b>'+fmtDur(buf.duration)+'</b>';
  });
  card.onclick = ()=>play(s, card, canvas);
  window.addEventListener("resize", ()=>{if(buffers[s.id]) drawWave(canvas, buffers[s.id]);});
  return card;
}

let current = null;
function play(s, card, canvas){
  if(AC.state==="suspended") AC.resume();
  const buf = buffers[s.id]; if(!buf) return;
  const src = AC.createBufferSource(); src.buffer = buf;
  const g = AC.createGain(); g.gain.value = 0.9; // preview at near-unity to hear clearly
  src.connect(g).connect(AC.destination);
  const t0 = AC.currentTime;
  card.classList.add("playing");
  src.start();
  if(current) current.stop=true;
  const tok = {stop:false}; current = tok;
  (function frame(){
    if(tok.stop) return;
    const p = (AC.currentTime - t0)/buf.duration;
    if(p>=1){ drawWave(canvas, buf); card.classList.remove("playing"); return; }
    drawWave(canvas, buf, p); requestAnimationFrame(frame);
  })();
  src.onended = ()=>{ card.classList.remove("playing"); };
}

const t1 = document.getElementById("t1"), t2 = document.getElementById("t2");
const h1 = document.createElement("div"); h1.className="tier-h";
h1.innerHTML = "Tier 1 — auto-placed off the click log";
const g1 = document.createElement("div"); g1.className="grid";
const h2 = document.createElement("div"); h2.className="tier-h";
h2.innerHTML = 'Tier 2 — <span class="t2">&nbsp;needs a labeled beat</span>';
const g2 = document.createElement("div"); g2.className="grid";
t1.append(h1,g1); t2.append(h2,g2);
for(const s of SOUNDS){ (s.tier===1?g1:g2).append(makeCard(s)); }
</script>
`;
}

main();
