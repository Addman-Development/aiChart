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

## Scope — dashboards the caller created

An embedded dashboard is personal, so this surface is deliberately **narrower**
than smartChart's own dashboard list. A project is visible only when all three
hold:

1. the caller has a **`ProjectRole`** for it — i.e. they created it
   (`ProjectController.create` writes one; `Project` has no owner column, so this
   is the only ownership record available);
2. it is **not a ghost project** (`ghost: true`) — the per-team holding pen for
   AI-generated scratch charts, which every smartChart surface hides; and
3. the caller is **still on the owning team**, so leaving a team also revokes
   embedding.

Notably this means team owners/admins do **not** get the whole team here, and a
global smartChart `admin` gets **no bypass** — neither may surface a colleague's
work in a sibling app. Dashboards shared with the caller via the
`TeamRole.projects[]` whitelist but created by someone else are also excluded.

The auto-created `"Ghost Project"` and `"Your First Dash"` are built with a bare
`db.Project.create` and hold no `ProjectRole`, so both fall out of the catalog for
free. `models/scripts/backfillProjectRoles.js` (run by migration
`20260728120000-backfill-project-roles`) assigns any pre-existing non-ghost project
with no `ProjectRole` to its team owner, so nothing real can go missing.

## Endpoints

| Method & path | Returns |
|---|---|
| `GET /api/embed/mine` | Catalog for a picker: `{ linked, teams:[{id,name}], projects:[{id,name,brewName,ghost,team_id,chartCount,charts:[{id,name,type}]}] }`. `linked:false` when the Keycloak user has no smartChart account yet (valid token, empty catalog — not a 401). `ghost` is always `false` given the filter above, and is present so a consumer can hide ghosts itself when talking to an older deployment. |
| `GET /api/embed/chart/:id` | Render-ready data for one chart — the `getEmbeddedChartData` object (`{ id,name,type,chartData:{data,options},content,ranges,... }`). `403` if not accessible, `404` if unknown. |
| `GET /api/embed/project/:id` | `{ project:{id,name,brewName}, charts:[<getEmbeddedChartData>...] }` for a whole dashboard. |

All three are rate-limited (60/min) and `GET`-only. `chartData` is smartChart's
last-computed Chart.js config (no live datasource re-run). Both `/mine` and
`/project/:id` exclude **draft** charts, so a whole-dashboard embed matches what
the catalog advertised.

### Fields consumers need per chart type

`getEmbeddedChartData` covers all twelve `Chart.type` values. Three do not use the
`chartData.data.{labels,datasets}` axis shape:

- **`table`** — `chartData` is keyed per dataset:
  `{ [datasetKey]: { columns:[{Header,accessor,columns?}], data:[{[accessor]:value}] } }`.
  Array-valued cells are prefixed `__cb_array` before their JSON. Page size is
  `defaultRowsPerPage`.
- **`kpi`/`avg`** — one tile per dataset. Growth is `chartData.growth[i]`
  (`{value,comparison,status,label}`, gated on `showGrowth`); goals are
  `chartData.goals[]` matched by **`goalIndex`**, not array position.
- **`gauge`** — bands come from `ranges` (`[{min,max,label,color}]`); the needle is
  the last value of the first dataset.
- **`matrix`** — first dataset only; points are `{x:ISO date, y:day, v, d:pretty}`
  with `_meta:{datasetColor,domainMin,domainMax}`.
- **`markdown`** — no dataset at all; the body is `content`.

Implemented in `server/api/EmbedRoute.js`, registered in `server/api/index.js`.
