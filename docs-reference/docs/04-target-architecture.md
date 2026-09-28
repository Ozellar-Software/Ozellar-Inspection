# 04 — Target architecture on Azure

## Summary
**React + TypeScript PWA** (also packaged as iOS/Android apps with **Capacitor**) on **Azure Static Web Apps**, calling an **Azure Functions** API (TypeScript) that owns all business rules, with **Azure Database for PostgreSQL** for data, **Blob Storage** for photos, **Microsoft Entra ID** for sign-in, and **Microsoft Graph** for email. Offline-first sync stays.

## Diagram
```
                    ┌──────────────────────── Microsoft Entra ID ────────────────────────┐
                    │  ozellar.com accounts + guest users · app roles / groups           │
                    └───────────────▲──────────────────────────────▲─────────────────────┘
                                    │ MSAL sign-in (PKCE)          │ token validation
┌──────────── Clients ─────────────┴──────┐                        │
│ Web / installed PWA (laptop, phone)     │                        │
│ iOS & Android apps (Capacitor wrapper)  │                        │
│  └ local DB (IndexedDB via Dexie)       │                        │
│  └ outbox queue + photo upload queue    │                        │
│  └ on-device PDF (offline fallback)     │                        │
└───────┬───────────────────────┬─────────┘                        │
        │ HTTPS (static files)  │ HTTPS /api/* + Bearer token       │
        ▼                       ▼                                   │
 Azure Static Web Apps ──linked backend──► Azure Functions (Node 20, Flex Consumption)
 (Standard plan, custom domain,           │  managed identity ─────┘
  inspection.ozellar.com)                 ├─► Azure Database for PostgreSQL Flexible Server
                                          │     (Entra auth for the Function's identity)
                                          ├─► Azure Blob Storage  (private "photos" container;
                                          │     phones upload/download with short-lived SAS URLs)
                                          ├─► Microsoft Graph  (send mail from inspections@ozellar.com)
                                          └─► Application Insights (logs, errors, metrics)
 Key Vault (any remaining secrets) · GitHub Actions (CI/CD, OIDC to Azure) · Bicep (infra as code)
```

## Components
| Component | Azure service / tech | Why |
|---|---|---|
| Web front end | **Static Web Apps (Standard)** | global CDN, free SSL, custom domain, preview environments per pull request, linked backend |
| Mobile apps | **Capacitor** wrapping the same React build | App Store / Play Store, reliable storage for hundreds of photos, native camera, background upload, push notifications |
| API | **Azure Functions**, Node 20, **Flex Consumption** plan | pay-per-use, scales to zero, VNet support; TypeScript shares code with the app |
| Database | **Azure Database for PostgreSQL – Flexible Server** | relational, managed backups & patching, Entra (passwordless) auth |
| Photos | **Blob Storage** (private container) | cheap, no size ceiling; direct phone→Blob upload with SAS so the API never streams images |
| Sign-in | **Microsoft Entra ID** (MSAL) | company SSO, MFA, leavers lose access automatically; guests for external users |
| Email | **Microsoft Graph** `sendMail` (application permission, restricted to one mailbox) | emails from @ozellar.com, no third-party service |
| Secrets | **Key Vault** + managed identities | no passwords in code or pipelines |
| Monitoring | **Application Insights** + Log Analytics | errors, slow calls, usage |
| CI/CD | **GitHub Actions** with OIDC | build, test, deploy on push; no stored Azure secrets |
| Infra | **Bicep** | whole environment reproducible (dev / prod) |

## Key decisions
| # | Decision | Chosen | Alternatives considered |
|---|---|---|---|
| D1 | Hosting | Static Web Apps + Functions | App Service (always-on cost, more than needed); VM (patching/security burden) |
| D2 | Language | TypeScript end-to-end | .NET back end (equally valid if IT prefers C#: ASP.NET Core / .NET Functions + EF Core + QuestPDF) |
| D3 | Auth | Entra ID via MSAL + Bearer tokens to the API | SWA built-in cookie auth (simpler for web, awkward for native apps) |
| D4 | Mobile | PWA **and** Capacitor apps from one codebase | PWA only (iOS limits: no background sync, storage eviction risk); React Native (second codebase) |
| D5 | Offline | local-first with outbox; server authoritative for approvals/locks | online-only (unusable at sea) |
| D6 | Photos | Blob Storage, direct SAS upload, resumable queue | base64 in DB (current; too heavy) |
| D7 | PDF | on-device (works offline, current proven design) **plus** optional server PDF later for very large reports | server-only (needs signal) |
| D8 | Data model | normalised Postgres tables | keep generic `records` JSON table (hard to query/report/secure) |
| D9 | Email | Microsoft Graph | Azure Communication Services Email (fine alternative); EmailJS/Gmail (not corporate) |

## Environments
| Env | Purpose | Notes |
|---|---|---|
| `dev` | development & preview | SWA preview environments per PR, small Postgres |
| `prod` | live | custom domain, backups ≥ 14 days, alerts |

## Mobile (Capacitor) notes
- Same React build is copied into the native shell (`npx cap sync`).
- Sign-in on native uses the system browser with a redirect back to the app (MSAL + a Capacitor auth plugin, or a custom-scheme redirect). Decide the plugin during Phase 2 and test on real iPhones early.
- Local data on native can stay in IndexedDB (Dexie) or move to SQLite (`@capacitor-community/sqlite`) if storage limits appear.
- Photos on native: save the original to the app's file storage, upload from the queue (survives app restarts).
