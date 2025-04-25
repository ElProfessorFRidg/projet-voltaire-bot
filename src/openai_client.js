import { OpenAI } from 'openai';
import { config } from './config_loader.js';
import logger from './logger.js';

const OPENAI_API_KEY = config.OPENAI_API_KEY;
const OPENAI_MODEL = config.OPENAI_MODEL;

let openai = null;
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

  // Choix aléatoire du modèle : 50% de chance d'utiliser le modèle configuré, sinon gpt-4.1-mini
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
export async function getErrorReportSuggestion(errorMessage, currentUrl, sessionId, screenshotBase64) {
  if (!openai) {
    logger.error(`[${sessionId}] [ErrorAssist] Le client OpenAI n'est pas initialisé.`);
    return { success: false, error: "Client OpenAI non initialisé." };
  }

  const visionModel = config.OPENAI_VISION_MODEL || 'gpt-4.1'; // Utiliser un modèle vision si configuré
  const textModel = config.OPENAI_MODEL || 'gpt-4.1';
  const modelToUse = screenshotBase64 ? visionModel : textModel;

  logger.info(`[${sessionId}] [ErrorAssist] Demande d'assistance IA (${modelToUse}) pour l'erreur: ${errorMessage}`);

  const systemPrompt = "Tu es un assistant expert en automatisation web. Analyse l'erreur fournie, l'URL, et potentiellement l'image de la page. Identifie l'élément UI (bouton, lien, etc.) sur lequel il faudrait probablement cliquer pour résoudre cette erreur ou continuer. Réponds uniquement avec le texte exact visible de l'élément OU un sélecteur CSS unique permettant de le localiser. Si aucun élément pertinent n'est identifiable, réponds 'AUCUNE_ACTION'.";

  const userMessages = [
    {
      type: "text",
      text: `Session ID: ${sessionId}\nURL: ${currentUrl}\nErreur: ${errorMessage}\n\nInstruction: Identifie l'élément UI à cliquer pour résoudre l'erreur. Réponds avec son texte visible ou un sélecteur CSS, ou 'AUCUNE_ACTION'.`
    }
  ];

  if (screenshotBase64 && modelToUse === visionModel) {
    logger.debug(`[${sessionId}] [ErrorAssist] Ajout de la capture d'écran à la requête (modèle vision).`);
    userMessages.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${screenshotBase64}`,
        detail: "low" // ou "high" si plus de détails sont nécessaires
      }
    });
  } else if (screenshotBase64) {
      logger.warn(`[${sessionId}] [ErrorAssist] Capture d'écran fournie mais le modèle ${modelToUse} ne supporte pas les images. L'image sera ignorée.`);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: modelToUse,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessages }
      ],
      temperature: 0.2,
      max_tokens: 150, // Une réponse courte est attendue
    });

    if (
      !completion ||
      !completion.choices ||
      !Array.isArray(completion.choices) ||
      completion.choices.length === 0 ||
      !completion.choices[0].message ||
      typeof completion.choices[0].message.content !== 'string'
    ) {
      logger.error(`[${sessionId}] [ErrorAssist] Réponse OpenAI invalide ou vide reçue.`, { completion });
      return { success: false, error: 'Invalid or empty response from OpenAI for error assistance' };
    }

    const suggestion = completion.choices[0].message.content.trim();
    logger.info(`[${sessionId}] [ErrorAssist] Suggestion reçue de l'IA: \"${suggestion}\"`);

    // Validation simple de la réponse
    if (!suggestion) {
        logger.warn(`[${sessionId}] [ErrorAssist] Suggestion vide reçue de l'IA.`);
        return { success: true, suggestion: 'AUCUNE_ACTION' }; // Traiter comme aucune action
    }

    return { success: true, suggestion: suggestion };

  } catch (apiError) {
    logger.error(`[${sessionId}] [ErrorAssist] Erreur lors de l'appel API OpenAI pour l'assistance:`, apiError);
    const errorMessageText =
      apiError?.response?.data?.error?.message ||
      apiError?.message ||
      'OpenAI API call failed for error assistance';
    return {
      success: false,
      error: errorMessageText,
      details: apiError?.response?.data || apiError
    };
  }
}
