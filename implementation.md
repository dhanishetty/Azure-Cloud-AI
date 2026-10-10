# Implementation Steps

Deploy the full app (frontend + backend) on AKS, with GitHub Actions for CI/CD.
Azure account: **dhanishetty@gmail.com** (not the work account).

## Rebuild From Scratch (Empty Subscription)

Use this when every Azure resource has been deleted. The code, Bicep files, workflows and manifests are all in this repo, so everything can be recreated. The steps below follow the original order. Details for each one are in the numbered step it points to.

**What survives a full delete**

| Still there | Gone |
|---|---|
| Repo, workflows, Bicep, manifests | `rg-portfolio` and everything in it (ACR, AKS, storage, OpenAI, monitoring) |
| GitHub secrets and the `ACR_NAME` variable | The shared AI Search service `rag-vector-store` |
| App registration, service principal and federated credential (Entra ID, not an Azure resource) | `User Access Administrator` on `rg-portfolio` (it goes with the group) |
| `Contributor` on the subscription (Step 2) | Uploaded PDFs, the search index, the Traefik IP and DNS name, the budget alert |

Resource names come back identical, because `uniqueString(resourceGroup().id)` gives the same value for the same group name.

**Rebuild order**

1. **Check the identity still exists.** Sign in as `dhanishetty@gmail.com`, then:
   ```powershell
   $appId = az ad app list --display-name Azure-Cloud-AI --query "[0].appId" -o tsv
   $subId = az account show --query id -o tsv
   az role assignment list --assignee $appId --scope "/subscriptions/$subId" -o table
   ```
   You should see `Contributor`. If the app is missing, redo Steps 2 to 4.

   ---

2. **Purge the soft-deleted OpenAI account.** Azure keeps a deleted OpenAI account for about 48 days, and the new one has the same name, so the deploy fails with a name conflict.
   ```powershell
   az cognitiveservices account list-deleted -o table
   az cognitiveservices account purge -l eastus -g rg-portfolio -n <deleted-account-name>
   ```

   ---

3. **Deploy ACR (Step 5).** Actions > **Deploy ACR (infra)** > Run workflow. It creates `rg-portfolio` and the registry.

   ---

4. **Give the pipeline `User Access Administrator` again (Step 6, item 3).** The role was on the old group, so it must be recreated on the new one.

   ---

5. **Build and push images (Step 5).** Actions > **Build and push images to ACR** > Run workflow.

   ---

6. **Deploy AKS (Step 6).** Actions > **Deploy AKS (infra)** > Run workflow.

   ---

7. **Change one line, then deploy Storage, Search and OpenAI (Step 8).** In `.github/workflows/deploy-data-ai.yml`, change `-p createSearch=false` to `-p createSearch=true`. The shared search service is gone and the Free slot is empty, so Bicep creates a new one named `srch-cloud-ai-<suffix>`. Commit and push, then run **Deploy Storage, Search and OpenAI (infra)**.

   ---

8. **Deploy identities and monitoring (Steps 9 and 12).** Run **Deploy Identity (infra)**, then **Deploy Monitoring (infra)**.

   ---

9. **Connect to the cluster and create the namespace and ServiceAccounts (Steps 6, 7 and 9).**
   ```powershell
   az aks get-credentials -g rg-portfolio -n aks-azure-cloud-ai --overwrite-existing
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/serviceaccounts.yaml
   ```

   ---

10. **Give the identities access to the new search service (Step 9, item 3).** The search service is now in `rg-portfolio` and has a new name, so the old commands change:
    ```powershell
    $search = az search service list -g rg-portfolio --query "[0].name" -o tsv
    $searchId = az search service show -g rg-portfolio -n $search --query id -o tsv
    $apiPid = az identity show -g rg-portfolio -n id-api --query principalId -o tsv
    $workerPid = az identity show -g rg-portfolio -n id-worker --query principalId -o tsv

    az search service update -g rg-portfolio -n $search --auth-options aadOrApiKey --aad-auth-failure-mode http401WithBearerChallenge

    az role assignment create --assignee-object-id $apiPid --assignee-principal-type ServicePrincipal --role "Search Index Data Contributor" --scope $searchId
    az role assignment create --assignee-object-id $workerPid --assignee-principal-type ServicePrincipal --role "Search Index Data Contributor" --scope $searchId
    az role assignment create --assignee-object-id $workerPid --assignee-principal-type ServicePrincipal --role "Search Service Contributor" --scope $searchId
    ```

    ---

11. **Create the ConfigMap again (Step 9, item 4), with the new search endpoint.** Use the item 4 commands, but set the search line from `$search`:
    ```powershell
    --from-literal="SEARCH_ENDPOINT=https://$search.search.windows.net"
    ```
    Every other line stays the same. The index `azure-cloud-ai-index` is created by the worker on the first upload.

    ---

12. **Install HTTPS (Step 11).** Add the Helm repos, install Traefik and cert-manager, then apply `cluster-issuers.yaml` and `ingress.yaml`. The public IP is new, but the DNS label `azure-cloud-ai` should be free again. If the name does not resolve, change it in `traefik-values.yaml` and `ingress.yaml`. To avoid Let's Encrypt rate limits when rebuilding often, try `letsencrypt-staging` first.

    ---

13. **Deploy the app (Step 10).** Actions > **Deploy to AKS** > Run workflow. Check that the pods are `Running`.

    ---

14. **Add monitoring to the cluster (Step 12, items 3 and 4).** Run `az aks enable-addons` and add the Application Insights connection string to `app-config`. Do not re-run **Deploy AKS (infra)** after this.

    ---

15. **Set the budget alert again (Step 14) and re-upload your PDFs.** Then open `https://azure-cloud-ai.eastus.cloudapp.azure.com` and ask a question.

> Three things differ from the first build: `createSearch=true` in `deploy-data-ai.yml`, the search role commands (item 10) and the `SEARCH_ENDPOINT` in the ConfigMap (item 11). Everything else uses the same commands as before.

## Table of Contents

