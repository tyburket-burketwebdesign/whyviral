-- Remove the empty anonymous rows created by page loads before the fix.
-- Safe: these have no user, no email and no saved analyses.
delete from accounts
where auth_user_id is null
  and email is null
  and full_name is null
  and id not in (select account_id from analyses)
  and id not in (select account_id from usage_events);
