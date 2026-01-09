/**
 * German translations for nirs4all webapp
 *
 * Deutsche Übersetzungen für die nirs4all webapp
 */

const de = {
  // ============= Common / Global =============
  common: {
    loading: "Wird geladen...",
    save: "Speichern",
    cancel: "Abbrechen",
    delete: "Löschen",
    add: "Hinzufügen",
    remove: "Entfernen",
    reset: "Zurücksetzen",
    apply: "Anwenden",
    refresh: "Aktualisieren",
    export: "Exportieren",
    import: "Importieren",
    download: "Herunterladen",
    upload: "Hochladen",
    browse: "Durchsuchen",
    copy: "Kopieren",
    copied: "Kopiert!",
    enabled: "Aktiviert",
    disabled: "Deaktiviert",
    yes: "Ja",
    no: "Nein",
    on: "Ein",
    off: "Aus",
    all: "Alle",
    none: "Keine",
    active: "Aktiv",
    inactive: "Inaktiv",
    success: "Erfolg",
    error: "Fehler",
    warning: "Warnung",
    info: "Info",
    notConfigured: "Nicht konfiguriert",
    comingSoon: "Demnächst verfügbar",
    learnMore: "Mehr erfahren",
    optional: "Optional",
    required: "Erforderlich",
    default: "Standard",
     creating: "Wird erstellt...",
     custom: "Benutzerdefiniert",
  },

  // ============= Time / Date =============
  time: {
    justNow: "Gerade eben",
    minutesAgo: "Vor {{count}} Minute",
    minutesAgo_other: "Vor {{count}} Minuten",
    hoursAgo: "Vor {{count}} Stunde",
    hoursAgo_other: "Vor {{count}} Stunden",
    daysAgo: "Vor {{count}} Tag",
    daysAgo_other: "Vor {{count}} Tagen",
    weeksAgo: "Vor {{count}} Woche",
    weeksAgo_other: "Vor {{count}} Wochen",
    monthsAgo: "Vor {{count}} Monat",
    monthsAgo_other: "Vor {{count}} Monaten",
    lastCheck: "Letzte Prüfung",
    lastAccessed: "Letzter Zugriff",
    createdAt: "Erstellt am",
    updatedAt: "Aktualisiert am",
  },

  // ============= Navigation =============
  nav: {
    dashboard: "Dashboard",
    datasets: "Datensätze",
    pipelines: "Pipelines",
    pipelineEditor: "Pipeline-Editor",
    playground: "Spielwiese",
    runs: "Ausführungen",
    results: "Ergebnisse",
    predictions: "Vorhersagen",
    analysis: "Analyse",
    settings: "Einstellungen",
    newExperiment: "Neues Experiment",
  },

  // ============= Settings Page =============
  settings: {
    title: "Einstellungen",
    subtitle: "Konfigurieren Sie Ihren Arbeitsbereich und Ihre Präferenzen",

    // Tab labels
    tabs: {
      general: "Allgemein",
      workspace: "Arbeitsbereich",
      data: "Daten-Standards",
      advanced: "Erweitert",
    },

    // General settings section
    general: {
      // Appearance
      appearance: {
        title: "Erscheinungsbild",
        description: "Passen Sie das Aussehen der Anwendung an",
        theme: "Design",
        themeLight: "Hell",
        themeDark: "Dunkel",
        themeSystem: "System",
      },
      // Display density
      density: {
        title: "Anzeigedichte",
        description: "Passen Sie Abstände in der Benutzeroberfläche an",
        compact: "Kompakt",
        comfortable: "Komfortabel",
        spacious: "Geräumig",
      },
      animations: {
        title: "Animationen reduzieren",
        description: "Bewegungen für Barrierefreiheit oder Leistung minimieren",
      },
      // Language
      language: {
        title: "Sprache",
        description: "Wählen Sie Ihre bevorzugte Oberflächensprache",
        select: "Sprache auswählen",
        current: "Aktuelle Sprache",
        restart: "Einige Änderungen erfordern möglicherweise ein Neuladen der Seite",
      },
    },

    // Workspace section
    workspace: {
      current: {
        title: "Aktueller Arbeitsbereich",
        description:
          "Legen Sie den Arbeitsordner zum Speichern von Pipelines, Ergebnissen und Vorhersagen fest",
        placeholder: "Kein Arbeitsbereich ausgewählt",
        selectButton: "Arbeitsbereich auswählen",
        browseButton: "Durchsuchen",
      },
      create: {
        title: "Neuen Arbeitsbereich erstellen",
        description: "Erstellen Sie einen neuen Arbeitsbereich mit Standardordnerstruktur",
        name: "Name",
        namePlaceholder: "mein_projekt",
        location: "Speicherort",
        locationPlaceholder: "/home/benutzer/nirs",
        locationDescription: "Übergeordnetes Verzeichnis für den neuen Arbeitsbereich",
        descriptionLabel: "Beschreibung",
        descriptionPlaceholder: "Optionale Beschreibung...",
        createStructure: "Standardordnerstruktur erstellen",
        createStructureHint:
          "(results/, pipelines/, models/, predictions/)",
        createButton: "Arbeitsbereich erstellen",
        creating: "Wird erstellt...",
        switching: "Wechsel zum neuen Arbeitsbereich...",
        success: "Arbeitsbereich erfolgreich erstellt",
        error: "Fehler beim Erstellen des Arbeitsbereichs",
        path: "Pfad",
        pathPreview: "Arbeitsbereich wird erstellt unter",
        pathPreviewEmpty: "Ort auswählen und Namen eingeben",
        validation: {
          nameRequired: "Arbeitsbereich-Name ist erforderlich",
          locationRequired: "Arbeitsbereich-Ort ist erforderlich",
        },
      },
      recent: {
        title: "Zuletzt verwendete Arbeitsbereiche",
        empty: "Keine zuletzt verwendeten Arbeitsbereiche",
        emptyHint: "Keine zuletzt verwendeten Arbeitsbereiche. Erstellen oder öffnen Sie einen Arbeitsbereich, um zu starten.",
        count: "{{count}} Arbeitsbereich",
        count_other: "{{count}} Arbeitsbereiche",
        open: "Öffnen",
        openHint: "Zu diesem Arbeitsbereich wechseln",
        remove: "Aus Liste entfernen",
        removeConfirm: "Diesen Arbeitsbereich aus der Liste entfernen?",
        removeDescription:
          "Dies entfernt \"{{name}}\" aus der Liste der zuletzt verwendeten Arbeitsbereiche. Die Dateien werden nicht gelöscht.",
        removeSuccess: "Arbeitsbereich aus Liste entfernt",
        removeError: "Arbeitsbereich konnte nicht entfernt werden",
        switchSuccess: "Arbeitsbereich gewechselt",
        current: "Aktuell",
        datasets: "{{count}} Datensatz",
        datasets_other: "{{count}} Datensätze",
        pipelines: "{{count}} Pipeline",
        pipelines_other: "{{count}} Pipelines",
      },
      stats: {
        title: "Arbeitsbereich-Statistiken",
        description: "Speichernutzung nach Kategorie",
        totalSize: "Gesamtgröße",
        linkedDatasets: "Verknüpfte Datensätze",
        externalData: "Externe Daten",
        refresh: "Aktualisieren",
        categories: {
          datasets: "Datensätze",
          pipelines: "Pipelines",
          results: "Ergebnisse",
          models: "Modelle",
          predictions: "Vorhersagen",
          cache: "Cache",
          other: "Sonstige",
        },
      },
      export: {
        title: "Arbeitsbereich exportieren",
        description: "Erstellen Sie ein Archiv Ihres Arbeitsbereichs",
        includeDatasets: "Datensätze einschließen",
        includeModels: "Modelle einschließen",
        includeResults: "Ergebnisse einschließen",
        outputPath: "Ausgabepfad",
        exportButton: "Exportieren",
        exporting: "Wird exportiert...",
        success: "Arbeitsbereich erfolgreich exportiert",
        error: "Fehler beim Exportieren des Arbeitsbereichs",
      },
      import: {
        title: "Arbeitsbereich importieren",
        description: "Importieren Sie einen Arbeitsbereich aus einem Archiv",
        archivePath: "Archivdatei",
        destination: "Zielort",
        workspaceName: "Arbeitsbereichsname",
        importButton: "Importieren",
        importing: "Wird importiert...",
        success: "Arbeitsbereich erfolgreich importiert",
        error: "Fehler beim Importieren des Arbeitsbereichs",
      },
    },

    // Data defaults section
    dataDefaults: {
      title: "Standard-Ladeparameter",
      description:
        "Standardeinstellungen beim Laden neuer Datensätze über den Assistenten",
      note: "Diese Standards werden beim Hinzufügen neuer Datensätze über den Assistenten angewendet. Jeder Datensatz kann diese Einstellungen während des Ladevorgangs überschreiben.",
      selectWorkspace:
        "Wählen Sie einen Arbeitsbereich, um die Standard-Ladeparameter zu konfigurieren",
      parsing: {
        title: "Parsing-Optionen",
        delimiter: "Trennzeichen",
        delimiters: {
          semicolon: "Semikolon (;)",
          comma: "Komma (,)",
          tab: "Tabulator",
          space: "Leerzeichen",
        },
        decimal: "Dezimaltrennzeichen",
        decimals: {
          dot: "Punkt (.)",
          comma: "Komma (,)",
        },
        hasHeader: "Hat Kopfzeile",
        headerUnit: "Kopfzeilen-Einheit",
        headerUnits: {
          nm: "Nanometer (nm)",
          "cm-1": "Wellenzahl (cm⁻¹)",
          text: "Textbeschriftungen",
          none: "Keine Einheiten",
          index: "Spaltenindex",
        },
      },
      signal: {
        title: "Signalkonfiguration",
        type: "Signaltyp",
        types: {
          auto: "Automatisch erkennen",
          absorbance: "Absorbanz",
          reflectance: "Reflexion",
          "reflectance%": "Reflexion (%)",
          transmittance: "Transmission",
          "transmittance%": "Transmission (%)",
        },
      },
      missing: {
        title: "Fehlende Werte",
        policy: "NA-Richtlinie",
        policies: {
          drop: "Zeilen entfernen",
          fill_mean: "Mit Mittelwert füllen",
          fill_median: "Mit Median füllen",
          fill_zero: "Mit Null füllen",
          error: "Fehler auslösen",
        },
      },
      autoDetect: "Format automatisch erkennen",
      save: "Standards speichern",
      reset: "Auf Standards zurücksetzen",
    },

    // Advanced section
    advanced: {
      developer: {
        title: "Entwicklermodus",
        description: "Aktivieren Sie zusätzliche Funktionen für Entwicklung und Tests",
        enable: "Entwicklermodus aktivieren",
        hint: "Zeigt synthetische Datengenerierung, Debug-Infos und erweiterte Optionen",
        needsWorkspace: "Wählen Sie einen Arbeitsbereich, um den Entwicklermodus zu aktivieren",
      },
      backend: {
        title: "Backend-Verbindung",
        description: "API-Endpunkt und Verbindungseinstellungen",
        url: "Backend-URL",
        urlHint: "API-Endpunkt (schreibgeschützt in Produktion)",
        status: {
          title: "Backend-Status",
          connected: "Verbunden",
          disconnected: "Getrennt",
          degraded: "Beeinträchtigt",
          checking: "Wird überprüft...",
          latency: "Latenz",
          lastCheck: "Letzte Prüfung",
          testConnection: "Verbindung testen",
          successRate: "Erfolgsrate",
          avgLatency: "Durchschnittliche Latenz",
        },
      },
      system: {
        title: "Systeminformationen",
        description: "Python-Umgebung und Systemdetails",
        python: "Python",
        version: "Version",
        platform: "Plattform",
        executable: "Ausführbare Datei",
        os: "Betriebssystem",
        osRelease: "Version",
        architecture: "Architektur",
        nirs4all: "nirs4all",
        capabilities: "Fähigkeiten",
        packages: "Installierte Pakete",
        copyToClipboard: "Systeminfos kopieren",
        copied: "In Zwischenablage kopiert",
      },
      errors: {
        title: "Fehlerprotokoll",
        description: "Aktuelle Fehler zur Fehlerbehebung",
        empty: "Keine Fehler aufgezeichnet",
        clear: "Protokolle löschen",
        clearConfirm: "Alle Fehlerprotokolle löschen?",
        clearSuccess: "Fehlerprotokolle gelöscht",
        refresh: "Aktualisieren",
        endpoint: "Endpunkt",
        message: "Nachricht",
        traceback: "Stacktrace",
        copyError: "Fehlerdetails kopieren",
      },
      troubleshooting: {
        title: "Fehlerbehebung",
        description: "Lokale Daten löschen und Einstellungen zurücksetzen",
        clearCache: "Lokalen Cache leeren",
        clearCacheHint: "Lokalen Speicher und Sitzungsdaten zurücksetzen",
        clearCacheConfirm: "Lokalen Cache leeren?",
        clearCacheDescription:
          "Dies löscht alle lokalen Speicher- und Sitzungsdaten. Die Seite wird nach dem Löschen neu geladen.",
        resetDefaults: "Auf Standards zurücksetzen",
        resetDefaultsHint: "Alle Einstellungen auf ihre Standardwerte zurücksetzen",
        resetDefaultsConfirm: "Alle Einstellungen zurücksetzen?",
        resetDefaultsDescription:
          "Dies setzt alle Anwendungseinstellungen auf ihre Standardwerte zurück und löscht den lokalen Speicher. Diese Aktion kann nicht rückgängig gemacht werden.",
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
    title: "Tastenkombinationen",
    description: "Kurzreferenz für Tastenkombinationen",
    categories: {
      global: "Global",
      pipelineEditor: "Pipeline-Editor",
      playground: "Spielwiese",
    },
    keys: {
      commandPalette: "Befehlspalette öffnen",
      toggleSidebar: "Seitenleiste umschalten",
      openSettings: "Einstellungen öffnen",
      savePipeline: "Pipeline speichern",
      undo: "Rückgängig",
      redo: "Wiederherstellen",
      deleteStep: "Ausgewählten Schritt entfernen",
      nextPanel: "Nächstes Panel",
      applyPipeline: "Pipeline anwenden",
      exportData: "Exportieren",
    },
  },

  // ============= Dashboard =============
  dashboard: {
    title: "Dashboard",
    welcome: "Willkommen zurück",
    quickStart: "Schnellstart",
    recentActivity: "Letzte Aktivität",
    stats: {
      datasets: "Datensätze",
      pipelines: "Pipelines",
      runs: "Ausführungen",
      models: "Modelle",
    },
    developer: {
      title: "Entwickler-Schnellstart",
      description: "Generieren Sie synthetische Datensätze für Tests und Entwicklung",
      generate: "Generieren",
      preset: "Vorlage",
      presets: {
        regressionSmall: "Regression (250 Proben)",
        regressionLarge: "Regression (2500 Proben)",
        classification: "Klassifikation (3 Klassen)",
        custom: "Benutzerdefinierte Konfiguration",
      },
    },
  },

  // ============= Datasets =============
  datasets: {
    title: "Datensätze",
    empty: "Keine Datensätze verknüpft",
    emptyHint: "Verknüpfen Sie einen Datensatz, um zu beginnen",
    addDataset: "Datensatz hinzufügen",
    generateSynthetic: "Synthetisch generieren",
    actions: {
      view: "Anzeigen",
      edit: "Bearbeiten",
      refresh: "Aktualisieren",
      export: "Exportieren",
      unlink: "Trennen",
      delete: "Löschen",
    },
    info: {
      samples: "Proben",
      features: "Merkmale",
      targets: "Ziele",
      path: "Pfad",
      status: "Status",
    },
    synthetic: {
      title: "Synthetischen Datensatz generieren",
      description: "Erstellen Sie synthetische NIRS-Daten für Tests und Entwicklung",
      taskType: "Aufgabentyp",
      taskTypes: {
        regression: "Regression",
        binary_classification: "Binäre Klassifikation",
        multiclass_classification: "Mehrklassen-Klassifikation",
      },
      samples: "Anzahl der Proben",
      complexity: "Komplexität",
      complexities: {
        simple: "Einfach",
        realistic: "Realistisch",
        complex: "Komplex",
      },
      classes: "Anzahl der Klassen",
      trainRatio: "Trainingsanteil",
      options: {
        title: "Optionen",
        includeMetadata: "Metadaten einschließen",
        includeRepetitions: "Wiederholungen einschließen",
        repetitionsPerSample: "Wiederholungen pro Probe",
        noiseLevel: "Rauschpegel",
        addBatchEffects: "Chargeneffekte hinzufügen",
        numBatches: "Anzahl der Chargen",
        autoLink: "Automatisch mit Arbeitsbereich verknüpfen",
      },
      generate: "Datensatz generieren",
      generating: "Wird generiert...",
      success: "Synthetischer Datensatz erfolgreich generiert",
      error: "Fehler beim Generieren des synthetischen Datensatzes",
    },
  },

  // ============= Pipelines =============
  pipelines: {
    title: "Pipelines",
    empty: "Keine Pipelines erstellt",
    emptyHint: "Erstellen Sie eine neue Pipeline, um zu beginnen",
    create: "Pipeline erstellen",
    editor: {
      title: "Pipeline-Editor",
      untitled: "Unbenannte Pipeline",
      save: "Pipeline speichern",
      run: "Pipeline ausführen",
      validate: "Validieren",
    },
    steps: {
      preprocessing: "Vorverarbeitung",
      splitting: "Aufteilung",
      model: "Modell",
      metrics: "Metriken",
    },
  },

  // ============= Runs =============
  runs: {
    title: "Ausführungen",
    empty: "Noch keine Ausführungen",
    emptyHint: "Starten Sie ein neues Experiment, um Ausführungen hier zu sehen",
    newRun: "Neue Ausführung",
    status: {
      queued: "Warteschlange",
      running: "Läuft",
      completed: "Abgeschlossen",
      failed: "Fehlgeschlagen",
      cancelled: "Abgebrochen",
      paused: "Pausiert",
    },
    actions: {
      view: "Details anzeigen",
      stop: "Stoppen",
      pause: "Pausieren",
      resume: "Fortsetzen",
      retry: "Wiederholen",
      delete: "Löschen",
    },
  },

  // ============= Errors & Validation =============
  errors: {
    generic: "Ein Fehler ist aufgetreten",
    networkError: "Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.",
    serverError: "Serverfehler. Bitte versuchen Sie es später erneut.",
    notFound: "Nicht gefunden",
    unauthorized: "Nicht autorisiert",
    forbidden: "Zugriff verweigert",
    validation: "Validierungsfehler",
    required: "Dieses Feld ist erforderlich",
    invalidFormat: "Ungültiges Format",
    tooShort: "Zu kurz",
    tooLong: "Zu lang",
    invalidPath: "Ungültiger Pfad",
    pathNotExists: "Pfad existiert nicht",
    alreadyExists: "Existiert bereits",
  },

  // ============= Confirmations =============
  confirm: {
    delete: {
      title: "Löschen bestätigen",
      description: "Sind Sie sicher, dass Sie dies löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.",
    },
    unsavedChanges: {
      title: "Ungespeicherte Änderungen",
      description: "Sie haben ungespeicherte Änderungen. Möchten Sie vor dem Verlassen speichern?",
      save: "Speichern",
      discard: "Verwerfen",
      stay: "Bleiben",
    },
  },

  // ============= Accessibility =============
  a11y: {
    skipToContent: "Zum Inhalt springen",
    closeDialog: "Dialog schließen",
    openMenu: "Menü öffnen",
    loading: "Wird geladen, bitte warten",
    expandSection: "Abschnitt erweitern",
    collapseSection: "Abschnitt reduzieren",
  },
};

export default de;
