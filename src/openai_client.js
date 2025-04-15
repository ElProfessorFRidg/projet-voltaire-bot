// src/openai_client.js
const { OpenAI } = require('openai');
const config = require('./config_loader'); // Importe la configuration chargée
const logger = require('./logger'); // Importe le logger

// Récupère la clé API depuis la configuration (validée dans config_loader.js)
const OPENAI_API_KEY = config.OPENAI_API_KEY; // Utilise la clé correcte de l'objet config
const OPENAI_MODEL = config.OPENAI_MODEL; // Utilise la clé correcte de l'objet config

// Vérifie si la clé API est bien présente (double vérification)
if (!OPENAI_API_KEY) {
  logger.error("Erreur critique : La clé API OpenAI (OPENAI_API_KEY) n'est pas définie dans la configuration.");
  // On pourrait choisir de lancer une erreur ici pour arrêter l'application
  // throw new Error("OPENAI_API_KEY is not configured.");
}

// Instancie le client OpenAI
// Assure-toi que la clé API est fournie, sinon le constructeur lèvera une erreur.
let openai;
try {
  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  logger.info(`Client OpenAI initialisé avec le modèle : ${OPENAI_MODEL}`);
} catch (error) {
  logger.error("Erreur lors de l'initialisation du client OpenAI:", error);
  // Gérer l'erreur d'initialisation comme nécessaire (ex: arrêter l'app, mode dégradé)
  openai = null; // S'assurer que le client n'est pas utilisable
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

  // Message système pour guider l'IA
  const systemMessage = `Tu es un expert en grammaire et orthographe française, assistant pour le Projet Voltaire. Analyse la phrase ou la question fournie et retourne la correction ou la réponse sous forme d'objet JSON structuré. Par exemple: { "action": "click_word", "value": "erreur" } ou { "action": "select_option", "value": "Option B" } ou { "action": "validate_rule", "rule_id": "REGLE_123" }. Ne fournis que le JSON.`;

  logger.debug(`Envoi du prompt à OpenAI (${OPENAI_MODEL}): ${promptContent}`);

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: promptContent }
      ],
      temperature: 0.2, // Pour des réponses plus déterministes
      max_tokens: 150, // Limite la longueur de la réponse
      response_format: { type: "json_object" }, // Demande une sortie JSON (nécessite modèle compatible)
    });

    logger.debug('Réponse brute reçue d\'OpenAI:', completion);

    if (completion.choices && completion.choices.length > 0) {
      const messageContent = completion.choices[0].message.content;
      logger.debug(`Contenu extrait de la réponse OpenAI: ${messageContent}`);

      // Essayer de parser le contenu JSON et vérifier la présence du champ 'action'
      try {
        const parsedJson = JSON.parse(messageContent);
        // Vérifier si le champ 'action' est présent
        if (parsedJson && parsedJson.action) {
          // Ajout d'un indicateur de succès pour clarifier la structure retournée
          return { success: true, data: parsedJson };
        } else {
          // Le JSON est valide mais le champ 'action' est manquant
          logger.error('Réponse JSON valide mais champ "action" manquant.', { parsedJson });
          return { success: false, error: 'Missing "action" field in JSON response', raw_content: messageContent, data: parsedJson };
        }
      } catch (parseError) {
        // Gérer l'erreur si le contenu n'est pas du JSON valide
        logger.error(`Erreur de parsing JSON de la réponse OpenAI: ${parseError.message}. Contenu brut: ${messageContent}`);
        return { success: false, error: 'Invalid JSON response from OpenAI', raw_content: messageContent };
      }
    } else {
      logger.error('Réponse OpenAI invalide ou vide reçue.');
      return { success: false, error: 'Invalid or empty response from OpenAI' };
    }

  } catch (apiError) {
    logger.error(`Erreur lors de l'appel API OpenAI: ${apiError.message}`, apiError);
    // Tenter de fournir plus de détails si disponibles dans l'erreur de l'API OpenAI
    const errorMessage = apiError.response?.data?.error?.message || apiError.message || 'OpenAI API call failed';
    return { success: false, error: errorMessage, details: apiError.response?.data || apiError };
  }
}

// Exporte la fonction pour utilisation dans d'autres modules
module.exports = {
  getCorrection,
};