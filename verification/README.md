# Vérification — 19 octobre 2026

La reprise a été vérifiée sous Windows avec Node.js 24.11.1, dans le navigateur
intégré à Codex. Le build de production a été servi avec `npm run preview`.

## Contrôles automatisés

- `npm test` : **57 tests réussis, 7 fichiers**.
- `npm run build` : vérification TypeScript et compilation Vite réussies.
- `npm run verify:sources` : **67 réponses oEmbed HTTP 200**, titres observés
  inchangés par rapport aux associations explicites. Voir [sources.json](sources.json).

Les tests couvrent notamment le catalogue canonique de 67 titres (comparé au
brief fourni), les préférences, le cadrage responsive, la qualité adaptative,
l'écran LCD, la sangle, l'interface et ses panneaux, la recherche japonaise,
les transitions de lecture, les courses entre sélections et les modes de
synchronisation. Les providers et permissions sont simulés dans les tests unitaires.

## Contrôles effectués dans le navigateur

| Action | Résultat observé |
| --- | --- |
| Lecture de la piste 46, Full Moon Full Life | État PLAYING et temps avançant dans le build de production |
| Pause puis déplacement à 0:45 | Temps maintenu à 0:45, lecture restant en pause |
| Volume et piste suivante | Volume passé de 70 à 25 ; piste 47 et iframe correspondante affichées |
| Recherche `やすらぎ` | Deux résultats sur 67 ; sélection de la piste 48 Reload |
| Lecture de la piste 48 | État PLAYING et progression observée jusqu'à 0:10 |
| Fermeture de SIGNAL WINDOW | Lecture mise en pause à 0:10 |
| Modes visuels | Moonlight, Dark Hour et Blue Memory sélectionnables |
| Rechargement | Piste, volume et mode visuel conservés |
| Glissement du walkman | Rotation volumétrique sans déclenchement de lecture |
| Repli 2D | Lecture de la piste 46 progressant jusqu'à 0:31, puis pause |
| Validateur de sources | 67 entrées, filtre fonctionnel, export refusé sans confirmation d'une entrée |
| Console de l'aperçu final | Aucune erreur ni aucun avertissement collecté lors du contrôle final |

## Formats visuels

Les sept dimensions du brief ont été inspectées dans des iframes de dimensions
CSS explicites. Les captures sont mises à l'échelle pour tenir dans le navigateur
de contrôle ; ce ne sont pas des essais sur sept appareils physiques.

| Dimensions CSS | Capture |
| --- | --- |
| 360 × 640 | [Mobile compact](screenshots/360x640.png) |
| 390 × 844 | [Mobile](screenshots/390x844.png) |
| 768 × 1024 | [Tablette](screenshots/768x1024.png) |
| 1280 × 720 | [Bureau compact](screenshots/1280x720.png) |
| 1440 × 900 | [Bureau](screenshots/1440x900.png) |
| 1920 × 1080 | [Full HD](screenshots/1920x1080.png) |
| 2560 × 1080 | [Ultrawide](screenshots/2560x1080.png) |

Le débordement horizontal de 5 px sur tablette et la coupure des commandes en
1280 × 720 ont été corrigés puis revérifiés. Sur le petit mobile, les commandes
secondaires restent accessibles par défilement.

Autres captures : [repli 2D](screenshots/fallback-2d.png) et
[aperçu final du build](screenshots/midnight-frequency.png).

## Limites de cette vérification

- Le contrôle oEmbed valide les métadonnées ; il ne garantit ni la bonne version
  musicale à l'écoute ni l'intégration ou la disponibilité régionale des 67 vidéos.
  Deux titres, 46 et 48, ont fait l'objet d'une lecture réelle pendant cette passe.
- Les permissions réelles de capture d'onglet et de microphone restent à essayer
  sur les navigateurs et appareils cibles. Les refus, interruptions et demandes
  concurrentes sont couverts par les tests unitaires.
- L'analyse directe nécessite un fichier audio autorisé fourni par l'utilisateur ;
  aucun enregistrement n'est distribué et ce parcours n'a pas été testé avec un
  fichier musical réel pendant cette passe.
- Les annonces YouTube, les restrictions de compte ou de région et les performances
  sur appareils physiques ne sont pas garanties par cet essai local.

L'iframe officielle reste visible pendant la lecture. Son intégration utilise
l'[API IFrame Player de YouTube](https://developers.google.com/youtube/iframe_api_reference).
