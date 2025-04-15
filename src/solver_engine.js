const logger = require('./logger');
const { parseExercise } = require('./exercise_parser');
const { getCorrection } = require('./openai_client');
const { randomDelay } = require('./human_simulator');
const config = require('./config_loader');

const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY;
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY;

/**
 * Helper pour cliquer sur un mot dans la phrase.
 */
async function clickWord(page, word) {
    // Décompose le mot pour gérer les mots composés
    const wordParts = word.split(/[\s\-‑]/);
    logger.debug(`Mot décomposé en parties: ${JSON.stringify(wordParts)}`);

    // Essaye avec le mot complet
    let locator = page.locator('div.sentence span.pointAndClickSpan', { hasText: word });
    let found = await locator.count() > 0;

    // Sinon, essaye avec la première partie
    if (!found && wordParts.length > 1) {
        const firstPart = wordParts[0];
        logger.info(`Mot composé non trouvé directement, tentative avec la première partie: "${firstPart}"`);
        locator = page.locator('div.sentence span.pointAndClickSpan', { hasText: firstPart });
        found = await locator.count() > 0;
    }

    if (found) {
        if (Math.random() < 0.1) {
            await randomDelay(10000, 18000);
        } else {
            await randomDelay(3000, 8000);
        }
        await locator.first().click({ timeout: 5000 });
        logger.info(`Clic réussi sur le mot ou sa première partie`);
        return true;
    }
    return false;
}

/**
 * Helper pour cliquer sur un bouton par sélecteur.
 */
async function clickButton(page, selector, description) {
    try {
        const button = page.locator(selector);
        await randomDelay(3000, 5000);
        await button.click({ timeout: 5000 });
        logger.info(`Clic réussi sur le bouton "${description}".`);
        return true;
    } catch (err) {
        logger.error(`Échec du clic sur le bouton "${description}": ${err.message}`);
        return false;
    }
}

/**
 * Tente de résoudre un seul exercice affiché sur la page Playwright.
 */
