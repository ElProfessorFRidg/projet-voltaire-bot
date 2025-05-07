/**
 * ⚠️ Ce fichier utilise l’API asynchrone du logger.
 * Pour chaque usage du logger dans une fonction asynchrone ou callback, il faut obtenir une instance via :
 *   const logger = await getLogger();
 * L’import du logger est : import getLogger from './logger.js';
 * Le logger doit être obtenu dans la portée de chaque fonction/callback où il est utilisé.
 * Pour le code top-level, utiliser une IIFE asynchrone ou initialiser le logger dans la portée de la fonction.
 */

import cors from 'cors'; // Importe le middleware CORS
import express from 'express';
import fs from 'fs/promises'; // Ajout pour la gestion des fichiers actifs
import path from 'path';
import { config, updateConfig, loadAccountsFromJSON } from './config_loader.js';
import { getSessionRemainingTime } from './browser_manager.js';
import getLogger from './logger.js';
const logger = await getLogger();
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
import { v4 as uuidv4 } from 'uuid'; // Ajout pour la génération d'identifiants de session uniques

const app = express();
app.use(cors({
  origin: ["*", "null"], // Autorise toutes les origines et l'origine 'null' pour les fichiers locaux
  methods: ["GET", "POST", "PUT", "DELETE"] // Ajout des méthodes PUT et DELETE pour les opérations CRUD
}));
app.use(express.json()); // Pour parser le corps des requêtes JSON
const port = 3000; // Port par défaut pour le serveur web
let actualServerPort = null; // Variable pour stocker le port réel après le démarrage

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

// --- Gestion des sessions multi-appareils ---
// Structure en mémoire pour stocker l'identifiant de session actif par utilisateur
let sessionIds = {}; // { [accountId]: { sessionId, timestamp } }

/**
 * Endpoint pour login de session (génère un identifiant de session unique)
 * Politique : une seule session active par utilisateur (invalidation de l'ancienne)
 *
 * Requête : { accountId: string }
 * Réponse : { success: boolean, sessionId: string, message?: string }
 */
app.post('/session-login', (req, res) => {
  const { accountId } = req.body;
  if (!accountId) {
    return res.status(400).json({ success: false, message: "accountId requis" });
  }
  const newSessionId = uuidv4();
  const now = Date.now();
  let message = "Session ouverte avec succès.";
  let previousSession = sessionIds[accountId];

  if (previousSession) {
    logger.info(`[MULTI-SESSION] Connexion multiple détectée pour ${accountId}. Ancienne session invalidée.`);
    message = "Une autre session était déjà active et a été invalidée.";
  } else {
    logger.info(`[SESSION] Connexion initiale pour ${accountId}.`);
  }

  sessionIds[accountId] = { sessionId: newSessionId, timestamp: now };

  logger.info(`[SESSION] Nouvelle session pour ${accountId} : ${newSessionId}`);

  return res.json({ success: true, sessionId: newSessionId, message });
});

/**
 * Endpoint pour vérifier la validité d'une session
 * GET /session-status/:accountId/:sessionId
 * Réponse : { valid: boolean, message: string }
 */
app.get('/session-status/:accountId/:sessionId', (req, res) => {
  const { accountId, sessionId } = req.params;
  const current = sessionIds[accountId];
  if (!current) {
    return res.json({ valid: false, message: "Aucune session active pour cet utilisateur." });
  }
  if (current.sessionId !== sessionId) {
    logger.info(`[MULTI-SESSION] Session concurrente détectée pour ${accountId}. Session courante : ${current.sessionId}, session demandée : ${sessionId}`);
    return res.json({ valid: false, message: "Votre session a été invalidée suite à une connexion sur un autre appareil ou onglet." });
  }
  return res.json({ valid: true, message: "Session valide." });
});

/**
 * Fonction utilitaire pour invalider la session d'un utilisateur (ex: à la déconnexion)
 */
function invalidateSession(accountId) {
  if (sessionIds[accountId]) {
    logger.info(`[SESSION] Déconnexion/invalidation de la session pour ${accountId} (sessionId: ${sessionIds[accountId].sessionId})`);
    delete sessionIds[accountId];
  }
}

