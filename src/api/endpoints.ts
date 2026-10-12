import { apiFetch } from './client'
export type Service = { id: string; name: string; description: string; category: string; accent: string }
export type BookingRequest = { serviceId: string; capacity: string; location: string; deliveryDate: string }
export const endpoints = { services: () => apiFetch<Service[]>('/services'), createBooking: (payload: BookingRequest) => apiFetch<{ id: string }>('/orders', { method: 'POST', body: JSON.stringify(payload) }) }
