/**
 * @fileoverview Module pour la synchronisation régulière du temps avec le serveur.
 */

// Intégration du gestionnaire offline
import * as offlineManager from './offline_manager.js';

const SYNC_INTERVAL_MS = 60000; // Intervalle de synchronisation (ex: 1 minute)
const MAX_ALLOWED_DIFF_MS = 5000; // Différence maximale tolérée pour considérer l'horloge comme "correcte" (ex: 5 secondes)
const CLOCK_SKEW_THRESHOLD_MS = 10000; // Seuil d'écart pour déclencher un avertissement (ex: 10 secondes)
const MAX_CONSECUTIVE_ANOMALIES = 3; // Nombre d'anomalies consécutives avant de bloquer la session

let syncIntervalId = null;
let isConnected = true; // Supposons connecté au démarrage
let lastServerTime = null;
let timeOffset = 0; // Différence calculée entre l'heure serveur et l'heure locale
let consecutiveAnomalies = 0; // Compteur d'anomalies d'horloge consécutives
let isSessionBlockedBySkew = false; // Indicateur de blocage de session dû à la désynchronisation

/**
 * Logger interne pour ce module.
 */
const logger = {
    log: (...args) => console.log('[TimeSync]', ...args),
    warn: (...args) => console.warn('[TimeSync]', ...args),
    error: (...args) => console.error('[TimeSync]', ...args),
};

/**
 * Récupère l'heure actuelle du serveur.
 * @returns {Promise<number>} Timestamp UTC du serveur.
 * @throws {Error} Si la requête échoue ou si la réponse est invalide.
 */
async function fetchServerTime(retries = 3, timeoutMs = 5000) {
    let lastError = null;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Timeout explicite via Promise.race
            const response = await Promise.race([
                fetch('/api/time'),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout de la requête fetchServerTime')), timeoutMs)
                )
            ]);
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            const data = await response.json();
            // Validation stricte de la réponse
            if (!data || typeof data.serverTime !== 'number' || isNaN(data.serverTime)) {
                throw new Error('Réponse invalide ou format d\'heure incorrect du serveur.');
            }
            // Assertion interne
            if (data.serverTime < 0 || data.serverTime > Number.MAX_SAFE_INTEGER) {
                throw new Error('Assertion interne: serverTime hors bornes');
            }
            logger.log(`Heure serveur reçue: ${new Date(data.serverTime).toISOString()} (${data.serverTime})`);
            return data.serverTime;
        } catch (error) {
            logger.error(`Erreur lors de la récupération de l'heure serveur (tentative ${attempt}/${retries}):`, error);
            lastError = error;
            // Attendre un court délai avant retry sauf dernière tentative
            if (attempt < retries) {
                await new Promise(res => setTimeout(res, 500));
            }
        }
    }
    // Fallback explicite après tous les essais
    throw new Error(`Échec de récupération de l'heure serveur après ${retries} tentatives: ${lastError && lastError.message}`);
}

/**
 * Gère le blocage de la session suite à des anomalies d'horloge persistantes.
 */
function handlePersistentSkew() {
    if (!isSessionBlockedBySkew) {
        logger.warn(`Blocage de la session en raison d'anomalies d'horloge persistantes (${consecutiveAnomalies} détectées).`);
        isSessionBlockedBySkew = true;
        displayWarning('Manipulation de l\'horloge détectée. La session est temporairement bloquée. Veuillez corriger l\'heure de votre système.', true); // true pour indiquer un message bloquant
        suspendCriticalActions();
    }
}

/**
 * Gère la correction de l'horloge après un blocage ou un avertissement.
 */
