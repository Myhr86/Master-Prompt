# Testresultater

Kjørt **9. november 2026** i utviklingsmiljøet (Linux, Node 22, PostgreSQL 16).

| Steg | Kommando | Resultat |
|---|---|---|
| Lint | `npm run lint` | ✅ ingen feil eller advarsler |
| Typesjekk | `npm run typecheck` | ✅ ingen feil |
| Enhets- og databasetester | `npm test` | ✅ **101 av 101 bestått** (9 filer) |
| Produksjonsbygg | `npm run build` | ✅ |
| E2E (Playwright, iPhone 13 + desktop Chrome) | `npm run test:e2e` | ✅ **28 bestått**, 2 hoppet over (se under) |

Databasetestene og publiseringstestene ble kjørt tre ganger på rad uten ustabilitet.

## Hva som er testet, og hvordan

**Databasetester** kjører de ekte migrasjonene i PostgreSQL 16 med en minimal Supabase-stub (rollene `anon`, `authenticated` og `service_role`, `auth.uid()` og `storage.objects`). Hver spørring kjøres som riktig rolle med JWT-claims, slik at både Row Level Security og triggere testes på samme måte som i Supabase.

**Publiseringstester** kjører publiseringstjenesten mot den ekte databasen og et simulert Graph API som registrerer alle kall. Slik kan testene bevise at Facebook *ikke* blir kalt når det ikke skal.

**Claude-testen** sender et ekte SDK-kall mot et simulert API-endepunkt og kontrollerer modell, adaptiv tenkning, strukturert utdata, reservemodell, caching og feilhåndtering. Det er ikke brukt ekte API-nøkler.

## De 14 påkrevde testene

| # | Krav | Status | Dekket av |
|---|---|---|---|
| 1 | Innlogging fungerer | ✅ delvis / ⏭️ full flyt | Innloggingsskjema, feilmeldinger og rate limiting (E2E). Hele flyten mot Supabase Auth ligger i `owner-flow.spec.ts` og kjøres med `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD` (krever Supabase-prosjekt, ikke tilgjengelig her). |
| 2 | Uautorisert bruker får ikke tilgang | ✅ | RLS-tester for anonym og innlogget ikke-eier, E2E-omdirigering for alle beskyttede sider, 401 fra API og cron |
| 3 | Claude kan generere innlegg | ✅ | `ai.test.ts` (generator) + `claude.test.ts` (SDK-kall mot simulert API) |
| 4 | Produktinformasjon blir korrekt | ✅ | Etterkontroll: feil pris, rabatt, knapphet, kundeuttalelser og oppdiktede produkter, lenker og bilder fanges opp. Prompten markerer manglende pris. |
| 5 | Bilder kan lastes opp | ✅ | Validering på innhold, fjerning av EXIF/GPS, størrelsesgrense, lagringspolicy (kun eier) |
| 6 | Innlegg kan redigeres | ✅ | Database (redigering + historikk) og validering av skjemaet |
| 7 | Endring etter godkjenning opphever godkjenningen | ✅ | Tekst, bilde, lenke og emneknagger, både for godkjente og planlagte innlegg |
| 8 | Utkast kan godkjennes | ✅ | Godkjenning setter tidspunkt og hash, og krever innlogget eier |
| 9 | Ikke-godkjente innlegg kan aldri publiseres | ✅ | Database (også med service-rollen) og tjenesten. Facebook kalles 0 ganger. |
| 10 | Godkjente innlegg kan publiseres | ✅ | Lenke-, bilde- og tekstinnlegg. Facebook-ID og URL lagres, og status blir `PUBLISHED`. |
| 11 | Dobbeltpublisering hindres | ✅ | Gjentatte og samtidige forsøk (5 parallelle) samt uklart svar fra Facebook. Facebook kalles nøyaktig én gang. |
| 12 | Facebook-feil håndteres korrekt | ✅ | Utløpt token, manglende tillatelse, midlertidig feil, 5xx og tidsavbrudd |
| 13 | Facebook-token kan kobles fra | ✅ | Frakoblet tilkobling stopper publisering. Databasen tillater frakobling med slettet token og ny tilkobling. |
| 14 | Systemet fungerer på mobil | ✅ | E2E på iPhone 13: ingen horisontal rulling og berøringsvennlige knapper. Innloggede skjermer (innlegg, kalender, oversikt) er sjekket visuelt med eksempeldata. |

**Testmodus** (simulert publisering) er dekket av egne tester. Den kontrollerer godkjenningen, sender ingenting til Facebook og endrer ikke status.

## Hoppet over

