# Backblaze B2 Setup for CyberGuard

CyberGuard keeps login and lesson/class metadata in Firebase. Profile photos
and lesson files (PDF/DOC/DOCX/PPT/PPTX) live in Backblaze B2 — chosen
instead of Supabase or Firebase Storage because it has a genuinely free,
no-credit-card 10GB tier.

Because B2 needs a secret key to authorize uploads, and that key can never
be shipped to the browser, uploads go through small Vercel serverless
functions under `/api/`:

```
browser → /api/b2-*-upload-url (verifies your Firebase login) → short-lived
signed URL → browser uploads directly to B2
```

## 1. Create the B2 account and buckets

1. Sign up at https://www.backblaze.com/sign-up/cloud-storage — no card
   needed for the 10GB free tier.
2. Create two buckets:
   - `cyberguard-avatars` — **Private**. (Public buckets require Backblaze
     email verification *and* a payment method/history on file, which
     defeats the point of avoiding a card — so avatars are private too,
     accessed the same signed-URL way as lessons.)
   - `cyberguard-lessons` — **Private**.

## 2. Get the S3-compatible endpoint

Go to **Account → S3 Compatible API**. Note the **Endpoint**
(e.g. `s3.us-west-004.backblazeb2.com`) and the region code inside it
(e.g. `us-west-004`).

## 3. Create a scoped Application Key

Go to **App Keys → Add a New Application Key**. Restrict it to your two
buckets with Read + Write access. Copy the `keyID` and `applicationKey`
immediately — Backblaze only shows the `applicationKey` once.

## 4. Get a Firebase service account key

**Firebase Console → Project Settings → Service Accounts → Generate new
private key.** This downloads a JSON file — it's how `/api/_lib/firebaseAdmin.js`
verifies who's actually signed in before handing out an upload/download URL.
**Never commit this file to git.**

## 5. Set environment variables in Vercel

Project → **Settings → Environment Variables** (Production + Preview):

| Key | Value |
|---|---|
| `B2_ENDPOINT` | e.g. `https://s3.us-west-004.backblazeb2.com` |
| `B2_REGION` | e.g. `us-west-004` |
| `B2_KEY_ID` | from step 3 |
| `B2_APPLICATION_KEY` | from step 3 |
| `B2_AVATARS_BUCKET` | `cyberguard-avatars` |
| `B2_LESSONS_BUCKET` | `cyberguard-lessons` |
| `FIREBASE_SERVICE_ACCOUNT` | the entire JSON file from step 4, pasted as one value |

All should be type **Secret**, not **Config**.

## 6. Allow browser uploads (CORS)

Because the browser uploads the file directly to the presigned B2 URL, both
buckets need a CORS rule. In the bucket's **Lifecycle Rules and CORS Rules**
settings, add a rule with:

- Allowed origins: your deployed site origin (for example,
  `https://your-domain.vercel.app`); add `http://localhost:3000` only for local testing
- Allowed operations: `s3_put`, `s3_get`, and `s3_head`
- Allowed headers: `*`
- Expose headers: `ETag`
- Max age: `3600`

## 7. Deploy

Push to the branch Vercel deploys from. Vercel installs the dependencies
in the root `package.json` (`firebase-admin`, `@aws-sdk/client-s3`,
`@aws-sdk/s3-request-presigner`) automatically for the `/api` functions —
no local build step needed for the rest of the (plain static) site.

## How access control works

Every `/api/b2-*` function requires a valid Firebase ID token
(`Authorization: Bearer <token>`), verified server-side — the same identity
your app already establishes on login. From there:

- **Avatar upload**: you can only upload to your own `avatars/{your-uid}.*`
  key — enforced by the endpoint itself.
- **Avatar download**: owner or admin only, mirroring the
  `users/{userId}` read rule in `firestore.rules`.
- **Lesson upload/delete**: admin-only, mirroring `firestore.rules`'
  `lessons` collection.
- **Lesson download**: any signed-in user, mirroring `firestore.rules`'
  current `allow read: if isSignedIn();` on `lessons`.

The admin allow-list is duplicated in three places that must be kept in
sync: `firestore.rules`, `services/firebase-service.js`
(`ADMIN_EMAILS`/`ADMIN_USER_IDS`), and each `/api/b2-*` function that checks
`isAdmin()`. If you add a new admin, update all three.

## If a key ever leaks

Delete it immediately (B2 → App Keys → Delete; Google Cloud Console → IAM &
Admin → Service Accounts → your service account → Keys tab → Delete) and
generate a replacement. A credential that's been pasted anywhere outside
its secure storage (chat, a screenshot, a commit) should be treated as
compromised regardless of how "low-stakes" the project seems — rotate
first, then keep going.