/**
 * Endpoint pour la synchronisation de session (heartbeat)
 * POST /session-sync/:accountId
 * Permet à un client de signaler qu'il est toujours actif pour un compte donné.
 * Réponse : { success: boolean }
 */
app.post('/session-sync/:accountId', async (req, res) => {
  const logger = await getLogger(); // Obtenir le logger
  const { accountId } = req.params;

  if (!accountId) {
    logger.warn('[SESSION-SYNC] Tentative de synchronisation sans accountId.');
    return res.status(400).json({ success: false, message: "accountId requis dans l'URL." });
  }

  try {
    const activeSession = sessionIds[accountId];

    if (activeSession) {
      // La session existe côté serveur, renvoyer l'état
      logger.info(`[SESSION-SYNC] Session active trouvée pour ${accountId}. Renvoi de l'état.`);

      const startTime = activeSession.timestamp;
      let sessionEnd = null;
      let status = 'active'; // Statut par défaut si la session existe

      // Calculer sessionEnd à partir de sessionTimes
      const sessionTimeData = sessionTimes[accountId];
      if (sessionTimeData && typeof sessionTimeData.remainingTime === 'number' && typeof sessionTimeData.lastUpdate === 'number') {
        const now = Date.now();
        const elapsedSinceLastUpdate = Math.max(0, now - sessionTimeData.lastUpdate);
        const currentRemainingTime = Math.max(0, sessionTimeData.remainingTime - elapsedSinceLastUpdate);

        if (currentRemainingTime > 0) {
          sessionEnd = now + currentRemainingTime;
          logger.debug(`[SESSION-SYNC] Calcul de sessionEnd pour ${accountId}: ${new Date(sessionEnd).toISOString()} (remaining: ${currentRemainingTime}ms)`);
        } else {
          status = 'expired'; // Marquer comme expiré si le temps est écoulé
          logger.info(`[SESSION-SYNC] Le temps de session calculé pour ${accountId} est écoulé.`);
          // Optionnel : Invalider la session ici si le temps est écoulé ?
          // invalidateSession(accountId); // Décommenter si nécessaire
        }
      } else {
        logger.warn(`[SESSION-SYNC] Pas de données de temps de session (sessionTimes) trouvées ou valides pour ${accountId}. sessionEnd sera null.`);
      }

      // Construire l'objet d'état
      const serverState = {
        accountId: accountId,
        status: status, // 'active' ou 'expired'
        startTime: startTime,
        sessionEnd: sessionEnd, // Timestamp de fin ou null
        // Ajouter d'autres champs si nécessaire, ex:
        // lastActivity: activeSession.timestamp // Ou une autre métrique si disponible
      };

      return res.json({ serverState });

    } else {
      // La session n'existe pas côté serveur, demander la suppression locale
      //logger.debug(`[SESSION-SYNC] Aucune session active trouvée pour ${accountId}. Demande de suppression locale.`);
      //return res.json({ action: 'delete_local' });
    }

  } catch (error) {
    logger.error(`[SESSION-SYNC] Erreur lors de la synchronisation pour ${accountId}:`, error);
    // Renvoyer une erreur générique ou une action de suppression par sécurité
    return res.status(500).json({ action: 'delete_local', message: 'Erreur serveur lors de la synchronisation.' });
  }
});
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
app.post('/config', async (req, res) => {
  const newConfigValues = req.body;
  await updateConfig(newConfigValues); // Appelle la fonction de mise à jour

  res.json({ success: true, message: 'Configuration reçue et appliquée.' });
});

// Nouveau endpoint POST /api/config pour la persistance web
app.post('/api/config', async (req, res) => {
  const newConfigValues = req.body;
  await updateConfig(newConfigValues);
  res.json({ success: true, message: 'Configuration web sauvegardée.' });
});

// Route pour obtenir le port sur lequel le serveur écoute réellement
app.get('/api/config', (req, res) => {
  if (actualServerPort) {
    res.json({ port: actualServerPort });
  } else {
    // Si le serveur n'a pas encore démarré ou si le port n'est pas encore défini
    res.status(503).json({ error: "Informations sur le port non encore disponibles." });
  }
});