async function solveSingleExercise(page) {
    logger.info('Tentative de résolution d\'un exercice...');

    try {
        // 1. Parsing de l'exercice
        logger.debug('Parsing de l\'exercice en cours...');
        const exerciseData = await parseExercise(page);

        if (!exerciseData.success) {
            logger.error(`Échec du parsing de l'exercice: ${exerciseData.error}`);
            return { success: false, error: `Parsing failed: ${exerciseData.error}` };
        }
        logger.debug(`Données extraites de l'exercice: ${JSON.stringify(exerciseData.data)}`);

        // 2. Délai humain avant l'appel IA
        logger.debug(`Ajout d'un délai aléatoire avant l'appel OpenAI...`);
        await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);

        // 3. Appel OpenAI pour la correction
        const prompt = `Analyse l'exercice suivant et fournis l'action JSON (type: 'click_word', 'select_option', 'validate_rule', 'no_mistake', etc. et 'value' ou 'rule_id' si applicable). Si aucune faute n'est détectée, utilise l'action 'no_mistake': ${exerciseData.data.question}`;
        logger.debug(`Prompt envoyé à OpenAI: ${prompt}`);

        const correctionResult = await getCorrection(prompt);
        logger.debug(`Résultat OpenAI: ${JSON.stringify(correctionResult)}`);

        if (!correctionResult || !correctionResult.success) {
            const errorMsg = `Failed to get valid correction from OpenAI: ${correctionResult?.error || 'Unknown error'}`;
            logger.error(errorMsg);
            logger.debug(`Raw OpenAI result object: ${JSON.stringify(correctionResult)}`);
            return { success: false, error: errorMsg };
        }

        const correctionData = correctionResult.data;
        if (!correctionData || typeof correctionData !== 'object' || !correctionData.action) {
            const errorMsg = 'OpenAI response data is invalid or missing "action" field.';
            logger.error(errorMsg, { dataReceived: correctionData });
            logger.debug(`Raw OpenAI result object: ${JSON.stringify(correctionResult)}`);
            return { success: false, error: errorMsg };
        }

        logger.info(`Correction reçue d'OpenAI: Action=${correctionData.action}, Value=${correctionData.value || 'N/A'}, RuleID=${correctionData.rule_id || 'N/A'}`);
        logger.debug(`Correction complète: ${JSON.stringify(correctionData)}`);

        // 4. Appliquer la correction
        const action = correctionData.action.toLowerCase();
        let actionSuccess = false;

        switch (action) {
            case 'click_word':
                if (!correctionData.value) {
                    logger.warn(`Action 'click_word' reçue sans 'value'.`);
                    return { success: false, error: 'AI action "click_word" missing value' };
                }
                await randomDelay(3000, 5000);
                logger.info(`Tentative de clic sur le mot: "${correctionData.value}"`);
                try {
                    actionSuccess = await clickWord(page, correctionData.value);
                    if (!actionSuccess) throw new Error(`Aucune correspondance trouvée pour le mot "${correctionData.value}" ni sa première partie`);
                } catch (clickError) {
                    logger.error(`Échec du clic sur le mot "${correctionData.value}": ${clickError.message}`);
                    // Tentative alternative
                    try {
                        logger.info(`Tentative alternative de clic via un sélecteur plus générique`);
                        const allSpans = page.locator('div.sentence span.pointAndClickSpan');
                        if (await allSpans.count() > 0) {
                            await allSpans.first().click({ timeout: 3000 });
                            logger.info(`Clic alternatif réussi sur un élément span`);
                        } else {
                            throw new Error("Aucun élément span cliquable trouvé");
                        }
                    } catch (alternativeError) {
                        logger.error(`Échec de la tentative alternative: ${alternativeError.message}`);
                        return { success: false, error: `Failed to click on word "${correctionData.value}": ${clickError.message}` };
                    }
                }
                break;

            case 'select_option':
                if (!correctionData.value) {
                    logger.warn(`Action 'select_option' reçue sans 'value'.`);
                    return { success: false, error: 'AI action "select_option" missing value' };
                }
                logger.info(`[SIMULATION] Sélection de l'option: ${correctionData.value}`);
                await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
                // TODO: Implémenter la logique de sélection réelle.
                break;

            case 'validate_rule':
                if (!correctionData.rule_id) {
                    logger.warn(`Action 'validate_rule' reçue sans 'rule_id'.`);
                    return { success: false, error: 'AI action "validate_rule" missing rule_id' };
                }
                logger.info(`Validation de la règle: ${correctionData.rule_id}. Clic sur le bouton "Il n'y a pas de faute".`);
                actionSuccess = await clickButton(page, 'button#btn_question_suivante.noMistakeButton', 'valider la règle');
                if (!actionSuccess) return { success: false, error: `Failed to click validation/no mistake button` };
                break;

            case 'no_mistake':
                logger.info(`[SIMULATION] Clic sur le bouton "Il n'y a pas de faute".`);
                actionSuccess = await clickButton(page, 'button#btn_question_suivante.noMistakeButton', 'Il n\'y a pas de faute');
                if (!actionSuccess) return { success: false, error: `Failed to click on "No Mistake" button` };
                break;

            default:
                logger.warn(`Action IA non reconnue ou non gérée: ${action}`);
                return { success: false, error: `Unhandled AI action: ${action}` };
        }
        logger.info(`[SIMULATION] Fin de l'application de l'action: ${action}`);

        // 5. Cliquer sur "Suivant" avec retry
        logger.info('Action appliquée. Tentative de clic sur le bouton "Suivant".');
        let attempt = 0;
        let clicked = false;
        while (attempt < 5 && !clicked) {
            await randomDelay(3000, 3000); // 3 secondes d'attente
            const nextButtonLocator = page.locator('#btn_question_suivante.nextButton');
            const isVisible = await nextButtonLocator.isVisible();
            const isEnabled = await nextButtonLocator.isEnabled();
            if (isVisible && isEnabled) {
                try {
                    await nextButtonLocator.click({ timeout: 5000 });
                    logger.info('Clic sur le bouton "Suivant" réussi.');
                    await page.waitForTimeout(500);
                    clicked = true;
                } catch (nextButtonError) {
                    logger.info(`Tentative ${attempt + 1}: Le bouton "Suivant" est visible/activé mais le clic a échoué (${nextButtonError.message}).`);
                }
            } else {
                logger.info(`Tentative ${attempt + 1}: Le bouton "Suivant" n'est pas visible ou activé.`);
            }
            attempt++;
        }
        if (!clicked) {
            logger.error('Le bouton "Suivant" n\'a pas pu être cliqué après 5 tentatives. Demande de redémarrage du navigateur.');
            return { success: false, restartBrowser: true };
        }

        logger.info('Fin de la tentative de résolution de l\'exercice.');
        return { success: true };

    } catch (error) {
        logger.error(`Erreur inattendue durant solveSingleExercise: ${error.message}`, { stack: error.stack });
        return { success: false, error: `Unexpected error: ${error.message}` };
    }
}

module.exports = {
    solveSingleExercise
};