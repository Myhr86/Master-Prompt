# Sikkerhetsgjennomgang før produksjonssetting

Gjennomgått 9. november 2026. Dokumentet beskriver trusselbildet, hvilke tiltak som er bygget inn, funn fra gjennomgangen og en sjekkliste eieren må fullføre før systemet tas i bruk.

## 1. Hva som skal beskyttes

| Verdi | Risiko | Viktigste tiltak |
|---|---|---|
| Bedriftens Facebook-side | Uønsket eller dobbel publisering, kapring | Godkjenning håndhevet i 3 lag, idempotens, minimale tillatelser, kryptert token |
| Facebook Page Access Token | Lekkasje | AES-256-GCM, kun service-rollen kan lese tabellen, aldri til nettleser eller AI, `appsecret_proof`, maskering i logger |
| API-nøkler (Anthropic, OpenAI, Supabase service) | Lekkasje og misbruk | Kun server-side miljøvariabler, ingen `NEXT_PUBLIC_`-prefiks, ikke i Git |
| Bedriftsdata og kundebilder | Uautorisert tilgang | Supabase Auth + eier-sjekk + RLS, privat lagringsbøtte, EXIF/GPS fjernes |
| Omdømme | Feilaktig reklame | Produktbiblioteket som sannhetskilde, etterkontroll av priser, rabatter og uttalelser, eier godkjenner alt |

## 2. Tiltak

**Autentisering og autorisasjon**
- Supabase Auth (e-post og passord). Offentlig registrering skal være avslått.
- Tre kontroller ved hver forespørsel: `proxy.ts` krever sesjon, `requireOwner()` krever e-post i `OWNER_EMAILS` *og* rad i `public.users`, og RLS-policyene krever `is_owner()`.
- Alle Server Actions kaller `requireOwner()` før de gjør noe.
- Innlogging har rate limit (10 forsøk per 15 min per IP og per e-post, lagret i databasen og gyldig på tvers av serverinstanser) og gir generelle feilmeldinger som ikke avslører hvilke kontoer som finnes.

**Database**
- RLS er slått på for alle tabeller. Anonyme brukere har ingen rettigheter. Supabases standardrettigheter for `authenticated` er fjernet og erstattet med minste nødvendige rettigheter.
- `facebook_connections` og `rate_limits` har ingen policyer for `authenticated`. Status leses gjennom en `security definer`-funksjon som ikke returnerer token.
- Revisjonsloggen kan bare leses og utvides, ikke endres eller slettes.
- Forretningsreglene for godkjenning og publisering håndheves av triggere (se README, avsnitt 2) og er dekket av tester.

**Facebook**
- Bare `pages_show_list`, `pages_manage_posts` og `pages_read_engagement`.
- OAuth `state` er tilfeldig (192 bit), lagres i en kryptert `__Host-`-informasjonskapsel (httpOnly, Secure, SameSite=Lax, 10 min) og sammenlignes i konstant tid.
- Innloggingen starter med POST med Origin-kontroll (CSRF).
- Tillatelsene kontrolleres etter innlogging, og siden må gi rettigheten `CREATE_CONTENT`.
- Tokenet sendes i POST-body, ikke i URL-en, og alltid med `appsecret_proof`.
- Utløp og tilbakekalling oppdages ved publisering, ved «Test tilkoblingen» og ved statistikkinnhenting.

**AI**
- Claude får bare bedriftsdata, produktbiblioteket og tidligere innleggstekster. Claude har ingen verktøy og ingen tilgang til tokens, og kan ikke godkjenne eller publisere.
- Eierens fritekst til Claude er begrenset i lengde og plassert i et avgrenset felt. Svaret valideres mot et skjema og kontrolleres deterministisk før lagring.

