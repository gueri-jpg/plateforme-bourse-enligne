# ==============================================================================
# acr.tf — Azure Container Registry (ACR)
#
# Crée un registre privé de conteneurs Docker et autorise l'AKS à puller
# les images via un rôle AcrPull assigné à l'identité kubelet du cluster.
#
# Nommage : acr{project_name}{environment} (sans tirets, tout en minuscules)
#   Ex : acrboursprod  ← Azure n'accepte pas les tirets dans les noms ACR
#
# Sécurité :
#   - admin_enabled = false : on n'utilise pas les credentials admin ACR
#   - L'accès se fait exclusivement via Azure RBAC (identité managée AKS)
# ==============================================================================

# ------------------------------------------------------------------------------
# Azure Container Registry
# SKU Basic : suffisant pour le dev/prod initiale (10 Go inclus, sans géo-réplication)
# Pour la production avancée : Standard (avec contenu approuvé) ou Premium (geo-rep)
# ------------------------------------------------------------------------------
resource "azurerm_container_registry" "main" {
  # Nom sans tirets, tout en minuscules, max 50 caractères
  name                = "acr${var.project_name}${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = var.acr_sku

  # Désactivation du compte admin : on préfère RBAC via identité managée
  admin_enabled = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# Rôle AcrPull : permet à l'AKS de puller les images depuis l'ACR
#
# L'identité kubelet (kubelet_identity) est l'identité utilisée par les nœuds
# AKS pour s'authentifier auprès d'Azure, notamment pour puller les images.
# Elle est DISTINCTE de l'identité principale du cluster (control plane).
#
# Sans ce rôle, les pods verront une erreur ImagePullBackOff.
# ------------------------------------------------------------------------------
resource "azurerm_role_assignment" "aks_acr_pull" {
  # Scope : l'ACR lui-même (limiter le principe du moindre privilège)
  scope = azurerm_container_registry.main.id

  # Rôle prédéfini Azure : lecture + pull des images uniquement
  role_definition_name = "AcrPull"

  # Principal : l'identité managée kubelet des nœuds AKS
  # kubelet_identity[0].object_id est l'Object ID du managed identity
  principal_id = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id

  # Évite les erreurs de propagation IAM lors du premier apply
  depends_on = [azurerm_kubernetes_cluster.main]
}
