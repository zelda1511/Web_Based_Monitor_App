// Sets the theme before the first paint so dark mode never flashes white. A file, not an inline script: the page's CSP allows scripts from the app only.
try {
  var m = localStorage.getItem('theme');
  var dark = m === 'dark' || (m !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
} catch (e) {}
