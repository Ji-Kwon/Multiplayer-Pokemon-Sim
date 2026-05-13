# Frontend — CLAUDE.md

React 18 + Vite + TypeScript. Tailwind for styling. No component library.

## Running the Frontend

```bash
npm run dev      # Vite dev server on port 5173
npm run build    # tsc + vite build → dist/
npm run preview  # preview production build
npm run test     # vitest run
```

## Key Dependencies

| Package | Purpose |
|---|---|
| react 18 + react-dom | UI framework |
| @tanstack/react-query 5 | Server state — all API calls |
| zustand 4 | Client state — auth session, battle state |
| socket.io-client 4 | WebSocket connection to battle server |
| tailwindcss 3 | Styling — utility classes only, no custom CSS unless unavoidable |
| vite 5 | Dev server + bundler |
| vitest | Tests |

## Environment Variables

```
VITE_API_URL=http://localhost:3000
```
Access as `import.meta.env.VITE_API_URL`. All `VITE_` prefixed vars are exposed to the browser.

## Vite Dev Proxy

`vite.config.ts` proxies `/api` and `/socket.io` to `http://localhost:3000` during development.
This means API calls can use relative paths (`/api/v1/teams`) — no need to reference `VITE_API_URL`
in most cases. The env var is for reference/production config.

## Directory Structure

```
frontend/src/
├── main.tsx              ← React root, QueryClientProvider, Router
├── App.tsx               ← top-level routes (scaffolded)
├── index.css             ← Tailwind directives only
├── pages/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── TeamList.tsx
│   ├── TeamBuilder.tsx
│   └── Battle.tsx
├── components/
│   ├── team-builder/     ← team builder sub-components
│   └── battle/           ← battle UI sub-components
├── stores/
│   ├── authStore.ts      ← zustand: current user session
│   └── battleStore.ts    ← zustand: live battle state
├── hooks/
│   └── useSocket.ts      ← socket.io-client connection hook
├── lib/
│   └── query-client.ts   ← React Query client instance
└── types/
    └── api.ts            ← shared API response types (written at end of Step 5)
```

## State Management Pattern

**React Query** — all server data (teams, pokemon list, learnsets, battle history).
Use `useQuery` for reads, `useMutation` for writes. Invalidate relevant queries after mutations.

**Zustand** — client-only state that doesn't belong in React Query:
- `authStore`: `{ user, token, login(), logout() }` — persisted to localStorage
- `battleStore`: `{ battleState, dispatch() }` — live battle state received over WebSocket

Do not put server data in Zustand. Do not put ephemeral UI state (modal open, hover) in Zustand — use `useState`.

## Styling Conventions

- Tailwind utility classes only. No inline `style={}` unless for dynamic values that can't be expressed as classes (e.g., HP bar width percentage).
- No custom CSS files except `index.css` (Tailwind directives).
- Dark mode: design for dark background (`bg-gray-900`) from the start — competitive Pokemon tools are conventionally dark-themed.
- Pokemon type colors: store as a static map `TYPE_COLORS: Record<string, string>` mapping type name to Tailwind class.

## API Call Pattern

```typescript
// All API calls through React Query — example:
const { data: teams } = useQuery({
  queryKey: ['teams'],
  queryFn: () => fetch('/api/v1/teams').then(r => r.json())
})

const createTeam = useMutation({
  mutationFn: (team: CreateTeamInput) =>
    fetch('/api/v1/teams', { method: 'POST', body: JSON.stringify(team) }).then(r => r.json()),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] })
})
```

Create a typed `apiClient` helper in `src/lib/api-client.ts` that wraps `fetch` with:
- Base URL prefix
- JSON headers
- Credential cookie inclusion (`credentials: 'include'`)
- Error throwing on non-2xx responses

## WebSocket Pattern

```typescript
// src/hooks/useSocket.ts
// Returns a stable socket instance. Connect once per battle, disconnect on cleanup.
// Battle state updates come via 'battle:state' events and are written to battleStore.
```

## TypeScript

Strict mode. Types for all API responses come from `src/types/api.ts`.
That file is the source of truth for what the backend returns — written at the end of Step 5
once the API is finalized. Do not duplicate type definitions.

## Testing

Component tests with vitest. Focus on team builder validation logic (EV cap, duplicate moves).
Battle UI does not need tests until the battle engine is stable.
