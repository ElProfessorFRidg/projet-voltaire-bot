// src/config_loader.js
require('dotenv').config(); // Charge les variables d'environnement depuis le fichier .env

/**
 * Vérifie que les variables d'environnement essentielles sont définies.
 * Lance une erreur si une variable manque.
 */
function validateEnvVariables() {
  const requiredEnvVars = [
    'VOLTAIRE_EMAIL',
    'VOLTAIRE_PASSWORD',
    'OPENAI_API_KEY',
    // Note: Les variables de délai ont des valeurs par défaut dans .env.example,
    // mais pourraient être rendues obligatoires ici si nécessaire.
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Erreur de configuration : Les variables d'environnement suivantes sont manquantes dans le fichier .env : ${missingVars.join(', ')}`);
  }
}

// Exécute la validation au chargement du module
validateEnvVariables();

// Exporte un objet contenant la configuration validée et traitée.
// Exporter la configuration chargée et validée
const config = {
  VOLTAIRE_EMAIL: process.env.VOLTAIRE_EMAIL,
  VOLTAIRE_PASSWORD: process.env.VOLTAIRE_PASSWORD,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  // Utilise une valeur par défaut pour le modèle s'il n'est pas défini
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  // Parse les délais en entiers, avec des valeurs par défaut raisonnables
  MIN_ACTION_DELAY: parseInt(process.env.MIN_ACTION_DELAY || '500', 10),
  MAX_ACTION_DELAY: parseInt(process.env.MAX_ACTION_DELAY || '1500', 10),
  MIN_TYPING_DELAY: parseInt(process.env.MIN_TYPING_DELAY || '50', 10),
  MAX_TYPING_DELAY: parseInt(process.env.MAX_TYPING_DELAY || '150', 10),
  // Ajoute d'autres variables si nécessaire (ex: LOGIN_URL)
  LOGIN_URL: process.env.VOLTAIRE_LOGIN_URL || 'https://compte.groupe-voltaire.fr/login'
};

console.log('Configuration chargée et validée.');
console.log(`Utilisation du modèle OpenAI : ${config.OPENAI_MODEL}`); // Log du modèle utilisé

module.exports = config;

// Suppression de l'ancienne section commentée sur getConfig