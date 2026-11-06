"use strict";(()=>{var x=acquireVsCodeApi(),_=x.getState()??{},o={tab:"overview",open:{},goal:"feature",request:"",mustNotChange:"",acceptance:"",planFirst:!0,..._},c=null,b=null,h=null,$="",R=[],A={},P=!1,v=()=>x.setState(o),G=0,D=new Map;function d(e,t={}){let a=++G;return new Promise(n=>{D.set(a,n),x.postMessage({type:e,id:a,...t})})}window.addEventListener("message",e=>{let t=e.data;t.type==="reply"&&t.id?(D.get(t.id)?.(t.result),D.delete(t.id)):t.type==="state"?(c=t.state,b=t.settings,m()):t.type==="navigate"&&t.tab&&(o.tab=t.tab,v(),m())});var s=e=>String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]),i=(e,t="")=>`<i class="codicon codicon-${e} ${t}" aria-hidden="true"></i>`;function k(e){if(!e)return"never";let t=Math.max(0,Math.round((Date.now()-e)/1e3));return t<45?"just now":t<3600?`${Math.round(t/60)} min ago`:t<86400?`${Math.round(t/3600)} h ago`:`${Math.round(t/86400)} d ago`}var K={verified:"Verified",inferred:"Inferred",unverified:"Unverified",failed:"Failed",unknown:"Unknown"},g=(e,t="")=>`<span class="conf conf-${e}" title="${s(t||z(e))}">${K[e]}</span>`;function z(e){return{verified:"Checked directly (e.g. a command passed, a file exists).",inferred:"BuildPilot's best reading of the evidence. Could be wrong.",unverified:"Claimed or assumed, but not proven yet.",failed:"Checked, and it failed.",unknown:"Not enough information to say."}[e]}var Y={blocker:"error",high:"warning",medium:"info",low:"circle-small",info:"circle-small"},M=e=>`<span class="sev sev-${e}">${i(Y[e])}${e==="blocker"?"Blocker":e==="high"?"Important":e==="medium"?"Worth doing":"Optional"}</span>`,J={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"},W=e=>`<span class="dot dot-${e}" aria-hidden="true"></span>`,j=e=>e.startsWith("demo-")?`DEMO ${e.slice(5,11)}`:e.slice(0,8),Q=e=>e.split(/[\\/]/).pop()??e,H=e=>c?.project&&e.startsWith(c.project.root)?e.slice(c.project.root.length+1):e,N=()=>b?.beginner??!0;function B(e){return e.length?`<ul class="evidence">${e.map(t=>`<li><span class="ev-kind ev-${t.kind}" title="${t.kind==="observed"?"Seen directly":"Inferred"}">${t.kind==="observed"?"seen":"inferred"}</span> ${s(t.text)}${t.ref?` <a href="#" data-open="${s(t.ref)}" class="ref">${s(Q(t.ref))}</a>`:""}</li>`).join("")}</ul>`:""}function f(e,t,a,n=!1){let l=o.open[e]??n;return`<details data-key="${s(e)}" ${l?"open":""}><summary>${t}</summary><div class="details-body">${a}</div></details>`}var X=[{id:"overview",label:"Overview",icon:"home"},{id:"sessions",label:"Sessions",icon:"pulse"},{id:"supervisor",label:"Supervisor",icon:"shield"},{id:"prompts",label:"Prompts",icon:"sparkle"},{id:"memory",label:"Memory",icon:"book"},{id:"connect",label:"Connect",icon:"plug"}];function m(){let e=document.getElementById("app"),t=document.querySelector(".content")?.scrollTop??0,a=document.activeElement,n=a?.id,l=a?.selectionStart??null;if(!c){e.innerHTML='<div class="loading">Starting BuildPilot\u2026</div>';return}if(!c.project)return e.innerHTML=`<div class="empty">${i("folder-opened","big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`,F();let p=c.out.sessions.filter(u=>!u.endedAt&&c.generatedAt-u.lastEventAt<36e5),E=p.filter(u=>u.displayStatus==="awaiting_approval"||u.displayStatus==="blocked").length,C=c.out.issues.filter(u=>u.severity==="blocker"||u.severity==="high").length,w={sessions:E?`<span class="badge warn">${E}</span>`:p.length?`<span class="badge">${p.length}</span>`:"",supervisor:C?`<span class="badge err">${C}</span>`:""},y=c.out.health;e.innerHTML=`
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${s(c.facts?.name??c.project.name)} ${i("chevron-down")}</button>
      <span class="spacer"></span>
      ${c.analyzing?`<span class="muted small">${i("loading","spin")} Analyzing</span>`:`<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${i("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${y.level}">${W(y.level==="good"?"running":y.level==="blocked"?"failed":y.level==="attention"?"awaiting_approval":"unknown")}${s(y.label)}</span>
      <span class="chip" title="Development stage (${c.out.stage.confidence})">${s(c.out.stage.stage)}</span>
    </div>
    ${c.demo?`<div class="demo-banner">${i("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>`:""}
    ${b?.trusted?"":`<div class="demo-banner">${i("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>`}
    <nav class="tabs" role="tablist">${X.map(u=>`<button role="tab" aria-selected="${o.tab===u.id}" class="tab ${o.tab===u.id?"active":""}" data-tab="${u.id}" title="${u.label}">${i(u.icon)}<span class="tab-label">${u.label}</span>${w[u.id]??""}</button>`).join("")}</nav>
  </header>
  <main class="content" role="tabpanel">${c.errors.map(u=>`<div class="error-box">${i("error")} ${s(u)}</div>`).join("")}${Z()}</main>`,F();let q=document.querySelector(".content");if(q&&(q.scrollTop=t),n){let u=document.getElementById(n);if(u&&(u.focus(),l!==null&&"setSelectionRange"in u))try{u.setSelectionRange(l,l)}catch{}}}function Z(){switch(o.tab){case"overview":return te();case"sessions":return ae();case"supervisor":return ie();case"prompts":return le();case"memory":return re();case"connect":return de()}}function U(e,t=!0){let a=e.action,n=t?"primary":"secondary";return a?a.kind==="install_hooks"?`<button class="${n}" data-act="installHooks">Connect</button>`:a.kind==="checkpoint"?`<button class="${n}" data-act="checkpoint">${i("save")} Save checkpoint</button>`:a.kind==="run_script"?`<button class="${n}" data-act="runScript" data-script="${s(a.script)}" ${c?.runningScript?"disabled":""}>${i("play")} ${a.script==="install"?"Install":`Run ${s(a.script)}`}</button>`:a.kind==="prompt"?`<button class="${n}" data-act="promptFor" data-goal="${s(a.goal)}" data-request="${s(a.request)}">${i("sparkle")} Write the prompt</button>`:a.kind==="open_file"?`<button class="${n}" data-open="${s(a.path)}">Open</button>`:"":""}function ee(){let e=c.out.next;return e?`<section class="next sev-border-${e.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${M(e.severity)}</div>
    <div class="next-title">${s(e.title)}</div>
    <p>${s(e.why)}</p>
    <div class="actions">${U(e)}<button class="link" data-act="dismiss" data-key="${s(e.key)}" title="Hide for 24 hours">Not now</button></div>
    ${f(`ev:${e.key}`,"Why BuildPilot thinks so",B(e.evidence))}
  </section>`:`<section class="next good">${i("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`}function te(){let e=c,t=e.facts,a=e.out.sessions.filter(r=>!r.endedAt&&e.generatedAt-r.lastEventAt<36e5),n=a.filter(r=>r.displayStatus==="running").length,l=a.filter(r=>r.displayStatus==="awaiting_approval"||r.displayStatus==="blocked").length,p=e.out.issues.filter(r=>r.severity==="blocker"||r.severity==="high"),E=e.hooks.installed?a.length===0?"No active Claude Code sessions in this project.":`${n} session${n===1?"":"s"} working${l?`, <b>${l} waiting for you</b>`:""}. <a href="#" data-tab="sessions">See sessions</a>`:'Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>',C=p.length===0?"Nothing urgent found.":`${p.length} important issue${p.length===1?"":"s"}: ${s(p[0].title)}${p.length>1?` <a href="#" data-tab="supervisor">+${p.length-1} more</a>`:""}`,w=e.requirements.filter(r=>r.status!=="dropped"),y=w.filter(r=>r.status==="done"&&r.evidence==="verified"),q=w.filter(r=>r.status==="in_progress"||r.status==="done"&&r.evidence!=="verified"),u=w.filter(r=>r.status==="todo"),I=e.testRuns.find(r=>/test|vitest|jest|pytest/.test(r.command));return`
  ${ee()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${E}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${C}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${t?.description?`${s(t.description)} <span class="muted small">(from ${s(t.descriptionSource)})</span>`:e.notes.goal?s(e.notes.goal):'<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>'}</dd>
      <dt>Built with</dt><dd>${t?s([...t.languages,...t.frameworks].join(", ")||"Not detected"):"\u2026"}</dd>
      <dt>Stage</dt><dd>${s(e.out.stage.stage)} ${g(e.out.stage.confidence)}${f("stage-ev","evidence",B(e.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${e.out.progress.total?`<div class="bar" role="progressbar" aria-valuenow="${e.out.progress.done}" aria-valuemax="${e.out.progress.total}"><span style="width:${Math.round(e.out.progress.done/e.out.progress.total*100)}%"></span></div>`:""}${s(e.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${I?`${I.passed?g("verified","Passed when BuildPilot ran it")+" passing":g("failed")+" failing"} \xB7 ${k(I.startedAt)}`:`${g("unknown")} not run yet${t?.scripts.test?' \xB7 <a href="#" data-act="runScript" data-script="test">Run tests</a>':""}`}</dd>
      <dt>Git</dt><dd>${e.changes?`${s(e.changes.branch??"detached")} \xB7 ${e.changes.unstaged.length+e.changes.untracked.length+e.changes.staged.length} uncommitted`:t?.isGit===!1?`${g("failed")} not using Git`:"\u2026"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${w.length===0?`<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${t?.checklistItems.length?`<a href="#" data-act="importChecklist">Import ${t.checklistItems.length} checklist items from your docs</a> or `:""}<a href="#" data-tab="memory">add them</a>.</p>`:`${L("Done & verified",y,"verified")}${L("Partly done / unproven",q,"unverified")}${L("Not started",u,"unknown")}`}
  </section>
  ${e.resolved.length?`<section><h3>Recently resolved</h3><ul class="plain">${e.resolved.map(r=>`<li>${i("check","ok")} ${s(r.title)} <span class="muted small">${k(r.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>`:""}
  <section>
    <h3>Recent work</h3>
    ${e.commits.length?`<ul class="plain">${e.commits.slice(0,5).map(r=>`<li><span class="muted small">${k(r.ts)}</span> ${s(r.subject)}</li>`).join("")}</ul>`:'<p class="muted">No commits yet.</p>'}
  </section>
  ${se()}`}function L(e,t,a){return t.length?`<div class="fgroup"><div class="fgroup-h">${g(a)} ${s(e)} <span class="muted">(${t.length})</span></div><ul class="plain">${t.slice(0,8).map(n=>`<li>${s(n.title)}</li>`).join("")}${t.length>8?`<li class="muted">+${t.length-8} more</li>`:""}</ul></div>`:""}function se(){let e=c,t=[{done:!!e.integration.claudeInstalled,label:"Claude Code installed",hint:e.integration.claudeInstalled===null?"checking\u2026":e.integration.claudeVersion??"Install from claude.com/claude-code"},{done:e.hooks.installed,label:"BuildPilot connected to Claude Code",hint:e.hooks.installed?"Live sessions will appear automatically":"",act:e.hooks.installed?"":'<button class="secondary small" data-act="installHooks">Connect</button>'},{done:!!e.integration.gitAvailable&&!!e.facts?.isGit,label:"Project uses Git",hint:e.facts?.isGit?"":"Needed for checkpoints and rollback"}];return t.every(a=>a.done)?"":`<section><h3>Setup</h3><ul class="steps">${t.map(a=>`<li>${i(a.done?"pass-filled":"circle-large-outline",a.done?"ok":"muted")} <span>${s(a.label)}${a.hint?` <span class="muted small">\xB7 ${s(a.hint)}</span>`:""}</span> ${a.act??""}</li>`).join("")}</ul></section>`}function ae(){let e=c;if(!e.hooks.installed&&e.out.sessions.length===0)return`<div class="empty">${i("plug","big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;if(e.out.sessions.length===0)return`<div class="empty">${i("terminal","big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p>${e.integration.otherProjectSessions?`<p class="muted small">${e.integration.otherProjectSessions} active session(s) are running in other folders.</p>`:""}<p class="muted small">Already running? Sessions started before connecting need a restart.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${i("sparkle")} Write a first prompt</button></div>`;let t=e.out.sessions.filter(n=>!n.endedAt&&e.generatedAt-n.lastEventAt<12*36e5),a=e.out.sessions.filter(n=>!t.includes(n));return`
    ${t.length?`<h3>Active <span class="muted small">(${t.length})</span></h3>${t.map(O).join("")}`:'<p class="muted">No active sessions.</p>'}
    ${a.length?f("past-sessions",`Earlier sessions (${a.length})`,a.map(O).join("")):""}
    ${e.integration.otherProjectSessions?`<p class="muted small">${e.integration.otherProjectSessions} active session(s) in other folders aren't shown.</p>`:""}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`}function O(e){let t=c.usage[e.id],a=t&&t.source==="transcript"?`${t.lastTurnInputTokens?.toLocaleString()??"?"} tokens in context (estimate) \xB7 ${t.totalOutputTokens?.toLocaleString()??"?"} written \xB7 ${t.assistantTurns} turns`:"Unknown (no local transcript data)",n=e.recent.map(l=>`<li class="${l.isError?"err":""}"><span class="muted small t">${new Date(l.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${s(l.summary)}${l.filePath?` <a href="#" data-open="${s(l.filePath)}" class="ref">open</a>`:""}${l.isError&&l.errorText?`<div class="errtext">${s(l.errorText.split(`
`).slice(0,3).join(" "))}</div>`:""}</li>`).join("");return`<article class="session ${e.displayStatus}" aria-label="Session ${s(j(e.id))}">
    <div class="s-head">${W(e.displayStatus)}<b>${J[e.displayStatus]??e.displayStatus}</b><span class="muted small mono">${s(j(e.id))}</span><span class="spacer"></span><span class="muted small">${k(e.lastEventAt)}</span></div>
    ${e.currentTask?`<div class="s-task" title="Last prompt you gave it">\u201C${s(e.currentTask)}\u201D</div>`:'<div class="s-task muted">Task unknown (no prompt seen yet)</div>'}
    <div class="s-reason">${s(e.displayReason)}</div>
    ${e.intervention?`<div class="s-int">${i("arrow-right")} ${s(e.intervention)}</div>`:""}
    ${e.overlapsWith.length?`<div class="s-int warn">${i("warning")} Editing the same files as ${e.overlapsWith.map(j).join(", ")}</div>`:""}
    ${f(`sess:${e.id}`,`Details \xB7 ${e.eventCount} events${e.errorCount?` \xB7 <span class="errc">${e.errorCount} errors</span>`:""}`,`
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${s(H(e.cwd)||".")}</dd>
        <dt>Model</dt><dd>${s(t?.model??e.model??"Unknown")}</dd>
        <dt>Usage</dt><dd>${s(a)}</dd>
        <dt>Cost</dt><dd>Unknown <span class="muted">(subscriptions don't expose per-session cost)</span></dd>
        <dt>Started</dt><dd>${new Date(e.startedAt).toLocaleString()}</dd>
        ${e.permissionMode?`<dt>Permissions</dt><dd>${s(e.permissionMode)}</dd>`:""}
      </dl>
      ${e.editedFiles.length?`<div class="sub">Changed files</div><ul class="plain files">${e.editedFiles.map(l=>`<li><a href="#" data-open="${s(l)}">${s(H(l))}</a></li>`).join("")}</ul>`:""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${n||"<li class='muted'>No events</li>"}</ul>`)}
  </article>`}function ne(e){return`<li class="issue">${M(e.severity)}<div class="issue-body"><div class="issue-title">${s(e.title)}</div>${N()?`<div class="plain-expl">${s(e.plain)}</div>`:""}${f(`iss:${e.key}`,"Evidence",(N()?"":`<p class="plain-expl">${s(e.plain)}</p>`)+B(e.evidence))}</div></li>`}function ie(){let e=c,t=e.out.recommendations,a=e.facts;return`
  <section>
    <h3>Issues <span class="muted small">${e.out.issues.length?`(${e.out.issues.length})`:""}</span></h3>
    ${e.out.issues.length?`<ul class="issues">${e.out.issues.map(ne).join("")}</ul>`:`<p class="muted">${i("pass","ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${t.length?`<ol class="recs">${t.slice(0,8).map(n=>`<li><div class="rec-title">${s(n.title)} ${M(n.severity)}</div><div class="muted">${s(n.why)}</div><div class="actions">${U(n,!1)}<button class="link" data-act="dismiss" data-key="${s(n.key)}">Not now</button></div></li>`).join("")}</ol>`:'<p class="muted">Nothing to recommend right now.</p>'}
  </section>
  <section>
    <h3>Checks</h3>
    <div class="actions wrap">
      ${a?.scripts.test?`<button class="secondary" data-act="runScript" data-script="test" ${e.runningScript?"disabled":""}>${i("beaker")} Run tests</button>`:""}
      ${a?.scripts.build?`<button class="secondary" data-act="runScript" data-script="build" ${e.runningScript?"disabled":""}>${i("package")} Build</button>`:""}
      ${a?.scripts.lint?`<button class="secondary" data-act="runScript" data-script="lint" ${e.runningScript?"disabled":""}>${i("checklist")} Lint</button>`:""}
      ${a?.scripts.typecheck?`<button class="secondary" data-act="runScript" data-script="typecheck" ${e.runningScript?"disabled":""}>${i("symbol-type-parameter")} Typecheck</button>`:""}
      <button class="secondary" data-act="analyze">${i("shield")} Re-scan</button>
    </div>
    ${e.runningScript?`<p class="muted">${i("loading","spin")} Running <code>${s(e.runningScript)}</code>\u2026</p>`:""}
    ${e.testRuns.length?f("runs",`Recent runs (${e.testRuns.length})`,`<ul class="plain">${e.testRuns.slice(0,8).map(n=>`<li>${n.passed?i("pass","ok"):i("error","bad")} <code>${s(n.command)}</code> <span class="muted small">${k(n.startedAt)} \xB7 ${(n.durationMs/1e3).toFixed(1)}s</span>${f(`run:${n.id}`,"output",`<pre>${s(n.outputTail)}</pre>`)}</li>`).join("")}</ul>`):""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${e.out.readiness.map(n=>`<li>${g(n.status)} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${e.doctor.length?`<ul class="ready">${e.doctor.map(n=>`<li>${g(n.status==="ok"?"verified":n.status==="fail"?"failed":n.status==="warn"?"unverified":"unknown")} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>`:'<p class="muted">No checks apply to this project type yet.</p>'}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${a?.isGit?"":"disabled"}>${i("save")} Save checkpoint</button></div>
    ${e.checkpoints.length?`<ul class="plain">${e.checkpoints.slice(0,6).map(n=>`<li>${i("history")} ${s(n.label)} <span class="muted small">${k(n.ts)} \xB7 ${n.sha.slice(0,8)}</span> <a href="#" data-act="cpDiff" data-sha="${n.sha}">changed since</a>${A[n.sha]?oe(n.sha):""}</li>`).join("")}</ul>`:""}
  </section>`}function oe(e){let t=A[e];return t.length?`<div class="cp-files"><ul class="plain files">${t.slice(0,40).map(a=>`<li><label><input type="checkbox" class="cpf" data-sha="${e}" value="${s(a)}"> ${s(a)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${e}">${i("discard")} Restore selected files</button></div>`:'<div class="muted small">No changes since this checkpoint.</div>'}function le(){let e=R.find(t=>t.id===o.goal);return`
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${R.map(t=>`<button role="radio" aria-checked="${t.id===o.goal}" class="goal ${t.id===o.goal?"on":""}" data-goal-pick="${t.id}" title="${s(t.plain)}">${s(t.label)}</button>`).join("")}</div>
    ${e?`<p class="muted small">${s(e.plain)}</p>`:""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${s(e?.hint??"")}">${s(o.request)}</textarea>
    ${e?.questions.length?`<div class="muted small hint">Helpful to include: ${e.questions.map(s).join(" \xB7 ")}</div>`:""}
    ${f("prompt-more","More options",`
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${s(o.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when\u2026" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${s(o.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${o.planFirst?"checked":""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${i("sparkle")} Build prompt</button></div>
  </section>
  ${h?`
  <section class="built">
    ${h.missingInfo.length?`<div class="note warn">${i("question")} <div><b>Worth adding</b><ul>${h.missingInfo.map(t=>`<li>${s(t)}</li>`).join("")}</ul></div></div>`:""}
    ${h.assumptions.length?`<div class="note">${i("info")} <div><b>Assumptions made</b><ul>${h.assumptions.map(t=>`<li>${s(t)}</li>`).join("")}</ul></div></div>`:""}
    <div class="muted small">Model: ${s(h.suggestedModel)} \xB7 ${h.verification.length?`Verifies with: ${h.verification.join(", ")}`:"No check commands found"} \xB7 ${$.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${s($)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${i("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${b?.trusted?"":"disabled"} title="Opens a terminal and starts Claude Code with this prompt">${i("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${b?.aiProvider==="none"?"Needs an AI provider (optional)":"Uses "+s(b?.aiProvider)}">${i("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>`:""}`}function re(){let e=c,t=a=>["todo","in_progress","done","dropped"].map(n=>`<option value="${n}" ${a.status===n?"selected":""}>${{todo:"Not started",in_progress:"In progress",done:"Done",dropped:"Dropped"}[n]}</option>`).join("");return`
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" placeholder="What are you building, for whom, and what does success look like?">${s(e.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${e.requirements.length?`<ul class="reqs">${e.requirements.map(a=>`<li>
      <div class="req-top"><select data-req-status="${a.id}" aria-label="Status for ${s(a.title)}">${t(a)}</select><span class="req-title">${s(a.title)}</span>${a.status==="done"?g(a.evidence,a.evidenceNote):""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${a.id}" aria-label="Delete requirement">${i("trash")}</button></div>
      <div class="muted small">${a.acceptance?`Done when: ${s(a.acceptance)}`:`<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${a.id}">Add</a>`}</div>
    </li>`).join("")}</ul>`:""}
    <input id="newReq" type="text" placeholder="e.g. Users can pay with a card">
    <input id="newAcc" type="text" placeholder="Done when\u2026 e.g. a test payment succeeds and a receipt is emailed">
    <div class="actions"><button class="secondary small" data-act="addReq">Add requirement</button>${e.facts?.checklistItems.length?`<button class="link" data-act="importChecklist">Import ${e.facts.checklistItems.length} from docs</button>`:""}</div>
  </section>
  <section>
    <h3>Decisions</h3>
    ${e.decisions.length?`<ul class="plain">${e.decisions.map(a=>`<li><b>${s(a.title)}</b>${a.detail?`: ${s(a.detail)}`:""} <button class="icon-btn" data-act="delDec" data-id="${a.id}" aria-label="Delete decision">${i("close")}</button></li>`).join("")}</ul>`:`<p class="muted small">Record choices (e.g. "Use Supabase for auth") so new sessions don't undo them.</p>`}
    <input id="newDec" type="text" placeholder="Decision"><input id="newDecD" type="text" placeholder="Why / detail (optional)">
    <div class="actions"><button class="secondary small" data-act="addDec">Add decision</button></div>
  </section>
  <section>
    <h3>Preferences</h3>
    <textarea id="prefs" rows="2" placeholder="e.g. Keep the UI minimal. Use TypeScript. Explain things simply.">${s(e.notes.preferences)}</textarea>
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
    <p class="muted small">Stored only on this computer in <code>${s(b?.home??"~/.buildpilot")}</code>.</p>
    <div class="actions wrap"><button class="link danger" data-act="deleteProjectData">Delete this project's data</button><button class="link danger" data-act="deleteAllData">Delete all data</button></div>
  </section>`}function de(){let e=c,t=b;return`
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${i(e.integration.claudeInstalled?"pass-filled":"circle-large-outline",e.integration.claudeInstalled?"ok":"muted")} <span>${e.integration.claudeInstalled?`Installed: ${s(e.integration.claudeVersion)}`:e.integration.claudeInstalled===null?"Checking\u2026":"Not found on PATH"}</span></li>
      <li>${i(e.hooks.installed?"pass-filled":"circle-large-outline",e.hooks.installed?"ok":"muted")} <span>${e.hooks.installed?"Connected":e.hooks.settingsError?`Settings file problem: ${s(e.hooks.settingsError)}`:"Not connected"}<div class="muted small mono">${s(e.hooks.settingsPath)}</div></span></li>
      <li>${i("database","muted")} <span>${e.integration.spool.accepted} events received this run${e.integration.spool.rejected?`, ${e.integration.spool.rejected} malformed ignored`:""}${e.integration.spool.lastEventAt?` \xB7 last ${k(e.integration.spool.lastEventAt)}`:""}</span></li>
    </ul>
    <div class="actions wrap">${e.hooks.installed?'<button class="link" data-act="uninstallHooks">Disconnect</button>':'<button class="primary" data-act="installHooks">Connect</button>'}${e.demo?'<button class="link" data-act="demoOff">Remove demo data</button>':'<button class="link" data-act="demoOn">Load demo data</button>'}</div>
  </section>
  <section>
    <h3>Phone, glasses &amp; other devices</h3>
    <p class="muted small">Get alerts where you are, like "Claude needs your approval" or "Tests failing". Send them to <b>ntfy</b> (free phone push; smart glasses paired to your phone can read phone notifications aloud), <b>Slack</b>, <b>Discord</b>, or any webhook. Only short alerts and the project name are sent, never code.</p>
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${i("bell")} ${P?"Change notification URL":"Set up notifications"}</button>${P?'<button class="link" data-act="testWebhook">Send test</button>':""}</div>
  </section>
  <section>
    <h3>Integration API</h3>
    <p class="muted small">Lets your own tools ask BuildPilot what's happening: iOS Shortcuts / Siri, Raycast, Stream Deck, a companion app for smart glasses, or a bot. Read-only plus prompt generation. It can't run commands or change files. Requires a secret token.</p>
    <label class="check"><input type="checkbox" id="apiToggle" ${t.apiEnabled?"checked":""}> Enable on ${t.apiAllowLan?"your local network":"this computer only"}</label>
    ${t.apiEnabled&&t.apiAddress?`<div class="mono small api">${s(t.apiAddress)}/v1/brief?format=text<br>${s(t.apiAddress)}/v1/status \xB7 /v1/sessions \xB7 /v1/next<br>POST ${s(t.apiAddress)}/v1/prompt {"goal","request"}</div>
      <div class="actions wrap"><button class="secondary small" data-act="copyApiToken">${i("key")} Copy token</button><button class="link" data-act="rotateApiToken">New token</button><button class="link" data-act="settings">Port / network settings</button></div>`:""}
  </section>
  <section>
    <h3>AI refinement <span class="muted small">(optional)</span></h3>
    <p class="muted small">BuildPilot works fully without AI. Optionally refine prompts with your own Anthropic API key or a local Ollama model. Nothing is sent without your OK each time.</p>
    <div class="muted small">Provider: <b>${s(t.aiProvider)}</b>${t.aiModel?` \xB7 ${s(t.aiModel)}`:""}</div>
    <div class="actions"><button class="link" data-act="settings">Change in Settings</button></div>
  </section>
  <section>
    <h3>Experience</h3>
    <label class="check"><input type="checkbox" id="beginner" ${t.beginner?"checked":""}> Beginner explanations (plain-English "why it matters")</label>
    <div class="muted small">Pop-up alerts: ${s(t.notifications)} \xB7 <a href="#" data-act="settings">change</a></div>
  </section>`}function F(){document.querySelectorAll("[data-tab]").forEach(t=>t.addEventListener("click",a=>{a.preventDefault(),o.tab=t.dataset.tab,v(),o.tab==="connect"&&d("hasWebhook").then(n=>{P=n,m()}),m(),document.querySelector(".content")?.scrollTo(0,0)})),document.querySelectorAll("details[data-key]").forEach(t=>t.addEventListener("toggle",()=>{o.open[t.dataset.key]=t.open,v()})),document.querySelectorAll("[data-open]").forEach(t=>t.addEventListener("click",a=>{a.preventDefault(),d("openFile",{path:t.dataset.open})})),document.querySelectorAll("[data-goal-pick]").forEach(t=>t.addEventListener("click",()=>{o.goal=t.dataset.goalPick,v(),m()}));let e=(t,a)=>document.getElementById(t)?.addEventListener("input",n=>{o[a]=n.target.value,v()});e("req","request"),e("must","mustNotChange"),e("acc","acceptance"),document.getElementById("planFirst")?.addEventListener("change",t=>{o.planFirst=t.target.checked,v()}),document.getElementById("ptext")?.addEventListener("input",t=>{$=t.target.value}),document.getElementById("apiToggle")?.addEventListener("change",t=>void d("apiToggle",{value:t.target.checked})),document.getElementById("beginner")?.addEventListener("change",t=>void d("setBeginner",{value:t.target.checked})),document.querySelectorAll("[data-req-status]").forEach(t=>t.addEventListener("change",()=>void d("updateRequirement",{id:t.dataset.reqStatus,patch:{status:t.value}}))),document.getElementById("req")?.addEventListener("keydown",t=>{t.key==="Enter"&&(t.metaKey||t.ctrlKey)&&T()}),document.getElementById("newAcc")?.addEventListener("keydown",t=>{t.key==="Enter"&&V()}),document.querySelectorAll("[data-act]").forEach(t=>t.addEventListener("click",a=>{a.preventDefault(),ce(t)}))}var S=e=>(document.getElementById(e)?.value??"").trim();async function T(){o.request=S("req")||o.request;let e=await d("buildPrompt",{goal:o.goal,request:o.request,mustNotChange:o.mustNotChange,acceptance:o.acceptance,beginner:N(),planFirst:o.planFirst});h=e,$=e.text,m(),document.getElementById("ptext")?.scrollIntoView({block:"nearest"})}async function V(){let e=S("newReq");e&&await d("addRequirement",{title:e,acceptance:S("newAcc")})}async function ce(e){let t=e.dataset.act;switch(t){case"build":return T();case"promptFor":return o.tab="prompts",o.goal=e.dataset.goal||"feature",o.request=e.dataset.request||"",v(),o.request?T():(h=null,m());case"copyPrompt":return void d("copy",{text:$});case"sendPrompt":return void d("sendToClaude",{text:$});case"refine":{let a=await d("refine",{text:$});a?.text&&($=a.text,m());return}case"copyHandoff":{let a=await d("handoff");return void d("copy",{text:a})}case"handoffPrompt":return o.tab="prompts",o.goal="handoff",o.request="Continue where the previous session left off.",v(),T();case"runScript":return void d("runScript",{script:e.dataset.script});case"dismiss":return void d("dismiss",{key:e.dataset.key});case"saveNote":return void d("setNote",{key:e.dataset.key,value:S(e.dataset.src)});case"addReq":return V();case"delReq":return void d("deleteRequirement",{id:e.dataset.id});case"editAcc":{let n=e.closest("li")?.querySelector(".req-title")?.textContent??"",l=document.createElement("input");l.type="text",l.placeholder=`Done when\u2026 (for "${n}")`,e.replaceWith(l),l.focus(),l.addEventListener("keydown",p=>{p.key==="Enter"&&l.value.trim()&&d("updateRequirement",{id:e.dataset.id,patch:{acceptance:l.value.trim()}})});return}case"addDec":{let a=S("newDec");a&&await d("addDecision",{title:a,detail:S("newDecD")});return}case"delDec":return void d("deleteDecision",{id:Number(e.dataset.id)});case"cpDiff":return A[e.dataset.sha]=await d("checkpointDiff",{sha:e.dataset.sha}),m();case"rollback":{let a=e.dataset.sha,n=[...document.querySelectorAll(`input.cpf[data-sha="${a}"]:checked`)].map(l=>l.value);return n.length?(await d("rollback",{sha:a,files:n}),A={},m()):void 0}case"demoOn":return void d("demo",{on:!0});case"demoOff":return void d("demo",{on:!1});case"setWebhook":return await d("setWebhook"),P=await d("hasWebhook"),m();default:return void d(t)}}d("goals").then(e=>{R=e??[],m()});x.postMessage({type:"ready"});})();
//# sourceMappingURL=webview.js.map
