param location string = resourceGroup().location

// Log Analytics workspace: stores logs. The daily cap stops runaway ingestion costs.
resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-azure-cloud-ai'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: json('0.2')
    }
  }
}

// Application Insights (workspace-based): request, failure and latency telemetry from the apps
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-azure-cloud-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
  }
}

output workspaceId string = workspace.id
output appInsightsName string = appInsights.name
