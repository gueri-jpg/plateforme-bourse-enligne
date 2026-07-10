# ==============================================================================
# main.tf — Configuration principale Terraform
#
# Définit :
#   - Le backend distant (Azure Blob Storage) pour stocker le tfstate
#   - Le provider azurerm avec les fonctionnalités requises
#
# Pré-requis :
#   - Resource group "rg-cfc-dev" déjà existant sur Azure
#   - Storage account "stcfcdevladw" avec container "tfstate" déjà créé
#   - Commande : az login && az account set --subscription <id>
# ==============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.110"
    }
  }

  # Backend distant : le fichier tfstate est stocké dans Azure Blob Storage
  # pour permettre le travail en équipe et éviter les conflits d'état local.
  backend "azurerm" {
    resource_group_name  = "rg-cfc-dev"
    storage_account_name = "stcfcdevladw"
    container_name       = "tfstate"
    key                  = "bourse.terraform.tfstate"
  }
}

# ------------------------------------------------------------------------------
# Provider Azure Resource Manager
# features {} vide est obligatoire depuis azurerm v2.x
# ------------------------------------------------------------------------------
provider "azurerm" {
  features {}
}

# ------------------------------------------------------------------------------
# Resource Group principal — contient tous les resources du projet
# Nommage : rg-{project_name}-{environment}  ex: rg-bourse-prod
# ------------------------------------------------------------------------------
# Resource Group créé par le tuteur/l'administrateur avant le premier apply.
# Référencé en data source — Terraform ne le crée ni ne le supprime jamais.
data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}
