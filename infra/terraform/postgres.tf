# ==============================================================================
# postgres.tf â€” Azure Database for PostgreSQL Flexible Server
#
# Remplace le conteneur postgres:16-alpine du docker-compose local par un
# service managÃ© Azure, accessible en privÃ© uniquement depuis le VNet (AKS).
#
# CrÃ©e :
#   - Le serveur PostgreSQL Flexible 16, en zone privÃ©e (Private Access)
#   - 2 bases de donnÃ©es : bourse_db (mÃ©tier) + keycloak_db (Keycloak)
#   - Liaison avec la zone DNS privÃ©e dÃ©finie dans network.tf
#
# Conforme Ã  docker-compose.yml : mÃªmes noms de bases que l'environnement
# local (bourse_db, keycloak_db), mÃªme utilisateur administrateur.
# ==============================================================================

# ------------------------------------------------------------------------------
# Serveur PostgreSQL Flexible
# Nommage : psql-{project_name}-{environment}
# AccÃ¨s rÃ©seau : "Private Access" via delegated subnet (snet-postgres)
#   => pas d'IP publique, uniquement accessible depuis le VNet (AKS inclus)
# zone = "1" : zone de disponibilitÃ© Azure fixe (pas de redondance HA ici,
#              suffisant pour un environnement initial ; ajouter une zone
#              standby pour la haute disponibilitÃ© en production avancÃ©e)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server" "main" {
  name                = "psql-${var.project_name}-${var.environment}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location

  # Version majeure de PostgreSQL (alignÃ©e avec docker-compose : postgres:16)
  version = var.postgres_version

  # Identifiants administrateur (le mot de passe est fourni via tfvars/CI, jamais en dur)
  administrator_login    = var.postgres_admin_username
  administrator_password = var.postgres_admin_password

  # SKU : B_Standard_B1ms = tier Burstable, 1 vCore, 2 Go RAM (Ã©conomique)
  sku_name = var.postgres_sku_name

  # Stockage allouÃ© en Go
  storage_mb = var.postgres_storage_gb * 1024

  # Zone de disponibilitÃ© unique (pas de HA standby pour limiter les coÃ»ts)
  zone = "1"

  # RÃ©tention des sauvegardes automatiques (jours)
  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  # --------------------------------------------------------------------------
  # RÃ©seau privÃ© : le serveur est injectÃ© dans le subnet dÃ©diÃ© snet-postgres
  # et rÃ©solu via la zone DNS privÃ©e. Aucun accÃ¨s public possible.
  # --------------------------------------------------------------------------
  delegated_subnet_id          = azurerm_subnet.postgres.id
  private_dns_zone_id          = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }

  # Le lien VNet <-> zone DNS privÃ©e doit exister AVANT la crÃ©ation du serveur
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]

  lifecycle {
    # Ã‰vite que Terraform tente de recrÃ©er le serveur si la zone de
    # disponibilitÃ© change automatiquement cÃ´tÃ© Azure (rebalancing interne)
    ignore_changes = [zone]
  }
}

# ------------------------------------------------------------------------------
# Base de donnÃ©es mÃ©tier : bourse_db
# Contient les schÃ©mas identitÃ© / marchÃ© / portefeuille / ordres / historique
# (cf. docs/architecture.md section 3 du projet d'origine)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_database" "bourse_db" {
  name      = "bourse_db"
  server_id = azurerm_postgresql_flexible_server.main.id

  # Encodage et collation standards pour les donnÃ©es financiÃ¨res / texte FR
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# ------------------------------------------------------------------------------
# Base de donnÃ©es dÃ©diÃ©e Ã  Keycloak : keycloak_db
# IsolÃ©e de bourse_db pour respecter la sÃ©paration des responsabilitÃ©s
# (Keycloak gÃ¨re son propre schÃ©ma interne de tables d'authentification)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_database" "keycloak_db" {
  name      = "keycloak_db"
  server_id = azurerm_postgresql_flexible_server.main.id

  collation = "en_US.utf8"
  charset   = "UTF8"
}

# ------------------------------------------------------------------------------
# RÃ¨gle de pare-feu / configuration serveur : autorise les connexions SSL
# uniquement (bonne pratique sÃ©curitÃ© pour une base accessible depuis AKS)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_configuration" "require_ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "ON"
}

