targetScope = 'resourceGroup'

@description('Azure region for the Container App.')
param location string = resourceGroup().location

@description('Name of the Azure Container App resource.')
param containerAppName string

@description('Resource ID of the existing Azure Container Apps environment.')
param containerAppsEnvironmentId string

@description('Container image reference for the SignalForge app.')
param image string

@description('Optional ACR server for the image registry.')
param registryServer string = ''

@description('Optional resource ID of a user-assigned identity with AcrPull on the registry.')
param registryIdentityResourceId string = ''

@description('CPU cores allocated to the app container.')
@allowed([
  '0.5'
  '1.0'
  '2.0'
])
param cpu string = '0.5'

@description('Memory allocated to the app container.')
@allowed([
  '1Gi'
  '2Gi'
  '4Gi'
])
param memory string = '1Gi'

@description('Minimum ACA replicas for the revision.')
@minValue(0)
param minReplicas int = 0

@description('Maximum ACA replicas for the revision.')
@minValue(1)
param maxReplicas int = 3

@description('Port exposed by the SignalForge container.')
param targetPort int = 3000

@description('Postgres connection string for SignalForge production-style storage.')
@secure()
param databaseUrl string

@description('Admin token for Sources UI and operator APIs.')
@secure()
param signalforgeAdminToken string

@description('LLM provider to enable. Leave empty for deterministic-only fallback.')
@allowed([
  ''
  'openai'
  'azure'
  'codex_app_server'
])
param llmProvider string = ''

@description('OpenAI API key when LLM_PROVIDER=openai.')
@secure()
param openAiApiKey string = ''

@description('OpenAI model override when LLM_PROVIDER=openai.')
param openAiModel string = 'gpt-5-mini'

@description('Azure OpenAI endpoint when LLM_PROVIDER=azure.')
param azureOpenAiEndpoint string = ''

@description('Azure OpenAI API key when LLM_PROVIDER=azure.')
@secure()
param azureOpenAiApiKey string = ''

@description('Azure OpenAI deployment name when LLM_PROVIDER=azure.')
param azureOpenAiDeployment string = ''

@description('Azure OpenAI API version for legacy Azure endpoints. Omit for /openai/v1 endpoints.')
param azureOpenAiApiVersion string = ''

@description('Codex App Server transport when LLM_PROVIDER=codex_app_server.')
@allowed([
  ''
  'stdio'
  'websocket'
])
param codexAppServerTransport string = ''

@description('Codex App Server model when LLM_PROVIDER=codex_app_server.')
param codexAppServerModel string = 'gpt-5.4'

@description('Codex App Server turn timeout in milliseconds.')
param codexAppServerTurnTimeoutMs string = '120000'

@description('Codex App Server WebSocket URL when using websocket transport.')
param codexAppServerWsUrl string = ''

@description('Allow non-loopback Codex App Server WebSocket URLs. Use only with authenticated private/tunnel endpoints.')
param codexAppServerWsAllowRemote bool = false

@description('Bearer token for Codex App Server WebSocket auth.')
@secure()
param codexAppServerWsBearerToken string = ''

@description('Optional revision suffix for the new deployment.')
param revisionSuffix string = ''

@description('Optional ACA ingress custom-domain bindings to apply or preserve.')
param customDomains array = []

@description('Tags applied to the Container App.')
param tags object = {
  app: 'signalforge'
  surface: 'aca'
  role: 'app'
}

