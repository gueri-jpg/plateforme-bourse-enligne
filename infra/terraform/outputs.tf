# ==============================================================================
# outputs.tf — Valeurs exportées après terraform apply
#
# Ces outputs permettent :
#   - De récupérer le kubeconfig AKS pour kubectl
#   - De connaître l'URL de l'ACR pour pousser les images Docker
#   - De connaître le FQDN PostgreSQL pour configurer le Helm chart
# ==============================================================================

# ------------------------------------------------------------------------------
# Kubeconfig AKS — fichier de configuration kubectl
# Sensible : contient les certificats et credentials d'accès au cluster
# Utilisation : terraform output -raw kube_config > ~/.kube/config-bourse
# ------------------------------------------------------------------------------
output "kube_config" {
  description = "Contenu du fichier kubeconfig pour se connecter au cluster AKS avec kubectl"
  value       = azurerm_kubernetes_cluster.main.kube_config_raw
  sensitive   = true
}

# ------------------------------------------------------------------------------
# Login server de l'ACR — URL de base pour pousser/puller les images
# Exemple : acrbourseprood.azurecr.io
# Utilisation dans le Helm chart via global.imageRegistry
# ------------------------------------------------------------------------------
output "acr_login_server" {
  description = "URL du login server de l'Azure Container Registry (ex: acrboursprod.azurecr.io)"
  value       = azurerm_container_registry.main.login_server
}

# ------------------------------------------------------------------------------
# FQDN PostgreSQL — adresse DNS privée du serveur PostgreSQL Flexible
# Exemple : psql-bourse-prod.postgres.database.azure.com
# À renseigner dans values.yaml > postgres.host
# ------------------------------------------------------------------------------
output "postgres_fqdn" {
  description = "Nom de domaine complet (FQDN) du serveur PostgreSQL Azure Flexible Server"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}

# ------------------------------------------------------------------------------
# Nom du resource group principal — utile pour les commandes az CLI
# Exemple : rg-bourse-prod
# ------------------------------------------------------------------------------
output "resource_group_name" {
  description = "Nom du resource group Azure principal contenant toutes les ressources"
  value       = azurerm_resource_group.main.name
}

# ------------------------------------------------------------------------------
# Nom du cluster AKS — utile pour az aks get-credentials
# ------------------------------------------------------------------------------
output "aks_cluster_name" {
  description = "Nom du cluster AKS pour la commande az aks get-credentials"
  value       = azurerm_kubernetes_cluster.main.name
}

# ------------------------------------------------------------------------------
# Identité kubelet AKS — client_id nécessaire pour valider le role AcrPull
# ------------------------------------------------------------------------------
output "aks_kubelet_identity_object_id" {
  description = "Object ID de l'identité managée kubelet (utilisée pour le rôle AcrPull)"
  value       = azurerm_kubernetes_cluster.main.kubelet_identity[0].object_id
}
