# Airzone Cloud

## Présentation

Cette intégration connecte Gladys Assistant à **Airzone Cloud** pour piloter
les zones de votre climatisation gainable Airzone depuis Gladys.

Une fois configurée, toutes les zones de votre compte Airzone Cloud
apparaissent dans l'écran **Découverte** de Gladys. Chaque zone expose les
fonctionnalités suivantes :

- **Marche/Arrêt** — allumer ou éteindre la zone ;
- **Mode** — climatisation, chauffage, ventilation, déshumidification ou auto (sur la zone maître uniquement) ;
- **Température** — la température de consigne, dans les bornes min/max de la zone ;
- **Température ambiante** — la température mesurée dans la zone (lecture seule) ;
- **Humidité** — l'humidité relative mesurée dans la zone (lecture seule) ;
- **PM2.5 / PM10** — la qualité de l'air (particules), uniquement sur les zones équipées d'un capteur (lecture seule).

L'état des zones est rafraîchi toutes les 10 secondes : un changement fait
depuis le thermostat Airzone ou l'application Airzone Cloud apparaît dans Gladys
peu après.

## Prérequis

- Un **compte Airzone Cloud** ([airzonecloud.com](https://airzonecloud.com))
  avec votre installation déjà enregistrée dedans : votre système Airzone doit
  être équipé d'un webserver Airzone (Airzone Cloud) appairé avec l'application
  Airzone Cloud.
- L'installation doit être joignable depuis Airzone Cloud : cette intégration
  dialogue avec le cloud Airzone, votre instance Gladys doit donc avoir accès à
  Internet.

## Configuration

1. Installez l'intégration depuis le store Gladys.
2. Ouvrez son écran de **Configuration** et renseignez :
   - **E-mail Airzone Cloud** — l'adresse e-mail de votre compte Airzone Cloud ;
   - **Mot de passe Airzone Cloud** — le mot de passe de ce compte (stocké comme
     secret, jamais réaffiché).
3. Enregistrez. L'intégration se connecte à Airzone Cloud et charge vos zones.
4. Ouvrez l'écran **Découverte** : vos zones y sont listées. Ajoutez celles que
   vous voulez, puis placez-les dans vos pièces et tableaux de bord comme
   n'importe quel appareil Gladys.

Pour utiliser un autre compte Airzone Cloud plus tard, mettez simplement à jour
l'e-mail et le mot de passe dans l'écran de Configuration : l'intégration se
reconnecte et rafraîchit la liste des zones automatiquement.

## Dépannage

- **« Airzone Cloud is not configured » pendant la découverte** — l'e-mail ou le
  mot de passe manque : renseignez les deux champs dans l'écran de Configuration
  et enregistrez.
- **La connexion échoue** — vérifiez vos identifiants en vous connectant sur
  [airzonecloud.com](https://airzonecloud.com).
- **Une zone n'apparaît pas dans la Découverte** — vérifiez qu'elle est visible
  dans l'application Airzone Cloud avec le même compte, puis relancez la
  découverte.
- **Les commandes semblent ignorées** — Airzone peut mettre quelques secondes à
  transmettre une commande à l'unité ; l'état dans Gladys reflète l'état du
  cloud et se met à jour au rafraîchissement suivant (10 secondes). Vérifiez
  aussi que l'installation est en ligne dans l'application Airzone Cloud
  (webserver connecté).
- **Les états ne se mettent plus à jour** — la session Airzone a pu expirer ;
  l'intégration rafraîchit son jeton automatiquement. Si le problème persiste,
  consultez les journaux de l'intégration depuis sa page de configuration dans
  Gladys.