function handleClockCorrected() {
    logger.log('L\'horloge système semble de nouveau synchronisée.');
    consecutiveAnomalies = 0; // Réinitialise le compteur
    if (isSessionBlockedBySkew) {
        logger.log('Déblocage de la session suite à la correction de l\'horloge.');
        isSessionBlockedBySkew = false;
        hideWarning(); // Cache le message (bloquant ou non)
        resumeCriticalActions(); // Reprend les actions
        // Optionnel: Afficher une notification de confirmation
        // showNotification('L\'heure système est correcte. Session réactivée.', 'success');
    } else {
        // Si la session n'était pas bloquée, on cache juste l'avertissement simple s'il y en avait un
        hideWarning();
    }
}

/**
 * Compare l'heure locale et l'heure serveur, gère les écarts, avertissements et blocages.
 * @param {number} serverTimestamp - Timestamp UTC du serveur.
 */
const compareAndAdjustTime = (() => {
    // Mutex simple pour éviter les appels concurrents
    let isSyncing = false;
    return function compareAndAdjustTime(serverTimestamp) {
        if (isSyncing) {
            logger.warn('Appel concurrent à compareAndAdjustTime ignoré (mutex actif).');
            return;
        }
        isSyncing = true;
        try {
            // Validation stricte du paramètre
            if (
                serverTimestamp === null ||
                serverTimestamp === undefined ||
                typeof serverTimestamp !== 'number' ||
                isNaN(serverTimestamp) ||
                serverTimestamp < 0 ||
                serverTimestamp > Number.MAX_SAFE_INTEGER
            ) {
                throw new Error('Paramètre serverTimestamp invalide dans compareAndAdjustTime');
            }

            const localTimestamp = Date.now();
            const currentOffset = serverTimestamp - localTimestamp;
            const absoluteSkew = Math.abs(currentOffset); // Écart absolu par rapport au serveur

            // Assertion interne
            if (Math.abs(currentOffset) > 10 * 365 * 24 * 60 * 60 * 1000) { // >10 ans
                throw new Error('Assertion interne: écart serveur/local aberrant');
            }

            logger.log(`Heure locale: ${new Date(localTimestamp).toISOString()}, Heure serveur: ${new Date(serverTimestamp).toISOString()}, Offset actuel: ${currentOffset}ms`);

            // 1. Vérification de l'écart anormal pour avertissement/incrémentation
            if (absoluteSkew > CLOCK_SKEW_THRESHOLD_MS) {
                consecutiveAnomalies++;
                logger.warn(`Anomalie d'horloge détectée (${consecutiveAnomalies}/${MAX_CONSECUTIVE_ANOMALIES}). Écart absolu: ${absoluteSkew}ms (Seuil: ${CLOCK_SKEW_THRESHOLD_MS}ms)`);
                displayWarning(`Attention: L'heure de votre système (${new Date(localTimestamp).toLocaleTimeString()}) semble incorrecte par rapport à l'heure serveur (${new Date(serverTimestamp).toLocaleTimeString()}). Écart: ${Math.round(absoluteSkew / 1000)}s.`);

                // 2. Vérification du blocage si anomalies consécutives dépassent le max
                if (consecutiveAnomalies >= MAX_CONSECUTIVE_ANOMALIES) {
                    handlePersistentSkew();
                }
            }
            // 3. Vérification si l'horloge est redevenue correcte (dans la tolérance générale)
            else if (absoluteSkew <= MAX_ALLOWED_DIFF_MS) {
                // Si l'horloge était précédemment anormale ou bloquée, on gère la correction
                if (consecutiveAnomalies > 0 || isSessionBlockedBySkew) {
                    handleClockCorrected();
                }
                // Si tout est normal et l'était déjà, on s'assure juste que l'avertissement est caché
                else {
                    hideWarning();
                }
                consecutiveAnomalies = 0; // Réinitialise si l'écart est faible, même si pas d'avertissement préalable
            }
            // 4. Cas intermédiaire : l'écart est > MAX_ALLOWED_DIFF_MS mais <= CLOCK_SKEW_THRESHOLD_MS
            // On ne fait rien de spécial ici, on ne réinitialise pas consecutiveAnomalies,
            // mais on ne déclenche pas non plus d'avertissement ou de blocage. L'offset sera mis à jour.

            // Met à jour l'offset et l'état de connexion SEULEMENT si la session n'est PAS bloquée
            if (!isSessionBlockedBySkew) {
                timeOffset = currentOffset;
                isConnected = true;
                // On ne reprend les actions que si elles étaient suspendues pour une autre raison (déconnexion)
                // et que l'horloge est maintenant correcte. La reprise après blocage est gérée dans handleClockCorrected.
                if (!isSessionBlockedBySkew && absoluteSkew <= MAX_ALLOWED_DIFF_MS) {
                    resumeCriticalActions();
                }
            }

            lastServerTime = serverTimestamp; // Toujours garder une trace de la dernière heure serveur reçue
        } finally {
            isSyncing = false;
        }
    };
})();


