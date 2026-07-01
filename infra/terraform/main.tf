# ==============================================================================
# main.tf — Configuration principale Terraform
#
# Définit :
#   - Le backend distant (Azure Blob Storage) pour stocker le tfstate
#   - Le provider azurerm avec les fonctionnalités requises
#
# Pré-requis :
#   - Resource group "rg-bourse-tfstate" déjà existant sur Azure
#   - Storage account "stboursetfstate" avec container "tfstate" déjà créés
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
    resource_group_name  = "rg-bourse-tfstate"
    storage_account_name = "stboursetfstate"
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
resource "azurerm_resource_group" "main" {
  name     = "rg-${var.project_name}-${var.environment}"
  location = var.location

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}
