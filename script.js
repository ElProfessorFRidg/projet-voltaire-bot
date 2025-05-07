// --- Switch mode sombre/clair ---
document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('theme-toggle-btn');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-mode');
        if (themeBtn) themeBtn.textContent = '☀️';
    }
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            themeBtn.textContent = isDark ? '☀️' : '🌙';
        });
    }
});

// --- Variable globale pour le port serveur ---
let SERVER_PORT = 3000; // Port par défaut

async function fetchServerConfig() {
    try {
        const response = await fetch('/api/config');
        if (response.ok) {
            const config = await response.json();
            if (config && typeof config.port === 'number') {
                SERVER_PORT = config.port;
                console.log(`Port serveur configuré via /api/config : ${SERVER_PORT}`);
            }
        } else {
            console.warn(`Échec de récupération de /api/config : ${response.status}, utilisation du port actuel de la page`);
            SERVER_PORT = Number(location.port) || SERVER_PORT;
            console.log(`Port serveur basculé sur port de la page : ${SERVER_PORT}`);
        }
    } catch (error) {
        console.error('Erreur fetchServerConfig:', error, 'utilisation du port de la page');
        SERVER_PORT = Number(location.port) || SERVER_PORT;
        console.log(`Port serveur basculé sur port de la page : ${SERVER_PORT}`);
    }
}

