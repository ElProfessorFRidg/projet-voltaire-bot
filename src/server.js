import cors from 'cors'; // Importe le middleware CORS
import express from 'express';
import fs from 'fs/promises'; // Ajout pour la gestion des fichiers actifs
import path from 'path';
import { config, updateConfig, loadAccountsFromJSON } from './config_loader.js';
import logger from './logger.js';

import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Mutex } from './async_utils.js';
import { ValidationError, AppError, handleError } from './error_utils.js';
import { validateUserFields } from './validation_utils.js';
import {
  ensureDirAndWriteFile,
  readJsonFile,
  writeJsonFile,
  readSessionTimes,
  writeSessionTimes,
  readDuration,
  writeDuration
} from './utils/file_utils.js';
import { calculateSessionEnd, parseDurationString } from './utils/time_utils.js';

const app = express();
app.use(cors({
  origin: ["*", "null"], // Autorise toutes les origines et l'origine 'null' pour les fichiers locaux
  methods: ["GET", "POST", "PUT", "DELETE"] // Ajout des méthodes PUT et DELETE pour les opérations CRUD
}));
app.use(express.json()); // Pour parser le corps des requêtes JSON
const port = 3000; // Port pour le serveur web

// Création du serveur HTTP pour socket.io
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: ["*", "null"], // Autorise toutes les origines et l'origine 'null' pour les fichiers locaux
    methods: ["GET", "POST", "PUT", "DELETE"] // Ajout des méthodes PUT et DELETE pour les opérations CRUD
  }
});

// Structure en mémoire pour stocker le temps restant par session
let sessionTimes = {}; // Utiliser let pour pouvoir réassigner au chargement
const sessionTimesPath = path.resolve('config/session_times.json'); // Chemin vers le fichier de sauvegarde des temps de session

// --- Persistance de la durée globale TimeTracker ---
const durationPath = path.resolve('config/duration.json');

// Mutex pour protéger l'accès concurrent au fichier des comptes
const accountsFileMutex = new Mutex();

// --- API pour recevoir les mises à jour du temps de session ---
// Route pour obtenir la configuration actuelle
// Route pour obtenir la configuration actuelle (exclut les secrets)
app.get('/config', (req, res) => {
  const currentConfig = { ...config }; // Copie pour éviter de modifier l'original
  delete currentConfig.OPENAI_API_KEY; // Exclut la clé API

  console.log('[DEBUG] /config renvoie :', currentConfig);
  res.json(currentConfig);
});

// Route pour mettre à jour la configuration
app.post('/config', (req, res) => {
  const newConfigValues = req.body;
  updateConfig(newConfigValues); // Appelle la fonction de mise à jour

  res.json({ success: true, message: 'Configuration reçue et appliquée.' });
});

// Route pour obtenir la liste des comptes (sans mots de passe)
app.get('/accounts', async (req, res) => {
  try {
    const allAccounts = await loadAccountsFromJSON();
    // Retire les mots de passe avant d'envoyer
    // Inclure sessionEnd dans la réponse pour chaque compte
    const accountsWithSessionEnd = allAccounts.map(account => {
      const sessionObj = sessionTimes[account.id];
      // Correction : ne réinitialiser le temps restant que si la durée a changé ou a été explicitement prolongée
      if (
        account.sessionEnd &&
        account.sessionEnd > Date.now() &&
        (
          !sessionObj ||
          !sessionObj.remainingTime ||
          // Si la sessionDuration a changé (on compare la durée totale attendue)
          (typeof sessionObj.initialSessionEnd === "undefined" || sessionObj.initialSessionEnd !== account.sessionEnd)
        )
      ) {
        // Nouvelle durée ou prolongation détectée, on réinitialise sessionTimes
        sessionTimes[account.id] = {
          remainingTime: account.sessionEnd - Date.now(),
          lastUpdate: Date.now()
        };
        return { ...account, sessionEnd: account.sessionEnd };
      }
      if (sessionObj && typeof sessionObj === 'object') {
        if (
          Object.prototype.hasOwnProperty.call(sessionObj, 'remainingTime') &&
          typeof sessionObj.remainingTime === 'number' &&
          !isNaN(sessionObj.remainingTime)
        ) {
          if (sessionObj.remainingTime <= 0) {
            return { ...account, sessionEnd: null };
          }
          return { ...account, sessionEnd: Date.now() + sessionObj.remainingTime };
        }
      }
      return { ...account, sessionEnd: null };
    });
    // Retire les mots de passe avant d'envoyer
    const accountsWithoutPasswords = accountsWithSessionEnd.map(({ password, ...account }) => account);
    res.json(accountsWithoutPasswords);
  } catch (error) {
    console.error("Erreur lors du chargement des comptes pour l'API:", error);
    res.status(500).json({ error: "Impossible de charger les comptes." });
  }
});

