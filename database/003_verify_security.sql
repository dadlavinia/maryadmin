-- Run as postgres in SQL Editor. Every row must return true.
select c.relname, c.relrowsecurity rls_enabled,
 not has_table_privilege('anon',c.oid,'SELECT') anonymous_read_blocked,
 not has_table_privilege('authenticated',c.oid,'INSERT') direct_insert_blocked,
 not has_table_privilege('authenticated',c.oid,'UPDATE') direct_update_blocked,
 not has_table_privilege('authenticated',c.oid,'DELETE') direct_delete_blocked
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'mc\_%' escape '\' order by c.relname;
select proname, not has_function_privilege('anon',p.oid,'EXECUTE') anonymous_execution_blocked,
 proconfig @> array['search_path=""'] fixed_search_path
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','mc_private') and proname like 'mc\_%' escape '\';
-- Must return zero rows.
select i.id,i.internal_number,i.paid_amount,coalesce(sum(p.amount) filter(where p.reversed_at is null),0) ledger_total
from public.mc_invoices i left join public.mc_payments p on p.invoice_id=i.id and p.org_id=i.org_id
group by i.id having i.paid_amount<>coalesce(sum(p.amount) filter(where p.reversed_at is null),0);
