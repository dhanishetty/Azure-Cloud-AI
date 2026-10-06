# Frontend Migration Guide: plain JS → React + Vite + TypeScript

Reference for how the frontend was migrated and how to extend it. The focus of this
project is Azure and AI, so the frontend is deliberately thin: a static SPA, no
server-side rendering, all intelligence in the Python backend.

## 1. Stack and why

| Tool | Role |
|---|---|
| Vite | Dev server and build tool. Output is static files in `dist/`. |
| React + TypeScript | UI and typed API contracts. |
| Tailwind CSS v4 | Styling via utility classes. Theme tokens live in `src/index.css` (`@theme`). |
| React Router | One route per feature (tabs). Features are lazy-loaded. |
| TanStack Query | Fetching, caching, polling, loading and error state. |
| Framer Motion | Animations. |
| lucide-react | Icons. |
| react-markdown | Renders markdown in LLM answers. |

Not used (add when needed): shadcn/ui (copy components in with its CLI), Zustand
(global state), Recharts/ECharts (charts for the sentiment and topic tabs).

## 2. Layout

```
Frontend/
├── Dockerfile              # multi-stage: node build -> nginx
├── nginx.conf.template     # unchanged; serves SPA + proxies /api
├── vite.config.ts          # dev proxy: /api -> http://localhost:8000
├── index.html
└── src/
    ├── main.tsx            # React root, QueryClient, Router
    ├── index.css           # Tailwind + theme tokens + glass/gradient helpers
    ├── app/
    │   ├── App.tsx         # routes (lazy-loaded)
    │   ├── Layout.tsx      # header + tab nav
    │   └── features.ts     # single list that drives the nav tabs
    ├── components/         # shared UI (ComingSoon placeholder)
    ├── lib/api.ts          # ALL backend calls + response types
    └── features/
        ├── rag-chat/            # live: upload, document list, chat
        ├── architecture/        # live: request flow + /info config
        ├── youtube-sentiment/   # placeholder
        └── topic-modeling/      # placeholder
```

## 3. What changed from the old frontend

- `public/index.html`, `app.js`, `styles.css` were replaced by the React app.
  The original still exists in `rag-qa-app/frontend`.
- API contract is unchanged: `/api/info`, `/api/documents`,
  `/api/documents/{id}/status`, `/api/ask`. nginx still strips `/api` and proxies
  to `BACKEND_URL`.
- Hand-written polling loops became TanStack Query `refetchInterval`
  (3s while a document is queued/processing, 15s otherwise).
- Selected document is still remembered in `localStorage` (`rag-qa-doc-id`).
- Answers render as markdown instead of a bold-only regex.
- `nginx.conf.template` needed no change (SPA fallback via `try_files` already exists).

## 4. Run locally

```bash
cd Code/Frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to localhost:8000
# different backend:
BACKEND_URL=https://my-backend.example.com npm run dev
npm run build        # type-check + production build into dist/
```

Docker (same as before):

```bash
docker build -t rag-frontend .
docker run -p 8080:80 -e BACKEND_URL=http://host.docker.internal:8000 rag-frontend
```

## 5. Add a new feature tab (the repeatable recipe)

Example: sentiment goes live.

1. Add endpoints to `src/lib/api.ts` (types + functions).
2. Build the page in `src/features/youtube-sentiment/` (replace `ComingSoon`).
3. Flip `ready: true` in `src/app/features.ts`.
4. Route already exists in `App.tsx`; for a brand-new feature add a lazy import and a `<Route>`.
5. Backend: expose it under its own prefix (`/api/sentiment/...`). nginx already forwards all of `/api/`.

For **live** data (sentiment) prefer Server-Sent Events: `new EventSource("/api/sentiment/stream?video=...")`
(FastAPI `StreamingResponse`), or WebSockets/Azure Web PubSub for two-way. nginx needs
`proxy_buffering off;` on SSE locations and a long `proxy_read_timeout`.

For **long jobs** (topic modeling): `POST` creates a job and returns an id, then poll
`/status` with `refetchInterval` (the same pattern the document list uses), then fetch results.

## 6. Azure hosting options

| Option | Notes |
|---|---|
| **Static Web Apps** | Best fit for a static SPA. Free tier, CDN, GitHub Actions deploy. Backend linked via `/api` rewrite or a separate Container App with CORS. `staticwebapp.config.json` replaces nginx (needs a SPA fallback route). |
| **Container Apps** (current Dockerfile) | Works as-is. Scales to zero. Set `BACKEND_URL` to the backend's internal FQDN. |

Both deploy with Bicep and GitHub Actions (OIDC login). Use the **dhanishetty@gmail.com**
Azure account for this project.

## 7. Next steps (suggested)

- Streaming answers (SSE) and source-citation cards in the chat.
- Charts: Recharts or ECharts for sentiment over time and topic maps.
- shadcn/ui for dialogs/tabs when needed (`npx shadcn@latest init`).
- Frontend config at build time via `import.meta.env.VITE_*`, not runtime secrets. Never put keys in the frontend.
- App Insights browser SDK for the "system status" page.
