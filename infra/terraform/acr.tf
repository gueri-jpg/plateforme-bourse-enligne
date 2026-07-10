# ==============================================================================
# acr.tf â€” Azure Container Registry (ACR)
#
# CrÃ©e un registre privÃ© de conteneurs Docker et autorise l'AKS Ã  puller
# les images via un rÃ´le AcrPull assignÃ© Ã  l'identitÃ© kubelet du cluster.
#
# Nommage : acr{project_name}{environment} (sans tirets, tout en minuscules)
#   Ex : acrboursprod  â† Azure n'accepte pas les tirets dans les noms ACR
#
# SÃ©curitÃ© :
#   - admin_enabled = false : on n'utilise pas les credentials admin ACR
#   - L'accÃ¨s se fait exclusivement via Azure RBAC (identitÃ© managÃ©e AKS)
# ==============================================================================

# ------------------------------------------------------------------------------
# Azure Container Registry
# SKU Basic : suffisant pour le dev/prod initiale (10 Go inclus, sans gÃ©o-rÃ©plication)
# Pour la production avancÃ©e : Standard (avec contenu approuvÃ©) ou Premium (geo-rep)
# ------------------------------------------------------------------------------
resource "azurerm_container_registry" "main" {
  # Nom sans tirets, tout en minuscules, max 50 caractÃ¨res
  name                = "acr${var.project_name}${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  sku                 = var.acr_sku

  # DÃ©sactivation du compte admin : on prÃ©fÃ¨re RBAC via identitÃ© managÃ©e
  admin_enabled = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# RÃ´le AcrPull : permet Ã  l'AKS de puller les images depuis l'ACR
#
# L'identitÃ© kubelet (kubelet_identity) est l'identitÃ© utilisÃ©e par les nÅ“uds
# AKS pour s'authentifier auprÃ¨s d'Azure, notamment pour puller les images.
# Elle est DISTINCTE de l'identitÃ© principale du cluster (control plane).
#
# Sans ce rÃ´le, les pods verront une erreur ImagePullBackOff.
# ------------------------------------------------------------------------------
resource "azurerm_role_assignment" "aks_acr_pull" {
  # Scope : l'ACR lui-mÃªme (limiter le principe du moindre privilÃ¨ge)
  scope = azurerm_container_registry.main.id

  # RÃ´le prÃ©dÃ©fini Azure : lecture + pull des images uniquement
  role_definition_name = "AcrPull"

  # Principal : l'identitÃ© managÃ©e kubelet des nÅ“uds AKS
  # kubelet_identity[0].object_id est l'Object ID du managed identity
  principal_id = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id

  # Ã‰vite les erreurs de propagation IAM lors du premier apply
  depends_on = [azurerm_kubernetes_cluster.main]
}

