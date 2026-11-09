# Myhr Tre og Design – AI Social Media Manager

Privat webapplikasjon for å planlegge, skrive, redigere, godkjenne og publisere Facebook-innlegg for Myhr Tre og Design. Claude (`claude-opus-5-5`) skriver forslag. **Eieren godkjenner alt, og ingenting publiseres uten godkjenning.**

| | |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Backend | Server Actions og API-ruter i Next.js, validering med Zod |
| Database | Supabase (PostgreSQL, Auth, Storage) med Row Level Security |
| AI | Anthropic Claude API, `claude-opus-5-5`, strukturert JSON-svar |
| Bilder | Utskiftbar bildegenerator (OpenAI Images API er med) + `sharp` for komposisjon og tekstgrafikk |
| Facebook | Meta Graph API, Facebook Login, Page Access Token |
| Drift | Vercel (inkl. Vercel Cron) + Supabase |

Brukerveiledning for eieren: [`docs/BRUKERVEILEDNING.md`](docs/BRUKERVEILEDNING.md)
Sikkerhetsgjennomgang: [`docs/SIKKERHETSGJENNOMGANG.md`](docs/SIKKERHETSGJENNOMGANG.md)
Testresultater: [`docs/TESTRESULTATER.md`](docs/TESTRESULTATER.md)

---

## Innhold

