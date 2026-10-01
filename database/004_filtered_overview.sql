begin;
create or replace function public.mc_dashboard_filtered(p_org uuid, p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; first_month date; last_month date;
begin
 perform mc_private.mc_require(p_org);
 first_month := date_trunc('month',coalesce(nullif(p_filters->>'date_from','')::date,
   coalesce(nullif(p_filters->>'date_to','')::date,mc_private.mc_today()) - interval '5 months'))::date;
 last_month := date_trunc('month',coalesce(nullif(p_filters->>'date_to','')::date,
   greatest(mc_private.mc_today(),first_month)))::date;
 if first_month > last_month then raise exception 'Start date must precede end date'; end if;
 with selected as materialized (
   select * from mc_private.mc_filtered_invoices(p_org,p_filters)
 ), aging_buckets(bucket,position) as (
   values ('Not due',1),('Due today',2),('1–30 days',3),('31–60 days',4),('61–90 days',5),('90+ days',6)
 ), aged as (
   select *,case when due_status='not_due' then 'Not due' when due_status='due_today' then 'Due today'
     when overdue_days<=30 then '1–30 days' when overdue_days<=60 then '31–60 days'
     when overdue_days<=90 then '61–90 days' else '90+ days' end bucket
   from selected where balance>0
 ), months as (
   select m::date month_start from generate_series(first_month,last_month,interval '1 month') m
 ), monthly as (
   select to_char(m.month_start,'YYYY-MM') period,
     coalesce((select sum(i.amount) from selected i where i.invoice_date>=m.month_start and i.invoice_date<(m.month_start+interval '1 month')::date),0) invoiced,
     coalesce((select sum(p.amount) from public.mc_payments p join selected i on i.id=p.invoice_id and i.org_id=p.org_id
       where p.org_id=p_org and p.reversed_at is null and p.payment_date>=m.month_start and p.payment_date<(m.month_start+interval '1 month')::date),0) collected
   from months m
 ), aging as (
   select b.bucket,b.position,coalesce(sum(a.balance),0) amount,count(a.id) invoices
   from aging_buckets b left join aged a on a.bucket=b.bucket group by b.bucket,b.position
 ), payment_mix as (
   select b.status,count(i.id) invoices,coalesce(sum(i.amount),0) invoiced,coalesce(sum(i.balance),0) outstanding
   from (values ('paid'),('partial'),('unpaid')) b(status)
   left join selected i on i.payment_status=b.status group by b.status
 ), top_customers as (
   select customer_id,customer_name,customer_code,sum(balance) outstanding,sum(paid_amount) collected,count(*) invoices
   from selected group by customer_id,customer_name,customer_code having sum(balance)>0
   order by outstanding desc,lower(customer_name),customer_id limit 6
 ), overdue as (
   select * from selected where due_status='overdue' order by due_date,internal_number,id limit 8
 )
 select jsonb_build_object(
   'filters',p_filters,'as_of_date',mc_private.mc_today(),
   'summary',mc_private.mc_summary(coalesce((select jsonb_agg(to_jsonb(i)) from selected i),'[]')),
   'monthly',coalesce((select jsonb_agg(to_jsonb(m) order by m.period) from monthly m),'[]'),
   'aging',coalesce((select jsonb_agg(to_jsonb(a)-'position' order by a.position) from aging a),'[]'),
   'payment_mix',coalesce((select jsonb_agg(to_jsonb(p) order by p.status) from payment_mix p),'[]'),
   'top_customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.outstanding desc,lower(c.customer_name),c.customer_id) from top_customers c),'[]'),
   'overdue_rows',coalesce((select jsonb_agg(to_jsonb(o) order by o.due_date,o.internal_number,o.id) from overdue o),'[]')
 ) into result;
 return result;
end;
$$;
revoke all on function public.mc_dashboard_filtered(uuid,jsonb) from public,anon;
grant execute on function public.mc_dashboard_filtered(uuid,jsonb) to authenticated;
commit;
