// Chrome can display the sized popup as soon as this small document loads.
// Keep the app and its styles off the document's initial load path.
function openPopup() {
  void import('./main').catch(() => {
    const shell = document.getElementById('popup-boot');
    if (!shell) return;
    const retry = document.createElement('button');
    retry.textContent = 'Reload Nostr WoT';
    retry.onclick = () => location.reload();
    shell.replaceChildren(retry);
  });
}

if (document.readyState === 'complete') openPopup();
else window.addEventListener('load', openPopup, { once: true });
