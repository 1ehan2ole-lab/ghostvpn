# 👻 Клиенты GhostVPN

Свои клиенты для всех платформ. Общее ядро — [sing-box](https://github.com/SagerNet/sing-box)
(VLESS + REALITY), общий протокол подписки — тот же, что у панели.

| Платформа | Стек | Что умеет | Сборка |
|---|---|---|---|
| **Windows** | C# / WPF / .NET 10 | Подписка, список серверов, подключение, системный прокси, TUN, счётчик трафика, журнал | `clients/GhostVPN.Windows` → `.exe` (проверено, работает) |
| **macOS** | Swift / SwiftUI | Подписка, серверы, подключение, системный прокси, журнал | `clients/GhostVPN.Apple` → `.app` / `.dmg` (CI: macos-14) |
| **iOS** | Swift / SwiftUI | То же UI; туннель — через сетевое расширение | `clients/GhostVPN.Apple` → `.ipa` (CI: macos-14) |
| **Android** | Kotlin / Jetpack Compose | Подписка, серверы, VpnService-туннель, QR | `clients/GhostVPN.Android` → `.apk` (CI: ubuntu) |
| **Linux / сервер** | C# / .NET 10 | Консольный клиент: конфиг sing-box, проверка, headless-режим | `clients/GhostVPN.Cli` → `ghostvpn` |

## Общая архитектура

```
                 ┌──────────────────────────┐
  Подписка  ───▶ │  Разбор подписки         │  v2ray (base64) · vless:// · Clash · sing-box
  (панель)       │  Сборка конфига sing-box │  mixed-инбаунд + VLESS/REALITY-аутбаунд
                 │  Управление ядром        │  sing-box + системный прокси / TUN
                 └──────────────────────────┘
```

## Windows (готов и проверен)

```bash
cd clients/GhostVPN.Windows
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true -o ../dist/windows
# ядро sing-box кладём рядом:
#   dist/windows/core/sing-box.exe
```

Готовый сборщик: `.github/workflows/client-windows.yml` (артефакт `ghostvpn-windows`).

Особенности:
- ядро sing-box скачивается самим клиентом (кнопка «Скачать ядро sing-box»), либо кладётся в `core/`;
- системный прокси (SOCKS5 + HTTP) на `127.0.0.1:2080`, снимается при выходе;
- TUN-режим — весь трафик (нужны права администратора);
- счётчик трафика — через локальный clash-api sing-box (`127.0.0.1:9090/traffic`);
- конфигурация пишется без BOM (sing-box не принимает JSON с меткой порядка байтов).

## macOS / iOS

```bash
cd clients/GhostVPN.Apple
swift build -c release
```

macOS-приложение запускает ядро `sing-box` из `GhostVPN.app/Contents/Resources/core/`
и управляет системным прокси через `networksetup`.
Сборка `.dmg` — в `.github/workflows/client-macos.yml`.

Для iOS: UI и ядро общие; туннель реализуется сетевым расширением
(Network Extension / PacketTunnel). Workflow `client-ios.yml` проверяет компиляцию пакета
под iOS; для распространения через App Store нужен Apple Developer Account
(подпись и entitlements выдаёт Apple), для sideloading — неподписанный `.ipa`.

## Android

```
clients/GhostVPN.Android/
├── app/src/main/java/app/ghostvpn/client/
│   ├── MainActivity.kt      — интерфейс (Compose)
│   ├── Core.kt              — разбор подписки + конфиг sing-box
│   └── GhostVpnService.kt   — VpnService: TUN + sing-box + tun2socks
```

Туннель: `VpnService` создаёт TUN → `hev-socks5-tunnel` (userspace TCP/IP → SOCKS5) →
локальный mixed-инбаунд sing-box → VLESS/REALITY → сервер панели.

CI (`client-android.yml`) собирает APK и кладёт внутрь:
- `lib/arm64-v8a/libexec.so` — ядро sing-box из официального релиза;
- `lib/arm64-v8a/libhev-socks5-tunnel.so` — tun2socks, собирается из исходников через NDK.

APK подписывается debug-ключом (тестовая сборка). Для публикации в Google Play
нужен собственный keystore — добавьте его в `~/.gradle/gradle.properties` и
переопределите `signingConfig` в `app/build.gradle.kts`.

## Консольный клиент (серверы, headless)

```bash
# список серверов из подписки
dotnet run --project clients/GhostVPN.Cli -- --list "https://vpn.example.com/sub/TOKEN"

# конфигурация sing-box из ссылки
dotnet run --project clients/GhostVPN.Cli -- --key "vless://..." --out config.json --check
```

## Формат подписки

Панель отдаёт подписку в базовом v2ray-формате (base64 со ссылками `vless://`),
а также в форматах Clash и sing-box:

| Ссылка | Формат |
|---|---|
| `/sub/TOKEN` | v2ray base64 |
| `/sub/TOKEN?format=clash` | Clash / Mihomo YAML |
| `/sub/TOKEN?format=singbox` | sing-box JSON |
| `/sub/TOKEN?format=json` | сырые ссылки JSON |

Клиенты автоматически определяют формат, поэтому подойдёт любая из ссылок.
