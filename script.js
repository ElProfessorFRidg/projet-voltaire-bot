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
    const saveActiveAccountsBtn = document.getElementById('save-active-accounts-btn');
    if (saveActiveAccountsBtn) {
        saveActiveAccountsBtn.addEventListener('click', saveAccountSelection);
    }

    let accounts = [];
    let botConfig = {};
    let editingAccountId = null;
   // [SUPPRIMÉ] Toute la logique d’affichage et de gestion du temps restant (session-timer) et time tracker pour simplification de l’interface.
   // [SUPPRIMÉ] Connexion socket.io pour timers, updateAllSessionTimers, sendSessionUpdates, formatDuration, etc.
   // [SUPPRIMÉ] Affichage du temps restant dans la liste des comptes.
   // [SUPPRIMÉ] Rafraîchissement et persistance du temps de session côté client.
   // [SUPPRIMÉ] Toute la logique dashboard et time tracker (voir plus bas).
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
            console.log('[DEBUG] Appel API /config...');
            const response = await fetch('http://localhost:3000/config');
            console.log('[DEBUG] Réponse API /config status:', response.status);
            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
            botConfig = await response.json();
            console.log('[DEBUG] Données reçues de /config:', botConfig);
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
        // Liste des clés attendues pour la config
        const configKeys = [
            "OPENAI_MODEL",
            "MIN_ACTION_DELAY",
            "MAX_ACTION_DELAY",
            "MIN_TYPING_DELAY",
            "MAX_TYPING_DELAY",
            "LOGIN_URL"
        ];
        // Si la config est vide, afficher un message d'erreur explicite
        if (!botConfig || Object.keys(botConfig).length === 0) {
            botConfigFormDiv.innerHTML = '<p style="color:red;">Configuration du bot absente ou vide. Vérifiez le backend ou le fichier .env.</p>';
            return;
        }
        let formHtml = '<h3>Configuration Générale du Bot</h3>';
        configKeys.forEach(key => {
            const value = botConfig[key] !== undefined ? botConfig[key] : '';
            const inputType = typeof value === 'number' ? 'number' : 'text';
            formHtml += `
                <div>
                    <label for="config-${key}">${key}:</label>
                    <input type="${inputType}" id="config-${key}" name="${key}" value="${value}">
                </div>
            `;
        });
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

// Fonction minimale pour charger et afficher les comptes (sans dashboard ni time tracker)
async function loadAndRenderAccounts() {
    try {
        const response = await fetch('http://localhost:3000/accounts');
        if (!response.ok) throw new Error('Erreur lors du chargement des comptes');
        accounts = await response.json();
        // Nettoyer la liste
        accountListDiv.innerHTML = '';
        if (!Array.isArray(accounts) || accounts.length === 0) {
            accountListDiv.innerHTML = '<p>Aucun compte enregistré.</p>';
            return;
        }
        // Afficher chaque compte avec options de sélection, modification, suppression
        accounts.forEach(acc => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span>${acc.email}</span>
                <button class="edit-account-btn" data-id="${acc.id}">Modifier</button>
                <button class="delete-account-btn" data-id="${acc.id}" data-email="${acc.email}">Supprimer</button>
                <input type="checkbox" class="account-checkbox" id="account-checkbox-${acc.id}" value="${acc.id}">
            `;
            accountListDiv.appendChild(li);
        });
        // Ajout des écouteurs pour modifier/supprimer
        accountListDiv.querySelectorAll('.edit-account-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = btn.getAttribute('data-id');
                showAccountForm(id);
            });
        });
        accountListDiv.querySelectorAll('.delete-account-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const id = btn.getAttribute('data-id');
                const email = btn.getAttribute('data-email');
                deleteAccount(id, email);
// Initialisation de la configuration générale du bot
    // (Retiré de la boucle forEach, voir plus bas)
            });
        });
        // Charger la sélection active
        await loadAndApplyActiveSelection();
    } catch (error) {
        accountListDiv.innerHTML = '<p style="color:red;">Erreur lors du chargement des comptes.</p>';
        console.error(error);
    }
}
    // --- Initialisation ---
    loadAndRenderAccounts();
    loadBotConfig();
// [SUPPRIMÉ] Toute la logique dashboard (filtres, graphiques, initialisation, données associées) pour simplification de l’interface.
// [SUPPRIMÉ] TimeTracker (affichage, gestion, requêtes /api/duration) pour simplification de l’interface.
});