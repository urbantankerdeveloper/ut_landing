import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { vendorApi, type MultiServiceFulfilment, type MultiServiceOffer } from '../../api/vendor'
import { demoDataEnabled } from '../../constants/demo'

const offersKey = ['vendor', 'multi-service-offers'] as const
const fulfilmentsKey = ['vendor', 'multi-service-fulfilments'] as const

function serviceTitle(item: MultiServiceOffer['items'][number]) {
  return item.service_types?.name ?? item.service_types?.code ?? 'Service'
}

export function MultiServiceVendorPanel() {
  const queryClient = useQueryClient()
  const fallbackInterval = import.meta.env.VITE_SOCKET_DRIVEN_REFRESH === 'true' ? 120_000 : 30_000
  const offers = useQuery({
    queryKey: offersKey,
    queryFn: vendorApi.multiServiceOffers,
    enabled: !demoDataEnabled,
    refetchInterval: fallbackInterval,
    refetchIntervalInBackground: false,
  })
  const fulfilments = useQuery({
    queryKey: fulfilmentsKey,
    queryFn: vendorApi.multiServiceFulfilments,
    enabled: !demoDataEnabled,
    refetchInterval: fallbackInterval,
    refetchIntervalInBackground: false,
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: offersKey }),
    queryClient.invalidateQueries({ queryKey: fulfilmentsKey }),
  ])
  const accept = useMutation({ mutationFn: vendorApi.acceptMultiServiceOffer, onSuccess: refresh })
  const reject = useMutation({ mutationFn: vendorApi.rejectMultiServiceOffer, onSuccess: refresh })
  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'en_route' | 'arrived' }) => vendorApi.transitionMultiServiceFulfilment(id, status),
    onSuccess: refresh,
  })
  const drop = useMutation({ mutationFn: vendorApi.dropMultiServiceFulfilment, onSuccess: refresh })
  const verify = useMutation({
    mutationFn: ({ id, otp }: { id: string; otp: string }) => vendorApi.verifyMultiServiceFulfilmentDelivery(id, otp),
    onSuccess: refresh,
  })
  const [codes, setCodes] = useState<Record<string, string>>({})
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [locationMessage, setLocationMessage] = useState<string | null>(null)
  const activeLocationIds = useMemo(
    () => (fulfilments.data ?? []).filter((item) => item.status === 'en_route' || item.status === 'arrived').map((item) => item.id).join(','),
    [fulfilments.data],
  )

  useEffect(() => {
    if (!activeLocationIds || !navigator.geolocation) return undefined
    const ids = activeLocationIds.split(',')
    let lastSentAt = 0
    const watchId = navigator.geolocation.watchPosition((position) => {
      if (Date.now() - lastSentAt < 15_000) return
      lastSentAt = Date.now()
      for (const id of ids) {
        void vendorApi.updateMultiServiceFulfilmentLocation(id, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }).then(() => setLocationMessage('Live fulfilment location updated.'))
          .catch((error: unknown) => setLocationMessage(error instanceof Error ? error.message : 'Live location update failed.'))
      }
    }, (error) => setLocationMessage(error.message || 'Live location permission is unavailable.'))
    return () => navigator.geolocation.clearWatch(watchId)
  }, [activeLocationIds])

  if (demoDataEnabled) return null
  if (offers.isLoading || fulfilments.isLoading) return <p role="status">Loading multi-service work…</p>
  if (offers.isError || fulfilments.isError) return <p role="alert">Multi-service work could not be loaded. Refresh the orders page to retry.</p>

  return <section className="vendor-multi-service-panel" aria-label="Multi-service orders">
    <h3>Multi-service offers</h3>
    {!offers.data?.length && <p>No active service offers.</p>}
    {(offers.data ?? []).map((offer: MultiServiceOffer) => (
      <article className="vendor-order-card" key={offer.id}>
        <strong>{offer.order?.reference ?? 'Order'} · {offer.is_bundle ? 'Bundle' : 'Service offer'}</strong>
        <ul>{offer.items.map((item) => <li key={item.id}>{serviceTitle(item)} · ₹{((item.locked_price_paise ?? 0) / 100).toLocaleString('en-IN')}</li>)}</ul>
        <div className="vendor-order-actions">
          <button className="button button-primary" disabled={accept.isPending} onClick={() => accept.mutate(offer.id)}>Accept</button>
          <button className="button button-quiet" disabled={reject.isPending} onClick={() => reject.mutate(offer.id)}>Decline</button>
        </div>
      </article>
    ))}
    <h3>Assigned fulfilments</h3>
    {locationMessage && <p role="status">{locationMessage}</p>}
    {!fulfilments.data?.length && <p>No assigned fulfilments.</p>}
    {(fulfilments.data ?? []).map((fulfilment: MultiServiceFulfilment) => (
      <article className="vendor-order-card" key={fulfilment.id}>
        <strong>{fulfilment.orders?.reference ?? fulfilment.reference}</strong>
        <p>Status: {fulfilment.status.replace(/_/g, ' ')}</p>
        <ul>{(fulfilment.order_fulfilment_items ?? []).flatMap((link) => link.order_items ? [link.order_items] : []).map((item, index) => (
          <li key={item.id ?? index}>{item.service_types?.name ?? item.service_types?.code ?? 'Service'} · {item.location ?? 'Location unavailable'}</li>
        ))}</ul>
        {fulfilment.status === 'accepted' && <div className="vendor-order-actions">
          <button className="button button-primary" disabled={transition.isPending} onClick={() => transition.mutate({ id: fulfilment.id, status: 'en_route' })}>Start delivery</button>
          <button className="button button-quiet" disabled={drop.isPending} onClick={() => drop.mutate(fulfilment.id)}>Drop and re-dispatch</button>
        </div>}
        {fulfilment.status === 'en_route' && <button className="button button-primary" disabled={transition.isPending} onClick={() => transition.mutate({ id: fulfilment.id, status: 'arrived' })}>Mark arrived</button>}
        {fulfilment.status === 'arrived' && <form className="vendor-order-actions" onSubmit={(event) => {
          event.preventDefault()
          const otp = codes[fulfilment.id] ?? ''
          if (!/^\d{6}$/.test(otp)) {
            setMessages((current) => ({ ...current, [fulfilment.id]: 'Enter the six-digit delivery code.' }))
            return
          }
          verify.mutate({ id: fulfilment.id, otp }, {
            onSuccess: () => setMessages((current) => ({ ...current, [fulfilment.id]: 'Delivery verified.' })),
            onError: (error) => setMessages((current) => ({ ...current, [fulfilment.id]: error instanceof Error ? error.message : 'Verification failed.' })),
          })
        }}>
          <label>Delivery OTP<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={codes[fulfilment.id] ?? ''} onChange={(event) => setCodes((current) => ({ ...current, [fulfilment.id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} /></label>
          <button className="button button-primary" type="submit" disabled={verify.isPending}>Verify delivery</button>
          {messages[fulfilment.id] && <span role="status">{messages[fulfilment.id]}</span>}
        </form>}
      </article>
    ))}
  </section>
}