// Route pour obtenir la liste des comptes (sans mots de passe)
app.get('/accounts', async (req, res) => {
  try {
    const allAccounts = await loadAccountsFromJSON();
    // Retire les mots de passe avant d'envoyer
    // Inclure sessionEnd dans la réponse pour chaque compte
    const accountsWithSessionEnd = allAccounts.map(account => {
      // Utilise la vraie logique Playwright pour le temps restant
      const remainingMs = getSessionRemainingTime(account.id);
      let elapsedMs = null;
      // Récupérer le temps passé sur la session Playwright si active
      if (global.sessionTimes && global.sessionTimes.has(account.id)) {
        const data = global.sessionTimes.get(account.id);
        if (data && typeof data.accumulatedTimeMs === 'number') {
          elapsedMs = data.accumulatedTimeMs;
        }
      }
      if (typeof remainingMs === 'number' && remainingMs > 0) {
        return { ...account, sessionEnd: Date.now() + remainingMs, elapsedMs };
      }
      // Correction : si sessionDuration est définie, calculer sessionEnd à partir de maintenant
      if (account.sessionDuration) {
        const durationMatch = account.sessionDuration.match(/^(\d+(\.\d+)?)h$/);
        if (durationMatch) {
          const durationMs = parseFloat(durationMatch[1]) * 60 * 60 * 1000;
          return { ...account, sessionEnd: Date.now() + durationMs, elapsedMs };
        }
      }
      return { ...account, sessionEnd: null, elapsedMs };
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

  // Sauvegarder la structure sessionTimes dans le fichier ⚠️ Ne pas réactiver 
  try {
    //await writeSessionTimes(sessionTimesPath, sessionTimes);
    //logger.debug(`sessionTimes sauvegardé dans ${sessionTimesPath}`);
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

// --- API pour la synchronisation du temps ---
app.get('/api/time', (req, res) => {
  const serverTimestamp = Date.now();
  logger.debug(`Requête /api/time reçue, renvoi de ${serverTimestamp}`);
  res.json({ serverTime: serverTimestamp });
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
                // --- Réinitialisation du temps Playwright pour ce compte ---
                if (!global.sessionTimes) global.sessionTimes = new Map();
                global.sessionTimes.set(accountId, {
                    accumulatedTimeMs: 0,
                    sessionDurationMs: durationMs
                });
            } else {
                merged.sessionEnd = null;
                if (global.sessionTimes) global.sessionTimes.delete(accountId);
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
 
// Nouvelle route pour lister tous les comptes configurés (ID et nom/email)
app.get('/api/accounts/list', async (req, res) => {
  const logger = await getLogger(); // Obtenir le logger
  try {
    const allAccounts = await loadAccountsFromJSON();
    // Mapper les comptes pour ne renvoyer que l'ID et un nom (utilise l'email si pas de champ 'name')
    const accountList = allAccounts.map(account => ({
      id: account.id,
      name: account.name || account.email // Utilise account.name si défini, sinon account.email
    }));
    logger.info(`[API /api/accounts/list] Renvoi de ${accountList.length} comptes.`);
    res.json(accountList);
  } catch (error) {
    logger.error(`[API /api/accounts/list] Erreur lors du chargement ou du traitement des comptes:`, error);
    // Gérer spécifiquement l'erreur si le fichier n'existe pas
    if (error.message.includes('est manquant')) {
       res.status(404).json({ success: false, message: "Le fichier de configuration des comptes est introuvable." });
    } else {
       res.status(500).json({ success: false, message: "Erreur serveur lors de la récupération de la liste des comptes." });
    }
  }
});

// Route pour récupérer l'ID du compte authentifié (EXISTANTE, NE PAS SUPPRIMER)
app.get('/api/account/id/:accountId/:sessionId', async (req, res) => {
  const logger = await getLogger(); // Obtenir le logger
  const { accountId, sessionId } = req.params;

  if (!accountId || !sessionId) {
    logger.warn('[API /api/account/id] Paramètres accountId ou sessionId manquants.');
    return res.status(400).json({ success: false, message: "Les paramètres accountId et sessionId sont requis." });
  }

  const currentSession = sessionIds[accountId];

  if (!currentSession) {
    logger.info(`[API /api/account/id] Aucune session active trouvée pour ${accountId}.`);
    return res.status(401).json({ success: false, message: "Utilisateur non authentifié ou session expirée." });
  }

  if (currentSession.sessionId !== sessionId) {
    logger.warn(`[API /api/account/id] Tentative d'accès avec un sessionId invalide pour ${accountId}. Attendu: ${currentSession.sessionId}, Reçu: ${sessionId}`);
    return res.status(401).json({ success: false, message: "Session invalide ou expirée." });
  }

  // Si la session est valide
  logger.info(`[API /api/account/id] Accès autorisé pour ${accountId}. Renvoi de l'ID.`);
  res.json({ success: true, accountId: accountId });
});
// --- Fin API CRUD ---


// TODO: Servir les fichiers statiques (index.html, script.js, style.css)
// app.use(express.static('public')); // Si les fichiers sont dans un dossier 'public'

// Servir les fichiers statiques (index.html, script.js, style.css) depuis la racine du projet
// Log pour vérifier si les requêtes statiques arrivent
app.use((req, res, next) => {
  console.log(`[STATIC] Requête reçue pour : ${req.path}`);
  next();
});
app.use(express.static(path.resolve('./')));

// --- Server Startup Logic with Port Retry ---

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10; // Try ports 3000 to 3009

async function attemptListen(portToTry) {
  return new Promise((resolve, reject) => {
    httpServer.listen(portToTry)
      .on('listening', async () => { // Utiliser async ici pour le chargement
        // Utilise le port réellement lié par le serveur pour éviter les décalages
        const address = httpServer.address();
        const boundPort = address && typeof address.port === 'number' ? address.port : portToTry;
        actualServerPort = boundPort; // Stocke le port réel
        console.log(`Serveur web + socket.io démarré sur http://localhost:${boundPort}`);
        logger.info(`Server listening on port ${boundPort}`);

        // --- Chargement des temps de session persistants au démarrage ---
        const notificationPath = path.resolve('config/session_times_notification.json');
        try {
          sessionTimes = await readSessionTimes(sessionTimesPath);
          logger.debug(`sessionTimes chargé depuis ${sessionTimesPath}`);
          // Nettoyer la notification si tout va bien
          try {
            await fs.unlink(notificationPath);
          } catch (e) {
            // Ignore si le fichier n'existe pas
          }
        } catch (error) {
          if (error.code === 'ENOENT') {
            logger.debug(`Fichier ${sessionTimesPath} non trouvé, initialisation de sessionTimes vide.`);
            sessionTimes = {}; // Assure que sessionTimes est un objet vide si le fichier n'existe pas
            // Notification explicite pour le frontend
            await fs.writeFile(notificationPath, JSON.stringify({
              type: "warning",
              message: `Le fichier ${sessionTimesPath} est absent. Les temps de session ont été réinitialisés.`
            }, null, 2));
          } else {
            logger.error(`Erreur lors du chargement de ${sessionTimesPath}:`, error);
            sessionTimes = {}; // En cas d'erreur de lecture/parsing, repartir de zéro
            // Notification explicite pour le frontend
            await fs.writeFile(notificationPath, JSON.stringify({
              type: "error",
              message: `Le fichier ${sessionTimesPath} est corrompu ou illisible. Les temps de session ont été réinitialisés.`
            }, null, 2));
          }
        }
        // --- Fin Chargement ---

        resolve({ app, io, httpServer, port: portToTry }); // Resolve with the actual port
      })
      .on('error', (err) => {
        reject(err); // Reject with the error for the main startServer function to handle
      });
  });
}

async function startServer() {
  let currentPort = DEFAULT_PORT;
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    try {
      logger.info(`Attempting to start server on port ${currentPort}...`);
      const result = await attemptListen(currentPort);
      return result; // Success! Return the server details including the port.
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        logger.warn(`Port ${currentPort} is already in use. Trying next port...`);
        currentPort++; // Increment port and try again in the next loop iteration
      } else {
        // Different error, rethrow it
        logger.error(`Failed to start server due to non-port conflict error: ${error.message}`);
        throw error; // Propagate other errors
      }
    }
  }
  // If loop finishes without success
  const finalErrorMsg = `Failed to start server. All ports from ${DEFAULT_PORT} to ${currentPort - 1} are in use or another error occurred.`;
  logger.error(finalErrorMsg);
  throw new Error(finalErrorMsg);
}


export { startServer, io, sessionTimes };