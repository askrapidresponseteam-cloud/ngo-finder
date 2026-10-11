# Karnataka animal NGOs: website + scraper

Lookup site of animal welfare, rescue, wildlife and gaushala groups across
Karnataka, with contacts, who runs each group and sources. The site is the
`karnataka-animal-ngos` folder; everything else is the scraper that fills it.

## Set up (GitHub + Vercel)

1. **Vercel:** Add New Project, import `askrapidresponseteam-cloud/ngo-finder`,
   press Deploy. No settings needed; `vercel.json` points Vercel at the site
   folder and adds the security headers. Every push redeploys.
2. **Ola Maps key** as a GitHub secret (never in the code): repo Settings >
   Secrets and variables > Actions > New repository secret, name
   `OLA_MAPS_API_KEY`. Or from your Mac, if you saved the key there and use the
   GitHub CLI:
   `gh secret set OLA_MAPS_API_KEY -R askrapidresponseteam-cloud/ngo-finder < ~/.config/ka-ngo-scraper/ola_maps_key`
3. **Fill the site:** Actions > Refresh data > Run workflow. It checks the key
   with one search, sweeps Karnataka, checks the data, and commits it; Vercel
   then redeploys. It also runs by itself on the 1st of every month. The
   spreadsheet and run log of each run are attached to the run as a download.

The **Tests** workflow runs the regression tests and the data check on every push.

## Publish from your Mac instead (Vercel CLI)

```
bash deploy.sh
```

Checks the data, then publishes the `karnataka-animal-ngos` folder to the
Vercel project `karnataka-animal-ngos` (created on first run; the Vercel CLI
asks you to log in once). Needs Node.js for `npx`.

The site ships with a verified base dataset: all 84 Karnataka groups on the
AWBI recognised list (as on 31 Mar 2026) plus researched groups, each with
source links and, where published, who runs it. See `scraper/data/`.

To refresh with a new scrape and publish:

```
bash run.sh && bash deploy.sh
```

`run.sh` rebuilds the website folder from the base dataset plus everything
the scraper finds.

## Ola Maps key (finds the small shelters, free)

Most small shelters and rescue trusts only exist as map listings. The
scraper sweeps Ola Maps across every district, all 191 taluk towns and 22
Bengaluru localities (about 1,400 searches, plus one details lookup per
shelter found: roughly 2,000 to 3,000 requests). Ola's free tier is 100,000
requests a month with no billing needed, and the scraper stops itself at
90,000 (`--ola-max`).

1. Sign up at https://maps.olakrutrim.com and create an API key.
2. Copy the key, then run: `mkdir -p ~/.config/ka-ngo-scraper && pbpaste > ~/.config/ka-ngo-scraper/ola_maps_key`
3. Check it with one search: `bash run.sh --ola-check`

Groups found on Ola Maps are published on the site with the credit Ola's
terms require ("Ola Maps", data available under the Open Database License).

## Google Maps key (optional extra)

Most small shelters and rescue trusts only exist as Google Maps listings, so
the scraper sweeps Google Maps (Places API) across every district, taluk town
and Bengaluru locality. It only uses the free tier:

1. In https://console.cloud.google.com create a project, enable
   **Places API (New)**, and add a billing account (Google requires one even
   for free use).
2. Create an API key and restrict it to Places API (New).
3. Optional, for a hard guarantee: under Places API (New) > Quotas, set
   "Text Search requests per day" to 300.
4. Copy the key, then run: `mkdir -p ~/.config/ka-ngo-scraper && pbpaste > ~/.config/ka-ngo-scraper/google_maps_key`

The scraper itself stops at 4,500 Text Search calls a month (free tier: 5,000;
change with `--places-max`). A full sweep uses roughly 1,000 to 1,500.

Google's terms do not allow storing or republishing Places data, so:
- a Maps listing that matches a known group only adds its "Open in Google Maps" link
- a new listing is published only after the scraper confirms the group on the
  open web (its own site, Facebook, Instagram or news), using that source
- everything else goes to the **Leads to confirm** tab of the spreadsheet.
  Call them, and add the real ones to `scraper/data/my_additions.csv`.

## Adding groups yourself

`scraper/data/my_additions.csv` is published as is. One row per group; use
`;` between multiple phones, emails or links, and write people as
`Name|Role|Source link`. Then run `bash deploy.sh`.

## Scraper

Finds animal welfare, rescue, wildlife and gaushala organisations across all
31 districts of Karnataka, and who runs each one. Saves to your Desktop:

- `karnataka-animal-ngos.html`: lookup page. Opens in any browser, works offline.
  Pick a district or search a group, person or town; tap + for contacts and who runs it.
- `karnataka-animal-ngos.xlsx` and `.csv`: the same data as a spreadsheet.

## Run

```
bash run.sh            # full run, 15 to 25 minutes
bash run.sh --quick    # official lists + OpenStreetMap only, about 1 minute
```

Other options (add after `run.sh`):

| Option | What it does |
|---|---|
| `--districts Udupi,Mysuru` | web search only these districts |
| `--no-web` | skip district web searches |
| `--no-enrich` | do not visit websites for email, phone and names |
| `--no-people` | skip the extra web search for who runs each group |
| `--ola-key KEY` | Ola Maps key for this run (otherwise read from the saved file) |
| `--ola-max N` | monthly cap on Ola Maps requests (default 90,000) |
| `--no-ola` | skip the Ola Maps sweep |
| `--ola-check` | one test search with your Ola key, printed in full |
| `--google-key KEY` | Google Maps key for this run (otherwise read from the saved file) |
| `--places-max N` | monthly cap on Google Text Search calls (default 4,500) |
| `--no-places` | skip the Google Maps sweep |
| `--awbi-pdf FILE` | use a downloaded AWBI recognised-list PDF |
| `--abc-pdf FILE` | use a downloaded AWBI ABC-list PDF |
| `--dump-awbi` | also save every parsed AWBI row, to check the parser |
| `--insecure` | only if awbi.gov.in has a broken certificate |

## Where the data comes from

1. **AWBI recognised list** (Animal Welfare Board of India). Official, high confidence.
2. **AWBI ABC list**: groups running animal birth control projects. Municipal bodies are left out.
3. **OpenStreetMap**: mapped animal shelters and animal or wildlife NGOs. Medium confidence.
4. **Web search** (DuckDuckGo, Bing as backup), two searches per district. Low confidence, marked "Needs review".

After merging duplicates it looks up websites for AWBI groups and reads each
website's home, contact, about and team pages for emails, phones, social links
and the people who run it.

## Who runs it

Names come from the group's own website (team, about, trustee pages) and, when
the site names nobody, from search snippets that are clearly about that group.
Only name and role are kept, with the link where each was found, so every
name can be checked. Names are matched by pattern, so treat them as leads
and confirm when you get in touch.

## The spreadsheet

- **NGOs**: one row per organisation, filter by District, Category or Confidence.
- **By district**: counts.
- **Run log**: which sources worked and anything that failed.

Gaushalas are included and tagged "Gaushala / cattle shelter" so you can filter them out.

## If something looks wrong

- AWBI renames its PDF on every update. The scraper searches for the newest one,
  but if it fails, download the list from awbi.gov.in and pass it with `--awbi-pdf`.
- Search engines sometimes show a captcha after many queries. The scraper then
  switches engine, and stops searching if both block. Run again later with
  `--districts` for the ones that were missed.
