# Captures de la page de présentation

## État actuel

**9 captures sont déjà en place** — elles ont été prises automatiquement sur
l'application en fonctionnement.

| Fichier | Écran |
|---|---|
| `01-dashboard.png` | Tableau de bord |
| `02-tracker-sn.png` | Tracker SN |
| `04-shift-planning.png` | Shift Planning |
| `06-quiz.png` | Quiz |
| `12-reports.png` | Weekly Report |
| `16-ma-performance.png` | Ma performance (écran d'accès) |
| `17-observations.png` | Observations |
| `18-fo-dashboard.png` | FO Dashboard |
| `19-my-requests.png` | My Requests |

**10 écrans sont décrits au lieu d'être montrés** : fiche ticket, Absences,
Agenda Training, Performance FO, Trust Matrix, Suivi O2O (bilan et profil),
Ops Review, Configuration, Sessions actives.

Ce sont les écrans protégés par mot de passe. Ils donnent accès à des
évaluations nominatives et à des données RH : les photographier reviendrait à
diffuser des notes et des comptes rendus d'entretien. La page l'explique en
préambule, et chaque bloc indique où trouver l'écran dans l'application.

## Si vous voulez remplacer une description par une vraie capture

Rien à modifier dans le code — il suffit de déposer le fichier au bon nom dans
ce dossier, puis de remplacer le bloc correspondant dans `public/demo.html`
(cherchez `class="locked"`).

| Fichier attendu | Écran | Où |
|---|---|---|
| `03-ticket-detail.png` | Fiche ticket | Tracker SN › ouvrir un ticket |
| `05-absences.png` | Absences | Menu › Absences (mot de passe dédié) |
| `07-training.png` | Agenda Training | Configuration › Agenda Training |
| `08-performance.png` | Performance FO | Configuration › Performance FO |
| `09-trust-matrix.png` | Trust Matrix | Performance FO › Trust Matrix |
| `10-o2o-bilan.png` | Suivi O2O — Bilan | Configuration › Suivi One-to-One |
| `11-o2o-profil.png` | Suivi O2O — Profil | Suivi One-to-One › Profil agent |
| `13-ops-review.png` | Ops Review | Menu › Ops Review |
| `14-admin-hub.png` | Configuration | Menu Admin › Vue d'ensemble |
| `15-sessions.png` | Sessions actives | Configuration › Sessions actives |

**Format** : PNG, largeur 1600 px, même thème que les captures existantes (sombre).

## Deux écrans demandent une préparation

**Trust Matrix** — verrouillée par défaut. Saisissez le mot de passe
Configuration pour qu'elle s'affiche avant de capturer.

**Profil agent** — la toile d'araignée n'apparaît qu'à partir de trois critères
renseignés. Sans notation, vous photographieriez le message « complétez la
fiche ». Notez au moins un agent dans Performance FO au préalable.

## Avant de diffuser

Les captures actuelles montrent des écrans **vides** (0 ticket, 0 absence,
0 notation) : elles illustrent la structure de l'outil, pas son usage réel.
Si la présentation doit convaincre, refaites-les quand l'application sera
alimentée.

Elles contiennent aussi **votre nom** en haut à droite et les **noms de
l'équipe** dans certains menus. À vérifier avant toute diffusion externe.
