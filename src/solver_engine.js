import getLogger from './logger.js';
const logger = await getLogger();
import { parseExercise } from './exercise_parser.js';
import { getCorrection, getErrorReportSuggestion } from './openai_client.js';
import { randomDelay } from './human_simulator.js';
import { config } from './config_loader.js';
import { maybeThrowError, ElementNotFoundError } from './error_utils.js'; // Import ElementNotFoundError
import { AppError } from './error_utils.js';
import selectors from './selectors.js';
import { Semaphore, Mutex } from './async_utils.js';
import assert from 'assert';
import { isOverlayBlocking, waitForOverlayToDisappear } from './utils/overlay_utils.js';
import { restartBrowserSession } from './browser_manager.js'; // Import restartBrowserSession

// --- VALIDATION DES DELAIS ---
function validateActionDelays(min, max) {
    if (typeof min !== 'number' || typeof max !== 'number' || isNaN(min) || isNaN(max)) {
        throw new Error(`[solver_engine] MIN_ACTION_DELAY et MAX_ACTION_DELAY doivent être des nombres valides.`);
    }
    if (min < 0 || max < 0) {
        throw new Error(`[solver_engine] MIN_ACTION_DELAY et MAX_ACTION_DELAY doivent être >= 0.`);
    }
    if (min > max) {
        throw new Error(`[solver_engine] MIN_ACTION_DELAY (${min}) doit être <= MAX_ACTION_DELAY (${max}).`);
    }
    if (max > Number.MAX_SAFE_INTEGER) {
        throw new Error(`[solver_engine] MAX_ACTION_DELAY dépasse Number.MAX_SAFE_INTEGER.`);
    }
    return true;
}
const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY;
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY;
validateActionDelays(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
/**
 * Correction : les sélecteurs CSS sont désormais centralisés dans src/selectors.js
 * pour éviter les duplications et faciliter la maintenance.
 */

// Sémaphore global pour limiter le nombre d'exercices résolus en parallèle (ex : 4)
const solveSemaphore = new Semaphore(4);

// Map de mutex par sessionId pour éviter l'accès concurrent à une même session
const sessionMutexMap = new Map();

/**
 * Récupère ou crée un mutex pour un sessionId donné.
 */
function getSessionMutex(sessionId) {
    // Validation stricte du paramètre
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
        logger && logger.error && logger.error(`[solver_engine] getSessionMutex: sessionId invalide: ${sessionId}`);
        throw new Error(`[solver_engine] getSessionMutex: sessionId doit être une string non vide.`);
    }
    try {
        if (!sessionMutexMap.has(sessionId)) {
            sessionMutexMap.set(sessionId, new Mutex());
            logger && logger.debug && logger.debug(`[solver_engine] Création d'un nouveau mutex pour sessionId=${sessionId}`);
        } else {
            logger && logger.debug && logger.debug(`[solver_engine] Mutex existant récupéré pour sessionId=${sessionId}`);
        }
        // Assertion : unicité du mutex
        const mutex = sessionMutexMap.get(sessionId);
        assert(mutex instanceof Mutex, `[solver_engine] Mutex pour sessionId=${sessionId} n'est pas une instance de Mutex.`);
        return mutex;
    } catch (e) {
        logger && logger.error && logger.error(`[solver_engine] Erreur lors de la récupération/création du mutex pour sessionId=${sessionId}: ${e.message}`);
        throw e;
    }
}
/**
 * Segmente un mot ou une expression en parties cliquables robustes.
 * Gère chiffres, ponctuation, expressions numériques, etc.
 * Exemples :
 *   "1,2" => ["1", ",", "2"]
 *   "3.14" => ["3", ".", "14"]
 *   "12/05" => ["12", "/", "05"]
 *   "Jean-Paul" => ["Jean", "-", "Paul"]
 *   "l'été" => ["l", "'", "été"]
 * @param {string} word
 * @returns {string[]} Liste ordonnée de segments cliquables
 */
