"use strict";(()=>{var R=acquireVsCodeApi(),ae=R.getState()??{},l={tab:"overview",open:{},goal:"feature",request:"",mustNotChange:"",acceptance:"",planFirst:!0,...ae},c=null,g=null,$=null,E="",O=[],D={},M=!1,U={},G="",z="",w={},q=null,A=null,f=()=>R.setState(l),se=0,W=new Map;function r(e,a={}){let t=++se;return new Promise(n=>{W.set(t,n),R.postMessage({type:e,id:t,...a})})}window.addEventListener("message",e=>{let a=e.data;if(a.type==="reply"&&a.id)W.get(a.id)?.(a.result),W.delete(a.id);else if(a.type==="state"){let t=JSON.stringify({...a.state,generatedAt:Math.floor(a.state.generatedAt/6e4)})+JSON.stringify(a.settings);if(c=a.state,g=a.settings,t===z)return;z=t,h()}else a.type==="navigate"&&a.tab&&(l.tab=a.tab,f(),h())});var s=e=>String(e??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),i=(e,a="")=>`<i class="codicon codicon-${e} ${a}" aria-hidden="true"></i>`;function b(e){if(!e)return"never";let a=Math.max(0,Math.round((Date.now()-e)/1e3));return a<45?"just now":a<3600?`${Math.round(a/60)} min ago`:a<86400?`${Math.round(a/3600)} h ago`:`${Math.round(a/86400)} d ago`}var ne={verified:"Verified",inferred:"Inferred",unverified:"Unverified",failed:"Failed",unknown:"Unknown"},k=(e,a="")=>`<span class="conf conf-${e}" title="${s(a||ie(e))}">${ne[e]}</span>`;function ie(e){return{verified:"Checked directly (e.g. a command passed, a file exists).",inferred:"BuildPilot's best reading of the evidence. Could be wrong.",unverified:"Claimed or assumed, but not proven yet.",failed:"Checked, and it failed.",unknown:"Not enough information to say."}[e]}var oe={blocker:"error",high:"warning",medium:"info",low:"circle-small",info:"circle-small"},_=e=>`<span class="sev sev-${e}">${i(oe[e])}${e==="blocker"?"Blocker":e==="high"?"Important":e==="medium"?"Worth doing":"Optional"}</span>`,Z={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"},V=e=>`<span class="dot dot-${e}" aria-hidden="true"></span>`,N=e=>e.startsWith("demo-")?`DEMO ${e.slice(5,11)}`:e.slice(0,8),le=e=>e.split(/[\\/]/).pop()??e,Y=e=>c?.project&&e.startsWith(c.project.root)?e.slice(c.project.root.length+1):e,F=()=>g?.beginner??!0;function K(e){return e.length?`<ul class="evidence">${e.map(a=>`<li><span class="ev-kind ev-${a.kind}" title="${a.kind==="observed"?"Seen directly":"Inferred"}">${a.kind==="observed"?"seen":"inferred"}</span> ${s(a.text)}${a.ref?` <a href="#" data-open="${s(a.ref)}" class="ref">${s(le(a.ref))}</a>`:""}</li>`).join("")}</ul>`:""}function S(e,a,t,n=!1){let m=l.open[e]??n;return`<details data-key="${s(e)}" ${m?"open":""}><summary>${a}</summary><div class="details-body">${t}</div></details>`}var re=["data-act","data-tab","data-key","data-script","data-id","data-sha","data-session","data-goal-pick","data-open","data-req-status","value"];function de(e){if(!e||e===document.body)return null;if(e.id)return`#${e.id}`;let a=re.map(t=>e.hasAttribute(t)?`[${t}="${CSS.escape(e.getAttribute(t))}"]`:"").join("");return a?e.tagName.toLowerCase()+a:null}function y(e){A={text:e,at:Date.now()};let a=document.getElementById("flash");a&&(a.textContent=e,a.classList.add("on"));let t=document.getElementById("live");t&&(t.textContent=e),setTimeout(()=>{A&&Date.now()-A.at>=2400&&(A=null,document.getElementById("flash")?.classList.remove("on"))},2500)}var ce=[{id:"overview",label:"Overview",icon:"home"},{id:"sessions",label:"Sessions",icon:"pulse"},{id:"supervisor",label:"Supervisor",icon:"shield"},{id:"prompts",label:"Prompts",icon:"sparkle"},{id:"memory",label:"Memory",icon:"book"},{id:"connect",label:"Connect",icon:"plug"}];function h(){let e=document.getElementById("app"),a=document.querySelector(".content")?.scrollTop??0,t=document.activeElement,n=de(t),m=new Set([...document.querySelectorAll("input.cpf:checked")].map(o=>`${o.dataset.sha}|${o.value}`)),p=t?.selectionStart??null;if(!c){e.innerHTML='<div class="loading">Starting BuildPilot\u2026</div>';return}if(!c.project)return e.innerHTML=`<div class="empty">${i("folder-opened","big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`,X();let u=c.out.sessions.filter(o=>!o.endedAt&&c.generatedAt-o.lastEventAt<36e5),x=u.filter(o=>o.displayStatus==="awaiting_approval"||o.displayStatus==="blocked").length,I=c.out.issues.filter(o=>o.severity==="blocker"||o.severity==="high").length,j={sessions:x?`<span class="badge warn">${x}</span>`:u.length?`<span class="badge">${u.length}</span>`:"",supervisor:I?`<span class="badge err">${I}</span>`:""},v=c.out.health;e.innerHTML=`
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${s(c.facts?.name??c.project.name)} ${i("chevron-down")}</button>
      <span class="spacer"></span>
      ${c.analyzing?`<span class="muted small">${i("loading","spin")} Analyzing</span>`:`<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${i("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${v.level}">${V(v.level==="good"?"running":v.level==="blocked"?"failed":v.level==="attention"?"awaiting_approval":"unknown")}${s(v.label)}</span>
      <span class="chip" title="Development stage (${c.out.stage.confidence})">${s(c.out.stage.stage)}</span>
    </div>
    ${c.demo?`<div class="demo-banner">${i("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>`:""}
    ${g?.trusted?"":`<div class="demo-banner">${i("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>`}
    <nav class="tabs" role="tablist" aria-label="BuildPilot sections">${ce.map(o=>`<button role="tab" id="tab-${o.id}" aria-controls="panel" aria-selected="${l.tab===o.id}" tabindex="${l.tab===o.id?0:-1}" class="tab ${l.tab===o.id?"active":""}" data-tab="${o.id}" title="${o.label}" aria-label="${o.label}${ue(o.id,x,I,u.length)}">${i(o.icon)}<span class="tab-label">${o.label}</span>${j[o.id]??""}</button>`).join("")}</nav>
  </header>
  <main class="content" id="panel" role="tabpanel" aria-labelledby="tab-${l.tab}" tabindex="-1">${c.errors.map(o=>`<div class="error-box">${i("error")} ${s(o)}</div>`).join("")}${me()}</main>
  <div id="flash" class="flash ${A?"on":""}" aria-hidden="true">${s(A?.text??"")}</div>`;for(let[o,B]of Object.entries(w)){let T=document.getElementById(o);T&&(T.value=B)}document.querySelectorAll("input.cpf").forEach(o=>o.checked=m.has(`${o.dataset.sha}|${o.value}`)),X(),pe();let L=document.querySelector(".content");if(L&&(L.scrollTop=a),n){let o=null;try{o=document.querySelector(n.startsWith("#")?`[id="${CSS.escape(n.slice(1))}"]`:n)}catch{}if(o&&(o.focus({preventScroll:!0}),p!==null&&"setSelectionRange"in o))try{o.setSelectionRange(p,p)}catch{}}}function ue(e,a,t,n){return e==="sessions"?a?`, ${a} waiting for you`:n?`, ${n} active`:"":e==="supervisor"&&t?`, ${t} important issues`:""}function pe(){if(!c)return;let e=c.out.sessions.filter(u=>!u.endedAt&&(u.displayStatus==="awaiting_approval"||u.displayStatus==="blocked")),a=c.elsewhere.filter(u=>u.status==="awaiting_approval"||u.status==="blocked"),t=c.out.issues.find(u=>u.severity==="blocker"),n=[];e.length&&n.push(`${e.length} Claude session${e.length===1?"":"s"} waiting for you`),a.length&&n.push(`waiting in ${[...new Set(a.map(u=>u.folder))].join(", ")}`),t&&n.push(`Blocker: ${t.title}`);let m=n.join(". "),p=document.getElementById("live");p||(p=document.createElement("div"),p.id="live",p.className="sr-only",p.setAttribute("role","status"),p.setAttribute("aria-live","polite"),document.body.appendChild(p)),m!==G&&(p.textContent=m),G=m}function me(){switch(l.tab){case"overview":return ge();case"sessions":return be();case"supervisor":return ye();case"prompts":return we();case"memory":return Se();case"connect":return Ee()}}function ee(e,a=!0){let t=e.action,n=a?"primary":"secondary";return t?t.kind==="install_hooks"?`<button class="${n}" data-act="installHooks">Connect</button>`:t.kind==="checkpoint"?`<button class="${n}" data-act="checkpoint">${i("save")} Save checkpoint</button>`:t.kind==="run_script"?`<button class="${n}" data-act="runScript" data-script="${s(t.script)}" ${c?.runningScript?"disabled":""}>${i("play")} ${t.script==="install"?"Install":`Run ${s(t.script)}`}</button>`:t.kind==="prompt"?`<button class="${n}" data-act="promptFor" data-goal="${s(t.goal)}" data-request="${s(t.request)}">${i("sparkle")} Write the prompt</button>`:t.kind==="open_file"?`<button class="${n}" data-open="${s(t.path)}">Open</button>`:t.kind==="audit"?`<button class="${n}" data-act="audit">${i("shield")} Check dependencies</button>`:t.kind==="visual_check"?`<button class="${n}" data-act="visualCheck">${i("eye")} Check the app</button>`:t.kind==="worktree"?`<button class="${n}" data-act="worktree" data-session="${s(t.sessionId)}">${i("git-branch")} Separate the sessions</button>`:t.kind==="open_tab"?`<button class="${n}" data-tab="${t.tab}">${t.tab==="sessions"?`${i("terminal")} See the session`:`Open ${t.tab[0].toUpperCase()+t.tab.slice(1)}`}</button>`:"":""}function he(){let e=c.out.next;return e?`<section class="next sev-border-${e.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${_(e.severity)}</div>
    <div class="next-title">${s(e.title)}</div>
    <p>${s(e.why)}</p>
    <div class="actions">${ee(e)}<button class="link" data-act="dismiss" data-key="${s(e.key)}" title="Hide for 24 hours">Not now</button></div>
    ${S(`ev:${e.key}`,"Why BuildPilot thinks so",K(e.evidence))}
  </section>`:`<section class="next good">${i("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`}function ge(){let e=c,a=e.facts,t=e.out.sessions.filter(d=>!d.endedAt&&e.generatedAt-d.lastEventAt<36e5),n=t.filter(d=>d.displayStatus==="running").length,m=t.filter(d=>d.displayStatus==="awaiting_approval"||d.displayStatus==="blocked").length,p=e.out.issues.filter(d=>d.severity==="blocker"||d.severity==="high"),u=t.length?`${n} session${n===1?"":"s"} working${m?`, <b>${m} waiting for you</b>`:""}. <a href="#" data-tab="sessions">See sessions</a>${e.hooks.installed?"":'<div class="muted small">Real sessions appear once you <a href="#" data-act="installHooks">connect</a>.</div>'}`:e.hooks.installed?"No active Claude Code sessions in this project.":'Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>',x=e.elsewhere.filter(d=>d.status==="awaiting_approval"||d.status==="blocked"),I=u+(x.length?`<div class="small warn-text">Also waiting for you: ${s([...new Set(x.map(d=>d.folder))].join(", "))}</div>`:e.elsewhere.length?`<div class="muted small">${e.elsewhere.length} active in other projects \xB7 <a href="#" data-tab="sessions">see</a></div>`:""),j=p.length===0?"Nothing urgent found.":`${p.length} important issue${p.length===1?"":"s"}: ${s(p[0].title)}${p.length>1?` <a href="#" data-tab="supervisor">+${p.length-1} more</a>`:""}`,v=e.requirements.filter(d=>d.status!=="dropped"),L=v.filter(d=>d.status==="done"&&d.evidence==="verified"),o=v.filter(d=>d.status==="in_progress"||d.status==="done"&&d.evidence!=="verified"),B=v.filter(d=>d.status==="todo"),T=e.testRuns.find(d=>/test|vitest|jest|pytest/.test(d.command));return`
  ${he()}
  ${ve()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${I}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${j}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${a?.description?`${s(a.description)} <span class="muted small">(from ${s(a.descriptionSource)})</span>`:e.notes.goal?s(e.notes.goal):'<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>'}</dd>
      <dt>Built with</dt><dd>${a?s([...a.languages,...a.frameworks].join(", ")||"Not detected"):"\u2026"}</dd>
      <dt>Stage</dt><dd>${s(e.out.stage.stage)} ${k(e.out.stage.confidence)}${S("stage-ev","evidence",K(e.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${e.out.progress.total?`<div class="bar" role="progressbar" aria-valuenow="${e.out.progress.done}" aria-valuemax="${e.out.progress.total}"><span style="width:${Math.round(e.out.progress.done/e.out.progress.total*100)}%"></span></div>`:""}${s(e.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${T?`${T.passed?k("verified","Passed when BuildPilot ran it")+" passing":k("failed")+" failing"} \xB7 ${b(T.startedAt)}`:`${k("unknown")} not run yet${a?.scripts.test?' \xB7 <a href="#" data-act="runScript" data-script="test">Run tests</a>':""}`}</dd>
      <dt>Git</dt><dd>${e.changes?`${s(e.changes.branch??"detached")} \xB7 ${e.changes.unstaged.length+e.changes.untracked.length+e.changes.staged.length} uncommitted`:a?.isGit===!1?`${k("failed")} not using Git`:"\u2026"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${v.length===0?`<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${a?.checklistItems.length?`<a href="#" data-act="importChecklist">Import ${a.checklistItems.length} checklist items from your docs</a> or `:""}<a href="#" data-tab="memory">add them</a>.</p>`:`${H("Done & verified",L,"verified")}${H("Partly done / unproven",o,"unverified")}${H("Not started",B,"unknown")}`}
  </section>
  ${e.resolved.length?`<section><h3>Recently resolved</h3><ul class="plain">${e.resolved.map(d=>`<li>${i("check","ok")} ${s(d.title)} <span class="muted small">${b(d.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>`:""}
  <section>
    <h3>Recent work</h3>
    ${e.commits.length?`<ul class="plain">${e.commits.slice(0,5).map(d=>`<li><span class="muted small">${b(d.ts)}</span> ${s(d.subject)}</li>`).join("")}</ul>`:'<p class="muted">No commits yet.</p>'}
  </section>
  ${$e()}`}function ve(){let e=c.metrics;if(!e.length)return"";let a=t=>t==="unknown"?"Unknown":t==="estimate"?"Estimate":"Measured";return`<section class="metrics" aria-label="Key numbers">${e.map(t=>`<button class="metric tone-${t.tone}" ${t.tab?`data-tab="${t.tab}"`:""} title="${s(t.why)}" aria-label="${s(`${t.label}: ${t.value==="\u2014"?"unknown":t.value}. ${t.detail}. ${t.why}`)}">
        <span class="m-label">${s(t.label)}</span>
        <span class="m-value">${s(t.value)}</span>
        <span class="m-detail">${s(t.detail)}</span>
        <span class="sr-only">${a(t.confidence)}</span>
      </button>`).join("")}</section>`}function H(e,a,t){return a.length?`<div class="fgroup"><div class="fgroup-h">${k(t)} ${s(e)} <span class="muted">(${a.length})</span></div><ul class="plain">${a.slice(0,8).map(n=>`<li>${s(n.title)}</li>`).join("")}${a.length>8?`<li class="muted">+${a.length-8} more</li>`:""}</ul></div>`:""}function $e(){let e=c,a=[{done:!!e.integration.claudeInstalled,label:"Claude Code installed",hint:e.integration.claudeInstalled===null?"checking\u2026":e.integration.claudeVersion??"Install from claude.com/claude-code"},{done:e.hooks.installed,label:"BuildPilot connected to Claude Code",hint:e.hooks.installed?"Live sessions will appear automatically":"",act:e.hooks.installed?"":'<button class="secondary small" data-act="installHooks">Connect</button>'},{done:!!e.integration.gitAvailable&&!!e.facts?.isGit,label:"Project uses Git",hint:e.facts?.isGit?"":"Needed for checkpoints and rollback"}];return a.every(t=>t.done)?"":`<section><h3>Setup</h3><ul class="steps">${a.map(t=>`<li>${i(t.done?"pass-filled":"circle-large-outline",t.done?"ok":"muted")} <span>${s(t.label)}${t.hint?` <span class="muted small">\xB7 ${s(t.hint)}</span>`:""}</span> ${t.act??""}</li>`).join("")}</ul></section>`}function be(){let e=c;if(!e.hooks.installed&&e.out.sessions.length===0)return`<div class="empty">${i("plug","big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;if(e.out.sessions.length===0)return`${J()}<div class="empty">${i("terminal","big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p><p class="muted small">Already running? It appears on its next action. If not, restart it.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${i("sparkle")} Write a first prompt</button></div>`;let a=e.out.sessions.filter(n=>!n.endedAt&&e.generatedAt-n.lastEventAt<12*36e5),t=e.out.sessions.filter(n=>!a.includes(n));return`
    ${a.length?`<h3>Active <span class="muted small">(${a.length})</span></h3>${a.map(Q).join("")}`:'<p class="muted">No active sessions.</p>'}
    ${t.length?S("past-sessions",`Earlier sessions (${t.length})`,t.map(Q).join("")):""}
    ${J()}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`}function J(){let e=c.elsewhere;if(!e.length)return"";let a=e.filter(t=>t.status==="awaiting_approval"||t.status==="blocked").length;return`<section class="elsewhere"><h3>Other projects <span class="muted small">(${e.length} active${a?`, <span class="warn-text">${a} waiting for you</span>`:""})</span></h3>
    <ul class="plain">${e.map(t=>`<li class="ew">${V(t.status)} <b>${s(t.folder)}</b> <span class="muted small">${Z[t.status]??t.status} \xB7 ${b(t.lastEventAt)}${t.contextPct!=null?` \xB7 context ${Math.round(t.contextPct)}%`:""}</span>${t.task?`<div class="muted small ew-task">\u201C${s(t.task)}\u201D</div>`:""}${t.status==="awaiting_approval"||t.status==="blocked"?`<div class="small warn-text">${s(t.reason)}</div>`:""}</li>`).join("")}</ul>
    <div class="muted small">To supervise one of these in depth, open its folder in VS Code.</div></section>`}function Q(e){let a=c.usage[e.id],t=c.live[e.id],n=t&&t.contextPct!=null?`<div class="ctx" title="From Claude Code's status line"><div class="bar ${t.contextPct>=80?"hot":""}"><span style="width:${Math.min(100,Math.round(t.contextPct))}%"></span></div><span class="small">Context ${Math.round(t.contextPct)}% of ${t.contextSize?Math.round(t.contextSize/1e3)+"k":"?"}${t.costUsd!=null?` \xB7 ~$${t.costUsd.toFixed(2)} at list price`:""}</span></div>`:"",m=a&&a.source==="transcript"?`${a.lastTurnInputTokens?.toLocaleString()??"?"} tokens in context (estimate) \xB7 ${a.totalOutputTokens?.toLocaleString()??"?"} written \xB7 ${a.assistantTurns} turns`:"Unknown (no local transcript data)",p=e.recent.map(u=>`<li class="${u.isError?"err":""}"><span class="muted small t">${new Date(u.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${s(u.summary)}${u.filePath?` <a href="#" data-open="${s(u.filePath)}" class="ref">open</a>`:""}${u.isError&&u.errorText?`<div class="errtext">${s(u.errorText.split(`
`).slice(0,3).join(" "))}</div>`:""}</li>`).join("");return`<article class="session ${e.displayStatus}" aria-label="Session ${s(N(e.id))}">
    <div class="s-head">${V(e.displayStatus)}<b>${Z[e.displayStatus]??e.displayStatus}</b><span class="muted small mono">${s(N(e.id))}</span><span class="spacer"></span><span class="muted small">${b(e.lastEventAt)}</span></div>
    ${e.currentTask?`<div class="s-task" title="Last prompt you gave it">\u201C${s(e.currentTask)}\u201D</div>`:'<div class="s-task muted">Task unknown (no prompt seen yet)</div>'}
    <div class="s-reason">${s(e.displayReason)}</div>
    ${n}
    ${e.intervention?`<div class="s-int">${i("arrow-right")} ${s(e.intervention)}</div>`:""}
    ${e.overlapsWith.length?`<div class="s-int warn">${i("warning")} Editing the same files as ${e.overlapsWith.map(N).join(", ")}</div>`:""}
    ${S(`sess:${e.id}`,`Details \xB7 ${e.eventCount} events${e.errorCount?` \xB7 <span class="errc">${e.errorCount} errors</span>`:""}`,`
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${s(Y(e.cwd)||"project root")}</dd>
        <dt>Model</dt><dd>${s(t?.model??a?.model??e.model??"Unknown")}</dd>
        <dt>Usage</dt><dd>${s(m)}</dd>
        <dt>Context</dt><dd>${t&&t.contextPct!=null?`${Math.round(t.contextPct)}% (exact, from Claude Code)`:c.statusline.installed?"Waiting for Claude Code to report":'Unknown \xB7 <a href="#" data-act="statuslineOn">show exact %</a>'}</dd>
        <dt>Cost</dt><dd>${t&&t.costUsd!=null?`~$${t.costUsd.toFixed(2)} <span class="muted">(Claude Code's estimate at list price; your plan may differ)</span>`:'Unknown <span class="muted">(not reported)</span>'}</dd>
        <dt>Started</dt><dd>${new Date(e.startedAt).toLocaleString()}</dd>
        ${e.permissionMode?`<dt>Permissions</dt><dd>${s(e.permissionMode)}</dd>`:""}
      </dl>
      ${e.editedFiles.length?`<div class="sub">Changed files</div><ul class="plain files">${e.editedFiles.map(u=>`<li><a href="#" data-open="${s(u)}">${s(Y(u))}</a></li>`).join("")}</ul>`:""}
      <div class="actions"><button class="link" data-act="explainSession" data-session="${s(e.id)}">${i("sparkle")} Explain with AI</button></div>
      ${U[e.id]?`<div class="note">${i("lightbulb")}<div class="pre-wrap">${s(U[e.id])}</div></div>`:""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${p||"<li class='muted'>No events</li>"}</ul>`)}
  </article>`}function fe(e){return`<li class="issue">${_(e.severity)}<div class="issue-body"><div class="issue-title">${s(e.title)}</div>${F()?`<div class="plain-expl">${s(e.plain)}</div>`:""}${S(`iss:${e.key}`,"Evidence",(F()?"":`<p class="plain-expl">${s(e.plain)}</p>`)+K(e.evidence))}</div></li>`}function ye(){let e=c,a=e.out.recommendations,t=e.facts;return`
  <section>
    <h3>Issues <span class="muted small">${e.out.issues.length?`(${e.out.issues.length})`:""}</span></h3>
    ${e.out.issues.length?`<ul class="issues">${e.out.issues.map(fe).join("")}</ul>`:`<p class="muted">${i("pass","ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${a.length?`<ol class="recs">${a.slice(0,8).map(n=>`<li><div class="rec-title">${s(n.title)} ${_(n.severity)}</div><div class="muted">${s(n.why)}</div><div class="actions">${ee(n,!1)}<button class="link" data-act="dismiss" data-key="${s(n.key)}">Not now</button></div></li>`).join("")}</ol>`:'<p class="muted">Nothing to recommend right now.</p>'}
  </section>
  <section>
    <h3>Checks</h3>
    <div class="actions wrap">
      ${t?.scripts.test?`<button class="secondary" data-act="runScript" data-script="test" ${e.runningScript?"disabled":""}>${i("beaker")} Run tests</button>`:""}
      ${t?.scripts.build?`<button class="secondary" data-act="runScript" data-script="build" ${e.runningScript?"disabled":""}>${i("package")} Build</button>`:""}
      ${t?.scripts.lint?`<button class="secondary" data-act="runScript" data-script="lint" ${e.runningScript?"disabled":""}>${i("checklist")} Lint</button>`:""}
      ${t?.scripts.typecheck?`<button class="secondary" data-act="runScript" data-script="typecheck" ${e.runningScript?"disabled":""}>${i("symbol-type-parameter")} Typecheck</button>`:""}
      <button class="secondary" data-act="analyze">${i("shield")} Re-scan</button>
    </div>
    ${e.runningScript?`<p class="muted">${i("loading","spin")} Running <code>${s(e.runningScript)}</code>\u2026</p>`:""}
    ${e.testRuns.length?S("runs",`Recent runs (${e.testRuns.length})`,`<ul class="plain">${e.testRuns.slice(0,8).map(n=>`<li>${n.passed?i("pass","ok"):i("error","bad")} <code>${s(n.command)}</code> <span class="muted small">${b(n.startedAt)} \xB7 ${(n.durationMs/1e3).toFixed(1)}s</span>${S(`run:${n.id}`,"output",`<pre>${s(n.outputTail)}</pre>`)}</li>`).join("")}</ul>`):""}
  </section>
  <section>
    <h3>Dependencies</h3>
    ${e.audit?e.audit.ok?`<p>${e.audit.counts.critical+e.audit.counts.high?i("warning","bad"):i("pass","ok")} ${e.audit.counts.critical} critical \xB7 ${e.audit.counts.high} high \xB7 ${e.audit.counts.moderate} moderate \xB7 ${e.audit.counts.low} low <span class="muted small">(${s(e.audit.tool)}, ${b(e.audit.ranAt)})</span></p>${e.audit.top.length?S("audit-top","Affected packages",`<ul class="plain">${e.audit.top.map(n=>`<li><code>${s(n.name)}</code> <span class="sev sev-${n.severity==="critical"?"blocker":n.severity==="high"?"high":"medium"}">${s(n.severity)}</span> ${s(n.title)}${n.fixAvailable?' <span class="muted small">fix available</span>':""}</li>`).join("")}</ul>`):""}`:`<p class="muted">${i("info")} ${s(e.audit.error)}</p>`:'<p class="muted small">Check your libraries against public vulnerability databases. Sends package names and versions only.</p>'}
    <div class="actions"><button class="secondary" data-act="audit" ${g?.trusted?"":"disabled"}>${i("shield")} ${e.audit?"Re-check":"Check dependencies"}</button></div>
  </section>
  <section>
    <h3>Visual check</h3>
    <p class="muted small">Open your running app headlessly, check it loads without an error, and save a screenshot.${e.browserFound?"":" (No Chrome/Edge found, so no screenshot.)"}</p>
    <input id="appUrl" type="text" value="${s(e.visual?.url??e.appUrl.url??"")}" placeholder="http://localhost:3000" aria-label="App address">
    <div class="muted small">${e.appUrl.url?`Detected from ${s(e.appUrl.basis)}`:"Address not detected. Enter it above."}</div>
    <div class="actions wrap"><button class="secondary" data-act="visualCheck">${i("eye")} Check now</button>${t?.scripts.dev||t?.scripts.start?`<button class="link" data-act="startApp" ${g?.trusted?"":"disabled"}>Start the app first</button>`:""}</div>
    ${e.visual?`<p>${e.visual.reachable&&!e.visual.errorText?i("pass","ok"):i("error","bad")} ${s(e.visual.note)} <span class="muted small">${b(e.visual.checkedAt)}${e.visual.title?` \xB7 \u201C${s(e.visual.title)}\u201D`:""}</span></p>${e.visual.errorText?`<div class="errtext">${s(e.visual.errorText)}</div>`:""}${g?.screenshotUri?`<a href="#" data-act="openScreenshot" title="Open full size"><img class="shot" src="${s(g.screenshotUri)}" alt="Screenshot of your app"></a>`:""}`:""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${e.out.readiness.map(n=>`<li>${k(n.status)} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${e.doctor.length?`<ul class="ready">${e.doctor.map(n=>`<li>${k(n.status==="ok"?"verified":n.status==="fail"?"failed":n.status==="warn"?"unverified":"unknown")} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>`:'<p class="muted">No checks apply to this project type yet.</p>'}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${t?.isGit?"":"disabled"}>${i("save")} Save checkpoint</button></div>
    ${e.checkpoints.length?`<ul class="plain">${e.checkpoints.slice(0,6).map(n=>`<li>${i("history")} ${s(n.label)} <span class="muted small">${b(n.ts)} \xB7 ${n.sha.slice(0,8)}</span> <a href="#" data-act="cpDiff" data-sha="${n.sha}">changed since</a>${D[n.sha]?ke(n.sha):""}</li>`).join("")}</ul>`:""}
  </section>`}function ke(e){let a=D[e];return a.length?`<div class="cp-files"><ul class="plain files">${a.slice(0,40).map(t=>`<li><label><input type="checkbox" class="cpf" data-sha="${e}" value="${s(t)}"> ${s(t)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${e}">${i("discard")} Restore selected files</button></div>`:'<div class="muted small">No changes since this checkpoint.</div>'}function we(){let e=O.find(a=>a.id===l.goal);return`
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${O.map(a=>`<button role="radio" aria-checked="${a.id===l.goal}" class="goal ${a.id===l.goal?"on":""}" data-goal-pick="${a.id}" title="${s(a.plain)}">${s(a.label)}</button>`).join("")}</div>
    ${e?`<p class="muted small">${s(e.plain)}</p>`:""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${s(e?.hint??"")}">${s(l.request)}</textarea>
    ${e?.questions.length?`<div class="muted small hint">Helpful to include: ${e.questions.map(s).join(" \xB7 ")}</div>`:""}
    ${S("prompt-more","More options",`
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${s(l.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when\u2026" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${s(l.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${l.planFirst?"checked":""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${i("sparkle")} Build prompt</button></div>
  </section>
  ${$?`
  <section class="built">
    ${$.missingInfo.length?`<div class="note warn">${i("question")} <div><b>Worth adding</b><ul>${$.missingInfo.map(a=>`<li>${s(a)}</li>`).join("")}</ul></div></div>`:""}
    ${$.assumptions.length?`<div class="note">${i("info")} <div><b>Assumptions made</b><ul>${$.assumptions.map(a=>`<li>${s(a)}</li>`).join("")}</ul></div></div>`:""}
    <div class="muted small">Model: ${s($.suggestedModel)} \xB7 ${$.verification.length?`Verifies with: ${$.verification.join(", ")}`:"No check commands found"} \xB7 ${E.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${s(E)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${i("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${g?.trusted?"":"disabled"} title="Opens a terminal and starts Claude Code with this prompt">${i("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${g?.aiProvider==="none"?"Needs an AI provider (optional)":"Uses "+s(g?.aiProvider)}">${i("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>`:""}`}function Se(){let e=c,a=t=>["todo","in_progress","done","dropped"].map(n=>`<option value="${n}" ${t.status===n?"selected":""}>${{todo:"Not started",in_progress:"In progress",done:"Done",dropped:"Dropped"}[n]}</option>`).join("");return`
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" aria-label="Project goal" placeholder="What are you building, for whom, and what does success look like?">${s(e.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${e.requirements.length?`<ul class="reqs">${e.requirements.map(t=>`<li>
      <div class="req-top"><select data-req-status="${t.id}" aria-label="Status for ${s(t.title)}">${a(t)}</select><span class="req-title">${s(t.title)}</span>${t.status==="done"?k(t.evidence,t.evidenceNote):""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${t.id}" aria-label="Delete requirement">${i("trash")}</button></div>
      <div class="muted small">${t.acceptance?`Done when: ${s(t.acceptance)}`:q===t.id?`<label class="lbl" for="acc-${s(t.id)}">Done when\u2026 (Enter to save, Escape to cancel)</label><input id="acc-${s(t.id)}" class="acc-edit" data-id="${s(t.id)}" type="text" placeholder="e.g. a test payment succeeds">`:`<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${t.id}">Add</a>`}</div>
    </li>`).join("")}</ul>`:""}
    <label class="lbl" for="newReq">New requirement</label>
    <input id="newReq" type="text" placeholder="e.g. Users can pay with a card">
    <label class="lbl" for="newAcc">Done when\u2026</label>
    <input id="newAcc" type="text" placeholder="e.g. a test payment succeeds and a receipt is emailed">
    <div class="actions"><button class="secondary small" data-act="addReq">Add requirement</button>${e.facts?.checklistItems.length?`<button class="link" data-act="importChecklist">Import ${e.facts.checklistItems.length} from docs</button>`:""}</div>
  </section>
  <section>
    <h3>Decisions</h3>
    ${e.decisions.length?`<ul class="plain">${e.decisions.map(t=>`<li><b>${s(t.title)}</b>${t.detail?`: ${s(t.detail)}`:""} <button class="icon-btn" data-act="delDec" data-id="${t.id}" aria-label="Delete decision">${i("close")}</button></li>`).join("")}</ul>`:`<p class="muted small">Record choices (e.g. "Use Supabase for auth") so new sessions don't undo them.</p>`}
    <label class="lbl" for="newDec">New decision</label><input id="newDec" type="text" placeholder="e.g. Use Supabase for login">
    <label class="lbl" for="newDecD">Why (optional)</label><input id="newDecD" type="text" placeholder="e.g. built-in email login, free tier">
    <div class="actions"><button class="secondary small" data-act="addDec">Add decision</button></div>
  </section>
  <section>
    <h3>Preferences</h3>
    <textarea id="prefs" rows="2" aria-label="Your preferences" placeholder="e.g. Keep the UI minimal. Use TypeScript. Explain things simply.">${s(e.notes.preferences)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="preferences" data-src="prefs">Save</button></div>
  </section>
  <section>
    <h3>Session handoff</h3>
    <p class="muted small">A compact summary of goal, requirements, state, what was tried, and the next step, to start a new Claude Code session without losing context.</p>
    <div class="actions wrap"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff</button><button class="secondary" data-act="handoffPrompt">${i("sparkle")} Handoff prompt</button><button class="link" data-act="saveHandoff">Save to .buildpilot/HANDOFF.md</button></div>
    <div class="actions"><button class="link" data-act="claudeMd">${e.facts?.hasClaudeMd?"Draft CLAUDE.md additions":"Draft a CLAUDE.md"}</button></div>
  </section>
  <section>
    <h3>Your data</h3>
    <p class="muted small">Stored only on this computer in <code>${s(g?.home??"~/.buildpilot")}</code>.</p>
    <div class="actions wrap"><button class="link danger" data-act="deleteProjectData">Delete this project's data</button><button class="link danger" data-act="deleteAllData">Delete all data</button></div>
  </section>`}function Ee(){let e=c,a=g;return`
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${i(e.integration.claudeInstalled?"pass-filled":"circle-large-outline",e.integration.claudeInstalled?"ok":"muted")} <span>${e.integration.claudeInstalled?`Installed: ${s(e.integration.claudeVersion)}`:e.integration.claudeInstalled===null?"Checking\u2026":"Not found on PATH"}</span></li>
      <li>${i(e.hooks.installed?"pass-filled":"circle-large-outline",e.hooks.installed?"ok":"muted")} <span>${e.hooks.installed?"Connected":e.hooks.settingsError?`Settings file problem: ${s(e.hooks.settingsError)}`:"Not connected"}<div class="muted small mono">${s(e.hooks.settingsPath)}</div></span></li>
      <li>${i(e.statusline.installed?"pass-filled":"circle-large-outline",e.statusline.installed?"ok":"muted")} <span>${e.statusline.installed?`Exact context % on${e.statusline.chainedOriginal?" (your status line is preserved)":""}`:"Exact context % off"} ${e.statusline.installed?'<a href="#" data-act="statuslineOff">remove</a>':'<a href="#" data-act="statuslineOn">turn on</a>'}</span></li>
      <li>${i("database","muted")} <span>${e.integration.spool.accepted} events received this run${e.integration.spool.rejected?`, ${e.integration.spool.rejected} malformed ignored`:""}${e.integration.spool.lastEventAt?` \xB7 last ${b(e.integration.spool.lastEventAt)}`:""}</span></li>
    </ul>
    <div class="actions wrap">${e.hooks.installed?'<button class="link" data-act="uninstallHooks">Disconnect</button>':'<button class="primary" data-act="installHooks">Connect</button>'}${e.demo?'<button class="link" data-act="demoOff">Remove demo data</button>':'<button class="link" data-act="demoOn">Load demo data</button>'}</div>
  </section>
  <section>
    <h3>Terminal</h3>
    <label class="check"><input type="checkbox" id="openWithTerminal" ${a.openWithTerminal?"checked":""}> Open BuildPilot whenever I open a terminal or start Claude Code</label>
    <ul class="steps">
      <li>${i(a.shellInstalled?"pass-filled":"circle-large-outline",a.shellInstalled?"ok":"muted")} <span>${a.shellInstalled?"Shown in every terminal (Terminal, iTerm, VS Code). Type <code>bp</code> for details.":"Show a BuildPilot summary in every new terminal, plus the <code>bp</code> command"} ${a.shellInstalled?'<a href="#" data-act="shellOff">remove</a>':'<a href="#" data-act="shellOn">turn on</a>'}</span></li>
    </ul>
  </section>
  <section>
    <h3>Phone, glasses &amp; other devices</h3>
    <p class="muted small">Get alerts where you are, like "Claude needs your approval" or "Tests failing". Send them to <b>ntfy</b> (free phone push; smart glasses paired to your phone can read phone notifications aloud), <b>Slack</b>, <b>Discord</b>, or any webhook. Only short alerts and the project name are sent, never code.</p>
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${i("bell")} ${M?"Change notification URL":"Set up notifications"}</button>${M?'<button class="link" data-act="testWebhook">Send test</button>':""}</div>
  </section>
  <section>
    <h3>Integration API</h3>
    <p class="muted small">Lets your own tools ask BuildPilot what's happening: iOS Shortcuts / Siri, Raycast, Stream Deck, a companion app for smart glasses, or a bot. Read-only plus prompt generation. It can't run commands or change files. Requires a secret token.</p>
    <label class="check"><input type="checkbox" id="apiToggle" ${a.apiEnabled?"checked":""}> Enable on ${a.apiAllowLan?"your local network":"this computer only"}</label>
    ${a.apiEnabled&&a.pocketUrl?`<div class="pocket">${i("device-mobile")} <div><b>Pocket</b>: a phone page that shows status and can read it aloud (through Bluetooth glasses or earbuds).<div class="mono small">${s(a.pocketUrl)}</div>${a.apiAllowLan?"":'<div class="muted small">To open it on your phone, enable network access in settings (trusted Wi-Fi only).</div>'}<button class="link" data-act="copyPocketLink">Copy link for my phone</button></div></div>`:""}
    ${a.apiEnabled&&a.apiAddress?`<div class="mono small api">${s(a.apiAddress)}/v1/brief?format=text<br>${s(a.apiAddress)}/v1/status \xB7 /v1/sessions \xB7 /v1/next<br>POST ${s(a.apiAddress)}/v1/prompt {"goal","request"}</div>
      <div class="actions wrap"><button class="secondary small" data-act="copyApiToken">${i("key")} Copy token</button><button class="link" data-act="rotateApiToken">New token</button><button class="link" data-act="settings">Port / network settings</button></div>`:""}
  </section>
  <section>
    <h3>AI refinement <span class="muted small">(optional)</span></h3>
    <p class="muted small">BuildPilot works fully without AI. Optionally refine prompts with your own Anthropic API key or a local Ollama model. Nothing is sent without your OK each time.</p>
    <div class="muted small">Provider: <b>${s(a.aiProvider)}</b>${a.aiModel?` \xB7 ${s(a.aiModel)}`:""}</div>
    <div class="actions"><button class="link" data-act="settings">Change in Settings</button></div>
  </section>
  <section>
    <h3>Experience</h3>
    <label class="check"><input type="checkbox" id="beginner" ${a.beginner?"checked":""}> Beginner explanations (plain-English "why it matters")</label>
    <div class="muted small">Pop-up alerts: ${s(a.notifications)} \xB7 <a href="#" data-act="settings">change</a></div>
  </section>`}function X(){document.querySelectorAll("[data-tab]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),l.tab=t.dataset.tab,f(),l.tab==="connect"&&r("hasWebhook").then(m=>{M=m,h()}),h(),document.querySelector(".content")?.scrollTo?.(0,0)}));let e=[...document.querySelectorAll('[role="tab"]')];e.forEach((t,n)=>t.addEventListener("keydown",m=>{let p=m.key,u=p==="ArrowRight"?(n+1)%e.length:p==="ArrowLeft"?(n-1+e.length)%e.length:p==="Home"?0:p==="End"?e.length-1:-1;u<0||(m.preventDefault(),l.tab=e[u].dataset.tab,f(),h(),document.getElementById(`tab-${l.tab}`)?.focus())})),document.querySelectorAll("details[data-key]").forEach(t=>t.addEventListener("toggle",()=>{l.open[t.dataset.key]=t.open,f()})),document.querySelectorAll("[data-open]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),r("openFile",{path:t.dataset.open})})),document.querySelectorAll("[data-goal-pick]").forEach(t=>t.addEventListener("click",()=>{l.goal=t.dataset.goalPick,f(),h()}));let a=(t,n)=>document.getElementById(t)?.addEventListener("input",m=>{l[n]=m.target.value,f()});a("req","request"),a("must","mustNotChange"),a("acc","acceptance"),document.getElementById("planFirst")?.addEventListener("change",t=>{l.planFirst=t.target.checked,f()}),document.querySelectorAll("#goal, #prefs, #newReq, #newAcc, #newDec, #newDecD, #appUrl, .acc-edit").forEach(t=>t.addEventListener("input",()=>{w[t.id]=t.value})),document.querySelectorAll(".acc-edit").forEach(t=>t.addEventListener("keydown",async n=>{if(n.key==="Escape")return delete w[t.id],q=null,h();n.key!=="Enter"||!t.value.trim()||(await r("updateRequirement",{id:t.dataset.id,patch:{acceptance:t.value.trim()}}),delete w[t.id],q=null,y("Saved"))})),document.getElementById("ptext")?.addEventListener("input",t=>{E=t.target.value}),document.getElementById("openWithTerminal")?.addEventListener("change",t=>void r("openWithTerminal",{value:t.target.checked})),document.getElementById("apiToggle")?.addEventListener("change",t=>void r("apiToggle",{value:t.target.checked})),document.getElementById("beginner")?.addEventListener("change",t=>void r("setBeginner",{value:t.target.checked})),document.querySelectorAll("[data-req-status]").forEach(t=>t.addEventListener("change",()=>void r("updateRequirement",{id:t.dataset.reqStatus,patch:{status:t.value}}))),document.getElementById("req")?.addEventListener("keydown",t=>{t.key==="Enter"&&(t.metaKey||t.ctrlKey)&&P()}),document.getElementById("newAcc")?.addEventListener("keydown",t=>{t.key==="Enter"&&te()}),document.getElementById("newReq")?.addEventListener("keydown",t=>{t.key==="Enter"&&document.getElementById("newAcc")?.focus()}),document.getElementById("newDecD")?.addEventListener("keydown",t=>{t.key==="Enter"&&document.querySelector('[data-act="addDec"]')?.click()}),document.getElementById("appUrl")?.addEventListener("keydown",t=>{t.key==="Enter"&&document.querySelector('[data-act="visualCheck"]')?.click()}),document.querySelectorAll("[data-act]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),Ce(t)}))}var C=e=>(document.getElementById(e)?.value??"").trim();async function P(){l.request=C("req")||l.request;let e=await r("buildPrompt",{goal:l.goal,request:l.request,mustNotChange:l.mustNotChange,acceptance:l.acceptance,beginner:F(),planFirst:l.planFirst});$=e,E=e.text,h(),document.getElementById("ptext")?.scrollIntoView?.({block:"nearest"})}async function te(){let e=C("newReq");if(!e){y("Type a requirement first"),document.getElementById("newReq")?.focus();return}await r("addRequirement",{title:e,acceptance:C("newAcc")}),delete w.newReq,delete w.newAcc;for(let a of["newReq","newAcc"]){let t=document.getElementById(a);t&&(t.value="")}y("Requirement added"),document.getElementById("newReq")?.focus()}async function Ce(e){let a=e.dataset.act;switch(a){case"build":return P();case"promptFor":return l.tab="prompts",l.goal=e.dataset.goal||"feature",l.request=e.dataset.request||"",f(),l.request?P():($=null,h());case"copyPrompt":return await r("copy",{text:E}),y("Prompt copied");case"sendPrompt":return void r("sendToClaude",{text:E});case"refine":{let t=await r("refine",{text:E});t?.text&&(E=t.text,h());return}case"copyHandoff":{let t=await r("handoff");return await r("copy",{text:t}),y("Handoff copied. Paste it into a new Claude Code session")}case"handoffPrompt":return l.tab="prompts",l.goal="handoff",l.request="Continue where the previous session left off.",f(),P();case"runScript":return void r("runScript",{script:e.dataset.script});case"dismiss":return void r("dismiss",{key:e.dataset.key});case"saveNote":return await r("setNote",{key:e.dataset.key,value:C(e.dataset.src)}),delete w[e.dataset.src],y("Saved");case"addReq":return te();case"delReq":return void r("deleteRequirement",{id:e.dataset.id});case"editAcc":q=e.dataset.id,h(),document.getElementById(`acc-${q}`)?.focus();return;case"addDec":{let t=C("newDec");if(!t){y("Type a decision first"),document.getElementById("newDec")?.focus();return}await r("addDecision",{title:t,detail:C("newDecD")}),delete w.newDec,delete w.newDecD;for(let n of["newDec","newDecD"]){let m=document.getElementById(n);m&&(m.value="")}return y("Decision recorded")}case"delDec":return void r("deleteDecision",{id:Number(e.dataset.id)});case"cpDiff":return D[e.dataset.sha]=await r("checkpointDiff",{sha:e.dataset.sha}),h();case"rollback":{let t=e.dataset.sha,n=[...document.querySelectorAll(`input.cpf[data-sha="${t}"]:checked`)].map(m=>m.value);return n.length?(await r("rollback",{sha:t,files:n}),D={},h()):y("Tick the files to restore first")}case"shellOn":return void r("shell",{on:!0});case"shellOff":return void r("shell",{on:!1});case"statuslineOn":return void r("statusline",{on:!0});case"statuslineOff":return void r("statusline",{on:!1});case"visualCheck":return void r("visualCheck",{url:C("appUrl")});case"worktree":return void r("worktree",{sessionId:e.dataset.session});case"explainSession":{let t=e.dataset.session,n=await r("explainSession",{sessionId:t});n&&(U[t]=n,h());return}case"demoOn":return void r("demo",{on:!0});case"demoOff":return void r("demo",{on:!1});case"setWebhook":return await r("setWebhook"),M=await r("hasWebhook"),h();default:return void r(a)}}r("goals").then(e=>{O=e??[],h()});R.postMessage({type:"ready"});})();
//# sourceMappingURL=webview.js.map
