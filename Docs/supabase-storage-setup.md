# Supabase Storage Setup for CyberGuard

Supabase Storage is the active lesson storage provider. Firebase continues to
hold authentication and lesson metadata.

CyberGuard keeps login and lesson metadata in Firebase. Supabase Storage is only for the actual uploaded lesson files.

## 1. Create the Supabase Project

1. Go to https://supabase.com/dashboard.
2. Create a new project.
3. Open Project Settings > API.
4. Copy:
   - Project URL
   - anon public key

## 2. Create the Bucket

1. Go to Storage.
2. Click New bucket.
3. Name it `cyberguard-lessons`.
4. Keep the bucket **Private**.
5. Create the bucket.

The app uses protected Vercel API functions. The browser never receives the
Supabase service-role key or a permanent public file URL.

## 3. Secure Setup

Use this for the real app:

1. Keep the bucket private.
2. Do not allow direct `anon` upload/delete policies.
3. Deploy the `/api` functions with Vercel.
4. The API verifies the Firebase ID token and checks the admin UID/email.
5. The API uses the Supabase service-role key only on the server.
6. Uploads use one-time signed upload URLs; downloads use 5-minute signed URLs.

This is more secure because the browser only has the public Firebase/Supabase anon values. The powerful Supabase service key stays server-side.

Recommended function secrets:

```sql
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FIREBASE_PROJECT_ID=your-firebase-project-id
CYBERGUARD_ADMIN_UIDS=your-admin-firebase-uid
CYBERGUARD_ADMIN_EMAILS=admin@example.com
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in `supabase-config.js` or any browser file.

## 4. Configure Vercel secrets

Add these environment variables in Vercel for Production and Preview:

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SUPABASE_STORAGE_BUCKET=cyberguard-lessons
FIREBASE_SERVICE_ACCOUNT={the entire Firebase service-account JSON}
```

Never add `SUPABASE_SERVICE_ROLE_KEY` or `FIREBASE_SERVICE_ACCOUNT` to frontend
files, GitHub, or any public `.env` file.

## 5. Update `services/supabase-config.js`

Open `supabase-config.js` and replace the placeholders:

```js
export const supabaseStorageConfig = {
  enabled: true,
  url: "https://vumqubqukdzasyhccske.supabase.co",
  anonKey: "sb_publishable_vYWcpTS2erKIEJZlcl3PhQ_jw0Q8MeT",
  bucket: "cyberguard-lessons"
};
```

## 6. Test

1. Log in as admin.
2. Go to Admin > Class.
3. Select a class.
4. Upload a PDF, DOCX, PPT, or PPTX file.
5. Confirm the file appears in Supabase Storage under `classes/<class-id>/`.
6. Open the student Lessons page and click View.

If upload says permission denied, re-check the bucket name and policies.
