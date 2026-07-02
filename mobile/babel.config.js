// babel.config.js — Configuration Babel pour Expo (React Native)
// Utilise babel-preset-expo qui inclut déjà les transformations nécessaires
// pour TypeScript, JSX, et les modules ES natifs.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
