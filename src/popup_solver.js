const logger = require('./logger');
const { getCorrection } = require('./openai_client'); // Conservé pour solveCorrectIncorrectPopup
const { randomDelay } = require('./human_simulator'); // Importé pour les délais aléatoires
const config = require('./config_loader'); // Importé pour les constantes de délai

// Délais
const MIN_ACTION_DELAY = config.MIN_ACTION_DELAY;
const MAX_ACTION_DELAY = config.MAX_ACTION_DELAY;

/**
 * Analyse une phrase pour déterminer si elle est grammaticalement correcte
 * (Fonction existante conservée)
 * @param {string} sentence La phrase à analyser.
 * @returns {boolean} true si la phrase est jugée correcte, false sinon.
 */
function analyzeSentence(sentence) {
    // Règle 1: "peut être" vs "peut-être"
    const peutEtreRegex = /\bpeut être\b/i;
    const peutetreRegex = /\bpeut-être\b/i;

    if (peutEtreRegex.test(sentence)) {
        // Contient "peut être". Correct si on ne peut PAS remplacer par "probablement".
        // Simplification: on suppose que si "peut être" est écrit, c'est correct dans ce contexte.
        logger.debug(`Analyse: "peut être" trouvé. Supposé correct.`);
        return true;
    } else if (peutetreRegex.test(sentence)) {
        // Contient "peut-être". Correct si on PEUT remplacer par "probablement".
        // Vérifier les motifs où "peut-être" est incorrectement utilisé pour "peut être" (verbe+verbe)
        const verbPatterns = [
            // Ex: "Il peut-être obligé..." -> Incorrect
            /\bpeut-être\s+(un|une|le|la|les|des|ce|cette|ces|mon|ma|mes|ton|ta|tes|son|sa|ses)\b/i, // peut-être + déterminant (souvent incorrect)
            /\bpeut-être\s+\w+(é|ée|és|ées)\b/i, // peut-être + participe passé
            /\bpeut-être\s+(être|avoir|faire|aller)\b/i, // peut-être + infinitif (souvent incorrect)
            // Cas spécifiques des exemples
             /\bpeut-être\s+obligé[es]?\b/i,
             /\bpeut-être\s+prouvé[es]?\b/i,
             /\bpeut-être\s+reproduit[es]?\b/i,
             /\bpeut-être\s+amené[es]?\b/i, // Ajout basé sur l'erreur log
        ];
        for (const pattern of verbPatterns) {
            if (pattern.test(sentence)) {
                logger.debug(`Analyse: "peut-être" suivi d'un motif verbal ("${pattern}"). Supposé incorrect.`);
                return false; // "peut-être" utilisé incorrectement à la place de "peut être"
            }
        }
        // Si aucun motif incorrect n'est trouvé, on suppose que "peut-être" (adverbe) est correct.
        logger.debug(`Analyse: "peut-être" trouvé et supposé utilisé correctement comme adverbe.`);
        return true;
    }

    logger.warn(`Analyse: Règle "peut être/peut-être" non applicable ou logique incomplète pour: "${sentence}"`);
    return true; // Comportement par défaut si ni l'un ni l'autre n'est clairement identifié
}


/**
 * Nouvelle version de solvePopup : Traite les questions une par une dans le popup intensif.
 * @param {import('playwright').Page} page L'objet Page de Playwright.
 */