var containerEnv = concat(
  [
    {
      name: 'DATABASE_DRIVER'
      value: 'postgres'
    }
    {
      name: 'DATABASE_URL'
      secretRef: 'database-url'
    }
    {
      name: 'SIGNALFORGE_ADMIN_TOKEN'
      secretRef: 'signalforge-admin-token'
    }
  ],
  llmProvider != '' ? [
    {
      name: 'LLM_PROVIDER'
      value: llmProvider
    }
  ] : [],
  llmProvider == 'openai' ? [
    {
      name: 'OPENAI_API_KEY'
      secretRef: 'openai-api-key'
    }
  ] : [],
  llmProvider == 'openai' && openAiModel != '' ? [
    {
      name: 'OPENAI_MODEL'
      value: openAiModel
    }
  ] : [],
  llmProvider == 'azure' && azureOpenAiEndpoint != '' ? [
    {
      name: 'AZURE_OPENAI_ENDPOINT'
      value: azureOpenAiEndpoint
    }
  ] : [],
  llmProvider == 'azure' ? [
    {
      name: 'AZURE_OPENAI_API_KEY'
      secretRef: 'azure-openai-api-key'
    }
  ] : [],
  llmProvider == 'azure' && azureOpenAiDeployment != '' ? [
    {
      name: 'AZURE_OPENAI_DEPLOYMENT'
      value: azureOpenAiDeployment
    }
  ] : [],
  llmProvider == 'azure' && azureOpenAiApiVersion != '' ? [
    {
      name: 'AZURE_OPENAI_API_VERSION'
      value: azureOpenAiApiVersion
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerTransport != '' ? [
    {
      name: 'CODEX_APP_SERVER_TRANSPORT'
      value: codexAppServerTransport
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerModel != '' ? [
    {
      name: 'CODEX_APP_SERVER_MODEL'
      value: codexAppServerModel
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerTurnTimeoutMs != '' ? [
    {
      name: 'CODEX_APP_SERVER_TURN_TIMEOUT_MS'
      value: codexAppServerTurnTimeoutMs
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerWsUrl != '' ? [
    {
      name: 'CODEX_APP_SERVER_WS_URL'
      value: codexAppServerWsUrl
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerWsAllowRemote ? [
    {
      name: 'CODEX_APP_SERVER_WS_ALLOW_REMOTE'
      value: 'true'
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerWsBearerToken != '' ? [
    {
      name: 'CODEX_APP_SERVER_WS_BEARER_TOKEN'
      secretRef: 'codex-app-server-ws-bearer-token'
    }
  ] : []
)

var containerSecrets = concat(
  [
    {
      name: 'database-url'
      value: databaseUrl
    }
    {
      name: 'signalforge-admin-token'
      value: signalforgeAdminToken
    }
  ],
  llmProvider == 'openai' ? [
    {
      name: 'openai-api-key'
      value: openAiApiKey
    }
  ] : [],
  llmProvider == 'azure' ? [
    {
      name: 'azure-openai-api-key'
      value: azureOpenAiApiKey
    }
  ] : [],
  llmProvider == 'codex_app_server' && codexAppServerWsBearerToken != '' ? [
    {
      name: 'codex-app-server-ws-bearer-token'
      value: codexAppServerWsBearerToken
    }
  ] : []
)

var templateBase = {
  containers: [
    {
      name: 'signalforge'
      image: image
      env: containerEnv
      probes: [
        {
          type: 'Startup'
          httpGet: {
            path: '/api/health'
            port: targetPort
            scheme: 'HTTP'
          }
          initialDelaySeconds: 3
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 12
        }
        {
          type: 'Readiness'
          httpGet: {
            path: '/api/health'
            port: targetPort
            scheme: 'HTTP'
          }
          initialDelaySeconds: 5
          periodSeconds: 10
          timeoutSeconds: 3
          failureThreshold: 3
        }
        {
          type: 'Liveness'
          httpGet: {
            path: '/api/health'
            port: targetPort
            scheme: 'HTTP'
          }
          initialDelaySeconds: 15
          periodSeconds: 15
          timeoutSeconds: 3
          failureThreshold: 3
        }
      ]
      resources: {
        cpu: json(cpu)
        memory: memory
      }
    }
  ]
  scale: {
    minReplicas: minReplicas
    maxReplicas: maxReplicas
  }
}

var appTemplate = empty(revisionSuffix)
  ? templateBase
  : union(templateBase, {
      revisionSuffix: revisionSuffix
    })

resource signalforgeApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: empty(registryIdentityResourceId)
    ? {
        type: 'SystemAssigned'
      }
    : {
        type: 'SystemAssigned, UserAssigned'
        userAssignedIdentities: {
          '${registryIdentityResourceId}': {}
        }
      }
  tags: tags
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        customDomains: customDomains
      }
      secrets: containerSecrets
      registries: !empty(registryServer) && !empty(registryIdentityResourceId)
        ? [
            {
              server: registryServer
              identity: registryIdentityResourceId
            }
          ]
        : []
    }
    template: appTemplate
  }
}

output containerAppId string = signalforgeApp.id
output defaultHostname string = signalforgeApp.properties.configuration.ingress.fqdn