/**
 * Gère la perte de connexion détectée lors de la tentative de synchronisation.
 */
function handleDisconnection() {
    if (isConnected || isSessionBlockedBySkew) { // Gérer aussi si on était bloqué
        logger.warn('Perte de connexion détectée ou état incohérent. Suspension des actions critiques et réinitialisation de l\'état de l\'horloge.');
        isConnected = false;
        isSessionBlockedBySkew = false; // Débloquer si la connexion est perdue
        consecutiveAnomalies = 0;
        lastServerTime = null; // Invalide la dernière heure serveur connue
        displayWarning('Connexion au serveur perdue. Tentative de resynchronisation en cours...');
        suspendCriticalActions(); // Met en pause les actions dépendantes du temps
        // Active le mode offline centralisé
        offlineManager.setOffline();
    }
}

/**
 * Tente de synchroniser l'heure avec le serveur.
 */
async function synchronizeTime() {
    // Ne pas tenter si la session est bloquée par l'utilisateur (autre mécanisme) ou explicitement arrêtée
    if (isSessionBlockedBySkew) {
        logger.log('Synchronisation ignorée car la session est bloquée par désynchronisation d\'horloge.');
        // On pourrait quand même tenter de fetch l'heure pour voir si elle s'est corrigée,
        // mais attendons le prochain intervalle normal pour éviter des appels excessifs.
        return;
    }
    logger.log('Tentative de synchronisation de l\'heure...');
    try {
        const serverTimestamp = await fetchServerTime();
        // La logique de reconnexion est maintenant implicite dans compareAndAdjustTime
        compareAndAdjustTime(serverTimestamp);
        // Si la connexion a été rétablie et que l'horloge est correcte,
        // compareAndAdjustTime appellera handleClockCorrected qui appellera resumeCriticalActions.

        // Si on était offline, on repasse online (détection de reconnexion)
        if (offlineManager.isOffline()) {
            await offlineManager.setOnline();
        }

        // Valider l'état de la session après une synchro réussie pourrait être pertinent
        // validateSessionState(); // À implémenter si besoin spécifique
    } catch (error) {
        // L'erreur est déjà loggée dans fetchServerTime
        handleDisconnection();
    }
}

/**
 * Démarre la synchronisation périodique de l'heure.
 */
