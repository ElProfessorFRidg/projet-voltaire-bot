## Audit des bugs potentiels

### Bugs critiques/majeurs

1.  **Conditions de course lors de la lecture/écriture du fichier d’accounts (src/server.js)**
    *   Description : `readAccountsFile` et `writeAccountsFile` utilisent `fs.readFile`/`fs.writeFile` sans synchronisation, exposant à des écrasements concurrents si plusieurs requêtes modifient les mêmes données.
    *   Scénario : deux sessions simultanées appellent `writeAccountsFile` presque en même temps ; l’une écrit après l’autre, supprimant les modifications intermédiaires.

2.  **Mutex/Semaphore non libérés en cas d’exception (src/async_utils.js)**
    *   Description : dans `Mutex.runExclusive` et `Semaphore.runExclusive`, l’appel à `unlock`/`release` n’est pas garanti si la fonction asynchrone échoue.
    *   Scénario : la fonction passée à `runExclusive` rejette ; le verrou n’est jamais libéré et bloque indéfiniment les appels suivants.

3.  **Fuite de ressources dans la gestion de sessions de navigateur (src/browser_manager.js)**
    *   Description : `initializeBrowserSession` stocke `sessionId` dans une Map globale, et `closeBrowserSession` peut échouer sans retrait de la Map, entraînant une accumulation de sessions fantômes.
    *   Scénario : crash d’un navigateur avant appel de `closeBrowserSession` ; la session reste dans `activeSessions`, consommant mémoire.

4.  **File d’actions hors ligne illimitée (src/offline_manager.js)**
    *   Description : `queueAction` ajoute sans limite dans un tableau, et `synchronizeQueuedActions` ne gère pas les effacements partiels en cas d’erreur.
    *   Scénario : l’utilisateur perd souvent la connexion ; la queue grandit indéfiniment, provoquant un OOM.

5.  **Timeouts et gestion des promesses non traités (services/openai_client.js & popup_solver.js)**
    *   Description : appels à l’API OpenAI (`chat.completions.create`) et boucles d’attente de popup (`solvePopup`) sans délai maximal ni catch global, menant à des promesses pendantes.
    *   Scénario : API lent ou popup jamais visible ; la fonction reste bloquée, bloquant le flow de l’application.

6.  **Absence de validation et de capture d’erreur JSON (src/config_loader.js)**
    *   Description : `loadAccountsFromJSON` fait un `JSON.parse` sans `try/catch`, une JSON invalide plantant l’application.
    *   Scénario : fichier `accounts.json` corrompu ; appel de l’API retourne une exception non gérée.

7.  **Validation d’email trop permissive (src/validation_utils.js)**
    *   Description : la regex de `validateEmail` n’est pas conforme aux standards RFC, acceptant des adresses invalides.
    *   Scénario : email `user@localhost` ou `user@@domain.com` passe la validation, induisant des erreurs en aval.

### Bugs mineurs

#### Gestion du temps

8.  **Incohérence d'horloge dans `updateAccountSessionUI` (script.js)**
    *   Description : La fonction compare `sessionEnd` à `Date.now()` (ligne 802) au lieu d'utiliser `Date.now() + timeOffset`, ce qui décale l'affichage du temps restant.
    *   Fichier : `script.js`

9.  **`parseDurationString` trop restrictif (src/utils/time_utils.js)**
    *   Description : N'accepte que les chaînes "Xh" ; pas de support pour "30m" ni "1h30m".
    *   Fichier : `src/utils/time_utils.js`

10. **Affichage initial de l'heure serveur bloqué (script.js)**
    *   Description : Si le module `time_sync` échoue, l'élément `#server-time-value` reste sur "Chargement..." et n'affiche jamais d'heure de secours.
    *   Fichier : `script.js`

#### Affichage web & interactions

11. **Bouton "Sauvegarder la sélection" inopérant (index.html + script.js)**
    *   Description : L'ID dans le HTML (`save-active-accounts-btn`, ligne 27) ne correspond pas à celui écouté dans le JS (`save-account-selection-btn`, ligne 972).
    *   Fichiers : `index.html`, `script.js`

12. **Élément `<main>` manquant (index.html)**
    *   Description : `script.js` (ligne 50) tente de sélectionner `main` pour suspendre l'UI, mais cet élément n'existe pas dans `index.html`.
    *   Fichiers : `index.html`, `script.js`

13. **Conteneur `.container` trop large (style.css)**
    *   Description : La combinaison de `width: 96vw`, `gap` et `padding` provoque un débordement horizontal sur les petits écrans.
    *   Fichier : `style.css`

14. **Bouton de bascule thème mal stylé (style.css)**
    *   Description : `#theme-toggle-btn` utilise `var(--color-panel-dark)` pour son fond même en mode clair, le rendant peu visible.
    *   Fichier : `style.css`

#### Cas limites et propagation d'erreurs

15. **Gestion imprécise des formats/valeurs limites dans `parseDurationString` (src/utils/time_utils.js)**
    *   Description : La fonction peut retourner des erreurs peu claires ou échouer à gérer correctement des entrées comme `"Infinityh"`, de très grands nombres (pouvant causer des problèmes avec `BigInt`), ou des unités non reconnues (ex: `"2x"`).
    *   Risque : Difficulté à diagnostiquer la cause exacte d'une erreur (format invalide vs dépassement de capacité).
    *   Fichier : `src/utils/time_utils.js`

