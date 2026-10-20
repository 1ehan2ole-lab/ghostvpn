// GhostVPN — приложение для macOS и iOS.
// macOS: запускает ядро sing-box и управляет системным прокси.
// iOS: управляет подпиской и ключом (туннель — через сетевое расширение).

import SwiftUI
import GhostVPNKit

@main
struct GhostVPNApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
        }
    }
}

@MainActor
final class AppModel: ObservableObject {

    @Published var subscriptionURL: String = ""
    @Published var profiles: [VpnProfile] = []
    @Published var selectedProfileID: String?
    @Published var isConnected = false
    @Published var statusText = "Не подключено"
    @Published var externalIP = "—"
    @Published var log: [String] = []
    @Published var setSystemProxy = true

    private let runner = SingBoxRunner()
    private var trafficTask: Task<Void, Never>?

    var selectedProfile: VpnProfile? {
        profiles.first { $0.id.uuidString == selectedProfileID } ?? profiles.first
    }

    init() {
        loadSettings()
    }

    // MARK: - Подписка

    func loadSubscription() async {
        let url = subscriptionURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !url.isEmpty else {
            append("Укажите ссылку на подписку")
            return
        }
        append("Загрузка подписки...")
        do {
            var request = URLRequest(url: URL(string: url) ?? URL(string: "https://invalid.local")!)
            request.setValue("GhostVPN/1.0 (Apple)", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode ?? 500 < 400 else {
                append("Сервер подписки вернул ошибку")
                return
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            let parsed = SubscriptionParser.parse(text)
            guard !parsed.isEmpty else {
                append("Серверы не найдены")
                return
            }
            profiles = parsed
            selectedProfileID = parsed.first?.id.uuidString
            append("Загружено серверов: \(parsed.count)")
            saveSettings()
        } catch {
            append("Ошибка загрузки: \(error.localizedDescription)")
        }
    }

    // MARK: - Подключение

    func connect() async {
        guard let profile = selectedProfile else {
            append("Сначала выберите сервер")
            return
        }
        #if os(macOS)
        guard runner.isCorePresent else {
            append("Ядро sing-box не найдено")
            return
        }
        let config = SingBoxConfigBuilder.build(profile)
        do {
            try runner.start(configJSON: config)
            try await Task.sleep(nanoseconds: 1_200_000_000)
            guard runner.isRunning else {
                append("Ядро sing-box завершилось с ошибкой")
                return
            }
            if setSystemProxy {
                SystemProxy.enable(port: 2080)
            }
            isConnected = true
            statusText = "Подключено"
            append("Подключено к \(profile.name) (\(profile.endpoint))")
            startTrafficPolling()
        } catch {
            append("Ошибка подключения: \(error.localizedDescription)")
        }
        #else
        append("На iOS используйте сетевое расширение GhostVPN")
        #endif
    }

    func disconnect() {
        #if os(macOS)
        runner.stop()
        if setSystemProxy { SystemProxy.disable() }
        #endif
        trafficTask?.cancel()
        trafficTask = nil
        isConnected = false
        statusText = "Не подключено"
        externalIP = "—"
        append("Отключено")
    }

    private func startTrafficPolling() {
        trafficTask?.cancel()
        trafficTask = Task {
            while !Task.isCancelled {
                await refreshStatus()
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func refreshStatus() async {
        #if os(macOS)
        let proxy = URLSessionConfiguration.default
        if let port = runnerPort {
            proxy.connectionProxyDictionary = [
                kCFNetworkProxiesHTTPEnable as String: true,
                kCFNetworkProxiesHTTPPort as String: port,
                kCFNetworkProxiesHTTPProxy as String: "127.0.0.1",
            ]
        }
        let session = URLSession(configuration: proxy)
        if let text = try? await session.string(from: URL(string: "https://api.ipify.org")!) {
            await MainActor.run { self.externalIP = text.trimmingCharacters(in: .whitespacesAndNewlines) }
        }
        #endif
    }

    private var runnerPort: Int? { 2080 }

    // MARK: - Настройки

    private var settingsPath: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent("ghostvpn-settings.json")
    }

    private struct Stored: Codable {
        var subscriptionURL: String
        var selectedProfileID: String?
        var setSystemProxy: Bool
    }

    private func loadSettings() {
        guard let data = try? Data(contentsOf: settingsPath),
              let stored = try? JSONDecoder().decode(Stored.self, from: data) else { return }
        subscriptionURL = stored.subscriptionURL
        selectedProfileID = stored.selectedProfileID
        setSystemProxy = stored.setSystemProxy
    }

    private func saveSettings() {
        let stored = Stored(subscriptionURL: subscriptionURL,
                            selectedProfileID: selectedProfileID,
                            setSystemProxy: setSystemProxy)
        guard let data = try? JSONEncoder().encode(stored) else { return }
        try? FileManager.default.createDirectory(at: settingsPath.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        try? data.write(to: settingsPath)
    }

    func append(_ line: String) {
        let stamp = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
        log.insert("\(stamp)  \(line)", at: 0)
        if log.count > 300 { log.removeLast() }
    }
}

// MARK: - Системный прокси (macOS)

enum SystemProxy {
    static func enable(port: Int) {
        for service in services() {
            run("/usr/sbin/networksetup", ["-setwebproxy", service, "127.0.0.1", "\(port)"])
            run("/usr/sbin/networksetup", ["-setsecurewebproxy", service, "127.0.0.1", "\(port)"])
            run("/usr/sbin/networksetup", ["-setsocksfirewallproxy", service, "127.0.0.1", "\(port)"])
        }
    }

    static func disable() {
        for service in services() {
            run("/usr/sbin/networksetup", ["-setwebproxystate", service, "off"])
            run("/usr/sbin/networksetup", ["-setsecurewebproxystate", service, "off"])
            run("/usr/sbin/networksetup", ["-setsocksfirewallproxystate", service, "off"])
        }
    }

    private static func services() -> [String] {
        let output = run("/usr/sbin/networksetup", ["-listallnetworkservices"])
        return output.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("*") }
    }

    @discardableResult
    private static func run(_ path: String, _ args: [String]) -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }
}
