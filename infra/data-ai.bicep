param location string = resourceGroup().location

@description('Makes globally unique names; stable for a given resource group')
param suffix string = uniqueString(resourceGroup().id)

param chatModel string = 'gpt-5-mini'
param chatModelVersion string = '2025-08-07'
param embedModel string = 'text-embedding-3-small'
param embedModelVersion string = '1'

var storageName = 'stcloudai${suffix}'
var searchName = 'srch-cloud-ai-${suffix}'
var openaiName = 'oai-cloud-ai-${suffix}'

// ---------- Storage: blob container + queue ----------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource documentsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'documents'
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource ingestQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'ingest-jobs'
}

// ---------- AI Search (Free tier: 1 per subscription, 50 MB) ----------
resource search 'Microsoft.Search/searchServices@2023-11-01' = {
  name: searchName
  location: location
  sku: { name: 'free' }
  properties: {
    replicaCount: 1
    partitionCount: 1
    hostingMode: 'default'
  }
}

// ---------- Azure OpenAI: account + chat and embedding deployments ----------
resource openai 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openaiName
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: openaiName
    publicNetworkAccess: 'Enabled'
  }
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openai
  name: 'chat'
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModel
      version: chatModelVersion
    }
  }
}

// Deployments on one account must be created one at a time
resource embedDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openai
  name: 'embeddings'
  dependsOn: [ chatDeployment ]
  sku: {
    name: 'GlobalStandard'
    capacity: 10
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: embedModel
      version: embedModelVersion
    }
  }
}

output storageName string = storage.name
output searchName string = search.name
output openaiName string = openai.name
