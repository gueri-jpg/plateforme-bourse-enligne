# ==============================================================================
# network.tf — Infrastructure réseau Azure
#
# Crée :
#   - VNet principal avec 2 sous-réseaux isolés
#   - Subnet AKS  : héberge les nœuds Kubernetes
#   - Subnet PostgreSQL : réseau privé pour le Flexible Server (avec délégation)
#
# La délégation Microsoft.DBforPostgreSQL/flexibleServers est obligatoire pour
# que le Flexible Server puisse injecter sa NIC dans le sous-réseau.
# ==============================================================================

# ------------------------------------------------------------------------------
# Réseau virtuel principal
# Nommage : vnet-{project_name}-{environment}
# Plage : 10.0.0.0/16 (65 536 adresses disponibles)
# ------------------------------------------------------------------------------
resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.project_name}-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = [var.vnet_address_space]

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# Sous-réseau AKS
# Plage : 10.0.1.0/24 (256 adresses, suffisant pour 2-10 nœuds + pods)
# Pas de délégation : les nœuds AKS utilisent ce subnet en mode standard
# Note : avec le network_plugin=azure (Azure CNI), chaque pod consomme une IP
#        dans ce subnet. Prévoir suffisamment d'adresses si scaling prévu.
# ------------------------------------------------------------------------------
resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.aks_subnet_cidr]
}

# ------------------------------------------------------------------------------
# Sous-réseau PostgreSQL Flexible Server
# Plage : 10.0.2.0/24
# La délégation est OBLIGATOIRE pour PostgreSQL Flexible Server en mode
# "réseau privé" (Private Access). Elle réserve ce subnet exclusivement
# au service managé PostgreSQL.
# ------------------------------------------------------------------------------
resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.postgres_subnet_cidr]

  # Délégation obligatoire pour PostgreSQL Flexible Server
  delegation {
    name = "delegation-postgres-flexible"

    service_delegation {
      name = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
      ]
    }
  }
}

# ------------------------------------------------------------------------------
# Zone DNS privée pour PostgreSQL Flexible Server
# Le FQDN généré par Azure (*.postgres.database.azure.com) doit être résolvable
# depuis l'intérieur du VNet. La zone privée assure cette résolution sans
# passer par le DNS public.
# ------------------------------------------------------------------------------
resource "azurerm_private_dns_zone" "postgres" {
  name                = "${var.project_name}-${var.environment}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.main.name

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# Lien VNet ↔ Zone DNS privée PostgreSQL
# Sans ce lien, les pods AKS dans le VNet ne peuvent pas résoudre le FQDN
# du serveur PostgreSQL. auto_registration_enabled=false car PostgreSQL gère
# lui-même l'enregistrement de son entrée DNS.
# ------------------------------------------------------------------------------
resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "vnet-link-postgres-${var.environment}"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}