// Route pour sauvegarder les comptes actifs sélectionnés
const activeAccountsPath = path.resolve('config/active_accounts.json'); // Chemin vers le fichier de sauvegarde

app.post('/accounts/active', async (req, res) => {
  const { activeAccounts } = req.body; // Récupère la liste des IDs

  if (!Array.isArray(activeAccounts)) {
    return res.status(400).json({ success: false, message: 'Format de données invalide.' });
  }

  try {
    // S'assurer que le répertoire config existe
    await fs.mkdir(path.dirname(activeAccountsPath), { recursive: true });
    // Écrire les IDs dans le fichier JSON
    await fs.writeFile(activeAccountsPath, JSON.stringify(activeAccounts, null, 2));
    console.log('Comptes actifs sauvegardés:', activeAccounts);
    res.json({ success: true, message: 'Sélection des comptes actifs sauvegardée.' });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde des comptes actifs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur lors de la sauvegarde.' });
  }
});

// Route pour récupérer les comptes actifs sélectionnés
app.get('/accounts/active', async (req, res) => {
  try {
      const data = await fs.readFile(activeAccountsPath, 'utf-8');
      try {
          const activeAccounts = JSON.parse(data);
          res.json(activeAccounts); // Renvoie le tableau des IDs actifs
      } catch (parseError) {
          logger.error('Fichier active_accounts.json corrompu, suppression et retour tableau vide.', parseError);
          // Supprimer le fichier corrompu
          try { await fs.unlink(activeAccountsPath); } catch (e) { /* ignore */ }
          res.json([]);
      }
  } catch (error) {
      if (error.code === 'ENOENT') {
          // Si le fichier n'existe pas, renvoyer un tableau vide
          res.json([]);
      } else {
          logger.error('Erreur lors de la lecture des comptes actifs:', error);
          res.status(500).json({ success: false, message: 'Erreur serveur lors de la lecture de la sélection.' });
      }
  }
});

// --- Endpoints API pour la durée globale (TimeTracker) ---
// GET /api/duration : retourne la durée sauvegardée (en ms)
app.get('/api/duration', async (req, res) => {
 try {
   const duration = await readDuration(durationPath);
   res.json({ duration });
 } catch (error) {
   if (error.code === 'ENOENT') {
     // Fichier non trouvé, retourner 0
     res.json({ duration: 0 });
   } else {
     logger.error('Erreur lors de la lecture de la durée:', error);
     res.status(500).json({ error: 'Erreur serveur lors de la lecture de la durée.' });
   }
 }
});

// POST /api/duration : sauvegarde la durée reçue (en ms)
app.post('/api/duration', async (req, res) => {
 const { duration } = req.body;
 if (typeof duration !== 'number' || isNaN(duration) || duration < 0) {
   return res.status(400).json({ success: false, message: 'Durée invalide.' });
 }
 try {
   await writeDuration(durationPath, duration);
   res.json({ success: true });
 } catch (error) {
   logger.error('Erreur lors de la sauvegarde de la durée:', error);
   res.status(500).json({ success: false, message: 'Erreur serveur lors de la sauvegarde.' });
 }
});

