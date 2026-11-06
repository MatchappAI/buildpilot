"use strict";(()=>{var q=acquireVsCodeApi(),Q=q.getState()??{},o={tab:"overview",open:{},goal:"feature",request:"",mustNotChange:"",acceptance:"",planFirst:!0,...Q},d=null,g=null,$=null,k="",R=[],T={},A=!1,M={},U="",b=()=>q.setState(o),X=0,D=new Map;function l(e,a={}){let t=++X;return new Promise(n=>{D.set(t,n),q.postMessage({type:e,id:t,...a})})}window.addEventListener("message",e=>{let a=e.data;a.type==="reply"&&a.id?(D.get(a.id)?.(a.result),D.delete(a.id)):a.type==="state"?(d=a.state,g=a.settings,m()):a.type==="navigate"&&a.tab&&(o.tab=a.tab,b(),m())});var s=e=>String(e??"").replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a]),i=(e,a="")=>`<i class="codicon codicon-${e} ${a}" aria-hidden="true"></i>`;function v(e){if(!e)return"never";let a=Math.max(0,Math.round((Date.now()-e)/1e3));return a<45?"just now":a<3600?`${Math.round(a/60)} min ago`:a<86400?`${Math.round(a/3600)} h ago`:`${Math.round(a/86400)} d ago`}var Z={verified:"Verified",inferred:"Inferred",unverified:"Unverified",failed:"Failed",unknown:"Unknown"},f=(e,a="")=>`<span class="conf conf-${e}" title="${s(a||ee(e))}">${Z[e]}</span>`;function ee(e){return{verified:"Checked directly (e.g. a command passed, a file exists).",inferred:"BuildPilot's best reading of the evidence. Could be wrong.",unverified:"Claimed or assumed, but not proven yet.",failed:"Checked, and it failed.",unknown:"Not enough information to say."}[e]}var te={blocker:"error",high:"warning",medium:"info",low:"circle-small",info:"circle-small"},B=e=>`<span class="sev sev-${e}">${i(te[e])}${e==="blocker"?"Blocker":e==="high"?"Important":e==="medium"?"Worth doing":"Optional"}</span>`,G={running:"Working",idle:"Idle",blocked:"Needs input",awaiting_approval:"Needs approval",completed:"Ended",failed:"Failed",unknown:"Unknown"},O=e=>`<span class="dot dot-${e}" aria-hidden="true"></span>`,j=e=>e.startsWith("demo-")?`DEMO ${e.slice(5,11)}`:e.slice(0,8),ae=e=>e.split(/[\\/]/).pop()??e,W=e=>d?.project&&e.startsWith(d.project.root)?e.slice(d.project.root.length+1):e,N=()=>g?.beginner??!0;function H(e){return e.length?`<ul class="evidence">${e.map(a=>`<li><span class="ev-kind ev-${a.kind}" title="${a.kind==="observed"?"Seen directly":"Inferred"}">${a.kind==="observed"?"seen":"inferred"}</span> ${s(a.text)}${a.ref?` <a href="#" data-open="${s(a.ref)}" class="ref">${s(ae(a.ref))}</a>`:""}</li>`).join("")}</ul>`:""}function y(e,a,t,n=!1){let c=o.open[e]??n;return`<details data-key="${s(e)}" ${c?"open":""}><summary>${a}</summary><div class="details-body">${t}</div></details>`}var se=[{id:"overview",label:"Overview",icon:"home"},{id:"sessions",label:"Sessions",icon:"pulse"},{id:"supervisor",label:"Supervisor",icon:"shield"},{id:"prompts",label:"Prompts",icon:"sparkle"},{id:"memory",label:"Memory",icon:"book"},{id:"connect",label:"Connect",icon:"plug"}];function m(){let e=document.getElementById("app"),a=document.querySelector(".content")?.scrollTop??0,t=document.activeElement,n=t?.id,c=t?.selectionStart??null;if(!d){e.innerHTML='<div class="loading">Starting BuildPilot\u2026</div>';return}if(!d.project)return e.innerHTML=`<div class="empty">${i("folder-opened","big")}<h2>Open a project</h2><p>BuildPilot supervises one project folder at a time. Open a folder in VS Code, or pick one.</p><button class="primary" data-act="selectProject">Choose project folder</button></div>`,V();let p=d.out.sessions.filter(h=>!h.endedAt&&d.generatedAt-h.lastEventAt<36e5),u=p.filter(h=>h.displayStatus==="awaiting_approval"||h.displayStatus==="blocked").length,E=d.out.issues.filter(h=>h.severity==="blocker"||h.severity==="high").length,I={sessions:u?`<span class="badge warn">${u}</span>`:p.length?`<span class="badge">${p.length}</span>`:"",supervisor:E?`<span class="badge err">${E}</span>`:""},w=d.out.health;e.innerHTML=`
  <header class="top">
    <div class="title-row">
      <button class="project" data-act="selectProject" title="Switch project">${s(d.facts?.name??d.project.name)} ${i("chevron-down")}</button>
      <span class="spacer"></span>
      ${d.analyzing?`<span class="muted small">${i("loading","spin")} Analyzing</span>`:`<button class="icon-btn" data-act="analyze" title="Re-analyze project" aria-label="Re-analyze project">${i("refresh")}</button>`}
    </div>
    <div class="meta-row">
      <span class="health health-${w.level}">${O(w.level==="good"?"running":w.level==="blocked"?"failed":w.level==="attention"?"awaiting_approval":"unknown")}${s(w.label)}</span>
      <span class="chip" title="Development stage (${d.out.stage.confidence})">${s(d.out.stage.stage)}</span>
    </div>
    ${d.demo?`<div class="demo-banner">${i("beaker")} Showing DEMO sessions. They aren't real. <a href="#" data-act="demoOff">Remove demo</a></div>`:""}
    ${g?.trusted?"":`<div class="demo-banner">${i("shield")} Restricted Mode: BuildPilot can read, but won't run scripts or change files.</div>`}
    <nav class="tabs" role="tablist" aria-label="BuildPilot sections">${se.map(h=>`<button role="tab" id="tab-${h.id}" aria-controls="panel" aria-selected="${o.tab===h.id}" tabindex="${o.tab===h.id?0:-1}" class="tab ${o.tab===h.id?"active":""}" data-tab="${h.id}" title="${h.label}" aria-label="${h.label}${ne(h.id,u,E,p.length)}">${i(h.icon)}<span class="tab-label">${h.label}</span>${I[h.id]??""}</button>`).join("")}</nav>
  </header>
  <main class="content" id="panel" role="tabpanel" aria-labelledby="tab-${o.tab}" tabindex="-1">${d.errors.map(h=>`<div class="error-box">${i("error")} ${s(h)}</div>`).join("")}${oe()}</main>`,V(),ie();let S=document.querySelector(".content");if(S&&(S.scrollTop=a),n){let h=document.getElementById(n);if(h&&(h.focus(),c!==null&&"setSelectionRange"in h))try{h.setSelectionRange(c,c)}catch{}}}function ne(e,a,t,n){return e==="sessions"?a?`, ${a} waiting for you`:n?`, ${n} active`:"":e==="supervisor"&&t?`, ${t} important issues`:""}function ie(){if(!d)return;let e=d.out.sessions.filter(u=>!u.endedAt&&(u.displayStatus==="awaiting_approval"||u.displayStatus==="blocked")),a=d.elsewhere.filter(u=>u.status==="awaiting_approval"||u.status==="blocked"),t=d.out.issues.find(u=>u.severity==="blocker"),n=[];e.length&&n.push(`${e.length} Claude session${e.length===1?"":"s"} waiting for you`),a.length&&n.push(`waiting in ${[...new Set(a.map(u=>u.folder))].join(", ")}`),t&&n.push(`Blocker: ${t.title}`);let c=n.join(". "),p=document.getElementById("live");p||(p=document.createElement("div"),p.id="live",p.className="sr-only",p.setAttribute("role","status"),p.setAttribute("aria-live","polite"),document.body.appendChild(p)),c!==U&&(p.textContent=c),U=c}function oe(){switch(o.tab){case"overview":return re();case"sessions":return ue();case"supervisor":return he();case"prompts":return ge();case"memory":return $e();case"connect":return ve()}}function K(e,a=!0){let t=e.action,n=a?"primary":"secondary";return t?t.kind==="install_hooks"?`<button class="${n}" data-act="installHooks">Connect</button>`:t.kind==="checkpoint"?`<button class="${n}" data-act="checkpoint">${i("save")} Save checkpoint</button>`:t.kind==="run_script"?`<button class="${n}" data-act="runScript" data-script="${s(t.script)}" ${d?.runningScript?"disabled":""}>${i("play")} ${t.script==="install"?"Install":`Run ${s(t.script)}`}</button>`:t.kind==="prompt"?`<button class="${n}" data-act="promptFor" data-goal="${s(t.goal)}" data-request="${s(t.request)}">${i("sparkle")} Write the prompt</button>`:t.kind==="open_file"?`<button class="${n}" data-open="${s(t.path)}">Open</button>`:t.kind==="audit"?`<button class="${n}" data-act="audit">${i("shield")} Check dependencies</button>`:t.kind==="visual_check"?`<button class="${n}" data-act="visualCheck">${i("eye")} Check the app</button>`:t.kind==="worktree"?`<button class="${n}" data-act="worktree" data-session="${s(t.sessionId)}">${i("git-branch")} Separate the sessions</button>`:t.kind==="open_tab"?`<button class="${n}" data-tab="${t.tab}">Open ${t.tab[0].toUpperCase()+t.tab.slice(1)}</button>`:"":""}function le(){let e=d.out.next;return e?`<section class="next sev-border-${e.severity}" aria-label="Recommended next step">
    <div class="eyebrow">Next step ${B(e.severity)}</div>
    <div class="next-title">${s(e.title)}</div>
    <p>${s(e.why)}</p>
    <div class="actions">${K(e)}<button class="link" data-act="dismiss" data-key="${s(e.key)}" title="Hide for 24 hours">Not now</button></div>
    ${y(`ev:${e.key}`,"Why BuildPilot thinks so",H(e.evidence))}
  </section>`:`<section class="next good">${i("pass-filled")}<div><div class="eyebrow">Next step</div><div class="next-title">Nothing urgent. Keep building.</div><p class="muted">Tell Prompt Studio what you want next.</p><button class="secondary" data-tab="prompts">Open Prompt Studio</button></div></section>`}function re(){let e=d,a=e.facts,t=e.out.sessions.filter(r=>!r.endedAt&&e.generatedAt-r.lastEventAt<36e5),n=t.filter(r=>r.displayStatus==="running").length,c=t.filter(r=>r.displayStatus==="awaiting_approval"||r.displayStatus==="blocked").length,p=e.out.issues.filter(r=>r.severity==="blocker"||r.severity==="high"),u=e.hooks.installed?t.length===0?"No active Claude Code sessions in this project.":`${n} session${n===1?"":"s"} working${c?`, <b>${c} waiting for you</b>`:""}. <a href="#" data-tab="sessions">See sessions</a>`:'Not connected to Claude Code yet. <a href="#" data-act="installHooks">Connect</a>',E=e.elsewhere.filter(r=>r.status==="awaiting_approval"||r.status==="blocked"),I=u+(E.length?`<div class="small warn-text">Also waiting for you: ${s([...new Set(E.map(r=>r.folder))].join(", "))}</div>`:e.elsewhere.length?`<div class="muted small">${e.elsewhere.length} active in other projects \xB7 <a href="#" data-tab="sessions">see</a></div>`:""),w=p.length===0?"Nothing urgent found.":`${p.length} important issue${p.length===1?"":"s"}: ${s(p[0].title)}${p.length>1?` <a href="#" data-tab="supervisor">+${p.length-1} more</a>`:""}`,S=e.requirements.filter(r=>r.status!=="dropped"),h=S.filter(r=>r.status==="done"&&r.evidence==="verified"),Y=S.filter(r=>r.status==="in_progress"||r.status==="done"&&r.evidence!=="verified"),J=S.filter(r=>r.status==="todo"),P=e.testRuns.find(r=>/test|vitest|jest|pytest/.test(r.command));return`
  ${le()}
  ${de()}
  <section class="qa">
    <div class="qa-row"><span class="qa-q">What's happening?</span><span>${I}</span></div>
    <div class="qa-row"><span class="qa-q">Anything wrong?</span><span>${w}</span></div>
  </section>
  <section>
    <h3>Project</h3>
    <dl class="facts">
      <dt>What it is</dt><dd>${a?.description?`${s(a.description)} <span class="muted small">(from ${s(a.descriptionSource)})</span>`:e.notes.goal?s(e.notes.goal):'<span class="muted">Unknown.</span> <a href="#" data-tab="memory">Describe your goal</a>'}</dd>
      <dt>Built with</dt><dd>${a?s([...a.languages,...a.frameworks].join(", ")||"Not detected"):"\u2026"}</dd>
      <dt>Stage</dt><dd>${s(e.out.stage.stage)} ${f(e.out.stage.confidence)}${y("stage-ev","evidence",H(e.out.stage.evidence))}</dd>
      <dt>Progress</dt><dd>${e.out.progress.total?`<div class="bar" role="progressbar" aria-valuenow="${e.out.progress.done}" aria-valuemax="${e.out.progress.total}"><span style="width:${Math.round(e.out.progress.done/e.out.progress.total*100)}%"></span></div>`:""}${s(e.out.progress.label)}</dd>
      <dt>Tests</dt><dd>${P?`${P.passed?f("verified","Passed when BuildPilot ran it")+" passing":f("failed")+" failing"} \xB7 ${v(P.startedAt)}`:`${f("unknown")} not run yet${a?.scripts.test?' \xB7 <a href="#" data-act="runScript" data-script="test">Run tests</a>':""}`}</dd>
      <dt>Git</dt><dd>${e.changes?`${s(e.changes.branch??"detached")} \xB7 ${e.changes.unstaged.length+e.changes.untracked.length+e.changes.staged.length} uncommitted`:a?.isGit===!1?`${f("failed")} not using Git`:"\u2026"}</dd>
    </dl>
  </section>
  <section>
    <h3>Features <span class="muted small">vs. your requirements</span></h3>
    ${S.length===0?`<p class="muted">No requirements yet, so BuildPilot can't tell what's built vs. missing. ${a?.checklistItems.length?`<a href="#" data-act="importChecklist">Import ${a.checklistItems.length} checklist items from your docs</a> or `:""}<a href="#" data-tab="memory">add them</a>.</p>`:`${L("Done & verified",h,"verified")}${L("Partly done / unproven",Y,"unverified")}${L("Not started",J,"unknown")}`}
  </section>
  ${e.resolved.length?`<section><h3>Recently resolved</h3><ul class="plain">${e.resolved.map(r=>`<li>${i("check","ok")} ${s(r.title)} <span class="muted small">${v(r.resolvedAt)}: condition no longer observed</span></li>`).join("")}</ul></section>`:""}
  <section>
    <h3>Recent work</h3>
    ${e.commits.length?`<ul class="plain">${e.commits.slice(0,5).map(r=>`<li><span class="muted small">${v(r.ts)}</span> ${s(r.subject)}</li>`).join("")}</ul>`:'<p class="muted">No commits yet.</p>'}
  </section>
  ${ce()}`}function de(){let e=d.metrics;if(!e.length)return"";let a=t=>t==="unknown"?"Unknown":t==="estimate"?"Estimate":"Measured";return`<section class="metrics" aria-label="Key numbers">${e.map(t=>`<button class="metric tone-${t.tone}" ${t.tab?`data-tab="${t.tab}"`:""} title="${s(t.why)}" aria-label="${s(`${t.label}: ${t.value==="\u2014"?"unknown":t.value}. ${t.detail}. ${t.why}`)}">
        <span class="m-label">${s(t.label)}</span>
        <span class="m-value">${s(t.value)}</span>
        <span class="m-detail">${s(t.detail)}</span>
        <span class="sr-only">${a(t.confidence)}</span>
      </button>`).join("")}</section>`}function L(e,a,t){return a.length?`<div class="fgroup"><div class="fgroup-h">${f(t)} ${s(e)} <span class="muted">(${a.length})</span></div><ul class="plain">${a.slice(0,8).map(n=>`<li>${s(n.title)}</li>`).join("")}${a.length>8?`<li class="muted">+${a.length-8} more</li>`:""}</ul></div>`:""}function ce(){let e=d,a=[{done:!!e.integration.claudeInstalled,label:"Claude Code installed",hint:e.integration.claudeInstalled===null?"checking\u2026":e.integration.claudeVersion??"Install from claude.com/claude-code"},{done:e.hooks.installed,label:"BuildPilot connected to Claude Code",hint:e.hooks.installed?"Live sessions will appear automatically":"",act:e.hooks.installed?"":'<button class="secondary small" data-act="installHooks">Connect</button>'},{done:!!e.integration.gitAvailable&&!!e.facts?.isGit,label:"Project uses Git",hint:e.facts?.isGit?"":"Needed for checkpoints and rollback"}];return a.every(t=>t.done)?"":`<section><h3>Setup</h3><ul class="steps">${a.map(t=>`<li>${i(t.done?"pass-filled":"circle-large-outline",t.done?"ok":"muted")} <span>${s(t.label)}${t.hint?` <span class="muted small">\xB7 ${s(t.hint)}</span>`:""}</span> ${t.act??""}</li>`).join("")}</ul></section>`}function ue(){let e=d;if(!e.hooks.installed&&e.out.sessions.length===0)return`<div class="empty">${i("plug","big")}<h2>Connect to Claude Code</h2><p>BuildPilot adds small background hooks to Claude Code so it can see what each session is doing. Nothing leaves your computer. Your settings are backed up and it can be undone.</p><button class="primary" data-act="installHooks">Connect</button><p class="muted small">Or <a href="#" data-act="demoOn">try it with demo data</a> first.</p></div>`;if(e.out.sessions.length===0)return`${F()}<div class="empty">${i("terminal","big")}<h2>No sessions yet</h2><p>Start Claude Code in this project (run <code>claude</code> in a terminal). It'll appear here within a second.</p><p class="muted small">Already running? It appears on its next action. If not, restart it.</p><button class="secondary" data-act="promptFor" data-goal="feature" data-request="">${i("sparkle")} Write a first prompt</button></div>`;let a=e.out.sessions.filter(n=>!n.endedAt&&e.generatedAt-n.lastEventAt<12*36e5),t=e.out.sessions.filter(n=>!a.includes(n));return`
    ${a.length?`<h3>Active <span class="muted small">(${a.length})</span></h3>${a.map(_).join("")}`:'<p class="muted">No active sessions.</p>'}
    ${t.length?y("past-sessions",`Earlier sessions (${t.length})`,t.map(_).join("")):""}
    ${F()}
    <div class="actions"><button class="secondary" data-act="copyHandoff">${i("copy")} Copy handoff for a new session</button></div>
    <p class="muted small">Statuses come from Claude Code hook events. BuildPilot never guesses what a terminal is doing. If it hasn't heard anything in 10 minutes, it says "Unknown".</p>`}function F(){let e=d.elsewhere;if(!e.length)return"";let a=e.filter(t=>t.status==="awaiting_approval"||t.status==="blocked").length;return`<section class="elsewhere"><h3>Other projects <span class="muted small">(${e.length} active${a?`, <span class="warn-text">${a} waiting for you</span>`:""})</span></h3>
    <ul class="plain">${e.map(t=>`<li class="ew">${O(t.status)} <b>${s(t.folder)}</b> <span class="muted small">${G[t.status]??t.status} \xB7 ${v(t.lastEventAt)}${t.contextPct!=null?` \xB7 context ${Math.round(t.contextPct)}%`:""}</span>${t.task?`<div class="muted small ew-task">\u201C${s(t.task)}\u201D</div>`:""}${t.status==="awaiting_approval"||t.status==="blocked"?`<div class="small warn-text">${s(t.reason)}</div>`:""}</li>`).join("")}</ul>
    <div class="muted small">To supervise one of these in depth, open its folder in VS Code.</div></section>`}function _(e){let a=d.usage[e.id],t=d.live[e.id],n=t&&t.contextPct!=null?`<div class="ctx" title="From Claude Code's status line"><div class="bar ${t.contextPct>=80?"hot":""}"><span style="width:${Math.min(100,Math.round(t.contextPct))}%"></span></div><span class="small">Context ${Math.round(t.contextPct)}% of ${t.contextSize?Math.round(t.contextSize/1e3)+"k":"?"}${t.costUsd!=null?` \xB7 ~$${t.costUsd.toFixed(2)} at list price`:""}</span></div>`:"",c=a&&a.source==="transcript"?`${a.lastTurnInputTokens?.toLocaleString()??"?"} tokens in context (estimate) \xB7 ${a.totalOutputTokens?.toLocaleString()??"?"} written \xB7 ${a.assistantTurns} turns`:"Unknown (no local transcript data)",p=e.recent.map(u=>`<li class="${u.isError?"err":""}"><span class="muted small t">${new Date(u.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span> ${s(u.summary)}${u.filePath?` <a href="#" data-open="${s(u.filePath)}" class="ref">open</a>`:""}${u.isError&&u.errorText?`<div class="errtext">${s(u.errorText.split(`
`).slice(0,3).join(" "))}</div>`:""}</li>`).join("");return`<article class="session ${e.displayStatus}" aria-label="Session ${s(j(e.id))}">
    <div class="s-head">${O(e.displayStatus)}<b>${G[e.displayStatus]??e.displayStatus}</b><span class="muted small mono">${s(j(e.id))}</span><span class="spacer"></span><span class="muted small">${v(e.lastEventAt)}</span></div>
    ${e.currentTask?`<div class="s-task" title="Last prompt you gave it">\u201C${s(e.currentTask)}\u201D</div>`:'<div class="s-task muted">Task unknown (no prompt seen yet)</div>'}
    <div class="s-reason">${s(e.displayReason)}</div>
    ${n}
    ${e.intervention?`<div class="s-int">${i("arrow-right")} ${s(e.intervention)}</div>`:""}
    ${e.overlapsWith.length?`<div class="s-int warn">${i("warning")} Editing the same files as ${e.overlapsWith.map(j).join(", ")}</div>`:""}
    ${y(`sess:${e.id}`,`Details \xB7 ${e.eventCount} events${e.errorCount?` \xB7 <span class="errc">${e.errorCount} errors</span>`:""}`,`
      <dl class="facts small">
        <dt>Folder</dt><dd class="mono">${s(W(e.cwd)||"project root")}</dd>
        <dt>Model</dt><dd>${s(t?.model??a?.model??e.model??"Unknown")}</dd>
        <dt>Usage</dt><dd>${s(c)}</dd>
        <dt>Context</dt><dd>${t&&t.contextPct!=null?`${Math.round(t.contextPct)}% (exact, from Claude Code)`:d.statusline.installed?"Waiting for Claude Code to report":'Unknown \xB7 <a href="#" data-act="statuslineOn">show exact %</a>'}</dd>
        <dt>Cost</dt><dd>${t&&t.costUsd!=null?`~$${t.costUsd.toFixed(2)} <span class="muted">(Claude Code's estimate at list price; your plan may differ)</span>`:'Unknown <span class="muted">(not reported)</span>'}</dd>
        <dt>Started</dt><dd>${new Date(e.startedAt).toLocaleString()}</dd>
        ${e.permissionMode?`<dt>Permissions</dt><dd>${s(e.permissionMode)}</dd>`:""}
      </dl>
      ${e.editedFiles.length?`<div class="sub">Changed files</div><ul class="plain files">${e.editedFiles.map(u=>`<li><a href="#" data-open="${s(u)}">${s(W(u))}</a></li>`).join("")}</ul>`:""}
      <div class="actions"><button class="link" data-act="explainSession" data-session="${s(e.id)}">${i("sparkle")} Explain with AI</button></div>
      ${M[e.id]?`<div class="note">${i("lightbulb")}<div class="pre-wrap">${s(M[e.id])}</div></div>`:""}
      <div class="sub">Timeline (newest first)</div><ul class="timeline">${p||"<li class='muted'>No events</li>"}</ul>`)}
  </article>`}function pe(e){return`<li class="issue">${B(e.severity)}<div class="issue-body"><div class="issue-title">${s(e.title)}</div>${N()?`<div class="plain-expl">${s(e.plain)}</div>`:""}${y(`iss:${e.key}`,"Evidence",(N()?"":`<p class="plain-expl">${s(e.plain)}</p>`)+H(e.evidence))}</div></li>`}function he(){let e=d,a=e.out.recommendations,t=e.facts;return`
  <section>
    <h3>Issues <span class="muted small">${e.out.issues.length?`(${e.out.issues.length})`:""}</span></h3>
    ${e.out.issues.length?`<ul class="issues">${e.out.issues.map(pe).join("")}</ul>`:`<p class="muted">${i("pass","ok")} No issues found in what BuildPilot can check. That doesn't prove there are none.</p>`}
  </section>
  <section>
    <h3>Recommendations</h3>
    ${a.length?`<ol class="recs">${a.slice(0,8).map(n=>`<li><div class="rec-title">${s(n.title)} ${B(n.severity)}</div><div class="muted">${s(n.why)}</div><div class="actions">${K(n,!1)}<button class="link" data-act="dismiss" data-key="${s(n.key)}">Not now</button></div></li>`).join("")}</ol>`:'<p class="muted">Nothing to recommend right now.</p>'}
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
    ${e.testRuns.length?y("runs",`Recent runs (${e.testRuns.length})`,`<ul class="plain">${e.testRuns.slice(0,8).map(n=>`<li>${n.passed?i("pass","ok"):i("error","bad")} <code>${s(n.command)}</code> <span class="muted small">${v(n.startedAt)} \xB7 ${(n.durationMs/1e3).toFixed(1)}s</span>${y(`run:${n.id}`,"output",`<pre>${s(n.outputTail)}</pre>`)}</li>`).join("")}</ul>`):""}
  </section>
  <section>
    <h3>Dependencies</h3>
    ${e.audit?e.audit.ok?`<p>${e.audit.counts.critical+e.audit.counts.high?i("warning","bad"):i("pass","ok")} ${e.audit.counts.critical} critical \xB7 ${e.audit.counts.high} high \xB7 ${e.audit.counts.moderate} moderate \xB7 ${e.audit.counts.low} low <span class="muted small">(${s(e.audit.tool)}, ${v(e.audit.ranAt)})</span></p>${e.audit.top.length?y("audit-top","Affected packages",`<ul class="plain">${e.audit.top.map(n=>`<li><code>${s(n.name)}</code> <span class="sev sev-${n.severity==="critical"?"blocker":n.severity==="high"?"high":"medium"}">${s(n.severity)}</span> ${s(n.title)}${n.fixAvailable?' <span class="muted small">fix available</span>':""}</li>`).join("")}</ul>`):""}`:`<p class="muted">${i("info")} ${s(e.audit.error)}</p>`:'<p class="muted small">Check your libraries against public vulnerability databases. Sends package names and versions only.</p>'}
    <div class="actions"><button class="secondary" data-act="audit" ${g?.trusted?"":"disabled"}>${i("shield")} ${e.audit?"Re-check":"Check dependencies"}</button></div>
  </section>
  <section>
    <h3>Visual check</h3>
    <p class="muted small">Open your running app headlessly, check it loads without an error, and save a screenshot.${e.browserFound?"":" (No Chrome/Edge found, so no screenshot.)"}</p>
    <input id="appUrl" type="text" value="${s(e.visual?.url??e.appUrl.url??"")}" placeholder="http://localhost:3000" aria-label="App address">
    <div class="muted small">${e.appUrl.url?`Detected from ${s(e.appUrl.basis)}`:"Address not detected. Enter it above."}</div>
    <div class="actions wrap"><button class="secondary" data-act="visualCheck">${i("eye")} Check now</button>${t?.scripts.dev||t?.scripts.start?`<button class="link" data-act="startApp" ${g?.trusted?"":"disabled"}>Start the app first</button>`:""}</div>
    ${e.visual?`<p>${e.visual.reachable&&!e.visual.errorText?i("pass","ok"):i("error","bad")} ${s(e.visual.note)} <span class="muted small">${v(e.visual.checkedAt)}${e.visual.title?` \xB7 \u201C${s(e.visual.title)}\u201D`:""}</span></p>${e.visual.errorText?`<div class="errtext">${s(e.visual.errorText)}</div>`:""}${g?.screenshotUri?`<a href="#" data-act="openScreenshot" title="Open full size"><img class="shot" src="${s(g.screenshotUri)}" alt="Screenshot of your app"></a>`:""}`:""}
  </section>
  <section>
    <h3>Ready to ship?</h3>
    <ul class="ready">${e.out.readiness.map(n=>`<li>${f(n.status)} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>
    <p class="muted small">Only items marked Verified were checked. BuildPilot never calls a product "production-ready" from opinion.</p>
  </section>
  <section>
    <h3>Environment</h3>
    ${e.doctor.length?`<ul class="ready">${e.doctor.map(n=>`<li>${f(n.status==="ok"?"verified":n.status==="fail"?"failed":n.status==="warn"?"unverified":"unknown")} <span>${s(n.label)}</span><div class="muted small">${s(n.detail)}</div></li>`).join("")}</ul>`:'<p class="muted">No checks apply to this project type yet.</p>'}
  </section>
  <section>
    <h3>Safe changes</h3>
    <p class="muted small">A checkpoint saves every file without touching your branch or staging. Restore individual files later if a change goes wrong.</p>
    <div class="actions"><button class="secondary" data-act="checkpoint" ${t?.isGit?"":"disabled"}>${i("save")} Save checkpoint</button></div>
    ${e.checkpoints.length?`<ul class="plain">${e.checkpoints.slice(0,6).map(n=>`<li>${i("history")} ${s(n.label)} <span class="muted small">${v(n.ts)} \xB7 ${n.sha.slice(0,8)}</span> <a href="#" data-act="cpDiff" data-sha="${n.sha}">changed since</a>${T[n.sha]?me(n.sha):""}</li>`).join("")}</ul>`:""}
  </section>`}function me(e){let a=T[e];return a.length?`<div class="cp-files"><ul class="plain files">${a.slice(0,40).map(t=>`<li><label><input type="checkbox" class="cpf" data-sha="${e}" value="${s(t)}"> ${s(t)}</label></li>`).join("")}</ul><button class="secondary small" data-act="rollback" data-sha="${e}">${i("discard")} Restore selected files</button></div>`:'<div class="muted small">No changes since this checkpoint.</div>'}function ge(){let e=R.find(a=>a.id===o.goal);return`
  <section>
    <h3>Prompt Studio</h3>
    <p class="muted small">Describe what you want. BuildPilot turns it into a structured Claude Code prompt with your project's context, guardrails, acceptance criteria and verification steps.</p>
    <div class="goals" role="radiogroup" aria-label="Goal">${R.map(a=>`<button role="radio" aria-checked="${a.id===o.goal}" class="goal ${a.id===o.goal?"on":""}" data-goal-pick="${a.id}" title="${s(a.plain)}">${s(a.label)}</button>`).join("")}</div>
    ${e?`<p class="muted small">${s(e.plain)}</p>`:""}
    <label class="lbl" for="req">What do you want?</label>
    <textarea id="req" rows="3" placeholder="${s(e?.hint??"")}">${s(o.request)}</textarea>
    ${e?.questions.length?`<div class="muted small hint">Helpful to include: ${e.questions.map(s).join(" \xB7 ")}</div>`:""}
    ${y("prompt-more","More options",`
      <label class="lbl" for="must">Must not change (optional)</label>
      <input id="must" type="text" value="${s(o.mustNotChange)}" placeholder="e.g. the database schema, the login page design">
      <label class="lbl" for="acc">Extra "done when\u2026" criteria, one per line (optional)</label>
      <textarea id="acc" rows="2">${s(o.acceptance)}</textarea>
      <label class="check"><input type="checkbox" id="planFirst" ${o.planFirst?"checked":""}> Ask Claude for a plan before it edits</label>`)}
    <div class="actions"><button class="primary" data-act="build">${i("sparkle")} Build prompt</button></div>
  </section>
  ${$?`
  <section class="built">
    ${$.missingInfo.length?`<div class="note warn">${i("question")} <div><b>Worth adding</b><ul>${$.missingInfo.map(a=>`<li>${s(a)}</li>`).join("")}</ul></div></div>`:""}
    ${$.assumptions.length?`<div class="note">${i("info")} <div><b>Assumptions made</b><ul>${$.assumptions.map(a=>`<li>${s(a)}</li>`).join("")}</ul></div></div>`:""}
    <div class="muted small">Model: ${s($.suggestedModel)} \xB7 ${$.verification.length?`Verifies with: ${$.verification.join(", ")}`:"No check commands found"} \xB7 ${k.length.toLocaleString()} characters</div>
    <label class="lbl" for="ptext">Your prompt (edit freely)</label>
    <textarea id="ptext" class="mono" rows="16">${s(k)}</textarea>
    <div class="actions wrap">
      <button class="primary" data-act="copyPrompt">${i("copy")} Copy</button>
      <button class="secondary" data-act="sendPrompt" ${g?.trusted?"":"disabled"} title="Opens a terminal and starts Claude Code with this prompt">${i("terminal")} Start in Claude Code</button>
      <button class="secondary" data-act="refine" title="${g?.aiProvider==="none"?"Needs an AI provider (optional)":"Uses "+s(g?.aiProvider)}">${i("wand")} Refine with AI</button>
    </div>
    <p class="muted small">"Start in Claude Code" opens a new terminal running <code>claude</code> with this prompt, after you confirm. To use an existing session, copy and paste instead.</p>
  </section>`:""}`}function $e(){let e=d,a=t=>["todo","in_progress","done","dropped"].map(n=>`<option value="${n}" ${t.status===n?"selected":""}>${{todo:"Not started",in_progress:"In progress",done:"Done",dropped:"Dropped"}[n]}</option>`).join("");return`
  <section>
    <h3>Goal</h3>
    <textarea id="goal" rows="2" aria-label="Project goal" placeholder="What are you building, for whom, and what does success look like?">${s(e.notes.goal)}</textarea>
    <div class="actions"><button class="secondary small" data-act="saveNote" data-key="goal" data-src="goal">Save</button></div>
  </section>
  <section>
    <h3>Requirements</h3>
    <p class="muted small">Progress is measured only against these. "Done" counts as verified once tests pass after you mark it.</p>
    ${e.requirements.length?`<ul class="reqs">${e.requirements.map(t=>`<li>
      <div class="req-top"><select data-req-status="${t.id}" aria-label="Status for ${s(t.title)}">${a(t)}</select><span class="req-title">${s(t.title)}</span>${t.status==="done"?f(t.evidence,t.evidenceNote):""}<span class="spacer"></span><button class="icon-btn" data-act="delReq" data-id="${t.id}" aria-label="Delete requirement">${i("trash")}</button></div>
      <div class="muted small">${t.acceptance?`Done when: ${s(t.acceptance)}`:`<span class="warn-text">No acceptance criteria.</span> <a href="#" data-act="editAcc" data-id="${t.id}">Add</a>`}</div>
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
  </section>`}function ve(){let e=d,a=g;return`
  <section>
    <h3>Claude Code</h3>
    <ul class="steps">
      <li>${i(e.integration.claudeInstalled?"pass-filled":"circle-large-outline",e.integration.claudeInstalled?"ok":"muted")} <span>${e.integration.claudeInstalled?`Installed: ${s(e.integration.claudeVersion)}`:e.integration.claudeInstalled===null?"Checking\u2026":"Not found on PATH"}</span></li>
      <li>${i(e.hooks.installed?"pass-filled":"circle-large-outline",e.hooks.installed?"ok":"muted")} <span>${e.hooks.installed?"Connected":e.hooks.settingsError?`Settings file problem: ${s(e.hooks.settingsError)}`:"Not connected"}<div class="muted small mono">${s(e.hooks.settingsPath)}</div></span></li>
      <li>${i(e.statusline.installed?"pass-filled":"circle-large-outline",e.statusline.installed?"ok":"muted")} <span>${e.statusline.installed?`Exact context % on${e.statusline.chainedOriginal?" (your status line is preserved)":""}`:"Exact context % off"} ${e.statusline.installed?'<a href="#" data-act="statuslineOff">remove</a>':'<a href="#" data-act="statuslineOn">turn on</a>'}</span></li>
      <li>${i("database","muted")} <span>${e.integration.spool.accepted} events received this run${e.integration.spool.rejected?`, ${e.integration.spool.rejected} malformed ignored`:""}${e.integration.spool.lastEventAt?` \xB7 last ${v(e.integration.spool.lastEventAt)}`:""}</span></li>
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
    <div class="actions wrap"><button class="secondary" data-act="setWebhook">${i("bell")} ${A?"Change notification URL":"Set up notifications"}</button>${A?'<button class="link" data-act="testWebhook">Send test</button>':""}</div>
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
  </section>`}function V(){document.querySelectorAll("[data-tab]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),o.tab=t.dataset.tab,b(),o.tab==="connect"&&l("hasWebhook").then(c=>{A=c,m()}),m(),document.querySelector(".content")?.scrollTo(0,0)}));let e=[...document.querySelectorAll('[role="tab"]')];e.forEach((t,n)=>t.addEventListener("keydown",c=>{let p=c.key,u=p==="ArrowRight"?(n+1)%e.length:p==="ArrowLeft"?(n-1+e.length)%e.length:p==="Home"?0:p==="End"?e.length-1:-1;u<0||(c.preventDefault(),o.tab=e[u].dataset.tab,b(),m(),document.getElementById(`tab-${o.tab}`)?.focus())})),document.querySelectorAll("details[data-key]").forEach(t=>t.addEventListener("toggle",()=>{o.open[t.dataset.key]=t.open,b()})),document.querySelectorAll("[data-open]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),l("openFile",{path:t.dataset.open})})),document.querySelectorAll("[data-goal-pick]").forEach(t=>t.addEventListener("click",()=>{o.goal=t.dataset.goalPick,b(),m()}));let a=(t,n)=>document.getElementById(t)?.addEventListener("input",c=>{o[n]=c.target.value,b()});a("req","request"),a("must","mustNotChange"),a("acc","acceptance"),document.getElementById("planFirst")?.addEventListener("change",t=>{o.planFirst=t.target.checked,b()}),document.getElementById("ptext")?.addEventListener("input",t=>{k=t.target.value}),document.getElementById("openWithTerminal")?.addEventListener("change",t=>void l("openWithTerminal",{value:t.target.checked})),document.getElementById("apiToggle")?.addEventListener("change",t=>void l("apiToggle",{value:t.target.checked})),document.getElementById("beginner")?.addEventListener("change",t=>void l("setBeginner",{value:t.target.checked})),document.querySelectorAll("[data-req-status]").forEach(t=>t.addEventListener("change",()=>void l("updateRequirement",{id:t.dataset.reqStatus,patch:{status:t.value}}))),document.getElementById("req")?.addEventListener("keydown",t=>{t.key==="Enter"&&(t.metaKey||t.ctrlKey)&&x()}),document.getElementById("newAcc")?.addEventListener("keydown",t=>{t.key==="Enter"&&z()}),document.querySelectorAll("[data-act]").forEach(t=>t.addEventListener("click",n=>{n.preventDefault(),be(t)}))}var C=e=>(document.getElementById(e)?.value??"").trim();async function x(){o.request=C("req")||o.request;let e=await l("buildPrompt",{goal:o.goal,request:o.request,mustNotChange:o.mustNotChange,acceptance:o.acceptance,beginner:N(),planFirst:o.planFirst});$=e,k=e.text,m(),document.getElementById("ptext")?.scrollIntoView?.({block:"nearest"})}async function z(){let e=C("newReq");e&&await l("addRequirement",{title:e,acceptance:C("newAcc")})}async function be(e){let a=e.dataset.act;switch(a){case"build":return x();case"promptFor":return o.tab="prompts",o.goal=e.dataset.goal||"feature",o.request=e.dataset.request||"",b(),o.request?x():($=null,m());case"copyPrompt":return void l("copy",{text:k});case"sendPrompt":return void l("sendToClaude",{text:k});case"refine":{let t=await l("refine",{text:k});t?.text&&(k=t.text,m());return}case"copyHandoff":{let t=await l("handoff");return void l("copy",{text:t})}case"handoffPrompt":return o.tab="prompts",o.goal="handoff",o.request="Continue where the previous session left off.",b(),x();case"runScript":return void l("runScript",{script:e.dataset.script});case"dismiss":return void l("dismiss",{key:e.dataset.key});case"saveNote":return void l("setNote",{key:e.dataset.key,value:C(e.dataset.src)});case"addReq":return z();case"delReq":return void l("deleteRequirement",{id:e.dataset.id});case"editAcc":{let n=e.closest("li")?.querySelector(".req-title")?.textContent??"",c=document.createElement("input");c.type="text",c.placeholder=`Done when\u2026 (for "${n}")`,e.replaceWith(c),c.focus(),c.addEventListener("keydown",p=>{p.key==="Enter"&&c.value.trim()&&l("updateRequirement",{id:e.dataset.id,patch:{acceptance:c.value.trim()}})});return}case"addDec":{let t=C("newDec");t&&await l("addDecision",{title:t,detail:C("newDecD")});return}case"delDec":return void l("deleteDecision",{id:Number(e.dataset.id)});case"cpDiff":return T[e.dataset.sha]=await l("checkpointDiff",{sha:e.dataset.sha}),m();case"rollback":{let t=e.dataset.sha,n=[...document.querySelectorAll(`input.cpf[data-sha="${t}"]:checked`)].map(c=>c.value);return n.length?(await l("rollback",{sha:t,files:n}),T={},m()):void 0}case"shellOn":return void l("shell",{on:!0});case"shellOff":return void l("shell",{on:!1});case"statuslineOn":return void l("statusline",{on:!0});case"statuslineOff":return void l("statusline",{on:!1});case"visualCheck":return void l("visualCheck",{url:C("appUrl")});case"worktree":return void l("worktree",{sessionId:e.dataset.session});case"explainSession":{let t=e.dataset.session,n=await l("explainSession",{sessionId:t});n&&(M[t]=n,m());return}case"demoOn":return void l("demo",{on:!0});case"demoOff":return void l("demo",{on:!1});case"setWebhook":return await l("setWebhook"),A=await l("hasWebhook"),m();default:return void l(a)}}l("goals").then(e=>{R=e??[],m()});q.postMessage({type:"ready"});})();
//# sourceMappingURL=webview.js.map