16. **Non-gestion de `Infinity` dans `calculateSessionEnd` (src/utils/time_utils.js)**
    *   Description : Si `startTime` ou `durationMs` est `Infinity`, la fonction retourne `Infinity` sans vérification `isFinite`, ce qui peut se propager.
    *   Risque : Propagation de `Infinity` dans les calculs dépendants, menant à des résultats inattendus ou `NaN`.
    *   Fichier : `src/utils/time_utils.js`

17. **Propagation de `NaN` depuis la configuration JSON (src/config_loader.js)**
    *   Description : Si un champ numérique attendu (ex: `"MAX_ACTION_DELAY"`) est manquant ou mal formaté (ex: `" -100 "`) dans `config/web_config.json`, `parseInt` peut retourner `NaN`. Ce `NaN` peut se propager silencieusement.
    *   Risque : Comportement erratique des fonctionnalités dépendant de cette configuration (ex: temporisations incorrectes).
    *   Fichiers : `config/web_config.json`, `src/config_loader.js`

18. **Accès potentiel à une propriété sur `undefined` (src/validation_utils.js)**
    *   Description : Tenter d'appeler `.trim()` sur le résultat de la validation d'email (ex: `validate(...).email.trim()`) plantera avec une `TypeError` si le champ `email` est `undefined`.
    *   Risque : Crash non géré lors de la validation si une donnée attendue est manquante.
    *   Fichier : `src/utils/validation_utils.js`

### Robustesse et récupération sur erreur

19. **Absence de détection/gestion des crashs navigateur (src/browser_manager.js)**
    *   Description : Aucun listener (`close`, `disconnected`, `pageerror`) n'est attaché aux objets Playwright (`browser`, `page`, `context`) pour détecter une fermeture inopinée. La fonction `autoFixPlaywrightEnvironment` n'est appelée qu'à l'initialisation.
    *   Conséquence : En cas de crash du navigateur en cours de session, l'état n'est pas nettoyé (sessions orphelines, verrous actifs), l'UI reste bloquée sans feedback ni tentative de redémarrage.
    *   Fichier : `src/browser_manager.js`

20. **Manque de feedback UI sur erreurs réseau/API (src/openai_client.js)**
    *   Description : Les erreurs lors des appels à l'API OpenAI (`getCorrection`, `getErrorReportSuggestion`) sont logguées mais ne déclenchent aucune notification ou mise à jour de l'interface utilisateur. L'initialisation avec une clé API invalide est également silencieuse.
    *   Conséquence : L'utilisateur ignore qu'une opération a échoué et qu'il doit réessayer, ou que la fonctionnalité OpenAI n'est pas disponible.
    *   Fichier : `src/openai_client.js`

21. **Perte potentielle de données hors ligne (src/offline_manager.js)**
    *   Description : `synchronizeQueuedActions` vide la file d'actions même si certaines échouent lors de la synchronisation (elles sont logguées mais pas remises en file).
    *   Conséquence : Perte définitive des actions qui n'ont pas pu être synchronisées avec le serveur.
    *   Fichier : `src/offline_manager.js`

22. **Gestion manuelle du statut online/offline (src/offline_manager.js)**
    *   Description : L'application ne réagit pas automatiquement aux événements `online`/`offline` du navigateur pour mettre à jour son état interne.
    *   Conséquence : Risque de désynchronisation entre l'état réel de la connexion et l'état perçu par l'application.
    *   Fichier : `src/offline_manager.js`

### Comportements non intuitifs ou sources de confusion

23. **Sélection aléatoire non documentée du modèle OpenAI (src/openai_client.js)**
    *   Description : Le choix entre `gpt-4.1` et le modèle configuré est fait aléatoirement (50/50) sans que cela soit indiqué ou configurable.
    *   Conséquence : Variabilité inattendue des réponses et des performances, rendant le débogage difficile.
    *   Fichier : `src/openai_client.js`

24. **Notifications persistantes potentiellement gênantes (src/offline_manager.js)**
    *   Description : Les notifications de perte de connexion sont marquées comme persistantes (`persistent: true`) et ne sont pas automatiquement effacées.
    *   Conséquence : Accumulation possible de notifications qui peuvent masquer des messages plus récents ou importants.
    *   Fichier : `src/offline_manager.js`

25. **Logs d'erreur manquant de contexte (src/logger.js)**
    *   Description : Certains logs d'erreur ne contiennent pas d'informations contextuelles clés (ex: `sessionId`, URL, fonction appelante).
    *   Conséquence : Difficulté à tracer l'origine exacte d'une erreur, surtout dans un environnement multi-sessions.
    *   Fichier : `src/logger.js`

26. **Absence d'indicateur de chargement pour opérations longues (client/scripts/script.js)**
    *   Description : Aucun retour visuel (spinner, message) n'est affiché pendant les opérations potentiellement longues comme l'appel à OpenAI ou le lancement du navigateur.
    *   Conséquence : L'utilisateur peut penser que l'application est bloquée, cliquer plusieurs fois inutilement ou être confus quant à l'état de sa requête.
    *   Fichier : `client/scripts/script.js`

27. **Validation silencieuse des options de navigateur (src/browser_manager.js)**
    *   Description : La fonction `validateBrowserSessionOptions` rejette les options invalides sans générer de message d'erreur visible par l'utilisateur dans l'UI.
    *   Conséquence : L'utilisateur peut tenter de lancer une session avec des options incorrectes sans comprendre pourquoi cela échoue (aucun navigateur ne se lance).
    *   Fichier : `src/browser_manager.js` (implicitement, via son utilisation)