begin;
create schema if not exists mc_private;
revoke all on schema mc_private from public, anon, authenticated;

create table public.mc_organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 120),
 currency text not null default 'KES' check(currency ~ '^[A-Z]{3}$'), created_at timestamptz not null default now()
);
create table public.mc_members (
 org_id uuid not null references public.mc_organizations(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','admin','collector','viewer')), active boolean not null default true,
 primary key(org_id,user_id)
);
create index mc_members_user_idx on public.mc_members(user_id,org_id) where active;
create table public.mc_customers (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.mc_organizations(id),
 customer_code text not null default ('CUS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 name text not null check(length(btrim(name)) between 1 and 160), email text not null default '', phone text not null default '',
 notes text not null default '', archived boolean not null default false, version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id), check(length(email)<=254),check(length(phone)<=60), check(length(customer_code) between 1 and 80), check(length(notes)<=4000)
);
create unique index mc_customers_code_idx on public.mc_customers(org_id,lower(btrim(customer_code)));
create index mc_customers_name_idx on public.mc_customers(org_id,lower(btrim(name)));
create table public.mc_invoice_counters (
 org_id uuid not null references public.mc_organizations(id), year integer not null,
 last_serial integer not null check(last_serial between 1 and 10000), primary key(org_id,year)
);
create table public.mc_import_batches (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.mc_organizations(id),
 file_name text not null, created_by uuid not null references auth.users(id),
 rows jsonb not null, preview jsonb not null, result jsonb, status text not null default 'preview' check(status in ('preview','completed')),
 created_at timestamptz not null default now(), committed_at timestamptz, unique(org_id,id)
);
create table public.mc_invoices (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.mc_organizations(id),
 customer_id uuid not null, internal_number text not null,
 external_number text, invoice_date date not null, due_date date not null, amount numeric(16,2) not null check(amount>0 and amount<=999999999999.99),
 paid_amount numeric(16,2) not null default 0 check(paid_amount>=0 and paid_amount<=amount),
 operation_status text not null default 'open' check(operation_status in ('open','actioned','disputed')),
 notes text not null default '', version integer not null default 1,
 request_id uuid, import_batch_id uuid, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id), unique(org_id,request_id), unique(org_id,internal_number), foreign key(org_id,customer_id) references public.mc_customers(org_id,id),
 foreign key(org_id,import_batch_id) references public.mc_import_batches(org_id,id),
 check(due_date>=invoice_date), check(external_number is null or length(btrim(external_number)) between 1 and 100), check(length(notes)<=4000)
);
create unique index mc_invoices_external_idx on public.mc_invoices(org_id,customer_id,lower(btrim(external_number))) where external_number is not null;
create index mc_invoices_customer_idx on public.mc_invoices(org_id,customer_id,invoice_date desc);
create index mc_invoices_due_idx on public.mc_invoices(org_id,due_date) where paid_amount<amount;
create index mc_invoices_date_idx on public.mc_invoices(org_id,invoice_date);
create index mc_invoices_amount_idx on public.mc_invoices(org_id,amount);
create table public.mc_payments (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.mc_organizations(id), invoice_id uuid not null,
 amount numeric(16,2) not null check(amount>0), payment_date date not null,
 method text not null check(method in ('cash','bank','mpesa','cheque','other')), reference text not null default '', notes text not null default '',
 idempotency_key uuid not null, recorded_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 reversed_at timestamptz, reversed_by uuid references auth.users(id), reversal_reason text,
 unique(org_id,idempotency_key), foreign key(org_id,invoice_id) references public.mc_invoices(org_id,id),
 check(length(notes)<=4000), check(length(reference)<=160), check((reversed_at is null and reversed_by is null and reversal_reason is null) or (reversed_at is not null and reversed_by is not null and length(btrim(reversal_reason))>0))
);
create index mc_payments_invoice_idx on public.mc_payments(org_id,invoice_id,created_at desc);
create index mc_payments_date_idx on public.mc_payments(org_id,payment_date) where reversed_at is null;
create table public.mc_audit_events (
 id bigint generated always as identity primary key, org_id uuid not null references public.mc_organizations(id),
 customer_id uuid, invoice_id uuid, customer_name text, invoice_number text, external_number text,
 action text not null, actor_id uuid references auth.users(id), actor_email text, before_data jsonb, after_data jsonb,
 created_at timestamptz not null default now()
);
create index mc_audit_org_date_idx on public.mc_audit_events(org_id,created_at desc,id desc);
create index mc_audit_customer_idx on public.mc_audit_events(org_id,customer_id,created_at desc);
create index mc_audit_invoice_idx on public.mc_audit_events(org_id,invoice_id,created_at desc);
create table public.mc_report_snapshots (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.mc_organizations(id),
 created_by uuid not null references auth.users(id), kind text not null check(kind in ('invoices','history','payments')),
 filters jsonb not null, filter_labels jsonb not null default '{}', rows jsonb not null, summary jsonb not null, created_at timestamptz not null default now(),
 as_of_date date not null, expires_at timestamptz not null default (now()+interval '24 hours')
);
create index mc_reports_owner_idx on public.mc_report_snapshots(org_id,created_by,created_at desc);

