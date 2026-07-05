<#-- error.ftl — BourseOnline — page d'erreur -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Erreur · BourseOnline</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/login.css">
</head>
<body>

<div class="bourse-page">
  <div class="bourse-card">

    <!-- Logo -->
    <div class="bourse-logo">
      <a href="${properties.kcLogoLink!'http://localhost:3000'}" class="bourse-logo-badge" title="BourseOnline">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      </a>
      <div class="bourse-logo-name">BourseOnline</div>
    </div>

    <div class="bourse-info-body">
      <span class="bourse-info-icon" aria-hidden="true">🔒</span>

      <h1 class="bourse-info-title">Accès refusé</h1>

      <#if message?has_content>
        <div class="kc-alert error" role="alert" style="text-align:left; max-width:360px; margin:0 auto 20px;">
          <span class="kc-alert-icon">✕</span>
          <span>${kcSanitize(message.summary)?no_esc}</span>
        </div>
      </#if>

      <#if !skipLink??>
        <#if (client.baseUrl)?has_content>
          <a class="btn-secondary" href="${client.baseUrl}"
             style="display:inline-flex; text-decoration:none; max-width:320px; margin:0 auto;">
            ← Retour à ${(client.name)!"l'application"}
          </a>
        <#else>
          <a class="btn-secondary" href="${properties.kcLogoLink!'http://localhost:3000'}"
             style="display:inline-flex; text-decoration:none; max-width:320px; margin:0 auto;">
            ← Retour à l'accueil
          </a>
        </#if>
      </#if>

    </div><!-- /bourse-info-body -->

  </div><!-- /bourse-card -->
</div><!-- /bourse-page -->

</body>
</html>
