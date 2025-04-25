import cors from 'cors'; // Importe le middleware CORS
import express from 'express';
import fs from 'fs/promises'; // Importe le module fs pour les opérations sur les fichiers
import path from 'path'; // Importe le module path pour gérer les chemins
import { config, updateConfig, loadAccountsFromJSON } from './config_loader.js'; // Importe la config, la mise à jour et loadAccountsFromJSON
import logger from './logger.js'; // Importe le logger

import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

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

// --- API pour recevoir les mises à jour du temps de session ---
// Route pour obtenir la configuration actuelle
// Route pour obtenir la configuration actuelle (exclut les secrets)
app.get('/config', (req, res) => {
  const currentConfig = { ...config }; // Copie pour éviter de modifier l'original
  delete currentConfig.OPENAI_API_KEY; // Exclut la clé API

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
      if (sessionObj && typeof sessionObj === 'object') {
        if (
          Object.prototype.hasOwnProperty.call(sessionObj, 'sessionEnd') &&
          typeof sessionObj.sessionEnd === 'number' &&
          !isNaN(sessionObj.sessionEnd)
        ) {
          return { ...account, sessionEnd: sessionObj.sessionEnd };
        } else if (
          Object.prototype.hasOwnProperty.call(sessionObj, 'remainingTime') &&
          typeof sessionObj.remainingTime === 'number' &&
          !isNaN(sessionObj.remainingTime)
        ) {
          return { ...account, sessionEnd: Date.now() + sessionObj.remainingTime };
        }
      }
      // Fallback : logique précédente
      if (account.sessionEnd !== undefined && account.sessionEnd !== null) {
        return { ...account, sessionEnd: Number(account.sessionEnd) };
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
      const activeAccounts = JSON.parse(data);
      res.json(activeAccounts); // Renvoie le tableau des IDs actifs
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

// Route pour recevoir les mises à jour de session du frontend
app.post('/session-update/:accountId', async (req, res) => { // Ajout de async ici
  const { accountId } = req.params;
  const sessionData = req.body;

  logger.info(`Mise à jour de session reçue pour ${accountId}:`, sessionData);

  // Mettre à jour la structure en mémoire sessionTimes
  // Stocker l'objet entier reçu pour ce compte pour flexibilité
  sessionTimes[accountId] = sessionData;

  // Sauvegarder la structure sessionTimes dans le fichier
  try {
    await fs.mkdir(path.dirname(sessionTimesPath), { recursive: true });
    await fs.writeFile(sessionTimesPath, JSON.stringify(sessionTimes, null, 2));
    logger.info(`sessionTimes sauvegardé dans ${sessionTimesPath}`);
  } catch (error) {
    logger.error(`Erreur lors de la sauvegarde de sessionTimes dans ${sessionTimesPath}:`, error);
    // Ne pas bloquer la réponse même si la sauvegarde échoue
  }

  // Log spécifique si des clés connues sont présentes
  if (sessionData.remainingTime !== undefined) {
    logger.info(`Temps restant reçu pour ${accountId}: ${sessionData.remainingTime}`);
  } else if (sessionData.sessionEnd !== undefined) {
    logger.info(`SessionEnd reçu pour ${accountId}: ${new Date(sessionData.sessionEnd).toISOString()}`);
  }

  // Répondre au frontend
  res.json({ success: true });
});

// --- API CRUD pour les comptes (config/accounts_config.json) ---
// Fonction utilitaire pour lire les comptes depuis JSON
async function readAccountsFile() {
    try {
        const data = await fs.readFile(activeAccountsPath.replace('active_accounts.json', 'accounts_config.json'), 'utf-8'); // Assurez-vous que le chemin est correct
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return []; // Retourne un tableau vide si le fichier n'existe pas
        }
        throw error; // Relance les autres erreurs
    }
}

// Fonction utilitaire pour écrire les comptes dans JSON
async function writeAccountsFile(accounts) {
    const accountsPath = activeAccountsPath.replace('active_accounts.json', 'accounts_config.json');
    await fs.mkdir(path.dirname(accountsPath), { recursive: true });
    await fs.writeFile(accountsPath, JSON.stringify(accounts, null, 2));
}

// Ajouter un nouveau compte
app.post('/accounts', async (req, res) => {
    try {
        const newAccount = req.body;
        // Validation simple
        if (!newAccount.email || !newAccount.password) {
            return res.status(400).json({ success: false, message: 'Email et mot de passe requis.' });
        }

        // Gestion du temps de session
        if (newAccount.sessionDuration) {
            // sessionDuration format: "2h" ou "1.5h"
            const hours = parseFloat(newAccount.sessionDuration.replace('h', ''));
            if (!isNaN(hours) && hours > 0) {
                newAccount.sessionEnd = Date.now() + hours * 60 * 60 * 1000;
            }
        } else {
            newAccount.sessionEnd = null;
        }

        const accounts = await readAccountsFile();

        // Générer un ID unique (simple exemple, pourrait être amélioré)
        const newId = `account_${Date.now()}`;
        newAccount.id = newId;

        accounts.push(newAccount);
        await writeAccountsFile(accounts);

        logger.info(`Nouveau compte ajouté: ${newAccount.email} (ID: ${newId})`);
        // Retourne le compte ajouté (avec son nouvel ID)
        res.status(201).json({ success: true, account: newAccount });
    } catch (error) {
        logger.error('Erreur lors de l\'ajout du compte:', error);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de l\'ajout.' });
    }
});

