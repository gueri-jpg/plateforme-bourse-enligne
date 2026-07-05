<#-- login-reset-password.ftl — BourseOnline — mot de passe oublié -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Mot de passe oublié · BourseOnline</title>
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

    <!-- Titre -->
    <div class="bourse-header">
      <h1 class="bourse-title">Mot de passe oublié</h1>
      <p class="bourse-subtitle">
        Saisissez votre adresse e-mail et nous vous enverrons un lien de réinitialisation.
      </p>
    </div>

    <div class="bourse-body">

      <#if message?has_content>
        <div class="kc-alert ${message.type}" role="alert">
          <span class="kc-alert-icon">
            <#if message.type == 'success'>✓<#elseif message.type == 'error'>✕<#else>ℹ</#if>
          </span>
          <span>${kcSanitize(message.summary)?no_esc}</span>
        </div>
      </#if>

      <form id="kc-reset-form" action="${url.loginAction}" method="post" novalidate>

        <div class="form-group">
          <label class="form-label" for="username">
            <#if !realm.loginWithEmailAllowed>Nom d'utilisateur
            <#elseif !realm.registrationEmailAsUsername>Email ou nom d'utilisateur
            <#else>Adresse e-mail
            </#if>
          </label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </span>
            <input
              class="form-input<#if messagesPerField.existsError('username')> has-error</#if>"
              type="text" id="username" name="username"
              value="${(auth.attemptedUsername)!''}"
              autocomplete="username" spellcheck="false"
              placeholder="email@exemple.com"
              autofocus
            >
          </div>
          <#if messagesPerField.existsError('username')>
            <span class="field-error">${kcSanitize(messagesPerField.get('username'))?no_esc}</span>
          </#if>
        </div>

        <button class="btn-primary" type="submit" id="kc-reset-submit">
          Envoyer le lien de réinitialisation
          <span class="btn-arrow">›</span>
        </button>

        <a class="btn-secondary" href="${url.loginUrl}">
          ← Retour à la connexion
        </a>

      </form>
    </div><!-- /bourse-body -->

  </div><!-- /bourse-card -->
</div><!-- /bourse-page -->

<script>
  document.getElementById('kc-reset-form').addEventListener('submit', function() {
    var btn = document.getElementById('kc-reset-submit');
    btn.disabled = true;
    btn.textContent = 'Envoi en cours…';
  });
</script>
</body>
</html>
