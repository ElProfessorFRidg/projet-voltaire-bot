// src/browser_manager.js

const playwright = require('playwright');

/**
 * Initialise une instance de navigateur Playwright, un contexte et une page.
 * @param {object} options - Options de lancement pour Playwright (ex: { headless: false }).
 * @returns {Promise<{browser: import('playwright').Browser, page: import('playwright').Page}>}
 */
async function initializeBrowser(options = {}) {
    let browser;
    try {
        browser = await playwright.chromium.launch(options);
        if (!browser) throw new Error('Échec du lancement du navigateur Chromium.');
        const context = await browser.newContext();
        if (!context) throw new Error('Échec de la création du contexte navigateur.');
        const page = await context.newPage();
        if (!page) throw new Error('Échec de la création de la page.');
        return { browser, page };
    } catch (error) {
        if (browser) {
            await closeBrowser(browser);
        }
        throw new Error(`Erreur lors de l'initialisation du navigateur: ${error.message}`);
    }
}

/**
 * Ferme proprement l'instance du navigateur Playwright.
 * @param {import('playwright').Browser} browser - L'instance du navigateur à fermer.
 */
async function closeBrowser(browser) {
    if (!browser || typeof browser.close !== 'function') {
        // Navigateur invalide ou déjà fermé
        return;
    }
    try {
        await browser.close();
    } catch (error) {
        // Affiche l'erreur mais ne la propage pas pour éviter de casser la chaîne d'exécution
        console.error("Erreur lors de la fermeture du navigateur:", error);
    }
}

module.exports = {
    initializeBrowser,
    closeBrowser
};