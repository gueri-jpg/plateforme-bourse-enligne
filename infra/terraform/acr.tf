# ==============================================================================
# acr.tf - Azure Container Registry (ACR)
#
# Cree un registre prive de conteneurs Docker.
# Nommage : acr{project_name}{environment} (sans tirets, tout en minuscules)
#   Ex : acrboursprod
#
# Note : le role AcrPull (AKS -> ACR) est gere via un Kubernetes imagePullSecret
# (secret "acr-secret" dans le namespace bourse) plutot que par une role
# assignment Azure, pour eviter les restrictions ABAC sur les comptes invites.
# ==============================================================================

resource "azurerm_container_registry" "main" {
  name                = "acr${var.project_name}${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  sku                 = var.acr_sku
  admin_enabled       = true

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}
