BC RETAIL TIPS — DEPLOY GUIDE
============================
This folder is a complete static website. No build step needed.

OPTION A — You upload it (2 minutes, one time):
1. Go to dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets
2. Name the project: bc-retail-tips
3. Drag in ALL files from this zip (keep the folder structure: posts/ stays a folder)
4. Deploy. Your site is live at https://bc-retail-tips.pages.dev

OPTION B — Atlas deploys it (needs a one-time token upgrade):
Your current Cloudflare token only covers the bestmikedeals.com zone, so Atlas
can't create Pages projects with it yet. If you want Atlas to deploy and update
the site himself going forward, say the word and he'll walk you through creating
a broader token (one time, ~3 minutes in the Cloudflare dashboard).

CUSTOM DOMAIN (later, optional):
- The site works fine on the free bc-retail-tips.pages.dev address.
- To use your own domain later: Pages project → Custom domains → add it,
  then point DNS at the project. No new domain purchase needed if you use a
  subdomain of one you already own.

ADS:
- Each page has a commented-out AdSense slot in the <head>. Paste your publisher
  ID, remove the comment markers, re-upload. That's it.

ADDING NEW ARTICLES:
- Copy one file from posts/, rename it, edit the content, and add a card for it
  on index.html. Or just tell Atlas the topic — he'll draft it.
