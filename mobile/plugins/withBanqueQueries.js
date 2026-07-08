const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Ajoute <queries> pour cfcdigibank:// dans AndroidManifest.
 * Requis sur Android 11+ (API 30+) pour que Linking.canOpenURL fonctionne
 * vers l'app banque CFC.
 */
module.exports = function withBanqueQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.queries) manifest.queries = [];
    const alreadyAdded = manifest.queries.some((q) =>
      q.intent?.some((i) =>
        i.data?.some((d) => d.$?.['android:scheme'] === 'cfcdigibank')
      )
    );
    if (!alreadyAdded) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
            data:   [{ $: { 'android:scheme': 'cfcdigibank' } }],
          },
        ],
      });
    }
    return config;
  });
};
