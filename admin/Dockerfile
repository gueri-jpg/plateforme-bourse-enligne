# ==============================================================================
# Dockerfile — Back-office admin (SPA statique servie par Nginx)
#
# Build l'image utilisée en environnement Kubernetes (AKS), en remplacement
# du montage de volumes utilisé en local via docker-compose.
# ==============================================================================
FROM nginx:alpine

# Configuration Nginx dédiée au back-office admin
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Fichiers statiques de la SPA admin (HTML/CSS/JS vanilla, sans étape de build)
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
