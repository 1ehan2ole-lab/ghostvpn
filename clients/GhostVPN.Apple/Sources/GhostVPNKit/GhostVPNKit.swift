// GhostVPN Core для Apple-платформ.
// Общая логика: разбор подписки, сборка конфигурации sing-box, запуск ядра.

import Foundation

// MARK: - Профиль сервера

public struct VpnProfile: Identifiable, Hashable {
    public var id = UUID()
    public var name: String = "GhostVPN"
    public var address: String = ""
    public var port: Int = 443
    public var uuid: String = ""
    public var flow: String = "xtls-rprx-vision"
    public var security: String = "reality"
    public var sni: String = ""
    public var publicKey: String = ""
    public var shortId: String = ""
    public var fingerprint: String = "chrome"
    public var network: String = "tcp"
    public var rawLink: String?

    public var endpoint: String { "\(address):\(port)" }
    public var isReality: Bool { security.lowercased() == "reality" }
}

// MARK: - Разбор подписки

public enum SubscriptionParser {

    public static func parse(_ input: String) -> [VpnProfile] {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [] }

        if text.hasPrefix("vless://") || text.hasPrefix("vmess://") || text.hasPrefix("trojan://") {
            if let profile = parseLink(text) { return [profile] }
            return []
        }
        if text.hasPrefix("{") { return parseSingBox(text) }
        if text.contains("proxies:") { return parseClash(text) }
        return parseV2Ray(text)
    }

    /// base64-подписка v2ray.
    public static func parseV2Ray(_ base64: String) -> [VpnProfile] {
        var text = base64.trimmingCharacters(in: .whitespacesAndNewlines)
        if let decoded = decodeBase64(text), decoded.contains("://") {
            text = decoded
        }
        return text.split(separator: "\n").compactMap { line in
            let value = line.trimmingCharacters(in: .whitespaces)
            return value.hasPrefix("vless://") ? parseLink(value) : nil
        }
    }

    /// Одиночная ссылка vless://.
    public static func parseLink(_ link: String) -> VpnProfile? {
        guard let components = URLComponents(string: link),
              let host = components.host else { return nil }

        var profile = VpnProfile()
        profile.address = host
        profile.port = components.port ?? 443
        profile.uuid = components.user?.removingPercentEncoding ?? ""
        profile.rawLink = link

        let name = components.fragment?.removingPercentEncoding ?? ""
        profile.name = name.isEmpty ? host : name

        for item in components.queryItems ?? [] {
            switch item.name.lowercased() {
            case "security": profile.security = item.value ?? ""
            case "sni", "host": profile.sni = item.value ?? ""
            case "pbk": profile.publicKey = item.value ?? ""
            case "sid": profile.shortId = item.value ?? ""
            case "fp": profile.fingerprint = item.value ?? "chrome"
            case "type": profile.network = item.value ?? "tcp"
            case "flow": profile.flow = item.value ?? ""
            default: break
            }
        }
        return profile
    }

    /// Конфигурация sing-box (outbounds типа vless).
    public static func parseSingBox(_ json: String) -> [VpnProfile] {
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outbounds = root["outbounds"] as? [[String: Any]] else { return [] }

        var result: [VpnProfile] = []
        for outbound in outbounds {
            guard (outbound["type"] as? String) == "vless" else { continue }
            var profile = VpnProfile()
            profile.name = outbound["tag"] as? String ?? "GhostVPN"
            profile.address = outbound["server"] as? String ?? ""
            profile.port = outbound["server_port"] as? Int ?? 443
            profile.uuid = outbound["uuid"] as? String ?? ""
            profile.flow = outbound["flow"] as? String ?? ""

            if let tls = outbound["tls"] as? [String: Any] {
                profile.sni = tls["server_name"] as? String ?? ""
                if let utls = tls["utls"] as? [String: Any] {
                    profile.fingerprint = utls["fingerprint"] as? String ?? "chrome"
                }
                if let reality = tls["reality"] as? [String: Any] {
                    profile.security = "reality"
                    profile.publicKey = reality["public_key"] as? String ?? ""
                    profile.shortId = reality["short_id"] as? String ?? ""
                }
            }
            result.append(profile)
        }
        return result
    }

    /// Clash / Mihomo (минимальный разбор секции proxies).
    public static func parseClash(_ yaml: String) -> [VpnProfile] {
        var result: [VpnProfile] = []
        var current: [String: String] = [:]
        var inProxies = false

        func flush() {
            defer { current.removeAll() }
            guard (current["type"]?.lowercased()) == "vless" else { return }
            var profile = VpnProfile()
            profile.name = current["name"] ?? "GhostVPN"
            profile.address = current["server"] ?? ""
            profile.port = Int(current["port"] ?? "443") ?? 443
            profile.uuid = current["uuid"] ?? ""
            profile.sni = current["servername"] ?? ""
            profile.fingerprint = current["client-fingerprint"] ?? "chrome"
            profile.flow = current["flow"] ?? ""
            profile.security = "reality"
            if let opts = current["reality-opts"] {
                for pair in opts.split(separator: "|") {
                    let kv = pair.split(separator: "=", maxSplits: 1)
                    guard kv.count == 2 else { continue }
                    if kv[0] == "public-key" { profile.publicKey = String(kv[1]) }
                    if kv[0] == "short-id" { profile.shortId = String(kv[1]) }
                }
            }
            result.append(profile)
        }

        for rawLine in yaml.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if !rawLine.hasPrefix(" ") && !rawLine.hasPrefix("-") {
                flush()
                inProxies = line.hasPrefix("proxies:")
                continue
            }
            guard inProxies else { continue }
            var value = line
            if value.hasPrefix("- ") { value = String(value.dropFirst(2)) }
            guard let idx = value.firstIndex(of: ":") else { continue }
            let key = String(value[value.startIndex..<idx]).trimmingCharacters(in: .whitespaces)
            var val = String(value[value.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
            if val.hasPrefix("{") && val.hasSuffix("}") {
                let inner = val.dropFirst().dropLast()
                var map: [String: String] = [:]
                for part in inner.split(separator: ",") {
                    let kv = part.split(separator: "=", maxSplits: 1)
                    if kv.count == 2 { map[String(kv[0]).trimmingCharacters(in: .whitespaces)] = String(kv[1]).trimmingCharacters(in: .whitespaces) }
                }
                val = map.map { "\($0.key)=\($0.value)" }.joined(separator: "|")
            } else {
                val = val.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            }
            current[key] = val
        }
        flush()
        return result
    }

    private static func decodeBase64(_ value: String) -> String? {
        var normalized = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        normalized = normalized.replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\r", with: "")
        while normalized.count % 4 != 0 { normalized.append("=") }
        guard let data = Data(base64Encoded: normalized) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Конфигурация sing-box

public enum SingBoxConfigBuilder {

    public struct Options {
        public var mixedPort: Int = 2080
        public var enableTun: Bool = false
        public var tunName: String = "ghostvpn0"
        public var logLevel: String = "info"
        public var dnsServer: String = "1.1.1.1"
        public init() {}
    }

    public static func build(_ profile: VpnProfile, options: Options = Options()) -> String {
        var outbound: [String: Any] = [
            "type": "vless",
            "tag": "proxy",
            "server": profile.address,
            "server_port": profile.port,
            "uuid": profile.uuid,
        ]
        if !profile.flow.isEmpty { outbound["flow"] = profile.flow }

        var tls: [String: Any] = [
            "enabled": true,
            "server_name": profile.sni,
            "utls": ["enabled": true, "fingerprint": profile.fingerprint],
        ]
        if profile.isReality {
            tls["reality"] = [
                "enabled": true,
                "public_key": profile.publicKey,
                "short_id": profile.shortId,
            ]
        }
        outbound["tls"] = tls

        var inbounds: [[String: Any]] = [[
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": options.mixedPort,
        ]]

        if options.enableTun {
            inbounds.append([
                "type": "tun",
                "tag": "tun-in",
                "interface_name": options.tunName,
                "address": ["172.19.0.1/30", "fdfe:cafe::1/126"],
                "mtu": 9000,
                "auto_route": true,
                "strict_route": true,
                "stack": "system",
            ])
        }

        let config: [String: Any] = [
            "log": ["level": options.logLevel, "timestamp": true],
            "dns": [
                "servers": [
                    ["tag": "dns-remote", "type": "udp", "server": options.dnsServer],
                    ["tag": "dns-local", "type": "udp", "server": "8.8.8.8"],
                ],
                "final": "dns-remote",
                "strategy": "prefer_ipv4",
            ],
            "inbounds": inbounds,
            "outbounds": [outbound,
                          ["type": "direct", "tag": "direct"],
                          ["type": "block", "tag": "block"]],
            "route": [
                "rules": [["action": "sniff"],
                          ["protocol": "dns", "action": "hijack-dns"]],
                "final": "proxy",
                "auto_detect_interface": true,
                "default_domain_resolver": "dns-local",
            ],
            "experimental": [
                "clash_api": ["external_controller": "127.0.0.1:9090"],
            ],
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]) else {
            return "{}"
        }
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

// MARK: - Ядро sing-box

public final class SingBoxRunner {

    public static let version = "1.14.3"

    public var binaryPath: String {
        let name = "sing-box"
        return URL(fileURLWithPath: Bundle.main.bundlePath)
            .appendingPathComponent("core")
            .appendingPathComponent(name)
            .path
    }

    public var isCorePresent: Bool { FileManager.default.fileExists(atPath: binaryPath) }

    private var process: Process?

    public init() {}

    /// Скачивание ядра для текущей платформы.
    public static func downloadCore(progress: ((String) -> Void)? = nil) async throws {
        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "amd64"
        #endif
        let archive = "sing-box-\(version)-darwin-\(arch).tar.gz"
        let url = URL(string: "https://github.com/SagerNet/sing-box/releases/download/v\(version)/\(archive)")!

        progress?("Скачивание \(archive)...")
        let (data, _) = try await URLSession.shared.data(from: url)
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(archive)
        try data.write(to: tmp)

        let target = URL(fileURLWithPath: Bundle.main.bundlePath).appendingPathComponent("core")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/tar")
        process.arguments = ["-xf", tmp.path, "-C", target.path]
        try process.run()
        process.waitUntilExit()

        try? FileManager.default.removeItem(at: tmp)

        let binary = target.appendingPathComponent("sing-box")
        if FileManager.default.fileExists(atPath: binary.path) {
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: binary.path)
        }
        progress?("Ядро готово")
    }

    public func start(configJSON: String) throws {
        stop()

        let coreDir = URL(fileURLWithPath: Bundle.main.bundlePath).appendingPathComponent("core")
        try FileManager.default.createDirectory(at: coreDir, withIntermediateDirectories: true)
        let configURL = coreDir.appendingPathComponent("config.json")
        try Data(configJSON.utf8).write(to: configURL)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: binaryPath)
        process.arguments = ["run", "--config", configURL.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        self.process = process
    }

    public func stop() {
        process?.terminate()
        process = nil
    }

    public var isRunning: Bool { process?.isRunning == true }
}
