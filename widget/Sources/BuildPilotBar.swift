// BuildPilot Bar: a tiny macOS menu-bar companion for BuildPilot.
// It never talks to the network and never changes anything: it runs BuildPilot's own CLI (`cli.js widget`),
// which reads the local database in ~/.buildpilot, and shows the result. Clicking a session brings its terminal tab forward.

import AppKit
import SwiftUI
import UserNotifications

// MARK: - Data (mirrors WidgetData in src/core/glance.ts)

struct WidgetSession: Codable, Identifiable, Equatable {
    let id: String
    let folder: String
    let cwd: String
    let status: String
    let word: String
    let reason: String
    let task: String?
    let contextPct: Double?
    let lastEventAt: Double
    let needsYou: Bool
    let next: String?
    // Newer fields (0.12): all optional so an older engine still decodes.
    let name: String?
    let now: String?
    let waitingFor: String?
    let stopped: Bool?
    let maybeStuck: Bool?
    let risks: [String]?
    let turn: Turn?
    let checklist: Checklist?

    struct Turn: Codable, Equatable { let steps: Int; let files: Int; let proof: String?; let done: Bool }
    struct Checklist: Codable, Equatable { let done: Int; let total: Int; let current: String? }

    var label: String { name ?? folder }
    /// One plain line: what it's doing / waiting for / how far along / whether it's proven.
    var line: String {
        if needsYou { return waitingFor.map { "Waiting for your OK: \($0)" } ?? reason }
        if stopped == true { return "Stopped mid-task" }
        if maybeStuck == true { return "\(now ?? "Quiet"), may be stuck" }
        if let c = checklist, c.total > 1, c.done < c.total { return "Step \(c.done + 1) of \(c.total)\(c.current.map { " · \($0)" } ?? "")" }
        if let t = turn, t.done, t.files > 0 { return t.proof == "verified" ? "Finished · tests passed" : t.proof == "failing" ? "Finished · tests failing" : "Finished · not tested yet" }
        return now ?? task.map { "“\($0)”" } ?? (word.prefix(1).uppercased() + word.dropFirst())
    }
}

struct WidgetData: Codable, Equatable {
    let v: Int
    let generatedAt: Double
    let sessions: [WidgetSession]
    let needs: Int
    let working: Int
    let yourTurn: Int?
    let fiveHourPct: Double?
    let sevenDayPct: Double?
}

struct RunnerConfig: Codable {
    var node: String
    var electronAsNode: Bool?
    var cli: String?
    var extensionId: String?
}

/// The VS Code extension id ("publisher.name"), written by the installer; used for vscode:// links.
let extensionId: String = {
    if let raw = FileManager.default.contents(atPath: "\(bpHome)/widget-config.json"),
       let cfg = try? JSONDecoder().decode(RunnerConfig.self, from: raw), let id = cfg.extensionId, !id.isEmpty { return id }
    return "buildpilot-local.buildpilot"
}()

let home = FileManager.default.homeDirectoryForCurrentUser.path
let bpHome = ProcessInfo.processInfo.environment["BUILDPILOT_HOME"] ?? "\(home)/.buildpilot"

// MARK: - Engine bridge

final class Model: ObservableObject {
    @Published var data: WidgetData?
    @Published var error: String?
    @Published var updatedAt: Date?
    @Published var notify: Bool = UserDefaults.standard.object(forKey: "notify") as? Bool ?? true {
        didSet { UserDefaults.standard.set(notify, forKey: "notify") }
    }
    /// Optional floating panel (off by default). Never takes focus; "keep on top" is its own choice.
    @Published var floating: Bool = UserDefaults.standard.bool(forKey: "floating") {
        didSet { UserDefaults.standard.set(floating, forKey: "floating"); let me = self; DispatchQueue.main.async { MainActor.assumeIsolated { FloatController.shared.update(me) } } }
    }
    @Published var floatOnTop: Bool = UserDefaults.standard.object(forKey: "floatOnTop") as? Bool ?? true {
        didSet { UserDefaults.standard.set(floatOnTop, forKey: "floatOnTop"); let me = self; DispatchQueue.main.async { MainActor.assumeIsolated { FloatController.shared.update(me) } } }
    }
    @Published var floatExpanded: Bool = UserDefaults.standard.bool(forKey: "floatExpanded") {
        didSet { UserDefaults.standard.set(floatExpanded, forKey: "floatExpanded") }
    }
    @Published var startAtLogin: Bool = LoginItem.isOn {
        didSet { if startAtLogin != LoginItem.isOn { startAtLogin ? LoginItem.enable() : LoginItem.disable() } }
    }

