# Implementation Steps

Deploy the full app (frontend + backend) on AKS, with GitHub Actions for CI/CD.
Azure account: **dhanishetty@gmail.com** (not the work account).

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
