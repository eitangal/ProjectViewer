# GitLens-Portal (`ProjectViewer`)

> **Multi-Tenant, Zero-Trust Git Repository Projection & ACL-Enforced Gemini RAG Portal**

GitLens-Portal allows repository owners (**Publishers**) to expose strictly filtered subsets of private or public GitHub repositories to external stakeholders (**Viewers**—clients, auditors, partners) without granting GitHub repository access, repository cloning privileges, or exposing commit history. It features an ACL-aware **Google Gemini RAG assistant** powered by the publisher's own API key (BYOK), all governed by a **System Administrator (SysAdmin)**.

---

## 🌟 Core Architecture Pillars

1. **Zero-Trust Git Projection:** The portal acts as a read-only sanitizing proxy over Git. Viewers never interact with `.git` or commit logs; they only access the materialized HEAD of the configured branch strictly filtered through path-level Access Control Lists (ACLs). File contents are streamed directly from shallow bare repository packfiles into memory on demand with zero working-tree disk overhead.
2. **ACL-Enforced RAG (Zero-Leakage Vector Search):** Rather than building separate vector indices per viewer group, the repository is indexed once per commit delta, tagging every vector chunk with its relative file path (`file_path`). At query time, the viewer's effective group ACL rules are compiled into a metadata pre-filter on the vector query (`sqlite-vec`), guaranteeing that retrieval never touches or leaks unauthorized content.
3. **BYOK (Bring Your Own Key) Economics:** Heavy embedding generation (`gemini-embedding-001`) and LLM chat completions (`gemini-3.8-flash` / `gemini-3.5-flash-lite`) are billed directly to the Publisher's Google Gemini API key (`@google/genai` SDK), encrypted at rest using AES-256-GCM.
4. **Embedded-First, Small-VM Friendly:** Single Node.js 22 process using `better-sqlite3` and `sqlite-vec` (`vec0`) in a single `.db` file, designed to run smoothly on small VMs (1–2 vCPU, 2–4 GB RAM).

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v22.0.0 or higher
- **Git**: Installed and available in `$PATH`
- **npm**: v10+

### 2. Setup & Installation
```bash
# Clone the repository
git clone https://github.com/eitangal/ProjectViewer.git
cd ProjectViewer

# Install dependencies
npm install

# Copy environment variables template
cp .env.example .env
```

### 3. Run Development Servers
```bash
# Terminal 1: Start Fastify Backend API
npm run dev:backend

# Terminal 2: Start Vite Frontend (with hot reload & API proxy)
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

- Default root SysAdmin email: `admin@gitlens-portal.local`
- In development mode without a Brevo API key, 6-digit verification OTP codes and 1-click magic links are logged directly to the server console output.

---

## 📧 Brevo Transactional Email REST API Configuration

GitLens-Portal uses **Brevo** (formerly Sendinblue) HTTPS REST API (`https://api.brevo.com/v3/smtp/email`) to deliver passwordless 1-click Magic Links and 6-digit verification OTP codes to invited Publishers and Viewers.

Using the Brevo REST API with an API key eliminates port blocking and firewall restrictions typically associated with SMTP relays (ports 587/465).

### Environment Variables (`.env`)

To enable outbound email delivery via Brevo's REST API, set the following environment variables in `.env`:

```bash
# Brevo API Key (starts with xkeysib-...)
BREVO_API_KEY=xkeysib-your-generated-brevo-api-key

# Verified Sender Email Address in your Brevo account
BREVO_SENDER_EMAIL=noreply@your-verified-domain.com

# Sender Display Name (optional, defaults to "GitLens Portal")
BREVO_SENDER_NAME=GitLens Portal
```

#### How to Obtain Brevo API Credentials:
1. **Sign Up / Log In**: Access your Brevo dashboard at [app.brevo.com](https://app.brevo.com).
2. **Generate API Key**: Open your top-right profile menu &rarr; **SMTP & API** &rarr; **API Keys** tab *(NOT the SMTP tab)*.
   - Click **Generate a new API key**, give it a name (e.g. `GitLens-Portal`), and copy the key starting with `xkeysib-...` into `BREVO_API_KEY`.
3. **Verify Sender Address**: Navigate to **Senders & IP** &rarr; **Senders** and ensure your `BREVO_SENDER_EMAIL` address or sending domain has been validated via DKIM/SPF. *Brevo will reject transactional emails dispatched from unverified sender addresses.*
4. **SysAdmin Web Console**: You can also configure and test your Brevo API key live at runtime from the **SysAdmin Console &rarr; Brevo API Email Setup** tab.

---

## 🧪 Testing & Verification

Run the comprehensive automated unit and integration test suite (32 tests):
```bash
npm test
```

Type checking and production build:
```bash
npm run typecheck
npm run build
```

---

## 🐳 Docker Deployment

The application includes a production-ready `Dockerfile`, `docker-compose.yml`, and `Caddyfile` for automated HTTPS and reverse proxying:

```bash
docker compose up -d --build
```

---

## 📂 Project Structure

```
ProjectViewer/
├── Caddyfile                        # Reverse proxy & TLS config
├── Dockerfile                       # Multi-stage container build
├── docker-compose.yml               # App + Caddy service deployment
├── docs/
│   └── design/                      # Full system design documents
├── src/
│   ├── backend/
│   │   ├── app.ts                   # Fastify application factory
│   │   ├── server.ts                # Server entry point & scheduled sync
│   │   ├── auth/                    # Passwordless OTP/Magic Link & JWT auth
│   │   ├── db/                      # SQLite + sqlite-vec unified schema
│   │   ├── routes/                  # Admin, Publisher, Viewer, and Auth routes
│   │   ├── services/                # Bare Git manager, ACL matcher, Gemini RAG
│   │   ├── utils/                   # AES-256-GCM encryption & webhook verifier
│   │   └── workers/                 # Incremental delta sync & vector retrieval
│   ├── frontend/
│   │   ├── App.tsx                  # Main client shell & view switcher
│   │   ├── components/
│   │   │   ├── admin/               # SysAdmin Governance Console
│   │   │   ├── auth/                # Passwordless Login View
│   │   │   ├── publisher/           # Publisher Console, Live ACL Builder, Invites
│   │   │   ├── renderers/           # Markdown, Mermaid, Scalar OpenAPI, HTML, Shiki
│   │   │   └── viewer/              # Viewer Workspace (LTR/RTL), RAG Drawer
│   │   ├── store/                   # Zustand UI & navigation state
│   │   └── utils/                   # Link resolution & format sniffing
│   └── shared/
│       └── types.ts                 # Shared TypeScript models and interfaces
└── tests/                           # Vitest end-to-end and unit test suites
```

---

## 📄 License
MIT
