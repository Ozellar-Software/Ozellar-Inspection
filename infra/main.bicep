// =====================================================================
// Ozellar VIR — Azure infrastructure (one environment per deployment)
//   az deployment group create -g <rg> -f infra/main.bicep -p @infra/main.parameters.prod.json
// Creates: Log Analytics, App Insights, Storage (photos + deployments), Key Vault,
// PostgreSQL Flexible Server (Entra auth), Function App (Flex Consumption, Node 20,
// managed identity), Static Web App (Standard) linked to the Function App.
// =====================================================================

@description('Short name used in resource names, e.g. ozvir')
@maxLength(10)
param prefix string = 'ozvir'

@allowed(['dev', 'prod'])
param env string = 'prod'

@description('Region for data + API (confirm Flex Consumption availability)')
param location string = resourceGroup().location

@description('Region for the Static Web App resource (content is served globally)')
param swaLocation string = 'eastasia'

@description('Entra tenant id')
param tenantId string = subscription().tenantId

@description('Audience of the API app registration, e.g. api://<api-client-id>')
param apiAudience string

@description('Object id of the Entra user/group that administers Postgres')
param pgAdminObjectId string

@description('UPN or group name of that Postgres admin')
param pgAdminName string

@allowed(['User', 'Group', 'ServicePrincipal'])
param pgAdminType string = 'User'

@description('Mailbox approval emails are sent from')
param mailSender string = 'inspections@ozellar.com'

@description('Public URL of the web app')
param appUrl string = 'https://inspection.ozellar.com'

var suffix = uniqueString(resourceGroup().id, prefix, env)
var names = {
  log: '${prefix}-${env}-log'
  appi: '${prefix}-${env}-appi'
  storage: take(toLower('${prefix}${env}${suffix}'), 24)
  kv: take('${prefix}-${env}-kv-${suffix}', 24)
  pg: '${prefix}-${env}-pg-${suffix}'
  plan: '${prefix}-${env}-plan'
  func: '${prefix}-${env}-api-${suffix}'
  swa: '${prefix}-${env}-web'
}
var appOrigins = [appUrl, 'capacitor://localhost', 'https://localhost', 'http://localhost:5173']
var storageBlobDataOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

// ---------------- Monitoring ----------------
resource log 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.log
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appi
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: log.id }
}

// ---------------- Storage (photos + function deployments) ----------------
resource st 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.storage
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false          // identity-only (user-delegation SAS still works)
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: st
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
    cors: {
      corsRules: [
        { // phones/browsers PUT photos straight to Blob with SAS URLs, and read them back
          allowedOrigins: appOrigins
          allowedMethods: ['GET', 'HEAD', 'PUT', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'photos'
  properties: { publicAccess: 'None' }
}

resource deployments 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'deployments'
  properties: { publicAccess: 'None' }
}

// ---------------- Key Vault ----------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kv
  location: location
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 30
    enablePurgeProtection: true
  }
}

// ---------------- PostgreSQL Flexible Server ----------------
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: names.pg
  location: location
  sku: { name: env == 'prod' ? 'Standard_B2s' : 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '16'
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: env == 'prod' ? 14 : 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    authConfig: { activeDirectoryAuth: 'Enabled', passwordAuth: 'Disabled', tenantId: tenantId }
    network: { publicNetworkAccess: 'Enabled' } // prod hardening: private endpoint + VNet integration
  }
}

resource pgAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: pg
  name: pgAdminObjectId
  properties: { principalName: pgAdminName, principalType: pgAdminType, tenantId: tenantId }
}

// Postgres child resources are created one after another (the server rejects parallel changes).
resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: pg
  name: 'vir'
  dependsOn: [pgAdmin]
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

resource pgAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: pg
  name: 'AllowAzureServices'
  dependsOn: [pgDb]
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// ---------------- Function App (Flex Consumption) ----------------
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: names.plan
  location: location
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource func 'Microsoft.Web/sites@2024-04-01' = {
  name: names.func
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${st.properties.primaryEndpoints.blob}deployments'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: { maximumInstanceCount: 40, instanceMemoryMB: 2048 }
      runtime: { name: 'node', version: '20' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      cors: { allowedOrigins: appOrigins }
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: st.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
        { name: 'ENTRA_TENANT_ID', value: tenantId }
        { name: 'API_AUDIENCE', value: apiAudience }
        { name: 'PG_HOST', value: pg.properties.fullyQualifiedDomainName }
        { name: 'PG_DB', value: 'vir' }
        { name: 'PG_USER', value: names.func }         // Postgres role created for the managed identity (see docs/10)
        { name: 'PHOTOS_ACCOUNT', value: st.name }
        { name: 'PHOTOS_CONTAINER', value: 'photos' }
        { name: 'MAIL_SENDER', value: mailSender }
        { name: 'APP_URL', value: appUrl }
        { name: 'ALLOWED_ORIGINS', value: join(appOrigins, ',') }
      ]
    }
  }
}

// Managed identity → storage (host storage, deployments, photos + user-delegation SAS) and Key Vault secrets
resource funcStorageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(st.id, func.id, storageBlobDataOwner)
  scope: st
  properties: {
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwner)
  }
}

resource funcKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, func.id, keyVaultSecretsUser)
  scope: kv
  properties: {
    principalId: func.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
  }
}

// ---------------- Static Web App (front end) linked to the API ----------------
resource swa 'Microsoft.Web/staticSites@2023-12-01' = {
  name: names.swa
  location: swaLocation
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

resource swaBackend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: swa
  name: 'api'
  properties: { backendResourceId: func.id, region: location }
}

output functionAppName string = func.name
output functionAppUrl string = 'https://${func.properties.defaultHostName}'
output functionPrincipalId string = func.identity.principalId
output staticWebAppName string = swa.name
output staticWebAppHostname string = swa.properties.defaultHostname
output postgresHost string = pg.properties.fullyQualifiedDomainName
output storageAccount string = st.name
output keyVault string = kv.name
