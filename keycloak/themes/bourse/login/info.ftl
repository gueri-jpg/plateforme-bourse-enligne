<#-- info.ftl — BourseOnline — page d'information / succès -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Information · BourseOnline</title>
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

      <#if message?has_content>
        <span class="bourse-info-icon" aria-hidden="true">
          <#if message.type == 'success'>✅
          <#elseif message.type == 'warning'>⚠️
          <#elseif message.type == 'error'>❌
          <#else>ℹ️
          </#if>
        </span>

        <h1 class="bourse-info-title">
          <#if message.type == 'success'>Opération réussie
          <#elseif message.type == 'warning'>Attention
          <#elseif message.type == 'error'>Une erreur est survenue
          <#else>Information
          </#if>
        </h1>

        <div class="bourse-info-text">
          <p>${kcSanitize(message.summary)?no_esc}</p>
          <#if requiredActions??>
            <ul style="margin-top:12px; text-align:left; padding-left:20px;">
              <#list requiredActions>
                <#items as reqActionItem>
                  <li>${kcSanitize(msg("requiredAction.${reqActionItem}"))?no_esc}</li>
                </#items>
              </#list>
            </ul>
          </#if>
        </div>
      </#if>

      <!-- Action -->
      <#if skipLink??>
        <p class="bourse-info-text" style="font-size:12px; margin-bottom:0;">
          Vous pouvez fermer cette fenêtre.
        </p>
      <#else>
        <#if actionUri?has_content>
          <a class="btn-primary" href="${actionUri}"
             style="display:inline-flex; text-decoration:none; max-width:320px; margin:0 auto;">
            Continuer
            <span class="btn-arrow">›</span>
          </a>
        <#elseif (client.baseUrl)?has_content>
          <a class="btn-secondary" href="${client.baseUrl}"
             style="display:inline-flex; text-decoration:none; max-width:320px; margin:0 auto;">
            ← Retour à ${(client.name)!"l'application"}
          </a>
        </#if>
      </#if>

    </div><!-- /bourse-info-body -->

  </div><!-- /bourse-card -->
</div><!-- /bourse-page -->

</body>
</html>
