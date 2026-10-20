// Интерфейс GhostVPN (macOS / iOS).

import SwiftUI
import GhostVPNKit

struct ContentView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.02, green: 0.03, blue: 0.06),
                                    Color(red: 0.05, green: 0.04, blue: 0.12),
                                    Color(red: 0.02, green: 0.06, blue: 0.09)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    header
                    subscriptionCard
                    serversCard
                    connectionCard
                    logCard
                }
                .padding(20)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("👻")
                .font(.system(size: 30))
                .frame(width: 46, height: 46)
                .background(
                    LinearGradient(colors: [Color(red: 0.49, green: 0.36, blue: 1.0),
                                            Color(red: 0.13, green: 0.83, blue: 0.93)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 14)
                )
            VStack(alignment: .leading, spacing: 2) {
                Text("GhostVPN").font(.system(size: 20, weight: .bold))
                Text(model.statusText).font(.system(size: 12)).foregroundStyle(.secondary)
            }
            Spacer()
            Circle()
                .fill(model.isConnected ? Color.green : Color.red)
                .frame(width: 9, height: 9)
            Text(model.isConnected ? "Подключено" : "Отключено")
                .font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(.white)
    }

    private var subscriptionCard: some View {
        card {
            VStack(alignment: .leading, spacing: 10) {
                Text("Подписка").font(.headline)
                Text("Вставьте ссылку подписки из личного кабинета или ключ vless://")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                HStack {
                    TextField("https://vpn.example.com/sub/...", text: $model.subscriptionURL)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(Color(red: 0.04, green: 0.05, blue: 0.10), in: RoundedRectangle(cornerRadius: 10))
                        .foregroundStyle(.white)
                    Button("Загрузить") { Task { await model.loadSubscription() } }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0.49, green: 0.36, blue: 1.0))
                }
                if !model.profiles.isEmpty {
                    Text("Серверов: \(model.profiles.count)").font(.system(size: 12))
                        .foregroundStyle(Color(red: 0.13, green: 0.83, blue: 0.93))
                }
            }
        }
    }

    private var serversCard: some View {
        card {
            VStack(alignment: .leading, spacing: 10) {
                Text("Серверы").font(.headline)
                if model.profiles.isEmpty {
                    Text("Подписка не загружена").font(.system(size: 12)).foregroundStyle(.secondary)
                } else {
                    ForEach(model.profiles) { profile in
                        Button {
                            model.selectedProfileID = profile.id.uuidString
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(profile.name).font(.system(size: 14, weight: .semibold))
                                    Text("\(profile.endpoint) · \(profile.security)")
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if model.selectedProfileID == profile.id.uuidString {
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                                }
                            }
                            .padding(10)
                            .background(Color(red: 0.05, green: 0.06, blue: 0.13), in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var connectionCard: some View {
        card {
            VStack(spacing: 14) {
                HStack {
                    VStack(alignment: .leading) {
                        Text("Внешний IP").font(.system(size: 12)).foregroundStyle(.secondary)
                        Text(model.externalIP).font(.system(size: 17, weight: .bold, design: .monospaced))
                    }
                    Spacer()
                }
                Toggle("Системный прокси (SOCKS/HTTP)", isOn: $model.setSystemProxy)
                    .font(.system(size: 12))
                    .tint(Color(red: 0.49, green: 0.36, blue: 1.0))
                Button {
                    Task {
                        if model.isConnected { model.disconnect() } else { await model.connect() }
                    }
                } label: {
                    Text(model.isConnected ? "Отключиться" : "Подключиться")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            LinearGradient(colors: [Color(red: 0.49, green: 0.36, blue: 1.0),
                                                    Color(red: 0.13, green: 0.83, blue: 0.93)],
                                           startPoint: .leading, endPoint: .trailing),
                            in: RoundedRectangle(cornerRadius: 12)
                        )
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var logCard: some View {
        card {
            VStack(alignment: .leading, spacing: 8) {
                Text("Журнал").font(.headline)
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(Array(model.log.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(height: 140)
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.12)))
    }
}
