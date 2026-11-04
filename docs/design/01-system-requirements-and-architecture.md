This specification outlines **GitLens-Portal** (working title), a multi-tenant, fine-grained Git repository projection and ACL-enforced RAG portal. It allows repository owners to expose strictly filtered subsets of private or public GitHub repositories to external stakeholders (clients, auditors, partners) without granting GitHub repository access or cloning privileges, paired with an ACL-aware Gemini RAG assistant powered by the publisher's own API key.

## **1\. Service Concept & Core Architecture Pillars**

Traditional Git hosting platforms operate on an all-or-nothing read model at the repository level. Organizations frequently need to share living architecture specifications, OpenAPI contracts, compliance documentation, or specific module code inside a monorepo with external parties while hiding proprietary source code, internal configurations, and commit history.

> * **Zero-Trust Git Projection:** The service acts as a read-only, sanitizing proxy over Git. Viewers never interact with the underlying .git directory or commit history; they only see the materialized head of the configured branch filtered through path-level Access Control Lists (ACLs).  
> * **ACL-Enforced RAG (Zero-Leakage Vector Search):** A critical architectural requirement is that the LLM assistant must never hallucinate or leak content from restricted folders. Rather than building separate vector indices per Viewer Group, the system indexes the entire repository once per commit delta, tagging every vector chunk with its exact relative file path (file\_path). At query time, the viewer's group ACL rules are compiled into a metadata pre-filter on the vector query, ensuring retrieval only touches authorized chunks.  
> * **BYOK (Bring Your Own Key) Economics:** To keep platform hosting overhead near zero, compute-heavy embeddings and LLM completions are billed directly to the Publisher's Google Gemini API key (@google/genai SDK), encrypted at rest using AES-256-GCM.

## **2\. Actor Personas & Detailed Functional Requirements**

### **2.1 System Administrator (SysAdmin)**

**Role & Needs:** Platform operator responsible for tenant onboarding, infrastructure health, storage quotas, and global security settings.

> * **SYS-01 (Publisher Onboarding):** Invite Publishers via email. Generate time-bound, cryptographically signed invitation tokens.  
> * **SYS-02 (Tenant Governance):** View, suspend, or revoke Publisher accounts and associated projects. Configure per-publisher limits (max repositories, max disk quota per repo, max viewers).  
> * **SYS-03 (System Telemetry):** Monitor disk utilization of cloned bare repositories, vector index sizes, background Git sync queue health, and SMTP delivery statuses.  
> * **SYS-04 (Global Security & Auth):** Configure SMTP/transactional email provider settings, magic-link/OTP TTLs, and global rate-limiting policies.

### **2.2 Project Publisher**

**Role & Needs:** Technical lead, architect, or product owner who owns or has read access to a GitHub repository and needs to curate specific views and AI capabilities for external or internal reader cohorts.

> * **PUB-01 (Passwordless Onboarding):** Authenticate strictly via email verification (Magic Link or 6-digit OTP) sent to the email address invited by the SysAdmin.  
> * **PUB-02 (GitHub Integration):** Connect public or private GitHub repositories via GitHub App installation or fine-grained Personal Access Token (PAT) with Contents: Read-only permissions. Select target branch/tag to track.  
> * **PUB-03 (Sync Management):** Configure synchronization triggers: GitHub Webhook (push events), periodic polling interval (e.g., every 15 minutes), or manual "Sync Now" execution.  
> * **PUB-04 (Viewer Group & ACL Definition):** Create named Viewer Groups (e.g., *External API Partners*, *Security Auditors*, *Frontend Contractors*) and define granular filtering criteria per group:  
  * **Allowed Folders:** Explicit directory whitelist (e.g., /docs/architecture, /specs/openapi).  
  * **Allowed Extensions:** Whitelist of file types (e.g., .md, .yaml, .json, .mmd, .html).  
  * **Exclusion Glob Patterns:** Explicit deny rules that override allow rules (e.g., \*\*/\*.secret.\*, \*\*/internal/\*\*, .env\*).  
  * **Max File Size Filter:** Exclude large binaries or data dumps exceeding a threshold.  
