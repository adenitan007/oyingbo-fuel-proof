# Oyingbo Fuel Proof

Phone app (installable PWA) that stamps diesel delivery photos at Oyingbo Station
and keeps a shared, write-once register for the audit team.

- Netlify project: oyingbo-fuel-proof (team adenitan007)
- Station PIN is the `ACCESS_PIN` environment variable (already set on the project).
  Change it in Netlify > Project configuration > Environment variables, then redeploy.

## Deploy from your laptop
    npm install -g netlify-cli
    cd oyingbo-fuel-proof
    netlify login
    netlify link --id 2ca266c1-0ede-4a77-b699-3ea7e14b02c0
    netlify deploy --prod --build
