#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# GhostVPN - установка на сервер (Ubuntu/Debian)
#
#   curl -fsSL https://raw.githubusercontent.com/1ehan2ole-lab/ghostvpn/main/deploy/install.sh | sudo bash
#
# После установки:
#   - панель:  http://<IP-сервера>:8080
#   - VPN:     <IP-сервера>:443
#   - логин/пароль админа печатаются в конце установки
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="https://github.com/1ehan2ole-lab/ghostvpn.git"
DIR="${GHOSTVPN_DIR:-/opt/ghostvpn}"

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать от root (sudo)"

log "Проверяем систему"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Поддерживаются Ubuntu и Debian" ;;
esac

log "Обновляем систему и ставим зависимости"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl unzip ca-certificates git iproute2 openssl >/dev/null

if ! command -v node >/dev/null 2>&1; then
  log "Ставим Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

log "Ставим GhostVPN в $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
[ -f .env ] || cp .env.example .env

log "Ставим зависимости и ядро sing-box"
npm ci --omit=dev --no-audit --no-fund >/dev/null
npm run xray:install >/dev/null
chmod +x vendor/xray/xray
ok "ядро: $(vendor/xray/xray version | head -n1)"

# --- порты ---------------------------------------------------------------
VPN_PORT="$(grep -E '^SERVER_PORT=' .env | cut -d= -f2 || true)"
VPN_PORT="${VPN_PORT:-443}"
PANEL_PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
PANEL_PORT="${PANEL_PORT:-8080}"

log "Открываем порты в firewall"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${VPN_PORT}/tcp" >/dev/null 2>&1 || true
  ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
fi

# --- systemd -------------------------------------------------------------
log "Ставим systemd-юнит"
cat > /etc/systemd/system/ghostvpn.service <<UNIT
[Unit]
Description=GhostVPN panel + Xray
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${DIR}
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
LimitNOFILE=65535
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable ghostvpn >/dev/null
systemctl restart ghostvpn
sleep 6
systemctl is-active --quiet ghostvpn && ok "служба запущена" || fail "служба не стартовала: journalctl -u ghostvpn -n 50"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
ok "установка завершена"
echo
printf '  Панель:  http://%s:%s\n' "${IP:-<IP-сервера>}" "${PANEL_PORT}"
printf '  VPN:     %s:%s (VLESS/REALITY)\n' "${IP:-<IP-сервера>}" "${VPN_PORT}"
printf '  Логи:    journalctl -u ghostvpn -f\n\n'
printf '  ВАЖНО: в админке -> "Сервер" -> "Адреса ноды" укажите публичный адрес,\n'
printf '  иначе в ключах и подписках останется %s.\n' "${IP:-localhost}"
printf '  Затем перезапустите: systemctl restart ghostvpn\n\n'
