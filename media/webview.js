"use strict";(()=>{var P=acquireVsCodeApi(),G=P.getState()??{},o={tab:"overview",open:{},goal:"feature",request:"",mustNotChange:"",acceptance:"",planFirst:!0,...G},d=null,g=null,v=null,k="",R=[],A={},T=!1,D={},y=()=>P.setState(o),z=0,M=new Map;function l(e,t={}){let s=++z;return new Promise(n=>{M.set(s,n),P.postMessage({type:e,id:s,...t})})}window.addEventListener("message",e=>{let t=e.data;t.type==="reply"&&t.id?(M.get(t.id)?.(t.result),M.delete(t.id)):t.type==="state"?(d=t.state,g=t.settings,h()):t.type==="navigate"&&t.tab&&(o.tab=t.tab,y(),h())});var a=e=>String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t]),i=(e,t="")=>`<i class="codicon codicon-${e} ${t}" aria-hidden="true"></i>`;function b(e){if(!e)return"never";let t=Math.max(0,Math.round((Date.now()-e)/1e3));return t<45?"just now":t<3600?`${Math.round(t/60)} min ago`:t<86400?`${Math.round(t/3600)} h ago`:`${Math.round(t/86400)} d ago`}var K={verified:"Verified",inferred:"Inferred",unverified:"Unverified",failed:"Failed",unknown:"Unknown"},$=(e,t="")=>`<span class="conf conf-${e}" title="${a(t||Y(e))}">${K[e]}</span>`;function Y(e){return{verified:"Checked directly (e.g. a command passed, a file exists).",inferred:"BuildPilot's best reading of the evidence. Could be wrong.",unverified:"Claimed or assumed, but not proven yet.",failed:"Checked, and it failed.",unknown:"Not enough information to say."}[e]}var J={blocker:"error",high:"warning",medium:"info",low:"circle-small",info:"circle-small"},B=e=>`<span class="sev sev-${e}">${i(J[e])}${e==="blocker"?"Blocker":e==="high"?"Important":e==="medium"?"Worth doing":"Optional"}</span>`,Q={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"},W=e=>`<span class="dot dot-${e}" aria-hidden="true"></span>`,j=e=>e.startsWith("demo-")?`DEMO ${e.slice(5,11)}`:e.slice(0,8),X=e=>e.split(/[\\/]/).pop()??e,H=e=>d?.project&&e.startsWith(d.project.root)?e.slice(d.project.root.length+1):e,N=()=>g?.beginner??!0;function U(e){return e.length?`<ul class="evidence">${e.map(t=>`<li><span class="ev-kind ev-${t.kind}" title="${t.kind==="observed"?"Seen directly":"Inferred"}">${t.kind==="observed"?"seen":"inferred"}</span> ${a(t.text)}${t.ref?` <a href="#" data-open="${a(t.ref)}" class="ref">${a(X(t.ref))}</a>`:""}</li>`).join("")}</ul>`:""}function f(e,t,s,n=!1){let u=o.open[e]??n;return`<details data-key="${a(e)}" ${u?"open":""}><summary>${t}</summary><div class="details-body">${s}</div></details>`}var Z=[{id:"overview",label:"Overview",icon:"home"},{id:"sessions",label:"Sessions",icon:"pulse"},{id:"supervisor",label:"Supervisor",icon:"shield"},{id:"prompts",label:"Prompts",icon:"sparkle"},{id:"memory",label:"Memory",icon:"book"},{id:"connect",label:"Connect",icon:"plug"}];function h(){let e=document.getElementById("app"),t=document.querySelector(".content")?.scrollTop??0,s=document.activeElement,n=s?.id,u=s?.selectionStart??null;if(!d){e.innerHTML='<div class="loading">Starting BuildPilot\u2026</div>';return}if(!d.project)return e.innerHTML=`<div class="empty">${i("folder-opened","big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`,F();let m=d.out.sessions.filter(c=>!c.endedAt&&d.generatedAt-c.lastEventAt<36e5),p=m.filter(c=>c.displayStatus==="awaiting_approval"||c.displayStatus==="blocked").length,E=d.out.issues.filter(c=>c.severity==="blocker"||c.severity==="high").length,C={sessions:p?`<span class="badge warn">${p}</span>`:m.length?`<span class="badge">${m.length}</span>`:"",supervisor:E?`<span class="badge err">${E}</span>`:""},w=d.out.health;e.innerHTML=`
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${a(d.facts?.name??d.project.name)} ${i("chevron-down")}</button>
      <span class="spacer"></span>
      ${d.analyzing?`<span class="muted small">${i("loading","spin")} Analyzing</span>`:`<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${i("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${w.level}">${W(w.level==="good"?"running":w.level==="blocked"?"failed":w.level==="attention"?"awaiting_approval":"unknown")}${a(w.label)}</span>
      <span class="chip" title="Development stage (${d.out.stage.confidence})">${a(d.out.stage.stage)}</span>
    </div>
    ${d.demo?`<div class="demo-banner">${i("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>`:""}
    ${g?.trusted?"":`<div class="demo-banner">${i("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>`}
    <nav class="tabs" role="tablist">${Z.map(c=>`<button role="tab" aria-selected="${o.tab===c.id}" class="tab ${o.tab===c.id?"active":""}" data-tab="${c.id}" title="${c.label}" aria-label="${c.label}">${i(c.icon)}<span class="tab-label">${c.label}</span>${C[c.id]??""}</button>`).join("")}</nav>
  </header>
  <main class="content" role="tabpanel">${d.errors.map(c=>`<div class="error-box">${i("error")} ${a(c)}</div>`).join("")}${ee()}</main>`,F();let x=document.querySelector(".content");if(x&&(x.scrollTop=t),n){let c=document.getElementById(n);if(c&&(c.focus(),u!==null&&"setSelectionRange"in c))try{c.setSelectionRange(u,u)}catch{}}}function ee(){switch(o.tab){case"overview":return se();case"sessions":return ne();case"supervisor":return oe();case"prompts":return re();case"memory":return de();case"connect":return ce()}}function _(e,t=!0){let s=e.action,n=t?"primary":"secondary";return s?s.kind==="install_hooks"?`<button class="${n}" data-act="installHooks">Connect</button>`:s.kind==="checkpoint"?`<button class="${n}" data-act="checkpoint">${i("save")} Save checkpoint</button>`:s.kind==="run_script"?`<button class="${n}" data-act="runScript" data-script="${a(s.script)}" ${d?.runningScript?"disabled":""}>${i("play")} ${s.script==="install"?"Install":`Run ${a(s.script)}`}</button>`:s.kind==="prompt"?`<button class="${n}" data-act="promptFor" data-goal="${a(s.goal)}" data-request="${a(s.request)}">${i("sparkle")} Write the prompt</button>`:s.kind==="open_file"?`<button class="${n}" data-open="${a(s.path)}">Open</button>`:s.kind==="audit"?`<button class="${n}" data-act="audit">${i("shield")} Check dependencies</button>`:s.kind==="visual_check"?`<button class="${n}" data-act="visualCheck">${i("eye")} Check the app</button>`:s.kind==="worktree"?`<button class="${n}" data-act="worktree" data-session="${a(s.sessionId)}">${i("git-branch")} Separate the sessions</button>`:s.kind==="open_tab"?`<button class="${n}" data-tab="${s.tab}">Open ${s.tab[0].toUpperCase()+s.tab.slice(1)}</button>`:"":""}function te(){let e=d.out.next;return e?`<section class="next sev-border-${e.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${B(e.severity)}</div>
    <div class="next-title">${a(e.title)}</div>
    <p>${a(e.why)}</p>
    <div class="actions">${_(e)}<button class="link" data-act="dismiss" data-key="${a(e.key)}" title="Hide for 24 hours">Not now</button></div>
    ${f(`ev:${e.key}`,"Why BuildPilot thinks so",U(e.evidence))}
  </section>`:`<section class="next good">${i("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`}function se(){let e=d,t=e.facts,s=e.out.sessions.filter(r=>!r.endedAt&&e.generatedAt-r.lastEventAt<36e5),n=s.filter(r=>r.displayStatus==="running").length,u=s.filter(r=>r.displayStatus==="awaiting_approval"||r.displayStatus==="blocked").length,m=e.out.issues.filter(r=>r.severity==="blocker"||r.severity==="high"),p=e.hooks.installed?s.length===0?"No active Claude Code sessions in this project.":`${n} session${n===1?"":"s"} working${u?`, <b>${u} waiting for you</b>`:""}. <a href="#" data-tab="sessions">See sessions</a>`:'Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>',E=m.length===0?"Nothing urgent found.":`${m.length} important issue${m.length===1?"":"s"}: ${a(m[0].title)}${m.length>1?` <a href="#" data-tab="supervisor">+${m.length-1} more</a>`:""}`,C=e.requirements.filter(r=>r.status!=="dropped"),w=C.filter(r=>r.status==="done"&&r.evidence==="verified"),x=C.filter(r=>r.status==="in_progress"||r.status==="done"&&r.evidence!=="verified"),c=C.filter(r=>r.status==="todo"),I=e.testRuns.find(r=>/test|vitest|jest|pytest/.test(r.command));return`
  ${te()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${p}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${E}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${t?.description?`${a(t.description)} <span class="muted small">(from ${a(t.descriptionSource)})</span>`:e.notes.goal?a(e.notes.goal):'<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>'}</dd>
      <dt>Built with</dt><dd>${t?a([...t.languages,...t.frameworks].join(", ")||"Not detected"):"\u2026"}</dd>
      <dt>Stage</dt><dd>${a(e.out.stage.stage)} ${$(e.out.stage.confidence)}${f("stage-ev","evidence",U(e.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${e.out.progress.total?`<div class="bar" role="progressbar" aria-valuenow="${e.out.progress.done}" aria-valuemax="${e.out.progress.total}"><span style="width:${Math.round(e.out.progress.done/e.out.progress.total*100)}%"></span></div>`:""}${a(e.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${I?`${I.passed?$("verified","Passed when BuildPilot ran it")+" passing":$("failed")+" failing"} \xB7 ${b(I.startedAt)}`:`${$("unknown")} not run yet${t?.scripts.test?' \xB7 <a href="#" data-act="runScript" data-script="test">Run tests</a>':""}`}</dd>
      <dt>Git</dt><dd>${e.changes?`${a(e.changes.branch??"detached")} \xB7 ${e.changes.unstaged.length+e.changes.untracked.length+e.changes.staged.length} uncommitted`:t?.isGit===!1?`${$("failed")} not using Git`:"\u2026"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${C.length===0?`<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${t?.checklistItems.length?`<a href="#" data-act="importChecklist">Import ${t.checklistItems.length} checklist items from your docs</a> or `:""}<a href="#" data-tab="memory">add them</a>.</p>`:`${L("Done & verified",w,"verified")}${L("Partly done / unproven",x,"unverified")}${L("Not started",c,"unknown")}`}
  </section>
  ${e.resolved.length?`<section><h3>Recently resolved</h3><ul class="plain">${e.resolved.map(r=>`<li>${i("check","ok")} ${a(r.title)} <span class="muted small">${b(r.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>`:""}
  <section>
    <h3>Recent work</h3>
    ${e.commits.length?`<ul class="plain">${e.commits.slice(0,5).map(r=>`<li><span class="muted small">${b(r.ts)}</span> ${a(r.subject)}</li>`).join("")}</ul>`:'<p class="muted">No commits yet.</p>'}
  </section>
  ${ae()}`}function L(e,t,s){return t.length?`<div class="fgroup"><div class="fgroup-h">${$(s)} ${a(e)} <span class="muted">(${t.length})</span></div><ul class="plain">${t.slice(0,8).map(n=>`<li>${a(n.title)}</li>`).join("")}${t.length>8?`<li class="muted">+${t.length-8} more</li>`:""}</ul></div>`:""}function ae(){let e=d,t=[{done:!!e.integration.claudeInstalled,label:"Claude Code installed",hint:e.integration.claudeInstalled===null?"checking\u2026":e.integration.claudeVersion??"Install from claude.com/claude-code"},{done:e.hooks.installed,label:"BuildPilot connected to Claude Code",hint:e.hooks.installed?"Live sessions will appear automatically":"",act:e.hooks.installed?"":'<button class="secondary small" data-act="installHooks">Connect</button>'},{done:!!e.integration.gitAvailable&&!!e.facts?.isGit,label:"Project uses Git",hint:e.facts?.isGit?"":"Needed for checkpoints and rollback"}];return t.every(s=>s.done)?"":`<section><h3>Setup</h3><ul class="steps">${t.map(s=>`<li>${i(s.done?"pass-filled":"circle-large-outline",s.done?"ok":"muted")} <span>${a(s.label)}${s.hint?` <span class="muted small">\xB7 ${a(s.hint)}</span>`:""}</span> ${s.act??""}</li>`).join("")}</ul></section>`}function ne(){let e=d;if(!e.hooks.installed&&e.out.sessions.length===0)return`<div class="empty">${i("plug","big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;if(e.out.sessions.length===0)return`<div class="empty">${i("terminal","big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p>${e.integration.otherProjectSessions?`<p class="muted small">${e.integration.otherProjectSessions} active session(s) are running in other folders.</p>`:""}<p class="muted small">Already running? Sessions started before connecting need a restart.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${i("sparkle")} Write a first prompt</button></div>`;let t=e.out.sessions.filter(n=>!n.endedAt&&e.generatedAt-n.lastEventAt<12*36e5),s=e.out.sessions.filter(n=>!t.includes(n));return`
    ${t.length?`<h3>Active <span class="muted small">(${t.length})</span></h3>${t.map(O).join("")}`:'<p class="muted">No active sessions.</p>'}
    ${s.length?f("past-sessions",`Earlier sessions (${s.length})`,s.map(O).join("")):""}
    ${e.integration.otherProjectSessions?`<p class="muted small">${e.integration.otherProjectSessions} active session(s) in other folders aren't shown.</p>`:""}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`}function O(e){let t=d.usage[e.id],s=d.live[e.id],n=s&&s.contextPct!=null?`<div class="ctx" title="From Claude Code's status line"><div class="bar ${s.contextPct>=80?"hot":""}"><span style="width:${Math.min(100,Math.round(s.contextPct))}%"></span></div><span class="small">Context ${Math.round(s.contextPct)}% of ${s.contextSize?Math.round(s.contextSize/1e3)+"k":"?"}${s.costUsd!=null?` \xB7 ~$${s.costUsd.toFixed(2)} at list price`:""}</span></div>`:"",u=t&&t.source==="transcript"?`${t.lastTurnInputTokens?.toLocaleString()??"?"} tokens in context (estimate) \xB7 ${t.totalOutputTokens?.toLocaleString()??"?"} written \xB7 ${t.assistantTurns} turns`:"Unknown (no local transcript data)",m=e.recent.map(p=>`<li class="${p.isError?"err":""}"><span class="muted small t">${new Date(p.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${a(p.summary)}${p.filePath?` <a href="#" data-open="${a(p.filePath)}" class="ref">open</a>`:""}${p.isError&&p.errorText?`<div class="errtext">${a(p.errorText.split(`
`).slice(0,3).join(" "))}</div>`:""}</li>`).join("");return`<article class="session ${e.displayStatus}" aria-label="Session ${a(j(e.id))}">
    <div class="s-head">${W(e.displayStatus)}<b>${Q[e.displayStatus]??e.displayStatus}</b><span class="muted small mono">${a(j(e.id))}</span><span class="spacer"></span><span class="muted small">${b(e.lastEventAt)}</span></div>
    ${e.currentTask?`<div class="s-task" title="Last prompt you gave it">\u201C${a(e.currentTask)}\u201D</div>`:'<div class="s-task muted">Task unknown (no prompt seen yet)</div>'}
    <div class="s-reason">${a(e.displayReason)}</div>
    ${n}
    ${e.intervention?`<div class="s-int">${i("arrow-right")} ${a(e.intervention)}</div>`:""}
    ${e.overlapsWith.length?`<div class="s-int warn">${i("warning")} Editing the same files as ${e.overlapsWith.map(j).join(", ")}</div>`:""}
    ${f(`sess:${e.id}`,`Details \xB7 ${e.eventCount} events${e.errorCount?` \xB7 <span class="errc">${e.errorCount} errors</span>`:""}`,`
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${a(H(e.cwd)||".")}</dd>
        <dt>Model</dt><dd>${a(t?.model??e.model??"Unknown")}</dd>
        <dt>Usage</dt><dd>${a(u)}</dd>
        <dt>Context</dt><dd>${s&&s.contextPct!=null?`${Math.round(s.contextPct)}% (exact, from Claude Code)`:d.statusline.installed?"Waiting for Claude Code to report":'Unknown \xB7 <a href="#" data-act="statuslineOn">show exact %</a>'}</dd>
        <dt>Cost</dt><dd>${s&&s.costUsd!=null?`~$${s.costUsd.toFixed(2)} <span class="muted">(Claude Code's estimate at list price; your plan may differ)</span>`:'Unknown <span class="muted">(not reported)</span>'}</dd>
        <dt>Started</dt><dd>${new Date(e.startedAt).toLocaleString()}</dd>
        ${e.permissionMode?`<dt>Permissions</dt><dd>${a(e.permissionMode)}</dd>`:""}
      </dl>
      ${e.editedFiles.length?`<div class="sub">Changed files</div><ul class="plain files">${e.editedFiles.map(p=>`<li><a href="#" data-open="${a(p)}">${a(H(p))}</a></li>`).join("")}</ul>`:""}
      <div class="actions"><button class="link" data-act="explainSession" data-session="${a(e.id)}">${i("sparkle")} Explain with AI</button></div>
      ${D[e.id]?`<div class="note">${i("lightbulb")}<div class="pre-wrap">${a(D[e.id])}</div></div>`:""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${m||"<li class='muted'>No events</li>"}</ul>`)}
  </article>`}function ie(e){return`<li class="issue">${B(e.severity)}<div class="issue-body"><div class="issue-title">${a(e.title)}</div>${N()?`<div class="plain-expl">${a(e.plain)}</div>`:""}${f(`iss:${e.key}`,"Evidence",(N()?"":`<p class="plain-expl">${a(e.plain)}</p>`)+U(e.evidence))}</div></li>`}function oe(){let e=d,t=e.out.recommendations,s=e.facts;return`
  <section>
    <h3>Issues <span class="muted small">${e.out.issues.length?`(${e.out.issues.length})`:""}</span></h3>
    ${e.out.issues.length?`<ul class="issues">${e.out.issues.map(ie).join("")}</ul>`:`<p class="muted">${i("pass","ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${t.length?`<ol class="recs">${t.slice(0,8).map(n=>`<li><div class="rec-title">${a(n.title)} ${B(n.severity)}</div><div class="muted">${a(n.why)}</div><div class="actions">${_(n,!1)}<button class="link" data-act="dismiss" data-key="${a(n.key)}">Not now</button></div></li>`).join("")}</ol>`:'<p class="muted">Nothing to recommend right now.</p>'}
  </section>
  <section>
    <h3>Checks</h3>
    <div class="actions wrap">
      ${s?.scripts.test?`<button class="secondary" data-act="runScript" data-script="test" ${e.runningScript?"disabled":""}>${i("beaker")} Run tests</button>`:""}
      ${s?.scripts.build?`<button class="secondary" data-act="runScript" data-script="build" ${e.runningScript?"disabled":""}>${i("package")} Build</button>`:""}
      ${s?.scripts.lint?`<button class="secondary" data-act="runScript" data-script="lint" ${e.runningScript?"disabled":""}>${i("checklist")} Lint</button>`:""}
      ${s?.scripts.typecheck?`<button class="secondary" data-act="runScript" data-script="typecheck" ${e.runningScript?"disabled":""}>${i("symbol-type-parameter")} Typecheck</button>`:""}
      <button class="secondary" data-act="analyze">${i("shield")} Re-scan</button>
    </div>
    ${e.runningScript?`<p class="muted">${i("loading","spin")} Running <code>${a(e.runningScript)}</code>\u2026</p>`:""}
    ${e.testRuns.length?f("runs",`Recent runs (${e.testRuns.length})`,`<ul class="plain">${e.testRuns.slice(0,8).map(n=>`<li>${n.passed?i("pass","ok"):i("error","bad")} <code>${a(n.command)}</code> <span class="muted small">${b(n.startedAt)} \xB7 ${(n.durationMs/1e3).toFixed(1)}s</span>${f(`run:${n.id}`,"output",`<pre>${a(n.outputTail)}</pre>`)}</li>`).join("")}</ul>`):""}
  </section>
  <section>
    <h3>Dependencies</h3>
    ${e.audit?e.audit.ok?`<p>${e.audit.counts.critical+e.audit.counts.high?i("warning","bad"):i("pass","ok")} ${e.audit.counts.critical} critical \xB7 ${e.audit.counts.high} high \xB7 ${e.audit.counts.moderate} moderate \xB7 ${e.audit.counts.low} low <span class="muted small">(${a(e.audit.tool)}, ${b(e.audit.ranAt)})</span></p>${e.audit.top.length?f("audit-top","Affected packages",`<ul class="plain">${e.audit.top.map(n=>`<li><code>${a(n.name)}</code> <span class="sev sev-${n.severity==="critical"?"blocker":n.severity==="high"?"high":"medium"}">${a(n.severity)}</span> ${a(n.title)}${n.fixAvailable?' <span class="muted small">fix available</span>':""}</li>`).join("")}</ul>`):""}`:`<p class="muted">${i("info")} ${a(e.audit.error)}</p>`:'<p class="muted small">Check your libraries against public vulnerability databases. Sends package names and versions only.</p>'}
    <div class="actions"><button class="secondary" data-act="audit" ${g?.trusted?"":"disabled"}>${i("shield")} ${e.audit?"Re-check":"Check dependencies"}</button></div>
  </section>
  <section>
    <h3>Visual check</h3>
    <p class="muted small">Open your running app headlessly, check it loads without an error, and save a screenshot.${e.browserFound?"":" (No Chrome/Edge found, so no screenshot.)"}</p>
    <input id="appUrl" type="text" value="${a(e.visual?.url??e.appUrl.url??"")}" placeholder="http://localhost:3000" aria-label="App address">
    <div class="muted small">${e.appUrl.url?`Detected from ${a(e.appUrl.basis)}`:"Address not detected. Enter it above."}</div>
    <div class="actions wrap"><button class="secondary" data-act="visualCheck">${i("eye")} Check now</button>${s?.scripts.dev||s?.scripts.start?`<button class="link" data-act="startApp" ${g?.trusted?"":"disabled"}>Start the app first</button>`:""}</div>
    ${e.visual?`<p>${e.visual.reachable&&!e.visual.errorText?i("pass","ok"):i("error","bad")} ${a(e.visual.note)} <span class="muted small">${b(e.visual.checkedAt)}${e.visual.title?` \xB7 \u201C${a(e.visual.title)}\u201D`:""}</span></p>${e.visual.errorText?`<div class="errtext">${a(e.visual.errorText)}</div>`:""}${g?.screenshotUri?`<a href="#" data-act="openScreenshot" title="Open full size"><img class="shot" src="${a(g.screenshotUri)}" alt="Screenshot of your app"></a>`:""}`:""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${e.out.readiness.map(n=>`<li>${$(n.status)} <span>${a(n.label)}</span><div class="muted small">${a(n.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${e.doctor.length?`<ul class="ready">${e.doctor.map(n=>`<li>${$(n.status==="ok"?"verified":n.status==="fail"?"failed":n.status==="warn"?"unverified":"unknown")} <span>${a(n.label)}</span><div class="muted small">${a(n.detail)}</div></li>`).join("")}</ul>`:'<p class="muted">No checks apply to this project type yet.</p>'}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${s?.isGit?"":"disabled"}>${i("save")} Save checkpoint</button></div>
    ${e.checkpoints.length?`<ul class="plain">${e.checkpoints.slice(0,6).map(n=>`<li>${i("history")} ${a(n.label)} <span class="muted small">${b(n.ts)} \xB7 ${n.sha.slice(0,8)}</span> <a href="#" data-act="cpDiff" data-sha="${n.sha}">changed since</a>${A[n.sha]?le(n.sha):""}</li>`).join("")}</ul>`:""}
  </section>`}function le(e){let t=A[e];return t.length?`<div class="cp-files"><ul class="plain files">${t.slice(0,40).map(s=>`<li><label><input type="checkbox" class="cpf" data-sha="${e}" value="${a(s)}"> ${a(s)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${e}">${i("discard")} Restore selected files</button></div>`:'<div class="muted small">No changes since this checkpoint.</div>'}function re(){let e=R.find(t=>t.id===o.goal);return`
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${R.map(t=>`<button role="radio" aria-checked="${t.id===o.goal}" class="goal ${t.id===o.goal?"on":""}" data-goal-pick="${t.id}" title="${a(t.plain)}">${a(t.label)}</button>`).join("")}</div>
    ${e?`<p class="muted small">${a(e.plain)}</p>`:""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${a(e?.hint??"")}">${a(o.request)}</textarea>
    ${e?.questions.length?`<div class="muted small hint">Helpful to include: ${e.questions.map(a).join(" \xB7 ")}</div>`:""}
    ${f("prompt-more","More options",`
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${a(o.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when\u2026" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${a(o.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${o.planFirst?"checked":""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${i("sparkle")} Build prompt</button></div>
  </section>
  ${v?`
  <section class="built">
    ${v.missingInfo.length?`<div class="note warn">${i("question")} <div><b>Worth adding</b><ul>${v.missingInfo.map(t=>`<li>${a(t)}</li>`).join("")}</ul></div></div>`:""}
    ${v.assumptions.length?`<div class="note">${i("info")} <div><b>Assumptions made</b><ul>${v.assumptions.map(t=>`<li>${a(t)}</li>`).join("")}</ul></div></div>`:""}
    <div class="muted small">Model: ${a(v.suggestedModel)} \xB7 ${v.verification.length?`Verifies with: ${v.verification.join(", ")}`:"No check commands found"} \xB7 ${k.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${a(k)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${i("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${g?.trusted?"":"disabled"} title="Opens a terminal and starts Claude Code with this prompt">${i("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${g?.aiProvider==="none"?"Needs an AI provider (optional)":"Uses "+a(g?.aiProvider)}">${i("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>`:""}`}function de(){let e=d,t=s=>["todo","in_progress","done","dropped"].map(n=>`<option value="${n}" ${s.status===n?"selected":""}>${{todo:"Not started",in_progress:"In progress",done:"Done",dropped:"Dropped"}[n]}</option>`).join("");return`
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" placeholder="What are you building, for whom, and what does success look like?">${a(e.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${e.requirements.length?`<ul class="reqs">${e.requirements.map(s=>`<li>
      <div class="req-top"><select data-req-status="${s.id}" aria-label="Status for ${a(s.title)}">${t(s)}</select><span class="req-title">${a(s.title)}</span>${s.status==="done"?$(s.evidence,s.evidenceNote):""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${s.id}" aria-label="Delete requirement">${i("trash")}</button></div>
      <div class="muted small">${s.acceptance?`Done when: ${a(s.acceptance)}`:`<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${s.id}">Add</a>`}</div>
    </li>`).join("")}</ul>`:""}
    <input id="newReq" type="text" placeholder="e.g. Users can pay with a card">
    <input id="newAcc" type="text" placeholder="Done when\u2026 e.g. a test payment succeeds and a receipt is emailed">
    <div class="actions"><button class="secondary small" data-act="addReq">Add requirement</button>${e.facts?.checklistItems.length?`<button class="link" data-act="importChecklist">Import ${e.facts.checklistItems.length} from docs</button>`:""}</div>
  </section>
  <section>
    <h3>Decisions</h3>
    ${e.decisions.length?`<ul class="plain">${e.decisions.map(s=>`<li><b>${a(s.title)}</b>${s.detail?`: ${a(s.detail)}`:""} <button class="icon-btn" data-act="delDec" data-id="${s.id}" aria-label="Delete decision">${i("close")}</button></li>`).join("")}</ul>`:`<p class="muted small">Record choices (e.g. "Use Supabase for auth") so new sessions don't undo them.</p>`}
    <input id="newDec" type="text" placeholder="Decision"><input id="newDecD" type="text" placeholder="Why / detail (optional)">
    <div class="actions"><button class="secondary small" data-act="addDec">Add decision</button></div>
  </section>
  <section>
    <h3>Preferences</h3>
    <textarea id="prefs" rows="2" placeholder="e.g. Keep the UI minimal. Use TypeScript. Explain things simply.">${a(e.notes.preferences)}</textarea>
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
    <p class="muted small">Stored only on this computer in <code>${a(g?.home??"~/.buildpilot")}</code>.</p>
    <div class="actions wrap"><button class="link danger" data-act="deleteProjectData">Delete this project's data</button><button class="link danger" data-act="deleteAllData">Delete all data</button></div>
  </section>`}function ce(){let e=d,t=g;return`
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${i(e.integration.claudeInstalled?"pass-filled":"circle-large-outline",e.integration.claudeInstalled?"ok":"muted")} <span>${e.integration.claudeInstalled?`Installed: ${a(e.integration.claudeVersion)}`:e.integration.claudeInstalled===null?"Checking\u2026":"Not found on PATH"}</span></li>
      <li>${i(e.hooks.installed?"pass-filled":"circle-large-outline",e.hooks.installed?"ok":"muted")} <span>${e.hooks.installed?"Connected":e.hooks.settingsError?`Settings file problem: ${a(e.hooks.settingsError)}`:"Not connected"}<div class="muted small mono">${a(e.hooks.settingsPath)}</div></span></li>
      <li>${i(e.statusline.installed?"pass-filled":"circle-large-outline",e.statusline.installed?"ok":"muted")} <span>${e.statusline.installed?`Exact context % on${e.statusline.chainedOriginal?" (your status line is preserved)":""}`:"Exact context % off"} ${e.statusline.installed?'<a href="#" data-act="statuslineOff">remove</a>':'<a href="#" data-act="statuslineOn">turn on</a>'}</span></li>
      <li>${i("database","muted")} <span>${e.integration.spool.accepted} events received this run${e.integration.spool.rejected?`, ${e.integration.spool.rejected} malformed ignored`:""}${e.integration.spool.lastEventAt?` \xB7 last ${b(e.integration.spool.lastEventAt)}`:""}</span></li>
    </ul>
    <div class="actions wrap">${e.hooks.installed?'<button class="link" data-act="uninstallHooks">Disconnect</button>':'<button class="primary" data-act="installHooks">Connect</button>'}${e.demo?'<button class="link" data-act="demoOff">Remove demo data</button>':'<button class="link" data-act="demoOn">Load demo data</button>'}</div>
  </section>
  <section>
    <h3>Phone, glasses &amp; other devices</h3>
    <p class="muted small">Get alerts where you are, like "Claude needs your approval" or "Tests failing". Send them to <b>ntfy</b> (free phone push; smart glasses paired to your phone can read phone notifications aloud), <b>Slack</b>, <b>Discord</b>, or any webhook. Only short alerts and the project name are sent, never code.</p>
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${i("bell")} ${T?"Change notification URL":"Set up notifications"}</button>${T?'<button class="link" data-act="testWebhook">Send test</button>':""}</div>
  </section>
  <section>
    <h3>Integration API</h3>
    <p class="muted small">Lets your own tools ask BuildPilot what's happening: iOS Shortcuts / Siri, Raycast, Stream Deck, a companion app for smart glasses, or a bot. Read-only plus prompt generation. It can't run commands or change files. Requires a secret token.</p>
    <label class="check"><input type="checkbox" id="apiToggle" ${t.apiEnabled?"checked":""}> Enable on ${t.apiAllowLan?"your local network":"this computer only"}</label>
    ${t.apiEnabled&&t.pocketUrl?`<div class="pocket">${i("device-mobile")} <div><b>Pocket</b>: a phone page that shows status and can read it aloud (through Bluetooth glasses or earbuds).<div class="mono small">${a(t.pocketUrl)}</div>${t.apiAllowLan?"":'<div class="muted small">To open it on your phone, enable network access in settings (trusted Wi-Fi only).</div>'}<button class="link" data-act="copyPocketLink">Copy link for my phone</button></div></div>`:""}
    ${t.apiEnabled&&t.apiAddress?`<div class="mono small api">${a(t.apiAddress)}/v1/brief?format=text<br>${a(t.apiAddress)}/v1/status \xB7 /v1/sessions \xB7 /v1/next<br>POST ${a(t.apiAddress)}/v1/prompt {"goal","request"}</div>
      <div class="actions wrap"><button class="secondary small" data-act="copyApiToken">${i("key")} Copy token</button><button class="link" data-act="rotateApiToken">New token</button><button class="link" data-act="settings">Port / network settings</button></div>`:""}
  </section>
  <section>
    <h3>AI refinement <span class="muted small">(optional)</span></h3>
    <p class="muted small">BuildPilot works fully without AI. Optionally refine prompts with your own Anthropic API key or a local Ollama model. Nothing is sent without your OK each time.</p>
    <div class="muted small">Provider: <b>${a(t.aiProvider)}</b>${t.aiModel?` \xB7 ${a(t.aiModel)}`:""}</div>
    <div class="actions"><button class="link" data-act="settings">Change in Settings</button></div>
  </section>
  <section>
    <h3>Experience</h3>
    <label class="check"><input type="checkbox" id="beginner" ${t.beginner?"checked":""}> Beginner explanations (plain-English "why it matters")</label>
    <div class="muted small">Pop-up alerts: ${a(t.notifications)} \xB7 <a href="#" data-act="settings">change</a></div>
  </section>`}function F(){document.querySelectorAll("[data-tab]").forEach(t=>t.addEventListener("click",s=>{s.preventDefault(),o.tab=t.dataset.tab,y(),o.tab==="connect"&&l("hasWebhook").then(n=>{T=n,h()}),h(),document.querySelector(".content")?.scrollTo(0,0)})),document.querySelectorAll("details[data-key]").forEach(t=>t.addEventListener("toggle",()=>{o.open[t.dataset.key]=t.open,y()})),document.querySelectorAll("[data-open]").forEach(t=>t.addEventListener("click",s=>{s.preventDefault(),l("openFile",{path:t.dataset.open})})),document.querySelectorAll("[data-goal-pick]").forEach(t=>t.addEventListener("click",()=>{o.goal=t.dataset.goalPick,y(),h()}));let e=(t,s)=>document.getElementById(t)?.addEventListener("input",n=>{o[s]=n.target.value,y()});e("req","request"),e("must","mustNotChange"),e("acc","acceptance"),document.getElementById("planFirst")?.addEventListener("change",t=>{o.planFirst=t.target.checked,y()}),document.getElementById("ptext")?.addEventListener("input",t=>{k=t.target.value}),document.getElementById("apiToggle")?.addEventListener("change",t=>void l("apiToggle",{value:t.target.checked})),document.getElementById("beginner")?.addEventListener("change",t=>void l("setBeginner",{value:t.target.checked})),document.querySelectorAll("[data-req-status]").forEach(t=>t.addEventListener("change",()=>void l("updateRequirement",{id:t.dataset.reqStatus,patch:{status:t.value}}))),document.getElementById("req")?.addEventListener("keydown",t=>{t.key==="Enter"&&(t.metaKey||t.ctrlKey)&&q()}),document.getElementById("newAcc")?.addEventListener("keydown",t=>{t.key==="Enter"&&V()}),document.querySelectorAll("[data-act]").forEach(t=>t.addEventListener("click",s=>{s.preventDefault(),ue(t)}))}var S=e=>(document.getElementById(e)?.value??"").trim();async function q(){o.request=S("req")||o.request;let e=await l("buildPrompt",{goal:o.goal,request:o.request,mustNotChange:o.mustNotChange,acceptance:o.acceptance,beginner:N(),planFirst:o.planFirst});v=e,k=e.text,h(),document.getElementById("ptext")?.scrollIntoView?.({block:"nearest"})}async function V(){let e=S("newReq");e&&await l("addRequirement",{title:e,acceptance:S("newAcc")})}async function ue(e){let t=e.dataset.act;switch(t){case"build":return q();case"promptFor":return o.tab="prompts",o.goal=e.dataset.goal||"feature",o.request=e.dataset.request||"",y(),o.request?q():(v=null,h());case"copyPrompt":return void l("copy",{text:k});case"sendPrompt":return void l("sendToClaude",{text:k});case"refine":{let s=await l("refine",{text:k});s?.text&&(k=s.text,h());return}case"copyHandoff":{let s=await l("handoff");return void l("copy",{text:s})}case"handoffPrompt":return o.tab="prompts",o.goal="handoff",o.request="Continue where the previous session left off.",y(),q();case"runScript":return void l("runScript",{script:e.dataset.script});case"dismiss":return void l("dismiss",{key:e.dataset.key});case"saveNote":return void l("setNote",{key:e.dataset.key,value:S(e.dataset.src)});case"addReq":return V();case"delReq":return void l("deleteRequirement",{id:e.dataset.id});case"editAcc":{let n=e.closest("li")?.querySelector(".req-title")?.textContent??"",u=document.createElement("input");u.type="text",u.placeholder=`Done when\u2026 (for "${n}")`,e.replaceWith(u),u.focus(),u.addEventListener("keydown",m=>{m.key==="Enter"&&u.value.trim()&&l("updateRequirement",{id:e.dataset.id,patch:{acceptance:u.value.trim()}})});return}case"addDec":{let s=S("newDec");s&&await l("addDecision",{title:s,detail:S("newDecD")});return}case"delDec":return void l("deleteDecision",{id:Number(e.dataset.id)});case"cpDiff":return A[e.dataset.sha]=await l("checkpointDiff",{sha:e.dataset.sha}),h();case"rollback":{let s=e.dataset.sha,n=[...document.querySelectorAll(`input.cpf[data-sha="${s}"]:checked`)].map(u=>u.value);return n.length?(await l("rollback",{sha:s,files:n}),A={},h()):void 0}case"statuslineOn":return void l("statusline",{on:!0});case"statuslineOff":return void l("statusline",{on:!1});case"visualCheck":return void l("visualCheck",{url:S("appUrl")});case"worktree":return void l("worktree",{sessionId:e.dataset.session});case"explainSession":{let s=e.dataset.session,n=await l("explainSession",{sessionId:s});n&&(D[s]=n,h());return}case"demoOn":return void l("demo",{on:!0});case"demoOff":return void l("demo",{on:!1});case"setWebhook":return await l("setWebhook"),T=await l("hasWebhook"),h();default:return void l(t)}}l("goals").then(e=>{R=e??[],h()});P.postMessage({type:"ready"});})();
//# sourceMappingURL=webview.js.map
