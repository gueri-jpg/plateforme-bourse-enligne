# ==============================================================================
# Dockerfile — Frontend investisseur (SPA statique servie par Nginx)
#
# Build l'image utilisée en environnement Kubernetes (AKS), en remplacement
# du montage de volumes utilisé en local via docker-compose.
# ==============================================================================
FROM nginx:alpine

# nginx-k8s.conf utilise les noms de services Helm (bourse-platform-backend, etc.)
# à la place des noms docker-compose (backend, bvc-relay)
COPY nginx-k8s.conf /etc/nginx/conf.d/default.conf

# Fichiers statiques de la SPA (HTML/CSS/JS vanilla, sans étape de build)
COPY . /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
