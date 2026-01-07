/**
 * French translations for nirs4all webapp
 *
 * Traductions françaises pour l'application nirs4all webapp
 */

const fr = {
  // ============= Common / Global =============
  common: {
    loading: "Chargement...",
    save: "Enregistrer",
    cancel: "Annuler",
    delete: "Supprimer",
    edit: "Modifier",
    create: "Créer",
    add: "Ajouter",
    remove: "Retirer",
    close: "Fermer",
    confirm: "Confirmer",
    back: "Retour",
    next: "Suivant",
    previous: "Précédent",
    search: "Rechercher",
    filter: "Filtrer",
    clear: "Effacer",
    reset: "Réinitialiser",
    apply: "Appliquer",
    refresh: "Actualiser",
    export: "Exporter",
    import: "Importer",
    download: "Télécharger",
    upload: "Téléverser",
    browse: "Parcourir",
    copy: "Copier",
    copied: "Copié !",
    enabled: "Activé",
    disabled: "Désactivé",
    yes: "Oui",
    no: "Non",
    on: "Activé",
    off: "Désactivé",
    all: "Tout",
    none: "Aucun",
    active: "Actif",
    inactive: "Inactif",
    success: "Succès",
    error: "Erreur",
    warning: "Avertissement",
    info: "Info",
    notConfigured: "Non configuré",
    comingSoon: "Bientôt disponible",
    learnMore: "En savoir plus",
    optional: "Optionnel",
    required: "Requis",
    default: "Par défaut",
    custom: "Personnalisé",
    creating: "Création...",
    saving: "Enregistrement...",
    revertChanges: "Annuler les modifications",
  },

  // ============= Time / Date =============
  time: {
    justNow: "À l'instant",
    minutesAgo: "Il y a {{count}} minute",
    minutesAgo_other: "Il y a {{count}} minutes",
    hoursAgo: "Il y a {{count}} heure",
    hoursAgo_other: "Il y a {{count}} heures",
    daysAgo: "Il y a {{count}} jour",
    daysAgo_other: "Il y a {{count}} jours",
    weeksAgo: "Il y a {{count}} semaine",
    weeksAgo_other: "Il y a {{count}} semaines",
    monthsAgo: "Il y a {{count}} mois",
    monthsAgo_other: "Il y a {{count}} mois",
    lastCheck: "Dernière vérification",
    lastAccessed: "Dernier accès",
    createdAt: "Créé le",
    updatedAt: "Modifié le",
  },

  // ============= Navigation =============
  nav: {
    dashboard: "Tableau de bord",
    datasets: "Jeux de données",
    pipelines: "Pipelines",
    pipelineEditor: "Éditeur de pipeline",
    playground: "Bac à sable",
    runs: "Exécutions",
    results: "Résultats",
    predictions: "Prédictions",
    analysis: "Analyse",
    settings: "Paramètres",
    newExperiment: "Nouvelle expérience",
  },

  // ============= Settings Page =============
  settings: {
    title: "Paramètres",
    subtitle: "Configurez votre espace de travail et vos préférences",

    // Tab labels
    tabs: {
      general: "Général",
      workspace: "Espace de travail",
      data: "Données par défaut",
      advanced: "Avancé",
    },

    // General settings section
    general: {
      // Appearance
      appearance: {
        title: "Apparence",
        description: "Personnalisez l'aspect de l'application",
        theme: "Thème",
        themeLight: "Clair",
        themeDark: "Sombre",
        themeSystem: "Système",
      },
      // Display density
      density: {
        title: "Densité d'affichage",
        description: "Ajustez l'espacement dans l'interface",
        compact: "Compact",
        comfortable: "Confortable",
        spacious: "Spacieux",
      },
      // Animations
      animations: {
        title: "Réduire les animations",
        description: "Minimiser les mouvements pour l'accessibilité ou les performances",
      },
      // Language
      language: {
        title: "Langue",
        description: "Choisissez votre langue d'interface préférée",
        select: "Sélectionner la langue",
        current: "Langue actuelle",
        restart: "Certains changements peuvent nécessiter un rechargement de la page",
      },
    },

    // Workspace section
    workspace: {
      current: {
        title: "Espace de travail actuel",
        description:
            "Sélectionner l'espace de travail pour stocker les pipelines, résultats et prédictions",
        emptyHint: "Aucun espace de travail récent. Créez ou ouvrez un espace de travail pour commencer.",
        count: "{{count}} espace de travail",
        count_other: "{{count}} espaces de travail",
        openHint: "Basculer vers cet espace de travail",
        placeholder: "Aucun espace de travail sélectionné",
        selectButton: "Sélectionner un espace de travail",
        removeDescription:
          "Cela retirera \"{{name}}\" de la liste des espaces de travail récents. Les fichiers ne seront pas supprimés.",
        browseButton: "Parcourir",
        removeError: "Échec de la suppression de l'espace de travail",
        switchSuccess: "Espace de travail sélectionné",
        current: "Actuel",
      },
      create: {
        title: "Créer un nouvel espace de travail",
        description: "Créez un nouvel espace de travail avec une structure de dossiers standard",
        name: "Nom",
        namePlaceholder: "mon_projet",
        location: "Emplacement",
        locationPlaceholder: "/home/utilisateur/nirs",
        locationDescription: "Répertoire parent pour le nouvel espace de travail",
        descriptionLabel: "Description",
        descriptionPlaceholder: "Description optionnelle...",
        createStructure: "Créer la structure de dossiers standard",
        createStructureHint:
          "(results/, pipelines/, models/, predictions/)",
         createButton: "Créer l'espace de travail",
        creating: "Création...",
        switching: "Basculement vers le nouvel espace de travail...",
        success: "Espace de travail créé avec succès",
        error: "Échec de la création de l'espace de travail",
        path: "Chemin",
        pathPreview: "L'espace de travail sera créé à",
        pathPreviewEmpty: "Sélectionnez un emplacement et saisissez un nom",
        validation: {
          nameRequired: "Le nom de l'espace de travail est requis",
          locationRequired: "L'emplacement de l'espace de travail est requis",
        },
      },
      recent: {
        title: "Espaces de travail récents",
        empty: "Aucun espace de travail récent",
        open: "Ouvrir",
        remove: "Retirer de la liste",
        removeConfirm: "Retirer cet espace de travail de la liste des récents ?",
        removeSuccess: "Espace de travail retiré de la liste",
        datasets: "{{count}} jeu de données",
        datasets_other: "{{count}} jeux de données",
        pipelines: "{{count}} pipeline",
        pipelines_other: "{{count}} pipelines",
      },
      stats: {
        title: "Statistiques de l'espace de travail",
        description: "Répartition de l'utilisation du stockage par catégorie",
        totalSize: "Taille totale",
        linkedDatasets: "Jeux de données liés",
        externalData: "Données externes",
        refresh: "Actualiser",
        categories: {
          datasets: "Jeux de données",
          pipelines: "Pipelines",
          results: "Résultats",
          models: "Modèles",
          predictions: "Prédictions",
          cache: "Cache",
          other: "Autre",
        },
      },
      export: {
        title: "Exporter l'espace de travail",
        description: "Créer une archive de votre espace de travail",
        includeDatasets: "Inclure les jeux de données",
        includeModels: "Inclure les modèles",
        includeResults: "Inclure les résultats",
        outputPath: "Chemin de sortie",
        exportButton: "Exporter",
        exporting: "Exportation...",
        success: "Espace de travail exporté avec succès",
        error: "Échec de l'exportation de l'espace de travail",
      },
      import: {
        title: "Importer un espace de travail",
        description: "Importer un espace de travail depuis une archive",
        archivePath: "Fichier d'archive",
        destination: "Destination",
        workspaceName: "Nom de l'espace de travail",
        importButton: "Importer",
        importing: "Importation...",
        success: "Espace de travail importé avec succès",
        error: "Échec de l'importation de l'espace de travail",
      },
    },

    // Data defaults section
    dataDefaults: {
      title: "Paramètres de chargement par défaut",
      description:
        "Paramètres par défaut appliqués lors du chargement de nouveaux jeux de données",
      note: "Ces paramètres par défaut sont appliqués lors de l'ajout de nouveaux jeux de données via l'assistant. Chaque jeu de données peut remplacer ces paramètres pendant le processus de chargement.",
      selectWorkspace:
        "Sélectionnez un espace de travail pour configurer les paramètres de chargement par défaut",
      savedSuccess: "Valeurs par défaut enregistrées avec succès",
      autoDetectDescription:
        "Détecter automatiquement le délimiteur, le séparateur décimal et l'en-tête à partir du contenu du fichier",
      parsing: {
        title: "Options d'analyse",
        tooltip:
          "Ces valeurs par défaut sont utilisées lorsque l'auto-détection est désactivée ou échoue",
        delimiter: "Délimiteur",
        delimiterDescription: "Caractère séparateur de colonnes",
        delimiters: {
          semicolon: "Point-virgule (;)",
          comma: "Virgule (,)",
          tab: "Tabulation",
          space: "Espace",
        },
        decimal: "Séparateur décimal",
        decimalDescription: "Caractère de séparation décimale",
        decimals: {
          dot: "Point (.)",
          comma: "Virgule (,)",
        },
        hasHeader: "Contient une ligne d'en-tête",
        hasHeaderDescription: "La première ligne contient les noms des colonnes",
        headerUnit: "Unité d'en-tête",
        headerUnitDescription: "Unité pour les en-têtes de colonnes de longueur d'onde",
        headerUnits: {
          nm: "Nanomètres (nm)",
          "cm-1": "Nombre d'onde (cm⁻¹)",
          text: "Étiquettes texte",
          none: "Pas d'unités",
          index: "Index de colonne",
        },
      },
      signal: {
        title: "Configuration du signal",
        type: "Type de signal",
        typeDescription: "Type de mesure spectrale",
        types: {
          auto: "Détection automatique",
          absorbance: "Absorbance",
          reflectance: "Réflectance",
          "reflectance%": "Réflectance (%)",
          transmittance: "Transmittance",
          "transmittance%": "Transmittance (%)",
        },
      },
      missing: {
        title: "Valeurs manquantes",
        description: "Comment gérer les valeurs manquantes ou invalides",
        policy: "Politique NA",
        policies: {
          drop: "Supprimer les lignes",
          fill_mean: "Remplir avec la moyenne",
          fill_median: "Remplir avec la médiane",
          fill_zero: "Remplir avec zéro",
          error: "Lever une erreur",
        },
      },
      autoDetect: "Détecter automatiquement le format",
      save: "Enregistrer les paramètres par défaut",
      reset: "Réinitialiser aux valeurs par défaut",
    },

    // Advanced section
    advanced: {
      developer: {
        title: "Mode développeur",
        description: "Activez des fonctionnalités supplémentaires pour le développement et les tests",
        enable: "Activer le mode développeur",
        hint: "Affiche la génération de données synthétiques, les informations de débogage et les options avancées",
        needsWorkspace: "Sélectionnez un espace de travail pour activer le mode développeur",
      },
      backend: {
        title: "Connexion au backend",
        description: "Point de terminaison API et paramètres de connexion",
        url: "URL du backend",
        urlHint: "Point de terminaison API (lecture seule en production)",
        status: {
          title: "État du backend",
          description: "Santé de la connexion et latence",
          connected: "Connecté",
          disconnected: "Déconnecté",
          degraded: "Dégradé",
          checking: "Vérification...",
          latency: "Latence",
          lastCheck: "Dernière vérification",
          testConnection: "Tester la connexion",
          successRate: "Taux de réussite",
          avgLatency: "Latence moyenne",
          recentChecks: "Vérifications récentes",
          failed: "Échec",
          autoRefreshEvery: "Rafraîchissement auto toutes les {{seconds}}s",
        },
      },
      system: {
        title: "Informations système",
        description: "Environnement Python et détails du système",
        python: "Python",
        version: "Version",
        platform: "Plateforme",
        executable: "Exécutable",
        os: "Système d'exploitation",
        osRelease: "Version",
        architecture: "Architecture",
        nirs4all: "nirs4all",
        capabilities: "Capacités",
        packages: "Paquets installés",
        copyToClipboard: "Copier les informations système",
        copied: "Copié dans le presse-papiers",
      },
      errors: {
        title: "Journal des erreurs",
        description: "Erreurs récentes pour le débogage",
        empty: "Aucune erreur enregistrée",
        clear: "Effacer les journaux",
        clearConfirm: "Effacer tous les journaux d'erreurs ?",
        clearSuccess: "Journaux d'erreurs effacés",
        refresh: "Actualiser",
        endpoint: "Point de terminaison",
        message: "Message",
        traceback: "Trace d'appel",
        copyError: "Copier les détails de l'erreur",
      },
      troubleshooting: {
        title: "Dépannage",
        description: "Effacer les données locales et réinitialiser les paramètres",
        clearCache: "Effacer le cache local",
        clearCacheHint: "Réinitialiser le stockage local et les données de session",
        clearCacheConfirm: "Effacer le cache local ?",
        clearCacheDescription:
          "Cela effacera toutes les données du stockage local et de session. La page sera rechargée après l'effacement.",
        resetDefaults: "Réinitialiser aux valeurs par défaut",
        resetDefaultsHint: "Restaurer tous les paramètres à leurs valeurs par défaut",
        resetDefaultsConfirm: "Réinitialiser tous les paramètres ?",
        resetDefaultsDescription:
          "Cela réinitialisera tous les paramètres de l'application à leurs valeurs par défaut et effacera le stockage local. Cette action ne peut pas être annulée.",
      },
    },

    // App info footer
    appInfo: {
      version: "nirs4all webapp v{{version}}",
      copyright: "© {{year}} nirs4all",
    },
  },

  // ============= Keyboard Shortcuts =============
  shortcuts: {
    title: "Raccourcis clavier",
    description: "Référence rapide des raccourcis clavier",
    categories: {
      global: "Global",
      pipelineEditor: "Éditeur de pipeline",
      playground: "Bac à sable",
    },
    keys: {
      commandPalette: "Ouvrir la palette de commandes",
      toggleSidebar: "Afficher/masquer la barre latérale",
      openSettings: "Ouvrir les paramètres",
      savePipeline: "Enregistrer le pipeline",
      undo: "Annuler",
      redo: "Rétablir",
      deleteStep: "Supprimer l'étape sélectionnée",
      nextPanel: "Panneau suivant",
      applyPipeline: "Appliquer le pipeline",
      exportData: "Exporter",
    },
  },

  // ============= Dashboard =============
  dashboard: {
    title: "Tableau de bord",
    welcome: "Bon retour",
    quickStart: "Démarrage rapide",
    recentActivity: "Activité récente",
    stats: {
      datasets: "Jeux de données",
      pipelines: "Pipelines",
      runs: "Exécutions",
      models: "Modèles",
    },
    developer: {
      title: "Démarrage rapide développeur",
      description: "Générez des jeux de données synthétiques pour les tests et le développement",
      generate: "Générer",
      preset: "Préréglage",
      presets: {
        regressionSmall: "Régression (250 échantillons)",
        regressionLarge: "Régression (2500 échantillons)",
        classification: "Classification (3 classes)",
        custom: "Configuration personnalisée",
      },
    },
  },

  // ============= Datasets =============
  datasets: {
    title: "Jeux de données",
    empty: "Aucun jeu de données lié",
    emptyHint: "Liez un jeu de données pour commencer",
    addDataset: "Ajouter un jeu de données",
    generateSynthetic: "Générer synthétique",
    actions: {
      view: "Voir",
      edit: "Modifier",
      refresh: "Actualiser",
      export: "Exporter",
      unlink: "Délier",
      delete: "Supprimer",
    },
    info: {
      samples: "Échantillons",
      features: "Caractéristiques",
      targets: "Cibles",
      path: "Chemin",
      status: "État",
    },
    synthetic: {
      title: "Générer un jeu de données synthétique",
      description: "Créez des données NIRS synthétiques pour les tests et le développement",
      taskType: "Type de tâche",
      taskTypes: {
        regression: "Régression",
        binary_classification: "Classification binaire",
        multiclass_classification: "Classification multi-classes",
      },
      samples: "Nombre d'échantillons",
      complexity: "Complexité",
      complexities: {
        simple: "Simple",
        realistic: "Réaliste",
        complex: "Complexe",
      },
      classes: "Nombre de classes",
      trainRatio: "Ratio d'entraînement",
      options: {
        title: "Options",
        includeMetadata: "Inclure les métadonnées",
        includeRepetitions: "Inclure les répétitions",
        repetitionsPerSample: "Répétitions par échantillon",
        noiseLevel: "Niveau de bruit",
        addBatchEffects: "Ajouter des effets de lot",
        numBatches: "Nombre de lots",
        autoLink: "Lier automatiquement à l'espace de travail",
      },
      generate: "Générer le jeu de données",
      generating: "Génération...",
      success: "Jeu de données synthétique généré avec succès",
      error: "Échec de la génération du jeu de données synthétique",
    },
  },

  // ============= Pipelines =============
  pipelines: {
    title: "Pipelines",
    empty: "Aucun pipeline créé",
    emptyHint: "Créez un nouveau pipeline pour commencer",
    create: "Créer un pipeline",
    editor: {
      title: "Éditeur de pipeline",
      untitled: "Pipeline sans titre",
      save: "Enregistrer le pipeline",
      run: "Exécuter le pipeline",
      validate: "Valider",
    },
    steps: {
      preprocessing: "Prétraitement",
      splitting: "Division",
      model: "Modèle",
      metrics: "Métriques",
    },
  },

  // ============= Runs =============
  runs: {
    title: "Exécutions",
    empty: "Aucune exécution",
    emptyHint: "Démarrez une nouvelle expérience pour voir les exécutions ici",
    newRun: "Nouvelle exécution",
    status: {
      queued: "En file d'attente",
      running: "En cours",
      completed: "Terminé",
      failed: "Échoué",
      cancelled: "Annulé",
      paused: "En pause",
    },
    actions: {
      view: "Voir les détails",
      stop: "Arrêter",
      pause: "Pause",
      resume: "Reprendre",
      retry: "Réessayer",
      delete: "Supprimer",
    },
  },

  // ============= Errors & Validation =============
  errors: {
    generic: "Une erreur s'est produite",
    networkError: "Erreur réseau. Veuillez vérifier votre connexion.",
    serverError: "Erreur serveur. Veuillez réessayer plus tard.",
    notFound: "Non trouvé",
    unauthorized: "Non autorisé",
    forbidden: "Accès refusé",
    validation: "Erreur de validation",
    required: "Ce champ est requis",
    invalidFormat: "Format invalide",
    tooShort: "Trop court",
    tooLong: "Trop long",
    invalidPath: "Chemin invalide",
    pathNotExists: "Le chemin n'existe pas",
    alreadyExists: "Existe déjà",
  },

  // ============= Confirmations =============
  confirm: {
    delete: {
      title: "Confirmer la suppression",
      description: "Êtes-vous sûr de vouloir supprimer ceci ? Cette action ne peut pas être annulée.",
    },
    unsavedChanges: {
      title: "Modifications non enregistrées",
      description: "Vous avez des modifications non enregistrées. Voulez-vous enregistrer avant de quitter ?",
      save: "Enregistrer",
      discard: "Abandonner",
      stay: "Rester",
    },
  },

  // ============= Accessibility =============
  a11y: {
    skipToContent: "Aller au contenu",
    closeDialog: "Fermer le dialogue",
    openMenu: "Ouvrir le menu",
    loading: "Chargement, veuillez patienter",
    expandSection: "Développer la section",
    collapseSection: "Réduire la section",
  },
};

export default fr;
