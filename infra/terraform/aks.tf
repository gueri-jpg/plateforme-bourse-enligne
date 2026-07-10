# ==============================================================================
# aks.tf â€” Cluster Azure Kubernetes Service (AKS)
#
# CrÃ©e un cluster AKS managÃ© avec :
#   - Node pool systÃ¨me : 2 nÅ“uds Standard_D2s_v3 dans le subnet AKS
#   - IdentitÃ© System-Assigned : Azure gÃ¨re automatiquement le principal de service
#   - Azure CNI (network_plugin=azure) : chaque pod obtient une IP du VNet
#   - Calico : network policy pour isoler les pods entre namespaces
#   - DNS prefix : {project_name}-{environment}
# ==============================================================================

resource "azurerm_kubernetes_cluster" "main" {
  name                = "aks-${var.project_name}-${var.environment}"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name

  # PrÃ©fixe DNS utilisÃ© pour le FQDN de l'API server Kubernetes
  # RÃ©sultat : {dns_prefix}-{random}.hcp.{location}.azmk8s.io
  dns_prefix = "${var.project_name}-${var.environment}"

  # --------------------------------------------------------------------------
  # Node pool systÃ¨me (obligatoire)
  # "system" signifie qu'il hÃ©berge les composants critiques Kubernetes
  # (coredns, metrics-server, etc.) en plus des workloads applicatifs.
  # --------------------------------------------------------------------------
  default_node_pool {
    name           = "system"
    node_count     = var.aks_node_count
    vm_size        = var.aks_node_vm_size

    # Placement des nÅ“uds dans le subnet AKS dÃ©diÃ©
    vnet_subnet_id = azurerm_subnet.aks.id

    # Type du node pool : VirtualMachineScaleSets permet l'autoscaling futur
    type = "VirtualMachineScaleSets"

    # Taille du disque OS par nÅ“ud (Go)
    os_disk_size_gb = 50

    tags = {
      project     = var.project_name
      environment = var.environment
      pool        = "system"
    }
  }

  # --------------------------------------------------------------------------
  # IdentitÃ© managÃ©e System-Assigned
  # Azure crÃ©e et gÃ¨re automatiquement un principal de service pour l'AKS.
  # Plus simple que UserAssigned, suffisant pour la plupart des cas.
  # --------------------------------------------------------------------------
  identity {
    type = "SystemAssigned"
  }

  # --------------------------------------------------------------------------
  # Configuration rÃ©seau
  # network_plugin=azure : Azure CNI â€” les pods ont des IPs routables dans le VNet
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
  # Add-ons AKS managÃ©s
  # --------------------------------------------------------------------------
  # DÃ©sactivation de l'Azure Policy add-on (non requis pour ce projet)
  azure_policy_enabled = false

  # Monitoring : peut Ãªtre activÃ© en prod via log_analytics_workspace_id
  # oms_agent { ... } â€” dÃ©sactivÃ© pour rÃ©duire les coÃ»ts en production initiale

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