    private let queue = DispatchQueue(label: "buildpilot.bar.refresh")
    private var running = false
    private var again = false
    private var watchers: [DispatchSourceFileSystemObject] = []
    private var timer: Timer?
    private var debounce: DispatchWorkItem?
    private var knownNeeds = Set<String>()
    private var firstLoad = true

    init(live: Bool = true) {
        guard live else { return }
        refresh()
        // New hook events land in the spool folder and status-line data in status/: refresh when either changes.
        for dir in ["spool", "status"] { watch("\(bpHome)/\(dir)") }
        // Time-based statuses (e.g. "no activity for 10 min") change without new events.
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.refresh() }
    }

    private func watch(_ path: String) {
        try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
        let fd = open(path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .extend, .rename], queue: .main)
        src.setEventHandler { [weak self] in self?.scheduleRefresh() }
        src.setCancelHandler { close(fd) }
        src.resume()
        watchers.append(src)
    }

    func scheduleRefresh() {
        debounce?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.refresh() }
        debounce = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: w)
    }

    func refresh() {
        queue.async { [weak self] in
            guard let self else { return }
            if self.running { self.again = true; return }
            self.running = true
            let result = Self.runWidget()
            DispatchQueue.main.async {
                switch result {
                case .success(let d):
                    if d != self.data { self.data = d }
                    self.error = nil
                    self.alertIfNeeded(d)
                case .failure(let e):
                    self.error = e.message
                }
                self.updatedAt = Date()
            }
            self.running = false
            if self.again { self.again = false; self.refresh() }
        }
    }

    struct RunError: Error { let message: String }

    static func runner() -> (exe: String, env: [String: String], cli: String)? {
        var env = ProcessInfo.processInfo.environment
        env["NO_COLOR"] = "1"
        let defaultCli = "\(bpHome)/bin/cli.js"
        if let raw = FileManager.default.contents(atPath: "\(bpHome)/widget-config.json"),
           let cfg = try? JSONDecoder().decode(RunnerConfig.self, from: raw),
           FileManager.default.isExecutableFile(atPath: cfg.node) {
            if cfg.electronAsNode == true { env["ELECTRON_RUN_AS_NODE"] = "1" }
            return (cfg.node, env, cfg.cli ?? defaultCli)
        }
        // Apps started from Finder don't get your shell PATH, so look in the usual places.
        for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.local/bin/node", "\(home)/.volta/bin/node"]
        where FileManager.default.isExecutableFile(atPath: p) {
            return (p, env, defaultCli)
        }
        // Last resort: VS Code's own runtime can run Node scripts.
        for app in ["/Applications/Visual Studio Code.app", "\(home)/Applications/Visual Studio Code.app"] {
            let p = "\(app)/Contents/MacOS/Electron"
            if FileManager.default.isExecutableFile(atPath: p) {
                env["ELECTRON_RUN_AS_NODE"] = "1"
                return (p, env, defaultCli)
            }
        }
        return nil
    }

    static func runWidget() -> Result<WidgetData, RunError> {
        guard let r = runner() else { return .failure(RunError(message: "BuildPilot needs Node.js 22.13 or newer. Install it from nodejs.org, then reopen BuildPilot Bar.")) }
        guard FileManager.default.fileExists(atPath: r.cli) else { return .failure(RunError(message: "BuildPilot isn't set up yet. In Claude Code, run /buildpilot:bp-connect (or bp bar install in a terminal).")) }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: r.exe)
        p.arguments = [r.cli, "widget"]
        p.environment = r.env
        p.currentDirectoryURL = URL(fileURLWithPath: home)
        let out = Pipe(), err = Pipe()
        p.standardOutput = out
        p.standardError = err
        do { try p.run() } catch { return .failure(RunError(message: "Couldn't start BuildPilot's engine: \(error.localizedDescription)")) }
        let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 10, execute: killer)
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        killer.cancel()
        guard p.terminationStatus == 0 else {
            let msg = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.split(separator: "\n").last.map(String.init) ?? "exit \(p.terminationStatus)"
            return .failure(RunError(message: "BuildPilot's engine reported a problem: \(msg)"))
        }
        // The CLI may print warnings first; the JSON is the last line.
        let line = String(data: data, encoding: .utf8)?.split(separator: "\n").last.map(String.init) ?? ""
        guard let json = line.data(using: .utf8), let d = try? JSONDecoder().decode(WidgetData.self, from: json) else {
            return .failure(RunError(message: "Unexpected answer from BuildPilot. Update it (claude plugin update buildpilot), then reopen BuildPilot Bar."))
        }
        return .success(d)
    }

    // Notify once when a session starts waiting for you (never on first load, never repeatedly).
    private func alertIfNeeded(_ d: WidgetData) {
        let now = Set(d.sessions.filter(\.needsYou).map(\.id))
        let fresh = now.subtracting(knownNeeds)
        knownNeeds = now
        if firstLoad { firstLoad = false; return }
        guard notify, notificationsAllowed else { return } // never claim an alert we can't actually show
        for s in d.sessions where fresh.contains(s.id) {
            // Same claim file the BuildPilot window and VS Code use, so one moment = one notification.
            guard claimAlert("need:\(s.id):\(String((s.waitingFor ?? s.reason).prefix(80))):\(Int(Date().timeIntervalSince1970 / 3600))") else { continue }
            let c = UNMutableNotificationContent()
            c.title = "Claude \(s.word) in \(s.folder)"
            c.body = s.reason
            c.userInfo = ["cwd": s.cwd, "id": s.id]
            c.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "bp-\(s.id)-\(Int(Date().timeIntervalSince1970))", content: c, trigger: nil))
        }
    }
}

