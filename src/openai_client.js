import { OpenAI } from 'openai';
import { config } from './config_loader.js';
import getLogger from './logger.js'; // ⚠️ Le logger est désormais asynchrone : utilisez const logger = await getLogger() avant chaque usage.
import { JSDOM } from 'jsdom';
import { closeBrowserSession } from './browser_manager.js';

/**
 * Initialisation asynchrone du client OpenAI et du logger.
 * Le logger doit être obtenu via await getLogger() à chaque utilisation.
 * Voir la documentation dans src/logger.js pour plus de détails.
 */
const OPENAI_API_KEY = config.OPENAI_API_KEY;
const OPENAI_MODEL = config.OPENAI_MODEL;

let openai = null;

/**
 * Initialise le client OpenAI et log l’état d’initialisation.
 * À appeler avant toute utilisation des fonctions exportées.
 */
export async function initOpenAIClient() {
  const logger = await getLogger();
  try {
    if (!OPENAI_API_KEY) {
      throw new Error("La clé API OpenAI (OPENAI_API_KEY) n'est pas définie dans la configuration.");
    }
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    logger.info(`Client OpenAI initialisé avec le modèle : ${OPENAI_MODEL}`);
  } catch (error) {
    logger.error("Erreur lors de l'initialisation du client OpenAI :", error);
    openai = null;
  }
}

/**
 * Analyse et parse une chaîne JSON, retourne {success, data|error}.
 * @param {string} jsonString
 * @returns {{success: boolean, data?: object, error?: string, raw_content?: string}}
 */
function tryParseJson(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (parsed && typeof parsed === 'object' && parsed.action) {
      return { success: true, data: parsed };
    }
    return {
      success: false,
      error: 'Missing "action" field in JSON response',
      raw_content: jsonString,
      data: parsed
    };
  } catch (err) {
    return {
      success: false,
      error: 'Invalid JSON response from OpenAI',
      raw_content: jsonString
    };
  }
}

/**
 * Envoie un prompt à l'API OpenAI (ChatGPT) et tente de récupérer une correction structurée en JSON.
 * @param {string} promptContent Le contenu du prompt à envoyer à l'IA.
 * @returns {Promise<object>} Une promesse qui résout avec l'objet JSON de la réponse ou un objet d'erreur.
 */
export async function getCorrection(promptContent) {
  const logger = await getLogger();
  if (!openai) {
    logger.error("Le client OpenAI n'a pas été initialisé correctement. Impossible d'envoyer le prompt.");
    return { success: false, error: "Client OpenAI non initialisé." };
  }

  const systemMessage =
    "Tu es un expert en grammaire et orthographe française, assistant pour le Projet Voltaire. " +
    "Analyse la phrase ou la question fournie et retourne la correction ou la réponse sous forme d'objet JSON structuré." +
    'Par exemple: { "action": "click_word", "value": "erreur" } ou { "action": "select_option", "value": "Option B" } ' +
    'ou { "action": "validate_rule", "rule_id": "REGLE_123" }. Ne fournis que le JSON.';

  logger.debug(`Envoi du prompt à OpenAI (${OPENAI_MODEL}): ${promptContent}`);

  // Choix aléatoire du modèle : 50% de chance d'utiliser le modèle configuré, sinon gpt-4.1
  const randomModel = Math.random() < 0.5 ? OPENAI_MODEL : 'gpt-4.1';
  logger.debug(`Modèle utilisé pour cette requête : ${randomModel}`);

  try {
    const completion = await openai.chat.completions.create({
      model: randomModel,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: `${promptContent}` }
      ],
      temperature: 0.1,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    });

    if (
      !completion ||
      !completion.choices ||
      !Array.isArray(completion.choices) ||
      completion.choices.length === 0 ||
      !completion.choices[0].message ||
      typeof completion.choices[0].message.content !== 'string'
    ) {
      logger.error('Réponse OpenAI invalide ou vide reçue.', { completion });
      return { success: false, error: 'Invalid or empty response from OpenAI' };
    }

    const messageContent = completion.choices[0].message.content;
    logger.debug(`Contenu extrait de la réponse OpenAI: ${messageContent}`);

    const parseResult = tryParseJson(messageContent);
    if (!parseResult.success) {
      logger.error(parseResult.error, { raw_content: parseResult.raw_content, data: parseResult.data });
    }
    return parseResult;

  } catch (apiError) {
    logger.error("Erreur lors de l'appel API OpenAI:", apiError);
    const errorMessage =
      apiError?.response?.data?.error?.message ||
      apiError?.message ||
      'OpenAI API call failed';
    return {
      success: false,
      error: errorMessage,
      details: apiError?.response?.data || apiError
    };
  }
}