// Route pour recevoir les mises à jour de session du frontend
app.post('/session-update/:accountId', async (req, res) => {
  const { accountId } = req.params;
  const sessionData = req.body;

  logger.debug(`Mise à jour de session reçue pour ${accountId}:`, sessionData);

  // Récupérer l'état actuel pour empêcher la "réactivation" d'un compte expiré
  const current = sessionTimes[accountId];
  let isExpired = false;
  if (
    current &&
    typeof current.remainingTime === 'number' &&
    typeof current.lastUpdate === 'number'
  ) {
    const now = Date.now();
    const elapsed = Math.max(0, now - current.lastUpdate);
    const timeLeft = Math.max(0, current.remainingTime - elapsed);
    if (timeLeft <= 0) {
      isExpired = true;
    }
  }

  // Si le compte est expiré, ignorer toute update (sauf reset explicite)
  if (
    isExpired &&
    (!sessionData.reset && !(sessionData.remainingTime > 0))
  ) {
    logger.debug(`Update ignorée pour ${accountId} car le temps est expiré.`);
    return res.json({ success: true, ignored: true });
  }

  // Nouvelle logique : stocker remainingTime et lastUpdate pour une persistance robuste
  if (
    typeof sessionData.remainingTime === 'number' &&
    typeof sessionData.lastUpdate === 'number'
  ) {
    sessionTimes[accountId] = {
      remainingTime: sessionData.remainingTime,
      lastUpdate: sessionData.lastUpdate
    };
  } else {
    sessionTimes[accountId] = {};
  }

  // Sauvegarder la structure sessionTimes dans le fichier
  try {
    await writeSessionTimes(sessionTimesPath, sessionTimes);
    logger.debug(`sessionTimes sauvegardé dans ${sessionTimesPath}`);
  } catch (error) {
    logger.error(`Erreur lors de la sauvegarde de sessionTimes dans ${sessionTimesPath}:`, error);
    // Ne pas bloquer la réponse même si la sauvegarde échoue
  }

  // Log spécifique
  if (sessionTimes[accountId].remainingTime !== undefined) {
    logger.debug(
      `remainingTime stocké pour ${accountId}: ${sessionTimes[accountId].remainingTime} ms (lastUpdate: ${new Date(sessionTimes[accountId].lastUpdate).toISOString()})`
    );
  }

  res.json({ success: true });
});

// --- API CRUD pour les comptes (config/accounts_config.json) ---
// Fonction utilitaire pour lire les comptes depuis JSON
/**
 * Lecture protégée par mutex pour éviter les accès concurrents au fichier des comptes.
 */
async function readAccountsFile() {
    return await accountsFileMutex.runExclusive(async () => {
        const accountsPath = activeAccountsPath.replace('active_accounts.json', 'accounts_config.json');
        const data = await readJsonFile(accountsPath);
        return data || [];
    });
}

// Fonction utilitaire pour écrire les comptes dans JSON
/**
 * Écriture protégée par mutex pour éviter les accès concurrents au fichier des comptes.
 */
async function writeAccountsFile(accounts) {
    await accountsFileMutex.runExclusive(async () => {
        const accountsPath = activeAccountsPath.replace('active_accounts.json', 'accounts_config.json');
        await writeJsonFile(accountsPath, accounts);
    });
}

// Ajouter un nouveau compte
/**
 * Route POST /accounts
 * Correction : validation stricte via ValidationError, gestion centralisée des erreurs via handleError.
 */
app.post('/accounts', async (req, res) => {
    try {
        const newAccount = req.body;
        validateUserFields(newAccount);

        // Gestion du temps de session
        if (newAccount.sessionDuration) {
            const durationMs = parseDurationString(newAccount.sessionDuration);
            if (!isNaN(durationMs) && durationMs > 0) {
                newAccount.sessionEnd = calculateSessionEnd(Date.now(), durationMs);
            } else {
                throw new ValidationError('sessionDuration doit être un nombre positif suivi de "h".', { champ: 'sessionDuration' });
            }
        } else {
            newAccount.sessionEnd = null;
        }

        if (typeof newAccount.isEnabled !== 'boolean') {
            newAccount.isEnabled = true;
        }

        const accounts = await readAccountsFile();

        const newId = `account_${Date.now()}`;
        newAccount.id = newId;

        accounts.push(newAccount);
        await writeAccountsFile(accounts);

        logger.info(`Nouveau compte ajouté: ${newAccount.email} (ID: ${newId})`);
        res.status(201).json({ success: true, account: newAccount });
    } catch (error) {
        if (error instanceof ValidationError) {
            logger.warn(`[Validation] ${error.message}`, error.details);
            return res.status(400).json({ success: false, message: error.message, details: error.details });
        }
        handleError(error, logger);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'ajout.' });
    }
});