- `owner-flow.spec.ts` (×2 prosjekter): krever en ekte Supabase-instans og en eierkonto. Ingen av delene fantes i utviklingsmiljøet, og nedlasting av Supabase-binærfiler var ikke tillatt. Kjør testen slik:
  ```bash
  E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... npm run test:e2e
  ```

## Fullstendig liste (Vitest)

```
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > ber kun om de tre minimale tillatelsene
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > støtter Facebook Login for Business (config_id i stedet for scope)
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > bruker versjonen fra konfigurasjonen (ingen hardkodet versjon)
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > sender token i POST-body med appsecret_proof, ikke i URL-en
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > klassifiserer feil fra Facebook (test 12)
 ✓ |unit| tests/unit/integrations.test.ts > Facebook Login og Graph API > innsikt: utilgjengelige metrikker hoppes over i stedet for å gjettes
 ✓ |unit| tests/unit/integrations.test.ts > Bildegenerator (utskiftbar leverandør) > er ikke konfigurert uten nøkkel
 ✓ |unit| tests/unit/integrations.test.ts > Bildegenerator (utskiftbar leverandør) > sender forespørsel og dekoder bildet
 ✓ |unit| tests/unit/integrations.test.ts > Bildegenerator (utskiftbar leverandør) > gir lesbar feil
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > leser Shopify products.json
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > leser WooCommerce Store API (minste valutaenhet)
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > leser JSON-LD Product og lar manglende pris være tom
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > oppdager endringer som forslag
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > tillater kun nettbutikkens eget domene over https (SSRF-vern)
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > følger ikke omdirigeringer til andre domener (SSRF via redirect)
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > følger omdirigering innen nettbutikkens domene og importerer fra Shopify
 ✓ |unit| tests/unit/integrations.test.ts > Produktimport (offentlig informasjon, ingen gjetting) > fjerner HTML og skript
 ✓ |unit| tests/unit/images.test.ts > Bildeopplasting (test 5) > godtar ekte bilder og fjerner metadata (EXIF/GPS)
 ✓ |unit| tests/unit/images.test.ts > Bildeopplasting (test 5) > avviser filer som ikke er bilder, uansett filnavn/MIME
 ✓ |unit| tests/unit/images.test.ts > Bildeopplasting (test 5) > avviser for store filer
 ✓ |unit| tests/unit/ai.test.ts > AI-innholdsprodusent (test 3–4) > genererer innlegg via Claude med produktbiblioteket som sannhetskilde
 ✓ |unit| tests/unit/ai.test.ts > AI-innholdsprodusent (test 3–4) > systeminstruksen er stabil (ingen dato) slik at caching fungerer, og inneholder sannhetsreglene
 ✓ |unit| tests/unit/ai.test.ts > AI-innholdsprodusent (test 3–4) > uten pris i biblioteket instrueres Claude til ikke å nevne pris
 ✓ |unit| tests/unit/ai.test.ts > AI-innholdsprodusent (test 3–4) > tomt bibliotek: Claude får beskjed om ikke å nevne konkrete produkter
 ✓ |unit| tests/unit/ai.test.ts > AI-innholdsprodusent (test 3–4) > tidligere innlegg sendes med for å unngå gjentakelser
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > fanger opp feil pris
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > godtar korrekt pris i ulike formater
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > fanger opp rabatter, falsk knapphet og kundeuttalelser
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > fjerner oppdiktede produkter, lenker og bilde-ID-er
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > erstatter tidspunkt i fortiden med planlagt tidspunkt
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > varsler om tekst som ligner tidligere innlegg
 ✓ |unit| tests/unit/ai.test.ts > Etterkontroll av AI-forslag (produktkorrekthet) > leser ut priser
 ✓ |unit| tests/unit/claude.test.ts > Claude-integrasjon (test 3) > sender strukturert forespørsel til claude-opus-5-5 med adaptiv tenkning og caching
 ✓ |unit| tests/unit/claude.test.ts > Claude-integrasjon (test 3) > håndterer avslag (refusal) med forståelig melding
 ✓ |unit| tests/unit/claude.test.ts > Claude-integrasjon (test 3) > avviser svar som ikke følger skjemaet
 ✓ |unit| tests/unit/images.test.ts > Bildeverksted > lager Facebook-formater
 ✓ |unit| tests/unit/dates.test.ts > Datoer i Oslo-tid > håndterer sommer- og vintertid
 ✓ |unit| tests/unit/dates.test.ts > Datoer i Oslo-tid > finner neste foretrukne publiseringstidspunkter
 ✓ |unit| tests/unit/dates.test.ts > Datoer i Oslo-tid > uke starter på mandag
 ✓ |unit| tests/unit/dates.test.ts > Norske merkedager > beregner påske, morsdag, farsdag og advent riktig
 ✓ |unit| tests/unit/dates.test.ts > Norske merkedager > foreslår relevante anledninger fram i tid
 ✓ |unit| tests/unit/posts.test.ts > Innholdshash > endres når tekst, emneknagger, lenke eller bilde endres
 ✓ |unit| tests/unit/posts.test.ts > validateForPublishing (test 7, 9) > godtar godkjent innlegg med uendret innhold
 ✓ |unit| tests/unit/posts.test.ts > validateForPublishing (test 7, 9) > avviser ikke-godkjente statuser
 ✓ |unit| tests/unit/posts.test.ts > validateForPublishing (test 7, 9) > avviser innhold endret etter godkjenning
 ✓ |unit| tests/unit/posts.test.ts > validateForPublishing (test 7, 9) > avviser allerede publiserte innlegg
 ✓ |unit| tests/unit/posts.test.ts > Facebook-tekst > setter sammen overskrift, tekst og emneknagger uten duplikat
 ✓ |unit| tests/unit/posts.test.ts > Facebook-tekst > bildeinnlegg får lenken i teksten
 ✓ |unit| tests/unit/posts.test.ts > Validering av redigering (test 6) > tolker emneknagger
 ✓ |unit| tests/unit/posts.test.ts > Validering av redigering (test 6) > krever https-lenker og ikke-tom tekst
 ✓ |unit| tests/unit/security.test.ts > Kryptering av Facebook-token (AES-256-GCM) > krypterer og dekrypterer
 ✓ |unit| tests/unit/security.test.ts > Kryptering av Facebook-token (AES-256-GCM) > gir ulikt chiffer hver gang (tilfeldig IV)
 ✓ |unit| tests/unit/security.test.ts > Kryptering av Facebook-token (AES-256-GCM) > avviser feil nøkkel og manipulerte data
 ✓ |unit| tests/unit/security.test.ts > Kryptering av Facebook-token (AES-256-GCM) > krever 32 byte nøkkel
 ✓ |unit| tests/unit/security.test.ts > Kryptering av Facebook-token (AES-256-GCM) > sammenligner i konstant tid
 ✓ |unit| tests/unit/security.test.ts > Logging maskerer hemmeligheter > maskerer nøkler etter navn og kjente tokenformater
 ✓ |unit| tests/unit/images.test.ts > Bildeverksted > miljøbilde bevarer det ekte produktet nøyaktig (ingen endring av form/farge)
 ✓ |unit| tests/unit/images.test.ts > Bildeverksted > lager tekstgrafikk med korrekt escaping
 ✓ |unit| tests/unit/images.test.ts > Bildeverksted > bakgrunnsprompt ber eksplisitt om at produktet IKKE skal genereres
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > SQL- og TypeScript-hash er identiske
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Tilgangskontroll (test 1–2) > anonym bruker får ikke lese eller skrive noe
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Tilgangskontroll (test 1–2) > innlogget bruker som ikke er eier ser ingen data og kan ikke skrive
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Tilgangskontroll (test 1–2) > eier har tilgang til egne data, men aldri direkte til Facebook-tokens
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Tilgangskontroll (test 1–2) > revisjonsloggen kan ikke endres eller slettes
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Tilgangskontroll (test 1–2) > lagring: kun eier kan laste opp til media-bøtta
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > AI-innhold tvinges til PENDING_APPROVAL selv om noe annet oppgis
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > nye innlegg kan ikke opprettes som godkjent eller publisert
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > utkast kan godkjennes av eier – databasen setter tidspunkt og hash
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > godkjenning krever at approved_by er den innloggede eieren
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > innlegg kan redigeres, og endringen loggføres
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > endring av tekst etter godkjenning opphever godkjenningen
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > endring av bilde, lenke eller emneknagger på et PLANLAGT innlegg opphever godkjenningen
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > flytting av publiseringstidspunkt beholder godkjenningen
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > godkjenningsfelter kan ikke manipuleres direkte
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > innhold kan ikke endres i samme operasjon som godkjenning
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Godkjenning (test 6–8) > kun godkjente innlegg kan planlegges
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > ikke-godkjente innlegg kan aldri settes til PUBLISHING eller PUBLISHED
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > selv service-rollen kan ikke publisere et ikke-godkjent innlegg
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > godkjent innlegg kan låses og publiseres med bekreftet Facebook-ID
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > dobbeltpublisering hindres: nytt forsøk mens ett pågår eller etter suksess avvises
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > samtidige publiseringsforsøk: kun ett lykkes
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > publiserte innlegg er låst og kan ikke slettes
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > simulert publisering kontrollerer godkjenning, men endrer ikke status
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > Publiseringsvern (test 9–11) > facebook_post_id kan ikke settes utenom publisering
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > rate limiting slår inn etter grensen
 ↓ |db| tests/db/database.test.ts > Database: RLS, godkjenning og publiseringsvern > kun én aktiv Facebook-tilkobling om gangen, og token kreves når tilkoblet
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > ikke-godkjent innlegg publiseres aldri – Facebook kalles ikke
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > innlegg endret etter godkjenning kan ikke publiseres
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > godkjent lenkeinnlegg publiseres, ID og URL lagres, status blir PUBLISHED
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > godkjent bildeinnlegg publiseres via /photos med lenken i teksten
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > tekstinnlegg uten lenke og bilde støttes
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > dobbeltpublisering hindres – andre kall sender ingenting til Facebook
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > samtidige klikk på «Publiser» gir kun ett innlegg hos Facebook
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > uklart resultat (tidsavbrudd) avklares mot Facebook før nytt forsøk – ingen duplikat
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > uklart resultat der Facebook IKKE opprettet innlegget: markeres feilet og kan prøves igjen
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > utløpt token håndteres: status FAILED, tilkobling merkes utløpt, tydelig melding
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > manglende tillatelse fra Meta gir forståelig feil
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > frakoblet Facebook stopper publisering før noe sendes (test 13)
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > utilgjengelig bilde stopper publisering
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > testmodus: simulert publisering sender ingenting og endrer ikke status
 ↓ |db| tests/db/publisher.test.ts > Publisering mot ekte database og simulert Facebook (test 9–13) > testmodus avviser fortsatt ikke-godkjente innlegg
```