/// Exclusive-create a claim file in ~/.buildpilot/alerts (see src/core/alerts.ts). false = another BuildPilot app already showed it.
func claimAlert(_ key: String) -> Bool {
    let home = ProcessInfo.processInfo.environment["BUILDPILOT_HOME"] ?? (NSHomeDirectory() + "/.buildpilot")
    let dir = home + "/alerts"
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let safe = String(key.replacingOccurrences(of: "approve:", with: "need:").map { ($0.isASCII && ($0.isLetter || $0.isNumber)) || "._-".contains($0) ? $0 : "_" }.prefix(150))
    let fd = open(dir + "/" + safe, O_CREAT | O_EXCL | O_WRONLY, 0o600)
    if fd >= 0 { close(fd); return true }
    return errno != EEXIST
}

// MARK: - Actions

enum Open {
    /// Runs BuildPilot's CLI in the background (no window of its own) and hands back the exit code.
    static func bp(_ args: [String], done: ((Int32) -> Void)? = nil) {
        guard let r = Model.runner(), FileManager.default.fileExists(atPath: r.cli) else { done?(1); return }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: r.exe)
        p.arguments = [r.cli] + args
        p.environment = r.env
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { pr in DispatchQueue.main.async { done?(pr.terminationStatus) } }
        do { try p.run() } catch { done?(1) }
    }

    /// The BuildPilot window (bp ui).
    static func window() { bp(["ui"]) }

    /// Bring this session's terminal tab forward; if it can't be found, open Terminal in its folder.
    static func session(_ folder: String?, id: String? = nil) {
        guard let folder else { window(); return }
        bp(["jump", folder] + (id.map { [$0] } ?? [])) { code in if code == 3 { terminal(folder) } }
    }

    static func terminal(_ folder: String) {
        let cfg = NSWorkspace.OpenConfiguration()
        if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") {
            NSWorkspace.shared.open([URL(fileURLWithPath: folder)], withApplicationAt: app, configuration: cfg)
        }
    }
}

