-- Run against a LOCAL test database after migrations. Every fixture and change
-- is fictional and rolled back. This is not a production load test.
begin;
set local statement_timeout='20s';
set local lock_timeout='2s';
do $$
declare v_owner uuid; v_user uuid:=gen_random_uuid(); v_other uuid:=gen_random_uuid();
  v_project uuid:=gen_random_uuid(); v_delivery uuid:=gen_random_uuid();
begin
  -- A local test may intentionally have registration disabled. This transaction
  -- never commits this fixture prerequisite (or any account/content below).
  if to_regclass('public.platform_registration_settings') is not null then
    update public.platform_registration_settings set registration_open=true where singleton;
  end if;
  select user_id into v_owner from public.platform_admins where role='owner';
  if v_owner is null then
    v_owner:=gen_random_uuid();
    insert into auth.users(id,email_confirmed_at) values(v_owner,now());
    insert into public.platform_admins(user_id) values(v_owner);
  end if;
  insert into auth.users(id,email_confirmed_at) values(v_user,now()),(v_other,now());
  perform set_config('test.restriction.owner',v_owner::text,true);
  perform set_config('test.restriction.user',v_user::text,true);
  perform set_config('test.restriction.other',v_other::text,true);
  perform set_config('test.restriction.project',v_project::text,true);
  perform set_config('test.restriction.delivery',v_delivery::text,true);
  insert into public.social_profiles(user_id,nickname) values(v_user,'Fictional user');
  insert into public.account_sync_snapshots(user_id,payload) values(v_user,'{"format":"study-life-sync","version":3,"values":{},"manifest":{}}');
  insert into public.team_projects(id,owner_id,name) values(v_project,v_user,'Fictional access test');
  insert into public.team_project_members(project_id,user_id,role,status,joined_at) values(v_project,v_user,'owner','active',now());
  insert into public.team_project_deliverables(id,project_id,title,created_by) values(v_delivery,v_project,'Fictional delivery',v_user);
  insert into storage.objects(bucket_id,name) values('qixing-deliverables',v_project||'/'||v_delivery||'/'||v_user||'/fictional.txt');
end;
$$;

set local role service_role;
do $$
declare o uuid:=current_setting('test.restriction.owner')::uuid; u uuid:=current_setting('test.restriction.user')::uuid;
  other_user uuid:=current_setting('test.restriction.other')::uuid; result jsonb; denied boolean:=false;
