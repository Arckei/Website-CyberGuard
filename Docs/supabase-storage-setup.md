# Supabase Storage Setup for CyberGuard

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
4. Keep Public bucket off for the secure setup.
5. Create the bucket.

Private bucket means lesson files are not publicly downloadable by random users.

## 3. Secure Setup

Use this for the real app:

1. Keep the bucket private.
2. Do not allow direct `anon` upload/delete policies.
3. Create a Supabase Edge Function that receives the Firebase ID token from the browser.
4. In the Edge Function, verify the Firebase token and check the admin UID/email.
5. Store the Supabase service role key only in Edge Function secrets.
6. Let the Edge Function upload/delete files with the service role key.
7. For student downloads, have the Edge Function return short-lived signed URLs.

This is more secure because the browser only has the public Firebase/Supabase anon values. The powerful Supabase service key stays server-side.

Recommended function secrets:

```sql
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FIREBASE_PROJECT_ID=cyberguard-56e66
CYBERGUARD_ADMIN_UIDS=GiCGuDEbtNcjALETb7oto1HntYS2
CYBERGUARD_ADMIN_EMAILS=keithwilsonplays@gmail.com
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in `supabase-config.js` or any browser file.

## Demo-Only Shortcut

Only use direct `anon` upload policies for a quick school demo where security is not important. Because this app uses Firebase Auth, Supabase cannot tell who is a Firebase admin from direct browser uploads unless a trusted server or Edge Function verifies it.

## 4. Update `supabase-config.js`

Open `supabase-config.js` and replace the placeholders:

```js
export const supabaseStorageConfig = {
  enabled: true,
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
  bucket: "cyberguard-lessons"
};
```

## 5. Test

1. Log in as admin.
2. Go to Admin > Class.
3. Select a class.
4. Upload a PDF, DOCX, PPT, or PPTX file.
5. Confirm the file appears in Supabase Storage under `classes/<class-id>/`.
6. Open the student Lessons page and click View.

If upload says permission denied, re-check the bucket name and policies.
