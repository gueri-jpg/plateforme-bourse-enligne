<#-- login.ftl — BourseOnline — connexion investisseur -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Connexion · BourseOnline</title>
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
      <div class="bourse-logo-tagline">Plateforme de trading en ligne</div>
    </div>

    <!-- Titre -->
    <div class="bourse-header">
      <h1 class="bourse-title">Connexion à votre compte</h1>
      <p class="bourse-subtitle">Accédez à votre espace investisseur.</p>
    </div>

    <div class="bourse-body">

      <#if message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
        <div class="kc-alert ${message.type}" role="alert">
          <span class="kc-alert-icon">
            <#if message.type == 'success'>✓<#elseif message.type == 'error'>✕<#else>!</#if>
          </span>
          <span>${kcSanitize(message.summary)?no_esc}</span>
        </div>
      </#if>

      <form id="kc-form-login" action="${url.loginAction}" method="post" novalidate>
        <input type="hidden" id="id-hidden-input" name="credentialId" value="${(auth.selectedCredential)!''}">

        <!-- Email / Nom d'utilisateur -->
        <div class="form-group">
          <div class="label-row">
            <label class="form-label" for="username">
              <#if !realm.loginWithEmailAllowed>Nom d'utilisateur
              <#elseif !realm.registrationEmailAsUsername>Email ou nom d'utilisateur
              <#else>Adresse e-mail
              </#if>
            </label>
          </div>
          <div class="input-wrap">
            <span class="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </span>
            <input
              class="form-input<#if messagesPerField.existsError('username','password')> has-error</#if>"
              type="text" id="username" name="username"
              value="${(login.username)!''}"
              autocomplete="username" spellcheck="false"
              placeholder="<#if !realm.loginWithEmailAllowed>nom.utilisateur<#else>email@exemple.com</#if>"
              <#if !usernameEditDisabled??>autofocus</#if>
            >
          </div>
          <#if messagesPerField.existsError('username')>
            <span class="field-error">${kcSanitize(messagesPerField.get('username'))?no_esc}</span>
          </#if>
        </div>

        <!-- Mot de passe -->
        <div class="form-group">
          <div class="label-row">
            <label class="form-label" for="password">Mot de passe</label>
            <#if realm.resetPasswordAllowed>
              <a class="forgot-link" href="https://bourse.cfconsultancy.org/forgot-password.html" tabindex="4">
                Mot de passe oublié ?
              </a>
            </#if>
          </div>
          <div class="input-wrap password-wrap">
            <span class="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input
              class="form-input<#if messagesPerField.existsError('username','password')> has-error</#if>"
              type="password" id="password" name="password"
              autocomplete="current-password" placeholder="••••••••••"
              <#if usernameEditDisabled??>autofocus</#if>
            >
            <button type="button" class="toggle-pw" onclick="togglePw(this)" aria-label="Afficher le mot de passe" tabindex="3">
              <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="eye-off-icon" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <#if messagesPerField.existsError('password')>
            <span class="field-error">${kcSanitize(messagesPerField.get('password'))?no_esc}</span>
          </#if>
        </div>

        <!-- Se souvenir de moi -->
        <#if realm.rememberMe && !usernameEditDisabled??>
          <div class="remember-row">
            <label class="checkbox-label">
              <input type="checkbox" name="rememberMe" tabindex="2" <#if login.rememberMe??>checked</#if>>
              <span>Se souvenir de moi</span>
            </label>
          </div>
        </#if>

        <button class="btn-primary" type="submit" id="kc-login" name="login" tabindex="5">
          Se connecter
          <span class="btn-arrow">›</span>
        </button>
      </form>

      <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
        <div class="bourse-footer" style="border-top:none; padding-top:16px;">
          Pas encore de compte ?<a href="${url.registrationUrl}">Créer un compte</a>
        </div>
      </#if>

    </div><!-- /bourse-body -->

    <!-- Badges de confiance -->
    <div class="trust-row">
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">Connexion sécurisée</div>
          <div class="trust-text">OAuth2 / OIDC</div>
        </div>
      </div>
      <div class="trust-sep"></div>
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">Données chiffrées</div>
          <div class="trust-text">Chiffrement TLS</div>
        </div>
      </div>
      <div class="trust-sep"></div>
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">Marchés temps réel</div>
          <div class="trust-text">Données BVC live</div>
        </div>
      </div>
    </div>

  </div><!-- /bourse-card -->
</div><!-- /bourse-page -->

<script>
  function togglePw(btn) {
    var input  = btn.previousElementSibling;
    var eyeOn  = btn.querySelector('.eye-icon');
    var eyeOff = btn.querySelector('.eye-off-icon');
    var show   = input.type === 'password';
    input.type           = show ? 'text'     : 'password';
    eyeOn.style.display  = show ? 'none'     : '';
    eyeOff.style.display = show ? ''         : 'none';
    btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  }
  document.getElementById('kc-form-login').addEventListener('submit', function() {
    var btn = document.getElementById('kc-login');
    btn.disabled = true;
    btn.innerHTML = 'Connexion en cours…';
  });
</script>
</body>
</html>
