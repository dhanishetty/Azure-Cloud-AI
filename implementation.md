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
| 6 | Deploy AKS cluster | In progress |

## Files Created

| File | Purpose |
|---|---|
| `infra/acr.bicep` | Defines the Azure Container Registry (Basic tier) |
| `.github/workflows/deploy-acr.yml` | Deploys the resource group and ACR |
| `.github/workflows/build-push-images.yml` | Builds and pushes `frontend`, `backend-api`, `ingestion-worker` to ACR |
| `infra/aks.bicep` | Defines the AKS cluster (Free tier, 1 node) and the AcrPull role |
| `.github/workflows/deploy-aks.yml` | Deploys the AKS cluster (manual run) |

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

---

2. **Check the VM size is available** in `eastus` for my subscription:
   ```powershell
   az vm list-skus --location eastus --size Standard_B2s --query "[].{name:name, restrictions:restrictions[0].reasonCode}" -o table
   ```
   `restrictions` must be empty. If restricted, pick another B-series size and change `nodeVmSize` in `aks.bicep`.

---

3. **Let the pipeline create role assignments.** `Contributor` can't assign roles, and `aks.bicep` assigns `AcrPull`. Give the identity `User Access Administrator` on the resource group only:
   ```powershell
   $appId = az ad app list --display-name Azure-Cloud-AI --query "[0].appId" -o tsv
   $subId = az account show --query id -o tsv
   az role assignment create --assignee $appId --role "User Access Administrator" --scope "/subscriptions/$subId/resourceGroups/rg-portfolio"
   ```

---

4. **Push the new files:**
   ```powershell
   git add .
   git commit -m "Add AKS Bicep and deploy workflow"
   git push
   ```

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

**Check ACR pull access:**
```powershell
az role assignment list --scope $(az acr show -n <ACR_NAME> --query id -o tsv) --query "[?roleDefinitionName=='AcrPull'].principalType" -o tsv
```
Should print `ServicePrincipal`.

**Save money when not working:**
```powershell
az aks stop -g rg-portfolio -n aks-azure-cloud-ai
az aks start -g rg-portfolio -n aks-azure-cloud-ai
```

**Troubleshooting**
- `AuthorizationFailed` on the role assignment: item 3 is missing or hasn't propagated. Wait a few minutes and re-run.
- `QuotaExceeded` or `SkuNotAvailable`: the VM size or vCPU quota isn't available. Change `nodeVmSize` or region.
- `MissingSubscriptionRegistration`: item 1 isn't finished.

## Later Steps

- Add Key Vault and monitoring to infra (optionally combine into one `main.bicep` with modules).
- Add Kubernetes manifests and a deploy-to-AKS workflow.
- Add ingress with HTTPS (NGINX + cert-manager).