> * **PUB-05 (ACL Preview / Impersonation):** "Preview as Group" mode allowing the Publisher to inspect the exact file tree and test the RAG chat interface as seen by any specific Viewer Group before sending invites.  
> * **PUB-06 (Viewer Invitation & Lifecycle):** Invite viewers by email (single or bulk CSV), assign them to one or more Viewer Groups (union of permissions), and revoke access instantly.  
> * **PUB-07 (Gemini BYOK & RAG Configuration):** Provide and validate a Google Gemini API Key. Select embedding model (e.g., text-embedding-004) and chat model (e.g., gemini-2.5-flash or gemini-2.5-pro), set custom system instructions for the project assistant, and define per-viewer daily token/query quotas to prevent billing spikes.

### **2.3 Project Viewer**

**Role & Needs:** Consumer of the curated repository subset (client, partner, team member) requiring fast, readable rendering of technical artifacts and natural language Q\&A across the documentation/codebase in both LTR and RTL languages.

> * **VIE-01 (Email Authentication):** Access invited projects via email verification (Magic Link / OTP). Support session persistence via HTTP-only secure JWT cookies.  
> * **VIE-02 (Dynamic Filtered File Tree):** View only the folders and files permitted by their assigned Viewer Group(s). Empty folders resulting from extension filtering are automatically pruned from the tree.  
> * **VIE-03 (Multi-Format Smart Rendering):** Switch seamlessly between **Formatted View** (default where applicable) and **Raw Text/Code View** (with syntax highlighting and line numbers):  
  * **Markdown (.md, .mdx):** GitHub-Flavored Markdown (GFM), tables, task lists, callouts, and embedded Mermaid code blocks.  
  * **Mermaid Diagrams (.mmd, .mermaid, or fenced blocks):** Interactive SVG rendering with pan, zoom, and diagram export controls.  
  * **OpenAPI / Swagger (.yaml, .yml, .json with openapi/swagger root keys):** Rendered interactive API documentation (Scalar or Swagger UI) showing endpoints, schemas, and request/response structures.  
  * **HTML (.html):** Rendered inside a strictly sandboxed iframe (DOMPurify \+ restrictive CSP disallowing scripts/top-navigation) or viewed as raw source.  
  * **Standard YAML / JSON / Source Code:** Syntax-highlighted code viewer with collapsible nodes and copy-to-clipboard buttons.  