enum LoginItem {
    static let label = "com.buildpilot.bar"
    static var plist: String { "\(home)/Library/LaunchAgents/\(label).plist" }
    static var isOn: Bool { FileManager.default.fileExists(atPath: plist) }

    static func enable() {
        let app = Bundle.main.bundlePath
        let dict: [String: Any] = ["Label": label, "ProgramArguments": ["/usr/bin/open", "-g", "-a", app], "RunAtLoad": true]
        try? FileManager.default.createDirectory(atPath: "\(home)/Library/LaunchAgents", withIntermediateDirectories: true)
        (dict as NSDictionary).write(toFile: plist, atomically: true)
    }

    static func disable() { try? FileManager.default.removeItem(atPath: plist) }
}

func ago(_ ms: Double) -> String {
    let s = max(0, Date().timeIntervalSince1970 - ms / 1000)
    if s < 45 { return "just now" }
    if s < 3600 { return "\(Int((s / 60).rounded())) min ago" }
    return "\(Int((s / 3600).rounded())) h ago"
}

// MARK: - UI

struct StatusDot: View {
    let status: String
    var color: Color {
        switch status {
        case "running": return .green
        case "awaiting_approval", "blocked": return .orange
        case "failed": return .red
        default: return .secondary
        }
    }
    var body: some View {
        Circle().fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
    }
}

struct SessionRow: View {
    let s: WidgetSession
    @State private var hover = false
    var body: some View {
        Button { Open.session(s.cwd, id: s.id) } label: {
            HStack(alignment: .top, spacing: 8) {
                StatusDot(status: s.status).padding(.top, 5)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(s.folder).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Text(s.word.prefix(1).uppercased() + s.word.dropFirst())
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(s.needsYou ? Color.orange : Color.secondary)
                        Spacer(minLength: 4)
                        if let c = s.contextPct {
                            Text("chat \(Int(c.rounded()))% full").font(.system(size: 11)).monospacedDigit()
                                .foregroundStyle(c >= 90 ? Color.red : c >= 70 ? Color.orange : Color.secondary)
                        }
                    }
                    if s.line.lowercased() != s.word.lowercased() {
                        Text(s.line).font(.system(size: 12)).lineLimit(2).foregroundStyle(s.needsYou ? Color.primary : Color.secondary)
                    }
                    if !s.needsYou, let t = s.task, !s.line.contains(t) {
                        Text("“\(t)”").font(.system(size: 11)).italic().lineLimit(1).foregroundStyle(.tertiary)
                    }
                    if let r = s.risks?.first { Text("⚠ \(r)").font(.system(size: 11)).foregroundStyle(.orange).lineLimit(2) }
                    Text(ago(s.lastEventAt)).font(.system(size: 11)).foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 6).padding(.horizontal, 8)
            .background(RoundedRectangle(cornerRadius: 6).fill(hover ? Color.primary.opacity(0.07) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help("Go to \(s.folder)'s terminal")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(s.folder), \(s.word). \(s.needsYou ? s.reason : (s.task ?? ""))\(s.contextPct.map { ". Chat \(Int($0.rounded())) percent full" } ?? ""). \(ago(s.lastEventAt))")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { Open.session(s.cwd, id: s.id) }
        .accessibilityHint("Brings this session's terminal tab forward")
        .contextMenu {
            Button("Go to its terminal") { Open.session(s.cwd, id: s.id) }
            Button("Open BuildPilot") { Open.window() }
            Button("Open in Terminal") { Open.terminal(s.cwd) }
            Button("Copy folder path") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s.cwd, forType: .string) }
        }
    }
}

struct LimitBar: View {
    let label: String
    let pct: Double
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(label).font(.system(size: 11)).foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(pct.rounded()))%").font(.system(size: 11, weight: .medium)).monospacedDigit()
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule().fill(pct >= 95 ? Color.red : pct >= 80 ? Color.orange : Color.accentColor)
                        .frame(width: max(4, g.size.width * CGFloat(min(max(pct, 0), 100) / 100)))
                }
            }
            .frame(height: 5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(Int(pct.rounded())) percent used")
    }
}

