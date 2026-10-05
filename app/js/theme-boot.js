// Aplica el tema guardado ANTES de pintar la página (script clásico y síncrono en <head>):
// así la app no parpadea de claro a oscuro al abrirse. La lógica completa está en ui/theme.js;
// aquí solo se leen y validan los valores ya calculados.
(function applySavedTheme() {
  var KEY = 'dinero:apariencia';
  var COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;
  var NAMES = ['--accent', '--accent-fill', '--on-accent', '--accent-bg'];
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (error) {
    saved = null; // sin almacenamiento o datos dañados: tema por defecto
  }
  var mode = saved && (saved.mode === 'light' || saved.mode === 'dark') ? saved.mode : 'auto';
  var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  var tokens = saved && saved.tokens && saved.tokens[dark ? 'dark' : 'light'];
  if (tokens) {
    for (var i = 0; i < NAMES.length; i += 1) {
      if (COLOR.test(tokens[NAMES[i]] || '')) root.style.setProperty(NAMES[i], tokens[NAMES[i]]);
    }
  }
  var scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute('content', dark ? 'dark' : 'light');
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar && tokens && COLOR.test(tokens['--accent-fill'] || '')) bar.setAttribute('content', tokens['--accent-fill']);
}());