// --- Fonction principale contenant la logique de l'application ---
async function startAppLogic() {
    console.log(`Initialisation de l'application avec le port serveur : ${SERVER_PORT}`);
// --- Initialisation de la synchronisation du temps ---
    // --- Références aux éléments UI pour la gestion des avertissements/blocages ---
    const timeSkewWarningDiv = document.getElementById('time-skew-warning');
    const mainContentDiv = document.querySelector('main'); // Ou un autre conteneur principal si pertinent

    // --- Implémentations des fonctions d'interaction UI pour time_sync ---
    const uiImplementations = {
        displayWarning: (message, isBlocking = false) => {
            if (!timeSkewWarningDiv) return;
            timeSkewWarningDiv.textContent = message;
            timeSkewWarningDiv.className = 'warning-banner'; // Reset classes
            if (isBlocking) {
                timeSkewWarningDiv.classList.add('blocking');
            } else {
                timeSkewWarningDiv.classList.add('warning');
            }
            timeSkewWarningDiv.style.display = 'block';
        },
        hideWarning: () => {
            if (timeSkewWarningDiv) {
                timeSkewWarningDiv.style.display = 'none';
                timeSkewWarningDiv.textContent = '';
                timeSkewWarningDiv.className = 'warning-banner'; // Reset classes
            }
        },
        suspendCriticalActions: () => {
            console.log('[UI] Suspension des actions critiques.');
            document.body.classList.add('session-blocked');
            // Désactiver spécifiquement des éléments si nécessaire (ex: formulaires)
            const forms = document.querySelectorAll('form');
            forms.forEach(form => form.setAttribute('disabled', 'true'));
            const buttons = document.querySelectorAll('button');
            buttons.forEach(button => button.setAttribute('disabled', 'true'));
            // Assurez-vous que le bouton de thème reste fonctionnel si souhaité
            const themeBtn = document.getElementById('theme-toggle-btn');
             if (themeBtn) themeBtn.removeAttribute('disabled');
        },
        resumeCriticalActions: () => {
            console.log('[UI] Reprise des actions critiques.');
            document.body.classList.remove('session-blocked');
            // Réactiver les éléments
            const forms = document.querySelectorAll('form');
            forms.forEach(form => form.removeAttribute('disabled'));
             const buttons = document.querySelectorAll('button');
            buttons.forEach(button => button.removeAttribute('disabled'));
            // Gérer les états spécifiques des boutons (ex: boutons 'Lu' des notifs)
             const readNotifButtons = document.querySelectorAll('.mark-read-btn[disabled]');
             readNotifButtons.forEach(btn => {
                 // Ne réactiver que si la condition de désactivation initiale n'est plus vraie
                 // Ici, on suppose que s'il est désactivé, c'est qu'il est 'Lu', donc on ne le réactive pas forcément.
                 // À ajuster selon la logique exacte. Pour l'instant, on les laisse désactivés s'ils l'étaient.
             });
        }
        // validateSessionState: async () => { ... } // Peut être implémenté ici si besoin
    };

    // --- Initialisation de la synchronisation du temps ---
    /**
     * Vérifie si le contexte d'exécution supporte les imports dynamiques ES modules.
     * Affiche une alerte et retourne false si le contexte est file://, about:blank ou CORS-cross-origin.
     * @returns {boolean}
     */
    function checkSupportedContext() {
        const isFileProtocol = location.protocol === 'file:';
        const isAboutBlank = location.href.startsWith('about:blank');
        const isCrossOrigin = !location.origin || location.origin === 'null';
        if (isFileProtocol || isAboutBlank || isCrossOrigin) {
            const msg = [
                "❌ L'application a été ouverte dans un contexte non supporté (file://, about:blank ou cross-origin).",
                "Les imports dynamiques ES modules nécessitent un serveur HTTP (http:// ou https://).",
                "Veuillez lancer l'application via un serveur local (ex: 'npx serve', 'python -m http.server', 'live-server', etc.).",
                "Documentation : https://developer.mozilla.org/fr/docs/Web/JavaScript/Guide/Modules#chargement_de_modules_dans_le_navigateur"
            ].join('\n');
            alert(msg);
            if (typeof uiImplementations?.displayWarning === 'function') {
                uiImplementations.displayWarning(msg, true);
            }
            console.error('[Import dynamique] Contexte non supporté :', { location: location.href, origin: location.origin });
            return false;
        }
        return true;
    }

    /**
     * Charge dynamiquement le module de synchronisation du temps.
     * Gère explicitement les erreurs et adapte le chemin selon le contexte.
     * @returns {Promise<void>}
     */
    async function loadTimeSyncModule() {
        if (!checkSupportedContext()) {
            // Blocage explicite si contexte non supporté
            return;
        }
        let importPath;
        // Utilise une URL absolue basée sur location.origin pour éviter les problèmes de chemin relatifs
        if (location.origin && location.origin !== 'null') {
            importPath = `${location.origin}/src/time_sync.js`;
        } else {
            // Fallback : chemin relatif (peut échouer en file://)
            importPath = './src/time_sync.js';
        }
        try {
            const module = await import(importPath);
            timeSyncModule = module; // Stocker le module chargé
            const { startPeriodicSync, setUIImplementations: setTimeSyncUI } = module;
            // Injecter les implémentations UI dans le module time_sync
            setTimeSyncUI(uiImplementations);
            // Démarrer la synchronisation
            startPeriodicSync();
            console.log('Module de synchronisation du temps chargé, configuré et démarré.');

            // Démarrer l'affichage de l'heure serveur après le chargement du module
            startServerTimeDisplay();
        } catch (error) {
            // Gestion explicite de l’erreur de chargement
            const userMsg = "Erreur critique : Impossible de charger le module de synchronisation du temps. " +
                "Vérifiez que l'application est bien lancée via un serveur HTTP (et non en ouvrant le fichier localement).";
            console.error('[Import dynamique] Erreur lors du chargement ou de la configuration du module de synchronisation du temps :', error, { importPath, location: location.href });
            if (typeof uiImplementations?.displayWarning === 'function') {
                uiImplementations.displayWarning(userMsg, true);
            }
            // Affichage utilisateur
            alert(userMsg + "\n\nDétail : " + error.message);
        }
    }

    // --- Lancement de l’import dynamique modulaire et sécurisé ---
    let timeSyncModule = null; // Pour stocker les exports du module
    loadTimeSyncModule();

    // --- Affichage de l'heure serveur ---
    const serverTimeValueSpan = document.getElementById('server-time-value');
    let serverTimeIntervalId = null;

    /**
     * Met à jour l'affichage de l'heure serveur en utilisant l'offset calculé.
     */
    function updateServerTimeDisplay() {
        if (!serverTimeValueSpan || !timeSyncModule) return; // Ne rien faire si l'élément ou le module n'est pas prêt

        const { timeOffset, isConnected, isSessionBlockedBySkew } = timeSyncModule;

        if (!isConnected) {
            serverTimeValueSpan.textContent = 'Déconnecté';
            serverTimeValueSpan.style.color = '#ef4444'; // Rouge pour déconnexion
        } else if (isSessionBlockedBySkew) {
             serverTimeValueSpan.textContent = 'Horloge désynchronisée!';
             serverTimeValueSpan.style.color = '#f97316'; // Orange pour désynchro bloquante
        } else {
            // Calculer l'heure serveur estimée
            const estimatedServerTime = new Date(Date.now() + timeOffset);
            // Formater en UTC HH:MM:SS
            const timeString = estimatedServerTime.toLocaleTimeString('fr-FR', {
                timeZone: 'UTC',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false // Format 24h
            });
            serverTimeValueSpan.textContent = `${timeString} (Serveur)`;
            serverTimeValueSpan.style.color = ''; // Couleur par défaut
        }
    }

    /**
     * Démarre la mise à jour périodique de l'affichage de l'heure serveur.
     */
    function startServerTimeDisplay() {
        if (serverTimeIntervalId) {
            clearInterval(serverTimeIntervalId);
        }
        // Mettre à jour toutes les secondes
        serverTimeIntervalId = setInterval(updateServerTimeDisplay, 1000);
        updateServerTimeDisplay(); // Appel immédiat pour afficher dès que possible
        console.log('Affichage de l\'heure serveur démarré.');
    }

    // --- Reste du code de script.js ---
    const accountListDiv = document.getElementById('account-list');
    const configFormDiv = document.getElementById('config-form');
    const addAccountBtn = document.getElementById('add-account-btn');
    const botConfigFormDiv = document.getElementById('bot-config-form');

    let accounts = [];
    let botConfig = {};

    // --- Connexion à socket.io pour la mise à jour temps réel des timers ---
    const socketScript = document.createElement('script');
    socketScript.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
    socketScript.onload = () => {
        console.log(`Connexion Socket.IO sur http://localhost:${SERVER_PORT}`);
        const socket = io(`http://localhost:${SERVER_PORT}`);
        socket.on('connect_error', (err) => {
            console.error(`Erreur de connexion Socket.IO sur port ${SERVER_PORT}:`, err.message);
            showNotification(`Erreur connexion temps réel (Socket.IO) sur port ${SERVER_PORT}.`, "error");
        });
        socket.on('session-time-update', ({ sessionId, timeLeftMs }) => {
            // Cherche le span du timer correspondant
            const span = document.querySelector(`.session-timer[data-account-id="${sessionId}"]`);
            if (span) {
                if (timeLeftMs > 0) {
                    span.textContent = '⏳ ' + formatDuration(timeLeftMs);
                    span.style.color = '';
                } else {
                    span.textContent = 'Expiré';
                    span.style.color = '#ef4444';
                }
            }
        });

        // === Notifications temps réel ===

        socket.on('log', (logData) => {
            // Filtrer pour ne garder que les erreurs et avertissements
            if (logData && (logData.level === 'error' || logData.level === 'warn')) {
                displayLog(logData);
            }
        });
    };
    document.head.appendChild(socketScript);

    let editingAccountId = null; // null = ajout, sinon id du compte à modifier

    // --- Gestion des Comptes (CRUD via API) ---

    // --- Gestion des Comptes (CRUD via API) ---

    // La fonction loadAndRenderAccounts est maintenant définie dans la section Persistance (plus bas)
    // async function loadAndRenderAccounts() { ... }

    // La fonction renderAccountList est maintenant définie dans la section Persistance (plus bas)
    // function renderAccountList() { ... }

    // La fonction updateAllSessionTimers est maintenant définie dans la section Persistance (plus bas)
    // function updateAllSessionTimers() { ... }
    function handleSessionExpired(account) {
        // Exemple : notification toast + décocher le compte
        if (typeof showNotification === 'function') {
            showNotification(`Session expirée pour ${account.email}`, "error");
        }
        // On peut décocher le compte automatiquement si souhaité :
        const checkbox = document.getElementById(`account-checkbox-${account.id}`);
        if (checkbox && checkbox.checked) {
            checkbox.checked = false;
        }
        // Optionnel : forcer une mise à jour de l'affichage
        // updateAllSessionTimers();
    }

    // Formate une durée en ms en HH:MM:SS
    function formatDuration(ms) {
        if (ms < 0) ms = 0; // Ne pas afficher de durée négative
        let totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        totalSec %= 3600;
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${h > 0 ? h + 'h ' : ''}${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }

    // Rafraîchit les timers toutes les secondes
    // Correction : rendre updateAllSessionTimers accessible dans tout le scope
    window.updateAllSessionTimers = updateAllSessionTimers;
    setInterval(updateAllSessionTimers, 1000);

    // Envoie périodiquement les mises à jour de session au serveur pour sauvegarde
    async function sendSessionUpdates() {
        console.log('sendSessionUpdates function called.');
        if (!timeSyncModule) return; // Attendre que le module time_sync soit chargé
        const now = Date.now() + timeSyncModule.timeOffset; // Utiliser l'heure serveur synchronisée

        for (const account of accounts) {
            const checkbox = document.getElementById(`account-checkbox-${account.id}`);
            // N'exécuter le timer et la persistance QUE si le compte est actif (case cochée)
            if (
                checkbox &&
                checkbox.checked &&
                account.sessionDuration &&
                account.sessionEnd !== null
            ) {
                const timeLeftMs = account.sessionEnd - now;
                // Affiche le temps restant dans la console du navigateur
                console.log(`Temps restant pour ${account.email} (${account.id}): ${formatDuration(timeLeftMs)}`);
                // Envoie la mise à jour uniquement si le temps restant est positif
                if (timeLeftMs > 0) {
                    try {
                        await fetch(`http://localhost:${SERVER_PORT}/session-update/${account.id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                remainingTime: timeLeftMs,
                                lastUpdate: now
                            })
                        });
                    } catch (error) {
                        console.error(`Erreur lors de l'envoi de la mise à jour de session pour ${account.id}:`, error);
                    }
                }
            } else {
                // Pour les comptes inactifs, ne rien faire : ni calcul, ni persistance, ni affichage
                // Optionnel : on peut aussi réinitialiser le timer côté client si besoin
                // account.sessionEnd = null; // Décommentez si vous souhaitez réinitialiser la session locale
            }
        }
    }

    // Envoie les mises à jour de session toutes les 5 secondes (ajustable)
    // setInterval(sendSessionUpdates, 5000); // Commenté pour éviter conflits avec la nouvelle logique


    // --- TimeTracker : persistance fiable de la durée (localStorage + API REST) ---
    let trackerDiv = document.getElementById('time-tracker');
    if (!trackerDiv) {
        trackerDiv = document.createElement('div');
        trackerDiv.id = 'time-tracker';
        trackerDiv.style = 'margin:2em 0;padding:1em;border:1px solid #ccc;max-width:350px;background:#f9f9f9;';
        document.body.appendChild(trackerDiv);
    }

    // Durée en ms (persistée)
    let duration = 0;
    let timerInterval = null;
    let isLoading = true; // Ajout d'un état de chargement

    // Utilitaires
    function formatMs(ms) {
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return `${h > 0 ? h + 'h ' : ''}${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }

    function updateDisplay() {
        trackerDiv.innerHTML = `
            <h3>⏱️ TimeTracker (persistance fiable)</h3>
            <div style="font-size:1.3em;margin-bottom:0.5em;">
                <span id="tracker-duration">${isLoading ? 'Chargement...' : formatMs(duration)}</span>
            </div>
            <button id="tracker-inc" ${isLoading ? 'disabled' : ''}>+1 min</button>
            <button id="tracker-dec" ${isLoading ? 'disabled' : ''}>-1 min</button>
            <button id="tracker-reset" ${isLoading ? 'disabled' : ''}>Reset</button>
            <span id="tracker-status" style="margin-left:1em;font-size:0.9em;color:#888;"></span>
        `;
    }

    function saveDuration(newDuration) {
        fetch(`http://localhost:${SERVER_PORT}/api/duration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration: newDuration })
        })
        .then(res => res.json())
        .then(data => {
            document.getElementById('tracker-status').textContent = data.success ? '✅ Sauvegardé' : '❌ Erreur serveur';
            if (!data.success) {
                if (typeof showNotification === 'function') {
                    showNotification('Erreur lors de la sauvegarde de la durée sur le serveur.', 'error');
                }
            }
        })
        .catch(() => {
            document.getElementById('tracker-status').textContent = '❌ Erreur réseau';
            if (typeof showNotification === 'function') {
                showNotification('Erreur réseau : impossible de sauvegarder la durée.', 'error');
            }
        });
    }

    function setDuration(newDuration) {
        duration = Math.max(0, newDuration);
        updateDisplay();
        saveDuration(duration);
    }

    // Gestion des boutons
    trackerDiv.addEventListener('click', (e) => {
        if (isLoading) return; // Empêche toute interaction pendant le chargement
        if (e.target.id === 'tracker-inc') {
            setDuration(duration + 60 * 1000);
        } else if (e.target.id === 'tracker-dec') {
            setDuration(Math.max(0, duration - 60 * 1000));
        } else if (e.target.id === 'tracker-reset') {
            setDuration(0);
        }
    });

    // Chargement initial : API REST uniquement
    function loadDuration() {
        isLoading = true;
        updateDisplay();
        fetch(`http://localhost:${SERVER_PORT}/api/duration`)
            .then(res => res.json())
            .then(data => {
                if (typeof data.duration === 'number' && !isNaN(data.duration)) {
                    duration = data.duration;
                } else {
                    duration = 0;
                    if (typeof showNotification === 'function') {
                        showNotification('Erreur : durée invalide reçue du serveur.', 'error');
                    }
                }
            })
            .catch(() => {
                duration = 0;
                if (typeof showNotification === 'function') {
                    showNotification('Erreur réseau : impossible de charger la durée.', 'error');
                }
            })
            .finally(() => {
                isLoading = false;
                updateDisplay();
            });
    }

    loadDuration();


    // --- Gestion de la Persistance de Session (localStorage + Validation Serveur) ---

    const SESSION_STORAGE_PREFIX = 'sessionState_';

    /**
     * Structure de l'état de session:
     * {
     *   accountId: string,
     *   status: 'running' | 'paused' | 'stopped' | 'expired', // 'paused', 'stopped' pour futures extensions
     *   startTime: number, // Timestamp du début ou de la reprise
     *   accumulatedDuration: number, // ms écoulés avant la dernière pause (pour futures extensions)
     *   sessionDurationLimit: number | null, // ms, null si illimité
     *   sessionEnd: number | null, // Timestamp de fin calculé
     *   lastClientUpdate: number // Timestamp de la dernière sauvegarde locale
     * }
     */

    const sessionLogger = {
        log: (message, ...args) => console.log(`[SessionPersistence] ${message}`, ...args),
        error: (message, ...args) => console.error(`[SessionPersistence] ${message}`, ...args),
        warn: (message, ...args) => console.warn(`[SessionPersistence] ${message}`, ...args),
    };

    /**
     * Sauvegarde l'état de session d'un compte dans localStorage.
     * @param {string} accountId
     * @param {object} state - L'état de session à sauvegarder.
     */
    function saveSessionState(accountId, state) {
        if (!accountId || !state) {
            sessionLogger.error('saveSessionState: accountId ou state manquant.');
            return;
        }
        try {
            const stateToSave = { ...state, lastClientUpdate: Date.now() };
            localStorage.setItem(SESSION_STORAGE_PREFIX + accountId, JSON.stringify(stateToSave));
            sessionLogger.log(`État de session sauvegardé pour ${accountId}`, stateToSave);
        } catch (e) {
            sessionLogger.error(`Erreur lors de la sauvegarde de l'état pour ${accountId}:`, e);
            // Potentiellement notifier l'utilisateur si le localStorage est plein
            showNotification("Erreur: Impossible de sauvegarder l'état de la session (stockage plein ?).", "error");
        }
    }

    /**
     * Charge l'état de session d'un compte depuis localStorage.
     * @param {string} accountId
     * @returns {object | null} L'état de session ou null si non trouvé/invalide.
     */
    /**
     * Charge l'état de session d'un compte depuis localStorage, avec vérification d'intégrité.
     * En cas de corruption ou d'effacement, tente une récupération automatique ou propose une réinitialisation.
     * Logge tous les événements de corruption, récupération ou réinitialisation.
     * @param {string} accountId
     * @returns {object | null} L'état de session ou null si non trouvé/invalide.
     */
    function loadSessionState(accountId) {
        if (!accountId) {
            sessionLogger.error('loadSessionState: accountId manquant.');
            return null;
        }
        try {
            const storedState = localStorage.getItem(SESSION_STORAGE_PREFIX + accountId);
            if (!storedState) {
                console.log('[DEBUG] loadSessionState: no storedState for', accountId);
                sessionLogger.warn(`Aucun état local trouvé pour ${accountId}.`);
                // Proposer récupération serveur si possible
                // handleSessionCorruptionOrLoss(accountId, 'missing');
                return null;
            }
            let state;
            try {
                state = JSON.parse(storedState);
            } catch (parseErr) {
                sessionLogger.error(`Corruption détectée (JSON.parse) pour ${accountId}:`, parseErr);
                showNotification(`Erreur: Données de session corrompues pour ${accountId}. Tentative de récupération...`, "error");
                loggerEvent('corruption', accountId, { error: parseErr });
                removeSessionState(accountId);
                handleSessionCorruptionOrLoss(accountId, 'corrupted');
                return null;
            }
            // Validation stricte de la structure attendue
            if (
                !state ||
                typeof state !== 'object' ||
                state.accountId !== accountId ||
                !['running', 'paused', 'stopped', 'expired'].includes(state.status) ||
                typeof state.startTime !== 'number' ||
                (state.sessionEnd !== null && typeof state.sessionEnd !== 'number')
            ) {
                sessionLogger.warn(`État de session invalide ou incohérent pour ${accountId}. Suppression et récupération.`);
                showNotification(`Erreur: Données de session invalides pour ${accountId}. Tentative de récupération...`, "error");
                loggerEvent('corruption', accountId, { state });
                removeSessionState(accountId);
                handleSessionCorruptionOrLoss(accountId, 'invalid');
                return null;
            }
            sessionLogger.log(`État de session chargé pour ${accountId}`, state);
            return state;
        } catch (e) {
            sessionLogger.error(`Erreur inattendue lors du chargement de l'état pour ${accountId}:`, e);
            showNotification(`Erreur inattendue lors du chargement de la session pour ${accountId}.`, "error");
            loggerEvent('corruption', accountId, { error: e });
            removeSessionState(accountId);
            handleSessionCorruptionOrLoss(accountId, 'exception');
            return null;
        }
    }

    /**
     * Gère la corruption ou la perte de session locale : tente une récupération serveur ou propose une réinitialisation.
     * @param {string} accountId
     * @param {'corrupted'|'invalid'|'missing'|'exception'} reason
     */
    async function handleSessionCorruptionOrLoss(accountId, reason) {
        sessionLogger.warn(`Tentative de récupération de la session pour ${accountId} suite à : ${reason}`);
        loggerEvent('recovery_attempt', accountId, { reason });
        showNotification(`Tentative de récupération de la session pour ${accountId}...`, "warning");
        try {
            // Appel direct à la validation/synchro serveur pour restaurer l'état
            await validateAndSyncSession(accountId, null);
            loggerEvent('recovery_success', accountId, { reason });
            showNotification(`Session restaurée depuis le serveur pour ${accountId}.`, "success");
        } catch (e) {
            sessionLogger.error(`Échec de récupération serveur pour ${accountId}:`, e);
            loggerEvent('recovery_failed', accountId, { error: e, reason });
            showNotification(
                `Impossible de restaurer la session pour ${accountId}. Veuillez réinitialiser manuellement.`,
                "error",
                7000
            );
            // Optionnel : proposer une réinitialisation guidée (UI)
            // showResetSessionUI(accountId);
        }
    }

    /**
     * Logge un événement de persistance critique (corruption, récupération, réinitialisation).
     * @param {'corruption'|'recovery_attempt'|'recovery_success'|'recovery_failed'|'reset'} type
     * @param {string} accountId
     * @param {object} [details]
     */
    function loggerEvent(type, accountId, details = {}) {
        const eventMsg = `[Persistance][${type}] Compte: ${accountId} | Détails: ${JSON.stringify(details)}`;
        sessionLogger.log(eventMsg);
        // Optionnel : envoyer vers un endpoint serveur pour audit
        // fetch('/api/persistence-log', { method: 'POST', body: JSON.stringify({ type, accountId, details }) });
    }

    /**
     * Supprime l'état de session d'un compte du localStorage.
     * @param {string} accountId
     */
    function removeSessionState(accountId) {
        if (!accountId) {
            sessionLogger.error('removeSessionState: accountId manquant.');
            return;
        }
        try {
            localStorage.removeItem(SESSION_STORAGE_PREFIX + accountId);
            sessionLogger.log(`État de session supprimé pour ${accountId}`);
        } catch (e) {
            sessionLogger.error(`Erreur lors de la suppression de l'état pour ${accountId}:`, e);
        }
    }

    /**
     * Valide l'état local avec le serveur et synchronise.
     * @param {string} accountId
     * @param {object} localState - L'état chargé depuis localStorage.
     */
    async function validateAndSyncSession(accountId, localState) {
        sessionLogger.log(`Validation de la session pour ${accountId}...`, localState);
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/session-sync/${accountId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ localState })
            });

            if (!response.ok) {
                // Gérer les erreurs HTTP (ex: 404 si session inconnue côté serveur)
                if (response.status === 404) {
                     sessionLogger.warn(`Session ${accountId} non trouvée sur le serveur. Suppression locale.`);
                     removeSessionState(accountId);
                     // Mettre à jour l'UI si nécessaire (ex: décocher la case)
                     const checkbox = document.getElementById(`account-checkbox-${accountId}`);
                     if (checkbox) checkbox.checked = false;
                     updateAccountSessionUI(accountId, null); // Mettre à jour l'UI pour refléter l'absence de session
                } else {
                    throw new Error(`Erreur HTTP ${response.status} lors de la validation.`);
                }
                return; // Sortir si erreur gérée (comme 404)
            }

            const syncResult = await response.json();
            sessionLogger.log(`Réponse de synchronisation reçue pour ${accountId}:`, syncResult);

            // Stratégie de résolution : priorité au serveur
            // Le serveur doit renvoyer l'état correct/fusionné dans syncResult.serverState
            if (syncResult.serverState && syncResult.serverState.accountId === accountId) {
                const serverState = syncResult.serverState;

                 // Convertir sessionEnd en nombre si nécessaire (vient du JSON)
                 if (serverState.sessionEnd !== null && typeof serverState.sessionEnd !== 'number') {
                    serverState.sessionEnd = Number(serverState.sessionEnd);
                 }
                 if (serverState.startTime !== null && typeof serverState.startTime !== 'number') {
                    serverState.startTime = Number(serverState.startTime);
                 }
                 if (serverState.lastClientUpdate !== null && typeof serverState.lastClientUpdate !== 'number') {
                    serverState.lastClientUpdate = Number(serverState.lastClientUpdate);
                 }


                // Comparer l'état local et serveur pour détecter les conflits (pour log)
                if (JSON.stringify(localState) !== JSON.stringify(serverState)) {
                    sessionLogger.warn(`Conflit détecté pour ${accountId}. État local:`, localState, `État serveur:`, serverState);
                    sessionLogger.warn(`Application de l'état serveur.`);
                }

                // Mettre à jour l'état local avec celui du serveur
                saveSessionState(accountId, serverState);

                // Mettre à jour l'état dans le tableau 'accounts' en mémoire
                const accountIndex = accounts.findIndex(acc => acc.id === accountId);
                if (accountIndex !== -1) {
                    // Fusionner l'état serveur avec les infos du compte existant
                     accounts[accountIndex] = {
                        ...accounts[accountIndex], // Garde email, etc.
                        sessionEnd: serverState.sessionEnd,
                        // Mettre à jour d'autres champs si nécessaire depuis serverState
                     };
                     sessionLogger.log(`État du compte ${accountId} mis à jour en mémoire.`);
                }

                // Mettre à jour l'interface utilisateur
                updateAccountSessionUI(accountId, serverState);

                // *** NOUVEAU : Récupérer et afficher l'ID du compte si la session est active ***
                if (serverState.status === 'running') {
                    fetchAndDisplayAccountId(accountId);
                } else {
                     // Si la session n'est plus 'running', masquer l'ID (ou afficher 'Non connecté')
                     const accountIdValueSpan = document.getElementById('account-id-value');
                     if (accountIdValueSpan) accountIdValueSpan.textContent = 'Non connecté';
                     // Optionnel: masquer complètement le div
                     // const accountIdDisplayDiv = document.getElementById('account-id-display');
                     // if (accountIdDisplayDiv) accountIdDisplayDiv.style.display = 'none';
                }

            } else if (syncResult.action === 'delete_local') {
                 sessionLogger.warn(`Le serveur demande la suppression de l'état local pour ${accountId}.`);
                 removeSessionState(accountId);
                 updateAccountSessionUI(accountId, null);
            } else {
                 sessionLogger.warn(`Réponse de synchronisation invalide du serveur pour ${accountId}.`);
            }

        } catch (error) {
            sessionLogger.error(`Erreur lors de la validation/synchronisation pour ${accountId}:`, error);
            // Que faire en cas d'échec de synchro ?
            // Option 1: Conserver l'état local (potentiellement désynchronisé)
            // Option 2: Supprimer l'état local (plus sûr pour éviter incohérences)
            // Option 3: Marquer l'état comme "désynchronisé" et réessayer plus tard
            // Pour l'instant, on conserve l'état local mais on affiche une erreur.
            showNotification(`Erreur de synchronisation pour le compte ${accountId}. L'état local est peut-être obsolète.`, "error");
            // Mettre à jour l'UI avec l'état local (qui a été chargé)
            updateAccountSessionUI(accountId, localState);
        }
    }

    /**
     * Récupère l'ID du compte depuis le backend si la session est valide et l'affiche.
     * @param {string} accountId
     */
    async function fetchAndDisplayAccountId(accountId) {
        const accountIdValueSpan = document.getElementById('account-id-value');
        const accountIdDisplayDiv = document.getElementById('account-id-display');
        if (!accountIdValueSpan || !accountIdDisplayDiv) return;

        // Dans ce contexte, sessionId est le même que accountId
        const sessionId = accountId;

        try {
            // Utilise une URL relative, pas besoin de SERVER_PORT ici
            const response = await fetch(`/api/account/id/${accountId}/${sessionId}`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.accountId) {
                    accountIdValueSpan.textContent = data.accountId;
                    accountIdDisplayDiv.style.display = 'block'; // Assurer la visibilité
                } else {
                    // Session invalide ou autre erreur serveur
                    accountIdValueSpan.textContent = 'Session invalide';
                    accountIdDisplayDiv.style.display = 'block'; // Garder visible pour montrer l'erreur
                    console.warn(`Échec de la récupération de l'ID pour ${accountId}:`, data.message || 'Session invalide');
                }
            } else {
                // Erreur HTTP
                accountIdValueSpan.textContent = 'Erreur API';
                accountIdDisplayDiv.style.display = 'block'; // Garder visible pour montrer l'erreur
                console.error(`Erreur HTTP ${response.status} lors de la récupération de l'ID pour ${accountId}`);
            }
        } catch (error) {
            accountIdValueSpan.textContent = 'Erreur réseau';
            accountIdDisplayDiv.style.display = 'block'; // Garder visible pour montrer l'erreur
            console.error(`Erreur réseau lors de la récupération de l'ID pour ${accountId}:`, error);
        }
    }


    /**
     * Met à jour l'affichage du timer et l'état de la checkbox pour un compte.
     * @param {string} accountId
     * @param {object | null} sessionState - L'état de session à appliquer, ou null si pas de session.
     */
    function updateAccountSessionUI(accountId, sessionState) {
        const checkbox = document.getElementById(`account-checkbox-${accountId}`);
        const timerSpan = document.querySelector(`.session-timer[data-account-id="${accountId}"]`);
        const account = accounts.find(acc => acc.id === accountId); // Récupérer les infos du compte

        if (!account) return; // Compte non trouvé

        // Laisser handleAccountCheckboxChange et loadAndApplyActiveSelection gérer l'état de la checkbox.
        // La fonction updateAccountSessionUI ne met à jour que le timer.
        // if (checkbox) {
        //     // Ne plus modifier checkbox.checked ici
        // }

        if (timerSpan) {
            // Affichage du temps passé si disponible
            if (typeof account.elapsedMs === 'number' && account.elapsedMs > 0) {
                timerSpan.textContent = '⏱️ ' + formatDuration(account.elapsedMs);
                timerSpan.style.color = '';
                timerSpan.style.display = '';
            } else if (sessionState && sessionState.status === 'running' && sessionState.sessionEnd && sessionState.sessionEnd > Date.now()) {
                const timeLeftMs = sessionState.sessionEnd - Date.now();
                timerSpan.textContent = '⏳ ' + formatDuration(timeLeftMs);
                timerSpan.style.color = '';
                timerSpan.style.display = '';
            } else if (
                // Afficher le timer même sans sessionState si la case est cochée et account.sessionEnd est valide
                (!sessionState || !sessionState.sessionEnd) &&
                checkbox && checkbox.checked &&
                account.sessionEnd && account.sessionEnd > Date.now()
            ) {
                const timeLeftMs = account.sessionEnd - Date.now();
                timerSpan.textContent = '⏳ ' + formatDuration(timeLeftMs);
                timerSpan.style.color = '';
                timerSpan.style.display = '';
            } else if (sessionState && (sessionState.status === 'expired' || (sessionState.sessionEnd && sessionState.sessionEnd <= Date.now()))) {
                timerSpan.textContent = 'Expiré';
                timerSpan.style.color = '#ef4444';
                timerSpan.style.display = '';
                 if (sessionState.status !== 'expired') {
                     // Mettre à jour l'état si l'expiration est détectée maintenant
                     sessionState.status = 'expired';
                     saveSessionState(accountId, sessionState);
                 }
            } else {
                // Pas de session active ou pas de timer à afficher
                timerSpan.textContent = '';
                timerSpan.style.display = 'none';
            }
        } else if (account.sessionDuration) {
             // Si le span n'existe pas encore mais devrait (compte avec durée),
             // il faudra peut-être le créer dynamiquement ou attendre le prochain renderAccountList.
             // Pour l'instant, on suppose que renderAccountList le créera.
             console.warn(`Timer span non trouvé pour ${accountId}, mise à jour UI différée.`);
        }
    }


    /**
     * Restaure et valide toutes les sessions stockées au chargement.
     */
    async function restoreAndValidateAllSessions() {
        sessionLogger.log('Démarrage de la restauration et validation des sessions...');
        let restoredCount = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(SESSION_STORAGE_PREFIX)) {
                const accountId = key.substring(SESSION_STORAGE_PREFIX.length);
                // Vérifier si le compte existe toujours dans la liste chargée
                if (accounts.some(acc => acc.id === accountId)) {
                    const localState = loadSessionState(accountId);
                    if (localState) {
                        restoredCount++;
                        // Valider de manière asynchrone sans attendre la fin des autres
                        validateAndSyncSession(accountId, localState);
                    }
                } else {
                    // Nettoyer les états locaux pour des comptes supprimés
                    sessionLogger.log(`Nettoyage de l'état local pour le compte supprimé ${accountId}`);
                    removeSessionState(accountId);
                }
            }
        }
         if (restoredCount === 0) {
            sessionLogger.log('Aucune session locale à restaurer.');
        }
    }

    // --- Modifications pour intégrer la persistance ---

    // 1. Appeler restoreAndValidateAllSessions après le chargement des comptes
    // Modifier la fonction loadAndRenderAccounts

    // Remplacer l'ancienne fonction loadAndRenderAccounts par celle-ci
    async function loadAndRenderAccounts() {
        console.log('Attempting to load and render accounts...');
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/accounts`);
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            const fetchedAccounts = await response.json();
            accounts = fetchedAccounts.map(account => ({
                ...account,
                sessionEnd: account.sessionEnd !== null ? Number(account.sessionEnd) : null
            }));
            console.log('Accounts loaded:', accounts);
            renderAccountList(); // Affiche la liste initiale
            await loadAndApplyActiveSelection(); // Charge la sélection sauvegardée (quelles cases étaient cochées)

            // *** NOUVEAU : Restaurer et valider les sessions après le rendu initial et l'application de la sélection ***
            await restoreAndValidateAllSessions();

// Réappliquer la sélection active après la restauration des sessions pour garantir la cohérence visuelle
            await loadAndApplyActiveSelection();
            console.log('Accounts rendered, active selection applied, and sessions restored/validated.');

        } catch (error) {
            console.error('Erreur lors du chargement des comptes:', error);
            if (accountListDiv) {
                accountListDiv.innerHTML = '<p style="color: red;">Erreur lors du chargement des comptes.</p>';
            }
        }
    }


    // 2. Sauvegarder/Supprimer l'état lors du cochage/décochage d'une case
    // Ajouter un écouteur d'événements global ou modifier renderAccountList

    // Modifier la fonction renderAccountList pour ajouter l'écouteur aux checkboxes
    function renderAccountList() {
        if (!accountListDiv) return;
        accountListDiv.innerHTML = '';
        if (accounts.length === 0) {
            // ... (code existant pour liste vide)
             const li = document.createElement('li');
             li.innerHTML = '<p>Aucun compte configuré.</p>';
             accountListDiv.appendChild(li);
        } else {
            accounts.forEach(account => {
                const li = document.createElement('li');
                li.classList.add('account-item');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `account-checkbox-${account.id}`;
                checkbox.value = account.id;
                checkbox.classList.add('account-checkbox');

                // *** NOUVEAU : Écouteur pour gérer le démarrage/arrêt de session ***
                checkbox.addEventListener('change', (event) => {
                    handleAccountCheckboxChange(event.target.checked, account);
                });

                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                label.textContent = `${account.email} ${account.id} (Durée: ${account.sessionDuration || 'Illimitée'})`;

                let timeSpan = null;
                if (account.sessionDuration) { // Afficher le span même si sessionEnd n'est pas défini au début
                    timeSpan = document.createElement('span');
                    timeSpan.className = 'session-timer';
                    timeSpan.dataset.accountId = account.id;
                    timeSpan.style.display = 'none'; // Masqué par défaut, updateAccountSessionUI le montrera si besoin
                }

                const editButton = document.createElement('button');
                editButton.textContent = 'Modifier';
                editButton.classList.add('edit-account-btn');
                editButton.dataset.accountId = account.id;
                editButton.addEventListener('click', () => showAccountForm(account.id));

                const deleteButton = document.createElement('button');
                deleteButton.textContent = 'Supprimer';
                deleteButton.classList.add('delete-account-btn');
                deleteButton.dataset.accountId = account.id;
                deleteButton.addEventListener('click', () => deleteAccount(account.id, account.email));

                li.appendChild(checkbox);
                li.appendChild(label);
                if (timeSpan) {
                    label.appendChild(document.createTextNode(' '));
                    label.appendChild(timeSpan);
                }
                li.appendChild(editButton);
                li.appendChild(deleteButton);
                accountListDiv.appendChild(li);

                // Pas besoin de renderConfigForm ici, la sélection se fait via checkbox maintenant
                // label.addEventListener('click', () => renderConfigForm(account.id));
            });
        }

        const saveSelectionButton = document.createElement('button');
        saveSelectionButton.id = 'save-account-selection-btn';
        saveSelectionButton.textContent = 'Sauvegarder Sélection Comptes Actifs';
        saveSelectionButton.addEventListener('click', saveAccountSelection);
        accountListDiv.appendChild(saveSelectionButton);

        // L'appel initial à updateAllSessionTimers est maintenant géré par restoreAndValidateAllSessions
        // et les mises à jour suivantes par l'intervalle et les changements d'état.
        // updateAllSessionTimers(); // Supprimer cet appel ici
    }


    /**
     * Gère le changement d'état d'une checkbox de compte.
     * Démarre ou arrête la session localement et sauvegarde l'état.
     * @param {boolean} isChecked - Nouvel état de la checkbox.
     * @param {object} account - L'objet compte concerné.
     */
    function handleAccountCheckboxChange(isChecked, account) {
        sessionLogger.log(`Checkbox change pour ${account.id}. Checked: ${isChecked}`);

        // --- Mise à jour immédiate de la sélection active (variable globale + localStorage) ---
        try {
            // Recharger depuis localStorage pour être sûr d'avoir la dernière version
            const activeAccountsRaw = localStorage.getItem('activeAccountsSelection');
            if (activeAccountsRaw) {
                activeAccountIds = JSON.parse(activeAccountsRaw);
            } else {
                activeAccountIds = [];
            }
        } catch (e) {
            sessionLogger.warn("Erreur lecture localStorage activeAccountsSelection", e);
            activeAccountIds = []; // Fallback
        }

        const index = activeAccountIds.indexOf(account.id);
        if (isChecked) {
            if (index === -1) {
                activeAccountIds.push(account.id);
                sessionLogger.log(`Ajout de ${account.id} à activeAccountIds`);
            }
        } else {
            if (index !== -1) {
                activeAccountIds.splice(index, 1);
                sessionLogger.log(`Retrait de ${account.id} de activeAccountIds`);
            }
        }
        // Sauvegarde locale immédiate pour la cohérence UI avant l'appel serveur asynchrone
        try {
            localStorage.setItem('activeAccountsSelection', JSON.stringify(activeAccountIds));
            sessionLogger.log(`localStorage activeAccountsSelection mis à jour:`, activeAccountIds);
        } catch (e) {
            sessionLogger.error("Erreur sauvegarde localStorage activeAccountsSelection dans handleAccountCheckboxChange", e);
        }
        // --- Fin mise à jour sélection active ---


        if (isChecked && account.sessionDuration) {
            // Démarrer une nouvelle session
            if (!timeSyncModule) {
                 sessionLogger.error("Impossible de démarrer la session: module time_sync non chargé.");
                 showNotification("Erreur: Impossible de démarrer la session, synchronisation non prête.", "error");
                 // Annuler le changement de la checkbox si erreur
                 const checkbox = document.getElementById(`account-checkbox-${account.id}`);
                 if(checkbox) checkbox.checked = false;
                 // Annuler la mise à jour de activeAccountIds
                 const idx = activeAccountIds.indexOf(account.id);
                 if (idx !== -1) {
                     activeAccountIds.splice(idx, 1);
                     try { localStorage.setItem('activeAccountsSelection', JSON.stringify(activeAccountIds)); } catch(e){}
                 }
                 return;
            }
            const now = Date.now() + timeSyncModule.timeOffset;
            let sessionEnd = null;
            let startTime = now;
            let status = 'running';

            const durationMatch = account.sessionDuration.match(/^(\d+(\.\d+)?)h$/);
            let durationMs = null;
            if (durationMatch) {
                durationMs = parseFloat(durationMatch[1]) * 60 * 60 * 1000;
                sessionEnd = now + durationMs;
            } else {
                 sessionLogger.warn(`Format de durée invalide pour ${account.id}: ${account.sessionDuration}. Session considérée comme illimitée.`);
                 status = 'stopped';
                 sessionEnd = null;
            }

            const newState = {
                accountId: account.id,
                status: status,
                startTime: startTime,
                accumulatedDuration: 0,
                sessionDurationLimit: durationMs,
                sessionEnd: sessionEnd,
                lastClientUpdate: now
            };

            account.sessionEnd = sessionEnd; // Mise à jour en mémoire
            saveSessionState(account.id, newState); // Sauvegarde état session local
            updateAccountSessionUI(account.id, newState); // Met à jour le timer (pas la coche)

        } else { // isChecked is false
            // Arrêter la session
            const currentState = loadSessionState(account.id);
            if (currentState) {
                 removeSessionState(account.id); // Supprime état session local
            }
             account.sessionEnd = null; // Mise à jour en mémoire
             updateAccountSessionUI(account.id, null); // Met à jour le timer (pas la coche)

             // *** NOUVEAU : Réinitialiser l'affichage de l'ID du compte ***
             const accountIdValueSpan = document.getElementById('account-id-value');
             if (accountIdValueSpan) accountIdValueSpan.textContent = 'Non connecté';
             // Optionnel: masquer complètement le div
             // const accountIdDisplayDiv = document.getElementById('account-id-display');
             // if (accountIdDisplayDiv) accountIdDisplayDiv.style.display = 'none';
        }

         // Sauvegarder la sélection globale des comptes actifs côté serveur (appel asynchrone)
         // Utilise la variable activeAccountIds mise à jour au début
         saveAccountSelection();
    }


    // 3. Mettre à jour updateAllSessionTimers pour utiliser l'état local et gérer l'expiration
    // Remplacer l'ancienne fonction updateAllSessionTimers

    // --- Correction : prise en compte de la sélection active pour l'affichage des cases cochées ---
    let activeAccountIds = [];
    try {
        const activeAccountsRaw = localStorage.getItem('activeAccountsSelection');
        if (activeAccountsRaw) {
            activeAccountIds = JSON.parse(activeAccountsRaw);
        }
    } catch (e) {
        // Ignore, fallback sur []
    }

    function updateAllSessionTimers() {
        console.log('[DEBUG] updateAllSessionTimers called at', new Date().toISOString());
        if (!timeSyncModule) return; // Attendre que le module time_sync soit chargé
        const now = Date.now() + timeSyncModule.timeOffset; // Utiliser l'heure serveur synchronisée
        const { isConnected, isSessionBlockedBySkew, CLOCK_SKEW_THRESHOLD_MS } = timeSyncModule;
        let needsRenderUpdate = false; // Pour détecter si un changement nécessite de redessiner

        accounts.forEach(account => {
            const checkbox = document.getElementById(`account-checkbox-${account.id}`);
            let sessionState = loadSessionState(account.id);

            // *** NOUVELLE CONDITION POUR ÉVITER BOUCLE INFINIE ***
            // Si l'état local est manquant (loadSessionState a retourné null),
            // on arrête le traitement pour ce compte DANS CETTE FONCTION.
            // loadSessionState a déjà tenté une récupération via handleSessionCorruptionOrLoss.
            // On évite ici de continuer avec un état potentiellement invalide ou manquant.
            if (!sessionState) {
                // On vérifie quand même si la case doit être cochée (sélection active).
                if (activeAccountIds.includes(account.id)) {
                    if (checkbox) checkbox.checked = true;
                } else {
                    // Assurer que le timer est caché si pas d'état et pas dans sélection active
                    updateAccountSessionUI(account.id, null);
                }
                // Passer au compte suivant dans la boucle forEach
                return;
            }

            // --- Le reste de la logique ne s'exécute que si sessionState existe ---

            // Assurer que la case est cochée si l'état existe et est 'running' ou si dans la sélection active
             if (checkbox && (activeAccountIds.includes(account.id) || (sessionState && sessionState.status === 'running'))) {
                 checkbox.checked = true;
             }

            // On ne met à jour le timer que si la case est cochée ET qu'il y a une durée définie
            if (checkbox && checkbox.checked && account.sessionDuration) {

                // Note: Le bloc 'else if (!sessionState)' précédent est maintenant géré par le 'return' ci-dessus.

                // Vérifier l'expiration
                if (sessionState.status === 'running' && sessionState.sessionEnd) {
                     const isExpired = sessionState.sessionEnd <= now;
                     if (isExpired) {
                         // Vérifier la connexion et la synchro AVANT de marquer comme expiré côté client
                         if (!isConnected || isSessionBlockedBySkew) {
                             sessionLogger.warn(`Expiration potentielle pour ${account.id} détectée, mais état réseau/horloge instable. Validation serveur attendue.`);
                             // Afficher un état "incertain" ou "validation en cours" ?
                             const timerSpan = document.querySelector(`.session-timer[data-account-id="${account.id}"]`);
                             if (timerSpan) {
                                 timerSpan.textContent = '⏳ Validation...';
                                 timerSpan.style.color = '#f59e0b'; // Jaune/Orange
                                 timerSpan.style.display = '';
                             }
                             // Ne pas changer l'état local ni appeler handleSessionExpired ici.
                             // La validation serveur (via validateAndSyncSession) corrigera l'état.
                         } else {
                             // Connexion OK et horloge synchronisée : on peut marquer comme expiré
                             sessionLogger.log(`Session expirée détectée pour ${account.id} dans updateAllSessionTimers.`);
                             sessionState.status = 'expired';
                             saveSessionState(account.id, sessionState); // Sauvegarder le nouvel état 'expired'
                             handleSessionExpired(account); // Déclencher les actions d'expiration
                             needsRenderUpdate = true; // Indiquer qu'un changement d'état a eu lieu
                         }
                     }
                }

                // Mettre à jour l'UI (même si pas expiré, pour rafraîchir le temps)
                // Sauf si on est en attente de validation serveur
                const timerSpan = document.querySelector(`.session-timer[data-account-id="${account.id}"]`);
                if (!timerSpan || timerSpan.textContent !== '⏳ Validation...') {
                     updateAccountSessionUI(account.id, sessionState);
                } else {
                     // Si on est en attente de validation, on ne met pas à jour l'UI ici
                     // pour éviter d'écraser le message "Validation..."
                }
                // Ne met à jour que si l'état est 'running' ou 'expired'
                 if (sessionState.status === 'running' || sessionState.status === 'expired') {
                    updateAccountSessionUI(account.id, sessionState);
                 } else {
                     // Si l'état est 'stopped' ou autre, s'assurer que l'UI est vide
                     updateAccountSessionUI(account.id, null);
                 }

            } else {
                 // Si la case n'est pas cochée ou pas de durée
                 // Correction : si le compte est dans la sélection active, laisser la case cochée et ne pas toucher à l'UI
                 if (activeAccountIds.includes(account.id)) {
                     if (checkbox) checkbox.checked = true;
                     // Ne pas appeler updateAccountSessionUI pour ne pas effacer la coche
                 } else {
                     // et qu'il n'y a pas d'état local persistant (nettoyage au cas où)
                     const currentState = loadSessionState(account.id);
                     if (currentState && currentState.status !== 'stopped') { // Ne pas supprimer si on veut garder une trace 'stopped'
                         // removeSessionState(account.id); // Commenté pour l'instant, la suppression se fait au décochage
                     }
                     updateAccountSessionUI(account.id, null);
                 }
            }
        });

        // Si un état a changé (ex: expiration), on pourrait forcer un re-rendu si nécessaire,
        // mais updateAccountSessionUI devrait suffire pour le timer.
        // if (needsRenderUpdate) {
        //     console.log("Changement d'état détecté, re-rendu potentiel nécessaire.");
        // }
    }

    // Rendre updateAllSessionTimers globalement accessible si ce n'est pas déjà le cas
    // La ligne `window.updateAllSessionTimers = updateAllSessionTimers;` existante devrait suffire.

    // 4. Modifier sendSessionUpdates pour utiliser l'état local (optionnel mais cohérent)
    // Cette fonction semble redondante si la validation/synchro est faite ailleurs.
    // On pourrait la supprimer ou la modifier pour envoyer l'état complet.
    // Pour l'instant, commentons son appel pour éviter les conflits potentiels.

    // Commenter l'intervalle qui appelle sendSessionUpdates
    // setInterval(sendSessionUpdates, 5000); // Ligne 317

    // 5. Modifier deleteAccount pour supprimer aussi l'état local
    // Ajouter removeSessionState dans deleteAccount

    async function deleteAccount(accountId, accountEmail) {
        if (!confirm(`Êtes-vous sûr de vouloir supprimer le compte ${accountEmail} (ID: ${accountId}) ?`)) return;
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/accounts/${accountId}`, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                showNotification('Compte supprimé avec succès !', "success");

                // *** NOUVEAU : Supprimer l'état de session local ***
                removeSessionState(accountId);

                await loadAndRenderAccounts(); // Recharge et réaffiche la liste
                // Si le compte affiché dans le formulaire de config était supprimé, vider la config
                const configFormAccountIdInput = document.querySelector('#config-form input[name="accountId"]'); // Ajuster le sélecteur si besoin
                if (configFormAccountIdInput && configFormAccountIdInput.value === accountId) {
                     configFormDiv.innerHTML = '<p>Sélectionnez un compte pour afficher sa configuration.</p>';
                }
                 // Pas besoin de editingAccountId ici si on se base sur le formulaire
                 // if (editingAccountId === accountId) { ... }

            } else {
                showNotification(`Erreur lors de la suppression: ${result.message || 'Erreur inconnue'}`, "error");
            }
        } catch (error) {
            console.error('Erreur lors de la suppression du compte:', error);
            showNotification('Erreur de communication avec le serveur.', "error");
        }
    }


    // --- Fin des Modifications pour la persistance ---


    // --- Formulaire d'ajout/modification dans la zone config-form ---

    function showAccountForm(accountId = null) {
        editingAccountId = accountId;
        let account = null;
        if (editingAccountId) {
            account = accounts.find(acc => acc.id === editingAccountId);
        }
        configFormDiv.innerHTML = `
            <h3>${editingAccountId ? 'Modifier le Compte' : 'Ajouter un Compte'}</h3>
            <form id="account-form">
                <label for="account-email">Nom d'utilisateur :</label>
                <input type="text" id="account-email" required autocomplete="username" value="${account ? account.email : ''}"><br>
                <label for="account-password">Mot de passe :</label>
                <input type="password" id="account-password" ${editingAccountId ? '' : 'required'} autocomplete="current-password" placeholder="${editingAccountId ? 'Laissez vide pour conserver le mot de passe actuel' : ''}"><br>
                <label for="account-duration">Durée de session (ex: 2h, 0.5h) :</label>
                <input type="text" id="account-duration" placeholder="ex: 2h ou vide pour illimité" value="${account && account.sessionDuration ? account.sessionDuration : ''}"><br>
                <label for="account-enabled" style="margin-top:0.5em;">
                    <input type="checkbox" id="account-enabled" ${!account || account.isEnabled !== false ? 'checked' : ''}>
                    Activé
                </label><br>
                <div style="margin-top:1em;">
                    <button type="submit" id="validate-account-form-btn">Valider</button>
                    <button type="button" id="cancel-account-form-btn">Annuler</button>
                </div>
            </form>
        `;
        // Ajout des écouteurs
        document.getElementById('account-form').addEventListener('submit', submitAccountForm);
        document.getElementById('cancel-account-form-btn').addEventListener('click', () => {
            if (editingAccountId) {
                renderConfigForm(editingAccountId);
            } else {
                configFormDiv.innerHTML = '<p>Sélectionnez un compte pour afficher sa configuration.</p>';
            }
            editingAccountId = null;
        });
    }

    // --- Notifications toast ---
    function showNotification(message, type = "info", duration = 3500) {
        const container = document.getElementById('notification-container');
        if (!container) return;
        const notif = document.createElement('div');
        notif.className = `toast-notification ${type}`;
        notif.textContent = message;
        container.appendChild(notif);
        setTimeout(() => notif.classList.add('hide'), duration);
        notif.addEventListener('animationend', () => {
            if (notif.classList.contains('hide')) notif.remove();
        });
    }

    /**
     * Affiche un message de log dans la zone dédiée de l'interface.
     * @param {object} logData - L'objet log reçu ({ level: string, message: string, timestamp?: string })
     */
    function displayLog(logData) {
        const logOutputDiv = document.getElementById('log-output'); // Supposons que cet élément existe dans index.html
        if (!logOutputDiv) {
            console.warn("Élément #log-output non trouvé pour afficher les logs.");
            return;
        }

        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', `log-${logData.level}`); // Ajoute une classe pour le style (ex: log-error)

        const timestampSpan = document.createElement('span');
        timestampSpan.classList.add('log-timestamp');
        // Formater le timestamp s'il existe, sinon utiliser l'heure actuelle (approximative)
        const time = logData.timestamp ? new Date(logData.timestamp).toLocaleTimeString('fr-FR') : new Date().toLocaleTimeString('fr-FR');
        timestampSpan.textContent = `[${time}]`;

        const levelSpan = document.createElement('span');
        levelSpan.classList.add('log-level');
        levelSpan.textContent = `[${logData.level.toUpperCase()}]`;

        const messageSpan = document.createElement('span');
        messageSpan.classList.add('log-message');
        // Utiliser textContent pour éviter les injections XSS potentielles si le message vient du serveur
        messageSpan.textContent = logData.message;

        logEntry.appendChild(timestampSpan);
        logEntry.appendChild(levelSpan);
        logEntry.appendChild(messageSpan);

        // Ajouter la nouvelle entrée au début pour voir les plus récents en haut.
        logOutputDiv.prepend(logEntry);

        // Optionnel : Limiter le nombre de logs affichés pour éviter de surcharger le DOM
        const maxLogEntries = 100; // Ajustable
        while (logOutputDiv.children.length > maxLogEntries) {
            logOutputDiv.removeChild(logOutputDiv.lastChild);
        }
    }


    async function submitAccountForm(event) {
        event.preventDefault();
        const email = document.getElementById('account-email').value;
        const pwdInput = document.getElementById('account-password').value;
        const sessionDuration = document.getElementById('account-duration').value || null;

        if (sessionDuration && !/^\d+(\.\d+)?h$/.test(sessionDuration)) {
            showNotification("Format de durée invalide. Utilisez 'Xh' ou 'X.Yh' (ex: '1.5h', '2h'). Laissez vide pour une durée illimitée.", "error");
            return;
        }

        let accountData = {};
        const isEnabled = document.getElementById('account-enabled')?.checked ?? true;
        console.log('Account Id:', editingAccountId);
        if (!editingAccountId) {
            console.log('Ajout d\'un compte');
            // Création : email et mot de passe requis
            if (!email || !pwdInput) {
                alert("Email et mot de passe requis pour créer un compte.");
                return;
            }
            accountData.email = email;
            accountData.password = pwdInput;
            if (sessionDuration) accountData.sessionDuration = sessionDuration;
            accountData.isEnabled = isEnabled;
        } else {
            // Modification : on ne met que ce qui est saisi (même si tout est vide, c'est accepté)
            if (email) accountData.email = email;
            if (pwdInput) accountData.password = pwdInput;
            if (sessionDuration) accountData.sessionDuration = sessionDuration;
            accountData.isEnabled = isEnabled;
            // Si rien n'est modifié, prévenir l'utilisateur
            if (Object.keys(accountData).length === 0) {
                showNotification("Aucune modification à enregistrer.", "info");
                return;
            }
        }
        try {
            let response, result;
            if (editingAccountId) {
                response = await fetch(`http://localhost:${SERVER_PORT}/accounts/${editingAccountId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(accountData)
                });
            } else {
                response = await fetch(`http://localhost:${SERVER_PORT}/accounts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(accountData)
                });
            }
            result = await response.json();
            if (result.success) {
                alert(`Compte ${editingAccountId ? 'modifié' : 'ajouté'} avec succès !`);
                editingAccountId = null;
                await loadAndRenderAccounts();
                configFormDiv.innerHTML = '<p>Sélectionnez un compte pour afficher sa configuration.</p>';
            } else {
                showNotification(`Erreur: ${result.message || 'Erreur inconnue'}`, "error");
            }
        } catch (error) {
            console.error('Erreur lors de la sauvegarde du compte:', error);
            showNotification('Erreur de communication avec le serveur.', "error");
        }
    }

    // La fonction deleteAccount est maintenant définie dans la section Persistance (plus haut)
    // async function deleteAccount(accountId, accountEmail) { ... }

    // Afficher la config d'un compte (lecture seule, avec bouton "Modifier")
    function renderConfigForm(accountId) {
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) {
            configFormDiv.innerHTML = '<p>Compte introuvable.</p>';
            return;
        }
        configFormDiv.innerHTML = `
            <h3>Configuration du Compte</h3>
            <p><strong>Nom d'utilisateur :</strong> ${account.email}</p>
            <p><strong>Mot de passe :</strong> ********</p>
            <p><strong>Durée de session :</strong> ${account.sessionDuration || 'Illimitée'}</p>
            <div style="margin-top:1em;">
                <button id="edit-account-btn">Modifier</button>
            </div>
        `;
        document.getElementById('edit-account-btn').addEventListener('click', () => showAccountForm(accountId));
    }

    // --- Ajout d'un compte ---
    if (addAccountBtn) {
        addAccountBtn.style.display = 'inline-block';
        addAccountBtn.addEventListener('click', () => showAccountForm());
    }

    // --- Gestion de la Sélection des Comptes Actifs ---

    async function loadAndApplyActiveSelection() {
        console.log('Attempting to load and apply active selection...');
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/accounts/active`);
            if (!response.ok) {
                if (response.status === 404) {
                    console.log('Active accounts file not found, returning empty selection.');
                    return;
                }
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            const activeIds = await response.json();
            console.log('Active account IDs loaded:', activeIds);
            if (Array.isArray(activeIds)) {
                activeIds.forEach(id => {
                    const checkbox = document.getElementById(`account-checkbox-${id}`);
                    if (checkbox) {
                        checkbox.checked = true;
                        console.log(`Checkbox for account ${id} checked.`);
                    } else {
                        console.log(`Checkbox for account ${id} not found.`);
                    }
                });
            }
            console.log('Active selection applied.');
        } catch (error) {
            console.error('Erreur lors du chargement de la sélection active:', error);
        }
    }

    async function saveAccountSelection() {
        const selectedAccountIds = [];
        const checkboxes = accountListDiv.querySelectorAll('.account-checkbox:checked');
        checkboxes.forEach(checkbox => selectedAccountIds.push(checkbox.value));
        // Sauvegarde locale pour la cohérence du rafraîchissement UI
        try {
            localStorage.setItem('activeAccountsSelection', JSON.stringify(selectedAccountIds));
        } catch (e) {
            // Ignore
        }
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/accounts/active`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activeAccounts: selectedAccountIds })
            });
            const result = await response.json();
            if (result.success) {
                showNotification('Sélection des comptes actifs sauvegardée ! Le bot utilisera ces comptes au prochain démarrage.', "success");
            } else {
                alert('Erreur lors de la sauvegarde de la sélection : ' + (result.message || 'Erreur inconnue'));
            }
        } catch (error) {
            console.error('Erreur lors de l\'envoi de la sélection des comptes:', error);
            showNotification('Erreur de communication avec le serveur lors de la sauvegarde de la sélection.', "error");
        }
    }

    // --- Gestion de la Configuration Générale du Bot (Existante) ---

    async function loadBotConfig() {
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/config`);
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            botConfig = await response.json();
            renderBotConfigForm();
        } catch (error) {
            console.error('Erreur lors du chargement de la configuration du bot:', error);
            if (botConfigFormDiv) {
                botConfigFormDiv.innerHTML = '<p style="color: red;">Erreur lors du chargement de la configuration.</p>';
            }
            showNotification('Erreur lors du chargement de la configuration du bot.', "error");
        }
    }

    function renderBotConfigForm() {
        if (!botConfigFormDiv) return;
        if (!botConfig || Object.keys(botConfig).length === 0) {
             botConfigFormDiv.innerHTML = '<p>Chargement de la configuration...</p>';
             return;
        }
        let formHtml = '<h3>Configuration Générale du Bot</h3>';
        for (const key in botConfig) {
            if (botConfig.hasOwnProperty(key)) {
                const value = botConfig[key];
                const inputType = typeof value === 'number' ? 'number' : 'text';
                formHtml += `
                    <div>
                        <label for="config-${key}">${key}:</label>
                        <input type="${inputType}" id="config-${key}" name="${key}" value="${value}">
                    </div>
                `;
            }
        }
        formHtml += `<button id="save-bot-config-btn">Sauvegarder Configuration Bot</button>`;
        botConfigFormDiv.innerHTML = formHtml;
        const saveBtn = document.getElementById('save-bot-config-btn');
        if (saveBtn) saveBtn.addEventListener('click', saveBotConfig);
    }

    async function saveBotConfig() {
        const updatedConfig = {};
        for (const key in botConfig) {
             if (botConfig.hasOwnProperty(key)) {
                const inputElement = document.getElementById(`config-${key}`);
                if (inputElement) {
                    updatedConfig[key] = typeof botConfig[key] === 'number' ? parseFloat(inputElement.value) : inputElement.value;
                }
             }
        }
        try {
            const response = await fetch(`http://localhost:${SERVER_PORT}/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig)
            });
            const result = await response.json();
            if (result.success) {
                showNotification('Configuration du bot sauvegardée avec succès!', "success");
                loadBotConfig();
            } else {
                showNotification('Erreur lors de la sauvegarde de la configuration: ' + result.message, "error");
            }
        } catch (error) {
            console.error('Erreur lors de l\'envoi de la configuration du bot:', error);
            showNotification('Erreur de communication avec le serveur lors de la sauvegarde.', "error");
        }
    }

// Charger la liste des comptes et la configuration du bot au démarrage
    await loadAndRenderAccounts();
    await loadBotConfig();
} // --- Fin de startAppLogic ---

// --- Point d'entrée principal ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM chargé. Récupération de la configuration serveur...");
    await fetchServerConfig(); // Attendre la récupération du port
    console.log("Configuration récupérée (ou échec géré). Démarrage de la logique principale...");
    await startAppLogic();     // Démarrer le reste de l'application
    console.log("Logique principale démarrée.");
});

