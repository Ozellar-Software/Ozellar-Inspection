# 10 — Azure deployment guide

Everything below is for **prod**; repeat with `-dev` names for a dev environment. Commands use Azure CLI (`az`) in Bash. Infra template: `starter/infra/main.bicep`.

## 0. Prerequisites
- Azure subscription + **Owner** (or Contributor + User Access Administrator) on it.
- Entra ID admin (to register apps and grant consent) — usually Microsoft 365 IT admin.
- Exchange Online admin (to restrict the email permission to one mailbox).
- A shared mailbox, e.g. `inspections@ozellar.com`.
- DNS access for `ozellar.com` (for `inspection.ozellar.com`).
- Tools: Azure CLI, Node 20, Git, (for mobile) Xcode + Android Studio, Apple Developer Program and Google Play Console accounts.

## 1. Pick region & names
```bash
LOC=centralindia                     # data residency near the team
az functionapp list-flexconsumption-locations -o table   # confirm Flex Consumption is offered in $LOC; else use southindia / southeastasia
RG=rg-ozellar-vir-prod
az group create -n $RG -l $LOC
```
Static Web Apps is served globally; its resource `location` only needs to be one of the SWA regions (e.g. `eastasia`).

## 2. Entra ID app registrations (Portal → Microsoft Entra ID → App registrations)
**a) VIR API**
- New registration "Ozellar VIR API", single tenant.
- *Expose an API* → Application ID URI `api://<api-client-id>` → add scope `access_as_user` (admins and users can consent).
- Note: **API client ID**, **tenant ID**.

**b) VIR Web (SPA)**
- New registration "Ozellar VIR Web", single tenant.
- *Authentication* → add platform **Single-page application**, redirect URIs: `https://inspection.ozellar.com`, `http://localhost:5173` (dev). For native apps add the Capacitor redirect (e.g. `msauth.com.ozellar.vir://auth` on iOS / the Android signature hash) when you reach Phase 2.
- *API permissions* → My APIs → Ozellar VIR API → `access_as_user` → **Grant admin consent**.
- Note: **Web client ID**.

**c) Guests** (external users): Entra → Users → Invite external user.

## 3. Deploy infrastructure (Bicep)
Edit `starter/infra/main.parameters.prod.json` (names, tenant id, API client id, Entra admin object id), then:
```bash
az deployment group create -g $RG -f starter/infra/main.bicep -p @starter/infra/main.parameters.prod.json
```
Creates: Log Analytics + Application Insights, Storage (photos container, soft delete, versioning), Key Vault, PostgreSQL Flexible Server (Entra auth, backups), Function App (Flex Consumption, Node 20, managed identity, role assignments on storage), Static Web App (Standard) linked to the Function App.

## 4. Database
```bash
PG=<pg-server-name>                        # from deployment output
# Entra admin for Postgres (a person or group) is set by Bicep. Sign in as that admin:
export PGPASSWORD=$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)
psql "host=$PG.postgres.database.azure.com dbname=postgres user=<admin-upn> sslmode=require" \
  -c "create database vir;"
psql "host=$PG.postgres.database.azure.com dbname=postgres user=<admin-upn> sslmode=require" \
  -c "select * from pgaadauth_create_principal('<function-app-name>', false, false);"
psql "host=$PG.postgres.database.azure.com dbname=vir user=<admin-upn> sslmode=require" -f starter/db/schema.sql
psql "host=$PG.postgres.database.azure.com dbname=vir user=<admin-upn> sslmode=require" <<'SQL'
grant usage on schema public to "<function-app-name>";
grant select, insert, update, delete on all tables in schema public to "<function-app-name>";
grant usage, select on all sequences in schema public to "<function-app-name>";
alter default privileges in schema public grant select, insert, update, delete on tables to "<function-app-name>";
alter default privileges in schema public grant usage, select on sequences to "<function-app-name>";
SQL
# Seed checklist + first admin:
(seed tool not built yet — see starter/tools/README.md; insert the checklist and first Admin manually for now)
```
Networking: start with "Allow public access from Azure services" + your office IP; for production move to a private endpoint + Function VNet integration.

