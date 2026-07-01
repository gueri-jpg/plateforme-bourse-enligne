# Infrastructure Azure — Plateforme de Bourse en Ligne

Ce répertoire contient l'infrastructure as code pour déployer la plateforme
sur **Azure Kubernetes Service (AKS)** :

```
infra/
├── terraform/      # Provisionnement de l'infra Azure (AKS, ACR, PostgreSQL, réseau)
└── helm/            # Déploiement applicatif sur AKS (backend, frontends, Kafka, Keycloak)
```

## Pré-requis

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) connecté : `az login`
- [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.6.0
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/) >= 3.x
- Docker (build des images)
- Un nom de domaine pointant vers l'IP publique de l'Ingress (`bourse-enligne.ma` et sous-domaines)

---

## 1. Provisionner l'infrastructure Azure (Terraform)

### 1.1 Créer le backend distant (une seule fois, avant le premier `terraform init`)

```bash
az group create --name rg-bourse-tfstate --location "West Europe"

az storage account create \
  --name stboursetfstate \
  --resource-group rg-bourse-tfstate \
  --location "West Europe" \
  --sku Standard_LRS \
  --encryption-services blob

az storage container create \
  --name tfstate \
  --account-name stboursetfstate
```

### 1.2 Initialiser et déployer

```bash
cd infra/terraform

# Initialise le backend azurerm + télécharge le provider
terraform init

# Fournir le mot de passe PostgreSQL (jamais en clair dans le repo) :
export TF_VAR_postgres_admin_password="UnMotDePasseFort_2026!"

# Vérifie le plan d'exécution
terraform plan -out=tfplan

# Applique les changements (crée RG, VNet, AKS, ACR, PostgreSQL)
terraform apply tfplan
```

### 1.3 Récupérer les outputs nécessaires au déploiement Helm

```bash
# Connexion kubectl au cluster AKS
az aks get-credentials \
  --resource-group $(terraform output -raw resource_group_name) \
  --name $(terraform output -raw aks_cluster_name)

# URL de l'ACR (pour les images Docker)
terraform output -raw acr_login_server

# FQDN PostgreSQL (pour values.yaml > postgres.host)
terraform output -raw postgres_fqdn
```

---

## 2. Builder et pousser les images Docker vers l'ACR

```bash
ACR_LOGIN_SERVER=$(terraform -chdir=infra/terraform output -raw acr_login_server)

# Authentification Docker auprès de l'ACR
az acr login --name $(echo $ACR_LOGIN_SERVER | cut -d. -f1)

# --- backend (FastAPI) ---
docker build -t $ACR_LOGIN_SERVER/backend:latest ./backend
docker push $ACR_LOGIN_SERVER/backend:latest

# --- bvc-producer (scraper Kafka) ---
docker build -t $ACR_LOGIN_SERVER/bvc-producer:latest ./kafka
docker push $ACR_LOGIN_SERVER/bvc-producer:latest

# --- bvc-relay (proxy HTTP BVC, serve.py) ---
docker build -f Dockerfile.bvc-relay -t $ACR_LOGIN_SERVER/bvc-relay:latest .
docker push $ACR_LOGIN_SERVER/bvc-relay:latest

# --- frontend investisseur (SPA Nginx) ---
docker build -t $ACR_LOGIN_SERVER/frontend:latest ./frontend
docker push $ACR_LOGIN_SERVER/frontend:latest

# --- admin-frontend (back-office Nginx) ---
docker build -t $ACR_LOGIN_SERVER/admin-frontend:latest ./admin
docker push $ACR_LOGIN_SERVER/admin-frontend:latest
```

> Les `Dockerfile` de `frontend/`, `admin/` et `Dockerfile.bvc-relay` (racine
> du projet) ont été ajoutés spécifiquement pour le déploiement Kubernetes,
> car en local ces services utilisent des volumes montés (non disponibles
> sur AKS).

---

## 3. Installer les pré-requis cluster (Ingress + cert-manager)

```bash
# Ingress NGINX
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace

# cert-manager (gestion automatique des certificats Let's Encrypt)
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true
```

Créer ensuite le `ClusterIssuer` `letsencrypt-prod` (référencé dans
`infra/helm/bourse-platform/templates/ingress.yaml`) :

```yaml
# cluster-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@bourse-enligne.ma
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

```bash
kubectl apply -f cluster-issuer.yaml
```

Récupérer l'IP publique de l'Ingress et configurer les enregistrements DNS
(A records) pour `bourse-enligne.ma`, `api.bourse-enligne.ma`,
`admin.bourse-enligne.ma`, `relay.bourse-enligne.ma`, `auth.bourse-enligne.ma` :

```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

---

## 4. Déployer la plateforme avec Helm

> **Namespace** : créer le namespace manuellement AVANT l'install Helm.
> Helm doit pouvoir y stocker son release Secret avant d'appliquer les
> manifests, ce qui crée un conflit si le namespace est déclaré dans le chart
> lui-même. La commande ci-dessous gère les deux étapes.

```bash
cd infra/helm/bourse-platform

# 1. Créer le namespace AVANT l'install (Helm a besoin qu'il existe)
kubectl create namespace bourse

# 2. Télécharger les sous-charts Kafka et Keycloak (Bitnami)
helm dependency update

# Récupère les outputs Terraform nécessaires
ACR_LOGIN_SERVER=$(terraform -chdir=../../terraform output -raw acr_login_server)
POSTGRES_FQDN=$(terraform -chdir=../../terraform output -raw postgres_fqdn)

# Installation (ou mise à jour) du chart
# Pas de --create-namespace : le chart crée et gère son propre namespace
# (templates/namespace.yaml), créé en premier par Helm avant les autres ressources.
helm upgrade --install bourse-platform . \
  --namespace bourse \
  --set global.imageRegistry=$ACR_LOGIN_SERVER \
  --set postgres.host=$POSTGRES_FQDN \
  --set postgres.password=$TF_VAR_postgres_admin_password \
  --set keycloak.externalDatabase.host=$POSTGRES_FQDN \
  --set keycloak.externalDatabase.password=$TF_VAR_postgres_admin_password \
  --set keycloak.auth.adminPassword="UnMotDePasseAdminFort!" \
  --set secrets.kcAdminPassword="UnMotDePasseAdminFort!" \
  --set secrets.keycloakAdminClientSecret="<secret-client-admin-tools>" \
  --set secrets.resendApiKey="<clé-api-resend>"
```

> **Bonne pratique** : au lieu d'empiler les `--set`, créer un fichier
> `values-prod.yaml` (ajouté au `.gitignore`) contenant ces valeurs
> sensibles, puis déployer avec `helm upgrade --install bourse-platform . -f values-prod.yaml`.

### Vérifier le déploiement

```bash
kubectl get pods -n bourse
kubectl get ingress -n bourse
kubectl logs -n bourse deploy/bourse-platform-backend
```

---

## 5. Mise à jour applicative (CI/CD)

Pour publier une nouvelle version d'un composant :

```bash
docker build -t $ACR_LOGIN_SERVER/backend:v1.1.0 ./backend
docker push $ACR_LOGIN_SERVER/backend:v1.1.0

helm upgrade bourse-platform infra/helm/bourse-platform \
  --namespace bourse --reuse-values \
  --set image.backend.tag=v1.1.0
```

---

## 6. Désinstallation

```bash
helm uninstall bourse-platform --namespace bourse
terraform -chdir=infra/terraform destroy
```

> `terraform destroy` supprime définitivement l'AKS, l'ACR et le serveur
> PostgreSQL (et toutes les données associées). À utiliser avec précaution.
