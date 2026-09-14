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
4. Set the bucket to **Public** for this direct browser upload setup.
5. Create the bucket.

The app uses the Supabase publishable/anon key from the frontend. Do not put a
service-role key in the frontend.

## 3. Secure Setup

Use this for the real app:

1. Keep the bucket public.
2. Add the Storage policies below.
3. The app still checks admin access through Firebase before showing lesson upload UI.

This is more secure because the browser only has the public Firebase/Supabase anon values. The powerful Supabase service key stays server-side.

Recommended function secrets:

```sql
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FIREBASE_PROJECT_ID=your-firebase-project-id
CYBERGUARD_ADMIN_UIDS=your-admin-firebase-uid
CYBERGUARD_ADMIN_EMAILS=admin@example.com
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in `supabase-config.js` or any browser file.

## 4. Storage policies

Run this in Supabase SQL Editor:

```sql
create policy "CyberGuard public uploads"
on storage.objects for insert to anon
with check (bucket_id = 'cyberguard-lessons');

create policy "CyberGuard public reads"
on storage.objects for select to anon
using (bucket_id = 'cyberguard-lessons');

create policy "CyberGuard public deletes"
on storage.objects for delete to anon
using (bucket_id = 'cyberguard-lessons');
```

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
