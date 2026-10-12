# Animal NGOs of India: website + scraper

Lookup site of animal welfare, rescue, wildlife and gaushala groups across
every state and district of India, with contacts, who runs each group and
sources. The site is the `site` folder; everything else is the scraper that
fills it.

## Set up (GitHub + Vercel)

1. **Vercel:** Add New Project, import `askrapidresponseteam-cloud/ngo-finder`,
   press Deploy. No settings needed; `vercel.json` points Vercel at the `site`
   folder and adds the security headers. Every push redeploys.
2. **Ola Maps key** as a GitHub secret (never in the code): repo Settings >
   Secrets and variables > Actions > New repository secret, name
   `OLA_MAPS_API_KEY`. Or from your Mac, if you saved the key there and use the
   GitHub CLI:
   `gh secret set OLA_MAPS_API_KEY -R askrapidresponseteam-cloud/ngo-finder < ~/.config/ka-ngo-scraper/ola_maps_key`
3. **Fill the site:** Actions > Refresh data > Run workflow (leave "states"
   blank for all of India). It checks the key with one search, downloads the
   national AWBI list, sweeps Ola Maps in every district, checks the data and
   commits it; Vercel then redeploys. It also runs by itself on the 1st of
   every month. The spreadsheet and run log of each run are attached to the
   run as a download.

The **Tests** workflow runs the regression tests and the data check on every push.

## Publish from your Mac instead (Vercel CLI)

```
bash deploy.sh
```

Checks the data, then publishes the `site` folder to the Vercel project
`ngo-finder` (the Vercel CLI asks you to log in once). Needs Node.js for `npx`.

To refresh with a new scrape and publish:

```
bash run.sh && bash deploy.sh
```

## The site

- **Overview:** map of India with state outlines (states with groups are
  hatched blue, blue dots are districts with groups; tap either), groups by type, how many have a named person, contact or AWBI
  recognition, and the top states and districts.
- **State:** map of that state's districts, ranked district list, then its groups.
- **District or search:** the groups; tap + for contacts, who runs it, and
  "More details" for addresses, AWBI code and sources.
- **Search** covers every field of every group across India (names, other
  names, people, places, addresses, phones, emails, websites, AWBI codes,
  notes) and finds sound-alike spellings and typos too: ganguli finds Suparna
  Ganguly, gowshala finds Gaushala and Goshala. Each result says where it matched.
- Type pills (Animal welfare, Wildlife, Gaushala) and the filter button work in
  every view. Every view has its own link (Copy link).

## On rapid-response.in

The directory also runs at https://rapid-response.in/ngos, inside the Rapid
Response site's header and footer and in its theme. That page (ngos.html in
Website-RRT) holds an empty `<div id="ngo-app" class="ngo-rr">`, loads
`/ngo-app/rr.css` and `/ngo-app/app.js`, and Website-RRT's vercel.json
forwards `/ngo-app/*` to this deployment, so the data stays in one place and
monthly refreshes show up there too.

- `app.js` loads its data and add-ons from beside itself, and builds its own
  markup when it finds `#ngo-app` (no side rail there; Overview, All states,
  Needs and About sit in a row under the site header).
- `rr.css` is generated on every build by `scraper/rrcss.py`: styles.css plus
  `scraper/web/rr-theme.css` (square corners, hairlines, Archivo headings,
  mono labels, data in ink, red only for the main action), every rule scoped
  to `.ngo-rr` so nothing touches the rest of the page. Change the look in
  rr-theme.css, never in rr.css.

## Federation (groups sign in, get verified, post needs)

Pages: `join.html` for groups, coordinators and anyone reporting a problem;
`admin.html` for admins. They stay hidden until a Firebase project is set up.

How a group gets the Verified badge (enforced by `firestore.rules`, not just
the pages):
1. It signs in (Google, or a link sent to its email; no SMS or WhatsApp codes)
   and claims its listing or asks to be listed, with registration proof
   (AWBI code, NGO Darpan ID, trust or society certificate) as photos or a
   shared Drive folder.
2. An admin checks the documents (the console cross-checks AWBI codes against
   the official list and flags duplicate claims).
3. Someone else vouches: a coordinator for that district or state, or a
   verified group the applicant names. Never the applicant, and the admin who
   verifies cannot be the one who vouched.
4. If the admin asks for it, a coordinator does a site visit or video call.
5. Only then can an admin verify. Every step writes a permanent audit entry.

No money: no donate buttons, UPI, bank details or fundraising text anywhere.
The rules refuse such text; the pages explain why before sending. Verified
groups post only in-kind needs (food, medicine, supplies, volunteers,
transport, foster homes, vet help), which expire within 31 days. Anyone signed
in can report a group; admins can suspend a verification.

### One-time setup (free Firebase plan)

1. https://console.firebase.google.com > Add project (name it, Analytics off).
2. Build > Authentication > Get started: enable **Google**, and
   **Email/Password** with **Email link (passwordless sign-in)**. Under
   Settings > Authorized domains, add `ngo-finder-omega.vercel.app`.
3. Build > Firestore Database > Create database, production mode, location
   `asia-south1` (Mumbai).
4. Project settings > General > Your apps > Web (`</>`): register the app and
   copy the `firebaseConfig` values into `scraper/web/fed/config.js`
   (they are public by design).
5. Publish the rules: `npx firebase-tools login`, then
   `npx firebase-tools deploy --only firestore:rules --project YOUR_PROJECT_ID`.