create function mc_private.mc_role(p_org uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.mc_members where org_id=p_org and user_id=(select auth.uid()) and active
$$;
grant usage on schema mc_private to authenticated;
grant execute on function mc_private.mc_role(uuid) to authenticated;
create function mc_private.mc_require(p_org uuid, p_roles text[] default array['owner','admin','collector','viewer']) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(mc_private.mc_role(p_org),'')<>all(p_roles) then raise exception 'Access denied' using errcode='42501'; end if;
end $$;
create function mc_private.mc_today() returns date language sql stable set search_path='' as $$ select (now() at time zone 'Africa/Nairobi')::date $$;
create function mc_private.mc_audit(p_org uuid,p_action text,p_before jsonb,p_after jsonb,p_customer uuid default null,p_invoice uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare c text; n text; e text;
begin
 select name into c from public.mc_customers where id=p_customer and org_id=p_org;
 select internal_number,external_number into n,e from public.mc_invoices where id=p_invoice and org_id=p_org;
 insert into public.mc_audit_events(org_id,action,actor_id,actor_email,before_data,after_data,customer_id,invoice_id,customer_name,invoice_number,external_number)
 values(p_org,p_action,auth.uid(),(select email from auth.users where id=auth.uid()),p_before,p_after,p_customer,p_invoice,c,n,e);
end $$;
create function mc_private.mc_next_number(p_org uuid) returns text language plpgsql security definer set search_path='' as $$
declare y integer:=extract(year from mc_private.mc_today()); s integer;
begin
 insert into public.mc_invoice_counters(org_id,year,last_serial) values(p_org,y,1)
 on conflict(org_id,year) do update set last_serial=public.mc_invoice_counters.last_serial+1
 returning last_serial into s;
 return 'INV-'||to_char(mc_private.mc_today(),'MM-YYYY')||'-'||lpad(s::text,5,'0');
end $$;

create view public.mc_invoice_register with (security_invoker=true) as
select i.*, c.name customer_name,c.customer_code,c.email,c.phone,
 (i.amount-i.paid_amount)::numeric(16,2) balance,
 case when i.paid_amount=i.amount then 'paid' when i.paid_amount>0 then 'partial' else 'unpaid' end payment_status,
 case when i.paid_amount=i.amount then 'settled' when i.due_date<mc_private.mc_today() then 'overdue' when i.due_date=mc_private.mc_today() then 'due_today' else 'not_due' end due_status,
 case when i.paid_amount=i.amount then 0 else greatest(0,mc_private.mc_today()-i.due_date) end overdue_days
from public.mc_invoices i join public.mc_customers c on c.org_id=i.org_id and c.id=i.customer_id;
grant execute on function mc_private.mc_today() to authenticated;

-- Read access is scoped by active membership. All writes use guarded RPCs.
do $$ declare t text; begin
 foreach t in array array['mc_organizations','mc_members','mc_customers','mc_invoice_counters','mc_import_batches','mc_invoices','mc_payments','mc_audit_events','mc_report_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 foreach t in array array['mc_customers','mc_import_batches','mc_invoices','mc_payments','mc_audit_events'] loop
 execute format('create policy mc_read on public.%I for select to authenticated using (mc_private.mc_role(org_id) is not null)',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy mc_read on public.mc_organizations for select to authenticated using(mc_private.mc_role(id) is not null);
create policy mc_read on public.mc_members for select to authenticated using(user_id=auth.uid() or mc_private.mc_role(org_id) in ('owner','admin'));
create policy mc_read on public.mc_report_snapshots for select to authenticated using(created_by=auth.uid() and mc_private.mc_role(org_id) is not null and expires_at>now());
revoke all on sequence public.mc_audit_events_id_seq from public,anon,authenticated;
grant select on public.mc_organizations,public.mc_members,public.mc_report_snapshots,public.mc_invoice_register to authenticated;
revoke all on public.mc_invoice_register from public,anon;

create function public.mc_save_customer(p_org uuid,p_data jsonb,p_id uuid default null,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.mc_customers; cur public.mc_customers;
begin
 perform mc_private.mc_require(p_org,array['owner','admin','collector']);
 if length(btrim(coalesce(p_data->>'name',''))) not between 1 and 160 then raise exception 'Customer name is required'; end if;
 if p_id is null then
 insert into public.mc_customers(org_id,name,customer_code,email,phone,notes) values(p_org,btrim(p_data->>'name'),coalesce(nullif(btrim(p_data->>'customer_code'),''),'CUS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),coalesce(p_data->>'email',''),coalesce(p_data->>'phone',''),coalesce(p_data->>'notes','')) returning * into cur;
 else
 select * into old from public.mc_customers where id=p_id and org_id=p_org for update;
 if old.id is null then raise exception 'Customer not found'; end if;
 if p_version is distinct from old.version then raise exception 'Record changed. Reload and try again' using errcode='40001'; end if;
 update public.mc_customers set name=btrim(p_data->>'name'),email=coalesce(p_data->>'email',''),phone=coalesce(p_data->>'phone',''),notes=coalesce(p_data->>'notes',''),archived=coalesce((p_data->>'archived')::boolean,false),version=version+1,updated_at=now() where id=p_id returning * into cur;
 end if;
 perform mc_private.mc_audit(p_org,case when p_id is null then 'customer_created' else 'customer_updated' end,case when p_id is null then null else to_jsonb(old) end,to_jsonb(cur),cur.id);
 return to_jsonb(cur);
end $$;

create function public.mc_save_invoice(p_org uuid,p_data jsonb,p_id uuid default null,p_version integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.mc_invoices; cur public.mc_invoices; cust uuid; amt numeric; inv_date date; due date;
begin
 perform mc_private.mc_require(p_org,array['owner','admin','collector']);
 cust:=(p_data->>'customer_id')::uuid; amt:=(p_data->>'amount')::numeric; inv_date:=(p_data->>'invoice_date')::date; due:=(p_data->>'due_date')::date;
 if amt is null or amt<=0 or amt<>round(amt,2) or amt>999999999999.99 then raise exception 'Enter a positive amount with up to two decimal places'; end if;
 if due<inv_date or inv_date is null or due is null then raise exception 'Check invoice and due dates'; end if;
 if not exists(select 1 from public.mc_customers where org_id=p_org and id=cust and not archived) then raise exception 'Choose an active customer'; end if;
 if p_id is null then
 if nullif(p_data->>'request_id','') is not null then
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||(p_data->>'request_id'),0));
 select * into cur from public.mc_invoices where org_id=p_org and request_id=(p_data->>'request_id')::uuid;
 if cur.id is not null then
 if cur.customer_id<>cust or cur.amount<>amt or cur.invoice_date<>inv_date or cur.due_date<>due or coalesce(cur.external_number,'')<>coalesce(p_data->>'external_number','') then raise exception 'Invoice request ID already used'; end if;
 return to_jsonb(cur);
 end if;
 end if;
 insert into public.mc_invoices(org_id,customer_id,internal_number,external_number,invoice_date,due_date,amount,operation_status,notes,created_by,request_id)
 values(p_org,cust,mc_private.mc_next_number(p_org),nullif(btrim(p_data->>'external_number'),''),inv_date,due,amt,coalesce(p_data->>'operation_status','open'),coalesce(p_data->>'notes',''),auth.uid(),(p_data->>'request_id')::uuid) returning * into cur;
 else
 select * into old from public.mc_invoices where id=p_id and org_id=p_org for update;
 if old.id is null then raise exception 'Invoice not found'; end if;
 if p_version is distinct from old.version then raise exception 'Record changed. Reload and try again' using errcode='40001'; end if;
 if old.customer_id<>cust then raise exception 'Invoice customer cannot be changed'; end if;
 if amt<old.paid_amount then raise exception 'Invoice amount cannot be lower than collections'; end if;
 update public.mc_invoices set external_number=nullif(btrim(p_data->>'external_number'),''),invoice_date=inv_date,due_date=due,amount=amt,operation_status=coalesce(p_data->>'operation_status','open'),notes=coalesce(p_data->>'notes',''),version=version+1,updated_at=now() where id=p_id returning * into cur;
 end if;
 perform mc_private.mc_audit(p_org,case when p_id is null then 'invoice_created' else 'invoice_updated' end,case when p_id is null then null else to_jsonb(old) end,to_jsonb(cur),cust,cur.id);
 return to_jsonb(cur);
end $$;

create function public.mc_record_payment(p_org uuid,p_invoice uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.mc_invoices; pay public.mc_payments; amt numeric; key uuid; d date;
begin
 perform mc_private.mc_require(p_org,array['owner','admin','collector']);
 key:=(p_data->>'idempotency_key')::uuid; amt:=(p_data->>'amount')::numeric; d:=(p_data->>'payment_date')::date;
 if key is null then raise exception 'Payment request ID is required'; end if;
 select * into inv from public.mc_invoices where id=p_invoice and org_id=p_org for update;
 if inv.id is null then raise exception 'Invoice not found'; end if;
 select * into pay from public.mc_payments where org_id=p_org and idempotency_key=key;
 if pay.id is not null then
 if pay.invoice_id<>p_invoice or pay.amount<>amt or pay.payment_date<>d or pay.method<>p_data->>'method' or pay.reference<>coalesce(p_data->>'reference','') or pay.notes<>coalesce(p_data->>'notes','') then raise exception 'Payment request ID already used'; end if;
 return to_jsonb(pay);
 end if;
 if amt is null or amt<=0 or amt<>round(amt,2) or amt>inv.amount-inv.paid_amount then raise exception 'Payment must be positive and within the outstanding balance'; end if;
 if d is null or d>mc_private.mc_today() or d<inv.invoice_date then raise exception 'Payment date must be between invoice date and today'; end if;
 insert into public.mc_payments(org_id,invoice_id,amount,payment_date,method,reference,notes,idempotency_key,recorded_by)
 values(p_org,p_invoice,amt,d,p_data->>'method',coalesce(p_data->>'reference',''),coalesce(p_data->>'notes',''),key,auth.uid()) returning * into pay;
 update public.mc_invoices set paid_amount=paid_amount+amt,version=version+1,updated_at=now() where id=p_invoice;
 perform mc_private.mc_audit(p_org,'payment_recorded',null,to_jsonb(pay),inv.customer_id,p_invoice);
 return to_jsonb(pay);
end $$;
create function public.mc_reverse_payment(p_org uuid,p_payment uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pay public.mc_payments; inv public.mc_invoices;
begin
 perform mc_private.mc_require(p_org,array['owner','admin']);
 if length(btrim(p_reason)) not between 1 and 1000 or p_reason is null then raise exception 'Reversal reason is required'; end if;
 -- Always lock invoice before payment, matching the recording lock order.
 select i.* into inv from public.mc_invoices i join public.mc_payments p on p.invoice_id=i.id and p.org_id=i.org_id where p.id=p_payment and p.org_id=p_org for update of i;
 if inv.id is null then raise exception 'Payment not found'; end if;
 select * into pay from public.mc_payments where id=p_payment and org_id=p_org for update;
 if pay.reversed_at is not null then raise exception 'Payment already reversed'; end if;
 update public.mc_payments set reversed_at=now(),reversed_by=auth.uid(),reversal_reason=btrim(p_reason) where id=p_payment;
 update public.mc_invoices set paid_amount=paid_amount-pay.amount,version=version+1,updated_at=now() where id=inv.id;
 perform mc_private.mc_audit(p_org,'payment_reversed',to_jsonb(pay),to_jsonb(pay)||jsonb_build_object('reversal_reason',btrim(p_reason),'reversed_at',now(),'reversed_by',auth.uid()),inv.customer_id,inv.id);
 return jsonb_build_object('id',p_payment,'reversed',true);
end $$;

create function public.mc_save_member(p_org uuid,p_email text,p_role text,p_active boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid; old jsonb;
begin
 perform mc_private.mc_require(p_org,array['owner','admin']);
 -- Serialize membership edits so two admins cannot remove each other concurrently.
 perform 1 from public.mc_organizations where id=p_org for update;
 if p_role not in ('admin','collector','viewer') then raise exception 'Choose admin, collector or viewer'; end if;
 select id into uid from auth.users where lower(email)=lower(btrim(p_email));
 if uid is null then raise exception 'Create this user in Supabase Authentication first'; end if;
 if uid=auth.uid() then raise exception 'You cannot change your own access'; end if;
 if exists(select 1 from public.mc_members where org_id=p_org and user_id=uid and role='owner') then raise exception 'Owner access cannot be changed here'; end if;
 if mc_private.mc_role(p_org)='admin' and (p_role='admin' or exists(select 1 from public.mc_members where org_id=p_org and user_id=uid and role='admin')) then raise exception 'Only the owner can manage administrators' using errcode='42501'; end if;
 select to_jsonb(m) into old from public.mc_members m where org_id=p_org and user_id=uid;
 insert into public.mc_members(org_id,user_id,role,active) values(p_org,uid,p_role,p_active) on conflict(org_id,user_id) do update set role=excluded.role,active=excluded.active;
 perform mc_private.mc_audit(p_org,'member_updated',old,jsonb_build_object('user_id',uid,'email',p_email,'role',p_role,'active',p_active));
 return jsonb_build_object('user_id',uid,'email',p_email,'role',p_role,'active',p_active);
end $$;
create function public.mc_team(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform mc_private.mc_require(p_org,array['owner','admin']);
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'active',m.active) order by u.email) from public.mc_members m join auth.users u on u.id=m.user_id where m.org_id=p_org),'[]'::jsonb);
end $$;

create function mc_private.mc_import_preview(p_org uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; item jsonb; output jsonb:='[]'; errors jsonb; row_no integer:=1; cust public.mc_customers; inv public.mc_invoices; found_count integer; amt numeric; idate date; ddate date; seen text[]:='{}'; k text; customer_key text; customer_names jsonb:='{}';
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'Import requires 1–5000 rows'; end if;
 for r in select value from jsonb_array_elements(p_rows) loop
 row_no:=row_no+1; errors:='[]'; cust:=null; inv:=null;
 if length(btrim(coalesce(r->>'customer_name',''))) not between 1 and 160 then errors:=errors||jsonb_build_array('Customer name is required'); end if;
 if length(btrim(coalesce(r->>'invoice_number',''))) not between 1 and 100 then errors:=errors||jsonb_build_array('Source invoice number is required'); end if;
 if length(coalesce(r->>'customer_code',''))>80 or length(coalesce(r->>'notes',''))>4000 or length(coalesce(r->>'email',''))>254 or length(coalesce(r->>'phone',''))>60 then errors:=errors||jsonb_build_array('Customer code or contact fields are too long'); end if;
 begin
 if coalesce(r->>'invoice_date','')!~ '^\d{4}-\d{2}-\d{2}$' or coalesce(r->>'due_date','')!~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'date'; end if;
 idate:=(r->>'invoice_date')::date; ddate:=(r->>'due_date')::date;
 if ddate<idate then raise exception 'date'; end if;
 exception when others then errors:=errors||jsonb_build_array('Invalid invoice or due date'); end;
 begin
 if coalesce(r->>'amount','')!~ '^\d+(\.\d{1,2})?$' then raise exception 'amount'; end if;
 amt:=(r->>'amount')::numeric;
 if amt<=0 or amt>999999999999.99 then raise exception 'amount'; end if;
 exception when others then errors:=errors||jsonb_build_array('Invalid amount'); end;
 if nullif(btrim(r->>'customer_code'),'') is not null then
 select * into cust from public.mc_customers where org_id=p_org and lower(btrim(customer_code))=lower(btrim(r->>'customer_code'));
 else
 select count(*) into found_count from public.mc_customers where org_id=p_org and lower(btrim(name))=lower(btrim(r->>'customer_name'));
 if found_count>1 then errors:=errors||jsonb_build_array('Customer name is ambiguous; provide customer_code');
 else select * into cust from public.mc_customers where org_id=p_org and lower(btrim(name))=lower(btrim(r->>'customer_name')); end if;
 end if;
 if cust.id is not null then
 if cust.archived then errors:=errors||jsonb_build_array('Customer is archived'); end if;
 if lower(btrim(cust.name))<>lower(btrim(r->>'customer_name')) then errors:=errors||jsonb_build_array('Customer name does not match customer_code'); end if;
 select * into inv from public.mc_invoices where org_id=p_org and customer_id=cust.id and lower(btrim(external_number))=lower(btrim(r->>'invoice_number'));
 if inv.id is not null and amt<inv.paid_amount then errors:=errors||jsonb_build_array('Amount is below recorded collections'); end if;
 end if;
 customer_key:=coalesce(cust.id::text,nullif(lower(btrim(r->>'customer_code')),''),'name:'||lower(btrim(coalesce(r->>'customer_name',''))));
 if customer_names ? customer_key and customer_names->>customer_key<>lower(btrim(r->>'customer_name')) then errors:=errors||jsonb_build_array('Customer name differs for the same customer_code'); end if;
 customer_names:=customer_names||jsonb_build_object(customer_key,lower(btrim(r->>'customer_name')));
 if coalesce(r->>'customer_code','')='' and exists(select 1 from jsonb_array_elements(p_rows) x where lower(btrim(x->>'customer_name'))=lower(btrim(r->>'customer_name')) and nullif(btrim(x->>'customer_code'),'') is not null) then errors:=errors||jsonb_build_array('Use customer_code consistently for this customer'); end if;
 k:=customer_key||'|'||lower(btrim(coalesce(r->>'invoice_number','')));
 if k=any(seen) then errors:=errors||jsonb_build_array('Duplicate invoice in this file'); end if; seen:=array_append(seen,k);
 item:=jsonb_build_object('row_number',row_no,'row',r,'customer_id',cust.id,'customer_version',cust.version,'invoice_id',inv.id,'invoice_version',inv.version,'mode',case when inv.id is null then 'insert' else 'update' end,'errors',errors);
 output:=output||jsonb_build_array(item);
 end loop;
 return output;
end $$;
create function public.mc_preview_import(p_org uuid,p_file_name text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb; bid uuid;
begin
 perform mc_private.mc_require(p_org,array['owner','admin','collector']);
 if length(p_file_name) not between 1 and 200 then raise exception 'Invalid file name'; end if;
 preview:=mc_private.mc_import_preview(p_org,p_rows);
 insert into public.mc_import_batches(org_id,file_name,created_by,rows,preview) values(p_org,p_file_name,auth.uid(),p_rows,preview) returning id into bid;
 return jsonb_build_object('id',bid,'preview',preview,'status','preview','file_name',p_file_name);
end $$;
create function public.mc_commit_import(p_org uuid,p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch public.mc_import_batches; latest jsonb; item jsonb; r jsonb; cust uuid; inv jsonb; inserted integer:=0; updated integer:=0; import_result jsonb;
begin
 perform mc_private.mc_require(p_org,array['owner','admin','collector']);
 perform 1 from public.mc_organizations where id=p_org for update;
 select * into batch from public.mc_import_batches where id=p_batch and org_id=p_org and created_by=auth.uid() for update;
 if batch.id is null then raise exception 'Import not found'; end if;
 if batch.status='completed' then return batch.result; end if;
 if batch.created_at<now()-interval '24 hours' then raise exception 'Import preview expired. Upload again'; end if;
 latest:=mc_private.mc_import_preview(p_org,batch.rows);
 if latest is distinct from batch.preview then raise exception 'Records changed since preview. Upload again' using errcode='40001'; end if;
 if exists(select 1 from jsonb_array_elements(latest) e where jsonb_array_length(e->'errors')>0) then raise exception 'Correct rejected rows before importing'; end if;
 for item in select value from jsonb_array_elements(latest) loop
 r:=item->'row'; cust:=(item->>'customer_id')::uuid;
 if cust is null then
 if nullif(btrim(r->>'customer_code'),'') is not null then
 select id into cust from public.mc_customers where org_id=p_org and lower(btrim(customer_code))=lower(btrim(r->>'customer_code'));
 else select id into cust from public.mc_customers where org_id=p_org and lower(btrim(name))=lower(btrim(r->>'customer_name')); end if;
 if cust is null then
 cust:=(public.mc_save_customer(p_org,jsonb_build_object('name',r->>'customer_name','customer_code',r->>'customer_code','email',r->>'email','phone',r->>'phone'))->>'id')::uuid;
 end if;
 end if;
 inv:=public.mc_save_invoice(p_org,jsonb_build_object('customer_id',cust,'external_number',r->>'invoice_number','invoice_date',r->>'invoice_date','due_date',r->>'due_date','amount',r->>'amount','notes',coalesce(nullif(r->>'notes',''),(select notes from public.mc_invoices where id=(item->>'invoice_id')::uuid),''),
 'operation_status',coalesce((select operation_status from public.mc_invoices where id=(item->>'invoice_id')::uuid),'open')),(item->>'invoice_id')::uuid,(item->>'invoice_version')::integer);
 update public.mc_invoices set import_batch_id=p_batch where id=(inv->>'id')::uuid;
 if item->>'mode'='insert' then inserted:=inserted+1; else updated:=updated+1; end if;
 end loop;
 import_result:=jsonb_build_object('id',p_batch,'inserted',inserted,'updated',updated,'rejected',0);
 update public.mc_import_batches set status='completed',result=import_result,committed_at=now() where id=p_batch;
 perform mc_private.mc_audit(p_org,'import_completed',null,import_result||jsonb_build_object('file_name',batch.file_name));
 return import_result;
end $$;

create function mc_private.mc_filtered_invoices(p_org uuid,p_filters jsonb) returns setof public.mc_invoice_register
language sql stable security definer set search_path='' as $$
 select v.* from public.mc_invoice_register v where v.org_id=p_org
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(v.customer_name||' '||v.customer_code||' '||v.internal_number||' '||coalesce(v.external_number,'')))>0)
 and (nullif(p_filters->>'customer_id','') is null or v.customer_id=(p_filters->>'customer_id')::uuid)
 and (nullif(p_filters->>'date_from','') is null or v.invoice_date>=(p_filters->>'date_from')::date)
 and (nullif(p_filters->>'date_to','') is null or v.invoice_date<=(p_filters->>'date_to')::date)
 and (nullif(p_filters->>'due_from','') is null or v.due_date>=(p_filters->>'due_from')::date)
 and (nullif(p_filters->>'due_to','') is null or v.due_date<=(p_filters->>'due_to')::date)
 and (nullif(p_filters->>'amount_min','') is null or v.amount>=(p_filters->>'amount_min')::numeric)
 and (nullif(p_filters->>'amount_max','') is null or v.amount<=(p_filters->>'amount_max')::numeric)
 and (nullif(p_filters->>'balance_min','') is null or v.balance>=(p_filters->>'balance_min')::numeric)
 and (nullif(p_filters->>'balance_max','') is null or v.balance<=(p_filters->>'balance_max')::numeric)
 and (nullif(p_filters->>'paid_min','') is null or v.paid_amount>=(p_filters->>'paid_min')::numeric)
 and (nullif(p_filters->>'paid_max','') is null or v.paid_amount<=(p_filters->>'paid_max')::numeric)
 and (nullif(p_filters->>'overdue_min','') is null or v.overdue_days>=(p_filters->>'overdue_min')::integer)
 and (nullif(p_filters->>'overdue_max','') is null or v.overdue_days<=(p_filters->>'overdue_max')::integer)
 and (coalesce(p_filters->>'payment_status','')='' or v.payment_status=p_filters->>'payment_status')
 and (coalesce(p_filters->>'due_status','')='' or v.due_status=p_filters->>'due_status')
 and (coalesce(p_filters->>'operation_status','')='' or v.operation_status=p_filters->>'operation_status')
 order by
 case when p_filters->>'sort'='name' then lower(v.customer_name) end asc,
 case when p_filters->>'sort'='due' then v.due_date end asc,
 case when p_filters->>'sort'='amount' then v.amount end desc,
 case when p_filters->>'sort'='balance' then v.balance end desc,
 v.invoice_date desc,v.internal_number asc,v.id;
$$;
create function mc_private.mc_summary(p_rows jsonb) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('count',count(*),'invoiced',coalesce(sum((r->>'amount')::numeric),0),'collected',coalesce(sum((r->>'paid_amount')::numeric),0),
 'outstanding',coalesce(sum((r->>'balance')::numeric),0),'overdue',coalesce(sum((r->>'balance')::numeric) filter(where r->>'due_status'='overdue'),0),
 'partial_balance',coalesce(sum((r->>'balance')::numeric) filter(where r->>'payment_status'='partial'),0),
 'unpaid_balance',coalesce(sum((r->>'balance')::numeric) filter(where r->>'payment_status'='unpaid'),0),
 'paid_count',count(*) filter(where r->>'payment_status'='paid'),'overdue_count',count(*) filter(where r->>'due_status'='overdue'))
 from jsonb_array_elements(p_rows) r
$$;
create function public.mc_query_invoices(p_org uuid,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare summary jsonb; data jsonb;
begin
 perform mc_private.mc_require(p_org);
 if p_page<1 or p_size not between 1 and 100 then raise exception 'Invalid page'; end if;
 select jsonb_build_object('count',count(*),'invoiced',coalesce(sum(amount),0),'collected',coalesce(sum(paid_amount),0),'outstanding',coalesce(sum(balance),0),'overdue',coalesce(sum(balance) filter(where due_status='overdue'),0)) into summary from mc_private.mc_filtered_invoices(p_org,p_filters);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into data from (select * from mc_private.mc_filtered_invoices(p_org,p_filters) limit p_size offset (p_page-1)*p_size) r;
 return jsonb_build_object('rows',data,'summary',summary,'page',p_page,'size',p_size);
end $$;
create function public.mc_apply_report(p_org uuid,p_kind text,p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare data jsonb; summary jsonb; sid uuid; labels jsonb;
begin
 perform mc_private.mc_require(p_org);
 if p_kind='invoices' then
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into data from (select * from mc_private.mc_filtered_invoices(p_org,p_filters) limit 20001) r;
 summary:=mc_private.mc_summary(data);
 elsif p_kind='history' then
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into data from (
 select * from public.mc_audit_events e where org_id=p_org
 and (nullif(p_filters->>'customer_id','') is null or e.customer_id=(p_filters->>'customer_id')::uuid)
 and (nullif(p_filters->>'invoice_id','') is null or e.invoice_id=(p_filters->>'invoice_id')::uuid)
 and (nullif(p_filters->>'actor_id','') is null or e.actor_id=(p_filters->>'actor_id')::uuid)
 and (coalesce(p_filters->>'action','')='' or e.action=p_filters->>'action')
 and (nullif(p_filters->>'event_from','') is null or e.created_at>=((p_filters->>'event_from')::date::timestamp at time zone 'Africa/Nairobi'))
 and (nullif(p_filters->>'event_to','') is null or e.created_at<(((p_filters->>'event_to')::date+1)::timestamp at time zone 'Africa/Nairobi'))
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(coalesce(e.customer_name,'')||' '||coalesce(e.invoice_number,'')||' '||coalesce(e.external_number,'')||' '||coalesce(e.actor_email,'')))>0)
 order by created_at desc,id desc limit 20001) r;
 summary:=jsonb_build_object('count',jsonb_array_length(data));
 elsif p_kind='payments' then
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into data from (
 select p.*,i.customer_id,i.customer_name,i.customer_code,i.internal_number,i.external_number from public.mc_payments p join public.mc_invoice_register i on i.id=p.invoice_id and i.org_id=p.org_id
 where p.org_id=p_org
 and (nullif(p_filters->>'customer_id','') is null or i.customer_id=(p_filters->>'customer_id')::uuid)
 and (nullif(p_filters->>'event_from','') is null or p.payment_date>=(p_filters->>'event_from')::date)
 and (nullif(p_filters->>'event_to','') is null or p.payment_date<=(p_filters->>'event_to')::date)
 and (nullif(p_filters->>'amount_min','') is null or p.amount>=(p_filters->>'amount_min')::numeric)
 and (nullif(p_filters->>'amount_max','') is null or p.amount<=(p_filters->>'amount_max')::numeric)
 and (coalesce(p_filters->>'payment_method','')='' or p.method=p_filters->>'payment_method')
 and (coalesce(p_filters->>'reversal_status','')='' or (p_filters->>'reversal_status'='active' and p.reversed_at is null) or (p_filters->>'reversal_status'='reversed' and p.reversed_at is not null))
 and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(i.customer_name||' '||i.internal_number||' '||coalesce(i.external_number,'')||' '||p.reference))>0)
 order by p.payment_date desc,p.created_at desc,p.id limit 20001) r;
 select jsonb_build_object('count',jsonb_array_length(data),'collected',coalesce(sum((e->>'amount')::numeric) filter(where e->>'reversed_at' is null),0)) into summary from jsonb_array_elements(data) e;
 else raise exception 'Invalid report'; end if;
 if jsonb_array_length(data)>20000 then raise exception 'More than 20,000 rows. Narrow the filters'; end if;
 labels:=jsonb_strip_nulls(jsonb_build_object('Customer',(select name from public.mc_customers where org_id=p_org and id=nullif(p_filters->>'customer_id','')::uuid),'Invoice',(select internal_number from public.mc_invoices where org_id=p_org and id=nullif(p_filters->>'invoice_id','')::uuid),'User',(select max(actor_email) from public.mc_audit_events where org_id=p_org and actor_id=nullif(p_filters->>'actor_id','')::uuid)));
 insert into public.mc_report_snapshots(org_id,created_by,kind,filters,filter_labels,rows,summary,as_of_date) values(p_org,auth.uid(),p_kind,p_filters,labels,data,summary,mc_private.mc_today()) returning id into sid;
 perform mc_private.mc_audit(p_org,'report_applied',null,jsonb_build_object('report_id',sid,'kind',p_kind,'filters',p_filters,'summary',summary));
 return jsonb_build_object('id',sid,'kind',p_kind,'filters',p_filters,'filter_labels',labels,'summary',summary,'rows',data,'created_at',now(),'as_of_date',mc_private.mc_today());
end $$;
create function public.mc_get_report(p_org uuid,p_report uuid,p_export boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare snap public.mc_report_snapshots;
begin
 perform mc_private.mc_require(p_org);
 select * into snap from public.mc_report_snapshots where id=p_report and org_id=p_org and created_by=auth.uid() and expires_at>now();
 if snap.id is null then raise exception 'Report expired or unavailable. Press OK again'; end if;
 if p_export then perform mc_private.mc_audit(p_org,'report_exported',null,jsonb_build_object('report_id',p_report,'kind',snap.kind,'filters',snap.filters)); end if;
 return to_jsonb(snap);
end $$;
create function public.mc_dashboard(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare summary jsonb; aging jsonb; monthly jsonb;
begin
 perform mc_private.mc_require(p_org);
 select mc_private.mc_summary(coalesce(jsonb_agg(to_jsonb(r)),'[]')) into summary from public.mc_invoice_register r where org_id=p_org;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into aging from (
 select bucket,coalesce(sum(balance),0) amount,count(*) invoices from (
 select balance,case when due_status='not_due' then 'Not due' when due_status='due_today' then 'Due today' when overdue_days<=30 then '1–30 days' when overdue_days<=60 then '31–60 days' when overdue_days<=90 then '61–90 days' else '90+ days' end bucket
 from public.mc_invoice_register where org_id=p_org and balance>0) a group by bucket) r;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.period),'[]') into monthly from (
 select to_char(m,'YYYY-MM') period,
 coalesce((select sum(amount) from public.mc_invoices where org_id=p_org and invoice_date>=m::date and invoice_date<(m+interval '1 month')::date),0) invoiced,
 coalesce((select sum(amount) from public.mc_payments where org_id=p_org and reversed_at is null and payment_date>=m::date and payment_date<(m+interval '1 month')::date),0) collected
 from generate_series(date_trunc('month',mc_private.mc_today())-interval '5 months',date_trunc('month',mc_private.mc_today()),interval '1 month') m) r;
 return jsonb_build_object('summary',summary,'aging',aging,'monthly',monthly,'as_of_date',mc_private.mc_today());
end $$;

create function public.mc_history_actors(p_org uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform mc_private.mc_require(p_org);
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select distinct actor_id,actor_email from public.mc_audit_events where org_id=p_org and actor_id is not null order by actor_email) r),'[]');
end $$;

-- Explicit allowlist. New functions are never automatically callable by clients.
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='mc_private' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 end loop;
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'mc\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
grant execute on function mc_private.mc_role(uuid),mc_private.mc_today() to authenticated;
commit;