- [Rebuild From Scratch (Empty Subscription)](#rebuild-from-scratch-empty-subscription)
- [Progress](#progress)
- [Files Created](#files-created)
- [Step 1: GitHub Repo](#step-1-github-repo)
- [Step 2: Azure Identity (OIDC)](#step-2-azure-identity-oidc)
- [Step 3: Repo Secrets](#step-3-repo-secrets)
- [Step 4: Repo Variable](#step-4-repo-variable)
- [Step 5: Run Order](#step-5-run-order) (ACR Bicep file, ACR and image build workflows explained)
- [Step 6: Deploy AKS](#step-6-deploy-aks) (AKS Bicep file and workflow explained)
- [Step 7: Deploy the Frontend to AKS](#step-7-deploy-the-frontend-to-aks) (namespace, frontend and backend Service manifests explained)
- [Step 8: Deploy Storage, AI Search and OpenAI](#step-8-deploy-storage-ai-search-and-openai) (data Bicep file and workflow explained)
- [Step 9: Deploy the Backend and Worker with Managed Identity](#step-9-deploy-the-backend-and-worker-with-managed-identity) (identity Bicep file and workflow, ServiceAccounts, backend and worker manifests explained)
- [Step 10: Deploy to AKS Automatically (CI/CD)](#step-10-deploy-to-aks-automatically-cicd) (deploy-app workflow explained)
- [Step 11: HTTPS and a Stable URL](#step-11-https-and-a-stable-url) (Traefik values, issuers and Ingress explained)
- [Step 12: Monitoring](#step-12-monitoring) (monitoring Bicep file and workflow explained)
- [Step 13: Hardening](#step-13-hardening)
- [Step 14: Budget Alert](#step-14-budget-alert)
- [To Do Before Making the Repo Public](#to-do-before-making-the-repo-public)
- [Later Steps](#later-steps)

## Progress

| Step | Task | Status |
|---|---|---|
| 1 | Create GitHub repo and push code | Done |
| 2 | Create Azure identity (OIDC) | Done |
| 3 | Add repo secrets | Done |
| 4 | Add repo variable `ACR_NAME` | Done |
| 5 | Run `deploy-acr`, then `build-push-images` | Done |
| 6 | Deploy AKS cluster | Done |
| 7 | Deploy frontend to AKS | Done |
| 8 | Deploy Storage, AI Search and OpenAI | Done |
| 9 | Deploy backend and worker with managed identity | Done |
| 10 | Deploy to AKS automatically (CI/CD) | Done |
| 11 | HTTPS and a stable URL | Done |
| 12 | Monitoring | Done |
| 13 | Hardening (no keys, HTTPS only) | Done |
| 14 | Budget alert | Done |

## Files Created

| File | Purpose |
|---|---|
| `infra/acr.bicep` | Defines the Azure Container Registry (Basic tier) |
| `.github/workflows/deploy-acr.yml` | Deploys the resource group and ACR |
| `.github/workflows/build-push-images.yml` | Builds and pushes `frontend`, `backend-api`, `ingestion-worker` to ACR |
| `infra/aks.bicep` | Defines the AKS cluster (Free tier, 1 node) and the AcrPull role |
| `.github/workflows/deploy-aks.yml` | Deploys the AKS cluster (manual run) |
| `k8s/namespace.yaml` | Creates the `rag-app` namespace |
| `k8s/frontend.yaml` | Frontend Deployment and public LoadBalancer Service |
| `k8s/backend-api-service.yaml` | Placeholder backend Service (no pods yet) |
| `infra/data-ai.bicep` | Defines Storage (blob + queue), AI Search (Free) and Azure OpenAI with two deployments |
| `.github/workflows/deploy-data-ai.yml` | Deploys the Storage, Search and OpenAI resources (manual run) |
| `infra/identity.bicep` | Managed identities, federated credentials and Storage/OpenAI role assignments |
| `.github/workflows/deploy-identity.yml` | Deploys the identities and roles (manual run) |
| `k8s/serviceaccounts.yaml` | ServiceAccounts `sa-api` and `sa-worker` for Workload Identity |
| `k8s/backend-api.yaml` | Backend Deployment (managed identity, settings from `app-config`) |
| `k8s/ingestion-worker.yaml` | Worker Deployment (managed identity, settings from `app-config`) |
| `.github/workflows/deploy-app.yml` | Deploys the SHA-tagged images to AKS after each successful build |
| `k8s/platform/traefik-values.yaml` | Traefik ingress settings (DNS label, small limits) |
| `k8s/platform/cluster-issuers.yaml` | Let's Encrypt staging and production issuers |
| `k8s/ingress.yaml` | HTTPS Ingress for the app |
| `infra/monitoring.bicep` | Log Analytics workspace (daily cap) and Application Insights |
| `.github/workflows/deploy-monitoring.yml` | Deploys the monitoring resources (manual run) |

## Step 1: GitHub Repo

**Why:** GitHub Actions only runs from GitHub. The current `origin` is Azure DevOps.

1. On github.com/new, create an empty repo (named `Azure-Cloud-AI`). Leave README, .gitignore and license unchecked.
2. Initialize and push from the `dhanishetty/` folder:
   ```powershell
   cd C:\Users\dhani\OneDrive\Desktop\Projects\dhanishetty
   git init -b main
   git add .
   git status
   ```
3. Check `git status`: `node_modules/`, `__pycache__/` and `dist/` must not be listed. The root `.gitignore` already excludes them.
4. Commit and push:
   ```powershell
   git commit -m "Initial commit: app code, Bicep, workflows"
   git remote add origin https://github.com/<your-username>/Azure-Cloud-AI.git
   git push -u origin main
   ```

**What each command does**

| Command | Purpose |
|---|---|
| `git init -b main` | Turns the folder into a git repo with a `main` branch |
| `git add .` | Stages all files (except those in `.gitignore`) for the next commit |
| `git status` | Shows what is staged, so you can check nothing unwanted is included |
| `git commit -m "..."` | Saves the staged files as a snapshot in local history |
| `git remote add origin <url>` | Links the local repo to the GitHub repo |
| `git push -u origin main` | Uploads the commits to GitHub and sets `main` as the default upstream |

**Note:** this is a separate repo nested inside `Projects`. The outer Azure DevOps repo ignores its contents.

**Check:** `.github/workflows/` and `infra/` appear at the repo root on GitHub.

---

---

## Step 2: Azure Identity (OIDC)

**Why:** lets GitHub Actions log in to Azure without a stored password.

**Analogy:** getting a contractor into an office building.

| Azure | Analogy |
|---|---|
| App registration | The contractor's company profile. It says who they are, but can't enter the building. |
| Service principal | The contractor's badge, issued in my building. It's what gets recognized at the door. |
| Federated credential | A trust agreement: "Anyone vouched for by GitHub, for this repo and branch, can use this badge." No key to copy or lose. |
| Role assignment (Contributor) | The badge's access level: which rooms it opens. |

When the workflow runs, GitHub vouches for the repo and branch. Azure checks that against the trust agreement, accepts it, and lets the badge in with its Contributor access.

1. **Log in and check the account** (`user` must be dhanishetty@gmail.com):
   ```powershell
   az login
   az account show --query "{name:name, user:user.name, id:id, tenant:tenantId}" -o table
   ```

---

2. **Create the app registration and service principal** (save `appId` as `AZURE_CLIENT_ID`):
   ```powershell
   $appId = az ad app create --display-name Azure-Cloud-AI --query appId -o tsv
   az ad sp create --id $appId
   $appId
   ```
   **App registration:** a record in Microsoft Entra ID that defines an application's identity, such as its ID and the credentials or trust it uses to sign in. Here it lets GitHub Actions prove who it is to Azure.

   **When I use an app registration:** whenever something other than a person needs to sign in to Azure or Entra ID, or needs to let people sign in to it.

   | Scenario | Example |
   |---|---|
   | CI/CD pipelines | GitHub Actions deploying to Azure (this project) |
   | User sign-in for my app | "Sign in with Microsoft" on a frontend |
   | Protecting my own API | Backend only accepts tokens issued for it |
   | Automation and scripts | A script calling Azure or Microsoft Graph APIs |
   | Third-party or SaaS integrations | A tool needing delegated access to my tenant's data |

   **When I don't need one:** code running inside Azure (AKS pods, App Service). Use a managed identity or Workload Identity instead. Same idea, but Azure manages the credentials.

   **In this project:** one now, for GitHub Actions. A second only if I add user login to the frontend later.

   **What the first command does:** creates an app registration in Microsoft Entra ID (the identity GitHub Actions uses to log in) and saves its ID in a variable.

   | Part | Meaning |
   |---|---|
   | `$appId =` | PowerShell variable that stores the output |
   | `az ad app create` | Creates the app registration |
   | `--display-name Azure-Cloud-AI` | Label shown in the portal |
   | `--query appId` | Keeps only the `appId` field from the JSON response |
   | `-o tsv` | Plain text output, no quotes, so the variable holds only the raw ID |

   The app registration can't hold roles by itself, so `az ad sp create` makes a service principal from it. Role assignments attach to the service principal.

   **What the second command does:** creates the service principal, the login identity in your tenant that Azure roles are assigned to.

   | Part | Meaning |
   |---|---|
   | `az ad sp create` | Creates a service principal in Entra ID |
   | `--id $appId` | Links it to the app registration created above, using its `appId` |

   Analogy: the app registration is the blueprint, and the service principal is the working identity made from it.

---

3. **Add the federated credential** (replace `<github-user>` with your GitHub username and `<repo-name>` with your repo name):
   ```powershell
   @'
   {
     "name": "github-main",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:<github-user>/<repo-name>:ref:refs/heads/main",
     "audiences": ["api://AzureADTokenExchange"]
   }
   '@ | Set-Content cred.json

   az ad app federated-credential create --id $appId --parameters cred.json
   Remove-Item cred.json
   ```
   ### Note
   
   **If login fails with `AADSTS700213` (no matching federated identity record):** GitHub may be using the newer subject format with the owner and repo IDs, e.g. `repo:<github-user>@<owner-id>/<repo-name>@<repo-id>:ref:refs/heads/main`. Copy the exact subject from the error message (`presented assertion subject '...'`) into `cred.json` and update the credential:
   ```powershell
   az ad app federated-credential update --id $appId --federated-credential-id github-main --parameters cred.json
   ```

   **What the three parts do:**

   | Part | What it does |
   |---|---|
   | `@'...'@ \| Set-Content cred.json` | Writes the trust rules into a temporary file, `cred.json`. A file avoids PowerShell quoting problems with JSON. |
   | `az ad app federated-credential create --id $appId --parameters cred.json` | Sends those rules to the app registration, so Azure trusts GitHub tokens for my repo and branch. |
   | `Remove-Item cred.json` | Deletes the temporary file. |

   **What the JSON fields mean:**

   | Field | Meaning |
   |---|---|
   | `name` | Label for this credential (`github-main`) |
   | `issuer` | Who vouches: GitHub's token service |
   | `subject` | Which repo and branch is allowed: `repo:<github-user>/<repo-name>:ref:refs/heads/main` |
   | `audiences` | Who the token is for: Azure's token exchange (always `api://AzureADTokenExchange`) |

   **Federated credential:** tells an Entra ID app registration to trust tokens from an outside identity provider, such as GitHub, for a specific subject (my repo and branch). The outside system proves who it is with its own short-lived token, so I never store a secret or password in Azure or GitHub.

   | Scenario | Example |
   |---|---|
   | CI/CD from GitHub Actions | Deploy to Azure with OIDC (this project) |
   | CI/CD from other providers | GitLab CI, Terraform Cloud, Azure DevOps workload identity federation |
   | Kubernetes pods | AKS Workload Identity: a pod's service account token is trusted to access Key Vault, no secret |
   | Other clouds | AWS or GCP workloads accessing Azure resources |

   **Why I use it:** no client secret to rotate, leak or expire. Access is limited to the exact repo and branch in the `subject`.

---

4. **Assign Contributor** (subscription scope, because the workflow creates the resource group):
   ```powershell
   $subId = az account show --query id -o tsv
   az role assignment create --assignee $appId --role Contributor --scope "/subscriptions/$subId"
   ```

---

5. **Note the three values for Step 3:**
   ```powershell
   "CLIENT_ID:       $appId"
   "TENANT_ID:       $(az account show --query tenantId -o tsv)"
   "SUBSCRIPTION_ID: $subId"
   ```

**Check:** `az role assignment list --assignee $appId -o table` shows `Contributor`.

---

---

## Step 3: Repo Secrets

**Why:** the workflows read these IDs to log in to Azure. They are identifiers, not passwords.

1. On GitHub, open the `Azure-Cloud-AI` repo > **Settings** > **Secrets and variables** > **Actions**.
2. Stay on the **Secrets** tab and click **New repository secret**.
3. Add each secret (values come from Step 2, item 5):

   | Name | Value | PowerShell / Bash |
   |---|---|---|
   | `AZURE_CLIENT_ID` | `appId` from Step 2 | `az ad app list --display-name Azure-Cloud-AI --query "[0].appId" -o tsv` |
   | `AZURE_TENANT_ID` | tenant ID | `az account show --query tenantId -o tsv` |
   | `AZURE_SUBSCRIPTION_ID` | subscription ID | `az account show --query id -o tsv` |

   Run these while logged in as dhanishetty@gmail.com.

**Check:** all three names appear in the repository secrets list. Names must match exactly (case-sensitive).

---

---

## Step 4: Repo Variable

**Why:** both workflows read `ACR_NAME` to know which registry to create and push to. It's a variable, not a secret, because the name isn't sensitive.

1. **Pick a name:** globally unique across Azure, lowercase letters and digits only, 5-50 characters, no dashes (e.g. `azurecloudai12345`).
2. **Check it's available:**
   ```powershell
   az acr check-name --name <your-acr-name> -o table
   ```
   `NameAvailable` must be `True`.
3. On GitHub, open the repo > **Settings** > **Secrets and variables** > **Actions**.
4. Open the **Variables** tab (not Secrets) and click **New repository variable**.
5. Add:

   | Name | Value |
   |---|---|
   | `ACR_NAME` | the name you picked |

**Check:** `ACR_NAME` appears in the repository variables list. The name is case-sensitive.

---

---

## Step 5: Run Order

**Why:** the registry must exist before images can be pushed to it, so the order matters.

1. **Register the resource provider** (once per subscription):
   ```powershell
   az provider register --namespace Microsoft.ContainerRegistry
   az provider show --namespace Microsoft.ContainerRegistry --query registrationState -o tsv
   ```
   Wait until it shows `Registered`.

---

2. **Run `Deploy ACR (infra)`:** GitHub repo > **Actions** tab > **Deploy ACR (infra)** > **Run workflow** > branch `main` > **Run workflow**.
   Wait for the green check. Open the run to see the logs if it fails.
   ```powershell
   az acr show --name <ACR_NAME> --query "{name:name, sku:sku.name, server:loginServer}" -o table
   ```
   The registry should be listed with SKU `Basic`.

   **`infra/acr.bicep`, section by section** (click a section to expand it). Bicep is the language that describes Azure resources as code; the workflow below deploys this file.
   
   <details>
   <summary><b>Show the whole file</b></summary>
   
   ```bicep
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
   ```
   
   </details>
   
   <details>
   <summary><b>1. Parameters</b></summary>
   
   ```bicep
   @description('Globally unique ACR name (5-50 lowercase alphanumeric)')
   param acrName string
   
   param location string = resourceGroup().location
   ```
   
   A **parameter** is an input to the file.
   - **`acrName`** has no default, so the deployment must provide it. The workflow passes it with `-p acrName=$ACR_NAME`. The `@description` line documents the naming rule: the name must be unique across all of Azure, 5-50 characters, lowercase letters and digits only.
   - **`location`** defaults to the region of the resource group the file is deployed into, so the registry lands in `eastus` without my typing it.
   
   </details>
   
   <details>
   <summary><b>2. The registry</b></summary>
   
   ```bicep
   resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
     name: acrName
     location: location
     sku: { name: 'Basic' }
     properties: { adminUserEnabled: false }
   }
   ```
   
   - **`resource acr '...registries@2023-07-01'`** declares one Azure resource. `acr` is a name I use inside this file. The text in quotes is the resource type and the API version that defines which settings are allowed.
   - **`sku: Basic`** is the cheapest tier (about $5 a month) and is enough for this project.
   - **`adminUserEnabled: false`** turns off the shared admin username and password. Access works only through Azure roles: the pipeline uses `Contributor`, and AKS pulls images with `AcrPull`.
   
   </details>
   
   <details>
   <summary><b>3. Output</b></summary>
   
   ```bicep
   output loginServer string = acr.properties.loginServer
   ```
   
   Returns the registry's address (`<name>.azurecr.io`) after the deployment. Nothing uses it yet, but it shows up in the deployment results.
   
   </details>
   
   
   **The `Deploy ACR (infra)` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-acr.yml`.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy ACR (infra)
   
   on:
     push:
       branches: [main]
       paths: ['infra/**', '.github/workflows/deploy-acr.yml']
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     RG: rg-portfolio
     LOCATION: eastus
     ACR_NAME: ${{ vars.ACR_NAME }}
   
   jobs:
     deploy-acr:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Create resource group
           run: az group create -n $RG -l $LOCATION
   
         - name: Deploy ACR with Bicep
           run: |
             az deployment group create \
               -g $RG \
               -f infra/acr.bicep \
               -p acrName=$ACR_NAME
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy ACR (infra)
   ```

   The label shown in the **Actions** tab. It is the name I click to run the workflow.

   </details>

   <details>
   <summary><b>2. Triggers (<code>on</code>)</b></summary>

   ```yaml
   on:
     push:
       branches: [main]
       paths: ['infra/**', '.github/workflows/deploy-acr.yml']
     workflow_dispatch:
   ```

   When the workflow starts:
   - **`push` to `main`**, but only if something under `infra/` or this workflow file changed. A change to app code does not trigger it.
   - **`workflow_dispatch`** adds the **Run workflow** button, so I can start it by hand.

   This is why my first push in Step 1 started a (failed) run: the file was new, and `ACR_NAME` did not exist yet.

   </details>

   <details>
   <summary><b>3. Permissions</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read
   ```

   What the workflow's built-in token may do:
   - **`id-token: write`** lets the job ask GitHub for an OIDC identity token. Azure checks it against the federated credential from Step 2. Without it, login fails.
   - **`contents: read`** lets the job download the repo's code.

   Everything else is denied. That is least privilege.

   </details>

   <details>
   <summary><b>4. Environment variables (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
     LOCATION: eastus
     ACR_NAME: ${{ vars.ACR_NAME }}
   ```

   Values the steps below reuse:
   - **`RG`** and **`LOCATION`** are the resource group name and Azure region, written directly.
   - **`ACR_NAME`** comes from the repo variable I added in Step 4 (`vars.ACR_NAME`). Keeping it as a variable means the name is not hard-coded in the file.

   Later steps read them as `$RG`, `$LOCATION` and `$ACR_NAME`.

   </details>

   <details>
   <summary><b>5. Job and runner</b></summary>

   ```yaml
   jobs:
     deploy-acr:
       runs-on: ubuntu-latest
       steps:
   ```

   - **`jobs`** holds the work. This workflow has one job, `deploy-acr`.
   - **`runs-on: ubuntu-latest`** is the temporary Linux machine GitHub starts to run it. It already has the Azure CLI installed, and it is thrown away afterwards.
   - **`steps`** are the actions below, run in order. If one fails, the rest are skipped.

   </details>

   <details>
   <summary><b>6. Step: check out the code</b></summary>

   ```yaml
   - uses: actions/checkout@v4
   ```

   Downloads the repo onto the runner. It is needed because the Bicep file `infra/acr.bicep` lives in the repo, and a later step reads it.

   </details>

   <details>
   <summary><b>7. Step: log in to Azure</b></summary>

   ```yaml
   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Signs the runner in to Azure with **OIDC**, using the three repo secrets from Step 3. There is no password. GitHub presents a short-lived token, and Azure accepts it because of the federated credential I created in Step 2 (this is where the `subject` must match). If it fails with `AADSTS700213`, see Step 2, item 3.

   </details>

   <details>
   <summary><b>8. Step: create the resource group</b></summary>

   ```yaml
   - name: Create resource group
     run: az group create -n $RG -l $LOCATION
   ```

   Creates `rg-portfolio` in `eastus`. If it already exists, the command does nothing and succeeds, so re-running is safe. The registry has to live in a resource group, so this must come first.

   </details>

   <details>
   <summary><b>9. Step: deploy the registry with Bicep</b></summary>

   ```yaml
   - name: Deploy ACR with Bicep
     run: |
       az deployment group create \
         -g $RG \
         -f infra/acr.bicep \
         -p acrName=$ACR_NAME
   ```

   Creates the Azure Container Registry from code:
   - **`az deployment group create`** runs a Bicep deployment inside a resource group.
   - **`-g $RG`** is the target resource group.
   - **`-f infra/acr.bicep`** is the file that defines the registry (Basic tier, admin user off).
   - **`-p acrName=$ACR_NAME`** passes my registry name into the Bicep `acrName` parameter.
   - The trailing `\` just continues the command on the next line.

   Running it again with the same values changes nothing. That is what makes it infrastructure as code.

   </details>


   ### Note
   
   **If login fails with `AADSTS700213` (no matching federated identity record):** GitHub may be using the newer subject format with the owner and repo IDs, e.g. `repo:<github-user>@<owner-id>/<repo-name>@<repo-id>:ref:refs/heads/main`. Copy the exact subject from the error message (`presented assertion subject '...'`) into `cred.json` and update the credential:
   ```powershell
   az ad app federated-credential update --id $appId --federated-credential-id github-main --parameters cred.json
   ```

---

3. **Run `Build and push images to ACR`:** **Actions** tab > **Build and push images to ACR** > **Run workflow** > `main`.
   Three matrix jobs run: `frontend`, `backend-api`, `ingestion-worker`.
   ```powershell
   az acr repository list --name <ACR_NAME> -o table
   az acr repository show-tags --name <ACR_NAME> --repository frontend -o table
   ```
   All three repositories should be listed, each tagged with the commit SHA and `latest`.

   **The `Build and push images to ACR` workflow, section by section** (click a section to expand it). The file is `.github/workflows/build-push-images.yml`.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Build and push images to ACR
   
   on:
     push:
       branches: [main]
       paths: ['Code/**', 'k8s/**', '.github/workflows/build-push-images.yml']
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     ACR_NAME: ${{ vars.ACR_NAME }}
   
   jobs:
     build-push:
       runs-on: ubuntu-latest
       strategy:
         matrix:
           include:
             - image: frontend
               context: Code/Frontend
             - image: backend-api
               context: Code/Backend/RAG/backend-api
             - image: ingestion-worker
               context: Code/Backend/RAG/ingestion-worker
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Build and push (tagged with commit SHA and latest)
           run: |
             az acr build -r $ACR_NAME \
               -t ${{ matrix.image }}:${{ github.sha }} \
               -t ${{ matrix.image }}:latest \
               ${{ matrix.context }}
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Build and push images to ACR
   ```

   The label shown in the **Actions** tab. It matters beyond looks: `deploy-app.yml` starts "after the workflow named `Build and push images to ACR` succeeds", so if I rename this workflow, the automatic deploy stops firing.

   </details>

   <details>
   <summary><b>2. Triggers (<code>on</code>)</b></summary>

   ```yaml
   on:
     push:
       branches: [main]
       paths: ['Code/**', 'k8s/**', '.github/workflows/build-push-images.yml']
     workflow_dispatch:
   ```

   When the workflow starts:
   - **`push` to `main`**, but only if something under `Code/`, `k8s/` or this workflow file changed. Changing only `infra/` or the README does not rebuild the images.
   - **`workflow_dispatch`** adds the **Run workflow** button for manual runs.

   `k8s/**` is included so that a manifest-only change still flows through to the deploy workflow.

   </details>

   <details>
   <summary><b>3. Permissions</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read
   ```

   What the workflow's built-in token may do:
   - **`id-token: write`** lets the job ask GitHub for an OIDC identity token, which Azure checks against the federated credential from Step 2.
   - **`contents: read`** lets the job download the repo's code.

   Everything else is denied.

   </details>

   <details>
   <summary><b>4. Environment variable (<code>env</code>)</b></summary>

   ```yaml
   env:
     ACR_NAME: ${{ vars.ACR_NAME }}
   ```

   The registry name, read from the repo variable I added in Step 4. Steps use it as `$ACR_NAME`. There is no resource group here because `az acr build` only needs the registry name.

   </details>

   <details>
   <summary><b>5. Job and runner</b></summary>

   ```yaml
   jobs:
     build-push:
       runs-on: ubuntu-latest
   ```

   - **`build-push`** is the one job.
   - **`runs-on: ubuntu-latest`** is the temporary Linux machine GitHub starts for it. The Azure CLI is already installed, and the machine is discarded afterwards. Because the image build happens inside ACR (see the last section), the runner does not need Docker.

   </details>

   <details>
   <summary><b>6. Matrix: three jobs from one definition</b></summary>

   ```yaml
   strategy:
     matrix:
       include:
         - image: frontend
           context: Code/Frontend
         - image: backend-api
           context: Code/Backend/RAG/backend-api
         - image: ingestion-worker
           context: Code/Backend/RAG/ingestion-worker
   ```

   GitHub runs the steps once for each entry, in parallel, so there are three jobs:
   - **`image`** is the name the image gets in ACR.
   - **`context`** is the folder with that app's `Dockerfile` and source code.

   Adding a new service later means adding one more entry here. The steps below use `${{ matrix.image }}` and `${{ matrix.context }}` to pick up the current entry.

   </details>

   <details>
   <summary><b>7. Step: check out the code</b></summary>

   ```yaml
   - uses: actions/checkout@v4
   ```

   Downloads the repo onto the runner, so the Dockerfiles and source code are there to build.

   </details>

   <details>
   <summary><b>8. Step: log in to Azure</b></summary>

   ```yaml
   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Signs the runner in to Azure with **OIDC**, using the three repo secrets from Step 3. There is no password: GitHub presents a short-lived token, and Azure accepts it because of the federated credential from Step 2. The `Contributor` role from Step 2 is what lets it push to the registry.

   </details>

   <details>
   <summary><b>9. Step: build and push the image</b></summary>

   ```yaml
   - name: Build and push (tagged with commit SHA and latest)
     run: |
       az acr build -r $ACR_NAME \
         -t ${{ matrix.image }}:${{ github.sha }} \
         -t ${{ matrix.image }}:latest \
         ${{ matrix.context }}
   ```

   Builds the image and stores it in the registry:
   - **`az acr build`** uploads the folder to ACR and builds the image there (ACR Tasks), then saves it in the registry. No Docker install and no separate push step.
   - **`-r $ACR_NAME`** is the target registry.
   - **`-t <image>:${{ github.sha }}`** tags the image with the commit SHA. This tag is what the deploy workflow rolls out, so every running version can be traced to a commit and rolled back.
   - **`-t <image>:latest`** adds a second tag, `latest`, that always points to the newest build.
   - **`${{ matrix.context }}`** is the folder to build, taken from the matrix entry.
   - The trailing `\` just continues the command on the next line.

   After this succeeds, `deploy-app.yml` starts automatically.

   </details>


**Troubleshooting**
- **Expected:** the push in Step 1 may have already triggered these workflows before `ACR_NAME` existed, so a red earlier run is normal. Just re-run manually.
- `Login failed` or `AADSTS700213` (no matching federated identity record): the federated credential `subject` doesn't match what GitHub sent. See Step 2, item 3.
- `AuthorizationFailed`: the Contributor role from Step 2 is missing or hasn't propagated yet. Wait a few minutes and re-run.
- `TasksOperationsNotAllowed` on image build: ACR Tasks may be blocked on some new or free subscriptions. Tell me and we'll build the images in the runner instead.

---

---

## Step 6: Deploy AKS

**Why:** the cluster that will run the frontend and backend. Deployed with Bicep from a manual GitHub Actions workflow, because a running cluster costs money.

**Files added:** `infra/aks.bicep` (Free-tier cluster, 1 x `Standard_B2s` node, OIDC + Workload Identity on, `AcrPull` role so nodes can pull from ACR) and `.github/workflows/deploy-aks.yml` (manual run only).

1. **Register the resource provider** (once per subscription):
   ```powershell
   az provider register --namespace Microsoft.ContainerService
   az provider show --namespace Microsoft.ContainerService --query registrationState -o tsv
   ```
   Wait until it shows `Registered`.

   **What each command does:**

   | Command | What it does |
   |---|---|
   | `az provider register ...` | Turns on the AKS service (`Microsoft.ContainerService`) for my subscription. Azure won't create clusters until it's registered. |
   | `az provider show ... -o tsv` | Prints the registration state (`Registering` or `Registered`) so I know when it's ready |

---

2. **Check the VM size is available** in `eastus` for my subscription:
   ```powershell
   az vm list-skus --location eastus --size Standard_B2s --query "[].{name:name, restrictions:restrictions[0].reasonCode}" -o table
   ```
   `restrictions` must be empty. If restricted, pick another B-series size and change `nodeVmSize` in `aks.bicep`.

   **What the command does:**

   | Part | What it does |
   |---|---|
   | `az vm list-skus` | Lists VM sizes and any restrictions on them |
   | `--location eastus --size Standard_B2s` | Limits the list to this size in this region |
   | `--query "[].{name:..., restrictions:...}"` | Shows only the name and the first restriction reason, if any |
   | `-o table` | Prints a table |

---

3. **Let the pipeline create role assignments.** `Contributor` can't assign roles, and `aks.bicep` assigns `AcrPull`. Give the identity `User Access Administrator` on the resource group only:
   ```powershell
   $appId = az ad app list --display-name Azure-Cloud-AI --query "[0].appId" -o tsv
   $subId = az account show --query id -o tsv
   az role assignment create --assignee $appId --role "User Access Administrator" --scope "/subscriptions/$subId/resourceGroups/rg-portfolio"
   ```

   **What each command does:**

   | Command | What it does |
   |---|---|
   | `$appId = az ad app list ...` | Looks up the client ID of the `Azure-Cloud-AI` app registration and stores it in `$appId` |
   | `$subId = az account show ...` | Gets the current subscription ID and stores it in `$subId` |
   | `az role assignment create ...` | Gives the app's service principal the `User Access Administrator` role, limited to the `rg-portfolio` resource group, so the pipeline can assign `AcrPull` |

---

4. **Push the new files:**
   ```powershell
   git add .
   git commit -m "Add AKS Bicep and deploy workflow"
   git push
   ```

   **What each command does:**

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all new and changed files for the commit |
   | `git commit -m "..."` | Saves the staged files as a snapshot in local history |
   | `git push` | Uploads the commit to GitHub so the workflow can use `aks.bicep` |

---

5. **Run `Deploy AKS (infra)`:** GitHub repo > **Actions** tab > **Deploy AKS (infra)** > **Run workflow** > `main`. Takes about 5-10 minutes.

   **`infra/aks.bicep`, section by section** (click a section to expand it). Bicep is the language that describes Azure resources as code; the workflow below deploys this file.
   
   <details>
   <summary><b>Show the whole file</b></summary>
   
   ```bicep
   @description('Name of the existing ACR the cluster pulls images from')
   param acrName string
   
   param clusterName string = 'aks-azure-cloud-ai'
   param location string = resourceGroup().location
   param nodeVmSize string = 'Standard_B2s'
   param nodeCount int = 1
   
   resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
     name: acrName
   }
   
   resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
     name: clusterName
     location: location
     sku: {
       name: 'Base'
       tier: 'Free'
     }
     identity: { type: 'SystemAssigned' }
     properties: {
       dnsPrefix: clusterName
       agentPoolProfiles: [
         {
           name: 'system'
           mode: 'System'
           count: nodeCount
           vmSize: nodeVmSize
           osType: 'Linux'
         }
       ]
       oidcIssuerProfile: { enabled: true }
       securityProfile: {
         workloadIdentity: { enabled: true }
       }
     }
   }
   
   // Lets the cluster's nodes pull images from ACR (built-in AcrPull role)
   var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
   
   resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
     name: guid(acr.id, aks.id, acrPullRoleId)
     scope: acr
     properties: {
       roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
       principalId: aks.properties.identityProfile.kubeletidentity.objectId
       principalType: 'ServicePrincipal'
     }
   }
   
   output clusterName string = aks.name
   ```
   
   </details>
   
   <details>
   <summary><b>1. Parameters</b></summary>
   
   ```bicep
   @description('Name of the existing ACR the cluster pulls images from')
   param acrName string
   
   param clusterName string = 'aks-azure-cloud-ai'
   param location string = resourceGroup().location
   param nodeVmSize string = 'Standard_B2s'
   param nodeCount int = 1
   ```
   
   Inputs to the file:
   - **`acrName`** has no default, so the workflow must pass it. It names the registry the cluster will pull images from.
   - **`clusterName`**, **`nodeVmSize`** and **`nodeCount`** have defaults: the cluster name, a small `Standard_B2s` virtual machine, and one node. I can change them without editing the resources.
   - **`location`** defaults to the resource group's region.
   
   </details>
   
   <details>
   <summary><b>2. The existing registry</b></summary>
   
   ```bicep
   resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
     name: acrName
   }
   ```
   
   The keyword **`existing`** means "look this up, don't create it". The registry was created earlier by `acr.bicep`. This lets the file refer to it, which the role assignment in section 4 needs.
   
   </details>
   
   <details>
   <summary><b>3. The cluster</b></summary>
   
   ```bicep
   resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' = {
     name: clusterName
     location: location
     sku: {
       name: 'Base'
       tier: 'Free'
     }
     identity: { type: 'SystemAssigned' }
     properties: {
       dnsPrefix: clusterName
       agentPoolProfiles: [
         {
           name: 'system'
           mode: 'System'
           count: nodeCount
           vmSize: nodeVmSize
           osType: 'Linux'
         }
       ]
       oidcIssuerProfile: { enabled: true }
       securityProfile: {
         workloadIdentity: { enabled: true }
       }
     }
   }
   ```
   
   - **`sku` Base / Free** is the free control plane: no charge for the cluster itself, and no uptime guarantee. I only pay for the node.
   - **`identity: SystemAssigned`** gives the cluster its own managed identity, created and managed by Azure.
   - **`dnsPrefix`** is a required name used for the cluster's API address.
   - **`agentPoolProfiles`** defines the nodes: one pool named `system`, with `nodeCount` machines of size `nodeVmSize`, running Linux. `mode: System` means it also runs Kubernetes' own components alongside my pods.
   - **`oidcIssuerProfile`** makes the cluster publish an identity token issuer. Azure uses it to trust tokens from my pods.
   - **`workloadIdentity`** turns on AKS Workload Identity, which injects those tokens into pods. Together these two settings are what let the apps use managed identities instead of keys.
   
   </details>
   
   <details>
   <summary><b>4. Letting the nodes pull images (AcrPull)</b></summary>
   
   ```bicep
   // Lets the cluster's nodes pull images from ACR (built-in AcrPull role)
   var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
   
   resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
     name: guid(acr.id, aks.id, acrPullRoleId)
     scope: acr
     properties: {
       roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
       principalId: aks.properties.identityProfile.kubeletidentity.objectId
       principalType: 'ServicePrincipal'
     }
   }
   ```
   
   A role assignment answers: who may do what, where.
   - **`acrPullRoleId`** is the fixed ID of Azure's built-in `AcrPull` role, which allows reading images from a registry.
   - **`name: guid(...)`** builds a name from the registry, the cluster and the role. Because it's calculated from fixed inputs, re-running the deployment produces the same name, so it never creates duplicates.
   - **`scope: acr`** limits the permission to this one registry.
   - **`principalId`** is the cluster's *kubelet identity*, the identity the nodes use to pull images. Azure creates it with the cluster, and Bicep reads its ID from the cluster resource.
   - **`principalType: ServicePrincipal`** tells Azure what kind of identity it is, which avoids a delay while Azure works it out.
   
   Creating a role assignment needs more than `Contributor`, which is why I gave the pipeline `User Access Administrator` on the resource group in Step 6.
   
   </details>
   
   <details>
   <summary><b>5. Output</b></summary>
   
   ```bicep
   output clusterName string = aks.name
   ```
   
   Returns the cluster name after the deployment.
   
   </details>
   
   
   **The `Deploy AKS (infra)` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-aks.yml`. It follows the same pattern as the `Deploy ACR (infra)` workflow in Step 5, so the shared parts are short here.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy AKS (infra)
   
   # Manual only: the cluster costs money while running
   on:
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     RG: rg-portfolio
     ACR_NAME: ${{ vars.ACR_NAME }}
   
   jobs:
     deploy-aks:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Deploy AKS with Bicep
           run: |
             az deployment group create \
               -g $RG \
               -f infra/aks.bicep \
               -p acrName=$ACR_NAME
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy AKS (infra)

   # Manual only: the cluster costs money while running
   ```

   The label shown in the **Actions** tab. The comment records why this workflow is manual.

   </details>

   <details>
   <summary><b>2. Trigger (<code>on</code>)</b></summary>

   ```yaml
   on:
     workflow_dispatch:
   ```

   Only the **Run workflow** button. There is no `push` trigger, unlike the ACR workflow, so editing `aks.bicep` never changes the cluster by accident. I run it on purpose.

   </details>

   <details>
   <summary><b>3. Permissions, job and runner</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read

   jobs:
     deploy-aks:
       runs-on: ubuntu-latest
       steps:
   ```

   Same as the ACR workflow: `id-token: write` lets the job get an OIDC token for the Azure login, `contents: read` lets it download the repo, and the job runs on a temporary Ubuntu machine with the Azure CLI installed.

   </details>

   <details>
   <summary><b>4. Environment variables (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
     ACR_NAME: ${{ vars.ACR_NAME }}
   ```

   - **`RG`** is the resource group to deploy into. There is no `LOCATION` and no `az group create` here, because the ACR workflow already created the group.
   - **`ACR_NAME`** is the repo variable from Step 4. The Bicep file needs it to find the existing registry and grant the cluster the `AcrPull` role on it.

   </details>

   <details>
   <summary><b>5. Steps: check out and log in</b></summary>

   ```yaml
   - uses: actions/checkout@v4

   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Same as the ACR workflow: download the repo so `infra/aks.bicep` is available, then sign in to Azure with OIDC and the three repo secrets from Step 3.

   </details>

   <details>
   <summary><b>6. Step: deploy the cluster with Bicep</b></summary>

   ```yaml
   - name: Deploy AKS with Bicep
     run: |
       az deployment group create \
         -g $RG \
         -f infra/aks.bicep \
         -p acrName=$ACR_NAME
   ```

   - **`-f infra/aks.bicep`** defines the cluster: Free tier, one `Standard_B2s` node, OIDC and Workload Identity turned on, and the `AcrPull` role so nodes can pull images.
   - **`-p acrName=$ACR_NAME`** passes the registry name into the Bicep parameter.
   - Creating the role assignment needs `User Access Administrator` on the resource group, which I granted in item 3 of this step. Without it, the deploy fails with `AuthorizationFailed`.
   - It takes about 5-10 minutes. Running it again changes nothing, but do not re-run it after turning on Container Insights in Step 12, because `aks.bicep` does not include that add-on.

   </details>


---

6. **Verify and connect:**
   ```powershell
   az aks show -g rg-portfolio -n aks-azure-cloud-ai --query "{state:provisioningState, tier:sku.tier, version:kubernetesVersion}" -o table
   az aks get-credentials -g rg-portfolio -n aks-azure-cloud-ai
   kubectl get nodes
   ```
   State must be `Succeeded` and one node `Ready`. `kubectl` is needed locally (`az aks install-cli` if missing).

   **What each command does:**

   | Command | What it does |
   |---|---|
   | `az aks show ... --query ... -o table` | Reads the cluster and shows its state, pricing tier and Kubernetes version |
   | `az aks get-credentials ...` | Downloads the cluster's connection details and merges them into `~/.kube/config`, making it the current `kubectl` context |
   | `kubectl get nodes` | Lists the cluster's worker nodes and their status |

**Check ACR pull access:**
```powershell
az role assignment list --scope $(az acr show -n <ACR_NAME> --query id -o tsv) --query "[?roleDefinitionName=='AcrPull'].principalType" -o tsv
```
Should print `ServicePrincipal`.

**What the command does:**

| Part | What it does |
|---|---|
| `az acr show -n <ACR_NAME> --query id -o tsv` | Gets the registry's full resource ID (inside `$(...)`) |
| `az role assignment list --scope <that ID>` | Lists role assignments on the registry |
| `--query "[?roleDefinitionName=='AcrPull'].principalType"` | Keeps only `AcrPull` assignments and shows who holds them |

**Save money when not working:**
```powershell
az aks stop -g rg-portfolio -n aks-azure-cloud-ai
az aks start -g rg-portfolio -n aks-azure-cloud-ai
```

| Command | What it does |
|---|---|
| `az aks stop` | Shuts down the nodes, so I stop paying for compute. The cluster config is kept. |
| `az aks start` | Brings the nodes back up (takes a few minutes) |

**Troubleshooting**
- `AuthorizationFailed` on the role assignment: item 3 is missing or hasn't propagated. Wait a few minutes and re-run.
- `QuotaExceeded` or `SkuNotAvailable`: the VM size or vCPU quota isn't available. Change `nodeVmSize` or region.
- `MissingSubscriptionRegistration`: item 1 isn't finished.

---

---

## Step 7: Deploy the Frontend to AKS

**Why:** proves the full path works: image in ACR, pulled by AKS, reachable from the internet. The backend comes later, because it needs Storage, AI Search and OpenAI, which don't exist yet.

**Files added** (in `k8s/`):

| File | Purpose |
|---|---|
| `namespace.yaml` | Creates the `rag-app` namespace to keep the app's resources together |
| `frontend.yaml` | Frontend `Deployment` (1 pod, small resource limits, health probes) and a `LoadBalancer` `Service` that gives it a public IP |
| `backend-api-service.yaml` | Placeholder `Service` with no pods yet. The frontend's nginx looks up `backend-api` at startup and crashes if it can't resolve it. Until the backend exists, `/api` returns 502. |

**The manifests, file by file** (click a section to expand it). Each file has a **Show the whole file** button first, then one section per part.

**`k8s/namespace.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: rag-app
```

</details>

<details>
<summary><b>1. Kind and version</b></summary>

```yaml
apiVersion: v1
kind: Namespace
```

- **`apiVersion`** says which version of the Kubernetes API describes this object.
- **`kind: Namespace`** is a named folder inside the cluster. It groups related resources so they stay separate from system pods and other projects.

</details>

<details>
<summary><b>2. Name</b></summary>

```yaml
metadata:
  name: rag-app
```

Every other file puts its resources into this namespace with `namespace: rag-app`. It has to exist first, which is why Step 7 applies this file before the others.

</details>

**`k8s/backend-api-service.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
# Placeholder Service so the frontend's nginx can resolve "backend-api".
# It has no pods behind it yet; /api returns 502 until the backend Deployment exists.
apiVersion: v1
kind: Service
metadata:
  name: backend-api
  namespace: rag-app
spec:
  type: ClusterIP
  selector:
    app: backend-api
  ports:
    - port: 8000
      targetPort: 8000
```

</details>

<details>
<summary><b>1. Comment</b></summary>

```yaml
# Placeholder Service so the frontend's nginx can resolve "backend-api".
# It has no pods behind it yet; /api returns 502 until the backend Deployment exists.
```

The frontend's nginx looks up the name `backend-api` when it starts, and crashes if it can't find it. This Service makes the name exist before the backend does. The backend pods arrived in Step 9, so it now routes to real pods.

</details>

<details>
<summary><b>2. Kind and metadata</b></summary>

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-api
  namespace: rag-app
```

A **Service** is a stable internal address in front of a set of pods. Its `name` becomes a DNS name inside the cluster, so the frontend can call `http://backend-api:8000`. It lives in the `rag-app` namespace.

</details>

<details>
<summary><b>3. Type and selector</b></summary>

```yaml
spec:
  type: ClusterIP
  selector:
    app: backend-api
```

- **`type: ClusterIP`** makes the Service reachable only from inside the cluster, not from the internet.
- **`selector`** picks the pods to send traffic to: any pod with the label `app: backend-api`.

</details>

<details>
<summary><b>4. Ports</b></summary>

```yaml
  ports:
    - port: 8000
      targetPort: 8000
```

- **`port`** is the port the Service listens on.
- **`targetPort`** is the port on the pod it forwards to (where FastAPI listens).

</details>

**`k8s/frontend.yaml`, section by section** (it holds two objects: a Deployment and a Service)

<details>
<summary><b>Show the whole file</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: rag-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: azurecloudai12345.azurecr.io/frontend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80
          env:
            - name: BACKEND_URL
              value: http://backend-api:8000
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
          readinessProbe:
            httpGet:
              path: /
              port: 80
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: rag-app
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
```

</details>

<details>
<summary><b>1. Deployment header</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: rag-app
```

A **Deployment** keeps the desired number of pods running and handles rolling updates. This one is named `frontend`, in the `rag-app` namespace.

</details>

<details>
<summary><b>2. Replicas and selector</b></summary>

```yaml
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
```

- **`replicas: 1`** runs one pod. That is all my single node can afford.
- **`selector`** tells the Deployment which pods are its own: those labelled `app: frontend`. It must match the labels in the pod template below.

</details>

<details>
<summary><b>3. Pod template labels</b></summary>

```yaml
  template:
    metadata:
      labels:
        app: frontend
```

The pod blueprint. The label `app: frontend` is how both the Deployment and the `frontend` Service find these pods.

</details>

<details>
<summary><b>4. Container</b></summary>

```yaml
    spec:
      containers:
        - name: frontend
          image: azurecloudai12345.azurecr.io/frontend:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 80
          env:
            - name: BACKEND_URL
              value: http://backend-api:8000
```

- **`image`** is the frontend image in my registry. The pipeline replaces `:latest` with the commit SHA tag when it deploys.
- **`imagePullPolicy: Always`** makes the node check the registry on every start instead of reusing a cached image.
- **`containerPort: 80`** is where nginx listens.
- **`env`** sets `BACKEND_URL`, which the nginx config uses to forward `/api` requests to the backend Service.

</details>

<details>
<summary><b>5. Resources</b></summary>

```yaml
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 200m
              memory: 128Mi
```

- **`requests`** is what the scheduler reserves for the pod on a node (50 millicores of CPU, 64 MiB of memory). With one small node, keeping requests low is what lets everything fit.
- **`limits`** is the maximum it may use. Going over the memory limit gets the container restarted.

</details>

<details>
<summary><b>6. Health probes</b></summary>

```yaml
          readinessProbe:
            httpGet:
              path: /
              port: 80
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10
```

- **`readinessProbe`** decides when the pod may receive traffic: once `/` answers.
- **`livenessProbe`** restarts the container if `/` stops answering. `initialDelaySeconds: 10` gives it time to start first.

</details>

<details>
<summary><b>7. Separator and Service</b></summary>

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: rag-app
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - port: 80
      targetPort: 80
```

- **`---`** separates two Kubernetes objects in one file.
- The **Service** gives the pods a stable internal address on port 80.
- **`type: ClusterIP`** keeps it internal. In Step 7 this was `LoadBalancer` (a public IP). In Step 11 I changed it, because Traefik now receives the traffic and forwards it here.

</details>


The frontend image is `azurecloudai12345.azurecr.io/frontend:latest`. Change it if my ACR name differs.

1. **Check I'm pointed at the right cluster:**
   ```powershell
   kubectl config current-context
   kubectl get nodes
   ```
   Context must be `aks-azure-cloud-ai` and the node `Ready`.

   | Command | What it does |
   |---|---|
   | `kubectl config current-context` | Shows which cluster `kubectl` is talking to |
   | `kubectl get nodes` | Lists the worker nodes and their status |

---

2. **Apply the manifests:**
   ```powershell
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/
   ```

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/namespace.yaml` | Creates the namespace first, because the other files need it |
   | `kubectl apply -f k8s/` | Creates or updates everything in the folder (safe to re-run) |

---

3. **Watch the pod start:**
   ```powershell
   kubectl get pods -n rag-app -w
   ```
   Wait for `1/1 Running`, then press Ctrl+C.

   | Part | What it does |
   |---|---|
   | `get pods` | Lists pods |
   | `-n rag-app` | In the `rag-app` namespace |
   | `-w` | Keeps watching and prints changes |

---

4. **Get the public IP:**
   ```powershell
   kubectl get service frontend -n rag-app -w
   ```
   `EXTERNAL-IP` shows `<pending>` for a minute or two, then an IP. Open `http://<EXTERNAL-IP>` in a browser. The page should load. Upload and Q&A won't work yet.

---

**Check**
- Browser shows the frontend page.
- `kubectl get pods -n rag-app` shows `frontend` `Running`.

**Troubleshooting**
- `ImagePullBackOff`: the image name or tag is wrong, or the nodes lack `AcrPull`. Run `kubectl describe pod -n rag-app -l app=frontend` and read the Events at the bottom.
- `CrashLoopBackOff` with `host not found in upstream "backend-api"`: `backend-api-service.yaml` wasn't applied. Re-run item 2.
- `EXTERNAL-IP` stays `<pending>` for over 5 minutes: run `kubectl describe service frontend -n rag-app` and read the Events.
- Pod `Pending` with `Insufficient cpu/memory`: the single node is full. Lower the resource requests in `frontend.yaml`.

**Save money:** this creates a public IP and load balancer that bill while the cluster exists. Run `az aks stop` when not working (see Step 6).

---

---

## Step 8: Deploy Storage, AI Search and OpenAI

**Why:** the backend and worker need these three services (they read their endpoints and keys from environment variables). Deployed with Bicep from a manual workflow, like ACR and AKS.

**Files added:** `infra/data-ai.bicep` and `.github/workflows/deploy-data-ai.yml` (manual run only).

| Resource | Details | Cost |
|---|---|---|
| Storage account | Standard_LRS, blob container `documents`, queue `ingest-jobs` | Cents per month |
| AI Search | Reuse my existing Free service `rag-vector-store` (in `rg-rag-qa-demo`). Not created by this step. | $0 |
| Azure OpenAI | Account plus deployments `chat` (gpt-5-mini) and `embeddings` (text-embedding-3-small, 1536 dimensions) | Pay per token |

Names get a unique suffix (`uniqueString`) because storage, search and OpenAI names must be globally unique.

**Note:** the target design in `docs/architecture.md` uses managed identity with no keys. The current code reads keys and a connection string, so Step 9 stores them in a Kubernetes Secret. Switching to managed identity is a later improvement.

1. **Register the resource providers** (once per subscription):
   ```powershell
   az provider register --namespace Microsoft.Search
   az provider register --namespace Microsoft.CognitiveServices
   az provider register --namespace Microsoft.Storage
   az provider show --namespace Microsoft.CognitiveServices --query registrationState -o tsv
   ```
   Wait until each shows `Registered`.

   | Command | What it does |
   |---|---|
   | `az provider register ...` | Turns on that Azure service for my subscription |
   | `az provider show ... -o tsv` | Prints the registration state |

---

2. **Check the OpenAI model versions are available** in `eastus`:
   ```powershell
   az cognitiveservices model list --location eastus --query "[?model.name=='gpt-5-mini' || model.name=='text-embedding-3-small'].{name:model.name, version:model.version}" -o table
   ```
   The versions in `data-ai.bicep` (`2025-08-07` and `1`) must appear. If not, change `chatModelVersion` or `embedModelVersion`.

   | Part | What it does |
   |---|---|
   | `az cognitiveservices model list` | Lists models Azure OpenAI offers in a region |
   | `--query "[?model.name==...]"` | Keeps only the two models I need and shows name and version |

---

3. **Check I don't already have a Free AI Search service** (only one is allowed per subscription):
   ```powershell
   az resource list --resource-type Microsoft.Search/searchServices --query "[].{name:name, sku:sku.name, rg:resourceGroup}" -o table
   ```
   **My result:** `rag-vector-store` (Free) already exists in `rg-rag-qa-demo`, so I reuse it. The workflow passes `createSearch=false`, so Bicep skips creating a search service. The worker creates the index itself (`create_or_update_index`), and Free allows 3 indexes. Step 9 uses this service's endpoint and keys. If the old project already uses an index named `documents-index` with a different schema, I set `SEARCH_INDEX` to a different name in Step 9. I do not delete the old service, because another project uses it.
   If I ever want a new service instead, set `createSearch=true` and delete or change the Free service first (Basic is about $75/month, so avoid it).

---

4. **Push the new files:**
   ```powershell
   git add .
   git commit -m "Add Storage, Search and OpenAI Bicep, switch to gpt-5-mini, update backend"
   git push
   ```

   **What each command does:**

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all new and changed files for the commit |
   | `git commit -m "..."` | Saves the staged files as a snapshot in local history |
   | `git push` | Uploads the commit to GitHub. It only sends commits: if I skip `git commit`, it says `Everything up-to-date`. |

   This push also changes `Code/**`, so `build-push-images` runs and rebuilds the `backend-api` image with the gpt-5 fixes.

---

5. **Run `Deploy Storage, Search and OpenAI (infra)`:** GitHub repo > **Actions** tab > select it > **Run workflow** > `main`. Takes about 3-5 minutes.

   **`infra/data-ai.bicep`, section by section** (click a section to expand it). Bicep is the language that describes Azure resources as code; the workflow below deploys this file.
   
   <details>
   <summary><b>Show the whole file</b></summary>
   
   ```bicep
   param location string = resourceGroup().location
   
   @description('Makes globally unique names; stable for a given resource group')
   param suffix string = uniqueString(resourceGroup().id)
   
   param chatModel string = 'gpt-5-mini'
   param chatModelVersion string = '2025-08-07'
   param embedModel string = 'text-embedding-3-small'
   param embedModelVersion string = '1'
   
   @description('Set false to reuse an existing AI Search service (only one Free service is allowed per subscription)')
   param createSearch bool = true
   
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
       allowSharedKeyAccess: false
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
   resource search 'Microsoft.Search/searchServices@2023-11-01' = if (createSearch) {
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
       disableLocalAuth: true
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
   output searchName string = createSearch ? search.name : 'existing (not created)'
   output openaiName string = openai.name
   ```
   
   </details>
   
   <details>
   <summary><b>1. Parameters</b></summary>
   
   ```bicep
   param location string = resourceGroup().location
   
   @description('Makes globally unique names; stable for a given resource group')
   param suffix string = uniqueString(resourceGroup().id)
   
   param chatModel string = 'gpt-5-mini'
   param chatModelVersion string = '2025-08-07'
   param embedModel string = 'text-embedding-3-small'
   param embedModelVersion string = '1'
   
   @description('Set false to reuse an existing AI Search service (only one Free service is allowed per subscription)')
   param createSearch bool = true
   ```
   
   Inputs to the file, all with defaults:
   - **`location`** is the resource group's region.
   - **`suffix`** is a short code made by `uniqueString` from the resource group's ID. It's always the same for this resource group, so re-running gives the same names.
   - **`chatModel` / `chatModelVersion`** and **`embedModel` / `embedModelVersion`** say which OpenAI models to deploy. To swap a model, change these two pairs.
   - **`createSearch`** switches the AI Search service on or off. The workflow passes `false` because I reuse a Free search service that already exists.
   
   </details>
   
   <details>
   <summary><b>2. Variables (resource names)</b></summary>
   
   ```bicep
   var storageName = 'stcloudai${suffix}'
   var searchName = 'srch-cloud-ai-${suffix}'
   var openaiName = 'oai-cloud-ai-${suffix}'
   ```
   
   A **variable** is a value worked out inside the file. These build the names from the fixed prefix plus the suffix. Storage, Search and OpenAI names must be unique across all of Azure, and storage names are limited to 24 lowercase letters and digits (`stcloudai` plus the 13-character suffix is 22). `identity.bicep` uses the same rule to find these resources again.
   
   </details>
   
   <details>
   <summary><b>3. Storage account</b></summary>
   
   ```bicep
   resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
     name: storageName
     location: location
     sku: { name: 'Standard_LRS' }
     kind: 'StorageV2'
     properties: {
       minimumTlsVersion: 'TLS1_2'
       allowBlobPublicAccess: false
       allowSharedKeyAccess: false
     }
   }
   ```
   
   - **`Standard_LRS`** is the cheapest redundancy: three copies in one datacenter.
   - **`kind: StorageV2`** is the standard general-purpose account type.
   - **`minimumTlsVersion: TLS1_2`** refuses older, weaker encryption.
   - **`allowBlobPublicAccess: false`** means no file can ever be made public.
   - **`allowSharedKeyAccess: false`** (added in Step 13) turns off the account keys. Only Entra ID sign-in works, so the apps must use their managed identities.
   
   </details>
   
   <details>
   <summary><b>4. Blob container and queue</b></summary>
   
   ```bicep
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
   ```
   
   Resources that live inside another one use **`parent`**. The chain is storage account, then a service (`default`), then the item inside it:
   - **`documents`** is the blob container where uploaded PDFs are stored.
   - **`ingest-jobs`** is the queue the API writes to when a PDF is uploaded and the worker reads from.
   
   </details>
   
   <details>
   <summary><b>5. AI Search (optional)</b></summary>
   
   ```bicep
   resource search 'Microsoft.Search/searchServices@2023-11-01' = if (createSearch) {
     name: searchName
     location: location
     sku: { name: 'free' }
     properties: {
       replicaCount: 1
       partitionCount: 1
       hostingMode: 'default'
     }
   }
   ```
   
   - **`if (createSearch)`** makes the resource conditional. With `createSearch=false`, Bicep skips it completely.
   - **`sku: free`** is the free tier: 50 MB, 3 indexes, and only one allowed per subscription.
   - **`replicaCount`** and **`partitionCount`** of 1 are the only values the free tier allows.
   
   </details>
   
   <details>
   <summary><b>6. Azure OpenAI account</b></summary>
   
   ```bicep
   resource openai 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
     name: openaiName
     location: location
     kind: 'OpenAI'
     sku: { name: 'S0' }
     properties: {
       customSubDomainName: openaiName
       publicNetworkAccess: 'Enabled'
       disableLocalAuth: true
     }
   }
   ```
   
   - **`kind: OpenAI`** with **`sku: S0`** is the standard Azure OpenAI account. It holds the model deployments but does not use any tokens by itself.
   - **`customSubDomainName`** gives the account its own address (`<name>.openai.azure.com`). This is required for signing in with Entra ID instead of keys.
   - **`publicNetworkAccess: Enabled`** lets the AKS pods reach it over the internet.
   - **`disableLocalAuth: true`** (added in Step 13) turns off API keys. Only managed identities work.
   
   </details>
   
   <details>
   <summary><b>7. Model deployments</b></summary>
   
   ```bicep
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
   ```
   
   A **deployment** makes one model available under a name the apps call.
   - **`name: chat`** and **`name: embeddings`** are the names the app's settings use (`OPENAI_CHAT_DEPLOYMENT` and `OPENAI_EMBED_DEPLOYMENT`). They must match.
   - **`sku: GlobalStandard`, `capacity: 10`** is pay-per-token with a small rate limit of about 10,000 tokens a minute, which is enough for this project.
   - **`model`** picks which model and version to run, from the parameters in section 1.
   - **`dependsOn: [ chatDeployment ]`** makes the second one wait for the first, because Azure can't create two deployments on one account at the same time.
   
   </details>
   
   <details>
   <summary><b>8. Outputs</b></summary>
   
   ```bicep
   output storageName string = storage.name
   output searchName string = createSearch ? search.name : 'existing (not created)'
   output openaiName string = openai.name
   ```
   
   Return the three resource names after the deployment. The search line uses `condition ? a : b`: if no search service was created, it prints a note instead of failing on a missing resource.
   
   </details>
   
   
   **The `Deploy Storage, Search and OpenAI (infra)` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-data-ai.yml`. It follows the same pattern as the `Deploy ACR (infra)` workflow in Step 5, so the shared parts are short here.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy Storage, Search and OpenAI (infra)
   
   on:
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     RG: rg-portfolio
   
   jobs:
     deploy-data-ai:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Deploy with Bicep
           run: |
             az deployment group create \
               -g $RG \
               -f infra/data-ai.bicep \
               -p createSearch=false
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy Storage, Search and OpenAI (infra)
   ```

   The label shown in the **Actions** tab. The name still says Search even though the workflow no longer creates one (see section 6).

   </details>

   <details>
   <summary><b>2. Trigger (<code>on</code>)</b></summary>

   ```yaml
   on:
     workflow_dispatch:
   ```

   Only the **Run workflow** button. I run it on purpose: once to create the resources (Step 8), and again in Step 13 to turn off the account keys.

   </details>

   <details>
   <summary><b>3. Permissions, job and runner</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read

   jobs:
     deploy-data-ai:
       runs-on: ubuntu-latest
       steps:
   ```

   Same as the ACR workflow: `id-token: write` lets the job get an OIDC token for the Azure login, `contents: read` lets it download the repo, and the job runs on a temporary Ubuntu machine with the Azure CLI installed.

   </details>

   <details>
   <summary><b>4. Environment variable (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
   ```

   Only the resource group. This workflow needs no registry name and does not create the group.

   </details>

   <details>
   <summary><b>5. Steps: check out and log in</b></summary>

   ```yaml
   - uses: actions/checkout@v4

   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Same as the ACR workflow: download the repo so `infra/data-ai.bicep` is available, then sign in to Azure with OIDC and the three repo secrets from Step 3.

   </details>

   <details>
   <summary><b>6. Step: deploy with Bicep</b></summary>

   ```yaml
   - name: Deploy with Bicep
     run: |
       az deployment group create \
         -g $RG \
         -f infra/data-ai.bicep \
         -p createSearch=false
   ```

   - **`-f infra/data-ai.bicep`** defines the storage account (blob container `documents`, queue `ingest-jobs`) and the Azure OpenAI account with its `chat` and `embeddings` deployments. Since Step 13 it also turns off storage shared keys and OpenAI API keys.
   - **`-p createSearch=false`** tells Bicep not to create an AI Search service. The subscription allows only one Free search service, and I reuse the existing `rag-vector-store` that another project already holds.
   - Re-running updates the resources in place, which is how Step 13 applied the hardening.

   </details>


---

6. **Verify the resources exist:**
   ```powershell
   az resource list -g rg-portfolio --query "[].{name:name, type:type}" -o table
   az cognitiveservices account deployment list -g rg-portfolio -n <openai-name> --query "[].{name:name, model:properties.model.name, state:properties.provisioningState}" -o table
   ```
   Expect the storage account, search service and OpenAI account, plus two deployments in state `Succeeded`. Find `<openai-name>` in the first command's output (it starts with `oai-cloud-ai-`).

   | Command | What it does |
   |---|---|
   | `az resource list -g rg-portfolio` | Lists everything in the resource group, with names and types |
   | `az cognitiveservices account deployment list` | Lists the model deployments (`chat`, `embeddings`) on the OpenAI account |

**Troubleshooting**
- `MissingSubscriptionRegistration`: item 1 isn't finished.
- `InvalidTemplateDeployment` mentioning model, version or quota: the model version isn't available or the region has no quota. Run item 2, then change the version or try another region.
- `ServiceQuotaExceeded` or "only one free search service": see item 3.
- `SpecialFeatureOrQuotaIdNotFound` or access denied on OpenAI: the subscription may lack Azure OpenAI access. Check the portal under Azure OpenAI.

**Save money:** the Free search tier and storage cost almost nothing when idle. OpenAI charges only for tokens used. Nothing here needs stopping.

---

---

## Step 9: Deploy the Backend and Worker with Managed Identity

**Why:** completes the app with **no keys or connection strings**. Each app gets its own Azure managed identity. Pods prove who they are through AKS Workload Identity, and Azure roles decide what each identity may do.

**How it fits together**

| Piece | Role |
|---|---|
| Managed identities `id-api`, `id-worker` | The Azure identity each app runs as |
| Federated credential (per identity) | Trusts one Kubernetes ServiceAccount: "tokens from AKS for `rag-app/sa-api` may act as `id-api`" |
| ServiceAccounts `sa-api`, `sa-worker` | The Kubernetes identity of each pod, annotated with the managed identity's client ID |
| Pod label `azure.workload.identity/use: "true"` | Tells AKS to inject the token into the pod |
| `DefaultAzureCredential` in the code | Picks up that token automatically (and `az login` when running locally) |
| Role assignments | Storage, OpenAI and Search permissions per identity |

**Roles**

| Identity | Storage | OpenAI | AI Search |
|---|---|---|---|
| `id-api` | Blob Data Contributor, Queue Message Sender | OpenAI User | Index Data Contributor (reads and deletes chunks) |
| `id-worker` | Blob Data Contributor (updates blob status), Queue Message Processor | OpenAI User | Index Data Contributor, Service Contributor (creates the index) |

This is slightly wider than the table in `docs/architecture.md`, because the code deletes chunks and updates blob metadata.

**Files added or changed**

| File | Change |
|---|---|
| `infra/identity.bicep` | New: identities, federated credentials, Storage and OpenAI role assignments |
| `.github/workflows/deploy-identity.yml` | New: deploys `identity.bicep` (manual run) |
| `k8s/serviceaccounts.yaml` | New: `sa-api` and `sa-worker` |
| `k8s/backend-api.yaml`, `k8s/ingestion-worker.yaml` | New: Deployments using the ServiceAccounts, the workload identity label, and settings from the `app-config` ConfigMap |
| `backend-api/main.py`, `ingestion-worker/worker.py` | Changed: `DefaultAzureCredential` instead of keys. Env var `STORAGE_ACCOUNT_NAME` replaces the connection string. |
| both `requirements.txt` | Added `azure-identity` |

**The Step 9 manifests, file by file** (click a section to expand it). Each file has a **Show the whole file** button first, then one section per part.

**`k8s/serviceaccounts.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
# The client-id annotation is added with `kubectl annotate` (see implementation.md, Step 9),
# so no Azure IDs are stored in git.
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sa-api
  namespace: rag-app
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sa-worker
  namespace: rag-app
```

</details>

<details>
<summary><b>1. Comment</b></summary>

```yaml
# The client-id annotation is added with `kubectl annotate` (see implementation.md, Step 9),
# so no Azure IDs are stored in git.
```

A ServiceAccount links to a managed identity through an annotation that holds the identity's client ID. I add that annotation with a command instead of writing it in the file, so no Azure IDs end up in git.

</details>

<details>
<summary><b>2. The API's ServiceAccount</b></summary>

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sa-api
  namespace: rag-app
```

A **ServiceAccount** is the Kubernetes identity a pod runs as. `sa-api` is used by the backend. Its name must match the federated credential on `id-api`, whose subject is `system:serviceaccount:rag-app:sa-api`.

</details>

<details>
<summary><b>3. Separator and the worker's ServiceAccount</b></summary>

```yaml
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: sa-worker
  namespace: rag-app
```

`---` separates the two objects. `sa-worker` is the same idea for the worker, tied to `id-worker`. Two separate accounts keep their permissions separate.

</details>

**`k8s/backend-api.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-api
  namespace: rag-app
spec:
  replicas: 1
  # One small node: replace the old pod instead of starting a second one next to it
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: backend-api
  template:
    metadata:
      labels:
        app: backend-api
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: sa-api
      containers:
        - name: backend-api
          image: azurecloudai12345.azurecr.io/backend-api:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
          envFrom:
            - configMapRef:
                name: app-config
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 15
```

</details>

<details>
<summary><b>1. Deployment header</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-api
  namespace: rag-app
```

A **Deployment** keeps the desired number of pods running and handles rolling updates. This one is `backend-api`, in the `rag-app` namespace.

</details>

<details>
<summary><b>2. Replicas and rollout strategy</b></summary>

```yaml
spec:
  replicas: 1
  # One small node: replace the old pod instead of starting a second one next to it
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
```

- **`replicas: 1`** runs one pod.
- **`maxSurge: 0`** means no extra pod is started during an update.
- **`maxUnavailable: 1`** allows the one existing pod to stop first.

A normal update starts the new pod before stopping the old one, which needs room for both. My one node was full, so the new pod stayed `Pending` forever. With this setting the old pod stops, then the new one takes its place. The cost is a short outage on each deploy.

</details>

<details>
<summary><b>3. Selector</b></summary>

```yaml
  selector:
    matchLabels:
      app: backend-api
```

Tells the Deployment which pods are its own: those labelled `app: backend-api`. It must match the labels in the pod template.

</details>

<details>
<summary><b>4. Pod labels, including the workload identity label</b></summary>

```yaml
  template:
    metadata:
      labels:
        app: backend-api
        azure.workload.identity/use: "true"
```

- **`app: backend-api`** is how the Deployment and the `backend-api` Service find the pod.
- **`azure.workload.identity/use: "true"`** tells AKS Workload Identity to inject an Azure token into this pod. Without the label, the pod can't sign in as its managed identity.

</details>

<details>
<summary><b>5. ServiceAccount</b></summary>

```yaml
    spec:
      serviceAccountName: sa-api
```

Runs the pod as `sa-api`, which is linked to the managed identity `id-api`. That link is what gives the code access to Storage, OpenAI and Search without keys.

</details>

<details>
<summary><b>6. Container</b></summary>

```yaml
      containers:
        - name: backend-api
          image: azurecloudai12345.azurecr.io/backend-api:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
```

- **`image`** is the backend image in my registry. The pipeline replaces `:latest` with the commit SHA tag.
- **`imagePullPolicy: Always`** checks the registry on every start.
- **`containerPort: 8000`** is where FastAPI (uvicorn) listens.

</details>

<details>
<summary><b>7. Settings from the ConfigMap</b></summary>

```yaml
          envFrom:
            - configMapRef:
                name: app-config
```

Turns every key in the `app-config` ConfigMap (endpoints, deployment names, the Application Insights connection string) into an environment variable. The ConfigMap holds no passwords or keys.

</details>

<details>
<summary><b>8. Resources</b></summary>

```yaml
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

- **`requests`** is what the scheduler reserves on the node.
- **`limits`** is the maximum the container may use. Going over the memory limit gets it restarted.

</details>

<details>
<summary><b>9. Health probes</b></summary>

```yaml
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 15
```

- **`readinessProbe`** sends traffic to the pod only once `/health` answers.
- **`livenessProbe`** restarts the container if `/health` stops answering. `initialDelaySeconds: 15` gives it time to start first.

</details>

**`k8s/ingestion-worker.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ingestion-worker
  namespace: rag-app
spec:
  replicas: 1
  # One small node: replace the old pod instead of starting a second one next to it
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: ingestion-worker
  template:
    metadata:
      labels:
        app: ingestion-worker
        azure.workload.identity/use: "true"
    spec:
      serviceAccountName: sa-worker
      containers:
        - name: ingestion-worker
          image: azurecloudai12345.azurecr.io/ingestion-worker:latest
          imagePullPolicy: Always
          envFrom:
            - configMapRef:
                name: app-config
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

</details>

<details>
<summary><b>1. Deployment header</b></summary>

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ingestion-worker
  namespace: rag-app
```

A Deployment named `ingestion-worker`, in the `rag-app` namespace. It runs the process that reads upload jobs from the queue and indexes the PDFs.

</details>

<details>
<summary><b>2. Replicas and rollout strategy</b></summary>

```yaml
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
```

One pod, and updates replace the old pod instead of starting a second one next to it, because the single node has no spare room. Same reasoning as `backend-api.yaml`.

</details>

<details>
<summary><b>3. Selector and pod labels</b></summary>

```yaml
  selector:
    matchLabels:
      app: ingestion-worker
  template:
    metadata:
      labels:
        app: ingestion-worker
        azure.workload.identity/use: "true"
```

- **`selector`** tells the Deployment which pods are its own.
- **`azure.workload.identity/use: "true"`** makes AKS inject an Azure token so the pod can sign in as its managed identity.

</details>

<details>
<summary><b>4. ServiceAccount</b></summary>

```yaml
    spec:
      serviceAccountName: sa-worker
```

Runs the pod as `sa-worker`, linked to the managed identity `id-worker`. That identity can process queue messages, write blob status, create the search index and call OpenAI.

</details>

<details>
<summary><b>5. Container</b></summary>

```yaml
      containers:
        - name: ingestion-worker
          image: azurecloudai12345.azurecr.io/ingestion-worker:latest
          imagePullPolicy: Always
```

The worker image from my registry (the pipeline replaces `:latest` with the commit SHA). There is no `ports` section and no probes, because the worker doesn't serve HTTP: it just polls the queue.

</details>

<details>
<summary><b>6. Settings and resources</b></summary>

```yaml
          envFrom:
            - configMapRef:
                name: app-config
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

- **`envFrom`** turns the keys in the `app-config` ConfigMap into environment variables. No secrets are in it.
- **`resources`** reserves 100m CPU and 256 MiB on the node, and caps the container at 500m and 512 MiB.

</details>


1. **Commit and push** (this also rebuilds the images with the new code):
   ```powershell
   git add .
   git commit -m "Use managed identity: identities, k8s manifests, code changes"
   git push
   ```
   Wait for **Build and push images to ACR** to turn green (Actions tab) before deploying the pods.

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all new and changed files |
   | `git commit -m "..."` | Saves them as a snapshot in local history |
   | `git push` | Uploads the commit to GitHub. Changes under `Code/**` trigger the image build. |

---

2. **Run `Deploy identities and roles (infra)`:** repo > **Actions** tab > select it > **Run workflow** > `main`. Then verify:
   ```powershell
   az identity list -g rg-portfolio --query "[].{name:name, clientId:clientId}" -o table
   ```
   Expect `id-api` and `id-worker`.

   | Command | What it does |
   |---|---|
   | `az identity list -g rg-portfolio` | Lists managed identities in the resource group, with their client IDs |

   **`infra/identity.bicep`, section by section** (click a section to expand it). Bicep is the language that describes Azure resources as code; the workflow below deploys this file.
   
   <details>
   <summary><b>Show the whole file</b></summary>
   
   ```bicep
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
   ```
   
   </details>
   
   <details>
   <summary><b>1. Parameters and names</b></summary>
   
   ```bicep
   param location string = resourceGroup().location
   param clusterName string = 'aks-azure-cloud-ai'
   param namespace string = 'rag-app'
   
   // Same naming rule as data-ai.bicep, so these resolve to the resources Step 8 created
   param suffix string = uniqueString(resourceGroup().id)
   var storageName = 'stcloudai${suffix}'
   var openaiName = 'oai-cloud-ai-${suffix}'
   ```
   
   - **`clusterName`** and **`namespace`** say which cluster and Kubernetes namespace the identities will trust.
   - **`suffix`**, **`storageName`** and **`openaiName`** use the exact same rule as `data-ai.bicep`, so this file works out the real names of the storage and OpenAI accounts without anyone passing them in.
   
   </details>
   
   <details>
   <summary><b>2. Existing resources</b></summary>
   
   ```bicep
   resource aks 'Microsoft.ContainerService/managedClusters@2024-02-01' existing = {
     name: clusterName
   }
   
   resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
     name: storageName
   }
   
   resource openai 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
     name: openaiName
   }
   ```
   
   **`existing`** means "look this up, don't create it". These three were created by earlier steps. The file needs them to read the cluster's token issuer address and to attach permissions to the storage and OpenAI accounts.
   
   </details>
   
   <details>
   <summary><b>3. Built-in role IDs</b></summary>
   
   ```bicep
   var blobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
   var queueMessageSender = 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'
   var queueMessageProcessor = '8a0f0c08-91a1-4084-bc3d-661d67233fed'
   var openaiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
   ```
   
   Azure's built-in roles have fixed IDs. These variables give them readable names:
   - **Storage Blob Data Contributor:** read, write and delete blobs.
   - **Storage Queue Data Message Sender:** put messages on a queue.
   - **Storage Queue Data Message Processor:** read and delete queue messages.
   - **Cognitive Services OpenAI User:** call the OpenAI models.
   
   </details>
   
   <details>
   <summary><b>4. The two managed identities</b></summary>
   
   ```bicep
   resource idApi 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
     name: 'id-api'
     location: location
   }
   
   resource idWorker 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
     name: 'id-worker'
     location: location
   }
   ```
   
   A **user-assigned managed identity** is an Azure identity with no password, created for one purpose. `id-api` is for the backend and `id-worker` is for the worker. Using two keeps each app's permissions separate (least privilege).
   
   </details>
   
   <details>
   <summary><b>5. Federated credentials (trusting the Kubernetes ServiceAccounts)</b></summary>
   
   ```bicep
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
   ```
   
   A **federated credential** says: "trust tokens from this issuer, for this subject, as this identity". It's the same idea as the one for GitHub Actions in Step 2, but for pods.
   - **`parent`** attaches it to the identity.
   - **`issuer`** is the cluster's token issuer address, read from the cluster resource.
   - **`subject`** is the Kubernetes ServiceAccount allowed to use the identity: `system:serviceaccount:rag-app:sa-api` (or `sa-worker`). The ServiceAccount names in `k8s/serviceaccounts.yaml` must match exactly.
   - **`audiences`** is Azure's token exchange, the same value every time.
   
   </details>
   
   <details>
   <summary><b>6. Role assignments for backend-api</b></summary>
   
   ```bicep
   resource apiBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
     name: guid(storage.id, idApi.id, blobDataContributor)
     scope: storage
     properties: {
       roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributor)
       principalId: idApi.properties.principalId
       principalType: 'ServicePrincipal'
     }
   }
   ```
   
   (`apiQueue` and `apiOpenai` follow the same pattern, so only the first is shown here. The whole-file button above has all three.)
   
   A role assignment answers: who may do what, where.
   - **`name: guid(...)`** is calculated from the scope, the identity and the role. It stays the same on every run, so re-running never creates duplicates.
   - **`scope`** is where the permission applies: the storage account or the OpenAI account only.
   - **`roleDefinitionId`** is the role from section 3.
   - **`principalId`** is the identity receiving the role (`id-api`).
   - **`principalType: ServicePrincipal`** avoids a delay while Azure works out what kind of identity it is.
   
   The three assignments give the backend: blob read and write, queue send, and OpenAI use.
   
   </details>
   
   <details>
   <summary><b>7. Role assignments for ingestion-worker</b></summary>
   
   ```bicep
   resource workerQueue 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
     name: guid(storage.id, idWorker.id, queueMessageProcessor)
     scope: storage
     properties: {
       roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueMessageProcessor)
       principalId: idWorker.properties.principalId
       principalType: 'ServicePrincipal'
     }
   }
   ```
   
   (`workerBlob` and `workerOpenai` follow the same pattern.)
   
   The same structure, for `id-worker`. The worker gets blob read and write (it updates each document's status), **queue message processor** (it reads and deletes jobs, instead of the backend's send-only role), and OpenAI use.
   
   </details>
   
   <details>
   <summary><b>8. Outputs and the Search roles</b></summary>
   
   ```bicep
   // Search roles are assigned with the CLI (the service is in another resource group)
   output apiClientId string = idApi.properties.clientId
   output apiPrincipalId string = idApi.properties.principalId
   output workerClientId string = idWorker.properties.clientId
   output workerPrincipalId string = idWorker.properties.principalId
   ```
   
   - The outputs return each identity's **client ID** and **principal ID** after the deployment.
   - The AI Search roles are not in this file. The search service is in another resource group that the pipeline can't touch, so I assign those roles by hand with the CLI (Step 9, item 3).
   
   </details>
   
   
   **The `Deploy identities and roles (infra)` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-identity.yml`. It follows the same pattern as the `Deploy ACR (infra)` workflow in Step 5, so the shared parts are short here.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy identities and roles (infra)
   
   on:
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     RG: rg-portfolio
   
   jobs:
     deploy-identity:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Deploy identities with Bicep
           run: |
             az deployment group create \
               -g $RG \
               -f infra/identity.bicep
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy identities and roles (infra)
   ```

   The label shown in the **Actions** tab.

   </details>

   <details>
   <summary><b>2. Trigger (<code>on</code>)</b></summary>

   ```yaml
   on:
     workflow_dispatch:
   ```

   Only the **Run workflow** button. Identities and permissions should change only when I decide to.

   </details>

   <details>
   <summary><b>3. Permissions, job and runner</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read

   jobs:
     deploy-identity:
       runs-on: ubuntu-latest
       steps:
   ```

   Same as the ACR workflow: `id-token: write` lets the job get an OIDC token for the Azure login, `contents: read` lets it download the repo, and the job runs on a temporary Ubuntu machine with the Azure CLI installed.

   </details>

   <details>
   <summary><b>4. Environment variable (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
   ```

   Only the resource group. The Bicep file works out the storage and OpenAI account names itself, using the same `uniqueString` rule as `data-ai.bicep`, so no names need to be passed in.

   </details>

   <details>
   <summary><b>5. Steps: check out and log in</b></summary>

   ```yaml
   - uses: actions/checkout@v4

   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Same as the ACR workflow: download the repo so `infra/identity.bicep` is available, then sign in to Azure with OIDC and the three repo secrets from Step 3.

   </details>

   <details>
   <summary><b>6. Step: deploy the identities with Bicep</b></summary>

   ```yaml
   - name: Deploy identities with Bicep
     run: |
       az deployment group create \
         -g $RG \
         -f infra/identity.bicep
   ```

   - **`-f infra/identity.bicep`** creates the managed identities `id-api` and `id-worker`, a federated credential for each (trusting the Kubernetes ServiceAccounts `sa-api` and `sa-worker`), and their role assignments on Storage and OpenAI.
   - There are no `-p` parameters because every value has a default.
   - It needs `User Access Administrator` on the resource group (Step 6, item 3), because it creates role assignments.
   - The AI Search roles are not here. The search service is in another resource group, so I assign those by hand in item 3 of this step.

   </details>


---

3. **Give both identities access to the shared AI Search service.** It's in another resource group (`rg-rag-qa-demo`), so the pipeline can't do this. Run it as me:
   ```powershell
   $apiPid = az identity show -g rg-portfolio -n id-api --query principalId -o tsv
   $workerPid = az identity show -g rg-portfolio -n id-worker --query principalId -o tsv
   $searchId = az search service show -g rg-rag-qa-demo -n rag-vector-store --query id -o tsv

   az search service update -g rg-rag-qa-demo -n rag-vector-store --auth-options aadOrApiKey --aad-auth-failure-mode http401WithBearerChallenge

   az role assignment create --assignee-object-id $apiPid --assignee-principal-type ServicePrincipal --role "Search Index Data Contributor" --scope $searchId
   az role assignment create --assignee-object-id $workerPid --assignee-principal-type ServicePrincipal --role "Search Index Data Contributor" --scope $searchId
   az role assignment create --assignee-object-id $workerPid --assignee-principal-type ServicePrincipal --role "Search Service Contributor" --scope $searchId
   ```

   | Command | What it does |
   |---|---|
   | `az identity show ... principalId` | Gets each identity's object ID, which role assignments need |
   | `az search service show ... id` | Gets the search service's full resource ID, to use as the scope |
   | `az search service update --auth-options aadOrApiKey` | Turns on Entra ID (role-based) sign-in. API keys keep working, so the old project is unaffected. |
   | `--aad-auth-failure-mode http401WithBearerChallenge` | Makes failed token sign-ins return a clear 401 |
   | `az role assignment create ...` | Grants a role on the search service to an identity |

---

4. **Create the app settings as a ConfigMap** (no secrets in it):
   ```powershell
   $st = az storage account list -g rg-portfolio --query "[0].name" -o tsv
   $oai = az cognitiveservices account list -g rg-portfolio --query "[?kind=='OpenAI'].name | [0]" -o tsv
   $oaiEndpoint = az cognitiveservices account show -g rg-portfolio -n $oai --query properties.endpoint -o tsv
   "$st | $oaiEndpoint"

   kubectl create configmap app-config -n rag-app `
     --from-literal="STORAGE_ACCOUNT_NAME=$st" `
     --from-literal="SEARCH_ENDPOINT=https://rag-vector-store.search.windows.net" `
     --from-literal="SEARCH_INDEX=azure-cloud-ai-index" `
     --from-literal="OPENAI_ENDPOINT=$oaiEndpoint" `
     --from-literal="OPENAI_API_VERSION=2025-04-01-preview" `
     --from-literal="OPENAI_CHAT_DEPLOYMENT=chat" `
     --from-literal="OPENAI_EMBED_DEPLOYMENT=embeddings" `
     --from-literal="OPENAI_CHAT_MODEL=gpt-5-mini" `
     --from-literal="OPENAI_EMBED_MODEL=text-embedding-3-small" `
     --from-literal="EMBED_DIMENSIONS=1536"
   ```
   The `"$st | $oaiEndpoint"` line just prints the two values so I can check they aren't empty.

   | Part | What it does |
   |---|---|
   | `az storage account list ... -o tsv` | Gets the storage account name Step 8 created |
   | `az cognitiveservices account ...` | Gets the OpenAI account name and endpoint URL |
   | `kubectl create configmap app-config -n rag-app` | Creates a ConfigMap of plain settings. The Deployments read it as environment variables. |
   | `SEARCH_INDEX=azure-cloud-ai-index` | Own index name, so I don't clash with the old project in the shared search service |
   | `OPENAI_*_DEPLOYMENT` | Must match the deployment names in `data-ai.bicep` (`chat`, `embeddings`) |
   | Backtick at line end | PowerShell line continuation |

   **Changing a value later:** `kubectl delete configmap app-config -n rag-app`, re-run the create command, then `kubectl rollout restart deployment/backend-api deployment/ingestion-worker -n rag-app`.

---

5. **Create the ServiceAccounts and link them to the identities:**
   ```powershell
   kubectl apply -f k8s/serviceaccounts.yaml

   $apiClientId = az identity show -g rg-portfolio -n id-api --query clientId -o tsv
   $workerClientId = az identity show -g rg-portfolio -n id-worker --query clientId -o tsv

   kubectl annotate serviceaccount sa-api -n rag-app azure.workload.identity/client-id=$apiClientId --overwrite
   kubectl annotate serviceaccount sa-worker -n rag-app azure.workload.identity/client-id=$workerClientId --overwrite
   ```

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/serviceaccounts.yaml` | Creates `sa-api` and `sa-worker` in `rag-app` |
   | `az identity show ... clientId` | Gets the client ID of each managed identity |
   | `kubectl annotate serviceaccount ... client-id=...` | Tells Workload Identity which managed identity this ServiceAccount maps to |

---

6. **Deploy the backend and worker:**
   ```powershell
   kubectl apply -f k8s/
   kubectl get pods -n rag-app -w
   ```
   Wait until `frontend`, `backend-api` and `ingestion-worker` all show `1/1 Running`, then press Ctrl+C.

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/` | Creates or updates everything in the folder |
   | `kubectl get pods -n rag-app -w` | Lists pods and keeps watching for changes |

---

7. **Check the logs:**
   ```powershell
   kubectl logs deployment/backend-api -n rag-app
   kubectl logs deployment/ingestion-worker -n rag-app
   ```
   Expect no `Traceback` or authentication errors. The worker should log that the search index is ready and that it's waiting for messages.

   | Command | What it does |
   |---|---|
   | `kubectl logs deployment/<name> -n rag-app` | Prints the container's output |

---

8. **Test through the public IP:**
   ```powershell
   $ip = kubectl get service frontend -n rag-app -o jsonpath="{.status.loadBalancer.ingress[0].ip}"
   curl.exe http://$ip/api/health
   curl.exe http://$ip/api/info
   ```
   `/api/health` returns `{"status":"ok"}`. `/api/info` shows `chat_model` as `gpt-5-mini`. Then open `http://<EXTERNAL-IP>` in a browser, upload a small PDF, wait for `ready`, and ask a question.

   | Command | What it does |
   |---|---|
   | `kubectl get service frontend ... jsonpath` | Extracts the public IP into `$ip` |
   | `curl.exe http://$ip/api/health` | Calls the backend through the frontend's nginx (`/api/` goes to `backend-api:8000`) |

**Check**
- All three pods `Running`, and no keys anywhere: `kubectl get secrets -n rag-app` shows nothing app-related.
- A PDF uploads, reaches `ready`, and a question gets an answer with page citations.

**Troubleshooting**
- `CredentialUnavailableError` or `ClientAuthenticationError` in the logs: the ServiceAccount annotation (item 5) or the pod label is missing, or the federated credential subject doesn't match. It must be `system:serviceaccount:rag-app:sa-api` (or `sa-worker`).
- `403 AuthorizationPermissionMismatch` (Storage) or `PermissionDenied` (OpenAI): the role assignment from item 2 isn't there yet. Role assignments can take up to 10 minutes. Wait, then restart the pods.
- `403` from Search: item 3 isn't finished, or RBAC isn't enabled on the service.
- `CreateContainerConfigError`: the `app-config` ConfigMap is missing. Re-run item 4.
- `KeyError: 'STORAGE_ACCOUNT_NAME'` (or similar) in the logs: a key is missing from the ConfigMap.
- `ImagePullBackOff` or old behavior: the image build from item 1 hasn't finished or failed.
- `/api/...` returns 502: the backend pod isn't ready. Check its logs.
- `DeploymentNotFound` (404 from OpenAI): the deployment names don't match. Run `az cognitiveservices account deployment list -g rg-portfolio -n $oai -o table`.
- `400 unsupported parameter` on `/ask`: the chat call must not set `temperature` (already removed) and the API version must be recent.

**Later hardening:** turn off shared-key access on the storage account (`allowSharedKeyAccess: false`) and disable local auth on OpenAI, so keys can't be used at all.

---

---

## Step 10: Deploy to AKS Automatically (CI/CD)

**Why:** until now I rebuilt images and ran `kubectl` by hand. Now a push to `main` builds the images, tags them with the commit SHA, and deploys that exact version to AKS.

**The flow**

| Stage | Workflow | What happens |
|---|---|---|
| 1. Build | `build-push-images.yml` (existing) | On push to `Code/**` or `k8s/**`: builds the three images in ACR, tagged with the commit SHA |
| 2. Deploy | `deploy-app.yml` (new) | Runs after the build succeeds: updates the four manifests with the SHA-tagged images and rolls them out on AKS |

**Files added or changed**

| File | Change |
|---|---|
| `.github/workflows/deploy-app.yml` | New: logs in with OIDC, connects to the cluster, deploys with `azure/k8s-deploy` |
| `.github/workflows/build-push-images.yml` | Changed: `k8s/**` added to the trigger paths, so manifest changes also flow through |

**What the deploy workflow does**

| Part | What it does |
|---|---|
| `on: workflow_run` | Starts when the build workflow finishes on `main`. The `if:` skips the deploy if the build failed. |
| `on: workflow_dispatch` | Lets me deploy by hand, with an optional `image_tag` (a tag that already exists in ACR) |
| `TAG` | The commit SHA that was built. This is what makes each deploy traceable. |
| `azure/login` | OIDC login, no secrets stored (same identity as Step 2) |
| `azure/aks-set-context` | Points `kubectl` at the cluster |
| `azure/k8s-deploy` | Swaps the image tags in the manifests, applies them, and waits for the rollout to finish |
| `concurrency` | Prevents two deploys from running at the same time |

The namespace and ServiceAccounts are not applied by the pipeline. They are one-time setup from Steps 7 and 9, and the ServiceAccounts carry the client ID annotations added by hand.

**Requirement:** the AKS cluster must be running. A stopped cluster makes the deploy fail (`az aks start` first).

1. **Make sure the cluster is running:**
   ```powershell
   az aks show -g rg-portfolio -n aks-azure-cloud-ai --query powerState.code -o tsv
   ```
   It must print `Running`. If `Stopped`, run `az aks start -g rg-portfolio -n aks-azure-cloud-ai`.

   | Command | What it does |
   |---|---|
   | `az aks show ... --query powerState.code` | Prints whether the cluster is `Running` or `Stopped` |

---

2. **Commit and push the workflow changes:**
   ```powershell
   git add .
   git commit -m "Add deploy-to-AKS workflow"
   git push
   ```
   The changed `build-push-images.yml` is in the commit, so the push triggers the build, and the deploy follows it.

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all new and changed files |
   | `git commit -m "..."` | Saves them as a snapshot in local history |
   | `git push` | Uploads the commit to GitHub. Pushes that touch the workflow file, `Code/**` or `k8s/**` start the pipeline. |

---

3. **Watch both workflows:** repo > **Actions** tab. First **Build and push images to ACR**, then **Deploy app to AKS** starts on its own. Both should turn green.

   **The `Deploy app to AKS` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-app.yml`.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy app to AKS
   
   # Runs after "Build and push images to ACR" succeeds on main.
   # Images are tagged with the commit SHA, so each deploy is traceable and easy to roll back.
   on:
     workflow_run:
       workflows: ['Build and push images to ACR']
       types: [completed]
       branches: [main]
     workflow_dispatch:
       inputs:
         image_tag:
           description: 'Image tag already in ACR (default: latest commit SHA)'
           required: false
   
   permissions:
     id-token: write
     contents: read
   
   concurrency:
     group: deploy-app
     cancel-in-progress: false
   
   env:
     RG: rg-portfolio
     CLUSTER: aks-azure-cloud-ai
     NAMESPACE: rag-app
     ACR_NAME: ${{ vars.ACR_NAME }}
     TAG: ${{ github.event.workflow_run.head_sha || inputs.image_tag || github.sha }}
   
   jobs:
     deploy:
       # For workflow_run, only deploy when the build succeeded
       if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with:
             ref: ${{ github.event.workflow_run.head_sha || github.sha }}
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - uses: azure/aks-set-context@v4
           with:
             resource-group: ${{ env.RG }}
             cluster-name: ${{ env.CLUSTER }}
   
         # Namespace and ServiceAccounts are one-time setup (Steps 7 and 9), so they are not applied here
         - uses: azure/k8s-deploy@v5
           with:
             namespace: ${{ env.NAMESPACE }}
             manifests: |
               k8s/backend-api-service.yaml
               k8s/backend-api.yaml
               k8s/ingestion-worker.yaml
               k8s/frontend.yaml
             images: |
               ${{ env.ACR_NAME }}.azurecr.io/frontend:${{ env.TAG }}
               ${{ env.ACR_NAME }}.azurecr.io/backend-api:${{ env.TAG }}
               ${{ env.ACR_NAME }}.azurecr.io/ingestion-worker:${{ env.TAG }}
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy app to AKS
   ```

   The label shown in the **Actions** tab. The comments in the file say what it does: it runs after the image build succeeds on `main`, and because the images are tagged with the commit SHA, every deploy is traceable and easy to roll back.

   </details>

   <details>
   <summary><b>2. Triggers (<code>on</code>)</b></summary>

   ```yaml
   on:
     workflow_run:
       workflows: ['Build and push images to ACR']
       types: [completed]
       branches: [main]
     workflow_dispatch:
       inputs:
         image_tag:
           description: 'Image tag already in ACR (default: latest commit SHA)'
           required: false
   ```

   Two ways to start it:
   - **`workflow_run`** starts it when the workflow named `Build and push images to ACR` finishes on `main`. It fires whether the build passed or failed, which is why the job has an `if` check (section 6). The name must match the build workflow's `name:` exactly.
   - **`workflow_dispatch`** adds the **Run workflow** button. It has an optional `image_tag` box, so I can deploy or roll back to any tag that is already in ACR.

   </details>

   <details>
   <summary><b>3. Permissions</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read
   ```

   What the workflow's built-in token may do:
   - **`id-token: write`** lets the job ask GitHub for an OIDC identity token, which Azure checks against the federated credential from Step 2.
   - **`contents: read`** lets the job download the repo's code.

   Everything else is denied.

   </details>

   <details>
   <summary><b>4. Concurrency</b></summary>

   ```yaml
   concurrency:
     group: deploy-app
     cancel-in-progress: false
   ```

   Only one deploy runs at a time. If a second one is triggered while the first is running, it waits its turn. `cancel-in-progress: false` means a running deploy is never cancelled halfway, because stopping a rollout midway could leave the app in a mixed state.

   </details>

   <details>
   <summary><b>5. Environment variables (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
     CLUSTER: aks-azure-cloud-ai
     NAMESPACE: rag-app
     ACR_NAME: ${{ vars.ACR_NAME }}
     TAG: ${{ github.event.workflow_run.head_sha || inputs.image_tag || github.sha }}
   ```

   Values the steps reuse:
   - **`RG`, `CLUSTER`, `NAMESPACE`** say where to deploy: the resource group, the AKS cluster and the Kubernetes namespace.
   - **`ACR_NAME`** comes from the repo variable from Step 4.
   - **`TAG`** is the image version to deploy. The `||` operators pick the first value that exists:
     1. `workflow_run.head_sha`: when started by a finished build, the commit that was just built.
     2. `inputs.image_tag`: when I start it by hand and type a tag.
     3. `github.sha`: when I start it by hand and leave the box empty, the latest commit. That image may not exist yet, so a manual run should normally give a tag.

   </details>

   <details>
   <summary><b>6. Job, runner and the <code>if</code> check</b></summary>

   ```yaml
   jobs:
     deploy:
       # For workflow_run, only deploy when the build succeeded
       if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
       runs-on: ubuntu-latest
       steps:
   ```

   - **`if`** lets the job run when I started it by hand, or when the build workflow finished with `success`. A failed build is skipped, so a broken build never gets deployed.
   - **`runs-on: ubuntu-latest`** is the temporary Linux machine GitHub starts for the job. It is discarded afterwards.

   </details>

   <details>
   <summary><b>7. Step: check out the code</b></summary>

   ```yaml
   - uses: actions/checkout@v4
     with:
       ref: ${{ github.event.workflow_run.head_sha || github.sha }}
   ```

   Downloads the repo onto the runner so the `k8s/` manifests are there. The `ref` makes it check out the exact commit that was built, not whatever `main` points to now. That keeps the manifests and the image tag from the same commit.

   </details>

   <details>
   <summary><b>8. Step: log in to Azure</b></summary>

   ```yaml
   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Signs the runner in to Azure with **OIDC**, using the three repo secrets from Step 3. There is no password: GitHub presents a short-lived token, and Azure accepts it because of the federated credential from Step 2.

   </details>

   <details>
   <summary><b>9. Step: connect to the cluster</b></summary>

   ```yaml
   - uses: azure/aks-set-context@v4
     with:
       resource-group: ${{ env.RG }}
       cluster-name: ${{ env.CLUSTER }}
   ```

   Fetches the AKS cluster's connection details and points `kubectl` at it, so the next step can talk to the cluster. The cluster must be running: if it is stopped, this step fails.

   </details>

   <details>
   <summary><b>10. Step: deploy the manifests with the new images</b></summary>

   ```yaml
   # Namespace and ServiceAccounts are one-time setup (Steps 7 and 9), so they are not applied here
   - uses: azure/k8s-deploy@v5
     with:
       namespace: ${{ env.NAMESPACE }}
       manifests: |
         k8s/backend-api-service.yaml
         k8s/backend-api.yaml
         k8s/ingestion-worker.yaml
         k8s/frontend.yaml
       images: |
         ${{ env.ACR_NAME }}.azurecr.io/frontend:${{ env.TAG }}
         ${{ env.ACR_NAME }}.azurecr.io/backend-api:${{ env.TAG }}
         ${{ env.ACR_NAME }}.azurecr.io/ingestion-worker:${{ env.TAG }}
   ```

   The step that actually deploys:
   - **`manifests`** lists the YAML files to apply. The namespace and ServiceAccounts are left out on purpose: they are one-time setup, and the ServiceAccounts carry client ID annotations I added by hand.
   - **`images`** lists the exact SHA-tagged images. The action replaces the image names in the manifests (which say `:latest`) with these tags before applying them.
   - It then applies the manifests and **waits for the rollout to finish**, so a pod that never becomes ready makes the workflow fail instead of looking green.
   - The `maxSurge: 0` rollout strategy in the Deployments (see Step 12 troubleshooting) means the old pod is stopped before the new one starts, because my one node has no spare room.

   </details>


---

4. **Verify the cluster runs the SHA-tagged images:**
   ```powershell
   git rev-parse HEAD
   kubectl get deployments -n rag-app -o wide
   ```
   The `IMAGES` column should end with the commit SHA from `git rev-parse HEAD`, not `:latest`.

   | Command | What it does |
   |---|---|
   | `git rev-parse HEAD` | Prints the full SHA of the latest commit |
   | `kubectl get deployments -n rag-app -o wide` | Lists Deployments with the images they run |

---

5. **Test the full loop once:** make a tiny visible change in the frontend (for example, text in `Code/Frontend`), then commit and push. After both workflows finish, reload the site. The change should be live with no manual steps.

---

6. **Roll back if a deploy breaks the app:**
   ```powershell
   kubectl rollout undo deployment/backend-api -n rag-app
   kubectl rollout history deployment/backend-api -n rag-app
   ```
   Or run **Deploy app to AKS** manually with an older `image_tag` (any SHA that is still in ACR).

   | Command | What it does |
   |---|---|
   | `kubectl rollout undo deployment/<name>` | Returns that Deployment to its previous version |
   | `kubectl rollout history deployment/<name>` | Lists previous versions (revisions) |

**Check**
- Both workflows are green for the same commit.
- `kubectl get deployments -n rag-app -o wide` shows the commit SHA in the images.
- A small code change reaches the live site through a push alone.

**Troubleshooting**
- **Deploy never starts:** the build workflow failed, or it didn't run for `main`. `workflow_run` only starts from the default branch's workflow file, so the file must be pushed to `main` first.
- **`Login failed` or `AADSTS700213`:** same federated credential issue as Step 2. The `main` branch subject must match.
- **`Forbidden` or `Unauthorized` from `kubectl` in the deploy job:** the pipeline identity can't use the cluster. It has `Contributor` on the subscription, which normally covers it. Check the error text, and tell me if it appears.
- **Cluster stopped or unreachable:** start the cluster, then re-run the failed deploy job.
- **`ImagePullBackOff`:** the tag doesn't exist in ACR. Check `az acr repository show-tags --name <ACR_NAME> --repository frontend -o table`.
- **Rollout times out:** a pod isn't becoming ready. Run `kubectl get pods -n rag-app` and `kubectl logs deployment/<name> -n rag-app`.
- **Manual run uses the wrong tag:** with no `image_tag`, it uses the latest commit SHA, which may not have been built yet. Enter a tag that exists.

---

---

## Step 11: HTTPS and a Stable URL

**Why:** the site is plain HTTP on a bare IP that can change after a stop and start. This step gives it a fixed hostname and a free Let's Encrypt certificate.

**Result:** `https://azure-cloud-ai.eastus.cloudapp.azure.com`

**Choices I made**

| Choice | Reason |
|---|---|
| Traefik ingress controller (Helm) | Light on my single small node. `ingress-nginx` was retired in March 2026, and Microsoft's NGINX add-on is only supported through November 2026. |
| Not the AKS Gateway API add-on | It's Microsoft's recommended future path (Istio-based, GA), but it's likely heavier for one small node and its HTTPS setup is manual (Key Vault). Worth a later upgrade. |
| cert-manager + Let's Encrypt | Free certificates that renew automatically |
| Azure DNS label hostname | Free (`<label>.<region>.cloudapp.azure.com`). A custom domain can replace it later. |

**How the pieces fit together**

| Piece | Role |
|---|---|
| Traefik | Receives traffic from a new public IP (load balancer) and routes it by hostname and path |
| DNS label on the Traefik Service | Gives that IP the name `azure-cloud-ai.eastus.cloudapp.azure.com` |
| cert-manager | Proves to Let's Encrypt that I own the hostname (HTTP-01 challenge through Traefik), then stores the certificate in a Secret and renews it |
| `ClusterIssuer` | Tells cert-manager which Let's Encrypt server to use (staging for tests, prod for real) |
| `Ingress` | Maps the hostname to the `frontend` Service and asks for a certificate. The frontend's nginx already forwards `/api` to the backend. |

**Files added** (in `k8s/`)

| File | Purpose |
|---|---|
| `platform/traefik-values.yaml` | Traefik settings: DNS label annotation and small resource limits |
| `platform/cluster-issuers.yaml` | Let's Encrypt staging and production issuers (needs my email) |
| `ingress.yaml` | HTTPS Ingress for the app |

**The Step 11 files, file by file** (click a section to expand it). Each file has a **Show the whole file** button first, then one section per part.

**`k8s/platform/traefik-values.yaml`, section by section** (a Helm values file, not a Kubernetes manifest: it configures the Traefik install)

<details>
<summary><b>Show the whole file</b></summary>

```yaml
# Helm values for the Traefik ingress controller (installed once by hand, see implementation.md Step 11)
service:
  annotations:
    # Gives the load balancer's public IP a free DNS name:
    #   azure-cloud-ai.eastus.cloudapp.azure.com
    # The label must be unique in the region. If it is taken, change it here AND in k8s/ingress.yaml.
    service.beta.kubernetes.io/azure-dns-label-name: "azure-cloud-ai"

resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 300m
    memory: 128Mi

# Redirect all plain HTTP traffic to HTTPS (Step 13)
ports:
  web:
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
```

</details>

<details>
<summary><b>1. Comment</b></summary>

```yaml
# Helm values for the Traefik ingress controller (installed once by hand, see implementation.md Step 11)
```

Settings that override Traefik's defaults when I run `helm install` and `helm upgrade`. Traefik is installed by hand, one time, so the pipeline doesn't manage this file.

</details>

<details>
<summary><b>2. DNS label for the public IP</b></summary>

```yaml
service:
  annotations:
    # Gives the load balancer's public IP a free DNS name:
    #   azure-cloud-ai.eastus.cloudapp.azure.com
    # The label must be unique in the region. If it is taken, change it here AND in k8s/ingress.yaml.
    service.beta.kubernetes.io/azure-dns-label-name: "azure-cloud-ai"
```

Traefik's Service gets a public IP from Azure's load balancer. This annotation asks Azure to give that IP a free name: `<label>.<region>.cloudapp.azure.com`. The same hostname appears in `ingress.yaml`, so change both together if the label is taken.

</details>

<details>
<summary><b>3. Resources</b></summary>

```yaml
resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    cpu: 300m
    memory: 128Mi
```

Keeps Traefik small. `requests` is what is reserved on the node and `limits` is the maximum. A low request matters because my one node is nearly full.

</details>

<details>
<summary><b>4. HTTP to HTTPS redirect</b></summary>

```yaml
# Redirect all plain HTTP traffic to HTTPS (Step 13)
ports:
  web:
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
```

Added in Step 13. Anything that arrives on the plain HTTP entry point (`web`, port 80) is redirected to the HTTPS one (`websecure`). `permanent: true` makes it a permanent redirect (301/308), which browsers remember.

</details>

**`k8s/platform/cluster-issuers.yaml`, section by section** (the real file has my email address; it is shown here as `<your-email>`)

<details>
<summary><b>Show the whole file</b></summary>

```yaml
# Let's Encrypt certificate issuers for cert-manager.
# Replace <your-email> before applying (Let's Encrypt uses it for expiry notices).
# Staging certificates are not trusted by browsers but have generous rate limits: test with it first.
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: <your-email>
    privateKeySecretRef:
      name: letsencrypt-staging-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <your-email>
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

</details>

<details>
<summary><b>1. Comments</b></summary>

```yaml
# Let's Encrypt certificate issuers for cert-manager.
# Replace <your-email> before applying (Let's Encrypt uses it for expiry notices).
# Staging certificates are not trusted by browsers but have generous rate limits: test with it first.
```

This file defines two certificate issuers. The staging one is for testing, because its certificates aren't trusted by browsers but it has generous rate limits. The production one gives real certificates, with strict limits. The email is where Let's Encrypt sends expiry notices.

</details>

<details>
<summary><b>2. The staging issuer</b></summary>

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: <your-email>
    privateKeySecretRef:
      name: letsencrypt-staging-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

- **`ClusterIssuer`** is a cert-manager object that can issue certificates for any namespace.
- **`server`** is Let's Encrypt's staging address.
- **`privateKeySecretRef`** names the Secret where cert-manager stores the account key it creates.
- **`solvers: http01`** proves I own the hostname by placing a temporary file at a known web address. It is served through the `traefik` ingress class.

</details>

<details>
<summary><b>3. Separator and the production issuer</b></summary>

```yaml
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <your-email>
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            ingressClassName: traefik
```

`---` separates the two objects. The second one is identical except for its name, the production Let's Encrypt `server` address, and its own account key Secret. The `Ingress` picks which issuer to use by name (`letsencrypt-staging` or `letsencrypt-prod`).

</details>

**`k8s/ingress.yaml`, section by section**

<details>
<summary><b>Show the whole file</b></summary>

```yaml
# Public entry point: HTTPS for the whole app. The frontend's nginx forwards /api to backend-api,
# so one route to the frontend is enough.
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  namespace: rag-app
  annotations:
    # Start with staging, switch to letsencrypt-prod once it works (implementation.md Step 11)
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - azure-cloud-ai.eastus.cloudapp.azure.com
      secretName: app-tls
  rules:
    - host: azure-cloud-ai.eastus.cloudapp.azure.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

</details>

<details>
<summary><b>1. Comment</b></summary>

```yaml
# Public entry point: HTTPS for the whole app. The frontend's nginx forwards /api to backend-api,
# so one route to the frontend is enough.
```

This is how traffic from the internet gets into the cluster. Only the frontend needs a route, because its nginx already forwards `/api` to the backend.

</details>

<details>
<summary><b>2. Kind, metadata and the issuer annotation</b></summary>

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
  namespace: rag-app
  annotations:
    # Start with staging, switch to letsencrypt-prod once it works (implementation.md Step 11)
    cert-manager.io/cluster-issuer: letsencrypt-prod
```

An **Ingress** is a set of routing rules from outside the cluster to Services inside it. The `cert-manager.io/cluster-issuer` annotation tells cert-manager to get a certificate for this Ingress from the named issuer. It was `letsencrypt-staging` for testing and is `letsencrypt-prod` now.

</details>

<details>
<summary><b>3. Ingress class</b></summary>

```yaml
spec:
  ingressClassName: traefik
```

Says which controller handles these rules: Traefik. Without it, no controller would pick the Ingress up.

</details>

<details>
<summary><b>4. TLS</b></summary>

```yaml
  tls:
    - hosts:
        - azure-cloud-ai.eastus.cloudapp.azure.com
      secretName: app-tls
```

Turns on HTTPS for this hostname. cert-manager stores the issued certificate and private key in the Secret `app-tls`, and Traefik reads it from there. Deleting that Secret makes cert-manager issue a new certificate.

</details>

<details>
<summary><b>5. Routing rule</b></summary>

```yaml
  rules:
    - host: azure-cloud-ai.eastus.cloudapp.azure.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

Requests for this hostname, on any path starting with `/`, go to the `frontend` Service on port 80. From there, nginx serves the site and forwards `/api` to `backend-api`.

</details>


`platform/` is a subfolder on purpose, so `kubectl apply -f k8s/` doesn't apply the issuers before cert-manager exists. Traefik and cert-manager are one-time cluster setup, so the pipeline doesn't manage them.

**Before starting:** the cluster must be running, and I need Helm.
```powershell
az aks start -g rg-portfolio -n aks-azure-cloud-ai
kubectl get pods -n rag-app
helm version
```
If `helm` isn't found, install it with one of these, then reopen the terminal and run `helm version` again:

| Option | Command | Note |
|---|---|---|
| winget | `winget install Helm.Helm` | Not installed on my machine (`winget` isn't recognized) |
| Chocolatey | `choco install kubernetes-helm -y` | Works on my machine. Run PowerShell as Administrator. |

| Command | What it does |
|---|---|
| `az aks start` | Starts the stopped cluster (a few minutes) |
| `kubectl get pods -n rag-app` | Checks the three app pods are `Running` again |
| `helm version` | Checks Helm is installed (Helm installs packaged apps into Kubernetes) |

1. **Install Traefik:**
   ```powershell
   helm repo add traefik https://traefik.github.io/charts
   helm repo update
   helm install traefik traefik/traefik -n traefik --create-namespace -f k8s/platform/traefik-values.yaml
   kubectl get service traefik -n traefik -w
   ```
   Wait for `EXTERNAL-IP` to show an IP, then press Ctrl+C.

   | Command | What it does |
   |---|---|
   | `helm repo add traefik ...` | Registers Traefik's chart repository |
   | `helm repo update` | Refreshes the list of available charts |
   | `helm install traefik traefik/traefik -n traefik --create-namespace -f ...` | Installs Traefik into its own namespace, using my values file |
   | `kubectl get service traefik -n traefik -w` | Watches the new load balancer get its public IP |

---

2. **Check the hostname resolves to that IP:**
   ```powershell
   nslookup azure-cloud-ai.eastus.cloudapp.azure.com
   ```
   The address must match the `EXTERNAL-IP` above. If the name isn't found, the DNS label may be taken: change it in `traefik-values.yaml` **and** `ingress.yaml`, then run `helm upgrade traefik traefik/traefik -n traefik -f k8s/platform/traefik-values.yaml`.

   | Command | What it does |
   |---|---|
   | `nslookup <hostname>` | Looks up the IP address a name points to |

---

3. **Install cert-manager:**
   ```powershell
   helm repo add jetstack https://charts.jetstack.io
   helm repo update
   helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true
   kubectl get pods -n cert-manager -w
   ```
   Wait until all three pods show `1/1 Running`, then press Ctrl+C.

   | Command | What it does |
   |---|---|
   | `helm repo add jetstack ...` | Registers cert-manager's chart repository |
   | `helm install cert-manager ... --set crds.enabled=true` | Installs cert-manager and its custom resource types (`Certificate`, `ClusterIssuer`) |
   | `kubectl get pods -n cert-manager -w` | Waits for cert-manager's pods to start |

---

4. **Create the issuers.** First open `k8s/platform/cluster-issuers.yaml` and replace both `<your-email>` values with my email. Then:
   ```powershell
   kubectl apply -f k8s/platform/cluster-issuers.yaml
   kubectl get clusterissuer
   ```
   Both issuers must show `READY` `True`.

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/platform/cluster-issuers.yaml` | Creates the Let's Encrypt staging and production issuers (registers an account with Let's Encrypt) |
   | `kubectl get clusterissuer` | Shows whether each issuer is ready |

---

5. **Apply the Ingress (staging certificate first):**
   ```powershell
   kubectl apply -f k8s/ingress.yaml
   kubectl get certificate -n rag-app -w
   ```
   Wait for `READY` `True` (usually 1-2 minutes), then press Ctrl+C. Test (`-k` skips the check, because staging certificates aren't trusted):
   ```powershell
   curl.exe -k -I https://azure-cloud-ai.eastus.cloudapp.azure.com
   ```
   Expect `HTTP/2 200`.

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/ingress.yaml` | Creates the Ingress. cert-manager sees its annotation and requests a certificate. |
   | `kubectl get certificate -n rag-app -w` | Watches the certificate until it's issued |
   | `curl.exe -k -I https://...` | Requests only the headers over HTTPS and ignores the untrusted staging certificate |

---

6. **Switch to the production certificate.** First **edit and save** `k8s/ingress.yaml`: change line 10 to `cert-manager.io/cluster-issuer: letsencrypt-prod`. Then:
   ```powershell
   kubectl apply -f k8s/ingress.yaml
   kubectl delete secret app-tls -n rag-app
   kubectl get certificate -n rag-app -w
   ```
   Wait for `READY` `True` again. `apply` must say `configured`. If it says `unchanged`, the file still has `letsencrypt-staging` and nothing was switched.

   | Command | What it does |
   |---|---|
   | `kubectl apply -f k8s/ingress.yaml` | Points the Ingress at the production issuer |
   | `kubectl delete secret app-tls -n rag-app` | Deletes the staging certificate so cert-manager issues a real one |

   **Check it's production:**
   ```powershell
   kubectl get certificate app-tls -n rag-app -o jsonpath="{.spec.issuerRef.name}"
   ```
   It must print `letsencrypt-prod`.

   | Part | What it does |
   |---|---|
   | `-o jsonpath="{.spec.issuerRef.name}"` | Prints only the name of the issuer the certificate uses |

   **Mistake I made:** I ran `apply` without changing the file (`unchanged`), then deleted the secret. cert-manager just issued another staging certificate, so the browser still said "not safe". The `unchanged` message was the clue.

---

7. **Test in the browser:** open `https://azure-cloud-ai.eastus.cloudapp.azure.com`. It should show a padlock with no warning. Upload a PDF and ask a question to confirm `/api` works through HTTPS.

---

8. **Make the frontend internal and drop its old public IP.** In `k8s/frontend.yaml`, change the Service `type: LoadBalancer` to `type: ClusterIP`. Then commit and push so the pipeline deploys it:
   ```powershell
   git add .
   git commit -m "Add HTTPS ingress with Traefik and cert-manager"
   git push
   kubectl get services -n rag-app
   ```
   After the deploy finishes, `frontend` should show type `ClusterIP` and no `EXTERNAL-IP`. The old IP is released, which saves a little money and removes the unencrypted entry point.

   | Command | What it does |
   |---|---|
   | `git add .`, `git commit -m "..."`, `git push` | Stage, snapshot and upload the changes. The pipeline deploys `frontend.yaml`. |
   | `kubectl get services -n rag-app` | Lists Services with their types and external IPs |

**Check**
- `https://azure-cloud-ai.eastus.cloudapp.azure.com` loads with a valid certificate.
- `kubectl get certificate -n rag-app` shows `READY` `True`.
- Upload and Q&A work over HTTPS.
- The `frontend` Service no longer has a public IP.

**Troubleshooting**
- **Certificate stays `READY False`:** run `kubectl describe certificate app-tls -n rag-app`, then `kubectl get challenges -A` and `kubectl describe challenge -A`. Usually DNS doesn't point to the Traefik IP yet, or the hostname is wrong.
- **`EXTERNAL-IP` stays `<pending>` on Traefik:** run `kubectl describe service traefik -n traefik` and read the Events. A taken DNS label shows up here.
- **`404 page not found` from Traefik:** the Ingress host doesn't match the URL, or `ingressClassName` isn't `traefik`. Run `kubectl describe ingress app -n rag-app`.
- **Browser says "not safe" or warns about the certificate:** it's still the staging certificate. Complete item 6, make sure `apply` says `configured` (not `unchanged`), and check the issuer prints `letsencrypt-prod`. Then reopen the page in a private window, because browsers cache the warning.
- **Let's Encrypt rate limit errors:** wait, and use the staging issuer for tests.
- **`/api` returns 502 over HTTPS:** the backend pod isn't ready. Check its logs (Step 9).
- **Site unreachable after a stop and start:** the cluster is starting. Wait, then check `kubectl get pods -A`.

**Save money:** Traefik's load balancer IP is the only public IP now. Stopping the cluster (`az aks stop`) takes the site offline, as before.

**Later improvements:** redirect HTTP to HTTPS, add a custom domain (point a CNAME at the Azure hostname and add it to the Ingress), and try the AKS Gateway API add-on.

---

---

## Step 12: Monitoring

**Why:** to see what the app and cluster are doing: requests, failures, latency, and container logs. It also helps debugging when something breaks.

**What I'm adding**

| Piece | Shows | Cost control |
|---|---|---|
| Log Analytics workspace | Stores the logs | Daily cap of 0.2 GB, 30-day retention |
| Application Insights | Request counts, failures, latency, dependency calls from `backend-api` and the worker | Sends into the same capped workspace |
| Container Insights | Pod and node metrics and container logs from AKS | Same capped workspace |
| Budget alert | Emails me before spending runs away | Free |

**Files added or changed**

| File | Change |
|---|---|
| `infra/monitoring.bicep` | New: Log Analytics workspace (with daily cap) and Application Insights |
| `.github/workflows/deploy-monitoring.yml` | New: deploys `monitoring.bicep` (manual run) |
| `backend-api/main.py`, `ingestion-worker/worker.py` | Changed: start Application Insights when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set, and silence the Azure SDK's per-request INFO logs (they would flood the logs and cost money) |
| both `requirements.txt` | Added `azure-monitor-opentelemetry` |

**Before starting:** the cluster must be running (`az aks start -g rg-portfolio -n aks-azure-cloud-ai`).

1. **Register the resource providers** (once per subscription):
   ```powershell
   az provider register --namespace Microsoft.OperationalInsights
   az provider register --namespace Microsoft.Insights
   az provider register --namespace Microsoft.OperationsManagement
   az provider show --namespace Microsoft.OperationalInsights --query registrationState -o tsv
   ```
   Wait until each shows `Registered`.

   | Command | What it does |
   |---|---|
   | `az provider register ...` | Turns on that Azure service for my subscription |
   | `az provider show ... -o tsv` | Prints the registration state |

---

2. **Deploy the monitoring resources.** Commit and push the new files, then run the workflow:
   ```powershell
   git add .
   git commit -m "Add monitoring: Log Analytics, Application Insights, telemetry in apps"
   git push
   ```
   Repo > **Actions** tab > **Deploy monitoring (infra)** > **Run workflow** > `main`.

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all new and changed files |
   | `git commit -m "..."` | Saves them as a snapshot in local history |
   | `git push` | Uploads the commit. Because `Code/**` changed, the build and deploy workflows also run. |

   **Note:** this push deploys the new app code, which has no connection string yet. That is fine: telemetry is skipped until item 4 adds it.

   Verify:
   ```powershell
   az resource list -g rg-portfolio --query "[?contains(name,'azure-cloud-ai')].{name:name, type:type}" -o table
   ```
   Expect `log-azure-cloud-ai` and `appi-azure-cloud-ai`.

   | Command | What it does |
   |---|---|
   | `az resource list -g rg-portfolio --query ...` | Lists resources in the group whose names contain `azure-cloud-ai` |

   **`infra/monitoring.bicep`, section by section** (click a section to expand it). Bicep is the language that describes Azure resources as code; the workflow below deploys this file.
   
   <details>
   <summary><b>Show the whole file</b></summary>
   
   ```bicep
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
   ```
   
   </details>
   
   <details>
   <summary><b>1. Parameter</b></summary>
   
   ```bicep
   param location string = resourceGroup().location
   ```
   
   The only input. It defaults to the resource group's region, so both resources land next to everything else.
   
   </details>
   
   <details>
   <summary><b>2. Log Analytics workspace</b></summary>
   
   ```bicep
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
   ```
   
   The workspace is where logs and telemetry are stored and queried.
   - **`sku: PerGB2018`** is the standard pay-per-gigabyte pricing.
   - **`retentionInDays: 30`** keeps data for 30 days, which is the cheapest standard setting.
   - **`workspaceCapping.dailyQuotaGb`** stops collecting after 0.2 GB a day. This is the cost safety net: a noisy app can't run up the bill. **`json('0.2')`** is there because Bicep needs it to write a fractional number.
   
   </details>
   
   <details>
   <summary><b>3. Application Insights</b></summary>
   
   ```bicep
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
   ```
   
   Application Insights collects request counts, failures and response times from the backend and worker.
   - **`kind` and `Application_Type`: web** describe the kind of app being monitored.
   - **`WorkspaceResourceId: workspace.id`** links it to the workspace above, so its data is stored there and shares the daily cap. Using `workspace.id` also makes Bicep create the workspace first.
   - **`IngestionMode: LogAnalytics`** makes it a workspace-based resource, the current standard. Data flows into Log Analytics instead of a separate store.
   
   </details>
   
   <details>
   <summary><b>4. Outputs</b></summary>
   
   ```bicep
   output workspaceId string = workspace.id
   output appInsightsName string = appInsights.name
   ```
   
   Return the workspace's full ID and the Application Insights name. The workspace ID is what `az aks enable-addons -a monitoring` needs in Step 12, item 3. The connection string is deliberately not an output, because deployment results are stored and visible; I fetch it with the CLI instead.
   
   </details>
   
   
   **The `Deploy monitoring (infra)` workflow, section by section** (click a section to expand it). The file is `.github/workflows/deploy-monitoring.yml`. It follows the same pattern as the `Deploy ACR (infra)` workflow in Step 5, so the shared parts are short here.

   <details>
   <summary><b>Show the whole file</b></summary>

   ```yaml
   name: Deploy monitoring (infra)
   
   on:
     workflow_dispatch:
   
   permissions:
     id-token: write
     contents: read
   
   env:
     RG: rg-portfolio
   
   jobs:
     deploy-monitoring:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
   
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   
         - name: Deploy monitoring with Bicep
           run: |
             az deployment group create \
               -g $RG \
               -f infra/monitoring.bicep
   ```

   </details>


   <details>
   <summary><b>1. Name</b></summary>

   ```yaml
   name: Deploy monitoring (infra)
   ```

   The label shown in the **Actions** tab.

   </details>

   <details>
   <summary><b>2. Trigger (<code>on</code>)</b></summary>

   ```yaml
   on:
     workflow_dispatch:
   ```

   Only the **Run workflow** button. I run it once to create the monitoring resources.

   </details>

   <details>
   <summary><b>3. Permissions, job and runner</b></summary>

   ```yaml
   permissions:
     id-token: write
     contents: read

   jobs:
     deploy-monitoring:
       runs-on: ubuntu-latest
       steps:
   ```

   Same as the ACR workflow: `id-token: write` lets the job get an OIDC token for the Azure login, `contents: read` lets it download the repo, and the job runs on a temporary Ubuntu machine with the Azure CLI installed.

   </details>

   <details>
   <summary><b>4. Environment variable (<code>env</code>)</b></summary>

   ```yaml
   env:
     RG: rg-portfolio
   ```

   Only the resource group.

   </details>

   <details>
   <summary><b>5. Steps: check out and log in</b></summary>

   ```yaml
   - uses: actions/checkout@v4

   - uses: azure/login@v2
     with:
       client-id: ${{ secrets.AZURE_CLIENT_ID }}
       tenant-id: ${{ secrets.AZURE_TENANT_ID }}
       subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
   ```

   Same as the ACR workflow: download the repo so `infra/monitoring.bicep` is available, then sign in to Azure with OIDC and the three repo secrets from Step 3.

   </details>

   <details>
   <summary><b>6. Step: deploy monitoring with Bicep</b></summary>

   ```yaml
   - name: Deploy monitoring with Bicep
     run: |
       az deployment group create \
         -g $RG \
         -f infra/monitoring.bicep
   ```

   - **`-f infra/monitoring.bicep`** creates the Log Analytics workspace `log-azure-cloud-ai` (30-day retention and a 0.2 GB daily cap to limit cost) and the Application Insights resource `appi-azure-cloud-ai`, which writes into that workspace.
   - There are no `-p` parameters because every value has a default.
   - This workflow does not turn on Container Insights or give the apps the connection string. Those are separate commands in items 3 and 4 of this step.

   </details>


---

3. **Turn on Container Insights for AKS:**
   ```powershell
   $wsId = az monitor log-analytics workspace show -g rg-portfolio -n log-azure-cloud-ai --query id -o tsv
   az aks enable-addons -a monitoring -g rg-portfolio -n aks-azure-cloud-ai --workspace-resource-id $wsId
   kubectl get pods -n kube-system | Select-String ama-logs
   ```
   Wait until the `ama-logs` pods show `Running`.

   | Command | What it does |
   |---|---|
   | `az monitor log-analytics workspace show ... --query id` | Gets the workspace's full resource ID |
   | `az aks enable-addons -a monitoring ... --workspace-resource-id` | Installs the monitoring agent (`ama-logs` pods) on the cluster and sends data to the workspace |
   | `kubectl get pods -n kube-system \| Select-String ama-logs` | Checks the agent pods are running |

   **Watch node capacity:** the agent needs some CPU and memory, and my node is small. If a pod shows `Pending`, run `kubectl describe pod <name> -n rag-app` and read the Events. If it says `Insufficient cpu` or `Insufficient memory`, lower the agent's cost by disabling it again (`az aks disable-addons -a monitoring -g rg-portfolio -n aks-azure-cloud-ai`) or add a node.

   **Do not re-run `Deploy AKS (infra)` after this.** `aks.bicep` doesn't include the add-on, so the deploy may remove it. If that happens, run the `enable-addons` command again.

---

4. **Give the apps the Application Insights connection string.** Get it and add it to the `app-config` ConfigMap:
   ```powershell
   $conn = az monitor app-insights component show -g rg-portfolio -a appi-azure-cloud-ai --query connectionString -o tsv
   kubectl create configmap app-config -n rag-app --from-literal="APPLICATIONINSIGHTS_CONNECTION_STRING=$conn" --dry-run=client -o yaml | kubectl apply -f -
   kubectl rollout restart deployment/backend-api deployment/ingestion-worker -n rag-app
   Remove-Variable conn
   ```
   If `az monitor app-insights` asks to install an extension, answer `Y`.

   | Command | What it does |
   |---|---|
   | `az monitor app-insights component show ... --query connectionString` | Gets the connection string the apps use to send telemetry |
   | `kubectl create configmap ... --dry-run=client -o yaml` | Builds the ConfigMap YAML without creating it |
   | `\| kubectl apply -f -` | Applies it, adding this one key and keeping the existing keys |
   | `kubectl rollout restart deployment/...` | Restarts the pods so they read the new setting |
   | `Remove-Variable conn` | Clears the value from my terminal session |

   The connection string lets a client send telemetry but not read it. It is lower risk than a key, but I still keep it out of git.

   **Verify item 4:**
   ```powershell
   (kubectl get configmap app-config -n rag-app -o json | ConvertFrom-Json).data.PSObject.Properties.Name
   kubectl get pods -n rag-app
   ```
   The list of key names must include `APPLICATIONINSIGHTS_CONNECTION_STRING`, and `backend-api` and `ingestion-worker` must be `Running` with an age newer than the restart. If the key is missing, the apps skip telemetry on purpose, so there will be nothing to see. Re-run the commands in item 4. If a pod crashes, run `kubectl logs deployment/backend-api -n rag-app --tail=30`.

   | Command | What it does |
   |---|---|
   | `kubectl get configmap app-config -n rag-app -o json \| ConvertFrom-Json` | Reads the ConfigMap as an object |
   | `.data.PSObject.Properties.Name` | Lists only the key names, not the values, so no connection string is printed |
   | `kubectl get pods -n rag-app` | Shows pod status and age, to confirm they restarted |

---

5. **Generate some traffic, then look at the data** (telemetry takes 2-5 minutes to appear). Open `https://azure-cloud-ai.eastus.cloudapp.azure.com`, upload a PDF, and ask a question or two. Then:
   ```powershell
   az monitor app-insights query -g rg-portfolio --app appi-azure-cloud-ai --analytics-query "requests | summarize count() by name, resultCode" -o table
   ```
   Or in the portal: **appi-azure-cloud-ai** > **Application map**, **Failures**, **Performance**, **Live metrics**.

   Container logs (needs item 3):
   ```powershell
   $wsCustomerId = az monitor log-analytics workspace show -g rg-portfolio -n log-azure-cloud-ai --query customerId -o tsv
   az monitor log-analytics query -w $wsCustomerId --analytics-query "ContainerLogV2 | where PodNamespace == 'rag-app' | project TimeGenerated, PodName, LogMessage | take 10" -o table
   ```

   | Command | What it does |
   |---|---|
   | `az monitor app-insights query ... --analytics-query "..."` | Runs a KQL query on the telemetry. This one counts requests by endpoint and status code. |
   | `az monitor log-analytics workspace show ... customerId` | Gets the ID the log query command needs |
   | `az monitor log-analytics query -w ...` | Runs a KQL query on the cluster's container logs |

   **Verify item 5:** the `requests` query must return rows listing my endpoints (for example `POST /ask`, `POST /documents`, `GET /health`) with status codes. In the portal, go to resource group **rg-portfolio** > **appi-azure-cloud-ai** and open **Application map** (backend and its dependencies), **Transaction search** (individual requests), **Failures** and **Performance**. If there are no rows, wait a few more minutes, then re-check the verification for item 4.

---

6. **Set a budget alert** (portal): **Cost Management** > **Budgets** > **Add**. Scope: the subscription. Amount: for example $30 per month. Alerts at 50%, 80% and 100%, sent to my email. This protects me from a forgotten cluster, an OpenAI usage spike, or log growth.

**Check**
- `log-azure-cloud-ai` and `appi-azure-cloud-ai` exist.
- `ama-logs` pods are `Running` and all app pods are still `Running`.
- The `requests` query returns rows after I used the site.
- A budget with email alerts exists.

**Troubleshooting**
- **Query returns no rows:** wait a few minutes, make sure the pods restarted after item 4, and check `kubectl logs deployment/backend-api -n rag-app` for errors. Confirm the key exists with `kubectl get configmap app-config -n rag-app -o yaml`.
- **Pods in `CrashLoopBackOff` after the code change:** the logs usually show an import error. Confirm the image build finished and `azure-monitor-opentelemetry` is in `requirements.txt`.
- **Pods `Pending`, `Insufficient cpu/memory`:** see the capacity note in item 3.
- **Rollout stuck: new pods `Pending` for hours, old pods still running (this happened to me):** a normal rolling update starts the new pod before stopping the old one, which needs room for both. My one node was at 90% memory requests, so the new pod never scheduled (`kubectl describe pod ...` showed `1 Insufficient memory`; `kubectl describe node` showed the allocation). I fixed it by adding `strategy: RollingUpdate` with `maxSurge: 0` and `maxUnavailable: 1` to `backend-api.yaml` and `ingestion-worker.yaml`, which replaces the old pod instead of surging. Cost: a short backend outage per deploy. Apply with `kubectl apply -f k8s/backend-api.yaml -f k8s/ingestion-worker.yaml`. If the node is still too full, disable Container Insights or add a node.
- **`MissingSubscriptionRegistration`:** item 1 isn't finished.
- **Logs stop for the day:** the 0.2 GB daily cap was reached. That is the cap working. Raise `dailyQuotaGb` in `monitoring.bicep` if needed.

**Save money:** monitoring costs mostly come from log volume, which the daily cap limits. The first 5 GB of ingestion per month is typically free, but check current pricing.

---

---

## Step 13: Hardening

**Why:** the apps already use managed identity, so nothing needs the account keys any more. This step turns the keys off, which makes "no keys" a rule Azure enforces instead of just a habit. It also forces all web traffic onto HTTPS.

**What changes**

| Change | Where | Effect |
|---|---|---|
| `allowSharedKeyAccess: false` | Storage account (`infra/data-ai.bicep`) | Account keys and connection strings stop working. Only Entra ID (managed identity) works. |
| `disableLocalAuth: true` | Azure OpenAI account (`infra/data-ai.bicep`) | API keys stop working. Only Entra ID works. |
| HTTP to HTTPS redirect | Traefik (`k8s/platform/traefik-values.yaml`) | `http://...` is permanently redirected to `https://...` |

The shared AI Search service is not changed. Another project still uses its API keys.

**Before starting:** the cluster must be running, and the app must work over HTTPS (upload a PDF and ask a question). If it works now, it will keep working, because the apps never used keys.

1. **Commit and push the changes:**
   ```powershell
   git add .
   git commit -m "Harden: disable storage keys and OpenAI local auth, redirect HTTP to HTTPS"
   git push
   ```

   | Command | What it does |
   |---|---|
   | `git add .` | Stages all changed files |
   | `git commit -m "..."` | Saves them as a snapshot in local history |
   | `git push` | Uploads the commit to GitHub |

---

2. **Re-run the Storage, Search and OpenAI deployment:** repo > **Actions** tab > **Deploy Storage, Search and OpenAI (infra)** > **Run workflow** > `main`. It updates the two accounts in place. The workflow still passes `createSearch=false`, so the shared search service is untouched.

---

3. **Verify the keys are off:**
   ```powershell
   $st = az storage account list -g rg-portfolio --query "[0].name" -o tsv
   $oai = az cognitiveservices account list -g rg-portfolio --query "[?kind=='OpenAI'].name | [0]" -o tsv

   az storage account show -g rg-portfolio -n $st --query allowSharedKeyAccess -o tsv
   az cognitiveservices account show -g rg-portfolio -n $oai --query properties.disableLocalAuth -o tsv
   ```
   The first must print `false`, the second `true`.

   Prove it by trying to use a key. Both commands should now fail:
   ```powershell
   az storage container list --account-name $st --auth-mode key
   az cognitiveservices account keys list -g rg-portfolio -n $oai
   ```
   Expect errors such as `KeyBasedAuthenticationNotPermitted` and a message that local authentication is disabled.

   | Command | What it does |
   |---|---|
   | `az storage account show ... --query allowSharedKeyAccess` | Shows whether account keys are allowed |
   | `az cognitiveservices account show ... disableLocalAuth` | Shows whether OpenAI API keys are disabled |
   | `az storage container list ... --auth-mode key` | Tries to read storage using the account key. It should be refused. |
   | `az cognitiveservices account keys list` | Tries to fetch the OpenAI keys. It should be refused. |

---

4. **Check the app still works:** open `https://azure-cloud-ai.eastus.cloudapp.azure.com`, upload a PDF, wait for `ready`, and ask a question. Also check the pod logs have no authentication errors:
   ```powershell
   kubectl logs deployment/backend-api -n rag-app --tail=30
   kubectl logs deployment/ingestion-worker -n rag-app --tail=30
   ```

   | Command | What it does |
   |---|---|
   | `kubectl logs deployment/<name> -n rag-app --tail=30` | Prints the last 30 log lines |

---

5. **Turn on the HTTP to HTTPS redirect:**
   ```powershell
   helm upgrade traefik traefik/traefik -n traefik -f k8s/platform/traefik-values.yaml
   curl.exe -I http://azure-cloud-ai.eastus.cloudapp.azure.com
   ```
   The response should be `301 Moved Permanently` or `308 Permanent Redirect` with a `Location:` header starting with `https://`.

   | Command | What it does |
   |---|---|
   | `helm upgrade traefik ... -f ...` | Applies the changed values to the existing Traefik install. The public IP and DNS name stay the same. |
   | `curl.exe -I http://...` | Requests only the headers over plain HTTP, to see the redirect |

---

6. **Optional: browse storage in the portal.** With shared keys off, the portal needs my own Entra ID permission to open the blob container:
   ```powershell
   $me = az ad signed-in-user show --query id -o tsv
   $stId = az storage account show -g rg-portfolio -n $st --query id -o tsv
   az role assignment create --assignee-object-id $me --assignee-principal-type User --role "Storage Blob Data Reader" --scope $stId
   ```
   In the portal, open the container and choose **Switch to Microsoft Entra user account** if it asks.

   | Command | What it does |
   |---|---|
   | `az ad signed-in-user show --query id` | Gets my user's object ID |
   | `az role assignment create ... "Storage Blob Data Reader"` | Lets me read blobs with my own login, scoped to this storage account only |

**Check**
- `allowSharedKeyAccess` is `false` and `disableLocalAuth` is `true`.
- Key-based commands are refused.
- Upload and Q&A still work, with no authentication errors in the logs.
- `http://` redirects to `https://`.

**Troubleshooting**
- **`403 AuthorizationPermissionMismatch` or `KeyBasedAuthenticationNotPermitted` from the apps:** something is still using a key or connection string. Check the pod environment (`kubectl get configmap app-config -n rag-app -o yaml`) and the code for `connection_string` or `api_key`.
- **Workflow fails with `PropertyChangeNotAllowed`:** tell me the exact message. These two properties should be changeable in place.
- **Redirect loop or certificate renewal fails after the redirect:** check `kubectl get challenges -A`. Let's Encrypt follows redirects, so this is unusual. Roll back by removing the `ports:` block from `traefik-values.yaml` and running `helm upgrade` again.
- **Old browser tab still shows HTTP:** reload in a private window.
- **Portal can't list blobs:** do item 6.

**Later improvements:** managed identity for the Search service too (if the old project no longer needs keys), pod security settings (non-root user, read-only filesystem, dropped capabilities), network policies, and Key Vault only if a real secret ever appears.

---

---

## Step 14: Budget Alert

**Why:** AKS, OpenAI usage and log volume can grow quietly. A budget emails me before the bill surprises me. It only sends emails: it does not stop spending, so `az aks stop` is still the real protection.

1. Portal (signed in as dhanishetty@gmail.com) > **Cost Management** > **Budgets** > **Add**.
2. Scope: the subscription. Name: `monthly-budget`. Reset period: monthly.
3. Amount: a number that would worry me (about $30-40 if the cluster runs all the time).
4. Alerts: 50%, 80% and 100% of the budget, type **Actual**, sent to my email.
5. Create.

**Check:** the budget appears in the Budgets list with its three alert conditions.

---

---

## To Do Before Making the Repo Public

- [ ] Add screenshots to the README (live site with a cited answer, green Actions runs, Application Insights map) in `docs/images/`.
- [ ] Check the README's cost estimate against my real budget numbers.
- [ ] Stop tracking generated files: `git rm --cached Code/Frontend/tsconfig.tsbuildinfo`, add `*.tsbuildinfo` to `.gitignore`, then commit and push.
- [ ] Read `implementation.md` once. It contains my Azure resource names and email address.

## Later Steps

- Add Key Vault to infra if a real secret appears (optionally combine the Bicep files into one `main.bicep` with modules).
