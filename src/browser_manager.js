// src/browser_manager.js

// 1. Importation
const playwright = require('playwright');

// 3. Fonction d'Initialisation
/**
 * Initialise une instance de navigateur Playwright, un contexte et une page.
 * @param {object} options - Options de lancement pour Playwright (ex: { headless: false }).
 * @returns {Promise<{browser: import('playwright').Browser, page: import('playwright').Page}>} Un objet contenant l'instance du navigateur et la page.
 */
async function initializeBrowser(options = {}) {
    // Lance le navigateur (Chromium par défaut) avec les options fournies
    const browser = await playwright.chromium.launch(options);
    // Crée un nouveau contexte
    const context = await browser.newContext();
    // Crée une nouvelle page
    const page = await context.newPage();
    // Retourne le navigateur et la page
    return { browser, page };
}

// 4. Fonction de Fermeture
/**
 * Ferme proprement l'instance du navigateur Playwright.
 * @param {import('playwright').Browser} browser - L'instance du navigateur à fermer.
 */
async function closeBrowser(browser) {
    // Vérifie si l'objet browser est valide
    if (browser && typeof browser.close === 'function') {
        try {
            // Ferme le navigateur
            await browser.close();
            // console.log("Navigateur fermé avec succès."); // Log de confirmation (optionnel)
        } catch (error) {
            // Gestion d'erreur basique
            console.error("Erreur lors de la fermeture du navigateur:", error);
        }
    } else {
        // console.warn("Tentative de fermeture d'un navigateur invalide ou déjà fermé."); // Avertissement (optionnel)
    }
}

// 5. Exportation
module.exports = {
    initializeBrowser,
    closeBrowser
};