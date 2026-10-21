# Бесплатный VPN-сервер (без аренды)

Сервер Xray должен работать **24/7 и иметь публичный IP** — иначе телефон не подключится,
когда ваш компьютер выключен. Бесплатные варианты:

| Вариант | Плюсы | Минусы |
|---|---|---|
| **1. Oracle Cloud Always Free** | 4 ядра ARM / 24 ГБ RAM / 10 ТБ трафика в месяц, навсегда | Нужна карта для проверки (списываний нет) |
| **2. Своя железка дома** (Raspberry Pi / старый ПК) | Бесплатно навсегда, нет лимитов трафика | Нужен белый IP у провайдера (не CGNAT) + проброс порта на роутере; работает только из домашней сети |
| 3. AWS/GCP Free Tier | Быстро | Трафик 1–100 ГБ/мес, AWS — 12 месяцев |

---

## Вариант 1. Oracle Cloud Always Free (рекомендую)

### Вариант 1а. Развернуть прямо из GitHub (без ручной работы с консолью)

В репозитории есть воркфлоу **«Deploy to Oracle Cloud (free tier)»** — он сам создаёт VM,
открывает порты, ставит GhostVPN **сразу с правильным публичным адресом** (в ключах и
подписках будет IP сервера, а не localhost) и печатает адрес панели.

1. Создайте API-ключ в Oracle: **User Settings → API Keys → Add API Key** (нужна пара
   «fingerprint» + приватный ключ `.pem`).
2. В GitHub: **Settings → Secrets and variables → Actions → New repository secret**:

   | Secret | Значение |
   |---|---|
   | `OCI_TENANCY_OCID` | OCID tenancy (User → Tenancy) |
   | `OCI_USER_OCID` | ваш User OCID |
   | `OCI_FINGERPRINT` | fingerprint ключа |
   | `OCI_PRIVATE_KEY` | приватный ключ, **в base64**: `base64 -w0 key.pem` |
   | `OCI_COMPARTMENT_OCID` | OCID compartment (обычно = tenancy) |

3. **Actions → Deploy to Oracle Cloud (free tier) → Run workflow** → выберите регион → Run.
4. В сводке запуска будут адрес панели и адрес VPN.

Проверить: https://github.com/1ehan2ole-lab/ghostvpn/actions/workflows/deploy-oci.yml

### Вариант 1б. Обновление сервера из GitHub

Когда в репозитории появляются изменения, обновить панель на сервере можно одной кнопкой:
**Actions → Deploy to server (update) → Run workflow**.

Секреты для него:

| Secret | Значение |
|---|---|
| `SERVER_HOST` | IP или домен сервера |
| `SERVER_USER` | `ubuntu` (или `root`) |
| `SERVER_SSH_KEY` | приватный SSH-ключ в base64 |

Воркфлоу выполнит `git pull`, переустановит зависимости и перезапустит службу.

### Вариант 1б. Вручную через консоль Oracle

### 1. Создать аккаунт и VM

1. Регистрация: https://signup.cloud.oracle.com/ (нужна карта, списываний не будет — free tier).
2. Создать **VPC** → **Subnet** (CIDR `10.0.0.0/24`).
3. Создать **Instance**:
   - Shape: **VM.Standard.A1.Flex**, 2 ядра ARM / 12 ГБ RAM (в рамках Always Free)
   - Image: **Canonical Ubuntu 22.04 (aarch64)**
   - Networking: публичный IP (по умолчанию)
4. Скопируйте **публичный IP** инстанса.

### 2. Открыть порты

Oracle по умолчанию закрывает всё. Добавьте правила в **Security List** подсети:

| Протокол | Порт | Источник |
|---|---|---|
| TCP | 443 | 0.0.0.0/0 |
| TCP | 8080 | 0.0.0.0/0 (панель; позже закройте или поставьте nginx) |

Также в **VCN → Security Lists** проверьте, что правило для ingress 443/8080 есть.

### 3. Подключиться и поставить

```bash
ssh -i ~/.ssh/<ваш-ключ>.pem ubuntu@<ПУБЛИЧНЫЙ_IP>

curl -fsSL https://raw.githubusercontent.com/1ehan2ole-lab/ghostvpn/main/deploy/install.sh | sudo bash
```

Скрипт поставит панель, Xray и systemd-юнит и напечатает адрес и пароль админа.

### 4. Правильный адрес в ключах

В админке → **«Сервер» → «Адреса ноды»** → впишите:

```
http://<ПУБЛИЧНЫЙ_IP>:8080
```

→ «Сохранить настройки» → на сервере `sudo systemctl restart ghostvpn`.

Теперь в ключах и подписках будет ваш сервер, а не `localhost`.

### 5. Проверка

- Админка → «Сервер» → «Проверить доступность»: покажет, доступен ли YouTube с IP сервера.
  Если недоступен — Google режет этот IP: берите другой регион/тариф.
- С телефона: установите [GhostVPN-Android-arm64.apk](https://github.com/1ehan2ole-lab/ghostvpn/releases/download/v1.1.0/GhostVPN-Android-arm64.apk),
  вставьте ссылку подписки из кабинета → «Подключиться».

### 6. Панель — только через HTTPS

Панель на `http://IP:8080` видна всему интернету. Закройте её:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
# домен на IP сервера -> A-запись, затем:
certbot --nginx -d vpn.example.com
```

nginx → проксирование `https://vpn.example.com` → `http://127.0.0.1:8080`, в `.env` панели:

```
PUBLIC_URL=https://vpn.example.com
TRUST_PROXY=1
```

---

## Вариант 2. Своя железка дома (Raspberry Pi / старый ПК)

Полностью бесплатно и без лимитов, но работает только пока дома есть интернет и устройство включено.

1. **Проверьте, есть ли у вас белый IP.** Узнайте внешний адрес:

   ```bash
   curl -4 https://api.ipify.org
   ```

   Сравните его с **WAN-IP** в настройках роутера (обычно `192.168.1.1`).
   Если адреса совпадают — белый IP есть, всё получится.
   Если не совпадают — у провайдера CGNAT, проброс портов не поможет (нужен вариант 1).

2. **Пробросьте порт 443** на роутере: внешний `TCP 443` → `192.168.x.x:443` (устройство с Xray).

3. **Поставьте GhostVPN** на устройство (Raspberry Pi: Ubuntu Server 22.04 aarch64 — тот же скрипт `deploy/install.sh`).

4. **Бесплатный DDNS**, чтобы не менять настройки при смене IP:

   ```bash
   sudo apt-get install -y ddclient
   # в /etc/ddclient.conf: protocol=duckdns, domain=имя, token=...
   ```

   В админке → «Адреса ноды» → `http://<домен-duckdns>:8080`.

5. **Клиент на телефоне** подключается к `домен:443` — работает из любой точки мира,
   пока дома есть интернет и устройство включено.

---

## Что выбрать

- Нужно «работает всегда, из любой точки, бесплатно» → **Oracle Cloud Always Free**.
- Нет желания возиться с облаком, есть домашний сервер/роутер с белым IP → **вариант 2**.
- Просто проверить работу с телефона в домашней сети → оставьте ПК включённым,
  ключ уже содержит `192.168.1.17:8443`.
