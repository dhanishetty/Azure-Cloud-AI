param location string = resourceGroup().location
param clusterName string = 'aks-azure-cloud-ai'
param namespace string = 'rag-app'

// Same naming rule as data-ai.bicep, so these resolve to the resources Step 8 created
param suffix string = uniqueString(resourceGroup().id)
var storageName = 'stcloudai${suffix}'
var openaiName = 'oai-cloud-ai-${suffix}'

resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' existing = {
  name: clusterName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageName
}

resource openai 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: openaiName
}

// ---------- Built-in role IDs ----------
var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var queueMessageSender = 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'
var queueMessageProcessor = '8a0f0c08-91a1-4084-bc3d-661d67233fed'
var openaiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

// ---------- Identities ----------
resource idApi 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-api'
  location: location
}

resource idWorker 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-worker'
  location: location
}

// ---------- Federated credentials: trust the Kubernetes ServiceAccounts ----------
resource fedApi 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: idApi
  name: 'aks-sa-api'
  properties: {
    issuer: aks.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:${namespace}:sa-api'
    audiences: [ 'api://AzureADTokenExchange' ]
  }
}

resource fedWorker 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: idWorker
  name: 'aks-sa-worker'
  properties: {
    issuer: aks.properties.oidcIssuerProfile.issuerURL
    subject: 'system:serviceaccount:${namespace}:sa-worker'
    audiences: [ 'api://AzureADTokenExchange' ]
  }
}

// ---------- Role assignments: backend-api ----------
resource apiBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, idApi.id, blobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor)
    principalId: idApi.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, idApi.id, queueMessageSender)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueMessageSender)
    principalId: idApi.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiOpenai 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, idApi.id, openaiUser)
  scope: openai
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openaiUser)
    principalId: idApi.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Role assignments: ingestion-worker ----------
resource workerBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, idWorker.id, blobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor)
    principalId: idWorker.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, idWorker.id, queueMessageProcessor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueMessageProcessor)
    principalId: idWorker.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerOpenai 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, idWorker.id, openaiUser)
  scope: openai
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openaiUser)
    principalId: idWorker.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Search roles are assigned with the CLI (the service is in another resource group)
output apiClientId string = idApi.properties.clientId
output apiPrincipalId string = idApi.properties.principalId
output workerClientId string = idWorker.properties.clientId
output workerPrincipalId string = idWorker.properties.principalId