// Modifier un compte existant
app.put('/accounts/:id', async (req, res) => {
    try {
        const accountId = req.params.id;
        const updatedData = req.body;
        // Ne pas permettre la modification de l'ID
        delete updatedData.id;

        // Validation : n'exiger email et mot de passe que si on tente de les modifier
        if (
            (Object.prototype.hasOwnProperty.call(updatedData, 'email') && !updatedData.email) ||
            (Object.prototype.hasOwnProperty.call(updatedData, 'password') && !updatedData.password)
        ) {
            return res.status(400).json({ success: false, message: 'Email ou mot de passe vide non autorisé.' });
        }


        const accounts = await readAccountsFile();
        const accountIndex = accounts.findIndex(acc => acc.id === accountId);

        if (accountIndex === -1) {
            return res.status(404).json({ success: false, message: 'Compte non trouvé.' });
        }

        // Fusionne les anciennes données avec les nouvelles
        // Gestion du temps de session lors de la modification
        let merged = { ...accounts[accountIndex], ...updatedData };
        if (updatedData.sessionDuration) {
            const hours = parseFloat(updatedData.sessionDuration.replace('h', ''));
            if (!isNaN(hours) && hours > 0) {
                merged.sessionEnd = Date.now() + hours * 60 * 60 * 1000;
            }
        }
        // Si sessionDuration supprimé, sessionEnd devient null
        if (updatedData.sessionDuration === "" || updatedData.sessionDuration === null) {
            merged.sessionEnd = null;
        }
        accounts[accountIndex] = merged;

        await writeAccountsFile(accounts);
        logger.info(`Compte modifié: ${accounts[accountIndex].email} (ID: ${accountId})`);
        res.json({ success: true, account: accounts[accountIndex] });
    } catch (error) {
        logger.error(`Erreur lors de la modification du compte ${req.params.id}:`, error);
        res.status(500).json({ success: false, message: 'Erreur serveur lors de la modification.' });
    }
});

// Supprimer un compte
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
        logger.error(`Erreur lors de la suppression du compte ${req.params.id}:`, error);
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
        const data = await fs.readFile(sessionTimesPath, 'utf-8');
        sessionTimes = JSON.parse(data);
        logger.info(`sessionTimes chargé depuis ${sessionTimesPath}`);
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.info(`Fichier ${sessionTimesPath} non trouvé, initialisation de sessionTimes vide.`);
          sessionTimes = {}; // Assure que sessionTimes est un objet vide si le fichier n'existe pas
        } else {
          logger.error(`Erreur lors du chargement de ${sessionTimesPath}:`, error);
          sessionTimes = {}; // En cas d'erreur de lecture/parsing, repartir de zéro
        }
      }

      // --- Initialisation des sessions actives au démarrage ---
      try {
        logger.info('--- Début Initialisation des sessions actives au démarrage ---');
        const allAccounts = await loadAccountsFromJSON();
        logger.info(`Comptes chargés pour initialisation: ${allAccounts.length}`);
        const activeAccountIds = await fs.readFile(activeAccountsPath, 'utf-8')
          .then(data => JSON.parse(data))
          .catch(error => {
            if (error.code === 'ENOENT') {
              logger.info('Fichier active_accounts.json non trouvé, aucun compte actif à initialiser.');
              return []; // Fichier non trouvé, pas de comptes actifs
            }
            throw error;
          });
        logger.info(`IDs des comptes actifs chargés: ${activeAccountIds.join(', ')}`);

        const now = Date.now();
        allAccounts.forEach(account => {
          logger.info(`Traitement du compte ${account.id}: sessionDuration=${account.sessionDuration}, sessionEnd=${account.sessionEnd}`);
          // Vérifier si le compte est actif ET a une durée de session
          if (activeAccountIds.includes(account.id) && account.sessionDuration) {
            const hours = parseFloat(account.sessionDuration.replace('h', ''));
            if (!isNaN(hours) && hours > 0) {
              // Si sessionEnd n'est pas défini ou est dans le passé, le recalculer
              if (account.sessionEnd === undefined || account.sessionEnd === null || Number(account.sessionEnd) <= now) {
                 account.sessionEnd = now + hours * 60 * 60 * 1000;
                 logger.info(`Initialisation de sessionEnd pour le compte actif ${account.id} à ${new Date(account.sessionEnd).toISOString()}`);
              } else {
                 // Si sessionEnd est déjà défini et dans le futur, s'assurer qu'il est un nombre
                 account.sessionEnd = Number(account.sessionEnd);
                 logger.info(`SessionEnd existant pour le compte actif ${account.id}: ${new Date(account.sessionEnd).toISOString()}`);
              }
              // Stocker le temps restant initial en mémoire
              sessionTimes[account.id] = account.sessionEnd - now;
              logger.info(`Temps restant initial en mémoire pour ${account.id}: ${sessionTimes[account.id]} ms`);
            } else {
               // Si le compte est actif mais n'a pas de durée de session valide, s'assurer que sessionEnd est null
               account.sessionEnd = null;
               if (sessionTimes[account.id]) delete sessionTimes[account.id]; // Retirer de la mémoire si présent
               logger.info(`Compte actif ${account.id} sans sessionDuration valide, sessionEnd mis à null.`);
            }
          } else {
             // Si le compte n'est pas actif, s'assurer que sessionEnd est null
             account.sessionEnd = null;
             if (sessionTimes[account.id]) delete sessionTimes[account.id]; // Retirer de la mémoire si présent
             logger.info(`Compte ${account.id} non actif, sessionEnd mis à null.`);
          }
        }); 
        
        logger.info('--- Fin Initialisation des sessions actives ---');
        resolve({ app, io, httpServer });
      } catch (error) {
        logger.error('Erreur lors de l\'initialisation des sessions actives:', error);
        reject(error);
      }
    }).on('error', reject);
  });
}

export { startServer, io, sessionTimes };