@description('Globally unique ACR name (5-50 lowercase alphanumeric)')
param acrName string

param location string = resourceGroup().location

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

output loginServer string = acr.properties.loginServer
