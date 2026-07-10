# ==============================================================================
# network.tf â€” Infrastructure rÃ©seau Azure
#
# CrÃ©e :
#   - VNet principal avec 2 sous-rÃ©seaux isolÃ©s
#   - Subnet AKS  : hÃ©berge les nÅ“uds Kubernetes
#   - Subnet PostgreSQL : rÃ©seau privÃ© pour le Flexible Server (avec dÃ©lÃ©gation)
#
# La dÃ©lÃ©gation Microsoft.DBforPostgreSQL/flexibleServers est obligatoire pour
# que le Flexible Server puisse injecter sa NIC dans le sous-rÃ©seau.
# ==============================================================================

# ------------------------------------------------------------------------------
# RÃ©seau virtuel principal
# Nommage : vnet-{project_name}-{environment}
# Plage : 10.0.0.0/16 (65 536 adresses disponibles)
# ------------------------------------------------------------------------------
resource "azurerm_virtual_network" "main" {
  name                = "vnet-${var.project_name}-${var.environment}"
  location            = data.azurerm_resource_group.main.location
  resource_group_name = data.azurerm_resource_group.main.name
  address_space       = [var.vnet_address_space]

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# Sous-rÃ©seau AKS
# Plage : 10.0.1.0/24 (256 adresses, suffisant pour 2-10 nÅ“uds + pods)
# Pas de dÃ©lÃ©gation : les nÅ“uds AKS utilisent ce subnet en mode standard
# Note : avec le network_plugin=azure (Azure CNI), chaque pod consomme une IP
#        dans ce subnet. PrÃ©voir suffisamment d'adresses si scaling prÃ©vu.
# ------------------------------------------------------------------------------
resource "azurerm_subnet" "aks" {
  name                 = "snet-aks"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.aks_subnet_cidr]
}

# ------------------------------------------------------------------------------
# Sous-rÃ©seau PostgreSQL Flexible Server
# Plage : 10.0.2.0/24
# La dÃ©lÃ©gation est OBLIGATOIRE pour PostgreSQL Flexible Server en mode
# "rÃ©seau privÃ©" (Private Access). Elle rÃ©serve ce subnet exclusivement
# au service managÃ© PostgreSQL.
# ------------------------------------------------------------------------------
resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = [var.postgres_subnet_cidr]

  # DÃ©lÃ©gation obligatoire pour PostgreSQL Flexible Server
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
# Zone DNS privÃ©e pour PostgreSQL Flexible Server
# Le FQDN gÃ©nÃ©rÃ© par Azure (*.postgres.database.azure.com) doit Ãªtre rÃ©solvable
# depuis l'intÃ©rieur du VNet. La zone privÃ©e assure cette rÃ©solution sans
# passer par le DNS public.
# ------------------------------------------------------------------------------
resource "azurerm_private_dns_zone" "postgres" {
  name                = "${var.project_name}-${var.environment}.private.postgres.database.azure.com"
  resource_group_name = data.azurerm_resource_group.main.name

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

# ------------------------------------------------------------------------------
# Lien VNet â†” Zone DNS privÃ©e PostgreSQL
# Sans ce lien, les pods AKS dans le VNet ne peuvent pas rÃ©soudre le FQDN
# du serveur PostgreSQL. auto_registration_enabled=false car PostgreSQL gÃ¨re
# lui-mÃªme l'enregistrement de son entrÃ©e DNS.
# ------------------------------------------------------------------------------
resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "vnet-link-postgres-${var.environment}"
  resource_group_name   = data.azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.main.id
  registration_enabled  = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}

