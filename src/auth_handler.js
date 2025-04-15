// src/auth_handler.js
const config = require('../src/config_loader.js'); // Importe la configuration exportée
const { randomDelay, getRandomInt } = require('../src/human_simulator');
const logger = require('./logger'); // Importe le logger configuré

/**
 * Gère la connexion au Projet Voltaire en simulant un comportement humain.
 * @param {import('playwright').Page} page - L'instance de la page Playwright.
 * @returns {Promise<{success: boolean, error?: string}>} - Un objet indiquant le succès ou l'échec de la connexion.
 */
async function login(page) {
  // Utilise la configuration importée
  const {
    VOLTAIRE_EMAIL,
    VOLTAIRE_PASSWORD,
    MIN_ACTION_DELAY,
    MAX_ACTION_DELAY,
    MIN_TYPING_DELAY,
    MAX_TYPING_DELAY,
    LOGIN_URL
  } = config;

  // Placeholders pour les sélecteurs (LOGIN_URL vient de config)
  //Projet voltaire official selector <input x-ref="email" x-on:input="validateEmail" name="email" aria-label="Identifiant" x-on:focus="focus" x-on:blur="blur" required="" class="w-full" placeholder="Identifiant">
  const emailSelector = 'input[name="email"], input#user_pseudonym'; // Sélecteur pour le champ email (avec alternative) // Sélecteur pour le champ email
  //Projet voltaire official selector <input x-ref="password" x-on:input="validatePassword" type="password" name="password" aria-label="Mot de passe" x-on:focus="focus" x-on:blur="blur" required="" class="w-full" placeholder="Mot de passe">*
  const passwordSelector = 'input[name="password"], input#user_password'; // Sélecteur pour le champ mot de passe
  //Projet voltaire official selector <button type="submit" x-bind:class="btnClass" x-bind:disabled="hasEmptyFields" class="mainButton">Je me connecte</button>
  const submitButtonSelector = 'button[type="submit"]'; // Sélecteur pour le bouton de soumission
  const successSelector = '#btn_home_exit, #btn_home_sortir';// Placeholder (élément visible après succès)
  //Projet voltaire error message HTML content <div class="error">Identifiant ou mot de passe incorrect</div>
  const errorSelector = '.error'; // Placeholder (élément d'erreur)

  logger.info(`Tentative de connexion à ${LOGIN_URL}...`);

  try {
    // Navigation vers la page de connexion
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' }); // Attendre que le réseau soit calme
    logger.info('Page de connexion chargée.');

    // --- Simulation de Saisie (Email) ---
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    logger.debug('Localisation du champ email...');
    const emailField = await page.locator(emailSelector);
    await emailField.waitFor({ state: 'visible', timeout: 10000 }); // Attendre que le champ soit visible
    logger.debug('Saisie de l\'email...');
    await emailField.type(VOLTAIRE_EMAIL, { delay: getRandomInt(MIN_TYPING_DELAY, MAX_TYPING_DELAY) });
    logger.info('Email saisi.');

    // --- Délai Intermédiaire ---
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);

    // --- Simulation de Saisie (Mot de passe) ---
    logger.debug('Localisation du champ mot de passe...');
    const passwordField = await page.locator(passwordSelector);
     await passwordField.waitFor({ state: 'visible', timeout: 10000 }); // Attendre que le champ soit visible
    logger.debug('Saisie du mot de passe...');
    await passwordField.type(VOLTAIRE_PASSWORD, { delay: getRandomInt(MIN_TYPING_DELAY, MAX_TYPING_DELAY) });
    logger.info('Mot de passe saisi.');

    // --- Simulation de Soumission ---
    await randomDelay(MIN_ACTION_DELAY, MAX_ACTION_DELAY);
    logger.debug('Localisation et clic sur le bouton de soumission...');
    const submitButton = await page.locator(submitButtonSelector);
    await submitButton.waitFor({ state: 'visible', timeout: 10000 }); // Attendre que le bouton soit visible
    await submitButton.click();
    logger.info('Formulaire soumis.');

    // --- Attente et Vérification du Résultat ---
    logger.info('Attente du résultat de la connexion (succès ou erreur)...');
    try {
      await Promise.race([
        page.waitForSelector(successSelector, { state: 'visible', timeout: 15000 }),
        page.waitForSelector(errorSelector, { state: 'visible', timeout: 15000 })
      ]);

      // Vérifie quel élément est apparu
      const errorMessageVisible = await page.locator(errorSelector).isVisible();
      if (errorMessageVisible) {
        const errorText = await page.locator(errorSelector).textContent();
        logger.error(`Échec de la connexion: Message d'erreur détecté - ${errorText?.trim()}`);
        return { success: false, error: `Login failed: ${errorText?.trim() || 'Error message found'}` };
      }

      const successElementVisible = await page.locator(successSelector).isVisible();
      if (successElementVisible) {
        logger.info('Connexion réussie (indicateur de succès détecté).');
        return { success: true };
      } else {
        // Aucun des sélecteurs attendus n'est visible après la fin de Promise.race
        // Cela peut arriver si la page change d'une manière inattendue ou si le timeout est atteint
        // sans qu'aucun des deux n'apparaisse.
        logger.error('Échec de la connexion: Timeout ou état inattendu après soumission (ni succès ni erreur détectés).');
        return { success: false, error: 'Login timeout or unexpected state after submission' };
      }

    } catch (error) {
      logger.error('Erreur lors de l\'attente post-connexion:', { name: error.name, message: error.message });
      if (error.name === 'TimeoutError') {
         logger.error('Timeout dépassé en attendant l\'indicateur de succès ou d\'erreur.');
        return { success: false, error: 'Login attempt timed out waiting for success/error indicator.' };
      }
      // Autre erreur pendant l'attente
      return { success: false, error: `Post-login wait error: ${error.message}` };
    }

  } catch (error) {
    logger.error(`Erreur critique durant le processus de connexion:`, { name: error.name, message: error.message });
    // Gérer les erreurs de localisation ou d'interaction
     if (error.message?.includes('selector resolved to hidden element') || error.message?.includes('waiting for selector')) {
       return { success: false, error: `Failed to find or interact with element: ${error.message}` };
     }
    return { success: false, error: `Critical login error: ${error.message}` };
  }
}

module.exports = { login };