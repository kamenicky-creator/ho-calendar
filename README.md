# HO kalendár

Tímový prehľad, kto je v kancelárii a kto na home office. Hore vidíš vybraný deň (predvolene dnešok), pod tým mesačnú tabuľku pracovných dní, do ktorej sa kliká.

- Stavy: Kancelária, Home office, Dovolenka / voľno, Choroba / lekár, Služobná cesta
- Poznámka ku každému dňu
- České štátne sviatky vrátane Veľkej noci sa vyznačia automaticky
- Úprava tímu priamo v kalendári (pridať, premenovať, zoradiť, skryť)
- Funguje na počítači aj v mobile, vo svetlom aj tmavom režime

Stránka beží na GitHub Pages. Dáta sú v Google tabuľke, ku ktorej je pripojený malý server v Google Apps Scripte.

## Obsah repozitára

| Súbor | Na čo slúži |
| --- | --- |
| `index.html`, `assets/` | Samotný kalendár |
| `config.js` | Adresa servera a názov tímu |
| `apps-script/Code.gs` | Server, vkladá sa do Google Apps Scriptu |
| `apps-script/appsscript.json` | Nastavenie projektu, treba len pri nasadzovaní cez `clasp` |

## Nasadenie

### 1. Google tabuľka a server

1. Vytvor novú prázdnu Google tabuľku, napríklad „HO kalendár – dáta“.
2. V tabuľke otvor **Rozšírenia › Apps Script**.
3. Obsah súboru `Kód.gs` nahraď obsahom `apps-script/Code.gs` a ulož.
4. Hore vyber funkciu `vytvorTimovyKluc` a klikni na **Spustiť**. Google si vypýta oprávnenia, potvrď ich. Kľúč nájdeš v **Protokole spustenia**, odlož si ho.
5. Ak máš súbor `Seed.gs` s históriou z pôvodnej tabuľky: pridaj ho cez **+ › Skript**, vlož obsah, spusti funkciu `nahratZaciatocneData` a potom `Seed.gs` zmaž. Import funguje len do prázdnej tabuľky.
6. Klikni na **Nasadiť › Nové nasadenie**, typ **Webová aplikácia**:
   - Spustiť ako: **Ja**
   - Kto má prístup: **Ktokoľvek**
7. Skopíruj URL webovej aplikácie (končí na `/exec`).

Prístup „Ktokoľvek“ je potrebný, aby sa naň stránka z GitHubu dostala. Bez tímového kľúča server nič neprečíta ani nezapíše.

### 2. Stránka na GitHube

1. V súbore `config.js` vlož URL z predchádzajúceho kroku do `apiUrl` a ulož zmenu.
2. V repozitári otvor **Settings › Pages**, v časti *Build and deployment* vyber **Deploy from a branch**, vetvu `main` a priečinok `/ (root)`.
3. O minútu bude kalendár na adrese `https://kamenicky-creator.github.io/ho-calendar/`.

GitHub Pages je na bezplatnom účte dostupné len pre verejné repozitáre. Kód neobsahuje žiadne osobné údaje, tie sú len v Google tabuľke.

### 3. Odkaz pre tím

Pošli kolegom odkaz s kľúčom:

```
https://kamenicky-creator.github.io/ho-calendar/?kluc=<TIMOVY_KLUC>
```

Prehliadač si kľúč pri prvom otvorení zapamätá a z adresy ho odstráni. Kto odkaz s kľúčom nemá, uvidí len výzvu na jeho zadanie.

## Dáta v Google tabuľke

- Hárok **Tím**: `id`, `meno`, `aktivny` (TRUE/FALSE). Poradie riadkov je poradie stĺpcov v kalendári.
- Hárok pre každý mesiac, napríklad **2026-11**: `datum`, `den`, `poznamka` a potom stĺpec pre každého kolegu podľa jeho `id`.
- V bunkách kolegov sú skratky `HO`, `Dov`, `Chor`, `Cesta`. Prázdna bunka znamená kanceláriu.

Hárok nového mesiaca vznikne sám pri prvom zápise. Tabuľku môžeš upravovať aj ručne, kalendár zmeny načíta do minúty.

## Bežná údržba

- **Zmena kľúča:** spusti znova `vytvorTimovyKluc` a pošli tímu nový odkaz. Starý kľúč prestane fungovať.
- **Úprava servera:** po zmene `Code.gs` otvor **Nasadiť › Spravovať nasadenia**, uprav existujúce nasadenie a zvoľ **Nová verzia**. URL zostane rovnaká.
- **Frekvencia obnovy:** `pollSeconds` v `config.js` (predvolene 60 sekúnd, minimum 20). Kalendár sa obnoví aj pri návrate na kartu.

## Skúšanie bez servera

Keď je `apiUrl` prázdne, kalendár ukladá zmeny len do tvojho prehliadača. Hodí sa to na úpravy vzhľadu: stačí otvoriť `index.html` alebo spustiť `python3 -m http.server` a ísť na `http://localhost:8000`.
