// On phones detail panels render below long lists; bring the opened panel into view unless it is already near the top.
export function revealSection(id: string) {
  window.setTimeout(() => {
    const element = document.getElementById(id);
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}
