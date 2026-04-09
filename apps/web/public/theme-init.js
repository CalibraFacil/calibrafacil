try {
  const stored = localStorage.getItem('theme')
  const theme =
    stored === 'dark' || stored === 'light'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'

  document.documentElement.classList.add(theme)
} catch {
  document.documentElement.classList.add('light')
}
