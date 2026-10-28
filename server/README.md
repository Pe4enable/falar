# Falar — сервис хранения прогресса

Маленький сервис: анонимные аккаунты + код восстановления + (опционально) email-вход.
Хранилище — SQLite. Авторизация — Bearer-токен (cookie не используются). Отдаётся за Caddy
на том же домене по префиксу `/api/*`.

## Запуск локально (для разработки/проверки)

```bash
cd server
npm install
PORT=8080 DB_PATH=./data.db node index.js
```

Проверка:
```bash
curl -s localhost:8080/api/health
curl -s -XPOST localhost:8080/api/account                       # → {accountId, token}
TOKEN=...                                                        # из ответа выше
curl -s -XPUT localhost:8080/api/progress -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"data":{"x":1},"baseVersion":0}'
curl -s localhost:8080/api/progress -H "Authorization: Bearer $TOKEN"
curl -s -XPOST localhost:8080/api/recovery/create -H "Authorization: Bearer $TOKEN"  # → {code}
curl -s -XPOST localhost:8080/api/recovery/login -H 'Content-Type: application/json' -d '{"code":"FALAR-..."}'
```

## Развёртывание на сервере (Docker)

1. Скопировать папку `server/` в стек, напр. `/srv/stacks/falar/progress/`.
2. В `docker-compose.yml` заменить имя сети `web` на сеть, где работает Caddy
   (`docker inspect <caddy> --format '{{json .NetworkSettings.Networks}}'`).
3. Поднять: `docker compose up -d --build`. Данные — в volume `falar-progress-data` (`/data/data.db`).
4. В Caddyfile нужного домена добавить **до** файлового сервера:
   ```
   handle /api/* {
       reverse_proxy falar-progress:8080
   }
   ```
   Перезагрузить Caddy: `docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile`.
5. Проверка снаружи: `curl -s https://<домен>/api/health` → `{"ok":true}`.

## Email (опционально, этап 2)

Привязка email включается, когда задан `RESEND_API_KEY` (провайдер [Resend](https://resend.com),
бесплатно 3000 писем/мес). Задать в окружении сервиса:
```
RESEND_API_KEY=re_xxx
EMAIL_FROM=Falar <noreply@ваш-домен>   # домен должен быть верифицирован в Resend
```
Без ключа эндпоинты email отвечают 503, а в приложении кнопка «Привязать email» скрыта
(код восстановления при этом работает).

## Бэкап

Все данные — один файл `data.db` (+ `-wal`/`-shm`) в volume `falar-progress-data`.
Простой бэкап по расписанию (cron на хосте):
```bash
docker run --rm -v falar-progress-data:/data -v /srv/backups:/backup alpine \
  sh -c "cp /data/data.db /backup/falar-progress-$(date +\%F).db"
```

## Переменные окружения

| Переменная        | По умолчанию          | Назначение                            |
|-------------------|-----------------------|---------------------------------------|
| `PORT`            | `8080`                | Порт сервиса                          |
| `DB_PATH`         | `./data.db`           | Путь к файлу SQLite                   |
| `RESEND_API_KEY`  | —                     | Ключ Resend (включает email)          |
| `EMAIL_FROM`      | `onboarding@resend.dev` | Отправитель писем                   |