var isSnapshot = false
/// Whether macOS lets BuildPilot Bar show notifications (checked at launch and on each refresh).
var notificationsAllowed = false
/// One model for the menu-bar panel and the floating panel.
let sharedModel = isRenderRun ? Model(live: false) : Model()
var isRenderRun: Bool { CommandLine.arguments.contains("--render") || CommandLine.arguments.contains("--render-float") }

struct Panel: View {
    @ObservedObject var m: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("BuildPilot").font(.system(size: 14, weight: .bold))
                Text(summary).font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer()
                if isSnapshot { Image(systemName: "arrow.clockwise").foregroundStyle(.secondary) } else {
                    Button { m.refresh() } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless).help("Refresh").accessibilityLabel(Text("Refresh"))
                }
            }

            if let e = m.error, m.data == nil {
                Label(e, systemImage: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let d = m.data {
                if d.sessions.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("No active Claude Code sessions").font(.system(size: 12, weight: .medium))
                        Text("Run `claude` in a project. It shows up here on its first action.").font(.system(size: 11)).foregroundStyle(.secondary)
                    }.padding(.vertical, 4)
                } else {
                    let needs = d.sessions.filter(\.needsYou)
                    let rest = d.sessions.filter { !$0.needsYou }
                    let list = VStack(alignment: .leading, spacing: 2) {
                            if !needs.isEmpty {
                                section("Needs you")
                                ForEach(needs) { SessionRow(s: $0) }
                            }
                            if !rest.isEmpty {
                                section(needs.isEmpty ? "Sessions" : "Others")
                                ForEach(rest) { SessionRow(s: $0) }
                            }
                        }
                    if d.sessions.count > 6 && !isSnapshot { ScrollView { list }.frame(maxHeight: 420) } else { list }
                }
                if d.fiveHourPct != nil || d.sevenDayPct != nil {
                    Divider()
                    VStack(spacing: 6) {
                        if let p = d.fiveHourPct { LimitBar(label: "5-hour limit", pct: p) }
                        if let p = d.sevenDayPct { LimitBar(label: "Weekly limit", pct: p) }
                    }
                }
                if let e = m.error {
                    Text(e).font(.system(size: 11)).foregroundStyle(.orange).lineLimit(2)
                }
            } else {
                HStack { ProgressView().controlSize(.small); Text("Loading…").font(.system(size: 12)) }
            }

            Divider()
            HStack(spacing: 10) {
                Button("Open BuildPilot") { Open.window() }.keyboardShortcut("o")
                    .accessibilityLabel(Text("Open the BuildPilot window"))
                Spacer()
                if isSnapshot { Image(systemName: "gearshape").foregroundStyle(.secondary) } else { Menu {
                    Toggle("Notify me when Claude needs me", isOn: $m.notify)
                    Toggle("Floating panel", isOn: $m.floating)
                    Toggle("Keep floating panel on top", isOn: $m.floatOnTop).disabled(!m.floating)
                    Toggle("Start at login", isOn: $m.startAtLogin)
                    Divider()
                    Button("Quit BuildPilot Bar") { NSApp.terminate(nil) }
                } label: { Image(systemName: "gearshape") }
                    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("Settings") }
            }
            .font(.system(size: 12))
        }
        .padding(12)
        .frame(width: 360)
    }

    var summary: String {
        guard let d = m.data else { return "" }
        if d.sessions.isEmpty { return "no sessions" }
        return headline(d)
    }

    func section(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
            .padding(.horizontal, 8).padding(.top, 4)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel(Text(t))
    }
}

// MARK: - Floating panel

/// Same counts and words as the window and terminal: needs you · your turn · working.
func headline(_ d: WidgetData) -> String {
    var parts: [String] = []
    if d.needs > 0 { parts.append("\(d.needs) need\(d.needs == 1 ? "s" : "") you") }
    if let t = d.yourTurn, t > 0 { parts.append("\(t) your turn") }
    if d.working > 0 { parts.append("\(d.working) working") }
    return parts.isEmpty ? "all quiet" : parts.joined(separator: " · ")
}

