-- Replace the generated placeholder thumbnails (066) with the real uploaded
-- photos now sitting in storage/thumbnails. Pairing is arbitrary (order only)
-- since the uploaded files' names are orphaned IDs with no link back to any
-- particular simulation; the "-regions.png" file is a click-region overlay
-- mask, not a display thumbnail, so it's excluded.

UPDATE simulations SET thumbnail_url = '/thumbnails/05e7338c-4d9a-4f93-bdec-119c58544a5a.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000001';
UPDATE simulations SET thumbnail_url = '/thumbnails/2f2b86a0-4d1a-4d97-b522-6592a913e18c.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000002';
UPDATE simulations SET thumbnail_url = '/thumbnails/383f1db0-b21e-43ea-8726-acc4ca87f074.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000003';
UPDATE simulations SET thumbnail_url = '/thumbnails/45a07a7a-7a0e-45a4-8804-4b360c53f3a1.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000004';
UPDATE simulations SET thumbnail_url = '/thumbnails/725eb7a2-1234-48b0-aee8-f217256735ca.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000005';
UPDATE simulations SET thumbnail_url = '/thumbnails/83318f84-9612-4715-bae7-17358a4b6664.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000006';
UPDATE simulations SET thumbnail_url = '/thumbnails/ae07a0fb-70e3-420a-ba9a-07c25ac49e16.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000007';
UPDATE simulations SET thumbnail_url = '/thumbnails/b3863c00-d74a-4098-b06d-66136e8ba266.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000008';
UPDATE simulations SET thumbnail_url = '/thumbnails/b6fd215c-4def-4f6d-83dd-860cfd481028.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000009';
UPDATE simulations SET thumbnail_url = '/thumbnails/bc476e68-3acb-4a9f-8d3c-aa3b6583f32d.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000010';
UPDATE simulations SET thumbnail_url = '/thumbnails/be04ed52-3ab3-4530-a611-0be430dec79c.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000011';
UPDATE simulations SET thumbnail_url = '/thumbnails/c11550f4-7d18-43de-a9b0-e0bd3040e110.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000012';
UPDATE simulations SET thumbnail_url = '/thumbnails/cea91667-3445-4444-b463-66b1591acb40.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000013';
UPDATE simulations SET thumbnail_url = '/thumbnails/cea91667-3445-4444-b463-66b1591acb40.webp' WHERE build_uuid = '00000000-0000-4000-8000-000000000014';
UPDATE simulations SET thumbnail_url = '/thumbnails/da31f80a-bdbc-4b2d-a6ec-1196a0575149.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000015';
UPDATE simulations SET thumbnail_url = '/thumbnails/e3afecbd-6862-4664-9a66-630c53c99213.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000016';
UPDATE simulations SET thumbnail_url = '/thumbnails/feeebd58-091b-4f1f-99d8-91dd45406411.png' WHERE build_uuid = '00000000-0000-4000-8000-000000000017';