function startPeriodicSync() {
    // Guard : empêcher plusieurs setInterval simultanés
    if (syncIntervalId !== null) {
        logger.warn('startPeriodicSync appelé alors qu\'un intervalle est déjà actif. Appel ignoré.');
        return;
    }
    // Assertion interne
    if (typeof syncIntervalId !== 'object' && syncIntervalId !== null) {
        throw new Error('Assertion interne: syncIntervalId dans un état inattendu');
    }
    logger.log(`Démarrage de la synchronisation périodique toutes les ${SYNC_INTERVAL_MS / 1000} secondes.`);
    // Réinitialiser l'état au démarrage
    isConnected = true; // Supposer connecté au début
    isSessionBlockedBySkew = false;
    consecutiveAnomalies = 0;
    lastServerTime = null;
    timeOffset = 0;

    // Intégration : suspendre/reprendre les actions critiques selon le statut offline/online
    offlineManager.onStatusChange(isOnline => {
        if (!isOnline) {
            suspendCriticalActions();
        } else {
            resumeCriticalActions();
        }
    });

    // Effectue une première synchronisation immédiate
    synchronizeTime().then(() => {
        // Lance la synchronisation périodique seulement après la première tentative
        // pour éviter des intervalles qui se chevauchent si la première synchro est longue.
        if (syncIntervalId === null) { // Vérifier si stopPeriodicSync n'a pas été appelé entre temps
            syncIntervalId = setInterval(synchronizeTime, SYNC_INTERVAL_MS);
            logger.log('Intervalle de synchronisation périodique démarré.');
        }
    });

    // Ajoute des écouteurs pour détecter la perte/reprise de connexion du navigateur
    window.addEventListener('offline', handleDisconnection);
    window.addEventListener('online', synchronizeTime); // Tente de resynchroniser immédiatement au retour en ligne
}

/**
 * Arrête la synchronisation périodique.
 */
function stopPeriodicSync() {
    // Guard : ignorer si déjà arrêté
    if (syncIntervalId === null) {
        logger.warn('stopPeriodicSync appelé alors qu\'aucun intervalle n\'est actif. Appel ignoré.');
        return;
    }
    // Assertion interne
    if (typeof syncIntervalId !== 'object') {
        throw new Error('Assertion interne: syncIntervalId dans un état inattendu');
    }
    try {
        clearInterval(syncIntervalId);
        logger.log('Synchronisation périodique arrêtée.');
    } catch (e) {
        logger.error('Erreur lors de l\'arrêt de l\'intervalle de synchronisation :', e);
    } finally {
        syncIntervalId = null;
    }
    // Nettoyer aussi les autres états si nécessaire
    // isConnected = false; // Ou laisser l'état tel quel ?
    // isSessionBlockedBySkew = false;
    // consecutiveAnomalies = 0;
    window.removeEventListener('offline', handleDisconnection);
    window.removeEventListener('online', synchronizeTime);
}

// --- Fonctions Placeholder pour l'intégration ---
// Ces fonctions devront être implémentées ou remplacées
// par les mécanismes réels de l'application.

/**
 * Placeholder: Affiche un message d'avertissement ou de blocage à l'utilisateur.
 * Cette fonction DOIT être implémentée ou surchargée par le code client (ex: script.js).
 * @param {string} message - Le message à afficher.
 * @param {boolean} [isBlocking=false] - Indique si le message est un blocage critique.
 */
let displayWarning = (message, isBlocking = false) => {
    if (isBlocking) {
        logger.error(`AVERTISSEMENT UI (BLOQUANT): ${message}`);
        // Implémentation réelle nécessaire dans script.js pour bloquer l'UI
    } else {
        logger.warn(`AVERTISSEMENT UI: ${message}`);
        // Implémentation réelle nécessaire dans script.js pour afficher une bannière/toast
    }
};

/**
 * Placeholder: Cache le message d'avertissement ou de blocage.
 * Cette fonction DOIT être implémentée ou surchargée par le code client.
 */
let hideWarning = () => {
    logger.log('Masquage de l\'avertissement/blocage UI.');
    // Implémentation réelle nécessaire dans script.js
};

/**
 * Placeholder: Met en pause les actions critiques dépendantes du temps ou de l'état de la session.
 * Cette fonction DOIT être implémentée ou surchargée par le code client.
 */
let _criticalActionsSuspended = false;
let suspendCriticalActions = () => {
    if (_criticalActionsSuspended) {
        logger.warn('suspendCriticalActions appelé alors que les actions sont déjà suspendues. Appel ignoré.');
        return;
    }
    _criticalActionsSuspended = true;
    logger.log('Suspension des actions critiques demandée.');
    // Assertion interne
    if (!_criticalActionsSuspended) {
        throw new Error('Assertion interne: l\'état de suspension n\'a pas été appliqué');
    }
    // Implémentation réelle nécessaire dans script.js (désactiver boutons, etc.)
};