## E2E (Playwright)

```
  -   1 [mobil] › tests/e2e/owner-flow.spec.ts:13:7 › Eierflyt (test 1, 6, 8, 10, 14) › logg inn, skriv innlegg, godkjenn og simuler publisering
  ✓   3 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › / sender til innlogging
  ✓   2 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › / sender til innlogging
  ✓   4 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innlegg sender til innlogging
  ✓   5 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innlegg sender til innlogging
  ✓   6 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /generer sender til innlogging
  ✓   7 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /generer sender til innlogging
  ✓   8 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /kalender sender til innlogging
  ✓   9 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /kalender sender til innlogging
  ✓  10 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /produkter sender til innlogging
  ✓  11 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /produkter sender til innlogging
  ✓  12 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /bilder sender til innlogging
  ✓  13 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /bilder sender til innlogging
  ✓  14 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /analyse sender til innlogging
  ✓  15 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /analyse sender til innlogging
  ✓  16 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innstillinger sender til innlogging
  ✓  17 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innstillinger sender til innlogging
  ✓  18 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /facebook/velg-side sender til innlogging
  ✓  19 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /facebook/velg-side sender til innlogging
  ✓  20 [mobil] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innlegg/00000000-0000-4000-8000-000000000000 sender til innlogging
  ✓  22 [mobil] › tests/e2e/access.spec.ts:12:7 › Tilgang uten innlogging (test 2) › API-ruter avviser uautoriserte kall
  ✓  23 [mobil] › tests/e2e/access.spec.ts:20:7 › Tilgang uten innlogging (test 2) › sikkerhetshoder er satt
  ✓  21 [desktop] › tests/e2e/access.spec.ts:5:9 › Tilgang uten innlogging (test 2) › /innlegg/00000000-0000-4000-8000-000000000000 sender til innlogging
  ✓  25 [desktop] › tests/e2e/access.spec.ts:12:7 › Tilgang uten innlogging (test 2) › API-ruter avviser uautoriserte kall
  ✓  26 [desktop] › tests/e2e/access.spec.ts:20:7 › Tilgang uten innlogging (test 2) › sikkerhetshoder er satt
  ✓  24 [mobil] › tests/e2e/access.spec.ts:33:7 › Innloggingssiden › er på norsk og fungerer på mobil uten horisontal rulling (test 14)
  ✓  27 [desktop] › tests/e2e/access.spec.ts:33:7 › Innloggingssiden › er på norsk og fungerer på mobil uten horisontal rulling (test 14)
  ✓  28 [mobil] › tests/e2e/access.spec.ts:47:7 › Innloggingssiden › ukjent e-post gir generell feilmelding uten å avsløre kontoer
  -  30 [desktop] › tests/e2e/owner-flow.spec.ts:13:7 › Eierflyt (test 1, 6, 8, 10, 14) › logg inn, skriv innlegg, godkjenn og simuler publisering
  ✓  29 [desktop] › tests/e2e/access.spec.ts:47:7 › Innloggingssiden › ukjent e-post gir generell feilmelding uten å avsløre kontoer
```
