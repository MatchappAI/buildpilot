/**
 * "Pocket": a tiny phone page served by the Integration API at /pocket.
 * It holds no data itself; it fetches /v1/brief and /v1/sessions with the bearer token the user pastes
 * once (kept in that phone's localStorage). It can read updates aloud with the browser's speech engine,
 * which plays through whatever audio the phone uses, including Bluetooth smart glasses.
 */
export function pocketHtml(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#14181f"><meta name="apple-mobile-web-app-capable" content="yes">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
<title>BuildPilot Pocket</title>
<style nonce="${nonce}">
:root{--bg:#f6f7f9;--fg:#1d2127;--mut:#6b7280;--card:#fff;--line:#e5e7eb;--ok:#1f883d;--warn:#b7791f;--bad:#cf222e;--acc:#0b63ce}
@media (prefers-color-scheme:dark){:root{--bg:#14181f;--fg:#e6e8eb;--mut:#9aa3ad;--card:#1c222b;--line:#2a313b;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#4da3ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;padding-top:max(16px,env(safe-area-inset-top))}
h1{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:4px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 12px}
#brief{font-size:20px;font-weight:600;line-height:1.35}
.s{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)}.s:first-child{border-top:0}
.dot{width:10px;height:10px;border-radius:50%;margin-top:7px;flex:none;background:var(--mut)}
.running{background:var(--ok)}.awaiting_approval,.blocked{background:var(--warn)}.failed{background:var(--bad)}
.mut{color:var(--mut);font-size:13px}
button{font:inherit;border:0;border-radius:10px;padding:12px 14px;background:var(--acc);color:#fff;width:100%;margin-top:8px}
button.sec{background:transparent;color:var(--acc);border:1px solid var(--line)}
label{display:flex;gap:10px;align-items:center;margin-top:10px;font-size:15px}
input[type=password]{width:100%;font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
</style></head><body>
<h1>BuildPilot Pocket</h1>
<div id="setup" class="card" hidden>
  <p>Paste your BuildPilot token (VS Code → BuildPilot → Connect → Copy token).</p>
  <input id="tok" type="password" autocomplete="off" placeholder="token">
  <button id="save">Save on this phone</button>
</div>
<div id="main" hidden>
  <div class="card"><div id="brief">…</div><div id="when" class="mut"></div>
    <button id="speak">Read aloud</button>
    <label><input id="auto" type="checkbox"> Speak when something needs me</label>
    <div class="mut">Audio plays through your phone's output, e.g. Bluetooth smart glasses or earbuds.</div></div>
  <div class="card" id="sessions"></div>
  <button class="sec" id="forget">Forget token</button>
</div>
<script nonce="${nonce}">
const $=id=>document.getElementById(id);let tok=localStorage.getItem("bp-token")||"";let last="";let lastAlert="";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LBL={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"};
function show(){ $("setup").hidden=!!tok; $("main").hidden=!tok; if(tok) refresh(); }
function say(t){ try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(t); u.rate=1.05; speechSynthesis.speak(u);}catch(e){} }
async function get(p){ const r=await fetch(p,{headers:{authorization:"Bearer "+tok}}); if(r.status===401){ tok=""; localStorage.removeItem("bp-token"); show(); throw new Error("bad token"); } return r.json(); }
async function refresh(){
  try{
    const b=await get("/v1/brief"); const ss=await get("/v1/sessions");
    $("brief").textContent=b.text; $("when").textContent="Updated "+new Date().toLocaleTimeString();
    const live=ss.filter(s=>s.status!=="completed").slice(0,10);
    $("sessions").innerHTML=live.length?live.map(s=>'<div class="s"><span class="dot '+esc(s.status)+'"></span><div><b>'+esc(LBL[s.status]||s.status)+'</b> <span class="mut">'+esc(s.folder||s.id.slice(0,8))+(s.contextPct!=null?' · '+Math.round(s.contextPct)+'% context':'')+'</span><div>'+esc(s.task||"")+'</div>'+(s.needsYou?'<div class="mut">'+esc(s.needsYou)+'</div>':"")+'</div></div>').join(""):'<div class="mut">No active sessions.</div>';
    const need=ss.filter(s=>s.status==="awaiting_approval"||s.status==="blocked"||s.status==="failed").map(s=>s.id+s.status+s.lastEventAt).join("|");
    if($("auto").checked&&need&&need!==lastAlert) say(b.text);
    lastAlert=need; last=b.text;
  }catch(e){ $("when").textContent="Can't reach BuildPilot ("+e.message+")"; }
}
$("save").onclick=()=>{ tok=$("tok").value.trim(); if(tok){ localStorage.setItem("bp-token",tok); show(); } };
$("forget").onclick=()=>{ localStorage.removeItem("bp-token"); tok=""; show(); };
$("speak").onclick=()=>say(last||$("brief").textContent);
$("auto").checked=localStorage.getItem("bp-auto")==="1"; $("auto").onchange=e=>localStorage.setItem("bp-auto",e.target.checked?"1":"0");
const h=new URLSearchParams(location.hash.slice(1)).get("t"); if(h){ localStorage.setItem("bp-token",h); tok=h; history.replaceState(null,"",location.pathname); }
show(); setInterval(()=>{ if(tok) refresh(); },20000);
</script></body></html>`;
}
