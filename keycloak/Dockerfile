FROM quay.io/keycloak/keycloak:26.0
COPY themes/bourse /opt/keycloak/themes/bourse
RUN /opt/keycloak/bin/kc.sh build \
    --db=postgres \
    --health-enabled=true \
    --proxy-headers=xforwarded