// Modifier un compte existant
/**
 * Route PUT /accounts/:id
 * Correction : validation stricte via ValidationError, gestion centralisée des erreurs via handleError.
 */
app.put('/accounts/:id', async (req, res) => {
    try {
        const accountId = req.params.id;
        const updatedData = req.body;
        delete updatedData.id;

        validateUserFields(updatedData);

        const accounts = await readAccountsFile();
        const accountIndex = accounts.findIndex(acc => acc.id === accountId);

        if (accountIndex === -1) {
            return res.status(404).json({ success: false, message: 'Compte non trouvé.' });
        }

        let merged = { ...accounts[accountIndex], ...updatedData };
        if (updatedData.sessionDuration) {
            const durationMs = parseDurationString(updatedData.sessionDuration);
            if (!isNaN(durationMs) && durationMs > 0) {
                merged.sessionEnd = calculateSessionEnd(Date.now(), durationMs);
            } else {
                merged.sessionEnd = null;
            }
        }
        if (updatedData.sessionDuration === "" || updatedData.sessionDuration === null) {
            merged.sessionEnd = null;
        }
        if (typeof updatedData.isEnabled === 'boolean') {
            merged.isEnabled = updatedData.isEnabled;
        }
        accounts[accountIndex] = merged;

        await writeAccountsFile(accounts);
        logger.info(`Compte modifié: ${accounts[accountIndex].email} (ID: ${accountId})`);
        res.json({ success: true, account: accounts[accountIndex] });
    } catch (error) {
        if (error instanceof ValidationError) {
            logger.warn(`[Validation] ${error.message}`, error.details);
            return res.status(400).json({ success: false, message: error.message, details: error.details });
        }
        handleError(error, logger);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la modification.' });
    }
});

// Supprimer un compte
/**
 * Route DELETE /accounts/:id
 * Correction : gestion centralisée des erreurs via handleError.
 */
app.delete('/accounts/:id', async (req, res) => {
    try {
        const accountId = req.params.id;
        const accounts = await readAccountsFile();
        const initialLength = accounts.length;
        const filteredAccounts = accounts.filter(acc => acc.id !== accountId);

        if (filteredAccounts.length === initialLength) {
            return res.status(404).json({ success: false, message: 'Compte non trouvé.' });
        }

        await writeAccountsFile(filteredAccounts);
        logger.info(`Compte supprimé (ID: ${accountId})`);
        res.json({ success: true, message: 'Compte supprimé.' });
    } catch (error) {
        // Gestion centralisée des erreurs
        handleError(error, logger);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la suppression.' });
    }
});

// --- Fin API CRUD ---


// TODO: Servir les fichiers statiques (index.html, script.js, style.css)
// app.use(express.static('public')); // Si les fichiers sont dans un dossier 'public'

// Servir les fichiers statiques (index.html, script.js, style.css) depuis la racine du projet
app.use(express.static('.'));

function startServer() {
  return new Promise((resolve, reject) => {
    httpServer.listen(port, async () => { // Utiliser async ici
      console.log(`Serveur web + socket.io démarré sur http://localhost:${port}`);

      // --- Chargement des temps de session persistants au démarrage ---
      try {
        sessionTimes = await readSessionTimes(sessionTimesPath);
        logger.debug(`sessionTimes chargé depuis ${sessionTimesPath}`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.debug(`Fichier ${sessionTimesPath} non trouvé, initialisation de sessionTimes vide.`);
          sessionTimes = {}; // Assure que sessionTimes est un objet vide si le fichier n'existe pas
        } else {
          logger.error(`Erreur lors du chargement de ${sessionTimesPath}:`, error);
          sessionTimes = {}; // En cas d'erreur de lecture/parsing, repartir de zéro
        }
      }

      // --- Initialisation des sessions actives au démarrage ---
      // Suppression de toute logique de réinitialisation des temps de session
      // On ne touche plus à sessionTimes ici : la persistance est garantie uniquement par sessionTimes.json
      resolve({ app, io, httpServer });
    }).on('error', reject);
  });
}

export { startServer, io, sessionTimes };