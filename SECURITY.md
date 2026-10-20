# Security Policy

## Supported versions

| Версия | Поддержка |
|---|---|
| `main` | ✅ |
| `v1.x` | ✅ |

## Reporting a vulnerability

Пожалуйста, **не создавайте публичный issue** для уязвимостей.

Вместо этого отправьте письмо на `security@ghostvpn.local` или откройте
приватный advisory в репозитории (Security → Report a vulnerability).

Что стоит указать в отчёте:

- описание проблемы и шаги воспроизведения;
- версия GhostVPN и ядра Xray (`npm run xray:status`);
- оценка влияния (кто и что может получить).

Ответ ожидается в течение 72 часов. После подтверждения выпускается патч,
исправление попадает в `main` вместе с advisory.

## Hardening checklist

- Поставьте панель за HTTPS (nginx/caddy) и не публикуйте порт `8080` наружу.
- Включите `TRUST_PROXY=1`, если панель работает за reverse-proxy.
- Задайте сложный `ADMIN_PASSWORD` и смените его после первого входа.
- Ограничьте доступ к панели по IP или через SSH-туннель.
- Держите `data/` вне веб-корня и делайте бэкапы `ghostvpn.db`.
- Регулярно обновляйте ядро Xray: `npm run xray:install`.