## 5. Email (Microsoft Graph)
Recommended: let the Function App's **managed identity** send mail (no secrets).
```powershell
# Microsoft Graph PowerShell, as Entra admin
Connect-MgGraph -Scopes "Application.Read.All","AppRoleAssignment.ReadWrite.All"
$mi    = Get-MgServicePrincipal -Filter "displayName eq '<function-app-name>'"
$graph = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$role  = $graph.AppRoles | Where-Object { $_.Value -eq 'Mail.Send' }
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $mi.Id -PrincipalId $mi.Id -ResourceId $graph.Id -AppRoleId $role.Id
```
Then **restrict it to one mailbox** (Exchange Online PowerShell, as Exchange admin) — use *RBAC for Applications* (current recommendation) or an application access policy scoped to a mail-enabled security group containing only `inspections@ozellar.com`. Without this, the permission could send as any mailbox.
Set app setting `MAIL_SENDER=inspections@ozellar.com` on the Function App.

## 6. Web app configuration
`apps/web/.env.production`:
```
VITE_ENTRA_TENANT_ID=<tenant-id>
VITE_ENTRA_WEB_CLIENT_ID=<web-client-id>
VITE_API_SCOPE=api://<api-client-id>/access_as_user
VITE_API_BASE=/api
```
Function App settings (Bicep sets most): `ENTRA_TENANT_ID`, `API_AUDIENCE=api://<api-client-id>`, `PG_HOST`, `PG_DB=vir`, `PG_USER=<function-app-name>`, `PHOTOS_ACCOUNT`, `PHOTOS_CONTAINER=photos`, `MAIL_SENDER`, `ALLOWED_ORIGINS=https://inspection.ozellar.com,capacitor://localhost,https://localhost`.

## 7. CI/CD (GitHub Actions)
1. Create an Entra app registration "gh-deploy-vir", add a **federated credential** for your GitHub repo (`repo:<org>/<repo>:ref:refs/heads/main` and `…:environment:prod`).
2. Give it **Contributor** on `$RG`.
3. GitHub repo → Settings → Secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `SWA_DEPLOYMENT_TOKEN` (`az staticwebapp secrets list -n <swa> --query properties.apiKey -o tsv`), `FUNCTION_APP_NAME`.
4. Workflow `starter/.github/workflows/deploy.yml`: test → build web → deploy SWA → build API → deploy Functions. Pull requests get SWA preview URLs.

## 8. Custom domain
```bash
az staticwebapp hostname set -n <swa-name> -g $RG --hostname inspection.ozellar.com
```
Add the CNAME `inspection` → `<swa-default-hostname>` in the ozellar.com DNS first. SSL certificate is automatic.

## 9. Mobile apps (Capacitor)
```bash
cd apps/web
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/camera @capacitor/filesystem
npx cap init "Ozellar Inspection" com.ozellar.vir --web-dir dist
npx cap add ios && npx cap add android
npm run build && npx cap sync
npx cap open ios        # Xcode: signing team, camera usage text, then Archive → App Store Connect / TestFlight
npx cap open android    # Android Studio: signing key, then Play Console internal testing
```
Native apps call the Function App URL directly (CORS allows `capacitor://localhost`).

## 10. Monitoring & alerts
- Application Insights → alerts: Function failures > 5 in 5 min; p95 duration > 3 s; Postgres CPU > 80 %; storage capacity thresholds.
- Postgres backups: retention 14–35 days; test a restore once.
- Blob: soft delete 30 days, versioning on.

## 11. Go-live checklist
- [ ] Data migrated and counts reconciled (see `11-migration-plan.md`)
- [ ] All `03-feature-inventory.md` items pass UAT
- [ ] Email restricted to one mailbox and tested
- [ ] Alerts firing to the right people
- [ ] Old GitHub Pages app shows a "moved to inspection.ozellar.com" banner, Supabase set read-only
