# ==============================================================================
# aks.tf — Cluster Azure Kubernetes Service (AKS)
#
# Crée un cluster AKS managé avec :
#   - Node pool système : 2 nœuds Standard_D2s_v3 dans le subnet AKS
#   - Identité System-Assigned : Azure gère automatiquement le principal de service
#   - Azure CNI (network_plugin=azure) : chaque pod obtient une IP du VNet
#   - Calico : network policy pour isoler les pods entre namespaces
#   - DNS prefix : {project_name}-{environment}
# ==============================================================================

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${var.project_name}-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  # Préfixe DNS utilisé pour le FQDN de l'API server Kubernetes
  # Résultat : {dns_prefix}-{random}.hcp.{location}.azmk8s.io
  dns_prefix = "${var.project_name}-${var.environment}"

  # --------------------------------------------------------------------------
  # Node pool système (obligatoire)
  # "system" signifie qu'il héberge les composants critiques Kubernetes
  # (coredns, metrics-server, etc.) en plus des workloads applicatifs.
  # --------------------------------------------------------------------------
  default_node_pool {
    name           = "system"
    node_count     = var.aks_node_count
    vm_size        = var.aks_node_vm_size

    # Placement des nœuds dans le subnet AKS dédié
    vnet_subnet_id = azurerm_subnet.aks.id

    # Type du node pool : VirtualMachineScaleSets permet l'autoscaling futur
    type = "VirtualMachineScaleSets"

    # Taille du disque OS par nœud (Go)
    os_disk_size_gb = 50

    tags = {
      project     = var.project_name
      environment = var.environment
      pool        = "system"
    }
  }

  # --------------------------------------------------------------------------
  # Identité managée System-Assigned
  # Azure crée et gère automatiquement un principal de service pour l'AKS.
  # Plus simple que UserAssigned, suffisant pour la plupart des cas.
  # --------------------------------------------------------------------------
  identity {
    type = "SystemAssigned"
  }

  # --------------------------------------------------------------------------
  # Configuration réseau
  # network_plugin=azure : Azure CNI — les pods ont des IPs routables dans le VNet
  # network_policy=calico : NetworkPolicy Kubernetes pour l'isolation des pods
  # --------------------------------------------------------------------------
  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"

    # Plage pour les services ClusterIP internes (ne doit pas chevaucher le VNet)
    service_cidr       = "10.1.0.0/16"
    dns_service_ip     = "10.1.0.10"
  }

  # --------------------------------------------------------------------------
  # Add-ons AKS managés
  # --------------------------------------------------------------------------
  # Désactivation de l'Azure Policy add-on (non requis pour ce projet)
  azure_policy_enabled = false

  # Monitoring : peut être activé en prod via log_analytics_workspace_id
  # oms_agent { ... } — désactivé pour réduire les coûts en production initiale

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}