/**
 * Placeholder: Reprend les actions critiques après correction ou reconnexion.
 * Cette fonction DOIT être implémentée ou surchargée par le code client.
 */
let resumeCriticalActions = () => {
    // Vérification interne pour ne pas reprendre si toujours déconnecté ou bloqué
    if (!isConnected) {
        logger.log('Reprise des actions critiques annulée (déconnecté).');
        return;
    }
    if (isSessionBlockedBySkew) {
        logger.log('Reprise des actions critiques annulée (session bloquée par skew).');
        return;
    }
    if (!_criticalActionsSuspended) {
        logger.warn('resumeCriticalActions appelé alors que les actions ne sont pas suspendues. Appel ignoré.');
        return;
    }
    _criticalActionsSuspended = false;
    logger.log('Reprise des actions critiques demandée.');
    // Assertion interne
    if (_criticalActionsSuspended) {
        throw new Error('Assertion interne: l\'état de suspension n\'a pas été levé');
    }
    // Implémentation réelle nécessaire dans script.js (réactiver boutons, etc.)
};

/**
 * Placeholder: Valide l'état de la session auprès du serveur.
 * Peut être utile après une reconnexion ou correction d'horloge.
 * Cette fonction PEUT être implémentée ou surchargée par le code client si nécessaire.
 */
let validateSessionState = async () => {
    logger.log('Validation de l\'état de la session (placeholder)...');
    // Exemple:
    // try {
    //     const response = await fetch('/api/session/status'); // Endpoint à définir
    //     if (!response.ok) throw new Error('Session invalide ou expirée côté serveur');
    //     const sessionData = await response.json();
    //     logger.log('État de la session validé par le serveur.', sessionData);
    //     // Mettre à jour l'UI ou l'état local en fonction de sessionData
    // } catch (error) {
    //     logger.error('Échec de la validation de la session:', error);
    //     // Gérer l'échec (ex: déconnexion de l'utilisateur, affichage d'erreur)
    //     handleSessionValidationError(error); // Fonction à créer
    // }
};

// --- Surcharge des Placeholders (Permet au code client d'injecter ses propres implémentations) ---

/**
 * Permet de définir les implémentations réelles des fonctions d'interaction UI.
 * @param {object} implementations
 * @param {function} [implementations.displayWarning]
 * @param {function} [implementations.hideWarning]
 * @param {function} [implementations.suspendCriticalActions]
 * @param {function} [implementations.resumeCriticalActions]
 * @param {function} [implementations.validateSessionState]
 */
function setUIImplementations(implementations) {
    if (implementations.displayWarning) displayWarning = implementations.displayWarning;
    if (implementations.hideWarning) hideWarning = implementations.hideWarning;
    if (implementations.suspendCriticalActions) suspendCriticalActions = implementations.suspendCriticalActions;
    if (implementations.resumeCriticalActions) resumeCriticalActions = implementations.resumeCriticalActions;
    if (implementations.validateSessionState) validateSessionState = implementations.validateSessionState;
    logger.log('Implémentations UI mises à jour.');
}


// --- Exports ---

/**
 * Pour les développeurs :
 * Si vous souhaitez exécuter une action dépendante du serveur alors que le mode offline est actif,
 * utilisez offlineManager.queueAction(() => votreActionAsync()).
 * Les actions seront automatiquement synchronisées à la reconnexion.
 */

export {
    startPeriodicSync,
    stopPeriodicSync,
    synchronizeTime,
    fetchServerTime,
    setUIImplementations, // Exporter la fonction de configuration
    // États et constantes utiles pour le client
    isConnected,
    isSessionBlockedBySkew,
    timeOffset,
    CLOCK_SKEW_THRESHOLD_MS,
    MAX_ALLOWED_DIFF_MS
    // Ne pas exporter les fonctions placeholder directement si setUIImplementations est utilisé
};