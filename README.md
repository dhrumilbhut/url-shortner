# 🔗 URL Shortener

![CI](https://github.com/dhrumilbhut/url-shortner/actions/workflows/ci.yml/badge.svg)

A production-grade URL shortening service built with **Node.js**, **Express**, **PostgreSQL**, **Redis**, and **RabbitMQ**. Click analytics are processed asynchronously — redirects are never blocked by analytics. Includes JWT auth with access + refresh token flow, token blocklist, admin user banning, and a minimal vanilla JS frontend.

> 🖥️ Start the server and open `http://localhost:3000`

---

## 🏗️ Architecture

```
POST /shorten  →  JWT verify  →  Postgres (store URL)

GET  /r/:code  →  Redis cache
                    ├── HIT:  instant redirect
                    └── MISS: Postgres → cache → redirect
                ↓
            RabbitMQ (fire & forget)  →  Worker  →  Redis INCR

GET /analytics/:code  →  Postgres metadata + Redis click count
```

---

## ✅ Prerequisites

| Service | Port |
|---|---|
| Node.js v20+ | — |
| PostgreSQL | 5432 |
| Redis | 6379 |
| RabbitMQ | 5672 |

> **Windows / WSL Redis:** `wsl sudo service redis-server start`

---

## 🚀 Setup

```bash
npm install
```

Create the database:

```sql
CREATE DATABASE shortener;
\c shortener

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  role VARCHAR(20) NOT NULL DEFAULT 'user'
);

CREATE TABLE urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(10) UNIQUE NOT NULL,
  original_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
```

Copy and fill in `.env`:

```bash
cp .env.example .env
```

```env
PORT=3000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/shortener
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
BASE_URL=http://localhost:3000
JWT_SECRET=your_long_random_secret_here
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
```

---

## ▶️ Running

### Option 1 — Docker (recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop). No other installs needed.

```bash
docker compose up --build
```

Everything starts automatically — Postgres, Redis, RabbitMQ, the API server, and the worker. Tables are created on first run. Open `http://localhost:3000`.

To stop and clean up:
```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers + delete data
```

### Option 2 — Local

Requires PostgreSQL, Redis, and RabbitMQ running locally.

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — click worker
npm run worker
```

---

## 🖥️ UI

A minimal frontend at `http://localhost:3000` — login/register, shorten URLs, view your links, copy, delete, and see click stats inline.

### Login / Register

![Login screen](/screenshots/login.png)

### Regular user

![Regular user dashboard](screenshots/user-dashboard.png)

### Admin user

![Admin dashboard](screenshots/admin-dashboard.png)

> Admins see a **👑 User Management** panel below their URLs where they can ban or unban any user.

---

## 📡 API Reference

### 🔐 Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create account |
| POST | `/auth/login` | — | Returns `accessToken` + `refreshToken` |
| POST | `/auth/refresh` | — | Exchange refresh token for new access token |
| POST | `/auth/logout` | 🔒 | Deletes refresh token |
| POST | `/auth/invalidate` | 🔒 | Blocklists current token immediately |
| POST | `/auth/admin/ban/:userId` | 🔒 👑 | Ban user (admin only) |
| DELETE | `/auth/admin/ban/:userId` | 🔒 👑 | Lift ban (admin only) |

**Login response:**
```json
{ "accessToken": "eyJ...", "refreshToken": "uuid", "expiresIn": "15m" }
```

**Refresh body:** `{ "userId": "uuid", "refreshToken": "uuid" }`

---

### ✂️ URLs

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/shorten` | 🔒 | Shorten a URL (optional `customCode`) |
| GET | `/urls/me` | 🔒 | List your active URLs |
| DELETE | `/urls/:shortCode` | 🔒 | Soft-delete (owner only) |
| GET | `/r/:shortCode` | — | Redirect (302, rate limited) |
| GET | `/analytics/:shortCode` | — | Click stats |
| GET | `/health` | — | Service health |

**Shorten body:** `{ "url": "https://...", "customCode": "optional" }`

**Analytics response:**
```json
{ "shortCode": "xK9pQr", "originalUrl": "https://...", "totalClicks": 42, "isActive": true }
```

> ⚠️ `totalClicks` only updates while the worker is running.

---

## 🔑 Auth Flow

Two-token system:

| Token | Lifespan | Stored | Used for |
|---|---|---|---|
| Access token (JWT) | 15 min | Client only | `Authorization: Bearer` header |
| Refresh token (UUID) | 7 days | Redis | Silently renew access token |

Logout deletes the refresh token instantly. On ban, both tokens are invalidated.

---

## ⚡ Redis Keys

| Key | Pattern | Purpose |
|---|---|---|
| `url:{code}` | Cache | Original URL, TTL 1h |
| `clicks:{code}` | Counter | Atomic INCR by worker |
| `rate:{ip}` | Sorted set | Sliding window rate limiter (60 req/60s) |
| `refresh:{userId}` | String | Refresh token, TTL 7d |
| `blocklist:{jti}` | String | Invalidated token, TTL = remaining lifetime |
| `banned:{userId}` | String | Banned user flag, no TTL |

---

## ⚙️ CI

Every push to `main` runs a GitHub Actions workflow that:

1. Spins up Postgres, Redis, and RabbitMQ as service containers
2. Installs dependencies and initializes the database schema
3. Boots the API server and hits `/health`
4. Fails the build if any service reports `"down"`

---

## 🧰 Tech Stack

Node.js + Express · PostgreSQL · Redis · RabbitMQ · bcrypt · jsonwebtoken · nanoid

---

## 🐛 Common Errors

| Error | Fix |
|---|---|
| `ECONNREFUSED 5432` | PostgreSQL not running |
| `ECONNREFUSED 6379` | Redis not running — `wsl sudo service redis-server start` |
| `ECONNREFUSED 5672` | RabbitMQ not running |
| `401 Access token expired` | Call `POST /auth/refresh` |
| `403 Your account has been banned` | Contact admin |
| `totalClicks` always 0 | Worker not running — `npm run worker` |
| HTTP 429 on every request | Rate limited — wait 60s |
| RabbitMQ UI not loading | `rabbitmq-plugins enable rabbitmq_management` |
