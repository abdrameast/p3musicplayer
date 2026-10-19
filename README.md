# MIDNIGHT FREQUENCY

**A Persona 3 Inspired Music Experience · The night is yours.**

Application Vite + TypeScript + Three.js, sans framework UI. Le walkman, sa sangle,
le décor urbain/aquatique et les effets sont générés par le code. Les images de
référence ne sont pas distribuées. Projet non officiel : voir [LICENSE-NOTICE.md](LICENSE-NOTICE.md).

## Démarrage

Node.js 22.12+ (ou 24 LTS) et npm :

```sh
npm ci
npm run dev
```

Ouvrir **http://localhost:5173**. La lecture commence uniquement après une action
de l’utilisateur. Le lecteur officiel YouTube reste dans la **SIGNAL WINDOW** ;
la fermer met YouTube en pause.

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Le build statique est dans `dist/`, l’aperçu de production sur **http://localhost:4173**.
Pour Vercel : importer le dossier comme projet Vite, commande `npm run build`,
sortie `dist`. `vercel.json` contient déjà cette configuration. Avec la CLI Vercel
installée et authentifiée, `vercel` crée un aperçu et `vercel --prod` publie le site.
Aucun déploiement distant n’est effectué automatiquement par ce projet.

## Utilisation

- Faire glisser le walkman pour le tourner ; cliquer pour lire/mettre en pause.
- **Espace** : lecture/pause ; **←/→** : piste précédente/suivante ; **↑/↓** : volume.
- **M** : muet ; **T** : catalogue ; **S** : synchronisation ; **F** : plein écran ; **Échap** : fermer.
- Le catalogue permet la recherche, les filtres par collection et la sélection directe.
- Les modes **MOONLIGHT**, **DARK HOUR**, **BLUE MEMORY** changent l’atmosphère.
- Les préférences de volume, piste, boucle, ambiance, qualité et mouvement sont sauvegardées localement.
- Les champs de saisie et les contrôles conservent leurs raccourcis natifs.

## Architecture conservée

| Sous-système | Emplacement | Responsabilité |
| --- | --- | --- |
| Walkman | `src/scene/Walkman.ts`, `WalkmanScreen.ts`, `Lanyard.ts` | Géométrie, contours, pose, écran LCD, sangle |
| Scene | `src/scene/`, `src/visuals/` | Caméra, shaders, profondeur, éclairage, qualité adaptative, effets |
| Engine | `src/audio/`, `src/player/`, `src/sources/` | Providers, lecture, résolution des sources, synchronisation |
| UI | `src/ui/`, `src/styles/` | Composition responsive, panneaux, commandes, accessibilité, repli SVG |
| Integration | `src/core/App.ts`, `src/core/types.ts` | Contrats typés, événements, préférences et boucle de rendu |

`src/config/config.ts` centralise palette, profils de qualité, modes, BPM et
transitions. Les 67 titres canoniques sont dans `src/config/tracks.ts` ; leur ordre
n’est jamais déduit des positions de la playlist YouTube.

## Sources musicales

Les 67 associations explicites de `src/config/source-map.ts` ont été conservées.
Le **19 octobre 2026**, les 67 identifiants ont renvoyé HTTP 200 via l’API publique
oEmbed de YouTube et leurs titres observés correspondaient aux titres de la table.
Le rapport complet est [verification/sources.json](verification/sources.json).

Relancer ce contrôle sans télécharger de média :

```sh
npm run verify:sources
```

Ce contrôle porte sur les métadonnées. Une restriction géographique, un retrait,
une interdiction d’intégration ou une exigence de connexion peuvent toujours
empêcher la lecture. Ces erreurs sont affichées ; une source ne remplace jamais
silencieusement un autre titre. La lecture effective des 67 vidéos ne découle pas
du contrôle oEmbed.

Pour corriger une association sans modifier TypeScript, éditer
`public/source-overrides.json`. Chaque entrée remplace celle du même identifiant
canonique. Exemple de déclaration explicite :

```json
{
  "version": 1,
  "entries": [{
    "trackId": 46,
    "videoId": "hWhgrA2dhrk",
    "verification": {
      "method": "manual-override",
      "observedTitle": "Full Moon Full Life",
      "checkedAt": "2026-10-19",
      "confidence": 1
    }
  }]
}
```

En développement, **http://localhost:5173/validator.html** affiche le catalogue,
les identifiants et les métadonnées vérifiées. Il permet d’examiner une vidéo,
de saisir une correspondance contrôlée manuellement et d’exporter les entrées
confirmées au format JSON. Cet outil est exclu du build de production.

Une source insuffisamment vérifiée reste indisponible. Pour un fichier audio dont
vous possédez les droits, utiliser `audioUrl` (chemin `/audio/...` ou URL HTTP(S))
et `verification.method: "licensed-declaration"`. Le fichier doit être fourni
séparément ; aucun enregistrement musical n’est inclus. Une source distante doit
autoriser CORS pour permettre l’analyse directe.

## Synchronisation et limites

**SIMULATED** utilise le temps de lecture et une grille BPM ; ce n’est pas une
analyse du flux YouTube. Le mode actif est toujours nommé dans l’interface.

**LIVE TAB** demande un partage volontaire de l’audio d’onglet, selon les capacités
du navigateur. **MICROPHONE** nécessite également une action et une permission.
Les flux sont analysés localement, sans enregistrement ni envoi. Un refus,
l’absence d’audio ou l’arrêt du partage ramène au mode simulé. Le microphone ne
se réactive pas automatiquement au chargement.

**DIRECT** analyse un fichier audio autorisé fourni au provider Licensed Audio.
L’audio de l’iframe YouTube n’est pas directement accessible à Web Audio.
Les permissions réelles restent à tester manuellement sur les appareils cibles.

Si WebGL 2 échoue, le walkman SVG de repli conserve le catalogue et la lecture.
Le DPR, les particules et les effets s’adaptent au budget de l’appareil ; le
rendu s’arrête lorsque l’onglet est masqué. Les préférences de mouvement réduit
sont respectées.

## Vérification visuelle et manuelle

La passe de reprise a validé **57 tests**, la compilation TypeScript/Vite et la
lecture réelle de deux titres. Le détail des essais, les captures et les limites
sont dans [verification/README.md](verification/README.md).

En développement, ouvrir `/verification/visual-check.html` pour inspecter les
sept tailles prévues par le brief, de 360 × 640 à 2560 × 1080. Le bouton **2D
fallback** ouvre `/?renderer=2d`, un diagnostic de développement uniquement.
La page de vérification n’est pas incluse dans le build de production.

Contrôles manuels : lecture/pause, seek, volume, changement rapide de piste,
fermeture de SIGNAL WINDOW, recherche japonaise, navigation clavier, panneaux
sur petit écran, reprise des préférences et modes visuels. Pour YouTube, tester
également la première lecture sans connexion, les éventuelles annonces et les
restrictions régionales. Pour la capture, tester un refus, un partage sans audio
et l’arrêt du partage via le navigateur.
