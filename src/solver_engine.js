import logger from './logger.js';
import { parseExercise } from './exercise_parser.js';
import { getCorrection, getErrorReportSuggestion } from './openai_client.js';
import { randomDelay } from './human_simulator.js';
import { config } from './config_loader.js';
import selectors from './selectors.js'; // Correction : centralisation des sélecteurs
import { Semaphore, Mutex } from './async_utils.js'; // Ajout pour la gestion de la concurrence
 
const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY;
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY;
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
    if (!sessionMutexMap.has(sessionId)) {
        sessionMutexMap.set(sessionId, new Mutex());
    }
    return sessionMutexMap.get(sessionId);
}

/**
 * Helper pour cliquer sur un mot dans la phrase.
 * @param {import('playwright').Page} page
 * @param {string} word
 * @param {string} sessionId Pour le logging
 */
async function clickWord(page, word, sessionId) {
    // Décompose le mot pour gérer les mots composés
    const wordParts = word.split(/[\s\-‑]/);
    // logger.debug(`[${sessionId}] Mot décomposé en parties: ${JSON.stringify(wordParts)}`);
 
    // Essaye avec le mot complet
    let locator = page.locator(selectors.pointAndClickSpan, { hasText: word });
    let found = await locator.count() > 0;
 
    // Sinon, essaye avec la première partie
    if (!found && wordParts.length > 1) {
        const firstPart = wordParts[0];
        // logger.info(`[${sessionId}] Mot composé non trouvé directement, tentative avec la première partie: "${firstPart}"`);
        locator = page.locator(selectors.pointAndClickSpan, { hasText: firstPart });
        found = await locator.count() > 0;
    }
 
    if (found) {
        if (Math.random() < 0.1) {
            await randomDelay(10000, 13000);
        } else {
            await randomDelay(5000, 7000);
        }
        await locator.first().click({ timeout: 5000 });
        // logger.info(`[${sessionId}] Clic réussi sur le mot ou sa première partie`);
        return true;
    }
    return false;
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
    logger.error(`[${sessionId}] [ErrorAssist] Erreur détectée (${contextDescription}): ${error.message}`);

    if (page.isClosed()) {
        logger.error(`[${sessionId}] [ErrorAssist] La page est déjà fermée. Impossible de tenter une récupération.`);
        return { attemptedAction: false, restartRequired: true };
    }

    let screenshotBase64 = null;
    let currentUrl = 'N/A';
    try {
        currentUrl = page.url();
        screenshotBase64 = await page.screenshot({ encoding: 'base64', timeout: 5000 });
        // logger.debug(`[${sessionId}] [ErrorAssist] Capture d'écran réalisée pour l'analyse.`);
    } catch (captureError) {
        logger.error(`[${sessionId}] [ErrorAssist] Échec de la capture d'écran ou de l'URL: ${captureError.message}`);
        // Continuer sans screenshot si la capture échoue
    }

    const suggestionResult = await getErrorReportSuggestion(error.message, currentUrl, sessionId, screenshotBase64);

    if (!suggestionResult.success || !suggestionResult.suggestion || suggestionResult.suggestion === 'AUCUNE_ACTION') {
        logger.error(`[${sessionId}] [ErrorAssist] Échec de l'obtention d'une suggestion IA ou aucune action suggérée. Erreur IA: ${suggestionResult.error || 'N/A'}. Arrêt de la session demandé.`);
        return { attemptedAction: false, restartRequired: true };
    }

    const suggestion = suggestionResult.suggestion;
    // logger.info(`[${sessionId}] [ErrorAssist] Suggestion IA reçue: "${suggestion}"`);

    let elementLocator = null;
    let locatedBy = '';

    // 1. Essayer de localiser par texte visible exact
    try {
        // Échapper les guillemets simples et doubles pour le sélecteur :text-is()
        const escapedSuggestion = suggestion.replace(/["']/g, '\\$&');
        const textLocator = page.locator(`:text-is("${escapedSuggestion}")`);
        if (await textLocator.count() > 0 && await textLocator.first().isVisible()) {
            elementLocator = textLocator.first();
            locatedBy = `texte visible "${suggestion}"`;
            // logger.info(`[${sessionId}] [ErrorAssist] Élément localisé par ${locatedBy}`);
        }
    } catch (textLocateError) {
        // logger.debug(`[${sessionId}] [ErrorAssist] Échec localisation par texte visible: ${textLocateError.message}`);
    }

    // 2. Si non trouvé par texte, essayer comme sélecteur CSS (si ce n'est pas la même chose que le texte)
    if (!elementLocator && !suggestion.startsWith(':text-is')) { // Évite de retester si la suggestion est déjà un sélecteur texte
        try {
            const cssLocator = page.locator(suggestion);
             // Vérifier si l'élément existe et est visible avant de le considérer comme trouvé
            if (await cssLocator.count() > 0 && await cssLocator.first().isVisible()) {
                elementLocator = cssLocator.first();
                locatedBy = `sélecteur CSS "${suggestion}"`;
                // logger.info(`[${sessionId}] [ErrorAssist] Élément localisé par ${locatedBy}`);
            } else {
                 // logger.info(`[${sessionId}] [ErrorAssist] Sélecteur CSS "${suggestion}" trouvé mais non visible ou multiple.`);
            }
        } catch (cssLocateError) {
            logger.error(`[${sessionId}] [ErrorAssist] Échec localisation par sélecteur CSS "${suggestion}": ${cssLocateError.message} (Probablement un sélecteur invalide ou non unique)`);
        }
    }

    if (elementLocator) {
        // logger.info(`[${sessionId}] [ErrorAssist] Tentative de clic sur l'élément suggéré localisé par ${locatedBy}.`);
        try {
            await elementLocator.click({ timeout: 7000 }); // Augmentation légère du timeout pour l'action corrective
            // logger.info(`[${sessionId}] [ErrorAssist] Clic sur l'élément suggéré réussi.`);
            return { attemptedAction: true, restartRequired: false };
        } catch (clickError) {
            logger.error(`[${sessionId}] [ErrorAssist] Échec du clic sur l'élément suggéré (${locatedBy}): ${clickError.message}. Arrêt de la session demandé.`);
            return { attemptedAction: false, restartRequired: true };
        }
    } else {
        logger.error(`[${sessionId}] [ErrorAssist] Impossible de localiser l'élément suggéré "${suggestion}" (ni par texte, ni par sélecteur CSS). Arrêt de la session demandé.`);
        return { attemptedAction: false, restartRequired: true };
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
export async function solveSingleExercise(page, sessionId) {
    // Limitation du nombre d'exercices résolus en parallèle
    return await solveSemaphore.runExclusive(async () => {
        // Protection de la session par mutex pour éviter l'accès concurrent à la même session
        const sessionMutex = getSessionMutex(sessionId);
        return await sessionMutex.runExclusive(async () => {
            // logger.info(`[${sessionId}] Tentative de résolution d'un exercice...`);

            try {
                // 1. Parsing de l'exercice
                // logger.debug(`[${sessionId}] Parsing de l'exercice en cours...`);
                // TODO: Passer sessionId à parseExercise si nécessaire pour son logging interne
                const exerciseData = await parseExercise(page);
                // ... (reste du code inchangé)
        if (!exerciseData.success) {
            logger.error(`[${sessionId}] Échec du parsing de l'exercice: ${exerciseData.error}`);
            // Tentative d'assistance IA avant d'abandonner
            const errorResult = await handleAutomationError(page, sessionId, new Error(exerciseData.error), "Parsing de l'exercice");
            if (errorResult.restartRequired) {
                return { success: false, error: `Parsing failed and error assistance failed or requires restart: ${exerciseData.error}`, restartBrowser: true };
            }
            // Si une action a été tentée, on pourrait retenter le parsing, mais pour l'instant on considère l'étape échouée mais récupérable
            logger.error(`[${sessionId}] Assistance IA a tenté une action après échec parsing, mais le parsing n'est pas retenté. Considéré comme échec.`);
            return { success: false, error: `Parsing failed: ${exerciseData.error}` };
        }
        // logger.debug(`[${sessionId}] Données extraites: ${JSON.stringify(exerciseData.data)}`);

        // 2. Délai humain avant l'appel IA
        // logger.debug(`[${sessionId}] Délai avant appel OpenAI...`);
        await randomDelay(5000, 10000);

        // 3. Appel OpenAI pour la correction
        const prompt = `Analyse l'exercice suivant et fournis l'action JSON (type: 'click_word', 'select_option', 'validate_rule', 'no_mistake', etc. et 'value' ou 'rule_id' si applicable). Si aucune faute n'est détectée, utilise l'action 'no_mistake': ${exerciseData.data.question}`;
        // logger.debug(`[${sessionId}] Prompt OpenAI: ${prompt}`);

        // TODO: Passer sessionId à getCorrection si nécessaire pour son logging interne
        const correctionResult = await getCorrection(prompt);
        // logger.debug(`[${sessionId}] Résultat OpenAI brut: ${JSON.stringify(correctionResult)}`);

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

        // logger.info(`[${sessionId}] Correction reçue: Action=${correctionData.action}, Value=${correctionData.value || 'N/A'}, RuleID=${correctionData.rule_id || 'N/A'}`);
        // logger.debug(`[${sessionId}] Correction complète: ${JSON.stringify(correctionData)}`);

        // 4. Appliquer la correction
        const action = correctionData.action.toLowerCase();
        let actionSuccess = false;

        switch (action) {
            case 'click_word':
                case 'click_word':
                    if (!correctionData.value) {
                        logger.error(`[${sessionId}] Action 'click_word' reçue sans 'value'.`);
                        logger.error(`[${sessionId}] Action 'click_word' reçue sans 'value'.`);
                        // Pas d'assistance ici, c'est une erreur logique de l'IA de correction
                        return { success: false, error: 'AI correction action "click_word" missing value' };
                    }
                    await randomDelay(5000, 10000);
                    // logger.info(`[${sessionId}] Tentative de clic sur le mot: "${correctionData.value}"`);
                    try {
                        actionSuccess = await clickWord(page, correctionData.value, sessionId);
                        if (!actionSuccess) {
                             throw new Error(`Aucune correspondance trouvée pour le mot "${correctionData.value}" ni sa première partie`);
                        }
                    } catch (clickError) {
                         logger.error(`[${sessionId}] Échec initial du clic sur le mot "${correctionData.value}": ${clickError.message}`);
                         // Tentative d'assistance IA
                         const errorResult = await handleAutomationError(page, sessionId, clickError, `Clic sur mot "${correctionData.value}"`);
                         if (errorResult.restartRequired) {
                             return { success: false, error: `Failed clickWord and error assistance failed or requires restart: ${clickError.message}`, restartBrowser: true };
                         }
                         if (errorResult.attemptedAction) {
                             // logger.info(`[${sessionId}] Assistance IA a tenté une action après échec clickWord. On considère l'action comme potentiellement réussie.`);
                             actionSuccess = true; // Marquer comme succès si l'assistance a agi
                         } else {
                             // Si l'assistance n'a rien fait et n'a pas demandé de redémarrage (improbable mais possible), on retourne l'échec.
                             return { success: false, error: `Failed to click on word "${correctionData.value}": ${clickError.message}` };
                         }
                    }
                    break;
    
                case 'select_option':
                    if (!correctionData.value) {
                        logger.error(`[${sessionId}] Action 'select_option' reçue sans 'value'.`);
                         logger.error(`[${sessionId}] Action 'select_option' reçue sans 'value'.`);
                        // Pas d'assistance ici, c'est une erreur logique de l'IA de correction
                        return { success: false, error: 'AI correction action "select_option" missing value' };
                    }
                    // logger.info(`[${sessionId}] [SIMULATION] Sélection de l'option: ${correctionData.value}`);
                    // TODO: Implémenter la logique de sélection réelle et ajouter gestion d'erreur + assistance
                    try {
                        // Placeholder pour la logique réelle
                        await randomDelay(5000, 10000);
                        actionSuccess = true; // Simulé pour l'instant
                    } catch (selectError) {
                        logger.error(`[${sessionId}] Échec (simulé) de la sélection de l'option "${correctionData.value}": ${selectError.message}`);
                        const errorResult = await handleAutomationError(page, sessionId, selectError, `Sélection option "${correctionData.value}"`);
                        if (errorResult.restartRequired) {
                             return { success: false, error: `Failed selectOption and error assistance failed or requires restart: ${selectError.message}`, restartBrowser: true };
                         }
                         if (errorResult.attemptedAction) {
                             // logger.info(`[${sessionId}] Assistance IA a tenté une action après échec selectOption. On considère l'action comme potentiellement réussie.`);
                             actionSuccess = true;
                         } else {
                             return { success: false, error: `Failed to select option "${correctionData.value}": ${selectError.message}` };
                         }
                    }
                    break;
    
                case 'validate_rule':
                    if (!correctionData.rule_id) {
                        logger.error(`[${sessionId}] Action 'validate_rule' reçue sans 'rule_id'.`);
                         logger.error(`[${sessionId}] Action 'validate_rule' reçue sans 'rule_id'.`);
                         // Pas d'assistance ici, c'est une erreur logique de l'IA de correction
                        return { success: false, error: 'AI correction action "validate_rule" missing rule_id' };
                    }
                    // logger.info(`[${sessionId}] Validation de la règle: ${correctionData.rule_id}. Tentative de clic sur le bouton "Il n'y a pas de faute".`);
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
                             // logger.info(`[${sessionId}] Assistance IA a tenté une action après échec clic validation. On considère l'action comme potentiellement réussie.`);
                             actionSuccess = true;
                         } else {
                            return { success: false, error: `Failed to click validation/no mistake button: ${validateError.message}` };
                         }
                    }
                    break;
    
                case 'no_mistake':
                    // logger.info(`[${sessionId}] Clic sur le bouton "Il n'y a pas de faute".`);
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
                             // logger.info(`[${sessionId}] Assistance IA a tenté une action après échec clic "Pas de faute". On considère l'action comme potentiellement réussie.`);
                             actionSuccess = true;
                         } else {
                             return { success: false, error: `Failed to click on "No Mistake" button: ${noMistakeError.message}` };
                         }
                    }
                    break;
    
                default:
                    logger.error(`[${sessionId}] Action IA non reconnue ou non gérée: ${action}`);
                    logger.error(`[${sessionId}] Action IA de correction non reconnue ou non gérée: ${action}`);
                     // Pas d'assistance ici, c'est une erreur logique de l'IA de correction
                    return { success: false, error: `Unhandled AI correction action: ${action}` };
            }

            // Si actionSuccess est false ici, cela signifie qu'une erreur s'est produite ET que l'assistance n'a pas réussi ou a demandé un redémarrage (géré dans les catch)
            // Ou que l'assistance a réussi mais on a décidé de ne pas marquer actionSuccess = true (ce qui ne devrait pas arriver avec le code actuel)
            // Donc, si on arrive ici et actionSuccess est false, c'est une situation d'échec non récupérée.
            if (!actionSuccess) {
                 logger.error(`[${sessionId}] L'action '${action}' a échoué et n'a pas pu être récupérée par l'assistance.`);
                 // Le retour d'erreur/redémarrage a déjà été fait dans les blocs catch + handleAutomationError
                 // On ne devrait techniquement pas arriver ici si un return a déjà eu lieu.
                 // Par sécurité, on retourne un échec générique demandant un redémarrage.
                 return { success: false, error: `Action '${action}' failed and was not recovered by assistance.`, restartBrowser: true };
            } else {
                // logger.info(`[${sessionId}] Action '${action}' (ou action corrective IA) appliquée avec succès.`);
            }
    
    
            // 5. Cliquer sur "Suivant" avec retry
            // logger.info(`[${sessionId}] Tentative de clic sur le bouton "Suivant".`);
            let attempt = 0;
            let clicked = false;
            while (attempt < 5 && !clicked) {
                await randomDelay(3000, 3000); // 3 secondes d'attente
                const nextButtonLocator = page.locator(selectors.nextButton);
                const isVisible = await nextButtonLocator.isVisible().catch(() => false); // Gère si l'élément disparaît
                const isEnabled = isVisible ? await nextButtonLocator.isEnabled().catch(() => false) : false;
    
                if (isVisible && isEnabled) {
                    try {
                        await nextButtonLocator.click({ timeout: 5000 });
                        // logger.info(`[${sessionId}] Clic sur le bouton "Suivant" réussi.`);
                        await page.waitForTimeout(500); // Petite pause après le clic
                        clicked = true;
                    } catch (nextButtonError) {
                        logger.error(`[${sessionId}] Tentative ${attempt + 1}: Clic sur "Suivant" échoué (${nextButtonError.message}).`);
                        // Pas d'assistance ici pour l'instant, on boucle pour retenter
                    }
                } else {
                    // logger.info(`[${sessionId}] Tentative ${attempt + 1}: Bouton "Suivant" non visible/activé.`);
                     // Vérifier si l'exercice est terminé (ex: bouton "Terminer" visible)
                     const finishButtonVisible = await page.locator(selectors.finishButton).isVisible().catch(() => false);
                     if (finishButtonVisible) {
                         // logger.info(`[${sessionId}] Bouton "Terminer" détecté pendant l'attente de "Suivant". Marqué comme exercice terminé.`);
                         return { success: true, exerciseComplete: true };
                     }
                     // Si le bouton n'est pas visible/activé après plusieurs tentatives, on pourrait déclencher l'assistance ici aussi.
                     if (attempt === 4) { // Dernière tentative avant échec
                         logger.error(`[${sessionId}] Bouton "Suivant" toujours pas cliquable avant la dernière tentative. Tentative d'assistance.`);
                         const errorAssist = await handleAutomationError(page, sessionId, new Error("Bouton Suivant non visible/activé après plusieurs attentes"), "Attente bouton Suivant");
                         if (errorAssist.attemptedAction) {
                             // Si l'IA a cliqué sur quelque chose, on sort de la boucle et on espère que ça a débloqué.
                             // On ne marque PAS clicked=true, car on ne sait pas si c'était le bouton "Suivant".
                             // La logique suivante vérifiera si l'exercice est terminé.
                             // logger.info(`[${sessionId}] Assistance IA a tenté une action pendant l'attente de 'Suivant'. On continue.`);
                             break; // Sortir de la boucle while
                         }
                         if (errorAssist.restartRequired) {
                             return { success: false, error: "Error assistance requested browser restart while waiting for Next button", restartBrowser: true };
                         }
                         // Si l'IA n'a rien fait et ne demande pas de redémarrage, on continue la dernière tentative de boucle.
                     }
                }
                attempt++;
            }
            if (!clicked) {
                 // Si on sort de la boucle sans avoir cliqué (et sans que l'IA ait demandé un redémarrage)
                logger.error(`[${sessionId}] Le bouton "Suivant" n'a pas pu être cliqué après ${attempt} tentatives et l'assistance n'a pas résolu.`);
                // Dernière tentative d'assistance avant de déclarer forfait
                const finalError = new Error(`Le bouton "Suivant" n'a pas pu être cliqué après ${attempt} tentatives.`);
                const finalAssist = await handleAutomationError(page, sessionId, finalError, "Échec final clic bouton Suivant");
                 if (finalAssist.restartRequired) {
                     return { success: false, error: finalError.message + " (Assistance finale a demandé redémarrage)", restartBrowser: true };
                 }
                 // Si même l'assistance finale échoue sans demander de redémarrage, on abandonne.
                 return { success: false, error: finalError.message + " (Assistance finale inefficace)", restartBrowser: true }; // On demande quand même le redémarrage par sécurité.
            }
    
            // logger.info(`[${sessionId}] Fin de la tentative de résolution de l'étape.`);
            // On ne sait pas si l'exercice est fini, on retourne juste le succès de l'étape
            return { success: true, exerciseComplete: false };
    
        } catch (error) {
            logger.error(`[${sessionId}] Erreur inattendue durant solveSingleExercise: ${error.message}`, { stack: error.stack });
            // Tentative d'assistance IA pour les erreurs inattendues
            const errorResult = await handleAutomationError(page, sessionId, error, "Erreur inattendue (catch global)");
            // Toujours demander le redémarrage après une erreur inattendue, même si l'IA a tenté quelque chose
            return { success: false, error: `Unexpected error: ${error.message}`, restartBrowser: true };
        }
        }); // Fin du runExclusive du mutex de session
    }); // Fin du runExclusive du sémaphore global
} // Fin de solveSingleExercise
