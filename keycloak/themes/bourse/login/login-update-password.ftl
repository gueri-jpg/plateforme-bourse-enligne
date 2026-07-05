<#-- login-update-password.ftl — BourseOnline — choisir un nouveau mot de passe -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#60a5fa">
  <title>Nouveau mot de passe · BourseOnline</title>
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
      <h1 class="bourse-title">Choisissez un nouveau mot de passe</h1>
      <p class="bourse-subtitle">Votre nouveau mot de passe doit comporter au moins 8 caractères.</p>
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

      <form id="kc-passwd-update-form" action="${url.loginAction}" method="post" novalidate>

        <#if isAppInitiatedAction??>
          <input type="hidden" name="logout-sessions" value="on">
        </#if>

        <!-- Nouveau mot de passe -->
        <div class="form-group">
          <label class="form-label" for="password-new">Nouveau mot de passe</label>
          <div class="input-wrap password-wrap">
            <span class="input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </span>
            <input
              class="form-input<#if messagesPerField.existsError('password-new','password-confirm')> has-error</#if>"
              type="password" id="password-new" name="password-new"
              autocomplete="new-password" placeholder="Min. 8 caractères"
              autofocus
            >
            <button type="button" class="toggle-pw" onclick="togglePw(this,'password-new')" aria-label="Afficher le mot de passe">
              <svg class="eye-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
              </svg>
              <svg class="eye-off-icon" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
          </div>
          <#if messagesPerField.existsError('password-new')>
            <span class="field-error">${kcSanitize(messagesPerField.get('password-new'))?no_esc}</span>
          </#if>
        </div>

        <!-- Confirmer le mot de passe -->
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

        <button class="btn-primary" type="submit" id="kc-update-submit">
          Mettre à jour le mot de passe
          <span class="btn-arrow">›</span>
        </button>

        <#if isAppInitiatedAction??>
          <button class="btn-secondary" type="submit" name="cancel-aia" value="true">
            Annuler
          </button>
        </#if>

      </form>
    </div><!-- /bourse-body -->

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
  document.getElementById('kc-passwd-update-form').addEventListener('submit', function(e) {
    if (e.submitter && e.submitter.name === 'cancel-aia') return;
    var btn = document.getElementById('kc-update-submit');
    btn.disabled = true;
    btn.textContent = 'Mise à jour en cours…';
  });
</script>
</body>
</html>
