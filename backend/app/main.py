"""
Point d'entree de l'application FastAPI - "Module Admin" (US-30 a US-34).

Lancement (developpement) :
    uvicorn app.main:app --reload --port 8000

Voir backend/README.md pour les instructions completes (variables
d'environnement, exemples curl, etc.).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import ws_market
from app.config import settings
from app.routers import otp_utilisateur, parametres_devise, parametres_otp, parametres_securite, portefeuille, ordres_bourse, inter_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    ws_market.start_kafka_thread()
    yield

app = FastAPI(
    title="Plateforme de Bourse en Ligne - Module Admin",
    lifespan=lifespan,
    description=(
        "API d'administration : seuils de securite (US-30/31), parametres OTP "
        "(US-32/33) et devise de la plateforme (US-34). "
        "Authentification via tokens JWT Keycloak (realm 'bourse-en-ligne')."
    ),
    version="1.0.0",
)

# ----------------------------------------------------------------------
# CORS : autorise les appels depuis le frontend SPA (cf. realm-export.json,
# client "frontend-spa", origines http://localhost:3000 et http://localhost:5173)
# ----------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8010",
        "https://bourse.cfconsultancy.org",
        "https://admin.cfconsultancy.org",
        "https://banquedigitale.cfconsultancy.org",
    ],
    allow_origin_regex=r"https?://.*\.nip\.io(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------
# Enregistrement des routers du Module Admin
# ----------------------------------------------------------------------
app.include_router(parametres_securite.router)
app.include_router(parametres_otp.router)
app.include_router(parametres_devise.router)
app.include_router(otp_utilisateur.router)
app.include_router(ws_market.router)
app.include_router(portefeuille.router)
app.include_router(ordres_bourse.router)
app.include_router(inter_service.router)


@app.get("/api/health", tags=["Supervision"])
def healthcheck():
    """Endpoint de supervision simple, sans authentification (verifie que l'API repond)."""
    return {"statut": "ok"}


@app.get("/api/config", tags=["Config"], include_in_schema=False)
def public_config():
    """Config frontend publique : URLs pour navigation inter-plateforme."""
    return {"banque_frontend_url": settings.BANQUE_FRONTEND_URL}