1. [Hva systemet gjør](#1-hva-systemet-gjør)
2. [Slik er godkjenning og publisering sikret](#2-slik-er-godkjenning-og-publisering-sikret)
3. [Installasjon lokalt](#3-installasjon-lokalt)
4. [Supabase](#4-supabase)
5. [Anthropic API (Claude)](#5-anthropic-api-claude)
6. [Bildegenerering (valgfritt)](#6-bildegenerering-valgfritt)
7. [Meta Developer App](#7-meta-developer-app)
8. [Koble til Facebook-siden](#8-koble-til-facebook-siden)
9. [Produksjonssetting på Vercel](#9-produksjonssetting-på-vercel)
10. [Testing](#10-testing)
11. [Prosjektstruktur](#11-prosjektstruktur)
12. [Hva som gjenstår før full drift](#12-hva-som-gjenstår-før-full-drift)

---

## 1. Hva systemet gjør

- **Oversikt:** dato og hilsen, Facebook-status, antall utkast, ventende, godkjente og publiserte innlegg, neste publisering, ukens innholdsplan og kommende merkedager.
- **AI-innholdsprodusent:** Claude skriver som standard tre innlegg per uke. Hvert innlegg har innledning, brødtekst, handlingsoppfordring, lenke, emneknagger, bildeforslag, anbefalt tidspunkt, begrunnelse, 0–2 alternative tekster og en intern egenvurdering. Claude får produktbiblioteket som eneste sannhetskilde, og en samlet tidslinje over tidligere innlegg: de siste 40 fra appen og de siste 60 som allerede ligger på Facebook-siden, også innlegg publisert direkte på Facebook. Claude bes velge tema, produkt og vinkel som er naturlig å poste nå, og unngå det som nylig er brukt. Innleggene fra siden hentes ved tilkobling, hver natt og med knappen «Hent eksisterende innlegg» (kun lesing, med `pages_read_engagement`).
- **Etterkontroll:** hvert forslag kontrolleres før det lagres, uavhengig av hva modellen svarte. Kontrollen ser etter priser som ikke stemmer med biblioteket, rabatter og tilbud, falsk knapphet, kundeuttalelser, lenker utenfor nettbutikken, produkter som ikke finnes og tekst som ligner tidligere innlegg. Funn vises som merknader eieren må vurdere.
- **Produktbibliotek:** produkter legges inn manuelt eller hentes fra nettbutikken (Shopify `products.json`, WooCommerce Store API eller JSON-LD på produktsider). Nye importerte produkter blir lagt inn som *inaktive* og merket «må bekreftes». Endringer i nettbutikken blir *forslag* som eieren må godta. Produktbilder kan lastes opp eller **hentes direkte fra nettbutikken**. De lastes ned over https, interne adresser blokkeres (også ved omdirigering), og bildene valideres og kodes om med metadata fjernet. Bilder som allerede er hentet, hoppes over.
- **Mediebank:** last opp egne bilder fra verkstedet, gravering, produksjon og produkter i hyllene, gjerne mange om gangen fra mobilen. Bildene skaleres ned i nettleseren (maks 2560 px) og sendes ett og ett. Claude beskriver hvert bilde én gang med kategori, stikkord, produkt og om personer er synlige. Det koster ca. 1,5 cent per bilde med Opus. Når innlegg lages, får Claude bare tekstbeskrivelsene, ikke bildene, og velger passende bilder som ikke er brukt nylig. Bilder med personer markeres, og Claude ber om bekreftelse på samtykke.
- **Bildeverksted:** opplasting (metadata som GPS fjernes), miljøbilder, tekstgrafikk, AI-bilder, Facebook-formater (1:1, 4:5, 1.91:1) og regenerering med nye instruksjoner. **Miljøbilder lages ved komposisjon:** AI lager bare bakgrunnen, og det ekte produktfotoet legges oppå uten endringer (kun proporsjonal skalering). Dermed endres aldri produktets utseende, form, ramme eller design. AI-innhold merkes tydelig.
- **Godkjenning:** forhåndsvisning som på Facebook og knappene *Godkjenn, Rediger, Generer nytt bilde, Generer ny tekst, Avvis* og *Slett utkast*.
- **Publisering:** tekst-, lenke- og bildeinnlegg via Pages API, enten med en gang eller planlagt. Publiseringen er beskyttet mot dobbeltpublisering, og et uklart svar fra Facebook avklares mot Facebook før et nytt forsøk.
- **Kalender:** måned-, uke- og dagsvisning, sju statuser, dra og slipp (eller «Flytt» på mobil) og forslag ved norske merkedager (valentinsdag, morsdag, påske, konfirmasjon, 17. mai, bryllupssesong, sommer, farsdag, advent, julegaver og jul).
- **Sporing av trafikk:** lenker til nettbutikken får UTM-parametere (`utm_source=facebook`, `utm_medium=social`, `utm_campaign` = innleggstype, `utm_content` = kode per innlegg). De legges på før godkjenning, så lenken som publiseres er den eieren har godkjent. Besøk og salg leses i Shopify, og analysesiden viser koden for hvert innlegg. Kan slås av og justeres under Innstillinger.
- **Analyse:** reaksjoner, kommentarer og delinger, pluss valgfrie innsiktsmetrikker hvis Meta gir tilgang. Viser utvikling over tid og resultater per innleggstype, og Claude kan analysere tallene og foreslå forbedringer. Systemet viser bare tall som faktisk er hentet.
- **Innstillinger:** bedriftsnavn, nettadresse, skrivestil, antall innlegg per uke, dager, klokkeslett, temaer, emneknagger, prioriterte produkter, sesonger, AI-modell, bildetjeneste, testmodus og Facebook-tilkobling.
- **Testmodus** (standard): alle kontroller kjøres, men ingenting sendes til Facebook.

## 2. Slik er godkjenning og publisering sikret

Reglene håndheves i **tre uavhengige lag**:

1. **Applikasjonen** (`src/lib/posts/publisher.ts`) sjekker status, godkjenning, innholdshash, bilde, Facebook-tilkobling og om innlegget allerede er publisert.
2. **Databasen** (`supabase/migrations/…_init.sql`):
   - AI-genererte innlegg settes alltid til `PENDING_APPROVAL`, selv om noe annet sendes inn.
   - Et innlegg kan ikke opprettes som godkjent eller publisert.
   - Godkjenning krever en registrert eier, og `approved_by` må være den innloggede brukeren. Databasen setter selv tidspunktet og en SHA-256-hash av innholdet.
   - Endres tekst, overskrift, emneknagger, lenke eller bilde, oppheves godkjenningen automatisk, og endringen loggføres i `post_history`.
   - `PUBLISHING` krever gyldig godkjenning med uendret hash. `PUBLISHED` kan bare settes fra `PUBLISHING` og bare med en bekreftet Facebook-ID.
   - `claim_post_for_publishing()` låser raden og lager en unik idempotensnøkkel. Det kan bare finnes ett aktivt eller fullført publiseringsforsøk per innlegg.
   - Publiserte innlegg kan ikke endres eller slettes.
3. **Row Level Security:** bare brukere i `public.users` (eiere) får tilgang. Facebook-tokens kan ikke leses av noen innlogget bruker, bare av service-rollen på serveren.

Den planlagte publiseringen (GitHub Actions hvert 10. minutt, med daglig Vercel Cron som reserve) plukker bare opp innlegg som eieren selv har **godkjent og planlagt** (`SCHEDULED`), og alle kontrollene kjøres på nytt. Det finnes ingen kodevei der AI-innhold publiseres uten godkjenning.

## 3. Installasjon lokalt

Krav: Node.js 20.9 eller nyere (testet med Node 22) og et Supabase-prosjekt (sky eller lokalt med `supabase start`).

```bash
git clone <repo> && cd Master-Prompt
npm install
cp .env.example .env.local   # fyll inn verdiene – se avsnittene under
npm run dev                  # http://localhost:3000
```

Lag hemmelighetene slik:

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

## 4. Supabase

1. Opprett et prosjekt på <https://supabase.com> (velg region **EU**, f.eks. Frankfurt eller Stockholm).
2. **Kjør migrasjonene** med én av disse metodene:
   - Supabase CLI: `supabase link --project-ref <ref>` og deretter `supabase db push`
   - eller kopier innholdet i hver fil i `supabase/migrations/` inn i *SQL Editor* og kjør dem i rekkefølge (`…000001_init.sql`, `…000002_storage.sql`, `…000003_product_image_sources.sql`, `…000004_facebook_page_posts.sql`, `…000005_media_library.sql`, `…000006_utm_tracking.sql`).
3. **Auth → Providers → Email:** slå på e-post/passord og **slå av «Allow new users to sign up»**. Systemet er privat.
4. **Auth → URL Configuration:** sett *Site URL* til `APP_URL`.
5. Hent verdiene under *Project Settings → API*: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` og `SUPABASE_SERVICE_ROLE_KEY` (hemmelig).
6. **Opprett eierkontoen** (passordet leses skjult fra terminalen):
   ```bash
   node --env-file=.env.local scripts/create-owner.mjs eier@myhrtreogdesign.com
   ```
   E-postadressen må også stå i `OWNER_EMAILS`.
7. Storage-bøtta `media` opprettes av migrasjonen og er **privat**. Bilder vises bare via kortlevde signerte URL-er.

**Tabeller:** `users`, `business_settings`, `facebook_connections`, `products`, `product_change_proposals`, `product_images`, `media_assets`, `posts`, `post_history`, `publish_attempts`, `analytics`, `ai_generations`, `audit_log` og `rate_limits`.

## 5. Anthropic API (Claude)

1. Opprett en API-nøkkel på <https://console.anthropic.com> → *API Keys*.
2. Sett `ANTHROPIC_API_KEY` som server-side miljøvariabel. Den brukes bare i `src/lib/ai/claude.ts` og sendes aldri til nettleseren.
3. Modellen er `claude-opus-5-5` (`ANTHROPIC_MODEL`) og kan også endres under *Innstillinger*.
4. Kallet bruker strukturert JSON-utdata (Zod-skjema), adaptiv tenkning, effort `high`, prompt caching på systeminstruksen og Anthropics standard reservemodell ved avslag (`fallbacks: "default"`).
5. Claude får **aldri** tokens, passord eller andre hemmeligheter. Den får bare bedriftsinnstillinger, produktbiblioteket og tidligere innleggstekster.

Kostnad: én ukesgenerering (tre innlegg) bruker typisk noen få tusen input-tokens og opptil rundt 10 000 output-tokens. Kostnaden avhenger av produktbibliotekets størrelse. Bruken logges i tabellen `ai_generations`.

## 6. Bildegenerering (valgfritt)

- Sett `OPENAI_API_KEY` (og eventuelt `OPENAI_IMAGE_MODEL`, standard `gpt-image-1`), og velg «OpenAI Images API» under *Innstillinger*.
- Uten nøkkel fungerer fortsatt opplasting, miljøbilder på nøytral studiobakgrunn, tekstgrafikk og formatering.
- Bildegeneratoren kan byttes ut. Implementer `ImageProvider` i `src/lib/images/providers/` og registrer den i `providers/index.ts`.

## 7. Meta Developer App

> Meta endrer jevnlig navn på menyer, apptyper og regler for App Review. Kontroller stegene mot <https://developers.facebook.com/docs/> når du setter opp.

1. Gå til <https://developers.facebook.com/apps> og velg **Opprett app**. Velg brukstilfellet for å administrere en Facebook-side (eller apptypen *Business*), og koble appen til Meta Business-kontoen som eier siden.
2. Legg til produktet **Facebook Login** (eller **Facebook Login for Business**).
   - *Valid OAuth Redirect URIs:* `https://<din-app>/api/facebook/callback` (og eventuelt `http://localhost:3000/api/facebook/callback` for lokal testing).
   - Med *Facebook Login for Business:* lag en **konfigurasjon** med bare de tre tillatelsene under, og sett `META_LOGIN_CONFIG_ID`.
3. Be **bare** om disse tillatelsene:
   - `pages_show_list`
   - `pages_manage_posts`
   - `pages_read_engagement`

   Systemet ber ikke om tilgang til meldinger, Messenger, personlig profil, annonsekontoer, betaling eller Business Manager-administrasjon.
4. Hent **App ID** og **App Secret** under *App settings → Basic* og sett `META_APP_ID` og `META_APP_SECRET`.
5. Sett `META_GRAPH_API_VERSION` til nyeste stabile versjon. Den står i [endringsloggen](https://developers.facebook.com/docs/graph-api/changelog). Versjonen er bevisst ikke hardkodet.
6. **App Review og tilgangsnivå:**
   - *Standard Access* gjelder for brukere som har en **rolle i appen** (administrator, utvikler eller tester). Siden eieren både administrerer appen og siden, kan det være nok for privat bruk, også i utviklingsmodus. Bekreft dette i Metas gjeldende dokumentasjon for akkurat din app.
   - *Advanced Access* krever **App Review** (ofte også **Business Verification**). Det trengs hvis personer uten rolle i appen skal koble til, eller hvis Meta krever det for publisering eller innsikt. App Review krever personvernerklæring, skjermopptak av flyten og en begrunnelse for hver tillatelse.
   - Enkelte innsiktsmetrikker kan kreve ekstra tilgang eller være avviklet. Systemet viser da «ikke tilgjengelig» og anslår ingenting.
7. Gå ikke ut fra at tilgang er gitt før Meta faktisk har gitt den. Etter innlogging kontrollerer appen `/me/permissions` og avviser tilkoblingen hvis en tillatelse mangler.

## 8. Koble til Facebook-siden

1. Logg inn i appen og gå til **Innstillinger → Facebook-tilkobling**.
2. Trykk **Koble til Facebook**. Du sendes til Facebook og logger inn der. Passordet ditt går aldri gjennom dette systemet.
3. Gi de tre tillatelsene og velg Myhr Tre og Design-siden.
4. Velg siden i appen og trykk **Bekreft tilkobling**.
5. Trykk **Test tilkoblingen**. Den kontrollerer tokenet og tillatelsene mot Facebook.

Teknisk fungerer det slik: OAuth-`state` lagres i en kryptert httpOnly-informasjonskapsel og sammenlignes i konstant tid. Kortlevd brukertoken byttes til langtlevd brukertoken, og ut fra det hentes et sidetoken. Sidetokenet krypteres med AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) og lagres i `facebook_connections`, der bare service-rollen har tilgang. Alle Graph-kall sendes med `appsecret_proof`. Utløper eller trekkes tokenet tilbake, markeres tilkoblingen som utløpt, og appen ber deg koble til på nytt. **Koble fra** sletter tokenet permanent. Du kan i tillegg fjerne appen under Facebook → Innstillinger → Bedriftsintegrasjoner.

## 9. Produksjonssetting på Vercel

1. Importer repoet i Vercel. Rammeverket oppdages automatisk.
2. Legg inn **alle** variablene fra `.env.example` under *Settings → Environment Variables* (Production). `APP_URL` skal være den endelige HTTPS-adressen.
3. Behold `PUBLISH_MODE=simulated` til alt er testet. Da kan ingenting publiseres.
4. Deploy. `vercel.json` setter opp to daglige cron-jobber (tillatt på Hobby):
   - `/api/cron/publish` daglig kl. 06:07 UTC er reserve for planlagt publisering.
   - `/api/cron/insights` daglig kl. 04:17 UTC henter statistikk.

   **Hyppig planlagt publisering** (hvert 10. minutt) gjøres av GitHub Actions (`.github/workflows/scheduled-publish.yml`), siden Vercel Hobby bare tillater daglig cron. Legg inn to *repository secrets* under GitHub → Settings → Secrets and variables → Actions:
   - `APP_URL`: samme adresse som i Vercel, f.eks. `https://din-app.vercel.app`
   - `CRON_SECRET`: nøyaktig samme verdi som i Vercel

   Uten disse hoppes jobben over. Med Vercel Pro kan du i stedet sette `"schedule": "*/10 * * * *"` i `vercel.json`. Uansett avviser endepunktene alt som ikke har riktig `Bearer CRON_SECRET`, og de publiserer bare innlegg du har godkjent og planlagt. GitHub kan forsinke planlagte kjøringer med noen minutter, og «Publiser nå» fungerer alltid umiddelbart.
5. Opprett eierkontoen (avsnitt 4.6) og logg inn.
6. Koble til Facebook (avsnitt 8) og gjør en **simulert** publisering.
7. Når alt fungerer: sett `PUBLISH_MODE=live`, deploy på nytt og slå av *Testmodus* under Innstillinger. **Begge** må være satt for ekte publisering.
8. Gå gjennom sjekklisten i [`docs/SIKKERHETSGJENNOMGANG.md`](docs/SIKKERHETSGJENNOMGANG.md).

## 10. Testing

```bash
npm run lint && npm run typecheck
npm test                 # enhetstester + databasetester
npm run build
npm run test:e2e         # Playwright (mobil + desktop) mot produksjonsbygget
```

- **Databasetestene** kjører migrasjonene i en ekte PostgreSQL med en minimal Supabase-stub (`supabase/tests/supabase-stub.sql`). Sett `DATABASE_URL_TEST`, for eksempel `postgres://tester:tester@localhost:5432/myhr_test`. Uten variabelen hoppes de over.
- **Publiseringstestene** kjører mot den ekte databasen og et simulert Graph API som registrerer alle kall. Dermed kan testene bevise at Facebook *ikke* kalles når det ikke skal.
- **E2E:** sett `E2E_OWNER_EMAIL` og `E2E_OWNER_PASSWORD` (mot et testprosjekt med `PUBLISH_MODE=simulated`) for å kjøre hele eierflyten, fra innlogging via redigering og godkjenning til simulert publisering.
- CI (`.github/workflows/ci.yml`) kjører alt dette med Postgres som tjeneste.

Siste resultater står i [`docs/TESTRESULTATER.md`](docs/TESTRESULTATER.md).

## 11. Prosjektstruktur

```
src/
  proxy.ts                    Sesjonsfornyelse + innloggingskrav (Next 16 «proxy»)
  app/
    login/                    Innlogging (rate-limited, kun OWNER_EMAILS)
    (app)/                    Beskyttede sider: oversikt, innlegg, generer, kalender,
                              produkter, bilder, analyse, innstillinger, facebook
    api/facebook/{login,callback}   OAuth-flyt
    api/cron/{publish,insights}     Vercel Cron (Bearer CRON_SECRET)
  lib/
    ai/                       Claude-klient, systeminstruks, skjemaer, generator, etterkontroll
    posts/                    Statusmaskin, innholdshash, publiseringstjeneste, Supabase-lager
    facebook/                 Graph API-klient, tilkobling, OAuth-informasjonskapsel
    images/                   sharp-komposisjon, formater, utskiftbare leverandører, lagring
    products/                 Import fra nettbutikk + endringsdeteksjon
    calendar/seasons.ts       Norske merkedager (påske beregnes osv.)
    crypto.ts, logger.ts, security.ts, auth.ts, env.ts
supabase/migrations/          Skjema, triggere, RLS, Storage
tests/{unit,db,e2e}/          Vitest + Playwright
scripts/create-owner.mjs      Oppretter eierkonto
```

## 12. Hva som gjenstår før full drift

Dette kan ikke gjøres fra koden og må gjøres av eieren:

- [ ] Opprette Supabase-prosjekt, kjøre migrasjoner, slå av registrering og opprette eierkonto.
- [ ] Legge inn `ANTHROPIC_API_KEY`.
- [ ] Opprette Meta-app, legge inn redirect-URI og App ID/Secret og velge Graph API-versjon. Avklare om App Review og Advanced Access trengs (avsnitt 7).
- [ ] Legge inn produkter. Nettbutikken kunne ikke leses fra utviklingsmiljøet, så **ingen produktdata er lagt inn på forhånd**. Bruk «Hent fra nettbutikken» etter produksjonssetting, kontroller og aktiver produktene, og last opp ekte produktbilder.
- [ ] (Valgfritt) Legge inn `OPENAI_API_KEY` for AI-bakgrunner.
- [ ] Teste med simulert publisering, og deretter sette `PUBLISH_MODE=live` og slå av testmodus.