/// Compact: the one session that matters most, in one line, plus its next step. Expanded: every session.
struct FloatView: View {
    @ObservedObject var m: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("BuildPilot").font(.system(size: 12, weight: .bold))
                if let d = m.data {
                    Text(headline(d)).accessibilityLabel(Text("BuildPilot: \(headline(d))"))
                        .font(.system(size: 11)).foregroundStyle(d.needs > 0 ? Color.orange : Color.secondary)
                }
                Spacer()
                if !isSnapshot {
                    Button { m.floatExpanded.toggle() } label: { Image(systemName: m.floatExpanded ? "rectangle.compress.vertical" : "rectangle.expand.vertical") }
                        .buttonStyle(.borderless).help(m.floatExpanded ? "Compact" : "Show every session")
                        .accessibilityLabel(Text(m.floatExpanded ? "Compact view" : "Expanded view"))
                    Button { Open.window() } label: { Image(systemName: "macwindow") }
                        .buttonStyle(.borderless).help("Open the BuildPilot window").accessibilityLabel(Text("Open the BuildPilot window"))
                }
            }
            if let d = m.data {
                if d.sessions.isEmpty {
                    Text("No Claude sessions running").font(.system(size: 12)).foregroundStyle(.secondary)
                } else if m.floatExpanded {
                    let rows = VStack(alignment: .leading, spacing: 6) { ForEach(d.sessions) { FloatRow(s: $0) } }
                    if d.sessions.count > 6 && !isSnapshot { ScrollView { rows } } else { rows }
                } else if let top = d.sessions.first(where: \.needsYou) ?? d.sessions.first(where: { $0.stopped == true || $0.maybeStuck == true || !($0.risks ?? []).isEmpty }) ?? d.sessions.first {
                    FloatRow(s: top)
                    if let n = top.next, !top.needsYou { Text("Next: \(n)").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2) }
                    if d.sessions.count > 1 && !isSnapshot {
                        Button("+\(d.sessions.count - 1) more") { m.floatExpanded = true }.buttonStyle(.borderless).font(.system(size: 11))
                            .help("Show every session")
                    }
                }
            } else if let e = m.error {
                Text(e).font(.system(size: 11)).foregroundStyle(.orange).lineLimit(3)
            }
        }
        .padding(12)
        .frame(minWidth: 260, idealWidth: 300, maxWidth: .infinity, minHeight: 60, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("BuildPilot floating panel"))
    }
}

struct FloatRow: View {
    let s: WidgetSession
    var body: some View {
        Button { Open.session(s.cwd, id: s.id) } label: {
            HStack(alignment: .top, spacing: 7) {
                StatusDot(status: s.stopped == true ? "failed" : s.status).padding(.top, 5)
                VStack(alignment: .leading, spacing: 1) {
                    HStack {
                        Text(s.label).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                        Spacer(minLength: 4)
                        if let c = s.contextPct {
                            Text("chat \(Int(c.rounded()))% full").font(.system(size: 11)).monospacedDigit()
                                .foregroundStyle(c >= 90 ? Color.red : c >= 70 ? Color.orange : Color.secondary)
                        }
                    }
                    Text(s.line).font(.system(size: 11)).foregroundStyle(s.needsYou ? Color.primary : Color.secondary).lineLimit(2)
                    if let r = s.risks?.first { Text("⚠ \(r)").font(.system(size: 11)).foregroundStyle(.orange).lineLimit(2) }
                }
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Go to \(s.label)'s terminal")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(s.label). \(s.line)")
        .accessibilityAddTraits(.isButton)
    }
}

/// A non-activating panel: it never takes keyboard focus or steals the frontmost app, so typing elsewhere is never
/// interrupted. Movable, resizable, remembers its place, joins every Space. Shown only when the user turns it on.
@MainActor final class FloatController {
    static let shared = FloatController()
    private var panel: NSPanel?

    func update(_ m: Model) {
        guard m.floating else { panel?.orderOut(nil); return }
        if panel == nil {
            let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 120),
                            styleMask: [.nonactivatingPanel, .titled, .closable, .resizable, .utilityWindow, .fullSizeContentView],
                            backing: .buffered, defer: true)
            p.titleVisibility = .hidden
            p.titlebarAppearsTransparent = true
            p.isMovableByWindowBackground = true
            p.hidesOnDeactivate = false
            p.becomesKeyOnlyIfNeeded = true
            p.isReleasedWhenClosed = false
            p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            p.contentView = NSHostingView(rootView: FloatView(m: m))
            p.setFrameAutosaveName("BuildPilotFloatingPanel")
            if !p.setFrameUsingName("BuildPilotFloatingPanel"), let screen = NSScreen.main {
                let v = screen.visibleFrame
                p.setFrameOrigin(NSPoint(x: v.maxX - 320, y: v.maxY - 160))
            }
            NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: p, queue: .main) { _ in
                MainActor.assumeIsolated { if m.floating { m.floating = false } }
            }
            panel = p
        }
        panel!.level = m.floatOnTop ? .floating : .normal
        panel!.orderFrontRegardless() // shows without activating BuildPilot Bar
    }
}

