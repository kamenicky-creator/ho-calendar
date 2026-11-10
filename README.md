# HO kalendár

Tímový prehľad, kto je v kancelárii a kto na home office. Hore vidíš vybraný deň (predvolene dnešok), pod tým mesačnú tabuľku pracovných dní, do ktorej sa kliká.

- Stavy: Kancelária, Home office, Dovolenka / voľno, Choroba / lekár, Služobná cesta
- Poznámka ku každému dňu
- České štátne sviatky vrátane Veľkej noci sa vyznačia automaticky
- Úprava tímu priamo v kalendári (pridať, premenovať, zoradiť, skryť)
- Každý si po prihlásení vyberie, kto je, a mení len svoje dni. Správca môže meniť dni všetkých aj zoznam tímu.
- Denník zmien: kto, kedy a čo zmenil, v kalendári aj v hárku „Zmeny“
- Funguje na počítači aj v mobile, vo svetlom aj tmavom režime

Kalendár beží na Verceli za spoločným tímovým heslom. Dáta sú v Google tabuľke, ku ktorej je pripojený malý server v Google Apps Scripte. Prehliadač komunikuje len s Vercelom: adresa Apps Scriptu a tímový kľúč zostávajú na serveri.

## Obsah repozitára

| Súbor | Na čo slúži |
| --- | --- |
| `index.html`, `assets/` | Samotný kalendár |
| `login.html` | Prihlasovacia stránka |
| `middleware.js` | Brána: bez prihlásenia Vercel nevydá žiadnu stránku ani dáta |
| `api/` | Prihlásenie, výber mena, odhlásenie a sprostredkovanie dát (Vercel Functions) |
| `config.js` | Názov tímu a frekvencia obnovy |
| `apps-script/Code.gs` | Server, vkladá sa do Google Apps Scriptu |
| `apps-script/appsscript.json` | Nastavenie projektu, treba len pri nasadzovaní cez `clasp` |

## Nastavenie

### 1. Google tabuľka a Apps Script

1. Priprav Google tabuľku na dáta. Môže byť prázdna, hárky „Tím“ a hárky jednotlivých mesiacov vzniknú samé.
2. V tabuľke otvor **Rozšírenia › Apps Script**, obsah `Kód.gs` nahraď obsahom `apps-script/Code.gs` a ulož.
3. Tímový kľúč: vyplň `DEFAULT_TEAM_KEY` na začiatku súboru, alebo spusti funkciu `vytvorTimovyKluc` a kľúč nájdeš v protokole spustenia.
4. Klikni na **Nasadiť › Nové nasadenie**, typ **Webová aplikácia**:
   - Spustiť ako: **Ja**
   - Kto má prístup: **Ktokoľvek**
5. Skopíruj URL webovej aplikácie (končí na `/exec`).

Prístup „Ktokoľvek“ je potrebný, aby sa na server dostal Vercel. Bez tímového kľúča server nič neprečíta ani nezapíše.

### 2. Vercel

1. Importuj repozitár (Application Preset: **Other**, bez build príkazu).
2. V **Settings › Environment Variables** pridaj:

   | Premenná | Hodnota |
   | --- | --- |
   | `APP_PASSWORD` | tímové heslo na prihlásenie |
   | `ADMIN_PASSWORD` | heslo správcu: môže meniť dni všetkých a zoznam tímu |
   | `GAS_URL` | URL webovej aplikácie z Apps Scriptu (končí na `/exec`) |
   | `GAS_KEY` | tímový kľúč z Apps Scriptu |
   | `SESSION_SECRET` | voliteľné: ľubovoľný náhodný text na podpis prihlásenia |

3. V **Deployments** pri poslednom nasadení klikni na **… › Redeploy**, aby sa premenné načítali.

### 3. Tím

Pošli kolegom adresu kalendára a tímové heslo. Po prihlásení si každý vyberie svoje meno a odvtedy mení len svoje dni. Prehliadač si prihlásenie zapamätá na 30 dní. Kto chce zmeniť meno, odhlási sa a prihlási znova.

Správca sa prihlási na tej istej stránke heslom z `ADMIN_PASSWORD`. Vyberie si svoje meno, alebo „Správca, nie som v zozname“, a môže meniť dni všetkých kolegov aj zoznam tímu.

Výber mena funguje na dôvere: kto pozná tímové heslo, môže si vybrať aj cudzie meno. Bráni to omylom a vďaka denníku zmien je vidieť, kto čo urobil.

## Dáta v Google tabuľke

- Hárok **Tím**: `id`, `meno`, `aktivny` (TRUE/FALSE). Poradie riadkov je poradie stĺpcov v kalendári.
- Hárok pre každý mesiac, napríklad **2026-11**: `datum`, `den`, `poznamka` a potom stĺpec pre každého kolegu podľa jeho `id`.
- V bunkách kolegov sú skratky `HO`, `Dov`, `Chor`, `Cesta`. Prázdna bunka znamená kanceláriu.
- Hárok **Zmeny**: denník všetkých zmien z kalendára (`cas`, `kto`, `co`, `datum`, `koho`, `predtym`, `potom`). Vznikne sám pri prvej zmene. Ručné úpravy priamo v tabuľke sa doň nezapisujú.

Hárok nového mesiaca vznikne sám pri prvom zápise. Tabuľku môžeš upravovať aj ručne, kalendár zmeny načíta do minúty.

## Bežná údržba

- **Zmena hesla:** zmeň `APP_PASSWORD` alebo `ADMIN_PASSWORD` a daj Redeploy. Všetci sa musia prihlásiť znova.
- **Odhlásenie všetkých bez zmeny hesla:** zmeň `SESSION_SECRET` a daj Redeploy.
- **Zmena tímového kľúča:** nastav nový kľúč v Apps Scripte, ten istý vlož do `GAS_KEY` a daj Redeploy.
- **Úprava servera:** po zmene `Code.gs` otvor **Nasadiť › Spravovať nasadenia**, uprav existujúce nasadenie a zvoľ **Nová verzia**. URL zostane rovnaká.
- **Úprava stránky:** stačí zmena vo vetve `main`, Vercel ju nasadí sám.
- **Frekvencia obnovy:** `pollSeconds` v `config.js` (predvolene 60 sekúnd, minimum 20). Kalendár sa obnoví aj pri návrate na kartu.

## Skúšanie bez servera

Na úpravy vzhľadu nastav v `config.js` dočasne `apiUrl: ''` a otvor `index.html`. Kalendár potom ukladá zmeny len do tvojho prehliadača.
