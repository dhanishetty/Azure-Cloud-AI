# Implementation Steps

Deploy the full app (frontend + backend) on AKS, with GitHub Actions for CI/CD.
Azure account: **dhanishetty@gmail.com** (not the work account).

## Progress

| Step | Task | Status |
|---|---|---|
| 1 | Create GitHub repo and push code | In progress |
| 2 | Create Azure identity (OIDC) | Pending |
| 3 | Add repo secrets | Pending |
| 4 | Add repo variable `ACR_NAME` | Pending |
| 5 | Run `deploy-acr`, then `build-push-images` | Pending |

## Files Created

| File | Purpose |
|---|---|
| `infra/acr.bicep` | Defines the Azure Container Registry (Basic tier) |
| `.github/workflows/deploy-acr.yml` | Deploys the resource group and ACR |
| `.github/workflows/build-push-images.yml` | Builds and pushes `frontend`, `backend-api`, `ingestion-worker` to ACR |

## Step 1: GitHub Repo

**Why:** GitHub Actions only runs from GitHub. The current `origin` is Azure DevOps.

1. On github.com/new, create an empty repo (e.g. `rag-qa-azure`). Leave README, .gitignore and license unchecked.
2. Initialize and push from the `dhanishetty/` folder:
   ```powershell
   cd C:\Users\dhani\OneDrive\Desktop\Projects\dhanishetty
   git init -b main
   git add .
   git status
   ```
3. Check `git status`: `node_modules/` and `__pycache__/` must not be listed. If they are, add a root `.gitignore`.
4. Commit and push:
   ```powershell
   git commit -m "Initial commit: app code, Bicep, workflows"
   git remote add origin https://github.com/<your-username>/rag-qa-azure.git
   git push -u origin main
   ```

**Note:** this is a separate repo nested inside `Projects`. The outer Azure DevOps repo ignores its contents.

**Check:** `.github/workflows/` and `infra/` appear at the repo root on GitHub.

## Step 2: Azure Identity (OIDC)

**Goal:** an app registration with a federated credential for the repo's `main` branch, with `Contributor` on the subscription or on `rg-portfolio`.

*Details to be added.*

## Step 3: Repo Secrets

**Goal:** add `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` under GitHub > Settings > Secrets and variables > Actions.

*Details to be added.*

## Step 4: Repo Variable

**Goal:** add `ACR_NAME`, a globally unique, lowercase name (5-50 alphanumeric characters).

*Details to be added.*

## Step 5: Run Order

1. Run `deploy-acr` (creates the resource group and ACR).
2. Run `build-push-images` (builds and pushes the three images).

*Details to be added.*

## Later Steps

- Extend infra to one `main.bicep` with modules (AKS, Key Vault, monitoring).
- Add Kubernetes manifests and a deploy-to-AKS workflow.
- Add ingress with HTTPS (NGINX + cert-manager).
