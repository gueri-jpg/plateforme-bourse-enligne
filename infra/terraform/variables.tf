# ==============================================================================
# variables.tf — Déclaration de toutes les variables Terraform
#
# Les valeurs sensibles (mots de passe) ne doivent JAMAIS être committées.
# Fournir via :
#   - Fichier terraform.tfvars (ajouté au .gitignore)
#   - Variables d'environnement TF_VAR_<nom>
#   - Azure Key Vault + data source (recommandé en production)
# ==============================================================================

# ------------------------------------------------------------------------------
# Variables Azure générales
# ------------------------------------------------------------------------------

variable "location" {
  description = "Région Azure cible pour déployer toutes les ressources"
  type        = string
  default     = "West Europe"
}

variable "environment" {
  description = "Nom de l'environnement (prod, staging, dev)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "L'environnement doit être 'prod', 'staging' ou 'dev'."
  }
}

variable "project_name" {
  description = "Nom court du projet, utilisé comme préfixe dans tous les noms de ressources"
  type        = string
  default     = "bourse"
}

# ------------------------------------------------------------------------------
# Variables AKS (Azure Kubernetes Service)
# ------------------------------------------------------------------------------

variable "aks_node_count" {
  description = "Nombre de nœuds dans le node pool par défaut de l'AKS"
  type        = number
  default     = 2

  validation {
    condition     = var.aks_node_count >= 1 && var.aks_node_count <= 10
    error_message = "Le nombre de nœuds AKS doit être entre 1 et 10."
  }
}

variable "aks_node_vm_size" {
  description = "Taille de VM Azure pour les nœuds AKS (Standard_D2s_v3 = 2 vCPU, 8 GB RAM)"
  type        = string
  default     = "Standard_D2s_v3"
}

# ------------------------------------------------------------------------------
# Variables PostgreSQL Flexible Server
# ------------------------------------------------------------------------------

variable "postgres_admin_username" {
  description = "Nom d'utilisateur administrateur pour le serveur PostgreSQL Azure"
  type        = string
  default     = "bourse_admin"
}

variable "postgres_admin_password" {
  description = "Mot de passe administrateur PostgreSQL (sensible, ne pas committer)"
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.postgres_admin_password) >= 12
    error_message = "Le mot de passe PostgreSQL doit contenir au moins 12 caractères."
  }
}

variable "postgres_sku_name" {
  description = "SKU du serveur PostgreSQL Flexible (B_Standard_B1ms pour dev/prod petit)"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_gb" {
  description = "Taille du stockage PostgreSQL en gigaoctets"
  type        = number
  default     = 32
}

variable "postgres_version" {
  description = "Version majeure de PostgreSQL"
  type        = string
  default     = "16"
}

# ------------------------------------------------------------------------------
# Variables ACR (Azure Container Registry)
# ------------------------------------------------------------------------------

variable "acr_sku" {
  description = "SKU de l'Azure Container Registry (Basic, Standard, Premium)"
  type        = string
  default     = "Basic"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.acr_sku)
    error_message = "Le SKU ACR doit être 'Basic', 'Standard' ou 'Premium'."
  }
}

# ------------------------------------------------------------------------------
# Variables réseau
# ------------------------------------------------------------------------------

variable "vnet_address_space" {
  description = "Plage d'adresses CIDR du VNet principal"
  type        = string
  default     = "10.0.0.0/16"
}

variable "aks_subnet_cidr" {
  description = "Plage CIDR du sous-réseau AKS"
  type        = string
  default     = "10.0.1.0/24"
}

variable "postgres_subnet_cidr" {
  description = "Plage CIDR du sous-réseau PostgreSQL Flexible Server"
  type        = string
  default     = "10.0.2.0/24"
}

# ------------------------------------------------------------------------------
# Variables applicatives
# ------------------------------------------------------------------------------

variable "domain" {
  description = "Nom de domaine principal de la plateforme (utilisé dans les Ingress)"
  type        = string
  default     = "bourse-enligne.ma"
}
