import 'dotenv/config'; // Charge les variables d'environnement depuis le fichier .env
import logger from './logger.js'; // Assurez-vous que le logger est disponible
import fs from 'fs/promises';
import path from 'path';

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
 * Vérifie que les variables d'environnement essentielles (hors comptes) sont définies.
 * Lance une erreur si une variable manque.
 */
function validateBaseEnvVariables() {
  const requiredEnvVars = [
    'OPENAI_API_KEY'
    // VOLTAIRE_EMAIL et VOLTAIRE_PASSWORD ne sont plus requis ici
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
 * Charge les comptes Voltaire depuis le fichier JSON de configuration.
 * @returns {Promise<Array<{id: string, email: string, password: string, sessionDuration?: string}>>} Liste des comptes trouvés.
 * @throws {Error} Si le fichier n'existe pas, n'est pas lisible ou contient des données invalides.
 */
async function loadAccountsFromJSON() {
    const accountsPath = path.resolve('config/accounts_config.json');
    logger.info(`Chargement des comptes depuis ${accountsPath}...`);
    try {
        const data = await fs.readFile(accountsPath, 'utf-8');
        const accounts = JSON.parse(data);

        if (!Array.isArray(accounts)) {
            throw new Error('Le fichier de configuration des comptes ne contient pas un tableau JSON valide.');
        }

        const now = Date.now();
        const processedAccounts = accounts.map(account => {
            // Validation simple (vérifier les champs essentiels)
            if (!account.id || !account.email || !account.password) {
                logger.warn(`Compte invalide trouvé dans ${accountsPath}. Manque id, email ou password. Compte ignoré.`);
                return null; // Ignorer ce compte invalide
            }

            // Calculer sessionEnd si sessionDuration est présent et valide
            if (account.sessionDuration) {
                const hours = parseFloat(account.sessionDuration.replace('h', ''));
                if (!isNaN(hours) && hours > 0) {
                    // Si sessionEnd n'est pas défini ou est dans le passé, le recalculer
                    if (account.sessionEnd === undefined || account.sessionEnd === null || Number(account.sessionEnd) <= now) {
                        account.sessionEnd = now + hours * 60 * 60 * 1000;
                        logger.info(`Calcul de sessionEnd pour le compte ${account.id} lors du chargement.`);
                    } else {
                        // Si sessionEnd est déjà défini et dans le futur, s'assurer qu'il est un nombre
                        account.sessionEnd = Number(account.sessionEnd);
                        logger.info(`Utilisation de sessionEnd existant pour le compte ${account.id}.`);
                    }
                } else {
                    // sessionDuration invalide, définir sessionEnd à null
                    account.sessionEnd = null;
                    logger.warn(`sessionDuration invalide pour le compte ${account.id}: "${account.sessionDuration}". sessionEnd mis à null.`);
                }
            } else {
                // Pas de sessionDuration, définir sessionEnd à null
                account.sessionEnd = null;
            }

            return account;
        }).filter(account => account !== null); // Filtrer les comptes invalides

        logger.info(`${processedAccounts.length} compte(s) chargé(s) et traité(s) depuis ${accountsPath}.`);
        return processedAccounts;
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.error(`Erreur: Le fichier de configuration des comptes ${accountsPath} n'a pas été trouvé.`);
            // Retourner un tableau vide ou lancer une erreur plus spécifique ?
            // Pour l'instant, on lance une erreur pour forcer la création du fichier.
             throw new Error(`Le fichier de configuration des comptes ${accountsPath} est manquant.`);
        } else if (error instanceof SyntaxError) {
            logger.error(`Erreur de syntaxe JSON dans ${accountsPath}: ${error.message}`);
            throw new Error(`Impossible de parser le fichier JSON des comptes : ${accountsPath}. Vérifiez la syntaxe.`);
        } else {
            logger.error(`Erreur inattendue lors de la lecture de ${accountsPath}: ${error.message}`);
            throw error; // Relance l'erreur originale pour les autres cas
        }
    }
}

/**
 * @param {string|undefined} value
 * @param {number} defaultValue
 * @returns {number}
 */
function parseIntOrDefault(value, defaultValue) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// Exécute la validation de base au chargement du module
try {
  validateBaseEnvVariables();
} catch (err) {
  // Affiche l'erreur et termine le processus proprement
  console.error(err.message); // Utilise console.error car le logger n'est peut-être pas encore prêt
  process.exit(1);
}

// Prépare la configuration validée et traitée (hors comptes)
let currentConfig = {
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

logger.info('Configuration de base chargée et validée.');
logger.info(`Utilisation du modèle OpenAI : ${currentConfig.OPENAI_MODEL}`);

/**
 * Met à jour la configuration avec de nouvelles valeurs.
 * @param {object} newValues Les nouvelles valeurs de configuration.
 */
function updateConfig(newValues) {
    logger.info('Tentative de mise à jour de la configuration...');
    let configChanged = false;
    const updatableKeys = [
        'OPENAI_MODEL',
        'MIN_ACTION_DELAY',
        'MAX_ACTION_DELAY',
        'MIN_TYPING_DELAY',
        'MAX_TYPING_DELAY',
        'LOGIN_URL'
    ];

    for (const key of updatableKeys) {
        if (newValues.hasOwnProperty(key)) {
            let value = newValues[key];
            // Simple validation/parsing pour les nombres
            if (key.includes('DELAY')) {
                const parsedValue = parseInt(value, 10);
                if (Number.isFinite(parsedValue) && parsedValue >= 0) { // Assure que c'est un nombre positif
                    value = parsedValue;
                } else {
                    logger.warn(`Valeur invalide pour ${key}: "${newValues[key]}". Ignorée.`);
                    continue; // Ignore la mise à jour pour cette clé
                }
            }

            if (currentConfig[key] !== value) {
                logger.info(`Mise à jour de ${key}: "${currentConfig[key]}" -> "${value}"`);
                currentConfig[key] = value;
                configChanged = true;
            }
        }
    }

    if (configChanged) {
        logger.info('Configuration mise à jour avec succès.');
        // TODO: Signaler aux parties du bot qui utilisent la config qu'elle a changé si nécessaire
    } else {
        logger.info('Aucun changement détecté dans la configuration fournie.');
    }
}


export {
    currentConfig as config, // Exporte currentConfig sous le nom 'config'
    updateConfig,
    loadAccountsFromJSON // Exporte la nouvelle fonction
};