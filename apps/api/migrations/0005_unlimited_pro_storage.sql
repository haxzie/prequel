-- Pro is unlimited now, not 1 TB. Existing subscribers were backfilled onto the
-- old cap by `0004`, and nothing else moves them until a webhook happens to
-- fire — which for a team that is already `pro` and paying may be a month away.
UPDATE `organization` SET `storage_quota_bytes` = 9007199254740991 WHERE `plan` = 'pro';
