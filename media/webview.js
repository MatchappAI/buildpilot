"use strict";(()=>{var T=acquireVsCodeApi(),J=T.getState()??{},l={tab:"overview",open:{},goal:"feature",request:"",mustNotChange:"",acceptance:"",planFirst:!0,...J},d=null,g=null,v=null,y="",R=[],A={},q=!1,M={},k=()=>T.setState(l),Q=0,D=new Map;function r(t,e={}){let s=++Q;return new Promise(n=>{D.set(s,n),T.postMessage({type:t,id:s,...e})})}window.addEventListener("message",t=>{let e=t.data;e.type==="reply"&&e.id?(D.get(e.id)?.(e.result),D.delete(e.id)):e.type==="state"?(d=e.state,g=e.settings,h()):e.type==="navigate"&&e.tab&&(l.tab=e.tab,k(),h())});var a=t=>String(t??"").replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),i=(t,e="")=>`<i class="codicon codicon-${t} ${e}" aria-hidden="true"></i>`;function $(t){if(!t)return"never";let e=Math.max(0,Math.round((Date.now()-t)/1e3));return e<45?"just now":e<3600?`${Math.round(e/60)} min ago`:e<86400?`${Math.round(e/3600)} h ago`:`${Math.round(e/86400)} d ago`}var X={verified:"Verified",inferred:"Inferred",unverified:"Unverified",failed:"Failed",unknown:"Unknown"},b=(t,e="")=>`<span class="conf conf-${t}" title="${a(e||Z(t))}">${X[t]}</span>`;function Z(t){return{verified:"Checked directly (e.g. a command passed, a file exists).",inferred:"BuildPilot's best reading of the evidence. Could be wrong.",unverified:"Claimed or assumed, but not proven yet.",failed:"Checked, and it failed.",unknown:"Not enough information to say."}[t]}var tt={blocker:"error",high:"warning",medium:"info",low:"circle-small",info:"circle-small"},B=t=>`<span class="sev sev-${t}">${i(tt[t])}${t==="blocker"?"Blocker":t==="high"?"Important":t==="medium"?"Worth doing":"Optional"}</span>`,V={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"},O=t=>`<span class="dot dot-${t}" aria-hidden="true"></span>`,j=t=>t.startsWith("demo-")?`DEMO ${t.slice(5,11)}`:t.slice(0,8),et=t=>t.split(/[\\/]/).pop()??t,H=t=>d?.project&&t.startsWith(d.project.root)?t.slice(d.project.root.length+1):t,N=()=>g?.beginner??!0;function U(t){return t.length?`<ul class="evidence">${t.map(e=>`<li><span class="ev-kind ev-${e.kind}" title="${e.kind==="observed"?"Seen directly":"Inferred"}">${e.kind==="observed"?"seen":"inferred"}</span> ${a(e.text)}${e.ref?` <a href="#" data-open="${a(e.ref)}" class="ref">${a(et(e.ref))}</a>`:""}</li>`).join("")}</ul>`:""}function f(t,e,s,n=!1){let u=l.open[t]??n;return`<details data-key="${a(t)}" ${u?"open":""}><summary>${e}</summary><div class="details-body">${s}</div></details>`}var st=[{id:"overview",label:"Overview",icon:"home"},{id:"sessions",label:"Sessions",icon:"pulse"},{id:"supervisor",label:"Supervisor",icon:"shield"},{id:"prompts",label:"Prompts",icon:"sparkle"},{id:"memory",label:"Memory",icon:"book"},{id:"connect",label:"Connect",icon:"plug"}];function h(){let t=document.getElementById("app"),e=document.querySelector(".content")?.scrollTop??0,s=document.activeElement,n=s?.id,u=s?.selectionStart??null;if(!d){t.innerHTML='<div class="loading">Starting BuildPilot\u2026</div>';return}if(!d.project)return t.innerHTML=`<div class="empty">${i("folder-opened","big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`,_();let m=d.out.sessions.filter(c=>!c.endedAt&&d.generatedAt-c.lastEventAt<36e5),p=m.filter(c=>c.displayStatus==="awaiting_approval"||c.displayStatus==="blocked").length,x=d.out.issues.filter(c=>c.severity==="blocker"||c.severity==="high").length,P={sessions:p?`<span class="badge warn">${p}</span>`:m.length?`<span class="badge">${m.length}</span>`:"",supervisor:x?`<span class="badge err">${x}</span>`:""},w=d.out.health;t.innerHTML=`
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${a(d.facts?.name??d.project.name)} ${i("chevron-down")}</button>
      <span class="spacer"></span>
      ${d.analyzing?`<span class="muted small">${i("loading","spin")} Analyzing</span>`:`<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${i("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${w.level}">${O(w.level==="good"?"running":w.level==="blocked"?"failed":w.level==="attention"?"awaiting_approval":"unknown")}${a(w.label)}</span>
      <span class="chip" title="Development stage (${d.out.stage.confidence})">${a(d.out.stage.stage)}</span>
    </div>
    ${d.demo?`<div class="demo-banner">${i("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>`:""}
    ${g?.trusted?"":`<div class="demo-banner">${i("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>`}
    <nav class="tabs" role="tablist">${st.map(c=>`<button role="tab" aria-selected="${l.tab===c.id}" class="tab ${l.tab===c.id?"active":""}" data-tab="${c.id}" title="${c.label}" aria-label="${c.label}">${i(c.icon)}<span class="tab-label">${c.label}</span>${P[c.id]??""}</button>`).join("")}</nav>
  </header>
  <main class="content" role="tabpanel">${d.errors.map(c=>`<div class="error-box">${i("error")} ${a(c)}</div>`).join("")}${at()}</main>`,_();let S=document.querySelector(".content");if(S&&(S.scrollTop=e),n){let c=document.getElementById(n);if(c&&(c.focus(),u!==null&&"setSelectionRange"in c))try{c.setSelectionRange(u,u)}catch{}}}function at(){switch(l.tab){case"overview":return it();case"sessions":return lt();case"supervisor":return dt();case"prompts":return ut();case"memory":return pt();case"connect":return mt()}}function G(t,e=!0){let s=t.action,n=e?"primary":"secondary";return s?s.kind==="install_hooks"?`<button class="${n}" data-act="installHooks">Connect</button>`:s.kind==="checkpoint"?`<button class="${n}" data-act="checkpoint">${i("save")} Save checkpoint</button>`:s.kind==="run_script"?`<button class="${n}" data-act="runScript" data-script="${a(s.script)}" ${d?.runningScript?"disabled":""}>${i("play")} ${s.script==="install"?"Install":`Run ${a(s.script)}`}</button>`:s.kind==="prompt"?`<button class="${n}" data-act="promptFor" data-goal="${a(s.goal)}" data-request="${a(s.request)}">${i("sparkle")} Write the prompt</button>`:s.kind==="open_file"?`<button class="${n}" data-open="${a(s.path)}">Open</button>`:s.kind==="audit"?`<button class="${n}" data-act="audit">${i("shield")} Check dependencies</button>`:s.kind==="visual_check"?`<button class="${n}" data-act="visualCheck">${i("eye")} Check the app</button>`:s.kind==="worktree"?`<button class="${n}" data-act="worktree" data-session="${a(s.sessionId)}">${i("git-branch")} Separate the sessions</button>`:s.kind==="open_tab"?`<button class="${n}" data-tab="${s.tab}">Open ${s.tab[0].toUpperCase()+s.tab.slice(1)}</button>`:"":""}function nt(){let t=d.out.next;return t?`<section class="next sev-border-${t.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${B(t.severity)}</div>
    <div class="next-title">${a(t.title)}</div>
    <p>${a(t.why)}</p>
    <div class="actions">${G(t)}<button class="link" data-act="dismiss" data-key="${a(t.key)}" title="Hide for 24 hours">Not now</button></div>
    ${f(`ev:${t.key}`,"Why BuildPilot thinks so",U(t.evidence))}
  </section>`:`<section class="next good">${i("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`}function it(){let t=d,e=t.facts,s=t.out.sessions.filter(o=>!o.endedAt&&t.generatedAt-o.lastEventAt<36e5),n=s.filter(o=>o.displayStatus==="running").length,u=s.filter(o=>o.displayStatus==="awaiting_approval"||o.displayStatus==="blocked").length,m=t.out.issues.filter(o=>o.severity==="blocker"||o.severity==="high"),p=t.hooks.installed?s.length===0?"No active Claude Code sessions in this project.":`${n} session${n===1?"":"s"} working${u?`, <b>${u} waiting for you</b>`:""}. <a href="#" data-tab="sessions">See sessions</a>`:'Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>',x=t.elsewhere.filter(o=>o.status==="awaiting_approval"||o.status==="blocked"),P=p+(x.length?`<div class="small warn-text">Also waiting for you: ${a([...new Set(x.map(o=>o.folder))].join(", "))}</div>`:t.elsewhere.length?`<div class="muted small">${t.elsewhere.length} active in other projects \xB7 <a href="#" data-tab="sessions">see</a></div>`:""),w=m.length===0?"Nothing urgent found.":`${m.length} important issue${m.length===1?"":"s"}: ${a(m[0].title)}${m.length>1?` <a href="#" data-tab="supervisor">+${m.length-1} more</a>`:""}`,S=t.requirements.filter(o=>o.status!=="dropped"),c=S.filter(o=>o.status==="done"&&o.evidence==="verified"),K=S.filter(o=>o.status==="in_progress"||o.status==="done"&&o.evidence!=="verified"),Y=S.filter(o=>o.status==="todo"),I=t.testRuns.find(o=>/test|vitest|jest|pytest/.test(o.command));return`
  ${nt()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${P}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${w}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${e?.description?`${a(e.description)} <span class="muted small">(from ${a(e.descriptionSource)})</span>`:t.notes.goal?a(t.notes.goal):'<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>'}</dd>
      <dt>Built with</dt><dd>${e?a([...e.languages,...e.frameworks].join(", ")||"Not detected"):"\u2026"}</dd>
      <dt>Stage</dt><dd>${a(t.out.stage.stage)} ${b(t.out.stage.confidence)}${f("stage-ev","evidence",U(t.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${t.out.progress.total?`<div class="bar" role="progressbar" aria-valuenow="${t.out.progress.done}" aria-valuemax="${t.out.progress.total}"><span style="width:${Math.round(t.out.progress.done/t.out.progress.total*100)}%"></span></div>`:""}${a(t.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${I?`${I.passed?b("verified","Passed when BuildPilot ran it")+" passing":b("failed")+" failing"} \xB7 ${$(I.startedAt)}`:`${b("unknown")} not run yet${e?.scripts.test?' \xB7 <a href="#" data-act="runScript" data-script="test">Run tests</a>':""}`}</dd>
      <dt>Git</dt><dd>${t.changes?`${a(t.changes.branch??"detached")} \xB7 ${t.changes.unstaged.length+t.changes.untracked.length+t.changes.staged.length} uncommitted`:e?.isGit===!1?`${b("failed")} not using Git`:"\u2026"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${S.length===0?`<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${e?.checklistItems.length?`<a href="#" data-act="importChecklist">Import ${e.checklistItems.length} checklist items from your docs</a> or `:""}<a href="#" data-tab="memory">add them</a>.</p>`:`${L("Done & verified",c,"verified")}${L("Partly done / unproven",K,"unverified")}${L("Not started",Y,"unknown")}`}
  </section>
  ${t.resolved.length?`<section><h3>Recently resolved</h3><ul class="plain">${t.resolved.map(o=>`<li>${i("check","ok")} ${a(o.title)} <span class="muted small">${$(o.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>`:""}
  <section>
    <h3>Recent work</h3>
    ${t.commits.length?`<ul class="plain">${t.commits.slice(0,5).map(o=>`<li><span class="muted small">${$(o.ts)}</span> ${a(o.subject)}</li>`).join("")}</ul>`:'<p class="muted">No commits yet.</p>'}
  </section>
  ${ot()}`}function L(t,e,s){return e.length?`<div class="fgroup"><div class="fgroup-h">${b(s)} ${a(t)} <span class="muted">(${e.length})</span></div><ul class="plain">${e.slice(0,8).map(n=>`<li>${a(n.title)}</li>`).join("")}${e.length>8?`<li class="muted">+${e.length-8} more</li>`:""}</ul></div>`:""}function ot(){let t=d,e=[{done:!!t.integration.claudeInstalled,label:"Claude Code installed",hint:t.integration.claudeInstalled===null?"checking\u2026":t.integration.claudeVersion??"Install from claude.com/claude-code"},{done:t.hooks.installed,label:"BuildPilot connected to Claude Code",hint:t.hooks.installed?"Live sessions will appear automatically":"",act:t.hooks.installed?"":'<button class="secondary small" data-act="installHooks">Connect</button>'},{done:!!t.integration.gitAvailable&&!!t.facts?.isGit,label:"Project uses Git",hint:t.facts?.isGit?"":"Needed for checkpoints and rollback"}];return e.every(s=>s.done)?"":`<section><h3>Setup</h3><ul class="steps">${e.map(s=>`<li>${i(s.done?"pass-filled":"circle-large-outline",s.done?"ok":"muted")} <span>${a(s.label)}${s.hint?` <span class="muted small">\xB7 ${a(s.hint)}</span>`:""}</span> ${s.act??""}</li>`).join("")}</ul></section>`}function lt(){let t=d;if(!t.hooks.installed&&t.out.sessions.length===0)return`<div class="empty">${i("plug","big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;if(t.out.sessions.length===0)return`${F()}<div class="empty">${i("terminal","big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p><p class="muted small">Already running? It appears on its next action. If not, restart it.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${i("sparkle")} Write a first prompt</button></div>`;let e=t.out.sessions.filter(n=>!n.endedAt&&t.generatedAt-n.lastEventAt<12*36e5),s=t.out.sessions.filter(n=>!e.includes(n));return`
    ${e.length?`<h3>Active <span class="muted small">(${e.length})</span></h3>${e.map(W).join("")}`:'<p class="muted">No active sessions.</p>'}
    ${s.length?f("past-sessions",`Earlier sessions (${s.length})`,s.map(W).join("")):""}
    ${F()}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`}function F(){let t=d.elsewhere;if(!t.length)return"";let e=t.filter(s=>s.status==="awaiting_approval"||s.status==="blocked").length;return`<section class="elsewhere"><h3>Other projects <span class="muted small">(${t.length} active${e?`, <span class="warn-text">${e} waiting for you</span>`:""})</span></h3>
    <ul class="plain">${t.map(s=>`<li class="ew">${O(s.status)} <b>${a(s.folder)}</b> <span class="muted small">${V[s.status]??s.status} \xB7 ${$(s.lastEventAt)}${s.contextPct!=null?` \xB7 context ${Math.round(s.contextPct)}%`:""}</span>${s.task?`<div class="muted small ew-task">\u201C${a(s.task)}\u201D</div>`:""}${s.status==="awaiting_approval"||s.status==="blocked"?`<div class="small warn-text">${a(s.reason)}</div>`:""}</li>`).join("")}</ul>
    <div class="muted small">To supervise one of these in depth, open its folder in VS Code.</div></section>`}function W(t){let e=d.usage[t.id],s=d.live[t.id],n=s&&s.contextPct!=null?`<div class="ctx" title="From Claude Code's status line"><div class="bar ${s.contextPct>=80?"hot":""}"><span style="width:${Math.min(100,Math.round(s.contextPct))}%"></span></div><span class="small">Context ${Math.round(s.contextPct)}% of ${s.contextSize?Math.round(s.contextSize/1e3)+"k":"?"}${s.costUsd!=null?` \xB7 ~$${s.costUsd.toFixed(2)} at list price`:""}</span></div>`:"",u=e&&e.source==="transcript"?`${e.lastTurnInputTokens?.toLocaleString()??"?"} tokens in context (estimate) \xB7 ${e.totalOutputTokens?.toLocaleString()??"?"} written \xB7 ${e.assistantTurns} turns`:"Unknown (no local transcript data)",m=t.recent.map(p=>`<li class="${p.isError?"err":""}"><span class="muted small t">${new Date(p.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${a(p.summary)}${p.filePath?` <a href="#" data-open="${a(p.filePath)}" class="ref">open</a>`:""}${p.isError&&p.errorText?`<div class="errtext">${a(p.errorText.split(`
`).slice(0,3).join(" "))}</div>`:""}</li>`).join("");return`<article class="session ${t.displayStatus}" aria-label="Session ${a(j(t.id))}">
    <div class="s-head">${O(t.displayStatus)}<b>${V[t.displayStatus]??t.displayStatus}</b><span class="muted small mono">${a(j(t.id))}</span><span class="spacer"></span><span class="muted small">${$(t.lastEventAt)}</span></div>
    ${t.currentTask?`<div class="s-task" title="Last prompt you gave it">\u201C${a(t.currentTask)}\u201D</div>`:'<div class="s-task muted">Task unknown (no prompt seen yet)</div>'}
    <div class="s-reason">${a(t.displayReason)}</div>
    ${n}
    ${t.intervention?`<div class="s-int">${i("arrow-right")} ${a(t.intervention)}</div>`:""}
    ${t.overlapsWith.length?`<div class="s-int warn">${i("warning")} Editing the same files as ${t.overlapsWith.map(j).join(", ")}</div>`:""}
    ${f(`sess:${t.id}`,`Details \xB7 ${t.eventCount} events${t.errorCount?` \xB7 <span class="errc">${t.errorCount} errors</span>`:""}`,`
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${a(H(t.cwd)||"project root")}</dd>
        <dt>Model</dt><dd>${a(s?.model??e?.model??t.model??"Unknown")}</dd>
        <dt>Usage</dt><dd>${a(u)}</dd>
        <dt>Context</dt><dd>${s&&s.contextPct!=null?`${Math.round(s.contextPct)}% (exact, from Claude Code)`:d.statusline.installed?"Waiting for Claude Code to report":'Unknown \xB7 <a href="#" data-act="statuslineOn">show exact %</a>'}</dd>
        <dt>Cost</dt><dd>${s&&s.costUsd!=null?`~$${s.costUsd.toFixed(2)} <span class="muted">(Claude Code's estimate at list price; your plan may differ)</span>`:'Unknown <span class="muted">(not reported)</span>'}</dd>
        <dt>Started</dt><dd>${new Date(t.startedAt).toLocaleString()}</dd>
        ${t.permissionMode?`<dt>Permissions</dt><dd>${a(t.permissionMode)}</dd>`:""}
      </dl>
      ${t.editedFiles.length?`<div class="sub">Changed files</div><ul class="plain files">${t.editedFiles.map(p=>`<li><a href="#" data-open="${a(p)}">${a(H(p))}</a></li>`).join("")}</ul>`:""}
      <div class="actions"><button class="link" data-act="explainSession" data-session="${a(t.id)}">${i("sparkle")} Explain with AI</button></div>
      ${M[t.id]?`<div class="note">${i("lightbulb")}<div class="pre-wrap">${a(M[t.id])}</div></div>`:""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${m||"<li class='muted'>No events</li>"}</ul>`)}
  </article>`}function rt(t){return`<li class="issue">${B(t.severity)}<div class="issue-body"><div class="issue-title">${a(t.title)}</div>${N()?`<div class="plain-expl">${a(t.plain)}</div>`:""}${f(`iss:${t.key}`,"Evidence",(N()?"":`<p class="plain-expl">${a(t.plain)}</p>`)+U(t.evidence))}</div></li>`}function dt(){let t=d,e=t.out.recommendations,s=t.facts;return`
  <section>
    <h3>Issues <span class="muted small">${t.out.issues.length?`(${t.out.issues.length})`:""}</span></h3>
    ${t.out.issues.length?`<ul class="issues">${t.out.issues.map(rt).join("")}</ul>`:`<p class="muted">${i("pass","ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${e.length?`<ol class="recs">${e.slice(0,8).map(n=>`<li><div class="rec-title">${a(n.title)} ${B(n.severity)}</div><div class="muted">${a(n.why)}</div><div class="actions">${G(n,!1)}<button class="link" data-act="dismiss" data-key="${a(n.key)}">Not now</button></div></li>`).join("")}</ol>`:'<p class="muted">Nothing to recommend right now.</p>'}
  </section>
  <section>
    <h3>Checks</h3>
    <div class="actions wrap">
      ${s?.scripts.test?`<button class="secondary" data-act="runScript" data-script="test" ${t.runningScript?"disabled":""}>${i("beaker")} Run tests</button>`:""}
      ${s?.scripts.build?`<button class="secondary" data-act="runScript" data-script="build" ${t.runningScript?"disabled":""}>${i("package")} Build</button>`:""}
      ${s?.scripts.lint?`<button class="secondary" data-act="runScript" data-script="lint" ${t.runningScript?"disabled":""}>${i("checklist")} Lint</button>`:""}
      ${s?.scripts.typecheck?`<button class="secondary" data-act="runScript" data-script="typecheck" ${t.runningScript?"disabled":""}>${i("symbol-type-parameter")} Typecheck</button>`:""}
      <button class="secondary" data-act="analyze">${i("shield")} Re-scan</button>
    </div>
    ${t.runningScript?`<p class="muted">${i("loading","spin")} Running <code>${a(t.runningScript)}</code>\u2026</p>`:""}
    ${t.testRuns.length?f("runs",`Recent runs (${t.testRuns.length})`,`<ul class="plain">${t.testRuns.slice(0,8).map(n=>`<li>${n.passed?i("pass","ok"):i("error","bad")} <code>${a(n.command)}</code> <span class="muted small">${$(n.startedAt)} \xB7 ${(n.durationMs/1e3).toFixed(1)}s</span>${f(`run:${n.id}`,"output",`<pre>${a(n.outputTail)}</pre>`)}</li>`).join("")}</ul>`):""}
  </section>
  <section>
    <h3>Dependencies</h3>
    ${t.audit?t.audit.ok?`<p>${t.audit.counts.critical+t.audit.counts.high?i("warning","bad"):i("pass","ok")} ${t.audit.counts.critical} critical \xB7 ${t.audit.counts.high} high \xB7 ${t.audit.counts.moderate} moderate \xB7 ${t.audit.counts.low} low <span class="muted small">(${a(t.audit.tool)}, ${$(t.audit.ranAt)})</span></p>${t.audit.top.length?f("audit-top","Affected packages",`<ul class="plain">${t.audit.top.map(n=>`<li><code>${a(n.name)}</code> <span class="sev sev-${n.severity==="critical"?"blocker":n.severity==="high"?"high":"medium"}">${a(n.severity)}</span> ${a(n.title)}${n.fixAvailable?' <span class="muted small">fix available</span>':""}</li>`).join("")}</ul>`):""}`:`<p class="muted">${i("info")} ${a(t.audit.error)}</p>`:'<p class="muted small">Check your libraries against public vulnerability databases. Sends package names and versions only.</p>'}
    <div class="actions"><button class="secondary" data-act="audit" ${g?.trusted?"":"disabled"}>${i("shield")} ${t.audit?"Re-check":"Check dependencies"}</button></div>
  </section>
  <section>
    <h3>Visual check</h3>
    <p class="muted small">Open your running app headlessly, check it loads without an error, and save a screenshot.${t.browserFound?"":" (No Chrome/Edge found, so no screenshot.)"}</p>
    <input id="appUrl" type="text" value="${a(t.visual?.url??t.appUrl.url??"")}" placeholder="http://localhost:3000" aria-label="App address">
    <div class="muted small">${t.appUrl.url?`Detected from ${a(t.appUrl.basis)}`:"Address not detected. Enter it above."}</div>
    <div class="actions wrap"><button class="secondary" data-act="visualCheck">${i("eye")} Check now</button>${s?.scripts.dev||s?.scripts.start?`<button class="link" data-act="startApp" ${g?.trusted?"":"disabled"}>Start the app first</button>`:""}</div>
    ${t.visual?`<p>${t.visual.reachable&&!t.visual.errorText?i("pass","ok"):i("error","bad")} ${a(t.visual.note)} <span class="muted small">${$(t.visual.checkedAt)}${t.visual.title?` \xB7 \u201C${a(t.visual.title)}\u201D`:""}</span></p>${t.visual.errorText?`<div class="errtext">${a(t.visual.errorText)}</div>`:""}${g?.screenshotUri?`<a href="#" data-act="openScreenshot" title="Open full size"><img class="shot" src="${a(g.screenshotUri)}" alt="Screenshot of your app"></a>`:""}`:""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${t.out.readiness.map(n=>`<li>${b(n.status)} <span>${a(n.label)}</span><div class="muted small">${a(n.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${t.doctor.length?`<ul class="ready">${t.doctor.map(n=>`<li>${b(n.status==="ok"?"verified":n.status==="fail"?"failed":n.status==="warn"?"unverified":"unknown")} <span>${a(n.label)}</span><div class="muted small">${a(n.detail)}</div></li>`).join("")}</ul>`:'<p class="muted">No checks apply to this project type yet.</p>'}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${s?.isGit?"":"disabled"}>${i("save")} Save checkpoint</button></div>
    ${t.checkpoints.length?`<ul class="plain">${t.checkpoints.slice(0,6).map(n=>`<li>${i("history")} ${a(n.label)} <span class="muted small">${$(n.ts)} \xB7 ${n.sha.slice(0,8)}</span> <a href="#" data-act="cpDiff" data-sha="${n.sha}">changed since</a>${A[n.sha]?ct(n.sha):""}</li>`).join("")}</ul>`:""}
  </section>`}function ct(t){let e=A[t];return e.length?`<div class="cp-files"><ul class="plain files">${e.slice(0,40).map(s=>`<li><label><input type="checkbox" class="cpf" data-sha="${t}" value="${a(s)}"> ${a(s)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${t}">${i("discard")} Restore selected files</button></div>`:'<div class="muted small">No changes since this checkpoint.</div>'}function ut(){let t=R.find(e=>e.id===l.goal);return`
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${R.map(e=>`<button role="radio" aria-checked="${e.id===l.goal}" class="goal ${e.id===l.goal?"on":""}" data-goal-pick="${e.id}" title="${a(e.plain)}">${a(e.label)}</button>`).join("")}</div>
    ${t?`<p class="muted small">${a(t.plain)}</p>`:""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${a(t?.hint??"")}">${a(l.request)}</textarea>
    ${t?.questions.length?`<div class="muted small hint">Helpful to include: ${t.questions.map(a).join(" \xB7 ")}</div>`:""}
    ${f("prompt-more","More options",`
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${a(l.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when\u2026" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${a(l.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${l.planFirst?"checked":""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${i("sparkle")} Build prompt</button></div>
  </section>
  ${v?`
  <section class="built">
    ${v.missingInfo.length?`<div class="note warn">${i("question")} <div><b>Worth adding</b><ul>${v.missingInfo.map(e=>`<li>${a(e)}</li>`).join("")}</ul></div></div>`:""}
    ${v.assumptions.length?`<div class="note">${i("info")} <div><b>Assumptions made</b><ul>${v.assumptions.map(e=>`<li>${a(e)}</li>`).join("")}</ul></div></div>`:""}
    <div class="muted small">Model: ${a(v.suggestedModel)} \xB7 ${v.verification.length?`Verifies with: ${v.verification.join(", ")}`:"No check commands found"} \xB7 ${y.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${a(y)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${i("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${g?.trusted?"":"disabled"} title="Opens a terminal and starts Claude Code with this prompt">${i("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${g?.aiProvider==="none"?"Needs an AI provider (optional)":"Uses "+a(g?.aiProvider)}">${i("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>`:""}`}function pt(){let t=d,e=s=>["todo","in_progress","done","dropped"].map(n=>`<option value="${n}" ${s.status===n?"selected":""}>${{todo:"Not started",in_progress:"In progress",done:"Done",dropped:"Dropped"}[n]}</option>`).join("");return`
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" placeholder="What are you building, for whom, and what does success look like?">${a(t.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${t.requirements.length?`<ul class="reqs">${t.requirements.map(s=>`<li>
      <div class="req-top"><select data-req-status="${s.id}" aria-label="Status for ${a(s.title)}">${e(s)}</select><span class="req-title">${a(s.title)}</span>${s.status==="done"?b(s.evidence,s.evidenceNote):""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${s.id}" aria-label="Delete requirement">${i("trash")}</button></div>
      <div class="muted small">${s.acceptance?`Done when: ${a(s.acceptance)}`:`<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${s.id}">Add</a>`}</div>
    </li>`).join("")}</ul>`:""}
    <input id="newReq" type="text" placeholder="e.g. Users can pay with a card">
    <input id="newAcc" type="text" placeholder="Done when\u2026 e.g. a test payment succeeds and a receipt is emailed">
    <div class="actions"><button class="secondary small" data-act="addReq">Add requirement</button>${t.facts?.checklistItems.length?`<button class="link" data-act="importChecklist">Import ${t.facts.checklistItems.length} from docs</button>`:""}</div>
  </section>
  <section>
    <h3>Decisions</h3>
    ${t.decisions.length?`<ul class="plain">${t.decisions.map(s=>`<li><b>${a(s.title)}</b>${s.detail?`: ${a(s.detail)}`:""} <button class="icon-btn" data-act="delDec" data-id="${s.id}" aria-label="Delete decision">${i("close")}</button></li>`).join("")}</ul>`:`<p class="muted small">Record choices (e.g. "Use Supabase for auth") so new sessions don't undo them.</p>`}
    <input id="newDec" type="text" placeholder="Decision"><input id="newDecD" type="text" placeholder="Why / detail (optional)">
    <div class="actions"><button class="secondary small" data-act="addDec">Add decision</button></div>
  </section>
  <section>
    <h3>Preferences</h3>
    <textarea id="prefs" rows="2" placeholder="e.g. Keep the UI minimal. Use TypeScript. Explain things simply.">${a(t.notes.preferences)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="preferences" data-src="prefs">Save</button></div>
  </section>
  <section>
    <h3>Session handoff</h3>
    <p class="muted small">A compact summary of goal, requirements, state, what was tried, and the next step, to start a new Claude Code session without losing context.</p>
    <div class="actions wrap"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff</button><button class="secondary" data-act="handoffPrompt">${i("sparkle")} Handoff prompt</button><button class="link" data-act="saveHandoff">Save to .buildpilot/HANDOFF.md</button></div>
    <div class="actions"><button class="link" data-act="claudeMd">${t.facts?.hasClaudeMd?"Draft CLAUDE.md additions":"Draft a CLAUDE.md"}</button></div>
  </section>
  <section>
    <h3>Your data</h3>
    <p class="muted small">Stored only on this computer in <code>${a(g?.home??"~/.buildpilot")}</code>.</p>
    <div class="actions wrap"><button class="link danger" data-act="deleteProjectData">Delete this project's data</button><button class="link danger" data-act="deleteAllData">Delete all data</button></div>
  </section>`}function mt(){let t=d,e=g;return`
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${i(t.integration.claudeInstalled?"pass-filled":"circle-large-outline",t.integration.claudeInstalled?"ok":"muted")} <span>${t.integration.claudeInstalled?`Installed: ${a(t.integration.claudeVersion)}`:t.integration.claudeInstalled===null?"Checking\u2026":"Not found on PATH"}</span></li>
      <li>${i(t.hooks.installed?"pass-filled":"circle-large-outline",t.hooks.installed?"ok":"muted")} <span>${t.hooks.installed?"Connected":t.hooks.settingsError?`Settings file problem: ${a(t.hooks.settingsError)}`:"Not connected"}<div class="muted small mono">${a(t.hooks.settingsPath)}</div></span></li>
      <li>${i(t.statusline.installed?"pass-filled":"circle-large-outline",t.statusline.installed?"ok":"muted")} <span>${t.statusline.installed?`Exact context % on${t.statusline.chainedOriginal?" (your status line is preserved)":""}`:"Exact context % off"} ${t.statusline.installed?'<a href="#" data-act="statuslineOff">remove</a>':'<a href="#" data-act="statuslineOn">turn on</a>'}</span></li>
      <li>${i("database","muted")} <span>${t.integration.spool.accepted} events received this run${t.integration.spool.rejected?`, ${t.integration.spool.rejected} malformed ignored`:""}${t.integration.spool.lastEventAt?` \xB7 last ${$(t.integration.spool.lastEventAt)}`:""}</span></li>
    </ul>
    <div class="actions wrap">${t.hooks.installed?'<button class="link" data-act="uninstallHooks">Disconnect</button>':'<button class="primary" data-act="installHooks">Connect</button>'}${t.demo?'<button class="link" data-act="demoOff">Remove demo data</button>':'<button class="link" data-act="demoOn">Load demo data</button>'}</div>
  </section>
  <section>
    <h3>Phone, glasses &amp; other devices</h3>
    <p class="muted small">Get alerts where you are, like "Claude needs your approval" or "Tests failing". Send them to <b>ntfy</b> (free phone push; smart glasses paired to your phone can read phone notifications aloud), <b>Slack</b>, <b>Discord</b>, or any webhook. Only short alerts and the project name are sent, never code.</p>
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${i("bell")} ${q?"Change notification URL":"Set up notifications"}</button>${q?'<button class="link" data-act="testWebhook">Send test</button>':""}</div>
  </section>
  <section>
    <h3>Integration API</h3>
    <p class="muted small">Lets your own tools ask BuildPilot what's happening: iOS Shortcuts / Siri, Raycast, Stream Deck, a companion app for smart glasses, or a bot. Read-only plus prompt generation. It can't run commands or change files. Requires a secret token.</p>
    <label class="check"><input type="checkbox" id="apiToggle" ${e.apiEnabled?"checked":""}> Enable on ${e.apiAllowLan?"your local network":"this computer only"}</label>
    ${e.apiEnabled&&e.pocketUrl?`<div class="pocket">${i("device-mobile")} <div><b>Pocket</b>: a phone page that shows status and can read it aloud (through Bluetooth glasses or earbuds).<div class="mono small">${a(e.pocketUrl)}</div>${e.apiAllowLan?"":'<div class="muted small">To open it on your phone, enable network access in settings (trusted Wi-Fi only).</div>'}<button class="link" data-act="copyPocketLink">Copy link for my phone</button></div></div>`:""}
    ${e.apiEnabled&&e.apiAddress?`<div class="mono small api">${a(e.apiAddress)}/v1/brief?format=text<br>${a(e.apiAddress)}/v1/status \xB7 /v1/sessions \xB7 /v1/next<br>POST ${a(e.apiAddress)}/v1/prompt {"goal","request"}</div>
      <div class="actions wrap"><button class="secondary small" data-act="copyApiToken">${i("key")} Copy token</button><button class="link" data-act="rotateApiToken">New token</button><button class="link" data-act="settings">Port / network settings</button></div>`:""}
  </section>
  <section>
    <h3>AI refinement <span class="muted small">(optional)</span></h3>
    <p class="muted small">BuildPilot works fully without AI. Optionally refine prompts with your own Anthropic API key or a local Ollama model. Nothing is sent without your OK each time.</p>
    <div class="muted small">Provider: <b>${a(e.aiProvider)}</b>${e.aiModel?` \xB7 ${a(e.aiModel)}`:""}</div>
    <div class="actions"><button class="link" data-act="settings">Change in Settings</button></div>
  </section>
  <section>
    <h3>Experience</h3>
    <label class="check"><input type="checkbox" id="beginner" ${e.beginner?"checked":""}> Beginner explanations (plain-English "why it matters")</label>
    <div class="muted small">Pop-up alerts: ${a(e.notifications)} \xB7 <a href="#" data-act="settings">change</a></div>
  </section>`}function _(){document.querySelectorAll("[data-tab]").forEach(e=>e.addEventListener("click",s=>{s.preventDefault(),l.tab=e.dataset.tab,k(),l.tab==="connect"&&r("hasWebhook").then(n=>{q=n,h()}),h(),document.querySelector(".content")?.scrollTo(0,0)})),document.querySelectorAll("details[data-key]").forEach(e=>e.addEventListener("toggle",()=>{l.open[e.dataset.key]=e.open,k()})),document.querySelectorAll("[data-open]").forEach(e=>e.addEventListener("click",s=>{s.preventDefault(),r("openFile",{path:e.dataset.open})})),document.querySelectorAll("[data-goal-pick]").forEach(e=>e.addEventListener("click",()=>{l.goal=e.dataset.goalPick,k(),h()}));let t=(e,s)=>document.getElementById(e)?.addEventListener("input",n=>{l[s]=n.target.value,k()});t("req","request"),t("must","mustNotChange"),t("acc","acceptance"),document.getElementById("planFirst")?.addEventListener("change",e=>{l.planFirst=e.target.checked,k()}),document.getElementById("ptext")?.addEventListener("input",e=>{y=e.target.value}),document.getElementById("apiToggle")?.addEventListener("change",e=>void r("apiToggle",{value:e.target.checked})),document.getElementById("beginner")?.addEventListener("change",e=>void r("setBeginner",{value:e.target.checked})),document.querySelectorAll("[data-req-status]").forEach(e=>e.addEventListener("change",()=>void r("updateRequirement",{id:e.dataset.reqStatus,patch:{status:e.value}}))),document.getElementById("req")?.addEventListener("keydown",e=>{e.key==="Enter"&&(e.metaKey||e.ctrlKey)&&E()}),document.getElementById("newAcc")?.addEventListener("keydown",e=>{e.key==="Enter"&&z()}),document.querySelectorAll("[data-act]").forEach(e=>e.addEventListener("click",s=>{s.preventDefault(),ht(e)}))}var C=t=>(document.getElementById(t)?.value??"").trim();async function E(){l.request=C("req")||l.request;let t=await r("buildPrompt",{goal:l.goal,request:l.request,mustNotChange:l.mustNotChange,acceptance:l.acceptance,beginner:N(),planFirst:l.planFirst});v=t,y=t.text,h(),document.getElementById("ptext")?.scrollIntoView?.({block:"nearest"})}async function z(){let t=C("newReq");t&&await r("addRequirement",{title:t,acceptance:C("newAcc")})}async function ht(t){let e=t.dataset.act;switch(e){case"build":return E();case"promptFor":return l.tab="prompts",l.goal=t.dataset.goal||"feature",l.request=t.dataset.request||"",k(),l.request?E():(v=null,h());case"copyPrompt":return void r("copy",{text:y});case"sendPrompt":return void r("sendToClaude",{text:y});case"refine":{let s=await r("refine",{text:y});s?.text&&(y=s.text,h());return}case"copyHandoff":{let s=await r("handoff");return void r("copy",{text:s})}case"handoffPrompt":return l.tab="prompts",l.goal="handoff",l.request="Continue where the previous session left off.",k(),E();case"runScript":return void r("runScript",{script:t.dataset.script});case"dismiss":return void r("dismiss",{key:t.dataset.key});case"saveNote":return void r("setNote",{key:t.dataset.key,value:C(t.dataset.src)});case"addReq":return z();case"delReq":return void r("deleteRequirement",{id:t.dataset.id});case"editAcc":{let n=t.closest("li")?.querySelector(".req-title")?.textContent??"",u=document.createElement("input");u.type="text",u.placeholder=`Done when\u2026 (for "${n}")`,t.replaceWith(u),u.focus(),u.addEventListener("keydown",m=>{m.key==="Enter"&&u.value.trim()&&r("updateRequirement",{id:t.dataset.id,patch:{acceptance:u.value.trim()}})});return}case"addDec":{let s=C("newDec");s&&await r("addDecision",{title:s,detail:C("newDecD")});return}case"delDec":return void r("deleteDecision",{id:Number(t.dataset.id)});case"cpDiff":return A[t.dataset.sha]=await r("checkpointDiff",{sha:t.dataset.sha}),h();case"rollback":{let s=t.dataset.sha,n=[...document.querySelectorAll(`input.cpf[data-sha="${s}"]:checked`)].map(u=>u.value);return n.length?(await r("rollback",{sha:s,files:n}),A={},h()):void 0}case"statuslineOn":return void r("statusline",{on:!0});case"statuslineOff":return void r("statusline",{on:!1});case"visualCheck":return void r("visualCheck",{url:C("appUrl")});case"worktree":return void r("worktree",{sessionId:t.dataset.session});case"explainSession":{let s=t.dataset.session,n=await r("explainSession",{sessionId:s});n&&(M[s]=n,h());return}case"demoOn":return void r("demo",{on:!0});case"demoOff":return void r("demo",{on:!1});case"setWebhook":return await r("setWebhook"),q=await r("hasWebhook"),h();default:return void r(e)}}r("goals").then(t=>{R=t??[],h()});T.postMessage({type:"ready"});})();
//# sourceMappingURL=webview.js.map
