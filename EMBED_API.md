# Embed API (`/api/embed/*`)

A small, **read-only** surface that lets other ADDMAN apps embed a user's own
smartChart **charts** ("components") and **projects** ("dashboards") — most
notably **the-platform**, which re-renders the returned data natively.

## Authentication

Unlike the rest of the API (which uses a smartChart-issued JWT), these routes
authenticate with a **Keycloak *access token* from the shared `addmangroup`
realm**. The calling app forwards the signed-in user's existing bearer:

```
Authorization: Bearer <keycloak access token>
```

The token is verified against the realm JWKS (`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`,
RS256) and mapped to a local `User` by `keycloakId` (the Keycloak `sub`, email
fallback). No smartChart credential is minted, stored, or shared. See
`server/modules/verifyKeycloakToken.js`. Requires `KEYCLOAK_ISSUER` to be set
(it already is for SSO login).

Access to individual charts/projects is still enforced per request by the
caller's `TeamRole`s (team owners/admins see the whole team; project-scoped
roles only see whitelisted projects; a global smartChart `admin` bypasses).

## Endpoints

| Method & path | Returns |
|---|---|
| `GET /api/embed/mine` | Catalog for a picker: `{ linked, teams:[{id,name}], projects:[{id,name,brewName,team_id,chartCount,charts:[{id,name,type}]}] }`. `linked:false` when the Keycloak user has no smartChart account yet (valid token, empty catalog — not a 401). |
| `GET /api/embed/chart/:id` | Render-ready data for one chart — the `getEmbeddedChartData` object (`{ id,name,type,chartData:{data,options},... }`). `403` if not accessible, `404` if unknown. |
| `GET /api/embed/project/:id` | `{ project:{id,name,brewName}, charts:[<getEmbeddedChartData>...] }` for a whole dashboard. |

All three are rate-limited (60/min) and `GET`-only. `chartData` is smartChart's
last-computed Chart.js config (no live datasource re-run).

Implemented in `server/api/EmbedRoute.js`, registered in `server/api/index.js`.
