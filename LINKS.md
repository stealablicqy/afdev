# AF Hub — hosts to test with /checkall

All links below serve the same build (commit `ca5378b3e1e9e3a1de6e46f879f514d9de305343`).
Proxies are XOR-obfuscated before base64url, and boot probes the Bare endpoint
and falls back to the public Wisp relay if it is blocked.

## jsDelivr (GitHub CDN)
1. https://cdn.jsdelivr.net/gh/stealablicqy/afdev@ca5378b3e1e9e3a1de6e46f879f514d9de305343/public/index.svg
2. https://cdn.jsdelivr.net/gh/stealablicqy/afdev@main/public/index.svg
3. https://cdn.jsdelivr.net/gh/stealablicqy/afdev@latest/public/index.svg
4. https://cdn.jsdelivr.net/gh/stealablicqy/afdev@ca5378b3e1e9e3a1de6e46f879f514d9de305343/public/go/

## Cloudflare Pages (verified working, fastest boot)
5. https://proxy-fix.af-hub-c8v.pages.dev/
6. https://proxy-fix.af-hub-c8v.pages.dev/go/

## GitHub Pages (branch `gh-pages` pushed; enable in repo Settings > Pages if 404)
7. https://stealablicqy.github.io/afdev/

## S3 (create your own buckets; kit is af-hub-s3-upload.zip in the repo root)
Bucket names to try, matching the pattern desync uses:
- afhub-free
- algebrahub-free
- learningtogether-free
- tutorialclass-free
- mathhub-free

Enable static website hosting on each bucket, upload the unzipped contents of
`af-hub-s3-upload.zip`, then test the website endpoint and the virtual-hosted
form, for example:

  https://afhub-free.s3.amazonaws.com/index.html
  https://s3.amazonaws.com/afhub-free/index.html

AWS CLI one-liner per bucket (requires your own credentials):

  aws s3 mb s3://afhub-free
  aws s3 cp af-hub-s3-upload.zip s3://afhub-free/upload.zip
  aws s3 cp dist/ s3://afhub-free/ --recursive
  aws s3api put-bucket-policy --bucket afhub-free --policy file://s3-policy.json
