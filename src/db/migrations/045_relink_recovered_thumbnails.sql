-- Relink the two real thumbnail images recovered from the storage volume
-- after the seed wipe incident (see 044 and the storage-scan/storage-relink
-- admin tool in catalog.service.js). The simulations table wipes/reseeds
-- with a fresh random `id` each time, but `build_uuid` stays fixed across
-- reseeds (it's the literal SEED_SIMS constant in seed.js), so match on
-- that instead of id to keep this idempotent and safe to reapply.

UPDATE simulations
   SET thumbnail_url = 'https://backend-production-a76c.up.railway.app/thumbnails/2f2b86a0-4d1a-4d97-b522-6592a913e18c.png'
 WHERE build_uuid = '00000000-0000-4000-8000-000000000004'  -- Fluid Mechanics Lab
   AND deleted_at IS NULL;

UPDATE simulations
   SET thumbnail_url = 'https://backend-production-a76c.up.railway.app/thumbnails/05e7338c-4d9a-4f93-bdec-119c58544a5a.png'
 WHERE build_uuid = '00000000-0000-4000-8000-000000000001'  -- PLC Control Systems Lab
   AND deleted_at IS NULL;
