# Full Application on AKS (Frontend + Backend) with GitHub Actions

Goal: a cheap, portfolio-ready deployment where both the frontend and the API run on one AKS cluster, with all CI/CD through GitHub Actions.

> Use the **dhanishetty@gmail.com** Azure account, not the work account. Check with `az account show`.

## Architecture

```
Browser --HTTPS--> app.yourdomain.com --> AKS NGINX ingress (cert-manager TLS)
                                             |-- /      --> frontend pods (nginx serving static build)
                                             |-- /api   --> backend pods (API)
                                                              |
GitHub Actions --(OIDC)--> ACR (Basic) --> AKS                +--> Key Vault via Workload Identity
```

Serving both from one hostname with path routing (`/` and `/api`) means the browser sees a single origin, so **no CORS setup is needed**.

Prices are approximate; confirm in the Azure pricing calculator.

## 0. Prerequisites

- Azure CLI, kubectl, Helm, Docker, Git
- A GitHub repo (a monorepo with `frontend/`, `backend/`, `k8s/`, `infra/` is simplest)
- A domain is optional (~$10/yr). Without one, give the ingress public IP a DNS label to get `<label>.<region>.cloudapp.azure.com`. Let's Encrypt works with that hostname too.

```bash
az login
az account set --subscription "<your-subscription-id>"
az provider register --namespace Microsoft.ContainerService
az provider register --namespace Microsoft.ContainerRegistry
```

## 1. Set a budget first

Portal > Cost Management > Budgets > create a monthly budget (e.g. $20) with email alerts at 50% / 80% / 100%.

## 2. Create the resource group and ACR

```bash
RG=rg-portfolio
LOC=eastus
ACR=acrportfolio$RANDOM   # must be globally unique, lowercase

az group create -n $RG -l $LOC
az acr create -g $RG -n $ACR --sku Basic
```

## 3. Create a cheap AKS cluster

```bash
AKS=aks-portfolio

az aks create -g $RG -n $AKS \
  --tier free \
  --node-count 1 \
  --node-vm-size Standard_B2s \
  --enable-oidc-issuer \
  --enable-workload-identity \
  --attach-acr $ACR \
  --generate-ssh-keys

az aks get-credentials -g $RG -n $AKS
kubectl get nodes
```

If `Standard_B2s` isn't available, try another B-series size in your region (`Standard_B2ps_v2` is ARM, so images must be ARM-compatible). One B2s node is enough for a small frontend, an API and the ingress controller. If pods stay `Pending`, check `kubectl describe pod` for resource shortage and lower the requests or add a node.

Save money when not demoing:

```bash
az aks stop -g $RG -n $AKS
az aks start -g $RG -n $AKS
```

## 4. Containerize both apps

**Backend:** a `Dockerfile` for the API, listening on a fixed port (e.g. 8000), with a `/health` endpoint.

**Frontend:** a multi-stage `Dockerfile`: build the static site with Node, then copy the output into an `nginx` image.

```dockerfile
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf   # SPA fallback: try_files $uri /index.html;
EXPOSE 80
```

(`dist` may be `build` depending on your framework.) In the frontend code, call the API with a relative URL like `/api/...`, not a hardcoded host.

Test locally with `docker run` before pushing, then build in ACR:

```bash
az acr build -r $ACR -t frontend:v1 ./frontend
az acr build -r $ACR -t backend:v1 ./backend
```

## 5. Kubernetes manifests (`k8s/`)

For each of frontend and backend:

- `Deployment`: image from `$ACR.azurecr.io/...`, resource requests/limits (keep small, e.g. 50m CPU / 64Mi for the frontend), readiness and liveness probes
- `Service`: ClusterIP

Apply and check:

```bash
kubectl apply -f k8s/
kubectl get pods
```

## 6. Ingress with HTTPS

1. Install the NGINX ingress controller:
   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm install ingress-nginx ingress-nginx/ingress-nginx \
     --namespace ingress-nginx --create-namespace
   kubectl get svc -n ingress-nginx   # note the EXTERNAL-IP
   ```
2. Point DNS at that IP (`A` record for `app.yourdomain.com`, or the DNS label on the public IP).
3. Install cert-manager and create a Let's Encrypt `ClusterIssuer`.
4. Create one `Ingress` with the `cert-manager.io/cluster-issuer` annotation, a `tls:` block for your hostname, and two path rules:
   - `/api` (Prefix) -> backend Service
   - `/` (Prefix) -> frontend Service

   If the API doesn't expect the `/api` prefix, either serve it under `/api` in the app or use the NGINX `rewrite-target` annotation. Mind the order: the more specific `/api` path must win over `/`.
5. Verify: open `https://app.yourdomain.com` and `curl https://app.yourdomain.com/api/health`.

Optional: use separate hosts instead (`www.` for the frontend, `api.` for the API). That's a fine layout too, but then you must configure CORS for the frontend origin and never use `*`.