/**
 * Demande une suggestion à l'IA pour résoudre une erreur d'automatisation.
 * @param {string} errorMessage Le message d'erreur capturé.
 * @param {string} currentUrl L'URL actuelle de la page.
 * @param {string} sessionId L'identifiant de la session pour le logging.
 * @param {string} [screenshotBase64] L'image de la page encodée en base64 (optionnel).
 * @returns {Promise<{success: boolean, suggestion?: string, error?: string}>}
 */
/**
 * Demande à l'IA le sélecteur CSS ou XPath du bouton le plus pertinent pour résoudre une erreur, à partir du HTML complet de la page.
 * Implémente une boucle de relance avec validation stricte du sélecteur (syntaxe, unicité, cliquabilité).
 * @param {string} errorMessage Le message d'erreur capturé.
 * @param {string} currentUrl L'URL actuelle de la page.
 * @param {string} sessionId L'identifiant de la session pour le logging.
 * @param {string} htmlSource Le code source HTML complet de la page (document.documentElement.outerHTML).
 * @returns {Promise<{success: boolean, suggestion?: string, error?: string}>}
 */
export async function getErrorReportSuggestion(errorMessage, currentUrl, sessionId, htmlSource) {
  const logger = await getLogger();
  if (!openai) {
    logger.error(`[${sessionId}] [ErrorAssist] Le client OpenAI n'est pas initialisé.`);
    return { success: false, error: "Client OpenAI non initialisé." };
  }

  // 1. Tronquer le HTML si besoin
  const MAX_HTML_LENGTH = 200000;
  let html = htmlSource || '';
  if (html.length > MAX_HTML_LENGTH) {
    html = html.slice(0, MAX_HTML_LENGTH);
    logger.warn(`[${sessionId}] [ErrorAssist] HTML tronqué à ${MAX_HTML_LENGTH} caractères pour l'envoi à l'IA.`);
  }

  // 2. Prompt de base
  const basePrompt = `
Tu es un assistant expert en automatisation web.
Analyse le HTML fourni et identifie le bouton le plus pertinent sur lequel il faudrait envoyer un clic programmatique pour résoudre le problème ou progresser dans le workflow, même si ce bouton est désactivé ou masqué.
Réponds UNIQUEMENT par un objet JSON strictement de la forme : { "action": "click_selector", "value": "<sélecteur CSS ou XPath>" }.
- Si un bouton pertinent existe dans le DOM (même désactivé ou masqué), "action" doit être "click_selector" et "value" doit être un sélecteur CSS ou XPath UNIQUE, non vide, ciblant ce bouton (button, a[role="button"], input[type="submit"], input[type="button"]).
- Si aucun bouton n’existe dans le DOM, réponds { "action": "no_action" } (et dans ce cas, n’inclus PAS de champ "value").
- N’invente jamais de sélecteur si aucun bouton n’existe.
- Ne réponds rien d’autre que cet objet JSON, sans texte ni explication.
`;

  // 3. Validation du sélecteur côté Node (syntaxe, unicité, cliquabilité)
  async function validateSelector(selector, html) {
    const logger = await getLogger();
    if (!selector || typeof selector !== 'string') return false;
    if (selector === 'AUCUNE_ACTION') return true;

    // On utilise jsdom pour parser le HTML côté Node
    let dom;
    try {
      dom = new JSDOM(html);
    } catch (e) {
      logger.error(`[${sessionId}] [ErrorAssist] Erreur parsing HTML pour validation sélecteur: ${e}`);
      return false;
    }
    const doc = dom.window.document;

    let elements = [];
    // Détection CSS ou XPath
    if (selector.startsWith('/') || selector.startsWith('(')) {
      // XPath
      try {
        let xpathResult = doc.evaluate(selector, doc, null, dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < xpathResult.snapshotLength; i++) {
          elements.push(xpathResult.snapshotItem(i));
        }
      } catch (e) {
        logger.warn(`[${sessionId}] [ErrorAssist] Sélecteur XPath invalide: ${selector}`);
        return false;
      }
    } else {
      // CSS
      try {
        elements = Array.from(doc.querySelectorAll(selector));
      } catch (e) {
        logger.warn(`[${sessionId}] [ErrorAssist] Sélecteur CSS invalide: ${selector}`);
        return false;
      }
    }
    if (elements.length !== 1) return false;
    const el = elements[0];
    // Vérifier la cliquabilité
    if (
      el.tagName === 'BUTTON' ||
      (el.tagName === 'A' && el.getAttribute('role') === 'button') ||
      (el.tagName === 'INPUT' && ['submit', 'button'].includes(el.type))
    ) {
      // On accepte même si le bouton est désactivé ou masqué
      return true;
    }
    return false;
  }

  // 4. Boucle de relance
  const maxTries = 3;
  let lastError = null;
  let lastSelector = null;
  // Correction : encapsulation du bloc de parsing/validation dans la boucle for
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    {
      const prompt =
        basePrompt +
        (attempt > 1
          ? `\nATTENTION : La réponse précédente était invalide (${lastError || "non conforme"}).
          Tu dois répondre par un sélecteur CSS ou XPath UNIQUE, qui cible exactement UN bouton cliquable (button, a[role="button"], input[type="submit"], input[type="button"]).`
          : '');
  
      logger.info(`[${sessionId}] [ErrorAssist] Appel OpenAI tentative ${attempt}...`);
      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: 'gpt-4.1',
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `URL: ${currentUrl}\nErreur: ${errorMessage}\n\nHTML:\n${html}` }
          ],
          temperature: 0.1,
          max_tokens: 8192,
        });
      } catch (apiError) {
        logger.error(`[${sessionId}] [ErrorAssist] Erreur API OpenAI tentative ${attempt}:`, apiError);
        lastError = apiError?.message || 'Erreur API';
        continue;
      }
  
      if (
        !completion ||
        !completion.choices ||
        !Array.isArray(completion.choices) ||
        completion.choices.length === 0 ||
        !completion.choices[0].message ||
        typeof completion.choices[0].message.content !== 'string'
      ) {
        lastError = 'Réponse OpenAI vide ou invalide';
        continue;
      }
      let raw = completion.choices[0].message.content.trim();
      let selector = null;
      let action = null;
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
        action = parsed.action;
        selector = parsed.value;
      } catch (e) {
        // fallback : si pas JSON, traiter comme sélecteur brut (pour compatibilité descendante)
        selector = raw;
        action = "click_selector";
        parsed = { action, value: selector };
      }
      lastSelector = selector;
      logger.info(`[${sessionId}] [ErrorAssist] Action proposée (tentative ${attempt}): action="${action}", value="${selector}"`);
      
      // Validation stricte de la structure
      if (action === "no_action") {
        logger.info(`[${sessionId}] [ErrorAssist] Aucune action suggérée à la tentative ${attempt}.`);
        // On ne retourne plus ici, on continue la boucle pour réessayer jusqu'à maxTries
        lastError = 'Aucune action suggérée ("no_action")';
        continue;
      }
      
      if (action === "click_selector" && typeof selector === "string" && selector.trim() && await validateSelector(selector, html)) {
        logger.info(`[${sessionId}] [ErrorAssist] Sélecteur validé: "${selector}"`);
        return { success: true, suggestion: { action: "click_selector", value: selector } };
      } else {
        lastError = 'Sélecteur non valide (syntaxe, unicité ou type, ou champ manquant)';
        logger.warn(`[${sessionId}] [ErrorAssist] Sélecteur rejeté ou structure incorrecte: "${JSON.stringify(parsed)}"`);
      }
    }
  }

  logger.error(`[${sessionId}] [ErrorAssist] Échec après ${maxTries} tentatives. Dernière action: "${lastSelector}"`);
  // Si la dernière action était "no_action", on ferme et relance le navigateur
  if (lastError && lastError.includes('Aucune action suggérée')) {
    logger.warn(`[${sessionId}] [ErrorAssist] 3x "no_action" consécutifs : fermeture et relance du navigateur.`);
    await closeBrowserSession(sessionId);
    return { success: true, suggestion: { action: "restart_browser" } };
  }
  return { success: false, error: `Aucun sélecteur valide trouvé après ${maxTries} essais. Dernier: "${lastSelector}"` };
}
