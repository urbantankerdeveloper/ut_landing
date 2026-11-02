import { useState } from 'react'
import { Plus, RefreshCw, Tag, Trash2 } from 'lucide-react'
import { useAdminCouponMutations, useAdminCoupons } from '../hooks/useAdminData'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.coupons.live

type Props = { onNotice: (message: string) => void }
type CouponForm = { code: string; label: string; discount: string; expires: string; active: boolean }

function mapCoupon(item: Record<string, unknown>): CouponForm & { id: string } { return { id: String(item.id), code: String(item.code ?? ''), label: String(item.label ?? item.title ?? ''), discount: item.discount ? String(item.discount) : item.discount_type === 'percentage' ? copy.percentOff(String(item.discount_value)) : copy.fixedOff(String(item.discount_value ?? 0)), expires: String(item.expires ?? item.valid_until ?? '').slice(0, 10), active: Boolean(item.active ?? item.is_active) } }

export default function AdminCouponsLiveScreen({ onNotice }: Props) {
  const query = useAdminCoupons()
  const mutations = useAdminCouponMutations()
  const [form, setForm] = useState<CouponForm>({ code: '', label: '', discount: '', expires: '', active: true })
  const [editingId, setEditingId] = useState<string | undefined>()
  const coupons = (query.data ?? []).map((item) => mapCoupon(item as Record<string, unknown>))
  function save(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); mutations.save.mutate({ id: editingId, payload: form }, { onSuccess: () => { setEditingId(undefined); setForm({ code: '', label: '', discount: '', expires: '', active: true }); onNotice(copy.notices.saved) }, onError: () => onNotice(copy.notices.saveFailed) }) }
  if (query.isLoading) return <section className="admin-view-panel"><h2>{copy.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{copy.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{copy.retry}</button></section>
  return <section className="admin-coupons-screen"><div className="coupon-page-hero"><div><p className="eyebrow">{copy.eyebrow}</p><h1>{copy.heroTitle}</h1><p>{copy.heroIntro}</p></div><div className="coupon-hero-mark"><Tag size={31} /><strong>{coupons.length}</strong><small>{copy.totalCoupons}</small></div></div><section className="coupon-surface"><form className="modal-form" onSubmit={save}><div className="modal-form-row"><label>{copy.labels.code}<input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} required /></label><label>{copy.labels.label}<input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required /></label></div><div className="modal-form-row"><label>{copy.labels.discount}<input value={form.discount} onChange={(event) => setForm({ ...form, discount: event.target.value })} required placeholder={copy.discountPlaceholder} /></label><label>{copy.labels.expires}<input type="date" value={form.expires} onChange={(event) => setForm({ ...form, expires: event.target.value })} required /></label></div><button className="button button-primary" disabled={mutations.save.isPending}>{mutations.save.isPending ? copy.saving : editingId ? copy.updateCoupon : copy.addCoupon} <Plus size={15} /></button></form><div className="coupon-card-grid">{coupons.map((coupon) => <article className="coupon-card" key={coupon.id}><div className="coupon-card-top"><span className="coupon-code"><Tag size={14} /> {coupon.code}</span><span className={`status-tag ${coupon.active ? '' : 'inactive'}`}>{coupon.active ? copy.active : copy.inactive}</span></div><h2>{coupon.discount}</h2><p>{coupon.label}</p><div className="coupon-card-meta"><span>{copy.labels.expires} <b>{coupon.expires}</b></span></div><div className="coupon-card-actions"><button className="button button-quiet" onClick={() => { setEditingId(coupon.id); setForm(coupon) }}>{copy.edit}</button><button className="icon-action danger" aria-label={copy.deleteCoupon(coupon.code)} onClick={() => mutations.remove.mutate(coupon.id, { onSuccess: () => onNotice(copy.notices.deleted), onError: () => onNotice(copy.notices.deleteFailed) })}><Trash2 size={15} /></button></div></article>)}{!coupons.length && <div className="admin-empty-state">{copy.emptyState}</div>}</div></section><button className="button button-quiet" onClick={() => { void query.refetch(); onNotice(copy.notices.refreshed) }}><RefreshCw size={15} /> {copy.refresh}</button></section>
}