function segmentWordForClick(word) {
    // On segmente sur tout caractère non alphanumérique (ponctuation, espace, etc.), mais on conserve les séparateurs comme segments
    // On gère aussi les nombres décimaux, dates, etc.
    // On ne segmente pas à l'intérieur d'un nombre (ex: "12" reste "12"), mais on sépare "1,2" en ["1", ",", "2"]
    // On conserve l'ordre et tous les séparateurs
    const regex = /([a-zA-ZÀ-ÿ0-9]+|[.,;:!?/\\'’"«»\[\]\(\)\-–—‒‑‒_…·•\u00A0\u202F\u2009])/gu;
    // On ignore les espaces purs, mais on garde les séparateurs utiles
    return Array.from(word.matchAll(regex)).map(m => m[0]);
}

/**
 * Retire la ponctuation finale d’un mot si présente (., ;, :, !, ?)
 * @param {string} word
 * @returns {string} Mot sans ponctuation finale
 */
function stripTrailingPunctuation(word) {
    return word.replace(/[.,;:!?]+$/u, '');
}

/**
 * Logge le contexte DOM détaillé lorsqu'un mot/segment n'est pas trouvable/cliquable.
 * Inclut le texte affiché, le parent, et la structure DOM autour.
 * @param {import('playwright').Page} page
 * @param {string} word
 * @param {string} sessionId
 * @param {import('playwright').Locator} locator
 */
async function logWordNotFoundContext(page, word, sessionId, locator) {
    try {
        // Texte du parent immédiat
        const parentText = await locator.locator('xpath=..').textContent({ timeout: 1000 }).catch(() => '');
        // Structure DOM autour (outerHTML du parent)
        const parentHtml = await locator.locator('xpath=..').evaluate(node => node.outerHTML, { timeout: 1000 }).catch(() => '');
        // Texte global affiché (body)
        const bodyText = await page.locator('body').textContent({ timeout: 2000 }).catch(() => '');
        logger.error(`[${sessionId}] [CONTEXT] Mot/segment "${word}" introuvable. Texte parent: "${(parentText||'').substring(0, 200)}..."`);
        logger.error(`[${sessionId}] [CONTEXT] Structure DOM parent: ${(parentHtml||'').substring(0, 300)}...`);
        logger.error(`[${sessionId}] [CONTEXT] Texte affiché (body, extrait): "${(bodyText||'').substring(0, 300)}..."`);
    } catch (e) {
        logger.error(`[${sessionId}] [CONTEXT] Impossible de logger le contexte DOM pour "${word}": ${e.message}`);
    }
}

/**
 * Helper pour cliquer sur un mot dans la phrase.
 * @param {import('playwright').Page} page
 * @param {string} word
 * @param {string} sessionId Pour le logging
 */
/**
 * Helper pour cliquer sur un mot ou une expression dans la phrase.
 * Gère les cas complexes : chiffres, ponctuation, expressions numériques, segmentation intelligente.
 * Logge explicitement les cas d’échec avec contexte DOM détaillé.
 * Modulaire et testable.
 * @param {import('playwright').Page} page
 * @param {string} word
 * @param {string} sessionId Pour le logging
 * @returns {Promise<boolean>} true si clic réussi, false sinon
 */
async function clickWord(page, word, sessionId) {
    logger.debug(`[${sessionId}] Tentative de clic sur le mot: "${word}"`);

    // Génère des variantes du mot pour robustesse (apostrophes, espaces insécables, etc.)
    function normalize(str) {
        return str
            .replace(/[\u2019\u2018\u201B\u2032\u2035']/g, "'") // toutes apostrophes → '
            .replace(/[\u00A0\u202F\u2009]/g, ' ') // espaces insécables → espace normal
            .replace(/\s+/g, ' ') // espaces multiples → un espace
            .trim();
    }
    const variants = [
        word,
        normalize(word),
        normalize(word).replace(/'/g, "’"),
        normalize(word).replace(/'/g, "’").replace(/ /g, ''),
        normalize(word).replace(/'/g, "’").replace(/ /g, '-'),
        normalize(word).replace(/'/g, "’").replace(/ /g, '\u00A0'),
    ];
    // Unicité
    const uniqueVariants = [...new Set(variants)];

    // Vérification overlay avant toute interaction
    if (await isOverlayBlocking(page)) {
        logger.warn(`[${sessionId}] Overlay bloquant détecté avant le clic sur "${word}". Attente de disparition...`);
        const overlayGone = await waitForOverlayToDisappear(page, 5000);
        if (!overlayGone) {
            logger.error(`[${sessionId}] Clic sur "${word}" bloqué par overlay persistant. Action annulée.`);
            return false;
        }
        logger.info(`[${sessionId}] Overlay disparu, reprise du clic sur "${word}".`);
    }

    // 1. Essayer toutes les variantes du mot complet
    for (const variant of uniqueVariants) {
        let locator = page.locator(selectors.pointAndClickSpan, { hasText: variant });
        let count = await locator.count();
        if (count > 0) {
            logger.info(`[${sessionId}] Mot (variante) "${variant}" trouvé. Clic.`);
            await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);

            // Vérification overlay juste avant le clic
            if (await isOverlayBlocking(page)) {
            }
            // Désactiver temporairement les overlays userClickOk qui interceptent les clics
            await page.evaluate(() => {
                document.querySelectorAll('.userClick.userClickOk').forEach(el => el.style.pointerEvents = 'none');
            });
            // Vérification overlay juste avant le clic
            if (await isOverlayBlocking(page)) {
                logger.warn(`[${sessionId}] Overlay bloquant détecté juste avant le clic sur "${variant}". Attente de disparition...`);
                const overlayGone = await waitForOverlayToDisappear(page, 5000);
                if (!overlayGone) {
                    logger.error(`[${sessionId}] Clic sur "${variant}" bloqué par overlay persistant (étape mot complet). Action annulée.`);
                    return false;
                }
                logger.info(`[${sessionId}] Overlay disparu, reprise du clic sur "${variant}".`);
            }

            try {
                const elHandle = await locator.first().elementHandle();
                if (elHandle) {
                    const box = await elHandle.boundingBox();
                    if (box) {
                        // Décalage aléatoire à l'intérieur du mot (évite les bords)
                        const offsetX = Math.floor(box.width * (0.15 + 0.7 * Math.random()));
                        const offsetY = Math.floor(box.height * (0.25 + 0.5 * Math.random()));
                        await locator.first().click({
                            timeout: 5000,
                            position: { x: offsetX, y: offsetY }
                        });
                        logger.info(`[${sessionId}] Clic "humain" réussi sur la variante "${variant}" à x=${offsetX}, y=${offsetY}.`);
                        return true;
                    }
                }
                // Fallback si boundingBox échoue
                await locator.first().click({ timeout: 5000 });
                logger.info(`[${sessionId}] Clic réussi (fallback centre) sur la variante "${variant}".`);
                return true;
            } catch (clickError) {
                logger.error(`[${sessionId}] Erreur lors du clic sur la variante "${variant}": ${clickError.message}`);
                await logWordNotFoundContext(page, variant, sessionId, locator);
                // On continue avec les autres variantes
            }
        }
    }

    // 2. Fallback : tenter le clic sur le mot sans ponctuation finale (toutes variantes)
    const wordStripped = stripTrailingPunctuation(word);
    if (wordStripped !== word && wordStripped.length > 0) {
        for (const variant of uniqueVariants) {
            const strippedVariant = stripTrailingPunctuation(variant);
            let locator = page.locator(selectors.pointAndClickSpan, { hasText: strippedVariant });
            let count = await locator.count();
            if (count > 0) {
                await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                try {
                    const elHandle = await locator.first().elementHandle();
                    if (elHandle) {
                        const box = await elHandle.boundingBox();
                        if (box) {
                            const offsetX = Math.floor(box.width * (0.15 + 0.7 * Math.random()));
                            const offsetY = Math.floor(box.height * (0.25 + 0.5 * Math.random()));
                            await locator.first().click({
                                timeout: 5000,
                                position: { x: offsetX, y: offsetY }
                            });
                            logger.info(`[${sessionId}] Clic "humain" réussi sur la variante fallback "${strippedVariant}" à x=${offsetX}, y=${offsetY}.`);
                            return true;
                        }
                    }
                    // Fallback si boundingBox échoue
                    await locator.first().click({ timeout: 5000 });
                    logger.info(`[${sessionId}] Clic réussi (fallback centre) sur la variante fallback "${strippedVariant}".`);
                    return true;
                } catch (clickError) {
                    logger.error(`[${sessionId}] Erreur lors du clic sur la variante fallback "${strippedVariant}": ${clickError.message}`);
                    await logWordNotFoundContext(page, strippedVariant, sessionId, locator);
                    // On continue avec les autres variantes
                }
            }
        }
    }

    // 3. Si le mot complet et le fallback échouent, segmentation intelligente et clic séquentiel (sur variantes normalisées)
    const parts = segmentWordForClick(word);
    logger.debug(`[${sessionId}] Mot complet "${word}" non trouvé. Décomposition intelligente en parties: ${JSON.stringify(parts)}`);

    if (parts.length <= 1) {
        logger.error(`[${sessionId}] Échec du clic: Mot "${word}" non trouvé et non décomposable en plusieurs parties pertinentes.`);
        await logWordNotFoundContext(page, word, sessionId, page.locator(selectors.pointAndClickSpan));
        return false;
    }

    logger.info(`[${sessionId}] Tentative de clic séquentiel sur les parties: ${parts.join(' -> ')}`);
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const partVariants = [
            part,
            normalize(part),
            normalize(part).replace(/'/g, "’"),
            normalize(part).replace(/'/g, "’").replace(/ /g, ''),
            normalize(part).replace(/'/g, "’").replace(/ /g, '-'),
            normalize(part).replace(/'/g, "’").replace(/ /g, '\u00A0'),
        ];
        const uniquePartVariants = [...new Set(partVariants)];
    
        let found = false;
        for (const variant of uniquePartVariants) {
            let locator = page.locator(selectors.pointAndClickSpan, { hasText: variant });
            let count = await locator.count();
            if (count > 0) {
                // Vérification visibilité et interception (déjà validé ou masqué)
                const elHandle = await locator.first().elementHandle();
                if (elHandle) {
                    // Vérifie si l'élément est visible
                    const isVisible = await locator.first().isVisible().catch(() => false);
                    if (!isVisible) continue;
    
                    // Vérifie si l'élément ou un parent proche a la classe userClickOk (déjà validé)
                    const hasUserClickOk = await elHandle.evaluate((el) => {
                        let node = el;
                        for (let depth = 0; node && depth < 3; depth++) {
                            if (node.classList && node.classList.contains('userClickOk')) return true;
                            node = node.parentElement;
                        }
                        // Vérifie les frères directs
                        if (el.parentElement) {
                            for (const sibling of el.parentElement.children) {
                                if (sibling !== el && sibling.classList && sibling.classList.contains('userClickOk')) return true;
                            }
                        }
                        return false;
                    });
                    if (hasUserClickOk) {
                        logger.debug(`[${sessionId}] Partie "${variant}" ignorée car déjà validée (userClickOk).`);
                        continue;
                    }
    
                    logger.info(`[${sessionId}] Partie (variante) "${variant}" trouvée et cliquable. Clic.`);
                    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    
                    // Vérification overlay juste avant le clic
                    if (await isOverlayBlocking(page)) {
                        logger.warn(`[${sessionId}] Overlay bloquant détecté juste avant le clic sur la partie "${variant}" (n°${i + 1}). Attente de disparition...`);
                        const overlayGone = await waitForOverlayToDisappear(page, 5000);
                        if (!overlayGone) {
                            logger.error(`[${sessionId}] Clic sur la partie "${variant}" (n°${i + 1}) bloqué par overlay persistant (étape partie). Action annulée.`);
                            return false;
                        }
                        logger.info(`[${sessionId}] Overlay disparu, reprise du clic sur la partie "${variant}" (n°${i + 1}).`);
                    }
    
                    try {
                        const box = await elHandle.boundingBox();
                        if (box) {
                            const offsetX = Math.floor(box.width * (0.15 + 0.7 * Math.random()));
                            const offsetY = Math.floor(box.height * (0.25 + 0.5 * Math.random()));
                            await locator.first().click({
                                timeout: 5000,
                                position: { x: offsetX, y: offsetY }
                            });
                            logger.debug(`[${sessionId}] Clic "humain" sur partie "${variant}" réussi à x=${offsetX}, y=${offsetY}.`);
                            found = true;
                            break;
                        }
                        // Fallback si boundingBox échoue
                        await locator.first().click({ timeout: 5000 });
                        logger.debug(`[${sessionId}] Clic sur partie "${variant}" réussi (fallback centre).`);
                        found = true;
                        break;
                    } catch (clickError) {
                        logger.error(`[${sessionId}] Erreur lors du clic sur la partie "${variant}" (n°${i + 1}): ${clickError.message}`);
                        await logWordNotFoundContext(page, variant, sessionId, locator);
                        // On continue avec les autres variantes
                    }
                }
            }
        }
        if (!found) {
            logger.warn(`[${sessionId}] Partie "${part}" (n°${i + 1}) ignorée car non cliquable (invisible, déjà validée ou absente).`);
            // On ne retourne plus d'erreur ici, on continue avec les autres parties
            continue;
        }
    }

    logger.info(`[${sessionId}] Toutes les parties pertinentes de "${word}" ont été cliquées avec succès.`);
    return true;
}

/**
 * Helper pour cliquer sur un bouton par sélecteur.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} description
 * @param {string} sessionId Pour le logging
 */
async function clickButton(page, selector, description, sessionId) {
    try {
        const button = page.locator(selector);
        await randomDelay(5000, 10000);
        await button.click({ timeout: 5000 });
        // logger.info(`[${sessionId}] Clic réussi sur le bouton "${description}".`);
        return true;
    } catch (err) {
        logger.error(`[${sessionId}] Échec du clic sur le bouton "${description}": ${err.message}`);
        return false;
    }
}

/**
 * Gère une erreur d'automatisation en demandant une suggestion à l'IA et en tentant une action.
 * @param {import('playwright').Page} page L'objet Page Playwright.
 * @param {string} sessionId L'identifiant de la session.
 * @param {Error} error L'erreur capturée.
 * @param {string} contextDescription Description de l'étape où l'erreur s'est produite.
 * @returns {Promise<{attemptedAction: boolean, restartRequired: boolean}>}
 */
async function handleAutomationError(page, sessionId, error, contextDescription) {
    // Validation stricte des paramètres
    if (!page || typeof page !== 'object' || typeof page.locator !== 'function' || typeof page.isClosed !== 'function') {
        logger && logger.error && logger.error(`[solver_engine] handleAutomationError: paramètre page invalide.`);
        throw new Error(`[solver_engine] handleAutomationError: paramètre page invalide.`);
    }
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
        logger && logger.error && logger.error(`[solver_engine] handleAutomationError: sessionId invalide: ${sessionId}`);
        throw new Error(`[solver_engine] handleAutomationError: sessionId doit être une string non vide.`);
    }
    if (!(error instanceof Error)) {
        logger && logger.error && logger.error(`[solver_engine] handleAutomationError: error n'est pas une instance de Error.`);
        throw new Error(`[solver_engine] handleAutomationError: error doit être une instance de Error.`);
    }
    if (typeof contextDescription !== 'string' || !contextDescription.trim()) {
        logger && logger.error && logger.error(`[solver_engine] handleAutomationError: contextDescription invalide.`);
        throw new Error(`[solver_engine] handleAutomationError: contextDescription doit être une string non vide.`);
    }

    logger.error(`[${sessionId}] [ErrorAssist] Erreur détectée (${contextDescription}): ${error.message}`);

    try {
        if (page.isClosed()) {
            logger.error(`[${sessionId}] [ErrorAssist] La page est déjà fermée. Impossible de tenter une récupération.`);
            return { attemptedAction: false, restartRequired: true };
        }

        let screenshotBase64 = null;
        let currentUrl = 'N/A';
        try {
            currentUrl = page.url();
            screenshotBase64 = await page.screenshot({ encoding: 'base64', timeout: 5000 });
        } catch (captureError) {
            logger.error(`[${sessionId}] [ErrorAssist] Échec de la capture d'écran ou de l'URL: ${captureError.message}`);
        }

        const suggestionResult = await getErrorReportSuggestion(error.message, currentUrl, sessionId, screenshotBase64);

        if (!suggestionResult.success || !suggestionResult.suggestion || suggestionResult.suggestion === 'AUCUNE_ACTION') {
            logger.error(`[${sessionId}] [ErrorAssist] Échec de l'obtention d'une suggestion IA ou aucune action suggérée. Erreur IA: ${suggestionResult.error || 'N/A'}. Arrêt de la session demandé.`);
            return { attemptedAction: false, restartRequired: true };
        }
        if (suggestionResult.suggestion.action === "restart_browser") {
            logger.warn(`[${sessionId}] [ErrorAssist] 3x "no_action" consécutifs : demande explicite de relance du navigateur.`);
            return { attemptedAction: false, restartRequired: true };
        }

        const suggestion = suggestionResult.suggestion;
        let elementLocator = null;
        let locatedBy = '';

        // 1. Essayer de localiser par texte visible exact
        try {
            const escapedSuggestion = suggestion.replace(/["']/g, '\\$&');
            const textLocator = page.locator(`:text-is("${escapedSuggestion}")`);
            if (await textLocator.count() > 0 && await textLocator.first().isVisible()) {
                elementLocator = textLocator.first();
                locatedBy = `texte visible "${suggestion}"`;
            }
        } catch (textLocateError) {
            logger.error(`[${sessionId}] [ErrorAssist] Échec localisation par texte visible: ${textLocateError.message}`);
        }

        // 2. Si non trouvé par texte, essayer comme sélecteur CSS
        if (!elementLocator && !suggestion.startsWith(':text-is')) {
            try {
                const cssLocator = page.locator(suggestion);
                if (await cssLocator.count() > 0 && await cssLocator.first().isVisible()) {
                    elementLocator = cssLocator.first();
                    locatedBy = `sélecteur CSS "${suggestion}"`;
                }
            } catch (cssLocateError) {
                logger.error(`[${sessionId}] [ErrorAssist] Échec localisation par sélecteur CSS "${suggestion}": ${cssLocateError.message}`);
            }
        }

        if (elementLocator) {
            try {
                await elementLocator.click({ timeout: 7000 });
                return { attemptedAction: true, restartRequired: false };
            } catch (clickError) {
                logger.error(`[${sessionId}] [ErrorAssist] Échec du clic sur l'élément suggéré (${locatedBy}): ${clickError.message}. Arrêt de la session demandé.`);
                return { attemptedAction: false, restartRequired: true };
            }
        } else {
            logger.error(`[${sessionId}] [ErrorAssist] Impossible de localiser l'élément suggéré "${suggestion}" (ni par texte, ni par sélecteur CSS). Arrêt de la session demandé.`);
            return { attemptedAction: false, restartRequired: true };
        }
    } catch (e) {
        logger && logger.error && logger.error(`[solver_engine] handleAutomationError: exception inattendue: ${e.message}`);
        throw e;
    }
}

/**
 * Tente de résoudre un seul exercice affiché sur la page Playwright.
 * @param {import('playwright').Page} page
 * @param {string} sessionId Pour le logging et potentiellement passer aux sous-fonctions
 * @returns {Promise<{success: boolean, error?: string, exerciseComplete?: boolean, restartBrowser?: boolean}>}
 */
/**
 * Résolution d'un exercice protégée par sémaphore global (parallélisme) et mutex de session (exclusivité session).
 */
export async function solveSingleExercise(page, sessionId, options = {}) {
     // 0. Erreur simulée aléatoire
     // 0. Simulation d’erreur aléatoire : ne doit pas interrompre brutalement la session
     try {
       maybeThrowError(config.FAULT_PROBABILITY * 100, new AppError('Erreur simulée par faultProbability'));
     } catch (err) {
       if (err instanceof AppError) {
         logger.warn(`[${sessionId}] Simulation d’erreur interceptée : ${err.message}`);
         // Retourne un échec contrôlé sans redémarrer le navigateur
         return { success: false, error: err.message, restartBrowser: false };
       }
       throw err;
     }
     // --- VALIDATION DES PARAMÈTRES ---
    if (!page || typeof page !== 'object' || typeof page.locator !== 'function' || typeof page.isClosed !== 'function') {
        throw new Error(`[solver_engine] solveSingleExercise: paramètre page invalide (doit être un objet Playwright Page).`);
    }
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw new Error(`[solver_engine] solveSingleExercise: sessionId doit être une string non vide.`);
    }
    logger && logger.info && logger.info(`[solver_engine] Entrée dans solveSingleExercise pour sessionId=${sessionId}`);

    // --- VALIDATION DES DELAIS ---
    try {
        validateActionDelays(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    } catch (e) {
        logger && logger.error && logger.error(`[solver_engine] solveSingleExercise: delays invalides: ${e.message}`);
        throw e;
    }

    // maxAttempts configurable
    const maxAttempts = (options && typeof options.maxAttempts === 'number' && options.maxAttempts > 0) ? options.maxAttempts : 5;
    assert(Number.isInteger(maxAttempts) && maxAttempts > 0, `[solver_engine] maxAttempts doit être un entier > 0`);

    // Limitation du nombre d'exercices résolus en parallèle
    return await solveSemaphore.runExclusive(async () => {
        // Protection de la session par mutex pour éviter l'accès concurrent à la même session
        const sessionMutex = getSessionMutex(sessionId);
        assert(sessionMutex instanceof Mutex, `[solver_engine] Mutex de session non valide pour sessionId=${sessionId}`);
        logger && logger.debug && logger.debug(`[solver_engine] Mutex de session acquis pour sessionId=${sessionId}`);
        return await sessionMutex.runExclusive(async () => {
            logger && logger.info && logger.info(`[solver_engine] Mutex exclusif acquis pour sessionId=${sessionId}`);
            let timers = [];
            try {
                // 1. Parsing de l'exercice (with ElementNotFoundError handling)
                logger.debug(`[${sessionId}] Parsing de l'exercice en cours...`);
                let exerciseData;
                try {
                    exerciseData = await parseExercise(page); // Can throw ElementNotFoundError

                    // Check result *after* successful parsing (if it didn't throw)
                    if (!exerciseData.success) {
                        logger.error(`[${sessionId}] Échec du parsing de l'exercice (returned failure): ${exerciseData.error}`);
                        // Attempt AI assistance before giving up on non-throwing parse failures
                        const errorResult = await handleAutomationError(page, sessionId, new Error(exerciseData.error), "Parsing de l'exercice (returned failure)");
                        if (errorResult.restartRequired) {
                            return { success: false, error: `Parsing failed (returned failure) and error assistance requires restart: ${exerciseData.error}`, restartBrowser: true };
                        }
                        logger.error(`[${sessionId}] Assistance IA attempted action after parsing returned failure, but parsing is not retried. Considered failure.`);
                        return { success: false, error: `Parsing failed (returned failure): ${exerciseData.error}` };
                    }
                    logger.debug(`[${sessionId}] Données extraites: ${JSON.stringify(exerciseData.data)}`);

                } catch (error) {
                    // Log initial pour toutes les erreurs interceptées ici
                    logger.error(`[${sessionId}] Erreur interceptée dans solveSingleExercise (parsing): Name=${error.name}, Message=${error.message}`, error);
                    // La gestion du redémarrage sur timeout .sentence est désormais assurée dans la boucle principale.
                    // Ici, on log simplement l'erreur et on retourne un échec.
                    return { success: false, error: error.message };
                }
                // If parsing succeeded (either initially or after non-throwing error + assistance), exerciseData is available here.

                // 2. Délai humain avant l'appel IA
                try {
                    validateActionDelays(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                    const delay = await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                    assert(typeof delay === 'number' && !isNaN(delay) && delay >= MIN_ACTION_DELAY && delay <= MAX_ACTION_DELAY, `[solver_engine] randomDelay a retourné une valeur incohérente: ${delay}`);
                    logger && logger.debug && logger.debug(`[${sessionId}] Délai humanisé appliqué: ${delay}ms`);
                } catch (e) {
                    logger && logger.error && logger.error(`[${sessionId}] Erreur lors du délai humanisé: ${e.message}`);
                    throw e;
                }

                // 3. Appel OpenAI pour la correction
                const prompt = `Analyse l'exercice suivant et fournis l'action JSON (type: 'click_word', 'select_option', 'validate_rule', 'no_mistake', etc. et 'value' ou 'rule_id' si applicable). Si aucune faute n'est détectée, utilise l'action 'no_mistake': ${exerciseData.data.question}`;
                let correctionResult;
                try {
                    correctionResult = await getCorrection(prompt);
                } catch (e) {
                    logger && logger.error && logger.error(`[${sessionId}] Erreur lors de l'appel à getCorrection: ${e.message}`);
                    throw e;
                }
                if (!correctionResult || !correctionResult.success) {
                    const errorMsg = `Failed to get valid correction from OpenAI: ${correctionResult?.error || 'Unknown error'}`;
                    logger.error(`[${sessionId}] ${errorMsg}`);
                    // Tentative d'assistance IA
                    const errorResult = await handleAutomationError(page, sessionId, new Error(errorMsg), "Obtention correction OpenAI");
                    if (errorResult.restartRequired) {
                        return { success: false, error: `Failed to get correction and error assistance failed or requires restart: ${errorMsg}`, restartBrowser: true };
                    }
                    logger.error(`[${sessionId}] Assistance IA a tenté une action après échec obtention correction. Considéré comme échec.`);
                    return { success: false, error: errorMsg };
                }

                const correctionData = correctionResult.data;
                if (!correctionData || typeof correctionData !== 'object' || !correctionData.action) {
                    const errorMsg = 'OpenAI response data is invalid or missing "action" field.';
                    logger.error(`[${sessionId}] ${errorMsg}`, { dataReceived: correctionData });
                    // Tentative d'assistance IA
                    const errorResult = await handleAutomationError(page, sessionId, new Error(errorMsg), "Validation réponse OpenAI");
                    if (errorResult.restartRequired) {
                        return { success: false, error: `Invalid OpenAI response and error assistance failed or requires restart: ${errorMsg}`, restartBrowser: true };
                    }
                    logger.error(`[${sessionId}] Assistance IA a tenté une action après réponse OpenAI invalide. Considéré comme échec.`);
                    return { success: false, error: errorMsg };
                }

                logger && logger.info && logger.info(`[${sessionId}] Correction reçue: Action=${correctionData.action}, Value=${correctionData.value || 'N/A'}, RuleID=${correctionData.rule_id || 'N/A'}`);

                // 4. Appliquer la correction
                const action = correctionData.action.toLowerCase();
                let actionSuccess = false;

                switch (action) {
                    case 'click_word':
                        if (!correctionData.value) {
                            logger.error(`[${sessionId}] Action 'click_word' reçue sans 'value'.`);
                            return { success: false, error: 'AI correction action "click_word" missing value' };
                        }
                        try {
                            validateActionDelays(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                            const delay = await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                            assert(typeof delay === 'number' && !isNaN(delay), `[solver_engine] randomDelay a retourné une valeur incohérente: ${delay}`);
                        } catch (e) {
                            logger && logger.error && logger.error(`[${sessionId}] Erreur lors du délai humanisé (click_word): ${e.message}`);
                            throw e;
                        }
                        try {
                            const locator = page.locator('div.sentence span.pointAndClickSpan', { hasText: correctionData.value });
                            const count = await locator.count();
                            if (count === 0) {
                                logger.warn(`[${sessionId}] Aucun span.pointAndClickSpan trouvé avec le texte exact "${correctionData.value}". Tentative avec clickWord robuste.`);
                                const clickWordResult = await clickWord(page, correctionData.value, sessionId);
                                if (clickWordResult) {
                                    actionSuccess = true;
                                } else {
                                    throw new Error(`Aucun span.pointAndClickSpan trouvé avec le texte exact "${correctionData.value}" et échec de clickWord robuste`);
                                }
                            } else {
                                await locator.first().click({ timeout: 5000 });
                                actionSuccess = true;
                            }
                        } catch (clickError) {
                            logger.error(`[${sessionId}] Échec du clic direct ou clickWord sur "${correctionData.value}": ${clickError.message}`);
                            const errorResult = await handleAutomationError(page, sessionId, clickError, `Clic direct/clickWord sur "${correctionData.value}"`);
                            if (errorResult.restartRequired) {
                                return { success: false, error: `Failed direct click/clickWord and error assistance failed or requires restart: ${clickError.message}`, restartBrowser: true };
                            }
                            if (errorResult.attemptedAction) {
                                actionSuccess = true;
                            } else {
                                return { success: false, error: `Failed to click on answerWord/clickWord "${correctionData.value}": ${clickError.message}` };
                            }
                        }
                        break;

                    case 'select_option':
                        if (!correctionData.value) {
                            logger.error(`[${sessionId}] Action 'select_option' reçue sans 'value'.`);
                            return { success: false, error: 'AI correction action "select_option" missing value' };
                        }
                        try {
                            validateActionDelays(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                            const delay = await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                            assert(typeof delay === 'number' && !isNaN(delay), `[solver_engine] randomDelay a retourné une valeur incohérente: ${delay}`);
                        } catch (e) {
                            logger && logger.error && logger.error(`[${sessionId}] Erreur lors du délai humanisé (select_option): ${e.message}`);
                            throw e;
                        }
                        try {
                            // Placeholder pour la logique réelle
                            actionSuccess = true; // Simulé pour l'instant
                        } catch (selectError) {
                            logger.error(`[${sessionId}] Échec (simulé) de la sélection de l'option "${correctionData.value}": ${selectError.message}`);
                            const errorResult = await handleAutomationError(page, sessionId, selectError, `Sélection option "${correctionData.value}"`);
                            if (errorResult.restartRequired) {
                                return { success: false, error: `Failed selectOption and error assistance failed or requires restart: ${selectError.message}`, restartBrowser: true };
                            }
                            if (errorResult.attemptedAction) {
                                actionSuccess = true;
                            } else {
                                return { success: false, error: `Failed to select option "${correctionData.value}": ${selectError.message}` };
                            }
                        }
                        break;

                    case 'validate_rule':
                        if (!correctionData.rule_id) {
                            logger.error(`[${sessionId}] Action 'validate_rule' reçue sans 'rule_id'.`);
                            return { success: false, error: 'AI correction action "validate_rule" missing rule_id' };
                        }
                        try {
                            actionSuccess = await clickButton(page, selectors.noMistakeButton, 'valider la règle (pas de faute)', sessionId);
                            if (!actionSuccess) throw new Error('clickButton helper returned false');
                        } catch (validateError) {
                            logger.error(`[${sessionId}] Échec du clic sur le bouton "Pas de faute" pour valider règle: ${validateError.message}`);
                            const errorResult = await handleAutomationError(page, sessionId, validateError, 'Clic bouton "Pas de faute" (validation règle)');
                            if (errorResult.restartRequired) {
                                return { success: false, error: `Failed validate_rule click and error assistance failed or requires restart: ${validateError.message}`, restartBrowser: true };
                            }
                            if (errorResult.attemptedAction) {
                                actionSuccess = true;
                            } else {
                                return { success: false, error: `Failed to click validation/no mistake button: ${validateError.message}` };
                            }
                        }
                        break;

                    case 'no_mistake':
                        try {
                            actionSuccess = await clickButton(page, selectors.noMistakeButton, 'Il n\'y a pas de faute', sessionId);
                            if (!actionSuccess) throw new Error('clickButton helper returned false');
                        } catch (noMistakeError) {
                            logger.error(`[${sessionId}] Échec du clic sur le bouton "Pas de faute": ${noMistakeError.message}`);
                            const errorResult = await handleAutomationError(page, sessionId, noMistakeError, 'Clic bouton "Pas de faute"');
                            if (errorResult.restartRequired) {
                                return { success: false, error: `Failed no_mistake click and error assistance failed or requires restart: ${noMistakeError.message}`, restartBrowser: true };
                            }
                            if (errorResult.attemptedAction) {
                                actionSuccess = true;
                            } else {
                                return { success: false, error: `Failed to click on "No Mistake" button: ${noMistakeError.message}` };
                            }
                        }
                        break;

                    default:
                        logger.error(`[${sessionId}] Action IA non reconnue ou non gérée: ${action}`);
                        return { success: false, error: `Unhandled AI correction action: ${action}` };
                }

                if (!actionSuccess) {
                    logger.error(`[${sessionId}] L'action '${action}' a échoué et n'a pas pu être récupérée par l'assistance.`);
                    return { success: false, error: `Action '${action}' failed and was not recovered by assistance.`, restartBrowser: true };
                }

                // 5. Cliquer sur "Suivant" avec retry (maxAttempts configurable)
                let attempt = 0;
                let clicked = false;
                while (attempt < maxAttempts && !clicked) {
                    try {
                        validateActionDelays(3000, 3000);
                        const delay = await randomDelay(3000, 3000);
                        assert(typeof delay === 'number' && !isNaN(delay), `[solver_engine] randomDelay a retourné une valeur incohérente: ${delay}`);
                    } catch (e) {
                        logger && logger.error && logger.error(`[${sessionId}] Erreur lors du délai humanisé (Suivant): ${e.message}`);
                        throw e;
                    }
                    logger && logger.debug && logger.debug(`[${sessionId}] Tentative n°${attempt + 1} de clic sur "Suivant"`);
                    const nextButtonLocator = page.locator(selectors.nextButton);
                    const isVisible = await nextButtonLocator.isVisible().catch(() => false);
                    const isEnabled = isVisible ? await nextButtonLocator.isEnabled().catch(() => false) : false;

                    if (isVisible && isEnabled) {
                        try {
                            await nextButtonLocator.click({ timeout: 5000 });
                            await page.waitForTimeout(500);
                            clicked = true;
                            logger && logger.info && logger.info(`[${sessionId}] Clic sur "Suivant" réussi à la tentative ${attempt + 1}`);
                        } catch (nextButtonError) {
                            logger.error(`[${sessionId}] Tentative ${attempt + 1}: Clic sur "Suivant" échoué (${nextButtonError.message}).`);
                        }
                    } else {
                        const finishButtonVisible = await page.locator(selectors.finishButton).isVisible().catch(() => false);
                        if (finishButtonVisible) {
                            logger && logger.info && logger.info(`[${sessionId}] Bouton "Terminer" détecté pendant l'attente de "Suivant". Marqué comme exercice terminé.`);
                            return { success: true, exerciseComplete: true };
                        }
                        if (attempt === maxAttempts - 1) {
                            logger.error(`[${sessionId}] Bouton "Suivant" toujours pas cliquable avant la dernière tentative (${maxAttempts}). Tentative d'assistance.`);
                            const errorAssist = await handleAutomationError(page, sessionId, new Error("Bouton Suivant non visible/activé après plusieurs attentes"), "Attente bouton Suivant");
                            if (errorAssist.attemptedAction) {
                                break;
                            }
                            if (errorAssist.restartRequired) {
                                return { success: false, error: "Error assistance requested browser restart while waiting for Next button", restartBrowser: true };
                            }
                        }
                    }
                    attempt++;
                }
                assert(attempt <= maxAttempts, `[solver_engine] Nombre de tentatives de clic sur "Suivant" (${attempt}) dépasse la limite maxAttempts (${maxAttempts})`);
                if (!clicked) {
                    logger.error(`[${sessionId}] Le bouton "Suivant" n'a pas pu être cliqué après ${attempt} tentatives et l'assistance n'a pas résolu.`);
                    const finalError = new Error(`Le bouton "Suivant" n'a pas pu être cliqué après ${attempt} tentatives.`);
                    const finalAssist = await handleAutomationError(page, sessionId, finalError, "Échec final clic bouton Suivant");
                    if (finalAssist.restartRequired) {
                        return { success: false, error: finalError.message + " (Assistance finale a demandé redémarrage)", restartBrowser: true };
                    }
                    return { success: false, error: finalError.message + " (Assistance finale inefficace)", restartBrowser: true };
                }

                logger && logger.info && logger.info(`[${sessionId}] Fin de la tentative de résolution de l'étape.`);
                return { success: true, exerciseComplete: false };

            } catch (error) {
                logger.error(`[${sessionId}] Erreur inattendue durant solveSingleExercise: ${error.message}`, { stack: error.stack });
                const errorResult = await handleAutomationError(page, sessionId, error, "Erreur inattendue (catch global)");
                return { success: false, error: `Unexpected error: ${error.message}`, restartBrowser: true };
            } finally {
                // Nettoyage des timers éventuels (aucun setTimeout explicite ici, mais on documente la garantie)
                timers.forEach(timerId => clearTimeout(timerId));
                logger && logger.debug && logger.debug(`[${sessionId}] Nettoyage des timers terminé.`);
            }
        });
    });
}