async function solvePopup(page) {
    logger.info('[solvePopup V3] Début du traitement phrase par phrase...');
    const MAX_ITERATIONS = 50; // Limite pour éviter les boucles infinies
    const POPUP_TIMEOUT_MS = 120000; // Timeout global pour la fonction
    const startTime = Date.now();
    let iteration = 0;
    let questionsProcessedCount = 0;

    try {
        // Sélecteurs
        const popupSelector = '.popupContent .intensiveTraining';
        const understoodButtonSelector = 'button.understoodButton';
        const questionContainerSelector = '.intensiveQuestion'; // Conteneur de chaque question
        const sentenceSelector = '.sentence'; // Sélecteur de la phrase DANS une question
        const correctButtonSelector = '.buttonOk'; // Bouton Correct DANS une question
        const incorrectButtonSelector = '.buttonKo'; // Bouton Incorrect DANS une question
        const exitButtonSelector = '.exitButton';
        const retryButtonSelector = '.retryButton';
        const tickSelector = '.tick'; // Indicateur de question répondue

        // 1. Attendre l'apparition du popup
        logger.info('[solvePopup V3] Attente de l\'apparition du pop-up...');
        await page.waitForSelector(popupSelector, { state: 'visible', timeout: 15000 });
        logger.info('[solvePopup V3] Pop-up détecté.');

        // 2. Gérer le bouton "J'ai compris" avec attente supplémentaire
        try {
            await page.waitForTimeout(5000); // Pause ajoutée avant locator
            const understoodButton = page.locator(understoodButtonSelector);
            console.log(understoodButton)
            // Attendre que le bouton soit potentiellement visible
            if (await understoodButton.isVisible({ timeout: 7000 })) { // Délai augmenté à 20s
                logger.info('[solvePopup V3] Bouton "J\'ai compris" détecté. Attente fixe (3s) + délai aléatoire...');
                // Attente fixe de 3 secondes
                await page.waitForTimeout(3000);
                logger.info('[solvePopup V3] Fin de l\'attente supplémentaire. Vérification finale et clic...');

                // Re-vérifier si le bouton est TOUJOURS visible avant de cliquer
                if (await understoodButton.isVisible({ timeout: 500 })) { // Timeout court pour la re-vérification
                    await understoodButton.click({ timeout: 3000 });
                    logger.info('[solvePopup V3] Clic sur "J\'ai compris". Attente post-clic...');
                    await page.waitForTimeout(2500); // Conserver l'attente post-clic existante
                } else {
                     logger.warn('[solvePopup V3] Bouton "J\'ai compris" devenu invisible pendant l\'attente supplémentaire.');
                }
            } else {
                // Si le bouton n'est pas apparu dans le délai initial de 10s
                logger.info('[solvePopup V3] Bouton "J\'ai compris" non visible dans le délai initial.');
            }
        } catch (error) {
            logger.warn(`[solvePopup V3] Erreur gestion bouton "J'ai compris": ${error.message}`);
        }

        // 3. Boucle principale de traitement
        while (iteration < MAX_ITERATIONS) {
            // Vérification timeout global
            if (Date.now() - startTime > POPUP_TIMEOUT_MS) {
                logger.error(`[solvePopup V3] Timeout global (${POPUP_TIMEOUT_MS}ms) atteint. Sortie.`);
                break;
            }
            iteration++;
            logger.debug(`[solvePopup V3 Iter ${iteration}/${MAX_ITERATIONS}] Début itération.`);

            // Vérifier si le popup est toujours là
            if (!await page.locator(popupSelector).isVisible({ timeout: 1000 })) {
                logger.info('[solvePopup V3] Popup principal disparu. Fin du traitement.');
                break;
            }

            // Vérifier les boutons de fin/continuation
            const exitButton = page.locator(exitButtonSelector);
            if (await exitButton.isVisible({ timeout: 500 })) {
                logger.info('[solvePopup V3] Bouton "Sortir" détecté. Clic et fin.');
                try { await exitButton.click({ timeout: 3000 }); await page.waitForTimeout(500); } catch (e) { logger.error(`Clic Sortir échoué: ${e.message}`); }
                break;
            }
            const retryButton = page.locator(retryButtonSelector);
            if (await retryButton.isVisible({ timeout: 500 })) {
                logger.info('[solvePopup V3] Bouton "Je m\'accroche" détecté. Clic et continue.');
                try { await retryButton.click({ timeout: 3000 }); await page.waitForTimeout(1000); } catch (e) { logger.error(`Clic Je m'accroche échoué: ${e.message}`); }
                continue; // Passe à l'itération suivante
            }

            // 4. Trouver la *prochaine* question à traiter
            let targetQuestion = null;
            const allQuestions = await page.locator(questionContainerSelector).all();
            logger.debug(`[solvePopup V3 Iter ${iteration}] Recherche de la prochaine question parmi ${allQuestions.length} conteneurs.`);

            for (const question of allQuestions) {
                // Vérifier si la question est visible et si elle n'a pas déjà été répondue (pas de .tick visible)
                // et si les boutons sont présents
                const isVisible = await question.isVisible({ timeout: 500 });
                const hasTick = await question.locator(tickSelector).isVisible({ timeout: 100 }); // Rapide check pour le tick
                const hasButtons = await question.locator(`${correctButtonSelector}, ${incorrectButtonSelector}`).count() > 0;

                if (isVisible && !hasTick && hasButtons) {
                     // Vérifier si les boutons sont réellement visibles (pas juste présents dans le DOM)
                     const okVisible = await question.locator(correctButtonSelector).isVisible({ timeout: 100 });
                     const koVisible = await question.locator(incorrectButtonSelector).isVisible({ timeout: 100 });
                     if (okVisible || koVisible) {
                        logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate trouvée (visible, sans tick, avec boutons visibles).`);
                        targetQuestion = question;
                        break; // On prend la première question non répondue
                     } else {
                         logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate ignorée (boutons OK/KO non visibles).`);
                     }
                } else {
                     logger.debug(`[solvePopup V3 Iter ${iteration}] Question candidate ignorée (Visible: ${isVisible}, Tick: ${hasTick}, Boutons DOM: ${hasButtons}).`);
                }
            }

            // 5. Traiter la question trouvée ou attendre
            if (targetQuestion) {
                questionsProcessedCount++;
                const questionLogId = `Q${questionsProcessedCount} (Iter ${iteration})`;
                logger.info(`[solvePopup V3 ${questionLogId}] Traitement de la question trouvée.`);

                try {
                    // Extraire la phrase (Correction: cibler DANS targetQuestion)
                    const sentenceElement = targetQuestion.locator(sentenceSelector).first(); // .first() pour éviter strict mode violation
                    const sentenceTextRaw = await sentenceElement.textContent({ timeout: 2000 });
                    if (sentenceTextRaw === null) throw new Error("Texte de la phrase est null.");
                    const sentenceText = sentenceTextRaw.trim().replace(/\s+/g, ' ');
                    if (!sentenceText) throw new Error("Texte de la phrase vide après nettoyage.");

                    logger.info(`[solvePopup V3 ${questionLogId}] Phrase: "${sentenceText}"`);

                    // Analyser
                    const isCorrect = analyzeSentence(sentenceText);
                    logger.info(`[solvePopup V3 ${questionLogId}] Analyse: ${isCorrect ? 'Correcte' : 'Incorrecte'}`);

                    // Cliquer
                    const buttonToClickLocator = isCorrect ? correctButtonSelector : incorrectButtonSelector;
                    const buttonToClick = targetQuestion.locator(buttonToClickLocator); // Cibler DANS targetQuestion
                    const buttonLabel = isCorrect ? 'Correct' : 'Incorrect';

                    logger.info(`[solvePopup V3 ${questionLogId}] Clic sur "${buttonLabel}"...`);
                    if (await buttonToClick.isVisible({ timeout: 1000 }) && await buttonToClick.isEnabled({ timeout: 1000 })) {
                        await buttonToClick.click({ timeout: 3000 });

                        // Attendre la disparition des boutons DANS CETTE question
                        logger.debug(`[solvePopup V3 ${questionLogId}] Attente disparition boutons...`);
                        try {
                            await page.waitForFunction(async ({ qElement, btnOkSel, btnKoSel }) => {
                                if (!qElement || !document.body.contains(qElement)) return true; // Disparu
                                const okBtn = qElement.querySelector(btnOkSel);
                                const koBtn = qElement.querySelector(btnKoSel);
                                return (!okBtn || okBtn.offsetParent === null) && (!koBtn || koBtn.offsetParent === null);
                            }, {
                                qElement: await targetQuestion.elementHandle(), // Passer l'ElementHandle
                                btnOkSel: correctButtonSelector,
                                btnKoSel: incorrectButtonSelector
                            }, { timeout: 5000 });
                            logger.debug(`[solvePopup V3 ${questionLogId}] Boutons disparus ou cachés.`);
                        } catch (waitError) {
                            logger.error(`[solvePopup V3 ${questionLogId}] Timeout attente disparition boutons: ${waitError.message}. L'état pourrait être incohérent.`);
                            // On continue quand même pour voir si ça se débloque à la prochaine itération
                        }
                    } else {
                        logger.warn(`[solvePopup V3 ${questionLogId}] Bouton "${buttonLabel}" non cliquable au moment prévu.`);
                    }

                } catch (error) {
                    logger.error(`[solvePopup V3 ${questionLogId}] Erreur traitement question: ${error.message}`);
                    // On continue à la prochaine itération pour ne pas bloquer
                }

            } else {
                logger.debug(`[solvePopup V3 Iter ${iteration}] Aucune question active trouvée. Attente...`);
                // Si aucune question active n'est trouvée, faire une pause avant de réessayer
                // Cela peut arriver si les questions apparaissent avec un délai
                await page.waitForTimeout(1500 + Math.random() * 1000);
            }

            // Petite pause entre les itérations
            await page.waitForTimeout(200 + Math.random() * 300);

        } // Fin boucle while

        if (iteration >= MAX_ITERATIONS) {
            logger.error(`[solvePopup V3] Nombre maximum d'itérations (${MAX_ITERATIONS}) atteint.`);
        }

        logger.info(`[solvePopup V3] Fin boucle principale. ${questionsProcessedCount} questions traitées sur ${iteration} itérations.`);

    } catch (error) {
        if (error.name === 'TimeoutError') {
            logger.error(`[solvePopup V3] Timeout attente élément clé (popup?): ${error.message}`);
        } else {
            logger.error(`[solvePopup V3] Erreur inattendue: ${error.message}`, { stack: error.stack });
        }
    } finally {
        logger.info('[solvePopup V3] Fin de l\'exécution.');
    }
}


