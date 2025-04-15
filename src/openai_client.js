const { OpenAI } = require('openai');
const config = require('./config_loader');
const logger = require('./logger');

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
async function getCorrection(promptContent) {
  if (!openai) {
    logger.error("Le client OpenAI n'a pas été initialisé correctement. Impossible d'envoyer le prompt.");
    return { success: false, error: "Client OpenAI non initialisé." };
  }

  const systemMessage =
    "Tu es un expert en grammaire et orthographe française, assistant pour le Projet Voltaire. " +
    "Analyse la phrase ou la question fournie et retourne la correction ou la réponse sous forme d'objet JSON structuré. " +
    'Par exemple: { "action": "click_word", "value": "erreur" } ou { "action": "select_option", "value": "Option B" } ' +
    'ou { "action": "validate_rule", "rule_id": "REGLE_123" }. Ne fournis que le JSON.';

  logger.debug(`Envoi du prompt à OpenAI (${OPENAI_MODEL}): ${promptContent}`);

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: promptContent }
      ],
      temperature: 0.2,
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

module.exports = {
  getCorrection,
};