6. The first admin is the owner email written in `firestore.rules`; more
   admins go in the Firestore document `config/admins` (field `emails`, a
   list) from the Firebase console. Appoint coordinators in `admin.html`.

The rules have their own tests (`tests/rules`), run on the Firestore emulator
by the Tests workflow on every push.

## Base data shipped in the repo

- All Karnataka groups on the AWBI recognised list (as on 31 Mar 2026),
  researched groups, and `scraper/data/my_additions.csv`, each with source
  links and, where published, who runs it.
- When the scraper downloads the AWBI list it keeps the national copy in
  `scraper/data/awbi_recognised_all.csv`, so later runs have every state even
  if awbi.gov.in is down.
- State outlines on the map: `scraper/data/india_states_map.json`, built by
  `tools/build_map.py` from india.topo.json in
  https://github.com/varunon9/india-choropleth-javascript (MIT License).
  Ladakh is drawn inside the Jammu and Kashmir outline of that file.
- States and districts come from the India Post PIN code directory
  (`scraper/data/india_pins.csv`, `india_districts.csv`, built by
  `tools/build_geo.py`). Karnataka uses its current 31 districts.

## Ola Maps key (finds the small shelters, free)

Most small shelters and rescue trusts only exist as map listings. Ola's
text search does not answer category searches like "animal shelter", but its
autocomplete finds places by name near a location, and animal groups nearly
always have the word in their name. So the scraper asks autocomplete for
32 words like "animal trust", "gaushala", "jeev daya" and "spca" around the centre
of every district of India, and 8 words like "animal", "goshala" and "dog" around
spread-out PIN code locations inside it (more in Karnataka). That is about
36,000 searches, plus one details lookup per group found. Ola's free tier is
100,000 requests a month with no billing needed, and the scraper stops
itself at 90,000 (`--ola-max`). `--ola-check` makes 6 test calls around
Udupi and Dakshina Kannada and shows what is found.

1. Sign up at https://maps.olakrutrim.com and create an API key.
2. Copy the key, then run: `mkdir -p ~/.config/ka-ngo-scraper && pbpaste > ~/.config/ka-ngo-scraper/ola_maps_key`
3. Check it with one search: `bash run.sh --ola-check`

Groups found on Ola Maps are published with the credit Ola's terms require
("Ola Maps", data available under the Open Database License).

## Google Maps key (optional, Karnataka only)

Google's terms do not allow storing or republishing Places data, so Google is
only used for leads: a listing that matches a known group adds its "Open in
Google Maps" link, a new listing is published only after the scraper confirms
the group on the open web, and everything else goes to the **Leads to
confirm** tab of the spreadsheet. The scraper stops at 4,500 Text Search calls
a month (free tier: 5,000; `--places-max`). Key setup: enable **Places API
(New)** in https://console.cloud.google.com, create a key restricted to it,
then `pbpaste > ~/.config/ka-ngo-scraper/google_maps_key`.

## Adding groups yourself

`scraper/data/my_additions.csv` is published as is. One row per group; fill
`state` (blank means Karnataka) and `district`; use `;` between multiple
phones, emails or links, and write people as `Name|Role|Source link`. Then
run `bash deploy.sh`.

## Run the scraper

```
bash run.sh                          # all of India
bash run.sh --states Karnataka,Goa   # only these states
bash run.sh --quick                  # official lists + map data only
```

Saves to your Desktop: `animal-ngos.html` (the same lookup page in one file,
works offline) and `animal-ngos.xlsx` / `.csv` (the data as a spreadsheet),
and updates the `site` folder.

| Option | What it does |
|---|---|
| `--states A,B` | only these states (default: all of India) |
| `--districts Udupi,Mysuru` | Karnataka web search only in these districts |
| `--no-web` | skip the Karnataka district web searches |
| `--no-enrich` | do not visit websites for email, phone and names |
| `--lookup-max N` | most groups to look up a website for (default 800) |
| `--people-max N` | most groups to search for who runs it (default 600) |
| `--no-people` | skip the extra web search for who runs each group |
| `--ola-key KEY` | Ola Maps key for this run (otherwise the saved file) |
| `--ola-max N` | monthly cap on Ola Maps requests (default 90,000) |
| `--no-ola` | skip the Ola Maps sweep |
| `--ola-check` | one test search with your Ola key, printed in full |
| `--google-key KEY` / `--no-places` / `--places-max N` | Google Maps lead search |
| `--awbi-pdf FILE` | use a downloaded AWBI recognised-list PDF |
| `--abc-pdf FILE` | use a downloaded AWBI ABC-list PDF |
| `--dump-awbi` | also save every parsed AWBI row, to check the parser |
| `--insecure` | only if awbi.gov.in has a broken certificate |

## Where the data comes from

1. **AWBI recognised list** (Animal Welfare Board of India), all states. Official, high confidence.
2. **AWBI ABC list**: groups running animal birth control projects. Municipal bodies are left out.
3. **Ola Maps** listings in every district. Medium confidence.
4. **OpenStreetMap**: mapped animal shelters and animal or wildlife NGOs in India. Medium confidence.
5. **Web search**, Karnataka districts. Low confidence, marked "Not verified".

After merging duplicates it looks up websites and reads each website's home,
contact, about and team pages for emails, phones, social links and the
people who run it. Names are kept with the link where each was found, so
treat them as leads and confirm when you get in touch.

## If something looks wrong

- AWBI renames its PDF on every update. If the download fails, get the list
  from awbi.gov.in and pass it with `--awbi-pdf`.
- Search engines sometimes show a captcha after many queries. The scraper
  switches engine and waits, and stops searching if all of them block.
