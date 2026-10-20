<div align="center">

# 👻 GhostVPN

**Полноценная VPN-панель: сайт, аккаунты, персональные ключи и подписки.**

[![CI](https://github.com/1ehan2ole-lab/ghostvpn/actions/workflows/ci.yml/badge.svg)](https://github.com/1ehan2ole-lab/ghostvpn/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-3fa737?logo=node.js)](https://nodejs.org)

VLESS + REALITY · веб-панель · учёт трафика · админка · подписки для всех клиентов

</div>

---

## Что это

GhostVPN — self-hosted VPN-сервис на базе ядра [Xray-core](https://github.com/XTLS/Xray-core).
Это не «обёртка над готовым сервисом», а полноценная панель:

| Возможность | Реализация |
|---|---|
| 🌐 Сайт | Лендинг, тарифы, FAQ, статистика онлайна (статика + API) |
| 👤 Аккаунты | Регистрация, вход, сессии в БД, смена пароля, роли |
| 🔑 Ключи | Уникальный UUID + REALITY-ключи на аккаунт, перевыпуск в один клик |
| 📡 Подписки | `vless://`, base64, Clash/Mihomo YAML, sing-box JSON, QR-код |
| 📊 Трафик | Реальный учёт с ядра Xray, лимиты, срок действия, автоотключение |
| 🛠 Админка | Пользователи, лимиты, продление, инвайты, настройки, журнал, управление Xray |
| 🔑 Генерация ключей | Массовая выдача платных ключей: количество, срок, лимит трафика, тариф, экспорт CSV/TXT |
| 💳 Оплата | Заявки на продление из кабинета → подтверждение в админке (продление + сброс трафика) |
| 🩺 Диагностика ноды | Проверка доступности YouTube/Google с IP сервера + переключатель QUIC |
| 🔒 Безопасность | scrypt-пароли, httpOnly-сессии, CSRF-защита, rate-limit, ACL |
| 📱 Свои клиенты | Windows (.exe), macOS (.dmg), Android (.apk), iOS (.ipa) + консольный клиент |
| 🐳 Деплой | Docker/docker-compose, systemd-совместимый запуск, GitHub Actions |

---

## Быстрый старт

### Вариант 1 — Docker (рекомендуется)

```bash
git clone https://github.com/1ehan2ole-lab/ghostvpn.git
cd ghostvpn
cp .env.example .env
nano .env            # задайте ADMIN_EMAIL, ADMIN_PASSWORD, SERVER_PORT
docker compose up -d
docker compose logs -f
```

### Вариант 2 — Вручную (Ubuntu / Debian)

```bash
# 1. Зависимости
apt-get update && apt-get install -y curl unzip iproute2

# 2. Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

# 3. Проект
git clone https://github.com/1ehan2ole-lab/ghostvpn.git
cd ghostvpn
npm install
npm run xray:install          # скачивает ядро Xray в ./vendor/xray

# 4. Настройки
cp .env.example .env
nano .env

# 5. Запуск
npm start
```

При первом запуске панель создаёт администратора и печатает его пароль в консоль:

```
┌─────────────────────────────────────────────┐
│ Создан администратор                        │
│ E-mail:  admin@ghostvpn.local               │
│ Пароль:  xxxxxxxxxxxxxxxxxxxx                │
└─────────────────────────────────────────────┘
```

> Порт `443` требует прав `root`. Для локального теста укажите `SERVER_PORT=8443`.

### systemd-юнит

```ini
# /etc/systemd/system/ghostvpn.service
[Unit]
Description=GhostVPN panel + Xray
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/ghostvpn
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now ghostvpn
```

---

## Настройка (.env)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `8080` | Порт веб-панели |
| `HOST` | `0.0.0.0` | Интерфейс панели |
| `PUBLIC_URL` | — | Публичный адрес панели (используется в подписках) |
| `TRUST_PROXY` | `0` | `1`, если панель за nginx/caddy |
| `DATA_DIR` | `./data` | База, конфиг Xray, логи |
| `XRAY_BIN` | `./vendor/xray/xray.exe` | Путь к ядру Xray |
| `SERVER_HOST` | — | Адрес VPN-ноды в подписках (если не совпадает с доменом) |
| `SERVER_PORT` | `443` | Порт VPN (TCP) |
| `REALITY_SNI` | `www.apple.com` | SNI маскировки |
| `REALITY_DEST` | `www.apple.com:443` | Destination для REALITY |
| `REALITY_FINGERPRINT` | `chrome` | uTLS fingerprint |
| `SITE_NAME` | `GhostVPN` | Название сайта |
| `DEFAULT_TRAFFIC_GB` | `0` | Лимит трафика нового аккаунта (0 = без лимита) |
| `TRIAL_DAYS` | `0` | Срок нового аккаунта в днях (0 = бессрочно) |
| `REGISTRATION_OPEN` | `1` | Открыта ли регистрация |
| `INVITE_REQUIRED` | `0` | Требовать инвайт-код |
| `DEVICE_LIMIT` | `3` | Одновременных устройств на аккаунт |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Учётка администратора при первом запуске |

Настройки из админ-панели (сайт, цены, порт, SNI, лимиты) перекрывают `.env` и сохраняются в базе.

---

## Как это работает

```
Клиент (Hiddify / v2rayN / v2rayNG / Streisand)
        │  vless:// + REALITY (TCP, XTLS Vision)
        ▼
┌──────────────────────── сервер ────────────────────────┐
│  Xray-core                                             │
│   ├─ inbound: VLESS/REALITY  →  :443/tcp               │
│   ├─ api: 127.0.0.1:10085   →  статистика и онлайн     │
│   └─ routing: block bittorrent, block QUIC(443/udp)    │
│                                                      │
│  GhostVPN (Node.js)                                   │
│   ├─ REST API + SSR-панель (Express, SQLite)          │
│   ├─ учёт трафика каждые 30 сек                       │
│   ├─ автоперезапуск Xray (watchdog)                   │
│   └─ выдача подписок: v2ray / clash / sing-box / QR   │
└──────────────────────────────────────────────────────┘
```

**Почему REALITY.** Трафик маскируется под обычный TLS к легитимному сайту
(`SNI` = `www.apple.com`), поэтому DPI-оборудование не видит разницы с легитимным
HTTPS-трафиком. XTLS Vision снижает накладные расходы.

---

## API

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/auth/register` | Регистрация |
| `POST` | `/api/auth/login` | Вход |
| `POST` | `/api/auth/logout` | Выход |
| `GET` | `/api/auth/me` | Текущий пользователь |
| `GET` | `/api/me` | Профиль, ключ, трафик, подписки |
| `GET` | `/api/me/key` | Ключ в текстовом виде |
| `GET` | `/api/me/qr.png` | QR-код ключа (PNG) |
| `GET` | `/api/me/plans` | Доступные тарифы |
| `GET` | `/api/me/payments` | Заявки на оплату пользователя |
| `POST` | `/api/me/payments` | Создать заявку на продление |
| `GET` | `/sub/:token` | Подписка (base64) |
| `GET` | `/sub/:token?format=clash` | Clash / Mihomo YAML |
| `GET` | `/sub/:token?format=singbox` | sing-box JSON |
| `GET` | `/sub/:token?format=json` | JSON со ссылками |
| `GET` | `/api/public/info` | Данные сайта и статистика |
| `GET` | `/api/health` | Health-check |
| `GET` | `/api/admin/users` | Список аккаунтов (admin) |
| `POST` | `/api/admin/users` | Создать аккаунт (admin) |
| `PATCH` | `/api/admin/users/:id` | Изменить аккаунт (admin) |
| `DELETE` | `/api/admin/users/:id` | Удалить аккаунт (admin) |
| `POST` | `/api/admin/users/:id/extend` | Продлить доступ (admin) |
| `POST` | `/api/admin/users/:id/reset-traffic` | Сбросить трафик (admin) |
| `POST` | `/api/admin/users/:id/rotate-key` | Перевыпустить ключ (admin) |
| `GET/PUT` | `/api/admin/settings` | Настройки панели (admin) |
| `GET` | `/api/admin/payments` | Заявки на оплату (admin) |
| `POST` | `/api/admin/payments/:id/paid` | Подтвердить оплату (admin) |
| `POST` | `/api/admin/payments/:id/reject` | Отклонить заявку (admin) |
| `POST` | `/api/admin/xray/restart` | Перезапуск Xray (admin) |
| `POST` | `/api/admin/xray/reload` | Обновить клиентов без рестарта (admin) |

---

## Скрипты

```bash
npm start              # запустить панель + Xray
npm run dev            # режим разработки (watch)
npm run setup          # первичная настройка: .env, ключи, админ
npm run xray:install   # скачать ядро Xray
npm run xray:start     # запустить только Xray
npm run xray:stop      # остановить Xray
npm run xray:restart   # перезапустить Xray
npm run xray:status    # статус и ключи REALITY
npm test               # тесты (unit + e2e API)
```

Вспомогательные PowerShell-скрипты для Windows:

```powershell
powershell -File scripts\test-tunnel.ps1   # сквозная проверка туннеля по подписке
powershell -File scripts\test-dest.ps1      # подбор рабочего REALITY destination
```

---

## Развёртывание сайта (GitHub Pages)

Публичная часть сайта (лендинг) публикуется на GitHub Pages:

1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables** → `PANEL_URL` = `https://vpn.example.com`.

Workflow `.github/workflows/deploy-pages.yml` собирает папку `web/` и подставляет адрес панели
в `config.js`. Кабинет и админка при этом остаются на сервере панели.

---

## Свои клиенты

В репозитории лежат клиенты под все платформы — общий протокол подписки, ядро sing-box:

| Платформа | Стек | Артефакт |
|---|---|---|
| Windows | C# / WPF / .NET 10 | `GhostVPN.exe` (собран и проверен) |
| macOS | Swift / SwiftUI | `.app` / `.dmg` |
| Android | Kotlin / Jetpack Compose | `.apk` (VpnService + sing-box + tun2socks) |
| iOS | Swift / SwiftUI | `.ipa` (сетевое расширение) |
| Linux / сервер | C# / .NET 10 | консольный `ghostvpn` |

Сборка: `clients/README.md`, workflow-файлы `.github/workflows/client-*.yml`.

Готовые сборки — в релиз��х GitHub: **https://github.com/1ehan2ole-lab/ghostvpn/releases**

| Файл | Платформа |
|---|---|
| `GhostVPN-Windows-x64.zip` | Windows (клиент + ядро sing-box + консольный клиент) |
| `GhostVPN-macOS-arm64.dmg` | macOS (Apple Silicon) |
| `GhostVPN-Android-arm64.apk` | Android (ядро sing-box + tun2socks внутри) |
| исходники `clients/GhostVPN.Apple` | iOS (сборка `.ipa` — вручную, нужен Apple Developer ID) |

```bash
# Windows
dotnet publish clients/GhostVPN.Windows/GhostVPN.Windows.csproj -c Release -r win-x64 \
  --self-contained false -p:PublishSingleFile=true -o clients/dist/windows

# консольный клиент
dotnet run --project clients/GhostVPN.Cli -- --list "https://vpn.example.com/sub/TOKEN"
```

## Продажа ключей (админка)

Вкладка **«Генерация ключей»** в админ-панели:

1. Укажите количество ключей, срок в днях, лимит трафика (ГБ), тариф и цену.
2. Метка партии — по ней ключи группируются и выгружаются.
3. Статус «Ждут оплаты» — ключи создаются неактивными: подписка отдаёт 403, пока админ
   не нажмёт «Активировать» (или не подтвердит заявку на оплату).
4. «Экспорт CSV» — файл с логинами, паролями, ключами и ссылками подписки
   (свежие ключи выгружаются вместе с паролями; по старым пароль недоступен — хранится только хеш).

Ключи можно выдать и поштучно: «Пользователи» → «Изм.» / «Активировать» / «+30 дн.».
Срок действия и лимит трафика считаются автоматически, по исчерпании аккаунт отключается.

## Почему может не работать YouTube

* **Проверьте ноду**: админка → «Сервер» → «Проверить доступность». Если YouTube недоступен
  с IP сервера, дело в адресе ноды (Google блокирует дата-центровые IP) — нужен другой VPS/IP.
* **QUIC**: по умолчанию UDP/443 блокируется, браузер переключается на TCP. Если рвётся —
  включите «Разрешить QUIC» в настройках ноды.
* **DNS**: клиенты отправляют DNS через туннель и используют только IPv4 — провайдерский
  DNS и AAAA-записи не должны выводить трафик мимо VPN.

---

## Структура проекта

```
ghostvpn/
├── server/
│   ├── index.js        # точка входа, Express, статика
│   ├── config.js       # конфигурация (.env)
│   ├── db.js           # SQLite-хранилище (node:sqlite)
│   ├── auth.js         # сессии, CSRF, rate-limit
│   ├── service.js      # бизнес-логика (аккаунты, трафик)
│   ├── xray.js         # управление ядром, статистика
│   ├── subscription.js # генерация подписок и ключей
│   ├── runtime.js      # настройки из БД поверх .env
│   ├── util.js         # хеши, токены, форматирование
│   └── routes/         # auth, me, admin, sub, public
├── web/                # статический сайт и кабинеты
├── scripts/            # установка Xray, setup, тестовые утилиты
├── test/               # unit + e2e тесты
├── data/               # БД, конфиг Xray, логи (в .gitignore)
└── .github/workflows/  # CI и деплой Pages
```

---

## Безопасность

- Пароли — `scrypt` со случайной солью, сравнение в постоянном времени.
- Сессии — случайные 32-байтные токены в БД, cookie `httpOnly` + `SameSite=Lax`.
- CSRF — проверка `Origin` для всех изменяющих запросов.
- Rate-limit на логин и регистрацию (in-memory, по IP).
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` на всех ответах.
- Подписки — отдельный непредсказуемый токен; при отключении аккаунта подписка перестаёт работать.
- Ключи можно перевыпустить — старый UUID мгновенно перестаёт действовать.

### Целостность базы

- SQLite работает в режиме WAL с частым чекпойнтом (`wal_autocheckpoint = 64`),
  поэтому основной файл `data/ghostvpn.db` всегда актуален, даже если процесс убит через `kill -9`.
- Раз в минуту выполняется принудительный чекпойнт, при остановке — слив WAL в файл БД.
- При старте проверяется целостность БД и создаётся ежедневная резервная копия
  в `data/backups/ghostvpn-YYYY-MM-DD.db`.
- Рекомендуется дополнительно держать копию `data/` на отдельном диске.

Рекомендуется дополнительно: HTTPS через reverse-proxy, firewall с открытым `443/tcp`,
`8880/tcp` для панели (или доступ к панели только по SSH-туннелю).

---

## Лицензия

MIT — см. [LICENSE](LICENSE).

Проект использует [Xray-core](https://github.com/XTLS/Xray-core) (MPL-2.0) и
[SQLite](https://sqlite.org) (public domain).
