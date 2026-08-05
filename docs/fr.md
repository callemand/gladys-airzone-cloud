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
- **Humidité** — l'humidité relative mesurée dans la zone (lecture seule).

Si votre installation comprend un capteur de qualité d'air Airzone, il est
publié comme un device dédié exposant température, humidité, CO2, PM2.5, PM10,
COV (TVOC), pression et un indice global de qualité d'air (tout en lecture
seule, avec historique).

L'état des zones est rafraîchi toutes les minutes : un changement fait depuis
le thermostat Airzone ou l'application Airzone Cloud apparaît dans Gladys peu
après. Cette fréquence est volontairement modérée, l'API Airzone Cloud limitant
le nombre de requêtes par compte.

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

L'écran de Configuration affiche aussi l'état de la connexion à Airzone Cloud et
deux boutons :

- **Tester la connexion Airzone Cloud** — se connecte et compte les zones de
  votre compte ;
- **Rafraîchir les appareils Airzone** — recharge zones et capteurs et les
  republie dans Gladys.

Tous les appareils portent le badge **cloud** : cette intégration passe par le
service Airzone Cloud, il n'y a pas de connexion locale. Le badge devient
« dégradé » (point orange) pour une zone dont le dernier rafraîchissement a
échoué, avec la raison en infobulle.

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
- **Certaines zones ne remontent aucune température** — vérifiez d'abord que
  ces zones ont bien été **ajoutées** depuis l'écran Découverte : une zone
  seulement découverte n'est pas un appareil Gladys, et les états publiés pour
  elle sont ignorés. Les journaux de l'intégration listent les zones découvertes
  mais non ajoutées à chaque démarrage. Si la zone est bien ajoutée, ses
  journaux indiqueront pourquoi le rafraîchissement échoue (erreur Airzone) ou
  qu'Airzone ne fournit pas de température ambiante pour elle (zone sans
  thermostat).
- **Les commandes semblent ignorées** — Airzone peut mettre quelques secondes à
  transmettre une commande à l'unité ; l'état dans Gladys reflète l'état du
  cloud et se met à jour au rafraîchissement suivant (une minute). Vérifiez
  aussi que l'installation est en ligne dans l'application Airzone Cloud
  (webserver connecté).
- **Les états ne se mettent plus à jour** — la session Airzone a pu expirer ;
  l'intégration rafraîchit son jeton automatiquement. Si le problème persiste,
  consultez les journaux de l'intégration depuis sa page de configuration dans
  Gladys.