/**
 * Gère la résolution d'un popup Correct/Incorrect (Fonction existante conservée)
 * @param {import('playwright').Page} page L'objet Page de Playwright.
 * @param {import('playwright').Locator} popupElement Le Locator Playwright pointant vers l'élément racine du popup.
 * @returns {Promise<string|null>} La décision prise ("Correct" ou "Incorrect") ou null en cas d'échec.
 */
async function solveCorrectIncorrectPopup(page, popupElement) {
    // ... (code inchangé de la version précédente)
    logger.info('[solveCorrectIncorrectPopup] Début...'); // Log simplifié
    try {
        const correctButtonSelector = '.buttonOk';
        const incorrectButtonSelector = '.buttonKo';
        let popupText = await popupElement.textContent({ timeout: 5000 });
        if (!popupText) {
            logger.warn('[solveCorrectIncorrectPopup] Texte du popup non extrait.');
            return null;
        }
        const cleanedText = popupText.trim().replace(/\s+/g, ' ');
        logger.debug(`[solveCorrectIncorrectPopup] Texte: "${cleanedText}"`);

        const prompt = `Analyse: "${cleanedText}". Indique si c'est CORRECT ou INCORRECT. Réponse JSON: { "decision": "Correct" } ou { "decision": "Incorrect" }`;
        await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY); // Simulation
        const decisionResult = await getCorrection(prompt);

        if (!decisionResult?.success || !decisionResult.data?.decision || !['Correct', 'Incorrect'].includes(decisionResult.data.decision)) {
            logger.error(`[solveCorrectIncorrectPopup] Décision OpenAI invalide.`, { decisionResult });
            // Fallback simple: tenter de cliquer sur le premier bouton visible
            try {
                const fallbackButton = popupElement.locator('button:visible').first();
                if (await fallbackButton.count() > 0) {
                    logger.warn("[solveCorrectIncorrectPopup] Tentative de clic fallback.");
                    await fallbackButton.click(); return "FallbackClick";
                }
            } catch (fallbackError) { logger.error(`[solveCorrectIncorrectPopup] Erreur fallback: ${fallbackError.message}`); }
            return null;
        }

        const decision = decisionResult.data.decision;
        logger.info(`[solveCorrectIncorrectPopup] Décision OpenAI: ${decision}`);
        const targetButtonSelector = decision === 'Correct' ? correctButtonSelector : incorrectButtonSelector;
        const buttonToClick = popupElement.locator(targetButtonSelector);

        if (await buttonToClick.count() > 0 && await buttonToClick.isVisible() && await buttonToClick.isEnabled()) {
            logger.info(`[solveCorrectIncorrectPopup] Clic sur "${decision}"...`);
            await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY); // Simulation
            await buttonToClick.click({ timeout: 5000 });
            await page.waitForTimeout(500);
            return decision;
        } else {
            logger.error(`[solveCorrectIncorrectPopup] Bouton "${decision}" non cliquable.`);
            // Fallback
            try {
                const fallbackButton = popupElement.locator('button:visible').first();
                if (await fallbackButton.count() > 0) {
                    logger.warn(`[solveCorrectIncorrectPopup] Tentative clic fallback (bouton cible non trouvé).`);
                    await fallbackButton.click(); return "FallbackClick";
                } else { logger.error("[solveCorrectIncorrectPopup] Aucun bouton visible pour fallback."); }
            } catch (fallbackError) { logger.error(`[solveCorrectIncorrectPopup] Erreur fallback 2: ${fallbackError.message}`); }
            return null;
        }
    } catch (error) {
        logger.error(`[solveCorrectIncorrectPopup] Erreur: ${error.message}`, { stack: error.stack });
        // Fallback générique
        try {
             const fallbackButton = popupElement.locator('button:visible').first();
             if (await fallbackButton.count() > 0) {
                logger.warn(`[solveCorrectIncorrectPopup] Erreur inattendue, tentative clic fallback.`);
                await fallbackButton.click(); return "FallbackClickOnError";
            }
        } catch (fallbackError) { logger.error(`[solveCorrectIncorrectPopup] Erreur fallback 3: ${fallbackError.message}`); }
        return null;
    } finally {
        logger.info('[solveCorrectIncorrectPopup] Fin.');
    }
}


module.exports = {
    solvePopup, // Nouvelle version V3 phrase par phrase
    solveCorrectIncorrectPopup,
    analyzeSentence
};