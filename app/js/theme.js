// Applies the saved light/dark choice before the page paints (a file, not inline, so the script policy can forbid inline code).
try { var t = localStorage.getItem('ro.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