**Web**
- Sikkerhetshoder: CSP (`frame-ancestors 'none'`, `object-src 'none'`, begrenset `connect-src`/`img-src`), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` og `X-Robots-Tag: noindex`. `X-Powered-By` er fjernet.
- Server Actions har innebygd Origin-kontroll i Next.js, og API-ruter som endrer tilstand sjekker Origin.
- Cron-endepunktene krever `Bearer CRON_SECRET`, sammenlignet i konstant tid.
- All input valideres med Zod: UUID-er, https-lenker, emneknagger, klokkeslett og lengdegrenser.
- Opplastede filer valideres på innholdet med sharp. Bare JPEG, PNG og WebP godtas (ikke SVG), filene kodes om, metadata fjernes og grensen er 15 MB. Lagringsbøtta tillater bare de samme MIME-typene.
- Tekst i tekstgrafikk XML-escapes før SVG-rendering.
- Produktimport (SSRF-vern): bare https mot nettbutikkens domene, også ved hver omdirigering (manuell redirect-håndtering), med tidsavbrudd og størrelsesgrense.
- Feil vises som trygge norske meldinger. Interne detaljer logges bare på serveren.

**Logging**
- Strukturert JSON-logging der tokens, nøkler, JWT og `access_token=` i URL-er maskeres.
- `audit_log` registrerer godkjenning, publisering, endringer, tilkoblinger og AI-kall.

## 3. Funn under gjennomgangen (rettet)

| Funn | Alvorlighet | Rettet |
|---|---|---|
| Produktimporten fulgte HTTP-omdirigeringer automatisk. En side på nettbutikkens domene kunne dermed sende serveren videre til interne adresser (SSRF). | Middels | Manuell redirect-håndtering med domenekontroll per hopp, dekket av test |
| Supabase gir `authenticated` alle tabellrettigheter som standard. RLS beskyttet, men revisjonsloggen kunne «oppdateres» (0 rader). | Lav | Rettighetene fjernes eksplisitt, og bare nødvendige rettigheter gis. Test bekrefter `permission denied`. |
| `PUBLIC_PATHS` i proxy matchet prefiks (`/loginX` ble regnet som offentlig). | Lav | Eksakt match, unntatt stier som slutter med `/` |
| Feil i rate limiting (f.eks. nede database) ga meldingen «for mange forsøk». | Lav (UX) | Egen melding om at innlogging er midlertidig utilgjengelig |
| SDK-feil ved ugyldig strukturert svar ble ikke oversatt til en forståelig melding. | Lav (UX) | Oversatt, og dekket av test |
| Parallelle publiseringskall kunne rapportere «publisert» to ganger (Facebook ble bare kalt én gang). | Lav | Avklaringen gjenkjenner et fullført forsøk og svarer «allerede publisert» |

## 4. Kjente begrensninger og anbefalinger

- **CSP bruker `'unsafe-inline'` for skript og stil.** Det er nødvendig for Next.js uten nonce-oppsett. Vurder nonce-basert CSP senere.
- **Supabase-sesjonen ligger i informasjonskapsler som JavaScript kan lese.** Det er standard i `@supabase/ssr`. XSS er begrenset av React-escaping, CSP og fravær av `dangerouslySetInnerHTML`.
- **Service-rollen kan i prinsippet godkjenne innlegg.** Databasen krever at `approved_by` er en registrert eier, men kan ikke vite hvem som kaller med service-nøkkelen. Applikasjonen bruker aldri service-rollen til godkjenning (kun til tokens, cron og signerte URL-er). Hold `SUPABASE_SERVICE_ROLE_KEY` hemmelig.
- **Planlagt publisering** kjøres av GitHub Actions hvert 10. minutt (Vercel Hobby tillater bare daglig cron). `CRON_SECRET` må derfor også ligge som GitHub repository secret. Bytt den begge steder hvis den lekker.
- **Rate limiting av AI-kall** (20 per time) beskytter mot kostnadsløp. Sett i tillegg en månedlig utgiftsgrense i Anthropic Console.
- **Tofaktorautentisering:** slå på MFA i Supabase Auth hvis tilgjengelig i planen, og bruk et langt, unikt passord.

## 5. Sjekkliste før produksjon

- [ ] `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `META_APP_SECRET`, `ANTHROPIC_API_KEY` og `OPENAI_API_KEY` er bare lagt inn i Vercel (Production), aldri i Git eller chat.
- [ ] `TOKEN_ENCRYPTION_KEY` er laget med `openssl rand -base64 32` og tatt sikkerhetskopi av på et trygt sted. Mistes nøkkelen, må Facebook kobles til på nytt.
- [ ] Supabase: registrering avslått, Site URL satt, eierkonto opprettet med sterkt passord.
- [ ] Begge migrasjonene er kjørt, og bøtta `media` er **ikke** offentlig.
- [ ] `OWNER_EMAILS` inneholder bare eierens adresse.
- [ ] Meta-appen ber bare om de tre tillatelsene, og redirect-URI er bare produksjonsadressen (pluss eventuelt localhost under utvikling).
- [ ] `APP_URL` er HTTPS-adressen. Vercel tvinger HTTPS.
- [ ] Simulert publisering er testet. Først deretter er `PUBLISH_MODE=live` satt og testmodus slått av.
- [ ] Utgiftsgrense er satt hos Anthropic (og eventuelt OpenAI).
- [ ] `npm test` og `npm run test:e2e` er grønne i CI.
