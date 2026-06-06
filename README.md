# Tara — Finance Research Agent

AI-powered personal finance assistant built with Mastra SDK + Anthropic Claude + Postgres.

## Quick Start

### 1. Prerequisites
- Node.js 18+
- Postgres 14+ running locally (default: `localhost:5432`)
- Anthropic API key (get one at https://console.anthropic.com)

### 2. Install
```bash
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in:
#   ANTHROPIC_API_KEY=sk-ant-...
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tara
```

### 4. Create the database
```bash
psql -U postgres -c "CREATE DATABASE tara;"
```

### 5. Ingest sample data
```bash
# Ingest sample_a (default)
npm run ingest

# Or specify a different snapshot:
DATA_DIR=./data/sample_b npm run ingest
DATA_DIR=./data/sample_c npm run ingest

# For grading (hidden snapshot):
DATA_DIR=./data/sample_x npx tsx scripts/ingest.ts
```

### 6. Start the server
```bash
npm start
```

Server runs at http://localhost:3000

### 7. Test it
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "What was my biggest expense?"}'
```

### 8. Run evals
```bash
# Server must be running first
npm run eval
```

---

## API

### `POST /ask`
```json
// Request
{ "question": "How much did I spend on food last month?" }

// Response
{ "answer": "Your net food spend in February 2025 was INR 4,231.50 across 18 transactions." }
```

### `GET /health`
Returns `{ "status": "ok" }`.

### `GET /traces`
Returns the last 50 request traces for observability/debugging.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Required. Your Anthropic API key. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/tara` | Postgres connection string |
| `DATA_DIR` | `./data/sample_a` | Snapshot folder for ingest script |
| `PORT` | `3000` | HTTP server port |

---

## Tech Stack
- **Mastra SDK** — agent framework, tool calling loop
- **Anthropic Claude** (`claude-3-5-sonnet`) — LLM
- **Postgres 14** — data storage
- **Express 4** — HTTP server
- **TypeScript + tsx** — runtime (no build step needed)

---

## Deployed URL
🔗 `https://your-deployed-url.com`

> See DESIGN.md for schema, formulas, and architectural decisions.