struct BarLabel: View {
    @ObservedObject var m: Model
    var body: some View {
        let needs = m.data?.needs ?? 0
        let working = m.data?.working ?? 0
        HStack(spacing: 3) {
            // BuildPilot's mark is a gauge; Safari's compass was confusing next to the real Safari.
            Image(systemName: needs > 0 ? "exclamationmark.circle.fill" : working > 0 ? "gauge.with.dots.needle.67percent" : "gauge.with.dots.needle.33percent")
            if needs > 0 { Text("\(needs)") } else if working > 0 { Text("\(working)") }
        }
        .accessibilityLabel(needs > 0 ? "BuildPilot: \(needs) need\(needs == 1 ? "s" : "") you, \(working) working" : "BuildPilot: \(working) working")
    }
}

/// `BuildPilot Bar --render out.png [light|dark]`: draws the panel with live data to a PNG and exits (for tests and docs).
@MainActor func renderSnapshot(to path: String, dark: Bool, float: Bool = false, expanded: Bool = false) {
    isSnapshot = true
    let m = Model(live: false)
    switch Model.runWidget() {
    case .success(let d): m.data = d
    case .failure(let e): m.error = e.message
    }
    m.floatExpanded = expanded
    let view = Group { if float { AnyView(FloatView(m: m).frame(width: 300)) } else { AnyView(Panel(m: m)) } }
        .background(dark ? Color(white: 0.16) : Color(white: 0.96))
        .environment(\.colorScheme, dark ? .dark : .light)
    let r = ImageRenderer(content: view)
    r.scale = 2
    if let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
        print("wrote \(path)")
    } else {
        print("render failed")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ n: Notification) {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--render-float"), i + 1 < args.count {
            renderSnapshot(to: args[i + 1], dark: args.contains("dark"), float: true, expanded: args.contains("expanded"))
            exit(0)
        }
        if let i = args.firstIndex(of: "--render"), i + 1 < args.count {
            renderSnapshot(to: args[i + 1], dark: args.contains("dark"))
            exit(0)
        }
        if UserDefaults.standard.bool(forKey: "floating") { DispatchQueue.main.async { MainActor.assumeIsolated { FloatController.shared.update(sharedModel) } } }
        let c = UNUserNotificationCenter.current()
        c.delegate = self
        c.requestAuthorization(options: [.alert, .sound]) { ok, _ in DispatchQueue.main.async { notificationsAllowed = ok } }
        c.getNotificationSettings { st in DispatchQueue.main.async { notificationsAllowed = st.authorizationStatus == .authorized || st.authorizationStatus == .provisional } }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        Open.session(info["cwd"] as? String, id: info["id"] as? String)
        done()
    }
}

@main
struct BuildPilotBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @ObservedObject private var model = sharedModel
    var body: some Scene {
        MenuBarExtra {
            Panel(m: model)
        } label: {
            BarLabel(m: model)
        }
        .menuBarExtraStyle(.window)
    }
}