begin
  result:=public.platform_set_account_restriction(o,u,'publish',true,'Fictional publish restriction',null,5400);
  perform set_config('test.restriction.publish_revision',result#>>'{restriction,revision}',true);
  if not (public.platform_account_access(u,false)->>'allowed')::boolean then raise exception 'Publish-only restriction blocked reads'; end if;
  if (public.platform_account_access(u,true)->>'allowed')::boolean then raise exception 'Publish restriction was bypassed'; end if;
  result:=public.platform_set_account_restriction(o,u,'account',true,'Fictional account restriction',null,null,null,true);
  perform set_config('test.restriction.account_revision',result#>>'{restriction,revision}',true);
  if (public.platform_account_access(u,false)->>'allowed')::boolean then raise exception 'Account restriction was bypassed'; end if;
  begin perform public.platform_set_account_restriction(o,u,'publish',false,'Stale test',null);
  exception when serialization_failure then denied:=true; end;
  if not denied then raise exception 'Stale update was accepted'; end if;
  denied:=false;
  begin perform public.platform_set_account_restriction(other_user,u,'account',false,'Not owner',null);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Non-owner set restriction'; end if;
  denied:=false;
  begin perform public.platform_set_account_restriction(o,o,'account',true,'Owner test',null,60);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Owner was restrictable'; end if;
end;
$$;
reset role;

do $$ begin perform set_config('request.jwt.claim.sub',current_setting('test.restriction.user'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.restriction.user'),'role','authenticated')::text,true); end $$;
set local role authenticated;
do $$
declare result jsonb; denied boolean:=false;
begin
  result:=public.platform_my_restrictions();
  if not (result#>>'{restrictions,account,active}')::boolean then raise exception 'Banned user could not read own notice'; end if;
  if result#>>'{restrictions,publish,reason}'<>'Fictional publish restriction' then raise exception 'Own notice reason missing'; end if;
  if not public.platform_ack_restriction('publish',current_setting('test.restriction.publish_revision')::uuid) then raise exception 'Cannot acknowledge own notice'; end if;
  if (public.platform_my_restrictions()#>>'{restrictions,publish,unread}')::boolean then raise exception 'Notice remains unread'; end if;
  if private.platform_account_allowed(auth.uid()) then raise exception 'Acknowledgment removed ban'; end if;
  begin perform count(*) from public.platform_account_restrictions;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Authenticated read private restriction table'; end if;
  denied:=false;
  begin perform public.platform_set_account_restriction(current_setting('test.restriction.owner')::uuid,auth.uid(),'account',false,'Forged owner');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Authenticated called service-only setter'; end if;
  denied:=false;
  begin perform count(*) from public.account_sync_snapshots where user_id=auth.uid();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Banned JWT read snapshot'; end if;
  denied:=false;
  begin perform public.write_account_sync_snapshot(1,'{"format":"study-life-sync","version":3,"values":{},"manifest":{}}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Banned JWT wrote snapshot RPC'; end if;
  denied:=false;
  begin update public.account_sync_snapshots set revision=revision+1 where user_id=auth.uid();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Banned JWT directly updated snapshot'; end if;
  denied:=false;
  begin insert into public.account_sync_snapshots(user_id,payload) values(auth.uid(),'{"format":"study-life-sync","version":3,"values":{},"manifest":{}}');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Banned JWT directly inserted snapshot'; end if;
  denied:=false;
  begin update public.social_profiles set nickname='Fictional blocked edit' where user_id=auth.uid();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Banned JWT edited profile'; end if;
  if exists(select 1 from storage.objects where bucket_id='qixing-deliverables') then raise exception 'Banned JWT read project file'; end if;
  update storage.objects set name=name||'.blocked' where bucket_id='qixing-deliverables';
  if found then raise exception 'Banned JWT updated project file'; end if;
  delete from storage.objects where bucket_id='qixing-deliverables';
  if found then raise exception 'Banned JWT deleted project file'; end if;
end;
$$;
reset role;

-- Another account cannot see the first account's reason or mark it read.
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('test.restriction.other'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.restriction.other'),'role','authenticated')::text,true); end $$;
set local role authenticated;
do $$ begin
  if public.platform_my_restrictions()->'restrictions'<>'{}'::jsonb then raise exception 'Cross-account notice leaked'; end if;
  if public.platform_ack_restriction('publish',current_setting('test.restriction.publish_revision')::uuid) then raise exception 'Cross-account acknowledgment accepted'; end if;
end $$;
reset role;

set local role service_role;
do $$ declare o uuid:=current_setting('test.restriction.owner')::uuid; u uuid:=current_setting('test.restriction.user')::uuid;
begin
  perform public.platform_set_account_restriction(o,u,'account',false,'Fictional early release',current_setting('test.restriction.account_revision')::uuid);
  if not private.platform_account_allowed(u) or private.platform_account_allowed(u,true) then raise exception 'Lifting account ban affected independent publishing restriction'; end if;
  if (select count(*) from public.platform_admin_audit where target_user_id=u and outcome='succeeded')<>3 then raise exception 'Atomic audit events missing'; end if;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('test.restriction.user'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.restriction.user'),'role','authenticated')::text,true); end $$;
set local role authenticated;
do $$ declare denied boolean:=false; result jsonb;
begin
  result:=public.write_account_sync_snapshot(1,'{"format":"study-life-sync","version":3,"values":{},"manifest":{}}');
  if not (result->>'ok')::boolean then raise exception 'Publish-only user could not sync'; end if;
  begin update public.social_profiles set nickname='Fictional publishing bypass' where user_id=auth.uid();
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Publish-only user edited public profile'; end if;
  if not exists(select 1 from storage.objects where bucket_id='qixing-deliverables') then raise exception 'Publish-only user could not read own file'; end if;
  denied:=false;
  begin insert into storage.objects(bucket_id,name) values('qixing-deliverables',current_setting('test.restriction.project')||'/'||current_setting('test.restriction.delivery')||'/'||auth.uid()||'/blocked.txt');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Publish-only user uploaded content'; end if;
  denied:=false;
  begin update storage.objects set name=name||'.edited' where bucket_id='qixing-deliverables'; denied:=not found;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Publish-only user updated shared file'; end if;
end $$;
reset role;
set local role service_role;
do $$ declare u uuid:=current_setting('test.restriction.user')::uuid;
begin
  update public.platform_account_restrictions set expires_at=now()-interval '1 second' where user_id=u and scope='publish';
  if not private.platform_account_allowed(u,true) then raise exception 'Expired restriction remained active'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false;
begin
  begin perform public.platform_my_restrictions(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Anonymous read restriction notices'; end if;
end $$;
reset role;
rollback;
select 'passed' as account_restriction_role_checks;
