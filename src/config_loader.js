require('dotenv').config(); // Charge les variables d'environnement depuis le fichier .env

// Valeurs par défaut pour la configuration
const DEFAULTS = {
  OPENAI_MODEL: 'gpt-4o-mini',
  MIN_ACTION_DELAY: 500,
  MAX_ACTION_DELAY: 1500,
  MIN_TYPING_DELAY: 50,
  MAX_TYPING_DELAY: 150,
  LOGIN_URL: 'https://compte.groupe-voltaire.fr/login'
};

/**
 * Vérifie que les variables d'environnement essentielles sont définies.
 * Lance une erreur si une variable manque.
 */
function validateEnvVariables() {
  const requiredEnvVars = [
    'VOLTAIRE_EMAIL',
    'VOLTAIRE_PASSWORD',
    'OPENAI_API_KEY'
  ];

  const missingVars = requiredEnvVars.filter(
    varName => typeof process.env[varName] !== 'string' || process.env[varName].trim() === ''
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Erreur de configuration : Les variables d'environnement suivantes sont manquantes ou vides dans le fichier .env : ${missingVars.join(', ')}`
    );
  }
}

/**
 * Parse une valeur en entier, retourne la valeur par défaut si le parsing échoue.
 * @param {string|undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parseIntOrDefault(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// Exécute la validation au chargement du module
try {
  validateEnvVariables();
} catch (err) {
  // Affiche l'erreur et termine le processus proprement
  console.error(err.message);
  process.exit(1);
}

// Prépare la configuration validée et traitée
const config = {
  VOLTAIRE_EMAIL: process.env.VOLTAIRE_EMAIL,
  VOLTAIRE_PASSWORD: process.env.VOLTAIRE_PASSWORD,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL && process.env.OPENAI_MODEL.trim() !== ''
    ? process.env.OPENAI_MODEL
    : DEFAULTS.OPENAI_MODEL,
  MIN_ACTION_DELAY: parseIntOrDefault(process.env.MIN_ACTION_DELAY, DEFAULTS.MIN_ACTION_DELAY),
  MAX_ACTION_DELAY: parseIntOrDefault(process.env.MAX_ACTION_DELAY, DEFAULTS.MAX_ACTION_DELAY),
  MIN_TYPING_DELAY: parseIntOrDefault(process.env.MIN_TYPING_DELAY, DEFAULTS.MIN_TYPING_DELAY),
  MAX_TYPING_DELAY: parseIntOrDefault(process.env.MAX_TYPING_DELAY, DEFAULTS.MAX_TYPING_DELAY),
  LOGIN_URL: process.env.VOLTAIRE_LOGIN_URL && process.env.VOLTAIRE_LOGIN_URL.trim() !== ''
    ? process.env.VOLTAIRE_LOGIN_URL
    : DEFAULTS.LOGIN_URL
};

console.log('Configuration chargée et validée.');
console.log(`Utilisation du modèle OpenAI : ${config.OPENAI_MODEL}`);

module.exports = config;