> * **VIE-04 (Smart Link Resolution):** In Formatted View, all hyperlinks are clickable:  
  * **Relative Repo Links** (e.g., \[Auth Spec\](../specs/auth.yaml) or \#section-header): Intercepted by the client router. If the target file is permitted by the viewer's ACL, the viewer navigates directly to it inside the portal; if unauthorized, displays a clean "Access Restricted" toast.  
  * **External Web Links:** Open safely in a new browser tab (target="\_blank" rel="noopener noreferrer").  
> * **VIE-05 (RTL / LTR Bi-Directional Layout):** Global and per-document toggle between Left-to-Right (LTR) and Right-to-Left (RTL) layout modes. Switching to RTL flips the sidebar dock position, breadcrumbs, and document text alignment while preserving LTR directionality for code blocks (dir="ltr" on \<pre\>\<code\>) and Mermaid diagrams.  
> * **VIE-06 (ACL-Scoped RAG Assistant):** Interact with a slide-out or split-screen AI chat panel. Ask questions about the project and receive answers grounded strictly in their authorized file subset, complete with clickable inline citations (\[filepath:line\]) that open the referenced file in the main viewport. Only visible if the Publisher has configured a valid Gemini API key.

## **3\. UI/UX Architecture & User Flows**

### **3.1 Viewer Workspace UI**

The Viewer UI is designed as a distraction-free, high-density workspace:  
`+-----------------------------------------------------------------------------------+`  
`| [☰]  ProjectSelector ▾  |  repo / docs / arch / overview.md      [LTR|RTL] [✨ AI] |`  
`+-------------------------+------------------------------------+--------------------+`  
`| 🔍 Filter files...      | [Formatted] [Raw Code]             | 🤖 Project AI      |`  
`| 📁 docs                 |                                    |                    |`  
`|   📁 arch               | # System Architecture              | How does auth work?|`  
`|     📄 overview.md  <-- |                                    |                    |`  
`|     📊 auth-flow.mmd    | Below is the core service flow:    | Based on the spec: |`  
`| 📁 specs                | +--------------------------------+ | 1. Token issued... |`  
`|   🌐 openapi.yaml       | | [Interactive Mermaid Diagram]  | |                    |`  
`|                         | +--------------------------------+ | Sources:           |`  
`|                         | See [API Spec](../../specs/...)    | [📄 auth-flow.mmd] |`  
`+-------------------------+------------------------------------+--------------------+`

> * **Top Navigation Bar:**  
  * **Menu Icon (☰):** Toggles the file-tree sidebar open/closed (collapses into an off-canvas drawer on mobile/tablet or full-width reading mode on desktop).  
  * **Breadcrumbs:** Interactive path indicator (repo / folder / file.ext).  
  * **Direction Toggle (LTR \| RTL):** Instant layout direction switch (dir="rtl" / dir="ltr").  
  * **View Mode Switcher:** Segmented control (Formatted vs. Raw).  
  * **AI Assistant Toggle (✨ AI):** Opens/closes the contextual RAG drawer.  
> * **Collapsible Sidebar:** Virtualized file tree with file-type icons, quick fuzzy filename search (Cmd/Ctrl \+ P), and logical CSS margins (margin-inline-start) so indentation automatically mirrors in RTL mode.  
> * **Main Viewport:** Responsive container rendering the active artifact. Clicking a relative link or an AI source citation smoothly transitions the viewport and highlights the active node in the sidebar.

### **3.2 Publisher Console UI**

> * **Repository & Sync Tab:** Connection status badge, webhook URL \+ secret copy box, branch selector, last commit hash (SHA), sync history log, and "Trigger Delta Sync" button.  
> * **Viewer Groups & Rules Matrix:** Split-screen rule builder. Left side: glob/extension/folder rule inputs. Right side: live real-time preview of the repository tree highlighting included files in green and excluded files in muted gray.  
> * **Access & Invitations Tab:** Table of invited viewer emails, assigned group pills, last active timestamp, and bulk invite modal.  
> * **AI & RAG Configuration Tab:** Masked input for Gemini API Key with "Test Connection" button, indexing status bar (e.g., *412 chunks indexed across 68 files*), model dropdown, and token usage metrics.

### **3.3 Core Activity Flows**

#### **Flow A: Delta Git Sync \&Incremental Vector Indexing**

> 1. GitHub Webhook fires on push (or scheduled cron triggers).  
> 2. Background Worker runs git fetch origin \<branch\> on the local shallow bare clone (--depth 1).  
> 3. Worker computes git diff \--name-status \<old\_sha\> \<new\_sha\> to identify Added (A), Modified (M), and Deleted (D) files.  
> 4. For D and M files: Delete existing chunks in the vector store where repo\_id \= X AND file\_path IN (...).  
> 5. For A and M files: Read content from Git blob, split into semantic chunks (Markdown header-aware splitter for .md, AST/sliding-window for code/YAML), and batch-call the Gemini Embeddings API using the Publisher's decrypted Gemini API key.  
> 6. Insert new embeddings into the vector table with metadata (repo\_id, file\_path, start\_line, end\_line, content). Update last\_synced\_sha.

#### **Flow B: ACL-Scoped Viewer RAG Query**

> 1. Viewer submits a question in the AI Drawer.  
> 2. Backend resolves the Viewer's assigned Viewer Group(s) and compiles the effective list of permitted file\_path patterns.  
> 3. Backend embeds the user's query using the Publisher's Gemini API key.  
> 4. Backend executes a K-Nearest Neighbors (KNN) \+ Full-Text Search (BM25) hybrid query strictly filtered by WHERE repo\_id \= ? AND file\_path IN (authorized\_paths\_subquery).  
> 5. Retrieved chunks are assembled into a grounded prompt with system instructions enforcing citation format \[file\_path\].  
> 6. Response streams back to the Viewer via Server-Sent Events (SSE); UI parses \[file\_path\] citations into clickable router links.

## **4\. Modern Design & Implementation Direction**

To satisfy the requirement of running cleanly as a **standalone deployment on a small VM (e.g., 1–2 vCPU, 2–4 GB RAM)** while offering a **seamless path to horizontal scale**, the architecture avoids heavy JVM/distributed dependencies (like Elasticsearch or standalone Milvus clusters) in favor of an **Embedded-First, Modular Monolith** pattern.

### **4.1 Technology Stack Comparison (Small VM vs. Scaled Tier)**

| Architectural Layer | Small VM Standalone (1-2 vCPU / 2-4GB RAM) | Horizontal Scale-Out Path |
| :---- | :---- | :---- |
| **Application Runtime** | Single **Go** binary or **Node.js (Fastify/Next.js)** process | Stateless container replicas behind load balancer |
| **Database & Vector Store** | **SQLite \+ sqlite-vec** (or **LibSQL**) in a single local .db file | **PostgreSQL \+ pgvector** (or managed Turso/Qdrant) |
| **Git Operations** | Local disk /data/repos using shallow bare clones (git clone \--bare \--depth 1\) | Shared RWX volume (NFS/EFS) or ephemeral worker clones backed by S3 cache |
| **Job Queue & Cache** | Embedded SQLite-backed queue (e.g., Liteque / River) \+ in-memory LRU cache | **Redis / BullMQ** with dedicated sync/indexing worker nodes |
| **Reverse Proxy & TLS** | **Caddy** (automatic Let's Encrypt HTTPS, static asset compression) | Cloud Load Balancer / Ingress Controller \+ CDN |

### **4.2 Key Implementation Directives**

> * **Frontend Stack:** **React 19 / Next.js** (or **Vite \+ TanStack Router** if bundled into a single Go binary) styled with **Tailwind CSS v4** using logical properties (ms-\*, me-\*, ps-\*, pe-\*, text-start) for native zero-hack RTL/LTR switching.  
  * *Rendering Libraries:* react-markdown \+ rehype-sanitize \+ shiki (syntax highlighting), mermaid (diagrams), and @scalar/api-reference-react (lightweight modern OpenAPI/Swagger renderer).  
> * **Storage Efficiency on Small VMs:** Never check out working trees for every user. Use **bare repositories** (git clone \--bare \--depth 1 \--single-branch) and read file contents directly from Git packfiles into memory on demand via git cat-file blob HEAD:path/to/file or go-git / isomorphic-git. This keeps disk usage minimal and avoids filesystem inode exhaustion.  
> * **ACL Evaluation Engine:** Compile Viewer Group rules (Allowed Folders \+ Allowed Extensions \+ Exclude Globs) into a cached glob-matcher per (repo\_id, group\_id) invalidated only when a Publisher updates group settings or a new commit arrives.  
> * **Google GenAI Integration:** Use the official @google/genai (TypeScript) or google.golang.org/genai (Go) SDK. Store Publisher Gemini API keys encrypted with a master key injected via environment variable (MASTER\_ENCRYPTION\_KEY), decrypting strictly in-memory during embedding generation and chat streaming.  
> * **Single-Command Deployment:** Package the entire stack in a single docker-compose.yml containing two lightweight containers (app and caddy), mounting a single host volume (/var/lib/gitportal/data) for both the SQLite database file and the bare Git repositories.