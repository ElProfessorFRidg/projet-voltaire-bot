# Bot Projet Voltaire 🤖📚✍️

Un script Node.js pour automatiser certaines tâches sur la plateforme Projet Voltaire, en utilisant Playwright pour le contrôle du navigateur et l'API OpenAI pour l'assistance à la résolution.

## Description 📝

Ce projet vise à explorer l'automatisation de la navigation et de l'interaction avec la plateforme d'entraînement Projet Voltaire. Il utilise des technologies modernes comme Playwright pour simuler une interaction utilisateur réaliste et peut s'interfacer avec des modèles de langage comme ceux d'OpenAI pour analyser et répondre aux exercices.

**Attention :** Ce projet est développé à des fins éducatives et expérimentales uniquement. L'automatisation de plateformes tierces peut enfreindre leurs conditions d'utilisation. Utilisez ce script de manière responsable et éthique.

## Mots-clés 🔑

Projet Voltaire, automatisation, bot, Playwright, Node.js, JavaScript, OpenAI, GPT, entraînement orthographe, grammaire française, scraping, simulation humaine, dotenv, winston.

## Fonctionnement détaillé ⚙️

Le script suit les étapes suivantes pour interagir avec Projet Voltaire :

1.  **Chargement de la configuration** (`config_loader.js`): Lit les informations sensibles (identifiants, clé API OpenAI) depuis un fichier `.env`.
2.  **Gestion du navigateur** (`browser_manager.js`): Lance et contrôle une instance de navigateur (Chromium, Firefox, ou WebKit) via Playwright.
3.  **Authentification** (`auth_handler.js`): Se connecte à la plateforme Projet Voltaire en utilisant les identifiants fournis.
4.  **Navigation et Analyse** (`exercise_parser.js`, `solver_engine.js`): Navigue vers les modules d'entraînement, identifie et extrait le contenu des exercices.
5.  **Simulation Humaine** (`human_simulator.js`): Imite des délais et des interactions humaines (mouvements de souris, frappe au clavier) pour rendre l'automatisation moins détectable.
6.  **Résolution (via OpenAI)** (`openai_client.js`, `solver_engine.js`): Envoie le contenu de l'exercice à l'API OpenAI pour obtenir une suggestion de réponse.
7.  **Gestion des Popups** (`popup_solver.js`): Détecte et gère potentiellement les fenêtres pop-up spécifiques à la plateforme.
8.  **Logging** (`logger.js`): Enregistre les actions importantes, les succès et les erreurs dans des fichiers logs pour le débogage.

## Fonctionnalités implémentées ✅

-   [x] Chargement sécurisé de la configuration via `.env`.
-   [x] Lancement et gestion du navigateur avec Playwright.
-   [x] Connexion automatique à la plateforme.
-   [x] Extraction basique du contenu des exercices.
-   [x] Simulation de délais aléatoires.
-   [x] Intégration avec l'API OpenAI pour l'aide à la résolution.
-   [x] Système de logging avec Winston.
-   [x] Gestion basique des popups (à vérifier/améliorer).

## Installation 🚀

1.  **Cloner le dépôt :**
    ```bash
    git clone https://github.com/ElProfessorFRidg/projet-voltaire-bot
    cd projet-voltaire-bot
    ```
2.  **Installer les dépendances :**
    ```bash
    npm install
    ```
3.  **Installer les navigateurs Playwright :**
    ```bash
    npx playwright install
    ```
4.  **Configurer l'environnement :**
    *   Copiez le fichier `.env.example` en `.env`.
        ```bash
        # Sur Windows (PowerShell)
        copy .env.example .env

        # Sur macOS/Linux
        cp .env.example .env
        ```
    *   Modifiez le fichier `.env` avec vos informations :
        ```dotenv
        # Identifiants Projet Voltaire
        VOLTAIRE_USERNAME="votre_email_ou_identifiant"
        VOLTAIRE_PASSWORD="votre_mot_de_passe"

        # Clé API OpenAI (obligatoire)
        OPENAI_API_KEY="votre_clé_api_openai"

        # Autres configurations (optionnel)
        # LOG_LEVEL=info
        # BROWSER_TYPE=chromium # chromium, firefox, webkit
        # HEADLESS_MODE=true # true pour invisible, false pour visible
        ```

## Utilisation ▶️

Pour lancer le script principal :

```bash
node main.js
```

Assurez-vous que votre fichier `.env` est correctement configuré.

## Dépendances 📦

-   [Playwright](https://playwright.dev/): Pour l'automatisation du navigateur.
-   [OpenAI Node.js Library](https://github.com/openai/openai-node): Pour interagir avec l'API OpenAI.
-   [dotenv](https://github.com/motdotla/dotenv): Pour charger les variables d'environnement depuis un fichier `.env`.
-   [Winston](https://github.com/winstonjs/winston): Pour un logging flexible.

## TODO 🚧

-   [ ] Améliorer la robustesse de l'analyse des exercices (`exercise_parser.js`).
-   [ ] Gérer plus de types d'exercices différents.
-   [ ] Affiner la simulation humaine (`human_simulator.js`) pour être plus réaliste.
-   [ ] Ajouter une meilleure gestion des erreurs et des tentatives de reconnexion.
-   [ ] Implémenter des tests unitaires et d'intégration.
-   [ ] Optimiser les requêtes à l'API OpenAI (coût, efficacité).
-   [ ] Ajouter une interface utilisateur simple (CLI ou web) pour faciliter l'utilisation.
-   [ ] Documenter le code de manière plus détaillée (JSDoc).
-   [ ] Gérer explicitement les différents niveaux d'entraînement (Supérieur, Excellence, etc.).
-   [ ] Améliorer la gestion des popups (`popup_solver.js`).

*(N'hésitez pas à ajouter vos propres TODOs ici !)*

## Avertissement ⚠️

L'utilisation de ce script est à vos propres risques. L'automatisation de plateformes peut entraîner des suspensions de compte si elle est détectée et jugée contraire aux conditions d'utilisation. Soyez conscient des implications éthiques et légales. Ce projet est fourni "tel quel", sans garantie d'aucune sorte.

## Licence 📄

Ce projet est sous licence ISC. Voir le fichier `LICENSE` (s'il existe) ou les informations du `package.json` pour plus de détails.