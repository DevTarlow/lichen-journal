(function () {
  var root = document.documentElement;
  try {
    var stored = window.localStorage.getItem('lichen.theme');
    var theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    root.dataset.theme = theme;
  } catch (error) {
    root.dataset.theme = 'light';
  }

  try {
    var raw = window.localStorage.getItem('lichen.preferences');
    var preferences = raw ? JSON.parse(raw) : {};
    if (
      preferences &&
      (preferences.palette === 'lichen' ||
        preferences.palette === 'river' ||
        preferences.palette === 'heather' ||
        preferences.palette === 'ember')
    ) {
      root.dataset.palette = preferences.palette;
    }
    if (preferences && preferences.reduceMotion === true) {
      root.dataset.reduceMotion = 'true';
    }
  } catch (error) {
    // Preferences are optional; the defaults are applied by the app.
  }
})();
