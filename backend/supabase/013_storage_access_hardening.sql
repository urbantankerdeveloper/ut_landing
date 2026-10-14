-- Restrict document objects to the authenticated user's own top-level folder.

drop policy if exists "authenticated users upload documents" on storage.objects;
create policy "authenticated users upload documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users read their documents" on storage.objects;
create policy "authenticated users read their documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users update their documents" on storage.objects;
create policy "authenticated users update their documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users delete their documents" on storage.objects;
create policy "authenticated users delete their documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);
