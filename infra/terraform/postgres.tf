# ==============================================================================
# postgres.tf — Azure Database for PostgreSQL Flexible Server
#
# Remplace le conteneur postgres:16-alpine du docker-compose local par un
# service managé Azure, accessible en privé uniquement depuis le VNet (AKS).
#
# Crée :
#   - Le serveur PostgreSQL Flexible 16, en zone privée (Private Access)
#   - 2 bases de données : bourse_db (métier) + keycloak_db (Keycloak)
#   - Liaison avec la zone DNS privée définie dans network.tf
#
# Conforme à docker-compose.yml : mêmes noms de bases que l'environnement
# local (bourse_db, keycloak_db), même utilisateur administrateur.
# ==============================================================================

# ------------------------------------------------------------------------------
# Serveur PostgreSQL Flexible
# Nommage : psql-{project_name}-{environment}
# Accès réseau : "Private Access" via delegated subnet (snet-postgres)
#   => pas d'IP publique, uniquement accessible depuis le VNet (AKS inclus)
# zone = "1" : zone de disponibilité Azure fixe (pas de redondance HA ici,
#              suffisant pour un environnement initial ; ajouter une zone
#              standby pour la haute disponibilité en production avancée)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server" "main" {
  name                = "psql-${var.project_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  # Version majeure de PostgreSQL (alignée avec docker-compose : postgres:16)
  version = var.postgres_version

  # Identifiants administrateur (le mot de passe est fourni via tfvars/CI, jamais en dur)
  administrator_login    = var.postgres_admin_username
  administrator_password = var.postgres_admin_password

  # SKU : B_Standard_B1ms = tier Burstable, 1 vCore, 2 Go RAM (économique)
  sku_name = var.postgres_sku_name

  # Stockage alloué en Go
  storage_mb = var.postgres_storage_gb * 1024

  # Zone de disponibilité unique (pas de HA standby pour limiter les coûts)
  zone = "1"

  # Rétention des sauvegardes automatiques (jours)
  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  # --------------------------------------------------------------------------
  # Réseau privé : le serveur est injecté dans le subnet dédié snet-postgres
  # et résolu via la zone DNS privée. Aucun accès public possible.
  # --------------------------------------------------------------------------
  delegated_subnet_id          = azurerm_subnet.postgres.id
  private_dns_zone_id          = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }

  # Le lien VNet <-> zone DNS privée doit exister AVANT la création du serveur
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]

  lifecycle {
    # Évite que Terraform tente de recréer le serveur si la zone de
    # disponibilité change automatiquement côté Azure (rebalancing interne)
    ignore_changes = [zone]
  }
}

# ------------------------------------------------------------------------------
# Base de données métier : bourse_db
# Contient les schémas identité / marché / portefeuille / ordres / historique
# (cf. docs/architecture.md section 3 du projet d'origine)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_database" "bourse_db" {
  name      = "bourse_db"
  server_id = azurerm_postgresql_flexible_server.main.id

  # Encodage et collation standards pour les données financières / texte FR
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# ------------------------------------------------------------------------------
# Base de données dédiée à Keycloak : keycloak_db
# Isolée de bourse_db pour respecter la séparation des responsabilités
# (Keycloak gère son propre schéma interne de tables d'authentification)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_database" "keycloak_db" {
  name      = "keycloak_db"
  server_id = azurerm_postgresql_flexible_server.main.id

  collation = "en_US.utf8"
  charset   = "UTF8"
}

# ------------------------------------------------------------------------------
# Règle de pare-feu / configuration serveur : autorise les connexions SSL
# uniquement (bonne pratique sécurité pour une base accessible depuis AKS)
# ------------------------------------------------------------------------------
resource "azurerm_postgresql_flexible_server_configuration" "require_ssl" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "ON"
}
