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
document.addEventListener('DOMContentLoaded', () => {
    // Correction : si c'est un <ul>, vider puis ajouter des <li> pour chaque compte
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
    const socket = io("http://localhost:3000");
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
};
document.head.appendChild(socketScript);
    let editingAccountId = null; // null = ajout, sinon id du compte à modifier

    // --- Gestion des Comptes (CRUD via API) ---

    async function loadAndRenderAccounts() {
        console.log('Attempting to load and render accounts...');
        try {
            const response = await fetch('http://localhost:3000/accounts');
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            const fetchedAccounts = await response.json();
            // Assurez-vous que sessionEnd est un nombre (timestamp) si présent
            accounts = fetchedAccounts.map(account => ({
                ...account,
                sessionEnd: account.sessionEnd !== null ? Number(account.sessionEnd) : null // Convertir en nombre si pas null
            }));
            console.log('Accounts loaded and processed:', accounts);
            renderAccountList();
            await loadAndApplyActiveSelection(); // Utiliser await ici
            console.log('Accounts rendered and active selection applied.');
        } catch (error) {
            console.error('Erreur lors du chargement des comptes:', error);
            if (accountListDiv) {
                accountListDiv.innerHTML = '<p style="color: red;">Erreur lors du chargement des comptes.</p>';
            }
        }
    }

    function renderAccountList() {
        if (!accountListDiv) return;
        accountListDiv.innerHTML = '';
        if (accounts.length === 0) {
            const li = document.createElement('li');
            li.innerHTML = '<p>Aucun compte configuré.</p>';
            accountListDiv.appendChild(li);
        } else {
            accounts.forEach(account => {
                const li = document.createElement('li');
                li.classList.add('account-item');

                // Checkbox pour sélection active
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = `account-checkbox-${account.id}`;
                checkbox.value = account.id;
                checkbox.classList.add('account-checkbox');

                // Label (Email et Durée)
                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                label.textContent = `${account.email} (Durée: ${account.sessionDuration || 'Illimitée'})`;

                // Affichage du temps restant
                let timeSpan = null;
                if (account.sessionDuration && typeof account.sessionEnd !== "undefined") {
                    timeSpan = document.createElement('span');
                    timeSpan.className = 'session-timer';
                    timeSpan.dataset.accountId = account.id;
                    // Affichage initial immédiat
                    const now = Date.now();
                    if (account.sessionEnd && account.sessionEnd > now) {
                        timeSpan.textContent = '⏳ ' + formatDuration(account.sessionEnd - now);
                        timeSpan.style.color = '';
                    } else if (account.sessionEnd && account.sessionEnd <= now) {
                        timeSpan.textContent = 'Expiré';
                        timeSpan.style.color = '#ef4444';
                    } else {
                        timeSpan.textContent = '';
                    }
                }

                // Boutons Modifier/Supprimer
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

                // Ajout des éléments
                li.appendChild(checkbox);
                li.appendChild(label);
                if (timeSpan) {
                    label.appendChild(document.createTextNode(' '));
                    label.appendChild(timeSpan);
                }
                li.appendChild(editButton);
                li.appendChild(deleteButton);
                accountListDiv.appendChild(li);

                // Sélectionner un compte pour afficher sa config
                label.addEventListener('click', () => renderConfigForm(account.id));
            });
        }

        // Ajouter le bouton de sauvegarde de la sélection
        const saveSelectionButton = document.createElement('button');
        saveSelectionButton.id = 'save-account-selection-btn';
        saveSelectionButton.textContent = 'Sauvegarder Sélection Comptes Actifs';
        saveSelectionButton.addEventListener('click', saveAccountSelection);
        accountListDiv.appendChild(saveSelectionButton);

        // Timer pour affichage temps restant
        updateAllSessionTimers();
    }

    // Met à jour tous les timers de session affichés
    function updateAllSessionTimers() {
        const now = Date.now();
        document.querySelectorAll('.session-timer').forEach(span => {
            const accountId = span.dataset.accountId;
            const account = accounts.find(acc => acc.id === accountId);
            // Toujours afficher le timer si le compte existe et a une durée
            if (account && typeof account.sessionEnd !== "undefined" && account.sessionDuration) {
                if (account.sessionEnd && account.sessionEnd > now) {
                    span.textContent = '⏳ ' + formatDuration(account.sessionEnd - now);
                    span.style.color = '';
                } else if (account.sessionEnd && account.sessionEnd <= now) {
                    span.textContent = 'Expiré';
                    span.style.color = '#ef4444';
                } else {
                    span.textContent = '';
                }
                span.style.display = '';
            } else {
                // Si pas de durée, masquer explicitement
                span.textContent = '';
                span.style.display = 'none';
            }
        });
    }

    // Formate une durée en ms en HH:MM:SS
    function formatDuration(ms) {
        let totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        totalSec %= 3600;
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        return `${h > 0 ? h + 'h ' : ''}${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
    }

    // Rafraîchit les timers toutes les secondes
    setInterval(updateAllSessionTimers, 1000);

    // Envoie périodiquement les mises à jour de session au serveur pour sauvegarde
    async function sendSessionUpdates() {
        console.log('sendSessionUpdates function called.');
        const now = Date.now();
        for (const account of accounts) {
            console.log(`Checking account: ${account.id}`);
            console.log(`  sessionDuration: ${account.sessionDuration}`);
            console.log(`  sessionEnd: ${account.sessionEnd}`);
            // Vérifie si le compte est actif (checkbox cochée) et a une durée de session définie
            const checkbox = document.getElementById(`account-checkbox-${account.id}`);
            if (checkbox && checkbox.checked && account.sessionDuration && account.sessionEnd !== null) {
                const timeLeftMs = account.sessionEnd - now;
                // Affiche le temps restant dans la console du navigateur
                console.log(`Temps restant pour ${account.email} (${account.id}): ${formatDuration(timeLeftMs)}`);
                // Envoie la mise à jour uniquement si le temps restant est positif
                if (timeLeftMs > 0) {
                    try {
                        // Utilise 'POST' pour envoyer la mise à jour au serveur
                        await fetch(`http://localhost:3000/session-update/${account.id}`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ timeLeftMs: timeLeftMs })
                        });
                        // Le serveur diffusera la mise à jour via Socket.IO, qui sera gérée par le listener existant
                    } catch (error) {
                        console.error(`Erreur lors de l'envoi de la mise à jour de session pour ${account.id}:`, error);
                        // On peut choisir d'afficher une notification ou non, pour l'instant on log juste l'erreur
                    }
                }
            } else {
                console.log(`Condition not met for account ${account.id}. Checkbox checked: ${checkbox?.checked}, sessionDuration: ${account.sessionDuration}, sessionEnd !== null: ${account.sessionEnd !== null}`);
            }
        }
    }

    // Envoie les mises à jour de session toutes les 5 secondes (ajustable)
    setInterval(sendSessionUpdates, 5000);


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
                <label for="account-email">Email :</label>
                <input type="text" id="account-email" required autocomplete="username" value="${account ? account.email : ''}"><br>
                <label for="account-password">Mot de passe :</label>
                <input type="password" id="account-password" ${editingAccountId ? '' : 'required'} autocomplete="current-password" placeholder="${editingAccountId ? 'Laissez vide pour conserver le mot de passe actuel' : ''}"><br>
                <label for="account-duration">Durée de session (ex: 2h, 0.5h) :</label>
                <input type="text" id="account-duration" placeholder="ex: 2h ou vide pour illimité" value="${account && account.sessionDuration ? account.sessionDuration : ''}"><br>
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
        } else {
            // Modification : on ne met que ce qui est saisi (même si tout est vide, c'est accepté)
            if (email) accountData.email = email;
            if (pwdInput) accountData.password = pwdInput;
            if (sessionDuration) accountData.sessionDuration = sessionDuration;
            // Si rien n'est modifié, prévenir l'utilisateur
            if (Object.keys(accountData).length === 0) {
                showNotification("Aucune modification à enregistrer.", "info");
                return;
            }
        }
        try {
            let response, result;
            if (editingAccountId) {
                response = await fetch(`http://localhost:3000/accounts/${editingAccountId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(accountData)
                });
            } else {
                response = await fetch('http://localhost:3000/accounts', {
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

    async function deleteAccount(accountId, accountEmail) {
        if (!confirm(`Êtes-vous sûr de vouloir supprimer le compte ${accountEmail} (ID: ${accountId}) ?`)) return;
        try {
            const response = await fetch(`http://localhost:3000/accounts/${accountId}`, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                showNotification('Compte supprimé avec succès !', "success");
                await loadAndRenderAccounts();
                // Si le compte affiché était supprimé, vider la config
                if (editingAccountId === accountId) {
                    configFormDiv.innerHTML = '<p>Sélectionnez un compte pour afficher sa configuration.</p>';
                    editingAccountId = null;
                }
            } else {
                showNotification(`Erreur lors de la suppression: ${result.message || 'Erreur inconnue'}`, "error");
            }
        } catch (error) {
            console.error('Erreur lors de la suppression du compte:', error);
            showNotification('Erreur de communication avec le serveur.', "error");
        }
    }

    // Afficher la config d'un compte (lecture seule, avec bouton "Modifier")
    function renderConfigForm(accountId) {
        const account = accounts.find(acc => acc.id === accountId);
        if (!account) {
            configFormDiv.innerHTML = '<p>Compte introuvable.</p>';
            return;
        }
        configFormDiv.innerHTML = `
            <h3>Configuration du Compte</h3>
            <p><strong>Email :</strong> ${account.email}</p>
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
            const response = await fetch('http://localhost:3000/accounts/active');
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
        try {
            const response = await fetch('http://localhost:3000/accounts/active', {
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
            const response = await fetch('http://localhost:3000/config');
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
            const response = await fetch('http://localhost:3000/config', {
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

    // --- Initialisation ---
    loadAndRenderAccounts();
    loadBotConfig();
});