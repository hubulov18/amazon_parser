# Amazon Reputation Parser (MVP)

Минималистичный MVP-парсер Amazon отзывов на `NestJS + Prisma + PostgreSQL`.

## Быстрый старт

### 1) Требования

- `Node.js 22+`
- `npm 10+`
- `Docker` и `docker compose`

### 2) Установка зависимостей

```bash
npm install
npx playwright install chromium
```

### 3) Подготовка окружения

```bash
cp .env.example .env
```

Минимум, что нужно проверить в `.env`:

- `DATABASE_URL`
- `AMAZON_CATEGORY_URL`
- `AMAZON_MAX_PRODUCTS`
- `AMAZON_REVIEW_FETCH_MODE` (`playwright` по умолчанию)

### 4) Поднять PostgreSQL

```bash
docker compose up -d
```

### 5) Применить миграции Prisma

```bash
npm run prisma:migrate:dev
```

## Авторизация Amazon для Playwright (не обязательно так как есть state.json)

Для парсинга отзывов используется браузерный режим (`playwright`), поэтому нужна валидная Amazon-сессия.

```bash
npm run review:login
```

Что делает команда:

- открывает браузер,
- дает пройти login/captcha/otp вручную (или автозаполнением, если заданы `AMAZON_LOGIN_EMAIL` и `AMAZON_LOGIN_PASSWORD`),
- сохраняет сессию в файл `AMAZON_PLAYWRIGHT_STORAGE_STATE_PATH` (по умолчанию `.amazon-playwright-state.json`).

## Запуск парсера

### Вариант 1: запуск по параметрам из `.env`

```bash
npm run parse:amazon
```

### Вариант 2: запуск с явными CLI-параметрами

```bash
npm run parse:amazon -- \
  --categoryUrl="https://www.amazon.com/s?i=specialty-aps&bbn=16225007011&rh=n%3A16225007011%2Cn%3A3011391011" \
  --ignoreCheckpoint=true \
  --maxProducts=5
```
## Как понять, что все отработало

В конце выполнения в логах должен быть блок вида:

- `Crawl completed...`
- `Crawl finished: {"crawlRunId": "...", ... }`

Это означает, что run завершен и метрики сохранены в БД.