## 7. CI/CD with GitHub Actions (OIDC, no stored secrets)

1. Create an app registration / service principal and add a **federated credential** for your GitHub repo and branch:
   ```bash
   az ad app create --display-name gh-portfolio-deploy
   # then: az ad app federated-credential create ... (subject: repo:<owner>/<repo>:ref:refs/heads/main)
   ```
2. Give it roles:
   - `AcrPush` on the ACR
   - `Azure Kubernetes Service Cluster User Role` plus a Kubernetes RBAC binding on the cluster
3. Add repo secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (identifiers, not passwords).
4. Workflow outline (`.github/workflows/deploy.yml`):
   ```yaml
   on:
     push:
       branches: [main]
   permissions:
     id-token: write
     contents: read
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: azure/login@v2
           with:
             client-id: ${{ secrets.AZURE_CLIENT_ID }}
             tenant-id: ${{ secrets.AZURE_TENANT_ID }}
             subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
         - run: az acr build -r $ACR -t backend:${{ github.sha }} ./backend
         - run: az acr build -r $ACR -t frontend:${{ github.sha }} ./frontend
         - uses: azure/aks-set-context@v4
           with:
             resource-group: rg-portfolio
             cluster-name: aks-portfolio
         - run: |
             kubectl set image deployment/backend backend=$ACR.azurecr.io/backend:${{ github.sha }}
             kubectl set image deployment/frontend frontend=$ACR.azurecr.io/frontend:${{ github.sha }}
             kubectl rollout status deployment/backend
             kubectl rollout status deployment/frontend
   ```
   Tag images with the commit SHA, not `latest`, so deployments are traceable and rollbacks are easy.
5. Improvements once it works: use `paths:` filters or two workflows so a frontend change doesn't rebuild the backend, run tests/lint before deploying, and add a PR workflow that builds without deploying.

## 8. Secrets with Key Vault + Workload Identity

1. Create a Key Vault and store API keys / connection strings there.
2. Create a user-assigned managed identity with `Key Vault Secrets User` on the vault.
3. Federate it with a Kubernetes service account (the cluster already has the OIDC issuer enabled).
4. Mount secrets with the Secrets Store CSI driver (`az aks enable-addons --addons azure-keyvault-secrets-provider`), or read them at startup with the Azure SDK's `DefaultAzureCredential`.

No secrets in the repo, in manifests, or in `secrets.md`.

## 9. Observability

- Enable Container Insights on AKS (the Log Analytics workspace adds cost; set a daily cap).
- Add Application Insights to the API for requests, failures and latency.
- Optional: one Azure Monitor alert, e.g. on pod restarts or 5xx rate.

## 10. Infrastructure as code (the strongest portfolio piece)

Once it works manually, recreate steps 2, 3 and 8 in **Bicep or Terraform** and commit them in `infra/`. Deploy the infra from a GitHub Actions workflow too. Being able to recreate the whole environment from code is worth more to a reviewer than the click-through version.

## 11. Portfolio README checklist

- [ ] Architecture diagram
- [ ] Live URL and `/api/health` URL
- [ ] Short "how it's deployed" section (AKS + ACR + ingress + GitHub Actions OIDC)
- [ ] Estimated monthly cost and how you keep it low (Free tier, one node, stop/start)
- [ ] Security notes (OIDC, Workload Identity, Key Vault, TLS)
- [ ] IaC folder and pipeline badges

## Cost control summary

| Item | Approx. cost |
|---|---|
| AKS Free tier control plane | $0 |
| 1x B2s node (24/7) | ~$30/mo; far less if stopped when idle |
| ACR Basic | ~$5/mo |
| Public IP + load balancer | a few $/mo |
| Domain (optional) | ~$10/yr |

When you're done with a demo period, run `az group delete -n rg-portfolio` to remove everything and stop all charges.

## Trade-offs of hosting the frontend on AKS

- You give up the free global CDN and automatic PR preview environments that Static Web Apps provides.
- The site goes down whenever the cluster is stopped, so the whole app is "on request" unless you leave the node running.
- In return you get one deployment target, one pipeline and a fuller Kubernetes story to show.

## Common problems

- **Certificate stays pending:** DNS not pointing at the ingress IP yet, or port 80 blocked; check `kubectl describe certificate`.
- **ImagePullBackOff:** ACR not attached; run `az aks update -g $RG -n $AKS --attach-acr $ACR`.
- **Pods Pending:** the single node is out of CPU/memory; lower requests or add a node.
- **404 on page refresh:** the frontend nginx config lacks the SPA fallback (`try_files $uri /index.html;`).
- **`/api` returns 404:** the path prefix isn't stripped or served by the app; check the rewrite annotation or the API's base path.
- **Cluster stopped:** the app is down until `az aks start`.
