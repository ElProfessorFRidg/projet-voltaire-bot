/**
 * Détection d’overlay bloquant (alerte, warning, perte de connexion, etc.)
 * @module overlay_utils
 * @author Roo
 */

const OVERLAY_SELECTORS = [
  '.dialogPanel.warning',
  '.dialogPanel.errorConnection',
  '.dialogPanel[role="alert"]',
  '.overlay-blocking',
  '[data-overlay-blocking="true"]'
];

/**
 * Vérifie si un overlay bloquant est présent et visible sur la page.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
export async function isOverlayBlocking(page) {
  for (const selector of OVERLAY_SELECTORS) {
    const locator = page.locator(selector);
    if (await locator.count() > 0 && await locator.first().isVisible()) {
      return true;
    }
  }
  return false;
}

/**
 * Attend la disparition de tout overlay bloquant.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true si l’overlay a disparu, false si timeout
 */
export async function waitForOverlayToDisappear(page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isOverlayBlocking(page))) return true;
    await page.waitForTimeout(200);
  }
  return !(await isOverlayBlocking(page));
}