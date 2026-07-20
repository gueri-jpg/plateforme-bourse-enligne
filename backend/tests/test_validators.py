"""Tests unitaires des validators Pydantic (aucun accès DB ni HTTP)."""
import pytest
from pydantic import ValidationError

from app.routers.ordres_bourse import OrdreIn
from app.routers.parametres_otp import ParametresOtp
from app.routers.parametres_devise import ParametresDevise


# ── OrdreIn ───────────────────────────────────────────────────────────────────

class TestOrdreInValidation:
    def test_ordre_limite_sans_prix_limite_invalide(self):
        with pytest.raises(ValidationError, match="prix_limite requis"):
            OrdreIn(
                instrument_code="IAM",
                sens="achat",
                type_ordre="limite",
                quantite=10,
                prix_limite=None,
            )

    def test_ordre_marche_sans_prix_marche_invalide(self):
        with pytest.raises(ValidationError, match="prix_marche requis"):
            OrdreIn(
                instrument_code="IAM",
                sens="achat",
                type_ordre="marche",
                quantite=10,
                prix_marche=None,
            )

    def test_ordre_limite_valide(self):
        ordre = OrdreIn(
            instrument_code="IAM",
            sens="achat",
            type_ordre="limite",
            quantite=5,
            prix_limite=100.0,
        )
        assert ordre.prix_limite == 100.0

    def test_ordre_marche_valide(self):
        ordre = OrdreIn(
            instrument_code="ATW",
            sens="vente",
            type_ordre="marche",
            quantite=3,
            prix_marche=85.5,
        )
        assert ordre.prix_marche == 85.5

    def test_sens_invalide_rejete(self):
        with pytest.raises(ValidationError):
            OrdreIn(instrument_code="IAM", sens="short", type_ordre="marche",
                    quantite=1, prix_marche=10.0)

    def test_quantite_zero_rejetee(self):
        with pytest.raises(ValidationError):
            OrdreIn(instrument_code="IAM", sens="achat", type_ordre="marche",
                    quantite=0, prix_marche=10.0)

    def test_prix_limite_negatif_rejete(self):
        with pytest.raises(ValidationError):
            OrdreIn(instrument_code="IAM", sens="achat", type_ordre="limite",
                    quantite=1, prix_limite=-5.0)


# ── ParametresOtp ─────────────────────────────────────────────────────────────

class TestParametresOtpValidation:
    def test_chaque_connexion_sans_valeur_valide(self):
        p = ParametresOtp(
            otp_actif_global=True,
            otp_frequence_type="chaque_connexion",
            otp_frequence_valeur=None,
        )
        assert p.otp_frequence_type == "chaque_connexion"

    def test_chaque_connexion_avec_valeur_invalide(self):
        with pytest.raises(ValidationError, match="otp_frequence_valeur doit etre absent"):
            ParametresOtp(
                otp_actif_global=True,
                otp_frequence_type="chaque_connexion",
                otp_frequence_valeur=5,
            )

    def test_apres_n_jours_sans_valeur_invalide(self):
        with pytest.raises(ValidationError, match="otp_frequence_valeur est obligatoire"):
            ParametresOtp(
                otp_actif_global=True,
                otp_frequence_type="apres_n_jours",
                otp_frequence_valeur=None,
            )

    def test_apres_n_connexions_avec_valeur_valide(self):
        p = ParametresOtp(
            otp_actif_global=False,
            otp_frequence_type="apres_n_connexions",
            otp_frequence_valeur=3,
        )
        assert p.otp_frequence_valeur == 3

    def test_frequence_type_invalide_rejete(self):
        with pytest.raises(ValidationError):
            ParametresOtp(
                otp_actif_global=True,
                otp_frequence_type="jamais",
                otp_frequence_valeur=None,
            )


# ── ParametresDevise ──────────────────────────────────────────────────────────

class TestParametresDeviseValidation:
    def test_code_iso_valide_mad(self):
        p = ParametresDevise(devise_par_defaut="MAD")
        assert p.devise_par_defaut == "MAD"

    def test_code_iso_valide_eur(self):
        p = ParametresDevise(devise_par_defaut="EUR")
        assert p.devise_par_defaut == "EUR"

    def test_code_iso_minuscule_normalise(self):
        # Le validator applique .upper() — "usd" → "USD"
        p = ParametresDevise(devise_par_defaut="usd")
        assert p.devise_par_defaut == "USD"

    def test_code_iso_trop_court_invalide(self):
        with pytest.raises(ValidationError):
            ParametresDevise(devise_par_defaut="MA")

    def test_code_iso_avec_chiffre_invalide(self):
        with pytest.raises(ValidationError, match="ISO 4217"):
            ParametresDevise(devise_par_defaut="M1D")

    def test_code_iso_trop_long_invalide(self):
        with pytest.raises(ValidationError):
            ParametresDevise(devise_par_defaut="EURO")
