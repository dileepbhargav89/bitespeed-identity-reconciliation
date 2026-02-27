# Bitespeed — Identity Reconciliation Service

A production-ready REST API that links customer contact records (email + phone) across multiple purchases into a single, consolidated identity.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Local Development](#local-development)
- [Database Migrations](#database-migrations)
- [Deploying to Render.com](#deploying-to-rendercom)
- [Project Structure](#project-structure)
- [Reconciliation Logic](#reconciliation-logic)

---

## Overview

FluxKart.com customers sometimes check out with different emails or phone numbers. This service identifies when separate contact records belong to the same real-world person and consolidates them into a unified profile, always preserving the **oldest** contact as the `primary`.

---

## Architecture

```
┌─────────────┐    POST /identify    ┌─────────────────────┐
│   Client    │ ──────────────────▶  │  Express Controller  │
└─────────────┘                      │  (input validation)  │
                                     └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │  Identity Service   │
                                     │  (business logic +  │
                                     │   DB transaction)   │
                                     └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │  Prisma ORM         │
                                     │  (type-safe queries)│
                                     └──────────┬──────────┘
                                                │
                                     ┌──────────▼──────────┐
                                     │   PostgreSQL DB     │
                                     └─────────────────────┘
```

**Layered Architecture:**
- **Controller** — HTTP boundary: parse, validate, delegate, respond
- **Service** — Pure business logic, no HTTP awareness
- **Lib (Prisma)** — Singleton DB client, transactions
- **Types** — Shared interfaces across all layers

---

## API Reference

### `POST /identify`

Reconciles an incoming contact with existing records.

**Request Body** (`application/json`):
```json
{
  "email": "mcfly@hillvalley.edu",
  "phoneNumber": "123456"
}
```

> `email` and `phoneNumber` are both optional, but **at least one must be provided**.
> `phoneNumber` may be sent as a string or a number — the service normalises it.

**Success Response** `200 OK`:
```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": [
      "lorraine@hillvalley.edu",
      "mcfly@hillvalley.edu"
    ],
    "phoneNumbers": [
      "123456"
    ],
    "secondaryContactIds": [23]
  }
}
```

> The primary contact's email/phone always appears **first** in its array.

**Error Responses**:

| Status | Reason |
|--------|--------|
| `400` | Neither `email` nor `phoneNumber` provided, or email format invalid |
| `404` | Route not found |
| `500` | Unexpected server error |

### `GET /health`

Liveness probe (used by Render.com and load balancers).

```json
{
  "status": "ok",
  "service": "bitespeed-identity-reconciliation",
  "timestamp": "2024-01-15T12:00:00.000Z"
}
```

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [PostgreSQL](https://www.postgresql.org/) ≥ 14 running locally (or a cloud instance)
- [npm](https://npmjs.com) or [yarn](https://yarnpkg.com)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/bitespeed-identity-reconciliation.git
cd bitespeed-identity-reconciliation

npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your PostgreSQL connection string:

```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/bitespeed_identity?schema=public"
PORT=3000
NODE_ENV=development
```

Create the database if it doesn't exist yet:

```sql
-- in psql
CREATE DATABASE bitespeed_identity;
```

### 3. Run Migrations

```bash
npm run prisma:migrate:dev
```

This will:
- Apply all migrations in `prisma/migrations/`
- Regenerate the Prisma client

### 4. Start the Development Server

```bash
npm run dev
```

The server starts with hot-reload via `ts-node-dev`. You should see:

```
✅ Database connection established.
🚀 Bitespeed Identity Service running on port 3000
   Environment : development
   Health check: http://localhost:3000/health
   Endpoint    : POST http://localhost:3000/identify
```

### 5. Test the Endpoint

```bash
# New customer
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"lorraine@hillvalley.edu","phoneNumber":"123456"}' | jq

# Same phone, new email → secondary created
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"mcfly@hillvalley.edu","phoneNumber":"123456"}' | jq

# Merge two clusters
curl -s -X POST http://localhost:3000/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"george@hillvalley.edu","phoneNumber":"717171"}' | jq
```

---

## Database Migrations

| Command | Description |
|---------|-------------|
| `npm run prisma:migrate:dev` | Create + apply a new migration (dev only) |
| `npm run prisma:migrate` | Apply existing migrations (production) |
| `npm run prisma:generate` | Regenerate Prisma client after schema changes |
| `npm run prisma:studio` | Open Prisma Studio GUI to inspect data |

---

## Deploying to Render.com

Render.com offers a free tier that's perfect for hosting this service.

### Step 1 — Push Code to GitHub

```bash
git init
git add .
git commit -m "feat: initial identity reconciliation service"
git remote add origin https://github.com/YOUR_USERNAME/bitespeed-identity-reconciliation.git
git push -u origin main
```

### Step 2 — Create a PostgreSQL Database on Render

1. Go to [render.com](https://render.com) → **New** → **PostgreSQL**
2. Fill in:
   - **Name**: `bitespeed-db`
   - **Database**: `bitespeed_identity`
   - **Region**: Choose the closest to your users
   - **Plan**: Free
3. Click **Create Database**
4. On the database page, copy the **Internal Database URL** (use this if your web service is also on Render) or the **External Database URL** (for local testing).

### Step 3 — Create a Web Service on Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repository
3. Fill in the settings:

   | Setting | Value |
   |---------|-------|
   | **Name** | `bitespeed-identity` |
   | **Region** | Same as your DB |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install && npm run build && npm run prisma:migrate` |
   | **Start Command** | `npm start` |
   | **Plan** | Free |

4. Under **Environment Variables**, add:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | Paste the **Internal** Database URL from Step 2 |
   | `NODE_ENV` | `production` |
   | `PORT` | `3000` |

5. Click **Create Web Service**

Render will build and deploy automatically. Your live endpoint will be:

```
https://bitespeed-identity.onrender.com/identify
```

> **Note**: Free-tier Render services spin down after 15 minutes of inactivity. The first request after sleep may take ~30 seconds. Upgrade to a paid plan to avoid cold starts.

### Step 4 — Verify Deployment

```bash
curl -s https://YOUR-SERVICE.onrender.com/health | jq

curl -s -X POST https://YOUR-SERVICE.onrender.com/identify \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","phoneNumber":"9999999999"}' | jq
```

---

## Project Structure

```
bitespeed-identity-reconciliation/
├── prisma/
│   ├── schema.prisma            # Database schema & Prisma config
│   └── migrations/              # SQL migration history
│       └── 20240101000000_init/
│           └── migration.sql
├── src/
│   ├── index.ts                 # Entry point: server startup + graceful shutdown
│   ├── app.ts                   # Express app factory (middleware, routes)
│   ├── lib/
│   │   └── prisma.ts            # Singleton Prisma client
│   ├── types/
│   │   └── identity.types.ts    # Shared TypeScript interfaces
│   ├── controllers/
│   │   └── identifyController.ts  # HTTP layer: validation, parsing, response
│   ├── services/
│   │   └── identityService.ts   # Core reconciliation algorithm
│   ├── routes/
│   │   └── identityRoutes.ts    # Express router
│   └── middleware/
│       └── errorHandler.ts      # Global error handler + 404 handler
├── .env.example                 # Template for environment variables
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

---

## Reconciliation Logic

The algorithm runs inside a **Serializable database transaction** to prevent race conditions.

```
INCOMING REQUEST { email?, phoneNumber? }
       │
       ▼
1. Find all Contacts matching email OR phoneNumber
       │
       ├─── No matches ──────────────────▶ CREATE new primary Contact
       │
       └─── Matches found
                 │
                 ▼
       2. Resolve "root primary" for each match
          (walk linkedId chain upward until linkPrecedence=primary & linkedId=null)
                 │
                 ├─── Single root ──────▶ Go to step 3
                 │
                 └─── Multiple roots ──▶ MERGE: oldest root wins
                                          Demote newer root(s) to secondary
                                          Re-link their secondaries to oldest root
                 │
                 ▼
       3. Check for new information
          Is email already in cluster? Is phoneNumber already in cluster?
                 │
                 ├─── All known ───────▶ No-op
                 │
                 └─── New info ────────▶ CREATE new secondary Contact
                 │
                 ▼
       4. Build consolidated response
          - Primary's email/phone FIRST
          - All unique emails/phones from secondaries
          - Array of all secondary IDs
```

### Key Design Decisions

- **Serializable transactions**: Prevents phantom reads and write skews when concurrent requests bridge overlapping clusters simultaneously.
- **Root resolution via chain traversal**: Correctly handles multi-hop secondary chains and stale `linkedId` references left by prior merges.
- **Oldest-wins merge**: When two separate primary clusters are bridged, the one with the earliest `createdAt` becomes the permanent primary.
- **Soft deletes**: The `deletedAt` field supports future data retention requirements without losing historical link integrity.
- **Type safety**: The entire stack is strictly typed from DB schema (Prisma) through service to controller, eliminating runtime type errors.
