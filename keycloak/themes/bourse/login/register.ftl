<#-- register.ftl — BourseOnline — inscription investisseur -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Créer un compte · BourseOnline</title>
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
      <div class="bourse-logo-tagline">Rejoignez la plateforme de trading</div>
    </div>

    <!-- Titre -->
    <div class="bourse-header">
      <h1 class="bourse-title">Créer votre compte</h1>
      <p class="bourse-subtitle">Ouvrez votre espace investisseur en quelques minutes.</p>
    </div>

    <div class="bourse-body">

      <#if message?has_content>
        <div class="kc-alert ${message.type}" role="alert">
          <span class="kc-alert-icon">
            <#if message.type == 'success'>✓<#elseif message.type == 'error'>✕<#else>!</#if>
          </span>
          <span>${kcSanitize(message.summary)?no_esc}</span>
        </div>
      </#if>

      <form id="kc-register-form" action="${url.loginAction}" method="post" novalidate>

        <!-- Prénom + Nom -->
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="firstName">Prénom</label>
            <div class="input-wrap">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input
                class="form-input<#if messagesPerField.existsError('firstName')> has-error</#if>"
                type="text" id="firstName" name="firstName"
                value="${(register.formData.firstName)!''}"
                autocomplete="given-name" placeholder="Prénom" autofocus
              >
            </div>
            <#if messagesPerField.existsError('firstName')>
              <span class="field-error">${kcSanitize(messagesPerField.get('firstName'))?no_esc}</span>
            </#if>
          </div>

          <div class="form-group">
            <label class="form-label" for="lastName">Nom</label>
            <div class="input-wrap">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input
                class="form-input<#if messagesPerField.existsError('lastName')> has-error</#if>"
                type="text" id="lastName" name="lastName"
                value="${(register.formData.lastName)!''}"
                autocomplete="family-name" placeholder="Nom de famille"
              >
            </div>
            <#if messagesPerField.existsError('lastName')>
              <span class="field-error">${kcSanitize(messagesPerField.get('lastName'))?no_esc}</span>
            </#if>
          </div>
        </div>

        <!-- Email -->
        <div class="form-group">
          <label class="form-label" for="email">Adresse e-mail</label>
          <div class="input-wrap">
            <span class="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </span>
            <input
              class="form-input<#if messagesPerField.existsError('email')> has-error</#if>"
              type="email" id="email" name="email"
              value="${(register.formData.email)!''}"
              autocomplete="email" placeholder="vous@exemple.com"
            >
          </div>
          <#if messagesPerField.existsError('email')>
            <span class="field-error">${kcSanitize(messagesPerField.get('email'))?no_esc}</span>
          </#if>
        </div>

        <!-- Nom d'utilisateur (si différent de l'email) -->
        <#if !realm.registrationEmailAsUsername>
          <div class="form-group">
            <label class="form-label" for="username">Nom d'utilisateur</label>
            <div class="input-wrap">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </span>
              <input
                class="form-input<#if messagesPerField.existsError('username')> has-error</#if>"
                type="text" id="username" name="username"
                value="${(register.formData.username)!''}"
                autocomplete="username" placeholder="nom.utilisateur" spellcheck="false"
              >
            </div>
            <#if messagesPerField.existsError('username')>
              <span class="field-error">${kcSanitize(messagesPerField.get('username'))?no_esc}</span>
            </#if>
          </div>
        </#if>

        <!-- Mots de passe -->
        <#if passwordRequired??>
          <div class="form-group">
            <label class="form-label" for="password">Mot de passe</label>
            <div class="input-wrap password-wrap">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <input
                class="form-input<#if messagesPerField.existsError('password','password-confirm')> has-error</#if>"
                type="password" id="password" name="password"
                autocomplete="new-password" placeholder="Min. 8 caractères"
              >
              <button type="button" class="toggle-pw" onclick="togglePw(this,'password')" aria-label="Afficher le mot de passe">
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

          <div class="form-group">
            <label class="form-label" for="password-confirm">Confirmer le mot de passe</label>
            <div class="input-wrap password-wrap">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
              </span>
              <input
                class="form-input<#if messagesPerField.existsError('password-confirm')> has-error</#if>"
                type="password" id="password-confirm" name="password-confirm"
                autocomplete="new-password" placeholder="Retapez votre mot de passe"
              >
              <button type="button" class="toggle-pw" onclick="togglePw(this,'password-confirm')" aria-label="Afficher la confirmation">
                <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                <svg class="eye-off-icon" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              </button>
            </div>
            <#if messagesPerField.existsError('password-confirm')>
              <span class="field-error">${kcSanitize(messagesPerField.get('password-confirm'))?no_esc}</span>
            </#if>
          </div>
        </#if>

        <!-- reCAPTCHA -->
        <#if recaptchaRequired??>
          <div class="form-group">
            <div class="g-recaptcha" data-size="compact" data-sitekey="${recaptchaSiteKey}"></div>
          </div>
          <script src="https://www.google.com/recaptcha/api.js" async defer></script>
        </#if>

        <button class="btn-primary" type="submit" id="kc-register">
          Créer mon compte
          <span class="btn-arrow">›</span>
        </button>
      </form>

    </div><!-- /bourse-body -->

    <div class="bourse-footer">
      Déjà inscrit ?<a href="${url.loginUrl}">Se connecter</a>
    </div>

    <!-- Badges de confiance -->
    <div class="trust-row">
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">Inscription sécurisée</div>
          <div class="trust-text">Données protégées</div>
        </div>
      </div>
      <div class="trust-sep"></div>
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">Accès immédiat</div>
          <div class="trust-text">Compte gratuit</div>
        </div>
      </div>
      <div class="trust-sep"></div>
      <div class="trust-item">
        <span class="trust-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </span>
        <div>
          <div class="trust-title">En 2 minutes</div>
          <div class="trust-text">Ouverture rapide</div>
        </div>
      </div>
    </div>

  </div><!-- /bourse-card -->
</div><!-- /bourse-page -->

<script>
  function togglePw(btn, id) {
    var input  = document.getElementById(id);
    var eyeOn  = btn.querySelector('.eye-icon');
    var eyeOff = btn.querySelector('.eye-off-icon');
    var show   = input.type === 'password';
    input.type           = show ? 'text'     : 'password';
    eyeOn.style.display  = show ? 'none'     : '';
    eyeOff.style.display = show ? ''         : 'none';
  }
  document.getElementById('kc-register-form').addEventListener('submit', function() {
    var btn = document.getElementById('kc-register');
    btn.disabled = true;
    btn.innerHTML = 'Création en cours…';
  });
</script>
</body>
</html>
